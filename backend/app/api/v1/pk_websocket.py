"""PK 竞技场 WebSocket 端点。"""
from __future__ import annotations
import asyncio
import json
import logging
import random
from typing import Callable
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
from app.services.pk.engine import PHASE_TIMEOUT_MS, select_words_with_fallback, select_words_for_player, fill_with_repeats, _question_event
from app.api.v1.pk_routes import load_learned_word_ids, load_word_points
from app.services import online_tracker

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
    """按词查学段难度分。⚠️ 已退出 live 计分链路(满分统一 词数×100,见 score.py),
    保留仅因多个测试以打桩本函数为基建;勿在业务代码里重新调用。"""
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
        # 队号 → 队名(班级名);分组赛按班级自动建队,前端一律显示队名而非"第N队"
        "team_names": {str(t): n for t, n in room.team_names.items()},
        "host_is_player": room.host_is_player,
        # 同题公平赛:全员同一批词(等待室/结算页展示用)
        "same_words": room.same_words,
        # 考试范围描述(教师建房指定书/单元才有;等待室展示)
        "scope_desc": room.scope_desc or None,
        # 全场倒计时(并行竞速):前端据 deadline_at 显示倒数
        "countdown_seconds": room.countdown_seconds,
        "deadline_at": room.deadline_at.isoformat() + "Z" if room.deadline_at else None,
        "players": [
            {
                "user_id": p.user_id, "nickname": p.nickname, "online": p.online,
                "correct": p.correct,
                "wrong": p.wrong, "total_time_ms": p.total_time_ms,
                "points": p.points, "streak": p.streak, "finished": p.finished,
                "team": p.team, "n_words": p.n_words,
                # 掌握赛进度:阶段 + 第几组 + 进度百分比(算实时榜/结算排名)
                "stage": p.stage, "group_idx": p.gi, "group_total": p.group_total,
                "progress": p.compute_progress(),
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


def _dumps(payload: dict) -> str:
    """与 Starlette send_json 同款序列化。预先转成文本,好在多收件人间复用同一份字节。"""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


async def _broadcast(
    room,
    event: dict,
    exclude: int | None = None,
    *,
    per_player: Callable[[int], str] | None = None,
):
    """
    Broadcast an event to all players except `exclude`. If a send fails,
    mark the player as disconnected and schedule cleanup. Notifications about
    the failure are deferred until iteration completes (avoid recursive sends).

    per_player(uid) -> 已序列化的 JSON 文本:可选的「按收件人定制载荷」钩子
    (实时榜用它把全量榜单裁成该玩家看得到的那部分)。不传就所有玩家收同一份。
    定制只是载荷层的事,失联检测/清理、教师镜像、观众脱敏全部共用这一条路径 ——
    曾经为了裁剪另写一个并行的 fan-out,结果漏掉了失联清理,
    `live_ranking` 成了唯一不会把死连接标离线的广播。
    钩子返回文本而不是 dict,是为了让调用方能自己复用序列化结果
    (榜单只有"前N名"和"前N名+我"两种形状,不该按人 dumps 200 次)。

    另:send_json 内部每次都会 json.dumps 一遍,200 人房就是同一份数据序列化 200 次。
    这里先 dumps 成文本再 send_text,同载荷只序列化一次。
    """
    failed_user_ids: list[int] = []
    common_text = _dumps(event) if per_player is None else None

    for uid, ps in list(room.players.items()):
        if uid == exclude or ps.ws is None:
            continue
        payload_text = common_text if common_text is not None else per_player(uid)
        try:
            await ps.ws.send_text(payload_text)
        except Exception as e:
            logger.warning(
                "PK broadcast send failed: room_id=%d user_id=%d error=%s",
                room.room_id, uid, e,
            )
            failed_user_ids.append(uid)

    # 教师控制台(非参赛房主):收全部广播,不脱敏(裁判视角)。发送失败标离线不影响对局。
    if room.host_ws is not None:
        try:
            await room.host_ws.send_text(_dumps(event))
        except Exception as e:
            logger.warning(
                "PK host-console send failed: room_id=%d host_id=%d error=%s",
                room.room_id, room.host_id, e,
            )
            room.host_ws = None
            room.host_online = False

    # 观众:题目脱敏后发送;发送失败直接移除(观众无重连窗口)
    if room.spectators:
        spec_text = _dumps(_mask_for_spectators(event))
        for uid, ss in list(room.spectators.items()):
            if uid == exclude or ss.ws is None:
                continue
            try:
                await ss.ws.send_text(spec_text)
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


_TIMEOUT_TASKS: dict[tuple[int, int, int], asyncio.Task] = {}  # (room_id, user_id, q_seq)
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


async def _broadcast_room_state(room, *, immediate: bool = False):
    """
    成员/在线状态变化后同步全房快照——等待室的玩家列表靠它实时刷新。

    ⚠️ 这是大房间的头号流量源(2026-07-26 实测):100 人陆续进房 → 每次 join 都
    向全房广播一份含全部玩家的快照 → 100 次 × 100 人 × 随人数变大的 payload,
    实测 100 人房 60 秒里 room_state 占 328MB(全部流量的 97%),
    远超实时榜。和实时榜一样合并推送:窗口内多次成员变动只发最后一份。
    快照是"当前状态"不是"增量",合并不丢信息。

    immediate=True 用于必须立刻同步的场合(开局、单人首次连上要拿到初始快照)。
    """
    if immediate:
        _clear_state_throttle(room.room_id)
        await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
        return
    # 节流路径不在这里建快照:窗口内可能被调用几十次,建了也会被丢掉,
    # 而 _snapshot_dict 要遍历全部玩家(200 人房约 5.5KB),白算几十遍
    _schedule_state_flush(room)


# 成员变动合并推送:与榜单同一套思路,窗口随人数放宽
STATE_THROTTLE_MS = 300
STATE_THROTTLE_PER_PLAYER_MS = 15
STATE_THROTTLE_MAX_MS = 2000
_STATE_TASKS: dict[int, asyncio.Task] = {}


def _state_throttle_ms(room) -> int:
    n = len(room.players) + len(room.spectators)
    return min(STATE_THROTTLE_MAX_MS,
               max(STATE_THROTTLE_MS, n * STATE_THROTTLE_PER_PLAYER_MS))


def _schedule_state_flush(room) -> None:
    """窗口内多次成员变动只发一份最新快照;已有任务在等就直接复用它。"""
    task = _STATE_TASKS.get(room.room_id)
    if task is not None and not task.done():
        return
    _STATE_TASKS[room.room_id] = asyncio.create_task(_flush_state_later(room))


async def _flush_state_later(room) -> None:
    try:
        await asyncio.sleep(_state_throttle_ms(room) / 1000)
        # 发送时才生成快照 —— 窗口期内又有人进出,要发最新的那份。
        # (所以这里不需要 pending 缓存,和榜单节流不同)
        await _broadcast(room, {"type": "room_state", "room": _snapshot_dict(room)})
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("PK room_state flush failed: room_id=%d error=%s", room.room_id, e)
    finally:
        _STATE_TASKS.pop(room.room_id, None)


def _clear_state_throttle(room_id: int) -> None:
    task = _STATE_TASKS.pop(room_id, None)
    if task is not None and not task.done():
        task.cancel()


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


# ---------- 实时榜合并推送 + 按人裁剪(解 O(人数²) 流量) ----------
# 原实现:每人每答一题 → 立即把「全量榜单」广播给全房。出站流量 = 榜单大小 × 人数 × 提交频率,
# 三个因子里两个随人数涨 → O(人数²)。实测 30 人房 580KB/s、50 人房就打满 12M 上行。
#
# 两处优化,合起来把流量压成近似 O(人数):
# 1. 合并推送:同一房间 throttle 窗口内的多次更新只发最后一条(榜单是"当前状态"不是
#    "增量事件",丢中间态无损)。让流量与答题速度解耦。
# 2. 按人裁剪:学生只需要"前几名 + 我自己在第几",不需要全班每一行。裁成
#    前 RANKING_TOP_N + 自己 → 单条榜单大小不再随人数涨。
#    教师控制台/大屏要看全班,仍发全量(每房只有 1 个教师连接,不构成规模问题)。
RANKING_TOP_N = 10
RANKING_THROTTLE_MS = 250
# 人多时再放宽窗口:窗口 ∝ 人数,保证「每秒总出站」有上界,不会因人数翻倍而翻倍
RANKING_THROTTLE_PER_PLAYER_MS = 12
RANKING_THROTTLE_MAX_MS = 2000
_RANKING_PENDING: dict[int, dict] = {}      # room_id → 最新一条待发榜单
_RANKING_TASKS: dict[int, asyncio.Task] = {}  # room_id → 正在等待的 flush 任务


def _ranking_throttle_ms(room) -> int:
    n = len(room.players)
    return min(RANKING_THROTTLE_MAX_MS,
               max(RANKING_THROTTLE_MS, n * RANKING_THROTTLE_PER_PLAYER_MS))


def _trim_ranking_for(event: dict, user_id: int | None) -> dict:
    """
    把全量榜单裁成「名次连续的前 N 名 + 自己(若在 N 名之外,追加在末尾)」。
    user_id=None 表示要全量(教师控制台 / 大屏观众)。

    前 N 名保持名次连续、顺序不变 —— 前端柱状图靠这个把"柱子的位置"等同于"名次",
    可视区只在有人真的追进前 N 时才换人。自己排在 N 名外时作为额外一条附在最后,
    前端单独渲染成"我的位置"那一行,不插进柱子序列里。
    """
    full = event.get("ranking") or []
    if user_id is None or len(full) <= RANKING_TOP_N:
        return event
    top = full[:RANKING_TOP_N]
    if not any(r.get("user_id") == user_id for r in top):
        mine = next((r for r in full if r.get("user_id") == user_id), None)
        if mine is not None:
            top = top + [mine]
    return {**event, "ranking": top, "total_players": len(full)}


def _schedule_ranking_flush(room, event: dict) -> None:
    """把最新榜单存下;若没有在等的 flush 任务,起一个。"""
    _RANKING_PENDING[room.room_id] = event
    task = _RANKING_TASKS.get(room.room_id)
    if task is not None and not task.done():
        return   # 已有任务在等,它会带上最新快照
    _RANKING_TASKS[room.room_id] = asyncio.create_task(_flush_ranking_later(room))


async def _flush_ranking_later(room) -> None:
    try:
        await asyncio.sleep(_ranking_throttle_ms(room) / 1000)
        event = _RANKING_PENDING.pop(room.room_id, None)
        if event is not None:
            await _broadcast_ranking(room, event)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.warning("PK ranking flush failed: room_id=%d error=%s", room.room_id, e)
    finally:
        _RANKING_TASKS.pop(room.room_id, None)


async def _broadcast_ranking(room, event: dict) -> None:
    """
    实时榜分发:学生只收「前 N 名 + 自己」,教师控制台/观众(大屏)收全量。

    走 _broadcast 的 per_player 钩子,而不是自己再写一遍 fan-out ——
    失联检测与清理、教师镜像、观众脱敏都由 _broadcast 统一负责。
    """
    full = event.get("ranking") or []
    if len(full) <= RANKING_TOP_N:
        await _broadcast(room, event)   # 人少时人人都能看全,无需裁剪
        return

    # 前 N 名对所有学生都一样,只序列化这一次;进了前 N 的人直接复用这份文本。
    # 排在 N 名外的人 = 同一份前缀 + 自己那行,用字符串拼接补上尾巴,
    # 避免为每个人整体 dumps 一遍(200 人房那是 200 次序列化)。
    trimmed_common = {**event, "ranking": full[:RANKING_TOP_N], "total_players": len(full)}
    common_text = _dumps(trimmed_common)
    top_ids = {r.get("user_id") for r in trimmed_common["ranking"]}
    row_by_uid = {r.get("user_id"): r for r in full}
    # 形如 ...,"ranking":[...]  → 在最后一个 ] 前插入 ,{我这行}
    split_at = common_text.rindex("]")
    prefix, suffix = common_text[:split_at], common_text[split_at:]
    text_cache: dict[int, str] = {}

    def payload_for(uid: int) -> str:
        if uid in top_ids or uid not in row_by_uid:
            return common_text
        cached = text_cache.get(uid)
        if cached is None:
            cached = f"{prefix},{_dumps(row_by_uid[uid])}{suffix}"
            text_cache[uid] = cached
        return cached

    await _broadcast(room, event, per_player=payload_for)


def _clear_ranking_throttle(room_id: int) -> None:
    """房间结束/解散时清理,避免任务泄漏。"""
    task = _RANKING_TASKS.pop(room_id, None)
    if task is not None and not task.done():
        task.cancel()
    _RANKING_PENDING.pop(room_id, None)


def _cancel_timer(room_id: int, user_id: int, q_seq: int):
    key = (room_id, user_id, q_seq)
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
    # 榜单/成员快照的节流任务挂在同一个房上,一并清掉
    # (否则房都没了还有 task 在等着广播)
    _clear_ranking_throttle(room_id)
    _clear_state_throttle(room_id)
    cd = _COUNTDOWN_TASKS.pop(room_id, None)
    if cd and not cd.done():
        cd.cancel()


def _schedule_player_timer(room, user_id: int, q_seq: int, stage: str, word_lookup: dict):
    """为某玩家的某道题起超时计时器(key=q_seq);超时则该题按错推进、推下一题。
    完成(done)不起计时器。超时时长按 stage(分类20s/听写60s/过关30s)。"""
    _cancel_timer(room.room_id, user_id, q_seq)
    if stage == "done":
        return
    from app.services.pk.engine import STAGE_TIMEOUT_MS
    timeout_ms = STAGE_TIMEOUT_MS.get(stage, 30_000)

    async def _run():
        try:
            await asyncio.sleep(timeout_ms / 1000)
            events = engine.force_timeout(room, user_id, q_seq, stage, word_lookup)
            await _process_events(room, events, word_lookup)
        except asyncio.CancelledError:
            pass

    _TIMEOUT_TASKS[(room.room_id, user_id, q_seq)] = asyncio.create_task(_run())


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
        elif etype == "live_ranking":
            # 实时榜合并推送:每人每答一题都会产生一条全量榜单,原来直接广播
            # → 出站流量按「房间人数²」涨(30人房实测 580KB/s,50人房就打满 12M)。
            # 改为最多每 RANKING_THROTTLE_MS 推一次,期间的更新合并成一条最新快照。
            # 榜单是「当前状态」而非「增量事件」,丢掉中间态不损失信息。
            _schedule_ranking_flush(room, event)
        else:
            await _broadcast(room, event)

        if etype == "question_pushed" and target is not None:
            # 为该玩家这道题起超时计时器(先取消他上一题的,避免重叠)
            _cancel_player_timers(room.room_id, target)
            _schedule_player_timer(room, target, event["q_seq"], event["stage"], word_lookup)
        elif etype == "player_finished" and target is not None:
            # 该玩家跑完整套流程:停其计时器;若全员完成则提前结算(不等全场倒计时)
            _cancel_player_timers(room.room_id, target)
            if engine.all_players_done(room):
                fin_events = engine.finalize_room(room)
                await _process_events(room, fin_events, word_lookup)
        elif etype == "game_finished":
            # 终局已经带了最终榜(finish_evt.ranking),此时还压着的节流榜单必须丢掉:
            # 否则它会在 game_finished 之后才送达,前端把结算页刷回"比赛中"的旧榜
            _clear_ranking_throttle(room.room_id)
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
    from app.services.pk.engine import _question_event, init_player_groups
    room.status = "playing"
    room.started_at = datetime.utcnow()
    room.deadline_at = room.started_at + timedelta(seconds=max(1, int(room.countdown_seconds)))
    # 每个玩家:把私有词表切成组,初始化到「第一组·分类·第一词」的状态机
    for ps in room.players.values():
        if ps.word_ids:
            init_player_groups(room, ps)
    # 开局快照必须立刻到位(前端据此从等待室切到比赛界面),且要丢掉排队中的旧快照
    await _broadcast_room_state(room, immediate=True)
    for uid, ps in list(room.players.items()):
        # 必须真正连着 WS 才推题/起计时器:仅 online=True 但 ws=None 的是"join 了没连"的
        # 幽灵玩家,给他起计时器会 force_timeout 一路自动记错推进,污染对局。重连时会补发其当前题。
        if ps.ws is None or not ps.online or not ps.groups:
            continue
        evt = _question_event(room, ps, room.word_lookup)
        await _send_to_player(room, uid, evt)
        _schedule_player_timer(room, uid, ps.q_seq, ps.stage, room.word_lookup)
    _schedule_countdown(room, room.word_lookup)


async def _try_start_game(room, requester_ws) -> None:
    """开局逻辑(房主/教师控制台共用)。requester_ws 用于把校验失败的 error 回给发起者。

    分组赛额外要求:每个队至少 1 名在线玩家,否则空队无意义。
    选词按 room.same_words:默认同题公平赛(严格交集、全员同词同序,不补词);
    关掉则各考各背过的词(题量取全场最小词汇量,保持工作量一致)。
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
        # 学生自己选组,所以开局前要拦两种情况:有人还没选、以及只有一组有人。
        unpicked = [room.players[uid].nickname for uid in online_ids if not room.players[uid].team]
        if unpicked:
            shown = "、".join(unpicked[:5]) + ("…" if len(unpicked) > 5 else "")
            await requester_ws.send_json({
                "type": "error", "code": "TEAM_NOT_PICKED",
                "message": f"还有 {len(unpicked)} 人没选组({shown}),让他们在等待室点一下组名;也可以你直接帮他们指定",
            })
            return
        online_teams = {room.players[uid].team for uid in online_ids}
        if len(online_teams) < 2:
            await requester_ws.send_json({
                "type": "error", "code": "SINGLE_TEAM",
                "message": "在线学生都挤在同一组了,分组赛至少要两组有人。让部分学生换到别的组,或改用个人赛",
            })
            return
        # 没人选的空组不进队伍榜(教师可能建了 4 组只用了 2 组),但组本身留着不删
        room.active_teams = sorted(online_teams)

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
            ps.word_ids = list(shared)   # 双方同一份词表(分组/状态机在 _push_first_question 里初始化)
            ps.answers = []
            ps.finished = False
        room.word_ids = list(shared)
    elif room.same_words:
        # 同题公平赛(默认):全员考「所有人都背过」交集里的同一批词、同一顺序。
        # 同词表 → 同分组 → 同满分(词数×100),先背完者分数必然最高 ——
        # 发奖品的硬要求:任何因抽词不同带来的难度/长度差异都不允许存在。
        # 指定了考试范围(scope_word_ids)则只在范围词池内取「背过的词」。
        learned = await _load_learned_for_room(online_ids, room.scope_word_ids)
        chosen, common_count = select_words_with_fallback(
            {uid: learned.get(uid, set()) for uid in online_ids},
            room.word_count, random, fill_pool=None,   # 严格交集,绝不补没背过的词
        )
        if len(chosen) < MIN_COMMON_WORDS:
            scope_hint = f"(范围:{room.scope_desc})" if room.scope_desc else ""
            await requester_ws.send_json({
                "type": "error", "code": "NOT_ENOUGH_COMMON_WORDS",
                "message": (
                    f"全场共同背过的词只有 {common_count} 个{scope_hint},凑不齐同题对局。"
                    "让学生先把相同单元背齐,或建房时关掉「同题公平赛」改为各考各的"
                ),
            })
            return
        # 共同词不够设定题量:随机重复池内词补足(不再压缩题量)。
        # 全员共用同一份含重复的卷面,同词同序 → 公平性不破
        if len(chosen) < room.word_count:
            chosen = fill_with_repeats(chosen, room.word_count, random)
        for uid in online_ids:
            ps = room.players[uid]
            ps.word_ids = list(chosen)   # 同一份、同一顺序 → 分组切法也完全一致
            ps.answers = []
            ps.finished = False
        room.word_count = len(chosen)    # 与设定值一致(重复补足后恒等;快照展示)
        room.word_ids = list(chosen)
    else:
        # 各考各的(same_words 关):每人考「他自己背过的词」(小初高混场词汇量
        # 差异大、凑不出交集时用),但 ⚠️ 题量必须全场统一 —— 胜负是「率先掌握
        # 完成」,若各人词表长短不同,背得少的人工作量小、必然先完成,激励完全反向。
        # 题量统一取设定值:背过的词不够的学生,随机重复他自己的词补足,
        # 不再按「全场最小词汇量」把所有人的题量压低。
        learned = await _load_learned_for_room(online_ids, room.scope_word_ids)
        min_vocab = min(len(learned.get(uid, set())) for uid in online_ids)
        if min_vocab < MIN_COMMON_WORDS:
            scope_hint = f"在指定范围({room.scope_desc})内" if room.scope_desc else ""
            await requester_ws.send_json({
                "type": "error", "code": "NOT_ENOUGH_COMMON_WORDS",
                "message": (
                    f"有学生{scope_hint}背过的单词太少(最少的只有 {min_vocab} 个),凑不齐一局。"
                    f"每人至少需要背过 {MIN_COMMON_WORDS} 个单词,先去学习流程多背一些再来 PK"
                ),
            })
            return
        per_player_count = room.word_count
        all_word_ids: set[int] = set()
        for uid in online_ids:
            ps = room.players[uid]
            mine = learned.get(uid, set())
            picked = select_words_for_player(mine, per_player_count, random)
            if len(picked) < per_player_count:
                # 他背过的词不够题量:随机重复自己的词补足到统一题量
                picked = fill_with_repeats(picked, per_player_count, random)
            ps.word_ids = picked
            ps.answers = []
            ps.finished = False
            all_word_ids |= set(picked)
        # 统一题量后每人 word_ids 长度一致 → 分组数一致 → 「谁先掌握完」才是公平比较
        room.word_count = per_player_count    # 快照/前端展示实际生效题量
        room.word_ids = list(all_word_ids)   # 快照/落库/教师聚合用(全房并集,去重)

    # 装载 word_lookup(word_id→Word,全房共享一份)。
    # word_points 不再装载:满分统一 词数×100(见 score.py),按学段给词加权
    # 已退出计分链路,留空让 points_for_word 恒返 base_points,展示口径一致。
    room.word_lookup.clear()
    room.word_lookup.update(await _load_word_lookup(room.word_ids))
    logger.info(
        "PK race game started: room_id=%d mode=%s fixed=%s players=%d words=%d countdown=%ds",
        room.room_id, room.mode, room.fixed_words, len(online_ids), len(room.word_ids), room.countdown_seconds,
    )
    await _push_first_question(room)


async def _finish_playing_room(room) -> bool:
    """教师提前结束正在进行的对局，复用倒计时到点时的正式结算流程。"""
    if room.status != "playing":
        return False
    _cancel_room_timers(room.room_id)
    events = engine.finalize_room(room)
    if not events:
        return False
    await _process_events(room, events, room.word_lookup)
    return True


async def _handle_host_console(ws: WebSocket, room, user) -> None:
    """教师控制台:组织者视角。收全场广播,能开局/结算/踢人/调队/解散,但不作答不计分。

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
            online_tracker.touch_ws(user.id)  # 对战期间几乎只走WS,不在此记活跃会漏统计
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
            elif mtype == "finish_game":
                if not await _finish_playing_room(room):
                    await ws.send_json({
                        "type": "error",
                        "code": "GAME_NOT_PLAYING",
                        "message": "比赛尚未开始或已经结束",
                    })
                    continue
                break
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
    online_tracker.touch_ws(user.id)  # 握手即在线,不等首个心跳
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
                online_tracker.touch_ws(user.id)  # 观战也占带宽,计入在线
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

    # 自己必须立刻拿到快照(否则等待室空白),别人的列表刷新走合并推送:
    # 100 人陆续进房时,「每人 join 都全房广播」是 O(人数²) 流量的元凶
    try:
        await ws.send_json({"type": "room_state", "room": _snapshot_dict(room)})
    except Exception:
        pass
    await _broadcast_room_state(room)
    await _broadcast(room, {"type": "player_reconnected", "user_id": user.id}, exclude=user.id)

    # 中途重连:房间已有词但共享词表为空时补装载(正常开局时由 start_game 装载)
    if room.word_ids and not room.word_lookup:
        room.word_lookup.update(await _load_word_lookup(room.word_ids))

    # 对局中重连:单发「我自己的当前题」(按状态机 q_seq/stage),并重置我这题的计时器,
    # 否则客户端卡在"等待下一题"。已完成(done)不补题。
    if room.status == "playing" and p.groups and p.stage != "done":
        await ws.send_json(_question_event(room, p, room.word_lookup))
        _schedule_player_timer(room, user.id, p.q_seq, p.stage, room.word_lookup)

    explicit_leave = False
    try:
        while True:
            msg = await ws.receive_json()
            online_tracker.touch_ws(user.id)  # 对战期间几乎只走WS,不在此记活跃会漏统计
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
                    if room.status == "playing" and p.groups and p.stage != "done":
                        await _send_to_player(room, user.id, _question_event(room, p, room.word_lookup))
                        _schedule_player_timer(room, user.id, p.q_seq, p.stage, room.word_lookup)
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
            elif mtype == "pick_team":
                # 学生自己选组(等待室点组名):{type:pick_team, team}
                # 只能给自己选——不带 user_id,免得学生互相改组
                try:
                    after = manager.set_player_team(room.room_id, user.id, int(msg.get("team")))
                except (TypeError, ValueError):
                    after = None
                if after is not None:
                    # 走节流广播:100 人房里人人点组名,immediate 会把 room_state
                    # 打成流量风暴(它本就是头号流量源)
                    await _broadcast_room_state(after)
                else:
                    await ws.send_json({
                        "type": "error", "code": "PICK_TEAM_FAILED",
                        "message": "选组没成功,可能已经开局或这个组不存在了",
                    })
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
