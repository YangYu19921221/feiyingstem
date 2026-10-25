#!/usr/bin/env python
"""工作进程服务的启动入口(systemd 单元 english-helper-workers 调它,见 deploy/multiproc/)。

每次启动按这台机器的 CPU 核数和可用内存现算开几个工作进程(core/worker_plan),
所以服务器升级 CPU / 内存后**重启一次服务就按新配置开**,不用改任何文件。

步骤: ①等主进程(8000)的 /health 通 —— 建表 / 迁移在主进程启动时做,工作进程先起来会查到还没加的列
②算个数、打一行日志(journalctl -u english-helper-workers 能看到为什么是这个数)
③exec 成 uvicorn --workers N(PROCESS_ROLE=worker,只听 127.0.0.1)。

    python scripts/start_workers.py --dry-run    # 只打印会开几个,不启动
环境变量: EH_WORKERS=数字 写死个数;EH_WORKERS_PORT 端口(默认 8001);EH_MAIN_HEALTH 主进程健康检查地址
"""
from __future__ import annotations

import os
import sys
import time
import urllib.request

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.core.worker_plan import plan  # noqa: E402

MAIN_HEALTH = os.environ.get("EH_MAIN_HEALTH", "http://127.0.0.1:8000/health")
WAIT_MAIN_SEC = 180


def wait_main() -> bool:
    deadline = time.monotonic() + WAIT_MAIN_SEC
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(MAIN_HEALTH, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:  # noqa: BLE001  主进程还在启动
            pass
        time.sleep(2)
    return False


def describe(p: dict) -> str:
    why = {"cpu": "按 CPU(核数 - 1,留一核给主进程)", "memory": "按可用内存(不够开满)",
           "max": "到上限", "override": "EH_WORKERS 写死"}[p["limited_by"]]
    mem = "未知" if p["avail_mb"] is None else f"{p['avail_mb']}MB"
    return (f"工作进程 {p['workers']} 个 —— {why};CPU {p['cpus']} 核、可用内存 {mem}"
            f"(按 CPU 可开 {p['by_cpu']}、按内存可开 {p['by_mem']})")


def main() -> None:
    p = plan()
    if "--dry-run" in sys.argv:
        print(describe(p))
        return
    if not wait_main():
        print(f"主进程 {MAIN_HEALTH} {WAIT_MAIN_SEC} 秒没通,照样启动工作进程", flush=True)
    p = plan()   # 等主进程期间内存可能变了,按启动这一刻的算
    print(describe(p), flush=True)

    port = os.environ.get("EH_WORKERS_PORT", "8001")
    os.environ["PROCESS_ROLE"] = "worker"
    os.chdir(BACKEND)
    args = [sys.executable, "-m", "uvicorn", "app.main:app",
            "--host", "127.0.0.1", "--port", port,
            "--workers", str(p["workers"]),
            "--timeout-graceful-shutdown", "20"]
    os.execv(sys.executable, args)


if __name__ == "__main__":
    main()
