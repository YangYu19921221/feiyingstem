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


@pytest.mark.asyncio
async def test_join_room_by_code_success(
    client, two_student_tokens, sample_unit_with_words,
):
    """房主创建房间,加入者通过邀请码加入 → 返回包含两位玩家的房间快照。"""
    token1, token2, host_id, joiner_id = two_student_tokens
    unit, _ = sample_unit_with_words
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"unit_id": unit.id, "max_players": 4},
    )
    code = resp.json()["invite_code"]

    join_resp = await client.post(
        f"/api/v1/pk/rooms/by-code/{code}/join",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert join_resp.status_code == 200
    body = join_resp.json()
    assert body["status"] == "waiting"
    assert len(body["players"]) == 2
    user_ids = {p["user_id"] for p in body["players"]}
    assert host_id in user_ids and joiner_id in user_ids


@pytest.mark.asyncio
async def test_join_room_invalid_code(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms/by-code/ZZZZZZ/join",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "ROOM_NOT_FOUND"


@pytest.mark.asyncio
async def test_join_room_already_in_other_room(
    client, two_student_tokens, sample_unit_with_words,
):
    """已在某个房间中的用户不能再加入另一个房间。"""
    token1, token2, _host_id, _joiner_id = two_student_tokens
    unit, _ = sample_unit_with_words

    # token1 创建房间 A
    resp_a = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"unit_id": unit.id, "max_players": 4},
    )
    code_a = resp_a.json()["invite_code"]
    # token2 创建房间 B(成为另一个房间的房主)
    resp_b = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token2}"},
        json={"unit_id": unit.id, "max_players": 4},
    )
    assert resp_b.status_code == 200

    # token2 已是 B 的房主,尝试加入 A → 409
    join = await client.post(
        f"/api/v1/pk/rooms/by-code/{code_a}/join",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert join.status_code == 409
    assert join.json()["detail"] == "USER_ALREADY_IN_ROOM"


@pytest.mark.asyncio
async def test_join_room_when_full(
    client, db_session, two_student_tokens, sample_unit_with_words,
):
    """max_players=2 的房间已满 2 人,第三个用户加入 → 409 ROOM_FULL。"""
    from app.models.user import User
    from tests.conftest import _make_token

    token1, token2, _h, _j = two_student_tokens
    unit, _ = sample_unit_with_words

    # 创建一个第三方用户(避免与 auth_student_token 中的 username 冲突)
    user3 = User(
        username="stu_pk_3",
        email="stu_pk_3_e2e@example.com",
        hashed_password="x",
        role="student",
        full_name="Student 3",
        is_active=True,
    )
    db_session.add(user3)
    await db_session.commit()
    await db_session.refresh(user3)
    token3 = _make_token(user3.id)

    # 房主创建 max_players=2 的房间
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"unit_id": unit.id, "max_players": 2},
    )
    code = resp.json()["invite_code"]

    # 第二个玩家填满房间
    join1 = await client.post(
        f"/api/v1/pk/rooms/by-code/{code}/join",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert join1.status_code == 200

    # 第三个玩家尝试加入 → 409 ROOM_FULL
    join2 = await client.post(
        f"/api/v1/pk/rooms/by-code/{code}/join",
        headers={"Authorization": f"Bearer {token3}"},
    )
    assert join2.status_code == 409
    assert join2.json()["detail"] == "ROOM_FULL"


@pytest.mark.asyncio
async def test_lookup_finished_room_returns_410(
    client, two_student_tokens, sample_unit_with_words, db_session,
):
    """A finished/archived room returns 410 ROOM_FINISHED, distinct from 404."""
    from app.models.pk import PkRoom
    import json
    token1, token2, host_id, joiner_id = two_student_tokens
    unit, _ = sample_unit_with_words
    # Insert a fake archived room
    archived = PkRoom(
        invite_code="DONEXX",
        host_id=host_id,
        unit_id=unit.id,
        max_players=2,
        status="finished",
        word_ids=json.dumps([1]),
    )
    db_session.add(archived)
    await db_session.commit()

    resp = await client.get(
        "/api/v1/pk/rooms/by-code/DONEXX",
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert resp.status_code == 410
    assert resp.json()["detail"] == "ROOM_FINISHED"


@pytest.mark.asyncio
async def test_join_finished_room_returns_410(
    client, two_student_tokens, sample_unit_with_words, db_session,
):
    """Joining a finished/archived room returns 410, not 404."""
    from app.models.pk import PkRoom
    import json
    token1, _, host_id, _ = two_student_tokens
    unit, _ = sample_unit_with_words
    archived = PkRoom(
        invite_code="DONEYY",
        host_id=host_id,
        unit_id=unit.id,
        max_players=2,
        status="finished",
        word_ids=json.dumps([1]),
    )
    db_session.add(archived)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/pk/rooms/by-code/DONEYY/join",
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert resp.status_code == 410
    assert resp.json()["detail"] == "ROOM_FINISHED"
