import pytest
from app.services.pk import manager
from app.services.pk.state import RoomState


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


def test_create_room_returns_state_with_invite_code():
    room = manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1, 2, 3])
    assert isinstance(room, RoomState)
    assert room.host_id == 1
    assert room.status == "waiting"
    assert len(room.invite_code) == 6
    assert room.invite_code.isalnum()
    assert room.word_ids == [1, 2, 3]
    assert manager.INVITE_INDEX[room.invite_code] == room.room_id
    assert 1 in room.players


def test_create_room_blocks_user_already_in_room():
    manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1])
    with pytest.raises(manager.UserAlreadyInRoom):
        manager.create_room(host_id=1, unit_id=11, max_players=4, word_ids=[2])


def test_join_room_by_invite_code():
    room = manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1])
    joined = manager.join_room(invite_code=room.invite_code, user_id=2, nickname="Bob")
    assert joined.room_id == room.room_id
    assert 2 in joined.players
    assert joined.join_order == [1, 2]


def test_join_room_invalid_code_raises():
    with pytest.raises(manager.RoomNotFound):
        manager.join_room(invite_code="ZZZZZZ", user_id=2, nickname="Bob")


def test_join_room_full_raises():
    room = manager.create_room(host_id=1, unit_id=10, max_players=2, word_ids=[1])
    manager.join_room(invite_code=room.invite_code, user_id=2, nickname="B")
    with pytest.raises(manager.RoomFull):
        manager.join_room(invite_code=room.invite_code, user_id=3, nickname="C")


def test_join_room_already_started_raises():
    room = manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1])
    room.status = "playing"
    with pytest.raises(manager.RoomAlreadyStarted):
        manager.join_room(invite_code=room.invite_code, user_id=2, nickname="B")


def test_leave_room_transfers_host_when_host_leaves():
    room = manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1])
    manager.join_room(invite_code=room.invite_code, user_id=2, nickname="B")
    manager.join_room(invite_code=room.invite_code, user_id=3, nickname="C")
    manager.leave_room(room_id=room.room_id, user_id=1)
    assert 1 not in room.players
    assert room.host_id == 2  # 按 join_order 转移


def test_leave_room_abandons_when_empty():
    room = manager.create_room(host_id=1, unit_id=10, max_players=4, word_ids=[1])
    manager.leave_room(room_id=room.room_id, user_id=1)
    assert room.room_id not in manager.ROOMS
    assert room.invite_code not in manager.INVITE_INDEX
