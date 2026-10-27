"""学习助手对话记录 + 按年级 / 接受程度讲(2026-10-27)

对话记录(services/tutor_history):
1. 分组按北京日: 今天 / 3 天内 / 7 天内 / 一个月内 / 更早,收藏的排最前
2. 搜索标题和内容,搜到内容给一小段原话;_ 和 % 不当通配符
3. 改名: 空标题 400;只点收藏不动标题;别人的对话 404
4. 孩子删: 孩子那边看不到、打不开、不能接着问(不扣次数);老师那边还看得到,标「孩子删了」
5. 到期清理: 180 天没动的没收藏对话、孩子删了 30 天的对话真删(连消息和练习),收藏的留着,
   小鹰老师的笔记不动;删之前先建次数行,用过的次数不会被退回去

讲法(services/tutor_level):
6. 年级: 设的优先,没设按在学的书推断(七年级 → 初一 → 初中),都没有按小学高年级讲;认不出的年级 400
7. 讲解方式: 自动按最近练习正确率和「听不懂」次数调一档;孩子 / 本班老师选了就按选的;别班老师 403
8. 提问时讲法进系统提示
"""
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core.timeutil import utc_now
from app.models.learning import LearningProgress
from app.models.tutor import TutorConversation, TutorMessage, TutorNote, TutorQuiz
from app.models.word import WordBook
from app.services import tutor as tt
from app.services import tutor_history as th
from app.services import tutor_level as tl
from tests.test_tutor import _ask, _env, _h, _text_reply, relay, shared_session  # noqa: F401


async def _conv(db, uid, title, *, days=0, starred=False, deleted_days=None, texts=()):
    c = TutorConversation(user_id=uid, org_id=1, title=title, message_count=len(texts),
                          updated_at=utc_now() - timedelta(days=days), starred=starred,
                          deleted_at=(utc_now() - timedelta(days=deleted_days)) if deleted_days is not None else None)
    db.add(c)
    await db.flush()
    for i, t in enumerate(texts):
        db.add(TutorMessage(conversation_id=c.id, user_id=uid, role="user" if i % 2 == 0 else "assistant", text=t))
    await db.commit()
    return c


async def _list(client, uid, q=None):
    r = await client.get("/api/v1/student/tutor/conversations", params={"q": q} if q else None, headers=_h(uid))
    assert r.status_code == 200
    return r.json()


# ---------------------------------------------------------------- 1-2 分组 / 搜索

@pytest.mark.asyncio
async def test_groups_starred_first_and_search(client, db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    await _conv(db_session, uid, "今天的", days=0)
    await _conv(db_session, uid, "昨天的", days=1)
    await _conv(db_session, uid, "五天前", days=5)
    await _conv(db_session, uid, "二十天前", days=20, texts=["一般现在时什么时候加 s", "主语是他她它的时候加 s。"])
    await _conv(db_session, uid, "两个月前收藏的", days=60, starred=True)
    await _conv(db_session, uid, "两个月前", days=60)
    await _conv(db_session, users["s2"].id, "别人的", days=0)

    body = await _list(client, uid)
    assert body["keep_days"] == th.KEEP_DAYS and body["deleted_keep_days"] == th.DELETED_KEEP_DAYS
    got = [(c["title"], c["group"]) for c in body["items"]]
    assert got == [("两个月前收藏的", "starred"), ("今天的", "today"), ("昨天的", "3d"), ("五天前", "7d"),
                   ("二十天前", "30d"), ("两个月前", "older")]
    assert next(c for c in body["items"] if c["title"] == "二十天前")["questions"] == 1

    # 搜内容: 给出命中的那一小段
    hit = (await _list(client, uid, "现在时"))["items"]
    assert [c["title"] for c in hit] == ["二十天前"] and "现在时" in hit[0]["snippet"]
    # 搜标题
    assert [c["title"] for c in (await _list(client, uid, "五天"))["items"]] == ["五天前"]
    # _ 和 % 不是通配符
    assert (await _list(client, uid, "_"))["items"] == []
    assert (await _list(client, uid, "%"))["items"] == []


# ---------------------------------------------------------------- 3 改名 / 收藏

@pytest.mark.asyncio
async def test_rename_and_star(client, db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    c = await _conv(db_session, uid, "apple 怎么记", days=3)
    url = f"/api/v1/student/tutor/conversations/{c.id}"

    r = await client.patch(url, json={"title": "   "}, headers=_h(uid))
    assert r.status_code == 400
    r = await client.patch(url, json={"title": "  记 apple  的  方法 " + "长" * 40}, headers=_h(uid))
    assert r.status_code == 200 and r.json()["title"] == ("记 apple 的 方法 " + "长" * 40)[:th.TITLE_MAX].strip()
    # 只点收藏: 标题不动,也不挪到「今天」那组
    r = await client.patch(url, json={"starred": True}, headers=_h(uid))
    assert r.status_code == 200 and r.json()["starred"] is True and r.json()["title"].startswith("记 apple")
    await db_session.refresh(c)
    assert (utc_now() - c.updated_at).days >= 2
    # 别人的对话
    r = await client.patch(url, json={"title": "x"}, headers=_h(users["s2"].id))
    assert r.status_code == 404


# ---------------------------------------------------------------- 4 孩子删

@pytest.mark.asyncio
async def test_student_delete_hides_but_teacher_still_sees(client, db_session, relay, shared_session):
    users = await _env(db_session)
    uid = users["s"].id
    relay([(200, _text_reply("先想想它有几个 p?"))])
    r, events = await _ask(client, uid, "apple 怎么拼")
    cid = events[0]["conversation_id"]
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(uid))).json()

    r = await client.delete(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(users["s2"].id))
    assert r.status_code == 404
    r = await client.delete(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(uid))
    assert r.status_code == 200 and r.json()["deleted_keep_days"] == th.DELETED_KEEP_DAYS

    assert (await _list(client, uid))["items"] == []
    assert (await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(uid))).status_code == 404
    # 删掉的对话不能接着问,而且不扣次数
    r, _ = await _ask(client, uid, "接着问", conversation_id=cid)
    assert r.status_code == 404
    assert (await client.get("/api/v1/student/tutor/status", headers=_h(uid))).json()["left"] == st["left"]

    log = (await client.get(f"/api/v1/teacher/students/{uid}/tutor", headers=_h(users["t"].id))).json()
    assert [(c["id"], c["deleted"]) for c in log["items"]] == [(cid, True)]


# ---------------------------------------------------------------- 5 到期清理

@pytest.mark.asyncio
async def test_purge_rules_keep_starred_notes_and_used_count(client, db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    # 10-26 第一版的提问: 没有次数行,已用次数按拿到回答的消息条数算
    old = await _conv(db_session, uid, "半年前", days=th.KEEP_DAYS + 1, texts=["apple?", "a-p-p-l-e"])
    db_session.add(TutorQuiz(user_id=uid, conversation_id=old.id, items=[{"type": "choice"}], total=1))
    db_session.add(TutorNote(user_id=uid, topic_key="apple", topic="apple", kind="word"))
    await db_session.commit()
    keep_recent = await _conv(db_session, uid, "上个月", days=th.KEEP_DAYS - 1)
    keep_starred = await _conv(db_session, uid, "半年前收藏的", days=th.KEEP_DAYS + 30, starred=True)
    gone = await _conv(db_session, uid, "删了一个多月", days=40, deleted_days=th.DELETED_KEEP_DAYS + 1)
    still = await _conv(db_session, uid, "刚删的", days=1, deleted_days=2)
    gone_starred = await _conv(db_session, uid, "收藏又删的", days=40, starred=True,
                               deleted_days=th.DELETED_KEEP_DAYS + 1)
    settings = await tt.get_settings(db_session)
    assert (await tt.allowance_status(db_session, uid, settings))["used"] == 1

    assert await th.purge_expired(db_session) == 3
    left = set((await db_session.execute(select(TutorConversation.id))).scalars())
    assert left == {keep_recent.id, keep_starred.id, still.id}
    assert gone.id not in left and gone_starred.id not in left
    msgs = (await db_session.execute(select(func.count(TutorMessage.id))
                                     .where(TutorMessage.conversation_id == old.id))).scalar()
    quizzes = (await db_session.execute(select(func.count(TutorQuiz.id))
                                        .where(TutorQuiz.conversation_id == old.id))).scalar()
    assert msgs == 0 and quizzes == 0
    assert (await db_session.execute(select(func.count(TutorNote.id)))).scalar() == 1
    # 消息删了,用过的那 1 次还在
    assert (await tt.allowance_status(db_session, uid, settings))["used"] == 1
    # 再跑一次什么都不删
    assert await th.purge_expired(db_session) == 0


# ---------------------------------------------------------------- 6-8 讲法

async def _prefs(client, uid):
    r = await client.get("/api/v1/student/tutor/prefs", headers=_h(uid))
    assert r.status_code == 200
    return r.json()


@pytest.mark.asyncio
async def test_grade_from_book_then_settings(client, db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    p = await _prefs(client, uid)
    assert p["grade"] is None and p["band"] == "p_high" and p["grade_source"] == "none"

    b = WordBook(name="人教版七年级上册", grade_level="七年级")
    db_session.add(b)
    await db_session.flush()
    db_session.add(LearningProgress(user_id=uid, book_id=b.id, learning_mode="flashcard", last_studied_at=utc_now()))
    await db_session.commit()
    p = await _prefs(client, uid)
    assert (p["grade"], p["band"], p["grade_source"], p["book"]) == ("初一", "junior", "book", "人教版七年级上册")

    r = await client.put("/api/v1/student/tutor/prefs", json={"grade": "三年级"}, headers=_h(uid))
    assert r.status_code == 200 and (r.json()["grade"], r.json()["band"], r.json()["grade_source"]) == \
        ("三年级", "p_low", "student")
    # 只改讲解方式,年级不动
    r = await client.put("/api/v1/student/tutor/prefs", json={"pace": "simple"}, headers=_h(uid))
    assert r.json()["grade"] == "三年级" and r.json()["pace"] == "simple" and r.json()["pace_mode"] == "student"
    assert (await client.put("/api/v1/student/tutor/prefs", json={"grade": "大学"}, headers=_h(uid))).status_code == 400
    # 清掉年级: 回到按书推断
    r = await client.put("/api/v1/student/tutor/prefs", json={"grade": ""}, headers=_h(uid))
    assert (r.json()["grade"], r.json()["grade_source"]) == ("初一", "book")


@pytest.mark.asyncio
async def test_auto_pace_and_teacher_override(client, db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    for _ in range(3):
        db_session.add(TutorQuiz(user_id=uid, items=[{"type": "choice"}] * 2, total=2, score=0, submitted_at=utc_now()))
    await db_session.commit()
    p = await _prefs(client, uid)
    assert p["pace"] == "simple" and p["pace_mode"] == "auto" and "0/6" in p["auto_reasons"][0]

    # 别班老师不能改,本班老师能改,改了以后不再自动
    url = f"/api/v1/teacher/students/{uid}/tutor-prefs"
    assert (await client.put(url, json={"pace": "deep"}, headers=_h(users["ot"].id))).status_code == 403
    r = await client.put(url, json={"pace": "deep"}, headers=_h(users["t"].id))
    assert r.status_code == 200 and (r.json()["pace"], r.json()["pace_mode"], r.json()["auto_pace"]) == \
        ("deep", "teacher", "simple")
    log = (await client.get(f"/api/v1/teacher/students/{uid}/tutor", headers=_h(users["t"].id))).json()
    assert log["prefs"]["pace"] == "deep"
    # 改回自动
    r = await client.put("/api/v1/student/tutor/prefs", json={"pace": "auto"}, headers=_h(uid))
    assert (r.json()["pace"], r.json()["pace_mode"]) == ("simple", "auto")


@pytest.mark.asyncio
async def test_confused_messages_lower_pace(db_session, relay):
    users = await _env(db_session)
    uid = users["s"].id
    await _conv(db_session, uid, "x", texts=["听不懂", "好的", "还是不会,讲给我听", "好的", "讲简单点", "好的"])
    pace, reasons = await tl.auto_pace(db_session, uid)
    assert pace == -1 and "3 次" in reasons[0]


@pytest.mark.asyncio
async def test_level_goes_into_system_prompt(client, db_session, relay, shared_session):
    users = await _env(db_session)
    uid = users["s"].id
    await client.put("/api/v1/student/tutor/prefs", json={"grade": "二年级", "pace": "simple"}, headers=_h(uid))
    fake = relay([(200, _text_reply("好的。"))])
    r, _ = await _ask(client, uid, "apple 怎么记")
    assert r.status_code == 200
    tail = fake.requests[0]["system"][1]["text"]
    assert "讲解方式" in tail and tl.BAND_STYLE["p_low"] in tail and tl.PACE_TEXT[-1] in tail
    assert "孩子s" not in tail
    # 规则那段不变(走缓存),里面写了怎么随反应调
    assert fake.requests[0]["system"][0]["text"] == tt.RULES and "听不懂" in tt.RULES
