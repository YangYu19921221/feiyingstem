"""直播弹幕 + 互动 WebSocket 端点。

## 为什么新建端点
直播原本是纯 REST(进场/心跳走 HTTP POST),没有任何实时通道。弹幕要实时,
必须开 WS。挂在 /api/v1/live/ws/{session_id},落在 /api/ 前缀下,直接继承
生产 nginx 现有的 WS upgrade 配置(PK 的 /api/v1/pk/ws 已在生产跑通),无需改 nginx。

## 班级隔离
所有互动都挂在 live_session_id 上,而 LiveSession 已绑 class_id。建连时用
student/live.py 的 _visible_session 校验"本机构+本班",进错班的连接直接 4003 关闭。
所以不需要另写分班级逻辑。

## 带宽(硬约束)
弹幕过应用机(媒体流走 SRS 不过)。100 人房逐条 fan-out 是 O(人数²) 出站,
不限流会打满 12M 出口(PK 的 live_ranking 吃过这个亏)。所以:
- 新弹幕先入缓冲,~250ms 窗口攒成一个 batch 一次广播;
- 同一份 payload 只 json.dumps 一次,用 send_text 发,不逐个 send_json。

## 协议
全 JSON,type 区分。dispatch 全程防御:非 dict / 坏字段丢弃,不断连。
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User, ClassStudent
from app.models.live import LiveSession, LiveDanmaku, LiveDanmakuMute
from app.services.danmaku_filter import clean_danmaku

logger = logging.getLogger(__name__)

router = APIRouter()

FLUSH_INTERVAL_MS = 250       # 弹幕合并广播窗口
HISTORY_LIMIT = 50            # 进场推送的历史条数


class DanmakuManager:
    """直播间连接管理器。照抄 pet_battle 的 BattleConnectionManager 骨架,
    session_id→user_id→ws;额外维护禁言集与节流缓冲。"""

    def __init__(self):
        # session_id -> {user_id: websocket}
        self.active: Dict[int, Dict[int, WebSocket]] = {}
        # session_id -> 待广播弹幕缓冲
        self.pending: Dict[int, List[dict]] = {}
        # session_id -> 正在跑的 flush 任务
        self.flush_tasks: Dict[int, asyncio.Task] = {}
        # session_id -> 被禁言的 student_id 集合(连接时从库预热)
        self.muted: Dict[int, Set[int]] = {}

    async def connect(self, session_id: int, user_id: int, ws: WebSocket):
        await ws.accept()
        if session_id not in self.active:
            self.active[session_id] = {}
            self.pending[session_id] = []
        # 同一用户多开标签页:后开的顶掉先开的(避免一人占多条连接)
        old = self.active[session_id].get(user_id)
        if old is not None and old is not ws:
            try:
                await old.close(code=4000, reason="别处已打开")
            except Exception:
                pass
        self.active[session_id][user_id] = ws

    def disconnect(self, session_id: int, user_id: int, ws: Optional[WebSocket] = None):
        conns = self.active.get(session_id)
        if not conns:
            return
        # 只在当前 ws 仍是登记的那条时才移除(防顶号后误删新连接)
        if ws is not None and conns.get(user_id) is not ws:
            return
        conns.pop(user_id, None)
        if not conns:
            self.active.pop(session_id, None)
            self.pending.pop(session_id, None)
            self.muted.pop(session_id, None)
            t = self.flush_tasks.pop(session_id, None)
            if t and not t.done():
                t.cancel()

    def online_count(self, session_id: int) -> int:
        return len(self.active.get(session_id, {}))

    async def _send(self, ws: WebSocket, text: str) -> bool:
        try:
            await ws.send_text(text)
            return True
        except Exception:
            return False

    async def broadcast(self, session_id: int, message: dict):
        """向房间所有连接广播(payload 只序列化一次)。"""
        conns = self.active.get(session_id)
        if not conns:
            return
        text = json.dumps(message, ensure_ascii=False)
        dead = []
        for uid, ws in list(conns.items()):
            if not await self._send(ws, text):
                dead.append((uid, ws))
        for uid, ws in dead:
            self.disconnect(session_id, uid, ws)

    async def send_to_user(self, session_id: int, user_id: int, message: dict):
        conns = self.active.get(session_id)
        if not conns:
            return
        ws = conns.get(user_id)
        if ws is None:
            return
        text = json.dumps(message, ensure_ascii=False)
        if not await self._send(ws, text):
            self.disconnect(session_id, user_id, ws)

    def queue_danmaku(self, session_id: int, item: dict):
        """把一条弹幕塞进节流缓冲,必要时启动 flush 循环。"""
        buf = self.pending.get(session_id)
        if buf is None:
            return
        buf.append(item)
        t = self.flush_tasks.get(session_id)
        if t is None or t.done():
            self.flush_tasks[session_id] = asyncio.create_task(self._flush_loop(session_id))

    async def _flush_loop(self, session_id: int):
        """睡一个窗口,把攒下的弹幕作为一个 batch 广播出去。"""
        try:
            await asyncio.sleep(FLUSH_INTERVAL_MS / 1000)
            buf = self.pending.get(session_id)
            if buf:
                items, buf[:] = list(buf), []
                await self.broadcast(session_id, {"type": "danmaku_batch", "items": items})
        except asyncio.CancelledError:
            pass
        except Exception as e:  # 单次 flush 失败不能拖垮连接
            logger.warning("danmaku flush failed s=%s: %s", session_id, e)

    def is_muted(self, session_id: int, student_id: int) -> bool:
        return student_id in self.muted.get(session_id, set())

    def set_mute(self, session_id: int, student_id: int, on: bool):
        s = self.muted.setdefault(session_id, set())
        if on:
            s.add(student_id)
        else:
            s.discard(student_id)


manager = DanmakuManager()


async def _authenticate(token: str) -> Optional[User]:
    """query-param JWT 鉴权。照抄 pk_websocket._authenticate:
    解 token → 取用户 → **设机构上下文**(自建鉴权路径必须手动 set,否则连接内
    DB 查询不被租户过滤器罩住)。"""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError, TypeError) as e:
        logger.info("live WS auth failed: %s", e)
        return None
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
    if user is not None:
        from app.core.tenancy import current_org_id
        current_org_id.set(None if user.role == "admin" else user.org_id)
    return user


async def _my_class_ids(db: AsyncSession, student_id: int) -> Set[int]:
    rows = (await db.execute(
        select(ClassStudent.class_id).where(ClassStudent.student_id == student_id)
    )).scalars().all()
    return set(rows)


async def _check_access(db: AsyncSession, session: LiveSession, user: User) -> bool:
    """能否进这个直播间的弹幕。老师=本人开的课(或 admin);学生=本机构+本班。"""
    if user.role == "admin":
        return True
    if user.role == "teacher":
        return session.teacher_id == user.id
    if user.role == "student":
        if session.class_id is None:
            return True
        return session.class_id in await _my_class_ids(db, user.id)
    return False


@router.websocket("/live/ws/{session_id}")
async def live_ws(
    websocket: WebSocket,
    session_id: int,
    token: str = Query(...),
):
    user = await _authenticate(token)
    if user is None:
        await websocket.close(code=4001, reason="登录已失效")
        return

    # 校验课存在 + 归属。用独立会话(鉴权已设好 current_org_id 上下文)
    async with AsyncSessionLocal() as db:
        session = (await db.execute(
            select(LiveSession).where(LiveSession.id == session_id)
        )).scalar_one_or_none()
        if session is None or session.status == "canceled":
            await websocket.close(code=4004, reason="直播课不存在")
            return
        if not await _check_access(db, session, user):
            await websocket.close(code=4003, reason="这节课不是你的班级")
            return

        is_teacher = user.role in ("teacher", "admin")

        # 预热禁言集(该 session 第一条连接时)
        if session_id not in manager.muted:
            muted_rows = (await db.execute(
                select(LiveDanmakuMute.student_id).where(
                    LiveDanmakuMute.live_session_id == session_id
                )
            )).scalars().all()
            manager.muted[session_id] = set(muted_rows)

        # 拉最近历史(未删)
        hist_rows = (await db.execute(
            select(LiveDanmaku)
            .where(LiveDanmaku.live_session_id == session_id,
                   LiveDanmaku.is_deleted == False)  # noqa: E712
            .order_by(LiveDanmaku.id.desc())
            .limit(HISTORY_LIMIT)
        )).scalars().all()
    history = [
        {"id": r.id, "name": r.display_name or "同学", "role": r.user_role,
         "content": r.content, "student_id": r.user_id}
        for r in reversed(hist_rows)
    ]

    await manager.connect(session_id, user.id, websocket)
    display_name = (user.full_name or user.username or "同学").strip()[:50]

    try:
        # 进场先推历史 + 当前状态
        await manager.send_to_user(session_id, user.id, {"type": "history", "items": history})
        if not is_teacher and manager.is_muted(session_id, user.id):
            await manager.send_to_user(session_id, user.id, {"type": "you_are_muted"})
        # 在线人数变化广播(教师端"谁在听"用)
        await manager.broadcast(session_id, {"type": "online", "count": manager.online_count(session_id)})

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")

            if mtype == "heartbeat":
                continue

            if mtype == "danmaku":
                await _handle_danmaku(session_id, user, display_name, is_teacher, msg)
            elif is_teacher and mtype == "delete":
                await _handle_delete(session_id, msg)
            elif is_teacher and mtype in ("mute", "unmute"):
                await _handle_mute(session_id, msg, on=(mtype == "mute"))
            elif is_teacher and mtype == "clear":
                await _handle_clear(session_id)
            # 未知类型 / 学生发管理指令:静默忽略

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning("live WS error s=%s u=%s: %s", session_id, user.id, e)
    finally:
        manager.disconnect(session_id, user.id, websocket)
        # 房还在才广播人数(空房已被 disconnect 清掉)
        if session_id in manager.active:
            await manager.broadcast(
                session_id, {"type": "online", "count": manager.online_count(session_id)}
            )


async def _handle_danmaku(session_id: int, user: User, display_name: str,
                          is_teacher: bool, msg: dict):
    # 禁言拦截(老师不受限)
    if not is_teacher and manager.is_muted(session_id, user.id):
        await manager.send_to_user(session_id, user.id,
                                   {"type": "error", "code": "muted", "message": "老师已暂停你发言"})
        return
    content, blocked = clean_danmaku(str(msg.get("content", "")))
    if blocked or not content:
        await manager.send_to_user(session_id, user.id,
                                   {"type": "error", "code": "blocked", "message": "内容不合适,换句话吧"})
        return

    role = "teacher" if is_teacher else "student"
    async with AsyncSessionLocal() as db:
        row = LiveDanmaku(
            live_session_id=session_id, user_id=user.id, user_role=role,
            display_name=display_name, content=content,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        danmaku_id = row.id

    manager.queue_danmaku(session_id, {
        "id": danmaku_id, "name": display_name, "role": role,
        "content": content, "student_id": user.id,
    })


async def _handle_delete(session_id: int, msg: dict):
    try:
        danmaku_id = int(msg.get("danmaku_id"))
    except (TypeError, ValueError):
        return
    async with AsyncSessionLocal() as db:
        row = await db.get(LiveDanmaku, danmaku_id)
        if row is None or row.live_session_id != session_id:
            return
        row.is_deleted = True
        await db.commit()
    await manager.broadcast(session_id, {"type": "deleted", "id": danmaku_id})


async def _handle_mute(session_id: int, msg: dict, on: bool):
    try:
        student_id = int(msg.get("student_id"))
    except (TypeError, ValueError):
        return
    async with AsyncSessionLocal() as db:
        exists = (await db.execute(
            select(LiveDanmakuMute).where(
                LiveDanmakuMute.live_session_id == session_id,
                LiveDanmakuMute.student_id == student_id,
            )
        )).scalar_one_or_none()
        if on and exists is None:
            db.add(LiveDanmakuMute(live_session_id=session_id, student_id=student_id))
            await db.commit()
        elif not on and exists is not None:
            await db.delete(exists)
            await db.commit()
    manager.set_mute(session_id, student_id, on)
    await manager.broadcast(session_id,
                            {"type": "muted" if on else "unmuted", "student_id": student_id})
    if on:
        await manager.send_to_user(session_id, student_id, {"type": "you_are_muted"})
    else:
        await manager.send_to_user(session_id, student_id, {"type": "you_are_unmuted"})


async def _handle_clear(session_id: int):
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(LiveDanmaku).where(
                LiveDanmaku.live_session_id == session_id,
                LiveDanmaku.is_deleted == False,  # noqa: E712
            )
        )).scalars().all()
        for r in rows:
            r.is_deleted = True
        await db.commit()
    await manager.broadcast(session_id, {"type": "cleared"})
