"""
管理员 - 用户管理API
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.core.database import get_db
from app.api.v1.auth import get_current_admin
from app.models.user import User
from app.schemas.user import UserResponse, UserCreate, UserUpdate
from app.services import auth_service

router = APIRouter()


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.get("/users", response_model=dict)
async def get_all_users(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    role: Optional[str] = Query(None, description="角色筛选: student/teacher/admin"),
    search: Optional[str] = Query(None, description="搜索关键词(用户名/姓名)"),
    is_active: Optional[bool] = Query(None, description="是否激活"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有用户列表(分页)
    - 支持按角色筛选
    - 支持关键词搜索
    - 支持按激活状态筛选
    """
    # 构建查询
    query = select(User)

    # 角色筛选
    if role:
        query = query.where(User.role == role)

    # 激活状态筛选
    if is_active is not None:
        query = query.where(User.is_active == is_active)

    # 搜索
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                User.username.ilike(search_pattern),
                User.full_name.ilike(search_pattern),
                User.email.ilike(search_pattern)
            )
        )

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(User.created_at.desc())

    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name,
                "role": user.role,
                "is_active": user.is_active,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "last_login": user.last_login.isoformat() if user.last_login else None
            }
            for user in users
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/users/stats", response_model=dict)
async def get_user_stats(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户统计信息
    """
    # 总用户数
    total_query = select(func.count()).select_from(User)
    total_result = await db.execute(total_query)
    total = total_result.scalar()

    # 各角色用户数
    role_stats = {}
    for role in ['student', 'teacher', 'admin']:
        role_query = select(func.count()).select_from(User).where(User.role == role)
        role_result = await db.execute(role_query)
        role_stats[role] = role_result.scalar()

    # 激活用户数
    active_query = select(func.count()).select_from(User).where(User.is_active == True)
    active_result = await db.execute(active_query)
    active_count = active_result.scalar()

    return {
        "total": total,
        "active": active_count,
        "inactive": total - active_count,
        "by_role": role_stats
    }


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user_detail(
    user_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户详细信息
    """
    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    return user


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    创建新用户
    """
    # 检查用户名是否已存在
    existing_user = await auth_service.get_user_by_username(db, user_data.username)
    if existing_user:
        raise HTTPException(status_code=400, detail="用户名已存在")

    # 检查邮箱是否已存在
    if user_data.email:
        existing_email = await auth_service.get_user_by_email(db, user_data.email)
        if existing_email:
            raise HTTPException(status_code=400, detail="邮箱已被使用")

    # 创建用户
    user = await auth_service.create_user(
        db=db,
        username=user_data.username,
        email=user_data.email,
        password=user_data.password,
        full_name=user_data.full_name,
        role=user_data.role
    )

    return user


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    更新用户信息
    """
    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 检查是否在修改自己的管理员权限
    if user.id == current_user.id and user_data.role and user_data.role != 'admin':
        raise HTTPException(status_code=400, detail="不能修改自己的管理员权限")

    # 更新字段
    if user_data.email is not None:
        # 检查邮箱是否被其他用户使用
        existing = await auth_service.get_user_by_email(db, user_data.email)
        if existing and existing.id != user_id:
            raise HTTPException(status_code=400, detail="邮箱已被使用")
        user.email = user_data.email

    if user_data.full_name is not None:
        user.full_name = user_data.full_name

    if user_data.role is not None:
        user.role = user_data.role

    if user_data.is_active is not None:
        user.is_active = user_data.is_active

    await db.commit()
    await db.refresh(user)

    return user


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    body: ResetPasswordRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    重置用户密码
    """
    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少6位")

    # 更新密码
    user.hashed_password = auth_service.get_password_hash(body.new_password)
    await db.commit()

    return {"message": "密码重置成功"}


@router.post("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    启用/禁用用户账号
    """
    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 不能禁用自己
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能禁用自己的账号")

    user.is_active = not user.is_active
    await db.commit()

    return {
        "message": "用户状态已更新",
        "is_active": user.is_active
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    删除用户
    """
    user = await auth_service.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 不能删除自己
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")

    await db.delete(user)
    await db.commit()

    return {"message": "用户已删除"}
