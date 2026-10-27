"""学习助手「上传文件」(2026-10-27,用户「拍照有了,上传文件的功能呢,小鹰 AI 可以做吗」→「doc 文档也要支持」)

孩子除了拍照,还能直接传一份文件问小鹰老师: PDF / Word(.docx、老的 .doc)/ txt。

## 怎么读
- txt: 直接读(UTF-8,不行退 GB18030 —— Windows 记事本存的中文常是 GBK)
- PDF: PyMuPDF 抽文字层;**扫描件没有文字层**(抽出来不到 MIN_TEXT_CHARS 个字)就把前 SCAN_PAGES 页
  渲染成图片发给模型看,跟拍照一个效果
- .docx: 自己解 zip 读 word/document.xml 的段落和表格(不加依赖)。XML 用 xml.etree:
  Python 3.12 + expat 2.6 默认挡住实体展开炸弹(billion laughs),外部实体也不解析
- .doc(老格式,二进制): 服务器上 LibreOffice(soffice)先转 PDF,再按 PDF 读。
  soffice 转换跨进程一次只跑一个(core/file_lock,和音标课件共用一个闸门),转完临时目录整个删掉

## 不存文件
和照片一样,文件只在内存 / 临时目录里过一下给模型看,不落盘、不进库。消息上只记文件名和类型
(tutor_messages.cards 里一张 {"type":"file"} 卡,老师看记录、刷新对话时显示「[文件] xxx.pdf」)。
发给模型的那段文字也不存 —— 存库的 text 只有孩子自己写的话(对话记录搜索不会搜到文件里的字)。

## 省钱
- 文字最多 MAX_CHARS 个字(约一张卷子),超出截掉并告诉模型和孩子「只读了前面一部分」
- 扫描件最多 SCAN_PAGES 页、每页按照片同样压到长边 1100px
- 一份文件一问算 1 次,和拍照一样;同一道题 15 分钟内的追问照常不另算(追问不用再传文件)
"""
from __future__ import annotations

import asyncio
import io
import os
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from typing import Optional

MAX_BYTES = 20 * 1024 * 1024
MAX_CHARS = 6000           # 发给模型的文字上限(约一张卷子 / 三四页讲义)
MIN_TEXT_CHARS = 30        # PDF 抽出来少于这么多字 = 扫描件,改看图
SCAN_PAGES = 3             # 扫描件最多看几页
SCAN_DPI = 110
DOCX_MAX_XML = 30 * 1024 * 1024   # document.xml 解压后上限(防 zip 炸弹)
NAME_MAX = 60

KINDS = {".pdf": "pdf", ".docx": "docx", ".doc": "doc", ".txt": "txt"}
ACCEPT = ".pdf,.doc,.docx,.txt"


class FileRejected(Exception):
    """这份文件不能用;message 直接给孩子看"""


@dataclass
class Extracted:
    name: str
    kind: str                       # pdf / docx / doc / txt
    text: str = ""
    truncated: bool = False
    pages: Optional[int] = None
    images: list[tuple[str, str]] = field(default_factory=list)   # [(base64, mime)] 扫描件的页图

    def card(self) -> dict:
        """存在用户消息上的那张卡(只有文件名和类型,没有内容)"""
        return {"type": "file", "name": self.name, "kind": self.kind, "pages": self.pages,
                "scanned": bool(self.images), "truncated": self.truncated}

    def prompt_block(self) -> str:
        """发给模型的文件说明 + 内容(不存库)"""
        head = f"[孩子发来一份文件: {self.name}"
        if self.pages:
            head += f",共 {self.pages} 页"
        head += "]"
        if self.images:
            n = len(self.images)
            more = f"(只看了前 {n} 页)" if self.pages and self.pages > n else ""
            return f"{head}\n这是扫描件,下面是前 {n} 页的图片{more}。"
        tail = f"\n[文件太长,只读了前 {MAX_CHARS} 个字]" if self.truncated else ""
        return f"{head}\n文件内容:\n<<<\n{self.text}\n>>>{tail}"


def safe_name(name: Optional[str]) -> str:
    """文件名只留显示用: 去路径、去控制字符、截短"""
    base = os.path.basename((name or "").replace("\\", "/")).strip() or "文件"
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    if len(base) > NAME_MAX:
        stem, ext = os.path.splitext(base)
        base = stem[:NAME_MAX - len(ext)] + ext
    return base


def kind_of(name: str) -> Optional[str]:
    return KINDS.get(os.path.splitext(name.lower())[1])


def _clip(text: str) -> tuple[str, bool]:
    text = re.sub(r"[ \t　]+", " ", text or "")
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS], True
    return text, False


# ---------------------------------------------------------------- 各格式

def _read_txt(raw: bytes) -> str:
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def _read_pdf(raw: bytes, name: str, kind: str = "pdf") -> Extracted:
    import pymupdf
    from app.services.tutor import prepare_image

    try:
        doc = pymupdf.open(stream=raw, filetype="pdf")
    except Exception:  # noqa: BLE001
        raise FileRejected("这份 PDF 打不开,换一份试试")
    with doc:
        if doc.needs_pass:
            raise FileRejected("这份 PDF 有密码,打不开。去掉密码再发,或者拍照发过来")
        pages = doc.page_count
        if pages <= 0:
            raise FileRejected("这份 PDF 是空的")
        parts: list[str] = []
        total = 0
        for p in doc:
            t = p.get_text()
            parts.append(t)
            total += len(t)
            if total > MAX_CHARS * 2:
                break
        text, truncated = _clip("\n".join(parts))
        if len(text) >= MIN_TEXT_CHARS:
            return Extracted(name=name, kind=kind, text=text, truncated=truncated, pages=pages)
        # 没有文字层(扫描件 / 拍照转的 PDF): 前几页当照片看
        images = []
        for i in range(min(SCAN_PAGES, pages)):
            pix = doc[i].get_pixmap(dpi=SCAN_DPI)
            images.append(prepare_image(pix.tobytes("png")))
        return Extracted(name=name, kind=kind, pages=pages, images=images)


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _read_docx(raw: bytes, name: str) -> Extracted:
    import xml.etree.ElementTree as ET

    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        info = z.getinfo("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise FileRejected("这份 Word 文件打不开,换一份试试(或者另存为 PDF 再发)")
    if info.file_size > DOCX_MAX_XML:
        raise FileRejected("这份 Word 文件太大了,拆开发或者另存为 PDF")
    try:
        root = ET.fromstring(z.read(info))
    except ET.ParseError:
        raise FileRejected("这份 Word 文件打不开,换一份试试(或者另存为 PDF 再发)")
    body = root.find(f"{_W}body")
    lines: list[str] = []

    def para_text(p) -> str:
        out = []
        for el in p.iter():
            if el.tag == f"{_W}t" and el.text:
                out.append(el.text)
            elif el.tag in (f"{_W}tab",):
                out.append("\t")
            elif el.tag in (f"{_W}br", f"{_W}cr"):
                out.append("\n")
        return "".join(out)

    for el in (body if body is not None else []):
        if el.tag == f"{_W}p":
            lines.append(para_text(el))
        elif el.tag == f"{_W}tbl":
            for tr in el.iter(f"{_W}tr"):
                cells = [" ".join(para_text(p) for p in tc.iter(f"{_W}p")).strip() for tc in tr.iter(f"{_W}tc")]
                lines.append(" | ".join(c for c in cells))
        if sum(len(x) for x in lines) > MAX_CHARS * 2:
            break
    text, truncated = _clip("\n".join(lines))
    if not text:
        raise FileRejected("这份 Word 文件里没有文字(可能全是图片)。截图或者拍照发过来")
    return Extracted(name=name, kind="docx", text=text, truncated=truncated)


async def _read_doc(raw: bytes, name: str) -> Extracted:
    """老的 .doc: soffice 转 PDF 再读。临时目录用完整个删(不留孩子文件的副本)"""
    from app.services import office_convert

    if not office_convert.office_available():
        raise FileRejected("服务器暂时读不了老版 Word(.doc),请另存为 .docx 或 PDF 再发")
    tmp = tempfile.mkdtemp(prefix="tutor_doc_")
    try:
        src = os.path.join(tmp, "upload.doc")
        with open(src, "wb") as f:
            f.write(raw)
        try:
            pdf_path = await office_convert.convert_to_pdf_async(src, os.path.join(tmp, "out"))
        except RuntimeError:
            raise FileRejected("这份 Word 文件打不开,请另存为 .docx 或 PDF 再发")
        with open(pdf_path, "rb") as f:
            pdf = f.read()
        return await asyncio.to_thread(_read_pdf, pdf, name, "doc")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def extract(name: Optional[str], raw: bytes) -> Extracted:
    nm = safe_name(name)
    kind = kind_of(nm)
    if kind is None:
        raise FileRejected("只能发 PDF、Word(.doc / .docx)或 txt 文件")
    if not raw:
        raise FileRejected("这份文件是空的")
    if len(raw) > MAX_BYTES:
        raise FileRejected(f"文件太大了(最大 {MAX_BYTES // 1024 // 1024}MB),拆开发或者只发要问的那几页")
    if kind == "txt":
        text, truncated = _clip(_read_txt(raw))
        if not text:
            raise FileRejected("这份文件是空的")
        return Extracted(name=nm, kind="txt", text=text, truncated=truncated)
    if kind == "pdf":
        return await asyncio.to_thread(_read_pdf, raw, nm)
    if kind == "docx":
        return await asyncio.to_thread(_read_docx, raw, nm)
    return await _read_doc(raw, nm)
