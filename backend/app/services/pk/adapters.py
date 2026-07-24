"""PK 阶段适配器:把不同题型的判定收敛到 judge(word, payload) -> bool。"""
from __future__ import annotations
import unicodedata
from typing import Protocol, Any


class PhaseAdapter(Protocol):
    def judge(self, word: Any, payload: dict) -> bool: ...


class ClassifyAdapter:
    VALID = {"familiar", "semi", "unknown"}

    def judge(self, word: Any, payload: dict) -> bool:
        return payload.get("category") in self.VALID


class SpeechAdapter:
    def judge(self, word: Any, payload: dict) -> bool:
        return payload.get("result") == "pass"


def _normalize_dictation_text(s: str) -> str:
    """Normalize dictation input: strip whitespace, lowercase, normalize unicode,
    map smart quotes to ASCII, strip trailing punctuation. Tolerates K12 typing
    quirks like trailing periods, smart quotes, and NBSP."""
    if not s:
        return ""
    # NFKC handles fullwidth chars / NBSP. It does NOT map smart quotes to ASCII,
    # so we translate them explicitly.
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(_QUOTE_MAP)
    s = s.strip().lower()
    while s and s[-1] in ".,!?":
        s = s[:-1]
    return s.strip()


# Smart / fullwidth quote chars → ASCII equivalents.
_QUOTE_MAP = {
    ord("‘"): "'",  # left single quotation mark
    ord("’"): "'",  # right single quotation mark / smart apostrophe
    ord("‚"): "'",  # single low-9 quotation mark
    ord("‛"): "'",  # single high-reversed-9
    ord("ʼ"): "'",  # modifier letter apostrophe
    ord("“"): '"',  # left double quotation mark
    ord("”"): '"',  # right double quotation mark
    ord("„"): '"',  # double low-9 quotation mark
    ord("´"): "'",  # acute accent often used as apostrophe
    ord("`"): "'",  # grave accent / backtick used as apostrophe
}


class DictationAdapter:
    def judge(self, word: Any, payload: dict) -> bool:
        text = _normalize_dictation_text(payload.get("text") or "")
        target = _normalize_dictation_text(getattr(word, "word", "") or "")
        return text == target and target != ""


# 过关检测题型(对齐分类记忆法 GroupExamPhase):
#   en_to_cn 英译中(选择) / cn_to_en 中译英(选择) / listening 听音拼写 / spelling 看义拼写
EXAM_TYPES: tuple[str, ...] = ("en_to_cn", "cn_to_en", "listening", "spelling")


def exam_type_for(word_idx: int) -> str:
    """按个人进度指针确定性地推出该题的过关题型。
    push(出题)与 judge(判分)都用同一函数,保证前后端题型一致、无需存状态。"""
    return EXAM_TYPES[word_idx % len(EXAM_TYPES)]


class ExamAdapter:
    """过关阶段判分:题型由服务端权威决定(见 engine.submit_answer 注入 payload['_exam_type'])。
    - 选择题(en_to_cn/cn_to_en): 比对 selected 文本与正确答案文本(正则化后相等)
    - 拼写/听写(spelling/listening): 按听写规则判 text
    """

    def judge(self, word: Any, payload: dict) -> bool:
        exam_type = payload.get("_exam_type", "spelling")
        if exam_type == "en_to_cn":
            selected = _norm_choice(payload.get("selected"))
            target = _norm_choice(getattr(word, "translation", "") or "")
            return selected != "" and selected == target
        if exam_type == "cn_to_en":
            selected = _norm_choice(payload.get("selected"))
            target = _norm_choice(getattr(word, "word", "") or "")
            return selected != "" and selected == target
        # listening / spelling: 拼出英文单词
        text = _normalize_dictation_text(payload.get("text") or "")
        target = _normalize_dictation_text(getattr(word, "word", "") or "")
        return text == target and target != ""


def _norm_choice(s: Any) -> str:
    """选择题选项归一:去空白 + 小写(中文释义也可能带词性/空格,统一后比对)。"""
    if not isinstance(s, str):
        return ""
    return unicodedata.normalize("NFKC", s).strip().lower()


_ADAPTERS: dict[str, PhaseAdapter] = {
    "classify": ClassifyAdapter(),
    "speech": SpeechAdapter(),
    "dictation": DictationAdapter(),
    "exam": ExamAdapter(),
}


def get_adapter(phase: str) -> PhaseAdapter:
    return _ADAPTERS[phase]
