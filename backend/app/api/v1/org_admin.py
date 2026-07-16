"""机构管理端(org_admin)- 加盟商老板的控制台(多租户 P3)

能力边界: 只管本机构 — 建/停老师账号、看机构概况与配额水位、领机构码、
自定义机构信息(名称/Logo/联系方式;机构码/配额/档位/状态是平台资产,只有平台能改)。
数据隔离由 tenancy 全局过滤器 + org_id 显式条件双保险。
"""
import os
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.api.v1.auth import require_role
from app.models.organization import Organization
from app.models.user import User
from app.services import auth_service
from app.services.org_service import count_active_students

router = APIRouter()

# 机构管理员(平台admin也可,方便代操作)
get_current_org_admin = require_role("org_admin", "admin")


async def _my_org(db: AsyncSession, current_user: User) -> Organization:
    org = (await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "机构不存在")
    return org


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
    org = await _my_org(db, current_user)
    active = await count_active_students(db, org.id)
    teacher_count = (await db.execute(
        select(func.count(User.id)).where(
            User.org_id == org.id, User.role == "teacher", User.is_active.is_(True))
    )).scalar() or 0
    return {
        "id": org.id, "name": org.name, "code": org.code, "plan": org.plan,
        "student_quota": org.student_quota, "active_students": active,
        "teacher_count": teacher_count, "logo_url": org.logo_url,
        "contact_name": org.contact_name, "contact_phone": org.contact_phone,
        "status": org.status, "expires_at": org.expires_at,
    }


class OrgInfoUpdate(BaseModel):
    """机构可自定义项。机构码/配额/档位/状态是平台资产,这里改不了"""
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    contact_name: Optional[str] = Field(None, max_length=50)
    contact_phone: Optional[str] = Field(None, max_length=20)


@router.patch("/info")
async def update_org_info(
    data: OrgInfoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """机构自定义名称/联系方式"""
    org = await _my_org(db, current_user)
    for field in ["name", "contact_name", "contact_phone"]:
        v = getattr(data, field)
        if v is not None:
            setattr(org, field, v.strip())
    await db.commit()
    return {"updated": True, "name": org.name}


@router.post("/logo")
async def upload_org_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """上传机构Logo(≤2MB, png/jpg/webp),覆盖旧图,URL带版本号防缓存"""
    ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
    ext = ext_map.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "仅支持 png/jpg/webp 图片")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "图片不能超过 2MB")

    org = await _my_org(db, current_user)
    logo_dir = os.path.join(settings.UPLOAD_DIR, "org-logos")
    os.makedirs(logo_dir, exist_ok=True)
    # 换扩展名时清掉旧文件,避免残留
    for old_ext in ext_map.values():
        old = os.path.join(logo_dir, f"org_{org.id}.{old_ext}")
        if old_ext != ext and os.path.exists(old):
            os.remove(old)
    with open(os.path.join(logo_dir, f"org_{org.id}.{ext}"), "wb") as f:
        f.write(content)

    org.logo_url = f"/api/v1/files/org-logos/org_{org.id}.{ext}?v={int(time.time())}"
    await db.commit()
    return {"logo_url": org.logo_url}


@router.get("/teachers")
async def list_teachers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_org_admin),
):
    """本机构老师列表"""
    rows = (await db.execute(
        select(User).where(
            User.org_id == current_user.org_id, User.role == "teacher")
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

    pwd = data.password or auth_service.generate_random_password()
    org_id = current_user.org_id
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
            User.org_id == current_user.org_id)
    )).scalar_one_or_none()
    if not teacher:
        raise HTTPException(404, "老师不存在或不属于本机构")
    teacher.is_active = not teacher.is_active
    await db.commit()
    return {"id": teacher.id, "is_active": teacher.is_active}
