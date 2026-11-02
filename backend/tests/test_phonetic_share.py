"""音标视频「共享给所有机构」(2026-11-02,规则见 services/phonetic_share 文件头)

锁住的规矩:
1. 开关关着: 别的机构看不到(和以前一样);平台 admin 在管理端打开后,直营的视频别的机构的学生 / 老师都看得到,
   讲义也跟着能看;打开以后直营新传的也是共享的;别的机构自己的视频不会被共享出去
2. 别的机构只能看: 改 / 删 / 批量删 / 批量设讲师 / 换封面 / 挂讲义一律 403;上传的机构照样能改
3. 只有平台 admin 能开关;关掉后别的机构又看不到
4. 发「指定几节」码: 共享的视频和本机构的能混选,别的机构的学生兑得了;布置视频作业也能选它
5. 租户安全网(tenancy 自动过滤)也认共享 —— 不然显式查询放行了,隐式过滤又把它和讲义挡掉
"""
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
    """直营(org 1)传了两节;子机构(9952)自己一节。子机构 open 模式(不要码)"""
    tenancy.register_tenant_models()     # conftest 走 create_all 不走 init_db: 把租户安全网也挂上一起测
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for key in ("hq1", "hq2", "sub1"):
        (vdir / f"{key}.mp4").write_bytes(f"FAKE-MP4-{key}-".encode() * 64)
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode, phonetic_access_mode, "
        "phonetic_code_quota) VALUES "
        "(1, '飞鹰直营', 'shhq', 'active', 'assigned', 'open', NULL), "
        "(9952, '会泽分校', 'shsub', 'active', 'assigned', 'open', 50)"))
    users = {}
    for key, role, org in [("hqT", "teacher", 1), ("subT", "teacher", 9952), ("subS", "student", 9952),
                           ("subOA", "org_admin", 9952), ("admin", "admin", 1)]:
        u = User(username=f"sh{key.lower()}", email=f"sh{key.lower()}@e.com", hashed_password="x",
                 role=role, full_name=f"sh{key}", is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    vids = {}
    for key, org in (("hq1", 1), ("hq2", 1), ("sub1", 9952)):
        v = PhoneticVideo(title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
                          category="vowel", is_active=True, org_id=org)
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    # 先给子机构自己那节挂几份,让直营那份讲义的 id 和视频 id 对不上(对上了测不出安全网按哪一列放行)
    for i in range(3):
        db_session.add(PhoneticMaterial(video_id=vids["sub1"], title=f"子{i}", kind="pdf", file_path=f"s{i}.pdf",
                                        page_count=1, render_ready=True, is_active=True, org_id=9952))
    await db_session.flush()
    db_session.add(PhoneticMaterial(video_id=vids["hq1"], title="讲义", kind="pdf", file_path="m.pdf",
                                    page_count=2, render_ready=True, is_active=True, org_id=1))
    await db_session.commit()
    return {"tok": {k: _make_token(u.id) for k, u in users.items()},
            "uid": {k: u.id for k, u in users.items()}, "vid": vids}


async def _share(client, env, shared=True, who="admin"):
    return await client.put(f"{T}/share", headers=_h(env["tok"][who]), json={"enabled": shared})


async def _student_ids(client, env):
    r = await client.get(f"{S}/videos", headers=_h(env["tok"]["subS"]))
    assert r.status_code == 200, r.text
    return {v["id"] for v in r.json()}


async def test_not_shared_is_invisible_then_visible_after_admin_shares(client: AsyncClient, env):
    hq1, hq2, sub1 = env["vid"]["hq1"], env["vid"]["hq2"], env["vid"]["sub1"]
    assert await _student_ids(client, env) == {sub1}, "没共享时别的机构看不到"
    assert (await client.get(f"{S}/videos/{hq1}", headers=_h(env["tok"]["subS"]))).status_code == 404

    r = await _share(client, env)
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["videos"] == 2, r.text
    assert await _student_ids(client, env) == {sub1, hq1, hq2}, "直营的全部共享"
    assert (await client.get(f"{S}/videos/{hq1}", headers=_h(env["tok"]["subS"]))).status_code == 200
    assert (await client.get(f"{S}/videos/{hq1}/ticket", headers=_h(env["tok"]["subS"]))).status_code == 200
    mats = await client.get(f"{S}/videos/{hq1}/materials", headers=_h(env["tok"]["subS"]))
    assert mats.status_code == 200 and len(mats.json()) == 1, "讲义跟着视频共享(租户安全网也要认)"

    # 别的机构的老师也看得到,标明是谁家的、只读
    lst = (await client.get(f"{T}/videos", headers=_h(env["tok"]["subT"]))).json()["items"]
    row = next(x for x in lst if x["id"] == hq1)
    assert row["can_edit"] is False and row["shared_from"] == "飞鹰直营"
    tm = await client.get(f"{T}/videos/{hq1}/materials", headers=_h(env["tok"]["subT"]))
    assert tm.status_code == 200 and tm.json()[0]["can_edit"] is False

    hq_lst = {x["id"] for x in (await client.get(f"{T}/videos", headers=_h(env["tok"]["hqT"]))).json()["items"]}
    assert sub1 not in hq_lst, "别的机构自己的视频不会被共享出去"
    all_rows = (await client.get(f"{T}/videos", headers=_h(env["tok"]["admin"]))).json()["items"]
    assert next(x for x in all_rows if x["id"] == sub1)["shared_all"] is False
    assert (await _share(client, env, shared=False)).json()["enabled"] is False
    assert await _student_ids(client, env) == {sub1}, "关掉后又看不到"


async def test_other_org_cannot_modify_shared_but_owner_can(client: AsyncClient, env):
    hq1, sub1 = env["vid"]["hq1"], env["vid"]["sub1"]
    await _share(client, env)
    sub = _h(env["tok"]["subT"])
    assert (await client.put(f"{T}/videos/{hq1}", headers=sub, json={"title": "改掉"})).status_code == 403
    assert (await client.delete(f"{T}/videos/{hq1}", headers=sub)).status_code == 403
    assert (await client.post(f"{T}/videos/batch-delete", headers=sub, json={"ids": [hq1, sub1]})).status_code == 403
    assert (await client.post(f"{T}/videos/batch-lecturer", headers=sub,
                              json={"ids": [hq1], "lecturer": "王老师"})).status_code == 403
    assert (await client.delete(f"{T}/videos/{hq1}/cover", headers=sub)).status_code == 403
    mid = (await client.get(f"{T}/videos/{hq1}/materials", headers=sub)).json()[0]["id"]
    assert (await client.put(f"{T}/materials/{mid}", headers=sub, json={"title": "x"})).status_code == 403
    assert (await client.delete(f"{T}/materials/{mid}", headers=sub)).status_code == 403
    # 子机构排序名单里没有它(只排自己的),提示里算进「排不了的」
    order = (await client.get(f"{T}/videos/order", headers=sub, params={"category": "vowel"})).json()
    assert [x["id"] for x in order["items"]] == [sub1] and order["preset_count"] == 2

    hq = _h(env["tok"]["hqT"])
    r = await client.put(f"{T}/videos/{hq1}", headers=hq, json={"title": "直营改的"})
    assert r.status_code == 200 and r.json()["title"] == "直营改的", "上传的机构照样能改"
    assert all(x["can_edit"] for x in (await client.get(f"{T}/videos", headers=hq)).json()["items"]
               if x["id"] in (env["vid"]["hq1"], env["vid"]["hq2"]))


async def test_only_admin_can_share_and_it_is_logged(client: AsyncClient, env, db_session):
    hq1 = env["vid"]["hq1"]
    assert (await _share(client, env, who="hqT")).status_code == 403
    assert (await _share(client, env, who="subT")).status_code == 403
    assert (await client.get(f"{T}/share", headers=_h(env["tok"]["hqT"]))).status_code == 403
    assert hq1 not in await _student_ids(client, env)
    assert (await _share(client, env)).status_code == 200
    logs = (await db_session.execute(select(OperationLog).where(OperationLog.action == "phonetic.share"))).scalars().all()
    assert len(logs) == 1 and '"enabled": true' in (logs[0].detail or "")


async def test_codes_can_mix_shared_with_own_and_redeem(client: AsyncClient, env, db_session):
    hq1, sub1 = env["vid"]["hq1"], env["vid"]["sub1"]
    oa = _h(env["tok"]["subOA"])
    gen = "/api/v1/admin/subscriptions/phonetic-codes/generate"
    body = {"count": 1, "grant_type": "period", "grant_days": 30, "video_ids": [hq1, sub1]}   # 机构只能发包月卡
    r0 = await client.post(gen, headers=oa, json=body)
    assert r0.status_code == 404, r0.text
    await _share(client, env)
    opts = (await client.get("/api/v1/admin/subscriptions/phonetic-codes/videos", headers=oa)).json()
    shared = next(x for x in opts if x["id"] == hq1)
    assert shared["shared"] is True and shared["org_id"] is None, "共享的和预置一样能混选"
    r = await client.post(gen, headers=oa, json=body)
    assert r.status_code == 200, r.text
    code = r.json()[0]["code"]
    await db_session.execute(sql_text("UPDATE organizations SET phonetic_access_mode='code' WHERE id=9952"))
    await db_session.commit()
    tenancy.invalidate_org_cache()
    stu = _h(env["tok"]["subS"])
    assert (await client.get(f"{S}/videos/{hq1}/ticket", headers=stu)).status_code == 403
    red = await client.post("/api/v1/subscription/redeem", headers=stu, json={"code": code})
    assert red.status_code == 200, red.text
    assert (await client.get(f"{S}/videos/{hq1}/ticket", headers=stu)).status_code == 200


async def test_content_homework_can_target_shared_video(client: AsyncClient, env):
    hq1 = env["vid"]["hq1"]
    body = {"kind": "phonetic_video", "target_ids": [hq1], "student_ids": [env["uid"]["subS"]]}
    sub = _h(env["tok"]["subT"])
    r = await client.post("/api/v1/teacher/content-homework", headers=sub, json=body)
    assert r.status_code in (400, 404), "没共享时布置不了"
    await _share(client, env)
    r = await client.post("/api/v1/teacher/content-homework", headers=sub, json=body)
    assert r.status_code == 200, r.text


async def test_video_uploaded_after_switch_on_is_shared(client: AsyncClient, env):
    """开关开着时直营新传的视频直接共享;别的机构新传的不共享;关掉连它一起收回"""
    import io
    await _share(client, env)

    async def up(who, name):
        r = await client.post(f"{T}/videos/upload", headers=_h(env["tok"][who]),
                              data={"title": name, "category": "vowel", "lecturer": "王老师"},
                              files={"file": (f"{name}.mp4", io.BytesIO(b"\x00" * 2048), "video/mp4")})
        assert r.status_code == 200, r.text
        return r.json()["id"]
    new_hq = await up("hqT", "hq-new")
    new_sub = await up("subT", "sub-new")
    assert new_hq in await _student_ids(client, env), "开着时直营新传的也共享"
    hq_lst = (await client.get(f"{T}/videos", headers=_h(env["tok"]["hqT"]))).json()["items"]
    assert new_sub not in {x["id"] for x in hq_lst}, "别的机构新传的不共享"
    await _share(client, env, shared=False)
    assert new_hq not in await _student_ids(client, env)
