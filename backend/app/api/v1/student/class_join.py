"""学生端 - 班级（加入 / 查看）"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.v1.auth import get_current_student
from app.models.user import User, Class, ClassStudent, ClassInviteCode

router = APIRouter()


class JoinByCodeRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class JoinResult(BaseModel):
    class_id: int
    class_name: str
    teacher_name: str | None
    transferred_from: str | None  # 若是从其它班转过来，提示来源班名


@router.post("/class/join-by-code", response_model=JoinResult)
async def join_class_by_code(
    body: JoinByCodeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """学生输入邀请码加入班级 — 若已在其它班则会自动从原班转出"""
    code = body.code.strip()
    res = await db.execute(
        select(ClassInviteCode).where(ClassInviteCode.code == code)
    )
    invite = res.scalar_one_or_none()
    if not invite:
        raise HTTPException(400, "邀请码无效")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(400, "邀请码已过期，请联系老师重新生成")

    cls_res = await db.execute(select(Class).where(Class.id == invite.class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(400, "邀请码对应的班级已不存在")

    teacher_res = await db.execute(select(User).where(User.id == cls.teacher_id))
    teacher = teacher_res.scalar_one_or_none()

    # 是否已在本班 active？
    in_this_res = await db.execute(
        select(ClassStudent).where(
            ClassStudent.class_id == cls.id,
            ClassStudent.student_id == current_user.id,
            ClassStudent.is_active.is_(True),
        )
    )
    if in_this_res.scalar_one_or_none():
        invite.redemption_count = (invite.redemption_count or 0) + 1  # 算一次"重复点击"
        await db.commit()
        return JoinResult(
            class_id=cls.id, class_name=cls.name,
            teacher_name=teacher.full_name or teacher.username if teacher else None,
            transferred_from=None,
        )

    # 当前其它 active 班 → 关闭
    cur_res = await db.execute(
        select(ClassStudent, Class)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            ClassStudent.student_id == current_user.id,
            ClassStudent.is_active.is_(True),
        )
    )
    transferred_from_name = None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for link, old_cls in cur_res.all():
        link.is_active = False
        link.left_at = now
        transferred_from_name = old_cls.name

    # 复活同班 inactive 历史 / 否则新增
    revive_res = await db.execute(
        select(ClassStudent).where(
            ClassStudent.class_id == cls.id,
            ClassStudent.student_id == current_user.id,
            ClassStudent.is_active.is_(False),
        )
    )
    inactive = revive_res.scalar_one_or_none()
    if inactive:
        inactive.is_active = True
        inactive.left_at = None
    else:
        db.add(ClassStudent(class_id=cls.id, student_id=current_user.id, is_active=True))

    invite.redemption_count = (invite.redemption_count or 0) + 1
    await db.commit()

    return JoinResult(
        class_id=cls.id,
        class_name=cls.name,
        teacher_name=(teacher.full_name or teacher.username) if teacher else None,
        transferred_from=transferred_from_name,
    )


@router.get("/class/my")
async def my_classes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """学生查看自己当前所在班级 + 班主任"""
    res = await db.execute(
        select(Class, User)
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .join(User, User.id == Class.teacher_id)
        .where(
            ClassStudent.student_id == current_user.id,
            ClassStudent.is_active.is_(True),
        )
    )
    out = []
    for cls, teacher in res.all():
        out.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "teacher_id": teacher.id,
            "teacher_name": teacher.full_name or teacher.username,
        })
    return {"classes": out}
