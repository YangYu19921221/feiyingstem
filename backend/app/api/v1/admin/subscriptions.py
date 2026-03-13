"""
管理员订阅兑换码管理API
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.api.v1.auth import get_current_admin
from app.schemas.subscription import (
    RedemptionCodeGenerate,
    RedemptionCodeResponse,
    RedemptionCodeListResponse,
    SubscriptionStatsResponse,
)
from app.services import subscription_service

router = APIRouter()


@router.post("/generate", response_model=list[RedemptionCodeResponse])
async def generate_codes(
    req: RedemptionCodeGenerate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量生成兑换码"""
    if req.duration_days not in (30, 90, 180, 365):
        raise HTTPException(status_code=400, detail="订阅天数必须为 30/90/180/365")

    codes = await subscription_service.batch_generate_codes(
        db=db,
        admin_id=current_user.id,
        count=req.count,
        duration_days=req.duration_days,
        batch_note=req.batch_note,
    )
    return codes


@router.get("/codes", response_model=RedemptionCodeListResponse)
async def list_codes(
    status: Optional[str] = Query(None, description="按状态筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """兑换码列表（分页+筛选）"""
    query = select(RedemptionCode)
    count_query = select(func.count(RedemptionCode.id))

    if status:
        query = query.where(RedemptionCode.status == status)
        count_query = count_query.where(RedemptionCode.status == status)

    query = query.order_by(RedemptionCode.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    codes = result.scalars().all()

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    return RedemptionCodeListResponse(total=total, codes=codes)


@router.get("/stats", response_model=SubscriptionStatsResponse)
async def subscription_stats(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """订阅统计"""
    now = datetime.utcnow()

    # 兑换码统计
    total_q = await db.execute(select(func.count(RedemptionCode.id)))
    total = total_q.scalar() or 0

    for s_name in ("unused", "used", "expired", "disabled"):
        pass  # 下面逐个查询

    unused_q = await db.execute(
        select(func.count(RedemptionCode.id)).where(
            RedemptionCode.status == RedemptionCodeStatus.UNUSED
        )
    )
    unused = unused_q.scalar() or 0

    used_q = await db.execute(
        select(func.count(RedemptionCode.id)).where(
            RedemptionCode.status == RedemptionCodeStatus.USED
        )
    )
    used = used_q.scalar() or 0

    expired_q = await db.execute(
        select(func.count(RedemptionCode.id)).where(
            RedemptionCode.status == RedemptionCodeStatus.EXPIRED
        )
    )
    expired_codes = expired_q.scalar() or 0

    disabled_q = await db.execute(
        select(func.count(RedemptionCode.id)).where(
            RedemptionCode.status == RedemptionCodeStatus.DISABLED
        )
    )
    disabled = disabled_q.scalar() or 0

    # 活跃订阅用户数
    active_q = await db.execute(
        select(func.count(User.id)).where(
            User.role == "student",
            User.subscription_expires_at > now,
        )
    )
    active_subs = active_q.scalar() or 0

    # 过期订阅用户数
    expired_subs_q = await db.execute(
        select(func.count(User.id)).where(
            User.role == "student",
            User.subscription_expires_at != None,
            User.subscription_expires_at <= now,
        )
    )
    expired_subs = expired_subs_q.scalar() or 0

    return SubscriptionStatsResponse(
        total_codes=total,
        unused_codes=unused,
        used_codes=used,
        expired_codes=expired_codes,
        disabled_codes=disabled,
        active_subscribers=active_subs,
        expired_subscribers=expired_subs,
    )


@router.post("/codes/{code_id}/disable")
async def disable_code(
    code_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """禁用兑换码"""
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.id == code_id)
    )
    code = result.scalar_one_or_none()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    if code.status == RedemptionCodeStatus.USED:
        raise HTTPException(status_code=400, detail="已使用的兑换码无法禁用")

    code.status = RedemptionCodeStatus.DISABLED
    await db.commit()
    return {"message": "兑换码已禁用"}
