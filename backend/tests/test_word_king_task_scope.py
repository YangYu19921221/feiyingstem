"""单词王只数「当天作业单元里的词」(2026-10-06)。

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


async def _assign(db, teacher, unit, stu, d, *, completed=True, closed=False, location="classroom"):
    hw = HomeworkAssignment(title="比赛", unit_id=unit.id, teacher_id=teacher.id,
                            learning_mode="spelling", target_score=80, max_attempts=3,
                            is_closed=closed, location_type=location)
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
    """关闭的作业、家里作业、别的日子布置的作业,单元都不算作业范围。"""
    db, teacher, _cls, a, _b, units = scene
    d = local_today() - timedelta(days=1)
    hw_unit, hw_words = units["hw"]
    await _assign(db, teacher, hw_unit, a, d, closed=True)
    await _assign(db, teacher, hw_unit, a, d, location="home")
    await _assign(db, teacher, hw_unit, a, d - timedelta(days=1))
    await _learn(db, a, hw_words, d)
    await db.commit()
    assert (await task_words_by_student(db, [a.id], d)).get(a.id, 0) == 0


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
    assert row["words_learned"] == 10 and row["task_words"] == 3 and row["has_task"] is True
