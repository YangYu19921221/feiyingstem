"""效果数据 + 老师端全班汇总 + 按单元查课本(services/tutor_insight、tutor.tool_unit_words,2026-10-27)

锁住的规矩:
1. 效果: 只算小鹰老师笔记里的单词;之前 = 起点前 30 天的正式计分题,之后 = 起点之后;两边都有题才算这个词
2. 不够 MIN_WORDS 个词 enough=False(前端不下结论)
3. 全班汇总只看本班;有没处理提醒的孩子排最前;卡得多的知识点列出来
4. 机构管理员的效果只算本机构
5. get_unit_words 只查孩子学过 / 今天作业里的单元,别的书查不到
"""
from datetime import timedelta

import pytest

from app.core.timeutil import utc_now
from app.models.learning import LearningProgress, LearningRecord
from app.models.tutor import TutorAlert, TutorMessage, TutorNote, TutorConversation
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import tutor as tt
from app.services import tutor_insight as ti
from tests.test_tutor import _env, _h


async def _word(db, w):
    x = Word(word=w)
    db.add(x)
    await db.flush()
    db.add(WordDefinition(word_id=x.id, meaning=f"{w}的意思", is_primary=True, example_sentence=f"I like {w}."))
    return x


def _rec(uid, wid, at, ok, mode="spelling"):
    return LearningRecord(user_id=uid, word_id=wid, learning_mode=mode, is_correct=ok, created_at=at)


@pytest.mark.asyncio
async def test_effect_before_after(db_session):
    users = await _env(db_session)
    s = users["s"].id
    now = utc_now()
    start = now - timedelta(days=5)
    w1, w2, w3 = await _word(db_session, "because"), await _word(db_session, "friend"), await _word(db_session, "zebra")
    db_session.add_all([
        TutorNote(user_id=s, topic_key="because", topic="because", kind="word", created_at=start),
        TutorNote(user_id=s, topic_key="friend", topic="friend", kind="word", created_at=start),
        TutorNote(user_id=s, topic_key="一般现在时", topic="一般现在时", kind="point", created_at=start),
        # 另一个更早记下的词: 把这个孩子的查询起点拉到很早,because 那条 40 天前的记录也会被查出来,得靠 30 天窗口挡掉
        TutorNote(user_id=s, topic_key="apple", topic="apple", kind="word", created_at=start - timedelta(days=60)),
        # because: 之前 0/2,之后 2/2
        _rec(s, w1.id, start - timedelta(days=2), False), _rec(s, w1.id, start - timedelta(days=1), False),
        _rec(s, w1.id, start + timedelta(days=1), True), _rec(s, w1.id, start + timedelta(days=2), True),
        # friend: 只有之后,不算
        _rec(s, w2.id, start + timedelta(days=1), True),
        # because 太早(超过 30 天)的不算进之前
        _rec(s, w1.id, start - timedelta(days=40), True),
        # 不在笔记里的词不算
        _rec(s, w3.id, start - timedelta(days=1), False), _rec(s, w3.id, start + timedelta(days=1), True),
        # 不计分的模式不算
        _rec(s, w1.id, start + timedelta(days=3), False, mode="flashcard"),
    ])
    await db_session.commit()
    e = await ti.effect(db_session, user_ids=[s])
    assert e["words"] == 1 and e["before"] == 0.0 and e["after"] == 1.0 and e["enough"] is False
    assert e["noted_words"] == 3


@pytest.mark.asyncio
async def test_class_summary_scope_and_order(client, db_session):
    from sqlalchemy import select as _sel
    from app.models.user import Class, ClassStudent, User
    users = await _env(db_session)
    s, s2 = users["s"].id, users["s2"].id
    s3 = User(username="tuts3", email="tuts3@e.com", hashed_password="x", role="student", is_active=True, org_id=1)
    db_session.add(s3)
    await db_session.flush()
    c = (await db_session.execute(_sel(Class).where(Class.teacher_id == users["t"].id))).scalars().first()
    db_session.add(ClassStudent(class_id=c.id, student_id=s3.id, is_active=True))
    conv = TutorConversation(user_id=s, title="t", message_count=0)
    db_session.add(conv)
    await db_session.flush()
    db_session.add_all([
        TutorMessage(conversation_id=conv.id, user_id=s, role="user", text="a"),
        TutorMessage(conversation_id=conv.id, user_id=s, role="user", text="b"),
        TutorMessage(conversation_id=conv.id, user_id=s2, role="user", text="不是本班的"),
        TutorNote(user_id=s, topic_key="一般现在时", topic="一般现在时第三人称", kind="point", times_wrong=2),
        TutorAlert(user_id=s3.id, org_id=1, level="urgent", source="keyword"),
    ])
    await db_session.commit()
    r = await client.get("/api/v1/teacher/tutor/summary", headers=_h(users["t"].id))
    d = r.json()
    # s2 不在本班;有没处理提醒的 s3 排在问得多的 s 前面
    assert r.status_code == 200 and [x["id"] for x in d["items"]] == [s3.id, s]
    assert d["items"][0]["urgent"] == 1 and d["items"][1]["questions"] == 2 and d["items"][1]["stuck"] == 1
    assert d["stuck_points"][0]["topic"] == "一般现在时第三人称" and d["questions"] == 2
    other = await client.get("/api/v1/teacher/tutor/summary", headers=_h(users["ot"].id))
    assert other.json()["items"] == []


@pytest.mark.asyncio
async def test_effect_endpoint_scoped(client, db_session):
    from app.models.user import User
    users = await _env(db_session)
    oa = User(username="tutoa2", email="tutoa2@e.com", hashed_password="x", role="org_admin", is_active=True, org_id=9981)
    db_session.add(oa)
    db_session.add(TutorNote(user_id=users["s"].id, topic_key="because", topic="because", kind="word"))
    await db_session.commit()
    assert (await client.get("/api/v1/admin/tutor/effect", headers=_h(users["t"].id))).status_code == 403
    assert (await client.get("/api/v1/admin/tutor/effect", headers=_h(oa.id))).json()["noted_words"] == 0
    assert (await client.get("/api/v1/admin/tutor/effect", headers=_h(users["a"].id))).json()["noted_words"] == 1


@pytest.mark.asyncio
async def test_unit_words_only_studied_units(db_session):
    users = await _env(db_session)
    s = users["s"]
    b = WordBook(name="人教版五上", is_public=True)
    b2 = WordBook(name="别的书", is_public=True)
    db_session.add_all([b, b2])
    await db_session.flush()
    u3 = Unit(book_id=b.id, unit_number=3, name="Unit 3 What would you like")
    u9 = Unit(book_id=b2.id, unit_number=9, name="Unit 9 Secret")
    db_session.add_all([u3, u9])
    await db_session.flush()
    w = await _word(db_session, "sandwich")
    w2 = await _word(db_session, "secret")
    db_session.add_all([UnitWord(unit_id=u3.id, word_id=w.id, order_index=1), UnitWord(unit_id=u9.id, word_id=w2.id, order_index=1),
                        LearningProgress(user_id=s.id, book_id=b.id, unit_id=u3.id, learning_mode="classify",
                                         last_studied_at=utc_now())])
    await db_session.commit()
    r = await tt.tool_unit_words(db_session, s)
    assert r["found"] and "Unit 3" in r["unit"] and r["words"][0]["word"] == "sandwich" and r["words"][0]["example"]
    assert (await tt.tool_unit_words(db_session, s, "unit 3"))["found"]
    assert (await tt.tool_unit_words(db_session, s, "Unit 9"))["found"] is False     # 没学过的书查不到
