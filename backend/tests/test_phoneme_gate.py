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
