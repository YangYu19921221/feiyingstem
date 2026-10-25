"""滑动窗口限流

与 ai_quota 分工:那边是「每日额度」(消耗型,按北京日重置,用于付费 LLM 调用);
这里是「速率」(一个窗口内多少次),防的是**脚本批量拉取** ——
一个学生翻讲义再快也就一秒一两页,爬虫是一秒几十页,速率一卡就露馅。

计数放在 core/shared_store(2026-10-25 起,后端多进程): 所有进程共用一份;
没配 Redis 时退回进程内存 = 原来的单进程行为。
"""
from __future__ import annotations

import math

from fastapi import HTTPException

from app.core.shared_store import reset_memory, store


def _key(key: tuple) -> str:
    return "rl:" + ":".join(str(k) for k in key)


async def check(key: tuple, limit: int, window_sec: int, detail: str) -> None:
    """记一次;窗口内超过 limit 抛 429(带 Retry-After 告诉客户端等多久)。

    key 自己带上业务名,如 ("phonetic-page", user_id),别让两个功能撞同一个桶。
    """
    wait = await store.window_hit(_key(key), [(float(window_sec), limit)])
    if wait > 0:
        raise HTTPException(status_code=429, detail=detail,
                            headers={"Retry-After": str(max(1, math.floor(wait) + 1))})


async def count(key: tuple, window_sec: int) -> int:
    """只看不记: 窗口内已有几次(配合 record 做「失败才计数」的闸门)"""
    return await store.window_count(_key(key), float(window_sec))


async def record(key: tuple, window_sec: int = 3600) -> None:
    """只记不判(window_sec = 这条记录至少要留多久,取调用方 count 用的最长窗口)"""
    await store.window_record(_key(key), float(window_sec))


def reset() -> None:
    """测试用:清空全部计数(只清进程内存那一份;测试不配 Redis)"""
    reset_memory()
