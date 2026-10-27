"""学习助手「教会」闭环(2026-10-27,用户「按你建议来」): 练习服务器判分 → 结果回给小鹰老师点评 → 记笔记 → 隔天回头考

锁住的规矩:
1. 答案只在服务器: 单词卡没有拼写、语法题没有答案;交了才判
2. 第一次交的才算(记笔记、点评);两个请求同时点评只有一个拿到
3. 做完练习的点评不扣次数,也不占「同一道题追问」的 3 次;点评那一轮里又出的练习,再点评按普通提问算
4. 发给模型的点评内容是服务器从库里拼的(题目、孩子的答案、对错),不信前端
5. 别人的练习交不了、点评不了(404)
6. 笔记: 刚讲完马上答对不算学会;到期那天答对才升级,三次学会;答错回到明天
7. 笔记进系统提示,学情档案超长时也留着
"""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models.tutor import TutorAllowance, TutorMessage, TutorNote, TutorQuiz
from app.models.word import Word, WordDefinition
from app.services import tutor as tt
from app.services import tutor_notes, tutor_profile, tutor_quiz
from tests.test_tutor import _ask, _env, _h, _text_reply, _tool_call, relay, shared_session  # noqa: F401


async def _used(db, uid):
    row = await db.get(TutorAllowance, uid)
    await db.refresh(row)
    return row.used


QUIZ = {"topic": "一般现在时第三人称加 s", "items": [
    {"type": "choice", "question": "She ___ apples.", "options": ["like", "likes", "liking"], "answer": "likes",
     "explain": "she 是第三人称单数"},
    {"type": "fill", "question": "He ___ (go) to school every day.", "answer": "goes"},
    {"type": "order", "answer": "My brother plays football."},
]}


def test_build_and_grade():
    full, public, problems = tutor_quiz.build_items(QUIZ["items"] + [{"type": "fill", "question": "no blank", "answer": "x"}], 1)
    assert len(full) == 3 and len(problems) == 1
    # 发给孩子的没有答案
    pub = json.dumps(public, ensure_ascii=False)
    assert "answer" not in pub and "explain" not in pub and "goes" not in pub
    assert sorted(public[2]["tokens"]) == sorted(["my", "brother", "plays", "football"])
    results, score = tutor_quiz.grade(full, [1, "Goes ", "my brother plays football"])
    assert score == 3, results
    results, score = tutor_quiz.grade(full, ["like", "go", "brother my plays football"])
    assert score == 0 and results[0]["answer"] == "likes" and results[2]["answer"] == "My brother plays football."
    # 选择题 answer 可以写字母
    full2, _, _ = tutor_quiz.build_items([{"type": "choice", "question": "q", "options": ["a1", "b1"], "answer": "B"}], 1)
    assert full2[0]["answer"] == 1


async def _quiz_round(client, relay, users):
    fake = relay([
        (200, _tool_call("make_quiz", QUIZ, "tu_q")),
        (200, _text_reply("在下面做一做。")),
    ])
    r, events = await _ask(client, users["s"].id, "教我一般现在时")
    assert r.status_code == 200, r.text
    card = next(e["card"] for e in events if e["type"] == "card")
    return fake, card, events[0]["conversation_id"]


@pytest.mark.asyncio
async def test_quiz_feedback_is_free_and_server_built(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    _, card, cid = await _quiz_round(client, relay, users)
    # 发下来的题没有答案: 选择题只有选项(不知道哪个对)、填空没有空里的词、连词成句只有打乱的词
    pub = json.dumps(card, ensure_ascii=False)
    assert card["type"] == "quiz" and '"answer"' not in pub and '"explain"' not in pub
    assert "goes" not in pub and "My brother plays football" not in pub
    used0 = await _used(db_session, s)

    # 别人交不了
    r = await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit", json={"answers": [1]},
                          headers=_h(users["s2"].id))
    assert r.status_code == 404
    r = await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit",
                          json={"answers": [0, "goes", "my brother plays football"]}, headers=_h(s))
    assert r.status_code == 200
    res = r.json()
    assert res["score"] == 2 and res["first"] and res["feedback"]
    assert res["results"][0]["answer"] == "likes" and res["results"][0]["explain"] == "she 是第三人称单数"
    # 再写一遍: 照样判分,但不覆盖第一次、不再点评
    r = await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit", json={"answers": [1, "goes", "x"]},
                          headers=_h(s))
    assert r.json()["first"] is False and r.json()["feedback"] is False

    # 别人点评不了
    r = await client.post("/api/v1/student/tutor/ask", data={"text": "x", "quiz_id": str(card["quiz_id"])},
                          headers=_h(users["s2"].id))
    assert r.status_code == 404

    fake = relay([(200, _text_reply("对了 2 题。第 1 题 she 后面要用 likes。"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"text": "随便写的", "quiz_id": str(card["quiz_id"])},
                          headers=_h(s))
    assert r.status_code == 200
    events = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")]
    assert events[0]["cost"] == 0 and events[-1]["type"] == "done"
    # 发给模型的是服务器拼的: 有题目、孩子的答案、对错;前端传的 text 不用
    sent = fake.requests[0]["messages"][-1]["content"][-1]["text"]
    assert "She ___ apples." in sent and "他答: like" in sent and "对了 2/3" in sent and "随便写的" not in sent
    assert await _used(db_session, s) == used0
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user")
                                   .order_by(TutorMessage.id.desc()).limit(1))).scalar_one()
    assert um.cost == tt.COST_FEEDBACK and um.text == "我做完了,对了 2/3"

    # 一份练习只点评一次
    relay([(200, _text_reply("x"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"quiz_id": str(card["quiz_id"])}, headers=_h(s))
    assert r.status_code == 409

    # 点评不占「同一道题追问」的 3 次: 第一问之后仍然有 3 次免费追问
    assert (await tt.followup_state(db_session, cid))["left"] == tt.FOLLOWUP_FREE

    # 刷新对话: 练习卡带着第一次的结果,但不带答案原文以外的东西
    r = await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(s))
    qcard = r.json()["messages"][1]["cards"][0]
    assert qcard["result"]["score"] == 2 and qcard["result"]["feedback_done"] is True and "key" not in qcard


@pytest.mark.asyncio
async def test_quiz_made_in_feedback_round_is_not_free(client, db_session, relay, shared_session):
    """点评那一轮又出的练习,再点评按普通提问算(不然能一直白用)"""
    users = await _env(db_session)
    s = users["s"].id
    _, card, cid = await _quiz_round(client, relay, users)
    await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit", json={"answers": [1, "goes", "x"]},
                      headers=_h(s))
    relay([(200, _tool_call("make_quiz", {"topic": "t", "items": [QUIZ["items"][0]]}, "tu_2")),
           (200, _text_reply("再来一道。"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"quiz_id": str(card["quiz_id"])}, headers=_h(s))
    events = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")]
    card2 = next(e["card"] for e in events if e["type"] == "card")
    q2 = await db_session.get(TutorQuiz, card2["quiz_id"])
    await db_session.refresh(q2)
    assert q2.free_feedback is False
    await client.post(f"/api/v1/student/tutor/quizzes/{card2['quiz_id']}/submit", json={"answers": [1]}, headers=_h(s))
    used0 = await _used(db_session, s)
    relay([(200, _text_reply("全对。"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"quiz_id": str(card2["quiz_id"])}, headers=_h(s))
    events = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")]
    # 还在第一问的 15 分钟里: 走普通的「同一道题追问」(cost 0,但占一次),不是练习点评
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user")
                                   .order_by(TutorMessage.id.desc()).limit(1))).scalar_one()
    assert um.cost == 0 and events[0]["cost"] == 0
    assert await _used(db_session, s) == used0
    assert (await tt.followup_state(db_session, cid))["left"] == tt.FOLLOWUP_FREE - 1


@pytest.mark.asyncio
async def test_failed_feedback_releases_claim(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    _, card, _ = await _quiz_round(client, relay, users)
    await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit", json={"answers": [1, "goes", "x"]},
                      headers=_h(s))
    relay([(503, {"error": {"message": "No available accounts"}})] * 6)
    r = await client.post("/api/v1/student/tutor/ask", data={"quiz_id": str(card["quiz_id"])}, headers=_h(s))
    events = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")]
    assert events[-1]["type"] == "error"
    q = await db_session.get(TutorQuiz, card["quiz_id"])
    await db_session.refresh(q)
    assert q.feedback_at is None      # 没讲成: 孩子可以再点一次
    relay([(200, _text_reply("好。"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"quiz_id": str(card["quiz_id"])}, headers=_h(s))
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_word_practice_grades_on_server_and_writes_notes(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    w = Word(word="apple", phonetic="/ˈæpl/")
    db_session.add(w)
    await db_session.flush()
    db_session.add(WordDefinition(word_id=w.id, meaning="n. 苹果", is_primary=True))
    await db_session.commit()
    relay([(200, _tool_call("make_practice", {"words": ["apple"], "mode": "meaning"}, "tu_p")),
           (200, _text_reply("写一写。"))])
    r, events = await _ask(client, s, "考考我")
    card = next(e["card"] for e in events if e["type"] == "card")
    assert "apple" not in json.dumps(card) and card["items"][0]["letters"] == 5
    r = await client.post(f"/api/v1/student/tutor/quizzes/{card['quiz_id']}/submit", json={"answers": ["aple"]},
                          headers=_h(s))
    assert r.json()["results"][0] == {"ok": False, "your": "aple", "answer": "apple"}
    n = (await db_session.execute(select(TutorNote).where(TutorNote.user_id == s))).scalar_one()
    assert n.topic == "apple" and n.kind == "word" and n.stage == 0 and "aple" in n.detail
    assert n.due_date == (tutor_notes.local_today() + timedelta(days=1)).isoformat()


@pytest.mark.asyncio
async def test_notes_spacing(db_session):
    users = await _env(db_session)
    s = users["s"].id
    d0 = date(2026, 10, 27)
    await tutor_notes.record(db_session, s, "一般现在时 第三人称加s", "taught", today=d0)
    # 刚讲完马上答对: 不算(短时记忆)
    n = await tutor_notes.record(db_session, s, "一般现在时,第三人称加 s", "right", today=d0)
    assert n.stage == 0 and n.due_date == "2026-10-28"
    n = await tutor_notes.record(db_session, s, "一般现在时第三人称加s", "right", today=date(2026, 10, 28))
    assert n.stage == 1 and n.due_date == "2026-10-31"
    n = await tutor_notes.record(db_session, s, "一般现在时第三人称加s", "right", today=date(2026, 10, 31))
    assert n.stage == 2 and n.due_date == "2026-11-07"
    n = await tutor_notes.record(db_session, s, "一般现在时第三人称加s", "wrong", today=date(2026, 11, 7))
    assert n.stage == 0 and n.due_date == "2026-11-08" and not n.mastered
    # 没到期答对不升级
    n = await tutor_notes.record(db_session, s, "一般现在时第三人称加s", "right", today=date(2026, 11, 7))
    assert n.stage == 0
    for d in (date(2026, 11, 8), date(2026, 11, 11), date(2026, 11, 18)):
        n = await tutor_notes.record(db_session, s, "一般现在时第三人称加s", "right", today=d)
    assert n.mastered and n.due_date is None
    # 没记过的答对不建行
    assert await tutor_notes.record(db_session, s, "没讲过的点", "right", today=d0) is None
    rows = (await db_session.execute(select(TutorNote).where(TutorNote.user_id == s))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_due_notes_in_profile_even_when_long(db_session):
    users = await _env(db_session)
    s = users["s"]
    await tutor_notes.record(db_session, s.id, "be 动词", "stuck", detail="is 和 are 分不清",
                             today=tutor_notes.local_today() - timedelta(days=2))
    await db_session.commit()
    line = await tutor_notes.profile_line(db_session, s.id)
    assert line and "今天该回头考: be 动词(上次卡在: is 和 are 分不清)" in line
    body = tutor_profile.render(["- 很长的一行 " + "x" * 700, line])
    assert line in body and len(body) <= tutor_profile.MAX_LEN + 10


@pytest.mark.asyncio
async def test_save_note_tool(client, db_session, relay, shared_session):
    users = await _env(db_session)
    relay([(200, _tool_call("save_note", {"topic": "there be", "status": "stuck", "detail": "单复数"}, "tu_n")),
           (200, _text_reply("好。"))])
    r, events = await _ask(client, users["s"].id, "there be 我不懂")
    assert events[-1]["type"] == "done"
    n = (await db_session.execute(select(TutorNote).where(TutorNote.user_id == users["s"].id))).scalar_one()
    assert n.topic == "there be" and n.detail == "单复数"
    # 别的孩子没有
    assert not (await db_session.execute(select(TutorNote).where(TutorNote.user_id == users["s2"].id))).first()


@pytest.mark.asyncio
async def test_claim_feedback_only_once(db_session):
    """两个点评请求同时到(都过了 API 里的预检): 条件 UPDATE 只让一个认领到"""
    users = await _env(db_session)
    s = users["s"].id
    full, _, _ = tutor_quiz.build_items(QUIZ["items"], 1)
    q = await tutor_quiz.create(db_session, s, {"conversation_id": None}, full, "t")
    await db_session.commit()
    assert await tutor_quiz.claim_feedback(db_session, s, q.id) is None      # 还没交
    await tutor_quiz.submit(db_session, s, q.id, [1, "goes", "x"])
    assert await tutor_quiz.claim_feedback(db_session, users["s2"].id, q.id) is None   # 别人的
    assert await tutor_quiz.claim_feedback(db_session, s, q.id) is not None
    await db_session.commit()
    assert await tutor_quiz.claim_feedback(db_session, s, q.id) is None
    await tutor_quiz.release_feedback(db_session, q.id)
    assert await tutor_quiz.claim_feedback(db_session, s, q.id) is not None
