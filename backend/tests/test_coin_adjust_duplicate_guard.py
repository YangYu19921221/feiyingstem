"""手动加币防双轨重复 —— 系统当天已自动发过,老师再手动加必须确认后果。

2026-08-16 实案:自动结算上线后老师沿用手动补发习惯,一个学生 8 天被
「系统自动 + 老师手动」发了两遍,多拿 ~11 枚还兑了奖。修法:
/coins/adjust 手动**加**币时若该生当天已有系统流水(task/unit/word_king),
先拒 409(code=SYSTEM_ALREADY_GRANTED,附已发明细),前端弹后果确认,
老师勾选知晓后带 force=true 重发才放行。扣减/兑换不拦。
"""
from datetime import date

import pytest

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.coin import StudentCoin
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.services import coin_service
from app.services.auth_service import get_password_hash
from sqlalchemy import select
from tests.conftest import _make_token

PIN = "1234"


@pytest.fixture
async def coin_teacher_student(db_session):
    """老师(已设加币 PIN)+ 本班学生,auto 发币机构。"""
    tenancy._org_cache.clear()
    org = Organization(name="防重复机构", code="DUPG01", status="active", coin_mode="auto")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="dupg_t", email="dupg_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id,
                   coin_pin_hash=get_password_hash(PIN))
    stu = User(username="dupg_s", email="dupg_s@e.com", hashed_password="x",
               role="student", full_name="学生丙", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()
    cls = Class(name="五年级2班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))
    await db_session.commit()
    return teacher, stu


async def _grant_system(db, stu: User, source: str, d: date):
    """模拟系统自动发放(带当天 dedup_key)。"""
    key = d.strftime("%Y%m%d")
    await coin_service.apply_delta(
        db, stu.id, stu.org_id, 1, source,
        reason=f"{d.isoformat()} 测试系统发放", dedup_key=f"{source}:{stu.id}:{key}",
    )
    await db.commit()


async def _balance(db, sid: int) -> int:
    coin = (await db.execute(
        select(StudentCoin).where(StudentCoin.user_id == sid)
    )).scalar_one_or_none()
    return coin.balance if coin else 0


def _adjust_body(stu: User, amount: int = 1, **extra):
    return {"student_id": stu.id, "amount": amount, "pin": PIN,
            "source": "manual", "reason": "测试手动", **extra}


@pytest.mark.asyncio
async def test_blocked_when_system_granted_today(client, db_session, coin_teacher_student):
    """系统今天已发 task+word_king → 手动加被 409,附两条已发明细,余额不动。"""
    teacher, stu = coin_teacher_student
    today = local_today()
    await _grant_system(db_session, stu, "task", today)
    await _grant_system(db_session, stu, "word_king", today)

    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "SYSTEM_ALREADY_GRANTED"
    assert {g["source"] for g in detail["granted"]} == {"task", "word_king"}
    assert await _balance(db_session, stu.id) == 2  # 只有系统那两枚


@pytest.mark.asyncio
async def test_force_passes_after_confirm(client, db_session, coin_teacher_student):
    """老师确认后果后带 force=true 重发 → 放行,余额 +1。"""
    teacher, stu = coin_teacher_student
    await _grant_system(db_session, stu, "task", local_today())

    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu, force=True),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert await _balance(db_session, stu.id) == 2


@pytest.mark.asyncio
async def test_deduct_and_redeem_not_blocked(client, db_session, coin_teacher_student):
    """扣减/兑换(负数)不拦 —— 拦的是重复**发放**,不是消费。"""
    teacher, stu = coin_teacher_student
    await _grant_system(db_session, stu, "task", local_today())

    resp = await client.post(
        "/api/v1/teacher/coins/adjust",
        json=_adjust_body(stu, amount=-1, source="redeem"),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 200
    assert await _balance(db_session, stu.id) == 0


@pytest.mark.asyncio
async def test_ok_when_no_system_coin_today(client, db_session, coin_teacher_student):
    """今天没有系统流水(昨天发过不算)→ 手动加不需要 force。"""
    from datetime import timedelta
    teacher, stu = coin_teacher_student
    await _grant_system(db_session, stu, "task", local_today() - timedelta(days=1))

    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 200
    assert await _balance(db_session, stu.id) == 2
