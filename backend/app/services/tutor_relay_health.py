"""学习助手中转钱包和 Key 自动检查(2026-10-27,用户「按你的建议全做了」)

钱包见底或 Key 被换掉/作废,孩子问什么都是「这次没有回答上来」,以前要等人来报才知道。
现在主进程每 CHECK_MINUTES 分钟查一次(挂在 sentence_speech.speech_loop 里,和对话清理一起),管理端「AI 学习助手」卡片顶上显示。

## 怎么查(不花模型钱)
中转有 GET /v1/usage(实测 10-27): 带 Key 请求,回 {balance, isValid, ...};Key 不对回 401 INVALID_API_KEY。
学习助手(claude_tutor)和画图(image_tutor)两个 Key 各查一次 —— 两个 Key 在同一个钱包时余额一样,分开查是为了知道哪个 Key 坏了。
别的中转 / 官方接口没有这个地址(404)就记「查不到余额」,只靠下面的「最近失败」判断。

## 结果
- ok: 余额 ≥ WARN_BALANCE
- low: 余额 < WARN_BALANCE(黄);empty: < EMPTY_BALANCE(红,马上就没法用了)
- invalid: Key 失效(红)
- unknown: 查不到(网络 / 中转没这个接口);不当成坏了
另外现算最近 1 小时学习助手回答失败几次(tutor_messages 里没字只有错误的,孩子自己停下的不算)。
结果放 shared_store(多进程都看得到),不进库;Key 只用来请求,不记日志不回显。
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Optional

import httpx
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import utc_now

logger = logging.getLogger(__name__)

CHECK_MINUTES = 30
WARN_BALANCE = 30.0      # 中转余额单位是美元(10-27 实测 444.9)。快速一问约 $0.014,30 美元约两千问
EMPTY_BALANCE = 5.0
STORE_KEY = "tutor:relay_health"
TIMEOUT = 15


def new_client() -> httpx.AsyncClient:
    # trust_env=False: 本机有 SOCKS 代理时 httpx 会崩(见 feedback hueling 代理坑)
    return httpx.AsyncClient(timeout=TIMEOUT, trust_env=False)


def judge(balance: Optional[float], valid: Optional[bool]) -> str:
    if valid is False:
        return "invalid"
    if balance is None:
        return "unknown"
    if balance < EMPTY_BALANCE:
        return "empty"
    if balance < WARN_BALANCE:
        return "low"
    return "ok"


async def probe(base: str, key: str, client: Optional[httpx.AsyncClient] = None) -> dict:
    """查一个 Key: {status, balance, note}"""
    base = (base or "").strip().rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    own = client is None
    client = client or new_client()
    try:
        r = await client.get(f"{base}/v1/usage", headers={"x-api-key": key, "Authorization": f"Bearer {key}"})
    except Exception as e:  # noqa: BLE001
        return {"status": "unknown", "balance": None, "note": f"连不上中转({type(e).__name__})"}
    finally:
        if own:
            await client.aclose()
    if r.status_code in (401, 403):
        return {"status": "invalid", "balance": None, "note": "Key 不对或已经作废"}
    if r.status_code != 200:
        return {"status": "unknown", "balance": None, "note": f"查不到余额(HTTP {r.status_code})"}
    try:
        d = r.json()
    except ValueError:
        return {"status": "unknown", "balance": None, "note": "查不到余额"}
    bal = d.get("balance")
    try:
        bal = round(float(bal), 2) if bal is not None else None
    except (TypeError, ValueError):
        bal = None
    valid = d.get("isValid")
    valid = None if valid is None else bool(valid)
    status = judge(bal, valid)
    note = {"ok": "正常", "low": "余额不多了,尽快充值", "empty": "余额快用完了,孩子马上就问不了了",
            "invalid": "Key 已经失效", "unknown": "查不到余额"}[status]
    return {"status": status, "balance": bal, "note": note}


async def recent_failures(db: AsyncSession, minutes: int = 60) -> dict:
    """最近 N 分钟学习助手回答: 一共几次,没调通几次(孩子自己停下的不算)"""
    from app.models.tutor import TutorMessage

    since = utc_now() - timedelta(minutes=minutes)
    total, failed = (await db.execute(
        select(func.count(TutorMessage.id),
               func.sum(case(((TutorMessage.text == "") & TutorMessage.error.isnot(None)
                              & (TutorMessage.error != "停下了"), 1), else_=0)))
        .where(TutorMessage.role == "assistant", TutorMessage.created_at >= since)
    )).one()
    return {"minutes": minutes, "answers": int(total or 0), "failed": int(failed or 0)}


async def check(db: AsyncSession, client: Optional[httpx.AsyncClient] = None) -> dict:
    """两个 Key 各查一次,写进 shared_store,返回结果"""
    from app.services import tutor as tt
    from app.services import word_picture as wp

    out: dict = {"checked_at": utc_now().isoformat()}
    conf = await tt.relay_conf(db)
    out["tutor"] = (await probe(conf.base_url, conf.api_key, client) if conf
                    else {"status": "unset", "balance": None, "note": "没配学习助手的 Key"})
    img = await wp.image_conf(db)
    out["picture"] = (await probe(img["base"], img["key"], client) if img
                      else {"status": "unset", "balance": None, "note": "没配画图的 Key"})
    await store.set(STORE_KEY, json.dumps(out, ensure_ascii=False), CHECK_MINUTES * 60 * 4)
    worst = [k for k in ("tutor", "picture") if out[k]["status"] in ("invalid", "empty", "low")]
    if worst:
        logger.warning("学习助手中转检查: %s", {k: out[k]["status"] for k in worst})
    return out


async def last(db: AsyncSession) -> dict:
    """管理端卡片读: 上次检查结果(没有就现查一次)+ 最近 1 小时失败"""
    raw = await store.get(STORE_KEY)
    data = None
    if raw:
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
    if data is None:
        data = await check(db)
    data["recent"] = await recent_failures(db)
    data["warn_balance"] = WARN_BALANCE
    return data


_last_run = 0.0


async def check_quietly(now_mono: float) -> None:
    """后台循环调: 到点了才查,出错只记日志"""
    global _last_run
    if _last_run and now_mono - _last_run < CHECK_MINUTES * 60:
        return
    _last_run = now_mono
    from app.core.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            await check(db)
    except Exception:  # noqa: BLE001
        logger.exception("学习助手中转检查出错")
