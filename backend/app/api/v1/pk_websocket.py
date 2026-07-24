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
from app.services.pk.engine import PHASE_TIMEOUT_MS, select_words_with_fallback, select_words_for_player, _question_event
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
        user = await db.get(User, user_id)
    if user is not None:
        # 多租户: 自建鉴权路径也要设机构上下文,否则该WS连接内的DB查询不被过滤
        from app.core.tenancy import current_org_id
        current_org_id.set(None if user.role == "admin" else user.org_id)
    return user


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
        "mode": room.mode,
        "team_count": room.team_count,
        "host_is_player": room.host_is_player,
        # 全场倒计时(并行竞速):前端据 deadline_at 显示倒数
        "countdown_seconds": room.countdown_seconds,
        "deadline_at": room.deadline_at.isoformat() + "Z" if room.deadline_at else None,
        "players": [
            {
                "user_id": p.user_id, "nickname": p.nickname, "online": p.online,
                "current_word_idx": p.current_word_idx, "correct": p.correct,
                "wrong": p.wrong, "total_time_ms": p.total_time_ms,
                "points": p.points, "streak": p.streak, "finished": p.finished,
                "team": p.team, "n_words": p.n_words,  # 该玩家私有词表大小(算个人进度%)
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
        masked = {**event, "word": word, "masked": True}
        # 过关选择题的选项里可能含正确英文词/释义,一并抹掉防止场边报答案
        masked.pop("options", None)
        return masked
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
            # 对局中不驱逐:保留玩家(离线状态)与其已攒得分,否则分组赛队伍总分会凭空缩水,
            # 且掉线玩家永远回不来。只在等待室阶段清退空出名额。
            if cur.status == "playing":
                return
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


def _schedule_host_console_cleanup(room, host_id: int):
    """教师控制台断开(切标签页/关网页)后:不再自动回收房间。

    产品决策(2026-07):房间只能由教师在大厅「我的房间」里主动删除,或对局倒计时结束
    自然收场。教师切走网页回来还能在列表里看到并重新进入,不会"切个网页房间就没了"。
    因此这里保留函数(调用点不变)但不做任何回收;USER_ACTIVE 的占用由教师手动删除
    (DELETE /rooms/{id})或再次建房时的孤儿房回收(manager.create_room)释放。
    """
    return  # no-op:见上,房间生命周期改为教师手动掌控


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
                    _cancel_player_timers(room.room_id, uid)  # 掉线暂停其题目计时器,重连再起
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

    # 教师控制台(非参赛房主):收全部广播,不脱敏(裁判视角)。发送失败标离线不影响对局。
    if room.host_ws is not None:
        try:
            await room.host_ws.send_json(event)
        except Exception as e:
            logger.warning(
                "PK host-console send failed: room_id=%d host_id=%d error=%s",
                room.room_id, room.host_id, e,
            )
            room.host_ws = None
            room.host_online = False

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


_TIMEOUT_TASKS: dict[tuple[int, int, int, str], asyncio.Task] = {}  # (room_id, user_id, word_idx, phase)
_COUNTDOWN_TASKS: dict[int, asyncio.Task] = {}  # room_id → 全场倒计时任务


async def _send_to_player(room, uid: int, event: dict):
    """定向把事件发给某个玩家本人,并镜像给教师控制台(裁判视角看全场)。
    发送失败标该玩家离线并排定清理。"""
    ps = room.players.get(uid)
    if ps is not None and ps.ws is not None:
        try:
            await ps.ws.send_json(event)
        except Exception as e:
            logger.warning("PK direct send failed: room=%d uid=%d err=%s", room.room_id, uid, e)
            ps.ws = None
            ps.online = False
            ps.disconnected_at = datetime.utcnow()
            _schedule_disconnect_cleanup(room, uid)
    # 镜像给教师控制台(不脱敏,教师要看到每个学生的题和进度)
    if room.host_ws is not None:
        try:
            await room.host_ws.send_json(event)
        except Exception:
            room.host_ws = None
            room.host_online = False


async def _broadcast_room_state(room):
    """成员/在线状态变化后同步全房快照——等待室的玩家列表靠它实时刷新。"""
    await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})


async def teardown_room(room_id: int, message: str = "老师已删除本房间") -> bool:
    """教师从大厅主动删除房间(REST 入口):取消计时器 → 通知并断开所有在场成员 → 清房。

    返回是否真的删了(房间不存在返回 False,供路由回 404)。与教师控制台 close_room
    同效,但不需要教师此刻连着该房的控制台 WS。
    """
    room = manager.get_room(room_id)
    if room is None:
        return False
    _cancel_room_timers(room_id)
    try:
        await _broadcast(room, {"type": "room_closed", "message": message})
    except Exception:
        pass
    # 断开仍连着的玩家 / 教师控制台 WS,避免其自动重连又把房间"复活"感知
    for ps in list(room.players.values()):
        if ps.ws is not None:
            try:
                await ps.ws.close(code=1000, reason="ROOM_DELETED")
            except Exception:
                pass
    if room.host_ws is not None:
        try:
            await room.host_ws.close(code=1000, reason="ROOM_DELETED")
        except Exception:
            pass
    await _notify_room_closed(room)
    manager.close_room(room_id)
    logger.info("PK room deleted by teacher via REST: room_id=%d", room_id)
    return True


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


def _cancel_timer(room_id: int, user_id: int, word_idx: int, phase: str):
    key = (room_id, user_id, word_idx, phase)
    task = _TIMEOUT_TASKS.pop(key, None)
    if task and not task.done():
        task.cancel()


def _cancel_player_timers(room_id: int, user_id: int) -> None:
    """取消某玩家在某房的所有待触发计时器(掉线/离开/被踢时)。"""
    keys = [k for k in _TIMEOUT_TASKS if k[0] == room_id and k[1] == user_id]
    for key in keys:
        task = _TIMEOUT_TASKS.pop(key, None)
        if task and not task.done():
            task.cancel()


def _cancel_room_timers(room_id: int) -> None:
    """取消全房所有计时器(含每人题目计时器 + 全场倒计时)。abandon/finish 时调。"""
    keys_to_remove = [k for k in _TIMEOUT_TASKS if k[0] == room_id]
    for key in keys_to_remove:
        task = _TIMEOUT_TASKS.pop(key, None)
        if task and not task.done():
            task.cancel()
    cd = _COUNTDOWN_TASKS.pop(room_id, None)
    if cd and not cd.done():
        cd.cancel()


def _schedule_player_timer(room, user_id: int, word_idx: int, phase: str, word_lookup: dict):
    """为某玩家的某道题起超时计时器;超时则该玩家该题记错、推进、推下一题。"""
    _cancel_timer(room.room_id, user_id, word_idx, phase)
    timeout_ms = PHASE_TIMEOUT_MS.get(phase, 30_000)

    async def _run():
        try:
            await asyncio.sleep(timeout_ms / 1000)
            events = engine.force_timeout(room, user_id, word_idx, phase, word_lookup)
            await _process_events(room, events, word_lookup)
        except asyncio.CancelledError:
            pass

    _TIMEOUT_TASKS[(room.room_id, user_id, word_idx, phase)] = asyncio.create_task(_run())


def _schedule_countdown(room, word_lookup: dict):
    """全场倒计时:到 deadline 强制 finalize_room,广播 game_finished。"""
    async def _run():
        try:
            secs = max(1, int(room.countdown_seconds))
            await asyncio.sleep(secs)
            events = engine.finalize_room(room)
            if events:
                await _process_events(room, events, word_lookup)
            else:
                # 空房(全员离场)finalize 不产结算:直接回收房间与计时器,不落假对局
                _cancel_room_timers(room.room_id)
                for uid in list(room.players.keys()):
                    manager.USER_ACTIVE.pop(uid, None)
                if not room.host_is_player:
                    manager.USER_ACTIVE.pop(room.host_id, None)
                manager.INVITE_INDEX.pop(room.invite_code, None)
                manager.ROOMS.pop(room.room_id, None)
        except asyncio.CancelledError:
            pass

    _COUNTDOWN_TASKS[room.room_id] = asyncio.create_task(_run())


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
        target = event.get("target_user_id")
        etype = event["type"]
        # 定向事件(某玩家的题/结算)只发本人 + 镜像教师;全房事件(榜单/终局/状态)照旧广播
        if target is not None:
            await _send_to_player(room, target, event)
        else:
            await _broadcast(room, event)

        if etype == "question_pushed" and target is not None:
            # 为该玩家这道题起超时计时器(先取消他上一题的,避免重叠)
            _cancel_player_timers(room.room_id, target)
            _schedule_player_timer(room, target, event["word_idx"], event["phase"], word_lookup)
        elif etype == "game_finished":
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
            # 教师房主不在 players 里,单独释放其 USER_ACTIVE,否则同一教师无法再建房
            if not room.host_is_player:
                manager.USER_ACTIVE.pop(room.host_id, None)
            manager.INVITE_INDEX.pop(room.invite_code, None)
            manager.ROOMS.pop(room.room_id, None)
            _cancel_room_timers(room.room_id)


async def _push_first_question(room) -> None:
    """开局(并行竞速):每人词表已就绪,广播房间状态 → 给每个在线玩家各推其第一题
    (定向)并起个人计时器 → 启动全场倒计时。"""
    from app.services.pk.engine import _question_event
    room.status = "playing"
    room.started_at = datetime.utcnow()
    room.deadline_at = room.started_at + timedelta(seconds=max(1, int(room.countdown_seconds)))
    await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
    for uid, ps in list(room.players.items()):
        # 必须真正连着 WS 才推题/起计时器:仅 online=True 但 ws=None 的是"join 了没连"的
        # 幽灵玩家,给他起计时器会 force_timeout 一路自动记错推进,污染对局。重连时会补发其当前题。
        if ps.ws is None or not ps.online or not ps.word_ids:
            continue
        evt = _question_event(room, ps, room.word_lookup)
        await _send_to_player(room, uid, evt)
        _schedule_player_timer(room, uid, ps.current_word_idx, ps.current_phase, room.word_lookup)
    _schedule_countdown(room, room.word_lookup)


async def _try_start_game(room, requester_ws) -> None:
    """开局逻辑(房主/教师控制台共用)。requester_ws 用于把校验失败的 error 回给发起者。

    分组赛额外要求:每个队至少 1 名在线玩家,否则空队无意义。
    自由房选词走「共同背过」交集,不足 word_count 时用其余学过的词补齐(不再直接卡死)。
    """
    if room.status != "waiting":
        return
    # 真正连着 WS 的才算在场:防止"join 了但没连 WS"的玩家被算进开局人数(会变幽灵对手)
    online_ids = [uid for uid, ps in room.players.items() if ps.online and ps.ws is not None]
    if len(online_ids) < 2:
        await requester_ws.send_json({
            "type": "error", "code": "NOT_ENOUGH_PLAYERS",
            "message": "至少需要 2 名已进入房间的玩家",
        })
        return

    if room.mode == "team":
        online_teams = {room.players[uid].team for uid in online_ids}
        needed = set(range(1, room.team_count + 1))
        empty = sorted(needed - online_teams)
        if empty:
            await requester_ws.send_json({
                "type": "error", "code": "EMPTY_TEAM",
                "message": f"第 {'、'.join(str(t) for t in empty)} 队还没有在线玩家,先让每队都有人再开始",
            })
            return

    if room.fixed_words and room.word_ids:
        # 晋级赛(1v1 淘汰赛):公平第一 → 双方考「同一批词」(从赛事单元池随机抽 word_count 个),
        # 不各考各的。这样同场同题、胜负可横比,不会因学段/词不同引起争议。
        pool = list(room.word_ids)
        random.shuffle(pool)
        shared = pool[:room.word_count]
        if len(shared) < min(room.word_count, MIN_COMMON_WORDS):
            await requester_ws.send_json({
                "type": "error", "code": "NOT_ENOUGH_COMMON_WORDS",
                "message": "赛事单元词量不足,凑不齐一局",
            })
            return
        for uid in online_ids:
            ps = room.players[uid]
            ps.word_ids = list(shared)   # 双方同一份词表
            ps.current_word_idx = 0
            ps.answers = []
            ps.finished = False
        room.word_ids = list(shared)
    else:
        # 自由房 / 分组赛:每人各抽「他自己背过的词」word_count 个(小初高混场也公平)
        learned = await _load_learned_for_room(online_ids, None)
        all_word_ids: set[int] = set()
        too_few: list[int] = []
        for uid in online_ids:
            ps = room.players[uid]
            mine = learned.get(uid, set())
            picked = select_words_for_player(mine, room.word_count, random, fill_pool=mine)
            if len(picked) < min(room.word_count, MIN_COMMON_WORDS):
                too_few.append(uid)
            ps.word_ids = picked
            ps.current_word_idx = 0
            ps.answers = []
            ps.finished = False
            all_word_ids |= set(picked)

        if not all_word_ids or len(too_few) == len(online_ids):
            await requester_ws.send_json({
                "type": "error", "code": "NOT_ENOUGH_COMMON_WORDS",
                "message": "在线玩家背过的单词太少,凑不齐一局。先让学生去学习流程多背一些单词再来 PK 吧",
            })
            return
        room.word_ids = list(all_word_ids)   # 快照/落库/教师聚合用(全房并集)

    # 装载 word_lookup / word_points(word_id→Word / 基础分,全房共享一份)
    room.word_points = await _load_word_points_for_room(room.word_ids)
    room.word_lookup.clear()
    room.word_lookup.update(await _load_word_lookup(room.word_ids))
    logger.info(
        "PK race game started: room_id=%d mode=%s fixed=%s players=%d words=%d countdown=%ds",
        room.room_id, room.mode, room.fixed_words, len(online_ids), len(room.word_ids), room.countdown_seconds,
    )
    await _push_first_question(room)


async def _handle_host_console(ws: WebSocket, room, user) -> None:
    """教师控制台:组织者视角。收全场广播,能开局/踢人/调队/解散,但不作答不计分。

    教师断开不解散房间(学生可能还在等待/对局中);教师主动 close_room 才解散。
    """
    if room.host_ws is not None and room.host_ws is not ws:
        try:
            await room.host_ws.close(code=1000, reason="REPLACED_BY_NEW_CONNECTION")
        except Exception:
            pass
    room.host_ws = ws
    room.host_online = True
    logger.info("PK host console connected: room_id=%d host_id=%d", room.room_id, user.id)

    # 首帧发全房快照。并行竞速下没有「全场当前题」,教师监控靠 room_state(含每人进度)
    # + 后续镜像的各玩家 question_pushed/settled/live_ranking 实时拼出多人进度面板。
    await ws.send_json({"type": "room_state", "room": _snapshot_dict(room)})
    if room.status == "playing" and room.word_ids and not room.word_lookup:
        room.word_lookup.update(await _load_word_lookup(room.word_ids))

    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")
            if mtype == "heartbeat":
                room.host_online = True
            elif mtype == "start_game":
                await _try_start_game(room, ws)
            elif mtype == "set_team":
                # 等待室手动调队(分组赛):{type:set_team, user_id, team}
                try:
                    after = manager.set_player_team(
                        room.room_id, int(msg.get("user_id")), int(msg.get("team")),
                    )
                except (TypeError, ValueError):
                    after = None
                if after is not None:
                    await _broadcast_room_state(after)
            elif mtype == "kick_player":
                target = msg.get("user_id")
                if target in room.players:
                    target_ws = room.players[target].ws
                    _cancel_player_timers(room.room_id, target)
                    manager.leave_room(room.room_id, target)
                    if target_ws:
                        try:
                            await target_ws.send_json({"type": "player_kicked", "user_id": target})
                            await target_ws.close()
                        except Exception:
                            pass
                    cur = manager.get_room(room.room_id)
                    if cur is not None:
                        await _broadcast(cur, {"type": "player_kicked", "user_id": target})
                        await _broadcast_room_state(cur)
            elif mtype == "close_room":
                # 教师主动解散:通知玩家并断开,清理房间
                _cancel_room_timers(room.room_id)
                try:
                    await _broadcast(room, {"type": "room_closed", "message": "老师已结束本场对战"})
                except Exception:
                    pass
                await _notify_room_closed(room)
                manager.close_room(room.room_id)
                break
            elif mtype == "leave_room":
                break
    except WebSocketDisconnect:
        pass
    finally:
        if room.host_ws is ws:  # 仅当仍是本连接时清理;已被新连接替换则不动
            room.host_ws = None
            room.host_online = False
            # 教师直接关标签页(没点解散)会留下孤儿房 + 永久占用 USER_ACTIVE,导致再也建不了房。
            # 给一个重连宽限期:到点若教师仍未回来且房间还没开打(或已无在线玩家),
            # 就解散房间释放占用。对局进行中(有在线玩家)则保留,教师可重连回控制台。
            _schedule_host_console_cleanup(room, user.id)
        logger.info("PK host console disconnected: room_id=%d host_id=%d", room.room_id, user.id)


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
    # 非参赛房主(教师控制台)也放行握手:user.id==host_id 且房主不下场
    is_host_console = (
        room is not None and user.id == room.host_id and not room.host_is_player
    )
    if room is None or (
        not is_host_console
        and user.id not in room.players
        and user.id not in room.spectators
    ):
        await ws.accept()
        await ws.send_json({"type": "error", "code": "ROOM_NOT_FOUND", "message": "Room not found"})
        # 非 1000 关闭:让客户端保留自动重连能力(观众掉线被移除后,
        # 前端会重新登记观战,下一次重连即可成功)
        await ws.close(code=4004, reason="ROOM_NOT_FOUND")
        return

    await ws.accept()

    # ---------- 教师控制台连接:组织者视角,收全场广播,可开局/踢人/解散,但不答题不计分 ----------
    if is_host_console:
        await _handle_host_console(ws, room, user)
        return

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
        # 并行竞速下无「全场当前题」,观众看实时榜(随广播的 live_ranking 更新),不补单题
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

    # 对局中重连(并行竞速):单发「我自己的当前题」(按个人游标),并重置我这题的计时器,
    # 否则客户端卡在"等待下一题"。不能读 room.current_word_idx(那是全房聚合,已非个人进度)。
    if room.status == "playing" and p.word_ids:
        await ws.send_json(_question_event(room, p, room.word_lookup))
        _schedule_player_timer(room, user.id, p.current_word_idx, p.current_phase, room.word_lookup)

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
                    # watchdog 曾误标离线并取消了他的题目计时器;复活后要补发当前题并重挂计时器,
                    # 否则这道题永不超时、个人进度冻结到全场倒计时结束(与换新连接的重连路径保持一致)
                    if room.status == "playing" and p.word_ids:
                        await _send_to_player(room, user.id, _question_event(room, p, room.word_lookup))
                        _schedule_player_timer(room, user.id, p.current_word_idx, p.current_phase, room.word_lookup)
            elif mtype == "start_game" and user.id == room.host_id and room.host_is_player:
                # 房主下场的房(学生自建/晋级赛):房主玩家亲自开局
                await _try_start_game(room, ws)
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
                    _cancel_player_timers(room.room_id, target)
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
            _cancel_player_timers(room.room_id, user.id)  # 停其题目计时器,重连再起
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
