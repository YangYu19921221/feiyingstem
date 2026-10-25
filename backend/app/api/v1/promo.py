"""地推体验卡 + 销售跟单 API —— 口径与规矩全在 services/promo.py

三组端点:
- 公开(卡上的二维码打开的落地页,无鉴权): GET /promo/public/{code}、POST /promo/public/{code}/leads
- 销售 / 机构管理员跟单(销售只看自己的,管理员看全机构): /promo/leads...、/promo/me...
- 机构管理员管理: 销售账号 /promo/sales...、卡码 /promo/channels...、看板 /promo/board、设置 /promo/settings

角色: 新增 role='sales'(销售)。**只给这一组接口放行**,其它所有接口按白名单判角色
(get_current_teacher / require_role / role=='student' 等),sales 一律进不去 —— 销售看不到学生学习数据。
平台 admin 按自己账号上的机构(直营)来管 —— 别家机构的体验卡由那家的机构管理员管,admin 不跨机构改。
"""
import os
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.users import guard_org_admin
from app.api.v1.auth import require_role
from app.core.actor import acting_user
from app.core.config import settings
from app.core.database import get_db
from app.core.timeutil import local_day_utc_range
from app.models.promo import PromoChannel, PromoLead
from app.models.user import User
from app.services import audit_log, auth_service, rate_limit
from app.services import promo as svc

router = APIRouter()

# 平台 admin 管的是自己挂的那个机构(生产上 admin 的 org_id=1 直营,直营没有单独的机构管理员账号)
get_promo_staff = require_role("sales", "org_admin", "admin")
get_promo_manager = require_role("org_admin", "admin")
get_platform_admin = require_role("admin")   # 各校区汇总只给平台管理员(机构管理员只看自己那家)

QR_DIR_NAME = "promo-qr"
QR_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_QR_SIZE = 2 * 1024 * 1024


def _scope(user: User) -> Optional[int]:
    """销售只看自己名下的线索;机构管理员看全机构(None = 不按人过滤)"""
    return user.id if user.role == "sales" else None


# ================== Schemas ==================

class LeadSubmit(BaseModel):
    # 长度在 service 里截断,这里放宽: 超长报 422 英文串对家长没用
    parent_phone: str = Field(..., max_length=30)
    parent_name: Optional[str] = Field(None, max_length=100)
    child_grade: Optional[str] = Field(None, max_length=50)


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = Field(None, max_length=4000)
    next_follow_at: Optional[str] = None      # 北京时间 YYYY-MM-DDTHH:MM;空串 = 清掉
    paid_amount: Optional[float] = Field(None, ge=0, le=100000, allow_inf_nan=False)   # 元,最多两位小数
    student_ref: Optional[str] = Field(None, max_length=50)   # 关联学生号(用户名或手机号)
    sales_user_id: Optional[int] = None       # 改归属(只有机构管理员)


class FollowUpCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    status: Optional[str] = None
    next_follow_at: Optional[str] = None


class ProfileUpdate(BaseModel):
    wechat_hint: Optional[str] = Field(None, max_length=200)
    qr_kind: Optional[str] = None


class SalesCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    password: Optional[str] = Field(None, min_length=6, max_length=50)


class SalesUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=50)
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)          # 空串 = 清掉手机号
    is_active: Optional[bool] = None


class SalesDelete(BaseModel):
    transfer_to: Optional[int] = None   # 名下有卡或线索时必填: 转给谁


class ChannelCreate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    sales_user_id: int
    template_id: Optional[str] = Field(None, max_length=8)


class ChannelUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    sales_user_id: Optional[int] = None
    is_active: Optional[bool] = None


class DesignUpdate(BaseModel):
    template_id: Optional[str] = Field(None, max_length=8)
    display_name: Optional[str] = Field(None, max_length=40)   # 空串 = 跟销售姓名走
    display_phone: Optional[str] = Field(None, max_length=30)  # 空串 = 不印电话


class LeadBatchDelete(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=200)


class SettingsUpdate(BaseModel):
    trial_price: Optional[float] = Field(None, allow_inf_nan=False)   # 元,最多两位小数(如 9.9);范围在 save_settings 判
    offer_text: Optional[str] = Field(None, max_length=500)


# ================== 公开: 卡上的二维码 ==================

@router.get("/promo/public/{code}")
async def public_card(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    # 地推现场几十个家长同一个 Wi-Fi / 同一个基站出口,别卡太紧
    await rate_limit.check(("promo-view", audit_log.client_ip(request) or "-"), 200, 60, "打开太频繁了,请稍后再试")
    ch, org, _owner = await svc.resolve_channel(db, code)
    s = await svc.get_settings(db, ch.org_id)
    await svc.bump_view(db, ch.id)
    # **不在这里给二维码**: 先留电话才给(规矩 1),否则线索归不到人
    return {
        "org_name": org.name,
        "org_logo": org.logo_url or "",
        "trial_price": s["trial_price"],
        "offer_text": s["offer_text"],
        "grades": list(svc.GRADES),
    }


@router.post("/promo/public/{code}/leads")
async def public_submit(code: str, body: LeadSubmit, request: Request, db: AsyncSession = Depends(get_db)):
    ip = audit_log.client_ip(request) or "-"
    await rate_limit.check(("promo-submit", ip), 30, 600, "提交太频繁了,请 10 分钟后再试")
    await rate_limit.check(("promo-submit-code", (code or "").upper()[:16]), 60, 600, "这张卡提交太频繁了,请稍后再试")
    return await svc.submit_lead(db, code, body.model_dump())


# ================== 销售: 我的资料与二维码 ==================

@router.get("/promo/me")
async def my_promo(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_promo_staff)):
    p = await svc.get_profile(db, current_user.id)
    chans = (await db.execute(
        select(PromoChannel).where(PromoChannel.org_id == current_user.org_id,
                                   PromoChannel.sales_user_id == current_user.id)
        .order_by(PromoChannel.id)
    )).scalars().all()
    s = await svc.get_settings(db, current_user.org_id)
    designs = await svc.designs_of(db, [c.id for c in chans])
    return {
        "name": svc.display_name(current_user),
        "role": current_user.role,
        "profile": svc.profile_out(p),
        "channels": [{"id": c.id, "code": c.code, "name": c.name, "is_active": bool(c.is_active),
                      "view_count": int(c.view_count or 0), "path": f"/c/{c.code}",
                      "design": svc.design_out(designs.get(c.id), current_user)} for c in chans],
        "settings": s,
    }


@router.put("/promo/me")
async def update_my_promo(body: ProfileUpdate, db: AsyncSession = Depends(get_db),
                          current_user: User = Depends(get_promo_staff)):
    p = await svc.ensure_profile(db, current_user)
    data = body.model_dump(exclude_unset=True)
    if "wechat_hint" in data:
        p.wechat_hint = svc._clip(data["wechat_hint"], 60)
    if "qr_kind" in data:
        if data["qr_kind"] not in ("wechat", "group"):
            raise HTTPException(status_code=400, detail="二维码类型不对")
        p.qr_kind = data["qr_kind"]
    await db.commit()
    return svc.profile_out(p)


@router.post("/promo/me/qr")
async def upload_my_qr(file: UploadFile = File(...), qr_kind: str = Query("wechat"),
                       db: AsyncSession = Depends(get_db), current_user: User = Depends(get_promo_staff)):
    """上传扫码后给家长看的二维码。这是**公开图片**(家长不登录就要看到),落 UPLOAD_DIR;
    文件名按 user_id 定,换图不换路径,所以 URL 必须带 ?v=时间戳(/api/v1/files 是一年长缓存)"""
    if qr_kind not in ("wechat", "group"):
        raise HTTPException(status_code=400, detail="二维码类型不对")
    ext = QR_EXT.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="只支持 png / jpg / webp 图片")
    # 两道大小检查: 声明的 size 由客户端给、可以撒谎,读完按真实字节再判一次
    if file.size and file.size > MAX_QR_SIZE:
        raise HTTPException(status_code=400, detail="图片不能超过 2MB")
    content = await file.read()
    if len(content) > MAX_QR_SIZE:
        raise HTTPException(status_code=400, detail="图片不能超过 2MB")
    if not content:
        raise HTTPException(status_code=400, detail="图片是空文件")
    d = os.path.join(settings.UPLOAD_DIR, QR_DIR_NAME)
    os.makedirs(d, exist_ok=True)
    for old_ext in set(QR_EXT.values()):   # 换格式要把旧扩展名那张删掉
        old = os.path.join(d, f"sales_{current_user.id}.{old_ext}")
        if old_ext != ext and os.path.isfile(old):
            os.remove(old)
    with open(os.path.join(d, f"sales_{current_user.id}.{ext}"), "wb") as f:
        f.write(content)
    p = await svc.ensure_profile(db, current_user)
    p.qr_image_url = f"/api/v1/files/{QR_DIR_NAME}/sales_{current_user.id}.{ext}?v={int(time.time())}"
    p.qr_kind = qr_kind
    p.qr_updated_at = datetime.utcnow()
    await db.commit()
    return svc.profile_out(p)


# ================== 跟单 ==================

@router.get("/promo/leads")
async def list_leads(
    status: Optional[str] = Query(None),
    owner: Optional[int] = Query(None),
    overdue: bool = Query(False),
    search: Optional[str] = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_promo_staff),
):
    data = await svc.list_leads(db, current_user.org_id, _scope(current_user), status=status,
                                owner=owner if current_user.role != "sales" else None,
                                overdue_only=overdue, search=search, page=page, size=size)
    data["is_manager"] = current_user.role != "sales"
    return data


@router.get("/promo/leads/{lead_id}/follow-ups")
async def lead_follow_ups(lead_id: int, db: AsyncSession = Depends(get_db),
                          current_user: User = Depends(get_promo_staff)):
    await svc.load_lead(db, lead_id, current_user.org_id, _scope(current_user))
    return await svc.follow_ups(db, lead_id)


@router.patch("/promo/leads/{lead_id}")
async def update_lead(lead_id: int, body: LeadUpdate, request: Request, db: AsyncSession = Depends(get_db),
                      current_user: User = Depends(get_promo_staff)):
    lead = await svc.load_lead(db, lead_id, current_user.org_id, _scope(current_user))
    actor = acting_user(current_user)
    data = body.model_dump(exclude_unset=True)
    now = datetime.utcnow()
    notes = []
    if "sales_user_id" in data:
        if current_user.role == "sales":
            raise HTTPException(status_code=403, detail="改归属要找机构管理员")
        target = data["sales_user_id"]
        if target is not None:
            await svc.load_owner(db, target, current_user.org_id)
        if target != lead.sales_user_id:
            old_name = svc.display_name((await svc._users_by_id(db, [lead.sales_user_id])).get(lead.sales_user_id)) \
                if lead.sales_user_id else "(未分配)"
            new_name = svc.display_name((await svc._users_by_id(db, [target])).get(target)) if target else "(未分配)"
            lead.sales_user_id = target
            notes.append(f"归属 {old_name} → {new_name}")
            audit_log.record(db, request, current_user, "promo.reassign", f"体验卡线索改归属: {old_name} → {new_name}",
                             target_type="promo_lead", target_id=lead.id)
    if "student_ref" in data:
        ref = (data["student_ref"] or "").strip()
        if ref:
            stu = await svc.link_student(db, lead, ref)
            notes.append(f"关联学生号 {stu.username}")
        else:
            lead.student_id = None
    if "paid_amount" in data:
        v = data["paid_amount"]
        lead.paid_amount = None if v is None else svc.parse_money(v, "实收金额")
    if "note" in data:
        lead.note = (data["note"] or "").strip()[:4000] or None
    if "next_follow_at" in data:
        lead.next_follow_at = svc.parse_local(data["next_follow_at"])
    if "status" in data and data["status"] and data["status"] != lead.status:
        svc.apply_status(lead, data["status"], now)
        notes.append(f"状态改为「{svc.STATUS_LABELS[data['status']]}」")
        svc.add_follow_up(db, lead, actor, ";".join(notes), status_after=data["status"])
    elif notes:
        svc.add_follow_up(db, lead, actor, ";".join(notes))
    await db.commit()
    users = await svc._users_by_id(db, [lead.sales_user_id, lead.student_id])
    chs = {}
    if lead.channel_id:
        ch = await db.get(PromoChannel, lead.channel_id)
        chs = {ch.id: ch} if ch else {}
    sd = await svc.studied_days(db, [lead])
    return svc.lead_out(lead, users, chs, now, sd.get(lead.id))


@router.post("/promo/leads/{lead_id}/follow-ups")
async def add_follow_up(lead_id: int, body: FollowUpCreate, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_promo_staff)):
    lead = await svc.load_lead(db, lead_id, current_user.org_id, _scope(current_user))
    actor = acting_user(current_user)
    now = datetime.utcnow()
    st = body.status if body.status and body.status != lead.status else None
    if st:
        svc.apply_status(lead, st, now)
    if body.next_follow_at is not None:
        lead.next_follow_at = svc.parse_local(body.next_follow_at)
    svc.add_follow_up(db, lead, actor, body.content.strip(), status_after=st)
    await db.commit()
    return await svc.follow_ups(db, lead_id)


def _lead_summary(snaps: list[dict]) -> str:
    """操作记录那一行: 手机号打码(记录列表谁都能翻),完整内容在 detail 快照里"""
    head = "、".join(f"{svc.mask_phone(x['parent_phone'])}({x['sales']})" for x in snaps[:3])
    return head + (f" 等 {len(snaps)} 条" if len(snaps) > 3 else "")


@router.delete("/promo/leads/{lead_id}")
async def delete_lead(lead_id: int, request: Request, db: AsyncSession = Depends(get_db),
                      current_user: User = Depends(get_promo_manager)):
    """删一条线索(只给机构管理员;销售遇到假线索标「无效」,删了会把自己转化差的痕迹一起抹掉)。
    跟进记录一起删,删前快照写进操作记录"""
    snaps = await svc.delete_leads(db, current_user.org_id, [lead_id])
    if not snaps:
        raise HTTPException(status_code=404, detail="线索不存在")
    audit_log.record(db, request, current_user, "promo.lead_delete", f"删除体验卡线索: {_lead_summary(snaps)}",
                     target_type="promo_lead", target_id=lead_id, detail={"leads": snaps})
    await db.commit()
    return {"deleted": len(snaps)}


@router.post("/promo/leads/batch-delete")
async def batch_delete_leads(body: LeadBatchDelete, request: Request, db: AsyncSession = Depends(get_db),
                             current_user: User = Depends(get_promo_manager)):
    """批量删线索(清测试号 / 刷出来的假线索)。只删本机构的,别家机构的 id 忽略"""
    snaps = await svc.delete_leads(db, current_user.org_id, body.ids)
    if not snaps:
        raise HTTPException(status_code=404, detail="选中的线索不存在")
    audit_log.record(db, request, current_user, "promo.lead_delete", f"批量删除体验卡线索 {len(snaps)} 条: {_lead_summary(snaps)}",
                     target_type="promo_lead", detail={"leads": snaps})
    await db.commit()
    return {"deleted": len(snaps)}


# ================== 机构管理员: 销售账号 ==================

def _no_admin(user: User) -> None:
    if not user.org_id:
        raise HTTPException(status_code=400, detail="账号没有所属机构,不能管理体验卡")


@router.get("/promo/sales")
async def list_sales(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=30),
    status: Optional[str] = Query(None, description="active / inactive"),
    all: bool = Query(False, description="下拉框用: 不分页、只要在用的"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_promo_manager),
):
    from sqlalchemy import func, or_
    stmt = select(User).where(User.org_id == current_user.org_id, User.role == "sales")
    if all:
        stmt = stmt.where(User.is_active.is_(True))
    elif status in ("active", "inactive"):
        stmt = stmt.where(User.is_active.is_(status == "active"))
    if search and search.strip():
        kw = search.strip()[:30].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(or_(User.full_name.like(f"%{kw}%", escape="\\"),
                              User.username.like(f"%{kw}%", escape="\\"),
                              User.phone.like(f"%{kw}%", escape="\\")))
    stmt = stmt.execution_options(skip_tenant_filter=True)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    q = stmt.order_by(User.is_active.desc(), User.id.desc())
    if not all:
        q = q.offset((page - 1) * size).limit(size)
    rows = (await db.execute(q)).scalars().all()
    counts = await svc.owned_counts(db, current_user.org_id, [u.id for u in rows])
    items = []
    for u in rows:
        p = await svc.get_profile(db, u.id)
        items.append({"id": u.id, "username": u.username, "full_name": u.full_name or "", "phone": u.phone or "",
                      "is_active": bool(u.is_active), "profile": svc.profile_out(p),
                      "created_at": svc.to_local_str(u.created_at), **counts.get(u.id, {"channels": 0, "leads": 0})})
    return {"items": items, "total": int(total), "page": page, "size": size}


@router.post("/promo/sales")
async def create_sales(body: SalesCreate, request: Request, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_promo_manager)):
    _no_admin(current_user)
    guard_org_admin(current_user, new_role="sales")
    username = body.username.strip()
    if await auth_service.get_user_by_username(db, username):
        raise HTTPException(status_code=409, detail="这个用户名已经有人用了,换一个")
    phone = (body.phone or "").strip() or None
    if phone and await auth_service.get_user_by_phone(db, phone):
        raise HTTPException(status_code=409, detail="这个手机号已经注册过账号")
    pwd = body.password or auth_service.generate_random_password()
    u = User(username=username, email=f"{username}@sales.feiying.local", phone=phone,
             full_name=body.full_name.strip(), hashed_password=auth_service.get_password_hash(pwd),
             role="sales", org_id=current_user.org_id, is_active=True)
    db.add(u)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="用户名或手机号已存在")
    audit_log.record(db, request, current_user, "promo.sales_create", f"新建销售账号: {u.full_name}({username})",
                     target_type="user", target_id=u.id)
    await db.commit()
    return {"id": u.id, "username": u.username, "full_name": u.full_name, "initial_password": pwd}


@router.patch("/promo/sales/{user_id}")
async def update_sales(user_id: int, body: SalesUpdate, request: Request, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_promo_manager)):
    u = await svc.load_sales(db, user_id, current_user.org_id)
    guard_org_admin(current_user, target=u)
    data = body.model_dump(exclude_unset=True)
    changes = []
    if "full_name" in data and data["full_name"]:
        nm = data["full_name"].strip()[:50]
        if nm != u.full_name:
            changes.append(f"姓名 {u.full_name} → {nm}")
            u.full_name = nm
    if "username" in data and data["username"]:
        un = data["username"].strip()
        if un != u.username:
            other = await auth_service.get_user_by_username(db, un)
            if other is not None and other.id != u.id:
                raise HTTPException(status_code=409, detail="这个用户名已经有人用了,换一个")
            changes.append(f"用户名 {u.username} → {un}")
            u.username = un
    if "phone" in data:
        # 空串 = 清掉手机号: 显式分支,别让 if data["phone"] 把清空吞掉(CLAUDE.md)
        ph = (data["phone"] or "").strip() or None
        if ph != u.phone:
            if ph:
                other = await auth_service.get_user_by_phone(db, ph)
                if other is not None and other.id != u.id:
                    raise HTTPException(status_code=409, detail="这个手机号已经注册过账号")
            changes.append(f"手机号 {u.phone or '空'} → {ph or '空'}")
            u.phone = ph
    if "is_active" in data and data["is_active"] is not None and bool(data["is_active"]) != bool(u.is_active):
        u.is_active = bool(data["is_active"])
        changes.append("启用" if u.is_active else "停用")
    if changes:
        audit_log.record(db, request, current_user, "promo.sales_update",
                         f"修改销售账号 {u.full_name}: " + ";".join(changes), target_type="user", target_id=u.id)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="用户名或手机号已存在")
    return {"ok": True}


@router.delete("/promo/sales/{user_id}")
async def delete_sales(user_id: int, request: Request, transfer_to: Optional[int] = Query(None),
                       db: AsyncSession = Depends(get_db), current_user: User = Depends(get_promo_manager)):
    """删销售账号。名下有卡或线索要带 transfer_to(接手人),一起转过去再删;没有就直接删。
    删了就登录不了、账号行也没了 —— 只是暂时不干了的,用「停用」"""
    u = await svc.load_sales(db, user_id, current_user.org_id)
    guard_org_admin(current_user, target=u)
    target = await svc.load_owner(db, transfer_to, current_user.org_id) if transfer_to else None
    name, uname = svc.display_name(u), u.username
    to_name = svc.display_name(target) if target else None
    r = await svc.delete_sales(db, u, target, current_user)
    audit_log.record(db, request, current_user, "promo.sales_delete",
                     f"删除销售账号 {name}({uname})" + (f",卡和线索转给 {to_name}" if to_name else ""),
                     target_type="user", target_id=user_id, detail={**r, "transfer_to": transfer_to})
    await db.commit()
    return r


@router.post("/promo/sales/{user_id}/reset-password")
async def reset_sales_password(user_id: int, request: Request, db: AsyncSession = Depends(get_db),
                               current_user: User = Depends(get_promo_manager)):
    u = await svc.load_sales(db, user_id, current_user.org_id)
    guard_org_admin(current_user, target=u)
    pwd = auth_service.generate_random_password()
    u.hashed_password = auth_service.get_password_hash(pwd)
    audit_log.record(db, request, current_user, "promo.sales_password", f"重置销售密码: {u.full_name}",
                     target_type="user", target_id=u.id)
    await db.commit()
    return {"username": u.username, "password": pwd}


# ================== 机构管理员: 卡码 ==================

def _channel_out(c: PromoChannel, users: dict, designs: dict, lead_counts: dict) -> dict:
    owner = users.get(c.sales_user_id) if c.sales_user_id else None
    return {
        "id": c.id, "code": c.code, "name": c.name, "path": f"/c/{c.code}",
        "sales_user_id": c.sales_user_id,
        "sales_name": svc.display_name(owner) if c.sales_user_id else "(未分配)",
        "is_active": bool(c.is_active), "view_count": int(c.view_count or 0),
        "leads": int(lead_counts.get(c.id, 0)), "created_at": svc.to_local_str(c.created_at),
        "design": svc.design_out(designs.get(c.id), owner),
    }


async def _channels_out(db: AsyncSession, org_id: int, chans: list) -> list[dict]:
    from sqlalchemy import func
    users = await svc._users_by_id(db, [c.sales_user_id for c in chans])
    designs = await svc.designs_of(db, [c.id for c in chans])
    lead_counts = {}
    if chans:
        lead_counts = dict((await db.execute(
            select(PromoLead.channel_id, func.count(PromoLead.id))
            .where(PromoLead.org_id == org_id, PromoLead.channel_id.in_([c.id for c in chans]))
            .group_by(PromoLead.channel_id)
        )).all())
    return [_channel_out(c, users, designs, lead_counts) for c in chans]


async def _load_channel(db: AsyncSession, channel_id: int, user: User) -> PromoChannel:
    stmt = select(PromoChannel).where(PromoChannel.id == channel_id, PromoChannel.org_id == user.org_id)
    if user.role == "sales":
        stmt = stmt.where(PromoChannel.sales_user_id == user.id)   # 销售只能改自己那几版卡的卡面
    ch = (await db.execute(stmt)).scalar_one_or_none()
    if ch is None:
        raise HTTPException(status_code=404, detail="卡码不存在")
    return ch


@router.get("/promo/channels")
async def list_channels(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    owner: Optional[int] = Query(None),
    search: Optional[str] = Query(None, max_length=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_promo_manager),
):
    from sqlalchemy import func, or_
    stmt = select(PromoChannel).where(PromoChannel.org_id == current_user.org_id)
    if owner is not None:
        stmt = stmt.where(PromoChannel.sales_user_id == owner)
    if search and search.strip():
        kw = search.strip()[:30].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(or_(PromoChannel.name.like(f"%{kw}%", escape="\\"),
                              PromoChannel.code.like(f"%{kw.upper()}%", escape="\\")))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    chans = list((await db.execute(
        stmt.order_by(PromoChannel.is_active.desc(), PromoChannel.id.desc()).offset((page - 1) * size).limit(size)
    )).scalars().all())
    return {"items": await _channels_out(db, current_user.org_id, chans), "total": int(total), "page": page, "size": size}


@router.post("/promo/channels")
async def create_channel(body: ChannelCreate, request: Request, db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_promo_manager)):
    _no_admin(current_user)
    owner = await svc.load_owner(db, body.sales_user_id, current_user.org_id)
    ch = await svc.create_channel(db, current_user.org_id, body.name or "", owner, current_user.id)
    if body.template_id:
        await svc.save_design(db, ch, {"template_id": body.template_id})
    audit_log.record(db, request, current_user, "promo.channel_create",
                     f"新建体验卡码 {ch.code}({ch.name})给 {svc.display_name(owner)}",
                     target_type="promo_channel", target_id=ch.id)
    await db.commit()
    return (await _channels_out(db, current_user.org_id, [ch]))[0]


@router.patch("/promo/channels/{channel_id}")
async def update_channel(channel_id: int, body: ChannelUpdate, request: Request, db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_promo_manager)):
    ch = await _load_channel(db, channel_id, current_user)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        ch.name = data["name"].strip()[:60]
    if "sales_user_id" in data and data["sales_user_id"] is not None and data["sales_user_id"] != ch.sales_user_id:
        # 转交: 已经印出去的卡继续能用,**之后**的线索归新销售;已有线索不跟着走(规矩 3)
        owner = await svc.load_owner(db, data["sales_user_id"], current_user.org_id)
        ch.sales_user_id = owner.id
        audit_log.record(db, request, current_user, "promo.channel_transfer",
                         f"体验卡码 {ch.code} 转交给 {svc.display_name(owner)}",
                         target_type="promo_channel", target_id=ch.id)
    if "is_active" in data and data["is_active"] is not None:
        ch.is_active = bool(data["is_active"])
    await db.commit()
    return (await _channels_out(db, current_user.org_id, [ch]))[0]


@router.delete("/promo/channels/{channel_id}")
async def delete_channel(channel_id: int, request: Request, db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_promo_manager)):
    """删卡码: 印出去的卡就作废了(扫了显示已停用)。已经留下的线索留着、归属不变。只是暂时不发用「停用」"""
    ch = await _load_channel(db, channel_id, current_user)
    owner = (await svc._users_by_id(db, [ch.sales_user_id])).get(ch.sales_user_id) if ch.sales_user_id else None
    snap = await svc.delete_channel(db, ch)
    audit_log.record(db, request, current_user, "promo.channel_delete",
                     f"删除体验卡码 {snap['code']}({snap['name']},{svc.display_name(owner) if owner else '未分配'}),"
                     f"保留线索 {snap['leads_kept']} 条", target_type="promo_channel", target_id=channel_id, detail=snap)
    await db.commit()
    return snap


@router.put("/promo/channels/{channel_id}/design")
async def update_channel_design(channel_id: int, body: DesignUpdate, db: AsyncSession = Depends(get_db),
                                current_user: User = Depends(get_promo_staff)):
    """改卡面: 选模板、改卡上印的名字和电话。销售能改自己那几版,管理员能改全机构的"""
    ch = await _load_channel(db, channel_id, current_user)
    await svc.save_design(db, ch, body.model_dump(exclude_unset=True))
    await db.commit()
    return (await _channels_out(db, current_user.org_id, [ch]))[0]


# ================== 机构管理员: 看板 / 设置 ==================

@router.get("/promo/board")
async def promo_board(
    start: Optional[str] = Query(None, description="北京日期 YYYY-MM-DD,含"),
    end: Optional[str] = Query(None, description="北京日期 YYYY-MM-DD,含"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_promo_manager),
):
    since, until = _day_range(start, end)
    return await svc.board(db, current_user.org_id, since, until)


def _day_range(start: Optional[str], end: Optional[str]):
    """北京日期(含两头)→ UTC 起止;看板和汇总同一个口径"""
    from datetime import date as _date
    try:
        since = local_day_utc_range(_date.fromisoformat(start))[0] if start else None
        until = local_day_utc_range(_date.fromisoformat(end))[1] if end else None
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式不对")
    return since, until


# ================== 平台管理员: 各校区汇总(只读) ==================

@router.get("/promo/summary")
async def promo_summary(
    start: Optional[str] = Query(None, description="北京日期 YYYY-MM-DD,含"),
    end: Optional[str] = Query(None, description="北京日期 YYYY-MM-DD,含"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_platform_admin),
):
    """每个机构一行: 销售几个 / 卡几版 / 扫开 / 留电话 → 报正价 / 实收 / 该跟进。没开始做的机构也列出来"""
    since, until = _day_range(start, end)
    return await svc.org_summary(db, since, until)


@router.get("/promo/summary/orgs/{org_id}/board")
async def promo_org_board(
    org_id: int,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_platform_admin),
):
    """汇总页点开一个校区: 按销售看(与那家机构自己看到的看板同一份数),只读"""
    from app.models.organization import Organization
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="机构不存在")
    since, until = _day_range(start, end)
    out = await svc.board(db, org_id, since, until)
    out["org_name"] = org.name
    return out


@router.get("/promo/settings")
async def get_promo_settings(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_promo_manager)):
    return await svc.get_settings(db, current_user.org_id)


@router.put("/promo/settings")
async def put_promo_settings(body: SettingsUpdate, request: Request, db: AsyncSession = Depends(get_db),
                             current_user: User = Depends(get_promo_manager)):
    _no_admin(current_user)
    s = await svc.save_settings(db, current_user.org_id, body.model_dump(exclude_unset=True))
    audit_log.record(db, request, current_user, "promo.settings", f"体验卡设置: 体验价 {s['trial_price']} 元",
                     detail=s)
    await db.commit()
    return s
