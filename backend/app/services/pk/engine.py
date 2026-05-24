"""PK lock-step 同步引擎。

引擎不发 WS,只返回事件列表,由调用方(pk_websocket.py)负责广播。
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from app.services.pk.state import RoomState, AnswerRecord, PHASES_IN_ORDER, PhaseLiteral
from app.services.pk.adapters import get_adapter
from app.services.pk.score import rank_players


PHASE_TIMEOUT_MS: dict[str, int] = {
    "classify": 20_000,
    "speech": 25_000,
    "dictation": 60_000,
    "exam": 30_000,
}


def submit_answer(
    room: RoomState,
    user_id: int,
    word_idx: int,
    phase: str,
    payload: dict,
    time_spent_ms: int,
    word_lookup: dict[int, Any],
) -> list[dict]:
    """记录答案;若全员到齐则触发结算,推进至下一题/阶段;返回待广播事件列表。"""
    if user_id not in room.players:
        return []
    if word_idx != room.current_word_idx:
        return []  # 提交的不是当前题,丢弃
    if phase != room.current_phase:
        return []
    bucket = room.answers.setdefault(word_idx, {})
    if user_id in bucket:
        return []  # 重复提交丢弃

    word_id = room.current_word_id  # word_idx == room.current_word_idx by guard above
    word = word_lookup.get(word_id)
    is_correct = bool(get_adapter(phase).judge(word, payload))

    bucket[user_id] = AnswerRecord(
        user_id=user_id, word_id=word_id, phase=phase,  # type: ignore[arg-type]
        is_correct=is_correct, time_spent_ms=time_spent_ms, payload=payload,
    )
    p = room.players[user_id]
    if is_correct:
        p.correct += 1
    else:
        p.wrong += 1
    p.total_time_ms += time_spent_ms
    p.current_word_idx = word_idx + 1

    events: list[dict] = [{"type": "player_answered", "user_id": user_id, "word_idx": word_idx}]

    online_players = [uid for uid, ps in room.players.items() if ps.online]
    if all(uid in bucket for uid in online_players):
        events.extend(_settle_and_advance(room, word_idx, word_lookup))
    return events


def force_timeout(
    room: RoomState, word_idx: int, phase: str, word_lookup: dict[int, Any],
) -> list[dict]:
    """超时:对未提交者记错,触发结算。"""
    if word_idx != room.current_word_idx or phase != room.current_phase:
        return []
    bucket = room.answers.setdefault(word_idx, {})
    word_id = room.current_word_id  # word_idx == room.current_word_idx by guard above
    timeout_ms = PHASE_TIMEOUT_MS.get(phase, 30_000)
    for uid, ps in room.players.items():
        if not ps.online or uid in bucket:
            continue
        bucket[uid] = AnswerRecord(
            user_id=uid, word_id=word_id, phase=phase,  # type: ignore[arg-type]
            is_correct=False, time_spent_ms=timeout_ms, payload={"timeout": True},
        )
        ps.wrong += 1
        ps.total_time_ms += timeout_ms
        ps.current_word_idx = word_idx + 1
    return _settle_and_advance(room, word_idx, word_lookup)


def _settle_and_advance(
    room: RoomState, word_idx: int, word_lookup: dict[int, Any],
) -> list[dict]:
    bucket = room.answers.get(word_idx, {})
    settled = {
        str(uid): {"is_correct": ans.is_correct, "time_spent_ms": ans.time_spent_ms}
        for uid, ans in bucket.items()
    }
    events: list[dict] = [
        {"type": "question_settled", "word_idx": word_idx, "results": settled}
    ]

    new_global = word_idx + 1
    n_words = len(room.word_ids)
    total = n_words * len(PHASES_IN_ORDER)
    if new_global >= total:
        room.status = "finished"
        room.current_phase = "summary"
        room.finished_at = datetime.utcnow()
        ranking = rank_players([
            {
                "user_id": ps.user_id, "nickname": ps.nickname,
                "correct": ps.correct, "wrong": ps.wrong, "total_time_ms": ps.total_time_ms,
            }
            for ps in room.players.values()
        ])
        events.append({"type": "game_finished", "ranking": ranking})
        return events

    new_phase: PhaseLiteral = PHASES_IN_ORDER[new_global // n_words]
    if new_phase != room.current_phase:
        room.current_phase = new_phase
        events.append({"type": "phase_advanced", "new_phase": new_phase})
    room.current_word_idx = new_global

    next_word_id = room.current_word_id
    next_word = word_lookup.get(next_word_id)
    events.append({
        "type": "question_pushed",
        "word_idx": new_global,
        "phase": new_phase,
        "word": _serialize_word(next_word),
    })
    return events


def _serialize_word(word: Any) -> dict:
    if word is None:
        return {}
    return {
        "id": getattr(word, "id", None),
        "word": getattr(word, "word", ""),
        "translation": getattr(word, "translation", ""),
    }
