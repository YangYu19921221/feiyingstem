"""音标跟读: 本地判不清楚的请讯飞再判(2026-10-31,用户「如果判断不清楚的就用讯飞？」)

守四件事:
1. 本地有把握的不问讯飞(按次收费),判不清的才问
2. 讯飞拒了(乱读 / 说中文 / ooo 实测全拒)就是没过;没拒按分数分绿黄
3. 讯飞没配 / 关了 / 报错 / 超时 / 用到上限 → 照本地结果,不挡孩子
4. 报错后一段时间不再问(否则每个孩子都白等)
"""
import asyncio

import pytest

from app.core.shared_store import store
from app.services import phoneme_referee as pr

CLEAR_PASS = {"verdict": "pass", "gop": -1.2, "best": "bad"}
ACCENT = {"verdict": "pass", "gop": -7.2, "accent": True, "best": "cab"}
NEAR = {"verdict": "not_close", "gop": -6.0, "best": "cab"}
VOWEL = {"verdict": "not_close", "gop": -5.3, "error_code": "wrong_vowel"}
FAR = {"verdict": "not_close", "gop": -14.0}


def test_needs_referee_only_when_unclear():
    assert not pr.needs_referee(CLEAR_PASS), "本地很有把握的不花钱"
    assert pr.needs_referee(ACCENT), "靠口音放宽才过的要问"
    assert pr.needs_referee(NEAR), "差一点的要问"
    assert pr.needs_referee({"verdict": "pass", "gop": -4.8}), "贴合分在中间的要问"
    assert not pr.needs_referee(VOWEL), "元音都不对: 本地有明确证据"
    assert not pr.needs_referee({"verdict": "not_close", "gop": -6.0, "error_code": "missing_onset"})
    assert not pr.needs_referee({"verdict": "wrong_word", "gop": -6.0})
    assert not pr.needs_referee(FAR), "差得很远"
    assert not pr.needs_referee({"verdict": "off", "gop": None})


@pytest.mark.parametrize("ise,verdict,color", [
    ({"total_score": 0.0, "is_rejected": True}, "not_close", "red"),     # 乱读 / 说中文 / ooo
    ({"total_score": 52.0, "is_rejected": True}, "not_close", "yellow"),  # 拒了但分不低: 差一点
    ({"total_score": 92.0, "is_rejected": False}, "pass", "green"),
    ({"total_score": 55.0, "is_rejected": False}, "pass", "yellow"),      # 用户带口音读 cab 实测 33–56
    ({"total_score": 30.0, "is_rejected": False}, "not_close", "yellow"),
    ({"total_score": 10.0, "is_rejected": False}, "not_close", "red"),
])
def test_merge(ise, verdict, color):
    r = pr.merge(ACCENT, ise)
    assert r["verdict"] == verdict and pr.grade_of(r) == color
    assert r["accent"] is False, "讯飞判过的不再算「口音放宽」"


def test_extra_vowel_hint_keeps_it_yellow():
    """讯飞给高分,但本地听出词尾多带了一个音 → 黄(能照着改的毛病)"""
    r = pr.merge({**NEAR, "error_code": "extra_final_vowel"}, {"total_score": 90.0, "is_rejected": False})
    assert pr.grade_of(r) == "yellow"


@pytest.fixture
def fake_ise(monkeypatch):
    from app.services import iflytek_ise_service
    calls = []
    state = {"result": {"total_score": 0.0, "is_rejected": True}, "raise": None, "config": {"app_id": "x"}}

    async def evaluate(audio, text, category="read_word"):
        calls.append(text)
        if state["raise"]:
            raise state["raise"]
        return state["result"]

    async def get_config():
        return state["config"]
    monkeypatch.setattr(iflytek_ise_service, "evaluate", evaluate)
    monkeypatch.setattr(iflytek_ise_service, "get_config", get_config)
    return calls, state


def _run(coro):
    return asyncio.run(coro)


def test_referee_asks_only_when_unclear(fake_ise):
    calls, _ = fake_ise
    assert _run(pr.referee(b"a", "bad", CLEAR_PASS, 1)) is CLEAR_PASS
    assert calls == []
    r = _run(pr.referee(b"a", "cab", ACCENT, 1))
    assert calls == ["cab"] and r["verdict"] == "not_close", "讯飞拒了 = 没过"


def test_referee_falls_back_and_backs_off_on_error(fake_ise):
    calls, state = fake_ise
    state["raise"] = RuntimeError("讯飞ISE返回错误: code=11200")
    assert _run(pr.referee(b"a", "cab", ACCENT, 1)) is ACCENT, "讯飞报错: 照本地的来"
    state["raise"] = None
    assert _run(pr.referee(b"a", "cab", ACCENT, 1)) is ACCENT, "刚报过错: 这段时间不再问"
    assert calls == ["cab"]


def test_referee_skips_when_not_configured(fake_ise):
    calls, state = fake_ise
    state["config"] = None
    assert _run(pr.referee(b"a", "cab", ACCENT, 1)) is ACCENT
    assert calls == []


def test_referee_timeout_falls_back(fake_ise, monkeypatch):
    from app.services import iflytek_ise_service
    calls, _ = fake_ise

    async def slow(audio, text, category="read_word"):
        await asyncio.sleep(1)
        return {"total_score": 0.0, "is_rejected": True}
    monkeypatch.setattr(iflytek_ise_service, "evaluate", slow)
    assert _run(pr.referee(b"a", "cab", ACCENT, 1, timeout=0.05)) is ACCENT


def test_per_student_cap(fake_ise, monkeypatch):
    calls, _ = fake_ise
    monkeypatch.setattr(pr, "PER_STUDENT_CAP", 2)
    for _ in range(3):
        _run(pr.referee(b"a", "cab", ACCENT, 7))
    assert len(calls) == 2, "一个孩子一天最多问 PER_STUDENT_CAP 次"
    _run(pr.referee(b"a", "cab", ACCENT, 8))
    assert len(calls) == 3, "别的孩子不受影响"
