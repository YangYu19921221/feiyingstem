"""学生端-我的金币:看自己的余额 + 获得/消费明细(只读)"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.coin import StudentCoin, CoinTransaction
from app.api.v1.auth import get_current_student

router = APIRouter()

SOURCE_LABELS = {"task": "完成作业", "word_king": "单词王", "manual": "老师奖励", "redeem": "兑换消耗"}


class MyTx(BaseModel):
    id: int
    amount: int
    source: str
    source_label: str
    reason: Optional[str]
    created_at: datetime


@router.get("/coins/me")
async def my_coins(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我的金币:总余额 + 分页流水(自己只读,不能改)。"""
    balance = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == current_user.id)
    )).scalar() or 0

    total = (await db.execute(
        select(func.count(CoinTransaction.id)).where(CoinTransaction.user_id == current_user.id)
    )).scalar() or 0

    rows = (await db.execute(
        select(CoinTransaction)
        .where(CoinTransaction.user_id == current_user.id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "balance": balance,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            MyTx(
                id=t.id, amount=t.amount, source=t.source,
                source_label=SOURCE_LABELS.get(t.source, t.source),
                reason=t.reason, created_at=t.created_at,
            )
            for t in rows
        ],
    }
