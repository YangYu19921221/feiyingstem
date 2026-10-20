"""音标视频「索引挪到文件头」(services/video_faststart)

用 ffmpeg 现做一段 2 秒的小视频(默认就是索引在尾),验证:
1. 能认出「索引在尾」,挪完变成「索引在头」,时长和音视频流不变
2. 已经在头的、不是 mp4 的、坏文件 → 不碰(坏文件原样保留,不留临时文件)
3. 上传接口落盘后自动在后台挪好
"""
import asyncio
import io
import os
import shutil
import subprocess

import pytest

from app.services import video_faststart as vf

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"),
                                reason="本机没装 ffmpeg")


def _make_mp4(path, faststart=False):
    cmd = ["ffmpeg", "-v", "error", "-y",
           "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2",
           "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]
    if faststart:
        cmd += ["-movflags", "+faststart"]
    subprocess.run([*cmd, str(path)], check=True)


async def test_moves_index_to_front_and_keeps_content(tmp_path):
    p = tmp_path / "a.mp4"
    _make_mp4(p)
    assert vf.needs_faststart(str(p))
    before = await vf._probe(str(p))
    bak = tmp_path / "bak"
    assert await vf.faststart_in_place(str(p), backup_dir=str(bak)) == "done"
    atoms = vf.top_level_atoms(str(p))
    assert atoms.index("moov") < atoms.index("mdat")
    after = await vf._probe(str(p))
    assert abs(after[0] - before[0]) < 0.1
    assert sorted(after[1]) == sorted(before[1]) == ["audio", "video"]
    # 备份是原样的(仍是索引在尾),出问题能整批还原
    assert (bak / "a.mp4").exists() and vf.needs_faststart(str(bak / "a.mp4"))
    assert not list(tmp_path.glob("*.tmp"))
    assert await vf.faststart_in_place(str(p)) == "skipped"      # 再跑一次不动


async def test_leaves_other_files_alone(tmp_path):
    good = tmp_path / "ok.mp4"
    _make_mp4(good, faststart=True)
    assert not vf.needs_faststart(str(good))
    webm = tmp_path / "x.webm"
    webm.write_bytes(b"\x1aE\xdf\xa3" + b"0" * 100)
    assert not vf.needs_faststart(str(webm))
    # 坏文件: 头部像 mp4(mdat 在 moov 前),内容却是垃圾 → 失败,原文件不动、不留临时文件
    bad = tmp_path / "bad.mp4"
    junk = (16).to_bytes(4, "big") + b"mdat" + b"x" * 8 + (16).to_bytes(4, "big") + b"moov" + b"y" * 8
    bad.write_bytes(junk)
    assert vf.needs_faststart(str(bad))
    status = await vf.faststart_in_place(str(bad))
    assert status.startswith("failed")
    assert bad.read_bytes() == junk
    assert not list(tmp_path.glob("*.tmp"))


async def test_upload_schedules_faststart(client, db_session, monkeypatch, tmp_path):
    from sqlalchemy import text as sql_text
    from app.core.config import settings
    from app.models.user import User
    from tests.conftest import _make_token
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path / "pv"), raising=False)
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9941, '机构快启', 'orgfast', 'active', 'assigned')"))
    t = User(username="tchfast", email="tchfast@e.com", hashed_password="x",
             role="teacher", full_name="tchfast", is_active=True, org_id=9941)
    db_session.add(t)
    await db_session.commit()
    src = tmp_path / "src.mp4"
    _make_mp4(src)
    r = await client.post(
        "/api/v1/teacher/phonetics/videos/upload",
        headers={"Authorization": f"Bearer {_make_token(t.id)}"},
        data={"category": "vowel", "lecturer": "王老师", "title": "fast"},
        files={"file": ("lesson.mp4", io.BytesIO(src.read_bytes()), "video/mp4")},
    )
    assert r.status_code == 200, r.text
    pv = tmp_path / "pv"
    for _ in range(50):
        if vf._background:
            await asyncio.gather(*list(vf._background))
        stored = [f for f in os.listdir(pv) if f.endswith(".mp4")]
        if stored and not vf.needs_faststart(str(pv / stored[0])):
            break
        await asyncio.sleep(0.1)
    stored = [f for f in os.listdir(pv) if f.endswith(".mp4")]
    assert len(stored) == 1
    atoms = vf.top_level_atoms(str(pv / stored[0]))
    assert atoms.index("moov") < atoms.index("mdat")
