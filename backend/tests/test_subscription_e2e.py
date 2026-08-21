"""
兑换卡端到端测试:管理端生成 → 学生兑换 → 查看剩余 → 学习扣减
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.word import WordBook, Unit
from app.models.learning import BookAssignment
from app.services import subscription_service


@pytest.mark.asyncio
async def test_times_card_full_flow(db_session: AsyncSession):
    """次卡完整流程:生成码 → 兑换 → 显示剩余 → 学习扣减 → 再次显示"""
    # 1. 管理员生成 7 天次卡
    admin = User(id=1, username='admin', role='admin', full_name='管理员')
    db_session.add(admin)
    student = User(id=2, username='stu', role='student', full_name='学生A')
    db_session.add(student)
    book = WordBook(id=1, name='测试书', is_public=True)
    db_session.add(book)
    await db_session.commit()

    codes = await subscription_service.batch_generate_codes(
        db_session, admin.id, count=1, book_id=book.id,
        grant_type='times', grant_times=7,
    )
    assert len(codes) == 1
    code_str = codes[0].code

    # 2. 学生兑换
    result = await subscription_service.redeem_code(db_session, student, code_str)
    assert result['success'] is True
    assert '7 天' in result['message']

    # 3. 查询学生的授权(模拟前端调用 /student/my-assignments)
    assignments = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == student.id)
    )).scalars().all()
    assert len(assignments) == 1
    a = assignments[0]
    assert a.grant_type == 'times'
    assert a.times_left == 7

    # 4. 第一次调用 describe_grant,应该显示剩余 7 天,未消费
    info = subscription_service.describe_grant(a)
    assert info['grant_type'] == 'times'
    assert info['times_left'] == 7
    assert info['used_today'] is False
    assert info['active'] is True

    # 5. 模拟学生今天第一次学习(调用 consume_times_if_needed)
    await subscription_service.consume_times_if_needed(db_session, student.id, book.id)
    await db_session.refresh(a)
    assert a.times_left == 6
    assert a.last_consumed_date is not None  # 今天的日期

    # 6. 再次查看状态,应该显示剩余 6 天,今天已消费
    info = subscription_service.describe_grant(a)
    assert info['times_left'] == 6
    assert info['used_today'] is True
    assert info['active'] is True  # 还有余量,仍然判活

    # 7. 同一天再次调用 consume (模拟刷新页面/切模式),不应该再扣
    await subscription_service.consume_times_if_needed(db_session, student.id, book.id)
    await db_session.refresh(a)
    assert a.times_left == 6  # 没变


@pytest.mark.asyncio
async def test_period_card_full_flow(db_session: AsyncSession):
    """包月卡完整流程:生成 30 天码 → 兑换 → 显示到期日 → 续期"""
    admin = User(id=3, username='admin2', role='admin', full_name='管理员2')
    db_session.add(admin)
    student = User(id=4, username='stu2', role='student', full_name='学生B')
    db_session.add(student)
    book = WordBook(id=2, name='测试书2', is_public=True)
    db_session.add(book)
    await db_session.commit()

    # 1. 生成 30 天包月卡
    codes = await subscription_service.batch_generate_codes(
        db_session, admin.id, count=1, book_id=book.id,
        grant_type='period', grant_days=30,
    )
    code1 = codes[0].code

    # 2. 兑换
    result = await subscription_service.redeem_code(db_session, student, code1)
    assert result['success'] is True

    a = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == student.id)
    )).scalar_one()
    assert a.grant_type == 'period'
    first_expiry = a.expires_at

    # 3. 查看状态:应该显示 days_left ≈ 30
    info = subscription_service.describe_grant(a)
    assert info['grant_type'] == 'period'
    assert 28 <= info['days_left'] <= 30  # 允许一点时间误差
    assert info['active'] is True

    # 4. 再兑换一张 30 天的(续期)
    codes2 = await subscription_service.batch_generate_codes(
        db_session, admin.id, count=1, book_id=book.id,
        grant_type='period', grant_days=30,
    )
    code2 = codes2[0].code
    result = await subscription_service.redeem_code(db_session, student, code2)
    assert result['success'] is True
    assert '续期成功' in result['message']

    await db_session.refresh(a)
    # 到期日应该从原来的往后接 30 天
    assert a.expires_at > first_expiry
    expected_gap = timedelta(days=29, hours=23)  # 允许一点误差
    assert (a.expires_at - first_expiry) >= expected_gap


@pytest.mark.asyncio
async def test_times_card_last_day_boundary(db_session: AsyncSession):
    """次卡最后一天边界:扣到 0 后当天仍判活"""
    admin = User(id=5, username='admin3', role='admin', full_name='管理员3')
    db_session.add(admin)
    student = User(id=6, username='stu3', role='student', full_name='学生C')
    db_session.add(student)
    book = WordBook(id=3, name='测试书3', is_public=True)
    db_session.add(book)
    await db_session.commit()

    # 生成只有 1 天的次卡
    codes = await subscription_service.batch_generate_codes(
        db_session, admin.id, count=1, book_id=book.id,
        grant_type='times', grant_times=1,
    )
    await subscription_service.redeem_code(db_session, student, codes[0].code)

    a = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == student.id)
    )).scalar_one()
    assert a.times_left == 1

    # 学习一次,扣到 0
    await subscription_service.consume_times_if_needed(db_session, student.id, book.id)
    await db_session.refresh(a)
    assert a.times_left == 0

    # 关键:当天再查,应该仍然判活(别让学生学一半被踢)
    info = subscription_service.describe_grant(a)
    assert info['active'] is True
    assert info['used_today'] is True

    # 模拟第二天(改 last_consumed_date 为昨天),此时应该判死
    from app.core.timeutil import local_today
    yesterday = (local_today() - timedelta(days=1)).isoformat()
    a.last_consumed_date = yesterday
    await db_session.commit()
    await db_session.refresh(a)

    info = subscription_service.describe_grant(a)
    assert info['active'] is False  # 无余量且不是今天,判死
