"""学生端 - 班级（加入 / 查看）"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.api.v1.auth import get_current_student
from app.api.v1.teacher._permissions import place_students_in_class
from app.models.user import User, Class, ClassStudent, ClassInviteCode

router = APIRouter()


class JoinByCodeRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


class JoinResult(BaseModel):
    class_id: int
    class_name: str
    teacher_name: str | None
    transferred_from: str | None


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

    cur_res = await db.execute(
        select(Class.name)
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .where(
            ClassStudent.student_id == current_user.id,
            ClassStudent.is_active.is_(True),
            ClassStudent.class_id != cls.id,
        )
    )
    transferred_from_name = None
    for (name,) in cur_res.all():
        transferred_from_name = name

    place = await place_students_in_class(
        db, [current_user.id], cls.id, cls.teacher_id, on_other_teacher="steal",
    )

    invite.redemption_count = (invite.redemption_count or 0) + 1
    await db.commit()

    return JoinResult(
        class_id=cls.id,
        class_name=cls.name,
        teacher_name=(teacher.full_name or teacher.username) if teacher else None,
        transferred_from=transferred_from_name if place.added or place.transferred else None,
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
