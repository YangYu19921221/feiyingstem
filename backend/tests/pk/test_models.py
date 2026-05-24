import pytest
from sqlalchemy import select
from app.models.pk import PkRoom, PkRoomPlayer, PkAnswerRecord


@pytest.mark.asyncio
async def test_pk_models_create_and_query(db_session):
    room = PkRoom(
        invite_code="ABC123",
        host_id=1,
        unit_id=1,
        max_players=4,
        status="waiting",
        word_ids='[1,2,3]',
    )
    db_session.add(room)
    await db_session.commit()
    await db_session.refresh(room)

    result = await db_session.execute(
        select(PkRoom).where(PkRoom.invite_code == "ABC123")
    )
    found = result.scalar_one()
    assert found.id == room.id
    assert found.status == "waiting"
