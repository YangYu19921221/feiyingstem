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


MAX_TEAMS = 8          # 每房最多分几组(再多队伍榜/柱状图就挤不下了)
MAX_TEAM_NAME_LEN = 12  # 组名长度上限(榜单一行放得下;过长会把名次和分数挤出屏幕)


def normalize_team_names(names: list[str] | None) -> dict[int, str]:
    """建房时把教师填的组名整理成 {组号: 组名}。组号从 1 连续编号。

    空名按「第N组」兜底(教师只想快速开两组、不想起名的常见情形);
    去掉纯空白项;超过 MAX_TEAMS 截断。分组赛至少两组,不足则补齐到两组。
    """
    cleaned: list[str] = []
    for raw in (names or []):
        name = (raw or "").strip()[:MAX_TEAM_NAME_LEN]
        cleaned.append(name)
    cleaned = [n for n in cleaned if n] or []
    if len(cleaned) < 2:
        # 教师没填够:补足两组,用「第N组」占位
        cleaned += [f"第 {i} 组" for i in range(len(cleaned) + 1, 3)]
    cleaned = cleaned[:MAX_TEAMS]
    # 同名会让学生选组时分不清谁是谁,后缀去重
    out: dict[int, str] = {}
    seen: dict[str, int] = {}
    for idx, name in enumerate(cleaned, start=1):
        if name in seen:
            seen[name] += 1
            name = f"{name}({seen[name]})"[:MAX_TEAM_NAME_LEN + 4]
        else:
            seen[name] = 1
        out[idx] = name
    return out


def create_room(host_id: int, max_players: int, org_id: int,
                word_ids: list[int] | None = None,
                unit_id: int | None = None, nickname: str | None = None,
                word_count: int = 10,
                mode: str = "individual",
                team_names: list[str] | None = None,
                host_is_player: bool = True,
                countdown_seconds: int = 300,
                same_words: bool = True,
                scope_word_ids: list[int] | None = None,
                scope_desc: str = "") -> RoomState:
    """建房。word_ids 通常留空——开局时才按 same_words 选词(见 _try_start_game)。
    org_id 必填(房主机构):不给默认值,忘传直接报错,防止房间静默归错机构。

    same_words=True(默认):同题公平赛,全员考「所有人都背过」的同一批词;
    False 则各考各背过的词(题量仍全场统一)。
    host_is_player=False:房主(教师)只组织不下场,不进 players、不参与结算/计分。
    mode="team":分组赛,教师建房时用 team_names 自己创建并命名分组,
    学生进房后在等待室自己选组(见 set_player_team)。
    """
    if host_id in USER_ACTIVE:
        prev = ROOMS.get(USER_ACTIVE[host_id])
        # 教师组织房(不下场):上一个房若还没开打(waiting),说明是关了标签页残留的孤儿房,
        # 直接回收让教师能重新建房;正在进行(playing)的才拦着,避免误关正在打的对局。
        if prev is not None and not prev.host_is_player and prev.status == "waiting":
            close_room(prev.room_id)
        else:
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
        # 分组由教师建房时定好;个人赛不建组
        team_names=normalize_team_names(team_names) if mode == "team" else {},
        host_is_player=host_is_player,
        countdown_seconds=max(60, min(int(countdown_seconds), 1800)),
        same_words=same_words,
        # 考试范围词池(教师指定书/单元时才有):开局选词只在此池内取「背过的词」
        scope_word_ids=list(scope_word_ids) if scope_word_ids else None,
        scope_desc=scope_desc or "",
    )
    if host_is_player:
        # 房主下场:作为首个玩家入房(学生自建房 / 晋级赛)。
        # 分组赛里房主也得自己选组,不预分(team 留 None)。
        hp = PlayerState(user_id=host_id, nickname=nickname or f"User{host_id}")
        room.players[host_id] = hp
        room.join_order.append(host_id)
    # host_id 无论下不下场都占 USER_ACTIVE,防同一人重复建房
    USER_ACTIVE[host_id] = room_id
    ROOMS[room_id] = room
    INVITE_INDEX[code] = room_id
    logger.info(
        "PK room created: room_id=%d host_id=%d host_is_player=%s mode=%s "
        "max_players=%d word_count=%d",
        room_id, host_id, host_is_player, room.mode,
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
    """学生凭邀请码进房。分组赛下 team 留 None(未选组),学生进等待室后自己选。"""
    if user_id in USER_ACTIVE:
        raise UserAlreadyInRoom()
    room = get_room_by_code(invite_code, org_id)
    if room.status != "waiting":
        raise RoomAlreadyStarted()
    if len(room.players) >= room.max_players:
        raise RoomFull()
    ps = PlayerState(user_id=user_id, nickname=nickname)
    room.players[user_id] = ps
    room.join_order.append(user_id)
    USER_ACTIVE[user_id] = room.room_id
    logger.info("PK player joined: room_id=%d user_id=%d", room.room_id, user_id)
    return room


def set_player_team(room_id: int, user_id: int, team: int) -> RoomState | None:
    """选组:学生自己选(在等待室点组名),教师也可代为调整。仅分组赛、仅开局前。

    只能选教师建好的组(team 必须在 team_names 里),不能凭空造组。
    返回 None 表示这次选组无效(房间/玩家不存在、已开局、组号不存在),调用方据此不广播。
    """
    room = ROOMS.get(room_id)
    if room is None or room.mode != "team" or room.status != "waiting":
        return None
    ps = room.players.get(user_id)
    if ps is None:
        return None
    t = int(team)
    if t not in room.team_names:
        return None
    ps.team = t
    logger.info("PK player picked team: room_id=%d user_id=%d team=%d", room_id, user_id, t)
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
    # 组是教师建的,人走了组还留着(别人还能选进来);空组不删
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
