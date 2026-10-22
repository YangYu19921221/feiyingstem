"""句子 / 音标视频 / 每日复习作业也算进「今天的任务」(2026-10-22)

钉住的不变量(判定真源 services/content_homework):
1. 陪跑看板: 今天开放的这类作业算进 tasks_total/tasks_done,没做完的点名列出来;提醒家长写「学习任务」并点名
2. 今日学习报告: 这类作业算进 today_total,没做完就不能「全部完成」;做完列出来、没有分数
3. 一批学生一起判完成时,按 (学生, 目标) 精确对 —— A 看完了不能让 B 也算完成
4. 每日复习作业的完成时刻 = 那一份最后一个词练到的时刻,不是被谁看到的那一刻
5. 昨天开放的、已关闭的不算今天的任务
"""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.timeutil import local_day_utc_range, local_today
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.daily_review import DailyReviewPlan
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.phonetic import PhoneticVideoView
from app.models.user import Class, ClassStudent, StudyCalendar
from app.models.word import Unit, Word, WordBook
from app.services import content_homework as chw
from tests.conftest import _make_token
from tests.test_content_homework import _env


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _setup(db):
    u, unit, _, video = await _env(db)
    t, s1, s2 = u["t"], u["s1"], u["s2"]
    c = Class(name="一班", teacher_id=t.id, org_id=9961)
    db.add(c)
    await db.flush()
    db.add_all([ClassStudent(class_id=c.id, student_id=s.id, is_active=True) for s in (s1, s2)])
    today = local_today()
    start, _ = local_day_utc_range(today)
    for s in (s1, s2):
        db.add(StudyCalendar(user_id=s.id, study_date=today, duration=600, words_learned=5))
    # 今天一份单词作业,两个孩子都做完了
    book = WordBook(name="单词书", is_public=True)
    db.add(book)
    await db.flush()
    wu = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db.add(wu)
    await db.flush()
    hw = HomeworkAssignment(title="Unit 1", unit_id=wu.id, teacher_id=t.id, learning_mode="spelling",
                            target_score=80, max_attempts=3)
    db.add(hw)
    await db.flush()
    for s in (s1, s2):
        db.add(HomeworkStudentAssignment(homework_id=hw.id, student_id=s.id, status="completed", best_score=95,
                                         assigned_at=start + timedelta(hours=1),
                                         completed_at=start + timedelta(hours=2)))
    await db.commit()
    return u, unit, video


async def _assign(client, t, kind, target, students, **kw):
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(t.id), json={
        "kind": kind, "target_ids": [target] if target else [], "student_ids": [s.id for s in students], **kw})
    assert r.status_code == 200, r.text
    return r.json()["homework_ids"]


async def _board(client, t):
    r = await client.get("/api/v1/teacher/coach/board", headers=_h(t.id))
    assert r.status_code == 200, r.text
    return {it["id"]: it for it in r.json()["items"]}


async def _report(client, s):
    r = await client.get("/api/v1/student/today-report", headers=_h(s.id))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_coach_board_counts_and_names_content_tasks(client, db_session):
    u, _, video = await _setup(db_session)
    t, s1, s2 = u["t"], u["s1"], u["s2"]
    await _assign(client, t, "phonetic_video", video.id, [s1, s2])
    # 只有 s1 看完了
    db_session.add(PhoneticVideoView(video_id=video.id, user_id=s1.id, watch_seconds=300,
                                     max_position_seconds=290, completed=True))
    await db_session.commit()

    by = await _board(client, t)
    a, b = by[s1.id], by[s2.id]
    assert (a["tasks_done"], a["tasks_total"], a["status"]) == (2, 2, "done")
    assert (b["tasks_done"], b["tasks_total"], b["status"]) == (1, 2, "in_progress")
    assert b["other_tasks"] == [{"kind": "phonetic_video", "label": "音标视频「元音 /æ/」", "done": False}]
    assert a["other_tasks"][0]["done"] is True
    assert "音标视频「元音 /æ/」" in b["remind"] and "学习任务" in b["remind"]
    assert "音标视频「元音 /æ/」还没做" in b["draft"]


@pytest.mark.asyncio
async def test_today_report_needs_content_tasks_done(client, db_session):
    u, unit, video = await _setup(db_session)
    s1 = u["s1"]
    await _assign(client, u["t"], "phonetic_video", video.id, [s1])
    rep = await _report(client, s1)
    assert (rep["today_total"], rep["today_done"], rep["all_done"]) == (2, 1, False)

    db_session.add(PhoneticVideoView(video_id=video.id, user_id=s1.id, watch_seconds=300,
                                     max_position_seconds=290, completed=True))
    await db_session.commit()
    rep = await _report(client, s1)
    assert (rep["today_total"], rep["today_done"], rep["all_done"]) == (2, 2, True)
    vt = [x for x in rep["tasks"] if x["kind"] == "phonetic_video"]
    assert len(vt) == 1 and vt[0]["unit_name"] == "元音 /æ/" and vt[0]["status"] == "completed"
    assert vt[0]["completed_time"] is not None
    assert {x["kind"] for x in rep["tasks"]} == {"word", "phonetic_video"}


@pytest.mark.asyncio
async def test_yesterday_and_closed_content_tasks_not_today(client, db_session):
    u, unit, video = await _setup(db_session)
    t, s1 = u["t"], u["s1"]
    ids = await _assign(client, t, "sentence", unit.id, [s1])
    # 改成昨天开放的(且没做完): 不是今天的任务
    hw = await db_session.get(ContentHomework, ids[0])
    hw.available_from -= timedelta(days=1)
    await db_session.commit()
    ids2 = await _assign(client, t, "phonetic_video", video.id, [s1])
    r = await client.post(f"/api/v1/teacher/content-homework/{ids2[0]}/toggle-closed", headers=_h(t.id))
    assert r.status_code == 200 and r.json()["is_closed"] is True

    row = (await _board(client, t))[s1.id]
    assert (row["tasks_done"], row["tasks_total"], row["other_tasks"]) == (1, 1, [])
    rep = await _report(client, s1)
    assert (rep["today_total"], rep["all_done"]) == (1, True)
    assert [x["kind"] for x in rep["tasks"]] == ["word"]


@pytest.mark.asyncio
async def test_batch_refresh_pairs_student_with_target(client, db_session):
    """一批判时视频看完记录按 (学生, 视频) 对: s1 看完视频 A、s2 看完视频 B,
    两人都布置了 A 时只有 s1 完成"""
    u, _, video = await _setup(db_session)
    from app.models.phonetic import PhoneticVideo
    other = PhoneticVideo(title="元音 /e/", file_path="y.mp4", category="vowel", is_active=True, org_id=None)
    db_session.add(other)
    await db_session.commit()
    await _assign(client, u["t"], "phonetic_video", video.id, [u["s1"], u["s2"]])
    db_session.add_all([
        PhoneticVideoView(video_id=video.id, user_id=u["s1"].id, watch_seconds=300, max_position_seconds=290, completed=True),
        PhoneticVideoView(video_id=other.id, user_id=u["s2"].id, watch_seconds=300, max_position_seconds=290, completed=True),
    ])
    await db_session.commit()
    links = list((await db_session.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id))).all())
    assert await chw.refresh_completion(db_session, links) is True
    done = {s.student_id: s.completed_at is not None for s, _ in links}
    assert done == {u["s1"].id: True, u["s2"].id: False}


@pytest.mark.asyncio
async def test_daily_review_completed_at_is_when_last_word_was_done(client, db_session):
    u, _, _ = await _setup(db_session)
    s1 = u["s1"]
    await _assign(client, u["t"], "daily_review", None, [s1])
    start, _ = local_day_utc_range(local_today())
    words = [Word(word=f"cw{i}") for i in range(2)]
    db_session.add_all(words)
    await db_session.flush()
    db_session.add(DailyReviewPlan(user_id=s1.id, plan_date=local_today(),
                                   word_ids=f"[{words[0].id}, {words[1].id}]", backlog=2))
    first, last = start + timedelta(hours=1), start + timedelta(hours=3)
    db_session.add_all([
        LearningRecord(user_id=s1.id, word_id=words[0].id, learning_mode="review", is_correct=True, created_at=first),
        LearningRecord(user_id=s1.id, word_id=words[1].id, learning_mode="review", is_correct=True, created_at=last),
        LearningRecord(user_id=s1.id, word_id=words[1].id, learning_mode="review", is_correct=True,
                       created_at=last + timedelta(hours=1)),
    ])
    await db_session.commit()
    mine = (await client.get("/api/v1/student/content-homework", headers=_h(s1.id))).json()
    assert [m["status"] for m in mine] == ["completed"]
    link = (await db_session.execute(select(ContentHomeworkStudent))).scalar_one()
    assert link.completed_at == last
    plan = (await db_session.execute(select(DailyReviewPlan))).scalar_one()
    assert plan.completed_at == last


@pytest.mark.asyncio
async def test_video_completion_time_is_when_watched_not_when_seen(client, db_session):
    """昨天开放、昨晚看完的视频作业,今天早上才有人打开页面判到 —— 完成时刻是昨晚,
    不能在今日报告里算成「今天补做」"""
    u, _, video = await _setup(db_session)
    s1 = u["s1"]
    ids = await _assign(client, u["t"], "phonetic_video", video.id, [s1])
    hw = await db_session.get(ContentHomework, ids[0])
    hw.available_from -= timedelta(days=1)
    watched = hw.available_from + timedelta(hours=12)
    db_session.add(PhoneticVideoView(video_id=video.id, user_id=s1.id, watch_seconds=300,
                                     max_position_seconds=290, completed=True, last_viewed_at=watched))
    await db_session.commit()
    rep = await _report(client, s1)
    assert [x["kind"] for x in rep["tasks"]] == ["word"]
    link = (await db_session.execute(select(ContentHomeworkStudent))).scalar_one()
    assert link.completed_at == watched
