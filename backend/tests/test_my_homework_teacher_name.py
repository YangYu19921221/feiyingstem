"""学生作业列表: 老师没填姓名时不能 500(2026-11-02 罗平新建的老师「安娜」没填姓名,布置作业后
她学生的 /student/my-homework 整个 500,一天 54 次)。没填姓名用用户名"""
import pytest

from app.core import tenancy
from app.models.organization import Organization
from app.models.user import Class, ClassStudent, User
from app.models.word import Unit, UnitWord, Word, WordBook
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.mark.asyncio
@pytest.mark.parametrize("full_name", [None, ""])
async def test_my_homework_when_teacher_has_no_full_name(client, db_session, full_name):
    tenancy._org_cache.clear()
    org = Organization(name="罗平测试", code="MHTN1", status="active")
    db_session.add(org)
    await db_session.flush()
    t = User(username="安娜", email="mhtn_t@e.com", hashed_password="x", role="teacher",
             full_name=full_name, is_active=True, org_id=org.id)
    s = User(username="mhtn_s", email="mhtn_s@e.com", hashed_password="x", role="student",
             full_name="学生", is_active=True, org_id=org.id)
    db_session.add_all([t, s])
    await db_session.flush()
    c = Class(name="班", teacher_id=t.id, org_id=org.id)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=s.id, is_active=True))
    book = WordBook(name="书", is_public=True)
    db_session.add(book)
    await db_session.flush()
    u = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db_session.add(u)
    await db_session.flush()
    w = Word(word="mhtnword")
    db_session.add(w)
    await db_session.flush()
    db_session.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=0))
    await db_session.commit()

    r = await client.post("/api/v1/teacher/homework", headers=_h(t.id), json={
        "title": "作业", "unit_id": u.id, "learning_mode": "classify", "student_ids": [s.id],
        "target_score": 80, "max_attempts": 3})
    assert r.status_code == 200, r.text
    r = await client.get("/api/v1/student/my-homework", headers=_h(s.id))
    assert r.status_code == 200, r.text
    assert r.json()[0]["teacher_name"] == "安娜"
