"""机构管理端(org_admin)- 加盟商老板的控制台(多租户 P3)

能力边界: 只管本机构 — 建/停老师账号、看机构概况与配额水位、领机构码。
数据隔离由 tenancy 全局过滤器 + org_id 显式条件双保险。
"""
import secrets
import string
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.organization import Organization
from app.models.user import User
from app.services import auth_service
from app.services.org_service import count_active_students

router = APIRouter()


async def get_current_org_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """机构管理员(平台admin也可,方便代操作)"""
    if current_user.role not in ["org_admin", "admin"]:
        raise HTTPException(status_code=403, detail="需要机构管理员权限")
    return current_user


class TeacherCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = Field(None, description="不传则随机生成,仅返回一次")
    full_name: Optional[str] = None
    phone: Optional[str] = None


@router.get("/info")
async def org_info(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """机构概况: 名称/机构码/配额水位/到期时间(测评链接、注册引导都用机构码)"""
    org = (await db.execute(
        select(Organization).where(Organization.id == (current_user.org_id or 1))
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")
    active = await count_active_students(db, org.id)
    teacher_count = (await db.execute(
        select(func.count(User.id)).where(
            User.org_id == org.id, User.role == "teacher", User.is_active.is_(True))
    )).scalar() or 0
    return {
        "id": org.id, "name": org.name, "code": org.code, "plan": org.plan,
        "student_quota": org.student_quota, "active_students": active,
        "teacher_count": teacher_count,
        "status": org.status, "expires_at": org.expires_at,
    }


@router.get("/teachers")
async def list_teachers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """本机构老师列表"""
    rows = (await db.execute(
        select(User).where(
            User.org_id == (current_user.org_id or 1), User.role == "teacher")
        .order_by(User.id)
    )).scalars().all()
    return [{"id": u.id, "username": u.username, "full_name": u.full_name,
             "phone": u.phone, "is_active": u.is_active, "last_login": u.last_login,
             "created_at": u.created_at}
            for u in rows]


@router.post("/teachers")
async def create_teacher(
    data: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """建老师账号(归本机构),初始密码仅返回这一次"""
    existing = await auth_service.get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(400, "用户名已存在")

    pwd = data.password or "".join(
        secrets.choice(string.ascii_letters + string.digits) for _ in range(10))
    org_id = current_user.org_id or 1
    user = await auth_service.create_user(
        db=db,
        username=data.username,
        email=f"{data.username}@org{org_id}.local",
        password=pwd,
        full_name=data.full_name or data.username,
        role="teacher",
        phone=data.phone,
        org_id=org_id,
    )
    return {"id": user.id, "username": user.username, "initial_password": pwd}


@router.patch("/teachers/{teacher_id}/toggle-active")
async def toggle_teacher_active(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """停用/恢复老师账号(只能操作本机构的)"""
    teacher = (await db.execute(
        select(User).where(
            User.id == teacher_id, User.role == "teacher",
            User.org_id == (current_user.org_id or 1))
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(404, "老师不存在或不属于本机构")
    teacher.is_active = not teacher.is_active
    await db.commit()
    return {"id": teacher.id, "is_active": teacher.is_active}
