"""
在线用户追踪(容量监测的数据源)

设计要点:
- 纯内存零依赖:middleware 每请求 O(1) 记录,不查库不加锁(单进程 asyncio 无并发写风险);
  服务重启即清零,当日峰值也随之重置——监测指标可接受,不值得为此引入持久化
- HTTP 侧从 JWT 直接解 sub 拿 user_id(不走 get_current_user,避免每请求多一次查库);
  token 无效/过期一律静默忽略,追踪绝不能影响业务请求
- PK 对战几乎只走 WebSocket,不埋点会漏人:pk_websocket 在收到消息时调 touch()
- 家长端 token 的 sub 是 parents 表 id,与 users 表 id 可能撞号,按路径前缀区分 key
- 应用层出网流量按 response content-length 累计(TLS/协议头/流式响应不计,
  偏小是已知误差,容量估算时乘协议放大系数补偿);监控页自身的轮询流量不计入,
  否则空闲时人均带宽会被 3s 一次的大 JSON 严重污染
"""
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings

_WINDOW_MAX = 600          # 支持的最大统计窗口(秒)
_BEIJING = timezone(timedelta(hours=8))

# key(如 "u123"/"p45") -> 最近活跃时刻(time.time())
_seen: dict[str, float] = {}
# 应用层出网事件: (时刻, 字节数);20000 条约覆盖高峰期数分钟
_egress: deque = deque(maxlen=20000)
# 请求事件时刻(算 QPS 用)
_requests: deque = deque(maxlen=20000)

_peak_today: int = 0
_peak_date: str = ""
_last_peak_calc: float = 0.0


def _bj_today() -> str:
    return datetime.now(_BEIJING).strftime("%Y-%m-%d")


def touch(key: str) -> None:
    """记录一次活跃;顺带低频(≥5s一次)刷新当日峰值,避免每请求全表扫描"""
    global _peak_today, _peak_date, _last_peak_calc
    now = time.time()
    _seen[key] = now

    if now - _last_peak_calc >= 5.0:
        _last_peak_calc = now
        today = _bj_today()
        if today != _peak_date:
            _peak_date = today
            _peak_today = 0
        cur = active_count(60)
        if cur > _peak_today:
            _peak_today = cur
        # 顺手清理超窗陈尸,防 dict 无限膨胀
        if len(_seen) > 5000:
            cutoff = now - _WINDOW_MAX
            for k in [k for k, t in _seen.items() if t < cutoff]:
                del _seen[k]


def touch_ws(user_id: int) -> None:
    """WebSocket 消息(心跳/答题)即活跃"""
    touch(f"u{user_id}")


def record_http(path: str, auth_header: str | None, content_length: str | None) -> None:
    """HTTP 中间件入口:解 token 记活跃 + 计量应用层出网流量"""
    now = time.time()
    _requests.append(now)
    # 监控页自身轮询不计流量(见模块头注释)
    if content_length and not path.startswith("/api/v1/admin/server"):
        try:
            _egress.append((now, int(content_length)))
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


def active_count(window_seconds: int = 300) -> int:
    cutoff = time.time() - window_seconds
    return sum(1 for t in _seen.values() if t >= cutoff)


def active_user_ids(window_seconds: int = 300, limit: int = 2000) -> list[int]:
    """活跃的 users 表 id(不含家长),给角色分布查询用"""
    cutoff = time.time() - window_seconds
    ids = [
        int(k[1:]) for k, t in _seen.items()
        if t >= cutoff and k.startswith("u")
    ]
    return ids[:limit]


def peak_today() -> int:
    return _peak_today if _peak_date == _bj_today() else 0


def app_rates(window_seconds: int = 300) -> tuple[float, float]:
    """返回 (应用层出网字节/秒, 请求数/秒),按实际观测窗口归一"""
    now = time.time()
    cutoff = now - window_seconds
    total = 0
    oldest = now
    for t, b in _egress:
        if t >= cutoff:
            total += b
            oldest = min(oldest, t)
    # 分母取实际观测跨度(deque滚动覆盖不足窗口时不低估),但不小于60s(零星请求不虚高)
    span = max(now - oldest, 60.0) if total else float(window_seconds)
    req = sum(1 for t in _requests if t >= cutoff)
    return total / span, req / max(float(window_seconds), 1.0)
