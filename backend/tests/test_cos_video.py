"""音标视频走腾讯云 COS(services/cos_video.py)

不连真 COS: 用一个假客户端记调用,测判定分支。
1. 文件在 COS 且与本机一致 → /stream 302 跳到签名地址,回包 no-store(生产 nginx 开着 proxy_cache)
2. 不在 COS / 本机文件变了(faststart、重压)/ 没配 COS → 照旧从本机串流 206
3. 302 之前照样要验票: 没票 401、别的视频的票 401
4. 流畅版 q=lite 跳流畅版自己的地址
5. 同步只传 *.mp4(不传压到一半的 .tmp、.lite.skip 标记),已一致的跳过
6. 删视频连带删 COS 上的原片和流畅版
"""
import os

import pytest
import pytest_asyncio
from sqlalchemy import text as sql_text

from app.api.v1 import phonetics as ph
from app.core.config import settings
from app.models.phonetic import PhoneticVideo
from app.models.user import User
from app.services import cos_video
from tests.conftest import _make_token


class FakeCos:
    def __init__(self):
        self.objects: dict[str, tuple[int, str]] = {}   # key -> (size, mtime meta)
        self.calls: list[tuple] = []

    def upload_file(self, Bucket, Key, LocalFilePath, Metadata=None, **kw):
        self.calls.append(("upload", Key))
        self.objects[Key] = (os.path.getsize(LocalFilePath), (Metadata or {}).get("x-cos-meta-mtime", "0"))

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete", Key))
        self.objects.pop(Key, None)

    def get_presigned_url(self, Bucket, Key, Method, Expired):
        return f"https://{Bucket}.cos.ap-guangzhou.myqcloud.com/{Key}?sign=x&exp={Expired}"

    def list_objects(self, Bucket, Prefix, Marker="", MaxKeys=1000):
        return {"Contents": [{"Key": k, "Size": str(v[0])} for k, v in self.objects.items() if k.startswith(Prefix)],
                "IsTruncated": "false"}

    def head_object(self, Bucket, Key):
        return {"x-cos-meta-mtime": self.objects[Key][1]}


@pytest.fixture
def fake_cos(monkeypatch):
    monkeypatch.setenv("COS_REDIRECT", "all")
    f = FakeCos()
    monkeypatch.setattr(cos_video, "_client", f)
    monkeypatch.setattr(cos_video, "_bucket", "eh-media-test")
    monkeypatch.setattr(cos_video, "_inited", True)
    monkeypatch.setattr(cos_video, "_index", {})
    return f


@pytest.fixture
def no_cos(monkeypatch):
    monkeypatch.setattr(cos_video, "_client", None)
    monkeypatch.setattr(cos_video, "_inited", True)
    monkeypatch.setattr(cos_video, "_index", {})


@pytest_asyncio.fixture
async def env(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path))
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9981, 'COS机构', 'cosorg', 'active', 'assigned')"))
    stu = User(username="cosstudent", email="cs@e.com", hashed_password="x", role="student",
               is_active=True, org_id=9981)
    tch = User(username="costeacher", email="ct@e.com", hashed_password="x", role="teacher",
               is_active=True, org_id=9981)
    db_session.add_all([stu, tch])
    await db_session.flush()
    (tmp_path / "abc123.mp4").write_bytes(b"\x00" * 5000)
    (tmp_path / "abc123.lite.mp4").write_bytes(b"\x01" * 2000)
    v = PhoneticVideo(title="元音 /æ/", file_path="abc123.mp4", category="vowel", is_active=True, org_id=9981,
                      created_by=tch.id)
    v2 = PhoneticVideo(title="辅音 /b/", file_path="def456.mp4", category="consonant", is_active=True, org_id=None)
    db_session.add_all([v, v2])
    await db_session.commit()
    return {"stu": stu, "tch": tch, "v": v, "v2": v2, "dir": tmp_path}


def _ticket(user, vid):
    return ph._mint_ticket(user, vid)[0]


async def test_redirects_to_cos_when_uploaded(client, env, fake_cos):
    p = os.path.join(env["dir"], "abc123.mp4")
    assert cos_video.upload(p)
    r = await client.get(f"/api/v1/phonetics/videos/{env['v'].id}/stream",
                         params={"t": _ticket(env["stu"], env["v"].id)}, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://eh-media-test.cos.ap-guangzhou.myqcloud.com/phonetics/abc123.mp4")
    assert r.headers["cache-control"] == "no-store"


async def test_lite_redirects_to_lite_object(client, env, fake_cos):
    cos_video.upload(os.path.join(env["dir"], "abc123.mp4"))
    cos_video.upload(os.path.join(env["dir"], "abc123.lite.mp4"))
    r = await client.get(f"/api/v1/phonetics/videos/{env['v'].id}/stream",
                         params={"t": _ticket(env["stu"], env["v"].id), "q": "lite"}, follow_redirects=False)
    assert r.status_code == 302 and "/phonetics/abc123.lite.mp4" in r.headers["location"]


async def test_falls_back_to_local_when_not_uploaded_or_changed(client, env, fake_cos):
    url = f"/api/v1/phonetics/videos/{env['v'].id}/stream"
    tk = {"t": _ticket(env["stu"], env["v"].id)}
    # 还没传 → 本机串流
    r = await client.get(url, params=tk, headers={"Range": "bytes=0-99"}, follow_redirects=False)
    assert r.status_code == 206
    # 传了之后本机文件被换了(faststart / 重压)→ 对不上,照旧本机,不跳旧文件
    p = os.path.join(env["dir"], "abc123.mp4")
    cos_video.upload(p)
    with open(p, "ab") as f:
        f.write(b"\x02" * 10)
    os.utime(p, (os.path.getatime(p), os.path.getmtime(p) + 5))
    r = await client.get(url, params=tk, headers={"Range": "bytes=0-99"}, follow_redirects=False)
    assert r.status_code == 206


async def test_no_cos_configured_streams_locally(client, env, no_cos):
    r = await client.get(f"/api/v1/phonetics/videos/{env['v'].id}/stream",
                         params={"t": _ticket(env["stu"], env["v"].id)}, headers={"Range": "bytes=0-9"},
                         follow_redirects=False)
    assert r.status_code == 206


async def test_redirect_still_requires_valid_ticket(client, env, fake_cos):
    cos_video.upload(os.path.join(env["dir"], "abc123.mp4"))
    url = f"/api/v1/phonetics/videos/{env['v'].id}/stream"
    assert (await client.get(url, follow_redirects=False)).status_code == 401
    other = _ticket(env["stu"], env["v2"].id)       # 别的视频的票
    assert (await client.get(url, params={"t": other}, follow_redirects=False)).status_code == 401


async def test_sync_uploads_only_mp4_and_skips_matching(env, fake_cos):
    (env["dir"] / "abc123.lite.999.tmp").write_bytes(b"x" * 10)
    (env["dir"] / "zzz.lite.skip").write_bytes(b"")
    r = cos_video.sync_dir(str(env["dir"]))
    assert r == {"uploaded": 2, "skipped": 0, "failed": 0}
    assert sorted(k for _, k in fake_cos.calls) == ["phonetics/abc123.lite.mp4", "phonetics/abc123.mp4"]
    assert cos_video.sync_dir(str(env["dir"])) == {"uploaded": 0, "skipped": 2, "failed": 0}
    # 进程重启: 清单从桶里重建(带上传时的 mtime),仍判一致、不重传
    cos_video._index.clear()
    assert cos_video.refresh_index() == 2
    assert cos_video.sync_dir(str(env["dir"])) == {"uploaded": 0, "skipped": 2, "failed": 0}


async def test_delete_video_removes_cos_objects(client, env, fake_cos):
    cos_video.sync_dir(str(env["dir"]))
    r = await client.delete(f"/api/v1/teacher/phonetics/videos/{env['v'].id}",
                            headers={"Authorization": f"Bearer {_make_token(env['tch'].id)}"})
    assert r.status_code == 204, r.text
    assert ("delete", "phonetics/abc123.mp4") in fake_cos.calls
    assert ("delete", "phonetics/abc123.lite.mp4") in fake_cos.calls
    assert fake_cos.objects == {}


async def test_redirect_switch_off_or_only_listed_videos(client, env, fake_cos, monkeypatch):
    cos_video.sync_dir(str(env["dir"]))
    url = f"/api/v1/phonetics/videos/{env['v'].id}/stream"
    tk = {"t": _ticket(env["stu"], env["v"].id)}
    # 开关没开: 文件在 COS 也照旧本机串流(上线第一步: 只同步不跳)
    monkeypatch.setenv("COS_REDIRECT", "")
    assert (await client.get(url, params=tk, headers={"Range": "bytes=0-9"}, follow_redirects=False)).status_code == 206
    # 只开别的那节: 这节不跳
    monkeypatch.setenv("COS_REDIRECT", str(env["v2"].id))
    assert (await client.get(url, params=tk, headers={"Range": "bytes=0-9"}, follow_redirects=False)).status_code == 206
    # 开这一节: 跳
    monkeypatch.setenv("COS_REDIRECT", f"{env['v2'].id},{env['v'].id}")
    assert (await client.get(url, params=tk, follow_redirects=False)).status_code == 302

