"""我的助教(2026-09-27)

起因:几位老师共用一个账号,布置错了查不到是谁 —— 操作记录里 IP 和设备全一样。
解法:主老师给每位助教开一个自己的账号。助教登录后**看数据/改数据按主老师的范围**
(认证层换身份,见 auth._resolve_assistant_owner),**操作记录记助教本人**(core/actor)。

规则:
- 只有主老师本人能管理助教;助教不能再建助教(没有多级)
- 每位主老师最多 MAX_ASSISTANTS 个(停用的也算,防止靠停用绕上限)
- 助教不占机构教师配额、不进教师统计(它不是一位新老师,是主老师的分身)
- 删除只删账号:作业表的布置人、操作日志里的操作人都存了姓名快照,删了照样追得到
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.actor import forbid_assistant
from app.api.v1.auth import get_current_teacher
from app.models.user import User
from app.services.auth_service import get_password_hash
from app.services import audit_log

router = APIRouter()

MAX_ASSISTANTS = 10


class AssistantCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=50)
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=6, max_length=50)


class AssistantUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=50)
    is_active: Optional[bool] = None


class AssistantPassword(BaseModel):
    password: str = Field(..., min_length=6, max_length=50)


def _owner_only(current_user: User) -> User:
    forbid_assistant(current_user, "管理助教")
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有老师账号可以添加助教")
    return current_user


def _out(a: User) -> dict:
    return {
        "id": a.id,
        "username": a.username,
        "full_name": a.full_name,
        "is_active": bool(a.is_active),
        "last_login": a.last_login.isoformat() + "Z" if a.last_login else None,
        "created_at": a.created_at.isoformat() + "Z" if a.created_at else None,
    }


async def _my_assistant(db: AsyncSession, owner: User, assistant_id: int) -> User:
    # 归属显式按 owner_teacher_id + org_id 判,不押在隐式租户过滤器上
    a = (await db.execute(
        select(User).where(User.id == assistant_id,
                           User.owner_teacher_id == owner.id,
                           User.org_id == owner.org_id)
    )).scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="助教不存在")
    return a


@router.get("/assistants")
async def list_assistants(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    owner = _owner_only(current_user)
    rows = (await db.execute(
        select(User).where(User.owner_teacher_id == owner.id, User.org_id == owner.org_id)
        .order_by(User.id)
    )).scalars().all()
    return {"items": [_out(a) for a in rows], "max": MAX_ASSISTANTS}


@router.post("/assistants")
async def create_assistant(
    body: AssistantCreate,
    http: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    owner = _owner_only(current_user)
    username = body.username.strip()
    full_name = body.full_name.strip()
    if len(username) < 2 or not full_name:
        raise HTTPException(status_code=400, detail="姓名和用户名都要填")
    count = (await db.execute(
        select(func.count(User.id)).where(User.owner_teacher_id == owner.id)
    )).scalar() or 0
    if count >= MAX_ASSISTANTS:
        raise HTTPException(status_code=400,
                            detail=f"每位老师最多 {MAX_ASSISTANTS} 个助教(停用的也算),可以删掉不用的再加")
    # 用户名全平台唯一:跨机构查重必须绕过租户过滤,否则撞上别家的名字只会在 commit 时 500
    taken = (await db.execute(
        select(User.id).where(User.username == username)
        .execution_options(skip_tenant_filter=True)
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="这个用户名已被占用,换一个")

    a = User(
        username=username,
        # email 是 NOT NULL UNIQUE,助教不需要邮箱:生成一个占位值
        email=f"assistant-{owner.id}-{uuid.uuid4().hex[:10]}@feiying.local",
        full_name=full_name,
        hashed_password=get_password_hash(body.password),
        role="teacher",
        is_active=True,
        org_id=owner.org_id,
        owner_teacher_id=owner.id,
    )
    db.add(a)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="这个用户名已被占用,换一个")
    audit_log.record(db, http, owner, "assistant.create",
                     f"添加助教「{full_name}」(用户名 {username})",
                     target_type="user", target_id=a.id)
    await db.commit()
    await db.refresh(a)
    return _out(a)


@router.patch("/assistants/{assistant_id}")
async def update_assistant(
    assistant_id: int,
    body: AssistantUpdate,
    http: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    owner = _owner_only(current_user)
    a = await _my_assistant(db, owner, assistant_id)
    changes = []
    if body.full_name is not None and body.full_name.strip() and body.full_name.strip() != a.full_name:
        changes.append(f"姓名 {a.full_name} → {body.full_name.strip()}")
        a.full_name = body.full_name.strip()
    if body.is_active is not None and bool(body.is_active) != bool(a.is_active):
        a.is_active = bool(body.is_active)
        changes.append("启用" if a.is_active else "停用")
    if not changes:
        return _out(a)
    audit_log.record(db, http, owner, "assistant.update",
                     f"助教「{a.full_name}」:{'、'.join(changes)}",
                     target_type="user", target_id=a.id)
    await db.commit()
    await db.refresh(a)
    return _out(a)


@router.post("/assistants/{assistant_id}/password")
async def reset_assistant_password(
    assistant_id: int,
    body: AssistantPassword,
    http: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    owner = _owner_only(current_user)
    a = await _my_assistant(db, owner, assistant_id)
    a.hashed_password = get_password_hash(body.password)
    # 改密码顺带踢掉旧登录:改密通常就是因为密码泄露了
    a.session_ver = (a.session_ver or 0) + 1
    audit_log.record(db, http, owner, "assistant.update",
                     f"重置助教「{a.full_name}」的密码",
                     target_type="user", target_id=a.id)
    await db.commit()
    return {"success": True}


@router.delete("/assistants/{assistant_id}")
async def delete_assistant(
    assistant_id: int,
    http: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    owner = _owner_only(current_user)
    a = await _my_assistant(db, owner, assistant_id)
    audit_log.record(db, http, owner, "assistant.delete",
                     f"删除助教「{a.full_name}」(用户名 {a.username})",
                     target_type="user", target_id=a.id,
                     detail={"username": a.username, "full_name": a.full_name})
    await db.delete(a)
    await db.commit()
    return {"deleted": True}
