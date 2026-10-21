"""句子 / 音标视频作业(2026-10-21)

1. 老师能把句子单元、音标视频布置给本机构学生;别家机构的学生、别家机构的内容都布置不了
2. 完成由服务端按真实学习数据判,不用前端报:
   - 句子: 作业开放后全部组过关才算(以前学过一遍不算)
   - 视频: phonetic_video_views.completed 就算
3. 关闭的作业学生端不显示;未开放的显示为 locked
4. 单词作业的口径不受影响(这类作业不进 homework_assignments)
"""
from datetime import datetime, timedelta

from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.content_homework import ContentHomeworkStudent
from app.models.learning import HomeworkAssignment
from app.models.phonetic import PhoneticVideo, PhoneticVideoView
from app.models.sentence import Sentence, SentenceBook, SentenceUnit
from app.models.sentence_learning import SentenceUnitProgress
from app.models.user import User
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _env(db):
    tenancy._org_cache.clear()
    await db.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(9961, '机构甲', 'cha', 'active', 'assigned'), (9962, '机构乙', 'chb', 'active', 'assigned')"))
    users = {}
    for key, role, org in [("t", "teacher", 9961), ("s1", "student", 9961), ("s2", "student", 9961),
                           ("other", "student", 9962), ("t2", "teacher", 9962)]:
        u = User(username=f"ch{key}", email=f"ch{key}@e.com", hashed_password="x", role=role,
                 full_name=f"ch{key}", is_active=True, org_id=org)
        db.add(u)
        await db.flush()
        users[key] = u
    book = SentenceBook(name="核心句型", is_public=True)            # 平台共享
    other_book = SentenceBook(name="乙家句子", is_public=True, org_id=9962)
    db.add_all([book, other_book])
    await db.flush()
    unit = SentenceUnit(book_id=book.id, unit_number=1, name="第一单元")
    other_unit = SentenceUnit(book_id=other_book.id, unit_number=1, name="乙单元")
    db.add_all([unit, other_unit])
    await db.flush()
    db.add(Sentence(unit_id=unit.id, english="Hi.", chinese="嗨", order_index=0))
    video = PhoneticVideo(title="元音 /æ/", file_path="x.mp4", category="vowel", is_active=True, org_id=None)
    db.add(video)
    await db.commit()
    return users, unit, other_unit, video


async def _assign(client, teacher, kind, target, students, **kw):
    return await client.post("/api/v1/teacher/content-homework", headers=_h(teacher.id), json={
        "kind": kind, "target_ids": [target], "student_ids": [s.id for s in students], **kw})


async def _mine(client, student):
    r = await client.get("/api/v1/student/content-homework", headers=_h(student.id))
    assert r.status_code == 200, r.text
    return r.json()


async def test_assign_sentence_and_complete_after_open(client, db_session):
    u, unit, _, _ = await _env(db_session)
    # 布置前就学过一遍(全部过关) —— 不能直接算这份作业完成
    db_session.add(SentenceUnitProgress(user_id=u["s1"].id, unit_id=unit.id, groups_passed=1,
                                        completed_at=datetime.utcnow() - timedelta(days=3),
                                        updated_at=datetime.utcnow() - timedelta(days=3)))
    await db_session.commit()
    r = await _assign(client, u["t"], "sentence", unit.id, [u["s1"], u["s2"]])
    assert r.status_code == 200, r.text
    mine = await _mine(client, u["s1"])
    assert len(mine) == 1 and mine[0]["status"] == "pending" and mine[0]["kind"] == "sentence"
    assert mine[0]["route"].endswith(f"/{unit.id}/learn")
    # 作业开放后重新全部过关 → 自动算完成,不用交作业
    p = (await db_session.execute(select(SentenceUnitProgress).where(
        SentenceUnitProgress.user_id == u["s1"].id))).scalar_one()
    p.updated_at = datetime.utcnow()
    await db_session.commit()
    assert (await _mine(client, u["s1"]))[0]["status"] == "completed"
    assert (await _mine(client, u["s2"]))[0]["status"] == "pending"
    # 老师端统计跟着走
    lst = (await client.get("/api/v1/teacher/content-homework", headers=_h(u["t"].id))).json()
    assert lst[0]["total"] == 2 and lst[0]["completed"] == 1 and lst[0]["target_name"] == "核心句型 · 第一单元"
    # 单词作业表一行没动
    assert (await db_session.execute(select(HomeworkAssignment))).first() is None


async def test_video_completed_counts(client, db_session):
    u, _, _, video = await _env(db_session)
    assert (await _assign(client, u["t"], "phonetic_video", video.id, [u["s1"]])).status_code == 200
    assert (await _mine(client, u["s1"]))[0]["status"] == "pending"
    db_session.add(PhoneticVideoView(video_id=video.id, user_id=u["s1"].id,
                                     watch_seconds=300, max_position_seconds=290, completed=True))
    await db_session.commit()
    got = (await _mine(client, u["s1"]))[0]
    assert got["status"] == "completed" and got["target_id"] == video.id
    st = (await client.get(f"/api/v1/teacher/content-homework/{got['homework_id']}/students",
                           headers=_h(u["t"].id))).json()
    assert st[0]["status"] == "completed"


async def test_cannot_assign_across_orgs(client, db_session):
    u, unit, other_unit, _ = await _env(db_session)
    # 别家机构的学生
    r = await _assign(client, u["t"], "sentence", unit.id, [u["other"]])
    assert r.status_code == 404
    # 别家机构的句子
    r = await _assign(client, u["t"], "sentence", other_unit.id, [u["s1"]])
    assert r.status_code == 404
    # 别的老师看不到、关不了、删不了这份作业
    ok = await _assign(client, u["t"], "sentence", unit.id, [u["s1"]])
    hid = ok.json()["homework_ids"][0]
    assert (await client.get(f"/api/v1/teacher/content-homework/{hid}/students",
                             headers=_h(u["t2"].id))).status_code == 404
    assert (await client.delete(f"/api/v1/teacher/content-homework/{hid}",
                                headers=_h(u["t2"].id))).status_code == 404


async def test_closed_hidden_and_future_locked(client, db_session):
    u, unit, _, video = await _env(db_session)
    tomorrow = (local_today() + timedelta(days=1)).isoformat()
    r = await _assign(client, u["t"], "phonetic_video", video.id, [u["s1"]], available_date=tomorrow)
    assert r.status_code == 200
    assert (await _mine(client, u["s1"]))[0]["status"] == "locked"
    r2 = await _assign(client, u["t"], "sentence", unit.id, [u["s1"]])
    hid = r2.json()["homework_ids"][0]
    await client.post(f"/api/v1/teacher/content-homework/{hid}/toggle-closed", headers=_h(u["t"].id))
    mine = await _mine(client, u["s1"])
    assert [m["kind"] for m in mine] == ["phonetic_video"]
    # 删除连带删学生分配
    await client.delete(f"/api/v1/teacher/content-homework/{hid}", headers=_h(u["t"].id))
    left = (await db_session.execute(select(ContentHomeworkStudent.homework_id))).scalars().all()
    assert hid not in left


async def test_targets_list_scoped_to_org(client, db_session):
    u, unit, other_unit, video = await _env(db_session)
    books = (await client.get("/api/v1/teacher/content-homework/targets?kind=sentence",
                              headers=_h(u["t"].id))).json()
    unit_ids = {x["id"] for b in books for x in b["units"]}
    assert unit.id in unit_ids and other_unit.id not in unit_ids
    vids = (await client.get("/api/v1/teacher/content-homework/targets?kind=phonetic_video",
                             headers=_h(u["t"].id))).json()
    assert video.id in {x["id"] for g in vids for x in g["units"]}
    # 学生不能调老师端
    assert (await client.get("/api/v1/teacher/content-homework", headers=_h(u["s1"].id))).status_code == 403
