"""
在线用户追踪(容量监测的数据源)

设计要点:
- 记录在本进程内存,O(1) 不查库不加锁;每 FLUSH_SEC 秒由 flush_loop 汇总到 core/shared_store
  (2026-10-25 起后端多进程: 学生请求分散在几个工作进程上,监控页在主进程,不汇总就只看得到一部分人)。
  读侧(监控页)一律从共享存储读,所以在线人数最多晚 FLUSH_SEC 秒。没配 Redis 时共享存储退回本进程内存
  = 原来的单进程行为
- HTTP 侧从 JWT 直接解 sub 拿 user_id(不走 get_current_user,避免每请求多一次查库);
  token 无效/过期一律静默忽略,追踪绝不能影响业务请求
- PK 对战几乎只走 WebSocket,不埋点会漏人:pk_websocket 在收到消息时调 touch_ws()
- 家长端 token 的 sub 是 parents 表 id,与 users 表 id 可能撞号,按路径前缀区分 key
- 应用层出网流量按 response content-length 累计(TLS/协议头/流式响应不计,
  偏小是已知误差,容量估算时乘协议放大系数补偿);监控页自身的轮询流量不计入,
  否则空闲时人均带宽会被 3s 一次的大 JSON 严重污染
- 进程登记: 每个进程 flush 时顺带报一次自己的 pid / 角色,监控页据此知道一共几个进程、
  把它们的 CPU 加起来(见 admin/server_monitor)
"""
import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.shared_store import store

logger = logging.getLogger(__name__)

_WINDOW_MAX = 600          # 支持的最大统计窗口(秒)
FLUSH_SEC = 5.0            # 本进程 → 共享存储的汇总间隔
_BUCKET_SEC = 10           # 流量 / 请求数按 10 秒一格累计
_BEIJING = timezone(timedelta(hours=8))

_SEEN_KEY = "ot:seen"      # 有序集合: 成员 "u123"/"p45",分数 = 最近活跃时刻
_PROCS_KEY = "ot:procs"    # 有序集合: 成员 "pid:角色",分数 = 最近报到时刻

# ---- 本进程待汇总的数据(flush 时清空) ----
_pending_seen: dict[str, float] = {}
_pending_bytes: dict[int, int] = {}      # 10 秒格编号 → 字节
_pending_reqs: dict[int, int] = {}       # 10 秒格编号 → 请求数


def _bj_today() -> str:
    return datetime.now(_BEIJING).strftime("%Y-%m-%d")


def _bucket(t: float) -> int:
    return int(t // _BUCKET_SEC)


def touch(key: str) -> None:
    """记录一次活跃(只写本进程内存,flush_loop 负责汇总)"""
    _pending_seen[key] = time.time()


def touch_ws(user_id: int) -> None:
    """WebSocket 消息(心跳/答题)即活跃"""
    touch(f"u{user_id}")


def record_http(path: str, auth_header: str | None, content_length: str | None) -> None:
    """HTTP 中间件入口:解 token 记活跃 + 计量应用层出网流量"""
    now = time.time()
    b = _bucket(now)
    _pending_reqs[b] = _pending_reqs.get(b, 0) + 1
    # 监控页自身轮询不计流量(见模块头注释)
    if content_length and not path.startswith("/api/v1/admin/server"):
        try:
            _pending_bytes[b] = _pending_bytes.get(b, 0) + int(content_length)
        except ValueError:
            pass

    if not auth_header or not auth_header.startswith("Bearer "):
        return
    try:
        payload = jwt.decode(
            auth_header[7:], settings.SECRET_KEY, algorithms=["HS256"]
        )
        sub = payload.get("sub")
        if sub is None:
            return
        prefix = "p" if path.startswith("/api/v1/parent") else "u"
        touch(f"{prefix}{int(sub)}")
    except Exception:
        return  # 无效/过期 token 与追踪无关,静默


async def flush() -> None:
    """把本进程攒的活跃/流量/请求数并进共享存储,顺带报到本进程、刷新当日峰值"""
    from app.core import process_role
    global _pending_seen, _pending_bytes, _pending_reqs
    seen, nbytes, reqs = _pending_seen, _pending_bytes, _pending_reqs
    _pending_seen, _pending_bytes, _pending_reqs = {}, {}, {}
    now = time.time()
    if seen:
        await store.zadd(_SEEN_KEY, seen, _WINDOW_MAX * 2)
    for b, n in nbytes.items():
        await store.incr(f"ot:bytes:{b}", n, _WINDOW_MAX * 2)
    for b, n in reqs.items():
        await store.incr(f"ot:reqs:{b}", n, _WINDOW_MAX * 2)
    await store.zadd(_PROCS_KEY, {f"{os.getpid()}:{process_role.label()}": now}, 120)
    await store.zprune(_SEEN_KEY, now - _WINDOW_MAX)
    await store.zprune(_PROCS_KEY, now - 30)
    cur = await store.zcount(_SEEN_KEY, now - 60)
    await store.set_max(f"ot:peak:{_bj_today()}", cur, 2 * 86400)


async def flush_loop() -> None:
    """每个进程都跑一份(main.py lifespan 里启动)"""
    while True:
        await asyncio.sleep(FLUSH_SEC)
        try:
            await flush()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001  统计出错不影响业务
            logger.warning("在线统计汇总出错: %s", e)


# ---------------- 读侧(监控页,主进程) ----------------

async def active_count(window_seconds: int = 300) -> int:
    return await store.zcount(_SEEN_KEY, time.time() - window_seconds)


async def active_user_ids(window_seconds: int = 300, limit: int = 2000) -> list[int]:
    """活跃的 users 表 id(不含家长),给角色分布查询用"""
    members = await store.zrange_since(_SEEN_KEY, time.time() - window_seconds, limit * 2)
    return [int(m[1:]) for m in members if m.startswith("u")][:limit]


async def peak_today() -> int:
    v = await store.get(f"ot:peak:{_bj_today()}")
    return int(v) if v is not None else 0


async def app_rates(window_seconds: int = 300) -> tuple[float, float]:
    """返回 (应用层出网字节/秒, 请求数/秒),按实际观测窗口归一"""
    now = time.time()
    first = _bucket(now - window_seconds)
    buckets = list(range(first, _bucket(now) + 1))
    byte_vals = await store.mget([f"ot:bytes:{b}" for b in buckets])
    req_vals = await store.mget([f"ot:reqs:{b}" for b in buckets])
    total = 0
    oldest = now
    for b, v in zip(buckets, byte_vals):
        if v:
            total += int(v)
            oldest = min(oldest, b * _BUCKET_SEC)
    # 分母取实际观测跨度(刚重启数据不足窗口时不低估),但不小于60s(零星请求不虚高)
    span = max(now - oldest, 60.0) if total else float(window_seconds)
    req = sum(int(v) for v in req_vals if v)
    return total / span, req / max(float(window_seconds), 1.0)


async def processes(max_age: float = 20.0) -> list[dict]:
    """最近报到过的后端进程 [{pid, role}](共享存储退回内存时只看得到本进程)"""
    out = []
    for m in await store.zrange_since(_PROCS_KEY, time.time() - max_age, 256):
        pid, _, role = m.partition(":")
        try:
            out.append({"pid": int(pid), "role": role or "main"})
        except ValueError:
            continue
    return out
