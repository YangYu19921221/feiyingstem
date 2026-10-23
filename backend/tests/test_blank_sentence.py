"""例句挖空(句子填空 / 选词填空 / 单元考试共用)

2026-10-23 全站补例句时发现的挖不出空: 连字符词、be + 形容词短语、不规则过去式、双写辅音。
前端 frontend/src/utils/blankSentence.ts 是同一份规则,这里解析前端文件核对不规则词表一致
(两边漂移了就会出现「前端能挖、后端判分对不上」)。
"""
import re
from pathlib import Path

import pytest

from app.utils.blank_sentence import _IRREGULAR, blank_out, find_blank_span

FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "blankSentence.ts"


def test_irregular_table_matches_frontend():
    ts = FRONT.read_text(encoding="utf-8")
    block = ts[ts.index("const IRREGULAR"):ts.index("};", ts.index("const IRREGULAR"))]
    front = dict(re.findall(r"([a-z']+): '([a-z']+)'", block))
    assert front == _IRREGULAR


@pytest.mark.parametrize("sentence,word,expected", [
    ("My brother is wearing a blue T-shirt.", "T-shirt", "T-shirt"),
    ("My father is a hard-working man.", "hard-working", "hard-working"),
    ("My brother is good at playing basketball.", "be good at", "is good at"),
    ("The fridge is full of fresh fruit.", "be full of", "is full of"),
    ("We are getting ready for the school trip.", "get ready", "getting ready"),
    ("She is putting on her red coat now.", "put on", "putting on"),
    ("Last year, my family moved to Beijing.", "move to", "moved to"),
    ("He stopped at the red light.", "stop", "stopped"),
    ("She told me a funny story.", "tell", "told"),
    ("She always helps others.", "help", "helps"),
    ("Happy birthday to you!", "happy", "Happy"),
])
def test_blanks_inflected_and_compound_forms(sentence, word, expected):
    span = find_blank_span(sentence, word)
    assert span is not None
    assert sentence[span[0]:span[1]] == expected


def test_does_not_blank_inside_other_words():
    # 以前单元考试用 str.replace: "eat" 会把 "great" 挖成 "gr______"
    assert blank_out("It is a great day.", "eat") is None
    assert blank_out("I eat an apple.", "eat") == "I ______ an apple."


def test_plain_plural_with_double_letters_kept():
    # 双写还原只对 -ing/-ed: "dresses" 不该被当成 "dres"
    span = find_blank_span("She has two new dresses.", "dress")
    assert span is not None
