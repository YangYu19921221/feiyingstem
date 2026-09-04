"""音素归一与逐格比对 —— 纯函数,不加载模型

## 这些用例的来源
全部来自 wav2vec2(facebook/wav2vec2-lv-60-espeak-cv-ft)在 Edge TTS 标准音上的
**真实输出**,不是编的。跑法见 §实测记录。

## 为什么这些测试重要
归一表是一把双刃刀:
  - 折叠得不够 → 假拒绝(bed 输出 bɛd 被判错,孩子读对了说他错)
  - 折叠得过头 → 假通过(cab 念成 kɑːb 也算对,而这正是拼读要教的元音区分)
两个方向各有用例守着。凡「可能掩盖真实发音错误」的映射一律不做。
"""
import pytest

from app.services.phoneme_norm import (
    compare, tokenize, normalize_model_ipa, align, VOWELS,
)


# ── 归一:写法差异必须折叠(否则假拒绝) ──────────────────────────────

@pytest.mark.parametrize("model_out,expected_tokens,why", [
    ("bɛd",  ["b", "e", "d"],       "ɛ 和 e 是同一个音,espeak 用 ɛ"),
    ("dab",  ["d", "æ", "b"],       "espeak 用裸 a 表示 TRAP 元音"),
    ("faf",  ["f", "æ", "f"],       "同上"),
    ("fi5",  ["f", "i"],            "5 是多语言模型带的声调符号,要去掉"),
    ("beɪb", ["b", "eɪ", "b"],      "双元音要整体切,不能拆成 e+ɪ"),
    ("siːd", ["s", "iː", "d"],      "长音符保留"),
])
def test_notation_differences_are_folded(model_out, expected_tokens, why):
    toks, unknown = tokenize(model_out)
    assert toks == expected_tokens, why
    assert not unknown, f"出现表外字符 {unknown}"


# ── 归一:真实发音差异**不能**折叠(否则假通过) ────────────────────

def test_real_vowel_difference_is_kept():
    """æ 与 ɑː 是不同元音(TRAP vs PALM),折叠它们就查不出 cab→kɑːb"""
    r = compare(["k", "æ", "b"], "kɑːb")
    assert r["all_correct"] is False, "æ→ɑː 被当成同一个音了"
    assert r["wrong"] == [1], "应指出是第 2 格(元音)错"
    assert r["vowel_bad"] == [1], "错的是元音,该单独标出来"


def test_real_consonant_difference_is_kept():
    """f 与 θ 不同,beef→biːθ 必须查出"""
    r = compare(["b", "iː", "f"], "biːθ")
    assert r["all_correct"] is False
    assert r["wrong"] == [2]
    assert r["vowel_bad"] == [], "错的是辅音,不该进元音清单"


# ── 逐格定位:这是音素模型相对 ASR 的核心优势 ──────────────────────

def test_locates_which_slot_is_wrong():
    """能说出「第几格」念偏了 —— ASR 只能说整个词像不像"""
    r = compare(["b", "æ", "d"], "bæd")
    assert r["per_slot"] == [True, True, True]

    r = compare(["k", "æ", "b"], "kɑːb")
    assert r["per_slot"] == [True, False, True], "只有元音那格该标错"


def test_stress_mark_never_judged():
    """重音符不参与判定:938 题里 177 题带重音,小学阶段漏点不该判错"""
    r = compare(["ˈ", "h", "æ", "n", "d", "l"], "hændl")
    assert r["all_correct"] is True
    assert r["per_slot"][0] is None, "重音格应为 None(不判)而非 False"


def test_missing_length_mark_is_lenient():
    """长音符缺失按同音处理

    严格说 i/iː 是不同音位(sit/seat),但模型对孤立单词的时长判断不稳,
    拿它判错会大量假拒绝 —— 长短音的区分交给对比回放。
    """
    assert compare(["f", "iː"], "fi")["all_correct"] is True
    assert compare(["s", "iː", "d"], "sid")["all_correct"] is True


# ── 对齐算法 ────────────────────────────────────────────────────────

def test_align_handles_missing_phoneme():
    """漏读一个音:对齐后该位置为 None"""
    m = align(["b", "æ", "d"], ["b", "d"])
    assert m[0] is not None and m[2] is not None
    assert m[1] is None, "漏掉的 æ 应对齐失败"


def test_align_handles_extra_phoneme():
    """多读一个音:其余仍能对上,不该整串错位"""
    r = compare(["b", "æ", "d"], "bæsd")
    assert r["per_slot"][0] is True
    assert r["per_slot"][2] is True, "多一个音不该让后面全错位"


def test_empty_model_output():
    """模型什么都没输出(静音):全部判未读"""
    r = compare(["b", "æ", "d"], "")
    assert r["all_correct"] is False
    assert r["wrong"] == [0, 1, 2]


# ── 闭集判定的阈值方向 ──────────────────────────────────────────────

def test_uncertain_margin_favors_the_child():
    """声学上分不开时判「过」,不冤枉孩子

    实测 bad/bed 在 Edge TTS 标准音上得分完全相同(差距 0.0)——
    模型对 æ/e 就是分不开,孩子只会更糊。这种情况判错的代价
    (读对了被否定)远大于漏纠,所以宁可漏放。
    """
    from app.services.phoneme_closed_set import judge, MARGIN_UNCERTAIN

    # 目标词不是第一名,但差距很小 → 判过
    scores = [("bad", -1.64), ("bed", -1.95)]
    r = judge(scores, "bed")
    assert r["verdict"] == "pass", "差距 0.31 小于阈值,该判过"

    # 差距明显 → 判念错了
    scores = [("bad", -0.40), ("bade", -1.90)]
    r = judge(scores, "bade")
    assert r["verdict"] == "confused", "差距 1.50 是真念错,该抓出来"
    assert r["best"] == "bad", "要能告诉孩子念成了哪个词"

    assert MARGIN_UNCERTAIN >= 0.6, (
        "阈值只该调大不该调小 —— 真实童声比标准音更糊")


def test_tie_favors_target_word():
    """平分时目标词优先

    实测 bee 和 beef 会算出完全相同的分(-1.67),
    原来靠字典序侥幸判对 —— 孩子的对错不能取决于字典序。
    """
    from app.services.phoneme_closed_set import judge

    scores = [("bee", -1.67), ("beef", -1.67)]
    assert judge(scores, "beef")["verdict"] == "pass"
    assert judge(scores, "bee")["verdict"] == "pass"
