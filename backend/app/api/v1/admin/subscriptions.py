"""
管理员兑换码管理API
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.word import WordBook
from app.api.v1.auth import get_current_admin_or_org_admin
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
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量生成兑换码。

    机构管理员: 发码总量与学生配额对等——累计已发(未禁用)不得超过 student_quota,
    防止用兑换码绕过名额;删除/禁用的码归还额度。平台 admin 不限。
    """
    # 检查单词本是否存在(org_admin 受租户过滤: 只能选平台共享库或本机构自建)
    book = await db.get(WordBook, req.book_id)
    if not book:
        raise HTTPException(status_code=400, detail="指定的单词本不存在")

    if current_user.role == "org_admin":
        from app.services.org_service import get_org
        org = await get_org(db, current_user.org_id)
        quota = org.student_quota if org else 0
        issued = (await db.execute(
            select(func.count(RedemptionCode.id)).where(
                RedemptionCode.created_by.in_(
                    select(User.id).where(User.org_id == current_user.org_id)
                ),
                RedemptionCode.status != RedemptionCodeStatus.DISABLED,
            )
        )).scalar() or 0
        if issued + req.count > quota:
            raise HTTPException(
                status_code=403,
                detail=f"兑换码额度不足: 已发 {issued}/{quota}(与学生名额对等),本次申请 {req.count} 个超出上限",
            )

    codes = await subscription_service.batch_generate_codes(
        db=db,
        admin_id=current_user.id,
        count=req.count,
        book_id=req.book_id,
        batch_note=req.batch_note,
    )

    # 为响应添加 book_name
    result = []
    for code in codes:
        code_dict = {
            "id": code.id,
            "code": code.code,
            "book_id": code.book_id,
            "book_name": book.name,
            "status": code.status,
            "created_by": code.created_by,
            "created_at": code.created_at,
            "code_expires_at": code.code_expires_at,
            "used_by": code.used_by,
            "used_at": code.used_at,
            "batch_note": code.batch_note,
        }
        result.append(code_dict)
    return result


@router.get("/codes", response_model=RedemptionCodeListResponse)
async def list_codes(
    status: Optional[str] = Query(None, description="按状态筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """兑换码列表（分页+筛选;机构管理员只见本机构发的码）"""
    query = select(RedemptionCode)
    count_query = select(func.count(RedemptionCode.id))

    if current_user.role == "org_admin":
        org_users = select(User.id).where(User.org_id == current_user.org_id)
        query = query.where(RedemptionCode.created_by.in_(org_users))
        count_query = count_query.where(RedemptionCode.created_by.in_(org_users))

    if status:
        query = query.where(RedemptionCode.status == status)
        count_query = count_query.where(RedemptionCode.status == status)

    query = query.order_by(RedemptionCode.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    codes = result.scalars().all()

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 收集所有涉及的 book_id，批量查询 book_name
    book_ids = set(c.book_id for c in codes)
    book_name_map = {}
    if book_ids:
        books_result = await db.execute(
            select(WordBook).where(WordBook.id.in_(book_ids))
        )
        for book in books_result.scalars().all():
            book_name_map[book.id] = book.name

    # 构造响应，添加 book_name
    code_responses = []
    for code in codes:
        code_responses.append(RedemptionCodeResponse(
            id=code.id,
            code=code.code,
            book_id=code.book_id,
            book_name=book_name_map.get(code.book_id, "未知"),
            status=code.status,
            created_by=code.created_by,
            created_at=code.created_at,
            code_expires_at=code.code_expires_at,
            used_by=code.used_by,
            used_at=code.used_at,
            batch_note=code.batch_note,
        ))

    return RedemptionCodeListResponse(total=total, codes=code_responses)


@router.get("/stats", response_model=SubscriptionStatsResponse)
async def subscription_stats(
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """兑换码统计(机构管理员只统计本机构发的码)"""
    base_cond = []
    if current_user.role == "org_admin":
        org_users = select(User.id).where(User.org_id == current_user.org_id)
        base_cond.append(RedemptionCode.created_by.in_(org_users))

    def _q(*conds):
        stmt = select(func.count(RedemptionCode.id))
        for c in [*base_cond, *conds]:
            stmt = stmt.where(c)
        return stmt

    total_q = await db.execute(_q())
    total = total_q.scalar() or 0

    unused_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.UNUSED))
    unused = unused_q.scalar() or 0

    used_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.USED))
    used = used_q.scalar() or 0

    expired_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.EXPIRED))
    expired_codes = expired_q.scalar() or 0

    disabled_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.DISABLED))
    disabled = disabled_q.scalar() or 0

    return SubscriptionStatsResponse(
        total_codes=total,
        unused_codes=unused,
        used_codes=used,
        expired_codes=expired_codes,
        disabled_codes=disabled,
    )


@router.post("/codes/{code_id}/disable")
async def disable_code(
    code_id: int,
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """禁用兑换码"""
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.id == code_id)
    )
    code = result.scalar_one_or_none()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    # 机构管理员只能操作本机构发的码(按不存在处理,不泄露)
    if current_user.role == "org_admin":
        creator_org = (await db.execute(
            select(User.org_id).where(User.id == code.created_by)
        )).scalar()
        if creator_org != current_user.org_id:
            raise HTTPException(status_code=404, detail="兑换码不存在")

    if code.status == RedemptionCodeStatus.USED:
        raise HTTPException(status_code=400, detail="已使用的兑换码无法禁用")

    code.status = RedemptionCodeStatus.DISABLED
    await db.commit()
    return {"message": "兑换码已禁用"}
