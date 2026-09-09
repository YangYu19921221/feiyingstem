"""音标课件渲染:PDF/PPT → 逐页 PNG

学生只拿渲染后的图,**原文件永不下发** —— 课件是老师的劳动成果,
给了原文件就等于给了可二次分发的母版。

## 为什么不直接用 watermark_service.render_material

那份代码的渲染循环和这里几乎一样,但两处硬差异让它不能直接复用:

1. **目录会串号**。`watermark_service.material_dir()` 是
   `MATERIAL_DIR/rendered/{整数 id}`,而 live_materials 与 phonetic_materials 的
   自增 id 各自从 1 开始 —— 共用根目录时 id=3 的音标课件会读到 id=3 的直播课件的页。
   这不是"可能撞",是两张表都从 1 开始必然撞。
2. **不烧水印**。直播课件按人烧水印是为防付费内容泄露,代价是每次翻页重新合成
   + 响应必须 no-store 禁缓存。音标讲义是教学辅助资料,这个代价不值得 ——
   不烧水印换来的是浏览器能缓存,学生来回翻页不重复走网络。

所以这里保持独立目录 + 独立函数,不给 watermark_service 加 flag 参数
(那会让"水印服务"里出现一条不烧水印的分支,两边都变难读)。
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile

from app.core.config import settings
from app.services import office_convert

logger = logging.getLogger(__name__)

RENDERED_SUBDIR = "rendered"

# 一份课件最多渲染多少页。超出的部分不渲染(而不是拒绝整份上传):
# 老师传的可能是整册讲义,前 N 页照样能看比整份传不上去有用。
# 真正的目的是拦住磁盘 —— 每页 PNG 几百 KB,不设上限时一份 500 页的扫描件能吃掉几百 MB
MAX_RENDER_PAGES = 200


def material_dir(material_id: int) -> str:
    return os.path.join(settings.PHONETIC_MATERIAL_DIR, RENDERED_SUBDIR, str(material_id))


def page_path(material_id: int, page_no: int) -> str:
    """第 page_no 页(从 1 开始)的渲染图路径"""
    return os.path.join(material_dir(material_id), f"{page_no}.png")


def render_pdf(pdf_path: str, material_id: int) -> int:
    """把 PDF 逐页渲染成 PNG,返回实际渲染的页数。

    **同步阻塞**(与 watermark_service.render_material 同惯例),调用方要丢线程池 ——
    单 worker 下直接跑会把整个服务卡住。
    """
    import pymupdf  # 延迟导入:没装 PyMuPDF 时不影响其它功能启动

    out_dir = material_dir(material_id)
    os.makedirs(out_dir, exist_ok=True)

    zoom = settings.MATERIAL_RENDER_DPI / 72.0
    with pymupdf.open(pdf_path) as doc:
        total = doc.page_count
        if total <= 0:
            raise RuntimeError("PDF 是 0 页,可能已损坏")
        pages = min(total, MAX_RENDER_PAGES)
        for i in range(pages):
            pix = doc.load_page(i).get_pixmap(
                matrix=pymupdf.Matrix(zoom, zoom), alpha=False
            )
            pix.save(page_path(material_id, i + 1))

    if pages < total:
        logger.warning(
            "课件 %s 共 %s 页,只渲染前 %s 页(上限)", material_id, total, pages
        )
    return pages


async def prepare(src_path: str, material_id: int, kind: str) -> int:
    """转换(PPT 才需要)+ 渲染,返回页数。失败抛异常,由上层存进 render_error。

    PPT 转出的 PDF 是中间产物,渲染完就删 ——
    留着等于在服务器上多存一份完整课件副本,白占磁盘。
    """
    if kind in ("ppt", "pptx"):
        tmp_dir = tempfile.mkdtemp(prefix="phonetic_ppt_")
        try:
            # convert_to_pdf_async 自带串行化闸门(同时只跑一个 soffice)与线程池
            pdf_path = await office_convert.convert_to_pdf_async(src_path, tmp_dir)
            return await asyncio.to_thread(render_pdf, pdf_path, material_id)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    return await asyncio.to_thread(render_pdf, src_path, material_id)


def cleanup(material_id: int) -> None:
    """删除某份课件的全部渲染页。删课件/删视频时调用,不抛异常"""
    shutil.rmtree(material_dir(material_id), ignore_errors=True)
