"""管理员 - 教师管理"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import Optional

from app.core.database import get_db
from app.api.v1.auth import get_current_admin
from app.models.user import User, Class, ClassStudent
from app.services.auth_service import get_password_hash, generate_random_password

router = APIRouter()


class TeacherCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str
    full_name: Optional[str] = None
    password: Optional[str] = None  # 不传则随机生成


class TeacherUpdate(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/teachers")
async def list_teachers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """列出所有教师，包含班级数与在册学生数"""
    res = await db.execute(
        select(
            User.id,
            User.username,
            User.email,
            User.full_name,
            User.is_active,
            User.last_login,
            func.count(func.distinct(Class.id)).label("class_count"),
            func.count(func.distinct(ClassStudent.student_id)).label("student_count"),
        )
        .outerjoin(Class, Class.teacher_id == User.id)
        .outerjoin(
            ClassStudent,
            (ClassStudent.class_id == Class.id) & (ClassStudent.is_active.is_(True)),
        )
        .where(User.role == "teacher")
        .group_by(User.id)
        .order_by(User.username)
    )
    return [
        {
            "id": i,
            "username": u,
            "email": e,
            "full_name": fn,
            "is_active": bool(act),
            "last_login": ll.isoformat() if ll else None,
            "class_count": cc,
            "student_count": sc,
        }
        for i, u, e, fn, act, ll, cc, sc in res.all()
    ]


@router.get("/teachers/{teacher_id}")
async def get_teacher(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """获取单个教师详情及其班级列表"""
    res = await db.execute(
        select(User).where(User.id == teacher_id, User.role == "teacher")
    )
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="教师不存在")

    cls_res = await db.execute(
        select(Class).where(Class.teacher_id == teacher_id)
    )
    classes = [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in cls_res.scalars().all()
    ]
    return {
        "id": t.id,
        "username": t.username,
        "email": t.email,
        "full_name": t.full_name,
        "is_active": t.is_active,
        "classes": classes,
    }


@router.post("/teachers")
async def create_teacher(
    body: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """创建教师账号（密码不传则随机生成并在响应中返回一次）"""
    pwd = body.password or generate_random_password()
    t = User(
        username=body.username,
        email=body.email,
        full_name=body.full_name,
        hashed_password=get_password_hash(pwd),
        role="teacher",
        is_active=True,
    )
    db.add(t)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="用户名或邮箱已存在")
    await db.refresh(t)
    return {"id": t.id, "username": t.username, "initial_password": pwd}


@router.patch("/teachers/{teacher_id}")
async def update_teacher(
    teacher_id: int,
    body: TeacherUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """更新教师 full_name 或 is_active"""
    res = await db.execute(
        select(User).where(User.id == teacher_id, User.role == "teacher")
    )
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="教师不存在")
    if body.full_name is not None:
        t.full_name = body.full_name
    if body.is_active is not None:
        t.is_active = body.is_active
    await db.commit()
    return {"updated": True}


@router.post("/teachers/{teacher_id}/reset-password")
async def reset_teacher_password(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """重置教师密码，返回一次性新密码"""
    res = await db.execute(
        select(User).where(User.id == teacher_id, User.role == "teacher")
    )
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="教师不存在")
    new_pwd = generate_random_password()
    t.hashed_password = get_password_hash(new_pwd)
    await db.commit()
    return {"new_password": new_pwd}
