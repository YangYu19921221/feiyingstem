"""家长端 API
- 学生生成绑定码 → 家长用绑定码注册并自动绑定
- 已注册家长可继续绑定其他孩子（多孩支持）
- 家长看自己孩子的完整学习数据看板
"""
import secrets
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_, case, Integer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range, local_today_utc_range
from app.api.v1.auth import get_current_student, get_current_parent, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class, get_my_class_student_ids
from app.services.auth_service import get_password_hash, verify_password, verify_password_async, create_access_token
from app.services import login_guard
from app.models.user import User, ParentStudentLink, ParentBindCode, Class, ClassStudent
from app.services import audit_log, rate_limit
from app.models.learning import LearningRecord, StudySession, WordMastery
from app.models.word import Word
from app.api.v1._weekly_report import build_and_cache_weekly_report, WeeklyReportResponse
from app.services.weak_words import top_wrong_words, mastery_buckets, NON_LEARNED_MODES
from app.services import daily_words, study_time

router = APIRouter()


# ================== Schemas ==================

class BindCodeResponse(BaseModel):
    code: str
    expires_at: datetime
    minutes_left: int


class ParentRegisterRequest(BaseModel):
    bind_code: str = Field(..., min_length=6, max_length=12)  # 带空格粘进来的也收,_normalize_code 再去
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$")
    password: str = Field(..., min_length=6, max_length=64)
    full_name: Optional[str] = Field(None, max_length=50)


class ParentLoginRequest(BaseModel):
    phone: str
    password: str


class ParentTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    parent_id: int
    full_name: Optional[str]


class ChildSummary(BaseModel):
    student_id: int
    username: str
    full_name: Optional[str]
    today_minutes: int
    today_words: int
    streak_days: int


class BindAdditionalRequest(BaseModel):
    bind_code: str = Field(..., min_length=6, max_length=12)


# ================== 绑定码 ==================
# 两种码同一张表(code 列 8 字符),**按有没有字母区分**:
# - 学生自己生成: 8 位纯数字(孩子要念给家长听),24 小时有效 —— 原来 6 位 5 分钟,
#   孩子在电教室生成、晚上回家才见到家长,码早过期了。有效期拉长后 6 位数字太好猜(见 _limit_bind)
# - 老师替学生生成: 8 位、首字符必是字母,7 天有效,拼成链接发家长群/私聊(家长点开码已填好)
# 两种都是一次性的: 码 = 「看这个孩子全部学习数据」的钥匙,发错人能看到别人家孩子
STUDENT_CODE_TTL = timedelta(hours=24)
STUDENT_CODE_LEN = 8
TEACHER_CODE_TTL = timedelta(days=7)
_TEACHER_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # 去掉 I/O,家长手抄不会错
_TEACHER_ALPHABET = _TEACHER_LETTERS + "23456789"  # 去掉 0/1


def is_teacher_code(code: str) -> bool:
    return not code.isdigit()
# 注册/绑定按 IP 限速防猜码。家长会在同一个 Wi-Fi 下集中注册(家长会),别卡太死
BIND_RATE_LIMIT = (30, 600)
BIND_FAIL_KEY = ("parent-bind-fail",)
BIND_FAIL_LIMIT = (100, 600)


def _normalize_code(code: str) -> str:
    return (code or "").strip().replace(" ", "").upper()


async def _new_bind_code(db: AsyncSession, student_id: int, teacher: bool) -> ParentBindCode:
    """code 是主键,用过/过期的码不删,随机撞上旧码会 IntegrityError —— 先查再插"""
    for _ in range(20):
        if teacher:
            code = secrets.choice(_TEACHER_LETTERS) + "".join(secrets.choice(_TEACHER_ALPHABET) for _ in range(7))
        else:
            code = "".join(secrets.choice("0123456789") for _ in range(STUDENT_CODE_LEN))
        if await db.get(ParentBindCode, code) is None:
            break
    else:
        raise HTTPException(503, "绑定码生成失败,请重试")
    row = ParentBindCode(code=code, student_id=student_id,
                         expires_at=datetime.utcnow() + (TEACHER_CODE_TTL if teacher else STUDENT_CODE_TTL))
    db.add(row)
    return row


async def _load_valid_code(db: AsyncSession, raw: str) -> ParentBindCode:
    code_row = await db.get(ParentBindCode, _normalize_code(raw))
    if not code_row:
        await _bind_failed()
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "绑定码不对,请核对后重输,或请老师/孩子重新生成"})
    if code_row.used_at is not None:
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "这个绑定码已经用过了,请老师/孩子重新生成"})
    if code_row.expires_at < datetime.utcnow():
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "绑定码已过期,请老师/孩子重新生成"})
    return code_row


def _parent_token(user_id: int, session_ver: int = 0) -> str:
    # 家长一周才看一两次,7 天的默认 token 等于每次都要重新登录 → 30 天。
    # 带 sv: 老师重置家长密码时 session_ver+1,手里的旧 token 一起作废(见 auth_service.session_ok)
    return create_access_token({"sub": str(user_id), "sv": session_ver or 0},
                               expires_delta=timedelta(days=30))


async def _limit_bind(request: Request) -> None:
    """单 IP 限速 + 全站「输错码」总量闸门(换 IP 也绕不过)。
    全站 10 分钟错 100 次远超正常(家长会上几十个家长也就错几次),到了就整体先停,只在真被猜时误伤。
    算账: 一天最多试 1.44 万次;同时有效的学生码按 50 个算,8 位数字一天猜中的期望 ≈ 0.007 个
    (6 位数字是 0.7 个,所以有效期拉到 24 小时必须同时加长到 8 位)"""
    await rate_limit.check(("parent-bind", audit_log.client_ip(request) or "-"), *BIND_RATE_LIMIT,
                     "尝试次数太多,请 10 分钟后再试")
    if await rate_limit.count(BIND_FAIL_KEY, BIND_FAIL_LIMIT[1]) >= BIND_FAIL_LIMIT[0]:
        raise HTTPException(429, "绑定码输错的人太多,系统先暂停一会儿,请 10 分钟后再试")


async def _bind_failed() -> None:
    await rate_limit.record(BIND_FAIL_KEY, BIND_FAIL_LIMIT[1])


@router.post("/student/parent-bind-codes", response_model=BindCodeResponse)
async def generate_parent_bind_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """学生发起 — 生成 8 位数字绑定码（24 小时有效），告诉家长去注册"""
    row = await _new_bind_code(db, current_user.id, teacher=False)
    code, expires_at = row.code, row.expires_at
    await db.commit()
    return BindCodeResponse(code=code, expires_at=expires_at,
                            minutes_left=int(STUDENT_CODE_TTL.total_seconds() // 60))


# ================== 家长：注册（含绑定）==================

@router.post("/parent/register", response_model=ParentTokenResponse)
async def parent_register(
    data: ParentRegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """家长注册：绑定码必填，验证后建账户 + 自动绑定该孩子

    手机号只和**家长号**查重: 孩子的学生号注册时填的多半就是这个手机号
    (生产 793 个学生 768 个填了手机),原来跟所有角色查重 → 家长一个都注册不上。
    已有家长号且密码对 → 直接把这个孩子绑上并登录(家长忘了自己注册过,是常态)。
    """
    await _limit_bind(request)
    code_row = await _load_valid_code(db, data.bind_code)
    student_id = code_row.student_id

    existing_parent = (await db.execute(
        select(User).where(User.phone == data.phone, User.role == "parent")
        .execution_options(skip_tenant_filter=True).limit(1)
    )).scalars().first()
    if existing_parent is not None:
        # 这里等于一个「凭绑定码试家长密码」的入口,和登录走同一道防爆破闸门
        keys = login_guard.account_keys([existing_parent.id])
        await login_guard.check(audit_log.client_ip(request), keys, staff=False)
        if not await verify_password_async(data.password, existing_parent.hashed_password):
            raise HTTPException(400, detail={"code": "phone_taken",
                                             "message": "这个手机号已经注册过家长账号,密码不对。请直接登录,登录后点「绑定孩子」输入绑定码"})
        if not existing_parent.is_active:
            raise HTTPException(403, detail={"code": "inactive", "message": "账号已被禁用，请联系管理员"})
        await login_guard.record_success(audit_log.client_ip(request), keys)
        await _link(db, existing_parent.id, code_row)
        await db.commit()
        return ParentTokenResponse(access_token=_parent_token(existing_parent.id, existing_parent.session_ver),
                                   parent_id=existing_parent.id, full_name=existing_parent.full_name)

    # org_id 跟孩子走: 不写就落列默认 1(直营),家长请求的租户上下文就是直营,
    # 非直营孩子的家长看不到孩子(User 是锚点表,按 org 过滤)。推荐链接按孩子的机构归属,同理
    child = (await db.execute(
        select(User).where(User.id == student_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    parent = User(
        username=f"parent_{data.phone}",
        email=f"{data.phone}@parent.local",
        phone=data.phone,
        hashed_password=get_password_hash(data.password),
        full_name=(data.full_name or "").strip() or f"{data.phone[-4:]} 的家长",
        role="parent",
        org_id=child.org_id if child is not None else 1,
    )
    db.add(parent)
    try:
        await db.flush()
    except IntegrityError:
        # 同一手机号两台设备同时注册: username=parent_{手机号} 唯一,后到的撞上
        await db.rollback()
        raise HTTPException(400, detail={"code": "phone_taken", "message": "这个手机号刚刚注册过家长账号,请直接登录"})
    parent_id, parent_name = parent.id, parent.full_name

    await _link(db, parent_id, code_row)
    await db.commit()

    return ParentTokenResponse(
        access_token=_parent_token(parent_id),
        parent_id=parent_id,
        full_name=parent_name,
    )


async def _link(db: AsyncSession, parent_id: int, code_row: ParentBindCode) -> None:
    """绑定 + 标记码已用。已经绑过这个孩子也把码用掉(否则一个码能反复试)"""
    exists = (await db.execute(
        select(ParentStudentLink.id).where(
            ParentStudentLink.parent_id == parent_id,
            ParentStudentLink.student_id == code_row.student_id,
        ).limit(1)
    )).scalar_one_or_none()
    if exists is None:
        db.add(ParentStudentLink(parent_id=parent_id, student_id=code_row.student_id))
    code_row.used_at = datetime.utcnow()


# ================== 家长：登录 ==================

@router.post("/parent/login", response_model=ParentTokenResponse)
async def parent_login(
    data: ParentLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await rate_limit.check(("parent-login", audit_log.client_ip(request) or "-"), 60, 600,
                     "尝试次数太多,请 10 分钟后再试")
    phone = (data.phone or "").strip()
    user = (await db.execute(
        select(User).where(User.phone == phone, User.role == "parent")
        .execution_options(skip_tenant_filter=True).limit(1)
    )).scalars().first()
    if user is None:
        # 这个号只有孩子的学生号: 家长常以为「孩子用我手机号注册了,我就能登」
        is_student = (await db.execute(
            select(User.id).where(User.phone == phone, User.role != "parent")
            .execution_options(skip_tenant_filter=True).limit(1)
        )).scalar_one_or_none() is not None
        raise HTTPException(401, detail={
            "code": "user_not_found",
            "message": ("这个手机号是孩子的学生账号,家长账号还没注册。请用老师或孩子给的绑定码注册(手机号可以一样)"
                        if is_student else "该手机号还没有注册家长账号"),
        })
    keys = login_guard.account_keys([user.id])
    await login_guard.check(audit_log.client_ip(request), keys, staff=False)
    if not await verify_password_async(data.password, user.hashed_password):
        raise HTTPException(401, detail={"code": "wrong_password", "message": "密码不正确，请重试"})
    await login_guard.record_success(audit_log.client_ip(request), keys)
    if not user.is_active:
        raise HTTPException(403, detail={"code": "inactive", "message": "账号已被禁用，请联系管理员"})

    return ParentTokenResponse(
        access_token=_parent_token(user.id, user.session_ver),
        parent_id=user.id,
        full_name=user.full_name,
    )


# ================== 家长：再绑定一个孩子 ==================

@router.post("/parent/bind", response_model=ChildSummary)
async def parent_bind_additional_child(
    data: BindAdditionalRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """已登录家长再绑定一个新孩子"""
    await _limit_bind(request)
    code_row = await _load_valid_code(db, data.bind_code)
    student_id = code_row.student_id

    # 是否已绑过
    existing = await db.execute(
        select(ParentStudentLink).where(
            and_(
                ParentStudentLink.parent_id == current_parent.id,
                ParentStudentLink.student_id == student_id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "已经绑定过这个孩子")

    db.add(ParentStudentLink(parent_id=current_parent.id, student_id=student_id))
    code_row.used_at = datetime.utcnow()
    await db.commit()

    return await _build_child_summary(db, student_id)


# ================== 老师：替学生给家长发绑定链接 ==================
# 学生自己生成绑定码的入口藏在光荣榜里,一年 363 个码 0 个家长绑上。
# 真正能把家长拉进来的是老师: 在家长群/私聊里一人发一条链接。

def _mask_phone(p: Optional[str]) -> str:
    if not p or len(p) < 7:
        return p or ""
    return f"{p[:3]}****{p[-4:]}"


@router.get("/teacher/parent-binding/students")
async def teacher_parent_binding_students(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """本班学生 + 每人绑了哪些家长 + 有没有还没用的链接(老师端「家长绑定」页)"""
    sids = await get_my_class_student_ids(db, current_user.id)
    if not sids:
        return {"items": [], "bound": 0, "total": 0}

    students = (await db.execute(
        select(User.id, User.username, User.full_name).where(User.id.in_(sids))
    )).all()
    class_rows = (await db.execute(
        select(ClassStudent.student_id, Class.name)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == current_user.id, ClassStudent.is_active.is_(True),
               ClassStudent.student_id.in_(sids))
    )).all()
    class_of: dict[int, str] = {}
    for sid, cname in class_rows:
        class_of.setdefault(sid, cname)

    # 家长号的 org_id 跟孩子走,但老数据可能不一致 —— 跨机构读家长行,范围已由 sids 收住
    links = (await db.execute(
        select(ParentStudentLink.id, ParentStudentLink.student_id, ParentStudentLink.bound_at,
               User.full_name, User.phone)
        .join(User, User.id == ParentStudentLink.parent_id)
        .where(ParentStudentLink.student_id.in_(sids))
        .order_by(ParentStudentLink.id)
        .execution_options(skip_tenant_filter=True)
    )).all()
    parents_of: dict[int, list] = {}
    for lid, sid, bound_at, pname, phone in links:
        parents_of.setdefault(sid, []).append({
            "link_id": lid, "name": pname or "", "phone": _mask_phone(phone), "bound_at": bound_at,
        })

    now = datetime.utcnow()
    pending = (await db.execute(
        select(ParentBindCode.student_id, ParentBindCode.code, ParentBindCode.expires_at)
        .where(ParentBindCode.student_id.in_(sids), ParentBindCode.used_at.is_(None),
               ParentBindCode.expires_at > now)
        .order_by(ParentBindCode.expires_at)
    )).all()
    # 只认老师发的链接码: 孩子自己生成的码是念给家长听的,不该冒充成「已发的链接」
    pending_of = {sid: {"code": code, "expires_at": exp}
                  for sid, code, exp in pending if is_teacher_code(code)}

    items = [{
        "id": sid, "username": uname, "full_name": fname or "",
        "class_name": class_of.get(sid, ""),
        "parents": parents_of.get(sid, []),
        "pending": pending_of.get(sid),
    } for sid, uname, fname in students]
    # 没绑家长的排前面: 打开这页就是为了挨个发链接
    items.sort(key=lambda x: (len(x["parents"]) > 0, x["class_name"], x["full_name"] or x["username"]))
    return {"items": items, "bound": sum(1 for x in items if x["parents"]), "total": len(items)}


async def _teacher_code(db: AsyncSession, student_id: int, renew: bool) -> tuple[ParentBindCode, bool, bool]:
    """(码, 是不是新生成的, 有没有作废旧码)。
    已有没用掉的链接默认原样返回: 老师可能已经发出去了,换码会让家长手里那条失效。
    renew=True 才作废旧的换新的(发错人了)。"""
    now = datetime.utcnow()
    old = [r for r in (await db.execute(
        select(ParentBindCode).where(
            ParentBindCode.student_id == student_id, ParentBindCode.used_at.is_(None),
            ParentBindCode.expires_at > now,
        ).order_by(ParentBindCode.expires_at.desc())
    )).scalars().all() if is_teacher_code(r.code)]
    if old and not renew:
        return old[0], False, False
    for r in old:  # 作废 = 让它过期(used_at 留给「真被用了」,事后查得清)
        r.expires_at = now
    return await _new_bind_code(db, student_id, teacher=True), True, bool(old)


class BatchCodeRequest(BaseModel):
    student_ids: list[int] = Field(..., min_length=1, max_length=200)


@router.post("/teacher/parent-binding/students/{student_id}/code")
async def teacher_parent_bind_code(
    student_id: int,
    request: Request,
    renew: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """给本班学生的家长生成绑定链接(7 天有效,一次性)"""
    if current_user.role != "admin":
        await assert_student_in_my_class(db, current_user.id, student_id)
    student = (await db.execute(select(User).where(User.id == student_id))).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(404, "学生不存在")
    child_name, child_label = student.full_name or "", student.full_name or student.username

    row, created, renewed = await _teacher_code(db, student_id, renew)
    code, expires_at = row.code, row.expires_at
    if created:
        audit_log.record(db, request, current_user, "parent.bind_link",
                         f"给「{child_label}」的家长生成绑定链接" + ("(换新,旧链接作废)" if renewed else ""),
                         target_type="user", target_id=student_id)
        await db.commit()
    return {"code": code, "expires_at": expires_at, "child_name": child_name, "renewed": renewed}


@router.post("/teacher/parent-binding/codes")
async def teacher_parent_bind_codes(
    body: BatchCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """一次给多个学生拿绑定码(打印「家长绑定条」用,孩子带回家)。已有没用掉的照旧返回同一个码"""
    ids = list(dict.fromkeys(body.student_ids))
    if current_user.role != "admin":
        mine = await get_my_class_student_ids(db, current_user.id)
        if any(i not in mine for i in ids):
            raise HTTPException(403, "只能给自己班里的学生生成")
    students = (await db.execute(
        select(User.id, User.username, User.full_name).where(User.id.in_(ids), User.role == "student")
    )).all()
    out, created_n = [], 0
    for sid, uname, fname in students:
        row, created, _ = await _teacher_code(db, sid, False)
        created_n += int(created)
        out.append({"student_id": sid, "child_name": fname or "", "username": uname,
                    "code": row.code, "expires_at": row.expires_at})
    if created_n:
        audit_log.record(db, request, current_user, "parent.bind_link",
                         f"批量生成家长绑定链接 {created_n} 个(打印绑定条)",
                         detail={"student_ids": [o["student_id"] for o in out]})
    await db.commit()
    order = {sid: i for i, sid in enumerate(ids)}
    out.sort(key=lambda o: order.get(o["student_id"], 0))
    return {"items": out}


@router.post("/teacher/parent-binding/links/{link_id}/reset-password")
async def teacher_reset_parent_password(
    link_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """家长忘了密码: 生产没配短信,家长端没有自助找回,只能老师重置。
    只在这个家长绑定的**每个**孩子都在本班时放行 —— 他还绑着别班的孩子,
    重置等于让这个老师进得去别班孩子的家长号。新密码只在响应里出现这一次"""
    from app.services.auth_service import generate_random_password

    link = (await db.execute(
        select(ParentStudentLink).where(ParentStudentLink.id == link_id)
    )).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "绑定关系不存在")
    parent_id = link.parent_id
    mine = await get_my_class_student_ids(db, current_user.id)
    if current_user.role != "admin":
        if link.student_id not in mine:
            raise HTTPException(403, "无权操作该学生")
        kids = (await db.execute(
            select(ParentStudentLink.student_id).where(ParentStudentLink.parent_id == parent_id)
        )).scalars().all()
        if any(k not in mine for k in kids):
            raise HTTPException(403, "这位家长还绑定了别的班的孩子,请找机构管理员在「用户管理」里重置")
    parent = (await db.execute(
        select(User).where(User.id == parent_id, User.role == "parent")
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if parent is None:
        raise HTTPException(404, "家长账号不存在")

    pwd = generate_random_password(8)
    parent.hashed_password = get_password_hash(pwd)
    parent.session_ver = (parent.session_ver or 0) + 1  # 重置 = 可能泄露了,家长手里的旧登录作废
    audit_log.record(db, request, current_user, "parent.reset_password",
                     f"重置家长「{parent.full_name or ''} {_mask_phone(parent.phone)}」的密码",
                     target_type="user", target_id=parent_id)
    await db.commit()
    return {"password": pwd}


@router.delete("/teacher/parent-binding/links/{link_id}")
async def teacher_remove_parent_link(
    link_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """解除绑定(链接发错人了 / 家长换了)。家长账号本身不删"""
    link = (await db.execute(
        select(ParentStudentLink).where(ParentStudentLink.id == link_id)
    )).scalar_one_or_none()
    if link is None:
        raise HTTPException(404, "绑定关系不存在")
    if current_user.role != "admin":
        await assert_student_in_my_class(db, current_user.id, link.student_id)
    parent = (await db.execute(
        select(User.full_name, User.phone).where(User.id == link.parent_id)
        .execution_options(skip_tenant_filter=True)
    )).first()
    student = (await db.execute(select(User.full_name, User.username).where(User.id == link.student_id))).first()
    audit_log.record(db, request, current_user, "parent.unbind",
                     f"解除「{(student.full_name or student.username) if student else link.student_id}」与家长"
                     f"「{(parent.full_name if parent else '') or ''} {_mask_phone(parent.phone if parent else '')}」的绑定",
                     target_type="user", target_id=link.student_id,
                     detail={"parent_id": link.parent_id, "student_id": link.student_id})
    await db.delete(link)
    await db.commit()
    return {"ok": True}


# ================== 家长：我的孩子列表 ==================

@router.get("/parent/children", response_model=list[ChildSummary])
async def parent_list_children(
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    res = await db.execute(
        select(ParentStudentLink.student_id)
        .where(ParentStudentLink.parent_id == current_parent.id)
    )
    student_ids = [r[0] for r in res.all()]
    return [await _build_child_summary(db, sid) for sid in student_ids]


async def _build_child_summary(db: AsyncSession, student_id: int) -> ChildSummary:
    res = await db.execute(select(User).where(User.id == student_id))
    student = res.scalar_one()

    today, tomorrow = local_today_utc_range()  # 北京今天的 UTC 区间

    # 今日学习分钟:走全站统一口径(日历与会话逐日取较大值,各自封顶)。
    # 原来是裸 sum(StudySession.time_spent) —— 复习模式和中途退出的会话系统性低报,
    # 家长看到的时长比老师端小一截
    today_minutes = await study_time.seconds_on_day(db, student_id, local_today()) // 60

    # 今日学习单词数:走全站统一口径(distinct lower(word) + 排除 classify)。
    # 原来是 distinct(word_id) 且不排除 classify —— 家长看到的数会比老师看到的大。
    today_words = await daily_words.words_total(db, [student_id], today, tomorrow)

    # 连续打卡：复用 dashboard 简化版
    streak_days = 0
    cur = today
    while True:
        nxt = cur + timedelta(days=1)
        res = await db.execute(
            select(func.count(LearningRecord.id))
            .where(and_(
                LearningRecord.user_id == student_id,
                LearningRecord.created_at >= cur,
                LearningRecord.created_at < nxt,
            ))
        )
        if (res.scalar() or 0) > 0:
            streak_days += 1
            cur -= timedelta(days=1)
            if streak_days >= 365:
                break
        else:
            break

    return ChildSummary(
        student_id=student.id,
        username=student.username,
        full_name=student.full_name,
        today_minutes=today_minutes,
        today_words=today_words,
        streak_days=streak_days,
    )


# ================== 家长：单孩完整看板 ==================

class WeakWordItem(BaseModel):
    word: str
    meaning: Optional[str]
    wrong_count: int


class BookProgressItem(BaseModel):
    book_id: int
    book_name: str
    progress_percentage: float
    completed_units: int
    total_units: int


class RankInfo(BaseModel):
    rank: Optional[int]
    total: int
    value: int


class HeatmapDay(BaseModel):
    date: str
    minutes: int


class ChildDashboard(BaseModel):
    student_id: int
    full_name: Optional[str]
    username: str
    # 今日 + 累计
    today_minutes: int
    today_words: int
    streak_days: int
    # 复习进度（与 /student/review-progress 同口径）
    review_due_today: int = 0
    review_done_today: int = 0
    graduated_words: int = 0
    total_words_learned: int
    total_words_mastered: int
    total_minutes: int
    # 本周对比
    this_week_minutes: int
    last_week_minutes: int
    this_week_words: int
    last_week_words: int
    this_week_accuracy: int
    last_week_accuracy: int
    # 排名（系统全部学生）
    rank_vocabulary: RankInfo
    rank_diligence: RankInfo
    rank_accuracy: RankInfo
    # 30 天热力图
    heatmap: list[HeatmapDay]
    # 薄弱词
    weak_words: list[WeakWordItem]
    # 单词本进度
    books: list[BookProgressItem]
    # 成就
    unlocked_achievements: int
    total_achievements: int


@router.get("/parent/children/{student_id}/dashboard", response_model=ChildDashboard)
async def parent_child_dashboard(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """家长看孩子完整数据看板"""
    # 1. 校验权限：必须是自己绑定的孩子
    res = await db.execute(
        select(ParentStudentLink).where(and_(
            ParentStudentLink.parent_id == current_parent.id,
            ParentStudentLink.student_id == student_id,
        ))
    )
    if not res.scalar_one_or_none():
        raise HTTPException(403, "无权查看该孩子的数据")

    res = await db.execute(select(User).where(User.id == student_id))
    student = res.scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")

    now = datetime.utcnow()
    _today_d = local_today()
    today, tomorrow = local_day_utc_range(_today_d)
    _monday = _today_d - timedelta(days=_today_d.weekday())
    week_start, _ = local_day_utc_range(_monday)
    week_end, _ = local_day_utc_range(_monday + timedelta(days=7))
    last_week_start, _ = local_day_utc_range(_monday - timedelta(days=7))

    # 今日 / 累计:时长走全站统一口径(逐日取较大值再相加,各自封顶)
    today_minutes = await study_time.seconds_on_day(db, student_id, _today_d) // 60

    # 同上:统一口径,与教师端「今日学词」一致
    today_words = await daily_words.words_total(db, [student_id], today, tomorrow)

    total_minutes = await study_time.seconds_total(db, student_id) // 60

    # 已学/已掌握走全站唯一口径(按拼写去重、排除只做过分类识别的词);
    # 原先已学用 count(WordMastery.id) 数原始行,单元隔离下同拼写多 word_id 会虚高,
    # 和家长在教师端看到的数对不上
    _pb = (await mastery_buckets(db, [student_id])).get(student_id, {})
    total_words_learned = _pb.get("words", 0)
    total_words_mastered = _pb.get("mastered", 0)

    # streak
    streak_days = 0
    cur = today
    for _ in range(365):
        nxt = cur + timedelta(days=1)
        res = await db.execute(
            select(func.count(LearningRecord.id))
            .where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= cur, LearningRecord.created_at < nxt))
        )
        if (res.scalar() or 0) > 0:
            streak_days += 1
            cur -= timedelta(days=1)
        else:
            break

    # 本周/上周对比
    async def period_stats(start: datetime, end: datetime, start_day: date, end_day: date) -> tuple[int, int, int]:
        # 时长走全站统一口径(逐日取较大值);end_day 是闭区间的最后一天
        minutes = await study_time.seconds_total(db, student_id, start_day, end_day) // 60
        # 按拼写去重 + 排除 classify(全站口径)。保留 is_correct:这里的语义是
        # "答对过的词",与下面词汇王排名必须完全同口径,否则会出现
        # "我的词数比第一名多却排第二"
        r2 = await db.execute(
            select(func.count(func.distinct(func.lower(Word.word))))
            .select_from(LearningRecord)
            .join(Word, Word.id == LearningRecord.word_id)
            .where(and_(
                LearningRecord.user_id == student_id,
                LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
                LearningRecord.created_at >= start, LearningRecord.created_at < end,
                LearningRecord.is_correct.is_(True),
            ))
        )
        words = int(r2.scalar() or 0)
        r3 = await db.execute(
            select(
                func.count(LearningRecord.id),
                func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)),
            ).where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= start, LearningRecord.created_at < end))
        )
        row = r3.first()
        accuracy = int((row[1] or 0) * 100 / row[0]) if row and row[0] else 0
        return minutes, words, accuracy

    this_week_minutes, this_week_words, this_week_accuracy = await period_stats(
        week_start, week_end, _monday, _monday + timedelta(days=6))
    last_week_minutes, last_week_words, last_week_accuracy = await period_stats(
        last_week_start, week_start, _monday - timedelta(days=7), _monday - timedelta(days=1))

    # 系统全部学生中的排名
    async def rank_info(metric_query, my_value: int) -> RankInfo:
        res = await db.execute(metric_query)
        rows = res.all()
        my_rank = None
        for rank, row in enumerate(rows, start=1):
            if row[0] == student_id:
                my_rank = rank
                break
        return RankInfo(rank=my_rank, total=len(rows), value=my_value)

    def rank_from_rows(rows: list[tuple[int, int]], my_value: int) -> RankInfo:
        """已在 Python 侧排好序的 [(uid, 值)] 直接定名次(口径与显示值同源)。"""
        my_rank = None
        for rank, (uid, _v) in enumerate(rows, start=1):
            if uid == student_id:
                my_rank = rank
                break
        return RankInfo(rank=my_rank, total=len(rows), value=my_value)

    # 词汇王（本周）—— 口径必须与上面 period_stats 的 words 完全一致
    vocab_query = (
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))).label("v"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
            LearningRecord.created_at >= week_start, LearningRecord.created_at < week_end,
            LearningRecord.is_correct.is_(True),
        ))
        .group_by(LearningRecord.user_id)
        .order_by(func.count(func.distinct(func.lower(Word.word))).desc())
    )
    rank_vocabulary = await rank_info(vocab_query, this_week_words)

    # 勤奋王（本周）—— 名次与上面 this_week_minutes 同源(study_time 统一口径),
    # 原先名次按裸 sum(StudySession.time_spent) 排、数值按另一套显示,会自相矛盾
    diligence_rows = await study_time.seconds_rows(
        db, None, _monday, _monday + timedelta(days=6))
    rank_diligence = rank_from_rows(diligence_rows, this_week_minutes)

    # 精准王（本周，>=20 题）
    accuracy_query = (
        select(
            LearningRecord.user_id,
            (func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)) * 100 / func.count(LearningRecord.id)).label("v"),
        )
        .where(and_(LearningRecord.created_at >= week_start, LearningRecord.created_at < week_end))
        .group_by(LearningRecord.user_id)
        .having(func.count(LearningRecord.id) >= 20)
        .order_by((func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)) * 100 / func.count(LearningRecord.id)).desc())
    )
    rank_accuracy = await rank_info(accuracy_query, this_week_accuracy)

    # 30 天热力图(时长走统一口径,与上方今日/本周同源)
    heatmap_days = [_today_d - timedelta(days=29 - i) for i in range(30)]
    heat_secs = await study_time.seconds_by_day(db, student_id, heatmap_days)
    heatmap = [
        HeatmapDay(date=str(d), minutes=heat_secs.get(d, 0) // 60)
        for d in heatmap_days
    ]

    # 薄弱词 TOP 10:只算计分模式的真实错误、按拼写去重,与教师端/周报同源
    # (原来读 word_mastery.wrong_count,分类自评的"我不认识"也算错,给家长报假错题)
    weak_words = [
        WeakWordItem(
            word=item["word"],
            meaning=item["meaning"],
            wrong_count=item["wrong_count"],
        )
        for item in await top_wrong_words(db, student_id, limit=10)
    ]

    # 单词本进度（复用 student/progress 的 logic 简化）
    from app.models.word import WordBook, Unit, BookWord
    from app.models.learning import LearningProgress, BookAssignment
    res = await db.execute(
        select(WordBook)
        .join(BookAssignment, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.student_id == student_id)
    )
    books = res.scalars().all()
    book_items: list[BookProgressItem] = []
    for book in books:
        unit_res = await db.execute(select(Unit).where(Unit.book_id == book.id))
        units = unit_res.scalars().all()
        unit_count = len(units)
        completed_units = 0
        for u in units:
            # 一个单元在不同 learning_mode 下可能有多条 LearningProgress
            # 任意一种模式完成即视为单元完成
            lp_res = await db.execute(
                select(func.max(func.cast(LearningProgress.is_completed, Integer)))
                .where(and_(
                    LearningProgress.user_id == student_id,
                    LearningProgress.unit_id == u.id,
                ))
            )
            if (lp_res.scalar() or 0) == 1:
                completed_units += 1
        progress_pct = (completed_units / unit_count * 100) if unit_count > 0 else 0
        book_items.append(BookProgressItem(
            book_id=book.id,
            book_name=book.name,
            progress_percentage=round(progress_pct, 1),
            completed_units=completed_units,
            total_units=unit_count,
        ))

    # 成就解锁数
    from app.models.user import Achievement, UserAchievement
    res = await db.execute(select(func.count(Achievement.id)))
    total_ach = int(res.scalar() or 0)
    res = await db.execute(
        select(func.count(UserAchievement.id))
        .where(UserAchievement.user_id == student_id)
    )
    unlocked_ach = int(res.scalar() or 0)

    # 复习进度（与 /student/review-progress 同口径）
    from app.api.v1.student.learning_records import compute_review_progress
    review_prog = await compute_review_progress(db, student_id)

    return ChildDashboard(
        student_id=student.id,
        full_name=student.full_name,
        username=student.username,
        today_minutes=today_minutes,
        today_words=today_words,
        streak_days=streak_days,
        review_due_today=review_prog["review_due_today"],
        review_done_today=review_prog["review_done_today"],
        graduated_words=review_prog["graduated_words"],
        total_words_learned=total_words_learned,
        total_words_mastered=total_words_mastered,
        total_minutes=total_minutes,
        this_week_minutes=this_week_minutes,
        last_week_minutes=last_week_minutes,
        this_week_words=this_week_words,
        last_week_words=last_week_words,
        this_week_accuracy=this_week_accuracy,
        last_week_accuracy=last_week_accuracy,
        rank_vocabulary=rank_vocabulary,
        rank_diligence=rank_diligence,
        rank_accuracy=rank_accuracy,
        heatmap=heatmap,
        weak_words=weak_words,
        books=book_items,
        unlocked_achievements=unlocked_ach,
        total_achievements=total_ach,
    )


# ================== 家长：孩子的 AI 学情周报 ==================

async def _assert_my_child(db: AsyncSession, parent_id: int, student_id: int):
    """校验 student_id 确实是该家长绑定的孩子,否则 403。"""
    res = await db.execute(
        select(ParentStudentLink).where(and_(
            ParentStudentLink.parent_id == parent_id,
            ParentStudentLink.student_id == student_id,
        ))
    )
    if not res.scalar_one_or_none():
        raise HTTPException(403, "无权查看该孩子的数据")


@router.get("/parent/children/{student_id}/weekly-report", response_model=WeeklyReportResponse)
async def parent_child_weekly_report(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """家长查看孩子本周 AI 学情周报(命中本周缓存则不重复调用 AI)。"""
    await _assert_my_child(db, current_parent.id, student_id)
    return await build_and_cache_weekly_report(db, student_id, force=False)


@router.post("/parent/children/{student_id}/weekly-report/regenerate", response_model=WeeklyReportResponse)
async def parent_regenerate_weekly_report(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """家长强制重新生成本周周报。"""
    await _assert_my_child(db, current_parent.id, student_id)
    # force=True 绕过缓存,每点一次都是一次真实 LLM 调用 —— 这是唯一对非员工角色
    # 开放的无限量 LLM 入口,必须限额(家长连点刷新就能烧钱)
    from app.services.ai_quota import check_and_consume
    await check_and_consume(current_parent.id, "weekly_report_regen", daily_limit=5)
    return await build_and_cache_weekly_report(db, student_id, force=True)
