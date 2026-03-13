"""
订阅兑换码服务
"""
import random
import string
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, RedemptionCode, RedemptionCodeStatus

# 去掉易混淆字符 0/O/1/I/L
CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


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
    duration_days: int,
    batch_note: Optional[str] = None,
    code_valid_days: int = 180,
) -> List[RedemptionCode]:
    """批量生成兑换码"""
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
            duration_days=duration_days,
            status=RedemptionCodeStatus.UNUSED,
            created_by=admin_id,
            code_expires_at=code_expires_at,
            batch_note=batch_note,
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
    """兑换激活订阅"""
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

    # 续期逻辑：未过期从到期日延续，已过期从当前时间开始
    duration = timedelta(days=code.duration_days)
    current_expires = user.subscription_expires_at
    if current_expires and current_expires > now:
        new_expires = current_expires + duration
    else:
        new_expires = now + duration

    # 更新用户订阅
    user.subscription_expires_at = new_expires
    # 更新兑换码状态
    code.status = RedemptionCodeStatus.USED
    code.used_by = user.id
    code.used_at = now

    await db.commit()
    await db.refresh(user)

    return {
        "success": True,
        "message": f"兑换成功！订阅有效期至 {new_expires.strftime('%Y-%m-%d %H:%M')}",
        "subscription_expires_at": new_expires,
    }
