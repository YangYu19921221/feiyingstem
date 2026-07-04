"""Real end-to-end PK test: HTTP create + HTTP join + dual WebSocket + complete game.

Unlike test_full_game.py (which bypasses the REST join flow by calling manager.join_room
directly), this test uses the actual production REST endpoints to create and join the
room. This catches integration bugs where the REST→manager→WS chain is broken (e.g., C1
where join_room was never wired up to a REST endpoint).

WS-side DB hooks are still patched because the WS handler uses AsyncSessionLocal (production DB)
rather than the test's in-memory db_session — that mismatch is structural, not a workaround.
"""
import pytest
from starlette.testclient import TestClient
from app.main import app
from app.services.pk import manager
from app.api.v1 import pk_websocket
from app.models.user import User


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


def _drain_until(ws, target_type, max_messages=80):
    """Drain ws messages until target_type is received; return that message."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg.get("type") == target_type:
            return msg
    raise RuntimeError(f"Did not receive {target_type} within {max_messages} messages")


def _drain_until_any(ws, target_types, max_messages=80):
    """Drain until any of target_types is received."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg.get("type") in target_types:
            return msg
    raise RuntimeError(f"Did not receive any of {target_types} within {max_messages} messages")


class _FakeWord:
    def __init__(self, id_: int, word: str = "apple", translation: str = "苹果"):
        self.id = id_
        self.word = word
        self.translation = translation


# Payloads guaranteed to satisfy each phase adapter's judge().
_PHASE_PAYLOADS = {
    "classify": {"category": "familiar"},
    "speech": {"result": "pass"},
    "dictation": {"text": "apple"},
    "exam": {"selected": 0, "correct": 0},
}


@pytest.mark.asyncio
async def test_real_e2e_http_create_join_then_full_game(
    client, two_student_tokens, sample_unit_with_words,
):
    """Drives the COMPLETE PK flow through real HTTP endpoints + dual WS:
    create → join (the C1 path!) → both WS connect → start_game → all phases → game_finished.
    Verifies the full integration without bypassing any production code path.
    """
    token1, token2, host_id, joiner_id = two_student_tokens
    unit, word_ids = sample_unit_with_words
    n_words = len(word_ids)
    n_phases = 4
    total_questions = n_words * n_phases

    # === REAL HTTP: host creates the room ===
    create_resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"max_players": 2, "word_count": 10},
    )
    assert create_resp.status_code == 200, create_resp.text
    create_body = create_resp.json()
    room_id = create_body["room_id"]
    invite_code = create_body["invite_code"]

    # === REAL HTTP: joiner joins via the C1 endpoint ===
    join_resp = await client.post(
        f"/api/v1/pk/rooms/by-code/{invite_code}/join",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert join_resp.status_code == 200, join_resp.text
    snapshot = join_resp.json()
    assert snapshot["status"] == "waiting"
    assert len(snapshot["players"]) == 2
    assert {p["user_id"] for p in snapshot["players"]} == {host_id, joiner_id}

    # === Sanity: room is now in manager.ROOMS with both players ===
    room_state = manager.get_room(room_id)
    assert room_state is not None
    assert host_id in room_state.players
    assert joiner_id in room_state.players  # ← THIS would fail before C1 fix
    assert room_state.word_ids == []  # 词在开局时才抽

    # === Patch WS-side DB hooks (structural; same as test_full_game.py) ===
    fake_user1 = User(
        id=host_id, username="h_e2e_real", email="h_e2e_real@example.com",
        hashed_password="x", role="student", is_active=True,
    )
    fake_user2 = User(
        id=joiner_id, username="j_e2e_real", email="j_e2e_real@example.com",
        hashed_password="x", role="student", is_active=True,
    )
    fake_users = {token1: fake_user1, token2: fake_user2}

    async def fake_auth(t):
        return fake_users.get(t)

    async def fake_word_lookup(db, ids):
        return {wid: _FakeWord(wid) for wid in ids}

    async def fake_learned(user_ids, ids=None):
        # 所有玩家背过 fixture 里的全部词 → 交集 = 全部 4 个
        return {uid: set(word_ids) for uid in user_ids}

    async def fake_word_points(ids):
        return {wid: 100 for wid in ids}

    persist_calls = []

    async def fake_persist(room, db):
        persist_calls.append(room.room_id)
        return room.room_id

    original_auth = pk_websocket._authenticate
    original_lookup = pk_websocket._word_lookup_for_room
    original_persist = pk_websocket.persist_finished_room
    original_learned = pk_websocket._load_learned_for_room
    original_points = pk_websocket._load_word_points_for_room
    pk_websocket._authenticate = fake_auth
    pk_websocket._word_lookup_for_room = fake_word_lookup
    pk_websocket.persist_finished_room = fake_persist
    pk_websocket._load_learned_for_room = fake_learned
    pk_websocket._load_word_points_for_room = fake_word_points

    try:
        with TestClient(app) as tc:
            with tc.websocket_connect(
                f"/api/v1/pk/ws?token={token1}&room_id={room_id}"
            ) as ws1:
                msg1 = ws1.receive_json()
                assert msg1["type"] == "room_state"

                with tc.websocket_connect(
                    f"/api/v1/pk/ws?token={token2}&room_id={room_id}"
                ) as ws2:
                    msg2 = ws2.receive_json()
                    assert msg2["type"] == "room_state"
                    _drain_until(ws1, "player_reconnected")

                    # Host starts the game
                    ws1.send_json({"type": "start_game"})
                    first_q1 = _drain_until(ws1, "question_pushed")
                    first_q2 = _drain_until(ws2, "question_pushed")
                    assert first_q1["word_idx"] == 0
                    assert first_q1["phase"] == "classify"
                    assert first_q2["word_idx"] == 0

                    # Walk through all (n_words * n_phases) questions.
                    # word_idx is global across all phases: 0..n_words-1=classify,
                    # n_words..2n_words-1=speech, etc.
                    current_phase = first_q1["phase"]
                    current_word_idx = first_q1["word_idx"]
                    for q in range(total_questions):
                        payload = _PHASE_PAYLOADS[current_phase]
                        ws1.send_json({
                            "type": "submit_answer",
                            "word_idx": current_word_idx, "phase": current_phase,
                            "payload": payload, "time_spent_ms": 1000,
                        })
                        ws2.send_json({
                            "type": "submit_answer",
                            "word_idx": current_word_idx, "phase": current_phase,
                            "payload": payload, "time_spent_ms": 1500,
                        })
                        _drain_until(ws1, "question_settled")
                        _drain_until(ws2, "question_settled")

                        if q < total_questions - 1:
                            # Next question pushed; read it on both sockets.
                            next_q1 = _drain_until_any(
                                ws1, {"question_pushed", "phase_advanced"}
                            )
                            if next_q1.get("type") == "phase_advanced":
                                next_q1 = _drain_until(ws1, "question_pushed")
                            _drain_until_any(ws2, {"question_pushed"})
                            current_phase = next_q1["phase"]
                            current_word_idx = next_q1["word_idx"]

                    final1 = _drain_until(ws1, "game_finished")
                    final2 = _drain_until(ws2, "game_finished")

        # Verify ranking shape end-to-end
        assert len(final1["ranking"]) == 2
        ranks = sorted(final1["ranking"], key=lambda r: r["rank"])
        assert ranks[0]["rank"] == 1
        assert ranks[1]["rank"] == 2
        assert ranks[0]["user_id"] == host_id  # faster player (1000ms vs 1500ms)
        assert ranks[1]["user_id"] == joiner_id

        # Verify persist invoked once for this room
        assert len(persist_calls) == 1
        assert persist_calls[0] == room_id

        # Both sockets see same final result
        assert final2["ranking"] == final1["ranking"]
    finally:
        pk_websocket._authenticate = original_auth
        pk_websocket._word_lookup_for_room = original_lookup
        pk_websocket.persist_finished_room = original_persist
        pk_websocket._load_learned_for_room = original_learned
        pk_websocket._load_word_points_for_room = original_points
