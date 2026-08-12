"""coin_hint 原因码:交卷达标却没拿到任务币时,给前端一句「为什么」。

钉住四个原因码的判定顺序与口径(与发币逻辑同源):
- late_makeup: 补做往日任务 → 无论如何先说明"金币只发当天"
- manual:      机构手动加币模式
- already:     今天的任务币已发过(追加任务不再多发)
- pending:     今天还有任务没完成(差几份要报对)
以及教师端批量状态 task_coin_day_status 的口径(done 只数当天完成)。
"""
from datetime import date, datetime, timedelta

import pytest

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import WordBook, Unit
from app.services.coin_service import (
    task_coin_hint, task_coin_day_status, try_award_task_coin,
)


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


async def _mk_org_student(db, coin_mode: str):
    tenancy._org_cache.clear()
    org = Organization(name="hint测试机构", code=f"HINT_{coin_mode}",
                       status="active", coin_mode=coin_mode)
    db.add(org)
    await db.flush()
    teacher = User(username=f"hint_t_{coin_mode}", email=f"ht_{coin_mode}@e.com",
                   hashed_password="x", role="teacher", full_name="老师", is_active=True,
                   org_id=org.id)
    stu = User(username=f"hint_s_{coin_mode}", email=f"hs_{coin_mode}@e.com",
               hashed_password="x", role="student", full_name="学生", is_active=True,
               org_id=org.id)
    db.add_all([teacher, stu])
    await db.flush()
    book = WordBook(name="hint测试书", is_public=True)
    db.add(book)
    await db.flush()
    return org, teacher, stu, book


async def _mk_task(db, teacher, stu, book, day: date, unit_no: int, done: bool):
    unit = Unit(book_id=book.id, unit_number=unit_no, name=f"U{unit_no}")
    db.add(unit)
    await db.flush()
    hw = HomeworkAssignment(
        title=f"任务U{unit_no}", unit_id=unit.id, teacher_id=teacher.id,
        learning_mode="classify", target_score=80, max_attempts=3, is_closed=False,
    )
    db.add(hw)
    await db.flush()
    sa = HomeworkStudentAssignment(
        homework_id=hw.id, student_id=stu.id,
        status="completed" if done else "pending",
        attempts_count=1 if done else 0, best_score=100 if done else 0,
        total_time_spent=0,
        assigned_at=_utc_for_beijing_day(day),
        completed_at=_utc_for_beijing_day(day, hour=20) if done else None,
    )
    db.add(sa)
    await db.flush()
    return sa


@pytest.mark.asyncio
async def test_hint_late_makeup(db_session):
    """补做昨天的任务 → late_makeup,且优先于其他判定。"""
    org, teacher, stu, book = await _mk_org_student(db_session, "auto")
    yesterday = local_today() - timedelta(days=1)
    await _mk_task(db_session, teacher, stu, book, yesterday, 1, done=True)
    await db_session.commit()

    hint = await task_coin_hint(db_session, stu.id, yesterday)
    assert hint is not None and hint["code"] == "late_makeup"
    assert "当天" in hint["message"]


@pytest.mark.asyncio
async def test_hint_pending_counts_remaining(db_session):
    """今天 3 份任务完成 1 份 → pending,差 2 份要报对。"""
    org, teacher, stu, book = await _mk_org_student(db_session, "auto")
    today = local_today()
    await _mk_task(db_session, teacher, stu, book, today, 1, done=True)
    await _mk_task(db_session, teacher, stu, book, today, 2, done=False)
    await _mk_task(db_session, teacher, stu, book, today, 3, done=False)
    await db_session.commit()

    hint = await task_coin_hint(db_session, stu.id, today)
    assert hint is not None and hint["code"] == "pending"
    assert "2 份" in hint["message"]


@pytest.mark.asyncio
async def test_hint_already_awarded(db_session):
    """今天的任务币已发过 → already(老师追加任务、学生又做完一份时的场景)。"""
    org, teacher, stu, book = await _mk_org_student(db_session, "auto")
    today = local_today()
    await _mk_task(db_session, teacher, stu, book, today, 1, done=True)
    await db_session.commit()
    assert await try_award_task_coin(db_session, stu.id, today) is True
    await db_session.commit()

    hint = await task_coin_hint(db_session, stu.id, today)
    assert hint is not None and hint["code"] == "already"


@pytest.mark.asyncio
async def test_hint_manual_org(db_session):
    """手动加币机构 → manual(不误导学生等系统发)。"""
    org, teacher, stu, book = await _mk_org_student(db_session, "manual")
    today = local_today()
    await _mk_task(db_session, teacher, stu, book, today, 1, done=True)
    await db_session.commit()

    hint = await task_coin_hint(db_session, stu.id, today)
    assert hint is not None and hint["code"] == "manual"


@pytest.mark.asyncio
async def test_day_status_late_makeup_not_counted_as_done(db_session):
    """教师端批量状态:昨天的任务今天补做 → done 不计,coined False。

    这是老师看「昨日 0/1 未发币」就明白原因、不用再来问的关键口径。
    """
    org, teacher, stu, book = await _mk_org_student(db_session, "auto")
    today = local_today()
    yesterday = today - timedelta(days=1)
    sa = await _mk_task(db_session, teacher, stu, book, yesterday, 1, done=True)
    sa.completed_at = _utc_for_beijing_day(today, hour=9)  # 今天才补做完
    await db_session.commit()

    status = (await task_coin_day_status(db_session, [stu.id], yesterday))[stu.id]
    assert status == {"total": 1, "done": 0, "coined": False}


@pytest.mark.asyncio
async def test_day_status_awarded(db_session):
    """当天做完且已发币 → done 满、coined True。"""
    org, teacher, stu, book = await _mk_org_student(db_session, "auto")
    today = local_today()
    await _mk_task(db_session, teacher, stu, book, today, 1, done=True)
    await db_session.commit()
    assert await try_award_task_coin(db_session, stu.id, today) is True
    await db_session.commit()

    status = (await task_coin_day_status(db_session, [stu.id], today))[stu.id]
    assert status == {"total": 1, "done": 1, "coined": True}
