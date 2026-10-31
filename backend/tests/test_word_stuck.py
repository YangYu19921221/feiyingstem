"""听写「卡住」(2026-10-31)—— 发呆提醒只看有没有操作,动鼠标也算人在,
抓不到「手偶尔动一下、人在走神」。听写时一个词 40 秒没交、15 秒没打字,页面问「卡住了吗」并上报。

钉住的不变量:
1. 一人一天一个词一行: 重试补交 / 再卡一次不会把次数刷高;留最长的那次和最后的结果
2. 卡住后才拼对(stuck=True)照常算对,但下次复习最晚排到明天北京 0 点;没卡住的照常按间隔排
3. 老师每日数据有 stuck_count,点开学生有卡住的词(想得最久的在前);只看本班
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today, local_today_utc_range
from app.models.learning import WordMastery, WordStuckEvent
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, UnitWord, Word
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def scene(db_session):
    tenancy._org_cache.clear()
    # 生产库 study_calendar 有 UNIQUE(user_id, study_date),测试库的 create_all 没建,提交记录时 upsert 要用
    await db_session.execute(sql_text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_test ON study_calendar(user_id, study_date)"))
    org = Organization(name="卡住机构", code="STK01", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="stkteach", email="stkt@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    other_teacher = User(username="stkother", email="stko@e.com", hashed_password="x",
                         role="teacher", full_name="李老师", is_active=True, org_id=org.id)
    stu = User(username="stkstu", email="stks@e.com", hashed_password="x",
               role="student", full_name="卡住同学", is_active=True, org_id=org.id)
    db_session.add_all([teacher, other_teacher, stu])
    await db_session.flush()
    cls = Class(name="卡住班", teacher_id=teacher.id, org_id=org.id)
    other_cls = Class(name="别的班", teacher_id=other_teacher.id, org_id=org.id)
    db_session.add_all([cls, other_cls])
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))
    book = WordBook(name="卡住书", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="U1")
    db_session.add(unit)
    await db_session.flush()
    words = []
    for i, sp in enumerate(["elephant", "because", "apple"]):
        w = Word(word=sp)
        db_session.add(w)
        await db_session.flush()
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
        words.append(w)
    await db_session.commit()
    return db_session, teacher, other_teacher, stu, cls, other_cls, unit, words


async def _stuck(client, stu, word, unit, ms, outcome):
    return await client.post("/api/v1/student/presence/stuck-word", headers=_h(stu.id), json={
        "word_id": word.id, "unit_id": unit.id, "ms": ms, "outcome": outcome})


@pytest.mark.asyncio
async def test_one_row_per_word_per_day_keeps_longest_and_latest(client, scene):
    db, _t, _o, stu, _c, _oc, unit, words = scene
    assert (await _stuck(client, stu, words[0], unit, 52_000, "gave_up")).status_code == 200
    # 重试补交同一条 + 同一个词又卡了一次(短一些、这次写对了)
    assert (await _stuck(client, stu, words[0], unit, 52_000, "gave_up")).status_code == 200
    assert (await _stuck(client, stu, words[0], unit, 41_000, "correct")).status_code == 200
    rows = (await db.execute(select(WordStuckEvent).where(WordStuckEvent.user_id == stu.id))).scalars().all()
    assert len(rows) == 1
    assert (rows[0].ms, rows[0].outcome, rows[0].study_date) == (52_000, "correct", local_today())


@pytest.mark.asyncio
async def test_bad_outcome_rejected_and_ms_clamped(client, scene):
    db, _t, _o, stu, _c, _oc, unit, words = scene
    assert (await _stuck(client, stu, words[1], unit, 40_000, "asleep")).status_code == 422
    assert (await _stuck(client, stu, words[1], unit, 99 * 60 * 1000, "wrong")).status_code == 200
    row = (await db.execute(select(WordStuckEvent).where(WordStuckEvent.word_id == words[1].id))).scalar_one()
    assert row.ms == 30 * 60 * 1000
    r = await client.post("/api/v1/student/presence/stuck-word", headers=_h(stu.id), json={
        "word_id": 987654, "ms": 40_000, "outcome": "wrong"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_stuck_correct_word_comes_back_tomorrow(client, scene):
    db, _t, _o, stu, _c, _oc, unit, words = scene
    now = datetime.utcnow()
    # 两个词都在 SRS 第 5 阶(再拼对按正常间隔要隔 4 天)
    for w in words[:2]:
        db.add(WordMastery(user_id=stu.id, word_id=w.id, review_stage=5, mastery_level=3,
                           correct_count=3, total_encounters=3, last_practiced_at=now - timedelta(days=3),
                           next_review_at=now - timedelta(hours=1)))
    await db.commit()
    r = await client.post("/api/v1/student/records", headers=_h(stu.id), json={
        "unit_id": unit.id, "learning_mode": "classify", "session_seconds": 120,
        "records": [
            {"word_id": words[0].id, "is_correct": True, "time_spent": 55_000, "learning_mode": "spelling", "stuck": True},
            {"word_id": words[1].id, "is_correct": True, "time_spent": 6_000, "learning_mode": "spelling"},
        ]})
    assert r.status_code == 200, r.text
    tomorrow = local_today_utc_range()[1]
    rows = {m.word_id: m for m in (await db.execute(
        select(WordMastery).where(WordMastery.user_id == stu.id))).scalars().all()}
    await db.refresh(rows[words[0].id])
    await db.refresh(rows[words[1].id])
    slow, normal = rows[words[0].id], rows[words[1].id]
    assert slow.review_stage == normal.review_stage == 6          # 照常算对、照常进阶
    assert slow.next_review_at <= tomorrow                       # 卡住的明天回来
    assert normal.next_review_at > tomorrow + timedelta(days=2)  # 没卡住的照常隔 4 天


@pytest.mark.asyncio
async def test_teacher_sees_stuck_count_and_words_only_for_own_class(client, scene):
    db, teacher, other_teacher, stu, cls, other_cls, unit, words = scene
    await _stuck(client, stu, words[0], unit, 63_000, "gave_up")
    await _stuck(client, stu, words[1], unit, 44_000, "correct")

    r = await client.get(f"/api/v1/teacher/classes/{cls.id}/daily-stats", headers=_h(teacher.id))
    assert r.status_code == 200, r.text
    row = next(s for s in r.json()["students"] if s["user_id"] == stu.id)
    assert row["stuck_count"] == 2

    r = await client.get(f"/api/v1/teacher/classes/{cls.id}/daily-stats/{stu.id}/content", headers=_h(teacher.id))
    assert r.status_code == 200, r.text
    assert [(w["word"], w["seconds"], w["outcome"]) for w in r.json()["stuck_words"]] == [
        ("elephant", 63, "gave_up"), ("because", 44, "correct")]

    # 别班老师看不到这个孩子
    r = await client.get(f"/api/v1/teacher/classes/{other_cls.id}/daily-stats/{stu.id}/content",
                         headers=_h(other_teacher.id))
    assert r.status_code in (403, 404)
