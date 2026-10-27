"""学习助手中转钱包 / Key 自动检查(services/tutor_relay_health,2026-10-27)

锁住的规矩:
1. 查 /v1/usage 不花模型钱;余额分三档(ok / low / empty),401 = Key 失效,404 / 连不上 = 查不到(不当成坏了)
2. 两个 Key(学习助手、画图)分开查;没配的写 unset
3. 结果不带 Key;只有平台管理员能看
4. 最近 1 小时失败数: 没调通的算,孩子自己停下的不算
5. 换了 Key 清掉旧结果
"""
import json

import httpx
import pytest

from app.core.shared_store import reset_memory, store
from app.models.tutor import TutorConversation, TutorMessage
from app.services import tutor_relay_health as rh
from tests.test_tutor import _env, _h


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("bal,status", [(444.9, "ok"), (20, "low"), (2, "empty")])
@pytest.mark.asyncio
async def test_balance_levels(bal, status):
    seen = {}

    def h(req):
        seen["url"] = str(req.url)
        return httpx.Response(200, json={"balance": bal, "isValid": True})
    r = await rh.probe("https://relay.example/v1", "sk-x", _client(h))
    assert r["status"] == status and r["balance"] == round(bal, 2) and seen["url"] == "https://relay.example/v1/usage"


@pytest.mark.asyncio
async def test_invalid_and_unknown():
    r = await rh.probe("https://r.example", "bad", _client(lambda q: httpx.Response(401, json={"code": "INVALID_API_KEY"})))
    assert r["status"] == "invalid"
    r = await rh.probe("https://r.example", "k", _client(lambda q: httpx.Response(404, text="nope")))
    assert r["status"] == "unknown"
    r = await rh.probe("https://r.example", "k", _client(lambda q: httpx.Response(200, json={"balance": 99, "isValid": False})))
    assert r["status"] == "invalid"

    def boom(q):
        raise httpx.ConnectError("x")
    r = await rh.probe("https://r.example", "k", _client(boom))
    assert r["status"] == "unknown"


@pytest.mark.asyncio
async def test_endpoint_admin_only_no_key_and_failures(client, db_session, monkeypatch):
    reset_memory()
    users = await _env(db_session)
    monkeypatch.setattr(rh, "new_client", lambda: _client(lambda q: httpx.Response(200, json={"balance": 12.5, "isValid": True})))
    conv = TutorConversation(user_id=users["s"].id, title="t", message_count=0)
    db_session.add(conv)
    await db_session.flush()
    for text, err in [("好", None), ("", "上游没号"), ("", "停下了")]:
        db_session.add(TutorMessage(conversation_id=conv.id, user_id=users["s"].id, role="assistant", text=text, error=err))
    await db_session.commit()
    assert (await client.get("/api/v1/admin/tutor/health", headers=_h(users["t"].id))).status_code == 403
    r = await client.get("/api/v1/admin/tutor/health", headers=_h(users["a"].id))
    d = r.json()
    assert r.status_code == 200 and d["tutor"]["status"] == "low" and d["tutor"]["balance"] == 12.5
    assert d["picture"]["status"] == "unset"
    assert d["recent"] == {"minutes": 60, "answers": 3, "failed": 1}
    assert "sk-relay-secret" not in r.text
    # 换 Key 清掉旧结果
    assert await store.get(rh.STORE_KEY)
    await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "hq", "free_total": 20, "api_key": "sk-new"})
    assert await store.get(rh.STORE_KEY) is None
    reset_memory()
