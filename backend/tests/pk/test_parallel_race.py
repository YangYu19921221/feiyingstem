"""并行竞速引擎测试:每人各考自己背过的词、各跑各的、答完循环续刷、全场倒计时结算。"""
import random
import pytest
from app.services.pk import manager, engine
from app.services.pk.state import PHASES_IN_ORDER
from app.services.pk.engine import select_words_for_player


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
    def __init__(self, wid, text="apple"):
        self.id = wid
        self.word = text
        self.translation = "苹果"


def _race_room(per_player_words: dict[int, list[int]], countdown=300):
    """建教师并行房,直接给每个学生塞好私有词表并置 playing。"""
    room = manager.create_room(host_id=100, max_players=8, org_id=1,
                               host_is_player=False, countdown_seconds=countdown)
    for uid, wids in per_player_words.items():
        manager.join_room(invite_code=room.invite_code, user_id=uid, nickname=f"U{uid}", org_id=1)
        ps = room.players[uid]
        ps.word_ids = list(wids)
        ps.current_word_idx = 0
    all_ids = {w for wids in per_player_words.values() for w in wids}
    room.word_lookup = {w: FakeWord(w) for w in all_ids}
    room.word_points = {w: 100 for w in all_ids}
    room.status = "playing"
    return room


# ---------- 单人选词:各抽各的 ----------

def test_select_words_for_player_picks_from_own_learned():
    chosen = select_words_for_player({1, 2, 3, 4, 5}, word_count=3, rng=random)
    assert len(chosen) == 3
    assert set(chosen) <= {1, 2, 3, 4, 5}


def test_select_words_for_player_pads_from_fill_pool():
    # 自己背过的只有 2 个,要 4 个 → 用 fill_pool 补
    chosen = select_words_for_player({1, 2}, word_count=4, rng=random, fill_pool={1, 2, 3, 4, 5})
    assert len(chosen) == 4
    assert {1, 2} <= set(chosen)


# ---------- 各答各的:两人词表不同,互不干扰 ----------

def test_each_player_answers_own_words():
    room = _race_room({1: [10, 11], 2: [20, 21]})
    # 玩家1 答自己第 0 题(classify, word 10)
    p1 = room.players[1]
    assert p1.current_word_id == 10 and p1.current_phase == "classify"
    events = engine.submit_answer(room, 1, word_idx=0, phase="classify",
                                  payload={"category": "familiar"}, time_spent_ms=1000,
                                  word_lookup=room.word_lookup)
    # 只推进玩家1,玩家2 不受影响
    assert p1.current_word_idx == 1
    assert room.players[2].current_word_idx == 0
    # 事件里有发给玩家1 的下一题(定向)
    pushed = [e for e in events if e["type"] == "question_pushed"]
    assert pushed and pushed[0]["target_user_id"] == 1


def test_wrong_word_idx_rejected():
    room = _race_room({1: [10, 11]})
    # 提交的不是玩家当前题(游标在 0,却报 word_idx=5)→ 丢弃
    events = engine.submit_answer(room, 1, word_idx=5, phase="classify",
                                  payload={"category": "x"}, time_spent_ms=100,
                                  word_lookup=room.word_lookup)
    assert events == []
    assert room.players[1].current_word_idx == 0


# ---------- 答完循环续刷:游标不清零,取模回第一题 ----------

def test_finish_loops_back_and_keeps_scoring():
    room = _race_room({1: [10, 11]})  # 2 词 × 4 关 = 8 题一轮
    p = room.players[1]
    total_one_round = len(p.word_ids) * len(PHASES_IN_ORDER)
    # 连答 total_one_round 题(每次都用当前 phase),应循环回到第一题继续
    for _ in range(total_one_round):
        engine.submit_answer(room, 1, word_idx=p.current_word_idx, phase=p.current_phase,
                             payload={"category": "familiar"}, time_spent_ms=500,
                             word_lookup=room.word_lookup)
    assert p.current_word_idx == total_one_round      # 指针累计不清零
    assert p.current_word_id == 10                     # 取模回到第一题
    assert p.current_phase == "classify"
    assert len(p.answers) == total_one_round           # 流水累计


# ---------- 全场倒计时结算 ----------

def test_finalize_room_produces_ranking_and_is_idempotent():
    room = _race_room({1: [10, 11], 2: [20, 21]})
    room.players[1].points = 300
    room.players[2].points = 150
    events = engine.finalize_room(room)
    assert room.status == "finished"
    gf = [e for e in events if e["type"] == "game_finished"]
    assert gf
    ranking = gf[0]["ranking"]
    assert ranking[0]["user_id"] == 1 and ranking[0]["rank"] == 1  # 高分第一
    # 幂等:再调一次不再产出
    assert engine.finalize_room(room) == []


def test_finalize_empty_room_no_ranking():
    # 教师房全员离场 → finalize 不产出 game_finished(不落 0 人假对局)
    room = _race_room({1: [10, 11]})
    room.players.clear()
    events = engine.finalize_room(room)
    assert events == []
    assert room.status == "finished"


def test_submit_over_cap_ignored():
    # 防刷上限:答题数达 word_count*4*50 后不再接
    room = _race_room({1: [10, 11]})
    p = room.players[1]
    cap = len(p.word_ids) * 4 * 50
    p.answers = [object()] * cap  # 伪造已达上限
    events = engine.submit_answer(room, 1, word_idx=p.current_word_idx, phase=p.current_phase,
                                  payload={"category": "x"}, time_spent_ms=100,
                                  word_lookup=room.word_lookup)
    assert events == []


def test_submit_after_finished_ignored():
    room = _race_room({1: [10, 11]})
    engine.finalize_room(room)
    events = engine.submit_answer(room, 1, word_idx=0, phase="classify",
                                  payload={"category": "x"}, time_spent_ms=100,
                                  word_lookup=room.word_lookup)
    assert events == []
