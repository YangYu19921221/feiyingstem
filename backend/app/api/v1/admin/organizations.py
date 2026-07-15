"""平台管理端 - 机构(租户)管理(多租户 P3)

平台 admin 开机构 → 发机构管理员账号 → 机构管理员自己建老师 → 老师建学生。
"""
import secrets
import string
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.tenancy import invalidate_org_cache
from app.api.v1.auth import get_current_admin
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.services import auth_service
from app.services.org_service import count_active_students

router = APIRouter()


# ---------- Schemas ----------

class OrgCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    code: Optional[str] = Field(None, max_length=16, description="机构码,不传自动生成")
    plan: str = Field("standard", description="trial/standard/county/city")
    student_quota: int = Field(100, ge=1)
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    expires_at: Optional[datetime] = None


class OrgUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    student_quota: Optional[int] = Field(None, ge=1)
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    status: Optional[str] = Field(None, description="active/suspended/expired")
    expires_at: Optional[datetime] = None


class OrgAdminCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = Field(None, description="不传则随机生成,仅返回一次")
    full_name: Optional[str] = None
    phone: Optional[str] = None


def _gen_org_code() -> str:
    return "ORG" + "".join(secrets.choice(string.digits) for _ in range(5))


def _org_out(org: Organization, active_students: int = 0, teacher_count: int = 0) -> dict:
    return {
        "id": org.id, "name": org.name, "code": org.code, "plan": org.plan,
        "student_quota": org.student_quota, "active_students": active_students,
        "teacher_count": teacher_count,
        "contact_name": org.contact_name, "contact_phone": org.contact_phone,
        "status": org.status, "expires_at": org.expires_at, "created_at": org.created_at,
    }


# ---------- 机构 CRUD ----------

@router.get("/organizations")
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """机构列表 + 每机构配额水位/老师数"""
    orgs = (await db.execute(
        select(Organization).order_by(Organization.id)
    )).scalars().all()

    # 每机构老师数/活跃学生数,各一次 GROUP BY 聚合(admin 上下文本就不过滤,无需逃生口)
    teacher_rows = (await db.execute(
        select(User.org_id, func.count(User.id))
        .where(User.role.in_(["teacher", "org_admin"]), User.is_active.is_(True))
        .group_by(User.org_id)
    )).all()
    teachers_by_org = {r[0]: r[1] for r in teacher_rows}

    student_rows = (await db.execute(
        select(Class.org_id, func.count(distinct(ClassStudent.student_id)))
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .where(ClassStudent.is_active.is_(True))
        .group_by(Class.org_id)
    )).all()
    students_by_org = {r[0]: r[1] for r in student_rows}

    return [
        _org_out(org, students_by_org.get(org.id, 0), teachers_by_org.get(org.id, 0))
        for org in orgs
    ]


@router.post("/organizations")
async def create_organization(
    data: OrgCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """开通新机构(加盟商签约后由平台开户)"""
    code = (data.code or _gen_org_code()).strip().upper()
    exists = (await db.execute(
        select(Organization).where(Organization.code == code)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, "机构码已存在，换一个")

    org = Organization(
        name=data.name, code=code, plan=data.plan,
        student_quota=data.student_quota,
        contact_name=data.contact_name, contact_phone=data.contact_phone,
        expires_at=data.expires_at, status="active",
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return _org_out(org)


@router.patch("/organizations/{org_id}")
async def update_organization(
    org_id: int,
    data: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """改配额/续费(改expires_at)/停用恢复(改status)"""
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")
    if org_id == 1 and data.status and data.status != "active":
        raise HTTPException(400, "直营机构不可停用")

    for field in ["name", "plan", "student_quota", "contact_name",
                  "contact_phone", "status", "expires_at"]:
        v = getattr(data, field)
        if v is not None:
            setattr(org, field, v)
    await db.commit()
    invalidate_org_cache(org_id)  # 停用/恢复立即生效
    active = await count_active_students(db, org_id)
    return _org_out(org, active)


# ---------- 机构管理员账号 ----------

@router.get("/organizations/{org_id}/admins")
async def list_org_admins(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    rows = (await db.execute(
        select(User).where(User.org_id == org_id, User.role == "org_admin")
    )).scalars().all()
    return [{"id": u.id, "username": u.username, "full_name": u.full_name,
             "phone": u.phone, "is_active": u.is_active, "last_login": u.last_login}
            for u in rows]


@router.post("/organizations/{org_id}/admins")
async def create_org_admin(
    org_id: int,
    data: OrgAdminCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """给机构开管理员账号(加盟商老板用),初始密码仅返回这一次"""
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")

    existing = await auth_service.get_user_by_username(db, data.username)
    if existing:
        raise HTTPException(400, "用户名已存在")

    pwd = data.password or auth_service.generate_random_password()
    user = await auth_service.create_user(
        db=db,
        username=data.username,
        email=f"{data.username}@org{org_id}.local",
        password=pwd,
        full_name=data.full_name or f"{org.name}管理员",
        role="org_admin",
        phone=data.phone,
        org_id=org_id,
    )
    return {"id": user.id, "username": user.username, "org_id": org_id,
            "initial_password": pwd, "org_code": org.code}
