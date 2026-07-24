"""掌握赛引擎测试(分类记忆法流程):每人分组走 分类循环→听写抄写→过关重考,
率先全部过关者赢;全场倒计时兜底结算。"""
import random
import pytest
from app.services.pk import manager, engine
from app.services.pk.engine import select_words_for_player, init_player_groups, exam_type_for


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


class FakeWord:
    def __init__(self, wid, text=None):
        self.id = wid
        self.word = text or f"w{wid}"
        self.translation = f"t{wid}"


def _race_room(per_player_words: dict[int, list[int]], countdown=300, group_size=10):
    """建教师房,给每个学生塞私有词表并初始化状态机,置 playing。"""
    room = manager.create_room(host_id=100, max_players=8, org_id=1,
                               host_is_player=False, countdown_seconds=countdown)
    all_ids = {w for wids in per_player_words.values() for w in wids}
    room.word_lookup = {w: FakeWord(w) for w in all_ids}
    room.word_points = {w: 100 for w in all_ids}
    # 先在 waiting 阶段 join,再置 playing + 初始化状态机(join 要求房间 waiting)
    for uid, wids in per_player_words.items():
        manager.join_room(invite_code=room.invite_code, user_id=uid, nickname=f"U{uid}", org_id=1)
        room.players[uid].word_ids = list(wids)
    room.status = "playing"
    for uid in per_player_words:
        init_player_groups(room, room.players[uid], group_size=group_size)
    return room


def _answer_current(room, uid, correct=True):
    p = room.players[uid]
    stage, wid = p.stage, p.current_wid
    if stage == "classify":
        payload = {"category": "familiar" if correct else "unknown"}
    elif stage == "exam":
        et = exam_type_for(p.q_seq)
        if et in ("en_to_cn", "cn_to_en"):
            field = "translation" if et == "en_to_cn" else "word"
            val = getattr(room.word_lookup[wid], field) if correct else "错"
            payload = {"selected": val}
        else:
            payload = {"text": room.word_lookup[wid].word if correct else "zzz"}
    else:  # dictation
        payload = {"text": room.word_lookup[wid].word if correct else "zzz"}
    return engine.submit_answer(room, uid, p.q_seq, stage, payload, 500, room.word_lookup)


def _play_to_done(room, uid):
    guard = 0
    while room.players[uid].stage != "done" and guard < 2000:
        _answer_current(room, uid, correct=True)
        guard += 1


# ---------- 选词:各抽各的 ----------

def test_select_words_for_player_picks_from_own_learned():
    chosen = select_words_for_player({1, 2, 3, 4, 5}, word_count=3, rng=random)
    assert len(chosen) == 3
    assert set(chosen) <= {1, 2, 3, 4, 5}


def test_select_words_for_player_pads_from_fill_pool():
    chosen = select_words_for_player({1, 2}, word_count=4, rng=random, fill_pool={1, 2, 3, 4, 5})
    assert len(chosen) == 4
    assert {1, 2} <= set(chosen)


# ---------- 分组初始化 ----------

def test_init_player_groups_splits_and_starts_classify():
    room = _race_room({1: list(range(1, 16))}, group_size=10)  # 15 词 → 2 组
    p = room.players[1]
    assert p.group_total == 2 and p.gi == 0
    assert p.stage == "classify" and p.q_seq == 0
    assert p.current_wid == p.groups[0][0]


# ---------- 各答各的:两人互不干扰 ----------

def test_each_player_progresses_independently():
    room = _race_room({1: [10, 11], 2: [20, 21]})
    _answer_current(room, 1, correct=True)
    assert room.players[1].q_seq == 1
    assert room.players[2].q_seq == 0  # 玩家2 不受影响


def test_stale_qseq_rejected():
    room = _race_room({1: [10, 11]})
    p = room.players[1]
    events = engine.submit_answer(room, 1, p.q_seq + 9, p.stage, {"category": "familiar"}, 100, room.word_lookup)
    assert events == []
    assert p.q_seq == 0


# ---------- 分类循环:夹生/陌生重来直到全熟悉 ----------

def test_classify_reloops_until_all_familiar():
    room = _race_room({1: [10, 11]})
    p = room.players[1]
    _answer_current(room, 1, correct=True)   # w10 familiar
    # w11 unknown → 本轮结束后应重刷 w11(仍在 classify)
    engine.submit_answer(room, 1, p.q_seq, "classify", {"category": "unknown"}, 300, room.word_lookup)
    assert p.stage == "classify" and p.current_wid == 11
    # 再标 familiar → 进听写
    engine.submit_answer(room, 1, p.q_seq, "classify", {"category": "familiar"}, 300, room.word_lookup)
    assert p.stage == "dictation"


# ---------- 听写:错词抄 3 遍 ----------

def test_dictation_wrong_requires_copies():
    room = _race_room({1: [10]})
    p = room.players[1]
    # 单词组:分类过
    engine.submit_answer(room, 1, p.q_seq, "classify", {"category": "familiar"}, 200, room.word_lookup)
    assert p.stage == "dictation"
    # 首次错 → 抄写态需 3 遍
    engine.submit_answer(room, 1, p.q_seq, "dictation", {"text": "zzz"}, 200, room.word_lookup)
    assert p.dict_copies_left == 3
    for expect in (2, 1):
        engine.submit_answer(room, 1, p.q_seq, "dictation", {"text": "w10"}, 200, room.word_lookup)
        assert p.dict_copies_left == expect
    # 第 3 遍抄对 → 出队,本词首错要再听一轮,最终进过关
    engine.submit_answer(room, 1, p.q_seq, "dictation", {"text": "w10"}, 200, room.word_lookup)
    # 单词组:错词循环再听一遍
    while p.stage == "dictation":
        engine.submit_answer(room, 1, p.q_seq, "dictation", {"text": "w10"}, 200, room.word_lookup)
    assert p.stage == "exam"


# ---------- 过关:<60% 重考,≥60% 过 ----------

def test_exam_retry_then_pass_then_done():
    room = _race_room({1: [10, 11]})
    p = room.players[1]
    # 过分类 + 听写
    while p.stage == "classify":
        _answer_current(room, 1, True)
    while p.stage == "dictation":
        _answer_current(room, 1, True)
    assert p.stage == "exam"
    # 全错 → 重考
    for _ in range(p.exam_total):
        _answer_current(room, 1, False)
    assert p.stage == "exam" and p.exam_attempt == 1
    # 全对 → 过关(单组)→ done
    for _ in range(p.exam_total):
        _answer_current(room, 1, True)
    assert p.stage == "done" and p.finished and p.finished_at is not None


# ---------- 提前结算 & 排名 ----------

def test_all_players_done_and_finish_ranking():
    room = _race_room({1: [10, 11], 2: [20, 21]})
    _play_to_done(room, 1)
    assert not engine.all_players_done(room)   # 玩家2 未完成
    _play_to_done(room, 2)
    assert engine.all_players_done(room)
    events = engine.finalize_room(room)
    gf = [e for e in events if e["type"] == "game_finished"]
    assert gf
    ranking = gf[0]["ranking"]
    # 玩家1 先完成 → rank 1
    assert ranking[0]["user_id"] == 1 and ranking[0]["rank"] == 1


def test_finalize_empty_room_no_ranking():
    room = _race_room({1: [10, 11]})
    room.players.clear()
    events = engine.finalize_room(room)
    assert events == []
    assert room.status == "finished"


def test_submit_after_finished_ignored():
    room = _race_room({1: [10, 11]})
    engine.finalize_room(room)
    p = room.players[1]
    events = engine.submit_answer(room, 1, p.q_seq, p.stage, {"category": "familiar"}, 100, room.word_lookup)
    assert events == []


def test_timeout_classify_marks_unknown():
    room = _race_room({1: [10, 11]})
    p = room.players[1]
    engine.force_timeout(room, 1, p.q_seq, "classify", room.word_lookup)
    assert p.cls_results.get(10) == "unknown"
