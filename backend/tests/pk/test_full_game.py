"""End-to-end PK game flow: two players walk through all 4 phases."""
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


def _drain_until(ws, target_type, max_messages=50):
    """Receive messages until one matches target_type. Raises after max_messages
    to prevent infinite loops on protocol bugs."""
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg.get("type") == target_type:
            return msg
    raise RuntimeError(f"Did not receive {target_type} within {max_messages} messages")


class _FakeWord:
    def __init__(self, id_: int, word: str = "apple", translation: str = "苹果"):
        self.id = id_
        self.word = word
        self.translation = translation


@pytest.mark.asyncio
async def test_full_two_player_game_emits_game_finished(two_student_tokens):
    """Two players play a 1-word PK to completion (4 questions, one per phase).
    Verifies the WS event protocol and engine state machine end-to-end.
    Persistence is covered separately in test_persist.py.
    """
    token1, token2, host_id, joiner_id = two_student_tokens

    word_id = 9001  # synthetic; backend resolves via patched _word_lookup_for_room
    room = manager.create_room(
        host_id=host_id,
        unit_id=999,  # synthetic; not validated by WS path
        max_players=2,
        word_ids=[word_id],
    )
    manager.join_room(invite_code=room.invite_code, user_id=joiner_id, nickname=f"User{joiner_id}")

    fake_user1 = User(
        id=host_id, username="stu_pk_1", email="stu_pk_1_e2e@example.com",
        hashed_password="x", role="student", is_active=True,
    )
    fake_user2 = User(
        id=joiner_id, username="stu_pk_2", email="stu_pk_2_e2e@example.com",
        hashed_password="x", role="student", is_active=True,
    )
    fake_users = {token1: fake_user1, token2: fake_user2}

    async def fake_auth(t):
        return fake_users.get(t)

    async def fake_word_lookup(db, word_ids):
        return {wid: _FakeWord(wid) for wid in word_ids}

    persist_calls = []

    async def fake_persist(room, db):
        persist_calls.append(room.room_id)
        return room.room_id

    original_auth = pk_websocket._authenticate
    original_lookup = pk_websocket._word_lookup_for_room
    original_persist = pk_websocket.persist_finished_room
    pk_websocket._authenticate = fake_auth
    pk_websocket._word_lookup_for_room = fake_word_lookup
    pk_websocket.persist_finished_room = fake_persist

    try:
        with TestClient(app) as tc:
            with tc.websocket_connect(
                f"/api/v1/pk/ws?token={token1}&room_id={room.room_id}"
            ) as ws1:
                msg1 = ws1.receive_json()
                assert msg1["type"] == "room_state"

                with tc.websocket_connect(
                    f"/api/v1/pk/ws?token={token2}&room_id={room.room_id}"
                ) as ws2:
                    msg2 = ws2.receive_json()
                    assert msg2["type"] == "room_state"
                    _drain_until(ws1, "player_reconnected")

                    ws1.send_json({"type": "start_game"})
                    _drain_until(ws1, "question_pushed")
                    _drain_until(ws2, "question_pushed")

                    payloads_per_phase = [
                        ("classify", {"category": "familiar"}),
                        ("speech", {"result": "pass"}),
                        ("dictation", {"text": "apple"}),
                        ("exam", {"selected": 0, "correct": 0}),
                    ]
                    for global_idx, (phase, payload) in enumerate(payloads_per_phase):
                        ws1.send_json({
                            "type": "submit_answer",
                            "word_idx": global_idx,
                            "phase": phase,
                            "payload": payload,
                            "time_spent_ms": 1000,
                        })
                        ws2.send_json({
                            "type": "submit_answer",
                            "word_idx": global_idx,
                            "phase": phase,
                            "payload": payload,
                            "time_spent_ms": 1500,
                        })
                        _drain_until(ws1, "question_settled")
                        _drain_until(ws2, "question_settled")

                    final1 = _drain_until(ws1, "game_finished")
                    final2 = _drain_until(ws2, "game_finished")

        assert len(final1["ranking"]) == 2
        ranks = sorted(final1["ranking"], key=lambda r: r["rank"])
        assert ranks[0]["rank"] == 1
        assert ranks[1]["rank"] == 2
        # Player 1 was 500ms faster per question, so user1 (host_id) ranks 1
        assert ranks[0]["user_id"] == host_id
        assert ranks[1]["user_id"] == joiner_id

        assert len(persist_calls) == 1
        assert persist_calls[0] == room.room_id

        assert final2["ranking"] == final1["ranking"]

    finally:
        pk_websocket._authenticate = original_auth
        pk_websocket._word_lookup_for_room = original_lookup
        pk_websocket.persist_finished_room = original_persist
