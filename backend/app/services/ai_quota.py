"""AI 用量限额(通用机制的第一块砖)

所有 LLM 端点的限流都该走这里,不要在端点里各自养私有计数器。
当前实现: 进程内按北京日计数(单进程部署够用);P3 换 DB/Redis 存储、
接入 organizations.ai_quota_json 按机构覆盖时,只换这里的实现,调用点不动。
"""
from fastapi import HTTPException

from app.core.timeutil import local_today

# {(user_id, feature): count},按日整体重置
_counts: dict = {}
_day = None


def check_and_consume(user_id: int, feature: str, daily_limit: int) -> None:
    """消耗一次额度;超限抛 429。只对真实消耗调用(缓存命中不要调)。"""
    global _day, _counts
    today = local_today()
    if _day != today:
        _day = today
        _counts = {}
    key = (user_id, feature)
    if _counts.get(key, 0) >= daily_limit:
        raise HTTPException(status_code=429, detail="今日AI次数已用完,明天再来~")
    _counts[key] = _counts.get(key, 0) + 1
