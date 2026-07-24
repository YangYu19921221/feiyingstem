"""房间结束落库:写 pk_rooms + pk_room_players + pk_answer_records。"""
from __future__ import annotations
import json
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.pk import PkRoom, PkRoomPlayer, PkAnswerRecord
from app.services.pk.state import RoomState
from app.services.pk.score import rank_players

logger = logging.getLogger(__name__)


async def persist_finished_room(room: RoomState, db: AsyncSession) -> int:
    """把房间和成绩写库,返回 pk_rooms.id。"""
    db_room = PkRoom(
        invite_code=room.invite_code,
        host_id=room.host_id,
        org_id=room.org_id,  # 多租户: 落库带机构归属
        unit_id=room.unit_id,
        max_players=room.max_players,
        status=room.status,
        mode=room.mode,
        word_ids=json.dumps(room.word_ids),
        started_at=room.started_at,
        finished_at=room.finished_at,
    )
    db.add(db_room)
    await db.flush()

    # 并行竞速:每人一份词表、答完循环续刷,答题数不定;掉线判定=中途离线(disconnected_at
    # 有值且未在线)而非"答题数不足",因为限时+循环下答题数本就因人而异。
    ranked = rank_players([
        {
            "user_id": ps.user_id,
            "correct": ps.correct,
            "wrong": ps.wrong,
            "total_time_ms": ps.total_time_ms,
            "points": ps.points,
            "team": ps.team,
            "is_disconnected": (not ps.online) and ps.disconnected_at is not None,
        }
        for ps in room.players.values()
    ])
    for r in ranked:
        db.add(PkRoomPlayer(
            room_id=db_room.id,
            user_id=r["user_id"],
            team=r.get("team"),
            rank=r["rank"],
            accuracy=r["accuracy"],
            total_time_ms=r["total_time_ms"],
            correct_count=r["correct"],
            wrong_count=r["wrong"],
            final_score=r["final_score"],
            is_disconnected=r.get("is_disconnected", False),
        ))

    # 答题流水:并行模式每人自己的 answers 列表(取每题实际词,答完循环续刷会有重复词)
    answer_total = 0
    for ps in room.players.values():
        for ans in ps.answers:
            answer_total += 1
            db.add(PkAnswerRecord(
                room_id=db_room.id,
                user_id=ps.user_id,
                word_id=ans.word_id,
                phase=ans.phase,
                is_correct=ans.is_correct,
                time_spent_ms=ans.time_spent_ms,
            ))

    await db.commit()
    logger.info(
        "PK room persisted: room_id=%d db_id=%d players=%d answers=%d",
        room.room_id, db_room.id, len(room.players), answer_total,
    )
    return db_room.id
