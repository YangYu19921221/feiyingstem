"""
订阅兑换API（学生端）
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.api.v1.auth import get_current_user_no_sub_check
from app.schemas.subscription import (
    RedeemRequest,
    RedeemResponse,
    SubscriptionStatusResponse,
)
from app.services import subscription_service

router = APIRouter()


@router.post("/redeem", response_model=RedeemResponse)
async def redeem(
    req: RedeemRequest,
    current_user: User = Depends(get_current_user_no_sub_check),
    db: AsyncSession = Depends(get_db),
):
    """兑换订阅码"""
    if current_user.role != "student":
        raise HTTPException(status_code=400, detail="仅学生用户需要兑换订阅")

    result = await subscription_service.redeem_code(db, current_user, req.code)
    return RedeemResponse(**result)


@router.get("/status", response_model=SubscriptionStatusResponse)
async def subscription_status(
    current_user: User = Depends(get_current_user_no_sub_check),
):
    """查询当前用户订阅状态"""
    now = datetime.utcnow()
    expires = current_user.subscription_expires_at

    if current_user.role != "student":
        # 教师/管理员不受订阅限制
        return SubscriptionStatusResponse(
            has_subscription=True,
            is_expired=False,
            days_remaining=99999,
        )

    if not expires:
        return SubscriptionStatusResponse(
            has_subscription=False,
            is_expired=True,
            days_remaining=0,
        )

    is_expired = expires < now
    days_remaining = max(0, (expires - now).days) if not is_expired else 0

    return SubscriptionStatusResponse(
        has_subscription=True,
        subscription_expires_at=expires,
        is_expired=is_expired,
        days_remaining=days_remaining,
    )
