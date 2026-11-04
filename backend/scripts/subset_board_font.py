"""登录页黑板上的中文字体子集(2026-11-04)。

黑板上的中文用站酷快乐体(ZCOOL KuaiLe,SIL OFL),整套 5MB 太大,只留黑板上真用到的字。
字从前端三个文件里扫出来: AuthShell.tsx(问候)、loginScenes.ts(每天的话)和 boardWords.ts(今日单词的释义、日期)。
改了这两个文件里的中文就跑一次:

    pip install fonttools brotli
    python backend/scripts/subset_board_font.py               # 自动下载原字体
    python backend/scripts/subset_board_font.py --src ZCOOLKuaiLe-Regular.ttf

输出 frontend/public/fonts/chalk/kuaile-board.woff2。只多不少: 漏了的字浏览器会退回系统字体(笔迹不一样)。
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    ROOT / "frontend/src/components/auth/AuthShell.tsx",
    ROOT / "frontend/src/components/auth/boardWords.ts",
    ROOT / "frontend/src/components/auth/loginScenes.ts",
]
OUT = ROOT / "frontend/public/fonts/chalk/kuaile-board.woff2"
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf"
# 与 AuthShell.css 里 BoardZh 的 unicode-range 一致
CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")
ALWAYS = "0123456789·"


def collect() -> str:
    chars: set[str] = set(ALWAYS)
    for path in SOURCES:
        text = path.read_text(encoding="utf-8")
        # 注释里的字不上黑板,去掉省体积
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        text = re.sub(r"//[^\n]*", "", text)
        chars.update(CJK.findall(text))
    return "".join(sorted(chars))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="ZCOOLKuaiLe-Regular.ttf 路径,不给就下载")
    args = ap.parse_args()

    try:
        from fontTools import subset
    except ImportError:
        print("先 pip install fonttools brotli", file=sys.stderr)
        return 1

    text = collect()
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(args.src) if args.src else Path(tmp) / "kuaile.ttf"
        if not args.src:
            print("下载原字体…")
            urllib.request.urlretrieve(FONT_URL, src)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]  # 留着版权和许可证那几条
        font = subset.load_font(str(src), opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subset.save_font(font, str(OUT), opts)
    print(f"{len(text)} 个字 → {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} 字节)")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
