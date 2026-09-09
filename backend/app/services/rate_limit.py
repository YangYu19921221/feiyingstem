"""进程内滑动窗口限流(单 worker 部署够用)

与 ai_quota 分工:那边是「每日额度」(消耗型,按北京日重置,用于付费 LLM 调用);
这里是「速率」(一个窗口内多少次),防的是**脚本批量拉取** ——
一个学生翻讲义再快也就一秒一两页,爬虫是一秒几十页,速率一卡就露馅。

多 worker 部署时换 Redis,只换这里的实现,调用点不动(CLAUDE.md 待做项已记)。
"""
from __future__ import annotations

import time
from collections import deque

from fastapi import HTTPException

# {key: deque[单调时钟时间戳]}。deque 两头都 O(1),窗口滑动只需 popleft
_buckets: dict[tuple, deque] = {}
# 桶数上限:超过就清掉一小时没动过的,免得脚本换 user_id 把内存撑爆
_SWEEP_AT = 20_000


def check(key: tuple, limit: int, window_sec: int, detail: str) -> None:
    """记一次;窗口内超过 limit 抛 429(带 Retry-After 告诉客户端等多久)。

    key 自己带上业务名,如 ("phonetic-page", user_id),别让两个功能撞同一个桶。
    """
    now = time.monotonic()
    dq = _buckets.get(key)
    if dq is None:
        dq = _buckets[key] = deque()
    cutoff = now - window_sec
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= limit:
        retry = int(dq[0] + window_sec - now) + 1
        raise HTTPException(status_code=429, detail=detail,
                            headers={"Retry-After": str(max(1, retry))})
    dq.append(now)

    if len(_buckets) > _SWEEP_AT:
        stale = now - 3600
        for k in [k for k, d in _buckets.items() if not d or d[-1] < stale]:
            _buckets.pop(k, None)


def reset() -> None:
    """测试用:清空全部计数"""
    _buckets.clear()