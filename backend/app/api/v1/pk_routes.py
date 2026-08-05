"""PK 房间 REST 端点:创建房间 / 通过邀请码查询 / 我的历史。"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.auth import get_current_user, get_current_teacher
from app.models.user import User
from app.models.pk import PkRoom, PkRoomPlayer
from app.schemas.pk import (
    CreateRoomRequest, CreateRoomResponse,
    RoomSnapshot, PlayerSnapshot, PlayerHistoryItem, SpectatorSnapshot,
    MyRoomItem,
)
from app.services.pk import manager
from app.services.pk.score import base_points_for_word_grades

logger = logging.getLogger(__name__)

router = APIRouter()


def _snapshot(room) -> RoomSnapshot:
    return RoomSnapshot(
        room_id=room.room_id,
        invite_code=room.invite_code,
        host_id=room.host_id,
        unit_id=room.unit_id,
        max_players=room.max_players,
        status=room.status,
        current_phase=room.current_phase,
        current_word_idx=room.current_word_idx,
        total_words=len(room.word_ids),
        word_count=room.word_count,
        mode=room.mode,
        team_count=room.team_count,
        team_names={str(t): n for t, n in room.team_names.items()},
        host_is_player=room.host_is_player,
        countdown_seconds=room.countdown_seconds,
        same_words=room.same_words,
        scope_desc=room.scope_desc or None,
        deadline_at=room.deadline_at.isoformat() + "Z" if room.deadline_at else None,
        players=[
            PlayerSnapshot(
                user_id=p.user_id, nickname=p.nickname, online=p.online,
                correct=p.correct,
                wrong=p.wrong, total_time_ms=p.total_time_ms,
                points=p.points, streak=p.streak, finished=p.finished,
                team=p.team, n_words=p.n_words,
                stage=p.stage, group_idx=p.gi, group_total=p.group_total,
                progress=p.compute_progress(),
            )
            for p in room.players.values()
        ],
        spectators=[
            SpectatorSnapshot(user_id=s.user_id, nickname=s.nickname, online=s.online)
            for s in room.spectators.values()
        ],
    )


async def load_learned_word_ids(
    db: AsyncSession, user_ids: list[int], word_ids: list[int] | None = None,
) -> dict[int, set[int]]:
    """查各玩家「背过」的 word_id 集合(背过 = word_mastery 有记录)。

    word_ids 为 None 时不限词表(全库),用于 PK 开局跨书选词。
    """
    per_user: dict[int, set[int]] = {uid: set() for uid in user_ids}
    if not user_ids or (word_ids is not None and not word_ids):
        return per_user
    uid_marks = ",".join(f":u{i}" for i in range(len(user_ids)))
    params: dict = {f"u{i}": v for i, v in enumerate(user_ids)}
    word_filter = ""
    if word_ids is not None:
        wid_marks = ",".join(f":w{i}" for i in range(len(word_ids)))
        params.update({f"w{i}": v for i, v in enumerate(word_ids)})
        word_filter = f"AND word_id IN ({wid_marks}) "
    result = await db.execute(
        text(
            f"SELECT user_id, word_id FROM word_mastery "
            f"WHERE user_id IN ({uid_marks}) {word_filter}"
            f"AND total_encounters > 0"
        ),
        params,
    )
    for uid, wid in result.fetchall():
        per_user[uid].add(wid)
    return per_user


async def resolve_scope_words(
    db: AsyncSession, book_ids: list[int], unit_ids: list[int], org_id: int,
) -> tuple[list[int], str]:
    """把教师建房时指定的「哪些书(整本)/哪些单元」解析成范围词池。

    返回 (word_ids, 范围描述)。书与单元取并集、去重;归属校验按机构:
    只认平台共享书(org_id IS NULL)或本机构自建书,别家机构的 id 静默丢弃
    (raw SQL 不走 tenancy 自动过滤,必须在这里显式拦)。
    整本已选中的书,其下单元不再单列(词已包含,描述也更干净)。
    """
    book_rows: list = []
    if book_ids:
        marks = ",".join(f":b{i}" for i in range(len(book_ids)))
        params: dict = {f"b{i}": v for i, v in enumerate(book_ids)}
        params["org"] = org_id
        book_rows = (await db.execute(
            text(
                f"SELECT id, name FROM word_books "
                f"WHERE id IN ({marks}) AND (org_id IS NULL OR org_id = :org)"
            ),
            params,
        )).fetchall()
    valid_book_ids = [r[0] for r in book_rows]

    unit_rows: list = []
    if unit_ids:
        marks = ",".join(f":u{i}" for i in range(len(unit_ids)))
        params = {f"u{i}": v for i, v in enumerate(unit_ids)}
        params["org"] = org_id
        unit_rows = (await db.execute(
            text(
                f"SELECT u.id, u.name, wb.id, wb.name FROM units u "
                f"JOIN word_books wb ON wb.id = u.book_id "
                f"WHERE u.id IN ({marks}) AND (wb.org_id IS NULL OR wb.org_id = :org)"
            ),
            params,
        )).fetchall()
    # 整本在选的书,其单元不再单算
    unit_rows = [r for r in unit_rows if r[2] not in set(valid_book_ids)]
    valid_unit_ids = [r[0] for r in unit_rows]

    word_ids: set[int] = set()
    if valid_book_ids:
        # 整本书的词经 units→unit_words 取:book_words 表实际是空的(导入只写
        # unit_words),直接查它整本永远 0 词
        marks = ",".join(f":b{i}" for i in range(len(valid_book_ids)))
        params = {f"b{i}": v for i, v in enumerate(valid_book_ids)}
        rows = await db.execute(
            text(
                f"SELECT DISTINCT uw.word_id FROM unit_words uw "
                f"JOIN units u ON u.id = uw.unit_id WHERE u.book_id IN ({marks})"
            ),
            params,
        )
        word_ids.update(r[0] for r in rows.fetchall())
    if valid_unit_ids:
        marks = ",".join(f":u{i}" for i in range(len(valid_unit_ids)))
        params = {f"u{i}": v for i, v in enumerate(valid_unit_ids)}
        rows = await db.execute(
            text(f"SELECT DISTINCT word_id FROM unit_words WHERE unit_id IN ({marks})"),
            params,
        )
        word_ids.update(r[0] for r in rows.fetchall())

    # 范围描述:整本书直接书名,单元按书聚合成「书名 Unit 1/Unit 2」;太长截断
    parts = [f"{name}(整本)" for _, name in book_rows]
    by_book: dict[str, list[str]] = {}
    for _, uname, _, bname in unit_rows:
        by_book.setdefault(bname, []).append(uname)
    for bname, unames in by_book.items():
        shown = "/".join(unames[:4]) + (f" 等{len(unames)}个单元" if len(unames) > 4 else "")
        parts.append(f"{bname} {shown}")
    desc = "、".join(parts[:3]) + (f" 等{len(parts)}项" if len(parts) > 3 else "")
    return sorted(word_ids), desc


async def load_word_points(db: AsyncSession, word_ids: list[int]) -> dict[int, int]:
    """按词查学段难度分(小学 100/初中 120/高中 150)。

    ⚠️ 2026-08-04 起已退出 PK 计分链路(满分统一 词数×100,见 score.py),
    live 路径不再调用;保留仅供测试与将来可能的展示用途,勿再接回胜负计算。
    """
    if not word_ids:
        return {}
    wid_marks = ",".join(f":w{i}" for i in range(len(word_ids)))
    params = {f"w{i}": v for i, v in enumerate(word_ids)}
    result = await db.execute(
        text(
            f"SELECT bw.word_id, wb.grade_level FROM book_words bw "
            f"JOIN word_books wb ON wb.id = bw.book_id "
            f"WHERE bw.word_id IN ({wid_marks})"
        ),
        params,
    )
    grades: dict[int, list] = {}
    for wid, grade in result.fetchall():
        grades.setdefault(wid, []).append(grade)
    return {wid: base_points_for_word_grades(grades.get(wid, [])) for wid in word_ids}


@router.post("/rooms", response_model=CreateRoomResponse)
async def create_room(
    body: CreateRoomRequest,
    user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """建房:仅教师/管理员可创建 PK 对战房间,教师作为组织者不下场参赛。

    建房定人数、每人题量、模式(个人/分组)与全场倒计时;开局时给每个参赛学生各抽
    「他自己背过的词」并行竞速,全场倒计时到点结算。学生只能凭邀请码加入,不能建房。
    分组赛(mode=team)用 team_names 自己建组命名,学生进等待室后各自选组。
    """
    nickname = user.full_name or user.username or f"User{user.id}"
    # 考试范围(可选):建房时就把书/单元解析成词池并校验,空范围直接拒绝,
    # 不要等开局才发现——那时学生都已经进房了
    scope_word_ids: list[int] | None = None
    scope_desc = ""
    if body.scope_book_ids or body.scope_unit_ids:
        scope_word_ids, scope_desc = await resolve_scope_words(
            db, body.scope_book_ids, body.scope_unit_ids, user.org_id,
        )
        if not scope_word_ids:
            raise HTTPException(
                status_code=400,
                detail="所选范围内没有单词,检查选中的书/单元是否为空",
            )
    try:
        room = manager.create_room(
            host_id=user.id,
            max_players=body.max_players,
            word_count=body.word_count,
            nickname=nickname,
            org_id=user.org_id,
            mode=body.mode,
            team_names=body.team_names,
            host_is_player=False,  # 教师是组织者,不作为选手下场
            countdown_seconds=body.countdown_seconds,
            same_words=body.same_words,
            scope_word_ids=scope_word_ids,
            scope_desc=scope_desc,
        )
    except manager.UserAlreadyInRoom:
        raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
    return CreateRoomResponse(room_id=room.room_id, invite_code=room.invite_code)


@router.get("/rooms/mine", response_model=list[MyRoomItem])
async def my_rooms(user: User = Depends(get_current_teacher)):
    """教师大厅「我的房间」:列出我当前还开着的房间(内存态,等待/对局中)。

    切标签页/关网页后房间不再自动回收,教师回来能在这里看到并重新进入或删除。
    只返回本人建的房(host_id==我),按创建时间倒序。
    """
    items = [
        MyRoomItem(
            room_id=r.room_id,
            invite_code=r.invite_code,
            status=r.status,
            mode=r.mode,
            word_count=r.word_count,
            scope_desc=r.scope_desc or None,
            player_count=len(r.players),
            online_count=sum(1 for p in r.players.values() if p.online),
            created_at=r.created_at,
            started_at=r.started_at,
        )
        for r in manager.ROOMS.values()
        if r.host_id == user.id and r.status in ("waiting", "playing")
    ]
    items.sort(key=lambda x: x.created_at or _EPOCH, reverse=True)
    return items


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(room_id: int, user: User = Depends(get_current_teacher)):
    """教师主动删除自己的房间(大厅「我的房间」里点删除)。

    仅房主本人可删;删除会取消计时器、通知并踢出所有在场成员、释放 USER_ACTIVE。
    """
    room = manager.get_room(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    # 只能删自己的房(且同机构;跨机构直接按不存在处理,不泄露)
    if room.host_id != user.id or room.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    from app.api.v1.pk_websocket import teardown_room
    await teardown_room(room_id)
    return None


_EPOCH = __import__("datetime").datetime(1970, 1, 1)


@router.get("/rooms/by-code/{code}", response_model=RoomSnapshot)
async def lookup_room(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        # 可见性裁决统一在 manager: 跨机构一律按不存在处理
        room = manager.get_room_by_code(code, user.org_id)
    except manager.RoomNotFound:
        # Check archive: maybe it finished
        result = await db.execute(
            select(PkRoom).where(PkRoom.invite_code == code).limit(1)
        )
        archived = result.scalar_one_or_none()
        if archived is not None:
            raise HTTPException(status_code=410, detail="ROOM_FINISHED")
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    return _snapshot(room)


@router.post("/rooms/by-code/{code}/join", response_model=RoomSnapshot)
async def join_room_by_code(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """非房主玩家通过邀请码加入房间。将玩家加入 manager.ROOMS,后续 WS 连接才能通过 player 校验。

    分组赛(mode=team)按学生所在班级自动归队:同班同队、班级名即队名,教师不用手动分。
    """
    try:
        nickname = user.full_name or user.username or f"User{user.id}"
        room = manager.join_room(
            invite_code=code, user_id=user.id, nickname=nickname, org_id=user.org_id,
        )
    except manager.RoomNotFound:
        # Distinguish never-existed from finished
        result = await db.execute(
            select(PkRoom).where(PkRoom.invite_code == code).limit(1)
        )
        archived = result.scalar_one_or_none()
        if archived is not None:
            raise HTTPException(status_code=410, detail="ROOM_FINISHED")
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    except manager.RoomFull:
        raise HTTPException(status_code=409, detail="ROOM_FULL")
    except manager.RoomAlreadyStarted:
        raise HTTPException(status_code=409, detail="ROOM_ALREADY_STARTED")
    except manager.UserAlreadyInRoom:
        raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
    return _snapshot(room)


@router.post("/rooms/by-code/{code}/spectate", response_model=RoomSnapshot)
async def spectate_room_by_code(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """以观众身份进房:等待中/对局中都可以,房间满员也不受限。"""
    nickname = user.full_name or user.username or f"User{user.id}"
    try:
        room = manager.spectate_room(invite_code=code, user_id=user.id, nickname=nickname, org_id=user.org_id)
    except manager.RoomNotFound:
        result = await db.execute(
            select(PkRoom).where(PkRoom.invite_code == code).limit(1)
        )
        archived = result.scalar_one_or_none()
        if archived is not None:
            raise HTTPException(status_code=410, detail="ROOM_FINISHED")
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    except manager.SpectatorsFull:
        raise HTTPException(status_code=409, detail="SPECTATORS_FULL")
    return _snapshot(room)


@router.get("/me/history", response_model=list[PlayerHistoryItem])
async def my_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PkRoom, PkRoomPlayer)
        .join(PkRoomPlayer, PkRoom.id == PkRoomPlayer.room_id)
        .where(PkRoomPlayer.user_id == user.id)
        .order_by(PkRoom.finished_at.desc())
        .limit(50)
    )
    items = []
    for room, player in result.all():
        items.append(PlayerHistoryItem(
            room_id=room.id, invite_code=room.invite_code, unit_id=room.unit_id,
            finished_at=room.finished_at, rank=player.rank,
            accuracy=float(player.accuracy) if player.accuracy is not None else None,
            final_score=player.final_score,
        ))
    return items
