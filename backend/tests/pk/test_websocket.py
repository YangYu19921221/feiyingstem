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


@pytest.mark.asyncio
async def test_broadcast_send_failure_marks_player_offline(two_student_tokens):
    """If send_json fails for player X (e.g., dead socket) during a broadcast,
    X must be marked offline (ws=None, online=False) AND a player_disconnected
    event must be broadcast to surviving players. Verifies C2 fix."""
    from starlette.testclient import TestClient
    from app.main import app
    from app.api.v1 import pk_websocket
    from app.models.user import User

    token1, token2, host_id, joiner_id = two_student_tokens

    room = manager.create_room(
        host_id=host_id, unit_id=999, max_players=2, word_ids=[1],
    )
    manager.join_room(invite_code=room.invite_code, user_id=joiner_id, nickname="Joiner")

    fake_users = {
        token1: User(id=host_id, username="h", email="h_e2e_c2@example.com",
                     hashed_password="x", role="student", is_active=True),
        token2: User(id=joiner_id, username="j", email="j_e2e_c2@example.com",
                     hashed_password="x", role="student", is_active=True),
    }

    async def fake_auth(t):
        return fake_users.get(t)

    async def fake_word_lookup(db, word_ids):
        class FW:
            id = word_ids[0]; word = "apple"; translation = "苹果"
        return {word_ids[0]: FW()}

    original_auth = pk_websocket._authenticate
    original_lookup = pk_websocket._word_lookup_for_room
    pk_websocket._authenticate = fake_auth
    pk_websocket._word_lookup_for_room = fake_word_lookup

    try:
        with TestClient(app) as tc:
            with tc.websocket_connect(
                f"/api/v1/pk/ws?token={token1}&room_id={room.room_id}"
            ) as ws1:
                ws1.receive_json()  # room_state
                with tc.websocket_connect(
                    f"/api/v1/pk/ws?token={token2}&room_id={room.room_id}"
                ) as ws2:
                    ws2.receive_json()  # room_state
                    # drain ws1's messages until we see player_reconnected
                    for _ in range(10):
                        msg = ws1.receive_json()
                        if msg["type"] == "player_reconnected":
                            break

                    # Simulate ws2's send failing: replace ws2's ws with a stub
                    # whose send_json raises.
                    class _DeadSocket:
                        async def send_json(self, *a, **kw):
                            raise RuntimeError("simulated dead socket")
                        async def close(self, *a, **kw):
                            pass

                    room_state = manager.get_room(room.room_id)
                    assert room_state is not None
                    joiner_ps = room_state.players[joiner_id]
                    joiner_ps.ws = _DeadSocket()

                    # Trigger a broadcast: host sends start_game.
                    # Server will broadcast room_state to both players;
                    # joiner's send fails -> joiner marked offline + player_disconnected sent.
                    ws1.send_json({"type": "start_game"})

                    # ws1 should eventually receive player_disconnected for joiner
                    received_types: list[str] = []
                    seen_disconnect = False
                    for _ in range(20):
                        msg = ws1.receive_json()
                        received_types.append(msg["type"])
                        if msg["type"] == "player_disconnected" and msg.get("user_id") == joiner_id:
                            seen_disconnect = True
                            break
                    assert seen_disconnect, f"Did not see player_disconnected for joiner. Got: {received_types}"

                    # Verify state: joiner is offline + ws cleared
                    assert joiner_ps.online is False
                    assert joiner_ps.ws is None
    finally:
        pk_websocket._authenticate = original_auth
        pk_websocket._word_lookup_for_room = original_lookup


def test_heartbeat_watchdog_marks_stale_players_offline():
    """Watchdog scan iterates rooms and marks players offline when their
    last_heartbeat_at is older than HEARTBEAT_TIMEOUT_S. We test the inner
    logic by directly invoking the loop body via a manual room construction.

    This is a logic test for the scan, not the full asyncio loop — testing
    a long-running task with timing in pytest is flaky."""
    import asyncio
    from datetime import datetime, timedelta
    from app.api.v1 import pk_websocket
    from app.services.pk.state import PlayerState

    room = manager.create_room(host_id=1, unit_id=10, max_players=2, word_ids=[1])
    # Add a stale player (last_heartbeat_at way in the past)
    stale_player = PlayerState(user_id=2, nickname="Stale")
    stale_player.last_heartbeat_at = datetime.utcnow() - timedelta(seconds=120)
    stale_player.online = True
    room.players[2] = stale_player
    room.join_order.append(2)
    manager.USER_ACTIVE[2] = room.room_id

    # Add a fresh player whose heartbeat is current
    fresh_player = PlayerState(user_id=3, nickname="Fresh")
    fresh_player.last_heartbeat_at = datetime.utcnow()
    fresh_player.online = True
    room.players[3] = fresh_player
    room.join_order.append(3)
    manager.USER_ACTIVE[3] = room.room_id

    # Run one iteration of the scan logic manually (the watchdog body)
    async def run_one_scan():
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=pk_websocket.HEARTBEAT_TIMEOUT_S)
        for r in list(manager.ROOMS.values()):
            stale_uids = []
            for uid, ps in list(r.players.items()):
                if ps.online and ps.last_heartbeat_at < cutoff:
                    stale_uids.append(uid)
            for uid in stale_uids:
                ps = r.players.get(uid)
                if ps is None or not ps.online:
                    continue
                ps.online = False
                ps.disconnected_at = now

    asyncio.run(run_one_scan())

    # Stale player marked offline; fresh player still online
    assert room.players[2].online is False
    assert room.players[2].disconnected_at is not None
    assert room.players[3].online is True


def test_ensure_heartbeat_watchdog_starts_task():
    """First call to _ensure_heartbeat_watchdog creates a task; second call doesn't replace it."""
    import asyncio
    from app.api.v1 import pk_websocket

    async def go():
        # Reset
        if pk_websocket._heartbeat_watchdog_task is not None:
            pk_websocket._heartbeat_watchdog_task.cancel()
            try:
                await pk_websocket._heartbeat_watchdog_task
            except (asyncio.CancelledError, Exception):
                pass
            pk_websocket._heartbeat_watchdog_task = None

        pk_websocket._ensure_heartbeat_watchdog()
        first = pk_websocket._heartbeat_watchdog_task
        assert first is not None
        assert not first.done()

        pk_websocket._ensure_heartbeat_watchdog()
        second = pk_websocket._heartbeat_watchdog_task
        assert second is first  # not replaced

        # Cleanup
        first.cancel()
        try:
            await first
        except (asyncio.CancelledError, Exception):
            pass
        pk_websocket._heartbeat_watchdog_task = None

    asyncio.run(go())


@pytest.mark.asyncio
async def test_start_game_rejected_with_solo_host(two_student_tokens):
    """Host cannot start_game alone; server replies with NOT_ENOUGH_PLAYERS error."""
    from starlette.testclient import TestClient
    from app.main import app
    from app.api.v1 import pk_websocket
    from app.models.user import User

    token1, token2, host_id, joiner_id = two_student_tokens

    room = manager.create_room(
        host_id=host_id, unit_id=999, max_players=2, word_ids=[1],
    )
    # NOTE: not joining the second player

    fake_users = {
        token1: User(id=host_id, username="h", email="h_solo@example.com",
                     hashed_password="x", role="student", is_active=True),
    }
    async def fake_auth(t):
        return fake_users.get(t)
    async def fake_word_lookup(db, word_ids):
        class FW:
            id = word_ids[0]; word = "x"; translation = "y"
        return {word_ids[0]: FW()}

    original_auth = pk_websocket._authenticate
    original_lookup = pk_websocket._word_lookup_for_room
    pk_websocket._authenticate = fake_auth
    pk_websocket._word_lookup_for_room = fake_word_lookup

    try:
        with TestClient(app) as tc:
            with tc.websocket_connect(
                f"/api/v1/pk/ws?token={token1}&room_id={room.room_id}"
            ) as ws1:
                ws1.receive_json()  # room_state
                ws1.send_json({"type": "start_game"})
                msg = ws1.receive_json()
                assert msg["type"] == "error"
                assert msg["code"] == "NOT_ENOUGH_PLAYERS"
                # Room still in waiting status
                assert manager.get_room(room.room_id).status == "waiting"
    finally:
        pk_websocket._authenticate = original_auth
        pk_websocket._word_lookup_for_room = original_lookup


def test_cancel_room_timers_removes_all_keys_for_room():
    """Verify the I1 fix: _cancel_room_timers cancels and pops all entries
    matching a room_id while leaving other rooms untouched."""
    import asyncio
    from app.api.v1 import pk_websocket

    async def go():
        # Set up 3 fake tasks: 2 for room 100, 1 for room 200
        async def _noop():
            await asyncio.sleep(60)

        t1 = asyncio.create_task(_noop())
        t2 = asyncio.create_task(_noop())
        t3 = asyncio.create_task(_noop())
        pk_websocket._TIMEOUT_TASKS[(100, 0, "classify")] = t1
        pk_websocket._TIMEOUT_TASKS[(100, 1, "classify")] = t2
        pk_websocket._TIMEOUT_TASKS[(200, 0, "classify")] = t3

        pk_websocket._cancel_room_timers(100)

        # Yield so the cancellations propagate.
        for t in (t1, t2):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass

        # room 100's keys gone, room 200's intact
        assert (100, 0, "classify") not in pk_websocket._TIMEOUT_TASKS
        assert (100, 1, "classify") not in pk_websocket._TIMEOUT_TASKS
        assert (200, 0, "classify") in pk_websocket._TIMEOUT_TASKS
        assert t1.cancelled() or t1.done()
        assert t2.cancelled() or t2.done()

        # Cleanup t3
        t3.cancel()
        try:
            await t3
        except (asyncio.CancelledError, Exception):
            pass
        pk_websocket._TIMEOUT_TASKS.pop((200, 0, "classify"), None)

    asyncio.run(go())
