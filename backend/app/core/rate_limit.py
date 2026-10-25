"""通用滑动窗口限流(反爬虫)

场景:内容读取端点(单词库/单词本)即使带合法 token 也不能被脚本批量抓取。
按 (账号, 用途) 维度多窗口限流——正常人最猛的一次交互(学习页一次并发拉 20+ 词)
放行,持续枚举(翻页扫全库 / 逐 id 遍历)会被压到很低速率,账号可追溯可封停。

计数放在 core/shared_store(2026-10-25 起): 多个工作进程共用一份,
否则开 N 个进程限额就被放大 N 倍。没配 Redis 时退回进程内存 = 原来的行为。
"""
from fastapi import HTTPException, status

from app.core.shared_store import store


async def check_rate(key: str, feature: str, windows: list[tuple[float, int]]) -> None:
    """滑动窗口限流。windows=[(秒, 上限), ...];任一窗口超限即抛 429。

    key 一般传 user_id;feature 区分不同资源族,避免互相挤占额度。
    """
    wait = await store.window_hit(f"rl2:{feature}:{key}", windows)
    if wait > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁,请稍后再试",
        )
