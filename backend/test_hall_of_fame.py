"""光荣榜聚合 helper 测试（按 backend/test_*.py 现有风格）"""
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User, Class, ClassStudent
from app.services.hall_of_fame_service import build_hall_of_fame


async def find_student_with_class():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ClassStudent.student_id, ClassStudent.class_id)
            .where(ClassStudent.is_active.is_(True))
            .limit(1)
        )
        row = res.first()
        return (row[0], row[1]) if row else (None, None)


async def find_student_without_class():
    async with AsyncSessionLocal() as db:
        # 一个 role=student 但不在 class_students 表里的
        res = await db.execute(
            select(User.id)
            .where(User.role == "student")
            .where(~User.id.in_(select(ClassStudent.student_id).where(ClassStudent.is_active.is_(True))))
            .limit(1)
        )
        row = res.first()
        return row[0] if row else None


async def test_with_class():
    student_id, class_id = await find_student_with_class()
    if not student_id:
        print("SKIP test_with_class: 无班级学生")
        return
    async with AsyncSessionLocal() as db:
        result = await build_hall_of_fame(db, student_id)
        assert result["class_id"] == class_id, f"班级 ID 不匹配：{result['class_id']} != {class_id}"
        assert "champions" in result
        assert set(result["champions"].keys()) == {"perfect_king", "speed_king", "progress_star"}
        print(f"OK test_with_class: 班级 {result['class_name']} period={result['period']}")
        print(f"  champions: {result['champions']}")


async def test_without_class():
    student_id = await find_student_without_class()
    if not student_id:
        print("SKIP test_without_class: 所有学生都有班级")
        return
    async with AsyncSessionLocal() as db:
        result = await build_hall_of_fame(db, student_id)
        assert result["class_id"] is None
        assert result["class_name"] is None
        assert all(v is None for v in result["champions"].values())
        print(f"OK test_without_class: 学生 {student_id} 无班级")


async def main():
    await test_with_class()
    await test_without_class()


if __name__ == "__main__":
    asyncio.run(main())
