"""作业分组多选 —— 单单元下勾选多个组时,每组各建一份独立作业。

2026-08-14 新增:此前范围选择器里组只能单选,老师想"第2组+第3组各一份"
得建两次作业。现在 group_indexes 多选与 unit_ids 多选同构:
  - 每组一份作业,标题自动带「· 第N组」,各自追踪完成情况
  - 配合 available_date + daily_sequence 时逐组顺延一天(一次排一周)
  - 多单元时分组仍被忽略(UI 也不允许该组合)
  - 旧的单个 group_index 行为不变
"""
from datetime import timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import HomeworkAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, UnitWord, Word
from tests.conftest import _make_token


@pytest.fixture
async def teacher_with_grouped_unit(db_session):
    """老师 + 学生 + 一个 6 词、每组 2 词(共 3 组)的单元。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="HWG01", status="active")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="hwg_t", email="hwg_t@e.com", hashed_password="x",
                   role="teacher", full_name="李老师", is_active=True, org_id=org.id)
    stu = User(username="hwg_stu", email="hwg_stu@e.com", hashed_password="x",
               role="student", full_name="学生乙", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()

    cls = Class(name="四年级1班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))

    book = WordBook(name="人教版四上", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1", group_size=2)
    db_session.add(unit)
    await db_session.flush()

    for i in range(6):
        w = Word(word=f"hwgword{i}")
        db_session.add(w)
        await db_session.flush()
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
    await db_session.commit()
    return teacher, stu, unit


def _payload(unit_id, student_id, **extra):
    return {
        "title": "分组练习",
        "unit_id": unit_id,
        "learning_mode": "classify",
        "student_ids": [student_id],
        "target_score": 80,
        "max_attempts": 3,
        **extra,
    }


@pytest.mark.asyncio
async def test_multi_group_creates_one_homework_per_group(
    client: AsyncClient, teacher_with_grouped_unit, db_session
):
    """勾选 2、3 两组 → 建 2 份作业,group_index 各归各,标题带组号。"""
    teacher, stu, unit = teacher_with_grouped_unit
    r = await client.post(
        "/api/v1/teacher/homework",
        json=_payload(unit.id, stu.id, group_indexes=[2, 3]),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["homework_ids"]) == 2
    assert data["total"] == 2  # 1 个学生 × 2 组

    rows = [await db_session.get(HomeworkAssignment, hid) for hid in data["homework_ids"]]
    assert [hw.group_index for hw in rows] == [2, 3]
    assert [hw.title for hw in rows] == ["分组练习 · 第2组", "分组练习 · 第3组"]


@pytest.mark.asyncio
async def test_multi_group_daily_sequence_staggers_by_day(
    client: AsyncClient, teacher_with_grouped_unit, db_session
):
    """多组 + 开始日期 + 按天顺延:第 1 组今天开放,后面每组顺延一天。"""
    teacher, stu, unit = teacher_with_grouped_unit
    r = await client.post(
        "/api/v1/teacher/homework",
        json=_payload(
            unit.id, stu.id,
            group_indexes=[1, 2, 3],
            available_date=local_today().strftime("%Y-%m-%d"),
            daily_sequence=True,
        ),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert r.status_code == 200, r.text
    hids = r.json()["homework_ids"]
    assert len(hids) == 3
    rows = [await db_session.get(HomeworkAssignment, hid) for hid in hids]
    opens = [hw.available_from for hw in rows]
    assert all(t is not None for t in opens)
    assert opens[1] - opens[0] == timedelta(days=1)
    assert opens[2] - opens[1] == timedelta(days=1)


@pytest.mark.asyncio
async def test_multi_group_out_of_range_rejected(
    client: AsyncClient, teacher_with_grouped_unit
):
    """越界组号(单元只有 3 组)整单拒绝,一份都不建。"""
    teacher, stu, unit = teacher_with_grouped_unit
    r = await client.post(
        "/api/v1/teacher/homework",
        json=_payload(unit.id, stu.id, group_indexes=[2, 9]),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert r.status_code == 422
    assert "超出范围" in r.json()["detail"]


@pytest.mark.asyncio
async def test_single_group_index_still_works(
    client: AsyncClient, teacher_with_grouped_unit, db_session
):
    """旧口径不回归:单个 group_index 建 1 份作业,标题不加组号后缀。"""
    teacher, stu, unit = teacher_with_grouped_unit
    r = await client.post(
        "/api/v1/teacher/homework",
        json=_payload(unit.id, stu.id, group_index=2),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["homework_ids"]) == 1
    hw = await db_session.get(HomeworkAssignment, data["homework_id"])
    assert hw.group_index == 2
    assert hw.title == "分组练习"
