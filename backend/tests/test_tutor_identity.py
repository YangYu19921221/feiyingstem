"""小鹰老师的身份(2026-10-27,用户「如果我问你是谁,你应该说是小鹰老师」)

锁住的规矩(RULES 里的「身份」那条):
1. 孩子问「你是谁 / 你叫什么」: 答「我是小鹰老师,飞鹰AI英语里的 AI 学习助手」
2. 不说背后是哪个模型、哪家公司(Claude / GPT / Anthropic 之类都不提);被追问就说不方便说,带回英语学习
3. 但**不冒充真人**: 问「你是真人吗」要说是 AI(老师是真人,有问题也可以问老师)—— 这条不能删
4. 快速 / 深度两种都带这条(都在规则段里,规则段走提示缓存)
"""
import pytest

from app.services import tutor as tt
from tests.test_tutor import _ask, _env, _text_reply, relay, shared_session  # noqa: F401


def test_rules_have_identity():
    r = tt.RULES
    assert "我是小鹰老师" in r and "AI 学习助手" in r
    assert "哪个模型" in r and "哪家公司" in r
    assert "不是真人" in r          # 不冒充真人
    for mode in ("fast", "deep"):
        system = tt.build_system("这个孩子的情况: -", mode)
        assert "我是小鹰老师" in system[0]["text"] and system[0].get("cache_control")


@pytest.mark.asyncio
async def test_identity_rule_sent_to_model(client, db_session, relay, shared_session):
    users = await _env(db_session)
    fake = relay([(200, _text_reply("我是小鹰老师,飞鹰AI英语里的 AI 学习助手。"))])
    r, events = await _ask(client, users["s"].id, "你是谁")
    assert r.status_code == 200 and events[-1]["type"] == "done"
    sent = fake.requests[0]["system"][0]["text"]
    assert "我是小鹰老师" in sent and "不是真人" in sent
