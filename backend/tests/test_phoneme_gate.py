"""音标跟读「乱读不能过」的两道门(2026-10-30)

用户原话:「现在我乱读都能过」「乱读不要过 还是要有一定的正确率」。
以前的判定只看**相对排序**(本节 20 个词里更像哪个),乱读也总有个最像的词,
目标词又常落在 0.6 以内 → 判过。现在先过两道门(services/phoneme_closed_set):
  贴合分 GOP ≥ GOP_FLOOR(像不像这个词)且 相对分 ≥ GATE_MARGIN(是不是明显在读别的词)。

tests/data/phoneme_gate_real.json 是生产真实录音算出来的分数(**只有分数,没有音频和孩子信息**):
  kids    = 10-03 一个孩子认真读的 9 条(回声修好之后,听过都在读)
  garbage = 10-30 用户自己乱读 / 说中文 / 说一句话的 5 条
门槛是在「kids 全过、garbage 全拦」的前提下挑的。改门槛让这两条测试任何一条失败 = 改错方向了。
"""
import json
import math
from pathlib import Path

import numpy as np
import pytest

from app.services.phoneme_closed_set import (
    ClosedSetScorer, judge, GOP_FLOOR, GATE_MARGIN,
)

DATA = json.loads((Path(__file__).parent / "data" / "phoneme_gate_real.json").read_text(encoding="utf-8"))
LET_THROUGH = {"pass", "confused", "uncertain"}
BLOCKED = {"not_close", "wrong_word"}


def _rows(rec):
    """把存下来的维特比总分还原成 rank() 的输出格式(与 _rank_on 同一公式,见下面那条用例核对)"""
    out = []
    for w, (vit, n) in rec["scores"].items():
        n = max(n, 1)
        if vit is None:
            out.append((w, -math.inf, -math.inf, -math.inf))
        else:
            out.append((w, vit / n, vit / rec["T"], (vit - rec["best"]) / n))
    out.sort(key=lambda x: -x[1])
    return out


@pytest.mark.parametrize("rec", DATA["kids"], ids=lambda r: r["target"])
def test_kids_reading_carefully_pass(rec):
    """认真读的真孩子一条都不能拦 —— 拦一次他就不敢开口了"""
    r = judge(_rows(rec), rec["target"])
    assert r["verdict"] in LET_THROUGH, f"{rec['target']} 被拦了: {r}"


@pytest.mark.parametrize("rec", DATA["garbage"], ids=lambda r: f"{r['target']}-{r['note']}")
def test_nonsense_is_blocked(rec):
    """乱读 / 说中文 / 说一句话都要拦(以前这 5 条全部判过)"""
    r = judge(_rows(rec), rec["target"])
    assert r["verdict"] in BLOCKED, f"{rec['note']} 竟然过了: {r}"


def test_thresholds_only_loosen():
    """方向锁: 两个门槛只该往宽调。收紧前先拿新攒的真孩子录音重跑标定"""
    assert GOP_FLOOR <= -5.5
    assert GATE_MARGIN <= -3.25


def test_rank_on_computes_gop_against_free_decoding():
    """贴合分 = (强制读成这个词的总分 − 每帧取最像的总分) ÷ 音素数

    读成什么就贴合什么: 音频里是 b-a 时 ba 的贴合分是 0,ab 明显更差。
    numpy 版 logits 也要能算(主应用 venv 不装 torch,测试用 numpy)。
    """
    vocab = {"<pad>": 0, "b": 1, "a": 2}
    sc = ClosedSetScorer(None, None, vocab)
    # 6 帧: blank b b a a blank,每帧那个 token 概率 0.9
    seq = [0, 1, 1, 2, 2, 0]
    p = np.full((6, 3), 0.05)
    for t, i in enumerate(seq):
        p[t, i] = 0.9
    logp = np.log(p)
    rows = {w: (s, pf, g) for w, s, pf, g in sc._rank_on(logp, {"ba": ["b", "a"], "ab": ["a", "b"]})}
    best = float(logp.max(-1).sum())
    assert rows["ba"][2] == pytest.approx(0.0, abs=1e-9)
    assert rows["ba"][2] == pytest.approx((rows["ba"][0] * 2 - best) / 2)
    assert rows["ab"][2] < -2, "读的是 ba,ab 应该明显不贴合"
    assert rows["ba"][1] == pytest.approx(rows["ba"][0] * 2 / 6), "逐帧分照旧 = 总分 ÷ 帧数"


def test_clearly_other_word_says_which():
    """另一个词又明显更像、本身也读得像 → wrong_word,告诉孩子读成了哪个"""
    scores = [("bad", -0.5, -0.05, -0.2), ("bed", -4.5, -0.4, -5.0)]
    r = judge(scores, "bed")
    assert r["verdict"] == "wrong_word"
    assert r["best"] == "bad"


def test_not_close_when_nothing_fits():
    """哪个词都不贴合(说中文)→ not_close,不硬说「像 X」"""
    scores = [("bad", -2.0, -0.2, -9.0), ("bed", -2.3, -0.2, -9.5)]
    r = judge(scores, "bad")
    assert r["verdict"] == "not_close"
    assert r["gop"] == -9.0


def test_too_short_audio_is_not_close_and_json_safe():
    """音频短到装不下这个词(分数 -inf)→ 拦,而且返回里不能有无穷(JSON 放不下)"""
    scores = [("bad", -math.inf, -math.inf, -math.inf), ("bed", -math.inf, -math.inf, -math.inf)]
    r = judge(scores, "bad")
    assert r["verdict"] == "not_close"
    json.dumps(r, allow_nan=False)


def test_old_score_format_skips_gates():
    """老格式(只有 2 个分)不判门槛,只按相对排序 —— 不能因为少个分就拦人"""
    assert judge([("bad", -1.6), ("bed", -1.9)], "bed")["verdict"] == "pass"


def test_far_behind_another_word_is_blocked():
    """目标词勉强贴合,但本节另一个词明显领先 → 拦(相对分那道门)

    长度不同的词才会出现: 目标 2 个音素、别的词 3 个音素时,两边贴合分扣掉的
    「自由解码分 ÷ 音素数」不一样,目标词贴合分过线、别的词反而没过线,
    第一道「明显读成了别的词」接不住,要靠这道。去掉它会落到排序判定 → confused 放过。
    """
    scores = [("bead", -16.0, -0.5, -6.0), ("bee", -20.0, -0.6, -5.0)]
    r = judge(scores, "bee")
    assert r["verdict"] == "not_close", r


# ── 三种颜色(2026-10-31)──────────────────────────────────────────────

def test_grade_colors():
    """绿 = 读对了;黄 = 接近(过了但词尾多带一个音 / 没过但差一点);红 = 差得多"""
    from app.services.phoneme_closed_set import grade, NEAR_FLOOR
    assert grade("pass", -1.0) == "green"
    assert grade("confused", -2.0) == "green", "模型分不开的词(bed/bad)读对了不能标黄"
    assert grade("pass", -1.0, "extra_final_vowel") == "yellow"
    assert grade("not_close", NEAR_FLOOR + 0.5) == "yellow"
    assert grade("not_close", NEAR_FLOOR - 0.5) == "red"
    assert grade("not_close", None) == "red"
    assert grade("wrong_word", -3.0) == "red"
    assert grade("off", None) is None and grade("silent", None) is None, "没判出来不是对读音的判断"
    assert NEAR_FLOOR <= -6.7, "标定里读对却没过门的最低 -6.62,要落在黄里"


@pytest.mark.parametrize("rec", DATA["kids"], ids=lambda r: r["target"])
def test_kids_never_red(rec):
    """认真读的真孩子不能标红"""
    from app.services.phoneme_closed_set import grade
    r = judge(_rows(rec), rec["target"])
    assert grade(r["verdict"], r.get("gop")) in ("green", "yellow")


@pytest.mark.parametrize("rec", DATA["garbage"], ids=lambda r: f"{r['target']}-{r['note']}")
def test_nonsense_is_red(rec):
    """10-30 那 5 条乱读 / 说中文 / 说一句话都是红"""
    from app.services.phoneme_closed_set import grade
    r = judge(_rows(rec), rec["target"])
    assert grade(r["verdict"], r.get("gop")) == "red"


# ── 中国口音放宽(2026-10-31)──────────────────────────────────────────

def _cab_scores(gop):
    # 只关心目标词那一行: 排序分随便给,贴合分 = gop,另一个词更差
    return [("cab", -4.0, -0.4, gop), ("bad", -5.0, -0.5, gop - 1.0)]


def test_accent_reading_passes_yellow():
    """线上 cab 读了 15 遍,模型听成 kha5 / khɑu5,贴合分 -7.0 ~ -7.7 —— 骨架对得上就算过,标黄"""
    from app.services.phoneme_closed_set import grade
    r = judge(_cab_scores(-7.3), "cab", heard="kha5", target_tokens=["k", "æ", "b"])
    assert r["verdict"] == "pass" and r.get("accent") is True
    assert grade(r["verdict"], r["gop"], None, True) == "yellow"


@pytest.mark.parametrize("heard,why", [
    ("aː", "「啊」没有开头辅音"),
    ("hʌloʊ", "说 hello: 开头是 h"),
    ("woʊtɚ", "说 water: 开头是 w"),
    ("tha5", "开头听成 t 不是 k"),
    ("khɑ5khɑ5khɑ5", "多出两个以上音节"),
])
def test_accent_allowance_needs_matching_skeleton(heard, why):
    r = judge(_cab_scores(-7.3), "cab", heard=heard, target_tokens=["k", "æ", "b"])
    assert r["verdict"] == "not_close", why


def test_accent_allowance_has_a_floor():
    """贴合分太低(-12)骨架对上也不放: 那是一长串里碰巧开头像"""
    r = judge(_cab_scores(-12.0), "cab", heard="kha5", target_tokens=["k", "æ", "b"])
    assert r["verdict"] == "not_close"


def test_vowel_initial_words_not_relaxed():
    """ace / add / ebb 只有一个元音能比,「啊」对 add 就对上了 —— 不放宽"""
    scores = [("add", -4.0, -0.4, -6.7), ("bad", -5.0, -0.5, -7.7)]
    r = judge(scores, "add", heard="aː", target_tokens=["æ", "d"])
    assert r["verdict"] == "not_close"


def test_no_heard_no_allowance():
    """老调用方不传 heard: 行为和以前一样"""
    assert judge(_cab_scores(-7.3), "cab")["verdict"] == "not_close"


# ── 元音对不上就拦(2026-10-31,用户「我发现乱读会过 我读ooo 给我过了」)──────────

def _fee_pass_scores():
    # 两道门都过得去的分数(用户对 fee 读「ooo」时的实际情况: 贴合分 -5.3,分差不大)
    return [("fee", -3.0, -0.3, -5.27), ("bed", -3.2, -0.3, -6.0)]


def test_vowel_only_with_wrong_vowel_is_blocked_red():
    """对 fee 读「ooo」,模型听成 aː: 两道门放过了,元音否决要拦下,标红"""
    from app.services.phoneme_closed_set import grade
    r = judge(_fee_pass_scores(), "fee", heard="aː", target_tokens=["f", "iː"])
    assert r["verdict"] == "not_close" and r["error_code"] == "wrong_vowel"
    assert "/iː/" in r["error_hint"]
    assert grade(r["verdict"], r["gop"], r["error_code"]) == "red"


@pytest.mark.parametrize("heard,word,toks,why", [
    ("fei5", "fee", ["f", "iː"], "有开头辅音: 模型常把元音听偏(标准音 fee 听成 fei5),不否决"),
    ("a", "ebb", ["e", "b"], "e 开头中国口音常读成 a,不否决"),
    ("i5", "cede", ["s", "iː", "d"], "元音对得上"),
    (None, "fee", ["f", "iː"], "没传听到的音素: 不否决(和以前一样)"),
])
def test_vowel_veto_does_not_hit_correct_readings(heard, word, toks, why):
    scores = [(word, -3.0, -0.3, -2.0), ("bed", -4.0, -0.4, -6.0)]
    assert judge(scores, word, heard=heard, target_tokens=toks)["verdict"] == "pass", why


def test_blocked_vowel_only_wrong_vowel_is_red_not_yellow():
    """线上 #112: 对 fee 读「ooo」听成 aa,贴合分 -5.6 本来就没过,但「差一点」会标黄 —— 元音都不对要标红"""
    from app.services.phoneme_closed_set import grade
    scores = [("fee", -3.0, -0.3, -5.64), ("beef", -2.2, -0.2, -5.0)]
    r = judge(scores, "fee", heard="aa", target_tokens=["f", "iː"])
    assert r["verdict"] == "not_close" and r["error_code"] == "wrong_vowel"
    assert grade(r["verdict"], r["gop"], r["error_code"]) == "red"


# ── 爆破音开头却没听到开头辅音(2026-10-31,用户「第一个词我读ooo也能过」)────────

@pytest.mark.parametrize("heard", ["ʌnaː", "alʔa", "ʔɑɑ", "ahʔa"])
def test_stop_initial_word_without_onset_is_red(heard):
    """第一个词 bad 读「ooo」,模型听成 ʌnaː / alʔa(元音大类 a 和 æ 对得上,元音否决拦不住)"""
    from app.services.phoneme_closed_set import grade
    scores = [("bad", -3.0, -0.3, -4.1), ("dad", -3.5, -0.3, -5.0)]
    r = judge(scores, "bad", heard=heard, target_tokens=["b", "æ", "d"])
    assert r["verdict"] == "not_close" and r["error_code"] == "missing_onset"
    assert "/b/" in r["error_hint"]
    assert grade(r["verdict"], r["gop"], r["error_code"]) == "red"


@pytest.mark.parametrize("heard,word,toks,why", [
    ("ɑ5", "faff", ["f", "æ", "f"], "f 开头: 标准音 faff 会听成 ɑ5,不否决"),
    ("i5", "cede", ["s", "iː", "d"], "s 开头: 标准音 cede 会听成 i5,不否决"),
    ("pa", "bad", ["b", "æ", "d"], "听到了 p(清浊不分)"),
    ("ad", "add", ["æ", "d"], "元音开头的词本来就没有开头辅音"),
])
def test_onset_veto_spares_correct_readings(heard, word, toks, why):
    scores = [(word, -3.0, -0.3, -2.0), ("bed", -4.0, -0.4, -6.0)]
    assert judge(scores, word, heard=heard, target_tokens=toks)["verdict"] == "pass", why
