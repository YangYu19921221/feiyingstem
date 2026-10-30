"""音标视频「只能在电教室看」(2026-10-30)。规则真源 services/classroom_net.py。

每条用例配一处可破坏的守卫(写在用例说明里): 破坏它 → 对应用例失败,这才算回归锁。
IP 一律用 X-Real-IP 头模拟(生产是 nginx 写的)。
"""
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text as sql_text, update

from app.core import tenancy
from app.core.config import settings
from app.core.timeutil import local_today, utc_now
from app.models.classroom_net import ClassroomDeviceIp, ClassroomHomeAllow
from app.models.phonetic import PhoneticAccessGrant, PhoneticVideo
from app.models.user import Class, ClassStudent, User
from app.services import classroom_net as cn
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

SCHOOL = "182.245.66.142"
SCHOOL_NEW = "182.245.66.249"
HOME = "39.130.49.152"


@pytest.fixture(autouse=True)
def _reset():
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    cn.reset_cache()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    cn.reset_cache()


def _h(tok: str, ip: str = HOME, key: str | None = None, **extra) -> dict:
    h = {"Authorization": f"Bearer {tok}", "X-Real-IP": ip}
    if key:
        h["X-EH-Classroom"] = key
    h.update(extra)
    return h


@pytest_asyncio.fixture
async def env(db_session, monkeypatch, tmp_path):
    """甲(9931)/乙(9932)两个机构。甲: 机构管理员、老师(带一个班: 学生 s1)、学生 s1 / s2(不在班);乙: 学生 b1。
    甲乙各一个视频 + 一个平台预置视频,文件真落盘"""
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for k in ("vA", "vB", "preset"):
        (vdir / f"{k}.mp4").write_bytes(f"FAKE-{k}-".encode() * 64)
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode, phonetic_access_mode) VALUES "
        "(9931, '甲', 'cneta', 'active', 'assigned', 'open'), "
        "(9932, '乙', 'cnetb', 'active', 'assigned', 'open')"
    ))
    users = {}
    for key, role, org in [("orgA", "org_admin", 9931), ("tA", "teacher", 9931), ("s1", "student", 9931),
                           ("s2", "student", 9931), ("b1", "student", 9932), ("orgB", "org_admin", 9932)]:
        u = User(username=f"cnet{key.lower()}", email=f"cnet{key.lower()}@e.com", hashed_password="x",
                 role=role, full_name=f"名{key}", is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    c = Class(name="一班", teacher_id=users["tA"].id, org_id=9931)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=users["s1"].id, is_active=True))
    vids = {}
    for k, org in [("vA", 9931), ("vB", 9932), ("preset", None)]:
        v = PhoneticVideo(title=f"v-{k}", file_path=f"{k}.mp4", mime_type="video/mp4",
                          category="vowel", is_active=True, org_id=org)
        db_session.add(v)
        await db_session.flush()
        vids[k] = v.id
    await db_session.commit()
    return {"tok": {k: _make_token(u.id) for k, u in users.items()},
            "uid": {k: u.id for k, u in users.items()}, "vid": vids}


async def _register(client, tok, ip, name="电教室 1 号机") -> str:
    r = await client.post("/api/v1/phonetics/classroom-net/devices", headers=_h(tok, ip), json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["key"]


async def _turn_on(client, env, ip=SCHOOL) -> str:
    key = await _register(client, env["tok"]["orgA"], ip)
    r = await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["orgA"], ip),
                         json={"mode": "classroom"})
    assert r.status_code == 200, r.text
    return key


async def _ticket(client, tok, vid, ip, **kw):
    return await client.get(f"/api/v1/phonetics/videos/{vid}/ticket", headers=_h(tok, ip, **kw))


# ---------- 默认不限 ----------

async def test_default_any_mode_watches_anywhere(client: AsyncClient, env):
    """没打开开关 = 上线零变化: 学生在家照常能换票。守卫: watch_place 里 `org_mode != classroom → ok`"""
    r = await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)
    assert r.status_code == 200, r.text


# ---------- 打开后在家拦、在电教室放 ----------

async def test_classroom_mode_blocks_home_and_allows_school(client: AsyncClient, env):
    """守卫: _enforce_gate 里的 `_place_ok`(去掉 → 在家也 200)"""
    await _turn_on(client, env)
    r = await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "classroom_only"
    r = await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)
    assert r.status_code == 200, r.text
    # 平台预置视频同样受限
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["preset"], HOME)).status_code == 403


async def test_x_forwarded_for_is_not_trusted(client: AsyncClient, env):
    """客户端自己填 X-Forwarded-For 冒充学校 IP 不行。守卫: client_ip 只读 X-Real-IP"""
    await _turn_on(client, env)
    r = await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME,
                      **{"X-Forwarded-For": SCHOOL})
    assert r.status_code == 403


async def test_list_and_detail_mark_place_locked(client: AsyncClient, env):
    """列表 / 详情带 place_locked,在家打开详情不记观看次数"""
    await _turn_on(client, env)
    r = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["s1"], HOME))
    assert r.status_code == 200
    assert r.json() and all(v["place_locked"] for v in r.json())
    r = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["s1"], SCHOOL))
    assert not any(v["place_locked"] for v in r.json())
    d = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}", headers=_h(env["tok"]["s1"], HOME))
    assert d.json()["place_locked"] is True and d.json()["view_count"] == 0


async def test_materials_also_blocked_at_home(client: AsyncClient, env):
    """讲义是视频的一部分,在家也不给(否则逐页翻讲义绕开)。守卫: list_video_materials 传 request 进 _enforce_gate"""
    await _turn_on(client, env)
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/materials", headers=_h(env["tok"]["s1"], HOME))
    assert r.status_code == 403
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/materials", headers=_h(env["tok"]["s1"], SCHOOL))
    assert r.status_code == 200


async def test_stream_rechecks_place_on_ticket(client: AsyncClient, env):
    """在学校换的票,拿回家放(?t=)也 403。守卫: stream_video 票据分支的 `_place_ok`"""
    await _turn_on(client, env)
    r = await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)
    url = r.json()["url"]
    ok = await client.get(url, headers={"X-Real-IP": SCHOOL, "Range": "bytes=0-9"})
    assert ok.status_code == 206
    bad = await client.get(url, headers={"X-Real-IP": HOME, "Range": "bytes=0-9"})
    assert bad.status_code == 403


async def test_staff_never_place_restricted(client: AsyncClient, env):
    """老师在家备课照常能看。守卫: watch_place 里 `user.role != student → ok`"""
    await _turn_on(client, env)
    assert (await _ticket(client, env["tok"]["tA"], env["vid"]["vA"], HOME)).status_code == 200


async def test_times_card_not_consumed_when_away(client: AsyncClient, env, db_session):
    """在家被拦的那次不扣次卡。守卫: _enforce_gate 先判地点再扣(顺序反了 → 2 变 1)"""
    await db_session.execute(sql_text(
        "UPDATE organizations SET phonetic_access_mode='code' WHERE id=9931"))
    db_session.add(PhoneticAccessGrant(student_id=env["uid"]["s1"], grant_type="times", times_left=2))
    await db_session.commit()
    tenancy.invalidate_org_cache()
    await _turn_on(client, env)
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)).status_code == 403
    g = (await db_session.execute(select(PhoneticAccessGrant).where(
        PhoneticAccessGrant.student_id == env["uid"]["s1"]))).scalar_one()
    await db_session.refresh(g)
    assert g.times_left == 2
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)).status_code == 200
    await db_session.refresh(g)
    assert g.times_left == 1


# ---------- 学校换 IP ----------

async def test_device_header_counts_and_reports_new_ip(client: AsyncClient, env):
    """学校换了出网 IP: 电教室电脑带设备码的请求直接算在电教室,并把新 IP 记下来 → 同一网络的学生跟着能看。
    守卫: at_classroom 里设备码那条 + touch_device 记 IP"""
    key = await _turn_on(client, env, SCHOOL)
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL_NEW)).status_code == 403
    # 电教室电脑上(不管谁登录、甚至没登录)报到
    r = await client.post("/api/v1/phonetics/classroom-net/ping",
                          headers={"X-Real-IP": SCHOOL_NEW, "X-EH-Classroom": key})
    assert r.status_code == 200, r.text
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL_NEW)).status_code == 200
    # 旧 IP 7 天内仍算(两条线路轮流出网)
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)).status_code == 200
    # 学生自己在电教室电脑上登录(带设备码): 直接放行
    assert (await _ticket(client, env["tok"]["s2"], env["vid"]["vA"], "1.2.3.4", key=key)).status_code == 200


async def test_old_ip_expires_after_keep_days(client: AsyncClient, env, db_session):
    """IP 只保留 7 天。守卫: classroom_ip_sources 里 `last_seen_at >= _keep_since()`"""
    await _turn_on(client, env, SCHOOL)
    await db_session.execute(update(ClassroomDeviceIp).values(
        last_seen_at=utc_now() - timedelta(days=cn.IP_KEEP_DAYS, minutes=1)))
    await db_session.commit()
    cn.reset_cache()
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)).status_code == 403


async def test_removed_device_no_longer_counts(client: AsyncClient, env):
    """移除电脑 → 它报过的 IP 立刻不算;它的设备码 ping 回 404。守卫: revoked_at IS NULL 两处"""
    key = await _turn_on(client, env, SCHOOL)
    s = (await client.get("/api/v1/phonetics/classroom-net", headers=_h(env["tok"]["orgA"], SCHOOL))).json()
    dev_id = s["devices"][0]["id"]
    # 开关开着时移除唯一一台电脑是允许的(之后用「今天临时加」或再登记)
    r = await client.delete(f"/api/v1/phonetics/classroom-net/devices/{dev_id}", headers=_h(env["tok"]["orgA"], SCHOOL))
    assert r.status_code == 200
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL)).status_code == 403
    r = await client.post("/api/v1/phonetics/classroom-net/ping", headers={"X-Real-IP": SCHOOL, "X-EH-Classroom": key})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "device_gone"


async def test_temp_net_counts_today_only(client: AsyncClient, env, db_session):
    """「今天先把这个网络算作电教室」只管今天。守卫: classroom_ip_sources 里 `day == local_today()`"""
    await _turn_on(client, env, SCHOOL)
    r = await client.post("/api/v1/phonetics/classroom-net/temp-net", headers=_h(env["tok"]["tA"], SCHOOL_NEW))
    assert r.status_code == 200 and r.json()["ip"] == SCHOOL_NEW
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL_NEW)).status_code == 200
    await db_session.execute(sql_text("UPDATE classroom_temp_nets SET day = :d"),
                             {"d": (local_today() - timedelta(days=1)).isoformat()})
    await db_session.commit()
    cn.reset_cache()
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], SCHOOL_NEW)).status_code == 403


# ---------- 机构隔离 ----------

async def test_other_org_classroom_ip_does_not_count(client: AsyncClient, env):
    """甲的电教室 IP 不是乙的电教室。守卫: classroom_ip_sources 里 `ClassroomDevice.org_id == org_id`"""
    await _turn_on(client, env, SCHOOL)
    await _register(client, env["tok"]["orgB"], "8.8.8.8", "乙电教室")
    r = await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["orgB"], "8.8.8.8"),
                         json={"mode": "classroom"})
    assert r.status_code == 200
    assert (await _ticket(client, env["tok"]["b1"], env["vid"]["vB"], SCHOOL)).status_code == 403
    assert (await _ticket(client, env["tok"]["b1"], env["vid"]["vB"], "8.8.8.8")).status_code == 200


async def test_other_org_device_key_does_not_count(client: AsyncClient, env):
    """拿甲的电教室设备码当乙的学生用,不放行。守卫: at_classroom 里 `device.org_id == org_id`"""
    keyA = await _turn_on(client, env, SCHOOL)
    await _register(client, env["tok"]["orgB"], "8.8.8.8", "乙电教室")
    await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["orgB"], "8.8.8.8"),
                     json={"mode": "classroom"})
    assert (await _ticket(client, env["tok"]["b1"], env["vid"]["vB"], HOME, key=keyA)).status_code == 403


# ---------- 开关 ----------

async def test_switch_needs_classroom_net_and_org_admin(client: AsyncClient, env):
    """没认出电教室网络不能打开(否则全机构都看不了);老师不能切开关。守卫: set_mode 的 409 / 403"""
    r = await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["orgA"], SCHOOL),
                         json={"mode": "classroom"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "no_classroom_net"
    await _register(client, env["tok"]["tA"], SCHOOL)
    r = await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["tA"], SCHOOL),
                         json={"mode": "classroom"})
    assert r.status_code == 403
    r = await client.put("/api/v1/phonetics/classroom-net/mode", headers=_h(env["tok"]["orgA"], SCHOOL),
                         json={"mode": "classroom"})
    assert r.status_code == 200


async def test_student_cannot_register_device(client: AsyncClient, env):
    """学生不能把自己家的电脑登记成电教室。守卫: _staff"""
    r = await client.post("/api/v1/phonetics/classroom-net/devices", headers=_h(env["tok"]["s1"], HOME),
                          json={"name": "我家"})
    assert r.status_code == 403
    r = await client.post("/api/v1/phonetics/classroom-net/temp-net", headers=_h(env["tok"]["s1"], HOME))
    assert r.status_code == 403


# ---------- 允许在家看 ----------

async def test_home_allow_lets_student_watch_at_home(client: AsyncClient, env, db_session):
    """守卫: watch_place 里 home_allowed;过期的不算(`until_day >= 今天`)"""
    await _turn_on(client, env)
    r = await client.put(f"/api/v1/phonetics/classroom-net/home-allows/{env['uid']['s1']}",
                         headers=_h(env["tok"]["tA"], HOME), json={"note": "请病假"})
    assert r.status_code == 200, r.text
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)).status_code == 200
    await db_session.execute(update(ClassroomHomeAllow).values(
        until_day=(local_today() - timedelta(days=1)).isoformat()))
    await db_session.commit()
    cn.reset_cache()
    assert (await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)).status_code == 403


async def test_teacher_can_only_allow_own_class(client: AsyncClient, env):
    """老师只能给本班孩子开;别机构的孩子 404。守卫: _check_student"""
    r = await client.put(f"/api/v1/phonetics/classroom-net/home-allows/{env['uid']['s2']}",
                         headers=_h(env["tok"]["tA"], HOME), json={})
    assert r.status_code == 403
    r = await client.put(f"/api/v1/phonetics/classroom-net/home-allows/{env['uid']['b1']}",
                         headers=_h(env["tok"]["orgA"], HOME), json={})
    assert r.status_code == 404
    # 机构管理员能给不在班的孩子开
    r = await client.put(f"/api/v1/phonetics/classroom-net/home-allows/{env['uid']['s2']}",
                         headers=_h(env["tok"]["orgA"], HOME), json={})
    assert r.status_code == 200


async def test_device_key_stored_hashed(client: AsyncClient, env, db_session):
    """库里只存设备码的散列"""
    key = await _register(client, env["tok"]["tA"], SCHOOL)
    row = (await db_session.execute(sql_text("SELECT key_hash FROM classroom_devices"))).scalar_one()
    assert row != key and row == cn.hash_key(key)


async def test_impact_lists_students_who_watched_outside(client: AsyncClient, env):
    """「最近在电教室以外看过的孩子」: 在家换过票的孩子在名单里"""
    await _ticket(client, env["tok"]["s1"], env["vid"]["vA"], HOME)
    await _register(client, env["tok"]["orgA"], SCHOOL)
    await _ticket(client, env["tok"]["s2"], env["vid"]["vA"], SCHOOL)
    r = await client.get("/api/v1/phonetics/classroom-net/impact", headers=_h(env["tok"]["orgA"], SCHOOL))
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()["items"]]
    assert env["uid"]["s1"] in ids and env["uid"]["s2"] not in ids
