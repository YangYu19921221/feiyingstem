import pytest
from app.services.pk import manager


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


def test_ws_rejects_invalid_token():
    """Bad token: WS handshake closes with code 1008."""
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect
    from app.main import app

    with TestClient(app) as tc:
        with pytest.raises(WebSocketDisconnect):
            with tc.websocket_connect("/api/v1/pk/ws?token=BAD&room_id=1") as ws:
                ws.receive_json()


@pytest.mark.asyncio
async def test_ws_join_then_receive_room_state(client, auth_student_token, sample_unit_with_words):
    """Player connects with valid token + valid room → receives room_state snapshot."""
    from starlette.testclient import TestClient
    from app.main import app
    from app.api.v1 import pk_websocket
    from app.models.user import User

    token, user_id = auth_student_token
    unit, word_ids = sample_unit_with_words

    # Pre-create the room directly via manager (skipping REST), since the WS
    # handler's AsyncSessionLocal does not share the test in-memory db_session.
    room = manager.create_room(
        host_id=user_id, unit_id=unit.id,
        max_players=4, word_ids=word_ids,
    )

    # Patch _authenticate to bypass DB-roundtrip auth (the WS handler creates
    # its own session that's NOT the test in-memory one). Return synthetic User.
    fake_user = User(id=user_id, username="stu_pk_1", email="stu_pk_1@example.com",
                     hashed_password="x", role="student", is_active=True)

    async def fake_auth(t):
        return fake_user if t == token else None

    async def fake_word_lookup(db, word_ids):
        return {}

    original_auth = pk_websocket._authenticate
    original_lookup = pk_websocket._word_lookup_for_room
    pk_websocket._authenticate = fake_auth
    pk_websocket._word_lookup_for_room = fake_word_lookup
    try:
        with TestClient(app) as tc:
            with tc.websocket_connect(
                f"/api/v1/pk/ws?token={token}&room_id={room.room_id}"
            ) as ws:
                msg = ws.receive_json()
                assert msg["type"] == "room_state"
                assert msg["room"]["room_id"] == room.room_id
                assert msg["room"]["host_id"] == user_id
                assert msg["room"]["total_words"] == len(word_ids)
    finally:
        pk_websocket._authenticate = original_auth
        pk_websocket._word_lookup_for_room = original_lookup
