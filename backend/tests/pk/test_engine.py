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
