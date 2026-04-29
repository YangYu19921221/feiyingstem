"""班级权限 helper 测试"""
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.api.v1.teacher._permissions import (
    get_my_class_student_ids,
    assert_student_in_my_class,
)
from app.models.user import Class, ClassStudent
from fastapi import HTTPException


async def find_teacher_with_students():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Class.teacher_id, ClassStudent.student_id)
            .join(ClassStudent, ClassStudent.class_id == Class.id)
            .where(ClassStudent.is_active.is_(True))
            .limit(1)
        )
        row = res.first()
        if row:
            return row[0], row[1]
        return None, None


async def test_get_my_class_student_ids_returns_set():
    teacher_id, student_id = await find_teacher_with_students()
    if not teacher_id:
        print("SKIP: 无测试数据（教师/班级/学生）")
        return
    async with AsyncSessionLocal() as db:
        ids = await get_my_class_student_ids(db, teacher_id)
        assert isinstance(ids, set)
        assert student_id in ids
        print(f"OK: 教师 {teacher_id} 班级有 {len(ids)} 个学生")


async def test_assert_student_in_my_class_pass():
    teacher_id, student_id = await find_teacher_with_students()
    if not teacher_id:
        print("SKIP")
        return
    async with AsyncSessionLocal() as db:
        await assert_student_in_my_class(db, teacher_id, student_id)
        print("OK: 同班学生通过")


async def test_assert_student_in_my_class_403():
    teacher_id, _ = await find_teacher_with_students()
    if teacher_id is None:
        # No data - use a fake teacher_id and any student_id; should still 403
        async with AsyncSessionLocal() as db:
            try:
                await assert_student_in_my_class(db, 1, 99999999)
                assert False
            except HTTPException as e:
                assert e.status_code == 403
                print("OK: 非本班学生 403 (无数据场景)")
        return
    async with AsyncSessionLocal() as db:
        try:
            await assert_student_in_my_class(db, teacher_id, 99999999)
            assert False
        except HTTPException as e:
            assert e.status_code == 403
            print("OK: 非本班学生 403")


async def main():
    await test_get_my_class_student_ids_returns_set()
    await test_assert_student_in_my_class_pass()
    await test_assert_student_in_my_class_403()
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
