"""弹幕内容过滤 —— 纯本地、零外部调用。

儿童产品的实时弹幕必须先过一道。这里做三件事:
1. 去首尾空白、压缩连续空白、截断到 200 字(与 LiveDanmaku.content 列宽一致)。
2. 命中敏感词 → 替换成等长 `*`。
3. 若整条几乎全被替换(说明基本是脏话堆砌)→ 判定 blocked,调用方丢弃不广播。

词表内置一份基础的(辱骂 / 联系方式诱导 / 明显不适合课堂的引流词),
后续可加表。**故意不接外部审核 API** —— 弹幕量大、要实时,一次网络往返就把
250ms 的节流窗口吃穿了,且外部服务挂了会连累发弹幕。基础过滤 + 老师可删/禁言
的组合足够课堂场景。
"""
from __future__ import annotations

import re

# 基础敏感词。小写匹配(英文)+ 原样匹配(中文)。
# 只放"课堂里冒出来明显要拦"的,不追求完备——完备靠老师删除兜底。
_BLOCK_WORDS = [
    # 辱骂类
    "傻逼", "傻b", "sb", "垃圾", "废物", "滚蛋", "去死", "白痴", "智障", "脑残",
    "妈的", "他妈", "草泥马", "cnm", "nmsl", "操你", "fuck", "shit", "bitch",
    # 引流 / 联系方式诱导(把孩子往站外带)
    "加微信", "加qq", "加我微", "私聊", "扫码", "vx", "威信", "薇信",
    # 政治敏感占位(保持克制,主要靠老师删)
    "翻墙", "vpn",
]

# 连续数字 11 位以上 → 疑似手机号/QQ,打码(防站外联系)
_LONG_DIGITS = re.compile(r"\d{11,}")
_WS = re.compile(r"\s+")

MAX_LEN = 200


def clean_danmaku(text: str) -> tuple[str, bool]:
    """返回 (清洗后的文本, 是否应丢弃)。

    blocked=True 时调用方不落库、不广播,回一条 error 告诉发送者。
    """
    if not text:
        return "", True

    # 1. 规整空白 + 截断
    cleaned = _WS.sub(" ", text).strip()
    if not cleaned:
        return "", True
    if len(cleaned) > MAX_LEN:
        cleaned = cleaned[:MAX_LEN]

    original_len = len(cleaned)
    masked_chars = 0

    # 2. 长数字串打码
    def _mask_digits(m: re.Match) -> str:
        nonlocal masked_chars
        masked_chars += len(m.group(0))
        return "*" * len(m.group(0))

    cleaned = _LONG_DIGITS.sub(_mask_digits, cleaned)

    # 3. 敏感词替换(大小写不敏感)
    lower = cleaned.lower()
    for word in _BLOCK_WORDS:
        start = 0
        while True:
            idx = lower.find(word, start)
            if idx == -1:
                break
            span = len(word)
            cleaned = cleaned[:idx] + ("*" * span) + cleaned[idx + span:]
            lower = cleaned.lower()  # 保持同步(长度不变)
            masked_chars += span
            start = idx + span

    # 4. 整条几乎全是敏感词 → 丢弃
    if original_len > 0 and masked_chars >= max(2, original_len * 0.6):
        return cleaned, True

    return cleaned, False
