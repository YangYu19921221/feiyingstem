"""PK lock-step 同步引擎。

引擎不发 WS,只返回事件列表,由调用方(pk_websocket.py)负责广播。
"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from app.services.pk.state import RoomState, AnswerRecord, PHASES_IN_ORDER, PhaseLiteral
from app.services.pk.adapters import get_adapter
from app.services.pk.score import rank_players, live_ranking, team_ranking, compute_question_points


PHASE_TIMEOUT_MS: dict[str, int] = {
    "classify": 20_000,
    "speech": 25_000,
    "dictation": 60_000,
    "exam": 30_000,
}


def _question_event(room: RoomState, p, word_lookup: dict[int, Any]) -> dict:
    """构造发给某玩家的「下一题」事件(定向,带 target_user_id)。"""
    wid = p.current_word_id
    word = word_lookup.get(wid) if wid is not None else None
    return {
        "type": "question_pushed",
        "target_user_id": p.user_id,
        "word_idx": p.current_word_idx,       # 个人进度指针(累计,循环续刷不清零)
        "phase": p.current_phase,
        "word": _serialize_word(word),
        "points": room.points_for_word(wid) if wid is not None else 0,
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
    """并行竞速:校验个人游标 → 即时判分累加 → 推进个人指针 → 定向推该玩家下一题。
    答完自己 word_count*4 题后循环续刷(指针不清零,靠取模回到第一题继续刷分)。
    不再等全员到齐,各答各的。全场倒计时到点由 finalize_room 统一结算。"""
    if room.status != "playing":
        return []
    p = room.players.get(user_id)
    if p is None or not p.word_ids:
        return []
    # 防刷上限:限时竞速下答完循环续刷,但单人单局答题数封顶(最多 50 轮),
    # 防异常/脚本客户端按序狂发把 answers 堆爆内存、落库放大。正常手速远达不到。
    if len(p.answers) >= len(p.word_ids) * 4 * 50:
        return []
    # 幂等/防乱序:只收该玩家「当前这一题」的作答(word_idx 必须等于其个人游标)
    if word_idx != p.current_word_idx:
        return []
    if phase != p.current_phase:
        return []

    timeout_ms = PHASE_TIMEOUT_MS.get(phase, 30_000)
    time_spent_ms = max(0, min(int(time_spent_ms), timeout_ms))

    word_id = p.current_word_id
    word = word_lookup.get(word_id) if word_id is not None else None
    is_correct = bool(get_adapter(phase).judge(word, payload))
    points_gained = compute_question_points(
        room.points_for_word(word_id) if word_id is not None else 0,
        is_correct, time_spent_ms, timeout_ms,
    )

    p.answers.append(AnswerRecord(
        user_id=user_id, word_id=word_id or 0, phase=phase,  # type: ignore[arg-type]
        is_correct=is_correct, time_spent_ms=time_spent_ms, payload=payload,
    ))
    if is_correct:
        p.correct += 1
        p.streak += 1
        p.best_streak = max(p.best_streak, p.streak)
    else:
        p.wrong += 1
        p.streak = 0
    p.points += points_gained
    p.total_time_ms += time_spent_ms
    p.current_word_idx += 1

    live_evt: dict = {"type": "live_ranking", "ranking": live_ranking(room)}
    if room.mode == "team":
        live_evt["team_ranking"] = team_ranking(room)
    events: list[dict] = [
        {
            "type": "question_settled",       # 只是「我这题」的即时回执(定向)
            "target_user_id": user_id,
            "word_idx": word_idx,
            "phase": phase,
            "results": {str(user_id): {
                "is_correct": is_correct,
                "time_spent_ms": time_spent_ms,
                "points_gained": points_gained,
            }},
        },
        live_evt,
        _question_event(room, p, word_lookup),  # 立刻推我的下一题(循环续刷)
    ]
    return events


def force_timeout(
    room: RoomState, user_id: int, word_idx: int, phase: str, word_lookup: dict[int, Any],
) -> list[dict]:
    """某玩家单题超时:该题记错、推进其个人指针、推下一题。玩家离线则不推进(等重连)。"""
    if room.status != "playing":
        return []
    p = room.players.get(user_id)
    if p is None or not p.word_ids or not p.online:
        return []
    if word_idx != p.current_word_idx or phase != p.current_phase:
        return []
    timeout_ms = PHASE_TIMEOUT_MS.get(phase, 30_000)
    word_id = p.current_word_id
    p.answers.append(AnswerRecord(
        user_id=user_id, word_id=word_id or 0, phase=phase,  # type: ignore[arg-type]
        is_correct=False, time_spent_ms=timeout_ms, payload={"timeout": True},
    ))
    p.wrong += 1
    p.streak = 0
    p.total_time_ms += timeout_ms
    p.current_word_idx += 1

    live_evt: dict = {"type": "live_ranking", "ranking": live_ranking(room)}
    if room.mode == "team":
        live_evt["team_ranking"] = team_ranking(room)
    return [live_evt, _question_event(room, p, word_lookup)]


def finalize_room(room: RoomState) -> list[dict]:
    """全场倒计时到点:强制结算,产出总榜 game_finished。幂等(已 finished 直接空返回)。"""
    if room.status == "finished":
        return []
    # 空房(教师房全员已离场)不产出结算,避免落一条 0 人的假对局;直接标结束让调用方清房
    if not room.players:
        room.status = "finished"
        room.finished_at = datetime.utcnow()
        return []
    room.status = "finished"
    room.current_phase = "summary"
    room.finished_at = datetime.utcnow()
    ranking = rank_players([
        {
            "user_id": ps.user_id, "nickname": ps.nickname,
            "correct": ps.correct, "wrong": ps.wrong,
            "total_time_ms": ps.total_time_ms,
            "points": ps.points, "best_streak": ps.best_streak,
            "team": ps.team,
        }
        for ps in room.players.values()
    ])
    finish_evt: dict = {"type": "game_finished", "ranking": ranking}
    if room.mode == "team":
        finish_evt["team_ranking"] = team_ranking(room)
    return [finish_evt]


def _serialize_word(word: Any) -> dict:
    if word is None:
        return {}
    return {
        "id": getattr(word, "id", None),
        "word": getattr(word, "word", ""),
        "translation": getattr(word, "translation", ""),
    }


def select_words_with_fallback(
    per_user_learned: dict[int, set[int]],
    word_count: int,
    rng: Any,
    min_common: int = 4,
    fill_pool: set[int] | None = None,
) -> tuple[list[int], int]:
    """自由房选词:优先「所有参赛玩家都背过」的交集,不够 word_count 时用 fill_pool 里
    其余词补齐(对齐晋级赛的"以赛促学"策略,避免共同词偏少时直接卡死开不了局)。

    返回 (chosen_word_ids, common_count)。common_count 供调用方在完全无共同词
    且无补充池时给出友好提示。fill_pool=None 表示不补(严格交集,老行为)。
    """
    sets = [s for s in per_user_learned.values()]
    common = set.intersection(*sets) if sets else set()
    common_count = len(common)
    common_list = list(common)
    rng.shuffle(common_list)
    chosen = common_list[:word_count]
    if len(chosen) < word_count and fill_pool:
        rest = [w for w in fill_pool if w not in common]
        rng.shuffle(rest)
        chosen = (chosen + rest)[:word_count]
    rng.shuffle(chosen)
    return chosen, common_count


def select_words_for_player(
    learned: set[int], word_count: int, rng: Any, fill_pool: set[int] | None = None,
) -> list[int]:
    """并行竞速:给单个玩家从他自己背过的词里抽 word_count 个;不足时用 fill_pool
    (该玩家已学的其余词)补齐。返回抽到的 word_id 列表(可能不足 word_count,由调用方判断)。"""
    pool = list(learned)
    rng.shuffle(pool)
    chosen = pool[:word_count]
    if len(chosen) < word_count and fill_pool:
        rest = [w for w in fill_pool if w not in learned]
        rng.shuffle(rest)
        chosen = (chosen + rest)[:word_count]
    return chosen
