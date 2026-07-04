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


def test_dictation_adapter_lenient_punct_and_unicode():
    ad = get_adapter("dictation")
    word = FakeWord(1, "apple", "苹果")
    # Trailing period
    assert ad.judge(word, {"text": "apple."}) is True
    # Multiple trailing punctuation
    assert ad.judge(word, {"text": "apple!?"}) is True
    # NBSP and fullwidth chars
    assert ad.judge(word, {"text": " apple "}) is True
    # Smart apostrophe should match ASCII apostrophe via NFKC
    word2 = FakeWord(2, "don't", "不要")
    assert ad.judge(word2, {"text": "don’t"}) is True


def test_exam_adapter_correct_option():
    ad = get_adapter("exam")
    word = FakeWord(1, "apple", "苹果")
    assert ad.judge(word, {"selected": 2, "correct": 2}) is True
    assert ad.judge(word, {"selected": 1, "correct": 2}) is False


def test_unknown_phase_raises():
    with pytest.raises(KeyError):
        get_adapter("unknown_phase")


def test_exam_adapter_text_mode_judges_spelling():
    """过关阶段当前是「重新拼写」:payload 带 text 时按文本判(修复恒判对 bug)。"""
    ad = get_adapter("exam")
    word = FakeWord(1, "apple", "苹果")
    assert ad.judge(word, {"text": "apple"}) is True
    assert ad.judge(word, {"text": " Apple. "}) is True   # 容错同听写
    assert ad.judge(word, {"text": "aple"}) is False
    assert ad.judge(word, {"text": ""}) is False


def test_exam_adapter_text_takes_precedence_over_selected():
    """带 text 时忽略 selected/correct(旧客户端曾固定发 0/0)。"""
    ad = get_adapter("exam")
    word = FakeWord(1, "apple", "苹果")
    assert ad.judge(word, {"text": "wrong", "selected": 0, "correct": 0}) is False
    assert ad.judge(word, {"text": "apple", "selected": 1, "correct": 2}) is True
