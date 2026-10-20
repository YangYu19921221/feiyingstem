"""音标视频「索引挪到文件头」(faststart)

背景(2026-10-18 实测): 线上 42 节音标视频的 moov(索引,播放器出第一帧前必须先拿到)**全在文件末尾**。
浏览器点开要先取开头、发现没有索引、再跳到文件末尾取一次,有的浏览器还会先下一大段才开始放 ——
点开转圈、拖进度慢。ffmpeg `-c copy -movflags +faststart` 只是把索引挪到前面,**不重新压缩**,
画质和大小都不变(242MB 那节实测 13 秒、小 30KB)。

两条路径都走这里: 新上传(upload_video 落盘后后台跑)和存量(scripts/faststart_phonetic_videos.py)。

换文件用 os.replace(同目录原子改名),中间没有「文件不存在」的空档。
⚠️ **正在播的视频不能换**: 播放器按旧索引里的偏移发 Range 请求,换成新文件后偏移全错 → 画面出错。
新上传的刚传完没人在看;存量脚本跳过最近几分钟有人看的那几节。
"""
import asyncio
import logging
import os
import shutil
import struct
from typing import Optional

logger = logging.getLogger(__name__)

# 只处理 ISO BMFF 容器(mp4/mov)。webm 没有 moov 这回事
_FORMAT_BY_EXT = {".mp4": "mp4", ".m4v": "mp4", ".mov": "mov"}

# 时长允许的误差(秒)。-c copy 不动编码,时长应完全一致;留一点给容器层取整
_DURATION_TOLERANCE = 1.0

# 一次只跑一个: ffmpeg 读写整个文件,并发跑几个会把磁盘 IO 占满,拖慢正在上课的人
_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


def top_level_atoms(path: str, limit: int = 64) -> list[str]:
    """文件顶层的 atom 类型(按出现顺序)。读不懂就返回读到的那部分,不抛错"""
    names: list[str] = []
    try:
        total = os.path.getsize(path)
        with open(path, "rb") as f:
            off = 0
            while off + 8 <= total and len(names) < limit:
                f.seek(off)
                head = f.read(16)
                if len(head) < 8:
                    break
                size, typ = struct.unpack(">I4s", head[:8])
                if size == 1:
                    if len(head) < 16:
                        break
                    size = struct.unpack(">Q", head[8:16])[0]
                elif size == 0:
                    size = total - off
                if size < 8:
                    break
                names.append(typ.decode("latin1"))
                off += size
    except OSError:
        return names
    return names


def needs_faststart(path: str) -> bool:
    """mdat(画面数据)排在 moov(索引)前面 = 需要挪。没有 moov 的(坏文件/不是 mp4)不碰"""
    if os.path.splitext(path)[1].lower() not in _FORMAT_BY_EXT:
        return False
    atoms = top_level_atoms(path)
    if "moov" not in atoms or "mdat" not in atoms:
        return False
    return atoms.index("mdat") < atoms.index("moov")


def tools_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


async def _run(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    return proc.returncode or 0, (out or b"").decode(errors="replace") + (err or b"").decode(errors="replace")


async def _probe(path: str) -> Optional[tuple[float, list[str]]]:
    """(时长秒, 各路流的类型)。读不出来返回 None"""
    code, out = await _run(
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=codec_type",
        "-of", "default=noprint_wrappers=1", path)
    if code != 0:
        return None
    duration: Optional[float] = None
    streams: list[str] = []
    for line in out.splitlines():
        k, _, v = line.partition("=")
        if k == "duration":
            try:
                duration = float(v)
            except ValueError:
                pass
        elif k == "codec_type":
            streams.append(v.strip())
    return (duration, streams) if duration is not None else None


async def faststart_in_place(path: str, *, backup_dir: Optional[str] = None) -> str:
    """把索引挪到文件头,原地替换。返回 'skipped' / 'done' / 'failed:<原因>'。

    任何一步不对都**保留原文件**(删掉临时文件),不让一个转坏的视频替换掉好的。
    backup_dir: 替换前把原文件硬链接一份过去(存量脚本用,出问题能整批还原)。
    """
    if not needs_faststart(path):
        return "skipped"
    if not tools_available():
        return "failed:服务器没装 ffmpeg/ffprobe"
    fmt = _FORMAT_BY_EXT[os.path.splitext(path)[1].lower()]
    tmp = f"{path}.faststart.tmp"
    async with _get_lock():
        # 拿到锁之后再判一次: 排队期间可能已经被别的任务处理过
        if not needs_faststart(path):
            return "skipped"
        try:
            before = await _probe(path)
            if before is None:
                return "failed:原文件读不出时长"
            cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", path,
                   "-map", "0", "-c", "copy", "-movflags", "+faststart", "-f", fmt, tmp]
            if shutil.which("nice"):
                cmd = ["nice", "-n", "19", *cmd]
            code, out = await _run(*cmd)
            if code != 0 or not os.path.isfile(tmp):
                return f"failed:ffmpeg 退出码 {code} {out[-200:]}"
            after = await _probe(tmp)
            if after is None:
                return "failed:转完的文件读不出时长"
            if abs(after[0] - before[0]) > _DURATION_TOLERANCE:
                return f"failed:时长对不上 {before[0]:.1f}s → {after[0]:.1f}s"
            if sorted(after[1]) != sorted(before[1]):
                return f"failed:音视频流对不上 {before[1]} → {after[1]}"
            if needs_faststart(tmp) or "moov" not in top_level_atoms(tmp):
                return "failed:转完索引仍不在文件头"
            orig_size = os.path.getsize(path)
            new_size = os.path.getsize(tmp)
            # -c copy 只挪索引,大小几乎不变;差太多说明丢了东西
            if orig_size and abs(new_size - orig_size) > orig_size * 0.05:
                return f"failed:大小变化过大 {orig_size} → {new_size}"
            # 转码那十几秒里视频被删了: 别用 os.replace 把文件「复活」成没人认领的孤儿
            if not os.path.isfile(path):
                return "failed:原文件已不在(视频可能刚被删除)"
            if backup_dir:
                os.makedirs(backup_dir, exist_ok=True)
                dst = os.path.join(backup_dir, os.path.basename(path))
                if not os.path.exists(dst):
                    try:
                        os.link(path, dst)          # 同一块盘: 硬链接,不多占空间也不花时间
                    except OSError:
                        shutil.copy2(path, dst)
            os.replace(tmp, path)
            return "done"
        except Exception as e:  # noqa: BLE001 - 这是附加优化,任何异常都退回原文件
            logger.exception("音标视频 faststart 失败: %s", path)
            return f"failed:{e}"
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


# ---- 新上传: 落盘后后台跑,不让老师的上传请求多等十几秒 ----

_background: set[asyncio.Task] = set()


async def _after_upload(video_id: int, path: str) -> None:
    # 不回写 file_size: 只挪索引,大小只差几十 KB(那一列只用于列表展示);
    # 串流按 os.stat 取真实大小,不读这一列
    status = await faststart_in_place(path)
    if status != "skipped":
        logger.info("音标视频 faststart: id=%s %s", video_id, status)


def schedule_after_upload(video_id: int, path: str) -> None:
    """upload_video 落盘并入库后调。不需要挪的(webm / 已经在头上 / 不是 mp4)直接跳过"""
    if not needs_faststart(path):
        return
    task = asyncio.create_task(_after_upload(video_id, path))
    _background.add(task)
    task.add_done_callback(_background.discard)
