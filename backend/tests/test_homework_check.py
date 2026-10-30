"""作业批改(services/homework_check): 中转用 httpx.MockTransport 假装,不真调模型。

锁住的规矩:
- 批一页扣 1 次;看不清 / 不是英语 / 一题没读出来 / 模型都没调通 / 卡住 → 退回
- 正确答案只在服务器: 错题先给提示,改对了或改了 2 次还不对才给答案;没写的题永远不给
- 5.x 开思考 + strict + 不强制调工具;4.6 不开思考 + 强制调工具
- 孩子的姓名不进批改结果;只有本班老师看得到;别人的看不到
- 错题的知识点记进小鹰老师的笔记
"""
import io
import json
from datetime import timedelta

import httpx
import pytest
from PIL import Image
from sqlalchemy import select, text as sql_text, update

from app.api.v1.admin.ai_config import encrypt_api_key
from app.core import tenancy
from app.core.shared_store import reset_memory
from app.core.timeutil import utc_now
from app.models.system_config import AIProvider
from app.models.tutor import HomeworkCheck, TutorAllowance, TutorNote
from app.models.user import Class, ClassStudent, User
from app.services import homework_check as hc
from app.services import tutor as tt
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


def _photo(size=(800, 1000)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (250, 248, 240)).save(buf, "JPEG")
    return buf.getvalue()


ITEMS = [
    {"no": "1", "question": "He ____ (like) apples.", "answer": "likes", "result": "right", "correct": ["likes"],
     "checkable": True, "hint": "", "explain": "He 是三单,动词加 s", "topic": "一般现在时三单"},
    {"no": "2", "question": "There ____ (be) two books on the desk.", "answer": "is", "result": "wrong",
     "correct": ["are"], "checkable": True, "hint": "two books 是复数,想想 be 动词用哪个",
     "explain": "books 是复数,用 are", "topic": "There be 句型"},
    {"no": "3", "question": "I have ____ orange. A. a B. an C. the", "answer": "", "result": "blank",
     "correct": ["B"], "checkable": True, "hint": "orange 以元音开头", "explain": "元音音素前用 an", "topic": "冠词"},
    {"no": "4", "question": "—What's this? —____ an apple. A. It's B. Its", "answer": "B", "result": "wrong",
     "correct": ["A"], "checkable": True, "hint": "选A就对了", "explain": "It's = It is", "topic": "代词与缩写"},
    {"no": "5", "question": "写一句话介绍张小明的家", "answer": "My home is big.", "result": "wrong", "correct": [],
     "checkable": False, "hint": "再加一句家里有什么", "explain": "可以写 My home has three rooms.", "topic": "写作"},
]


def _tool_reply(inp: dict, *, model="claude-sonnet-5-5") -> dict:
    return {"model": model, "stop_reason": "tool_use",
            "content": [{"type": "thinking", "thinking": "", "signature": "x"},
                        {"type": "tool_use", "id": "t1", "name": hc.TOOL_NAME, "input": inp}],
            "usage": {"input_tokens": 2900, "output_tokens": 1300}}


class FakeRelay:
    def __init__(self, script):
        self.script = list(script)
        self.requests: list[dict] = []
        self.headers: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        self.headers.append(dict(request.headers))
        status, payload = self.script.pop(0)
        return httpx.Response(status, json=payload)


@pytest.fixture
def relay(monkeypatch):
    def install(script):
        fake = FakeRelay(script)
        monkeypatch.setattr(tt, "new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
        return fake

    reset_memory()
    yield install
    reset_memory()


@pytest.fixture
def env(db_session, monkeypatch):
    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(hc, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(hc, "INLINE", True)

    async def build(provider=True):
        tenancy._org_cache.clear()
        await db_session.execute(sql_text(
            "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
            "(1, '直营', 'HQ001', 'active', 'assigned')"))
        users = {}
        for key, role, name in [("t", "teacher", "王老师"), ("ot", "teacher", "李老师"),
                                ("s", "student", "张小明"), ("s2", "student", "赵二")]:
            u = User(username=f"hwc{key}", email=f"hwc{key}@e.com", hashed_password="x", role=role,
                     full_name=name, is_active=True, org_id=1)
            db_session.add(u)
            await db_session.flush()
            users[key] = u
        c = Class(name="c", teacher_id=users["t"].id, org_id=1)
        db_session.add(c)
        await db_session.flush()
        db_session.add(ClassStudent(class_id=c.id, student_id=users["s"].id, is_active=True))
        if provider:
            db_session.add(AIProvider(provider_name=tt.PROVIDER_NAME, display_name="学习助手专用",
                                      api_key=encrypt_api_key("sk-relay"), base_url="https://relay.example",
                                      model_name="claude-sonnet-5-5", enabled=True, is_default=False,
                                      extra_config={"fallback_model": "claude-sonnet-4-6"}))
        await db_session.commit()
        return users

    return build


async def _upload(client, uid, data=None):
    return await client.post("/api/v1/student/homework-check", headers=_h(uid),
                             files={"image": ("p.jpg", data or _photo(), "image/jpeg")})


async def _used(db, uid) -> int:
    return (await db.execute(select(TutorAllowance.used).where(TutorAllowance.user_id == uid))).scalar() or 0


# ---------------------------------------------------------------- 1. 批改 + 扣次数 + 答案不下发

@pytest.mark.asyncio
async def test_grades_page_charges_once_and_hides_answers(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    fake = relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS}))])
    r = await _upload(client, s.id)
    assert r.status_code == 200
    cid = r.json()["id"]
    assert await _used(db_session, s.id) == 1
    body = fake.requests[0]
    # 5.x: 开思考、strict、不强制调工具;照片在里面
    assert body["model"] == "claude-sonnet-5-5" and body["thinking"] == {"type": "adaptive"}
    assert body["tool_choice"] == {"type": "auto"} and body["tools"][0]["strict"] is True
    assert body["messages"][0]["content"][0]["type"] == "image"
    # 被拒时让服务器换模型重跑
    assert body["fallbacks"] == "default" and fake.headers[0]["anthropic-beta"] == hc.FALLBACK_BETA

    out = (await client.get(f"/api/v1/student/homework-check/{cid}", headers=_h(s.id))).json()
    assert out["status"] == "done" and out["total"] == 5 and out["right"] == 1 and out["blank"] == 1
    items = out["items"]
    # 对的: 看得到讲解;错的、没写的: 只有提示,没有正确答案也没有讲解
    assert items[0]["explain"] and items[0]["correct"] == []
    assert items[1]["correct"] == [] and items[1]["explain"] == "" and items[1]["hint"] and items[1]["can_fix"]
    assert items[2]["correct"] == [] and items[2]["explain"] == "" and items[2]["tries_left"] == hc.MAX_TRIES
    # 提示里写出了答案(「选A」)的换成通用提示
    assert "A" not in items[3]["hint"] and "代词与缩写" in items[3]["hint"]
    # 开放题: 不在网页上订正,讲解(可能是范文)不给孩子
    assert items[4]["can_fix"] is False and items[4]["explain"] == "" and items[4]["hint"]
    # 孩子的姓名换掉了
    assert "张小明" not in json.dumps(out, ensure_ascii=False)
    # 照片不存: 库里没有图片数据
    row = await db_session.get(HomeworkCheck, cid)
    assert "image" not in json.dumps(row.items) and row.input_tokens == 2900


# ---------------------------------------------------------------- 2. 订正

@pytest.mark.asyncio
async def test_fix_wrong_item_reveals_only_after_two_tries(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS}))])
    cid = (await _upload(client, s.id)).json()["id"]
    url = f"/api/v1/student/homework-check/{cid}/items/1/fix"
    r = (await client.post(url, json={"answer": "am"}, headers=_h(s.id))).json()
    assert r["ok"] is False and r["item"]["correct"] == [] and r["item"]["explain"] == "" and r["item"]["can_fix"]
    r = (await client.post(url, json={"answer": "be"}, headers=_h(s.id))).json()
    assert r["ok"] is False and r["item"]["revealed"] and r["item"]["correct"] == ["are"] and r["item"]["explain"]
    # 给了答案以后不能再「改对」刷数字,而且告诉他为什么
    r = await client.post(url, json={"answer": "are"}, headers=_h(s.id))
    assert r.status_code == 400 and "答案已经告诉你" in r.json()["detail"]
    # 改对了: 看得到讲解,改对数 +1
    url3 = f"/api/v1/student/homework-check/{cid}/items/3/fix"
    r = (await client.post(url3, json={"answer": "(A)"}, headers=_h(s.id))).json()
    assert r["ok"] and r["item"]["fixed"] and r["item"]["explain"] and r["fixed"] == 1
    # 开放题不能在网页上订正
    assert (await client.post(f"/api/v1/student/homework-check/{cid}/items/4/fix",
                              json={"answer": "x"}, headers=_h(s.id))).status_code == 400


@pytest.mark.asyncio
async def test_blank_item_never_reveals_answer(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS}))])
    cid = (await _upload(client, s.id)).json()["id"]
    url = f"/api/v1/student/homework-check/{cid}/items/2/fix"
    for i in range(hc.MAX_TRIES):
        r = (await client.post(url, json={"answer": "C"}, headers=_h(s.id))).json()
        assert r["ok"] is False and r["item"]["correct"] == [] and r["item"]["explain"] == ""
    assert r["item"]["can_fix"] is False and not r["item"]["revealed"]
    assert (await client.post(url, json={"answer": "B"}, headers=_h(s.id))).status_code == 400
    full = (await client.get(f"/api/v1/student/homework-check/{cid}", headers=_h(s.id))).json()
    assert "an" not in [c for it in full["items"] for c in it["correct"]]


# ---------------------------------------------------------------- 3. 退回次数

@pytest.mark.asyncio
async def test_unreadable_or_not_english_refunds(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    relay([(200, _tool_reply({"readable": False, "is_english": True, "reason": "照片太暗了", "items": []})),
           (200, _tool_reply({"readable": True, "is_english": False, "reason": "", "items": ITEMS[:1]}))])
    for _ in range(2):
        cid = (await _upload(client, s.id)).json()["id"]
        out = (await client.get(f"/api/v1/student/homework-check/{cid}", headers=_h(s.id))).json()
        assert out["status"] == "failed" and "退回" in out["reason"]
    assert await _used(db_session, s.id) == 0


@pytest.mark.asyncio
async def test_falls_back_then_refunds_when_all_models_fail(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    fake = relay([(503, {"error": {"message": "No available accounts"}}),
                  (200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS},
                                    model="claude-sonnet-4-6"))])
    cid = (await _upload(client, s.id)).json()["id"]
    assert (await db_session.get(HomeworkCheck, cid)).status == "done"
    # 4.6: 不开思考、强制调工具、不带 strict
    b = fake.requests[1]
    assert b["model"] == "claude-sonnet-4-6" and "thinking" not in b
    assert b["tool_choice"] == {"type": "tool", "name": hc.TOOL_NAME} and "strict" not in b["tools"][0]
    assert "fallbacks" not in b and "anthropic-beta" not in fake.headers[1]
    # 主模型记了「没号」: 下一页直接用备用;备用也挂了 → 退回
    fake2 = relay([(500, {"error": "boom"})])
    cid2 = (await _upload(client, s.id)).json()["id"]
    assert [x["model"] for x in fake2.requests] == ["claude-sonnet-4-6"]
    row = await db_session.get(HomeworkCheck, cid2)
    assert row.status == "failed" and row.cost == 0
    assert await _used(db_session, s.id) == 1


@pytest.mark.asyncio
async def test_refusal_tries_next_model(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    relay([(200, {"stop_reason": "refusal", "usage": {},
                  "content": [{"type": "tool_use", "id": "t0", "name": hc.TOOL_NAME,
                               "input": {"readable": True, "is_english": True, "reason": "", "items": ITEMS[:1]}}]}),
           (200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS},
                             model="claude-sonnet-4-6"))])
    cid = (await _upload(client, s.id)).json()["id"]
    row = await db_session.get(HomeworkCheck, cid)
    assert row.status == "done" and row.model == "claude-sonnet-4-6" and row.total == 5


@pytest.mark.asyncio
async def test_truncated_reply_tries_next_model(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    cut = _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS[:1]})
    cut["stop_reason"] = "max_tokens"
    relay([(200, cut), (200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS},
                                         model="claude-sonnet-4-6"))])
    cid = (await _upload(client, s.id)).json()["id"]
    row = await db_session.get(HomeworkCheck, cid)
    assert row.total == 5 and row.model == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_relay_without_fallbacks_retries_plain(client, db_session, env, relay):
    """中转不认 fallbacks(400): 同一个模型去掉再发一次;服务器换过模型的记真正批的那个"""
    u = await env()
    s = u["s"]
    fake = relay([(400, {"error": {"message": "Unknown parameter: fallbacks"}}),
                  (200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS},
                                    model="claude-opus-5-5"))])
    cid = (await _upload(client, s.id)).json()["id"]
    assert [x["model"] for x in fake.requests] == ["claude-sonnet-5-5", "claude-sonnet-5-5"]
    assert "fallbacks" not in fake.requests[1] and "anthropic-beta" not in fake.headers[1]
    row = await db_session.get(HomeworkCheck, cid)
    assert row.status == "done" and row.model == "claude-opus-5-5"


@pytest.mark.asyncio
async def test_items_as_json_string_are_accepted(client, db_session, env, relay):
    """4.6 不强制调工具时会把 items 写成 JSON 字符串(10-30 实测)"""
    u = await env()
    s = u["s"]
    relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "",
                              "items": json.dumps(ITEMS, ensure_ascii=False)}))])
    cid = (await _upload(client, s.id)).json()["id"]
    assert (await db_session.get(HomeworkCheck, cid)).total == 5


@pytest.mark.asyncio
async def test_stale_pending_refunded_and_blocks_while_pending(client, db_session, env, relay, monkeypatch):
    u = await env()
    s = u["s"]
    monkeypatch.setattr(hc, "INLINE", False)

    async def never(*a):
        return None

    monkeypatch.setattr(hc, "run_later", never)
    cid = (await _upload(client, s.id)).json()["id"]
    assert (await _upload(client, s.id)).status_code == 409
    assert await _used(db_session, s.id) == 1
    await db_session.execute(update(HomeworkCheck).where(HomeworkCheck.id == cid)
                             .values(created_at=utc_now() - timedelta(minutes=10)))
    await db_session.commit()
    out = (await client.get(f"/api/v1/student/homework-check/{cid}", headers=_h(s.id))).json()
    assert out["status"] == "failed"
    assert await _used(db_session, s.id) == 0
    # 卡住的那份迟到的结果不再覆盖(也不会再扣 / 退一次)
    await hc.finish(db_session, cid, {"readable": True, "is_english": True, "items": ITEMS}, "m", {})
    assert (await db_session.get(HomeworkCheck, cid)).status == "failed"


@pytest.mark.asyncio
async def test_no_quota_or_not_open(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    db_session.add(TutorAllowance(user_id=s.id, used=20, extra=0, updated_at=utc_now()))
    await db_session.commit()
    relay([])
    r = await _upload(client, s.id)
    assert r.status_code == 429
    assert (await db_session.execute(select(HomeworkCheck))).first() is None
    st = (await client.get("/api/v1/student/homework-check/status", headers=_h(s.id))).json()
    assert st["enabled"] and st["left"] == 0


@pytest.mark.asyncio
async def test_not_configured_is_403(client, db_session, env, relay):
    u = await env(provider=False)
    assert (await _upload(client, u["s"].id)).status_code == 403


# ---------------------------------------------------------------- 4. 谁看得到

@pytest.mark.asyncio
async def test_only_owner_and_class_teacher(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": ITEMS}))])
    cid = (await _upload(client, s.id)).json()["id"]
    assert (await client.get(f"/api/v1/student/homework-check/{cid}", headers=_h(u["s2"].id))).status_code == 404
    assert (await client.post(f"/api/v1/student/homework-check/{cid}/items/1/fix", json={"answer": "are"},
                              headers=_h(u["s2"].id))).status_code == 404
    r = await client.get(f"/api/v1/teacher/students/{s.id}/homework-checks", headers=_h(u["t"].id))
    assert r.status_code == 200 and r.json()["items"][0]["items"][1]["correct"] == ["are"]
    assert (await client.get(f"/api/v1/teacher/students/{s.id}/homework-checks",
                             headers=_h(u["ot"].id))).status_code == 403
    # 「批错了?」只做记号,老师看得到
    await client.post(f"/api/v1/student/homework-check/{cid}/items/0/dispute", headers=_h(s.id))
    r = await client.get(f"/api/v1/teacher/students/{s.id}/homework-checks", headers=_h(u["t"].id))
    assert r.json()["items"][0]["disputed"] == 1 and r.json()["items"][0]["right"] == 1


# ---------------------------------------------------------------- 5. 笔记

@pytest.mark.asyncio
async def test_wrong_topics_go_to_tutor_notes(client, db_session, env, relay):
    u = await env()
    s = u["s"]
    items = ITEMS + [dict(ITEMS[1], no="6", question="There ____ (be) a cat.")]
    relay([(200, _tool_reply({"readable": True, "is_english": True, "reason": "", "items": items}))])
    await _upload(client, s.id)
    notes = list((await db_session.execute(select(TutorNote).where(TutorNote.user_id == s.id))).scalars())
    topics = sorted(n.topic for n in notes)
    # 错题的点记下来(同一个点一页只记一次);没写的、对的不记;stuck 不算判错次数
    assert topics == sorted(["There be 句型", "代词与缩写", "写作"])
    assert all(n.times_wrong == 0 for n in notes)


# ---------------------------------------------------------------- 6. 判订正的口径

def test_matches_rules():
    assert hc.matches("I don't like cats", ["I do not like cats."])
    assert hc.matches("  ARE ", ["are"])
    assert hc.matches("(A)", ["A"]) and hc.matches("a. It's", ["A"]) and not hc.matches("B", ["A"])
    assert hc.matches("I", ["I"]) and not hc.matches("an", ["a"])
    assert not hc.matches("", ["are"])
    assert hc._leaks("想想 there be 后面用 are", ["are"]) and not hc._leaks("想想复数用哪个", ["are"])
    assert hc._leaks("选 B", ["B"]) and not hc._leaks("看看 b 开头的词", ["B"])
