"""跨进程互斥锁(2026-10-25,后端多进程)

以前「一次只跑一个 ffmpeg / soffice」靠模块里的 asyncio.Lock / Semaphore,只管得住本进程;
开了多个工作进程以后,两个老师同时传视频 / 课件会落在不同进程上,各自的锁都是空的 →
几个 ffmpeg / soffice 同时跑(soffice 一个几百 MB,一起跑有 OOM 风险,OOM 会掐掉整个服务)。
这里用文件锁(fcntl.flock)把同名的锁跨进程排队。

用非阻塞 flock + 轮询,不用阻塞 flock 丢线程池: 线程里阻塞等锁时请求被取消,
线程过后拿到锁却没人释放,会把后面所有人卡死。进程崩了操作系统自动放锁,不会留死锁。
"""
from __future__ import annotations

import asyncio
import contextlib
import fcntl
import os
from pathlib import Path

LOCK_DIR = Path(__file__).resolve().parents[2] / "private_media" / "locks"
_POLL_SEC = 0.3


@contextlib.asynccontextmanager
async def interprocess_lock(name: str):
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(LOCK_DIR / f"{name}.lock"), os.O_RDWR | os.O_CREAT, 0o644)
    locked = False
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
                break
            except BlockingIOError:
                await asyncio.sleep(_POLL_SEC)
        yield
    finally:
        try:
            if locked:
                fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
