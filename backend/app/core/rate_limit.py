"""通用滑动窗口限流(反爬虫)

场景:内容读取端点(单词库/单词本)即使带合法 token 也不能被脚本批量抓取。
按 (账号, 用途) 维度多窗口限流——正常人最猛的一次交互(学习页一次并发拉 20+ 词)
放行,持续枚举(翻页扫全库 / 逐 id 遍历)会被压到很低速率,账号可追溯可封停。

当前实现:进程内内存(单进程部署够用)。多 worker 部署时换 Redis,
只改这里的存储,调用点不动(与 ai_quota 同一演进路线)。
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status

# {(key, feature): deque[timestamp]},只保留最长窗口内的时间戳
_hits: dict = defaultdict(deque)
# 惰性清理游标:每积累若干次调用扫一遍,清掉长期不活跃的空 deque,防内存缓慢增长
_calls_since_gc = 0
_GC_EVERY = 5000


def _gc(now: float, max_window: float) -> None:
    global _calls_since_gc
    _calls_since_gc = 0
    stale = [k for k, dq in _hits.items() if not dq or now - dq[-1] > max_window]
    for k in stale:
        _hits.pop(k, None)


def check_rate(key: str, feature: str, windows: list[tuple[float, int]]) -> None:
    """滑动窗口限流。windows=[(秒, 上限), ...];任一窗口超限即抛 429。

    key 一般传 user_id;feature 区分不同资源族,避免互相挤占额度。
    """
    global _calls_since_gc
    now = time.monotonic()
    max_window = max(w for w, _ in windows)

    dq = _hits[(key, feature)]
    # 丢弃超出最长窗口的旧时间戳
    while dq and now - dq[0] > max_window:
        dq.popleft()

    # 逐窗口计数(dq 已按时间升序,从右往左数落在窗口内的即可)
    for span, limit in windows:
        cnt = sum(1 for t in dq if now - t <= span)
        if cnt >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="请求过于频繁,请稍后再试",
            )

    dq.append(now)

    _calls_since_gc += 1
    if _calls_since_gc >= _GC_EVERY:
        _gc(now, max_window)
