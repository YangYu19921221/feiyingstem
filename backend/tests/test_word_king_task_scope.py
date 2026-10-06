"""比赛模式:当天有「🏆 比赛模式」作业时,单词王/排行只数比赛作业单元里的词(2026-10-06)。

起因: 老师布置任务拿来比赛,学生做完作业就跑去没布置的书里刷词量当单词王。
生产核对(09-29 班 55): 某生作业内只背 25 词、另在别的书刷到 174 词当上了王,
作业内背得最多(40 词)的同学反而没当上。

规则: 去别的书背照常记学习记录、照常进学生自己的总量(my_all_words / 日报 words_learned),
只是不进比赛。作业范围与任务分母同口径: 当天布置、未关闭、非家里作业。
"""
from datetime import date, datetime, timedelta

import pytest

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, UnitWord, Word
from app.services.coin_service import (
    task_words_by_student, word_kings_for_class, word_king_race,
)


def _utc(d: date, hour: int) -> datetime:
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


@pytest.fixture
async def scene(db_session):
    """一个班两名学生;作业单元 10 词,另一本「没布置的书」30 词(拼写与作业词部分相同)。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="WKS01", status="active", coin_mode="auto")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="wkst", email="wkst@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    a = User(username="wksa", email="wksa@e.com", hashed_password="x",
             role="student", full_name="刷词的", is_active=True, org_id=org.id)
    b = User(username="wksb", email="wksb@e.com", hashed_password="x",
             role="student", full_name="认真做作业的", is_active=True, org_id=org.id)
    db_session.add_all([teacher, a, b])
    await db_session.flush()
    cls = Class(name="比赛班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    for s in (a, b):
        db_session.add(ClassStudent(class_id=cls.id, student_id=s.id, is_active=True))

    def unit_with(book_name, prefix, n):
        return book_name, prefix, n

    units = {}
    for book_name, prefix, n in (unit_with("作业书", "hw", 10), unit_with("没布置的书", "ex", 30)):
        book = WordBook(name=book_name, is_public=True)
        db_session.add(book)
        await db_session.flush()
        unit = Unit(book_id=book.id, unit_number=1, name=f"{book_name} U1")
        db_session.add(unit)
        await db_session.flush()
        words = []
        for i in range(n):
            # 没布置的书前 5 个词与作业词同拼写(单元级隔离:同拼写不同 word_id)
            spell = f"hw{i}" if prefix == "ex" and i < 5 else f"{prefix}{i}"
            w = Word(word=spell)
            db_session.add(w)
            await db_session.flush()
            db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
            words.append(w)
        units[prefix] = (unit, words)
    await db_session.commit()
    return db_session, teacher, cls, a, b, units


async def _assign(db, teacher, unit, stu, d, *, completed=True, closed=False, location="classroom",
                  contest=True):
    hw = HomeworkAssignment(title="比赛", unit_id=unit.id, teacher_id=teacher.id,
                            learning_mode="spelling", target_score=80, max_attempts=3,
                            is_closed=closed, location_type=location, is_contest=contest)
    db.add(hw)
    await db.flush()
    db.add(HomeworkStudentAssignment(
        homework_id=hw.id, student_id=stu.id, status="completed" if completed else "pending",
        attempts_count=1, best_score=100, total_time_spent=60,
        assigned_at=_utc(d, 9), completed_at=_utc(d, 11) if completed else None,
    ))
    await db.flush()


async def _learn(db, stu, words, d, mode="spelling"):
    for w in words:
        db.add(LearningRecord(user_id=stu.id, word_id=w.id, learning_mode=mode,
                              is_correct=True, time_spent=3, created_at=_utc(d, 12)))
    await db.flush()


async def test_farming_other_book_does_not_win(scene):
    """事故形状: A 作业内 4 词 + 别的书刷 30 词;B 作业内 8 词 → 王是 B。"""
    db, teacher, cls, a, b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    _ex_unit, ex_words = units["ex"]
    for s in (a, b):
        await _assign(db, teacher, hw_unit, s, d)
    await _learn(db, a, hw_words[:4], d)
    await _learn(db, a, ex_words, d)
    await _learn(db, b, hw_words[:8], d)
    await db.commit()

    counts = await task_words_by_student(db, [a.id, b.id], d)
    assert counts == {a.id: 4, b.id: 8}
    assert await word_kings_for_class(db, cls.id, d) == {b.id}


async def test_same_spelling_in_other_book_not_counted(scene):
    """别的书里与作业词同拼写的词(不同 word_id)不算作业内 —— 否则换本书背同样的词就能刷。"""
    db, teacher, _cls, a, _b, units = scene
    d = local_today() - timedelta(days=1)
    await _assign(db, teacher, units["hw"][0], a, d)
    await _learn(db, a, units["ex"][1][:5], d)  # ex 前 5 个拼写 = hw0..hw4
    await db.commit()
    assert (await task_words_by_student(db, [a.id], d)).get(a.id, 0) == 0


async def test_scope_matches_task_denominator(scene):
    """关闭的、家里的、别的日子布置的比赛作业都不构成「比赛日」,当天照常全算。"""
    db, teacher, _cls, a, _b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    await _assign(db, teacher, hw_unit, a, d, closed=True)
    await _assign(db, teacher, hw_unit, a, d, location="home")
    await _assign(db, teacher, hw_unit, a, d - timedelta(days=1))
    await _learn(db, a, hw_words, d)
    await _learn(db, a, units["ex"][1][5:10], d)
    await db.commit()
    # 关闭的/家里的/别的日子的比赛作业都不让当天成为比赛日 → 照常全算(10 作业词 + 5 书本词)
    assert (await task_words_by_student(db, [a.id], d)).get(a.id, 0) == 15


async def test_classify_not_counted_and_dedup(scene):
    """与 daily_words 同口径: classify 不算、同词多条记录只算一次。"""
    db, teacher, _cls, a, _b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    await _assign(db, teacher, hw_unit, a, d)
    await _learn(db, a, hw_words[:3], d)
    await _learn(db, a, hw_words[:3], d)
    await _learn(db, a, hw_words[3:6], d, mode="classify")
    await db.commit()
    assert (await task_words_by_student(db, [a.id], d)).get(a.id, 0) == 3


async def test_race_reports_both_counts(scene):
    """学生战况给两个数: my_words(作业内,比赛用)与 my_all_words(当天总量)。"""
    db, teacher, _cls, a, b, units = scene
    d = local_today()
    hw_unit, hw_words = units["hw"]
    for s in (a, b):
        await _assign(db, teacher, hw_unit, s, d)
    await _learn(db, a, hw_words[:4], d)
    await _learn(db, a, units["ex"][1][5:25], d)
    await _learn(db, b, hw_words[:8], d)
    await db.commit()
    r = await word_king_race(db, a.id, d)
    assert r["my_words"] == 4 and r["my_all_words"] == 24
    assert r["top_words"] == 8 and r["gap"] == 4 and r["is_leading"] is False


async def test_daily_stats_exposes_task_words(scene, client):
    """教师端日报多一列 task_words(作业内,与单词王同口径),words_learned 照旧是总量。"""
    from tests.conftest import _make_token
    db, teacher, cls, a, _b, units = scene
    d = local_today()
    await _assign(db, teacher, units["hw"][0], a, d)
    await _learn(db, a, units["hw"][1][:3], d)
    await _learn(db, a, units["ex"][1][5:12], d)
    await db.commit()
    r = await client.get(f"/api/v1/teacher/classes/{cls.id}/daily-stats",
                         headers={"Authorization": f"Bearer {_make_token(teacher.id)}"})
    assert r.status_code == 200, r.text
    row = next(s for s in r.json()["students"] if s["user_id"] == a.id)
    # 用户定:有作业的日子书本里背的不增加 → words_learned 只算作业内;all_words 留总量
    assert row["words_learned"] == 3 and row["all_words"] == 10


async def _checkin(db, stu):
    from app.models.user import DailyCheckin
    db.add(DailyCheckin(user_id=stu.id, checkin_date=local_today()))
    await db.flush()


async def test_start_learning_contest_notice(scene, client):
    """学习页比赛提示: 今天有作业时进作业外单元才提示;进作业单元 / 今天没作业都不提示。"""
    from app.models.learning import BookAssignment
    from tests.conftest import _make_token
    db, teacher, _cls, a, b, units = scene
    hw_unit, ex_unit = units["hw"][0], units["ex"][0]
    for s in (a, b):
        await _checkin(db, s)
        db.add(BookAssignment(student_id=s.id, book_id=ex_unit.book_id, scope_type="book",
                              teacher_id=teacher.id))
    await _assign(db, teacher, hw_unit, a, local_today(), completed=False)
    await db.commit()

    async def start(stu, unit):
        r = await client.post(f"/api/v1/student/units/{unit.id}/start", json={"learning_mode": "spelling"},
                              headers={"Authorization": f"Bearer {_make_token(stu.id)}"})
        assert r.status_code == 200, r.text
        return r.json().get("contest_notice")

    assert "不增加单词数" in (await start(a, ex_unit) or "")   # 比赛日,进比赛外单元
    assert await start(a, hw_unit) is None                      # 进的就是作业单元
    assert await start(b, ex_unit) is None                      # 今天没作业,不评王,不提示


async def test_contest_count_matches_word_king_and_spares_no_task_days(scene):
    """比赛口径(排行/大屏/每日数据)与单词王同一个数;当天没作业的学生照常全算。"""
    from app.core.timeutil import local_day_utc_range
    from app.services import daily_words
    db, teacher, _cls, a, b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    ex_words = units["ex"][1]
    await _assign(db, teacher, hw_unit, a, d)          # a 有作业,b 没有
    await _learn(db, a, hw_words[:4], d)
    await _learn(db, a, ex_words[5:25], d)             # a 去别的书刷 20 词
    await _learn(db, b, ex_words[5:15], d)             # b 当天没作业,自学 10 词
    await db.commit()
    s, e = local_day_utc_range(d)
    contest = await daily_words.words_by_student(db, [a.id, b.id], s, e, contest=True)
    assert contest == {a.id: 4, b.id: 10}
    assert (await task_words_by_student(db, [a.id], d))[a.id] == contest[a.id]
    # 总量口径(家长端/学生自己的统计)不受影响
    assert (await daily_words.words_by_student(db, [a.id], s, e))[a.id] == 24


async def test_weekly_contest_sum_is_per_day(scene):
    """周榜按天判:有作业那天只算作业内,没作业那天照常全算,再相加。"""
    from app.services import daily_words
    db, teacher, _cls, a, _b, units = scene
    d1 = local_today() - timedelta(days=2)
    d2 = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    ex_words = units["ex"][1]
    await _assign(db, teacher, hw_unit, a, d1)
    await _learn(db, a, hw_words[:3], d1)
    await _learn(db, a, ex_words[5:15], d1)             # d1 有作业:只算 3
    await _learn(db, a, ex_words[5:12], d2)             # d2 没作业:算 7
    await db.commit()
    got = await daily_words.words_sum_by_student(db, [a.id], d1, d2, contest=True)
    assert got[a.id] == 10
    assert (await daily_words.words_sum_by_student(db, [a.id], d1, d2))[a.id] == 20


async def test_ordinary_homework_does_not_restrict(scene):
    """普通作业(没勾比赛模式)不影响计数:书本里背的照常全算,单词王也按总量。"""
    from app.core.timeutil import local_day_utc_range
    from app.services import daily_words
    db, teacher, cls, a, b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    ex_words = units["ex"][1]
    for s in (a, b):
        await _assign(db, teacher, hw_unit, s, d, contest=False)
    await _learn(db, a, hw_words[:4], d)
    await _learn(db, a, ex_words[5:25], d)   # a 书本里背 20
    await _learn(db, b, hw_words[:8], d)
    await db.commit()
    st, en = local_day_utc_range(d)
    assert await daily_words.words_by_student(db, [a.id, b.id], st, en, contest=True) == {a.id: 24, b.id: 8}
    assert await word_kings_for_class(db, cls.id, d) == {a.id}


async def test_create_homework_is_contest_flag(scene, client):
    """建作业时勾比赛模式 → 落库 + 教师/学生列表都带 is_contest。"""
    from tests.conftest import _make_token
    db, teacher, _cls, a, _b, units = scene
    r = await client.post("/api/v1/teacher/homework", json={
        "title": "周赛", "unit_id": units["hw"][0].id, "learning_mode": "spelling",
        "student_ids": [a.id], "target_score": 80, "max_attempts": 3, "is_contest": True,
    }, headers={"Authorization": f"Bearer {_make_token(teacher.id)}"})
    assert r.status_code == 200, r.text
    hid = r.json()["homework_ids"][0]
    assert (await db.get(HomeworkAssignment, hid)).is_contest is True
    t = await client.get("/api/v1/teacher/homework", headers={"Authorization": f"Bearer {_make_token(teacher.id)}"})
    assert any(h["id"] == hid and h["is_contest"] for h in t.json())
    m = await client.get("/api/v1/student/my-homework", headers={"Authorization": f"Bearer {_make_token(a.id)}"})
    assert any(h["homework_id"] == hid and h["is_contest"] for h in m.json())
