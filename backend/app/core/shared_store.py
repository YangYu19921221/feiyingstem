"""多进程共享的小数据(2026-10-25,后端从单进程改成「主进程 + 多个工作进程」)

为什么要有它: 限流桶、AI 每日次数、短信验证码、实时课堂在线状态、在线人数这些以前都放在进程内存里,
单进程时没问题;开了多个工作进程以后,每个进程各记各的 —— 限流 N 个进程就放大 N 倍、
学生心跳打到 A 进程而老师的实时课堂轮询打到 B 进程就看不到人。所以这些数统一放这里。

两种后端,调用方不用管是哪种:
- 配了 REDIS_URL 且连得上 → Redis(所有进程看到同一份)
- 没配 / 连不上 → 进程内存(= 以前的单进程行为)。Redis 中途断了也退回内存,5 秒后再试,
  不让一个缓存服务拖垮整个站点;退回期间各进程各算各的(限流变松、在线人数偏少),不会报错

所有键都带过期时间(Redis 满了按 LRU 淘汰也不会丢要紧的东西),统一加 "eh:" 前缀。
时间一律用 time.time()(各进程同一台机器,墙上时钟一致;monotonic 跨进程不可比)。
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import secrets
import time
from collections import deque
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

PREFIX = "eh:"
# Redis 出错后多久再试(期间走内存)
_RETRY_AFTER_SEC = 5.0
# Redis 单次操作超时: 本机回环正常 <1ms,0.5 秒还没回 = 出事了,别让请求跟着卡
_OP_TIMEOUT = 0.5


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------- 内存后端

class MemoryBackend:
    """单进程内存实现。语义必须与 RedisBackend 完全一致(测试对两边跑同一套用例)"""

    def __init__(self) -> None:
        self._kv: dict[str, tuple[str, Optional[float]]] = {}   # key -> (值, 过期时刻)
        self._z: dict[str, dict[str, float]] = {}                # 有序集合 key -> {成员: 分数}
        self._z_exp: dict[str, float] = {}
        self._win: dict[str, deque] = {}                          # 滑动窗口 key -> deque[时刻]
        self._win_exp: dict[str, float] = {}
        self._ops = 0

    def clear(self) -> None:
        self._kv.clear(); self._z.clear(); self._z_exp.clear(); self._win.clear(); self._win_exp.clear()

    # 惰性清理: 每几千次操作扫一遍过期的,防内存慢慢涨
    def _tick(self) -> None:
        self._ops += 1
        if self._ops % 5000:
            return
        now = _now()
        for k in [k for k, (_, e) in self._kv.items() if e is not None and e <= now]:
            self._kv.pop(k, None)
        for store, exp in ((self._z, self._z_exp), (self._win, self._win_exp)):
            for k in [k for k, e in exp.items() if e <= now]:
                store.pop(k, None)
                exp.pop(k, None)

    def _get_raw(self, key: str) -> Optional[str]:
        hit = self._kv.get(key)
        if hit is None:
            return None
        if hit[1] is not None and hit[1] <= _now():
            self._kv.pop(key, None)
            return None
        return hit[0]

    def _ttl_left(self, key: str) -> Optional[float]:
        hit = self._kv.get(key)
        return None if hit is None or hit[1] is None else hit[1] - _now()

    # ---- 键值 ----
    async def get(self, key: str) -> Optional[str]:
        self._tick()
        return self._get_raw(key)

    async def mget(self, keys: list[str]) -> list[Optional[str]]:
        return [self._get_raw(k) for k in keys]

    async def set(self, key: str, value: str, ttl: float) -> None:
        self._tick()
        self._kv[key] = (value, _now() + ttl)

    async def delete(self, key: str) -> int:
        alive = self._get_raw(key) is not None
        self._kv.pop(key, None)
        self._z.pop(key, None)
        self._win.pop(key, None)
        return 1 if alive else 0

    async def incr(self, key: str, amount: int, ttl: float) -> int:
        cur = self._get_raw(key)
        n = (int(cur) if cur is not None else 0) + amount
        left = self._ttl_left(key) if cur is not None else None
        self._kv[key] = (str(n), _now() + (left if left is not None else ttl))
        return n

    async def incr_if_below(self, key: str, limit: int, ttl: float) -> bool:
        cur = self._get_raw(key)
        n = int(cur) if cur is not None else 0
        if n >= limit:
            return False
        await self.incr(key, 1, ttl)
        return True

    async def set_max(self, key: str, value: int, ttl: float) -> int:
        cur = self._get_raw(key)
        if cur is not None and int(cur) >= value:
            return int(cur)
        self._kv[key] = (str(value), _now() + ttl)
        return value

    # ---- 有序集合(在线人数、进程登记) ----
    def _zset(self, key: str) -> Optional[dict[str, float]]:
        exp = self._z_exp.get(key)
        if exp is not None and exp <= _now():
            self._z.pop(key, None)
            self._z_exp.pop(key, None)
        return self._z.get(key)

    async def zadd(self, key: str, mapping: dict[str, float], ttl: float) -> None:
        self._tick()
        z = self._zset(key)
        if z is None:
            z = self._z[key] = {}
        z.update(mapping)
        self._z_exp[key] = _now() + ttl

    async def zcount(self, key: str, min_score: float) -> int:
        z = self._zset(key) or {}
        return sum(1 for s in z.values() if s > min_score)

    async def zrange_since(self, key: str, min_score: float, limit: int) -> list[str]:
        z = self._zset(key) or {}
        return [m for m, _ in sorted(((m, s) for m, s in z.items() if s > min_score),
                                     key=lambda x: x[1])][:limit]

    async def zprune(self, key: str, max_score: float) -> None:
        z = self._zset(key)
        if z:
            for m in [m for m, s in z.items() if s <= max_score]:
                del z[m]

    # ---- 滑动窗口限流 ----
    def _window(self, key: str, now: float, keep: float) -> deque:
        exp = self._win_exp.get(key)
        if exp is not None and exp <= now:
            self._win.pop(key, None)
        dq = self._win.get(key)
        if dq is None:
            dq = self._win[key] = deque()
        cutoff = now - keep
        while dq and dq[0] <= cutoff:
            dq.popleft()
        return dq

    async def window_hit(self, key: str, windows: list[tuple[float, int]]) -> float:
        """任一窗口已满 → 返回还要等几秒(>0,不记这一次);都没满 → 记一次,返回 0"""
        self._tick()
        now = _now()
        keep = max(w for w, _ in windows)
        dq = self._window(key, now, keep)
        for span, limit in windows:
            inside = [t for t in dq if t > now - span]
            if len(inside) >= limit:
                return max(inside[0] + span - now, 0.001)
        dq.append(now)
        self._win_exp[key] = now + keep + 1
        return 0.0

    async def window_count(self, key: str, span: float) -> int:
        now = _now()
        dq = self._window(key, now, span)
        return sum(1 for t in dq if t > now - span)

    async def window_record(self, key: str, keep: float) -> None:
        now = _now()
        dq = self._window(key, now, keep)
        dq.append(now)
        self._win_exp[key] = max(self._win_exp.get(key, 0), now + keep + 1)


# ---------------------------------------------------------------- Redis 后端

# 限流: 先清掉最长窗口外的,逐个窗口数;满了返回要等几秒(字符串,Lua 数字转整数会截断小数),没满记一次返回 '0'
_LUA_WINDOW_HIT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local member = ARGV[2]
local keep = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - keep)
local n = (#ARGV - 3) / 2
for i = 0, n - 1 do
  local span = tonumber(ARGV[4 + i * 2])
  local limit = tonumber(ARGV[5 + i * 2])
  local lo = '(' .. tostring(now - span)
  if redis.call('ZCOUNT', key, lo, '+inf') >= limit then
    local first = redis.call('ZRANGEBYSCORE', key, lo, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
    local wait = tonumber(first[2]) + span - now
    if wait < 0.001 then wait = 0.001 end
    return tostring(wait)
  end
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, math.ceil((keep + 1) * 1000))
return '0'
"""

# 过期时间一律按毫秒(PEXPIRE / SET PX): 按秒向上取整的话 0.4 秒的键要活 1 秒,与内存后端对不上
_LUA_INCR = """
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return n
"""

_LUA_INCR_IF_BELOW = """
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 1
"""

_LUA_SET_MAX = """
local v = tonumber(redis.call('GET', KEYS[1]) or '-1')
local n = tonumber(ARGV[1])
if n > v then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return n
end
return v
"""


def _ms(ttl: float) -> int:
    return max(1, math.ceil(ttl * 1000))


class RedisBackend:
    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis
        self._r = aioredis.Redis.from_url(
            url, decode_responses=True,
            socket_timeout=_OP_TIMEOUT, socket_connect_timeout=_OP_TIMEOUT,
        )
        self._hit = self._r.register_script(_LUA_WINDOW_HIT)
        self._incr = self._r.register_script(_LUA_INCR)
        self._incr_below = self._r.register_script(_LUA_INCR_IF_BELOW)
        self._setmax = self._r.register_script(_LUA_SET_MAX)

    async def close(self) -> None:
        await self._r.aclose()

    async def ping(self) -> bool:
        return bool(await self._r.ping())

    async def get(self, key: str) -> Optional[str]:
        return await self._r.get(key)

    async def mget(self, keys: list[str]) -> list[Optional[str]]:
        return list(await self._r.mget(keys)) if keys else []

    async def set(self, key: str, value: str, ttl: float) -> None:
        await self._r.set(key, value, px=_ms(ttl))

    async def delete(self, key: str) -> int:
        return int(await self._r.delete(key))

    async def incr(self, key: str, amount: int, ttl: float) -> int:
        return int(await self._incr(keys=[key], args=[amount, _ms(ttl)]))

    async def incr_if_below(self, key: str, limit: int, ttl: float) -> bool:
        return bool(int(await self._incr_below(keys=[key], args=[limit, _ms(ttl)])))

    async def set_max(self, key: str, value: int, ttl: float) -> int:
        return int(await self._setmax(keys=[key], args=[value, _ms(ttl)]))

    async def zadd(self, key: str, mapping: dict[str, float], ttl: float) -> None:
        if not mapping:
            return
        async with self._r.pipeline(transaction=True) as p:
            p.zadd(key, mapping)
            p.pexpire(key, _ms(ttl))
            await p.execute()

    async def zcount(self, key: str, min_score: float) -> int:
        return int(await self._r.zcount(key, f"({min_score}", "+inf"))

    async def zrange_since(self, key: str, min_score: float, limit: int) -> list[str]:
        return list(await self._r.zrangebyscore(key, f"({min_score}", "+inf", start=0, num=limit))

    async def zprune(self, key: str, max_score: float) -> None:
        await self._r.zremrangebyscore(key, "-inf", max_score)

    async def window_hit(self, key: str, windows: list[tuple[float, int]]) -> float:
        now = _now()
        args: list[Any] = [repr(now), f"{now!r}:{secrets.token_hex(4)}", max(w for w, _ in windows)]
        for span, limit in windows:
            args += [span, limit]
        return float(await self._hit(keys=[key], args=args))

    async def window_count(self, key: str, span: float) -> int:
        return int(await self._r.zcount(key, f"({_now() - span!r}", "+inf"))

    async def window_record(self, key: str, keep: float) -> None:
        now = _now()
        async with self._r.pipeline(transaction=True) as p:
            p.zadd(key, {f"{now!r}:{secrets.token_hex(4)}": now})
            p.zremrangebyscore(key, "-inf", now - keep)
            p.pexpire(key, math.ceil((keep + 1) * 1000))
            await p.execute()


# ---------------------------------------------------------------- 对外入口

def redis_url_from_env() -> str:
    """REDIS_URL: 环境变量优先(systemd 单元里写),其次 backend/.env。
    不加进 config.Settings: config.py 在生产有注释 drift,改它要走补丁(与 cos_video 同做法)"""
    import os
    v = os.environ.get("REDIS_URL")
    if v is not None:
        return v.strip()
    path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("REDIS_URL=") and not line.startswith("#"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


class SharedStore:
    """按配置选后端;Redis 出错自动退回内存,冷却后再试"""

    def __init__(self) -> None:
        self.memory = MemoryBackend()
        self._redis: Optional[RedisBackend] = None
        self._redis_url: Optional[str] = None
        self._down_until = 0.0
        self._last_warn = 0.0
        self._configured = False

    def configure(self, url: Optional[str]) -> None:
        """换后端(启动时按 settings 自动调一次;测试用它指向临时 Redis 或退回内存)"""
        self._redis_url = (url or "").strip() or None
        self._redis = None
        self._down_until = 0.0
        self._configured = True

    def _ensure_configured(self) -> None:
        if not self._configured:
            self.configure(redis_url_from_env())

    def _backend(self):
        self._ensure_configured()
        if not self._redis_url or _now() < self._down_until:
            return None
        if self._redis is None:
            try:
                self._redis = RedisBackend(self._redis_url)
            except Exception as e:  # noqa: BLE001  redis 包缺失 / URL 写错
                self._fail(e)
                return None
        return self._redis

    def _fail(self, e: BaseException) -> None:
        self._down_until = _now() + _RETRY_AFTER_SEC
        if _now() - self._last_warn > 60:
            self._last_warn = _now()
            logger.warning("共享存储(Redis)不可用,先用本进程内存: %s", e)

    async def _call(self, name: str, *args):
        r = self._backend()
        if r is not None:
            try:
                return await asyncio.wait_for(getattr(r, name)(*args), _OP_TIMEOUT * 2)
            except Exception as e:  # noqa: BLE001  连接断 / 超时 / 脚本错 —— 一律退回内存,不让请求失败
                self._fail(e)
                # 连接可能已坏,下次重建
                self._redis = None
        return await getattr(self.memory, name)(*args)

    # 状态(监控页用)
    def backend_name(self) -> str:
        self._ensure_configured()
        if not self._redis_url:
            return "memory"
        return "memory_fallback" if _now() < self._down_until else "redis"

    async def ping(self) -> bool:
        """真连一下 Redis(监控页 / 启动日志用)。没配 Redis 返回 False"""
        r = self._backend()
        if r is None:
            return False
        try:
            return await asyncio.wait_for(r.ping(), _OP_TIMEOUT * 2)
        except Exception as e:  # noqa: BLE001
            self._fail(e)
            self._redis = None
            return False

    # ---- 键值 ----
    async def get(self, key: str) -> Optional[str]:
        return await self._call("get", PREFIX + key)

    async def mget(self, keys: Iterable[str]) -> list[Optional[str]]:
        return await self._call("mget", [PREFIX + k for k in keys])

    async def set(self, key: str, value: str, ttl: float) -> None:
        await self._call("set", PREFIX + key, value, ttl)

    async def delete(self, key: str) -> int:
        return await self._call("delete", PREFIX + key)

    async def get_json(self, key: str) -> Any:
        raw = await self.get(key)
        return None if raw is None else json.loads(raw)

    async def mget_json(self, keys: Iterable[str]) -> list[Any]:
        return [None if v is None else json.loads(v) for v in await self.mget(keys)]

    async def set_json(self, key: str, value: Any, ttl: float) -> None:
        await self.set(key, json.dumps(value, ensure_ascii=False, separators=(",", ":")), ttl)

    # ---- 计数 ----
    async def incr(self, key: str, amount: int = 1, ttl: float = 86400) -> int:
        """加一(键不存在时从 0 起、设过期);已有的过期时间不刷新"""
        return await self._call("incr", PREFIX + key, amount, ttl)

    async def incr_if_below(self, key: str, limit: int, ttl: float) -> bool:
        """还没到 limit 就加一并返回 True;到了返回 False(原子,并发不会超)"""
        return await self._call("incr_if_below", PREFIX + key, limit, ttl)

    async def set_max(self, key: str, value: int, ttl: float) -> int:
        return await self._call("set_max", PREFIX + key, value, ttl)

    # ---- 有序集合 ----
    async def zadd(self, key: str, mapping: dict[str, float], ttl: float) -> None:
        await self._call("zadd", PREFIX + key, mapping, ttl)

    async def zcount(self, key: str, min_score: float) -> int:
        return await self._call("zcount", PREFIX + key, min_score)

    async def zrange_since(self, key: str, min_score: float, limit: int = 2000) -> list[str]:
        return await self._call("zrange_since", PREFIX + key, min_score, limit)

    async def zprune(self, key: str, max_score: float) -> None:
        await self._call("zprune", PREFIX + key, max_score)

    # ---- 滑动窗口 ----
    async def window_hit(self, key: str, windows: list[tuple[float, int]]) -> float:
        return await self._call("window_hit", PREFIX + key, list(windows))

    async def window_count(self, key: str, span: float) -> int:
        return await self._call("window_count", PREFIX + key, span)

    async def window_record(self, key: str, keep: float) -> None:
        await self._call("window_record", PREFIX + key, keep)


store = SharedStore()


def reset_memory() -> None:
    """测试用: 清空内存后端(限流桶 / 在线状态 / 验证码等全部清掉)"""
    store.memory.clear()
