"""音标视频「流畅」版(480p 低码率副本)

背景(2026-10-18 实测): 服务器出口 12M,原片码率中位 0.67 Mbps(最高一节 1080p 2 Mbps),
同时 18 个孩子看就占满 —— 电教室一个班一起开视频卡,是带宽不够。流畅版把画面压到 480p、
约 0.2 Mbps(实测 1080p 那节 2002→196 kbps,720p 721→201 kbps,白板字和音标符号看得清),
**声音原样不动**(音标课听发音是正事;源音频是 AAC 就直接拷,不是才转 128k AAC)。
整体流量降到原来的 1/2 ~ 1/6,同时能看的人数翻一倍多。

文件放在原片旁边: `{原片名去扩展名}.lite.mp4`。原片名是随机 hex,不会撞名;不进数据库,
有没有流畅版就看这个文件在不在(列表 42 条就 42 次 stat,可以忽略)。
压完没小多少(≥ 原片 70%)就不留,写个 `.lite.skip` 标记,以后不再压 —— 这种视频播放器不给「流畅」选项。

何时压: 新上传后后台压;学生换票时发现还没有流畅版也顺手排一个(自愈: 压到一半服务重启丢了的,
下次有人看时补上)。一次只压一个,nice 19,线程数受限,不跟上课抢 CPU。
存量用 scripts/gen_phonetic_lite.py 夜里批量压。

删视频时连带删(teacher/phonetics.py 两条删除路径都调 remove_for)。
"""
import asyncio
import glob
import logging
import os
import shutil
import time
from typing import Optional

from app.services import video_faststart

logger = logging.getLogger(__name__)

LITE_SUFFIX = ".lite.mp4"
SKIP_SUFFIX = ".lite.skip"
# 压完至少要小这么多才留(压完只小一点点,白占磁盘、多一个选项还让孩子困惑)
KEEP_RATIO = 0.7
# 短边像素
LITE_SHORT_SIDE = 480
# 磁盘剩这么多以下就不压了(GB)
MIN_FREE_GB = 3
# 后台(白天也可能跑)用的线程数;夜里批量脚本可以给多些
DEFAULT_THREADS = 2

_lock: Optional[asyncio.Lock] = None
_running: set[str] = set()
_failed: set[str] = set()
_background: set[asyncio.Task] = set()


def _get_lock() -> asyncio.Lock:
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


def lite_path_for(original_path: str) -> str:
    base, _ = os.path.splitext(original_path)
    return base + LITE_SUFFIX


def _skip_path_for(original_path: str) -> str:
    base, _ = os.path.splitext(original_path)
    return base + SKIP_SUFFIX


def has_lite(original_path: Optional[str]) -> bool:
    return bool(original_path) and os.path.isfile(lite_path_for(original_path))


def remove_for(original_path: str) -> None:
    """删视频时调: 流畅版、跳过标记、没压完的临时文件一起删"""
    base, _ = os.path.splitext(original_path)
    for p in [base + LITE_SUFFIX, base + SKIP_SUFFIX, *glob.glob(glob.escape(base) + ".lite.*.tmp")]:
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            logger.warning("删除流畅版文件失败: %s %s", p, e)


def cleanup_stale_tmp(directory: str, older_than_sec: int = 2 * 3600) -> int:
    """压到一半服务重启/被杀留下的临时文件。返回删了几个"""
    n = 0
    now = time.time()
    for p in glob.glob(os.path.join(glob.escape(directory), "*.lite.*.tmp")):
        try:
            if now - os.path.getmtime(p) > older_than_sec:
                os.remove(p)
                n += 1
        except OSError:
            pass
    return n


def _free_gb(path: str) -> float:
    try:
        return shutil.disk_usage(os.path.dirname(path) or ".").free / 1024 ** 3
    except OSError:
        return 0.0


async def _audio_codec(path: str) -> Optional[str]:
    code, out = await video_faststart._run(
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name", "-of", "csv=p=0", path)
    name = out.strip().splitlines()[0].strip() if code == 0 and out.strip() else ""
    return name or None


async def make_lite(original_path: str, *, threads: int = DEFAULT_THREADS) -> str:
    """压一份流畅版。返回 'exists' / 'skipped' / 'done' / 'not_smaller' / 'failed:<原因>'。

    任何一步不对都不留半成品;原片一个字节都不动。
    """
    lite = lite_path_for(original_path)
    if os.path.isfile(lite):
        return "exists"
    if os.path.isfile(_skip_path_for(original_path)):
        return "skipped"
    if not os.path.isfile(original_path):
        return "failed:原片不在"
    if not video_faststart.tools_available():
        return "failed:服务器没装 ffmpeg/ffprobe"
    if _free_gb(original_path) < MIN_FREE_GB:
        return f"failed:磁盘剩余不足 {MIN_FREE_GB}GB"

    # 临时文件名带进程号: 夜里的批量脚本和服务里的后台任务可能同时压同一节,各写各的不打架
    tmp = f"{os.path.splitext(original_path)[0]}.lite.{os.getpid()}.tmp"
    try:
        src = await video_faststart._probe(original_path)
        if src is None or "video" not in src[1]:
            return "failed:原片读不出时长或没有画面"
        audio = await _audio_codec(original_path)
        s = LITE_SHORT_SIDE
        # 短边压到 480(横屏按高、竖屏按宽),本来就不到 480 的不放大;宽高取偶数(yuv420p 要求)
        vf = (f"scale=w='if(gte(iw,ih),-2,trunc(min({s},iw)/2)*2)'"
              f":h='if(gte(iw,ih),trunc(min({s},ih)/2)*2,-2)'")
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", original_path,
               "-map", "0:v:0", "-map", "0:a:0?", "-vf", vf,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
               "-maxrate", "300k", "-bufsize", "600k", "-profile:v", "main", "-pix_fmt", "yuv420p",
               "-threads", str(max(1, threads))]
        # 声音原样不动: 音标课听发音是正事,不能为了省流量把齿音/摩擦音压糊
        cmd += ["-c:a", "copy"] if audio == "aac" else ["-c:a", "aac", "-b:a", "128k"]
        cmd += ["-movflags", "+faststart", "-f", "mp4", tmp]
        if shutil.which("nice"):
            cmd = ["nice", "-n", "19", *cmd]
        code, out = await video_faststart._run(*cmd)
        if code != 0 or not os.path.isfile(tmp):
            return f"failed:ffmpeg 退出码 {code} {out[-200:]}"
        got = await video_faststart._probe(tmp)
        if got is None or "video" not in got[1]:
            return "failed:压完的文件读不出时长或没有画面"
        if abs(got[0] - src[0]) > 1.5:
            return f"failed:时长对不上 {src[0]:.1f}s → {got[0]:.1f}s"
        if ("audio" in src[1]) != ("audio" in got[1]):
            return "failed:声音丢了"
        if os.path.getsize(tmp) >= os.path.getsize(original_path) * KEEP_RATIO:
            # 原片本来就小: 没必要给「流畅」选项,记下来以后不再压
            open(_skip_path_for(original_path), "w").close()
            return "not_smaller"
        # 压的这几分钟里视频被删了: 别把流畅版「复活」成没人认领的孤儿
        if not os.path.isfile(original_path):
            return "failed:原片已不在(视频可能刚被删除)"
        # 夜里的脚本和服务的后台任务同时压了同一节、对方先压好了: 留先到的那份,
        # 不去替换 —— 可能已经有孩子在看它,中途换文件播放器按旧偏移取数据会出错
        if os.path.isfile(lite):
            return "exists"
        os.replace(tmp, lite)
        return "done"
    except Exception as e:  # noqa: BLE001 - 附加功能,任何异常都只是没有流畅版
        logger.exception("音标视频流畅版失败: %s", original_path)
        return f"failed:{e}"
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _threads_now() -> int:
    """白天(7–23 点有人上课)只给 1 个线程,夜里给 DEFAULT_THREADS。nice 19 之外再收一道,不跟上课抢 CPU"""
    from datetime import datetime
    return 1 if 7 <= datetime.now().hour < 23 else DEFAULT_THREADS


async def _job(original_path: str) -> None:
    key = os.path.basename(original_path)
    try:
        async with _get_lock():
            status = await make_lite(original_path, threads=_threads_now())
        if status.startswith("failed"):
            _failed.add(key)          # 这次进程里不再重试,免得一个坏文件被反复压
        if status not in ("exists", "skipped"):
            logger.info("音标视频流畅版: %s %s", key, status)
    finally:
        _running.discard(key)


def ensure_scheduled(original_path: Optional[str]) -> None:
    """没有流畅版就排一个后台任务(已有/已判不值得/正在压/这次进程里失败过 → 什么都不做)。

    上传后和学生换票时调。不阻塞调用方,不抛错。
    """
    if not original_path:
        return
    key = os.path.basename(original_path)
    if key in _running or key in _failed:
        return
    if os.path.isfile(lite_path_for(original_path)) or os.path.isfile(_skip_path_for(original_path)):
        return
    if not os.path.isfile(original_path) or not video_faststart.tools_available():
        return
    # 只压完整的 mp4/mov: webm / 坏文件不碰(也免得测试里的假文件拉起一堆 ffmpeg)
    if not video_faststart.is_iso_bmff(original_path):
        _failed.add(key)
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _running.add(key)
    task = loop.create_task(_job(original_path))
    _background.add(task)
    task.add_done_callback(_background.discard)
