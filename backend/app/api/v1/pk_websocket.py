"""PK 竞技场 WebSocket 端点。"""
from __future__ import annotations
import asyncio
import logging
import random
from datetime import datetime, timedelta
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.word import Word
from app.services.pk import manager, engine
from app.services.pk import tournament as tsvc
from app.services.pk.persist import persist_finished_room
from app.services.pk.engine import PHASE_TIMEOUT_MS
from app.api.v1.pk_routes import load_learned_word_ids, load_word_points

logger = logging.getLogger(__name__)

router = APIRouter()

HEARTBEAT_TIMEOUT_S = 30
RECONNECT_WINDOW_S = 90
MIN_COMMON_WORDS = 4  # 所有玩家共同背过的词少于该数时不允许开局


async def _authenticate(token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError) as e:
        logger.info("PK WS auth failed: %s", e)
        return None
    async with AsyncSessionLocal() as db:
        return await db.get(User, user_id)


async def _word_lookup_for_room(db: AsyncSession, word_ids: list[int]) -> dict:
    """word_id → Word,并补上中文释义。

    words 表没有 translation 列(释义在 word_definitions),这里取主释义
    动态挂到实例上,否则听写/过关阶段玩家只会看到空白提示。
    """
    result = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    words = {w.id: w for w in result.scalars().all()}
    if words:
        wid_marks = ",".join(f":w{i}" for i in range(len(word_ids)))
        params = {f"w{i}": v for i, v in enumerate(word_ids)}
        rows = await db.execute(
            text(
                f"SELECT word_id, part_of_speech, meaning FROM word_definitions "
                f"WHERE word_id IN ({wid_marks}) ORDER BY is_primary DESC, id"
            ),
            params,
        )
        for wid, pos, meaning in rows.fetchall():
            w = words.get(wid)
            if w is not None and not getattr(w, "translation", None):
                w.translation = f"{pos} {meaning}" if pos else (meaning or "")
    return words


async def _load_learned_for_room(user_ids: list[int], word_ids: list[int] | None = None) -> dict[int, set[int]]:
    """查各玩家背过的词(独立会话;模块级方便测试打桩)。word_ids=None 表示全库。"""
    async with AsyncSessionLocal() as db:
        return await load_learned_word_ids(db, user_ids, word_ids)


async def _load_word_points_for_room(word_ids: list[int]) -> dict[int, int]:
    """按词定基础分(独立会话;模块级方便测试打桩)。"""
    async with AsyncSessionLocal() as db:
        return await load_word_points(db, word_ids)


async def _load_word_lookup(word_ids: list[int]) -> dict:
    """装载 word_id → Word(独立会话;模块级方便测试打桩)。"""
    async with AsyncSessionLocal() as db:
        return await _word_lookup_for_room(db, word_ids)


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
        "word_count": room.word_count,
        "players": [
            {
                "user_id": p.user_id, "nickname": p.nickname, "online": p.online,
                "current_word_idx": p.current_word_idx, "correct": p.correct,
                "wrong": p.wrong, "total_time_ms": p.total_time_ms,
                "points": p.points, "streak": p.streak, "finished": p.finished,
            }
            for p in room.players.values()
        ],
        "spectators": [
            {"user_id": s.user_id, "nickname": s.nickname, "online": s.online}
            for s in room.spectators.values()
        ],
    }


def _mask_for_spectators(event: dict) -> dict:
    """听写/过关阶段的题目对观众隐藏英文原词,防止场边报答案。"""
    if event.get("type") == "question_pushed" and event.get("phase") in ("dictation", "exam"):
        word = dict(event.get("word") or {})
        word["word"] = ""
        return {**event, "word": word, "masked": True}
    return event


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
            if cur_after is None:
                _cancel_room_timers(room.room_id)
                await _notify_room_closed(cur)
            else:
                if cur_after.host_id != old_host:
                    await _broadcast(cur_after, {"type": "host_changed", "new_host_id": cur_after.host_id})
                await _broadcast_room_state(cur_after)

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
                    await _broadcast_room_state(room)
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
        except Exception as e:
            logger.warning(
                "PK broadcast send failed: room_id=%d user_id=%d error=%s",
                room.room_id, uid, e,
            )
            failed_user_ids.append(uid)

    # 观众:题目脱敏后发送;发送失败直接移除(观众无重连窗口)
    spec_event = _mask_for_spectators(event)
    for uid, ss in list(room.spectators.items()):
        if uid == exclude or ss.ws is None:
            continue
        try:
            await ss.ws.send_json(spec_event)
        except Exception as e:
            logger.warning(
                "PK spectator send failed: room_id=%d user_id=%d error=%s",
                room.room_id, uid, e,
            )
            room.spectators.pop(uid, None)

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


async def _broadcast_room_state(room):
    """成员/在线状态变化后同步全房快照——等待室的玩家列表靠它实时刷新。"""
    await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})


async def _notify_room_closed(room):
    """房间解散(最后一名玩家离开):通知并断开所有观众。"""
    for uid, ss in list(room.spectators.items()):
        if ss.ws is None:
            continue
        try:
            await ss.ws.send_json({"type": "room_closed", "message": "房间已解散"})
            await ss.ws.close()
        except Exception:
            pass
    room.spectators.clear()


def _cancel_timer(room_id: int, word_idx: int, phase: str):
    key = (room_id, word_idx, phase)
    task = _TIMEOUT_TASKS.pop(key, None)
    if task and not task.done():
        task.cancel()


def _cancel_room_timers(room_id: int) -> None:
    """Cancel all pending per-question timers for a room (called on abandon/finish)."""
    keys_to_remove = [k for k in _TIMEOUT_TASKS if k[0] == room_id]
    for key in keys_to_remove:
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


async def _record_tournament_result(db, room, room_db_id: int, ranking: list[dict]) -> None:
    """把一场晋级赛对局的胜负 + 双方数据交给 tournament service 记录并推进赛程。

    胜者判定:优先用最终榜首(rank_players 已按 得分>用时 排好);
    掉线/一人未答完也能判——榜首就是赢家。平局(极罕见)按用时少者胜,
    rank_players 已内建该规则,取 rank==1 即可。
    """
    stats: dict[int, dict] = {}
    winner_id = None
    for r in ranking:
        uid = r.get("user_id")
        if uid is None:
            continue
        stats[uid] = {
            "correct": r.get("correct", 0),
            "score": r.get("final_score", r.get("points", 0)),
            "time_ms": r.get("total_time_ms", 0),
        }
        if r.get("rank") == 1:
            winner_id = uid
    # 兜底:ranking 里没有明确 rank==1 时,取 players 里得分最高者
    if winner_id is None and room.players:
        winner_id = max(room.players.values(), key=lambda p: (p.points, -p.total_time_ms)).user_id
        stats.setdefault(winner_id, {"correct": 0, "score": 0, "time_ms": 0})
    await tsvc.record_match_result(
        db, room.tournament_match_id,
        winner_id=winner_id, stats=stats, room_db_id=room_db_id,
    )
    logger.info(
        "晋级赛对局结果已记录: match=%s winner=%s",
        room.tournament_match_id, winner_id,
    )


async def _process_events(room, events: list[dict], word_lookup: dict):
    for event in events:
        await _broadcast(room, event)
        if event["type"] == "question_pushed":
            _schedule_timer(room, event["word_idx"], event["phase"], word_lookup)
        elif event["type"] == "question_settled":
            # 用事件里记录的本题阶段取消计时器——阶段切换时 room.current_phase 已是新阶段
            _cancel_timer(room.room_id, event["word_idx"], event.get("phase", room.current_phase))
        elif event["type"] == "game_finished":
            logger.info(
                "PK game finished: room_id=%d players=%d",
                room.room_id, len(room.players),
            )
            async with AsyncSessionLocal() as db:
                room_db_id = await persist_finished_room(room, db)
                # 晋级赛对局:回写结果并自动推进赛程(出线/下一轮/冠军)
                if room.tournament_match_id is not None:
                    try:
                        await _record_tournament_result(db, room, room_db_id, event.get("ranking", []))
                    except Exception:
                        logger.exception(
                            "回写晋级赛结果失败: match=%s room=%d",
                            room.tournament_match_id, room.room_id,
                        )
            for uid in list(room.players.keys()):
                manager.USER_ACTIVE.pop(uid, None)
            manager.INVITE_INDEX.pop(room.invite_code, None)
            manager.ROOMS.pop(room.room_id, None)
            _cancel_room_timers(room.room_id)


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
    if room is None or (user.id not in room.players and user.id not in room.spectators):
        await ws.accept()
        await ws.send_json({"type": "error", "code": "ROOM_NOT_FOUND", "message": "Room not found"})
        # 非 1000 关闭:让客户端保留自动重连能力(观众掉线被移除后,
        # 前端会重新登记观战,下一次重连即可成功)
        await ws.close(code=4004, reason="ROOM_NOT_FOUND")
        return

    await ws.accept()

    # ---------- 观众连接:只收广播不作答 ----------
    if user.id not in room.players:
        s = room.spectators[user.id]
        if s.ws is not None and s.ws is not ws:
            try:
                await s.ws.close(code=1000, reason="REPLACED_BY_NEW_CONNECTION")
            except Exception:
                pass
        s.ws = ws
        s.online = True
        logger.info("PK spectator WS connected: room_id=%d user_id=%d", room.room_id, user.id)
        await _broadcast_room_state(room)  # 全房刷新观众数(自己也借此拿到快照)
        if room.status == "playing" and room.word_ids:
            cur_id = room.current_word_id
            cur_word = room.word_lookup.get(cur_id)
            await ws.send_json(_mask_for_spectators({
                "type": "question_pushed",
                "word_idx": room.current_word_idx,
                "phase": room.current_phase,
                "word": {
                    "id": getattr(cur_word, "id", None),
                    "word": getattr(cur_word, "word", ""),
                    "translation": getattr(cur_word, "translation", ""),
                },
                "points": room.points_for_word(cur_id),
            }))
        try:
            while True:
                msg = await ws.receive_json()
                if not isinstance(msg, dict):
                    continue
                mtype = msg.get("type")
                if mtype == "leave_room":
                    break
                # heartbeat 收下即可;submit/start/kick 等一律忽略(观众无权)
        except WebSocketDisconnect:
            pass
        finally:
            if s.ws is ws:  # 仅当仍是本连接时清理;已被新连接替换则不动
                s.ws = None
                s.online = False
                manager.leave_spectator(room.room_id, user.id)
                logger.info("PK spectator WS disconnected: room_id=%d user_id=%d", room.room_id, user.id)
                cur = manager.get_room(room.room_id)
                if cur is not None:
                    await _broadcast_room_state(cur)
        return

    # ---------- 玩家连接 ----------
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
    logger.info(
        "PK WS connected: room_id=%d user_id=%d",
        room.room_id, user.id,
    )

    _ensure_heartbeat_watchdog()

    # 广播给全房(含自己):新玩家加入/重连上线,等待室所有人的玩家列表都要刷新
    await _broadcast_room_state(room)
    await _broadcast(room, {"type": "player_reconnected", "user_id": user.id}, exclude=user.id)

    # 中途重连:房间已有词但共享词表为空时补装载(正常开局时由 start_game 装载)
    if room.word_ids and not room.word_lookup:
        room.word_lookup.update(await _load_word_lookup(room.word_ids))

    # 对局中重连:单发当前题,否则客户端会卡在"等待下一题"直到本题结算
    if room.status == "playing" and room.word_ids:
        cur_id = room.current_word_id
        cur_word = room.word_lookup.get(cur_id)
        await ws.send_json({
            "type": "question_pushed",
            "word_idx": room.current_word_idx,
            "phase": room.current_phase,
            "word": {
                "id": getattr(cur_word, "id", None),
                "word": getattr(cur_word, "word", ""),
                "translation": getattr(cur_word, "translation", ""),
            },
            "points": room.points_for_word(cur_id),
        })
        # 本题已作答过 → 补发"已作答"状态,让客户端进入等待其他玩家的界面
        if user.id in room.answers.get(room.current_word_idx, {}):
            await ws.send_json({
                "type": "player_answered",
                "user_id": user.id,
                "word_idx": room.current_word_idx,
            })

    explicit_leave = False
    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")
            if mtype == "heartbeat":
                # 收到心跳即在线:watchdog 误标离线(如手机短暂锁屏)后靠这里恢复,
                # 否则 90s 清退会把活着的玩家踢出房间
                p.last_heartbeat_at = datetime.utcnow()
                p.disconnected_at = None
                if not p.online:
                    p.online = True
                    await _broadcast(room, {"type": "player_reconnected", "user_id": user.id}, exclude=user.id)
                    await _broadcast_room_state(room)
            elif mtype == "start_game" and user.id == room.host_id:
                if room.status == "waiting":
                    online_ids = [uid for uid, ps in room.players.items() if ps.online]
                    if len(online_ids) < 2:
                        await ws.send_json({
                            "type": "error",
                            "code": "NOT_ENOUGH_PLAYERS",
                            "message": "至少需要 2 名在线玩家",
                        })
                    elif room.fixed_words and room.word_ids:
                        # 晋级赛房:词表建房时已按赛事单元预置,不走"共同背过"交集
                        room.word_lookup.clear()
                        room.word_lookup.update(await _load_word_lookup(room.word_ids))
                        room.status = "playing"
                        room.started_at = datetime.utcnow()
                        logger.info(
                            "PK tournament game started: room_id=%d match=%s words=%d",
                            room.room_id, room.tournament_match_id, len(room.word_ids),
                        )
                        first_id = room.word_ids[0]
                        first_word = room.word_lookup.get(first_id)
                        push_event = {
                            "type": "question_pushed", "word_idx": 0,
                            "phase": "classify",
                            "word": {
                                "id": getattr(first_word, "id", None),
                                "word": getattr(first_word, "word", ""),
                                "translation": getattr(first_word, "translation", ""),
                            },
                            "points": room.points_for_word(first_id),
                        }
                        await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
                        await _broadcast(room, push_event)
                        _schedule_timer(room, 0, "classify", room.word_lookup)
                    else:
                        # 全库取「所有在线玩家都背过」的交集,再随机抽 word_count 个
                        learned = await _load_learned_for_room(online_ids)
                        common = set.intersection(
                            *(learned.get(uid, set()) for uid in online_ids)
                        )
                        if len(common) < MIN_COMMON_WORDS:
                            await ws.send_json({
                                "type": "error",
                                "code": "NOT_ENOUGH_COMMON_WORDS",
                                "common_count": len(common),
                                "message": (
                                    f"大家共同背过的单词只有 {len(common)} 个"
                                    f"(至少需要 {MIN_COMMON_WORDS} 个),"
                                    "先去学习流程多背一些单词再来 PK 吧"
                                ),
                            })
                        else:
                            chosen = random.sample(
                                sorted(common), min(room.word_count, len(common))
                            )
                            room.word_ids = chosen
                            room.word_points = await _load_word_points_for_room(chosen)
                            room.word_lookup.clear()
                            room.word_lookup.update(await _load_word_lookup(chosen))
                            room.status = "playing"
                            room.started_at = datetime.utcnow()
                            logger.info(
                                "PK game started: room_id=%d players=%d common_words=%d chosen=%d",
                                room.room_id, len(online_ids), len(common), len(chosen),
                            )
                            first_id = room.word_ids[0]
                            first_word = room.word_lookup.get(first_id)
                            push_event = {
                                "type": "question_pushed", "word_idx": 0,
                                "phase": "classify",
                                "word": {
                                    "id": getattr(first_word, "id", None),
                                    "word": getattr(first_word, "word", ""),
                                    "translation": getattr(first_word, "translation", ""),
                                },
                                "points": room.points_for_word(first_id),
                            }
                            await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
                            await _broadcast(room, push_event)
                            _schedule_timer(room, 0, "classify", room.word_lookup)
            elif mtype == "submit_answer":
                # 客户端消息不可信:类型不对直接丢弃,不让异常炸断连接
                try:
                    word_idx = int(msg.get("word_idx"))
                    time_spent_ms = int(msg.get("time_spent_ms", 0))
                except (TypeError, ValueError):
                    continue
                payload = msg.get("payload", {})
                if not isinstance(payload, dict):
                    continue
                events = engine.submit_answer(
                    room=room, user_id=user.id,
                    word_idx=word_idx, phase=msg.get("phase"),
                    payload=payload,
                    time_spent_ms=time_spent_ms,
                    word_lookup=room.word_lookup,
                )
                await _process_events(room, events, room.word_lookup)
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
                    await _broadcast_room_state(room)
            elif mtype == "leave_room":
                explicit_leave = True
                break
    except WebSocketDisconnect:
        pass
    finally:
        replaced = p.ws is not ws  # 已被同一用户的新连接接管
        if not replaced:
            p.ws = None
            p.online = False
            p.disconnected_at = datetime.utcnow()
        logger.info(
            "PK WS disconnected: room_id=%d user_id=%d explicit=%s replaced=%s",
            room.room_id, user.id, explicit_leave, replaced,
        )
        if explicit_leave:
            # 主动离开:立即出房并释放 USER_ACTIVE,允许马上再开/加入下一局
            # (即使已被新连接替换,用户的离开意图依然生效)
            old_host = room.host_id
            manager.leave_room(room.room_id, user.id)
            after = manager.get_room(room.room_id)
            if after is None:
                _cancel_room_timers(room.room_id)
                await _notify_room_closed(room)
            else:
                await _broadcast(after, {"type": "player_left", "user_id": user.id})
                if after.host_id != old_host:
                    await _broadcast(after, {"type": "host_changed", "new_host_id": after.host_id})
                await _broadcast_room_state(after)
        elif not replaced:
            # 意外断线:保留 90s 重连窗口
            await _broadcast(room, {"type": "player_disconnected", "user_id": user.id})
            await _broadcast_room_state(room)
            _schedule_disconnect_cleanup(room, user.id)
