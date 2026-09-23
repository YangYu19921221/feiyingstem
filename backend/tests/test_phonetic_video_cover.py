"""音标视频封面图 —— 换封面 / 改回默认 / 不许填外部地址

背景: `cover_image` 这个字段**一直存在**(模型有、VideoUpdate 有、学生端和教师端
都渲染它),但从来没有任何写入路径 —— 于是它永远是 NULL,所有视频都落到按分类
兜底的那四张静态图上。一个接通了却永远设不了的字段。

四类风险:
1. **写进了公开目录**: 封面是唯一允许落 UPLOAD_DIR 的音标文件(那个目录整体经
   /api/v1/files 公开无鉴权)。视频本体和讲义是付费内容,绝不能跟着进来 ——
   所以测试要盯住落盘位置
2. **URL 必须带版本号**: 文件按 video_id 命名、换图不换路径,而 /api/v1/files 是
   一年期 immutable 缓存。不带 ?v= 就是换了也看不见
3. **cover_image 不许是自由文本**: 这个值被两端直接塞进 <img src>,受众是学生。
   放任写入等于允许存储型 XSS / 挂外站地址
4. **删视频要连带删封面文件**: phonetic_videos.id 是不带 AUTOINCREMENT 的
   INTEGER PRIMARY KEY,SQLite 会把删掉的最大 id 重新发给下一条(本项目已实测),
   留着同名旧图会让新视频凭空长出上一个视频的封面
"""
import io
import os

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.core.config import settings
from app.models.user import User
from app.models.phonetic import PhoneticVideo
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


def _png_bytes() -> bytes:
    """最小的合法 PNG(1x1)。现造而不是放二进制 fixture —— 仓库里不该躺
    来历不明的二进制文件。封面端点只写字节不解码,所以不需要 Pillow"""
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        b"\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IENDaeB`\x82"
    )


@pytest_asyncio.fixture
async def cover_env(db_session, monkeypatch, tmp_path):
    """两个机构 + 一个平台预置视频。

    UPLOAD_DIR 指到 tmp_path: 测试绝不能往真的公开目录里写东西,
    且每个测试拿到干净目录(否则上一轮的封面会让下一轮"看起来成功")
    """
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "uploads"))

    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9921, '机构甲', 'orgcvja', 'active', 'assigned'), "
        "(9922, '机构乙', 'orgcvyi', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchcovone", "teacher", 9921),
        ("t2", "tchcovtwo", "teacher", 9922),
        ("admin", "admcov", "admin", 9921),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    vids = {}
    for key, org in [("v1", 9921), ("v1b", 9921), ("v2", 9922), ("preset", None)]:
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
        "vid": vids,
        "dir": os.path.join(str(tmp_path / "uploads"), "phonetic-covers"),
    }


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _put_cover(client: AsyncClient, token: str, video_id: int,
                     name: str = "cover.png", data: bytes | None = None,
                     ctype: str = "image/png"):
    return await client.post(
        f"/api/v1/teacher/phonetics/videos/{video_id}/cover",
        headers=_h(token),
        files={"file": (name, io.BytesIO(data if data is not None else _png_bytes()), ctype)},
    )


# ---------- 主路径 ----------

async def test_upload_cover_sets_field_and_writes_public_dir(
        client: AsyncClient, cover_env, db_session):
    """换封面:库里落 URL、盘上落文件、返回值立刻可用"""
    env = cover_env
    vid = env["vid"]["v1"]

    r = await _put_cover(client, env["tok"]["t1"], vid)
    assert r.status_code == 200, r.text
    url = r.json()["cover_image"]

    # 路径必须在公开静态目录下(封面本来就要给所有学生看)
    assert url.startswith(f"/api/v1/files/phonetic-covers/video_{vid}.png")
    # 文件真的落盘了
    assert os.path.isfile(os.path.join(env["dir"], f"video_{vid}.png"))

    # 库里也存住了(不是只在响应里)
    v = await db_session.get(PhoneticVideo, vid)
    await db_session.refresh(v)
    assert v.cover_image == url


async def test_cover_url_carries_version_query(client: AsyncClient, cover_env):
    """URL 必须带 ?v= 版本号。

    /api/v1/files 是 `public, max-age=31536000, immutable`(见 main.py),
    而封面文件按 video_id 命名 —— 换图不换路径。不带版本号的话老师换完封面
    在自己和学生的浏览器里都还是旧图,而且**一年内都不会变**。
    """
    env = cover_env
    r = await _put_cover(client, env["tok"]["t1"], env["vid"]["v1"])
    url = r.json()["cover_image"]
    assert "?v=" in url
    assert url.split("?v=")[1].isdigit()


async def test_replacing_other_ext_removes_stale_file(client: AsyncClient, cover_env):
    """换了格式要删掉旧扩展名那张,否则磁盘上留一张永远没人引用的废图"""
    env = cover_env
    vid = env["vid"]["v1"]

    await _put_cover(client, env["tok"]["t1"], vid, "a.png", ctype="image/png")
    assert os.path.isfile(os.path.join(env["dir"], f"video_{vid}.png"))

    r = await _put_cover(client, env["tok"]["t1"], vid, "a.jpg",
                         data=b"\xff\xd8\xff\xd9", ctype="image/jpeg")
    assert r.status_code == 200
    assert os.path.isfile(os.path.join(env["dir"], f"video_{vid}.jpg"))
    assert not os.path.exists(os.path.join(env["dir"], f"video_{vid}.png"))
    assert r.json()["cover_image"].startswith(
        f"/api/v1/files/phonetic-covers/video_{vid}.jpg")


async def test_delete_cover_falls_back_to_default(client: AsyncClient, cover_env):
    """删封面 = 改回按分类的默认图(cover_image 为 None),文件也清掉"""
    env = cover_env
    vid = env["vid"]["v1"]
    await _put_cover(client, env["tok"]["t1"], vid)

    r = await client.delete(
        f"/api/v1/teacher/phonetics/videos/{vid}/cover", headers=_h(env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    assert r.json()["cover_image"] is None
    assert not os.path.exists(os.path.join(env["dir"], f"video_{vid}.png"))


# ---------- 校验 ----------

async def test_rejects_non_image_type(client: AsyncClient, cover_env):
    """只收 png/jpg/webp。老师把 PPT 拖进封面框是常见误操作"""
    r = await _put_cover(client, cover_env["tok"]["t1"], cover_env["vid"]["v1"],
                         "x.pdf", data=b"%PDF-1.4", ctype="application/pdf")
    assert r.status_code == 400
    assert "png" in r.json()["detail"]


async def test_rejects_oversized_by_real_bytes(client: AsyncClient, cover_env):
    """2MB 上限按**真实字节**判。

    声明的 file.size 由客户端给、可以撒谎,所以读完还要再判一次
    (与 coins.py / org_admin.py 同口径)。
    """
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (2 * 1024 * 1024 + 10)
    r = await _put_cover(client, cover_env["tok"]["t1"], cover_env["vid"]["v1"],
                         "big.png", data=big)
    assert r.status_code == 400
    assert "2MB" in r.json()["detail"]


async def test_rejects_empty_file(client: AsyncClient, cover_env):
    """空文件要拒。落盘成 0 字节的话卡片上是个破图标,比默认封面差"""
    r = await _put_cover(client, cover_env["tok"]["t1"], cover_env["vid"]["v1"],
                         "empty.png", data=b"")
    assert r.status_code == 400


async def test_update_rejects_external_cover_url(client: AsyncClient, cover_env):
    """PUT /videos/{id} 不接受任意 cover_image 字符串。

    这个值被两端直接塞进 <img src>,而受众是学生。放任自由文本就是允许
    `javascript:...`(存储型 XSS)或挂外站地址(每个学生打开页面都去访问
    那台服务器,顺手泄露访客 IP)。
    """
    env = cover_env
    for bad in ["https://evil.example.com/a.png",
                "javascript:alert(1)",
                "/api/v1/files/org-logos/org_1.png"]:
        r = await client.put(
            f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}",
            headers=_h(env["tok"]["t1"]), json={"cover_image": bad})
        assert r.status_code == 400, f"{bad} 应该被拒: {r.text}"


async def test_update_accepts_our_own_cover_path(client: AsyncClient, cover_env):
    """我们自己产出的路径要放行 —— 否则前端把整条视频回传时会被自己的封面噎住"""
    env = cover_env
    vid = env["vid"]["v1"]
    url = (await _put_cover(client, env["tok"]["t1"], vid)).json()["cover_image"]

    r = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                         headers=_h(env["tok"]["t1"]),
                         json={"title": "改个名", "cover_image": url})
    assert r.status_code == 200, r.text
    assert r.json()["cover_image"] == url


# ---------- 多租户 / 预置只读 ----------

async def test_cross_org_cannot_set_cover(client: AsyncClient, cover_env):
    """别家机构的视频摸不到(封面会直接出现在对方学生的页面上)"""
    env = cover_env
    r = await _put_cover(client, env["tok"]["t2"], env["vid"]["v1"])
    assert r.status_code == 404
    assert not os.path.exists(os.path.join(env["dir"], f"video_{env['vid']['v1']}.png"))


async def test_preset_cover_readonly_for_org(client: AsyncClient, cover_env):
    """平台预置视频对机构只读(改了会影响所有机构),admin 可以改"""
    env = cover_env
    pid = env["vid"]["preset"]

    r = await _put_cover(client, env["tok"]["t1"], pid)
    assert r.status_code == 403

    r = await _put_cover(client, env["tok"]["admin"], pid)
    assert r.status_code == 200, r.text


async def test_delete_cover_preset_readonly(client: AsyncClient, cover_env):
    """删封面走同一道闸门"""
    env = cover_env
    r = await client.delete(
        f"/api/v1/teacher/phonetics/videos/{env['vid']['preset']}/cover",
        headers=_h(env["tok"]["t1"]))
    assert r.status_code == 403


# ---------- 删视频要连带删封面(id 会被 SQLite 回收复用)----------

async def test_delete_video_removes_cover_file(client: AsyncClient, cover_env):
    """单条删除。

    phonetic_videos.id 是不带 AUTOINCREMENT 的 INTEGER PRIMARY KEY,
    SQLite 会把删掉的最大 id 重新发给下一条插入(本项目已实测,同样的理由
    让删视频必须连带删 PhoneticVideoView 行)。封面文件按 id 命名 ——
    留着的话新视频一传封面就可能撞上这张旧图。
    """
    env = cover_env
    vid = env["vid"]["v1"]
    await _put_cover(client, env["tok"]["t1"], vid)
    path = os.path.join(env["dir"], f"video_{vid}.png")
    assert os.path.isfile(path)

    r = await client.delete(f"/api/v1/teacher/phonetics/videos/{vid}",
                            headers=_h(env["tok"]["t1"]))
    assert r.status_code == 204
    assert not os.path.exists(path)


async def test_batch_delete_removes_cover_files(client: AsyncClient, cover_env):
    """批量删除同口径 —— 两条删除路径都要清,漏一条就是活的 bug"""
    env = cover_env
    a, b = env["vid"]["v1"], env["vid"]["v1b"]
    await _put_cover(client, env["tok"]["t1"], a)
    await _put_cover(client, env["tok"]["t1"], b)
    pa = os.path.join(env["dir"], f"video_{a}.png")
    pb = os.path.join(env["dir"], f"video_{b}.png")
    assert os.path.isfile(pa) and os.path.isfile(pb)

    r = await client.post("/api/v1/teacher/phonetics/videos/batch-delete",
                          headers=_h(env["tok"]["t1"]), json={"ids": [a, b]})
    assert r.status_code == 200 and r.json()["deleted"] == 2
    assert not os.path.exists(pa) and not os.path.exists(pb)


# ---------- 学生端读得到 ----------

async def test_student_list_sees_cover(client: AsyncClient, cover_env, db_session):
    """学生端列表下发的就是老师设的那张(读路径本来就带 cover_image,守住不回退)"""
    env = cover_env
    vid = env["vid"]["v1"]
    url = (await _put_cover(client, env["tok"]["t1"], vid)).json()["cover_image"]

    stu = User(username="stucov", email="stucov@e.com", hashed_password="x",
               role="student", full_name="stucov", is_active=True, org_id=9921)
    db_session.add(stu)
    await db_session.commit()

    r = await client.get("/api/v1/phonetics/videos", headers=_h(_make_token(stu.id)))
    assert r.status_code == 200, r.text
    row = next(x for x in r.json() if x["id"] == vid)
    assert row["cover_image"] == url
