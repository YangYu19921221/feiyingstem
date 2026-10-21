"""每日复习(2026-10-21)—— 口径真源 services/daily_review.py

钉住的不变量:
1. 一天一份 20 个,第一次打开时挑好、当天不变(做了几个再回来,剩下的只会变少,不会冒出新词)
2. 两周内练过的词优先,但最多占 15 个,旧积压每天也消化一点;旧积压里错过的优先;按拼写去重
3. 做了几个按当天的学习记录算;全做完记 completed_at;没有到期词 = 空的一份、直接算完成
4. 能布置成作业: 连续 N 天每天一份、恒为当天截止;那天那一份做完作业自动完成
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_day_utc_range, local_today
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.daily_review import DailyReviewPlan
from app.models.learning import LearningRecord, WordMastery
from app.models.user import User
from app.models.word import Word
from app.services import daily_review
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9971, '复习机构', 'drv', 'active', 'assigned')"))
    t = User(username="drteach", email="drt@e.com", hashed_password="x", role="teacher",
             full_name="王老师", is_active=True, org_id=9971)
    s = User(username="drstu", email="drs@e.com", hashed_password="x", role="student",
             full_name="复习同学", is_active=True, org_id=9971)
    db_session.add_all([t, s])
    await db_session.commit()
    return db_session, t, s


async def _words(db, stu, n, *, prefix, practiced_days_ago, overdue_days, wrong=0, level=2):
    """n 个到期词;返回 word_id 列表"""
    now = datetime.utcnow()
    ids = []
    for i in range(n):
        w = Word(word=f"{prefix}{i}")
        db.add(w)
        await db.flush()
        db.add(WordMastery(user_id=stu.id, word_id=w.id, mastery_level=level, review_stage=3,
                           wrong_count=wrong, correct_count=3, total_encounters=3 + wrong,
                           last_practiced_at=now - timedelta(days=practiced_days_ago),
                           next_review_at=now - timedelta(days=overdue_days)))
        ids.append(w.id)
    await db.flush()
    return ids


async def _practice(db, stu, word_ids):
    """今天练了这几个词(学习记录 + 掌握度上的练习时间,与真实复习提交一致)"""
    now = datetime.utcnow()
    for wid in word_ids:
        db.add(LearningRecord(user_id=stu.id, word_id=wid, learning_mode="review", is_correct=True, created_at=now))
    rows = (await db.execute(select(WordMastery).where(WordMastery.user_id == stu.id,
                                                       WordMastery.word_id.in_(word_ids)))).scalars()
    for m in rows:
        m.last_practiced_at = now
        m.next_review_at = now + timedelta(days=2)
    await db.commit()


async def _get(client, stu, words=False):
    r = await client.get(f"/api/v1/student/daily-review{'?words=true' if words else ''}", headers=_h(stu.id))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_fresh_words_first_but_backlog_still_gets_slots(client, env):
    db, _t, stu = env
    # 100 个半年前的旧积压(其中 10 个错过)+ 30 个这周刚学、今天到期的
    old_clean = await _words(db, stu, 90, prefix="old", practiced_days_ago=180, overdue_days=150)
    old_wrong = await _words(db, stu, 10, prefix="oldw", practiced_days_ago=200, overdue_days=170, wrong=2)
    fresh = await _words(db, stu, 30, prefix="new", practiced_days_ago=3, overdue_days=1)
    await db.commit()

    data = await _get(client, stu, words=True)
    assert (data["total"], data["done"], data["backlog"]) == (20, 0, 130)
    picked = [w["word_id"] for w in data["words"]]
    # 15 个新词在前(旧写法按到期最早取,20 个全是半年前的旧词,新词永远轮不到)
    assert len([i for i in picked if i in fresh]) == daily_review.FRESH_SLOTS
    assert picked[:15] == [i for i in picked if i in fresh]
    # 剩下 5 个给旧积压,错过的优先
    assert set(picked[15:]) <= set(old_wrong)
    assert not set(picked) & set(old_clean)


@pytest.mark.asyncio
async def test_plan_fixed_for_the_day_and_completes(client, db_session, env):
    db, _t, stu = env
    await _words(db, stu, 30, prefix="w", practiced_days_ago=3, overdue_days=1)
    await db.commit()
    first = await _get(client, stu, words=True)
    plan_ids = [w["word_id"] for w in first["words"]]
    assert len(plan_ids) == 20

    # 做了 8 个再回来: 剩 12 个,还是原来那份里的,没冒出新词
    await _practice(db, stu, plan_ids[:8])
    again = await _get(client, stu, words=True)
    assert (again["total"], again["done"], again["remaining"], again["completed"]) == (20, 8, 12, False)
    assert [w["word_id"] for w in again["words"]] == plan_ids[8:]

    await _practice(db, stu, plan_ids[8:])
    done = await _get(client, stu)
    assert (done["done"], done["completed"]) == (20, True)
    plan = (await db_session.execute(select(DailyReviewPlan))).scalar_one()
    assert plan.completed_at is not None


@pytest.mark.asyncio
async def test_dedup_by_spelling_and_empty_day(client, db_session, env):
    db, _t, stu = env
    # 同一个拼写在两个单元各有一行: 只占一个名额,取掌握度低的那行
    a = Word(word="Apple")
    b = Word(word="apple")
    db.add_all([a, b])
    await db.flush()
    now = datetime.utcnow()
    for w, lv in ((a, 4), (b, 1)):
        db.add(WordMastery(user_id=stu.id, word_id=w.id, mastery_level=lv, review_stage=2,
                           last_practiced_at=now - timedelta(days=2), next_review_at=now - timedelta(hours=1)))
    await db.commit()
    data = await _get(client, stu, words=True)
    assert [w["word_id"] for w in data["words"]] == [b.id]

    # 另一个孩子没有到期词: 空的一份,直接算完成
    other = User(username="drempty", email="dre@e.com", hashed_password="x", role="student",
                 is_active=True, org_id=9971)
    db.add(other)
    await db.commit()
    empty = await _get(client, other)
    assert (empty["total"], empty["completed"]) == (0, True)


@pytest.mark.asyncio
async def test_assign_daily_review_homework_and_auto_complete(client, db_session, env):
    db, t, stu = env
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(t.id), json={
        "kind": "daily_review", "target_ids": [], "student_ids": [stu.id], "days": 3})
    assert r.status_code == 200, r.text
    assert len(r.json()["homework_ids"]) == 3
    rows = list((await db_session.execute(select(ContentHomework).order_by(ContentHomework.available_from))).scalars())
    today = local_today()
    # 连续三天、每份当天截止
    for i, hw in enumerate(rows):
        start, end = local_day_utc_range(today + timedelta(days=i))
        assert (hw.available_from, hw.deadline, hw.target_id) == (start, end, 0)
    assert rows[0].title.startswith("每日复习 · ")

    # 句子作业不选内容照旧拦
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(t.id), json={
        "kind": "sentence", "target_ids": [], "student_ids": [stu.id]})
    assert r.status_code == 400

    # 学生端: 今天那份可做,后两份未开放;去完成进复习页
    mine = (await client.get("/api/v1/student/content-homework", headers=_h(stu.id))).json()
    by_status = sorted(m["status"] for m in mine)
    assert by_status == ["locked", "locked", "pending"]
    assert {m["route"] for m in mine} == {"/student/memory-curve"}

    # 今天的 20 个做完 → 今天那份作业自动完成,另外两天的不受影响
    await _words(db, stu, 20, prefix="hw", practiced_days_ago=3, overdue_days=1)
    await db.commit()
    plan = await _get(client, stu, words=True)
    await _practice(db, stu, [w["word_id"] for w in plan["words"]])
    mine = (await client.get("/api/v1/student/content-homework", headers=_h(stu.id))).json()
    assert sorted(m["status"] for m in mine) == ["completed", "locked", "locked"]
    links = list((await db_session.execute(select(ContentHomeworkStudent))).scalars())
    assert sum(1 for l in links if l.completed_at is not None) == 1


@pytest.mark.asyncio
async def test_homework_not_completed_by_other_days_plan(client, db_session, env):
    """昨天那份做完了,不能让今天的作业算完成(只认开放那一天的那一份)"""
    db, t, stu = env
    yesterday = local_today() - timedelta(days=1)
    db.add(DailyReviewPlan(user_id=stu.id, plan_date=yesterday, word_ids="[]", backlog=0,
                           completed_at=datetime.utcnow() - timedelta(days=1)))
    await db.commit()
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(t.id), json={
        "kind": "daily_review", "target_ids": [], "student_ids": [stu.id]})
    assert r.status_code == 200, r.text
    await _words(db, stu, 5, prefix="td", practiced_days_ago=3, overdue_days=1)
    await db.commit()
    mine = (await client.get("/api/v1/student/content-homework", headers=_h(stu.id))).json()
    assert [m["status"] for m in mine] == ["pending"]
