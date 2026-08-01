"""
服务器实时监控 API(仅平台管理员)

设计要点:
- psutil 采样跑在惰性启动的后台任务里(首次请求才启动),2s 一采,
  环形缓冲保留最近 10 分钟;超过 10 分钟无人查看自动停止,零常驻开销
- CPU 百分比是"距上次调用"的差分,采样循环是唯一调用方,
  请求处理器只读缓存,避免多个调用方互相污染差分基准
- psutil 用 try 导入:生产先更新代码后装依赖的窗口期内,不能让 main.py 崩启动
"""
import asyncio
import os
import platform
import socket
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.auth import get_current_admin
from app.core.config import settings
from app.models.user import User

try:
    import psutil
except ImportError:  # 生产依赖未装齐时接口返回 503,不影响其他模块
    psutil = None

router = APIRouter()

_SAMPLE_INTERVAL = 2.0          # 采样间隔(秒)
_HISTORY_POINTS = 300           # 10 分钟历史
_IDLE_STOP_SECONDS = 600        # 无人查看多久后停止采样

_BACKEND_DIR = Path(__file__).resolve().parents[4]

_history: deque = deque(maxlen=_HISTORY_POINTS)
_latest: dict = {}
_sampler_task: asyncio.Task | None = None
_last_poll_at: float = 0.0


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


async def _sampler_loop():
    global _latest, _sampler_task
    try:
        proc = psutil.Process(os.getpid())
        # 差分类指标先空调一次建立基准
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)
        proc.cpu_percent(interval=None)
        last_net = _safe(psutil.net_io_counters)
        last_disk = _safe(psutil.disk_io_counters)
        last_t = time.monotonic()

        while True:
            await asyncio.sleep(_SAMPLE_INTERVAL)
            now_t = time.monotonic()
            elapsed = max(now_t - last_t, 1e-6)

            net = _safe(psutil.net_io_counters)
            disk = _safe(psutil.disk_io_counters)
            mem = psutil.virtual_memory()

            def rate(cur, prev, attr):
                if cur is None or prev is None:
                    return 0.0
                return max(0.0, (getattr(cur, attr) - getattr(prev, attr)) / elapsed)

            sample = {
                "t": round(time.time(), 1),
                "cpu": psutil.cpu_percent(interval=None),
                "mem": mem.percent,
                "net_up": round(rate(net, last_net, "bytes_sent")),
                "net_down": round(rate(net, last_net, "bytes_recv")),
                "disk_read": round(rate(disk, last_disk, "read_bytes")),
                "disk_write": round(rate(disk, last_disk, "write_bytes")),
            }
            _latest = {
                **sample,
                "per_core": psutil.cpu_percent(interval=None, percpu=True),
                "proc_cpu": _safe(lambda: proc.cpu_percent(interval=None), 0.0),
                "proc_rss": _safe(lambda: proc.memory_info().rss, 0),
            }
            _history.append(sample)
            last_net, last_disk, last_t = net, disk, now_t

            if time.monotonic() - _last_poll_at > _IDLE_STOP_SECONDS:
                break
    finally:
        _sampler_task = None


def _ensure_sampler():
    global _sampler_task
    if _sampler_task is None or _sampler_task.done():
        _sampler_task = asyncio.get_running_loop().create_task(_sampler_loop())


def _db_sizes() -> dict | None:
    """SQLite 主库 + WAL 文件大小(WAL 膨胀是这套部署的真实风险点)"""
    url = settings.DATABASE_URL
    if "sqlite" not in url:
        return None
    raw = url.rsplit("///", 1)[-1].split("?")[0]
    p = Path(raw)
    if not p.is_absolute():
        p = _BACKEND_DIR / raw.lstrip("./")
    if not p.exists():
        return None
    wal = Path(str(p) + "-wal")
    return {
        "main_bytes": p.stat().st_size,
        "wal_bytes": wal.stat().st_size if wal.exists() else 0,
    }


def _temperature() -> float | None:
    getter = getattr(psutil, "sensors_temperatures", None)
    if getter is None:
        return None
    temps = _safe(getter)
    if not temps:
        return None
    vals = [e.current for arr in temps.values() for e in arr if e.current]
    return round(max(vals), 1) if vals else None


def _connections() -> dict | None:
    """全机 inet 连接统计;macOS 非 root 会 AccessDenied,返回 None 前端显示 —"""
    conns = _safe(lambda: psutil.net_connections(kind="inet"))
    if conns is None:
        return None
    return {
        "total": len(conns),
        "established": sum(1 for c in conns if c.status == "ESTABLISHED"),
        "listen": sum(1 for c in conns if c.status == "LISTEN"),
    }


@router.get("/metrics")
async def get_server_metrics(current_user: User = Depends(get_current_admin)):
    """当前快照 + 最近 10 分钟历史(前端 3s 轮询)"""
    if psutil is None:
        raise HTTPException(503, "服务器未安装 psutil,请先 pip install -r requirements.txt")

    global _last_poll_at
    _last_poll_at = time.monotonic()
    _ensure_sampler()

    mem = psutil.virtual_memory()
    swap = _safe(psutil.swap_memory)
    disk = psutil.disk_usage("/")
    freq = _safe(psutil.cpu_freq)
    load = _safe(lambda: os.getloadavg())
    net_total = _safe(psutil.net_io_counters)
    boot = psutil.boot_time()
    proc = psutil.Process(os.getpid())

    return {
        "interval": _SAMPLE_INTERVAL,
        "collecting": len(_history) < 2,  # 采样器刚启动,曲线还没长出来
        "static": {
            "hostname": socket.gethostname(),
            "os": f"{platform.system()} {platform.release()}",
            "arch": platform.machine(),
            "python": platform.python_version(),
            "cores_logical": psutil.cpu_count() or 0,
            "cores_physical": psutil.cpu_count(logical=False) or 0,
        },
        "now": {
            "cpu": _latest.get("cpu", 0.0),
            "per_core": _latest.get("per_core", []),
            "load_avg": [round(v, 2) for v in load] if load else None,
            "cpu_freq_mhz": round(freq.current) if freq and freq.current else None,
            "temperature": _temperature(),
            "mem": {"total": mem.total, "used": mem.used, "available": mem.available, "percent": mem.percent},
            "swap": {"total": swap.total, "used": swap.used, "percent": swap.percent} if swap else None,
            "disk": {"total": disk.total, "used": disk.used, "free": disk.free, "percent": disk.percent},
            "net_up": _latest.get("net_up", 0),
            "net_down": _latest.get("net_down", 0),
            "net_total": {"sent": net_total.bytes_sent, "recv": net_total.bytes_recv} if net_total else None,
            "disk_read": _latest.get("disk_read", 0),
            "disk_write": _latest.get("disk_write", 0),
            "uptime_seconds": round(time.time() - boot),
            "process_count": len(psutil.pids()),
            "connections": _connections(),
            "service": {
                "rss": _latest.get("proc_rss") or _safe(lambda: proc.memory_info().rss, 0),
                "cpu": _latest.get("proc_cpu", 0.0),
                "threads": _safe(proc.num_threads, 0),
                "fds": _safe(proc.num_fds) if hasattr(proc, "num_fds") else None,
                "uptime_seconds": round(time.time() - proc.create_time()),
            },
            "db": _db_sizes(),
        },
        "history": list(_history),
    }
