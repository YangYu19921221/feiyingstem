"""金币口径:老师布置作业时标「家里(location_type='home')」的任务不发金币。

用户诉求(2026-09-30):「在电教室背才有币,在家里背没有」。不做运行时定位
(IP/GPS 都能伪造),改由老师布置时标 home / classroom。金币闸门只收在两处
分母查询(coin_service 的 task_progress_on_day 与 settle_day 内联那份),
把 'home' 排除在外。作业可见/解锁单元/完成追踪全走 scope_service,一律不动 ——
家里任务照常显示、照常要做,只是不进金币计算。

这里钉住的核心不变量:
1. 只有家里作业的一天 → 实时发币拒、夜间结算也不发(两条路径都要有闸门)。
2. 电教室作业照旧发币(不能误伤存量/普通作业)。
3. 电教室 + 家里混布:做完电教室那些就发币,家里那份既不进分母、也不挡币。
4. 家里作业不算完成也不影响电教室币(它压根不在分母里)。

回归锁:去掉任一条 `location_type != "home"` 过滤,mixed 用例里家里作业会
重新进入分母 —— 只做完电教室那份时 total!=done → 该发的币发不出(test 3 失败);
只有家里作业时 total>0 → 会误发(test 1 失败)。
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.coin import StudentCoin
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import WordBook, Unit
from app.services.coin_service import (
    try_award_task_coin, settle_day, task_progress_on_day,
)


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    """北京日 d 的 hour 点 → UTC naive(assigned_at/completed_at 存 UTC)。"""
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


async def _balance(db, user_id: int) -> int:
    row = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == user_id)
    )).scalar()
    return row or 0


@pytest.fixture
async def env(db_session):
    """一个自动发币机构 + 一个学生 + 一本书。返回 (db, org, teacher, stu, book)。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="LOC1", status="active", coin_mode="auto")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="loc_t", email="loc_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu = User(username="loc_stu", email="loc_stu@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()
    return db_session, org, teacher, stu, book


async def _make_task(db, teacher, stu, book, *, unit_no: int, day: date,
                     location_type: str, completed: bool):
    """给 stu 布置一份任务并按 completed 决定是否做完。返回 (hw, sa)。"""
    unit = Unit(book_id=book.id, unit_number=unit_no, name=f"Unit {unit_no}")
    db.add(unit)
    await db.flush()
    hw = HomeworkAssignment(
        title=f"任务 {unit_no}", unit_id=unit.id, teacher_id=teacher.id,
        learning_mode="classify", target_score=80, max_attempts=3,
        is_closed=False, location_type=location_type,
    )
    db.add(hw)
    await db.flush()
    sa = HomeworkStudentAssignment(
        homework_id=hw.id, student_id=stu.id,
        status="completed" if completed else "pending",
        attempts_count=1 if completed else 0,
        best_score=100 if completed else 0, total_time_spent=60 if completed else 0,
        assigned_at=_utc_for_beijing_day(day),
        completed_at=_utc_for_beijing_day(day, hour=20) if completed else None,
    )
    db.add(sa)
    await db.flush()
    return hw, sa


# ─────────────────────────────────────────────────────────────
# 1. 只有家里作业:实时 + 结算都不发币
# ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_home_only_realtime_awards_nothing(env):
    """当天只布置了家里作业、做完了 —— 实时发币拒,余额不动。"""
    db, org, teacher, stu, book = env
    today = local_today()
    await _make_task(db, teacher, stu, book, unit_no=1, day=today,
                     location_type="home", completed=True)
    await db.commit()

    granted = await try_award_task_coin(db, stu.id, today)
    await db.commit()
    assert granted is False
    assert await _balance(db, stu.id) == 0


@pytest.mark.asyncio
async def test_home_only_nightly_settle_awards_nothing(env):
    """昨天只布置了家里作业、做完了 —— 夜间结算/补算昨天也不发。

    settle_day 有独立的内联任务币循环,不走 try_award_task_coin,必须单独钉住。
    """
    db, org, teacher, stu, book = env
    yesterday = local_today() - timedelta(days=1)
    await _make_task(db, teacher, stu, book, unit_no=1, day=yesterday,
                     location_type="home", completed=True)
    await db.commit()

    result = await settle_day(db, yesterday)
    await db.commit()
    assert result["task"] == 0
    assert await _balance(db, stu.id) == 0


@pytest.mark.asyncio
async def test_home_task_not_in_denominator(env):
    """家里作业不进金币分母:只有家里作业时 task_progress_on_day 返回空/0。"""
    db, org, teacher, stu, book = env
    today = local_today()
    await _make_task(db, teacher, stu, book, unit_no=1, day=today,
                     location_type="home", completed=True)
    await db.commit()

    total, done = (await task_progress_on_day(db, [stu.id], today)).get(stu.id, (0, 0))
    assert total == 0, "家里作业不该出现在金币分母里"
    assert done == 0


# ─────────────────────────────────────────────────────────────
# 2. 电教室作业照旧发币(不误伤)
# ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_classroom_task_still_awards(env):
    """电教室作业当天做完 → 照发 1 币(规则不变)。"""
    db, org, teacher, stu, book = env
    today = local_today()
    await _make_task(db, teacher, stu, book, unit_no=1, day=today,
                     location_type="classroom", completed=True)
    await db.commit()

    granted = await try_award_task_coin(db, stu.id, today)
    await db.commit()
    assert granted is True
    assert await _balance(db, stu.id) == 1


# ─────────────────────────────────────────────────────────────
# 3. 电教室 + 家里混布:只按电教室那些算
# ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mixed_done_classroom_awards_ignoring_home(env):
    """当天 1 份电教室 + 1 份家里。做完电教室那份(家里没做)→ 照发币。

    家里那份既不进分母也不挡币 —— 分母只数电教室的 1 份,做完即 total==done。
    """
    db, org, teacher, stu, book = env
    today = local_today()
    await _make_task(db, teacher, stu, book, unit_no=1, day=today,
                     location_type="classroom", completed=True)
    await _make_task(db, teacher, stu, book, unit_no=2, day=today,
                     location_type="home", completed=False)
    await db.commit()

    total, done = (await task_progress_on_day(db, [stu.id], today)).get(stu.id, (0, 0))
    assert (total, done) == (1, 1), "分母应只含电教室那 1 份且已完成"

    granted = await try_award_task_coin(db, stu.id, today)
    await db.commit()
    assert granted is True
    assert await _balance(db, stu.id) == 1


@pytest.mark.asyncio
async def test_mixed_classroom_pending_blocks_coin(env):
    """当天 1 份电教室(没做) + 1 份家里(做了)→ 不发币。

    金币要电教室那份做完;家里那份做没做完都不影响判定。
    """
    db, org, teacher, stu, book = env
    today = local_today()
    await _make_task(db, teacher, stu, book, unit_no=1, day=today,
                     location_type="classroom", completed=False)
    await _make_task(db, teacher, stu, book, unit_no=2, day=today,
                     location_type="home", completed=True)
    await db.commit()

    total, done = (await task_progress_on_day(db, [stu.id], today)).get(stu.id, (0, 0))
    assert (total, done) == (1, 0), "分母只含未完成的电教室那份"

    granted = await try_award_task_coin(db, stu.id, today)
    await db.commit()
    assert granted is False
    assert await _balance(db, stu.id) == 0
