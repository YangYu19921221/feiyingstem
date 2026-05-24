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
        unit_id=room.unit_id,
        max_players=room.max_players,
        status=room.status,
        word_ids=json.dumps(room.word_ids),
        started_at=room.started_at,
        finished_at=room.finished_at,
    )
    db.add(db_room)
    await db.flush()

    total_questions = len(room.word_ids) * 4
    ranked = rank_players([
        {
            "user_id": ps.user_id,
            "correct": ps.correct,
            "wrong": ps.wrong,
            "total_time_ms": ps.total_time_ms,
            "is_disconnected": (ps.correct + ps.wrong) < total_questions,
        }
        for ps in room.players.values()
    ])
    for r in ranked:
        db.add(PkRoomPlayer(
            room_id=db_room.id,
            user_id=r["user_id"],
            rank=r["rank"],
            accuracy=r["accuracy"],
            total_time_ms=r["total_time_ms"],
            correct_count=r["correct"],
            wrong_count=r["wrong"],
            final_score=r["final_score"],
            is_disconnected=r.get("is_disconnected", False),
        ))

    for word_idx, bucket in room.answers.items():
        for uid, ans in bucket.items():
            db.add(PkAnswerRecord(
                room_id=db_room.id,
                user_id=uid,
                word_id=ans.word_id,
                phase=ans.phase,
                is_correct=ans.is_correct,
                time_spent_ms=ans.time_spent_ms,
            ))

    await db.commit()
    logger.info(
        "PK room persisted: room_id=%d db_id=%d players=%d answers=%d",
        room.room_id, db_room.id, len(room.players),
        sum(len(b) for b in room.answers.values()),
    )
    return db_room.id
