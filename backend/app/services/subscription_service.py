"""
单词本兑换码服务
"""
import random
import string
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.learning import BookAssignment
from app.models.word import WordBook

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
    book_id: int,
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
            book_id=book_id,
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

    # 查询绑定的单词本名称
    book = await db.get(WordBook, code.book_id)
    book_name = book.name if book else "未知"

    # 检查学生是否已拥有该单词本
    existing_assignment = await db.execute(
        select(BookAssignment).where(
            BookAssignment.book_id == code.book_id,
            BookAssignment.student_id == user.id,
        )
    )
    if existing_assignment.scalar_one_or_none():
        return {"success": False, "message": f"你已拥有单词本《{book_name}》，无需重复兑换"}

    # 创建单词本分配记录
    assignment = BookAssignment(
        book_id=code.book_id,
        student_id=user.id,
        teacher_id=code.created_by,
    )
    db.add(assignment)

    # 更新兑换码状态
    code.status = RedemptionCodeStatus.USED
    code.used_by = user.id
    code.used_at = now

    await db.commit()

    return {
        "success": True,
        "message": f"兑换成功！已获得单词本《{book_name}》",
        "book_name": book_name,
    }
