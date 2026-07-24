"""PK lock-step 同步引擎。

引擎不发 WS,只返回事件列表,由调用方(pk_websocket.py)负责广播。
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
import random
from app.services.pk.state import RoomState, AnswerRecord, PHASES_IN_ORDER, PhaseLiteral
from app.services.pk.adapters import get_adapter, exam_type_for
from app.services.pk.score import rank_players, live_ranking, team_ranking, compute_question_points


PHASE_TIMEOUT_MS: dict[str, int] = {
    "classify": 20_000,
    "speech": 25_000,
    "dictation": 60_000,
    "exam": 30_000,
}

# 按组内阶段的单题超时(抄写态给足时间;stage 就是 classify/dictation/exam)
STAGE_TIMEOUT_MS: dict[str, int] = {
    "classify": 20_000,
    "dictation": 60_000,
    "exam": 30_000,
}


def init_player_groups(room: RoomState, p, group_size: Optional[int] = None) -> None:
    """开局:把玩家私有词表切成 groups,初始化状态机到「第一组·分类·第一词」。"""
    from app.services.pk.state import DEFAULT_GROUP_SIZE
    gsize = group_size or DEFAULT_GROUP_SIZE
    wids = list(p.word_ids)
    p.groups = [wids[i:i + gsize] for i in range(0, len(wids), gsize)] or []
    p.gi = 0
    p.q_seq = 0
    p.stage = "classify" if p.groups else "done"
    p.cls_results = {}
    p.dict_first = {}
    p.exam_correct = p.exam_total = p.exam_attempt = 0
    p.dict_copies_left = 0
    if p.groups:
        p.cls_pending = list(p.groups[0])
        p.current_wid = p.cls_pending[0]
    else:
        p.cls_pending = []
        p.current_wid = None
        p.finished = True
        p.finished_at = datetime.utcnow()
    p.current_meta = {}
    _prepare_meta(room, p, room.word_lookup)
    p.progress = p.compute_progress()


def _prepare_meta(room: RoomState, p, word_lookup: dict[int, Any]) -> None:
    """按当前 stage/词 预备 current_meta(过关题型+选项、听写抄写剩余遍数)。"""
    p.current_meta = {}
    if p.stage == "exam" and p.current_wid is not None:
        etype = exam_type_for(p.q_seq)
        p.current_meta["exam_type"] = etype
        if etype in ("en_to_cn", "cn_to_en"):
            p.current_meta["options"] = _build_exam_options(room, word_lookup, p.current_wid, etype)
    elif p.stage == "dictation":
        # 抄写态:附带需抄遍数与正确词(前端提示"再抄N遍");dict_copies_left>0 表示在抄写
        if p.dict_copies_left > 0:
            p.current_meta["copies_left"] = p.dict_copies_left


def _question_event(room: RoomState, p, word_lookup: dict[int, Any]) -> dict:
    """构造发给某玩家的「下一题」事件(定向,带 target_user_id)。状态机版:带 q_seq/stage。"""
    wid = p.current_wid
    word = word_lookup.get(wid) if wid is not None else None
    evt: dict = {
        "type": "question_pushed",
        "target_user_id": p.user_id,
        "q_seq": p.q_seq,
        "stage": p.stage,
        # phase 兼容旧前端字段名(与 stage 同值);done 时无题
        "phase": p.stage,
        "group_idx": p.gi,
        "group_total": p.group_total,
        "word": _serialize_word(word),
        "points": room.points_for_word(wid) if wid is not None else 0,
    }
    meta = p.current_meta or {}
    if "exam_type" in meta:
        evt["exam_type"] = meta["exam_type"]
    if "options" in meta:
        evt["options"] = meta["options"]
    if "copies_left" in meta:
        evt["copies_left"] = meta["copies_left"]
    return evt


def _build_exam_options(room: RoomState, word_lookup: dict[int, Any], wid, exam_type: str) -> list[str]:
    """给过关选择题构造选项:正确答案 + 从房间其余词里取最多 3 个干扰项,打乱后返回。
    en_to_cn 用中文释义,cn_to_en 用英文原词。"""
    correct_word = word_lookup.get(wid) if wid is not None else None
    if correct_word is None:
        return []
    field = "translation" if exam_type == "en_to_cn" else "word"
    correct = (getattr(correct_word, field, "") or "").strip()
    if not correct:
        return []
    pool = []
    seen = {correct}
    for owid, ow in word_lookup.items():
        if owid == wid:
            continue
        val = (getattr(ow, field, "") or "").strip()
        if val and val not in seen:
            seen.add(val)
            pool.append(val)
    random.shuffle(pool)
    options = pool[:3] + [correct]
    random.shuffle(options)
    return options


def _pop_current(pending: list[int]) -> None:
    """把队首(当前词)移除。"""
    if pending:
        pending.pop(0)


def _set_current_from_pending(p, pending: list[int]) -> None:
    p.current_wid = pending[0] if pending else None


def _advance(room: RoomState, p, is_correct: bool, payload: dict, word_lookup: dict[int, Any]) -> None:
    """分类记忆法状态机推进(替代旧的无条件 current_word_idx += 1)。
    根据当前 stage 与判定结果,更新队列、切换阶段/组,必要时置 done。"""
    stage = p.stage
    if stage == "classify":
        wid = p.current_wid
        category = payload.get("category", "unknown")
        if wid is not None:
            p.cls_results[wid] = category
        _pop_current(p.cls_pending)
        if not p.cls_pending:
            # 本轮结束:夹生(semi)+陌生(unknown)循环重来;全熟悉才进听写
            again = [w for w in p.cur_group if p.cls_results.get(w) != "familiar"]
            if again:
                p.cls_pending = again
            else:
                _enter_dictation(p)
        _set_current_from_pending(p, p.cls_pending if p.stage == "classify" else p.dict_pending)

    elif stage == "dictation":
        wid = p.current_wid
        if p.dict_copies_left > 0:
            # 抄写态:抄对一遍减一,抄错重来(不减)。抄够后该词出队。
            if is_correct:
                p.dict_copies_left -= 1
                if p.dict_copies_left <= 0:
                    _pop_current(p.dict_pending)
                    _after_dict_pop(p)
            # 抄错:停在原词继续抄(current_wid 不变)
        else:
            # 首次听写
            first = p.dict_first.get(wid)
            if wid is not None and first is None:
                p.dict_first[wid] = is_correct
            if is_correct:
                _pop_current(p.dict_pending)
                _after_dict_pop(p)
            else:
                # 错:进入抄写(需连续抄对 DICT_COPY_REQUIRED 遍)
                from app.services.pk.state import DICT_COPY_REQUIRED
                p.dict_copies_left = DICT_COPY_REQUIRED
                # current_wid 不变,继续抄本词
        if p.stage == "dictation":
            _set_current_from_pending(p, p.dict_pending)

    elif stage == "exam":
        if is_correct:
            p.exam_correct += 1
        _pop_current(p.exam_pending)
        if not p.exam_pending:
            # 本次过关结束:算通过率
            from app.services.pk.state import EXAM_PASS_RATIO
            ratio = (p.exam_correct / p.exam_total) if p.exam_total else 0.0
            if ratio >= EXAM_PASS_RATIO:
                _advance_group(p)
            else:
                # 重考:重灌本组词,重置计数
                p.exam_attempt += 1
                p.exam_pending = list(p.cur_group)
                random.shuffle(p.exam_pending)
                p.exam_correct = 0
                p.exam_total = len(p.exam_pending)
        _set_current_from_pending(p, p.exam_pending if p.stage == "exam" else _stage_pending(p))

    # 推进后刷新 meta(题型/抄写遍数)与进度
    if p.stage != "done":
        _prepare_meta(room, p, word_lookup)
    else:
        p.current_meta = {}
        p.current_wid = None
    p.progress = p.compute_progress()


def _stage_pending(p) -> list[int]:
    return {"classify": p.cls_pending, "dictation": p.dict_pending, "exam": p.exam_pending}.get(p.stage, [])


def _enter_dictation(p) -> None:
    p.stage = "dictation"
    p.dict_pending = list(p.cur_group)
    p.dict_first = {}
    p.dict_copies_left = 0
    p.current_wid = p.dict_pending[0] if p.dict_pending else None


def _after_dict_pop(p) -> None:
    """听写某词出队后:队列空了则本轮结束。首次错的词循环再听写一遍(错词已抄过,
    这轮只再确认一次,不再要求第二轮抄写,避免无限拖);再过后进过关检测。"""
    p.dict_copies_left = 0
    if not p.dict_pending:
        wrong_again = [w for w in p.cur_group if p.dict_first.get(w) is False]
        if wrong_again and not getattr(p, "_dict_relooped", False):
            p._dict_relooped = True
            p.dict_pending = list(wrong_again)
            p.current_wid = p.dict_pending[0]
        else:
            _enter_exam(p)


def _enter_exam(p) -> None:
    p.stage = "exam"
    p._dict_relooped = False
    p.exam_pending = list(p.cur_group)
    random.shuffle(p.exam_pending)
    p.exam_correct = 0
    p.exam_total = len(p.exam_pending)
    p.exam_attempt = 0
    p.current_wid = p.exam_pending[0] if p.exam_pending else None


def _advance_group(p) -> None:
    """本组过关:进入下一组的分类;没有下一组则完成。"""
    p.gi += 1
    if p.gi < len(p.groups):
        p.stage = "classify"
        p.cls_pending = list(p.cur_group)
        p.cls_results = {}
        p.current_wid = p.cls_pending[0] if p.cls_pending else None
    else:
        p.stage = "done"
        p.finished = True
        p.finished_at = datetime.utcnow()
        p.current_wid = None


def submit_answer(
    room: RoomState,
    user_id: int,
    word_idx: int,      # 兼容旧签名:此处复用为 q_seq(客户端回显服务端下发的 q_seq)
    phase: str,         # 兼容旧签名:此处为 stage(classify/dictation/exam)
    payload: dict,
    time_spent_ms: int,
    word_lookup: dict[int, Any],
) -> list[dict]:
    """分类记忆法队列状态机:校验 q_seq → 判定 → _advance 推进 → 定向推下一题。
    率先走完全部组(stage=done)者完成。全员完成由调用方检测后提前结算。"""
    if room.status != "playing":
        return []
    p = room.players.get(user_id)
    if p is None or not p.groups or p.stage == "done":
        return []
    q_seq = word_idx
    stage = phase
    # 幂等/防乱序:只收该玩家「当前这一题」(q_seq + stage 都要匹配)
    if q_seq != p.q_seq or stage != p.stage:
        return []
    # 防刷上限:循环流程题数不固定,给一个宽松硬顶(每组约 3*词数题 * 20 组循环冗余)
    if len(p.answers) >= max(500, len(p.word_ids) * 30):
        return []

    stage_timeout = STAGE_TIMEOUT_MS.get(stage, 30_000)
    time_spent_ms = max(0, min(int(time_spent_ms), stage_timeout))

    word_id = p.current_wid
    word = word_lookup.get(word_id) if word_id is not None else None
    # 过关阶段:题型服务端权威(按 q_seq 推出),注入 payload 供 adapter 判分
    if stage == "exam":
        payload = {**payload, "_exam_type": exam_type_for(q_seq)}
    is_correct = bool(get_adapter(stage).judge(word, payload))
    points_gained = compute_question_points(
        room.points_for_word(word_id) if word_id is not None else 0,
        is_correct, time_spent_ms, stage_timeout,
    )

    p.answers.append(AnswerRecord(
        user_id=user_id, word_id=word_id or 0, phase=stage,  # type: ignore[arg-type]
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
    p.q_seq += 1

    _advance(room, p, is_correct, payload, word_lookup)

    live_evt: dict = {"type": "live_ranking", "ranking": live_ranking(room)}
    if room.mode == "team":
        live_evt["team_ranking"] = team_ranking(room)
    events: list[dict] = [
        {
            "type": "question_settled",
            "target_user_id": user_id,
            "q_seq": q_seq,
            "stage": stage,
            "phase": stage,
            "results": {str(user_id): {
                "is_correct": is_correct,
                "time_spent_ms": time_spent_ms,
                "points_gained": points_gained,
            }},
        },
        live_evt,
    ]
    if p.stage == "done":
        events.append({"type": "player_finished", "target_user_id": user_id, "finished_at": p.finished_at.isoformat() + "Z"})
    else:
        events.append(_question_event(room, p, word_lookup))
    return events


def force_timeout(
    room: RoomState, user_id: int, word_idx: int, phase: str, word_lookup: dict[int, Any],
) -> list[dict]:
    """某玩家单题超时:按「错」喂进状态机推进。玩家离线则不推进(等重连)。
    word_idx 复用为 q_seq,phase 复用为 stage。"""
    if room.status != "playing":
        return []
    p = room.players.get(user_id)
    if p is None or not p.groups or not p.online or p.stage == "done":
        return []
    q_seq, stage = word_idx, phase
    if q_seq != p.q_seq or stage != p.stage:
        return []
    stage_timeout = STAGE_TIMEOUT_MS.get(stage, 30_000)
    word_id = p.current_wid
    # 超时判定:分类超时=陌生(unknown),其余按错
    payload = {"timeout": True}
    if stage == "classify":
        payload["category"] = "unknown"
    p.answers.append(AnswerRecord(
        user_id=user_id, word_id=word_id or 0, phase=stage,  # type: ignore[arg-type]
        is_correct=False, time_spent_ms=stage_timeout, payload=payload,
    ))
    p.wrong += 1
    p.streak = 0
    p.total_time_ms += stage_timeout
    p.q_seq += 1
    _advance(room, p, False, payload, word_lookup)

    live_evt: dict = {"type": "live_ranking", "ranking": live_ranking(room)}
    if room.mode == "team":
        live_evt["team_ranking"] = team_ranking(room)
    if p.stage == "done":
        return [live_evt, {"type": "player_finished", "target_user_id": user_id, "finished_at": p.finished_at.isoformat() + "Z"}]
    return [live_evt, _question_event(room, p, word_lookup)]


def all_players_done(room: RoomState) -> bool:
    """全场是否可提前结算:所有「在线」玩家都完成(stage=done)。
    至少要有一名玩家完成,避免空房误判。离线玩家不阻塞(否则一人掉线全场卡住)。"""
    online = [p for p in room.players.values() if p.online]
    considered = online or list(room.players.values())
    if not considered:
        return False
    done_any = any(p.stage == "done" for p in room.players.values())
    return done_any and all(p.stage == "done" for p in considered)


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
            "finished": ps.finished,
            "finished_at_ms": int(ps.finished_at.timestamp() * 1000) if ps.finished_at else None,
            "progress": ps.compute_progress(),
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
