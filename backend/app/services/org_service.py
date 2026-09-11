"""机构服务(多租户 P3): 配额统计与校验、机构码解析"""
from fastapi import HTTPException
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import DEFAULT_ORG_ID
from app.models.user import User, Class, ClassStudent
from app.models.organization import Organization


async def count_active_students(db: AsyncSession, org_id: int) -> int:
    """机构活跃学生数 = 有活跃班级关系的去重学生(计费口径,见设计方案§5.1)"""
    return (await db.execute(
        select(func.count(distinct(ClassStudent.student_id)))
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.org_id == org_id, ClassStudent.is_active.is_(True))
        .execution_options(skip_tenant_filter=True)  # 计数需跨上下文准确(如admin视角)
    )).scalar() or 0


async def get_org(db: AsyncSession, org_id: int) -> Organization | None:
    return (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()


# ===== 学习卡额度(2026-09-11) =====
# 「已发张数 / 已购张数」,与学生名额是**两笔账**:
#   student_quota = 同时在读多少人(可复用: 学生离班腾出名额)
#   card_quota    = 买过多少张半年卡(一次性消耗: 同一学生学一年要两张)
# 机构改成只能发半年卡后,两者混用会把续卡锁死(实测: 发满 2/2 后续卡 403),
# 而协议明确允许续卡(50 张起)。
#
# 计数口径沿用发码上线时的选择:
#   - 按**码张数**计,不按 码×书数 —— 一张卡开一整个学段是权益厚度,不是名额
#   - 未使用的码被禁用/删除**归还额度**(印错的批次不该白扣)
#   - 已兑换的码永久占额(那才是真卖出去的一张卡)
CARD_RENEWAL_MIN = 50   # 协议第三条: 续卡 50 张起


def card_quota_of(org: Organization | None) -> int:
    """该机构买过多少张学习卡。

    card_quota 为 NULL(存量机构全部如此) → 回退 student_quota,
    维持改动前的发码上限,不会让任何现有机构突然多出或少掉额度。
    """
    if org is None:
        return 0
    quota = getattr(org, "card_quota", None)
    return quota if quota is not None else (org.student_quota or 0)


async def count_issued_cards(db: AsyncSession, org_id: int) -> int:
    """该机构累计已发(未禁用)的兑换码张数 = 已占用的卡额度。"""
    from app.models.user import RedemptionCode, RedemptionCodeStatus

    return (await db.execute(
        select(func.count(RedemptionCode.id)).where(
            RedemptionCode.created_by.in_(
                select(User.id).where(User.org_id == org_id)
            ),
            RedemptionCode.status != RedemptionCodeStatus.DISABLED,
        ).execution_options(skip_tenant_filter=True)
    )).scalar() or 0


async def card_quota_status(db: AsyncSession, org_id: int) -> dict:
    """卡额度水位 —— 机构端「额度」区块与发码闸门共用这一份。

    两处各算一遍必然漂移成"界面说还剩 5 张、发码说额度不足"。
    """
    org = await get_org(db, org_id)
    quota = card_quota_of(org)
    used = await count_issued_cards(db, org_id)
    return {
        "card_quota": quota,
        "cards_used": used,
        "cards_left": max(0, quota - used),
        # NULL 时前端要说清"未单独设置,按学生名额算",否则机构看不懂这个数从哪来
        "card_quota_explicit": getattr(org, "card_quota", None) is not None if org else False,
        "renewal_min": CARD_RENEWAL_MIN,
    }


async def resolve_org_code(db: AsyncSession, code: str | None) -> int:
    """机构码 → org_id。无码/无效码/机构停用 → 直营。
    测评链接、注册页、后台共用这一处语义(大小写不敏感)。"""
    if not code:
        return DEFAULT_ORG_ID
    org_id = (await db.execute(
        select(Organization.id).where(
            Organization.code == code.strip().upper(),
            Organization.status == "active",
        )
    )).scalar_one_or_none()
    return org_id or DEFAULT_ORG_ID


async def check_student_quota(db: AsyncSession, org_id: int, adding: int = 1):
    """入班/建学生前校验配额,超了抛403(直营 quota=999999 等于不限)"""
    org = await get_org(db, org_id)
    if org is None:
        return  # 机构不存在时不拦(数据异常由其他层兜底)
    current = await count_active_students(db, org_id)
    if current + adding > (org.student_quota or 0):
        raise HTTPException(
            status_code=403,
            detail=f"机构学生名额已满({current}/{org.student_quota})，请联系机构管理员扩容",
        )
