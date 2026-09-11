"""机构管理端(org_admin)- 加盟商老板的控制台(多租户 P3)

能力边界: 只管本机构 — 建/停老师账号、看机构概况与配额水位、领机构码、
自定义机构信息(名称/Logo/联系方式;机构码/配额/档位/状态是平台资产,只有平台能改)。
数据隔离由 tenancy 全局过滤器 + org_id 显式条件双保险。
"""
import os
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.api.v1.auth import require_role
from app.models.organization import Organization
from app.models.user import User
from app.services import auth_service
from app.services.org_service import count_active_students, get_org

router = APIRouter()

# 机构管理员(平台admin也可,方便代操作)
get_current_org_admin = require_role("org_admin", "admin")


async def _my_org(db: AsyncSession, current_user: User) -> Organization:
    org = await get_org(db, current_user.org_id)
    if not org:
        raise HTTPException(404, "机构不存在")
    return org


async def _my_teacher(db: AsyncSession, current_user: User, teacher_id: int) -> User:
    """取本机构的一个老师,取不到按 404(不区分"不存在"与"别家的",不泄露)。

    ⚠️ 所有对单个老师的写操作都必须经这一个函数拿对象,不要各自手写
    `where(id==..., org_id==...)` —— 手写副本会漂移,漏掉一处
    `role == "teacher"` 就意味着机构管理员能拿这些端点去改**别的机构管理员甚至
    平台 admin** 的密码(users.py 的 guard_org_admin 就是为同类问题存在的)。

    role 必须锁死 teacher: 机构管理员只管老师,不能通过老师端点操作
    org_admin/admin/student/parent 账号。
    """
    teacher = (await db.execute(
        select(User).where(
            User.id == teacher_id,
            User.role == "teacher",
            User.org_id == current_user.org_id,
        )
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(404, "老师不存在或不属于本机构")
    return teacher


class TeacherCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = Field(None, description="不传则随机生成,仅返回一次")
    full_name: Optional[str] = None
    phone: Optional[str] = None


class TeacherUpdate(BaseModel):
    """改老师资料。用户名是登录凭据不在这里改(要改走停用+新建,避免老师登录不了却没人知道);
    密码走独立端点(重置是敏感动作,要单独留痕并回显一次)。"""
    full_name: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)


class TeacherPasswordReset(BaseModel):
    """机构给老师重置密码(不需要旧密码 —— 老师忘了密码才要重置)。
    不传新密码 = 服务端生成,仅在响应里回显一次。"""
    new_password: Optional[str] = Field(None, min_length=6, max_length=50)


class OrgAdminPasswordChange(BaseModel):
    """机构管理员改**自己**的密码,必须验旧密码(确认本人操作)。"""
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=50)


class TeacherHandover(BaseModel):
    """把一位老师名下的班级与教学关系整体转交给另一位老师。

    这是「删除老师」的前置步骤 —— 删除只允许删零依赖的账号(见 delete_teacher),
    所以要清理离职老师的账号,得先把他名下的东西交给接手人。
    """
    to_teacher_id: int = Field(..., description="接手老师的 id(必须是本机构在职老师)")


@router.get("/info")
async def org_info(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """机构概况: 名称/机构码/配额水位/到期时间(测评链接、注册引导都用机构码)"""
    org = await _my_org(db, current_user)
    active = await count_active_students(db, org.id)
    teacher_count = (await db.execute(
        select(func.count(User.id)).where(
            User.org_id == org.id, User.role == "teacher", User.is_active.is_(True))
    )).scalar() or 0
    # 学习卡额度与学生名额是两笔账,机构首页要同时看得见 —— 只显示学生名额时,
    # 机构会把「发不出卡」误当成「学生满了」(其实要续卡)
    from app.services.org_service import card_quota_status
    cards = await card_quota_status(db, org.id)
    return {
        "id": org.id, "name": org.name, "code": org.code, "plan": org.plan,
        "student_quota": org.student_quota, "active_students": active,
        "teacher_count": teacher_count, "logo_url": org.logo_url,
        "contact_name": org.contact_name, "contact_phone": org.contact_phone,
        "status": org.status, "expires_at": org.expires_at,
        **cards,
    }


class OrgInfoUpdate(BaseModel):
    """机构可自定义项。机构码/配额/档位/状态是平台资产,这里改不了"""
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=50)
    contact_phone: Optional[str] = Field(None, max_length=20)


@router.patch("/info")
async def update_org_info(
    data: OrgInfoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """机构自定义名称/联系方式"""
    org = await _my_org(db, current_user)
    for field in ["name", "contact_name", "contact_phone"]:
        v = getattr(data, field)
        if v is not None and v.strip():  # strip后为空(纯空格)视为未填,防机构名被改成空白
            setattr(org, field, v.strip())
    await db.commit()
    return {"updated": True, "name": org.name}


@router.put("/my-password")
async def change_my_password(
    data: OrgAdminPasswordChange,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """机构管理员改自己的密码(需旧密码)。

    与通用 `PUT /auth/change-password` 的关系: 那个端点对任何已登录用户都可用,
    机构管理员本来就能调 —— 这里**不是**重复实现,而是为了在机构端做两件它没做的事:
    ①拒绝"新密码与旧密码相同"(通用端点允许,改了等于没改却提示成功)
    ②口令与机构端其它响应同构,前端不必为一个动作切两套错误处理。
    校验/哈希仍复用 auth_service,不另写一套。
    """
    if not auth_service.verify_password(data.old_password, current_user.hashed_password):
        # 刻意不区分"旧密码错"与其它失败: 这是登录态下的本人确认,
        # 但仍不给攻击者"密码是否接近"的任何线索
        raise HTTPException(400, "当前密码不正确")
    if data.old_password == data.new_password:
        raise HTTPException(400, "新密码与当前密码相同，等于没改")

    current_user.hashed_password = auth_service.get_password_hash(data.new_password)
    await db.commit()
    # 不 bump session_ver: 正式机构的管理员不在顶号范围内(手机电脑双开是正常用法),
    # 这里 bump 会把他自己当前这个会话也踢下线,改完密码立刻被登出很莫名
    return {"updated": True}


@router.post("/logo")
async def upload_org_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """上传机构Logo(≤2MB, png/jpg/webp),覆盖旧图,URL带版本号防缓存"""
    ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
    ext = ext_map.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "仅支持 png/jpg/webp 图片")
    # 先看声明大小再读,超限的大文件不吃进内存
    if file.size and file.size > 2 * 1024 * 1024:
        raise HTTPException(400, "图片不能超过 2MB")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "图片不能超过 2MB")

    org = await _my_org(db, current_user)
    logo_dir = os.path.join(settings.UPLOAD_DIR, "org-logos")  # 目录由 main.py 启动时创建
    # 换扩展名时清掉旧文件,避免残留
    for old_ext in ext_map.values():
        old = os.path.join(logo_dir, f"org_{org.id}.{old_ext}")
        if old_ext != ext and os.path.exists(old):
            os.remove(old)
    with open(os.path.join(logo_dir, f"org_{org.id}.{ext}"), "wb") as f:
        f.write(content)

    org.logo_url = f"/api/v1/files/org-logos/org_{org.id}.{ext}?v={int(time.time())}"
    await db.commit()
    return {"logo_url": org.logo_url}


def _teacher_out(u: User, class_count: int = 0, student_count: int = 0) -> dict:
    return {
        "id": u.id, "username": u.username, "full_name": u.full_name,
        "phone": u.phone, "is_active": u.is_active, "last_login": u.last_login,
        "created_at": u.created_at,
        # 名下班级/学生数: 停用或删除前要让机构看清影响面
        "class_count": class_count, "student_count": student_count,
    }


@router.get("/teachers")
async def list_teachers(
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """本机构老师列表(可按用户名/姓名/手机号搜)。

    带上每位老师名下的班级数与学生数 —— 停用/删除前机构得先看见影响面。
    两次 GROUP BY 聚合,不按老师 N 次查(十几个老师就是几十条 SQL)。
    """
    from app.models.user import Class, ClassStudent

    stmt = select(User).where(
        User.org_id == current_user.org_id, User.role == "teacher")
    if q and q.strip():
        # LIKE 的 _ 和 % 是通配符必须转义(CLAUDE.md 记过: like('__t_%') 误删过真实账号)
        kw = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{kw}%"
        from sqlalchemy import or_
        stmt = stmt.where(or_(
            User.username.ilike(pattern, escape="\\"),
            User.full_name.ilike(pattern, escape="\\"),
            User.phone.ilike(pattern, escape="\\"),
        ))
    rows = (await db.execute(stmt.order_by(User.id))).scalars().all()

    ids = [u.id for u in rows]
    classes_by_t: dict[int, int] = {}
    students_by_t: dict[int, int] = {}
    if ids:
        for tid, n in (await db.execute(
            select(Class.teacher_id, func.count(Class.id))
            .where(Class.teacher_id.in_(ids)).group_by(Class.teacher_id)
        )).all():
            classes_by_t[tid] = n
        # 学生按**去重**计: 一个学生进了同一老师的两个班不该算两个人
        for tid, n in (await db.execute(
            select(Class.teacher_id, func.count(func.distinct(ClassStudent.student_id)))
            .join(ClassStudent, ClassStudent.class_id == Class.id)
            .where(Class.teacher_id.in_(ids), ClassStudent.is_active.is_(True))
            .group_by(Class.teacher_id)
        )).all():
            students_by_t[tid] = n

    return [_teacher_out(u, classes_by_t.get(u.id, 0), students_by_t.get(u.id, 0))
            for u in rows]


@router.post("/teachers")
async def create_teacher(
    data: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """建老师账号(归本机构),初始密码仅返回这一次"""
    username = data.username.strip()
    if not username:
        raise HTTPException(400, "用户名不能为空")
    # 用户名全站唯一(登录凭据),所以这里**必须跨机构查重**。
    # get_user_by_username 走 tenancy 过滤会只看本机构 → 撞上别家的用户名时
    # 这里放行、create_user 再撞库唯一约束抛 500。显式跳过过滤,按"已存在"拒。
    taken = (await db.execute(
        select(User.id).where(User.username == username)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if taken:
        raise HTTPException(400, "用户名已存在")

    pwd = data.password or auth_service.generate_random_password()
    if len(pwd) < 6:
        raise HTTPException(400, "密码长度至少 6 位")
    org_id = current_user.org_id
    user = await auth_service.create_user(
        db=db,
        username=data.username,
        email=f"{data.username}@org{org_id}.local",
        password=pwd,
        full_name=data.full_name or data.username,
        role="teacher",
        phone=data.phone,
        org_id=org_id,
    )
    return {"id": user.id, "username": user.username, "initial_password": pwd}


@router.patch("/teachers/{teacher_id}")
async def update_teacher(
    teacher_id: int,
    data: TeacherUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """改老师姓名/手机号(只能改本机构的)。

    「留空=不修改」的判空必须走**显式分支**: `if v` 会让空串走不进来,
    于是"把手机号清空"这个正当操作永远做不到(CLAUDE.md 记过 AI 配置
    api_key 被空串清空的反向事故 —— 两种写法各有陷阱,所以要显式区分
    None=未传、""=要清空)。
    """
    teacher = await _my_teacher(db, current_user, teacher_id)

    if data.full_name is not None:
        name = data.full_name.strip()
        # 姓名是列表里的主要标识,允许改但不允许改成空白(会显示成一行"—"分不清是谁)
        if not name:
            raise HTTPException(400, "姓名不能为空")
        teacher.full_name = name
    if data.phone is not None:
        # 空串 = 明确要清空(老师换号了先删掉),不是"没传"
        teacher.phone = data.phone.strip() or None

    await db.commit()
    return _teacher_out(teacher)


@router.post("/teachers/{teacher_id}/reset-password")
async def reset_teacher_password(
    teacher_id: int,
    data: TeacherPasswordReset,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """给老师重置密码,新密码仅返回这一次。

    不需要旧密码 —— 场景就是老师忘了密码。这也是为什么 `_my_teacher` 把
    role 锁死在 teacher: 否则机构管理员能拿这个端点重置**别的机构管理员
    甚至平台 admin** 的密码,那是提权。
    """
    teacher = await _my_teacher(db, current_user, teacher_id)
    pwd = data.new_password or auth_service.generate_random_password()
    if len(pwd) < 6:
        raise HTTPException(400, "密码长度至少 6 位")

    teacher.hashed_password = auth_service.get_password_hash(pwd)
    # 密码被重置 = 原密码可能已泄露,把该老师**已发出的会话全部作废**:
    # session_ver 变了,他旧手机/别人电脑上那份 token 下次请求即 401。
    # (体验机构老师本来就在顶号范围,正式机构老师平时不顶号 —— 但"重置密码"
    #  这个动作本身就该踢掉旧会话,否则拿到过旧 token 的人还能继续用 7 天)
    teacher.session_ver = (teacher.session_ver or 0) + 1
    await db.commit()
    # 只在服务端生成时回显: 管理员自己设的密码他已经知道,回显等于多一处泄露面
    return {"id": teacher.id, "username": teacher.username,
            "new_password": pwd if not data.new_password else None}


@router.patch("/teachers/{teacher_id}/toggle-active")
async def toggle_teacher_active(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """停用/恢复老师账号(只能操作本机构的)"""
    teacher = (await db.execute(
        select(User).where(
            User.id == teacher_id, User.role == "teacher",
            User.org_id == current_user.org_id)
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(404, "老师不存在或不属于本机构")
    teacher.is_active = not teacher.is_active
    if not teacher.is_active:
        # 停用要立刻断掉他已发出的会话,否则手里的 token 还能用满 7 天 ——
        # 「停用」在机构管理员眼里就是"这个人现在进不来了"。
        # (get_current_user 每请求查 is_active,本已拦住;bump 是双保险,
        #  也让 WebSocket 这类长连接下次校验即失效)
        teacher.session_ver = (teacher.session_ver or 0) + 1
    await db.commit()
    return {"id": teacher.id, "is_active": teacher.is_active}


async def _teacher_dependents(db: AsyncSession, teacher_id: int) -> dict:
    """这个老师名下还挂着什么 —— 删除前的影响面清单。

    ⚠️ 为什么必须显式查而不能依赖数据库级 CASCADE:
    生产 SQLite 的 `PRAGMA foreign_keys` 是 **0(关闭)**,已实测确认。
    模型上那些 `ondelete="CASCADE"` 因此**根本不生效** —— 直接删老师不会级联,
    而是留下一堆**悬挂行**: 班级还在、学生还在班里,但没有任何老师能看见它们;
    book_assignments 也还在(学生仍能学),可 teacher_id 指向一个不存在的用户。
    真要打开 FK 反而更糟: 那会**级联删掉 book_assignments**,
    即学生已付费的书本授权凭空消失。
    两种结局都不能默认发生,所以有依赖时一律拒绝删除、引导去停用。
    """
    from app.models.user import Class, ClassStudent
    from app.models.learning import BookAssignment, HomeworkAssignment

    classes = (await db.execute(
        select(func.count(Class.id)).where(Class.teacher_id == teacher_id)
    )).scalar() or 0
    students = (await db.execute(
        select(func.count(func.distinct(ClassStudent.student_id)))
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher_id, ClassStudent.is_active.is_(True))
    )).scalar() or 0
    assignments = (await db.execute(
        select(func.count(BookAssignment.id))
        .where(BookAssignment.teacher_id == teacher_id)
    )).scalar() or 0
    homework = (await db.execute(
        select(func.count(HomeworkAssignment.id))
        .where(HomeworkAssignment.teacher_id == teacher_id)
    )).scalar() or 0
    return {"classes": classes, "students": students,
            "book_assignments": assignments, "homework": homework}


@router.get("/teachers/{teacher_id}/dependents")
async def teacher_dependents(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """删除前预检: 这个老师名下有多少班级/学生/授权/作业。

    与 DELETE 共用同一份 `_teacher_dependents`,不会出现"预检说能删、删的时候被拒"。
    """
    teacher = await _my_teacher(db, current_user, teacher_id)
    dep = await _teacher_dependents(db, teacher.id)
    return {
        "id": teacher.id, "username": teacher.username,
        "full_name": teacher.full_name,
        "dependents": dep,
        "deletable": not any(dep.values()),
    }


@router.post("/teachers/{teacher_id}/handover")
async def handover_teacher(
    teacher_id: int,
    data: TeacherHandover,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """把老师名下的班级与教学关系转交给另一位老师(离职交接)。

    ## 为什么需要它
    删除只允许删零依赖的账号,所以离职老师的账号原本卡在「只能停用」。
    这个端点是那条路的出口: 先交接、再删除(或停用)。

    ## 转交什么
    - `classes.teacher_id`: 班级归属(学生跟着班走,**不动 class_students**,
      所以学生的学习记录、掌握度一行都不会变)
    - `book_assignments.teacher_id`: 谁开的书。**冲突的行不改而是删掉**,
      见下面「唯一索引」
    - `homework_assignments.teacher_id`: 作业归属(学生的完成记录挂在
      homework_student_assignments 上,不受影响)
    - `class_invite_codes.teacher_id`: 入班码
    **不转交**: live_sessions(直播是一次性的历史记录,改归属会让回放对不上人)、
    reading_assignments(阅读作业同理挂在具体一次布置上)。

    ## 唯一索引: 冲突行必须删而不是改
    `book_assignments` 上有三个**部分唯一索引**(uq_assign_book/unit/group,
    生产已实测存在),键里**不含 teacher_id** —— 键是 (book,student[,unit,group])。
    所以当两位老师给同一个学生开过同一本书时,把 A 的行改成 B 会直接撞
    UNIQUE 约束抛 IntegrityError,整个交接 500 回滚。
    处理: 接手人已有等价授权的,**删掉离职老师那一行**(权益不变,学生照样能学,
    因为判活看的是"有没有一行有效授权"而不是"哪个老师开的")。

    ## 幂等与原子性
    整个交接在一个事务里,任一步失败全部回滚,不会留下一半交接的状态。
    重复调用是安全的(第二次没有属于原老师的行可转,返回全 0)。
    """
    from app.models.user import Class, ClassInviteCode
    from app.models.learning import BookAssignment, HomeworkAssignment
    from sqlalchemy import update as sa_update

    src = await _my_teacher(db, current_user, teacher_id)
    if data.to_teacher_id == teacher_id:
        raise HTTPException(400, "不能转交给自己")
    # 接手人也必须是本机构老师 —— 否则能把班级塞给别家机构的人(跨租户污染)
    dst = await _my_teacher(db, current_user, data.to_teacher_id)
    if not dst.is_active:
        # 交给一个停用的账号 = 这些班级立刻没人管得了,等于换个地方悬挂
        raise HTTPException(400, f"接手老师「{dst.full_name or dst.username}」已停用，请先恢复他的账号")

    moved = {"classes": 0, "book_assignments": 0, "homework": 0,
             "invite_codes": 0, "dropped_duplicate_assignments": 0}

    # ① 班级(学生跟着班走,不动 class_students)
    moved["classes"] = (await db.execute(
        sa_update(Class).where(Class.teacher_id == src.id)
        .values(teacher_id=dst.id)
    )).rowcount or 0

    # ② 书本授权: 先挑出会撞唯一索引的行删掉,再整体改剩下的。
    # 判重键与三个部分唯一索引一致: (scope_type, book_id, student_id, unit_id, group_index)
    src_rows = (await db.execute(
        select(BookAssignment).where(BookAssignment.teacher_id == src.id)
    )).scalars().all()
    if src_rows:
        dst_keys = {
            (a.scope_type or "book", a.book_id, a.student_id, a.unit_id, a.group_index)
            for a in (await db.execute(
                select(BookAssignment).where(BookAssignment.teacher_id == dst.id)
            )).scalars().all()
        }
        for a in src_rows:
            key = (a.scope_type or "book", a.book_id, a.student_id, a.unit_id, a.group_index)
            if key in dst_keys:
                # 接手人已有等价授权 → 删掉旧的那行(学生权益不变)
                await db.delete(a)
                moved["dropped_duplicate_assignments"] += 1
            else:
                a.teacher_id = dst.id
                dst_keys.add(key)   # 同一批里可能有两行同键(理论上被索引挡住,防御性加上)
                moved["book_assignments"] += 1

    # ③ 作业(学生完成记录挂在 homework_student_assignments,不受影响)
    moved["homework"] = (await db.execute(
        sa_update(HomeworkAssignment).where(HomeworkAssignment.teacher_id == src.id)
        .values(teacher_id=dst.id)
    )).rowcount or 0

    # ④ 入班码
    moved["invite_codes"] = (await db.execute(
        sa_update(ClassInviteCode).where(ClassInviteCode.teacher_id == src.id)
        .values(teacher_id=dst.id)
    )).rowcount or 0

    await db.commit()
    return {
        "from": {"id": src.id, "name": src.full_name or src.username},
        "to": {"id": dst.id, "name": dst.full_name or dst.username},
        "moved": moved,
    }


@router.delete("/teachers/{teacher_id}")
async def delete_teacher(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """删除老师账号(彻底删行,不可恢复)。

    **只允许删干净的账号** —— 名下有班级/学生/书本授权/作业一律拒(409),
    让机构改用「停用」。理由见 `_teacher_dependents`: 生产 FK 是关闭的,
    删了只会留下没人能看见的悬挂班级;而打开 FK 会连学生已付费的书本授权
    一起级联删掉。两者都是静默的数据损坏,不该由点一下"删除"来触发。

    典型用途: 建错了名字、体验账号清理 —— 这些恰好都是零依赖的。
    真要清理老账号,先把班级转交给别的老师(教师端已有转班能力),再回来删。
    """
    teacher = await _my_teacher(db, current_user, teacher_id)

    # 不能删自己: org_admin 走不到这里(_my_teacher 锁了 role=teacher),
    # 但平台 admin 代操作时 role 可能是 admin —— 显式挡住更保险
    if teacher.id == current_user.id:
        raise HTTPException(400, "不能删除自己的账号")

    dep = await _teacher_dependents(db, teacher.id)
    if any(dep.values()):
        raise HTTPException(409, {
            "code": "TEACHER_HAS_DEPENDENTS",
            "message": (
                f"「{teacher.full_name or teacher.username}」名下还有 "
                f"{dep['classes']} 个班级、{dep['students']} 名学生、"
                f"{dep['book_assignments']} 条书本授权、{dep['homework']} 份作业，"
                "不能删除。两条出路：①「停用」——他立刻登录不了，"
                "班级、学生和已开通的书本都不受影响（多数情况用这个）；"
                "②先「转交」给另一位老师，交接完再删。"
            ),
            "dependents": dep,
        })

    await db.delete(teacher)
    await db.commit()
    return {"deleted": True, "id": teacher_id}
