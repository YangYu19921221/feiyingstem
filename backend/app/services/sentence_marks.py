"""句子里的高频词标记(2026-10-11)。

老师录入/导入时用 # 把高频词包起来: `I #like# apples.`(`##like##` 也认,两种写法都有人用)。
- 存库: english = 去掉 # 的原句(判分、TTS、去重都用它,不受标记影响)
         english_marked = 带 # 的原文(只给显示用);没标任何词时为 None
- # 不成对 / 包了个空的 → 报错,指出是哪里(导入时按行报,不静默吞掉)
"""
from __future__ import annotations

import re
from typing import Optional

_SPACES = re.compile(r"\s+")


class MarkError(ValueError):
    pass


def parse(raw: str) -> tuple[str, Optional[str]]:
    """返回 (干净的句子, 带标记的句子或 None)。格式不对抛 MarkError(中文说明)"""
    text = _SPACES.sub(" ", (raw or "").strip())
    if "#" not in text:
        return text, None
    # ##词## 与 #词# 等价
    text = re.sub(r"#{2,}", "#", text)
    parts = text.split("#")
    if len(parts) % 2 == 0:
        raise MarkError("# 没有成对,高频词要用两个 # 包起来,如 I #like# apples.")
    marked_parts: list[str] = []
    for i, seg in enumerate(parts):
        if i % 2 == 1:
            seg = seg.strip()
            if not seg:
                raise MarkError("有一对 # 中间是空的")
            marked_parts.append(f"#{seg}#")
        else:
            marked_parts.append(seg)
    marked = _SPACES.sub(" ", "".join(marked_parts)).strip()
    clean = _SPACES.sub(" ", marked.replace("#", "")).strip()
    return clean, marked


def highlighted(marked: Optional[str]) -> list[str]:
    """标出来的词/短语,按出现顺序"""
    if not marked:
        return []
    return [seg.strip() for i, seg in enumerate(marked.split("#")) if i % 2 == 1 and seg.strip()]
