"""学生端 - 班级（加入 / 查看）"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.tenancy import current_org_id
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

    # 多租户: 班级/老师可能在其他机构(未认领学生扫码入班的归属判定),显式跳过租户过滤读取
    cls_res = await db.execute(
        select(Class).where(Class.id == invite.class_id)
        .execution_options(skip_tenant_filter=True)
    )
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(400, "邀请码对应的班级已不存在")

    # 多租户归属规则: 班级和学生不同机构时——
    # 未被认领的直营散户(org=1 且无任何活跃班级)随班转入该机构;已属其他机构则拒绝
    student_org = current_user.org_id
    class_org = cls.org_id
    if class_org != student_org:
        has_any_class = (await db.execute(
            select(ClassStudent.id).where(
                ClassStudent.student_id == current_user.id,
                ClassStudent.is_active.is_(True),
            ).limit(1)
        )).first()
        if student_org == 1 and not has_any_class:
            current_user.org_id = class_org  # 认领: 随班归属机构
            # 同步请求级租户上下文,否则本请求后续查询仍按旧机构过滤,
            # place_students_in_class 里的 User/Class 查询会看不到刚认领的数据
            current_org_id.set(class_org)
        else:
            raise HTTPException(403, "该邀请码属于其他机构，请联系你的老师处理")

    teacher_res = await db.execute(
        select(User).where(User.id == cls.teacher_id)
        .execution_options(skip_tenant_filter=True)
    )
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
