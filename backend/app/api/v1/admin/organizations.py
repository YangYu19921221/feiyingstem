"""平台管理端 - 机构(租户)管理(多租户 P3)

平台 admin 开机构 → 发机构管理员账号 → 机构管理员自己建老师 → 老师建学生。
"""
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, distinct, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.tenancy import invalidate_org_cache
from app.core.timeutil import local_today
from app.api.v1.auth import get_current_admin
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook
from app.services import auth_service, geo_service
from app.services.org_service import count_active_students

router = APIRouter()


# ---------- Schemas ----------

class OrgCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    code: Optional[str] = Field(None, max_length=16, description="机构码,不传自动生成")
    plan: str = Field("standard", description="trial/standard/county/city")
    student_quota: int = Field(100, ge=1)
    # 学习卡额度(协议第三条: 基础合作费含 100 张半年卡)。不传 = 跟随 student_quota
    card_quota: Optional[int] = Field(
        None, ge=0, description="已购学习卡张数(不传=跟随学生名额)")
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    expires_at: Optional[datetime] = None
    # 区域保护(协议第四条): 登记经营场所,开通时按直线距离查冲突
    address: Optional[str] = Field(None, max_length=255, description="经营场所详细地址")
    # 范围校验不写在 Field 上: lat=120(填反了的典型值)会被 Pydantic 拦成 422,
    # 盖掉"你把经纬度填反了"这句更有用的提示。统一交给 geo_service.coord_error
    lat: Optional[float] = Field(None, description="纬度(GCJ02,从高德复制)")
    lng: Optional[float] = Field(None, description="经度")
    protect_radius_km: Optional[float] = Field(
        None, gt=0, le=500, description="独家半径(公里),不传=默认 3")
    force: bool = Field(False, description="已核对区域冲突,仍要开通(违约由管理员承担)")


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    student_quota: Optional[int] = Field(None, ge=1)
    # 学习卡额度: 直接设成某个总数
    card_quota: Optional[int] = Field(None, ge=0, description="学习卡总额度(设为绝对值)")
    # 续卡: 在现有额度上**增加** N 张。与 card_quota 的区别是并发安全 ——
    # 「读出 100、写回 150」中间若有另一笔续卡就会被覆盖掉,增量走 SQL 原子加。
    # 协议第三条: 续卡 50 张起,但这里不硬拦(平台可能补发/赠送零头)
    add_cards: Optional[int] = Field(None, ge=1, le=100000, description="续卡: 增加 N 张")
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    status: Optional[str] = Field(None, description="active/suspended/expired")
    expires_at: Optional[datetime] = None
    # 内容授权模式: assigned=逐本分配 | all_books=全托(时间+人数付费,书本全开放)
    access_mode: Optional[str] = Field(None, pattern="^(assigned|all_books)$")
    # 金币发放: auto=系统自动按规则发(默认) | manual=只能老师核实后手动加
    coin_mode: Optional[str] = Field(None, pattern="^(auto|manual)$")
    # 显式清空有效期(改回永不过期): expires_at 的 None 语义是"未传不动",
    # 无法表达"传了要清",用独立布尔区分
    clear_expires: Optional[bool] = None
    # 区域保护: 改地址/坐标同样要查冲突(搬迁到别家 3 公里内和新开一家一样违约)
    address: Optional[str] = Field(None, max_length=255)
    lat: Optional[float] = None  # 范围校验同 OrgCreate,走 geo_service.coord_error
    lng: Optional[float] = None
    protect_radius_km: Optional[float] = Field(None, gt=0, le=500)
    force: bool = Field(False, description="已核对区域冲突,仍要保存")


class OrgAdminCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = Field(None, description="不传则随机生成,仅返回一次")
    full_name: Optional[str] = None
    phone: Optional[str] = None


class TrialProvision(BaseModel):
    """一键开体验账号:建机构 + 三端账号 + 默认班 + 授权全部平台词书"""
    name: Optional[str] = Field(None, max_length=100, description="机构名,不传自动生成")
    days: int = Field(14, ge=1, le=365, description="体验天数(到期当天仍可用,次日停服)")
    student_quota: int = Field(20, ge=1, le=500)
    prefix: Optional[str] = Field(
        None, min_length=2, max_length=20, pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$",
        description="账号前缀(如 hangzhou → hangzhou_admin/_teacher/_student),不传自动生成",
    )
    password: Optional[str] = Field(None, min_length=6, max_length=50,
                                   description="三个账号共用一个密码,不传自动生成")
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    assign_all_books: bool = Field(True, description="给体验学生授权全部平台词书")


def _gen_org_code() -> str:
    return "ORG" + "".join(secrets.choice(string.digits) for _ in range(5))


async def _guard_territory(
    db: AsyncSession,
    lat: Optional[float],
    lng: Optional[float],
    radius_km: Optional[float],
    force: bool,
    exclude_org_id: Optional[int] = None,
) -> list[dict]:
    """区域保护闸门(协议第四条)。返回冲突清单(force 放行时用于记日志)。

    没给坐标 → 直接放过:坐标是选填的,不能因为新增了这个功能就让不填坐标的老流程失败。
    给了坐标 → 校验合法性 → 查冲突 → 有冲突且未 force 时抛 409 带明细,
    前端弹确认框列明细,勾选「我已核对」后带 force=true 重试。

    坐标只给一半是**必拦**的错误: 只填纬度会静默存成半条数据,
    既判不出冲突、又让这家机构看着"已登记"却不受保护 —— 比不填更危险。
    """
    if lat is None and lng is None:
        return []
    if lat is None or lng is None:
        raise HTTPException(400, "经纬度必须同时填写(只填一个无法判定区域冲突)")
    bad = geo_service.coord_error(lat, lng)
    if bad:
        raise HTTPException(400, bad)

    radius = radius_km or geo_service.DEFAULT_PROTECT_RADIUS_KM
    others = (await db.execute(select(Organization))).scalars().all()
    conflicts = geo_service.find_territory_conflicts(
        lat, lng, radius, others, exclude_org_id=exclude_org_id
    )
    if conflicts and not force:
        raise HTTPException(409, geo_service.conflict_payload(conflicts, radius))
    return conflicts


def _org_out(
    org: Organization,
    active_students: int = 0,
    teacher_count: int = 0,
    cards_used: int = 0,
) -> dict:
    from app.services.org_service import card_quota_of
    return {
        "id": org.id, "name": org.name, "code": org.code, "plan": org.plan,
        "student_quota": org.student_quota, "active_students": active_students,
        # 学习卡额度: card_quota 为 NULL 时按 student_quota 生效(存量零影响),
        # 但仍把原始值一起下发,让平台端能区分「显式设过」和「跟随学生名额」
        "card_quota": card_quota_of(org),
        "card_quota_explicit": getattr(org, "card_quota", None) is not None,
        "cards_used": cards_used,
        "cards_left": max(0, card_quota_of(org) - cards_used),
        "teacher_count": teacher_count, "logo_url": getattr(org, "logo_url", None),
        "contact_name": org.contact_name, "contact_phone": org.contact_phone,
        "status": org.status, "expires_at": org.expires_at, "created_at": org.created_at,
        "access_mode": getattr(org, "access_mode", None) or "assigned",
        "coin_mode": getattr(org, "coin_mode", None) or "auto",
        # 区域保护(协议第四条);坐标为 NULL = 未登记,前端提示"未登记不受保护"
        "address": getattr(org, "address", None),
        "lat": getattr(org, "lat", None),
        "lng": getattr(org, "lng", None),
        "protect_radius_km": getattr(org, "protect_radius_km", None),
    }


# ---------- 机构 CRUD ----------

@router.get("/organizations")
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """机构列表 + 每机构配额水位/老师数"""
    orgs = (await db.execute(
        select(Organization).order_by(Organization.id)
    )).scalars().all()

    # 每机构老师数/活跃学生数,各一次 GROUP BY 聚合(admin 上下文本就不过滤,无需逃生口)
    teacher_rows = (await db.execute(
        select(User.org_id, func.count(User.id))
        .where(User.role.in_(["teacher", "org_admin"]), User.is_active.is_(True))
        .group_by(User.org_id)
    )).all()
    teachers_by_org = {r[0]: r[1] for r in teacher_rows}

    student_rows = (await db.execute(
        select(Class.org_id, func.count(distinct(ClassStudent.student_id)))
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .where(ClassStudent.is_active.is_(True))
        .group_by(Class.org_id)
    )).all()
    students_by_org = {r[0]: r[1] for r in student_rows}

    # 每机构已发卡张数: 一次 GROUP BY 聚合,别按机构 N 次查(几十家就是几十条 SQL)。
    # 口径与 org_service.count_issued_cards 一致(禁用的不算),两处必须同步改
    from app.models.user import RedemptionCode, RedemptionCodeStatus
    card_rows = (await db.execute(
        select(User.org_id, func.count(RedemptionCode.id))
        .join(RedemptionCode, RedemptionCode.created_by == User.id)
        .where(RedemptionCode.status != RedemptionCodeStatus.DISABLED)
        .group_by(User.org_id)
    )).all()
    cards_by_org = {r[0]: r[1] for r in card_rows}

    return [
        _org_out(org, students_by_org.get(org.id, 0), teachers_by_org.get(org.id, 0),
                 cards_by_org.get(org.id, 0))
        for org in orgs
    ]


@router.post("/organizations")
async def create_organization(
    data: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """开通新机构(加盟商签约后由平台开户)"""
    code = (data.code or _gen_org_code()).strip().upper()
    exists = (await db.execute(
        select(Organization).where(Organization.code == code)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, "机构码已存在，换一个")

    # 区域保护闸门: 登记了坐标就查 3 公里内有没有已签约的合作点(体验机构不算)。
    # 放在建行之前 —— 抛 409 时库里不能留下半家机构
    conflicts = await _guard_territory(
        db, data.lat, data.lng, data.protect_radius_km, data.force
    )

    org = Organization(
        name=data.name, code=code, plan=data.plan,
        student_quota=data.student_quota,
        card_quota=data.card_quota,
        contact_name=data.contact_name, contact_phone=data.contact_phone,
        expires_at=data.expires_at, status="active",
        address=data.address, lat=data.lat, lng=data.lng,
        protect_radius_km=data.protect_radius_km,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    out = _org_out(org)
    # force 放行的记在响应里,前端 toast 提示「已跳过区域冲突」留个印象
    if conflicts:
        out["territory_overridden"] = conflicts
    return out


@router.patch("/organizations/{org_id}")
async def update_organization(
    org_id: int,
    data: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """改配额/续费(改expires_at)/停用恢复(改status)"""
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")
    if org_id == 1 and data.status and data.status != "active":
        raise HTTPException(400, "直营机构不可停用")

    # 区域保护: 改坐标 = 搬迁,搬到别家保护圈里和新开一家一样违约,同样要过闸。
    # PATCH 语义是"未传不动",所以取「传了用新的、没传用库里的」的有效坐标一起判
    # (只改半径不改坐标时,新半径也可能把原本合规的位置变成冲突)
    touches_territory = any(
        v is not None for v in (data.lat, data.lng, data.protect_radius_km)
    )
    conflicts: list[dict] = []
    if touches_territory:
        eff_lat = data.lat if data.lat is not None else org.lat
        eff_lng = data.lng if data.lng is not None else org.lng
        eff_radius = (
            data.protect_radius_km
            if data.protect_radius_km is not None
            else org.protect_radius_km
        )
        conflicts = await _guard_territory(
            db, eff_lat, eff_lng, eff_radius, data.force, exclude_org_id=org_id
        )

    for field in ["name", "plan", "student_quota", "card_quota", "contact_name",
                  "contact_phone", "status", "expires_at", "access_mode", "coin_mode",
                  "address", "lat", "lng", "protect_radius_km"]:
        v = getattr(data, field)
        if v is not None:
            setattr(org, field, v)
    if data.clear_expires:
        org.expires_at = None  # 改回永不过期
    if data.add_cards:
        # 续卡走原子加,别读出来再写回去(两笔续卡并发时后写的会吞掉前一笔)。
        # card_quota 仍为 NULL 的存量机构: 先落成"当前生效值"(= student_quota)再加,
        # 否则 NULL + 50 = NULL,这笔续卡静默丢失
        from app.services.org_service import card_quota_of
        base = card_quota_of(org)
        await db.execute(
            update(Organization)
            .where(Organization.id == org_id)
            .values(card_quota=(
                Organization.card_quota + data.add_cards
                if org.card_quota is not None else base + data.add_cards
            ))
        )
    await db.commit()
    if data.add_cards:
        await db.refresh(org)
    invalidate_org_cache(org_id)  # 停用/恢复/续费立即生效
    active = await count_active_students(db, org_id)
    # 已发卡数要真查:默认 0 会让续卡后的响应显示成"额度全新未用",
    # 前端拿它回填列表就成了错数
    from app.services.org_service import count_issued_cards
    out = _org_out(org, active, cards_used=await count_issued_cards(db, org_id))
    if conflicts:
        out["territory_overridden"] = conflicts
    return out


# ---------- 区域保护预检(协议第四条) ----------

@router.get("/organizations/territory-check")
async def check_territory(
    lat: float,
    lng: float,
    radius_km: Optional[float] = None,
    exclude_org_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """填完坐标先看一眼周边:有没有冲突、最近几家分别多远。

    只读不写,谈单时就能查(客户报个地址,当场答"这个位置能不能签")。
    与写端点共用 geo_service 一份判定,不会出现"预检说行、开通被拦"。
    """
    bad = geo_service.coord_error(lat, lng)
    if bad:
        raise HTTPException(400, bad)

    radius = radius_km or geo_service.DEFAULT_PROTECT_RADIUS_KM
    orgs = (await db.execute(select(Organization))).scalars().all()
    conflicts = geo_service.find_territory_conflicts(
        lat, lng, radius, orgs, exclude_org_id=exclude_org_id
    )

    # 顺带给出最近 5 家(含不冲突的),让管理员对"这一带有多密"有直觉
    nearby = []
    for org in orgs:
        if org.id == exclude_org_id or org.lat is None or org.lng is None:
            continue
        nearby.append({
            "org_id": org.id, "org_name": org.name, "org_code": org.code,
            "plan": org.plan, "status": org.status,
            "distance_km": round(geo_service.haversine_km(lat, lng, org.lat, org.lng), 2),
        })
    nearby.sort(key=lambda x: x["distance_km"])

    # 没登记坐标的机构判不了,数量要报出来 —— 否则"零冲突"会被误读成"这一带没人",
    # 而实际可能是隔壁那家根本没录坐标
    unmapped = sum(
        1 for o in orgs
        if o.lat is None and (o.plan or "") != "trial" and o.id != exclude_org_id
    )
    return {
        "ok": not conflicts,
        "radius_km": radius,
        "conflicts": conflicts,
        "nearby": nearby[:5],
        "unmapped_orgs": unmapped,
    }


# ---------- 删除机构(硬删,连带其全部账号与数据) ----------

# 机构"拥有"的顶层表(org_id 列直查);users/classes 等的子孙数据靠 FK 扫描逐层清
_ORG_OWNED_TABLES = [
    "users", "classes", "pk_rooms", "assessment_leads", "leaderboard_snapshots",
    "word_books", "sentence_books", "reading_passages", "competition_question_sets",
    "phonetic_videos", "book_series", "student_coins", "coin_transactions",
    "coin_rewards", "coin_redeem_requests",
]


@router.delete("/organizations/{org_id}")
async def delete_organization(
    org_id: int,
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """硬删机构:机构本体 + 名下全部账号/班级/内容/学习数据,不可恢复。

    防呆三道闸:
    1. 直营(id=1)永远不可删
    2. 必须传机构码 code 且与库中一致(前端要求管理员手输,防止点错行)
    3. 正式机构(plan!=trial)必须先停用才能删;体验机构可直接删
       (删机构的主场景就是清理过期体验/测试机构)

    实现: 不逐表硬编码删除顺序——用 sqlite_master + PRAGMA foreign_key_list
    通用扫描"谁引用了机构拥有的行",多轮删除直到收敛(处理孙子表链),
    最后删顶层行和机构本体。漏网行会被 FK 约束拦下整体回滚,宁可失败不留脏。
    """
    from sqlalchemy import text

    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")
    if org_id == 1:
        raise HTTPException(400, "直营机构不可删除")
    if code.strip().upper() != org.code:
        raise HTTPException(400, "机构码不匹配,已阻止删除")
    if org.plan != "trial" and org.status == "active":
        raise HTTPException(400, "正式机构请先停用再删除(体验机构可直接删)")

    # 统计口径给前端确认过的数字一个对账
    user_count = (await db.execute(
        select(func.count(User.id)).where(User.org_id == org_id)
    )).scalar() or 0

    # 顶层受害行: {表名: 主键集合}
    victims: dict[str, set[int]] = {}
    for t in _ORG_OWNED_TABLES:
        try:
            ids = (await db.execute(
                text(f"SELECT id FROM {t} WHERE org_id = :o"), {"o": org_id}
            )).scalars().all()
        except Exception:
            continue  # 环境缺表(旧库)跳过
        if ids:
            victims[t] = set(ids)

    all_tables = (await db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    )).scalars().all()

    # FK 引用图: 表 -> [(引用列, 被引表)](只关心指向受害表的边)
    fk_edges: dict[str, list[tuple[str, str]]] = {}
    for t in all_tables:
        rows = (await db.execute(text(f"PRAGMA foreign_key_list({t})"))).all()
        edges = [(r[3], r[2]) for r in rows if r[2] in _ORG_OWNED_TABLES]  # (from_col, ref_table)
        if edges:
            fk_edges[t] = edges

    deleted_rows = 0
    # 多轮清扫: 每轮删掉所有"引用受害行"的行;有孙子链时前几轮部分失败,收敛为止
    for _ in range(6):
        progressed = False
        for t, edges in fk_edges.items():
            for col, ref in edges:
                ids = victims.get(ref)
                if not ids:
                    continue
                id_list = ",".join(str(i) for i in ids)
                try:
                    res = await db.execute(
                        text(f"DELETE FROM {t} WHERE {col} IN ({id_list})")
                    )
                    if res.rowcount:
                        deleted_rows += res.rowcount
                        progressed = True
                except Exception:
                    pass  # 本轮被更深层引用挡住,下一轮再试
        if not progressed:
            break

    # 顶层行本身(同样多轮:classes 引用 users 等交叉链)
    for _ in range(6):
        progressed = False
        for t in list(victims.keys()):
            if not victims.get(t):
                continue
            try:
                res = await db.execute(text(f"DELETE FROM {t} WHERE org_id = :o"), {"o": org_id})
                deleted_rows += res.rowcount or 0
                victims.pop(t, None)
                progressed = True
            except Exception:
                pass
        if not victims:
            break
        if not progressed:
            await db.rollback()
            raise HTTPException(409, f"仍有数据引用未清干净({'、'.join(victims)}),已整体回滚")

    await db.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org_id})
    await db.commit()
    invalidate_org_cache(org_id)
    return {"deleted": True, "org_name": org.name, "users_removed": user_count,
            "rows_removed": deleted_rows}


# ---------- 机构管理员账号 ----------
# 路径用 /managers 而非 /admins: 实测 Safari 内容拦截器会按 URL 关键词
# 掐掉 */admins 结尾的 XHR(请求根本不出浏览器,报 Network Error)

@router.get("/organizations/{org_id}/managers")
async def list_org_admins(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(User).where(User.org_id == org_id, User.role == "org_admin")
    )).scalars().all()
    return [{"id": u.id, "username": u.username, "full_name": u.full_name,
             "phone": u.phone, "is_active": u.is_active, "last_login": u.last_login}
            for u in rows]


@router.post("/organizations/{org_id}/managers")
async def create_org_admin(
    org_id: int,
    data: OrgAdminCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """给机构开管理员账号(加盟商老板用),初始密码仅返回这一次"""
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")

    existing = await auth_service.get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(400, "用户名已存在")

    pwd = data.password or auth_service.generate_random_password()
    user = await auth_service.create_user(
        db=db,
        username=data.username,
        email=f"{data.username}@org{org_id}.local",
        password=pwd,
        full_name=data.full_name or f"{org.name}管理员",
        role="org_admin",
        phone=data.phone,
        org_id=org_id,
    )
    return {"id": user.id, "username": user.username, "org_id": org_id,
            "initial_password": pwd, "org_code": org.code}


# ---------- 一键开体验账号 ----------

@router.post("/trial-provision")
async def provision_trial(
    data: TrialProvision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """一键给加盟商开一整套体验环境:独立机构 + 三端账号 + 默认班 + 全部平台词书。

    每谈一家开一套(账号前缀区分),到期自动停服。三个账号共用一个密码,
    只在响应里返回这一次——方便直接整段复制发给对方。
    """
    prefix = (data.prefix or "demo" + "".join(secrets.choice(string.digits) for _ in range(4))).lower()
    accounts = {role: f"{prefix}_{role}" for role in ("admin", "teacher", "student")}

    # 三个用户名先全查一遍再动手:避免建到一半撞名,留下半套垃圾账号
    taken = (await db.execute(
        select(User.username).where(User.username.in_(list(accounts.values())))
    )).scalars().all()
    if taken:
        raise HTTPException(400, f"账号已存在: {'、'.join(taken)},换个前缀")

    code = _gen_org_code()
    while (await db.execute(select(Organization.id).where(Organization.code == code))).scalar_one_or_none():
        code = _gen_org_code()

    # days 含当天: days=14 → 今天起共 14 个自然日可用,第 15 天停服
    # (check_org_active 的语义是 expires_at 当天仍可用)
    expires = datetime.combine(
        local_today() + timedelta(days=data.days - 1),
        datetime.max.time(),
    ).replace(microsecond=0)

    org = Organization(
        name=data.name or f"体验机构-{prefix}",
        code=code,
        plan="trial",
        student_quota=data.student_quota,
        contact_name=data.contact_name,
        contact_phone=data.contact_phone,
        expires_at=expires,
        status="active",
    )
    db.add(org)
    await db.flush()

    pwd = data.password or auth_service.generate_random_password(10)

    created = {}
    for role, db_role, name in (
        ("admin", "org_admin", "体验-机构管理员"),
        ("teacher", "teacher", "体验-老师"),
        ("student", "student", "体验-学生"),
    ):
        u = User(
            username=accounts[role],
            email=f"{accounts[role]}@org{org.id}.local",
            hashed_password=auth_service.get_password_hash(pwd),
            full_name=name,
            role=db_role,
            org_id=org.id,
            is_active=True,
        )
        db.add(u)
        await db.flush()
        created[role] = u

    # ⚠️ org_id 必须显式给: tenancy 写侧打戳只在机构上下文生效,
    # 这里是平台 admin 上下文(current_org_id=None),不给会落到默认的直营(org_id=1),
    # 导致体验班级不算进本机构、配额与学情统计都对不上
    cls = Class(
        name="体验班",
        description=f"{org.name}的体验班级",
        teacher_id=created["teacher"].id,
        org_id=org.id,
    )
    db.add(cls)
    await db.flush()
    db.add(ClassStudent(class_id=cls.id, student_id=created["student"].id, is_active=True))

    # 全部平台共享词书整本授权给体验学生(org_id IS NULL = 平台库;
    # admin 上下文读侧不过滤,拿到的就是全部平台书)
    books = 0
    if data.assign_all_books:
        book_ids = (await db.execute(
            select(WordBook.id).where(WordBook.org_id.is_(None)).order_by(WordBook.id)
        )).scalars().all()
        for bid in book_ids:
            db.add(BookAssignment(
                book_id=bid,
                student_id=created["student"].id,
                teacher_id=created["teacher"].id,
                scope_type="book",
            ))
        books = len(book_ids)

    await db.commit()
    invalidate_org_cache(org.id)

    return {
        "org": _org_out(org, active_students=1, teacher_count=2),
        "password": pwd,
        "days": data.days,
        "expires_on": expires.date().isoformat(),
        "books_assigned": books,
        "accounts": [
            {"role": "org_admin", "label": "机构管理端", "username": accounts["admin"]},
            {"role": "teacher", "label": "教师端", "username": accounts["teacher"]},
            {"role": "student", "label": "学生端", "username": accounts["student"]},
        ],
    }
