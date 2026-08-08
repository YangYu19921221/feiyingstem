"""金币口径:只发「当天」的任务币,今天补做昨天的任务不发。

为什么必须钉住:dedup_key 是按天的(task:{sid}:{YYYYMMDD}),拦不住跨天累加。
若允许按布置日发,学生把上周欠的 7 天任务一次补完 → 每个布置日各发一枚 →
一次领到 7 枚,直接击穿「一天封顶 2 枚」。
所以 try_award_task_coin 只认今天(唯一例外:刚跨午夜那一小时补昨天,
对应离线重试队列 23:59 交卷、0 点后才送达的情况)。
历史某天真全做完了,由当晚 00:35 的 settle_day 兜底,不走实时这条路。
"""
from datetime import date, datetime, timedelta

import pytest

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.coin import CoinTransaction, StudentCoin
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import WordBook, Unit
from app.services.coin_service import try_award_task_coin, settle_day


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    """北京日 d 的 hour 点 → UTC naive(assigned_at 存 UTC)。"""
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


@pytest.fixture
async def student_with_day_tasks(db_session):
    """一个自动发币机构的学生,昨天和今天各布置一份任务,两份都已完成。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="COIN1", status="active", coin_mode="auto")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="coin_t", email="coin_t@e.com", hashed_password="x",
                   role="teacher", full_name="李老师", is_active=True, org_id=org.id)
    stu = User(username="coin_stu", email="coin_stu@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()

    today = local_today()
    yesterday = today - timedelta(days=1)
    sas = {}
    for key, day in (("yesterday", yesterday), ("today", today)):
        unit = Unit(book_id=book.id, unit_number=1 if key == "yesterday" else 2, name=f"Unit {key}")
        db_session.add(unit)
        await db_session.flush()
        hw = HomeworkAssignment(
            title=f"{key} 的任务", unit_id=unit.id, teacher_id=teacher.id,
            learning_mode="classify", target_score=80, max_attempts=3, is_closed=False,
        )
        db_session.add(hw)
        await db_session.flush()
        # completed_at 必须设:发币判定「当天完成」要看它(真实交卷路径一定会写),
        # 这里当天布置当天做完 —— 迟做的场景另有专门用例
        sa = HomeworkStudentAssignment(
            homework_id=hw.id, student_id=stu.id, status="completed",
            attempts_count=1, best_score=100, total_time_spent=60,
            assigned_at=_utc_for_beijing_day(day),
            completed_at=_utc_for_beijing_day(day, hour=20),
        )
        db_session.add(sa)
        await db_session.flush()
        sas[key] = sa
    await db_session.commit()
    return stu, org, today, yesterday


async def _balance(db, user_id: int) -> int:
    from sqlalchemy import select
    row = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == user_id)
    )).scalar()
    return row or 0


@pytest.mark.asyncio
async def test_today_task_awards_coin(db_session, student_with_day_tasks):
    """今天布置、今天做完 → 发 1 币。"""
    stu, _, today, _ = student_with_day_tasks
    granted = await try_award_task_coin(db_session, stu.id, today)
    await db_session.commit()
    assert granted is True
    assert await _balance(db_session, stu.id) == 1


@pytest.mark.asyncio
async def test_yesterday_task_awards_nothing_in_realtime(db_session, student_with_day_tasks):
    """核心口径:今天补做昨天的任务,实时发币直接拒 —— 余额不动。"""
    stu, _, _, yesterday = student_with_day_tasks
    granted = await try_award_task_coin(db_session, stu.id, yesterday)
    await db_session.commit()
    assert granted is False
    assert await _balance(db_session, stu.id) == 0


@pytest.mark.asyncio
async def test_backfilling_a_week_cannot_break_daily_cap(db_session, student_with_day_tasks):
    """一次补完过去 7 天的任务,也只可能拿到今天那一枚,不会领到 7 枚。"""
    stu, _, today, _ = student_with_day_tasks
    for i in range(1, 8):
        await try_award_task_coin(db_session, stu.id, today - timedelta(days=i))
    await db_session.commit()
    assert await _balance(db_session, stu.id) == 0, "历史日期不该发币"

    await try_award_task_coin(db_session, stu.id, today)
    await db_session.commit()
    assert await _balance(db_session, stu.id) == 1, "只有今天那一枚"


@pytest.mark.asyncio
async def test_realtime_award_is_idempotent(db_session, student_with_day_tasks):
    """同一天重复发只发一次(dedup_key)。"""
    stu, _, today, _ = student_with_day_tasks
    assert await try_award_task_coin(db_session, stu.id, today) is True
    await db_session.commit()
    assert await try_award_task_coin(db_session, stu.id, today) is False
    await db_session.commit()
    assert await _balance(db_session, stu.id) == 1


@pytest.mark.asyncio
async def test_nightly_settle_backfills_yesterday(db_session, student_with_day_tasks):
    """兜底路径:昨天确实全做完了,当晚 00:35 的 settle_day 会补发那一枚。

    这条说明「实时不发」不等于「永远不发」——按布置日归属,只是不在今天实时发。
    """
    stu, _, _, yesterday = student_with_day_tasks
    result = await settle_day(db_session, yesterday)
    await db_session.commit()
    assert result["task"] == 1
    assert await _balance(db_session, stu.id) == 1


@pytest.mark.asyncio
async def test_settle_records_the_owning_day(db_session, student_with_day_tasks):
    """补发的流水 dedup_key/理由要落在**昨天**,不是今天 —— 对账靠这个。"""
    from sqlalchemy import select
    stu, _, _, yesterday = student_with_day_tasks
    await settle_day(db_session, yesterday)
    await db_session.commit()
    tx = (await db_session.execute(
        select(CoinTransaction).where(CoinTransaction.user_id == stu.id)
    )).scalars().all()
    assert len(tx) == 1
    assert yesterday.strftime("%Y%m%d") in tx[0].dedup_key
    assert yesterday.isoformat() in (tx[0].reason or "")


# ─────────────────────────────────────────────────────────────
# 「补算昨天」不能追认迟做的任务(2026-08-08 堵的缺口)
# ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_settle_does_not_award_task_completed_late(db_session, student_with_day_tasks):
    """昨天的任务今天才做完 → 点「🔄补算昨天」也不该发币。

    这是之前的缺口:settle_day 只看 status='completed' 不看完成时间,
    于是"今天补做 + 管理员点补算"能绕过实时那条「只发当天」的限制。
    要给迟做的学生补币走教师端手动加币(有 PIN、有流水、有操作人)。
    """
    stu, _, today, yesterday = student_with_day_tasks
    # 把昨天那份的完成时间改成今天(模拟今天才补做完)
    sa_yesterday = (await db_session.execute(
        _select_assignment_for(stu.id, yesterday)
    )).scalars().first()
    sa_yesterday.completed_at = _utc_for_beijing_day(today, hour=9)
    await db_session.commit()

    result = await settle_day(db_session, yesterday)
    await db_session.commit()
    assert result["task"] == 0, "迟做的任务被补算追认了"
    assert await _balance(db_session, stu.id) == 0


@pytest.mark.asyncio
async def test_settle_still_awards_submit_just_past_midnight(db_session, student_with_day_tasks):
    """23:59 交卷、离线队列 0 点后才落库的,属按时完成,补算要照发。

    这是「当天完成」判定放宽 45 分钟缓冲的理由 —— 不能因为时间戳跨了午夜
    就把孩子做完的成绩判成迟做(与交卷端点的 LATE_SUBMIT_GRACE 同源)。
    """
    stu, _, today, yesterday = student_with_day_tasks
    sa_yesterday = (await db_session.execute(
        _select_assignment_for(stu.id, yesterday)
    )).scalars().first()
    # 北京今天 00:20 落库 = 昨天 24 点后 20 分钟,在 45 分钟缓冲内
    sa_yesterday.completed_at = _utc_for_beijing_day(today, hour=0) + timedelta(minutes=20)
    await db_session.commit()

    result = await settle_day(db_session, yesterday)
    await db_session.commit()
    assert result["task"] == 1, "缓冲期内送达的成绩被误判成迟做"
    assert await _balance(db_session, stu.id) == 1


def _select_assignment_for(student_id: int, day: date):
    """取该生 assigned_at 落在 day 的那份作业分配。"""
    from sqlalchemy import select as _sel
    start = _utc_for_beijing_day(day, hour=0)
    return _sel(HomeworkStudentAssignment).where(
        HomeworkStudentAssignment.student_id == student_id,
        HomeworkStudentAssignment.assigned_at >= start,
        HomeworkStudentAssignment.assigned_at < start + timedelta(days=1),
    )
