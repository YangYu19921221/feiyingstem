"""记忆妙招走 Claude(2026-10-31,用户「记忆妙招你接入 claude 的吧」)

以前走默认 AI 通道(阿里云百炼),10-11 起欠费,孩子点「记忆妙招」一直出不来。
现在先用学习助手那个专用 Key(claude_tutor,用户 10-31 明确同意记忆妙招也用它),没配 / 没调通再退回默认通道。

为什么花得起: 一个词全平台只生成一次(words.memory_hook 缓存),之后所有孩子免费看;
每个孩子每天最多真生成 20 个(ai_quota memory_hook)。用备用模型(sonnet-4-6,不开思考,约 2 秒)、max_tokens 200。
用量按北京日记在共享存储(memhook:{日}:n / :tok),管理端「AI 学习助手」卡片显示近 7 天。
"""
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import local_today

logger = logging.getLogger(__name__)

MAX_TOKENS = 200
MAX_LEN = 160
_TTL = 10 * 86400


class RelayError(Exception):
    """中转回了非 200: 带上状态码和正文,ai_errors.classify 能认出欠费 / Key 失效 / 太忙"""

    def __init__(self, status_code: int, body: str):
        super().__init__(f"HTTP {status_code}: {body[:300]}")
        self.status_code = status_code


_PAIRS = {'"': '"', "“": "”", "「": "」"}


def clean(text: str) -> str:
    """去 markdown;整段被一对引号包着才去掉那对(不能 strip 引号字符: 「"耐死"都…」会被削掉开头那个)"""
    from app.services import tutor as tt
    t = tt.plain(text or "").strip()
    if len(t) >= 2 and _PAIRS.get(t[0]) == t[-1] and t[0] not in t[1:-1] and t[-1] not in t[1:-1]:
        t = t[1:-1].strip()
    return t[:MAX_LEN].strip()


async def _count(tokens: int) -> None:
    day = local_today().isoformat()
    try:
        await store.incr(f"memhook:{day}:n", 1, _TTL)
        await store.incr(f"memhook:{day}:tok", int(tokens), _TTL)
    except Exception:  # noqa: BLE001
        logger.debug("记记忆妙招用量出错", exc_info=True)


async def usage(days: int = 7) -> dict:
    today = local_today()
    n = tok = 0
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        n += int(await store.get(f"memhook:{d}:n") or 0)
        tok += int(await store.get(f"memhook:{d}:tok") or 0)
    return {"days": days, "generated": n, "tokens": tok}


async def via_claude(db: AsyncSession, prompt: str) -> Optional[str]:
    """学习助手的中转(claude_tutor)写一条;没配返回 None,配了没调通抛最后那个错"""
    from app.services import tutor as tt
    conf = await tt.relay_conf(db)
    if conf is None:
        return None
    # 备用模型(sonnet-4-6)在前: 不开思考、快、便宜;它不行再用主模型
    models = [m for m in dict.fromkeys([conf.fallback, conf.model]) if m]
    last: Optional[Exception] = None
    async with tt.new_client() as cli:
        for m in models:
            if await tt._is_down(m):
                continue
            body = {"model": m, "max_tokens": MAX_TOKENS,
                    "messages": [{"role": "user", "content": prompt}]}
            body.update(tt.fast_thinking(m))
            try:
                r = await cli.post(f"{conf.base_url}/v1/messages", headers=tt._headers(conf), json=body)
            except Exception as e:  # noqa: BLE001
                last = e
                continue
            if r.status_code != 200:
                last = RelayError(r.status_code, r.text)
                if r.status_code in (404, 503):
                    await tt._mark_down(m)
                continue
            data = r.json()
            text = "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")
            if tt.RELAY_EMPTY_MARK in text or data.get("stop_reason") == "refusal":
                last = RelayError(502, "上游没给内容")
                continue
            hook = clean(text)
            if hook:
                u = data.get("usage") or {}
                await _count(int((u.get("input_tokens") or 0) + (u.get("output_tokens") or 0)))
                return hook
            last = RelayError(502, "上游没给内容")
    if last is not None:
        raise last
    return None


async def generate(db: AsyncSession, word: str, meaning: str, syllables: Optional[str]) -> tuple[str, str]:
    """(妙招, 来源 claude / default)。两条都不行抛错: 配了 Claude 就报 Claude 的错(它是主通道)"""
    from app.services.ai_service import ai_service, memory_hook_prompt
    prompt = memory_hook_prompt(word, meaning, syllables)
    claude_err: Optional[Exception] = None
    try:
        hook = await via_claude(db, prompt)
        if hook:
            return hook, "claude"
    except Exception as e:  # noqa: BLE001
        claude_err = e
        logger.warning("记忆妙招 Claude 没调通,改用默认通道: %s", e)
    try:
        hook = clean(await ai_service.generate_memory_hook(word, meaning, syllables))
    except Exception:
        if claude_err is not None:
            raise claude_err
        raise
    return hook, "default"
