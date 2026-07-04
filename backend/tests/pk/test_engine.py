import pytest
from datetime import datetime
from app.services.pk import manager, engine
from app.services.pk.state import PHASES_IN_ORDER


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
    def __init__(self, id, text="apple"):
        self.id = id
        self.word = text
        self.translation = "苹果"


@pytest.fixture
def word_lookup():
    return {1: FakeWord(1, "apple"), 2: FakeWord(2, "banana")}


def _start_two_player_room():
    room = manager.create_room(host_id=1, unit_id=10, max_players=2, word_ids=[1, 2])
    manager.join_room(invite_code=room.invite_code, user_id=2, nickname="Bob")
    room.status = "playing"
    room.started_at = datetime.utcnow()
    return room


def test_submit_answer_partial_no_settle(word_lookup):
    room = _start_two_player_room()
    events = engine.submit_answer(
        room, user_id=1, word_idx=0, phase="classify",
        payload={"category": "familiar"}, time_spent_ms=2000,
        word_lookup=word_lookup,
    )
    assert any(e["type"] == "player_answered" for e in events)
    assert all(e["type"] != "question_settled" for e in events)
    assert room.current_word_idx == 0  # 未推进


def test_submit_answer_full_triggers_settle(word_lookup):
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 2000, word_lookup)
    events = engine.submit_answer(room, 2, 0, "classify", {"category": "unknown"}, 3000, word_lookup)
    types = [e["type"] for e in events]
    assert "question_settled" in types
    assert "question_pushed" in types
    assert room.current_word_idx == 1


def test_phase_advances_when_all_words_done(word_lookup):
    room = _start_two_player_room()
    # 分类两个词都答完
    for word_idx in (0, 1):
        engine.submit_answer(room, 1, word_idx, "classify", {"category": "familiar"}, 1000, word_lookup)
        engine.submit_answer(room, 2, word_idx, "classify", {"category": "familiar"}, 1000, word_lookup)
    assert room.current_phase == "speech"
    assert room.current_word_idx == 2  # 进入 speech 第 1 个词


def test_game_finishes_after_last_phase_last_word(word_lookup):
    room = _start_two_player_room()
    total = len(PHASES_IN_ORDER) * len(room.word_ids)
    for global_idx in range(total):
        phase = PHASES_IN_ORDER[global_idx // len(room.word_ids)]
        # 所有 phase 都用各自合法的 payload
        payload = {
            "classify": {"category": "familiar"},
            "speech": {"result": "pass"},
            "dictation": {"text": "apple"},
            "exam": {"selected": 0, "correct": 0},
        }[phase]
        engine.submit_answer(room, 1, global_idx, phase, payload, 1000, word_lookup)
        events = engine.submit_answer(room, 2, global_idx, phase, payload, 1000, word_lookup)
    assert room.status == "finished"
    assert room.current_phase == "summary"
    assert any(e["type"] == "game_finished" for e in events)


def test_duplicate_submit_ignored(word_lookup):
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 2000, word_lookup)
    events = engine.submit_answer(room, 1, 0, "classify", {"category": "unknown"}, 9999, word_lookup)
    assert events == []  # 重复提交被丢弃
    assert room.players[1].correct == 1  # 维持原值


def test_force_timeout_records_wrong_for_unanswered(word_lookup):
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 2000, word_lookup)
    events = engine.force_timeout(room, word_idx=0, phase="classify", word_lookup=word_lookup)
    assert any(e["type"] == "question_settled" for e in events)
    assert room.players[2].wrong == 1
    assert room.current_word_idx == 1


# ---------- 新计分:得分 / 连击 / 实时榜单 ----------

def test_points_accumulate_with_speed_bonus(word_lookup):
    """答对得 基础分+手速加成;classify 超时 20s,用时 10s → +15%。"""
    room = _start_two_player_room()  # base_points 默认 100
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 10_000, word_lookup)
    assert room.players[1].points == 115
    assert room.players[1].streak == 1
    assert room.players[1].best_streak == 1


def test_wrong_answer_resets_streak_and_adds_no_points(word_lookup):
    room = _start_two_player_room()
    p1 = room.players[1]
    p1.streak = 3
    p1.best_streak = 3
    p1.points = 345
    # 无效分类会被判错:用它构造答错场景
    engine.submit_answer(room, 1, 0, "classify", {"category": "INVALID"}, 5000, word_lookup)
    assert p1.points == 345  # 没加分
    assert p1.streak == 0
    assert p1.best_streak == 3  # 最高连击保留


def test_timeout_resets_streak(word_lookup):
    room = _start_two_player_room()
    p2 = room.players[2]
    p2.streak = 2
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 2000, word_lookup)
    engine.force_timeout(room, word_idx=0, phase="classify", word_lookup=word_lookup)
    assert p2.streak == 0
    assert p2.points == 0


def test_live_ranking_event_broadcast_after_settle(word_lookup):
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 2000, word_lookup)
    events = engine.submit_answer(room, 2, 0, "classify", {"category": "unknown"}, 8000, word_lookup)
    lr = [e for e in events if e["type"] == "live_ranking"]
    assert len(lr) == 1
    ranking = lr[0]["ranking"]
    assert [r["user_id"] for r in ranking] == [1, 2]  # 用时短的先(同为答对)
    assert ranking[0]["rank"] == 1
    assert ranking[0]["points"] > ranking[1]["points"]  # 手速加成拉开分差
    assert {"nickname", "streak", "online", "correct"} <= set(ranking[0].keys())


def test_question_settled_carries_points_gained(word_lookup):
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 10_000, word_lookup)
    events = engine.submit_answer(room, 2, 0, "classify", {"category": "INVALID"}, 4000, word_lookup)
    settled = next(e for e in events if e["type"] == "question_settled")
    assert settled["results"]["1"]["points_gained"] == 115  # 答对:100 + 15% 手速
    assert settled["results"]["2"]["points_gained"] == 0    # 答错 0 分


def test_final_ranking_uses_points(word_lookup):
    """打满一局:全对但更快的玩家 points 更高,终局按 points 排名。"""
    room = _start_two_player_room()
    total = len(PHASES_IN_ORDER) * len(room.word_ids)
    for global_idx in range(total):
        phase = PHASES_IN_ORDER[global_idx // len(room.word_ids)]
        payload = {
            "classify": {"category": "familiar"},
            "speech": {"result": "pass"},
            "dictation": {"text": "apple" if room.current_word_id == 1 else "banana"},
            "exam": {"selected": 0, "correct": 0},
        }[phase]
        engine.submit_answer(room, 1, global_idx, phase, payload, 1000, word_lookup)
        events = engine.submit_answer(room, 2, global_idx, phase, payload, 5000, word_lookup)
    final = next(e for e in events if e["type"] == "game_finished")
    ranks = sorted(final["ranking"], key=lambda r: r["rank"])
    assert ranks[0]["user_id"] == 1  # 更快 → 手速加成多 → 第一
    assert ranks[0]["final_score"] == room.players[1].points
    assert ranks[0]["final_score"] > ranks[1]["final_score"]
    assert "best_streak" in ranks[0]


def test_per_word_points_used_when_set(word_lookup):
    """word_points 里配了的词按词计分(如高中词 150)。"""
    room = _start_two_player_room()
    room.word_points = {1: 150, 2: 100}
    # classify 超时 20s,用时 10s → 150 + 150*0.3*0.5 = 173(round)
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 10_000, word_lookup)
    assert room.players[1].points == 150 + round(150 * 0.3 * 0.5)


def test_question_pushed_carries_word_points(word_lookup):
    """推题事件带本题分值,前端展示「本题 X 分」。"""
    room = _start_two_player_room()
    room.word_points = {1: 100, 2: 150}
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 1000, word_lookup)
    events = engine.submit_answer(room, 2, 0, "classify", {"category": "familiar"}, 1000, word_lookup)
    push = next(e for e in events if e["type"] == "question_pushed")
    assert push["word"]["id"] == 2
    assert push["points"] == 150


def test_negative_time_spent_is_clamped(word_lookup):
    """恶意负用时:手速加成封顶 30%,总用时不允许倒扣。"""
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, -999_999, word_lookup)
    p1 = room.players[1]
    assert p1.points == 130          # clamp 到 0ms → 100 + 30%,不会更高
    assert p1.total_time_ms == 0     # 不允许为负


def test_oversized_time_spent_is_clamped_to_timeout(word_lookup):
    """超过阶段超时的用时按超时记:无手速加成,总用时只加 timeout。"""
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 999_999_999, word_lookup)
    p1 = room.players[1]
    assert p1.points == 100          # 无加成
    assert p1.total_time_ms == 20_000  # classify 超时 20s


def test_question_settled_carries_phase(word_lookup):
    """settled 事件带本题阶段,供调用方精确取消计时器。"""
    room = _start_two_player_room()
    engine.submit_answer(room, 1, 0, "classify", {"category": "familiar"}, 1000, word_lookup)
    events = engine.submit_answer(room, 2, 0, "classify", {"category": "familiar"}, 1000, word_lookup)
    settled = next(e for e in events if e["type"] == "question_settled")
    assert settled["phase"] == "classify"


def test_settled_phase_correct_at_phase_boundary(word_lookup):
    """阶段边界:最后一题结算时 settled.phase 仍是旧阶段(room.current_phase 已推进)。"""
    room = _start_two_player_room()
    for word_idx in (0, 1):
        engine.submit_answer(room, 1, word_idx, "classify", {"category": "familiar"}, 1000, word_lookup)
        events = engine.submit_answer(room, 2, word_idx, "classify", {"category": "familiar"}, 1000, word_lookup)
    settled = next(e for e in events if e["type"] == "question_settled")
    assert settled["phase"] == "classify"      # 被结算题的阶段
    assert room.current_phase == "speech"      # 房间已推进到新阶段
