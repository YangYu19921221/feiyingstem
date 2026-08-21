"""
测试兑换卡次卡/包月——判活、续期、消费幂等
"""
import pytest
from datetime import datetime, timedelta
from app.models.learning import BookAssignment
from app.services.subscription_service import (
    is_assignment_active,
    GRANT_PERMANENT, GRANT_PERIOD, GRANT_TIMES,
)


def test_permanent_card_always_active():
    """永久卡(含 NULL/老师直接分配)恒判活"""
    a = BookAssignment(grant_type=GRANT_PERMANENT)
    assert is_assignment_active(a)

    a = BookAssignment(grant_type=None)
    assert is_assignment_active(a)

    a = BookAssignment(grant_type="")
    assert is_assignment_active(a)


def test_period_card_expiry():
    """包月卡按到期日判活"""
    # 未过期
    a = BookAssignment(
        grant_type=GRANT_PERIOD,
        expires_at=datetime.utcnow() + timedelta(days=5)
    )
    assert is_assignment_active(a)

    # 已过期
    a = BookAssignment(
        grant_type=GRANT_PERIOD,
        expires_at=datetime.utcnow() - timedelta(days=1)
    )
    assert not is_assignment_active(a)


def test_times_card_with_balance():
    """次卡有余量时判活"""
    a = BookAssignment(
        grant_type=GRANT_TIMES,
        times_left=3,
        last_consumed_date="2026-08-20"
    )
    # 今天 08-21,昨天扣过,还剩 3 天
    assert is_assignment_active(a, today="2026-08-21")


def test_times_card_last_day_consumption():
    """次卡最后一天:扣到 0 后当天仍判活(别让学生学一半被踢)"""
    # 无余量但今天已消费 → 判活
    a = BookAssignment(
        grant_type=GRANT_TIMES,
        times_left=0,
        last_consumed_date="2026-08-21"
    )
    assert is_assignment_active(a, today="2026-08-21")

    # 无余量且不是今天 → 判死
    a = BookAssignment(
        grant_type=GRANT_TIMES,
        times_left=0,
        last_consumed_date="2026-08-20"
    )
    assert not is_assignment_active(a, today="2026-08-21")


def test_times_card_never_consumed():
    """次卡领了没学(last_consumed_date 为 NULL),有余量时仍判活"""
    a = BookAssignment(
        grant_type=GRANT_TIMES,
        times_left=7,
        last_consumed_date=None
    )
    assert is_assignment_active(a, today="2026-08-21")

    # 领了没学且已用尽(理论上不可能,但口径要自洽)
    a = BookAssignment(
        grant_type=GRANT_TIMES,
        times_left=0,
        last_consumed_date=None
    )
    assert not is_assignment_active(a, today="2026-08-21")
