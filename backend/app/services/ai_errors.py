"""AI 调用失败时说清楚为什么(2026-10-31,用户「下次如果出现这样的问题你要提示让用户知道这是什么原因」)

以前直接把上游的英文报错塞给孩子(「AI服务暂不可用: Error code: 400 - {'error': {'message': 'Access denied ... overdue-payment'」),
管理员也只能在控制台里看到一个 503。这里把常见的几种失败翻成一句中文:
  - 欠费(阿里云百炼 Arrearage / overdue-payment / 余额不足)
  - Key 失效(401 / invalid api key)
  - 太忙(429 / rate limit)、超时、连不上、没配置
并把最近一次失败记在共享存储里,管理端首页顶上显示(成功一次就清掉)。
只管默认 AI 通道(ai_service._call_llm 那条);学习助手 / 出图有自己的钱包检查(tutor_relay_health)。
"""
import logging
from datetime import datetime
from typing import Optional

from app.core.shared_store import store

logger = logging.getLogger(__name__)

LAST_ERROR_KEY = "ai:default:last_error"
_TTL = 2 * 86400

# (code, 给人看的原因) —— 原因要能说清「谁来处理」
REASONS = {
    "ai_arrears": "平台的 AI 服务账户欠费了,管理员充值后恢复",
    "ai_key_invalid": "平台的 AI 密钥失效了,管理员在「AI 配置」里换一个",
    "ai_busy": "AI 服务这会儿太忙,过一会儿再试",
    "ai_timeout": "AI 服务响应太慢,过一会儿再试",
    "ai_unreachable": "连不上 AI 服务,过一会儿再试",
    "ai_not_configured": "平台还没配置 AI 服务,管理员在「AI 配置」里配一个",
    "ai_error": "AI 服务出错了,过一会儿再试",
}


def classify(e: BaseException) -> str:
    """异常 → 原因代码"""
    text = f"{type(e).__name__} {e}".lower()
    status = getattr(e, "status_code", None)
    if any(k in text for k in ("arrearage", "overdue", "insufficient_quota", "insufficient balance",
                               "余额不足", "欠费", "account is in good standing")):
        return "ai_arrears"
    if status == 401 or any(k in text for k in ("invalid api key", "incorrect api key", "invalid_api_key",
                                                "authentication", "unauthorized")):
        return "ai_key_invalid"
    if status == 429 or "rate limit" in text or "ratelimit" in text or "too many requests" in text:
        return "ai_busy"
    if "timeout" in text or "timed out" in text:
        return "ai_timeout"
    if any(k in text for k in ("connecterror", "connection", "apiconnectionerror", "name or service not known")):
        return "ai_unreachable"
    if "未配置" in text:
        return "ai_not_configured"
    return "ai_error"


def reason_of(e: BaseException) -> str:
    return REASONS[classify(e)]


async def note_failure(e: BaseException, model: Optional[str] = None) -> None:
    """记下最近一次失败(管理端首页看)。自己出错不影响调用方"""
    try:
        code = classify(e)
        import json
        await store.set(LAST_ERROR_KEY, json.dumps({
            "code": code, "message": REASONS[code], "model": model or "",
            "at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }, ensure_ascii=False), _TTL)
    except Exception:  # noqa: BLE001
        logger.debug("记 AI 失败原因出错", exc_info=True)


async def note_ok() -> None:
    try:
        if await store.get(LAST_ERROR_KEY):
            await store.delete(LAST_ERROR_KEY)
    except Exception:  # noqa: BLE001
        logger.debug("清 AI 失败原因出错", exc_info=True)


async def last_error() -> Optional[dict]:
    import json
    try:
        raw = await store.get(LAST_ERROR_KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None
