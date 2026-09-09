"""PPT/PPTX → PDF 转换(LibreOffice headless)

音标课件老师传的多半是 PPT,而逐页渲染只吃 PDF,中间这一步交给 soffice。
转出的 PDF 是**中间产物**,渲染完就删 —— 留着等于在服务器上多存一份完整课件副本。

## 以下每一条都是 2026-09-09 在生产机(Ubuntu 24.04 + LibreOffice 24.2.7)实测出来的

**1. 判失败只能看输出文件,不能看退出码、更不能看 stderr。**
   实测 3 个并发共享 profile 时,失败的那个进程**退出码是 1 但日志里只有一句无害的
   javaldx 警告**,没有任何错误信息;而成功的转换 stderr 里也必然有那句 javaldx。
   所以唯一可靠的判据是:目标 PDF 存在、非空、且能被 PyMuPDF 真正打开。
   (同「判 PNG 损坏只能真解码」一个道理,见 CLAUDE.md 的截断图教训)

**2. 每次转换必须用独立的 UserInstallation profile 目录。**
   实测共享 profile 跑 3 并发:1 个失败(无输出文件);改成每个进程独立 profile:
   3/3 成功、2 秒、零残留进程。soffice 的 profile 目录带锁,第二个实例会尝试把请求
   交给持锁的那个实例,而 headless 的临时实例接不了 —— 于是静默失败。

**3. 必须按进程组杀,只 kill 父进程会留孤儿。**
   soffice 是壳脚本,真正干活的是它 fork 出来的 soffice.bin。父进程被杀后子进程会被
   init 收养继续跑,一个几百 MB 常驻 —— 生产机可用内存只有 4.4G,漏几个就 OOM。
   所以 start_new_session=True 让子进程自成进程组,超时时 killpg 整组。

**4. 参数必须以 list 传,永远不要 shell=True。**
   文件名来自老师上传(可能带空格、中文、引号、分号),拼进 shell 就是命令注入。

**5. 并发要压到 1。**
   生产机 uvicorn 单 worker(PK 房间/限流是进程内状态,不能多 worker)、只吃 1 核,
   而每个 soffice 实例吃几百 MB。实测 3 并发内存多用 ~370MB;老师同时传几份大课件
   就有 OOM 风险,而 OOM 会掐掉整个应用。排队几秒可接受,拒绝上传不可接受。
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import subprocess
import tempfile

logger = logging.getLogger(__name__)

# 走 soffice 转换的扩展名。doc/docx 也能转,但音标课件场景只承诺 PPT
OFFICE_EXTS = {".ppt", ".pptx"}

# 单个文件转换超时。实测 2 页 4 秒,百页课件留足余量;
# 到点必须杀掉,否则单 worker 下一个卡住的转换会一直占着线程池的位置
CONVERT_TIMEOUT_SEC = 150

# 串行化闸门:同一时刻只允许一个 soffice 在跑(理由见文件头第 5 条)。
# 模块级单例,单 worker 下 asyncio 原语足够(与 pk/tournament.py 同惯例)
_SOFFICE_SEM = asyncio.Semaphore(1)


def soffice_bin() -> str | None:
    """soffice 可执行文件路径,没装返回 None。

    每次调用都探测(不做模块级缓存):装完 LibreOffice 不用重启应用就能生效,
    而这个函数只在上传课件时走,一次 which 的开销无所谓。
    """
    return shutil.which("soffice") or shutil.which("libreoffice")


def office_available() -> bool:
    return soffice_bin() is not None


def convert_to_pdf(src_path: str, out_dir: str) -> str:
    """把 PPT/PPTX 转成 PDF,返回生成的 PDF 路径。

    **同步阻塞**(与 watermark_service.render_material 同惯例),调用方要丢线程池;
    或者直接用下面的 convert_to_pdf_async(它顺带管了串行化闸门)。

    失败一律抛 RuntimeError,错误信息**中文原因放最前面** —— 上层会截到 400 字符
    存进 render_error 给老师看,把 stderr 放开头会把结论挤掉。
    """
    exe = soffice_bin()
    if not exe:
        raise RuntimeError("服务器未安装 PPT 转换组件(LibreOffice),请先另存为 PDF 再上传")
    if not os.path.isfile(src_path):
        raise RuntimeError(f"源文件不存在: {src_path}")

    os.makedirs(out_dir, exist_ok=True)

    # 独立 profile:并发的关键(文件头第 2 条)。放 /tmp,绝不能放 UPLOAD_DIR
    # (那个目录整体经 /api/v1/files 公开无鉴权)
    profile = tempfile.mkdtemp(prefix="lo_profile_")
    cmd = [
        exe,
        "-env:UserInstallation=file://" + profile,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to", "pdf",
        "--outdir", out_dir,
        src_path,
    ]

    try:
        # start_new_session:让 soffice 自成进程组,超时才杀得干净(文件头第 3 条)
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            _, err = proc.communicate(timeout=CONVERT_TIMEOUT_SEC)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            raise RuntimeError(
                f"PPT 转换超时({CONVERT_TIMEOUT_SEC} 秒),文件可能过大或已损坏"
            )
        stderr_tail = (err or b"").decode("utf-8", "replace")[-400:]
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    # soffice 用**源文件名**命名输出,不接受自定义输出名
    stem = os.path.splitext(os.path.basename(src_path))[0]
    pdf_path = os.path.join(out_dir, stem + ".pdf")

    # ⚠️ 判失败只看输出文件(文件头第 1 条):退出码和 stderr 都不可靠。
    # 退出码只在失败时并进错误信息供排查,不作为判据
    if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) == 0:
        raise RuntimeError(
            "PPT 转换失败,没有生成有效的 PDF。"
            f"(rc={proc.returncode} stderr={stderr_tail})"
        )

    # 文件在、大小正常 ≠ 内容能用。真打开一次才算数
    try:
        import pymupdf  # 延迟导入:没装 PyMuPDF 时不影响其它功能启动
        with pymupdf.open(pdf_path) as doc:
            if doc.page_count <= 0:
                raise RuntimeError("转换出的 PDF 是 0 页")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"转换出的 PDF 打不开: {type(exc).__name__}: {exc}")

    logger.info("PPT 转 PDF 成功: %s -> %s", os.path.basename(src_path), pdf_path)
    return pdf_path


def _kill_group(proc: subprocess.Popen) -> None:
    """按进程组杀干净并收尸(文件头第 3 条)"""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.communicate(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        # SIGKILL 之后仍要 wait 一次,否则留 zombie
        proc.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        logger.warning("soffice 进程组杀不掉,可能留下孤儿进程 pid=%s", proc.pid)


async def convert_to_pdf_async(src_path: str, out_dir: str) -> str:
    """convert_to_pdf 的异步包装:自带串行化闸门 + 线程池。

    调用方一律用这个,不要自己 to_thread —— 闸门放在这里,谁也绕不过去。
    """
    async with _SOFFICE_SEM:
        return await asyncio.to_thread(convert_to_pdf, src_path, out_dir)
