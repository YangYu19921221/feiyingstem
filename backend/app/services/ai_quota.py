"""AI 用量限额(通用机制的第一块砖)

所有 LLM 端点的限流都该走这里,不要在端点里各自养私有计数器。
计数按北京日放在 core/shared_store(2026-10-25 起,后端多进程): 所有进程共用一份,
否则开 N 个进程每人每天就能用 N 倍;没配 Redis 时退回进程内存 = 原来的行为。
接入 organizations.ai_quota_json 按机构覆盖时,只换这里的实现,调用点不动。
"""
from fastapi import HTTPException

from app.core.shared_store import store
from app.core.timeutil import local_today

# 计数留两天(跨零点那一刻前一天的键还在被读也无妨,第二天自然过期)
_TTL = 2 * 86400


def _key(user_id: int, feature: str) -> str:
    return f"aiq:{local_today().isoformat()}:{feature}:{user_id}"


async def check_and_consume(user_id: int, feature: str, daily_limit: int) -> None:
    """消耗一次额度;超限抛 429。只对真实消耗调用(缓存命中不要调)。"""
    if not await store.incr_if_below(_key(user_id, feature), daily_limit, _TTL):
        raise HTTPException(status_code=429, detail="今日AI次数已用完,明天再来~")


async def used(user_id: int, feature: str) -> int:
    """今天已经用了几次"""
    v = await store.get(_key(user_id, feature))
    return int(v) if v else 0


async def refund(user_id: int, feature: str) -> None:
    """退回一次(调用彻底失败、孩子什么都没拿到时)。不会退成负数"""
    if await used(user_id, feature) > 0:
        await store.incr(_key(user_id, feature), -1, _TTL)
