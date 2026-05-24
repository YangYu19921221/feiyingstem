"""PK 阶段适配器:把不同题型的判定收敛到 judge(word, payload) -> bool。"""
from __future__ import annotations
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


class DictationAdapter:
    def judge(self, word: Any, payload: dict) -> bool:
        text = (payload.get("text") or "").strip().lower()
        target = (getattr(word, "word", "") or "").strip().lower()
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
