"""小鹰老师补知识点 + 教师端小鹰老师(2026-10-29)

用户「如果用户欠缺知识点如何帮助学生解决问题,教师端也需要一个月 1000 的额度,需要同样的功能」→
「直营免费,加盟和我们购买 300 / 1000 次」。锁住的规矩:
1. 缺前置: save_note(stuck, missing=…) 原来那条写明缺什么,前置另记一条
2. 交给老师: 练习里同一个点错满 HANDOFF_WRONG 次、没学会 → 老师列表里有;讲过了消失;之后又错了重新出现;只看本班
3. 首页「考考你」: 今天到期的点,一天第一次不扣次数(cost=-4,不算追问);别人的 / 没到期的 404;没调通还回去
4. 教师端次数: 每位老师每月 monthly 次;直营不扣机构池;加盟机构每问一次扣池,池里不够 429 且老师那个月不扣;没调通两边都退
5. 教师端隐私: 老师写的学生姓名换成代号再发给模型,工具结果只有代号;工具只查本班
6. 教师端对话只给本人;学生看不到老师的对话
"""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core.timeutil import local_today
from app.models.tutor import TeacherTutorUsage, TutorMessage, TutorNote, TutorOrgPool
from app.models.user import Class, ClassStudent, User
from app.services import teacher_tutor as tch
from app.services import tutor as tt
from app.services import tutor_notes
from tests.test_tutor import _ask, _env, _h, _text_reply, _tool_call, relay, shared_session  # noqa: F401
from tests.test_tutor_pricing import _franchise_class


async def _teacher_ask(client, uid, text="帮我出 3 道一般现在时的题", conversation_id=None, mode="fast"):
    data = {"text": text, "mode": mode}
    if conversation_id:
        data["conversation_id"] = str(conversation_id)
    r = await client.post("/api/v1/teacher/tutor/me/ask", data=data, headers=_h(uid))
    events = []
    if r.status_code == 200:
        for chunk in r.text.split("\n\n"):
            if chunk.startswith("data: "):
                events.append(json.loads(chunk[6:]))
    return r, events


async def _wrong(db, uid, topic, n, kind="point"):
    for _ in range(n):
        await tutor_notes.record(db, uid, topic, "wrong", kind=kind, detail="答成 go")
    await db.commit()


# ---------------------------------------------------------------- 1. 缺前置

@pytest.mark.asyncio
async def test_missing_prerequisite_recorded_as_its_own_note(db_session):
    users = await _env(db_session)
    sid = users["s"].id
    out = await tutor_notes.tool_save_note(db_session, sid, {
        "topic": "一般现在时第三人称加 s", "status": "stuck", "missing": "判断主语是不是第三人称单数"})
    assert out["ok"] and out["missing"] == "判断主语是不是第三人称单数"
    notes = {n.topic: n for n in (await db_session.execute(select(TutorNote).where(TutorNote.user_id == sid))).scalars()}
    assert notes["一般现在时第三人称加 s"].detail.startswith("缺前置: 判断主语")
    pre = notes["判断主语是不是第三人称单数"]
    assert pre.due_date == (local_today() + timedelta(days=1)).isoformat() and not pre.mastered
    # missing 和 topic 一样: 不另记
    await tutor_notes.tool_save_note(db_session, sid, {"topic": "be 动词", "status": "stuck", "missing": "be动词"})
    assert (await db_session.execute(select(TutorNote).where(TutorNote.user_id == sid))).scalars().all().__len__() == 3


# ---------------------------------------------------------------- 2. 交给老师

@pytest.mark.asyncio
async def test_handoff_after_repeated_wrong_and_reappears(client, db_session):
    users = await _env(db_session)
    sid, t, ot = users["s"].id, users["t"].id, users["ot"].id
    await _wrong(db_session, sid, "一般现在时第三人称加 s", tutor_notes.HANDOFF_WRONG - 1)
    await tutor_notes.record(db_session, sid, "be 动词", "stuck")    # 只是 stuck,不算
    await db_session.commit()
    r = await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))
    assert r.json()["items"] == []
    await _wrong(db_session, sid, "一般现在时第三人称加 s", 1)
    r = (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))).json()
    assert r["pending"] == 1 and r["items"][0]["topic"] == "一般现在时第三人称加 s"
    assert r["items"][0]["student_name"] == "孩子s"
    # 没填姓名: 老师要认得出是谁,用用户名(不藏成「孩子」)
    stu = await db_session.get(User, sid)
    stu.full_name = None
    await db_session.commit()
    r2 = (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))).json()
    assert r2["items"][0]["student_name"] == stu.username
    assert (await client.get("/api/v1/teacher/tutor/available", headers=_h(t))).json()["handoffs"] == 1
    # 别班老师看不到、也处理不了
    assert (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(ot))).json()["items"] == []
    nid = r["items"][0]["note_id"]
    assert (await client.post(f"/api/v1/teacher/tutor/handoffs/{nid}", headers=_h(ot), json={})).status_code == 403
    # 讲过了: 消失;明天回头考
    r = await client.post(f"/api/v1/teacher/tutor/handoffs/{nid}", headers=_h(t), json={"note": "课后讲了主语"})
    assert r.status_code == 200
    assert (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))).json()["items"] == []
    n = await db_session.get(TutorNote, nid)
    await db_session.refresh(n)
    assert n.due_date == (local_today() + timedelta(days=1)).isoformat()
    # 讲过以后又错了: 重新出现,带着上次讲的记录
    await _wrong(db_session, sid, "一般现在时第三人称加 s", 1)
    r = (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))).json()
    assert r["pending"] == 1 and r["items"][0]["handled"]["note"] == "课后讲了主语"
    # 学会了就不再出现
    n.mastered = True
    await db_session.commit()
    assert (await client.get("/api/v1/teacher/tutor/handoffs", headers=_h(t))).json()["items"] == []


# ---------------------------------------------------------------- 3. 首页「考考你」

@pytest.mark.asyncio
async def test_review_question_is_free_once_a_day(client, db_session, relay, shared_session):
    users = await _env(db_session)
    sid, s2 = users["s"].id, users["s2"].id
    await tutor_notes.record(db_session, sid, "一般现在时第三人称加 s", "taught",
                             today=local_today() - timedelta(days=1))
    await db_session.commit()
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(sid))).json()
    rv = st["review"]
    assert rv and rv["topic"] == "一般现在时第三人称加 s"
    # 别人的笔记 404
    r = await client.post("/api/v1/student/tutor/ask", data={"review_note_id": str(rv["note_id"])}, headers=_h(s2))
    assert r.status_code == 404
    fake = relay([(200, _text_reply("来,10 秒考考你。")), (200, _text_reply("再来一题"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"review_note_id": str(rv["note_id"]), "text": "随便写的"},
                          headers=_h(sid))
    assert r.status_code == 200
    # 考哪个点由服务器从笔记里拼,不用前端的字
    last = fake.requests[0]["messages"][-1]["content"][-1]["text"]
    assert "回头考" in last and "一般现在时第三人称加 s" in last and "随便写的" not in last
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user"))).scalar_one()
    assert um.cost == tt.COST_REVIEW and um.text == "考考我: 一般现在时第三人称加 s"
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(sid))).json()
    assert st["used"] == 0 and st["review"] is None        # 今天的用过了,首页不再出
    # 今天第二次: 照常扣
    r = await client.post("/api/v1/student/tutor/ask", data={"review_note_id": str(rv["note_id"])}, headers=_h(sid))
    assert r.status_code == 200
    assert (await client.get("/api/v1/student/tutor/status", headers=_h(sid))).json()["used"] == 1


@pytest.mark.asyncio
async def test_review_not_due_404_and_failure_gives_it_back(client, db_session, relay, shared_session):
    users = await _env(db_session, fallback=None)
    sid = users["s"].id
    n = await tutor_notes.record(db_session, sid, "be 动词", "taught")    # 今天刚讲,明天才到期
    await db_session.commit()
    r = await client.post("/api/v1/student/tutor/ask", data={"review_note_id": str(n.id)}, headers=_h(sid))
    assert r.status_code == 404
    n.due_date = local_today().isoformat()
    await db_session.commit()
    relay([(503, {"error": {"message": "No available accounts"}})] * 2)
    r = await client.post("/api/v1/student/tutor/ask", data={"review_note_id": str(n.id)}, headers=_h(sid))
    assert r.status_code == 200
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(sid))).json()
    assert st["review"] is not None and st["used"] == 0    # 没调通: 今天的「考考你」还回去了


# ---------------------------------------------------------------- 4. 教师端次数

@pytest.mark.asyncio
async def test_teacher_monthly_limit_direct_org_no_pool(client, db_session, relay, shared_session):
    users = await _env(db_session)
    t, a = users["t"].id, users["a"].id
    r = await client.put("/api/v1/admin/tutor/teacher", headers=_h(a), json={"enabled": True, "monthly": 2})
    assert r.status_code == 200 and r.json()["monthly"] == 2
    st = (await client.get("/api/v1/teacher/tutor/me/status", headers=_h(t))).json()
    assert st["enabled"] and st["left"] == 2 and st["uses_pool"] is False and st["price"] == 0
    relay([(200, _text_reply("好的,题在下面")), (200, _text_reply("第二次"))])
    for _ in range(2):
        r, ev = await _teacher_ask(client, t)
        assert r.status_code == 200 and ev[-1]["type"] == "done"
    r, _ = await _teacher_ask(client, t)
    assert r.status_code == 429 and "1 号恢复" in r.json()["detail"]
    row = (await db_session.execute(select(TeacherTutorUsage).where(TeacherTutorUsage.user_id == t))).scalar_one()
    assert row.used == 2 and row.month == tch.month_key()
    assert (await db_session.execute(select(TutorOrgPool))).scalars().all() == []   # 直营不走池子
    # 老师的提问不算「问过的学生」
    adm = (await client.get("/api/v1/admin/tutor", headers=_h(a))).json()
    assert all(d["students"] == 0 for d in adm["usage"]) and adm["teacher"]["used"] == 2
    # 学生看不到老师的对话
    cid = (await db_session.execute(select(TutorMessage.conversation_id))).scalars().first()
    r = await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(users["s"].id))
    assert r.status_code == 404
    r = await client.get(f"/api/v1/teacher/tutor/me/conversations/{cid}", headers=_h(users["ot"].id))
    assert r.status_code == 404
    assert (await client.get(f"/api/v1/teacher/tutor/me/conversations/{cid}", headers=_h(t))).status_code == 200


@pytest.mark.asyncio
async def test_franchise_teacher_takes_from_pool_and_refunds(client, db_session, relay, shared_session):
    users = await _env(db_session, fallback=None)
    ft, _ = await _franchise_class(db_session, users)
    a = users["a"].id
    # 池子 0: 机构没开通,用不了
    r, _ = await _teacher_ask(client, ft.id)
    assert r.status_code == 403
    # 进货 1000 次,先扣回到只剩 1 次(扣回最多扣到已分出去的: 先把 999 记成已分)
    await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a), json={"times": 1000})
    await db_session.execute(sql_text("UPDATE tutor_org_pools SET used = 999 WHERE org_id = 9981"))
    await db_session.commit()
    st = (await client.get("/api/v1/teacher/tutor/me/status", headers=_h(ft.id))).json()
    assert st["uses_pool"] and st["pool_left"] == 1 and st["left"] == 1 and st["price"] == tt.POOL_PRICE
    relay([(200, _text_reply("好"))])
    r, _ = await _teacher_ask(client, ft.id)
    assert r.status_code == 200
    pool = await tt.pool_status(db_session, 9981)
    assert pool["left"] == 0
    # 池里没了: 429,老师这个月也不扣
    r, _ = await _teacher_ask(client, ft.id)
    assert r.status_code == 429 and "购买次数" in r.json()["detail"]
    assert await tch.month_used(db_session, ft.id) == 1
    # 没调通: 老师那个月和池子都退回
    await db_session.execute(sql_text("UPDATE tutor_org_pools SET used = 998 WHERE org_id = 9981"))
    await db_session.commit()
    relay([(503, {"error": {"message": "No available accounts"}})] * 2)
    r, ev = await _teacher_ask(client, ft.id)
    assert ev[-1]["type"] == "error" and ev[-1]["refunded"] is True
    assert await tch.month_used(db_session, ft.id) == 1
    assert (await tt.pool_status(db_session, 9981))["left"] == 2
    detail = (await client.get("/api/v1/admin/tutor/pools/9981", headers=_h(a))).json()
    assert detail["teacher_used"] == 1


@pytest.mark.asyncio
async def test_teacher_tutor_can_be_turned_off(client, db_session):
    users = await _env(db_session)
    await client.put("/api/v1/admin/tutor/teacher", headers=_h(users["a"].id), json={"enabled": False, "monthly": 1000})
    st = (await client.get("/api/v1/teacher/tutor/me/status", headers=_h(users["t"].id))).json()
    assert st["enabled"] is False
    r, _ = await _teacher_ask(client, users["t"].id)
    assert r.status_code == 403
    # 学生端不受影响
    assert (await client.get("/api/v1/student/tutor/status", headers=_h(users["s"].id))).json()["enabled"] is True


# ---------------------------------------------------------------- 5. 隐私 + 只查本班

@pytest.mark.asyncio
async def test_teacher_names_become_codes_and_tools_see_own_class(client, db_session, relay, shared_session):
    users = await _env(db_session)
    t, sid, s2 = users["t"].id, users["s"].id, users["s2"].id     # s2 不在 t 的班里
    stu = await db_session.get(User, sid)
    stu.full_name = "张小明"
    await db_session.commit()
    await _wrong(db_session, sid, "一般现在时第三人称加 s", 2)
    await _wrong(db_session, s2, "一般现在时第三人称加 s", 2)
    fake = relay([
        (200, _tool_call("find_students", {"topic": "第三人称"})),
        (200, _text_reply(f"S{sid} 卡在三单上")),
    ])
    r, ev = await _teacher_ask(client, t, "张小明和班上谁卡在第三人称?")
    assert r.status_code == 200
    sent = json.dumps(fake.requests, ensure_ascii=False)
    assert "张小明" not in sent and f"S{sid}和班上谁卡在第三人称" in sent
    tool_result = fake.requests[1]["messages"][-1]["content"][0]["content"]
    assert f"S{sid}" in tool_result and f"S{s2}" not in tool_result and "张小明" not in tool_result
    # 库里存原话(老师翻记录看得懂);页面拿名单把代号换回名字
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user"))).scalar_one()
    assert um.text == "张小明和班上谁卡在第三人称?" and um.user_id == t
    ros = (await client.get("/api/v1/teacher/tutor/me/roster", headers=_h(t))).json()["items"]
    assert {"code": f"S{sid}", "id": sid, "name": "张小明", "class_name": "c"} in ros
    assert all(x["id"] != s2 for x in ros)
    # 查别班的孩子: 查不到
    ros_t = await tch.roster(db_session, t)
    out, _ = await tch.tool_get_student(db_session, stu, ros_t, f"S{s2}")
    assert out["found"] is False


@pytest.mark.asyncio
async def test_worksheet_keeps_answers_for_teacher(db_session):
    out, card = await tch.tool_make_worksheet({"title": "三单小测", "items": [
        {"type": "choice", "question": "He ___ to school.", "options": ["go", "goes"], "answer": "goes", "explain": "he 是三单"},
        {"type": "fill", "question": "She ___ (like) apples.", "answer": "likes"},
        {"type": "order", "answer": "My father reads books every day."},
        {"type": "choice", "question": "坏题", "options": ["a"], "answer": "a"},
    ] * 8, "students": ["S1", "S999999"]}, [(1, "u", "", "c")])     # 32 题里 24 道合格,只留 20
    assert out["ok"] and card["type"] == "worksheet" and len(card["items"]) == tch.WORKSHEET_MAX
    assert card["items"][0]["answer"] == "goes" and card["items"][1]["answer"] == "likes"
    assert card["items"][2]["tokens"] and card["students"] == ["S1"]     # 不在本班的代号去掉
    assert out["problems"]


@pytest.mark.asyncio
async def test_pseudonymize_skips_english_usernames():
    ros = [(5, "apple", "李华", "c"), (6, "王小明", "", "c"), (7, "x", "张三丰", "c")]
    s = tch.pseudonymize("李华和王小明谁记得 apple?张三丰呢", ros)
    assert s == "S5和S6谁记得 apple?S7呢"
