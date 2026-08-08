"""当日任务(available_from)的可见性与可做性 —— 两件事必须分开。

2026-08-08 行为变更:未开放的任务从"列表里看不见"改成"看得见但做不了"。
学生要能提前知道明天要做什么,但不能提前做。所以:
  - /student/my-homework 返回它,带 is_locked=True
  - /homework/{id}/start 和 /submit 仍然拒
  - 单元解锁/书本归属那两处过滤保持"未开放不算"(本文件不覆盖,别跟着改)
"""
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit
from tests.conftest import _make_token


def _beijing_midnight_utc(day_offset: int) -> datetime:
    """第 N 天(相对今天)北京 0 点对应的 UTC naive —— 与教师端写入口径一致。"""
    beijing_now = datetime.utcnow() + timedelta(hours=8)
    beijing_day = (beijing_now + timedelta(days=day_offset)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return beijing_day - timedelta(hours=8)


@pytest.fixture
async def student_with_tasks(db_session):
    """一个学生 + 三份任务:今天开放的、明天才开放的、普通作业(无日期)。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="DAY01", status="active")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="day_t", email="day_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu = User(username="day_stu", email="day_stu@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()

    cls = Class(name="三年级1班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit_today = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    unit_tmr = Unit(book_id=book.id, unit_number=2, name="Unit 2")
    unit_plain = Unit(book_id=book.id, unit_number=3, name="Unit 3")
    db_session.add_all([unit_today, unit_tmr, unit_plain])
    await db_session.flush()

    def mk(title, unit, available_from):
        return HomeworkAssignment(
            title=title, unit_id=unit.id, teacher_id=teacher.id,
            learning_mode="classify", target_score=80, max_attempts=3,
            available_from=available_from, is_closed=False,
        )

    hw_today = mk("今天的任务", unit_today, _beijing_midnight_utc(0))
    hw_tmr = mk("明天的任务", unit_tmr, _beijing_midnight_utc(1))
    hw_plain = mk("普通作业", unit_plain, None)
    db_session.add_all([hw_today, hw_tmr, hw_plain])
    await db_session.flush()

    sas = {}
    for key, hw in (("today", hw_today), ("tmr", hw_tmr), ("plain", hw_plain)):
        sa = HomeworkStudentAssignment(
            homework_id=hw.id, student_id=stu.id, status="pending",
            attempts_count=0, best_score=0, total_time_spent=0,
        )
        db_session.add(sa)
        await db_session.flush()
        sas[key] = sa
    await db_session.commit()
    return stu, sas


@pytest.mark.asyncio
async def test_future_task_is_visible_but_locked(client: AsyncClient, student_with_tasks):
    """核心变更:明天的任务要出现在列表里,并且带 is_locked=True。"""
    stu, _ = student_with_tasks
    r = await client.get("/api/v1/student/my-homework",
                         headers={"Authorization": f"Bearer {_make_token(stu.id)}"})
    assert r.status_code == 200, r.text
    rows = {x["title"]: x for x in r.json()}

    # 三份都看得见(改之前"明天的任务"是查不到的)
    assert set(rows) == {"今天的任务", "明天的任务", "普通作业"}
    assert rows["明天的任务"]["is_locked"] is True
    assert rows["明天的任务"]["available_from"] is not None
    # 今天的和普通作业不能被误锁
    assert rows["今天的任务"]["is_locked"] is False
    assert rows["普通作业"]["is_locked"] is False
    assert rows["普通作业"]["available_from"] is None


@pytest.mark.asyncio
async def test_locked_task_cannot_start(client: AsyncClient, student_with_tasks):
    """可见 ≠ 可做:明天的任务点开始要被拒(400),前端靠这个兜底。"""
    stu, sas = student_with_tasks
    r = await client.post(f"/api/v1/student/homework/{sas['tmr'].id}/start",
                          headers={"Authorization": f"Bearer {_make_token(stu.id)}"})
    assert r.status_code == 400
    assert "还没开始" in r.json()["detail"]


@pytest.mark.asyncio
async def test_locked_task_cannot_submit(client: AsyncClient, student_with_tasks):
    """直接调交卷接口也要拒,不能绕过 start 提前把明天的任务做掉。"""
    stu, sas = student_with_tasks
    r = await client.post(
        f"/api/v1/student/homework/{sas['tmr'].id}/submit",
        json={"score": 100, "time_spent": 60, "correct_count": 10,
              "wrong_count": 0, "total_words": 10},
        headers={"Authorization": f"Bearer {_make_token(stu.id)}"},
    )
    assert r.status_code == 400
    assert "还没开始" in r.json()["detail"]


@pytest.mark.asyncio
async def test_todays_task_can_start(client: AsyncClient, student_with_tasks):
    """今天开放的当日任务照常能做 —— 别把正常路径一起锁了。"""
    stu, sas = student_with_tasks
    r = await client.post(f"/api/v1/student/homework/{sas['today'].id}/start",
                          headers={"Authorization": f"Bearer {_make_token(stu.id)}"})
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_locked_task_not_marked_overdue(client: AsyncClient, student_with_tasks, db_session):
    """未开放的任务不能被列表接口顺手判成 overdue(它的窗口还没到)。"""
    stu, sas = student_with_tasks
    await client.get("/api/v1/student/my-homework",
                     headers={"Authorization": f"Bearer {_make_token(stu.id)}"})
    await db_session.refresh(sas["tmr"])
    assert sas["tmr"].status == "pending"
