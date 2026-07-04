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
async def test_create_room_returns_invite_code(client, auth_student_token):
    token, user_id = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"max_players": 4, "word_count": 10},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "invite_code" in body and len(body["invite_code"]) == 6
    assert "room_id" in body


@pytest.mark.asyncio
async def test_create_room_word_count_bounds(client, auth_student_token):
    """word_count 超出 4~30 → 422。"""
    token, _ = auth_student_token
    for bad in (3, 31):
        resp = await client.post(
            "/api/v1/pk/rooms",
            headers={"Authorization": f"Bearer {token}"},
            json={"max_players": 4, "word_count": bad},
        )
        assert resp.status_code == 422, f"word_count={bad}"


@pytest.mark.asyncio
async def test_lookup_room_by_invite_code(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"max_players": 4, "word_count": 8},
    )
    code = resp.json()["invite_code"]
    look = await client.get(
        f"/api/v1/pk/rooms/by-code/{code}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert look.status_code == 200
    body = look.json()
    assert body["status"] == "waiting"
    assert body["word_count"] == 8
    assert body["total_words"] == 0  # 开局前词还没抽


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
async def test_join_room_by_code_success(client, two_student_tokens):
    """房主创建房间,加入者通过邀请码加入 → 返回包含两位玩家的房间快照。"""
    token1, token2, host_id, joiner_id = two_student_tokens
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"max_players": 4, "word_count": 10},
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
async def test_join_room_already_in_other_room(client, two_student_tokens):
    """已在某个房间中的用户不能再加入另一个房间。"""
    token1, token2, _host_id, _joiner_id = two_student_tokens

    # token1 创建房间 A
    resp_a = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"max_players": 4, "word_count": 10},
    )
    code_a = resp_a.json()["invite_code"]
    # token2 创建房间 B(成为另一个房间的房主)
    resp_b = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token2}"},
        json={"max_players": 4, "word_count": 10},
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
async def test_join_room_when_full(client, db_session, two_student_tokens):
    """max_players=2 的房间已满 2 人,第三个用户加入 → 409 ROOM_FULL。"""
    from app.models.user import User
    from tests.conftest import _make_token

    token1, token2, _h, _j = two_student_tokens

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
        json={"max_players": 2, "word_count": 10},
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
async def test_lookup_finished_room_returns_410(client, two_student_tokens, db_session):
    """A finished/archived room returns 410 ROOM_FINISHED, distinct from 404."""
    from app.models.pk import PkRoom
    import json
    token1, token2, host_id, joiner_id = two_student_tokens
    # Insert a fake archived room(unit_id 已可空)
    archived = PkRoom(
        invite_code="DONEXX",
        host_id=host_id,
        unit_id=None,
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
async def test_join_finished_room_returns_410(client, two_student_tokens, db_session):
    """Joining a finished/archived room returns 410, not 404."""
    from app.models.pk import PkRoom
    import json
    token1, _, host_id, _ = two_student_tokens
    archived = PkRoom(
        invite_code="DONEYY",
        host_id=host_id,
        unit_id=None,
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


# ---------- 自定义人数(2~20) ----------

@pytest.mark.asyncio
async def test_create_room_allows_up_to_20_players(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"max_players": 20, "word_count": 10},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_room_rejects_over_20_players(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"max_players": 21, "word_count": 10},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_room_rejects_solo_room(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token}"},
        json={"max_players": 1, "word_count": 10},
    )
    assert resp.status_code == 422


# ---------- 逐词学段分值 ----------

@pytest.mark.asyncio
async def test_load_word_points_by_book_grade(db_session, sample_unit_with_words, senior_unit_with_words):
    """无年级书的词 → 100;高一书的词 → 150。"""
    from app.api.v1.pk_routes import load_word_points

    _, primary_ids = sample_unit_with_words   # 书无 grade_level
    _, senior_ids = senior_unit_with_words    # 书 grade_level=高一
    points = await load_word_points(db_session, primary_ids + senior_ids)
    for wid in primary_ids:
        assert points[wid] == 100
    for wid in senior_ids:
        assert points[wid] == 150


@pytest.mark.asyncio
async def test_load_word_points_word_without_book_defaults_primary(db_session):
    """不属于任何书的词按小学 100 兜底。"""
    from app.api.v1.pk_routes import load_word_points
    from app.models.word import Word

    w = Word(word="orphan_word", difficulty=1)
    db_session.add(w)
    await db_session.commit()
    await db_session.refresh(w)
    points = await load_word_points(db_session, [w.id])
    assert points[w.id] == 100


@pytest.mark.asyncio
async def test_load_learned_word_ids_full_vocab(db_session, auth_student_token, sample_unit_with_words):
    """word_ids=None 时返回该生全库背过的词。"""
    from app.api.v1.pk_routes import load_learned_word_ids
    from app.models.learning import WordMastery

    _, user_id = auth_student_token
    _, word_ids = sample_unit_with_words
    for wid in word_ids[:3]:
        db_session.add(WordMastery(user_id=user_id, word_id=wid, total_encounters=2))
    await db_session.commit()

    learned = await load_learned_word_ids(db_session, [user_id], None)
    assert learned[user_id] == set(word_ids[:3])


# ---------- 观战模式 ----------

@pytest.mark.asyncio
async def test_spectate_waiting_room(client, two_student_tokens):
    """等待中的房间可观战,快照 spectators 含观众。"""
    token1, token2, host_id, joiner_id = two_student_tokens
    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"max_players": 2, "word_count": 10},
    )
    code = resp.json()["invite_code"]
    spec = await client.post(
        f"/api/v1/pk/rooms/by-code/{code}/spectate",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert spec.status_code == 200
    body = spec.json()
    assert len(body["players"]) == 1           # 不占玩家名额
    assert len(body["spectators"]) == 1
    assert body["spectators"][0]["user_id"] == joiner_id


@pytest.mark.asyncio
async def test_spectate_full_or_started_room(client, db_session, two_student_tokens):
    """房间满员/已开局时仍可观战(玩家 join 会被拒)。"""
    from app.models.user import User
    from tests.conftest import _make_token

    token1, token2, host_id, joiner_id = two_student_tokens
    user3 = User(username="stu_pk_spec", email="spec@example.com",
                 hashed_password="x", role="student", is_active=True)
    db_session.add(user3)
    await db_session.commit()
    await db_session.refresh(user3)
    token3 = _make_token(user3.id)

    resp = await client.post(
        "/api/v1/pk/rooms",
        headers={"Authorization": f"Bearer {token1}"},
        json={"max_players": 2, "word_count": 10},
    )
    code = resp.json()["invite_code"]
    await client.post(f"/api/v1/pk/rooms/by-code/{code}/join",
                      headers={"Authorization": f"Bearer {token2}"})

    # 满员:join 拒,spectate 可
    join3 = await client.post(f"/api/v1/pk/rooms/by-code/{code}/join",
                              headers={"Authorization": f"Bearer {token3}"})
    assert join3.status_code == 409
    spec3 = await client.post(f"/api/v1/pk/rooms/by-code/{code}/spectate",
                              headers={"Authorization": f"Bearer {token3}"})
    assert spec3.status_code == 200

    # 已开局(直接改内存状态)仍可再次观战(幂等)
    room = manager.ROOMS[resp.json()["room_id"]]
    room.status = "playing"
    spec_again = await client.post(f"/api/v1/pk/rooms/by-code/{code}/spectate",
                                   headers={"Authorization": f"Bearer {token3}"})
    assert spec_again.status_code == 200


@pytest.mark.asyncio
async def test_spectate_invalid_code_404(client, auth_student_token):
    token, _ = auth_student_token
    resp = await client.post(
        "/api/v1/pk/rooms/by-code/ZZZZZZ/spectate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
