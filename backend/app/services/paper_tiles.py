"""卷子文件 → 一页一页的图 → 切成一栏一栏的小图(给拆卷模型看),以及截一道题的原题图

为什么要切: 卷子常是两页并排扫在一张图上、每页两栏(2026-11-22 试拆的七上测评卷: 一张图 3072×2286、四栏)。
整张图给模型,会被缩到长边 1568 左右,小字(音标、选项)看不清;切成一栏、每栏再上下分两块后,
每块 600–800 宽、1200 多高,字和原图一样大。

切法(纯函数,不碰库和网络,测试直接喂图):
1. 横着的图(宽 > 高 × 1.15)先从中间的空白缝分成左右两页;找不到缝就从正中间切
2. 每一页找中间的空白缝分两栏;找不到就当一栏(手机拍的单栏作业纸)
3. 每栏高宽比大于 1.6 就上下切成两块,中间重叠 OVERLAP(题目被切在缝上时两块里都有,模型写一次)
4. 每块长边压到 TILE_MAX 以内(5.x 收得下 2576,4.6 自己会缩到 1568;这么大已经够看清)

Word 文档没有图: 抽文字按段落分成几「页」,一页不超过 TEXT_PAGE 个字。
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Optional

TILE_MAX = 1568
TILE_MIN_SIDE = 200
OVERLAP = 0.06
SPREAD_RATIO = 1.15          # 宽 > 高 × 这么多 = 两页并排
TALL_RATIO = 1.6             # 一栏高宽比大于这么多就上下切两块
PAGE_MAX_SIDE = 4000         # 原图太大先缩(手机原图 6000 多,没必要)
RENDER_DPI = 300
MAX_PAGES = 40
TEXT_PAGE = 3500


@dataclass
class Page:
    """一页: 图(PIL.Image)或文字(Word)"""
    image: object = None
    text: Optional[str] = None
    tiles: list = field(default_factory=list)


class FileError(Exception):
    """文件打不开 / 页太多,message 给老师看"""


# ---------------------------------------------------------------- 读文件

def _rgb(img):
    from PIL import ImageOps
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.mode == "L":
        img = img.convert("RGB")
    if max(img.size) > PAGE_MAX_SIDE:
        img.thumbnail((PAGE_MAX_SIDE, PAGE_MAX_SIDE))
    return img


def pdf_page_count(raw: bytes) -> int:
    import fitz  # PyMuPDF
    try:
        with fitz.open(stream=raw, filetype="pdf") as doc:
            if doc.needs_pass:
                raise FileError("这个 PDF 有密码,打不开。去掉密码再传")
            return doc.page_count
    except FileError:
        raise
    except Exception as e:  # noqa: BLE001
        raise FileError("这个 PDF 打不开,换一个文件试试") from e


def read_pdf(raw: bytes) -> list[Page]:
    """扫描件(一页就是一张图)取原图,不重新渲染(原图最清楚);别的按 RENDER_DPI 渲染"""
    import fitz
    from PIL import Image

    pages: list[Page] = []
    with fitz.open(stream=raw, filetype="pdf") as doc:
        if doc.needs_pass:
            raise FileError("这个 PDF 有密码,打不开。去掉密码再传")
        if doc.page_count > MAX_PAGES:
            raise FileError(f"一次最多传 {MAX_PAGES} 页,这份有 {doc.page_count} 页,拆成几份再传")
        for page in doc:
            img = None
            imgs = page.get_images(full=True)
            if len(imgs) == 1 and not page.get_text().strip():
                try:
                    pix = fitz.Pixmap(doc, imgs[0][0])
                    if pix.n - pix.alpha >= 4 or pix.alpha:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    img = Image.open(io.BytesIO(pix.tobytes("png")))
                except Exception:  # noqa: BLE001 —— 取不出来就渲染
                    img = None
                if img is not None and min(img.size) < 600:
                    img = None
            if img is None:
                zoom = RENDER_DPI / 72
                long_pt = max(page.rect.width, page.rect.height) or 1
                zoom = min(zoom, 3400 / long_pt)
                pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
            pages.append(Page(image=_rgb(img)))
    if not pages:
        raise FileError("这个 PDF 里没有页")
    return pages


def read_image(raw: bytes) -> list[Page]:
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise FileError("这张图打不开,换一张试试") from e
    img = _rgb(img)
    if min(img.size) < 400:
        raise FileError("这张图太小了,看不清字,拍清楚一点再传")
    return [Page(image=img)]


def read_docx(raw: bytes, name: str) -> list[Page]:
    from app.services import tutor_files
    try:
        got = tutor_files._read_docx(raw, name, max_chars=TEXT_PAGE * MAX_PAGES)
    except Exception as e:  # noqa: BLE001
        raise FileError("这个 Word 文件打不开,另存为 PDF 再传") from e
    text = (getattr(got, "text", "") or "").strip()
    if len(text) < 30:
        raise FileError("这个 Word 文件里没读出题目(题目可能是图片),另存为 PDF 再传")
    pages: list[Page] = []
    buf = ""
    for para in text.split("\n"):
        if len(buf) + len(para) > TEXT_PAGE and buf:
            pages.append(Page(text=buf.strip()))
            buf = ""
        buf += para + "\n"
    if buf.strip():
        pages.append(Page(text=buf.strip()))
    if len(pages) > MAX_PAGES:
        raise FileError(f"这份 Word 太长了,拆成几份再传(一次最多 {MAX_PAGES} 段)")
    return pages


def kind_of(name: str, content_type: str = "") -> Optional[str]:
    n = (name or "").lower()
    ct = (content_type or "").lower()
    if n.endswith(".pdf") or ct == "application/pdf":
        return "pdf"
    if n.endswith((".jpg", ".jpeg", ".png", ".webp")) or ct in ("image/jpeg", "image/png", "image/webp"):
        return "image"
    if n.endswith(".docx"):
        return "docx"
    if n.endswith(".doc"):
        return "doc"
    return None


def read_file(kind: str, raw: bytes, name: str = "") -> list[Page]:
    if kind == "pdf":
        return read_pdf(raw)
    if kind == "image":
        return read_image(raw)
    if kind == "docx":
        return read_docx(raw, name)
    raise FileError("只能传 PDF、照片(jpg / png)或 Word(.docx)")


# ---------------------------------------------------------------- 找空白缝、切块

def _ink_profile(img, lo: float, hi: float) -> tuple[list[float], int]:
    """图缩到宽 600,算 [lo, hi] 这一段宽度里每一列有多少比例是字(深色)。只看上下各去掉 6% 的部分(页眉页脚常横跨两栏)"""
    import numpy as np

    w, h = img.size
    scale = 600 / w
    small = img.convert("L").resize((600, max(50, int(h * scale))))
    a = np.asarray(small, dtype=np.uint8)
    hh = a.shape[0]
    body = a[int(hh * 0.06): int(hh * 0.94), :]
    dark = (body < 150).mean(axis=0)
    x0, x1 = int(600 * lo), int(600 * hi)
    return [float(v) for v in dark[x0:x1]], x0


def find_gutter(img, lo: float = 0.33, hi: float = 0.67) -> Optional[float]:
    """在 [lo, hi] 宽度范围里找竖着的空白缝(几乎没字、至少 0.6% 宽),返回缝中间在整张图里的位置(0–1);找不到 None。
    几条缝都够宽时挑离正中间最近的;两栏中间画了一条竖线的也算缝(线很细、两边空白)"""
    prof, x0 = _ink_profile(img, lo, hi)
    n = len(prof)
    if n == 0:
        return None
    # 「几乎没字」按这一页自己的字有多密来定: 扫描件的缝里常有一点灰点 / 淡竖线(实测七上卷第 5 页缝里 1% 是深色),
    # 写死 0.4% 会找不到缝;字的那几栏一般 5–15%
    dense = sorted(prof)[len(prof) // 2]
    th = min(0.03, max(0.004, dense * 0.2))
    blank = [v < th for v in prof]
    # 竖线: 1–3 列很黑、两边空白
    for i in range(1, n - 1):
        if prof[i] > 0.35 and not blank[i]:
            left = all(blank[j] for j in range(max(0, i - 6), max(0, i - 1)))
            right_end = i + 1
            while right_end < n and prof[right_end] > 0.35 and right_end - i < 3:
                right_end += 1
            right = all(blank[j] for j in range(right_end, min(n, right_end + 5)))
            if left and right and right_end - i <= 3:
                for j in range(i, right_end):
                    blank[j] = True
    runs: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if blank[i]:
            j = i
            while j < n and blank[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    min_w = max(3, int(600 * 0.006))
    good = [(a, b) for a, b in runs if b - a >= min_w]
    if not good:
        return None
    mid = 300 - x0
    a, b = min(good, key=lambda r: abs((r[0] + r[1]) / 2 - mid) - (r[1] - r[0]) * 0.5)
    return (x0 + (a + b) / 2) / 600


def _fit(tile):
    if max(tile.size) > TILE_MAX:
        tile = tile.copy()
        tile.thumbnail((TILE_MAX, TILE_MAX))
    return tile


def split_page(img) -> list:
    """一页图 → 按阅读顺序的小图(左页左栏上、左页左栏下、左页右栏上……)"""
    w, h = img.size
    halves = [img]
    if w > h * SPREAD_RATIO:
        g = find_gutter(img, 0.38, 0.62) or 0.5
        cut = int(w * g)
        halves = [img.crop((0, 0, cut, h)), img.crop((cut, 0, w, h))]
    tiles = []
    for half in halves:
        hw, hh = half.size
        cols = [half]
        g = find_gutter(half) if hw > 500 else None
        if g is not None:
            cut = int(hw * g)
            pad = int(hw * 0.01)
            cols = [half.crop((0, 0, min(hw, cut + pad), hh)), half.crop((max(0, cut - pad), 0, hw, hh))]
        for col in cols:
            cw, ch = col.size
            if cw < TILE_MIN_SIDE or ch < TILE_MIN_SIDE:
                continue
            if ch > cw * TALL_RATIO:
                mid = ch // 2
                ov = int(ch * OVERLAP / 2)
                tiles.append(_fit(col.crop((0, 0, cw, min(ch, mid + ov)))))
                tiles.append(_fit(col.crop((0, max(0, mid - ov), cw, ch))))
            else:
                tiles.append(_fit(col))
    return tiles or [_fit(img)]


def to_jpeg(img, quality: int = 85) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def crop_item(tile_bytes: bytes, y0: Optional[float], y1: Optional[float], pad: float = 0.03) -> bytes:
    """从一块小图里截出一道题(上下各多留一点,宁大勿小)。没有位置就给整块"""
    from PIL import Image

    img = Image.open(io.BytesIO(tile_bytes))
    img.load()
    w, h = img.size
    if y0 is None or y1 is None:
        return tile_bytes
    a = max(0.0, min(1.0, float(y0)))
    b = max(0.0, min(1.0, float(y1)))
    if b < a:
        a, b = b, a
    if b - a < 0.03:
        b = min(1.0, a + 0.12)
    top = max(0, int((a - pad) * h))
    bottom = min(h, int((b + pad) * h))
    if bottom - top < 40:
        return tile_bytes
    return to_jpeg(img.crop((0, top, w, bottom)), 88)
