"""「只能从作业进入」的作业(entry_mode='homework_only')。

2026-10-05 用户需求: 布置任务时有个选项「只能从布置任务中进入背单词」,不选则书本里也能进。
口径(用户选 A,书本分配优先): 这个开关只收回「作业额外开放的那部分」——
  - homework_only 作业不并入单元白名单、不开书;只有请求带上发给本人的 assignment_id 才放行
  - 学生本来就有该书/单元分配的,照样能从书本自学(不锁付费的书)
  - open(默认)作业行为不变
出题端点(generate-unit-quiz / cloze)此前连登录都不要,一并接同一道闸门,否则是后门。
"""
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import BookAssignment, HomeworkAssignment, HomeworkStudentAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent, DailyCheckin
from app.models.word import WordBook, Unit, UnitWord, Word, WordDefinition
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def env(db_session):
    """书 A: 学生只分配了 Unit 1;Unit 2/3 没分配。书 B: 学生完全没有分配。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="HEM01", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="hemt", email="hemt@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu = User(username="hemstu", email="hemstu@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    other = User(username="hemother", email="hemother@e.com", hashed_password="x",
                 role="student", full_name="学生乙", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu, other])
    await db_session.flush()
    for s in (stu, other):
        db_session.add(DailyCheckin(user_id=s.id, checkin_date=local_today()))
    cls = Class(name="五年级1班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    for s in (stu, other):
        db_session.add(ClassStudent(class_id=cls.id, student_id=s.id, is_active=True))

    units = {}
    for bname in ("hemA", "hemB"):
        book = WordBook(name=bname, is_public=True, grade_level="小学五年级")
        db_session.add(book)
        await db_session.flush()
        for n in (1, 2, 3):
            u = Unit(book_id=book.id, unit_number=n, name=f"{bname} U{n}")
            db_session.add(u)
            await db_session.flush()
            for i in range(4):
                w = Word(word=f"{bname}u{n}w{i}")
                db_session.add(w)
                await db_session.flush()
                db_session.add(WordDefinition(word_id=w.id, meaning=f"释义{i}", is_primary=True))
                db_session.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=i))
            units[(bname, n)] = u
    units["bookA"] = units[("hemA", 1)].book_id
    units["bookB"] = units[("hemB", 1)].book_id
    db_session.add(BookAssignment(student_id=stu.id, book_id=units["bookA"], scope_type="unit",
                                  unit_id=units[("hemA", 1)].id, teacher_id=teacher.id))
    await db_session.commit()
    return teacher, stu, other, units


async def _assign(client, teacher, stu, unit, entry_mode=None):
    body = {"title": "背单词", "unit_id": unit.id, "learning_mode": "spelling",
            "student_ids": [stu.id], "target_score": 80, "max_attempts": 3}
    if entry_mode:
        body["entry_mode"] = entry_mode
    r = await client.post("/api/v1/teacher/homework", json=body, headers=_h(teacher.id))
    assert r.status_code == 200, r.text
    mine = await client.get("/api/v1/student/my-homework", headers=_h(stu.id))
    hwid = r.json()["homework_ids"][0]
    return next(h for h in mine.json() if h["homework_id"] == hwid)


async def _start(client, stu, unit, assignment_id=None):
    body = {"learning_mode": "spelling"}
    if assignment_id is not None:
        body["assignment_id"] = assignment_id
    return await client.post(f"/api/v1/student/units/{unit.id}/start", json=body, headers=_h(stu.id))


async def test_homework_only_blocks_book_entry_but_allows_homework_entry(client: AsyncClient, env):
    teacher, stu, _o, units = env
    u2 = units[("hemA", 2)]
    hw = await _assign(client, teacher, stu, u2, "homework_only")
    assert hw["entry_mode"] == "homework_only"

    r = await _start(client, stu, u2)
    assert r.status_code == 403
    assert "作业" in r.json()["detail"]  # 说清要从作业进,不是「没分配」

    r = await _start(client, stu, u2, hw["id"])
    assert r.status_code == 200, r.text
    assert len(r.json()["words"]) == 4


async def test_open_homework_unchanged(client: AsyncClient, env):
    teacher, stu, _o, units = env
    u3 = units[("hemA", 3)]
    hw = await _assign(client, teacher, stu, u3)  # 不传 = open(旧行为)
    assert hw["entry_mode"] == "open"
    r = await _start(client, stu, u3)
    assert r.status_code == 200, r.text


async def test_book_assignment_wins(client: AsyncClient, env):
    """用户选 A: 学生本来就分配了这个单元,勾了「仅作业入口」也照样能从书本进。"""
    teacher, stu, _o, units = env
    u1 = units[("hemA", 1)]
    await _assign(client, teacher, stu, u1, "homework_only")
    r = await _start(client, stu, u1)
    assert r.status_code == 200, r.text


async def test_assignment_id_must_match(client: AsyncClient, env):
    """拿别的单元/别人的作业 id 不能开锁。"""
    teacher, stu, other, units = env
    u2, u3 = units[("hemA", 2)], units[("hemA", 3)]
    hw = await _assign(client, teacher, stu, u2, "homework_only")
    # 单元对不上
    assert (await _start(client, stu, u3, hw["id"])).status_code == 403
    # 别人的作业分配
    assert (await _start(client, other, u2, hw["id"])).status_code == 403


async def test_closed_or_not_yet_open_homework_does_not_grant(client: AsyncClient, env, db_session):
    teacher, stu, _o, units = env
    u2 = units[("hemA", 2)]
    hw = await _assign(client, teacher, stu, u2, "homework_only")
    homework = await db_session.get(HomeworkAssignment, hw["homework_id"])
    homework.available_from = datetime.utcnow() + timedelta(days=1)
    await db_session.commit()
    assert (await _start(client, stu, u2, hw["id"])).status_code == 403
    homework.available_from = None
    homework.is_closed = True
    await db_session.commit()
    assert (await _start(client, stu, u2, hw["id"])).status_code == 403


async def test_homework_only_does_not_open_book_on_shelf(client: AsyncClient, env):
    teacher, stu, _o, units = env
    await _assign(client, teacher, stu, units[("hemB", 1)], "homework_only")
    books = (await client.get("/api/v1/student/books", headers=_h(stu.id))).json()
    owned = {b["id"]: b["owned"] for b in books}
    assert owned[units["bookB"]] is False

    # 对照: open 作业照旧开书
    await _assign(client, teacher, stu, units[("hemB", 2)])
    books = (await client.get("/api/v1/student/books", headers=_h(stu.id))).json()
    assert {b["id"]: b["owned"] for b in books}[units["bookB"]] is True


async def test_book_progress_marks_homework_only(client: AsyncClient, env):
    teacher, stu, _o, units = env
    await _assign(client, teacher, stu, units[("hemA", 2)], "homework_only")
    r = await client.get(f"/api/v1/student/books/{units['bookA']}/progress", headers=_h(stu.id))
    assert r.status_code == 200, r.text
    by_id = {u["unit_id"]: u for u in r.json()["units"]}
    u2 = by_id[units[("hemA", 2)].id]
    assert u2["is_allowed"] is False and u2["homework_only"] is True
    u3 = by_id[units[("hemA", 3)].id]
    assert u3["is_allowed"] is False and u3["homework_only"] is False


async def test_quiz_and_cloze_and_exam_share_gate(client: AsyncClient, env):
    """出题端点此前不鉴权 = 「仅作业入口」的后门;现在与取词同一道闸门。"""
    teacher, stu, _o, units = env
    u2 = units[("hemA", 2)]
    hw = await _assign(client, teacher, stu, u2, "homework_only")
    quiz = {"unit_id": u2.id, "question_count": 5, "question_type": "spelling"}

    assert (await client.post("/api/v1/ai/generate-unit-quiz", json=quiz)).status_code == 401
    r = await client.post("/api/v1/ai/generate-unit-quiz", json=quiz, headers=_h(stu.id))
    assert r.status_code == 403
    r = await client.post("/api/v1/ai/generate-unit-quiz", json={**quiz, "assignment_id": hw["id"]},
                          headers=_h(stu.id))
    assert r.status_code == 200, r.text

    r = await client.post("/api/v1/ai/generate-unit-cloze",
                          json={"unit_id": u2.id, "blank_count": 3}, headers=_h(stu.id))
    assert r.status_code == 403

    r = await client.get(f"/api/v1/student/exam/generate/{u2.id}", headers=_h(stu.id))
    assert r.status_code == 403
    r = await client.get(f"/api/v1/student/exam/generate/{u2.id}?assignment_id={hw['id']}",
                         headers=_h(stu.id))
    assert r.status_code == 200, r.text

    # 老师预览不拦
    r = await client.post("/api/v1/ai/generate-unit-quiz", json=quiz, headers=_h(teacher.id))
    assert r.status_code == 200, r.text
