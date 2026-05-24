import pytest
from app.services.pk.adapters import get_adapter


class FakeWord:
    def __init__(self, id, text, translation):
        self.id = id
        self.word = text
        self.translation = translation


def test_classify_adapter_familiar_correct():
    ad = get_adapter("classify")
    word = FakeWord(1, "apple", "苹果")
    # 分类阶段:任何合法分类都视为"答完";PK 模式简化:familiar/semi/unknown
    # 都算正确(只是分类动作),非法 category 记错。
    assert ad.judge(word, {"category": "familiar"}) is True
    assert ad.judge(word, {"category": "unknown"}) is True
    assert ad.judge(word, {"category": "semi"}) is True
    assert ad.judge(word, {"category": "invalid"}) is False


def test_speech_adapter_pass_vs_skip():
    ad = get_adapter("speech")
    word = FakeWord(1, "apple", "苹果")
    assert ad.judge(word, {"result": "pass"}) is True
    assert ad.judge(word, {"result": "skip"}) is False


def test_dictation_adapter_case_insensitive_trim():
    ad = get_adapter("dictation")
    word = FakeWord(1, "Apple", "苹果")
    assert ad.judge(word, {"text": "apple"}) is True
    assert ad.judge(word, {"text": "  APPLE  "}) is True
    assert ad.judge(word, {"text": "appel"}) is False


def test_exam_adapter_correct_option():
    ad = get_adapter("exam")
    word = FakeWord(1, "apple", "苹果")
    assert ad.judge(word, {"selected": 2, "correct": 2}) is True
    assert ad.judge(word, {"selected": 1, "correct": 2}) is False


def test_unknown_phase_raises():
    with pytest.raises(KeyError):
        get_adapter("unknown_phase")
