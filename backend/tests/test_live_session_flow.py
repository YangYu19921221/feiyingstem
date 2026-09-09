"""直播核心链路端到端 —— 建房→开播签推流→学生进间签播放地址→考勤→回放可见性

此前直播只有 test_live_material_permission.py(纯逻辑单测,只覆盖课件权限和心跳封顶),
核心链路一条没测。这里补齐真实 HTTP + DB 的端到端:

1. 老师建课→开播,只有 start 端点吐 whip/rtmp 推流地址
2. 学生 join:响应含播放地址(flv/hls/webrtc)+ 水印,**绝不含推流地址/stream_key**
3. join 落考勤行;老师考勤表能看到该学生
4. 未开播的课学生 join 返回 409;别的班的课 403
5. 回放可见性:allow_replay + replay_ready 都满足才 replay_available
6. 源站未配置时 start 返回 503(前端据此隐藏入口)
"""
import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.live import LiveSession, LiveAttendance
from tests.conftest import _make_token


@pytest.fixture(autouse=True)
def _live_env(monkeypatch):
    """让 live_available() 为真:配好本地源站参数。不配 CDN(回退直连源站)。"""
    from app.core.config import settings
    monkeypatch.setattr(settings, "LIVE_ENABLED", True)
    monkeypatch.setattr(settings, "LIVE_ORIGIN_HOST", "localhost:8091")
    monkeypatch.setattr(settings, "LIVE_API_HOST", "localhost:1985")
    monkeypatch.setattr(settings, "LIVE_CDN_HOST", "")
    monkeypatch.setattr(settings, "LIVE_CDN_AUTH_KEY", "")


@pytest.fixture
async def live_fixture(db_session):
    """一个机构 + 老师 + 两个班(A 有学生甲、B 有学生乙)。"""
    tenancy._org_cache.clear()
    org = Organization(name="直播测试机构", code="LIVE01", status="active")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="live_t", email="live_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu_a = User(username="live_a", email="live_a@e.com", hashed_password="x",
                 role="student", full_name="学生甲", is_active=True, org_id=org.id)
    stu_b = User(username="live_b", email="live_b@e.com", hashed_password="x",
                 role="student", full_name="学生乙", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu_a, stu_b])
    await db_session.flush()

    cls_a = Class(name="A班", teacher_id=teacher.id, org_id=org.id)
    cls_b = Class(name="B班", teacher_id=teacher.id, org_id=org.id)
    db_session.add_all([cls_a, cls_b])
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls_a.id, student_id=stu_a.id, is_active=True))
    db_session.add(ClassStudent(class_id=cls_b.id, student_id=stu_b.id, is_active=True))
    await db_session.commit()
    return {"org": org, "teacher": teacher, "stu_a": stu_a, "stu_b": stu_b,
            "cls_a": cls_a, "cls_b": cls_b}


def _auth(user):
    return {"Authorization": f"Bearer {_make_token(user.id)}"}


@pytest.mark.asyncio
async def test_full_flow_push_only_to_teacher_play_only_to_student(
    client: AsyncClient, live_fixture, db_session
):
    """建课→开播(签推流,仅老师)→学生 join(签播放,不含推流)→落考勤→老师看考勤。"""
    f = live_fixture
    teacher, stu_a = f["teacher"], f["stu_a"]

    # 建课(绑 A 班)
    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "第一课", "class_id": f["cls_a"].id},
                          headers=_auth(teacher))
    assert r.status_code == 200, r.text
    sid = r.json()["id"]

    # 未开播时学生 join → 409
    r = await client.post(f"/api/v1/student/live/sessions/{sid}/join", headers=_auth(stu_a))
    assert r.status_code == 409

    # 开播:只有这里吐推流地址
    r = await client.post(f"/api/v1/teacher/live/sessions/{sid}/start", headers=_auth(teacher))
    assert r.status_code == 200, r.text
    push = r.json()
    assert push["whip_url"] and push["rtmp_url"] and push["stream_key"]

    # 学生 join:拿到播放地址+水印,**绝不含推流地址/stream_key**
    r = await client.post(f"/api/v1/student/live/sessions/{sid}/join", headers=_auth(stu_a))
    assert r.status_code == 200, r.text
    play = r.json()
    assert play["flv_url"] and play["hls_url"] and play["webrtc_url"]
    assert "学生甲" in play["watermark"]
    # 播放地址本就含 stream_key(拉流路径需要它),防转发靠"按人签发+短时过期票据",
    # 不是藏 stream_key。真正不能泄露的是**推流专用地址**:whip 推流端点、rtmp 推流。
    # 学生的 webrtc 是 whep(拉流),与 whip(推流)不同,不能用 "whip" 子串误伤。
    blob = " ".join(str(v) for v in play.values())
    assert "/whip/" not in blob, "播放响应泄露了 WHIP 推流端点!"
    assert "rtmp" not in blob.lower(), "播放响应含 RTMP 推流地址!"
    assert push["rtmp_url"] not in blob and push["whip_url"] not in blob

    # 落了考勤行
    att = (await db_session.execute(
        LiveAttendance.__table__.select().where(
            LiveAttendance.live_session_id == sid)
    )).fetchall()
    assert len(att) == 1

    # 老师考勤表看得到该学生
    r = await client.get(f"/api/v1/teacher/live/sessions/{sid}/attendance", headers=_auth(teacher))
    assert r.status_code == 200
    names = [row["name"] for row in r.json()]
    assert "学生甲" in names


@pytest.mark.asyncio
async def test_other_class_student_forbidden(client: AsyncClient, live_fixture):
    """绑了 A 班的课,B 班学生看不到、join 被 403。"""
    f = live_fixture
    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "A班专属", "class_id": f["cls_a"].id},
                          headers=_auth(f["teacher"]))
    sid = r.json()["id"]
    await client.post(f"/api/v1/teacher/live/sessions/{sid}/start", headers=_auth(f["teacher"]))

    r = await client.post(f"/api/v1/student/live/sessions/{sid}/join", headers=_auth(f["stu_b"]))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_teacher_cannot_start_others_session(client: AsyncClient, live_fixture, db_session):
    """别的老师不能开播我的课(否则能拿到推流密钥劫持直播)。"""
    f = live_fixture
    other = User(username="live_t2", email="live_t2@e.com", hashed_password="x",
                 role="teacher", full_name="李老师", is_active=True, org_id=f["org"].id)
    db_session.add(other)
    await db_session.commit()

    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "我的课"}, headers=_auth(f["teacher"]))
    sid = r.json()["id"]
    r = await client.post(f"/api/v1/teacher/live/sessions/{sid}/start", headers=_auth(other))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_replay_visibility(client: AsyncClient, live_fixture, db_session):
    """回放可见性:allow_replay 且 replay_ready 都满足才 replay_available=True。"""
    f = live_fixture
    # allow_replay=False 的课
    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "不许回放", "class_id": f["cls_a"].id,
                                "allow_replay": False},
                          headers=_auth(f["teacher"]))
    sid_no = r.json()["id"]
    # allow_replay=True 且已转码好的课
    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "可回放", "class_id": f["cls_a"].id},
                          headers=_auth(f["teacher"]))
    sid_yes = r.json()["id"]
    sess = await db_session.get(LiveSession, sid_yes)
    sess.replay_ready = True
    sess.status = "ended"
    await db_session.commit()

    r = await client.get("/api/v1/student/live/sessions", headers=_auth(f["stu_a"]))
    assert r.status_code == 200
    by_id = {s["id"]: s for s in r.json()}
    assert by_id[sid_yes]["replay_available"] is True
    assert by_id[sid_no]["replay_available"] is False


@pytest.mark.asyncio
async def test_start_returns_503_when_origin_unconfigured(
    client: AsyncClient, live_fixture, monkeypatch
):
    """源站未配置时开播返回 503(前端据此隐藏入口,而不是点进去报错)。"""
    from app.core.config import settings
    monkeypatch.setattr(settings, "LIVE_ORIGIN_HOST", "")
    f = live_fixture
    r = await client.post("/api/v1/teacher/live/sessions",
                          json={"title": "没源站"}, headers=_auth(f["teacher"]))
    sid = r.json()["id"]
    r = await client.post(f"/api/v1/teacher/live/sessions/{sid}/start", headers=_auth(f["teacher"]))
    assert r.status_code == 503
