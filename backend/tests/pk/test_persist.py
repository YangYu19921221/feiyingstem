import json
import pytest
from datetime import datetime
from sqlalchemy import select
from app.services.pk import manager
from app.services.pk.persist import persist_finished_room
from app.models.pk import PkRoom, PkRoomPlayer, PkAnswerRecord


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield


@pytest.mark.asyncio
async def test_persist_finished_room(db_session):
    room = manager.create_room(host_id=1, unit_id=10, max_players=2, word_ids=[1, 2])
    manager.join_room(invite_code=room.invite_code, user_id=2, nickname="Bob")
    room.status = "finished"
    room.started_at = datetime.utcnow()
    room.finished_at = datetime.utcnow()
    room.players[1].correct = 5
    room.players[1].wrong = 3
    room.players[1].total_time_ms = 12000
    room.players[1].points = 500
    room.players[2].correct = 7
    room.players[2].wrong = 1
    room.players[2].total_time_ms = 14000
    room.players[2].points = 700

    await persist_finished_room(room, db_session)

    rows = (await db_session.execute(select(PkRoom))).scalars().all()
    assert len(rows) == 1
    assert rows[0].invite_code == room.invite_code
    assert json.loads(rows[0].word_ids) == [1, 2]

    players = (await db_session.execute(select(PkRoomPlayer).order_by(PkRoomPlayer.rank))).scalars().all()
    assert len(players) == 2
    assert players[0].rank == 1
    assert players[0].user_id == 2  # points 700 vs 500,Bob 第一
    assert players[0].final_score == 700
    assert players[1].rank == 2


@pytest.mark.asyncio
async def test_persist_is_disconnected_based_on_completion(db_session):
    """A player who didn't answer all questions is marked disconnected,
    regardless of their `online` flag at game-end time."""
    room = manager.create_room(host_id=1, unit_id=10, max_players=2, word_ids=[1, 2])
    manager.join_room(invite_code=room.invite_code, user_id=2, nickname="Bob")
    room.status = "finished"
    room.started_at = datetime.utcnow()
    room.finished_at = datetime.utcnow()
    # Total questions = 2 words x 4 phases = 8
    # Player 1: answered all 8 (5 right + 3 wrong) -> NOT disconnected
    room.players[1].correct = 5
    room.players[1].wrong = 3
    room.players[1].total_time_ms = 12000
    room.players[1].online = False  # online flag misleading; should still NOT be disconnected
    # Player 2: only answered 6 (4 right + 2 wrong) -> disconnected
    room.players[2].correct = 4
    room.players[2].wrong = 2
    room.players[2].total_time_ms = 14000
    room.players[2].online = True  # online flag misleading; should still BE disconnected

    await persist_finished_room(room, db_session)

    players = (await db_session.execute(
        select(PkRoomPlayer).order_by(PkRoomPlayer.user_id)
    )).scalars().all()
    by_uid = {p.user_id: p for p in players}
    assert by_uid[1].is_disconnected is False  # finished all 8
    assert by_uid[2].is_disconnected is True   # only 6 of 8
