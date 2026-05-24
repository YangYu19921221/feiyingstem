"""PK 房间 REST 端点:创建房间 / 通过邀请码查询 / 我的历史。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.pk import PkRoom, PkRoomPlayer
from app.schemas.pk import (
    CreateRoomRequest, CreateRoomResponse,
    RoomSnapshot, PlayerSnapshot, PlayerHistoryItem,
)
from app.services.pk import manager

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
        players=[
            PlayerSnapshot(
                user_id=p.user_id, nickname=p.nickname, online=p.online,
                current_word_idx=p.current_word_idx, correct=p.correct,
                wrong=p.wrong, total_time_ms=p.total_time_ms, finished=p.finished,
            )
            for p in room.players.values()
        ],
    )


async def _load_unit_word_ids(db: AsyncSession, unit_id: int) -> list[int]:
    """读 unit_words 关联,按 order_index 返回 word_id 列表。"""
    result = await db.execute(
        text("SELECT word_id FROM unit_words WHERE unit_id = :uid ORDER BY order_index"),
        {"uid": unit_id},
    )
    return [row[0] for row in result.fetchall()]


@router.post("/rooms", response_model=CreateRoomResponse)
async def create_room(
    body: CreateRoomRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    word_ids = await _load_unit_word_ids(db, body.unit_id)
    if not word_ids:
        raise HTTPException(status_code=400, detail="UNIT_HAS_NO_WORDS")
    try:
        room = manager.create_room(
            host_id=user.id, unit_id=body.unit_id,
            max_players=body.max_players, word_ids=word_ids,
        )
    except manager.UserAlreadyInRoom:
        raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
    return CreateRoomResponse(room_id=room.room_id, invite_code=room.invite_code)


@router.get("/rooms/by-code/{code}", response_model=RoomSnapshot)
async def lookup_room(code: str, user: User = Depends(get_current_user)):
    room_id = manager.INVITE_INDEX.get(code)
    if room_id is None:
        raise HTTPException(status_code=404, detail="ROOM_NOT_FOUND")
    return _snapshot(manager.ROOMS[room_id])


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
