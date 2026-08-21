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


def _utc_now_for_today():
    """落在"北京今天"内的 UTC naive 时间戳(与 DB 存储口径一致)。

    不能直接用 utcnow():北京 0~8 点时 utcnow 还在昨天,记录会落到昨天的窗口里。
    """
    from app.core.timeutil import local_day_utc_range
    start, end = local_day_utc_range(local_today())
    return start + (end - start) / 2


async def _assign_completed_task(db, teacher: User, students: list[User]):
    """给一批学生布置今天的任务并标记已完成 —— 单词王参评的前提条件之一
    (2026-08-20 起没做完当天作业不参评,见 test_word_king_eligibility.py)。"""
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    from app.models.word import WordBook, Unit

    book = WordBook(name="测试书", is_public=True)
    db.add(book)
    await db.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db.add(unit)
    await db.flush()
    hw = HomeworkAssignment(
        title="今日任务", unit_id=unit.id, teacher_id=teacher.id,
        learning_mode="spelling", target_score=80, max_attempts=3, is_closed=False,
    )
    db.add(hw)
    await db.flush()
    ts = _utc_now_for_today()
    for s in students:
        db.add(HomeworkStudentAssignment(
            homework_id=hw.id, student_id=s.id, status="completed",
            attempts_count=1, best_score=100, total_time_spent=60,
            assigned_at=ts, completed_at=ts,
        ))
    await db.flush()


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
async def test_redeem_source_with_positive_amount_still_blocked(
    client, db_session, coin_teacher_student
):
    """source='redeem' 配**正数**同样是发币,不能绕过门。

    判据必须按 amount>0,不能按 src=='manual' —— 前端不会这么发,但 API 收得下,
    按 src 判就留了个后门:POST {amount:+5, source:'redeem'} 直接白发 5 枚。
    """
    teacher, stu = coin_teacher_student
    await _grant_system(db_session, stu, "task", local_today())

    resp = await client.post(
        "/api/v1/teacher/coins/adjust",
        json=_adjust_body(stu, amount=5, source="redeem"),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 409, "redeem+正数绕过了防重复门"
    assert await _balance(db_session, stu.id) == 1


@pytest.mark.asyncio
async def test_force_marks_reason_for_audit(client, db_session, coin_teacher_student):
    """force 放行的那笔必须在账面留标记,否则事后无法用 SQL 筛出来对账。"""
    from app.models.coin import CoinTransaction
    teacher, stu = coin_teacher_student
    await _grant_system(db_session, stu, "task", local_today())

    resp = await client.post(
        "/api/v1/teacher/coins/adjust",
        json=_adjust_body(stu, force=True, reason="上课表现好"),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 200
    row = (await db_session.execute(
        select(CoinTransaction).where(CoinTransaction.source == "manual")
    )).scalars().first()
    assert row is not None and row.reason.startswith("[已确认重复]"), row.reason if row else None
    assert "上课表现好" in row.reason


@pytest.mark.asyncio
async def test_guard_survives_tenant_filter(db_session, coin_teacher_student):
    """开着机构过滤、且流水 org_id 与学生错位时,门仍要查得到(不能静默放行)。

    CoinTransaction 是 tenancy 锚点表,带机构上下文的查询会被注入 org_id 过滤
    (实测取实体和取列都会)。自动发币靠 dedup_key 唯一约束兜底,这道门没有兜底,
    所以 system_coins_on_day 必须走 skip_tenant_filter 查全。
    """
    from app.core.config import settings
    _, stu = coin_teacher_student
    today = local_today()
    key = today.strftime("%Y%m%d")
    # 手工造一条 org_id 与学生不一致的系统流水(模拟转机构等历史错位)
    from app.models.coin import CoinTransaction
    db_session.add(CoinTransaction(
        user_id=stu.id, org_id=(stu.org_id or 1) + 999, amount=1, balance_after=1,
        source="task", reason="错位机构的系统发放", dedup_key=f"task:{stu.id}:{key}",
    ))
    await db_session.commit()

    old = settings.TENANCY_ENFORCE
    old_models = list(tenancy.TENANT_MODELS)
    settings.TENANCY_ENFORCE = True
    tenancy.register_tenant_models()
    token = tenancy.current_org_id.set(stu.org_id or 1)
    try:
        granted = await coin_service.system_coins_on_day(db_session, stu.id, today)
    finally:
        # 必须把 TENANT_MODELS 还原:_stamp_tenant_writes(写侧打戳)**不看**
        # TENANCY_ENFORCE,只看 current_org_id 和这个清单。留着不清会让后面
        # 任何设了 current_org_id 的测试凭空多出 org_id 打戳 → 顺序相关的假红假绿。
        tenancy.current_org_id.reset(token)
        tenancy.TENANT_MODELS.clear()
        tenancy.TENANT_MODELS.extend(old_models)
        settings.TENANCY_ENFORCE = old
        tenancy._org_cache.clear()
    assert [g["source"] for g in granted] == ["task"], "机构过滤把系统流水滤掉了 → 门会静默放行"


@pytest.mark.asyncio
async def test_blocked_when_word_king_pending(client, db_session, coin_teacher_student):
    """老师比系统先动手:白天看到"暂列第一"就手动补单词王 → 必须拦。

    这是事故的真实时序(2026-08-08 08:57 老师补发「单词王8.7」,系统的
    word_king dedup_key 要到 12:58 才写)。只查"已发的行"在这里全程放行,
    所以门必须能判「即将发」。单词王按设计次日 00:35 才结算。

    ⚠️ 2026-08-20 起「暂列第一」本身有参评门(见 test_word_king_eligibility.py):
    要有对手、且当天任务全做完。所以这里必须造出一个真实的争夺局面 ——
    原来那句"班里只有他,>0 即领先"已经不成立了。
    """
    from app.models.learning import LearningRecord
    from app.models.word import Word
    teacher, stu = coin_teacher_student
    w = Word(word="pendingking")
    w2 = Word(word="rivalword")
    db_session.add_all([w, w2])
    await db_session.flush()

    # 对手:同班、当天也学了词(词量比他少),让"争夺"成立
    rival = User(username="dupg_rival", email="dupg_rival@e.com", hashed_password="x",
                 role="student", full_name="对手生", is_active=True, org_id=stu.org_id)
    db_session.add(rival)
    await db_session.flush()
    cls_id = (await db_session.execute(
        select(ClassStudent.class_id).where(ClassStudent.student_id == stu.id)
    )).scalar_one()
    db_session.add(ClassStudent(class_id=cls_id, student_id=rival.id, is_active=True))

    ts = _utc_now_for_today()
    db_session.add_all([
        LearningRecord(user_id=stu.id, word_id=w.id, learning_mode="spelling",
                       is_correct=True, created_at=ts),
        LearningRecord(user_id=stu.id, word_id=w2.id, learning_mode="spelling",
                       is_correct=True, created_at=ts),   # 他 2 词
        LearningRecord(user_id=rival.id, word_id=w.id, learning_mode="spelling",
                       is_correct=True, created_at=ts),   # 对手 1 词
    ])
    # 两人当天都有任务且都已完成(参评前提)
    await _assign_completed_task(db_session, teacher, [stu, rival])
    await db_session.commit()

    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 409, "单词王待发时手动补币没被拦住"
    detail = resp.json()["detail"]
    assert detail["granted"] == []          # 系统还没发
    # 任务币也在待发里 —— 参评单词王本来就要求当天任务全做完(2026-08-20 起),
    # 两者必然同时待发,这是新规则下的正常形态,不是多报
    assert [p["kind"] for p in detail["pending"]] == ["task", "word_king"]
    assert await _balance(db_session, stu.id) == 0


@pytest.mark.asyncio
async def test_manual_mode_org_not_blocked_by_pending(db_session):
    """manual 机构不报「即将发」—— 系统永远不发,手动加币是唯一途径,
    在那里拦会天天误挡老师唯一的正常操作。已发的历史行仍要报。"""
    from app.models.learning import LearningRecord
    from app.models.word import Word
    tenancy._org_cache.clear()
    org = Organization(name="手动机构", code="DUPG_M", status="active", coin_mode="manual")
    db_session.add(org)
    await db_session.flush()
    stu = User(username="dupg_m_s", email="dupg_m_s@e.com", hashed_password="x",
               role="student", full_name="学生丁", is_active=True, org_id=org.id)
    db_session.add(stu)
    await db_session.flush()
    t2 = User(username="dupg_m_t", email="dupg_m_t@e.com", hashed_password="x",
              role="teacher", full_name="手动老师", is_active=True, org_id=org.id)
    db_session.add(t2)
    await db_session.flush()
    cls = Class(name="手动班", teacher_id=t2.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))
    w = Word(word="manualking")
    db_session.add(w)
    await db_session.flush()
    db_session.add(LearningRecord(
        user_id=stu.id, word_id=w.id, learning_mode="spelling", is_correct=True,
        created_at=_utc_now_for_today(),
    ))
    await db_session.commit()

    conflict = await coin_service.manual_grant_conflicts(db_session, stu.id, org.id)
    assert conflict["pending"] == [], "manual 机构报了「即将发」,会误拦老师唯一的加币途径"
    assert conflict["granted"] == []


@pytest.mark.asyncio
async def test_yesterday_grant_also_blocks_with_day_label(
    client, db_session, coin_teacher_student
):
    """昨天发过**也要拦**,并标出是哪天的币。

    跨天补发正是原先漏掉的那类:老师第二天早上补「昨天的单词王」,查今天查不到
    → 放行 → 与「补算昨天」/凌晨结算撞车。所以窗口是今天+昨天,且必须带 day
    让老师看出"这是昨天那枚,已经发过了"。
    """
    from datetime import timedelta
    teacher, stu = coin_teacher_student
    yesterday = local_today() - timedelta(days=1)
    await _grant_system(db_session, stu, "word_king", yesterday)

    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 409
    granted = resp.json()["detail"]["granted"]
    assert [g["day"] for g in granted] == [yesterday.isoformat()]
    assert await _balance(db_session, stu.id) == 1


@pytest.mark.asyncio
async def test_ok_when_nothing_granted_or_pending(
    client, db_session, coin_teacher_student
):
    """两天都没有系统币、也没有待发的 → 手动加不需要 force(不能天天误拦)。"""
    teacher, stu = coin_teacher_student
    resp = await client.post(
        "/api/v1/teacher/coins/adjust", json=_adjust_body(stu),
        headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
    )
    assert resp.status_code == 200
    assert await _balance(db_session, stu.id) == 1
