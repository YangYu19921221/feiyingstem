"""
单词本兑换API（学生端）
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.learning import BookAssignment
from app.models.word import WordBook
from app.api.v1.auth import get_current_user_no_sub_check
from app.models.phonetic import PhoneticCode
from app.schemas.subscription import (
    RedeemRequest,
    RedeemResponse,
)
from app.services import subscription_service, phonetic_access_service

router = APIRouter()


@router.post("/redeem", response_model=RedeemResponse)
async def redeem(
    req: RedeemRequest,
    current_user: User = Depends(get_current_user_no_sub_check),
    db: AsyncSession = Depends(get_db),
):
    """兑换(单词本码 / 音标视频库码,同一个入口)。

    音标码与单词本码是两套码两张表(为什么分开见 models/phonetic.py)。学生只有
    一个「兑换」框、也记不住哪张是哪套,所以这里先按码串在**两张表**里找:
    命中音标表就走音标授权,否则按单词本码处理。响应里的 scope 让前端区分文案。
    """
    if current_user.role != "student":
        raise HTTPException(status_code=400, detail="仅学生用户需要兑换")

    # 先看是不是音标码(音标表的 code 唯一,与单词本码不会撞:两套码都走
    # generate_code_string,理论上可能重复,但先查音标、未命中再查单词本,
    # 分派是确定的 —— 命中哪张表就按哪套兑)
    phonetic_code = (await db.execute(
        select(PhoneticCode).where(PhoneticCode.code == req.code)
    )).scalar_one_or_none()
    if phonetic_code is not None:
        result = await phonetic_access_service.redeem_phonetic_code(
            db, current_user, req.code)
        return RedeemResponse(**result)

    result = await subscription_service.redeem_code(db, current_user, req.code)
    return RedeemResponse(**result)


@router.get("/my-books")
async def my_purchased_books(
    current_user: User = Depends(get_current_user_no_sub_check),
    db: AsyncSession = Depends(get_db),
):
    """查询当前用户已购买（兑换）的单词本列表"""
    if current_user.role != "student":
        return {"books": []}

    result = await db.execute(
        select(BookAssignment, WordBook)
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.student_id == current_user.id)
    )
    rows = result.all()

    books = []
    for assignment, book in rows:
        grant_info = subscription_service.describe_grant(assignment)
        books.append({
            "book_id": book.id,
            "book_name": book.name,
            "assigned_at": assignment.assigned_at,
            **grant_info,
        })

    return {"books": books}
