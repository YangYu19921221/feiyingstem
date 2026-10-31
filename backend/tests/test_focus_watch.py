"""离开记录 / 摄像头同意 / 家长「今天」(2026-10-31)—— 规则真源 services/focus_watch.py

钉住的不变量:
1. 切出页面带时长的记一条(几点走、多久,封顶 4 小时);老页面不带时长只记次数;不满 5 秒不记
2. 摄像头离开(no_face)家长没同意一律 403;同意了满 10 秒才记
3. 家长打开要勾同意;只能管自己绑定的孩子;撤回后孩子那边马上关;删记录只删摄像头那部分
4. 老师登记纸质同意书要确认签了;只能本班;进操作记录
5. 家长「今天」: 作业数、切出次数和分钟、摄像头离开、卡住的词、正在学时的实时状态(含看不到人)
6. 离开记录留 180 天,写入时顺手删更早的
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.audit import OperationLog
from app.models.focus_watch import CameraConsent, CameraDayStatus, FocusAwayEvent
from app.models.learning import WordStuckEvent
from app.models.organization import Organization
from app.models.user import Class, ClassStudent, ParentStudentLink, StudyCalendar, User
from app.models.word import Word
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def scene(db_session):
    tenancy._org_cache.clear()
    await db_session.execute(sql_text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_test ON study_calendar(user_id, study_date)"))
    org = Organization(name="看在不在机构", code="FWT01", status="active")
    db_session.add(org)
    await db_session.flush()
    mk = lambda u, role, name: User(username=u, email=f"{u}@e.com", hashed_password="x", role=role,  # noqa: E731
                                    full_name=name, is_active=True, org_id=org.id)
    teacher, other_t = mk("fwteach", "teacher", "王老师"), mk("fwother", "teacher", "李老师")
    stu, stu2 = mk("fwstu", "student", "小明"), mk("fwstu2", "student", "小红")
    parent, stranger = mk("fwparent", "parent", "小明妈妈"), mk("fwstranger", "parent", "别人家长")
    db_session.add_all([teacher, other_t, stu, stu2, parent, stranger])
    await db_session.flush()
    cls = Class(name="一班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add_all([
        ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True),
        ParentStudentLink(parent_id=parent.id, student_id=stu.id),
    ])
    await db_session.commit()
    return db_session, teacher, other_t, stu, stu2, parent, stranger


async def _focus(client, stu, **body):
    return await client.post("/api/v1/student/presence/focus-event", headers=_h(stu.id), json=body)


async def _consent(client, parent, stu, enabled=True, agree=True):
    return await client.put(f"/api/v1/parent/children/{stu.id}/camera", headers=_h(parent.id),
                            json={"enabled": enabled, "agree": agree})


@pytest.mark.asyncio
async def test_switch_records_duration_old_clients_only_count(client, scene):
    db, _t, _o, stu, *_ = scene
    assert (await _focus(client, stu, kind="switch", away_ms=6 * 60_000, page="/student/units/3/classify")).status_code == 200
    assert (await _focus(client, stu, kind="switch")).status_code == 200                      # 老页面
    assert (await _focus(client, stu, kind="switch", away_ms=3_000)).status_code == 200        # 不满 5 秒
    assert (await _focus(client, stu, kind="switch", away_ms=99 * 3600_000)).status_code == 200  # 页面开着人走了
    rows = (await db.execute(select(FocusAwayEvent).where(FocusAwayEvent.user_id == stu.id)
                             .order_by(FocusAwayEvent.id))).scalars().all()
    assert [(r.kind, r.away_ms) for r in rows] == [("switch", 360_000), ("switch", 4 * 3600_000)]
    assert rows[0].page == "/student/units/3/classify"
    assert rows[0].left_at <= datetime.utcnow() - timedelta(minutes=5)
    cal = (await db.execute(select(StudyCalendar).where(StudyCalendar.user_id == stu.id))).scalar_one()
    await db.refresh(cal)
    assert cal.switch_count == 4


@pytest.mark.asyncio
async def test_no_face_needs_parent_consent(client, scene):
    db, _t, _o, stu, _s2, parent, _x = scene
    r = await _focus(client, stu, kind="no_face", away_ms=30_000)
    assert r.status_code == 403
    assert (await client.get("/api/v1/student/presence/camera", headers=_h(stu.id))).json()["enabled"] is False
    assert (await _consent(client, parent, stu)).status_code == 200
    assert (await client.get("/api/v1/student/presence/camera", headers=_h(stu.id))).json()["enabled"] is True
    assert (await _focus(client, stu, kind="no_face", away_ms=8_000)).status_code == 200   # 不满 10 秒
    assert (await _focus(client, stu, kind="no_face", away_ms=95_000)).status_code == 200
    rows = (await db.execute(select(FocusAwayEvent.kind, FocusAwayEvent.away_ms)
                             .where(FocusAwayEvent.user_id == stu.id))).all()
    assert rows == [("no_face", 95_000)]


@pytest.mark.asyncio
async def test_parent_consent_rules(client, scene):
    db, _t, _o, stu, stu2, parent, stranger = scene
    assert (await _consent(client, parent, stu, agree=False)).status_code == 400
    assert (await _consent(client, stranger, stu)).status_code == 403
    assert (await _consent(client, parent, stu2)).status_code == 403      # 不是自己的孩子
    r = await _consent(client, parent, stu)
    assert r.status_code == 200 and r.json()["consent"]["status"] == "granted"
    assert r.json()["consent"]["method"] == "parent"
    notice = (await client.get(f"/api/v1/parent/children/{stu.id}/camera", headers=_h(parent.id))).json()["notice"]
    assert "看在不在机构" in notice["sections"][0]["p"] and len(notice["sections"]) >= 5

    await _focus(client, stu, kind="no_face", away_ms=60_000)
    await _focus(client, stu, kind="switch", away_ms=60_000)
    r = await client.delete(f"/api/v1/parent/children/{stu.id}/camera/records", headers=_h(parent.id))
    assert r.json()["deleted"] == 1
    kinds = (await db.execute(select(FocusAwayEvent.kind).where(FocusAwayEvent.user_id == stu.id))).scalars().all()
    assert kinds == ["switch"]                                            # 切屏记录不归这个按钮删

    r = await _consent(client, parent, stu, enabled=False)
    assert r.json()["consent"]["status"] == "revoked"
    assert (await client.get("/api/v1/student/presence/camera", headers=_h(stu.id))).json()["enabled"] is False
    assert (await _focus(client, stu, kind="no_face", away_ms=60_000)).status_code == 403
    row = (await db.execute(select(CameraConsent).where(CameraConsent.student_id == stu.id))).scalar_one()
    await db.refresh(row)
    assert row.granted_at is not None and row.revoked_at is not None     # 同意那次的记录留着


@pytest.mark.asyncio
async def test_teacher_registers_paper_consent_for_own_class_only(client, scene):
    db, teacher, other_t, stu, *_ = scene
    url = f"/api/v1/teacher/camera-consents/{stu.id}"
    assert (await client.put(url, headers=_h(teacher.id), json={"enabled": True})).status_code == 400
    r = await client.put(url, headers=_h(other_t.id), json={"enabled": True, "paper_signed": True})
    assert r.status_code in (403, 404)
    r = await client.put(url, headers=_h(teacher.id), json={"enabled": True, "paper_signed": True})
    assert r.status_code == 200 and r.json()["consent"]["method"] == "paper"
    logs = (await db.execute(select(OperationLog).where(OperationLog.action == "camera.consent"))).scalars().all()
    assert len(logs) == 1 and logs[0].target_id == stu.id
    lst = (await client.get("/api/v1/teacher/parent-binding/students", headers=_h(teacher.id))).json()
    me = next(x for x in lst["items"] if x["id"] == stu.id)
    assert me["camera"]["status"] == "granted" and me["camera"]["method"] == "paper"


@pytest.mark.asyncio
async def test_parent_today_card(client, scene):
    db, _t, _o, stu, _s2, parent, _x = scene
    await _consent(client, parent, stu)
    await _focus(client, stu, kind="switch", away_ms=7 * 60_000)
    await _focus(client, stu, kind="switch", away_ms=40_000)
    await _focus(client, stu, kind="switch")            # 还没刷新的老页面: 只有次数没有时长
    await _focus(client, stu, kind="no_face", away_ms=3 * 60_000)
    await _focus(client, stu, kind="distracted")
    assert (await client.post("/api/v1/student/presence/camera-status", headers=_h(stu.id),
                              json={"status": "on"})).status_code == 200
    w = Word(word="because")
    db.add(w)
    await db.flush()
    db.add(WordStuckEvent(user_id=stu.id, word_id=w.id, study_date=local_today(), ms=48_000, outcome="gave_up"))
    await db.commit()
    # 孩子正在学,镜头里看不到人
    await client.post("/api/v1/student/presence/heartbeat", headers=_h(stu.id),
                      json={"visible": True, "idle": False, "unit_name": "Unit 3", "no_face": True})

    r = await client.get(f"/api/v1/parent/children/{stu.id}/today", headers=_h(parent.id))
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["switch"]["count"], d["switch"]["minutes"], d["switch"]["longest_minutes"]) == (3, 8, 7)
    assert [e["minutes"] for e in d["switch"]["episodes"]] == [7, 1]
    assert (d["no_face"]["count"], d["no_face"]["minutes"]) == (1, 3)
    assert d["distracted_count"] == 1
    assert d["stuck_words"] == [{"word": "because", "seconds": 48, "outcome": "gave_up"}]
    assert d["camera"]["active"] is True and d["camera"]["status_today"] == "on"
    assert d["live"]["status"] == "studying" and d["live"]["no_face"] is True
    assert d["live"]["unit_name"] == "Unit 3"
    assert (await client.get(f"/api/v1/parent/children/{stu.id}/today", headers=_h(_x.id))).status_code == 403


@pytest.mark.asyncio
async def test_camera_status_needs_consent_and_old_rows_are_purged(client, scene):
    db, _t, _o, stu, _s2, parent, _x = scene
    r = await client.post("/api/v1/student/presence/camera-status", headers=_h(stu.id), json={"status": "on"})
    assert r.status_code == 403
    await _consent(client, parent, stu)
    for st in ("denied", "on"):
        assert (await client.post("/api/v1/student/presence/camera-status", headers=_h(stu.id),
                                  json={"status": st})).status_code == 200
    rows = (await db.execute(select(CameraDayStatus.status).where(CameraDayStatus.user_id == stu.id))).scalars().all()
    assert rows == ["on"]

    old_day = local_today() - timedelta(days=200)
    db.add(FocusAwayEvent(user_id=stu.id, study_date=old_day, kind="switch",
                          left_at=datetime.utcnow() - timedelta(days=200), away_ms=60_000))
    db.add(FocusAwayEvent(user_id=stu.id, study_date=local_today() - timedelta(days=30), kind="switch",
                          left_at=datetime.utcnow() - timedelta(days=30), away_ms=60_000))
    await db.commit()
    await _focus(client, stu, kind="switch", away_ms=60_000)
    days = sorted((await db.execute(select(FocusAwayEvent.study_date)
                                    .where(FocusAwayEvent.user_id == stu.id))).scalars().all())
    assert old_day not in days and len(days) == 2
