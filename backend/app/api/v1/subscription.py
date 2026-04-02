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
from app.schemas.subscription import (
    RedeemRequest,
    RedeemResponse,
)
from app.services import subscription_service

router = APIRouter()


@router.post("/redeem", response_model=RedeemResponse)
async def redeem(
    req: RedeemRequest,
    current_user: User = Depends(get_current_user_no_sub_check),
    db: AsyncSession = Depends(get_db),
):
    """兑换单词本"""
    if current_user.role != "student":
        raise HTTPException(status_code=400, detail="仅学生用户需要兑换")

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
        books.append({
            "book_id": book.id,
            "book_name": book.name,
            "assigned_at": assignment.assigned_at,
        })

    return {"books": books}
