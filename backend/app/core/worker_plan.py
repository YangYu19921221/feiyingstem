"""开几个工作进程: 按这台机器的 CPU 核数和可用内存现算(2026-10-25)

用户要求「服务器升级 CPU / 内存后不用改配置」: 工作进程服务每次启动时调 plan() 算一遍,
升级完重启一次服务(或重启机器)就按新配置开,不用改任何文件。

规则:
- 按 CPU: 核数 - 1(留一核给主进程: PK / 直播弹幕 / 宠物对战这些实时功能都在主进程里,
  主进程忙不过来实时功能就卡;开口背转写进程池平时空着,忙起来和工作进程抢,能接受)
- 按内存: (可用内存 - 预留) ÷ 每个工作进程按多少算。预留给主进程临时要的(Whisper 模型首次加载约 500MB、
  PPT 转换的 soffice 几百 MB、ffmpeg 压视频)和系统页缓存 —— 内存不够时宁可少开,开多了被 OOM 杀掉更糟
- 两者取小,至少 1 个、至多 MAX_WORKERS 个
- 环境变量 EH_WORKERS=数字 可以写死(排查问题 / 临时压低用),优先于自动计算

实测(2026-10-25 生产 4 核 8G): 一个进程导入完全部接口约 150MB,跑一阵子会涨,按 PER_WORKER_MB 算;
那时可用内存约 3.9GB → 按 CPU 3 个、按内存 7 个 → 开 3 个(主进程 1 + 工作进程 3 = 4 核都用上)。
"""
from __future__ import annotations

import os
from typing import Optional

PER_WORKER_MB = 300
RESERVE_MB = 1536
MAX_WORKERS = 16


def usable_cpus() -> int:
    """本进程能用的核数(容器 / taskset 限过核时比 os.cpu_count() 准)"""
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):   # macOS 没有 sched_getaffinity
        return max(1, os.cpu_count() or 1)


def available_mb() -> Optional[int]:
    try:
        import psutil
        return int(psutil.virtual_memory().available / 1024 / 1024)
    except Exception:  # noqa: BLE001  psutil 没装: 只按 CPU 算
        return None


def plan(cpus: Optional[int] = None, avail_mb: Optional[int] = None,
         override: Optional[str] = None, *, probe: bool = True) -> dict:
    """返回 {"workers", "cpus", "avail_mb", "by_cpu", "by_mem", "limited_by"}。
    probe=False 时不读本机(测试传死数用)"""
    if cpus is None:
        cpus = usable_cpus() if probe else 1
    if avail_mb is None and probe:
        avail_mb = available_mb()
    if override is None:
        override = os.environ.get("EH_WORKERS")

    by_cpu = max(1, cpus - 1)
    by_mem = None if avail_mb is None else max(1, (avail_mb - RESERVE_MB) // PER_WORKER_MB)

    n, limited_by = by_cpu, "cpu"
    if by_mem is not None and by_mem < n:
        n, limited_by = by_mem, "memory"
    if n > MAX_WORKERS:
        n, limited_by = MAX_WORKERS, "max"
    if override and override.strip().isdigit():
        n, limited_by = max(1, min(int(override.strip()), MAX_WORKERS)), "override"

    return {"workers": n, "cpus": cpus, "avail_mb": avail_mb,
            "by_cpu": by_cpu, "by_mem": by_mem, "limited_by": limited_by}
