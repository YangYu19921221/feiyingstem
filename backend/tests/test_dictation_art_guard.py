"""听写配图不能露出单词(2026-11-08)

配图里画着单词(几乎都在图片下面三成),分类记忆的听写页只露出上面一截(index.css .dict-art-window 的 padding-top)。
全库 27,118 张用 OCR 量过(11-08): 单词顶边 p0.1 在图片 68.2%、p1 71.7%;顶边在 66% 以内的 15 张
(多是 ten / four / five 这类短词,字画得大)列在 frontend/src/data/dictationArtUnsafe.ts,听写时不显示。

锁住的几件事:
1. 露出来的比例不超过 65%(留出余量,改大了就会露出单词的上半截)
2. 听写页不用 <img> 放配图(长按能存下整张图,图下面就是答案),也不在图的说明文字里写单词
3. 没露出来之前,配图说明不能带单词
4. 不安全名单的格式能被前端读到(文件名.jpg)
"""
import re
from pathlib import Path

FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src"
CSS = (FRONT / "index.css").read_text(encoding="utf-8")
PHASE = (FRONT / "components" / "classify" / "DictationPhase.tsx").read_text(encoding="utf-8")
UNSAFE = (FRONT / "data" / "dictationArtUnsafe.ts").read_text(encoding="utf-8")


def _rule(selector: str) -> str:
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    assert m, f"index.css 里找不到 {selector}"
    return m.group(1)


def test_art_window_shows_at_most_65_percent():
    body = _rule(".dict-art-window")
    pad = re.search(r"padding-top:\s*([\d.]+)%", body)
    assert pad, "听写配图窗口要用 padding-top 百分比定高度"
    assert float(pad.group(1)) <= 65, "露出来超过 65% 会露出画在下面的单词"
    # 从图片顶部开始露(不能居中或从下往上)
    assert re.search(r"background-position:\s*50%\s+0%", body)
    assert re.search(r"background-size:\s*100%\s+auto", body)


def test_dictation_does_not_use_img_for_art():
    # 只看渲染部分: 配图走背景图,不出现 <img
    assert "<img" not in PHASE
    assert "backgroundImage" in PHASE


def test_art_label_hides_word_before_submit():
    m = re.search(r"aria-label=\{submitted \? `配图:\$\{word\}` : '([^']*)'\}", PHASE)
    assert m, "配图的说明要按交没交卷分开写"
    assert "word" not in m.group(1)


def test_unsafe_list_format():
    block = UNSAFE[UNSAFE.index("new Set<string>(["):UNSAFE.index("]);")]
    names = re.findall(r"'([^']+)'", block)
    assert all(re.fullmatch(r"[a-z0-9_]+(?:__[0-9a-f]{6})?\.jpg", n) for n in names), names[:5]
    assert len(names) == len(set(names))
