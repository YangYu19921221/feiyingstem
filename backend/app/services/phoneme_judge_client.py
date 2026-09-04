"""闭集判定客户端 —— 主应用侧

## 为什么要独立进程
模型(wav2vec2-large)推理常驻约 2.6GB,而生产机可用内存只剩 4.6GB,
且 uvicorn 是**单 worker**(PK 房间/限流是进程内状态,加 worker 会崩)。
模型与主应用同进程会:①推理时抢 CPU 拖慢登录/交卷 ②内存吃紧
③模型崩了连带整站挂。

所以模型跑在独立进程(scripts/phoneme_judge_server.py),主应用通过
本地 HTTP 调它。这样最坏情况只是判定不可用 —— 前端退回纯对比回放,课照上。

## 判定不可用是常态,不是异常
判定服务没起、超时、模型没下载,都返回 verdict='off'。
**绝不能因此挡住孩子读下一个词** —— 录音留档与判定是两件事,前者必须成功。
"""
import logging
from typing import List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# 判定要在孩子的耐心之内返回。实测单次推理 0.25s(含 20 个候选打分),
# 3 秒足够;超时就当判定不可用,不让孩子干等
_TIMEOUT = 3.0


async def judge(audio: bytes, target_word: str,
                candidates: dict) -> Optional[dict]:
    """请独立进程判一次。

    candidates: {词: 音素token列表} —— 本节全部词,闭集范围。
    返回 None 表示判定不可用(服务没起/超时/出错),调用方应按 'off' 处理。
    """
    url = getattr(settings, "PHONEME_JUDGE_URL", "") or ""
    if not url:
        return None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(
                f"{url.rstrip('/')}/judge",
                files={"audio": ("a.webm", audio, "application/octet-stream")},
                data={"target": target_word,
                      "candidates": _dumps(candidates)},
            )
        if r.status_code != 200:
            logger.warning("判定服务返回 %s", r.status_code)
            return None
        return r.json()
    except Exception as e:
        # 判定不可用是常态(服务可能没部署),用 info 而不是 error 免得刷满日志
        logger.info("判定服务不可用: %s", e)
        return None


def _dumps(d: dict) -> str:
    import json
    return json.dumps(d, ensure_ascii=False)


async def healthy() -> bool:
    url = getattr(settings, "PHONEME_JUDGE_URL", "") or ""
    if not url:
        return False
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            r = await c.get(f"{url.rstrip('/')}/health")
        return r.status_code == 200
    except Exception:
        return False
