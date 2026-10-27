"""学习助手「按住说话」(services/tutor_voice,2026-10-27)

锁住的规矩:
1. 上传只排队(哪个进程都行),主进程转写循环转;转完马上删音频,行里只留文字
2. 只能本人取结果;服务器没装 Whisper 503;格式不对 / 空 / 太大 400
3. 1 天前的行和遗留文件删掉
4. 不扣「问小鹰老师」次数
"""
import os
from datetime import timedelta

import pytest

from app.core.timeutil import utc_now
from app.models.tutor import TutorAllowance, TutorVoiceClip
from app.services import sentence_speech, tutor_voice as tv
from tests.test_tutor import _env, _h


@pytest.mark.asyncio
async def test_upload_transcribe_delete(client, db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(tv, "AUDIO_DIR", str(tmp_path))
    monkeypatch.setattr(sentence_speech, "is_available", lambda: True)
    users = await _env(db_session)
    files = {"audio": ("a.webm", b"fake-audio", "audio/webm;codecs=opus")}
    r = await client.post("/api/v1/student/tutor/voice", files=files, headers=_h(users["s"].id))
    assert r.status_code == 200 and r.json()["status"] == "pending"
    cid = r.json()["id"]
    clip = await db_session.get(TutorVoiceClip, cid)
    path = tv.audio_path(clip.file_path)
    assert os.path.exists(path)
    # 别人取不到
    assert (await client.get(f"/api/v1/student/tutor/voice/{cid}", headers=_h(users["s2"].id))).status_code == 404
    # 主进程转写(这里不跑进程池,直接假装转好)

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    import app.core.database as dbm
    monkeypatch.setattr(dbm, "AsyncSessionLocal", lambda: _Ctx())

    async def fake_transcribe(p):
        assert os.path.exists(p)
        return "There is 和 There are 怎么区分"
    monkeypatch.setattr(tv, "transcribe", fake_transcribe)
    rows = await tv.pending_rows(db_session, 5)
    assert [r[0] for r in rows] == [cid]
    await tv.process_one(*rows[0])
    assert not os.path.exists(path)
    got = await client.get(f"/api/v1/student/tutor/voice/{cid}", headers=_h(users["s"].id))
    assert got.json() == {"id": cid, "status": "done", "text": "There is 和 There are 怎么区分"}
    await db_session.refresh(clip)
    assert clip.file_path is None
    assert await db_session.get(TutorAllowance, users["s"].id) is None       # 不扣次数


@pytest.mark.asyncio
async def test_rejects(client, db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(tv, "AUDIO_DIR", str(tmp_path))
    users = await _env(db_session)
    h = _h(users["s"].id)
    monkeypatch.setattr(sentence_speech, "is_available", lambda: False)
    assert (await client.post("/api/v1/student/tutor/voice", files={"audio": ("a.webm", b"x", "audio/webm")}, headers=h)).status_code == 503
    monkeypatch.setattr(sentence_speech, "is_available", lambda: True)
    assert (await client.post("/api/v1/student/tutor/voice", files={"audio": ("a.txt", b"x", "text/plain")}, headers=h)).status_code == 400
    assert (await client.post("/api/v1/student/tutor/voice", files={"audio": ("a.webm", b"", "audio/webm")}, headers=h)).status_code == 400
    big = b"x" * (tv.MAX_BYTES + 1)
    assert (await client.post("/api/v1/student/tutor/voice", files={"audio": ("a.webm", big, "audio/webm")}, headers=h)).status_code == 400


@pytest.mark.asyncio
async def test_purge(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(tv, "AUDIO_DIR", str(tmp_path))
    users = await _env(db_session)
    (tmp_path / "old.webm").write_bytes(b"x")
    db_session.add_all([TutorVoiceClip(user_id=users["s"].id, file_path="old.webm", status="pending",
                                       created_at=utc_now() - timedelta(hours=30)),
                        TutorVoiceClip(user_id=users["s"].id, status="done", text="新的", created_at=utc_now())])
    await db_session.commit()
    assert await tv.purge_expired(db_session) == 1
    assert not (tmp_path / "old.webm").exists()
