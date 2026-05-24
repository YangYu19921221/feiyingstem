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


class ExamAdapter:
    def judge(self, word: Any, payload: dict) -> bool:
        selected = payload.get("selected")
        correct = payload.get("correct")
        return selected is not None and selected == correct


_ADAPTERS: dict[str, PhaseAdapter] = {
    "classify": ClassifyAdapter(),
    "speech": SpeechAdapter(),
    "dictation": DictationAdapter(),
    "exam": ExamAdapter(),
}


def get_adapter(phase: str) -> PhaseAdapter:
    return _ADAPTERS[phase]
