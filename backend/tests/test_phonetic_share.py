"""直营音标视频给哪些机构看(2026-11-02,规则见 services/phonetic_share 文件头)

锁住的规矩:
1. 默认能看: 机构没动过开关就看得到直营的全部视频和讲义,包括以后直营新传的
2. 平台管理员关掉某家 → 那家一节都看不到(列表 / 详情 / 讲义 / 发码 / 兑码 / 布置作业);别的机构不受影响;
   两家开关不同时交替查也不串(租户安全网的条件不能把上一家的机构号缓存住)
3. 别的机构只能看直营的: 改 / 删 / 批量删 / 批量设讲师 / 换封面 / 改讲义一律 403;直营老师照样能改
4. 只有平台管理员能开关,改了记操作记录
5. 只有直营老师和平台管理员能上传音标视频,分校老师 403;列表告诉前端能不能传
"""
import io

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.config import settings
from app.models.audit import OperationLog
from app.models.phonetic import PhoneticMaterial, PhoneticVideo
from app.models.user import User
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio
T = "/api/v1/teacher/phonetics"
S = "/api/v1/phonetics"


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True)
def _reset():
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()


@pytest_asyncio.fixture
async def env(db_session, monkeypatch, tmp_path):
    """直营(org 1)两节 + 一份讲义;分校甲(9952)、乙(9953)各一节自己的。都 open 模式(不要码)。
    插机构时不写 phonetic_hq_videos —— 拿的就是列默认值(锁「默认能看」)"""
    tenancy.register_tenant_models()     # conftest 走 create_all 不走 init_db: 把租户安全网也挂上一起测
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for key in ("hq1", "hq2", "a1", "b1"):
        (vdir / f"{key}.mp4").write_bytes(f"FAKE-MP4-{key}-".encode() * 64)
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode, phonetic_access_mode, "
        "phonetic_code_quota) VALUES "
        "(1, '飞鹰直营', 'shhq', 'active', 'assigned', 'open', NULL), "
        "(9952, '会泽分校', 'shsuba', 'active', 'assigned', 'open', 50), "
        "(9953, '罗平分校', 'shsubb', 'active', 'assigned', 'open', 50)"))
    users = {}
    for key, role, org in [("hqT", "teacher", 1), ("aT", "teacher", 9952), ("aS", "student", 9952),
                           ("aOA", "org_admin", 9952), ("bT", "teacher", 9953), ("bS", "student", 9953),
                           ("admin", "admin", 1)]:
        u = User(username=f"sh{key.lower()}", email=f"sh{key.lower()}@e.com", hashed_password="x",
                 role=role, full_name=f"sh{key}", is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    vids = {}
    for key, org in (("hq1", 1), ("hq2", 1), ("a1", 9952), ("b1", 9953)):
        v = PhoneticVideo(title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
                          category="vowel", is_active=True, org_id=org)
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    # 先给分校的视频挂几份讲义,让直营那份讲义的 id 和视频 id 对不上(对上了测不出安全网按哪一列放行)
    for i in range(3):
        db_session.add(PhoneticMaterial(video_id=vids["a1"], title=f"甲{i}", kind="pdf", file_path=f"s{i}.pdf",
                                        page_count=1, render_ready=True, is_active=True, org_id=9952))
    await db_session.flush()
    db_session.add(PhoneticMaterial(video_id=vids["hq1"], title="讲义", kind="pdf", file_path="m.pdf",
                                    page_count=2, render_ready=True, is_active=True, org_id=1))
    await db_session.commit()
    return {"tok": {k: _make_token(u.id) for k, u in users.items()},
            "uid": {k: u.id for k, u in users.items()}, "vid": vids}


async def _switch(client, env, org_id, enabled, who="admin"):
    return await client.put(f"{T}/share/orgs/{org_id}", headers=_h(env["tok"][who]), json={"enabled": enabled})


async def _student_ids(client, env, who):
    r = await client.get(f"{S}/videos", headers=_h(env["tok"][who]))
    assert r.status_code == 200, r.text
    return {v["id"] for v in r.json()}


async def test_default_on_then_admin_turns_one_org_off(client: AsyncClient, env):
    v = env["vid"]
    hq = {v["hq1"], v["hq2"]}
    assert await _student_ids(client, env, "aS") == hq | {v["a1"]}, "默认能看直营的"
    assert await _student_ids(client, env, "bS") == hq | {v["b1"]}
    mats = await client.get(f"{S}/videos/{v['hq1']}/materials", headers=_h(env["tok"]["aS"]))
    assert mats.status_code == 200 and len(mats.json()) == 1, "讲义跟着视频(租户安全网也要放行)"
    assert (await client.get(f"{S}/videos/{v['hq1']}/ticket", headers=_h(env["tok"]["aS"]))).status_code == 200

    r = await _switch(client, env, 9953, False)
    assert r.status_code == 200, r.text
    assert {o["id"]: o["enabled"] for o in r.json()["orgs"]} == {9952: True, 9953: False}
    # 两家开关不一样,交替查: 各看各的,不串
    for _ in range(2):
        assert await _student_ids(client, env, "bS") == {v["b1"]}, "关了的那家一节直营的都看不到"
        assert await _student_ids(client, env, "aS") == hq | {v["a1"]}, "没关的那家照旧"
    b = _h(env["tok"]["bS"])
    assert (await client.get(f"{S}/videos/{v['hq1']}", headers=b)).status_code == 404
    assert (await client.get(f"{S}/videos/{v['hq1']}/materials", headers=b)).status_code in (403, 404)
    bt = (await client.get(f"{T}/videos", headers=_h(env["tok"]["bT"]))).json()["items"]
    assert {x["id"] for x in bt} == {v["b1"]}

    await _switch(client, env, 9953, True)
    assert await _student_ids(client, env, "bS") == hq | {v["b1"]}, "打开后又看得到"


async def test_other_org_read_only_and_hq_can_edit(client: AsyncClient, env):
    v = env["vid"]
    hq1, a1 = v["hq1"], v["a1"]
    a = _h(env["tok"]["aT"])
    lst = (await client.get(f"{T}/videos", headers=a)).json()
    row = next(x for x in lst["items"] if x["id"] == hq1)
    assert row["can_edit"] is False and row["shared_from"] == "飞鹰直营"
    assert next(x for x in lst["items"] if x["id"] == a1)["shared_from"] is None
    assert (await client.put(f"{T}/videos/{hq1}", headers=a, json={"title": "改掉"})).status_code == 403
    assert (await client.delete(f"{T}/videos/{hq1}", headers=a)).status_code == 403
    assert (await client.post(f"{T}/videos/batch-delete", headers=a, json={"ids": [hq1, a1]})).status_code == 403
    assert (await client.post(f"{T}/videos/batch-lecturer", headers=a,
                              json={"ids": [hq1], "lecturer": "王老师"})).status_code == 403
    assert (await client.delete(f"{T}/videos/{hq1}/cover", headers=a)).status_code == 403
    mats = (await client.get(f"{T}/videos/{hq1}/materials", headers=a)).json()
    assert mats[0]["can_edit"] is False
    assert (await client.put(f"{T}/materials/{mats[0]['id']}", headers=a, json={"title": "x"})).status_code == 403
    assert (await client.delete(f"{T}/materials/{mats[0]['id']}", headers=a)).status_code == 403
    order = (await client.get(f"{T}/videos/order", headers=a, params={"category": "vowel"})).json()
    assert [x["id"] for x in order["items"]] == [a1] and order["preset_count"] == 2

    hq = _h(env["tok"]["hqT"])
    r = await client.put(f"{T}/videos/{hq1}", headers=hq, json={"title": "直营改的"})
    assert r.status_code == 200 and r.json()["title"] == "直营改的", "直营老师照样能改"
    hq_ids = {x["id"] for x in (await client.get(f"{T}/videos", headers=hq)).json()["items"]}
    assert hq_ids == {v["hq1"], v["hq2"]}, "直营看不到分校的视频"


async def test_only_admin_can_switch_and_it_is_logged(client: AsyncClient, env, db_session):
    assert (await _switch(client, env, 9952, False, who="hqT")).status_code == 403
    assert (await _switch(client, env, 9952, False, who="aOA")).status_code == 403
    assert (await client.get(f"{T}/share", headers=_h(env["tok"]["hqT"]))).status_code == 403
    assert (await _switch(client, env, 1, False)).status_code == 400
    assert env["vid"]["hq1"] in await _student_ids(client, env, "aS")
    r = await client.get(f"{T}/share", headers=_h(env["tok"]["admin"]))
    assert r.json()["hq_videos"] == 2 and all(o["enabled"] for o in r.json()["orgs"])
    assert (await _switch(client, env, 9952, False)).status_code == 200
    logs = (await db_session.execute(select(OperationLog).where(OperationLog.action == "phonetic.share"))).scalars().all()
    assert len(logs) == 1 and logs[0].target_id == 9952


async def _upload(client, env, who, name):
    return await client.post(f"{T}/videos/upload", headers=_h(env["tok"][who]),
                             data={"title": name, "category": "vowel", "lecturer": "王老师"},
                             files={"file": (f"{name}.mp4", io.BytesIO(b"\x00" * 2048), "video/mp4")})


async def test_only_hq_can_upload_and_new_hq_video_is_seen(client: AsyncClient, env):
    r = await _upload(client, env, "aT", "a-new")
    assert r.status_code == 403 and "直营" in r.text, r.text
    assert (await client.get(f"{T}/videos", headers=_h(env["tok"]["aT"]))).json()["can_upload"] is False
    assert (await client.get(f"{T}/videos", headers=_h(env["tok"]["hqT"]))).json()["can_upload"] is True
    assert (await client.get(f"{T}/videos", headers=_h(env["tok"]["admin"]))).json()["can_upload"] is True
    r = await _upload(client, env, "hqT", "hq-new")
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    assert new_id in await _student_ids(client, env, "aS"), "直营新传的分校马上看得到"
    await _switch(client, env, 9952, False)
    assert new_id not in await _student_ids(client, env, "aS")


async def test_codes_and_homework_follow_the_switch(client: AsyncClient, env, db_session):
    hq1, a1 = env["vid"]["hq1"], env["vid"]["a1"]
    oa = _h(env["tok"]["aOA"])
    gen = "/api/v1/admin/subscriptions/phonetic-codes/generate"
    body = {"count": 1, "grant_type": "period", "grant_days": 30, "video_ids": [hq1, a1]}   # 机构只能发包月卡
    opts = (await client.get("/api/v1/admin/subscriptions/phonetic-codes/videos", headers=oa)).json()
    row = next(x for x in opts if x["id"] == hq1)
    assert row["shared"] is True and row["org_id"] is None, "直营的和预置一样能混选"
    r = await client.post(gen, headers=oa, json=body)
    assert r.status_code == 200, r.text
    code = r.json()[0]["code"]
    await db_session.execute(sql_text("UPDATE organizations SET phonetic_access_mode='code' WHERE id=9952"))
    await db_session.commit()
    tenancy.invalidate_org_cache()
    stu = _h(env["tok"]["aS"])
    assert (await client.get(f"{S}/videos/{hq1}/ticket", headers=stu)).status_code == 403
    assert (await client.post("/api/v1/subscription/redeem", headers=stu, json={"code": code})).status_code == 200
    assert (await client.get(f"{S}/videos/{hq1}/ticket", headers=stu)).status_code == 200

    hw = {"kind": "phonetic_video", "target_ids": [hq1], "student_ids": [env["uid"]["aS"]]}
    assert (await client.post("/api/v1/teacher/content-homework", headers=_h(env["tok"]["aT"]), json=hw)).status_code == 200

    await _switch(client, env, 9952, False)
    assert (await client.post(gen, headers=oa, json=body)).status_code == 404, "关了就发不了直营的码"
    assert (await client.post("/api/v1/teacher/content-homework", headers=_h(env["tok"]["aT"]),
                              json=hw)).status_code in (400, 404), "关了就布置不了"
