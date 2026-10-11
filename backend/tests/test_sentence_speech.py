"""开口背后台转写: 比对口径 + 上传/查看的权限边界 + 转完删音频"""
import os

import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.models.sentence import Sentence, SentenceBook, SentenceUnit
from app.models.sentence_speech import SentenceSpeech
from app.models.user import Class, ClassStudent, User
from app.services import sentence_speech as ss
from tests.conftest import _make_token

AUDIO = b"\x1aE\xdf\xa3" + b"0" * 4000


# ---------- 比对 ----------

def test_compare_exact_and_contraction():
    assert ss.compare("It's a cat.", "it is a cat")[0] == 1.0
    assert ss.compare("— What's your name?", "What is your name")[0] == 1.0


def test_compare_reports_missed_words():
    ratio, missed = ss.compare("I like apples very much.", "I like very much")
    assert missed == ["apples"] and ratio == pytest.approx(0.8)


def test_compare_tolerates_plural_slip_but_not_short_word_swap():
    assert ss.compare("I like apples.", "I like apple")[0] == 1.0
    # 短词必须完全一致: is → it 不放水
    assert ss.compare("This is a pen.", "This it a pen")[1] == ["is"]


def test_compare_order_matters_and_numbers():
    assert ss.compare("There are 3 books.", "there are three books")[0] == 1.0
    # 乱序念不能全中
    assert ss.compare("I like red apples", "apples red like I")[0] < ss.PASS_RATIO


def test_judge_one_content_word_swapped_fails():
    # 七成阈值曾放过这句(80%)
    assert ss.judge("My mother is a teacher.", "My mother is a banana")[2] is False
    assert ss.judge("My mother is a teacher.", "My mother a teacher")[2] is True   # 只吞了虚词 is


def test_compare_gibberish_fails():
    assert ss.compare("We go to school by bus.", "hello hello")[0] < ss.PASS_RATIO


# ---------- 端点 ----------

async def _setup(db):
    await db.execute(text("INSERT INTO organizations (id, name, code, status, access_mode) "
                          "VALUES (9901, 'A', 'orga', 'active', 'assigned'), (9902, 'B', 'orgb', 'active', 'assigned')"))
    stu = User(username="stuspeech", email="s@x.com", hashed_password="x", role="student", is_active=True, org_id=9901)
    tch = User(username="tchspeech", email="t@x.com", hashed_password="x", role="teacher", is_active=True, org_id=9901)
    other = User(username="tchother", email="o@x.com", hashed_password="x", role="teacher", is_active=True, org_id=9901)
    db.add_all([stu, tch, other]); await db.flush()
    c = Class(name="c", teacher_id=tch.id, org_id=9901); db.add(c); await db.flush()
    db.add(ClassStudent(class_id=c.id, student_id=stu.id, is_active=True))
    book = SentenceBook(name="b", is_public=True); db.add(book); await db.flush()
    u = SentenceUnit(book_id=book.id, unit_number=1, name="U1"); db.add(u)
    u2 = SentenceUnit(book_id=book.id, unit_number=2, name="U2"); db.add(u2); await db.flush()
    s = Sentence(unit_id=u.id, english="I like apples.", chinese="我喜欢苹果"); db.add(s)
    s2 = Sentence(unit_id=u2.id, english="Hi.", chinese="嗨"); db.add(s2)
    await db.commit()
    return stu, tch, other, u, s, s2


@pytest.fixture
def speech_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SENTENCE_SPEECH_DIR", str(tmp_path))
    return tmp_path


async def _upload(client, token, sid, uid, data=AUDIO):
    return await client.post("/api/v1/student/sentences/speech",
                             headers={"Authorization": f"Bearer {token}"},
                             data={"sentence_id": str(sid), "unit_id": str(uid)},
                             files={"audio": ("a.webm", data, "audio/webm")})


async def test_upload_queues_and_rejects_foreign_sentence(client, db_session, speech_dir):
    stu, _, _, u, s, s2 = await _setup(db_session)
    tok = _make_token(stu.id)
    r = await _upload(client, tok, s.id, u.id)
    assert r.status_code == 200, r.text
    row = (await db_session.execute(select(SentenceSpeech))).scalar_one()
    assert row.status == "pending" and os.path.exists(os.path.join(speech_dir, row.file_path))
    # 别的单元的句子塞进本单元 → 400
    assert (await _upload(client, tok, s2.id, u.id)).status_code == 400
    assert (await _upload(client, tok, s.id, u.id, b"x" * 10)).status_code == 400


async def test_teacher_sees_only_own_class_student(client, db_session, speech_dir):
    stu, tch, other, u, s, _ = await _setup(db_session)
    db_session.add(SentenceSpeech(user_id=stu.id, sentence_id=s.id, unit_id=u.id, status="done",
                                  transcript="I like", missed_words="apples", hit_ratio=0.67, passed=False))
    await db_session.commit()
    r = await client.get(f"/api/v1/teacher/students/{stu.id}/sentence-speech",
                         headers={"Authorization": f"Bearer {_make_token(tch.id)}"})
    assert r.status_code == 200
    body = r.json()
    assert body["items"][0]["missed_words"] == ["apples"] and body["summary"]["passed"] == 0
    r = await client.get(f"/api/v1/teacher/students/{stu.id}/sentence-speech",
                         headers={"Authorization": f"Bearer {_make_token(other.id)}"})
    assert r.status_code == 403


async def test_process_one_writes_result_and_deletes_audio(db_session, speech_dir, monkeypatch):
    stu, _, _, u, s, _ = await _setup(db_session)
    name = "x.webm"
    (speech_dir / name).write_bytes(AUDIO)
    row = SentenceSpeech(user_id=stu.id, sentence_id=s.id, unit_id=u.id, status="pending", file_path=name)
    db_session.add(row); await db_session.commit()

    class _Pool:
        pass
    import asyncio
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(ss, "_get_pool", lambda: None)
    monkeypatch.setattr(loop, "run_in_executor", lambda _p, _f, _a: _done("I like apple"))
    # 写库走 AsyncSessionLocal: 换成测试会话的同一个引擎
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    import app.core.database as dbmod
    monkeypatch.setattr(dbmod, "AsyncSessionLocal",
                        async_sessionmaker(db_session.bind, expire_on_commit=False, class_=AsyncSession))
    await ss._process_one(row.id, name, s.english)
    await db_session.refresh(row)
    assert row.status == "done" and row.passed is True and row.file_path is None
    assert not (speech_dir / name).exists()


def _done(v):
    import asyncio
    f = asyncio.get_running_loop().create_future()
    f.set_result(v)
    return f
