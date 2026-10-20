"""音标视频「流畅」版(services/video_lite)

用 ffmpeg 现做一段 720p 的小视频,验证:
1. 压出 480p、带声音、时长不变,原片一个字节不动
2. 压完没小多少的不留,写跳过标记,以后不再压
3. 串流 q=lite 播流畅版;没有流畅版时 404(前端退回原片);列表 has_lite 跟着文件走
4. 删视频连带删流畅版
"""
import asyncio
import hashlib
import os
import shutil
import subprocess

import pytest
import pytest_asyncio
from sqlalchemy import text as sql_text

from app.core.config import settings
from app.models.phonetic import PhoneticVideo
from app.models.user import User
from app.services import video_faststart, video_lite
from tests.conftest import _make_token

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
                                reason="本机没装 ffmpeg")


def _make_mp4(path, size="1280x720", seconds=3, bitrate="1500k"):
    subprocess.run([
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=25:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libx264", "-b:v", bitrate, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(path)], check=True)


def _md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


async def _height(p):
    code, out = await video_faststart._run(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=height", "-of", "csv=p=0", str(p))
    return int(out.strip())


async def test_make_lite_480p_keeps_audio_and_original(tmp_path):
    src = tmp_path / "a.mp4"
    _make_mp4(src)
    before = _md5(src)
    assert await video_lite.make_lite(str(src), threads=1) == "done"
    lite = tmp_path / "a.lite.mp4"
    assert lite.exists() and lite.stat().st_size < src.stat().st_size * video_lite.KEEP_RATIO
    assert await _height(lite) == 480
    probe = await video_faststart._probe(str(lite))
    assert sorted(probe[1]) == ["audio", "video"]
    assert not video_faststart.needs_faststart(str(lite))   # 流畅版本身也是索引在头
    assert _md5(src) == before                              # 原片一个字节不动
    assert not list(tmp_path.glob("*.tmp"))
    assert await video_lite.make_lite(str(src)) == "exists"


async def test_not_smaller_writes_skip_marker(tmp_path):
    # 本来就是 360p 低码率: 压完小不了多少,不留
    src = tmp_path / "small.mp4"
    _make_mp4(src, size="640x360", bitrate="120k")
    assert await video_lite.make_lite(str(src), threads=1) == "not_smaller"
    assert not (tmp_path / "small.lite.mp4").exists()
    assert (tmp_path / "small.lite.skip").exists()
    assert await video_lite.make_lite(str(src)) == "skipped"
    video_lite.remove_for(str(src))
    assert not (tmp_path / "small.lite.skip").exists()


@pytest_asyncio.fixture
async def lite_env(db_session, monkeypatch, tmp_path):
    vdir = tmp_path / "pv"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9951, '机构流畅', 'orglite', 'active', 'assigned')"))
    stu = User(username="stulite", email="stulite@e.com", hashed_password="x",
               role="student", full_name="stulite", is_active=True, org_id=9951)
    tch = User(username="tchlite", email="tchlite@e.com", hashed_password="x",
               role="teacher", full_name="tchlite", is_active=True, org_id=9951)
    db_session.add_all([stu, tch])
    await db_session.flush()
    _make_mp4(vdir / "v1.mp4")
    v = PhoneticVideo(title="v1", file_path="v1.mp4", mime_type="video/mp4",
                      category="vowel", is_active=True, org_id=9951)
    db_session.add(v)
    await db_session.commit()
    return {"stu": _make_token(stu.id), "tch": _make_token(tch.id), "vid": v.id, "dir": vdir}


def _h(t):
    return {"Authorization": f"Bearer {t}"}


async def _drain():
    for _ in range(100):
        if not video_lite._background:
            return
        await asyncio.gather(*list(video_lite._background))


async def test_stream_lite_and_list_flag(client, lite_env):
    env = lite_env
    video_lite._failed.clear()
    r = await client.get("/api/v1/phonetics/videos", headers=_h(env["stu"]))
    assert [x["has_lite"] for x in r.json()] == [False]
    # 换票时顺手在后台压一份
    tk = (await client.get(f"/api/v1/phonetics/videos/{env['vid']}/ticket", headers=_h(env["stu"]))).json()
    miss = await client.get(tk["url"] + "&q=lite", headers={"Range": "bytes=0-99"})
    assert miss.status_code in (404, 206)       # 还没压好时 404,前端退回原片
    await _drain()
    assert (env["dir"] / "v1.lite.mp4").exists()
    full = await client.get(tk["url"], headers={"Range": "bytes=0-99"})
    lite = await client.get(tk["url"] + "&q=lite", headers={"Range": "bytes=0-99"})
    assert full.status_code == lite.status_code == 206
    total = lambda r: int(r.headers["content-range"].split("/")[1])   # noqa: E731
    assert total(lite) < total(full)
    assert lite.headers["etag"] != full.headers["etag"]                # 两份文件缓存不串
    r = await client.get("/api/v1/phonetics/videos", headers=_h(env["stu"]))
    assert [x["has_lite"] for x in r.json()] == [True]


async def test_delete_removes_lite(client, lite_env):
    env = lite_env
    assert await video_lite.make_lite(str(env["dir"] / "v1.mp4"), threads=1) == "done"
    r = await client.delete(f"/api/v1/teacher/phonetics/videos/{env['vid']}", headers=_h(env["tch"]))
    assert r.status_code == 204, r.text
    assert not (env["dir"] / "v1.mp4").exists()
    assert not (env["dir"] / "v1.lite.mp4").exists()


async def test_fake_files_never_spawn_ffmpeg(tmp_path):
    fake = tmp_path / "fake.mp4"
    fake.write_bytes(b"FAKE-MP4-" * 64)
    video_lite._failed.discard("fake.mp4")
    video_lite.ensure_scheduled(str(fake))
    assert "fake.mp4" not in video_lite._running
    assert not video_lite._background or all(t.done() for t in video_lite._background)
    assert os.listdir(tmp_path) == ["fake.mp4"]
