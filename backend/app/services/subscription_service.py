"""
单词本兑换码服务
"""
import random
import string
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.learning import BookAssignment
from app.models.word import WordBook

# 去掉易混淆字符 0/O/1/I/L
CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

# 卡种
GRANT_PERMANENT = "permanent"   # 永久(旧行为)
GRANT_PERIOD = "period"         # 包月:按天数计时,到期即停
GRANT_TIMES = "times"           # 次卡:按「学习天」计次,当天首次进入扣 1


def _normalize_grant_type(gt: Optional[str]) -> str:
    """归一化卡种:NULL/空串/permanent 统一返回 GRANT_PERMANENT"""
    return gt if gt in (GRANT_PERIOD, GRANT_TIMES) else GRANT_PERMANENT


def is_assignment_active(a: BookAssignment, today: Optional[str] = None) -> bool:
    """这条授权现在还能不能学。

    永久(grant_type 为 NULL/permanent,含全部老师直接分配的行)恒 True——
    这是旧行为,不能因为加了卡种就把存量授权判死。

    次卡的判活口径是「有余量 **或** 今天已经扣过」: 只看 times_left>0 会让最后
    一天在当天首次进入扣减后立刻失效(扣到 0 → 判死 → 学生学一半被踢出去)。
    """
    gt = _normalize_grant_type(a.grant_type)
    if gt == GRANT_PERMANENT:
        return True
    if gt == GRANT_PERIOD:
        return a.expires_at is None or a.expires_at > utc_now()
    # GRANT_TIMES
    if (a.times_left or 0) > 0:
        return True
    return a.last_consumed_date == (today or local_today().isoformat())


async def active_assignments(
    db: AsyncSession, student_id: int, book_id: Optional[int] = None
) -> List[BookAssignment]:
    """该学生仍然有效的授权行(过期/用尽的次卡被滤掉)。"""
    q = select(BookAssignment).where(BookAssignment.student_id == student_id)
    if book_id is not None:
        q = q.where(BookAssignment.book_id == book_id)
    rows = (await db.execute(q)).scalars().all()
    today = local_today().isoformat()
    return [a for a in rows if is_assignment_active(a, today)]


async def consume_times_if_needed(
    db: AsyncSession, student_id: int, book_id: int
) -> None:
    """次卡扣减:该学生该书的次卡授权,当天首次进入扣 1 天。

    只在「真正开始学习」的入口调用(取单元词表),不要挂在任何列表/统计接口上——
    挂错地方会让学生翻一下书本列表就掉一天。

    幂等靠 last_consumed_date(北京日):同一天再进不重复扣,所以提交队列重放、
    刷新页面、切模式都不会多扣。
    """
    today = local_today().isoformat()
    rows = (await db.execute(
        select(BookAssignment).where(
            BookAssignment.student_id == student_id,
            BookAssignment.book_id == book_id,
            BookAssignment.grant_type == GRANT_TIMES,
        )
    )).scalars().all()
    changed = False
    for a in rows:
        if a.last_consumed_date == today:
            continue
        if (a.times_left or 0) <= 0:
            continue
        a.times_left = (a.times_left or 0) - 1
        a.last_consumed_date = today
        changed = True
    if changed:
        await db.commit()


def describe_grant(a: BookAssignment) -> dict:
    """给前端的卡片状态(剩余天数/次数/是否今天已用)。"""
    gt = _normalize_grant_type(a.grant_type)
    today = local_today().isoformat()
    info = {"grant_type": gt, "active": is_assignment_active(a, today)}
    if gt == GRANT_PERIOD:
        info["expires_at"] = a.expires_at
        if a.expires_at:
            info["days_left"] = max(0, (a.expires_at - utc_now()).days)
    elif gt == GRANT_TIMES:
        info["times_left"] = a.times_left or 0
        info["used_today"] = a.last_consumed_date == today
    return info


def generate_code_string() -> str:
    """生成格式化兑换码 XXXX-XXXX-XXXX-XXXX"""
    parts = []
    for _ in range(4):
        part = ''.join(random.choices(CHARSET, k=4))
        parts.append(part)
    return '-'.join(parts)


async def batch_generate_codes(
    db: AsyncSession,
    admin_id: int,
    count: int,
    book_id: int,
    batch_note: Optional[str] = None,
    code_valid_days: int = 180,
    grant_type: str = GRANT_PERMANENT,
    grant_days: Optional[int] = None,
    grant_times: Optional[int] = None,
) -> List[RedemptionCode]:
    """批量生成兑换码。

    grant_type: permanent=永久 / period=包月(grant_days 必填) / times=次卡(grant_times 必填)。
    注意 code_valid_days 是「码本身多久内必须兑换」,与卡的时长/次数是两件事。
    Pydantic schema 已校验必填字段,这里不重复检查。
    """
    codes = []
    code_expires_at = datetime.utcnow() + timedelta(days=code_valid_days)

    # 收集已有code避免重复
    existing = set()
    result = await db.execute(select(RedemptionCode.code))
    for row in result.scalars():
        existing.add(row)

    generated = []
    attempts = 0
    while len(generated) < count and attempts < count * 10:
        code_str = generate_code_string()
        attempts += 1
        if code_str not in existing:
            existing.add(code_str)
            generated.append(code_str)

    for code_str in generated:
        code = RedemptionCode(
            code=code_str,
            book_id=book_id,
            status=RedemptionCodeStatus.UNUSED,
            created_by=admin_id,
            code_expires_at=code_expires_at,
            batch_note=batch_note,
            grant_type=grant_type,
            grant_days=grant_days if grant_type == GRANT_PERIOD else None,
            grant_times=grant_times if grant_type == GRANT_TIMES else None,
        )
        db.add(code)
        codes.append(code)

    await db.commit()
    for c in codes:
        await db.refresh(c)
    return codes


async def redeem_code(
    db: AsyncSession,
    user: User,
    code_str: str,
) -> dict:
    """兑换码激活单词本"""
    # 查找兑换码
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.code == code_str)
    )
    code = result.scalar_one_or_none()

    if not code:
        return {"success": False, "message": "兑换码不存在"}

    if code.status == RedemptionCodeStatus.USED:
        return {"success": False, "message": "兑换码已被使用"}

    if code.status == RedemptionCodeStatus.DISABLED:
        return {"success": False, "message": "兑换码已被禁用"}

    # 检查兑换码本身是否过期
    now = datetime.utcnow()
    if code.code_expires_at < now:
        code.status = RedemptionCodeStatus.EXPIRED
        await db.commit()
        return {"success": False, "message": "兑换码已过期"}

    # 查询绑定的单词本是否还存在
    book = await db.get(WordBook, code.book_id)
    if not book:
        code.status = RedemptionCodeStatus.DISABLED
        await db.commit()
        return {"success": False, "message": "兑换码绑定的单词本已不存在，请联系管理员"}
    book_name = book.name

    grant_type = code.grant_type or GRANT_PERMANENT

    # 已有的书级授权。次卡/包月是**续期**而不是拒绝——月卡到期前续下一个月是
    # 正常动作,按"已拥有"拒掉会让学生的卡断在中间接不上。
    existing_assignment = (await db.execute(
        select(BookAssignment).where(
            BookAssignment.book_id == code.book_id,
            BookAssignment.student_id == user.id,
            BookAssignment.scope_type == 'book',
        )
    )).scalars().first()

    if existing_assignment is not None:
        existing_type = existing_assignment.grant_type or GRANT_PERMANENT
        # 已经是永久的,任何卡都没有意义;拿永久卡去覆盖次卡/月卡则是升级,放行
        if existing_type == GRANT_PERMANENT:
            return {"success": False, "message": f"你已拥有单词本《{book_name}》，无需重复兑换"}
        if grant_type == GRANT_PERMANENT:
            existing_assignment.grant_type = GRANT_PERMANENT
            existing_assignment.expires_at = None
            existing_assignment.times_left = None
            msg = f"兑换成功！《{book_name}》已升级为永久可学"
        elif grant_type != existing_type:
            return {
                "success": False,
                "message": f"《{book_name}》当前是{_grant_label(existing_type)}，"
                           f"不能直接用{_grant_label(grant_type)}续期，请等当前的用完",
            }
        elif grant_type == GRANT_PERIOD:
            # 未过期从原到期日往后接,已过期从现在算(别把过期的空窗期白送)
            base = existing_assignment.expires_at
            if base is None or base < now:
                base = now
            existing_assignment.expires_at = base + timedelta(days=code.grant_days or 0)
            msg = (f"续期成功！《{book_name}》有效期延长 {code.grant_days} 天，"
                   f"到 {existing_assignment.expires_at.strftime('%Y-%m-%d')}")
        else:
            existing_assignment.times_left = (existing_assignment.times_left or 0) + (code.grant_times or 0)
            msg = (f"续期成功！《{book_name}》增加 {code.grant_times} 天，"
                   f"剩余 {existing_assignment.times_left} 天")
    else:
        assignment = BookAssignment(
            book_id=code.book_id,
            student_id=user.id,
            teacher_id=code.created_by,
            scope_type='book',
            grant_type=grant_type,
        )
        if grant_type == GRANT_PERIOD:
            assignment.expires_at = now + timedelta(days=code.grant_days or 0)
            msg = (f"兑换成功！已获得《{book_name}》{code.grant_days} 天，"
                   f"到 {assignment.expires_at.strftime('%Y-%m-%d')}")
        elif grant_type == GRANT_TIMES:
            assignment.times_left = code.grant_times or 0
            msg = f"兑换成功！已获得《{book_name}》次卡 {code.grant_times} 天（学习当天才计次）"
        else:
            msg = f"兑换成功！已获得单词本《{book_name}》"
        db.add(assignment)

    # 更新兑换码状态
    code.status = RedemptionCodeStatus.USED
    code.used_by = user.id
    code.used_at = now

    await db.commit()

    return {"success": True, "message": msg, "book_name": book_name}


def _grant_label(grant_type: str) -> str:
    return {
        GRANT_PERMANENT: "永久卡",
        GRANT_PERIOD: "包月卡",
        GRANT_TIMES: "次卡",
    }.get(grant_type, grant_type)
