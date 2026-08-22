"""课件水印与渲染服务 —— 支撑「能看不能下」

## 先把话说清楚
截屏和手机拍照**防不住**,任何方案都防不住。所以目标不是"禁止复制",而是:
1. **原文件永不出服务器** —— 没有任何 URL 指向原 PDF,右键另存拿不到源文件;
2. **每个人拿到的图都不一样** —— 烧「飞鹰教育 + 姓名 + 学号 + 时间」,
   传出去一眼能查到是谁传的(配合 material_view_logs 溯源)。

## 两阶段
- 上传时 `render_material()`:PDF 逐页 → PNG 底图(**不含个人信息**),缓存复用。
  底图只在服务端,不下发。
- 请求时 `stamp_page()`:底图 + 该学生的水印 → 内存 bytes 直接返回。
  **按人烧不能缓存到磁盘**(N 个学生 × N 页会撑爆盘,且留一堆带个人信息的图)。

字体:走系统中文字体,找不到就退 Pillow 内置位图字体(英文可读、中文变方块)。
中文变方块比整个功能 500 好,但部署时应确保有中文字体。
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timedelta
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings

# 渲染页缓存目录名(在 MATERIAL_DIR 下)
RENDERED_SUBDIR = "rendered"

# 中文字体候选。Linux 服务器常见的放前面,macOS 开发机兜底
_FONT_CANDIDATES: tuple[str, ...] = (
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
)

_font_cache: dict[int, ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}


def _font(size: int):
    """按字号取字体,缓存住 —— 每页每次都 truetype() 会明显拖慢"""
    hit = _font_cache.get(size)
    if hit is not None:
        return hit
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, size)
                _font_cache[size] = f
                return f
            except Exception:
                continue
    # 兜底:内置位图字体。中文会变方块,但不至于让整个课件打不开
    f = ImageFont.load_default()
    _font_cache[size] = f
    return f


def material_dir(material_id: int) -> str:
    """某课件的渲染页目录"""
    return os.path.join(settings.MATERIAL_DIR, RENDERED_SUBDIR, str(material_id))


def page_path(material_id: int, page_no: int) -> str:
    """第 page_no 页(1 起)的底图路径"""
    return os.path.join(material_dir(material_id), f"{page_no:04d}.png")


def render_material(src_path: str, material_id: int, kind: str) -> int:
    """把原文件渲染成逐页底图,返回页数。**同步阻塞**,调用方要丢线程池。

    kind='pdf' 走 PyMuPDF;'image' 直接当单页拷进去(顺带压一下尺寸)。
    渲染是幂等的:重跑会覆盖同名文件。
    """
    out_dir = material_dir(material_id)
    os.makedirs(out_dir, exist_ok=True)

    if kind == "image":
        with Image.open(src_path) as im:
            im = im.convert("RGB")
            im.thumbnail((2000, 2000))
            im.save(page_path(material_id, 1), format="PNG")
        return 1

    if kind != "pdf":
        raise ValueError(f"不支持渲染的类型: {kind}")

    import fitz  # 延迟导入:没装 PyMuPDF 时不影响其它功能启动

    # DPI→缩放比,PDF 基准 72dpi
    zoom = settings.MATERIAL_RENDER_DPI / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    with fitz.open(src_path) as doc:
        total = doc.page_count
        for idx in range(total):
            pix = doc.load_page(idx).get_pixmap(matrix=matrix, alpha=False)
            pix.save(page_path(material_id, idx + 1))
    return total


def stamp_page(
    material_id: int,
    page_no: int,
    *,
    viewer_label: str,
    fmt: str = "WEBP",
) -> bytes:
    """取底图 + 烧水印,返回图片 bytes(不落盘)。

    viewer_label 例:"张小明 · 学号1024"。函数自己再拼上日期和主文案。
    WEBP 体积比 PNG 小很多 —— 课件页是要过公网的,这直接省带宽。
    """
    src = page_path(material_id, page_no)
    if not os.path.exists(src):
        raise FileNotFoundError(src)

    with Image.open(src) as base:
        img = base.convert("RGB")
        _draw_watermark(img, viewer_label)
        buf = io.BytesIO()
        if fmt.upper() == "WEBP":
            img.save(buf, format="WEBP", quality=82, method=4)
        else:
            img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()


def _draw_watermark(img: Image.Image, viewer_label: str) -> None:
    """原地烧水印:平铺斜纹 + 右下角实体角标。

    平铺斜纹用半透明合成(遮不住内容又抹不掉);角标不透明,截屏也一定带走。
    """
    w, h = img.size
    stamp = f"{settings.WATERMARK_TEXT} · {viewer_label}"
    date_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ---- 平铺斜纹 ----
    # 单独一层画完再旋转合成:直接在原图上画斜字 Pillow 不支持旋转文本
    tile_font = _font(max(20, w // 42))
    layer = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    try:
        bbox = ld.textbbox((0, 0), stamp, font=tile_font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:
        tw, th = len(stamp) * 12, 20
    step_x, step_y = tw + max(80, w // 8), th + max(90, h // 9)
    for y in range(0, h * 2, step_y):
        # 每行错开半格,免得连成竖直条纹
        offset = (y // step_y % 2) * (step_x // 2)
        for x in range(-step_x, w * 2, step_x):
            ld.text((x + offset, y), stamp, font=tile_font, fill=(0, 0, 0, 30))
    layer = layer.rotate(30, resample=Image.BICUBIC, center=(w, h))
    # 裁回原图尺寸(旋转后取中心区)
    left, top = w // 2, h // 2
    layer = layer.crop((left, top, left + w, top + h))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))

    # ---- 右下角实体角标 ----
    d = ImageDraw.Draw(img)
    corner_font = _font(max(16, w // 55))
    text = f"{settings.WATERMARK_TEXT}  {viewer_label}  {date_str}"
    try:
        bbox = d.textbbox((0, 0), text, font=corner_font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:
        tw, th = len(text) * 10, 18
    pad = max(8, w // 120)
    x0, y0 = w - tw - pad * 3, h - th - pad * 3
    d.rectangle([x0 - pad, y0 - pad, w - pad, h - pad], fill=(255, 107, 53))
    d.text((x0, y0), text, font=corner_font, fill=(255, 255, 255))


def cleanup_rendered(material_id: int) -> None:
    """删课件时清渲染页。目录不存在不报错"""
    import shutil

    shutil.rmtree(material_dir(material_id), ignore_errors=True)


def iter_page_numbers(page_count: int | None) -> Iterable[int]:
    return range(1, (page_count or 0) + 1)


def ffmpeg_watermark_args(viewer_label: str | None = None) -> list[str]:
    """回放烧水印的 FFmpeg drawtext 参数。

    **必须烧进画面**:播放器上叠 DOM 水印能被 DevTools 一键删掉,烧进去删不掉。
    viewer_label 为空时只烧机构名(录制是全班一份,按人烧要转码 N 次,不值)。
    """
    text = settings.WATERMARK_TEXT if not viewer_label else f"{settings.WATERMARK_TEXT} {viewer_label}"
    font_file = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), "")
    font_opt = f"fontfile='{font_file}':" if font_file else ""
    return [
        "-vf",
        (
            f"drawtext={font_opt}text='{text}':fontcolor=white@0.75:fontsize=h/28:"
            "box=1:boxcolor=black@0.28:boxborderw=8:x=w-tw-20:y=20"
        ),
    ]


def play_token_expiry(ttl: int | None = None) -> int:
    """播放票据过期时间戳。CDN 防盗链和课件签名共用一套时钟口径"""
    ttl = ttl or settings.LIVE_PLAY_TOKEN_TTL
    return int((datetime.utcnow() + timedelta(seconds=ttl)).timestamp())
