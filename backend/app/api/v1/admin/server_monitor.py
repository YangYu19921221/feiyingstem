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
import json
import os
import platform
import socket
import time
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.services import online_tracker

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
                "online": online_tracker.active_count(300),
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


# ===================== 并发容量评估 =====================
#
# 目标:回答"当前配置最多支撑多少人同时在线使用"。
# 方法:三种资源分别外推,取最小值为整体容量,标出瓶颈项。
#   带宽  = 公网带宽上限(可配置,默认12Mbps) / 人均出网速率
#   CPU   = 单核100%(uvicorn 单worker事件循环,GIL 上限≈1核,压测实证"4核只用1核")
#           / 人均后端CPU占用;若改多worker部署需同步调整此上限
#   内存  = 可用内存 / 人均增量(弱相关,基本不会是瓶颈,仅作 sanity 展示)
# 人均消耗优先用实测(≥5个活跃用户才有统计意义),样本不足时退回参考基准。
# 参考基准来自 2026-07 压测:12M带宽下 PK 8人房≈180人、20人房≈37人同时对战,
# 常规学习(REST提交)人均远低于PK,参考值取保守偏高的 6KB/s、0.5%CPU。

_CAPACITY_KEY = "capacity_config"
_DEFAULT_CAPACITY_CONFIG = {"bandwidth_mbps": 12.0}
_SAFETY = 0.85               # 预留15%余量,不按跑满100%估
_MIN_MEASURE_USERS = 5       # 实测人均消耗所需的最少活跃用户数
_PROTO_OVERHEAD = 1.35       # 应用层content-length → 线上字节的协议放大(TLS/HTTP头/重传)
_REF_BW_PER_USER = 6 * 1024  # 参考人均出网 B/s(常规学习,保守)
_REF_CPU_PER_USER = 0.5      # 参考人均后端CPU %(压测PK≈0.55,常规学习更低)
_MEM_PER_USER = 512 * 1024   # 人均内存增量估计(WS连接/会话开销,保守)
_PK_REF = {"room8": 180, "room20": 37, "at_mbps": 12.0}  # 压测原始数据


async def _read_capacity_config(db: AsyncSession) -> dict:
    row = (await db.execute(
        text("SELECT value FROM system_settings WHERE key = :k"),
        {"k": _CAPACITY_KEY},
    )).fetchone()
    cfg = dict(_DEFAULT_CAPACITY_CONFIG)
    if row and row[0]:
        try:
            stored = json.loads(row[0])
            if isinstance(stored, dict) and stored.get("bandwidth_mbps"):
                cfg["bandwidth_mbps"] = float(stored["bandwidth_mbps"])
        except (ValueError, TypeError):
            pass
    return cfg


async def _role_breakdown(db: AsyncSession, ids: list[int]) -> dict:
    """活跃用户按角色分布;超过900个id截断(SQLite变量上限),分布仅供参考"""
    if not ids:
        return {}
    stmt = text(
        "SELECT role, COUNT(*) FROM users WHERE id IN :ids GROUP BY role"
    ).bindparams(bindparam("ids", expanding=True))
    rows = (await db.execute(stmt, {"ids": ids[:900]})).fetchall()
    return {r[0]: r[1] for r in rows}


async def _capacity_block(db: AsyncSession) -> dict:
    cfg = await _read_capacity_config(db)
    bw_limit = cfg["bandwidth_mbps"] * 1_000_000 / 8  # B/s

    active_5m = online_tracker.active_count(300)
    active_1m = online_tracker.active_count(60)
    app_up_bps, req_per_s = online_tracker.app_rates(300)
    app_up_wire = app_up_bps * _PROTO_OVERHEAD
    proc_cpu = float(_latest.get("proc_cpu") or 0.0)
    machine_up = float(_latest.get("net_up") or 0.0)
    mem_available = int(psutil.virtual_memory().available) if psutil else 0

    measured = active_5m >= _MIN_MEASURE_USERS and app_up_wire > 0
    if measured:
        per_user_bw = max(app_up_wire / active_5m, 2 * 1024)   # 下限2KB/s防除穿
        per_user_cpu = max(proc_cpu / active_5m, 0.15)
    else:
        per_user_bw = float(_REF_BW_PER_USER)
        per_user_cpu = _REF_CPU_PER_USER

    est_bw = int(bw_limit * _SAFETY / per_user_bw)
    # 单worker事件循环:上限1核=100%,不乘全机核数(见块首注释)
    est_cpu = int(100.0 * _SAFETY / per_user_cpu)
    est_mem = int(mem_available * 0.8 / _MEM_PER_USER) + active_5m

    estimates = {"bandwidth": est_bw, "cpu": est_cpu, "memory": est_mem}
    bottleneck = min(estimates, key=lambda k: estimates[k])
    scale = cfg["bandwidth_mbps"] / _PK_REF["at_mbps"]

    return {
        "config": cfg,
        "online": {
            "active_1m": active_1m,
            "active_5m": active_5m,
            "peak_today": online_tracker.peak_today(),
            "roles": await _role_breakdown(db, online_tracker.active_user_ids(300)),
        },
        "estimate": {
            "max_users": estimates[bottleneck],
            "bottleneck": bottleneck,
            "confidence": "measured" if measured else "reference",
            "by_resource": estimates,
        },
        "usage": {
            # 带宽水位用全机上行(含nginx/其他服务,反映真实占用);人均成本用应用层实测
            "bw_limit_bps": int(bw_limit),
            "bw_machine_up": int(machine_up),
            "bw_app_up": int(app_up_wire),
            "bw_percent": round(min(machine_up / bw_limit * 100, 100), 1) if bw_limit else 0,
            "proc_cpu_percent": round(proc_cpu, 1),   # 相对1核,可>100前端截断
            "req_per_s": round(req_per_s, 2),
            "per_user_bw": round(per_user_bw),
            "per_user_cpu": round(per_user_cpu, 2),
        },
        # PK对战是资源消耗最陡的场景(live_ranking广播O(n²)),单独给压测参考
        "pk_reference": {
            "room8_users": int(_PK_REF["room8"] * scale),
            "room20_users": int(_PK_REF["room20"] * scale),
            "tested_at_mbps": _PK_REF["at_mbps"],
        },
    }


class CapacityConfigPayload(BaseModel):
    bandwidth_mbps: float = Field(gt=0, le=10000, description="公网带宽上限(Mbps)")


@router.put("/capacity-config")
async def update_capacity_config(
    payload: CapacityConfigPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """设置公网带宽上限(腾讯云按购买值填,psutil看不到云厂商限速)"""
    value = json.dumps({"bandwidth_mbps": payload.bandwidth_mbps})
    await db.execute(
        text(
            "INSERT INTO system_settings (key, value) VALUES (:k, :v) "
            "ON CONFLICT(key) DO UPDATE SET value = :v"
        ),
        {"k": _CAPACITY_KEY, "v": value},
    )
    await db.commit()
    return {"ok": True, "bandwidth_mbps": payload.bandwidth_mbps}


@router.get("/metrics")
async def get_server_metrics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
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
        "capacity": await _capacity_block(db),
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
