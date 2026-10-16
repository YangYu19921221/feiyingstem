"""音标兑换码「指定几节」: 一张码只开选中的一节或几节视频(2026-10-16)

此前一张音标码开的是**整个音标视频库**。现在发码时可以勾一节或多节,兑出来只开这几节:
- 开的那几节能换票、能串流、能翻讲义;别的节照旧锁着(列表 locked 按节判);
- 机构只能选本机构或平台预置的视频,别家的 404;平台 admin 不能混选两个机构的视频;
  学生兑不了别家机构视频的码;
- 已有整库永久权限 → 不用兑,且**不吞码**;全部下架 → 拒且不吞码;
- 多节码逐节给结果: 已开通的那节跳过、其余照开,码用掉;**每节都跳过才失败且不吞码**;
- 同一节重复兑 = 续期(与整库码同一套规则);
- 整库次卡 + 这一节另有永久单节授权 → 看这一节不扣整库次卡;
- 删视频 → 单节授权删掉、未使用码里这节的明细删掉,删光的码作废 ——
  **码不能因为明细删光就退化成整库码**(id 会被 SQLite 回收给下一条新视频)。

每条断言都配一处可破坏的守卫:破坏它 → 对应用例失败,这才算回归锁。
"""
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.config import settings
from app.core.timeutil import utc_now
from app.models.phonetic import (
    PhoneticAccessGrant, PhoneticCode, PhoneticCodeVideo, PhoneticVideo, PhoneticVideoGrant,
)
from app.models.user import User
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

GEN = "/api/v1/admin/subscriptions/phonetic-codes/generate"


@pytest.fixture(autouse=True)
def _reset_process_state():
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def env(db_session, monkeypatch, tmp_path):
    """甲(9941)/乙(9942)两机构都是需码模式;甲三节、乙一节、平台预置一节,文件真落盘。"""
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for key in ("a1", "a2", "a3", "b1", "preset"):
        (vdir / f"{key}.mp4").write_bytes(f"FAKE-MP4-{key}-".encode() * 64)

    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations "
        "(id, name, code, status, access_mode, phonetic_access_mode) VALUES "
        "(9941, '甲', 'svorga', 'active', 'assigned', 'code'), "
        "(9942, '乙', 'svorgb', 'active', 'assigned', 'code')"
    ))
    users = {}
    for key, uname, role, org in [
        ("stuA", "svstua", "student", 9941),
        ("stuA2", "svstuaa", "student", 9941),
        ("stuB", "svstub", "student", 9942),
        ("teacherA", "svtcha", "teacher", 9941),
        ("oaA", "svoadma", "org_admin", 9941),
        ("admin", "svadmin", "admin", 9941),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    vids = {}
    for key, org in [("a1", 9941), ("a2", 9941), ("a3", 9941), ("b1", 9942), ("preset", None)]:
        v = PhoneticVideo(
            title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org,
        )
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()
    return {
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "uid": {k: u.id for k, u in users.items()},
        "vid": vids,
    }


async def _gen(client: AsyncClient, tok: str, *, video_ids=None, grant_type="permanent",
               grant_days=None, grant_times=None):
    body = {"count": 1, "grant_type": grant_type}
    if video_ids is not None:
        body["video_ids"] = video_ids
    if grant_days is not None:
        body["grant_days"] = grant_days
    if grant_times is not None:
        body["grant_times"] = grant_times
    return await client.post(GEN, headers=_h(tok), json=body)


async def _code(client: AsyncClient, tok: str, **kw) -> str:
    r = await _gen(client, tok, **kw)
    assert r.status_code == 200, r.text
    return r.json()[0]["code"]


async def _redeem(client: AsyncClient, tok: str, code: str) -> dict:
    r = await client.post("/api/v1/subscription/redeem", headers=_h(tok), json={"code": code})
    assert r.status_code == 200, r.text
    return r.json()


async def _ticket(client: AsyncClient, tok: str, vid: int):
    return await client.get(f"/api/v1/phonetics/videos/{vid}/ticket", headers=_h(tok))


async def _locked_map(client: AsyncClient, tok: str) -> dict:
    r = await client.get("/api/v1/phonetics/videos", headers=_h(tok))
    assert r.status_code == 200, r.text
    return {v["id"]: v["locked"] for v in r.json()}


async def _code_row(db_session, code: str) -> PhoneticCode:
    db_session.expire_all()
    return (await db_session.execute(
        select(PhoneticCode).where(PhoneticCode.code == code))).scalar_one()


# ---------- 核心: 只开选中的那几节 ----------

async def test_single_video_code_unlocks_only_that_video(client: AsyncClient, env):
    """守卫: _enforce_gate / _locked_ids 按 video_id 判(只认整库授权的话,兑完仍全锁)。"""
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"]])
    res = await _redeem(client, tok, code)
    assert res["success"] is True, res
    assert res["video_ids"] == [vid["a1"]]
    assert "video-a1" in res["message"]

    assert (await _ticket(client, tok, vid["a1"])).status_code == 200
    assert (await _ticket(client, tok, vid["a2"])).status_code == 403
    assert (await _ticket(client, tok, vid["preset"])).status_code == 403

    locked = await _locked_map(client, tok)
    assert locked[vid["a1"]] is False
    assert locked[vid["a2"]] is True and locked[vid["preset"]] is True

    # 详情同口径(锁住的那节不记观看)
    d = await client.get(f"/api/v1/phonetics/videos/{vid['a2']}", headers=_h(tok))
    assert d.json()["locked"] is True
    d = await client.get(f"/api/v1/phonetics/videos/{vid['a1']}", headers=_h(tok))
    assert d.json()["locked"] is False


async def test_multi_video_code_unlocks_all_picked_and_nothing_else(client: AsyncClient, env):
    """一张码勾两节(本机构一节 + 平台预置一节): 两节都开,第三节照旧锁。"""
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"], vid["preset"]])
    res = await _redeem(client, tok, code)
    assert res["success"] is True, res
    assert sorted(res["video_ids"]) == sorted([vid["a1"], vid["preset"]])
    assert "2 节" in res["message"]

    locked = await _locked_map(client, tok)
    assert locked[vid["a1"]] is False and locked[vid["preset"]] is False
    assert locked[vid["a2"]] is True and locked[vid["a3"]] is True
    assert (await _ticket(client, tok, vid["preset"])).status_code == 200
    assert (await _ticket(client, tok, vid["a2"])).status_code == 403


async def test_single_video_grant_does_not_leak_to_classmate(client: AsyncClient, env):
    """一人一节一行: 同班同学不跟着解锁。"""
    vid = env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"]])
    assert (await _redeem(client, env["tok"]["stuA"], code))["success"] is True
    assert (await _ticket(client, env["tok"]["stuA2"], vid["a1"])).status_code == 403


async def test_single_video_code_opens_its_materials_and_stream(client: AsyncClient, env):
    """讲义列表、Bearer 串流也按节判: 开的那节放行、别的节 403。
    守卫: list_video_materials / stream_video 把 video_id 传进 _enforce_gate。"""
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"]])
    assert (await _redeem(client, tok, code))["success"] is True

    ok = await client.get(f"/api/v1/phonetics/videos/{vid['a1']}/materials", headers=_h(tok))
    assert ok.status_code == 200 and ok.json() == []
    no = await client.get(f"/api/v1/phonetics/videos/{vid['a2']}/materials", headers=_h(tok))
    assert no.status_code == 403

    s = await client.get(f"/api/v1/phonetics/videos/{vid['a1']}/stream", headers=_h(tok))
    assert s.status_code in (200, 206)
    s = await client.get(f"/api/v1/phonetics/videos/{vid['a2']}/stream", headers=_h(tok))
    assert s.status_code == 403


async def test_library_code_still_opens_everything(client: AsyncClient, env, db_session):
    """整库码(不传 video_ids)行为不变: 兑完全部解锁,不写单节授权行,scope 记 library。"""
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"])
    assert (await _code_row(db_session, code)).scope == "library"
    res = await _redeem(client, tok, code)
    assert res["success"] is True and res.get("video_ids") is None
    locked = await _locked_map(client, tok)
    assert not any(locked.values())
    assert (await _ticket(client, tok, vid["a2"])).status_code == 200


# ---------- 归属: 机构不能选别家视频、admin 不能混选两个机构、学生兑不了别家视频的码 ----------

async def test_org_admin_cannot_code_other_org_video(client: AsyncClient, env):
    """守卫: resolve_code_videos 的归属判定(机构 = 本机构 + 平台预置)。"""
    admin, oa, vid = env["tok"]["admin"], env["tok"]["oaA"], env["vid"]
    r = await client.patch("/api/v1/admin/organizations/9941", headers=_h(admin),
                           json={"add_phonetic_codes": 5})
    assert r.status_code == 200, r.text

    # 混进一节别家的 → 整批 404,一张不发
    r = await _gen(client, oa, video_ids=[vid["a1"], vid["b1"]], grant_type="period", grant_days=30)
    assert r.status_code == 404, r.text
    r = await _gen(client, oa, video_ids=[vid["a1"], vid["a2"], vid["preset"]],
                   grant_type="period", grant_days=30)
    assert r.status_code == 200, r.text
    assert [v["title"] for v in r.json()[0]["videos"]] == ["video-a1", "video-a2", "video-preset"]
    assert r.json()[0]["scope"] == "videos"

    # 一张码算一张额度,不按节数算
    q = (await client.get("/api/v1/admin/subscriptions/phonetic-codes/quota",
                          headers=_h(oa))).json()
    assert q["phonetic_codes_used"] == 1

    # 视频列表同口径: 有本机构 + 预置,没有别家的
    lst = (await client.get("/api/v1/admin/subscriptions/phonetic-codes/videos",
                            headers=_h(oa))).json()
    ids = {v["id"] for v in lst}
    assert {vid["a1"], vid["a2"], vid["preset"]} <= ids
    assert vid["b1"] not in ids


async def test_admin_cannot_mix_two_orgs_videos(client: AsyncClient, env):
    """学生只属于一个机构,混选两家的码谁都兑不成 → 发码时就 400(预置可以和任一家混)。
    守卫: resolve_code_videos 的 `len(orgs) > 1`。"""
    admin, vid = env["tok"]["admin"], env["vid"]
    r = await _gen(client, admin, video_ids=[vid["a1"], vid["b1"]])
    assert r.status_code == 400 and "不同机构" in r.json()["detail"]
    r = await _gen(client, admin, video_ids=[vid["b1"], vid["preset"]])
    assert r.status_code == 200, r.text


async def test_student_cannot_redeem_code_for_other_org_video(client: AsyncClient, env, db_session):
    """平台 admin 能给任何机构的视频发平台码;甲的学生兑乙家视频的码要拒且不吞码。
    守卫: redeem_phonetic_code 里逐节判 `org_id != user.org_id`。"""
    code = await _code(client, env["tok"]["admin"], video_ids=[env["vid"]["b1"]])
    res = await _redeem(client, env["tok"]["stuA"], code)
    assert res["success"] is False and "不是你所在学校" in res["message"]
    assert (await _code_row(db_session, code)).status == "unused"
    # 乙的学生正常兑
    assert (await _redeem(client, env["tok"]["stuB"], code))["success"] is True


# ---------- 不吞码的拒绝 + 部分跳过 ----------

async def test_library_permanent_makes_video_code_unnecessary(client: AsyncClient, env, db_session):
    """已有整库永久 → 指定几节的码不用兑,码保持未使用(留着给别人)。"""
    tok, admin = env["tok"]["stuA"], env["tok"]["admin"]
    assert (await _redeem(client, tok, await _code(client, admin)))["success"] is True
    code = await _code(client, admin, video_ids=[env["vid"]["a1"], env["vid"]["a2"]])
    res = await _redeem(client, tok, code)
    assert res["success"] is False and "整个音标视频库" in res["message"]
    assert (await _code_row(db_session, code)).status == "unused"


async def test_partial_skip_still_opens_the_rest(client: AsyncClient, env, db_session):
    """a1 已永久开通,再兑 [a1, a2]: a1 跳过、a2 开通,码用掉(照单词本一码多书)。
    守卫: 逐节 reason,只在 all(reasons) 时整张拒。"""
    tok, admin, vid = env["tok"]["stuA"], env["tok"]["admin"], env["vid"]
    assert (await _redeem(client, tok, await _code(client, admin, video_ids=[vid["a1"]])))["success"]
    code = await _code(client, admin, video_ids=[vid["a1"], vid["a2"]])
    res = await _redeem(client, tok, code)
    assert res["success"] is True, res
    assert res["video_ids"] == [vid["a2"]]
    assert "没有重复开" in res["message"] and "video-a1" in res["message"]
    assert (await _code_row(db_session, code)).status == "used"
    assert (await _ticket(client, tok, vid["a2"])).status_code == 200


async def test_all_skipped_rejects_without_consuming(client: AsyncClient, env, db_session):
    tok, admin, vid = env["tok"]["stuA"], env["tok"]["admin"], env["vid"]
    assert (await _redeem(client, tok, await _code(
        client, admin, video_ids=[vid["a1"], vid["a2"]])))["success"]
    code = await _code(client, admin, video_ids=[vid["a2"], vid["a1"]])
    res = await _redeem(client, tok, code)
    assert res["success"] is False and "都已经开通" in res["message"]
    assert (await _code_row(db_session, code)).status == "unused"


async def test_inactive_video_code_rejected_without_consuming(client: AsyncClient, env, db_session):
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"]])
    v = await db_session.get(PhoneticVideo, vid["a1"])
    v.is_active = False
    await db_session.commit()
    res = await _redeem(client, tok, code)
    assert res["success"] is False and "下架" in res["message"]
    assert (await _code_row(db_session, code)).status == "unused"

    # 下架的视频也勾不进新码(学生兑了也看不到)
    r = await _gen(client, env["tok"]["admin"], video_ids=[vid["a1"], vid["a2"]])
    assert r.status_code == 400 and "下架" in r.json()["detail"]


# ---------- 续期 / 扣次卡 ----------

async def test_same_video_period_codes_extend(client: AsyncClient, env, db_session):
    """同一节兑两张包月码 = 续期(到期日往后接),只有一行授权。"""
    tok, admin, vid = env["tok"]["stuA"], env["tok"]["admin"], env["vid"]
    c1 = await _code(client, admin, video_ids=[vid["a1"]], grant_type="period", grant_days=30)
    c2 = await _code(client, admin, video_ids=[vid["a1"]], grant_type="period", grant_days=30)
    assert (await _redeem(client, tok, c1))["success"] is True
    res = await _redeem(client, tok, c2)
    assert res["success"] is True and "续期" in res["message"]

    db_session.expire_all()
    rows = (await db_session.execute(select(PhoneticVideoGrant).where(
        PhoneticVideoGrant.student_id == env["uid"]["stuA"]))).scalars().all()
    assert len(rows) == 1
    assert rows[0].expires_at - utc_now() > timedelta(days=58)


async def test_single_times_card_consumed_on_ticket(client: AsyncClient, env, db_session):
    """单节次卡: 看这一节当天扣一次,同天再看不扣。
    守卫: consume_times_if_needed 按放行的那条授权扣(只扣整库表的话这条永远不掉)。"""
    tok, vid = env["tok"]["stuA"], env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a1"]],
                       grant_type="times", grant_times=3)
    assert (await _redeem(client, tok, code))["success"] is True

    async def _left() -> int:
        db_session.expire_all()
        return (await db_session.execute(select(PhoneticVideoGrant.times_left).where(
            PhoneticVideoGrant.student_id == env["uid"]["stuA"]))).scalar_one()

    assert await _left() == 3
    assert (await _ticket(client, tok, vid["a1"])).status_code == 200
    assert await _left() == 2
    assert (await _ticket(client, tok, vid["a1"])).status_code == 200
    assert await _left() == 2


async def test_library_times_not_consumed_when_single_permanent_covers(
    client: AsyncClient, env, db_session,
):
    """整库次卡 + 这一节另有永久单节授权: 看这一节不扣整库次卡;看别的节照扣。
    守卫: pick_grant 优先选今天不用扣的那条。"""
    tok, admin, vid, uid = env["tok"]["stuA"], env["tok"]["admin"], env["vid"], env["uid"]["stuA"]
    assert (await _redeem(client, tok, await _code(client, admin, video_ids=[vid["a1"]])))["success"]
    assert (await _redeem(client, tok, await _code(
        client, admin, grant_type="times", grant_times=5)))["success"]

    async def _lib_left() -> int:
        db_session.expire_all()
        return (await db_session.execute(select(PhoneticAccessGrant.times_left).where(
            PhoneticAccessGrant.student_id == uid))).scalar_one()

    assert (await _ticket(client, tok, vid["a1"])).status_code == 200
    assert await _lib_left() == 5
    assert (await _ticket(client, tok, vid["a2"])).status_code == 200
    assert await _lib_left() == 4


# ---------- 删视频: id 会被回收,单节授权和未用码必须跟着走 ----------

async def test_delete_video_drops_grants_and_trims_unused_codes(
    client: AsyncClient, env, db_session,
):
    """守卫: delete_video 里的 forget_videos。"""
    vid = env["vid"]
    admin = env["tok"]["admin"]
    used = await _code(client, admin, video_ids=[vid["a1"]])
    only_a1 = await _code(client, admin, video_ids=[vid["a1"]])
    a1_and_a2 = await _code(client, admin, video_ids=[vid["a1"], vid["a2"]])
    assert (await _redeem(client, env["tok"]["stuA"], used))["success"] is True

    r = await client.delete(f"/api/v1/teacher/phonetics/videos/{vid['a1']}",
                            headers=_h(env["tok"]["teacherA"]))
    assert r.status_code == 204, r.text

    db_session.expire_all()
    left = (await db_session.execute(select(PhoneticVideoGrant).where(
        PhoneticVideoGrant.video_id == vid["a1"]))).scalars().all()
    assert left == []
    assert (await _code_row(db_session, only_a1)).status == "disabled"   # 一节不剩 → 作废
    assert (await _code_row(db_session, used)).status == "used"          # 兑换凭证不动

    # 两节的那张只剩 a2,仍是 videos 码 —— 兑了只开 a2
    row = await _code_row(db_session, a1_and_a2)
    assert row.status == "unused" and row.scope == "videos"
    res = await _redeem(client, env["tok"]["stuA2"], a1_and_a2)
    assert res["success"] is True and res["video_ids"] == [vid["a2"]]
    locked = await _locked_map(client, env["tok"]["stuA2"])
    assert locked[vid["a2"]] is False and locked[vid["a3"]] is True


async def test_emptied_code_never_becomes_library_code(client: AsyncClient, env, db_session):
    """明细删光的码即使状态被手动改回 unused,也只能是「开的视频已删除」,绝不能退化成整库码。
    守卫: 兑换按 scope 列分支,不拿「有没有明细」来推范围。"""
    vid = env["vid"]
    code = await _code(client, env["tok"]["admin"], video_ids=[vid["a3"]])
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-delete",
                          headers=_h(env["tok"]["teacherA"]), json={"ids": [vid["a3"]]})
    assert r.status_code == 200 and r.json()["deleted"] == 1
    row = await _code_row(db_session, code)
    assert row.status == "disabled"
    row.status = "unused"
    await db_session.commit()

    res = await _redeem(client, env["tok"]["stuA"], code)
    assert res["success"] is False and "已被删除" in res["message"]
    locked = await _locked_map(client, env["tok"]["stuA"])
    assert all(locked.values())


async def test_batch_delete_also_forgets(client: AsyncClient, env, db_session):
    vid = env["vid"]
    admin = env["tok"]["admin"]
    code = await _code(client, admin, video_ids=[vid["a2"]])
    assert (await _redeem(client, env["tok"]["stuA"], await _code(
        client, admin, video_ids=[vid["a2"]])))["success"] is True
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-delete",
                          headers=_h(env["tok"]["teacherA"]), json={"ids": [vid["a2"]]})
    assert r.status_code == 200 and r.json()["deleted"] == 1
    db_session.expire_all()
    assert (await db_session.execute(select(PhoneticVideoGrant).where(
        PhoneticVideoGrant.video_id == vid["a2"]))).scalars().all() == []
    assert (await _code_row(db_session, code)).status == "disabled"


# ---------- 码列表 ----------

async def test_code_list_shows_videos_and_searches_titles(client: AsyncClient, env):
    admin = env["tok"]["admin"]
    await _code(client, admin, video_ids=[env["vid"]["a1"], env["vid"]["a2"]])
    await _code(client, admin)
    r = await client.get("/api/v1/admin/subscriptions/phonetic-codes",
                         headers=_h(admin), params={"search": "video-a2"})
    body = r.json()
    assert body["total"] == 1
    assert body["codes"][0]["scope"] == "videos"
    assert [v["title"] for v in body["codes"][0]["videos"]] == ["video-a1", "video-a2"]

    full = (await client.get("/api/v1/admin/subscriptions/phonetic-codes",
                             headers=_h(admin))).json()
    lib = [c for c in full["codes"] if c["scope"] == "library"]
    assert len(lib) == 1 and lib[0]["videos"] == []


async def test_delete_code_removes_its_video_rows(client: AsyncClient, env, db_session):
    """生产 FK 是关的,ON DELETE CASCADE 不生效 —— 删码必须显式删明细,否则孤儿行会挂到回收 id 的新码上。"""
    admin = env["tok"]["admin"]
    r = await _gen(client, admin, video_ids=[env["vid"]["a1"]])
    code_id = r.json()[0]["id"]
    d = await client.delete(f"/api/v1/admin/subscriptions/phonetic-codes/{code_id}", headers=_h(admin))
    assert d.status_code == 200, d.text
    db_session.expire_all()
    assert (await db_session.execute(select(PhoneticCodeVideo).where(
        PhoneticCodeVideo.code_id == code_id))).scalars().all() == []
