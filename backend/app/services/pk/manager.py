"""PK 房间生命周期管理(单进程内存)。"""
from __future__ import annotations
import logging
import secrets
import string
from itertools import count
from app.services.pk.state import RoomState, PlayerState, SpectatorState

logger = logging.getLogger(__name__)

ROOMS: dict[int, RoomState] = {}
INVITE_INDEX: dict[str, int] = {}
USER_ACTIVE: dict[int, int] = {}
_id_seq = count(1)
_INVITE_ALPHABET = string.ascii_uppercase + string.digits

MAX_SPECTATORS = 30  # 每房观众上限


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


class SpectatorsFull(PkError):
    code = "SPECTATORS_FULL"


class NotHost(PkError):
    code = "NOT_HOST"


def _gen_invite_code() -> str:
    while True:
        code = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(6))
        if code not in INVITE_INDEX:
            return code


def _balance_team(room: RoomState) -> int:
    """分组赛给新成员选人数最少的队(均衡分队),并列时取队号最小的。"""
    counts = {t: 0 for t in range(1, room.team_count + 1)}
    for ps in room.players.values():
        if ps.team in counts:
            counts[ps.team] += 1
    return min(counts, key=lambda t: (counts[t], t))


def create_room(host_id: int, max_players: int, org_id: int,
                word_ids: list[int] | None = None,
                unit_id: int | None = None, nickname: str | None = None,
                word_count: int = 10,
                mode: str = "individual", team_count: int = 2,
                host_is_player: bool = True,
                countdown_seconds: int = 300) -> RoomState:
    """建房。word_ids 通常留空——开局时才从「所有人都背过」的交集里随机抽 word_count 个。
    org_id 必填(房主机构):不给默认值,忘传直接报错,防止房间静默归错机构。

    host_is_player=False:房主(教师)只组织不下场,不进 players、不参与结算/计分。
    mode="team":分组赛,入房自动均衡分队;个人赛(默认)沿用原逻辑。
    """
    if host_id in USER_ACTIVE:
        raise UserAlreadyInRoom()
    room_id = next(_id_seq)
    code = _gen_invite_code()
    room = RoomState(
        room_id=room_id,
        invite_code=code,
        host_id=host_id,
        org_id=org_id,
        unit_id=unit_id,
        max_players=max_players,
        status="waiting",
        word_ids=list(word_ids or []),
        word_count=word_count,
        mode="team" if mode == "team" else "individual",
        team_count=max(2, int(team_count)) if mode == "team" else 2,
        host_is_player=host_is_player,
        countdown_seconds=max(60, min(int(countdown_seconds), 1800)),
    )
    if host_is_player:
        # 房主下场:作为首个玩家入房(学生自建房 / 晋级赛)
        hp = PlayerState(user_id=host_id, nickname=nickname or f"User{host_id}")
        if room.mode == "team":
            hp.team = _balance_team(room)
        room.players[host_id] = hp
        room.join_order.append(host_id)
    # host_id 无论下不下场都占 USER_ACTIVE,防同一人重复建房
    USER_ACTIVE[host_id] = room_id
    ROOMS[room_id] = room
    INVITE_INDEX[code] = room_id
    logger.info(
        "PK room created: room_id=%d host_id=%d host_is_player=%s mode=%s "
        "team_count=%d max_players=%d word_count=%d",
        room_id, host_id, host_is_player, room.mode, room.team_count,
        max_players, word_count,
    )
    return room


def get_room_by_code(invite_code: str, org_id: int) -> RoomState:
    """按邀请码取房间,统一裁决跨机构可见性:不同机构一律 RoomNotFound,
    不泄露房间存在性。路由层不要直接摸 ROOMS/INVITE_INDEX。"""
    room_id = INVITE_INDEX.get(invite_code)
    if room_id is None:
        raise RoomNotFound()
    room = ROOMS[room_id]
    if room.org_id != org_id:
        raise RoomNotFound()
    return room


def join_room(invite_code: str, user_id: int, nickname: str, org_id: int) -> RoomState:
    if user_id in USER_ACTIVE:
        raise UserAlreadyInRoom()
    room = get_room_by_code(invite_code, org_id)
    if room.status != "waiting":
        raise RoomAlreadyStarted()
    if len(room.players) >= room.max_players:
        raise RoomFull()
    ps = PlayerState(user_id=user_id, nickname=nickname)
    if room.mode == "team":
        ps.team = _balance_team(room)
    room.players[user_id] = ps
    room.join_order.append(user_id)
    USER_ACTIVE[user_id] = room.room_id
    logger.info(
        "PK player joined: room_id=%d user_id=%d team=%s",
        room.room_id, user_id, ps.team,
    )
    return room


def set_player_team(room_id: int, user_id: int, team: int) -> RoomState | None:
    """教师在等待室手动调整某玩家所在队(仅分组赛、仅开局前)。"""
    room = ROOMS.get(room_id)
    if room is None or room.mode != "team" or room.status != "waiting":
        return None
    ps = room.players.get(user_id)
    if ps is None:
        return None
    ps.team = max(1, min(int(team), room.team_count))
    return room


def close_room(room_id: int) -> RoomState | None:
    """房主(教师)主动解散房间:释放所有玩家的 USER_ACTIVE 并清索引。返回被关闭的房间。"""
    room = ROOMS.get(room_id)
    if room is None:
        return None
    for uid in list(room.players.keys()):
        USER_ACTIVE.pop(uid, None)
    USER_ACTIVE.pop(room.host_id, None)
    INVITE_INDEX.pop(room.invite_code, None)
    ROOMS.pop(room_id, None)
    room.status = "abandoned"
    logger.info("PK room closed by host: room_id=%d", room_id)
    return room


def spectate_room(invite_code: str, user_id: int, nickname: str, org_id: int) -> RoomState:
    """以观众身份进房:等待中/对局中都可以,不占玩家名额。

    观众不进 USER_ACTIVE(旁观是轻量行为,不阻止其另开房间);
    自己已是该房玩家时原样返回(按玩家身份连 WS 即可)。
    """
    room = get_room_by_code(invite_code, org_id)
    if user_id in room.players:
        return room  # 本来就是玩家,无需观战
    if user_id in room.spectators:
        room.spectators[user_id].nickname = nickname
        return room  # 重复观战幂等
    if len(room.spectators) >= MAX_SPECTATORS:
        raise SpectatorsFull()
    room.spectators[user_id] = SpectatorState(user_id=user_id, nickname=nickname)
    logger.info("PK spectator joined: room_id=%d user_id=%d", room.room_id, user_id)
    return room


def leave_spectator(room_id: int, user_id: int) -> None:
    room = ROOMS.get(room_id)
    if room is None:
        return
    if room.spectators.pop(user_id, None) is not None:
        logger.info("PK spectator left: room_id=%d user_id=%d", room_id, user_id)


def leave_room(room_id: int, user_id: int) -> None:
    room = ROOMS.get(room_id)
    if room is None:
        return
    room.players.pop(user_id, None)
    if user_id in room.join_order:
        room.join_order.remove(user_id)
    USER_ACTIVE.pop(user_id, None)
    if not room.players:
        # 教师组织的房(房主不下场):最后一名学生退出不解散,教师仍掌控房间生命周期
        # (由 close_room 或教师控制台断开时决定),否则空等待室会被自动清掉。
        if not room.host_is_player:
            logger.info(
                "PK player left teacher room, kept alive empty: room_id=%d user_id=%d",
                room_id, user_id,
            )
            return
        _abandon_room(room)
        logger.info(
            "PK player left: room_id=%d user_id=%d abandoned=True",
            room_id, user_id,
        )
        return
    # 房主转移只在"房主下场"的房里发生;教师房 host 不在 players,永不触发
    if room.host_is_player and room.host_id == user_id and room.join_order:
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
    # 房主不下场时,其 USER_ACTIVE 不在 players 清理链里,单独释放
    if not room.host_is_player:
        USER_ACTIVE.pop(room.host_id, None)


def get_room(room_id: int) -> RoomState | None:
    return ROOMS.get(room_id)


def assert_host(room: RoomState, user_id: int) -> None:
    if room.host_id != user_id:
        raise NotHost()
