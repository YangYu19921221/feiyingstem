"""音标视频/课件的防爬防泄露:播放票据、按人水印、速率上限

先把话说清楚:HTTPS 抓包在用户自己的设备上**防不住**。这里守的是三件能守的:
1. 抓到的东西**用处小**:视频 URL 里不再是整站会话 token(抄走 = 拿走账号),
   而是只能播这一个视频、两小时过期、当 Bearer 用直接签名失败的票据;
2. 抓到的东西**追得到人**:讲义每一页都烧着取图人的姓名 + ID;
3. **爬不快**:换票和翻页都有速率上限,脚本一秒几十页当场 429。
"""
import time

import pytest
import pytest_asyncio
from httpx import AsyncClient
from jose import jwt
from sqlalchemy import text as sql_text

from app.api.v1 import phonetics as ph
from app.core.config import settings
from app.services import rate_limit
from tests.test_phonetic_material import material_env, _pdf_bytes, _upload, _h  # noqa: F401

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    """限速桶是进程内状态,测试之间必须清,否则前一个用例把桶灌满、后一个莫名 429"""
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest_asyncio.fixture
async def media_env(material_env, monkeypatch, tmp_path):
    """在 material_env 之上把视频文件真放到磁盘上,串流端点才有东西可发"""
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for key in ("v1", "v2", "preset"):
        (vdir / f"{key}.mp4").write_bytes(f"FAKE-MP4-{key}-".encode() * 64)
    return material_env


async def _ticket(client: AsyncClient, token: str, video_id: int):
    r = await client.get(f"/api/v1/phonetics/videos/{video_id}/ticket", headers=_h(token))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 票据替代整站 token ----------

async def test_ticket_plays_and_session_token_in_url_is_dead(
        client: AsyncClient, media_env):
    """票据能播;**整站会话 token 放 URL 上不再好使**(这是之前的洞)"""
    env = media_env
    vid = env["vid"]["v1"]
    tk = await _ticket(client, env["tok"]["stu"], vid)
    assert "?t=" in tk["url"]
    assert tk["expires_at"] > int(time.time()) + 3600

    ok = await client.get(tk["url"])
    assert ok.status_code == 200
    assert ok.content.startswith(b"FAKE-MP4-v1-")

    # 老路子:?token=<会话 token> → 401
    dead = await client.get(f"/api/v1/phonetics/videos/{vid}/stream?token={env['tok']['stu']}")
    assert dead.status_code == 401, "整站会话 token 放 URL 上仍能播 = 洞没堵"
    # 什么都不带 → 401
    assert (await client.get(f"/api/v1/phonetics/videos/{vid}/stream")).status_code == 401
    # Authorization 头(axios 路径)照旧能用
    hdr = await client.get(f"/api/v1/phonetics/videos/{vid}/stream", headers=_h(env["tok"]["stu"]))
    assert hdr.status_code == 200


async def test_ticket_is_not_a_session_token(client: AsyncClient, media_env):
    """抓到票据拿去当 Bearer 调 API → 401。独立密钥签的,签名过不去"""
    env = media_env
    tk = await _ticket(client, env["tok"]["stu"], env["vid"]["v1"])
    ticket = tk["url"].split("?t=", 1)[1]
    r = await client.get("/api/v1/phonetics/videos", headers=_h(ticket))
    assert r.status_code == 401, "票据能当会话 token 用 = 等于没换"
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/materials", headers=_h(ticket))
    assert r.status_code == 401


async def test_ticket_bound_to_one_video(client: AsyncClient, media_env):
    """v1 的票拿去播平台预置视频 → 401(泄一张票只丢一个视频)"""
    env = media_env
    tk = await _ticket(client, env["tok"]["stu"], env["vid"]["v1"])
    ticket = tk["url"].split("?t=", 1)[1]
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['preset']}/stream?t={ticket}")
    assert r.status_code == 401


async def test_expired_ticket_rejected(client: AsyncClient, media_env, db_session):
    env = media_env
    vid = env["vid"]["v1"]
    uid = (await db_session.execute(sql_text(
        "SELECT id FROM users WHERE username='stumat'"))).scalar()
    stale = jwt.encode(
        {"typ": "media", "sub": str(uid), "vid": vid, "sv": 0, "exp": int(time.time()) - 5},
        ph._ticket_key(), algorithm="HS256")
    r = await client.get(f"/api/v1/phonetics/videos/{vid}/stream?t={stale}")
    assert r.status_code == 401


async def test_ticket_dies_when_session_is_kicked(
        client: AsyncClient, media_env, db_session):
    """别处重新登录(session_ver +1)后,旧设备上抓到的票据也跟着作废"""
    env = media_env
    vid = env["vid"]["v1"]
    tk = await _ticket(client, env["tok"]["stu"], vid)
    assert (await client.get(tk["url"])).status_code == 200

    await db_session.execute(sql_text(
        "UPDATE users SET session_ver = session_ver + 1 WHERE username='stumat'"))
    await db_session.commit()
    assert (await client.get(tk["url"])).status_code == 401


async def test_ticket_requires_visible_active_video(client: AsyncClient, media_env):
    """下架的视频换不到票;别家机构的视频也换不到"""
    env = media_env
    # 下架
    await client.put(f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}",
                     headers=_h(env["tok"]["t1"]), json={"is_active": False})
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/ticket",
                         headers=_h(env["tok"]["stu"]))
    assert r.status_code == 404
    # 机构乙的学生要机构甲的视频(v1 已下架,换 v2 反向验证:甲的学生要乙的)
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v2']}/ticket",
                         headers=_h(env["tok"]["stu"]))
    assert r.status_code == 404


# ---------- 按人水印 ----------

async def test_material_page_is_watermarked_per_viewer(client: AsyncClient, media_env):
    """同一页、两个人取 → 两张不同的图(各烧各的姓名+ID);且不许缓存"""
    env = media_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"], data=_pdf_bytes(1))).json()
    url = f"/api/v1/phonetics/materials/{m['id']}/page/1"

    a = await client.get(url, headers=_h(env["tok"]["stu"]))
    b = await client.get(url, headers=_h(env["tok"]["t1"]))
    assert a.status_code == 200 and b.status_code == 200
    assert a.headers["content-type"] == "image/webp"
    assert a.content != b.content, "两个人拿到一样的图 = 水印没烧上"
    for r in (a, b):
        assert "no-store" in r.headers["cache-control"]
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("content-disposition") == "inline"


# ---------- 速率上限 ----------

async def test_page_flip_rate_limited(client: AsyncClient, media_env, monkeypatch):
    """翻页超过每分钟上限 → 429 + Retry-After。爬虫一秒几十页在这里被卡"""
    env = media_env
    monkeypatch.setattr(ph, "PAGE_RATE_LIMIT", 5)
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"], data=_pdf_bytes(2))).json()
    url = f"/api/v1/phonetics/materials/{m['id']}/page/1"
    h = _h(env["tok"]["stu"])

    for i in range(5):
        assert (await client.get(url, headers=h)).status_code == 200, f"第 {i+1} 次不该被限"
    r = await client.get(url, headers=h)
    assert r.status_code == 429
    assert int(r.headers.get("retry-after", "0")) >= 1
    assert "太快" in r.json()["detail"]

    # 别人的桶不受影响
    assert (await client.get(url, headers=_h(env["tok"]["t1"]))).status_code == 200


async def test_ticket_rate_limited(client: AsyncClient, media_env, monkeypatch):
    env = media_env
    monkeypatch.setattr(ph, "TICKET_RATE_LIMIT", 3)
    for _ in range(3):
        await _ticket(client, env["tok"]["stu"], env["vid"]["v1"])
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/ticket",
                         headers=_h(env["tok"]["stu"]))
    assert r.status_code == 429


async def test_kicked_session_token_cannot_stream_via_header(
        client: AsyncClient, media_env, db_session):
    """顶号后旧会话 token 走 Authorization 头串流也要挂 —— 此前串流端点漏了 sv 校验"""
    env = media_env
    vid = env["vid"]["v1"]
    uid = (await db_session.execute(sql_text(
        "SELECT id FROM users WHERE username='stumat'"))).scalar()
    from datetime import datetime, timedelta
    tok_sv0 = jwt.encode({"sub": str(uid), "sv": 0,
                          "exp": datetime.utcnow() + timedelta(hours=1)},
                         settings.SECRET_KEY, algorithm="HS256")
    assert (await client.get(f"/api/v1/phonetics/videos/{vid}/stream",
                             headers=_h(tok_sv0))).status_code == 200
    await db_session.execute(sql_text(
        "UPDATE users SET session_ver = 1 WHERE username='stumat'"))
    await db_session.commit()
    assert (await client.get(f"/api/v1/phonetics/videos/{vid}/stream",
                             headers=_h(tok_sv0))).status_code == 401