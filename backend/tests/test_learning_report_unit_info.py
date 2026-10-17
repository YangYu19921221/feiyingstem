"""学习报告分享图用到的 unit_info 字段(book_name / org_name)

分类学习结算页「生成学习报告」在图上写书名、落款写机构名。加盟机构的家长看到的必须是
**本机构**的名字(不是平台品牌,也不是别家机构),所以 org_name 取学生自己的 org_id。
"""
import pytest

from app.models.user import User, DailyCheckin
from app.models.word import Word, WordBook, BookWord, Unit, UnitWord
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.core.timeutil import local_today
from app.core import tenancy
from tests.conftest import _make_token


async def _student_in_org(db_session, org_name: str, code: str, username: str):
    org = Organization(name=org_name, code=code, status="active")
    db_session.add(org)
    await db_session.flush()
    user = User(
        username=username, email=f"{username}@example.com", hashed_password="x",
        role="student", full_name="报告同学", is_active=True, org_id=org.id,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(DailyCheckin(user_id=user.id, checkin_date=local_today()))
    return user


@pytest.fixture
async def unit_and_two_students(db_session):
    tenancy._org_cache.clear()  # 机构状态有进程内缓存,测试间必须清
    a = await _student_in_org(db_session, "甲机构英语", "RPTA", "reportstua")
    b = await _student_in_org(db_session, "乙机构英语", "RPTB", "reportstub")

    book = WordBook(name="人教版三年级上册", is_public=True, grade_level="小学三年级")
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1 Hello")
    db_session.add(unit)
    await db_session.flush()
    for i, text in enumerate(["hello", "ruler", "pencil"]):
        w = Word(word=f"{text}rpt", difficulty=1)
        db_session.add(w)
        await db_session.flush()
        db_session.add(BookWord(book_id=book.id, word_id=w.id, order_index=i))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
    for u in (a, b):
        db_session.add(BookAssignment(student_id=u.id, book_id=book.id, scope_type="book", teacher_id=u.id))
    await db_session.commit()
    return unit, a.id, b.id


async def _start(client, unit, uid):
    r = await client.post(
        f"/api/v1/student/units/{unit.id}/start",
        json={"unit_id": unit.id, "learning_mode": "classify"},
        headers={"Authorization": f"Bearer {_make_token(uid)}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["unit_info"]


async def test_unit_info_has_book_and_own_org_name(client, unit_and_two_students):
    unit, a_id, b_id = unit_and_two_students
    info_a = await _start(client, unit, a_id)
    assert info_a["book_name"] == "人教版三年级上册"
    assert info_a["org_name"] == "甲机构英语"
    # 原有字段不受影响
    assert info_a["name"] == "Unit 1 Hello"
    assert info_a["grade_level"] == "小学三年级"

    # 同一本平台书,另一家机构的学生落款是他自己的机构
    info_b = await _start(client, unit, b_id)
    assert info_b["org_name"] == "乙机构英语"
