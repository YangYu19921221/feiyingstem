"""陪跑看板(2026-10-21)—— 口径真源 services/coach.py

钉住的不变量:
1. 状态互斥且按「越该先管越靠前」排: 好几天没来 > 今天没学 > 没做完 > 做完了 > 很久没来;
   好几天没来里刚断两三天的排前面;15 天以上/从没学过单列「很久没来」排最后(从没学过的在最末)
2. 老师只看/只写自己班的学生(助教看主老师的班,落款是助教本人)
3. 草稿只写事实: 几份任务、几个词、错了哪几个词;提醒家长的话按状态换
4. 同一天再写是改不是追加;改了内容孩子/家长要重新看到(已读清掉)
5. 孩子只看自己的,家长只看绑定的孩子
"""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.core.timeutil import local_day_utc_range, local_today
from app.models.coach import CoachNote
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.organization import Organization
from app.models.user import Class, ClassStudent, ParentStudentLink, StudyCalendar, User
from app.models.word import Unit, Word, WordBook
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    org = Organization(name="陪跑机构", code="COACH", status="active")
    db_session.add(org)
    await db_session.flush()
    t1 = User(username="coachteach", email="ct@e.com", hashed_password="x", role="teacher",
              full_name="王老师", org_id=org.id, is_active=True)
    t2 = User(username="coachteachtwo", email="ct2@e.com", hashed_password="x", role="teacher",
              full_name="李老师", org_id=org.id, is_active=True)
    db_session.add_all([t1, t2])
    await db_session.flush()
    asst = User(username="coachasst", email="ca@e.com", hashed_password="x", role="teacher",
                full_name="小张助教", org_id=org.id, is_active=True, owner_teacher_id=t1.id)
    names = ["今天做完", "没做完", "今天没学", "断三天", "断十天", "从没学", "断二十天"]
    kids = [User(username=f"coachkid{i}", email=f"ck{i}@e.com", hashed_password="x", role="student",
                 full_name=n, org_id=org.id, is_active=True) for i, n in enumerate(names)]
    other = User(username="coachother", email="co@e.com", hashed_password="x", role="student",
                 full_name="别班孩子", org_id=org.id, is_active=True)
    parent = User(username="parent_13800009999", email="13800009999@parent.local", hashed_password="x",
                  role="parent", full_name="妈妈", org_id=org.id, is_active=True, phone="13800009999")
    db_session.add_all([asst, *kids, other, parent])
    await db_session.flush()
    c1 = Class(name="一班", teacher_id=t1.id, org_id=org.id)
    c2 = Class(name="二班", teacher_id=t2.id, org_id=org.id)
    db_session.add_all([c1, c2])
    await db_session.flush()
    db_session.add_all([ClassStudent(class_id=c1.id, student_id=k.id, is_active=True) for k in kids])
    db_session.add(ClassStudent(class_id=c2.id, student_id=other.id, is_active=True))
    db_session.add(ParentStudentLink(parent_id=parent.id, student_id=kids[0].id))

    today = local_today()
    start, _ = local_day_utc_range(today)
    book = WordBook(name="陪跑书", is_public=True)
    db_session.add(book)
    await db_session.flush()
    units = [Unit(book_id=book.id, unit_number=i, name=f"Unit {i}") for i in (1, 2)]
    db_session.add_all(units)
    words = [Word(word=w) for w in ("apple", "banana", "orange")]
    db_session.add_all(words)
    await db_session.flush()

    async def task(stu, unit, status):
        hw = HomeworkAssignment(title=f"{unit.name}", unit_id=unit.id, teacher_id=t1.id,
                                learning_mode="spelling", target_score=80, max_attempts=3)
        db_session.add(hw)
        await db_session.flush()
        db_session.add(HomeworkStudentAssignment(homework_id=hw.id, student_id=stu.id,
                                                 assigned_at=start + timedelta(hours=1), status=status))

    def cal(stu, days_ago, minutes=20):
        db_session.add(StudyCalendar(user_id=stu.id, study_date=today - timedelta(days=days_ago),
                                     duration=minutes * 60, words_learned=10))

    done, half, notyet, gap3, gap10, _never, gap20 = kids
    # 今天做完: 两份都完成,拼对 12/12
    await task(done, units[0], "completed")
    await task(done, units[1], "completed")
    cal(done, 0)
    for i in range(12):
        db_session.add(LearningRecord(user_id=done.id, word_id=words[i % 3].id, learning_mode="spelling",
                                      is_correct=True, created_at=start + timedelta(hours=2, seconds=i)))
    # 没做完: 1/2,拼写 4/12(struggling),错了 banana 和 orange
    await task(half, units[0], "completed")
    await task(half, units[1], "pending")
    cal(half, 0)
    for i in range(12):
        db_session.add(LearningRecord(user_id=half.id, word_id=words[i % 3].id, learning_mode="spelling",
                                      is_correct=(i % 3 == 0), user_answer="x",
                                      created_at=start + timedelta(hours=2, seconds=i)))
    # 今天没学: 昨天学过,今天有一份任务
    await task(notyet, units[0], "pending")
    cal(notyet, 1)
    cal(gap3, 3)
    cal(gap10, 10)
    cal(gap20, 20)
    await db_session.commit()
    return {"t1": t1, "t2": t2, "asst": asst, "kids": kids, "other": other, "parent": parent}


async def _board(client, uid):
    r = await client.get("/api/v1/teacher/coach/board", headers=_h(uid))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_board_status_order_and_counts(client, env):
    data = await _board(client, env["t1"].id)
    names = [it["full_name"] for it in data["items"]]
    # 好几天没来(断三天 → 断十天) > 今天没学 > 没做完 > 做完了 > 很久没来(断二十天 → 从没学)
    assert names == ["断三天", "断十天", "今天没学", "没做完", "今天做完", "断二十天", "从没学"]
    assert data["counts"] == {"absent": 2, "not_started": 1, "in_progress": 1, "done": 1, "gone": 2}
    by = {it["full_name"]: it for it in data["items"]}
    assert by["断三天"]["days_since"] == 3 and by["从没学"]["days_since"] is None
    half = by["没做完"]
    assert (half["tasks_done"], half["tasks_total"]) == (1, 2)
    assert half["struggling"] is True and half["accuracy_today"] == 33
    assert half["weak_today"] == ["banana", "orange"]
    assert by["今天做完"]["struggling"] is False and by["今天做完"]["accuracy_today"] == 100
    assert by["今天做完"]["parent_bound"] is True and half["parent_bound"] is False
    assert data["struggling"] == 1
    # 别班孩子不在,别班老师也看不到这些孩子
    assert "别班孩子" not in names
    other = await _board(client, env["t2"].id)
    assert [it["full_name"] for it in other["items"]] == ["别班孩子"]


@pytest.mark.asyncio
async def test_drafts_and_reminders_state_facts(client, env):
    by = {it["full_name"]: it for it in (await _board(client, env["t1"].id))["items"]}
    assert "2 份任务全部完成" in by["今天做完"]["draft"] and "100%" in by["今天做完"]["draft"]
    assert "1/2" in by["没做完"]["draft"] and "banana、orange 拼错了" in by["没做完"]["draft"]
    assert "3 天没来" in by["断三天"]["draft"] and "20 天没来" in by["断二十天"]["draft"]
    assert "还没开始背单词" in by["从没学"]["draft"]
    assert "今天的 1 份任务还没开始" in by["今天没学"]["draft"]
    # 一份都没做完时不写「完成了 0/1」
    row = {**by["没做完"], "tasks_done": 0, "words_today": 8}
    from app.services.coach import draft_note
    assert draft_note(row, []).startswith("没做完,今天学了 8 个词,2 份任务还没做完")
    assert by["断三天"]["remind"].startswith("断三天家长您好,断三天已经 3 天没有背单词了")
    assert "还差 1 份" in by["没做完"]["remind"]


@pytest.mark.asyncio
async def test_note_upsert_read_reset_and_visibility(client, db_session, env):
    t1, asst, kids, parent = env["t1"], env["asst"], env["kids"], env["parent"]
    kid = kids[0]
    # 助教写: 落款是助教本人,看的是主老师的班
    r = await client.put(f"/api/v1/teacher/coach/notes/{kid.id}", headers=_h(asst.id), json={"content": "  今天很棒  "})
    assert r.status_code == 200, r.text
    assert r.json() == {"content": "今天很棒", "author_name": "小张助教"}
    # 孩子看到 → 记已读;家长看到 → 记已读
    r = await client.get("/api/v1/student/coach-note", headers=_h(kid.id))
    assert r.json()["note"]["content"] == "今天很棒" and r.json()["note"]["is_today"] is True
    r = await client.get(f"/api/v1/parent/children/{kid.id}/coach-notes", headers=_h(parent.id))
    assert [n["author_name"] for n in r.json()["items"]] == ["小张助教"]
    item = next(it for it in (await _board(client, t1.id))["items"] if it["id"] == kid.id)
    assert item["note"]["read_by_student"] is True and item["note"]["read_by_parent"] is True
    # 同一天再写 = 改,已读清掉
    r = await client.put(f"/api/v1/teacher/coach/notes/{kid.id}", headers=_h(t1.id), json={"content": "改一下"})
    assert r.json()["author_name"] == "王老师"
    rows = (await db_session.execute(select(CoachNote).where(CoachNote.student_id == kid.id))).scalars().all()
    assert len(rows) == 1 and rows[0].read_by_student_at is None and rows[0].read_by_parent_at is None
    # 别的孩子看不到;没绑的家长 403;空内容 400
    r = await client.get("/api/v1/student/coach-note", headers=_h(kids[1].id))
    assert r.json()["note"] is None
    r = await client.get(f"/api/v1/parent/children/{kids[1].id}/coach-notes", headers=_h(parent.id))
    assert r.status_code == 403
    r = await client.put(f"/api/v1/teacher/coach/notes/{kid.id}", headers=_h(t1.id), json={"content": "   "})
    assert r.status_code == 400
    # 删除
    r = await client.delete(f"/api/v1/teacher/coach/notes/{kid.id}", headers=_h(t1.id))
    assert r.status_code == 200
    assert (await client.get("/api/v1/student/coach-note", headers=_h(kid.id))).json()["note"] is None


@pytest.mark.asyncio
async def test_other_class_cannot_write_and_batch_is_all_or_nothing(client, db_session, env):
    t1, t2, kids, other = env["t1"], env["t2"], env["kids"], env["other"]
    r = await client.put(f"/api/v1/teacher/coach/notes/{kids[0].id}", headers=_h(t2.id), json={"content": "x"})
    assert r.status_code == 403
    r = await client.post("/api/v1/teacher/coach/notes/batch", headers=_h(t1.id), json={"items": [
        {"student_id": kids[0].id, "content": "a"}, {"student_id": other.id, "content": "b"}]})
    assert r.status_code == 403
    assert (await db_session.execute(select(CoachNote))).scalars().all() == []
    r = await client.post("/api/v1/teacher/coach/notes/batch", headers=_h(t1.id), json={"items": [
        {"student_id": kids[0].id, "content": "a"}, {"student_id": kids[1].id, "content": "b"}]})
    assert r.json() == {"saved": 2}
    data = await _board(client, t1.id)
    assert data["noted"] == 2


@pytest.mark.asyncio
async def test_old_notes_drop_off_student_home_but_parent_keeps_two_weeks(client, db_session, env):
    t1, kid, parent = env["t1"], env["kids"][0], env["parent"]
    today = local_today()
    for days_ago in (5, 20):
        db_session.add(CoachNote(student_id=kid.id, teacher_id=t1.id, author_name="王老师",
                                 note_date=today - timedelta(days=days_ago), content=f"{days_ago} 天前"))
    await db_session.commit()
    assert (await client.get("/api/v1/student/coach-note", headers=_h(kid.id))).json()["note"] is None
    r = await client.get(f"/api/v1/parent/children/{kid.id}/coach-notes", headers=_h(parent.id))
    assert [n["content"] for n in r.json()["items"]] == ["5 天前"]
