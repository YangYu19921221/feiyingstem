import pytest
from app.services.pk import manager


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


@pytest.mark.asyncio
async def test_create_room_returns_invite_code(client, auth_student_token, sample_unit_with_words):
    token, user_id = auth_student_token
    unit, word_ids = sample_unit_with_words
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"unit_id": unit.id, "max_players": 4},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "invite_code" in body and len(body["invite_code"]) == 6
    assert "room_id" in body


@pytest.mark.asyncio
async def test_create_room_requires_words_in_unit(client, auth_student_token, empty_unit):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"unit_id": empty_unit.id, "max_players": 4},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_lookup_room_by_invite_code(client, auth_student_token, sample_unit_with_words):
    token, _ = auth_student_token
    unit, _ = sample_unit_with_words
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"unit_id": unit.id, "max_players": 4},
    )
    code = resp.json()["invite_code"]
    look = await client.get(
        f"/api/v1/pk/rooms/by-code/{code}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert look.status_code == 200
    assert look.json()["status"] == "waiting"


@pytest.mark.asyncio
async def test_my_history_empty(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.get(
        "/api/v1/pk/me/history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []
