"""例句跟读(services/read_aloud.py + api/v1/read_aloud.py)

1. 能跟读的句子: 一个词一条、3–15 个词、主释义优先、同一句只留一次
2. 进单元走和取词表同一道闸门: 没分配的书 403;布置了跟读作业的单元放行
3. 上传只认服务端的例句,别的单元的词 400
4. 作业: 开放后读满一轮(单元句子不够就读完全部)才算完成,开放前读的不算
5. 老师: 只看本班;14 天内能回放,到期删文件(行保留)、回放 410;能标读对/没读对
6. 转写不删录音(老师 14 天内要听)
"""
import os
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.content_homework import ContentHomeworkStudent
from app.models.learning import BookAssignment
from app.models.read_aloud import ReadAloudRecording
from app.models.user import Class, ClassStudent, DailyCheckin, User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import read_aloud as ra
from tests.conftest import _make_token

AUDIO = b"\x1a\x45\xdf\xa3" + b"0" * 4000

SENTENCES = [
    ("apple", "I eat an apple every day."),
    ("cat", "The cat sleeps on the soft bed."),
    ("dog", "My dog runs in the park."),
    ("run", "Run!"),                                                       # 太短
    ("long", "This is a very long sentence that has far too many words for a young child to read aloud."),  # 太长
    ("bird", "The bird sings a song in the tree."),
]


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
def audio_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(ra, "AUDIO_DIR", str(tmp_path))
    return tmp_path


async def _env(db, *, assign=True):
    tenancy._org_cache.clear()
    await db.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(9971, '机构甲', 'raa', 'active', 'assigned')"))
    users = {}
    for key, role in [("t", "teacher"), ("other_t", "teacher"), ("s", "student"), ("s2", "student")]:
        u = User(username=f"ra{key.replace('_', '')}", email=f"ra{key}@e.com", hashed_password="x", role=role,
                 full_name=f"ra{key}", is_active=True, org_id=9971)
        db.add(u)
        await db.flush()
        users[key] = u
    c = Class(name="c", teacher_id=users["t"].id, org_id=9971)
    db.add(c)
    await db.flush()
    for k in ("s", "s2"):
        db.add(ClassStudent(class_id=c.id, student_id=users[k].id, is_active=True))
        db.add(DailyCheckin(user_id=users[k].id, checkin_date=local_today()))
    book = WordBook(name="三年级上", is_public=True)
    db.add(book)
    await db.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    unit2 = Unit(book_id=book.id, unit_number=2, name="Unit 2")
    db.add_all([unit, unit2])
    await db.flush()
    words = {}
    for i, (w, sent) in enumerate(SENTENCES):
        wd = Word(word=w)
        db.add(wd)
        await db.flush()
        words[w] = wd
        db.add(UnitWord(unit_id=unit.id, word_id=wd.id, order_index=i))
        db.add(WordDefinition(word_id=wd.id, meaning="x", example_sentence=sent, example_translation="译文",
                              is_primary=True))
    # 非主释义那条不该被选中
    db.add(WordDefinition(word_id=words["apple"].id, meaning="y", example_sentence="An apple a day keeps the doctor away.",
                          example_translation="译", is_primary=False))
    other = Word(word="pen")
    db.add(other)
    await db.flush()
    db.add(UnitWord(unit_id=unit2.id, word_id=other.id, order_index=0))
    db.add(WordDefinition(word_id=other.id, meaning="笔", example_sentence="I have a red pen.",
                          example_translation="我有一支红笔。", is_primary=True))
    if assign:
        db.add(BookAssignment(student_id=users["s"].id, book_id=book.id, teacher_id=users["t"].id, scope_type="book"))
    await db.commit()
    return users, unit, unit2, words, other


async def _upload(client, uid, unit_id, word_id, data=AUDIO):
    return await client.post(f"/api/v1/student/units/{unit_id}/read-aloud", headers=_h(uid),
                             data={"word_id": str(word_id)}, files={"audio": ("a.webm", data, "audio/webm")})


async def test_eligible_sentences_filters_and_prefers_primary(db_session):
    _, unit, _, words, _ = await _env(db_session)
    got = (await ra.eligible_sentences(db_session, [unit.id]))[unit.id]
    assert [g["word"] for g in got] == ["apple", "cat", "dog", "bird"]
    assert got[0]["sentence"] == "I eat an apple every day."


async def test_round_needs_access_and_homework_opens_it(client, db_session, audio_dir):
    u, unit, _, words, _ = await _env(db_session, assign=False)
    # 书没分配给孩子 → 进不去
    r = await client.get(f"/api/v1/student/units/{unit.id}/read-aloud", headers=_h(u["s"].id))
    assert r.status_code == 403
    # 老师布置这个单元的跟读作业 → 放行
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(u["t"].id), json={
        "kind": "read_aloud", "target_ids": [unit.id], "student_ids": [u["s"].id]})
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/student/units/{unit.id}/read-aloud", headers=_h(u["s"].id))
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 4 and r.json()["keep_days"] == ra.KEEP_DAYS
    # 没被布置的同班同学照旧进不去
    r = await client.get(f"/api/v1/student/units/{unit.id}/read-aloud", headers=_h(u["s2"].id))
    assert r.status_code == 403


async def test_upload_uses_server_sentence_and_rejects_foreign_word(client, db_session, audio_dir):
    u, unit, _, words, other = await _env(db_session)
    r = await _upload(client, u["s"].id, unit.id, words["cat"].id)
    assert r.status_code == 200, r.text
    row = (await db_session.execute(select(ReadAloudRecording))).scalar_one()
    assert row.sentence == "The cat sleeps on the soft bed." and row.status == "pending"
    assert os.path.exists(os.path.join(audio_dir, row.file_path))
    assert (await _upload(client, u["s"].id, unit.id, other.id)).status_code == 400        # 别的单元的词
    assert (await _upload(client, u["s"].id, unit.id, words["run"].id)).status_code == 400  # 没有能跟读的句子
    assert (await _upload(client, u["s"].id, unit.id, words["cat"].id, b"x" * 10)).status_code == 400


async def test_pick_round_unread_first(db_session):
    u, unit, _, words, _ = await _env(db_session)
    db_session.add(ReadAloudRecording(user_id=u["s"].id, unit_id=unit.id, word_id=words["apple"].id,
                                      sentence="x", created_at=datetime.utcnow()))
    await db_session.commit()
    got = await ra.pick_round(db_session, u["s"].id, unit.id)
    assert [g["word"] for g in got] == ["cat", "dog", "bird", "apple"]


async def test_homework_completes_after_reading_all_after_open(client, db_session, audio_dir):
    u, unit, _, words, _ = await _env(db_session)
    # 开放前读过的不算(读的是 bird,开放后不再读它 → 若算进去,读完 3 句就会误判完成)
    db_session.add(ReadAloudRecording(user_id=u["s"].id, unit_id=unit.id, word_id=words["bird"].id,
                                      sentence="x", created_at=datetime.utcnow() - timedelta(days=3)))
    await db_session.commit()
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(u["t"].id), json={
        "kind": "read_aloud", "target_ids": [unit.id], "student_ids": [u["s"].id]})
    assert r.status_code == 200, r.text

    async def status():
        mine = (await client.get("/api/v1/student/content-homework", headers=_h(u["s"].id))).json()
        assert mine[0]["route"] == f"/student/units/{unit.id}/read-aloud"
        return mine[0]["status"]

    assert await status() == "pending"
    for w in ("apple", "cat", "dog"):
        assert (await _upload(client, u["s"].id, unit.id, words[w].id)).status_code == 200
    assert await status() == "pending"            # 单元 4 句,读了 3 句
    # 同一句读两遍不算两句
    assert (await _upload(client, u["s"].id, unit.id, words["dog"].id)).status_code == 200
    assert await status() == "pending"
    assert (await _upload(client, u["s"].id, unit.id, words["bird"].id)).status_code == 200
    assert await status() == "completed"
    lst = (await client.get("/api/v1/teacher/content-homework", headers=_h(u["t"].id))).json()
    assert lst[0]["kind_label"] == "例句跟读" and lst[0]["completed"] == 1
    assert lst[0]["target_name"] == "三年级上 · Unit 1"


async def test_cannot_assign_unit_without_examples(client, db_session):
    u, unit, _, words, _ = await _env(db_session)
    empty = Unit(book_id=unit.book_id, unit_number=3, name="Unit 3")
    db_session.add(empty)
    await db_session.commit()
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(u["t"].id), json={
        "kind": "read_aloud", "target_ids": [empty.id], "student_ids": [u["s"].id]})
    assert r.status_code == 404
    groups = (await client.get("/api/v1/teacher/content-homework/targets", headers=_h(u["t"].id),
                               params={"kind": "read_aloud"})).json()
    names = [x["name"] for g in groups for x in g["units"]]
    assert names == ["Unit 1(4 句)", "Unit 2(1 句)"]


async def test_teacher_playback_verdict_and_purge(client, db_session, audio_dir):
    u, unit, _, words, _ = await _env(db_session)
    assert (await _upload(client, u["s"].id, unit.id, words["cat"].id)).status_code == 200
    row = (await db_session.execute(select(ReadAloudRecording))).scalar_one()
    row.status, row.passed, row.transcript, row.missed_words = "done", False, "the cat sleeps", "soft,bed"
    await db_session.commit()

    r = await client.get(f"/api/v1/teacher/students/{u['s'].id}/read-aloud", headers=_h(u["t"].id))
    assert r.status_code == 200
    body = r.json()
    assert body["items"][0]["has_audio"] is True and body["items"][0]["missed_words"] == ["soft", "bed"]
    # 别的老师看不到、听不到
    assert (await client.get(f"/api/v1/teacher/students/{u['s'].id}/read-aloud",
                             headers=_h(u["other_t"].id))).status_code == 403
    assert (await client.get(f"/api/v1/teacher/read-aloud/{row.id}/audio",
                             headers=_h(u["other_t"].id))).status_code == 403
    r = await client.get(f"/api/v1/teacher/read-aloud/{row.id}/audio", headers=_h(u["t"].id))
    assert r.status_code == 200 and r.content == AUDIO and r.headers["cache-control"] == "no-store"
    # 老师标「没读对」→ 和机器一致
    r = await client.put(f"/api/v1/teacher/read-aloud/{row.id}/verdict", headers=_h(u["t"].id), json={"verdict": "bad"})
    assert r.status_code == 200
    s = (await client.get(f"/api/v1/teacher/students/{u['s'].id}/read-aloud", headers=_h(u["t"].id))).json()["summary"]
    assert s["marked"] == 1 and s["agree"] == 1
    assert (await client.put(f"/api/v1/teacher/read-aloud/{row.id}/verdict", headers=_h(u["t"].id),
                             json={"verdict": "maybe"})).status_code == 400

    # 13 天时还在,15 天时删掉文件、行留着
    path = os.path.join(audio_dir, row.file_path)
    assert await ra.purge_expired(db_session, now=row.created_at + timedelta(days=13)) == 0
    assert os.path.exists(path)
    assert await ra.purge_expired(db_session, now=row.created_at + timedelta(days=15)) == 1
    assert not os.path.exists(path)
    await db_session.refresh(row)
    assert row.file_path is None and row.transcript == "the cat sleeps" and row.teacher_verdict == "bad"
    assert (await client.get(f"/api/v1/teacher/read-aloud/{row.id}/audio", headers=_h(u["t"].id))).status_code == 410


async def test_process_one_keeps_audio(db_session, audio_dir, monkeypatch):
    import asyncio
    import app.core.database as dbmod
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.services import sentence_speech as ss
    u, unit, _, words, _ = await _env(db_session)
    (audio_dir / "a.webm").write_bytes(AUDIO)
    row = ReadAloudRecording(user_id=u["s"].id, unit_id=unit.id, word_id=words["cat"].id,
                             sentence="The cat sleeps on the soft bed.", file_path="a.webm", created_at=datetime.utcnow())
    db_session.add(row)
    await db_session.commit()

    def _done(v):
        f = asyncio.get_running_loop().create_future()
        f.set_result(v)
        return f
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(ss, "_get_pool", lambda: None)
    monkeypatch.setattr(loop, "run_in_executor", lambda _p, _f, _a: _done("The cat sleeps on the bed"))
    monkeypatch.setattr(dbmod, "AsyncSessionLocal",
                        async_sessionmaker(db_session.bind, expire_on_commit=False, class_=AsyncSession))
    await ra.process_one(row.id, "a.webm", row.sentence)
    await db_session.refresh(row)
    assert row.status == "done" and row.passed is False and "soft" in row.missed_words
    assert row.file_path == "a.webm" and (audio_dir / "a.webm").exists()
