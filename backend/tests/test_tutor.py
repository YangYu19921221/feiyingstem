"""AI 学习助手(services/tutor.py + api/v1/tutor.py)

中转用 httpx.MockTransport 假装,不真调模型(贵)。锁住的规矩:
1. 学习助手的 Key 只给学习助手: 不能设成默认通道;默认通道 / OCR 选通道都看不见它
2. 开放范围: hq = 只给直营学生;别的机构 403;没配 Key 403
3. 主模型没号(503 No available accounts)自动换备用,记下实际回答的模型和用量
4. 工具只查孩子自己的数据(别的孩子的错词不会出现在他的工具结果里)
5. 次数: 每人每天上限,调用彻底失败退回次数
6. 老师只看本班学生的对话
7. 工具循环: 模型先调工具再回答,练习卡片落库、刷新后还在
"""
import json

import httpx
import pytest
from sqlalchemy import select, text as sql_text

from app.api.v1 import tutor as tutor_api
from app.api.v1.admin.ai_config import encrypt_api_key
from app.core import tenancy
from app.core.shared_store import reset_memory
from app.models.learning import LearningRecord
from app.models.system_config import AIProvider
from app.models.tutor import TutorConversation, TutorMessage
from app.models.user import Class, ClassStudent, User
from app.models.word import Word, WordDefinition
from app.services import tutor as tt
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


def _sse_body(events: list[dict]) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def _text_reply(text: str, *, inp=100, out=20, cache_read=0) -> list[dict]:
    return [
        {"type": "message_start", "message": {"usage": {"input_tokens": inp, "cache_read_input_tokens": cache_read,
                                                        "cache_creation_input_tokens": 0}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text[:3]}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text[3:]}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": out}},
        {"type": "message_stop"},
    ]


def _tool_call(name: str, inp: dict, tid="tu_1") -> list[dict]:
    return [
        {"type": "message_start", "message": {"usage": {"input_tokens": 120}}},
        {"type": "content_block_start", "index": 0,
         "content_block": {"type": "tool_use", "id": tid, "name": name, "input": {}}},
        {"type": "content_block_delta", "index": 0,
         "delta": {"type": "input_json_delta", "partial_json": json.dumps(inp)[:5]}},
        {"type": "content_block_delta", "index": 0,
         "delta": {"type": "input_json_delta", "partial_json": json.dumps(inp)[5:]}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 30}},
    ]


class FakeRelay:
    """按顺序回放预设的回答;记下每次请求体"""

    def __init__(self, script):
        self.script = list(script)
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        step = self.script.pop(0)
        if callable(step):
            step = step(body)
        status, payload = step
        if status != 200:
            return httpx.Response(status, json=payload)
        return httpx.Response(200, content=_sse_body(payload), headers={"content-type": "text/event-stream"})


@pytest.fixture
def relay(monkeypatch):
    holder = {}

    def install(script):
        fake = FakeRelay(script)
        holder["fake"] = fake
        monkeypatch.setattr(tt, "new_client",
                            lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
        return fake

    reset_memory()
    yield install
    reset_memory()


@pytest.fixture
def shared_session(db_session, monkeypatch):
    """后台任务自己开会话: 测试里让它拿到同一个内存库"""
    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(tutor_api, "session_factory", lambda: _Ctx())
    return db_session


async def _env(db, *, provider=True, fallback="claude-sonnet-4-6"):
    tenancy._org_cache.clear()
    await db.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(1, '直营', 'HQ001', 'active', 'assigned'), (9981, '加盟甲', 'tta', 'active', 'assigned')"))
    users = {}
    for key, role, org in [("t", "teacher", 1), ("ot", "teacher", 1), ("s", "student", 1),
                           ("s2", "student", 1), ("fs", "student", 9981), ("a", "admin", None)]:
        u = User(username=f"tut{key}", email=f"tut{key}@e.com", hashed_password="x", role=role,
                 full_name=f"孩子{key}", is_active=True, org_id=org)
        db.add(u)
        await db.flush()
        users[key] = u
    c = Class(name="c", teacher_id=users["t"].id, org_id=1)
    db.add(c)
    await db.flush()
    db.add(ClassStudent(class_id=c.id, student_id=users["s"].id, is_active=True))
    # 默认通道(周报那些用的)
    db.add(AIProvider(provider_name="qwen", display_name="通义", api_key=encrypt_api_key("sk-qwen"),
                      base_url="https://dashscope.example/v1", model_name="qwen3.8-max",
                      enabled=True, is_default=True))
    if provider:
        db.add(AIProvider(provider_name=tt.PROVIDER_NAME, display_name="Claude(学习助手专用)",
                          api_key=encrypt_api_key("sk-relay-secret"), base_url="https://relay.example",
                          model_name="claude-haiku-5-5", enabled=True, is_default=False,
                          extra_config={"fallback_model": fallback} if fallback else {}))
    await db.commit()
    return users


async def _ask(client, uid, text="apple 怎么记", conversation_id=None):
    data = {"text": text}
    if conversation_id:
        data["conversation_id"] = str(conversation_id)
    r = await client.post("/api/v1/student/tutor/ask", data=data, headers=_h(uid))
    events = []
    if r.status_code == 200:
        for chunk in r.text.split("\n\n"):
            if chunk.startswith("data: "):
                events.append(json.loads(chunk[6:]))
    return r, events


# ---------------------------------------------------------------- 1. Key 只给学习助手

@pytest.mark.asyncio
async def test_tutor_provider_cannot_become_default(client, db_session):
    users = await _env(db_session)
    row = (await db_session.execute(select(AIProvider).where(AIProvider.provider_name == tt.PROVIDER_NAME))).scalar_one()
    r = await client.put(f"/api/v1/admin/ai/providers/{row.id}", json={"is_default": True}, headers=_h(users["a"].id))
    assert r.status_code == 400
    r = await client.post("/api/v1/admin/ai/providers", headers=_h(users["a"].id), json={
        "provider_name": tt.PROVIDER_NAME, "display_name": "x", "api_key": "k", "model_name": "m", "is_default": True})
    assert r.status_code == 400
    await db_session.refresh(row)
    assert not row.is_default


@pytest.mark.asyncio
async def test_default_ai_config_never_picks_tutor_key(db_session, monkeypatch):
    """就算库里被手动改成 is_default=1,周报那些(ai_service)也不会拿到学习助手的 Key"""
    await _env(db_session)
    await db_session.execute(sql_text("UPDATE ai_providers SET is_default = 0 WHERE provider_name = 'qwen'"))
    await db_session.execute(sql_text("UPDATE ai_providers SET is_default = 1 WHERE provider_name = :p"),
                             {"p": tt.PROVIDER_NAME})
    await db_session.execute(sql_text("UPDATE ai_providers SET extra_config = :e WHERE provider_name = :p"),
                             {"e": json.dumps({"ocr_model": "claude-x", "fallback_model": "y"}), "p": tt.PROVIDER_NAME})
    await db_session.commit()
    from app.services import ai_service as ais

    async def fake_get_db():
        yield db_session

    monkeypatch.setattr("app.core.database.get_db", fake_get_db)
    cfg = await ais.ai_service._get_ai_config()
    assert cfg is None or cfg.get("api_key") != "sk-relay-secret"
    ocr = await ais.ai_service._get_ocr_config() if hasattr(ais.ai_service, "_get_ocr_config") else None
    assert not ocr or ocr.get("api_key") != "sk-relay-secret"


# ---------------------------------------------------------------- 2. 开放范围

@pytest.mark.asyncio
async def test_scope_hq_only_and_needs_key(client, db_session, relay, shared_session):
    users = await _env(db_session)
    r = await client.get("/api/v1/student/tutor/status", headers=_h(users["s"].id))
    assert r.json()["enabled"] is True and r.json()["left"] == 20
    r = await client.get("/api/v1/student/tutor/status", headers=_h(users["fs"].id))
    assert r.json()["enabled"] is False
    r, _ = await _ask(client, users["fs"].id)
    assert r.status_code == 403
    # 管理员开到全部机构
    r = await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "all", "daily_limit": 20})
    assert r.status_code == 200 and r.json()["scope"] == "all"
    assert r.json()["provider"]["api_key_masked"] and "sk-relay-secret" not in json.dumps(r.json())
    r = await client.get("/api/v1/student/tutor/status", headers=_h(users["fs"].id))
    assert r.json()["enabled"] is True
    # 关掉
    await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "off", "daily_limit": 20})
    r, _ = await _ask(client, users["s"].id)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_no_provider_means_disabled(client, db_session):
    users = await _env(db_session, provider=False)
    r = await client.get("/api/v1/student/tutor/status", headers=_h(users["s"].id))
    assert r.json()["enabled"] is False and "配置" in r.json()["reason"]


@pytest.mark.asyncio
async def test_admin_blank_key_keeps_old_key(client, db_session):
    users = await _env(db_session)
    r = await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id),
                         json={"scope": "hq", "daily_limit": 10, "api_key": "", "model": "claude-sonnet-5"})
    assert r.status_code == 200
    conf = await tt.relay_conf(db_session)
    assert conf.api_key == "sk-relay-secret" and conf.model == "claude-sonnet-5"


# ---------------------------------------------------------------- 3. 换备用 + 记用量

@pytest.mark.asyncio
async def test_fallback_when_primary_has_no_accounts(client, db_session, relay, shared_session):
    users = await _env(db_session)
    fake = relay([
        (503, {"error": {"type": "api_error", "message": "No available accounts"}}),
        (200, _text_reply("apple 可以拆成 a + pple 来记。", inp=900, out=25, cache_read=800)),
    ])
    r, events = await _ask(client, users["s"].id)
    assert r.status_code == 200
    assert r.headers["x-accel-buffering"] == "no" and r.headers["cache-control"] == "no-store"
    assert [e["type"] for e in events][0] == "meta"
    assert events[-1]["type"] == "done"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "apple 可以拆成 a + pple 来记。"
    assert [b["model"] for b in fake.requests] == ["claude-haiku-5-5", "claude-sonnet-4-6"]
    # 规则那段带缓存标记;孩子姓名不进提示词
    sys_blocks = fake.requests[1]["system"]
    assert sys_blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert "孩子s" not in json.dumps(fake.requests[1], ensure_ascii=False)
    msg = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "assistant"))).scalar_one()
    assert msg.model == "claude-sonnet-4-6" and msg.input_tokens == 900 and msg.cache_read_tokens == 800
    # 主模型记成 5 分钟不可用: 下一次直接用备用,不再先撞 503
    fake.script.append((200, _text_reply("好的,再练一遍。")))
    await _ask(client, users["s"].id, "再来", conversation_id=events[0]["conversation_id"])
    assert fake.requests[-1]["model"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------- 5. 次数 + 失败退回

@pytest.mark.asyncio
async def test_total_failure_refunds_quota(client, db_session, relay, shared_session):
    users = await _env(db_session, fallback=None)
    fake = relay([(503, {"error": {"message": "No available accounts"}})] * 2)
    r, events = await _ask(client, users["s"].id)
    assert events[-1]["type"] == "error" and events[-1]["refunded"] is True
    assert len(fake.requests) == 2   # 没有备用模型时,同一个模型再试一次
    r = await client.get("/api/v1/student/tutor/status", headers=_h(users["s"].id))
    assert r.json()["used"] == 0
    # 失败的那条只记 error,下一次提问的历史里不带它
    msg = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "assistant"))).scalar_one()
    assert msg.error and not msg.text


@pytest.mark.asyncio
async def test_daily_limit(client, db_session, relay, shared_session):
    users = await _env(db_session)
    await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "hq", "daily_limit": 2})
    relay([(200, _text_reply("第一次回答")), (200, _text_reply("第二次回答"))])
    for _ in range(2):
        r, _ = await _ask(client, users["s"].id)
        assert r.status_code == 200
    r, _ = await _ask(client, users["s"].id)
    assert r.status_code == 429 and "2 次" in r.json()["detail"]


# ---------------------------------------------------------------- 4 + 7. 工具: 只查自己的;卡片落库

@pytest.mark.asyncio
async def test_tool_loop_uses_own_data_and_saves_card(client, db_session, relay, shared_session):
    users = await _env(db_session)
    words = {}
    for sp, mean in [("apple", "苹果"), ("banana", "香蕉"), ("secretword", "别人的错词")]:
        w = Word(word=sp, phonetic="/x/")
        db_session.add(w)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=w.id, meaning=mean, is_primary=True))
        words[sp] = w
    # s 错了 apple(写成 aple),s2 错了 secretword
    db_session.add(LearningRecord(user_id=users["s"].id, word_id=words["apple"].id, learning_mode="spelling",
                                  is_correct=False, user_answer="aple"))
    for _ in range(3):
        db_session.add(LearningRecord(user_id=users["s2"].id, word_id=words["secretword"].id,
                                      learning_mode="spelling", is_correct=False, user_answer="secrt"))
    await db_session.commit()

    def answer_after_tools(body):
        # 第三轮: 前两轮工具结果都回来了
        results = [c for m in body["messages"] if m["role"] == "user" and isinstance(m["content"], list)
                   for c in m["content"] if c.get("type") == "tool_result"]
        assert len(results) == 2
        weak = json.loads(results[0]["content"])
        assert [w["word"] for w in weak["words"]] == ["apple"] and weak["words"][0]["wrote_as"] == ["aple"]
        return 200, _text_reply("你常把 apple 漏一个 p,下面练一练。")

    fake = relay([
        (200, _tool_call("get_weak_words", {"limit": 5}, "tu_1")),
        (200, _tool_call("make_practice", {"words": ["apple", "nosuchword"], "mode": "listen"}, "tu_2")),
        answer_after_tools,
    ])
    r, events = await _ask(client, users["s"].id, "我哪些词容易错,考考我")
    assert r.status_code == 200, r.text
    types = [e["type"] for e in events]
    assert "status" in types and "card" in types and types[-1] == "done"
    # 孩子的情况里也只有自己的错词
    ctx = json.dumps(fake.requests[0]["system"][1], ensure_ascii=False)
    assert "apple" in ctx and "secretword" not in ctx
    card = next(e["card"] for e in events if e["type"] == "card")
    assert card["mode"] == "listen" and [i["word"] for i in card["items"]] == ["apple"]
    # 刷新后卡片还在
    cid = events[0]["conversation_id"]
    r = await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(users["s"].id))
    msgs = r.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["cards"][0]["items"][0]["word"] == "apple"
    assert (await db_session.execute(select(TutorMessage.tools).where(TutorMessage.role == "assistant"))).scalar() \
        == "get_weak_words,make_practice"
    # 别的孩子看不到这段对话
    r = await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(users["s2"].id))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_last_round_forbids_tools(client, db_session, relay, shared_session):
    """模型一直要调工具: 工具轮用完后最后一轮 tool_choice=none,一定能拿到文字"""
    users = await _env(db_session)
    fake = relay([(200, _tool_call("show_link", {"target": "review"}, f"tu_{i}")) for i in range(tt.MAX_TOOL_ROUNDS)]
                 + [(200, _text_reply("去复习吧。"))])
    r, events = await _ask(client, users["s"].id, "我该干嘛")
    assert events[-1]["type"] == "done"
    assert "tool_choice" not in fake.requests[0]
    assert fake.requests[-1]["tool_choice"] == {"type": "none"}


# ---------------------------------------------------------------- 6. 老师只看本班

@pytest.mark.asyncio
async def test_teacher_sees_only_own_class(client, db_session, relay, shared_session):
    users = await _env(db_session)
    relay([(200, _text_reply("我看到的题目: apple。先想想它有几个 p?"))])
    await _ask(client, users["s"].id, "这题选什么")
    r = await client.get(f"/api/v1/teacher/students/{users['s'].id}/tutor", headers=_h(users["t"].id))
    assert r.status_code == 200
    body = r.json()
    assert body["total_questions"] == 1 and body["items"][0]["messages"][1]["text"].startswith("我看到的题目")
    r = await client.get(f"/api/v1/teacher/students/{users['s'].id}/tutor", headers=_h(users["ot"].id))
    assert r.status_code == 403
    r = await client.get("/api/v1/admin/tutor", headers=_h(users["t"].id))
    assert r.status_code == 403


# ---------------------------------------------------------------- 照片

@pytest.mark.asyncio
async def test_image_is_compressed_and_not_saved(client, db_session, relay, shared_session, tmp_path):
    from io import BytesIO

    from PIL import Image

    users = await _env(db_session)
    fake = relay([(200, _text_reply("我看到的题目: She ___ to school. 想想主语是第几人称?"))])
    buf = BytesIO()
    Image.new("RGB", (3000, 2000), "white").save(buf, "PNG")
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(users["s"].id),
                          data={"text": ""}, files={"image": ("q.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200
    img_block = fake.requests[0]["messages"][-1]["content"][0]
    assert img_block["type"] == "image" and img_block["source"]["media_type"] == "image/jpeg"
    import base64
    w, h = Image.open(BytesIO(base64.b64decode(img_block["source"]["data"]))).size
    assert max(w, h) <= tt.IMAGE_MAX_DIM
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user"))).scalar_one()
    assert um.has_image is True
    conv = (await db_session.execute(select(TutorConversation))).scalar_one()
    assert conv.title == "拍题提问"
    # 只认图片
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(users["s"].id),
                          data={"text": "x"}, files={"image": ("a.txt", b"hello", "text/plain")})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_teacher_available_follows_scope(client, db_session):
    users = await _env(db_session)
    r = await client.get("/api/v1/teacher/tutor/available", headers=_h(users["t"].id))
    assert r.json() == {"enabled": True}
    await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "off", "daily_limit": 20})
    r = await client.get("/api/v1/teacher/tutor/available", headers=_h(users["t"].id))
    assert r.json() == {"enabled": False}


@pytest.mark.asyncio
async def test_relay_empty_notice_is_hidden_and_retried(client, db_session, relay, shared_session):
    """中转在上游没返回内容时自己编一段「⚠️ 上游模型未返回任何内容…」: 不能给孩子看,换下一次重试"""
    users = await _env(db_session)
    notice = "⚠️ 上游模型未返回任何内容。可能原因：触发了安全策略、上游限流。请重试。"
    fake = relay([
        (200, _text_reply(notice)),
        (200, _text_reply("apple 两个 p,记成 app + le。")),
    ])
    r, events = await _ask(client, users["s"].id)
    shown = "".join(e["text"] for e in events if e["type"] == "delta")
    assert "上游" not in shown and shown == "apple 两个 p,记成 app + le。"
    assert events[-1]["type"] == "done" and len(fake.requests) == 2
    msg = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "assistant"))).scalar_one()
    assert "上游" not in msg.text


def test_practice_meaning_hides_spelling():
    """看中文写单词: 释义里带英文(「(=center) 中心」)等于给了答案,出卡时去掉"""
    assert tt._hide_spelling("(=center) 中心；中央", "centre") == "中心；中央"
    assert tt._hide_spelling("apple 苹果", "apple") == "____ 苹果"
    assert tt._hide_spelling("n.经历；经验", "experience") == "n.经历；经验"


def test_plain_strips_markdown():
    assert tt.plain("注意 **now** 这个词\n## 小结\n- 第一点") == "注意 now 这个词\n小结\n· 第一点"
