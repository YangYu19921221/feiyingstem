"""PK 房间 REST 端点:创建房间 / 通过邀请码查询 / 我的历史。"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.pk import PkRoom, PkRoomPlayer
from app.schemas.pk import (
    CreateRoomRequest, CreateRoomResponse,
    RoomSnapshot, PlayerSnapshot, PlayerHistoryItem, SpectatorSnapshot,
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
        players=[
            PlayerSnapshot(
                user_id=p.user_id, nickname=p.nickname, online=p.online,
                current_word_idx=p.current_word_idx, correct=p.correct,
                wrong=p.wrong, total_time_ms=p.total_time_ms,
                points=p.points, streak=p.streak, finished=p.finished,
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


async def load_word_points(db: AsyncSession, word_ids: list[int]) -> dict[int, int]:
    """按词定每题基础分:取该词出现过的所有单词本年级里最早的学段。

    小学 100 / 初中 120 / 高中 150;没有书籍信息的词按小学。
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """建房只定人数和题量;单词在开局时从「所有人都背过」的交集里随机抽取。"""
    nickname = user.full_name or user.username or f"User{user.id}"
    try:
        room = manager.create_room(
            host_id=user.id,
            max_players=body.max_players,
            word_count=body.word_count,
            nickname=nickname,
            org_id=user.org_id,
        )
    except manager.UserAlreadyInRoom:
        raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
    return CreateRoomResponse(room_id=room.room_id, invite_code=room.invite_code)


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
    """非房主玩家通过邀请码加入房间。将玩家加入 manager.ROOMS,后续 WS 连接才能通过 player 校验。"""
    nickname = user.full_name or user.username or f"User{user.id}"
    try:
        room = manager.join_room(invite_code=code, user_id=user.id, nickname=nickname, org_id=user.org_id)
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
