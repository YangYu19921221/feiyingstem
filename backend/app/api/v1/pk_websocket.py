"""PK 竞技场 WebSocket 端点。"""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.word import Word
from app.services.pk import manager, engine
from app.services.pk.persist import persist_finished_room
from app.services.pk.engine import PHASE_TIMEOUT_MS

router = APIRouter()

HEARTBEAT_TIMEOUT_S = 30
RECONNECT_WINDOW_S = 90


async def _authenticate(token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
    async with AsyncSessionLocal() as db:
        return await db.get(User, user_id)


async def _word_lookup_for_room(db: AsyncSession, word_ids: list[int]) -> dict:
    result = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    return {w.id: w for w in result.scalars().all()}


def _snapshot_dict(room) -> dict:
    return {
        "room_id": room.room_id,
        "invite_code": room.invite_code,
        "host_id": room.host_id,
        "unit_id": room.unit_id,
        "max_players": room.max_players,
        "status": room.status,
        "current_phase": room.current_phase,
        "current_word_idx": room.current_word_idx,
        "total_words": len(room.word_ids),
        "players": [
            {
                "user_id": p.user_id, "nickname": p.nickname, "online": p.online,
                "current_word_idx": p.current_word_idx, "correct": p.correct,
                "wrong": p.wrong, "total_time_ms": p.total_time_ms, "finished": p.finished,
            }
            for p in room.players.values()
        ],
    }


def _schedule_disconnect_cleanup(room, user_id: int):
    """Schedule the 90s reconnect window before evicting a disconnected player.

    If the player is still offline at the deadline, leave_room() runs and
    host_changed is broadcast if the host transferred.
    """
    async def _cleanup():
        await asyncio.sleep(RECONNECT_WINDOW_S)
        cur = manager.get_room(room.room_id)
        if cur is None:
            return
        ps_after = cur.players.get(user_id)
        if ps_after and not ps_after.online:
            old_host = cur.host_id
            manager.leave_room(cur.room_id, user_id)
            cur_after = manager.get_room(room.room_id)
            if cur_after and cur_after.host_id != old_host:
                await _broadcast(cur_after, {"type": "host_changed", "new_host_id": cur_after.host_id})

    asyncio.create_task(_cleanup())


HEARTBEAT_CHECK_INTERVAL_S = 5  # how often the watchdog scans rooms

_heartbeat_watchdog_task: asyncio.Task | None = None


async def _heartbeat_watchdog_loop():
    """Periodically scan all rooms; flip players offline if no heartbeat for HEARTBEAT_TIMEOUT_S."""
    while True:
        try:
            await asyncio.sleep(HEARTBEAT_CHECK_INTERVAL_S)
            now = datetime.utcnow()
            cutoff = now - timedelta(seconds=HEARTBEAT_TIMEOUT_S)
            # Iterate over a snapshot — manager.ROOMS may mutate during await.
            for room in list(manager.ROOMS.values()):
                stale_uids: list[int] = []
                for uid, ps in list(room.players.items()):
                    if ps.online and ps.last_heartbeat_at < cutoff:
                        stale_uids.append(uid)
                for uid in stale_uids:
                    ps = room.players.get(uid)
                    if ps is None or not ps.online:
                        continue
                    ps.online = False
                    ps.disconnected_at = now
                    # Don't clear ps.ws — the OS-level socket may still be alive,
                    # we just stopped trusting the heartbeat.
                    await _broadcast(room, {"type": "player_disconnected", "user_id": uid})
                    _schedule_disconnect_cleanup(room, uid)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Don't let one bad iteration kill the watchdog.
            # In production, log this; for now, swallow.
            continue


def _ensure_heartbeat_watchdog():
    """Start the global watchdog if not running. Called lazily on each WS connect."""
    global _heartbeat_watchdog_task
    if _heartbeat_watchdog_task is None or _heartbeat_watchdog_task.done():
        _heartbeat_watchdog_task = asyncio.create_task(_heartbeat_watchdog_loop())


async def _broadcast(room, event: dict, exclude: int | None = None):
    """Broadcast an event to all players except `exclude`. If a send fails,
    mark the player as disconnected and schedule cleanup. Notifications about
    the failure are deferred until iteration completes (avoid recursive sends)."""
    failed_user_ids: list[int] = []
    for uid, ps in list(room.players.items()):
        if uid == exclude or ps.ws is None:
            continue
        try:
            await ps.ws.send_json(event)
        except Exception:
            failed_user_ids.append(uid)

    for uid in failed_user_ids:
        ps = room.players.get(uid)
        if ps is None:
            continue
        ps.ws = None
        ps.online = False
        ps.disconnected_at = datetime.utcnow()
        # Notify other players (this re-enters _broadcast but failed_user_ids is
        # bounded, and the failed player is now ws=None so it'll be skipped).
        await _broadcast(room, {"type": "player_disconnected", "user_id": uid})
        _schedule_disconnect_cleanup(room, uid)


_TIMEOUT_TASKS: dict[tuple[int, int, str], asyncio.Task] = {}


def _cancel_timer(room_id: int, word_idx: int, phase: str):
    key = (room_id, word_idx, phase)
    task = _TIMEOUT_TASKS.pop(key, None)
    if task and not task.done():
        task.cancel()


def _schedule_timer(room, word_idx: int, phase: str, word_lookup: dict):
    _cancel_timer(room.room_id, word_idx, phase)
    timeout_ms = PHASE_TIMEOUT_MS.get(phase, 30_000)

    async def _run():
        try:
            await asyncio.sleep(timeout_ms / 1000)
            events = engine.force_timeout(room, word_idx, phase, word_lookup)
            await _process_events(room, events, word_lookup)
        except asyncio.CancelledError:
            pass

    _TIMEOUT_TASKS[(room.room_id, word_idx, phase)] = asyncio.create_task(_run())


async def _process_events(room, events: list[dict], word_lookup: dict):
    for event in events:
        await _broadcast(room, event)
        if event["type"] == "question_pushed":
            _schedule_timer(room, event["word_idx"], event["phase"], word_lookup)
        elif event["type"] == "question_settled":
            _cancel_timer(room.room_id, event["word_idx"], room.current_phase)
        elif event["type"] == "game_finished":
            async with AsyncSessionLocal() as db:
                await persist_finished_room(room, db)
            for uid in list(room.players.keys()):
                manager.USER_ACTIVE.pop(uid, None)
            manager.INVITE_INDEX.pop(room.invite_code, None)
            manager.ROOMS.pop(room.room_id, None)


@router.websocket("/ws")
async def pk_ws(
    ws: WebSocket,
    token: str = Query(...),
    room_id: int = Query(...),
):
    user = await _authenticate(token)
    if user is None:
        await ws.close(code=1008, reason="AUTH_FAILED")
        return
    room = manager.get_room(room_id)
    if room is None or user.id not in room.players:
        await ws.accept()
        await ws.send_json({"type": "error", "code": "ROOM_NOT_FOUND", "message": "Room not found"})
        await ws.close()
        return

    await ws.accept()
    p = room.players[user.id]
    if p.ws is not None and p.ws is not ws:
        try:
            await p.ws.close(code=1000, reason="REPLACED_BY_NEW_CONNECTION")
        except Exception:
            pass
    p.ws = ws
    p.online = True
    p.last_heartbeat_at = datetime.utcnow()
    p.disconnected_at = None

    _ensure_heartbeat_watchdog()

    await ws.send_json({"type": "room_state", "room": _snapshot_dict(room)})
    await _broadcast(room, {"type": "player_reconnected", "user_id": user.id}, exclude=user.id)

    async with AsyncSessionLocal() as db:
        word_lookup = await _word_lookup_for_room(db, room.word_ids)

    try:
        while True:
            msg = await ws.receive_json()
            mtype = msg.get("type")
            if mtype == "heartbeat":
                p.last_heartbeat_at = datetime.utcnow()
            elif mtype == "start_game" and user.id == room.host_id:
                if room.status == "waiting":
                    room.status = "playing"
                    room.started_at = datetime.utcnow()
                    first_word = word_lookup.get(room.word_ids[0])
                    push_event = {
                        "type": "question_pushed", "word_idx": 0,
                        "phase": "classify",
                        "word": {
                            "id": getattr(first_word, "id", None),
                            "word": getattr(first_word, "word", ""),
                            "translation": getattr(first_word, "translation", ""),
                        },
                    }
                    await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
                    await _broadcast(room, push_event)
                    _schedule_timer(room, 0, "classify", word_lookup)
            elif mtype == "submit_answer":
                events = engine.submit_answer(
                    room=room, user_id=user.id,
                    word_idx=msg.get("word_idx"), phase=msg.get("phase"),
                    payload=msg.get("payload", {}),
                    time_spent_ms=msg.get("time_spent_ms", 0),
                    word_lookup=word_lookup,
                )
                await _process_events(room, events, word_lookup)
            elif mtype == "kick_player" and user.id == room.host_id:
                target = msg.get("user_id")
                if target in room.players and target != user.id:
                    target_ws = room.players[target].ws
                    manager.leave_room(room.room_id, target)
                    if target_ws:
                        try:
                            await target_ws.send_json({"type": "player_kicked", "user_id": target})
                            await target_ws.close()
                        except Exception:
                            pass
                    await _broadcast(room, {"type": "player_kicked", "user_id": target})
            elif mtype == "leave_room":
                break
    except WebSocketDisconnect:
        pass
    finally:
        p.ws = None
        p.online = False
        p.disconnected_at = datetime.utcnow()
        await _broadcast(room, {"type": "player_disconnected", "user_id": user.id})
        _schedule_disconnect_cleanup(room, user.id)
