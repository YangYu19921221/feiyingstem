"""快速档提速(services/tutor「提速」,2026-10-27)

锁住的规矩:
1. 孩子问到的英文词,服务器先按课本查好放进系统提示尾部(不放进规则段,不破坏缓存);查不到的词不写
2. 模型这一轮已经写了字、调的只是记笔记 / 出卡片这类工具,而且都成功了 → 不再多请一轮;出了卡片补一句「在下面做」
3. 工具出错了(比如词不在课本里出不了卡)→ 照常再请一轮,让模型跟孩子说
"""
import pytest
from sqlalchemy import select

from app.models.word import Word, WordDefinition
from app.services import tutor as tt
from tests.test_tutor import _ask, _env, _text_reply, _tool_call, relay, shared_session  # noqa: F401


def _text_then_tools(text, calls):
    """先写一段字,再调几个工具(同一轮)"""
    import json
    ev = [{"type": "message_start", "message": {"usage": {"input_tokens": 100}}},
          {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
          {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}},
          {"type": "content_block_stop", "index": 0}]
    for i, (name, inp) in enumerate(calls, start=1):
        ev += [{"type": "content_block_start", "index": i,
                "content_block": {"type": "tool_use", "id": f"tu_{i}", "name": name, "input": {}}},
               {"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": json.dumps(inp)}},
               {"type": "content_block_stop", "index": i}]
    ev.append({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 40}})
    return ev


async def _word(db, w, meaning):
    x = Word(word=w, phonetic="/bɪˈkɒz/")
    db.add(x)
    await db.flush()
    db.add(WordDefinition(word_id=x.id, part_of_speech="conj.", meaning=meaning, is_primary=True,
                          example_sentence="I stay home because it rains."))
    await db.commit()
    return x


@pytest.mark.asyncio
async def test_prefetch_goes_into_tail(client, db_session, relay, shared_session):
    users = await _env(db_session)
    await _word(db_session, "because", "因为")
    fake = relay([(200, _text_reply("because 可以拆成 be + cause。"))])
    await _ask(client, users["s"].id, "because 和 zzqx 老是拼错")
    sys = fake.requests[0]["system"]
    assert "因为" in sys[1]["text"] and "because" in sys[1]["text"] and "不用再调 lookup_word" in sys[1]["text"]
    assert "zzqx" not in sys[1]["text"].split("查好了")[-1]
    assert sys[0]["text"] == tt.RULES


@pytest.mark.asyncio
async def test_no_extra_round_after_text_and_card(client, db_session, relay, shared_session):
    users = await _env(db_session)
    await _word(db_session, "because", "因为")
    fake = relay([(200, _text_then_tools("because 拆成 be + cause 来记。",
                                         [("make_practice", {"words": ["because"]}), ("save_note", {"topic": "because", "status": "taught"})]))])
    r, events = await _ask(client, users["s"].id, "because 怎么记")
    assert events[-1]["type"] == "done" and len(fake.requests) == 1
    shown = "".join(e["text"] for e in events if e["type"] == "delta")
    assert "be + cause" in shown and "练习卡在下面" in shown
    assert any(e["type"] == "card" and e["card"]["type"] == "practice" for e in events)


@pytest.mark.asyncio
async def test_failed_tool_still_gets_followup(client, db_session, relay, shared_session):
    users = await _env(db_session)
    fake = relay([(200, _text_then_tools("来练一下。", [("make_practice", {"words": ["zzqx"]})])),
                  (200, _text_reply("这个词课本里没有,换一个吧。"))])
    r, events = await _ask(client, users["s"].id, "考考我 zzqx")
    assert len(fake.requests) == 2
    assert "课本里没有" in "".join(e["text"] for e in events if e["type"] == "delta")
