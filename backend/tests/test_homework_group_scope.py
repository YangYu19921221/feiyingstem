"""按组布置的作业,学生端只能拿到那一组的词。

2026-09-26 线上反馈:「按组分配作业都是给了一个单元的」。老师选「第2组」建作业,
group_index 是存进库了,但 start_homework 不回传、学生端取词(start_learning /
generate-unit-quiz / generate-unit-cloze)也不认它 → 学生打开恒是整单元。
这里锁住三件事:取词只给该组、组号越界 422、组作业不写坏整单元的续学进度。
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import BookAssignment, HomeworkAssignment, LearningProgress
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent, DailyCheckin
from app.models.word import WordBook, Unit, UnitWord, Word, WordDefinition
from tests.conftest import _make_token


@pytest.fixture
async def grouped(db_session):
    """老师 + 已签到学生 + 6 词、每组 2 词(共 3 组)的单元。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="HGS01", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="hgs_t", email="hgs_t@e.com", hashed_password="x",
                   role="teacher", full_name="李老师", is_active=True, org_id=org.id)
    stu = User(username="hgs_stu", email="hgs_stu@e.com", hashed_password="x",
               role="student", full_name="学生丙", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()
    db_session.add(DailyCheckin(user_id=stu.id, checkin_date=local_today()))
    cls = Class(name="四年级2班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))

    book = WordBook(name="人教版四上", is_public=True, grade_level="小学四年级")
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1", group_size=2)
    db_session.add(unit)
    await db_session.flush()
    for i in range(6):
        w = Word(word=f"hgsword{i}")
        db_session.add(w)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=w.id, meaning=f"释义{i}", is_primary=True))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
    db_session.add(BookAssignment(student_id=stu.id, book_id=book.id,
                                  scope_type="book", teacher_id=teacher.id))
    await db_session.commit()
    return teacher, stu, unit


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def test_start_learning_group_returns_only_that_group(client: AsyncClient, grouped):
    _t, stu, unit = grouped
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify", "group_index": 2}, headers=_h(stu.id))
    assert r.status_code == 200, r.text
    assert [w["word"] for w in r.json()["words"]] == ["hgsword2", "hgsword3"]
    assert r.json()["total_words"] == 2

    # 不带组号 = 整单元(旧行为不变)
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify"}, headers=_h(stu.id))
    assert len(r.json()["words"]) == 6


async def test_start_learning_group_out_of_range_422(client: AsyncClient, grouped):
    _t, stu, unit = grouped
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify", "group_index": 4}, headers=_h(stu.id))
    assert r.status_code == 422


async def test_group_session_does_not_touch_unit_progress(client: AsyncClient, grouped, db_session):
    """组作业不读写整单元进度:否则组内游标会把续学位置打乱。"""
    _t, stu, unit = grouped
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify", "group_index": 3}, headers=_h(stu.id))
    assert r.status_code == 200
    assert r.json()["current_word_index"] == 0
    rows = (await db_session.execute(select(LearningProgress).where(
        LearningProgress.user_id == stu.id, LearningProgress.unit_id == unit.id))).scalars().all()
    assert rows == []


async def test_start_homework_returns_group_index(client: AsyncClient, grouped, db_session):
    teacher, stu, unit = grouped
    r = await client.post("/api/v1/teacher/homework", json={
        "title": "分组练习", "unit_id": unit.id, "learning_mode": "spelling",
        "student_ids": [stu.id], "target_score": 80, "max_attempts": 3, "group_indexes": [2],
    }, headers=_h(teacher.id))
    assert r.status_code == 200, r.text
    hid = r.json()["homework_ids"][0]

    mine = await client.get("/api/v1/student/my-homework", headers=_h(stu.id))
    assert mine.status_code == 200, mine.text
    assert [h["group_index"] for h in mine.json() if h["id"] == hid] == [2]

    r = await client.post(f"/api/v1/student/homework/{hid}/start", headers=_h(stu.id))
    assert r.status_code == 200, r.text
    assert r.json()["group_index"] == 2


async def test_unit_quiz_respects_group(client: AsyncClient, grouped):
    _t, stu, unit = grouped
    r = await client.post("/api/v1/ai/generate-unit-quiz", json={
        "unit_id": unit.id, "question_count": 10, "question_type": "spelling", "group_index": 1,
    }, headers=_h(stu.id))
    assert r.status_code == 200, r.text
    assert sorted(q["word"] for q in r.json()["questions"]) == ["hgsword0", "hgsword1"]

    r = await client.post("/api/v1/ai/generate-unit-quiz", json={
        "unit_id": unit.id, "question_count": 10, "question_type": "spelling", "group_index": 9,
    }, headers=_h(stu.id))
    assert r.status_code == 422
