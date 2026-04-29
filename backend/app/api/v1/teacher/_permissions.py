"""教师端班级权限 helper - 教师只能操作自己班级里 active 的学生"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Class, ClassStudent


async def get_my_class_student_ids(db: AsyncSession, teacher_id: int) -> set[int]:
    """该教师所有班级里 is_active=True 的学生 id"""
    res = await db.execute(
        select(ClassStudent.student_id)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher_id, ClassStudent.is_active.is_(True))
    )
    return {row[0] for row in res.all()}


async def assert_student_in_my_class(
    db: AsyncSession, teacher_id: int, student_id: int
) -> None:
    """不在则 raise HTTPException(403)"""
    ids = await get_my_class_student_ids(db, teacher_id)
    if student_id not in ids:
        raise HTTPException(status_code=403, detail="无权操作该学生")
