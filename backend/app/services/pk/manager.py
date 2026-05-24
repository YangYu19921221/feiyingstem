"""PK 房间生命周期管理(单进程内存)。"""
from __future__ import annotations
import logging
import secrets
import string
from itertools import count
from app.services.pk.state import RoomState, PlayerState

logger = logging.getLogger(__name__)

ROOMS: dict[int, RoomState] = {}
INVITE_INDEX: dict[str, int] = {}
USER_ACTIVE: dict[int, int] = {}
_id_seq = count(1)
_INVITE_ALPHABET = string.ascii_uppercase + string.digits


class PkError(Exception):
    code: str = "PK_ERROR"


class UserAlreadyInRoom(PkError):
    code = "USER_ALREADY_IN_ROOM"


class RoomNotFound(PkError):
    code = "ROOM_NOT_FOUND"


class RoomFull(PkError):
    code = "ROOM_FULL"


class RoomAlreadyStarted(PkError):
    code = "ROOM_ALREADY_STARTED"


class NotHost(PkError):
    code = "NOT_HOST"


def _gen_invite_code() -> str:
    while True:
        code = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(6))
        if code not in INVITE_INDEX:
            return code


def create_room(host_id: int, unit_id: int, max_players: int, word_ids: list[int],
                nickname: str | None = None) -> RoomState:
    if host_id in USER_ACTIVE:
        raise UserAlreadyInRoom()
    room_id = next(_id_seq)
    code = _gen_invite_code()
    room = RoomState(
        room_id=room_id,
        invite_code=code,
        host_id=host_id,
        unit_id=unit_id,
        max_players=max_players,
        status="waiting",
        word_ids=list(word_ids),
    )
    room.players[host_id] = PlayerState(
        user_id=host_id,
        nickname=nickname or f"User{host_id}",
    )
    room.join_order.append(host_id)
    ROOMS[room_id] = room
    INVITE_INDEX[code] = room_id
    USER_ACTIVE[host_id] = room_id
    logger.info(
        "PK room created: room_id=%d host_id=%d unit_id=%d max_players=%d",
        room_id, host_id, unit_id, max_players,
    )
    return room


def join_room(invite_code: str, user_id: int, nickname: str) -> RoomState:
    if user_id in USER_ACTIVE:
        raise UserAlreadyInRoom()
    room_id = INVITE_INDEX.get(invite_code)
    if room_id is None:
        raise RoomNotFound()
    room = ROOMS[room_id]
    if room.status != "waiting":
        raise RoomAlreadyStarted()
    if len(room.players) >= room.max_players:
        raise RoomFull()
    room.players[user_id] = PlayerState(user_id=user_id, nickname=nickname)
    room.join_order.append(user_id)
    USER_ACTIVE[user_id] = room_id
    logger.info("PK player joined: room_id=%d user_id=%d", room_id, user_id)
    return room


def leave_room(room_id: int, user_id: int) -> None:
    room = ROOMS.get(room_id)
    if room is None:
        return
    room.players.pop(user_id, None)
    if user_id in room.join_order:
        room.join_order.remove(user_id)
    USER_ACTIVE.pop(user_id, None)
    if not room.players:
        _abandon_room(room)
        logger.info(
            "PK player left: room_id=%d user_id=%d abandoned=True",
            room_id, user_id,
        )
        return
    if room.host_id == user_id and room.join_order:
        old = room.host_id
        room.host_id = room.join_order[0]
        logger.info(
            "PK host transferred: room_id=%d old_host=%d new_host=%d",
            room_id, old, room.host_id,
        )
    logger.info(
        "PK player left: room_id=%d user_id=%d abandoned=False",
        room_id, user_id,
    )


def _abandon_room(room: RoomState) -> None:
    room.status = "abandoned"
    INVITE_INDEX.pop(room.invite_code, None)
    ROOMS.pop(room.room_id, None)


def get_room(room_id: int) -> RoomState | None:
    return ROOMS.get(room_id)


def assert_host(room: RoomState, user_id: int) -> None:
    if room.host_id != user_id:
        raise NotHost()
