"""存量音标视频: 把 mp4 的索引(moov)挪到文件头,点开就能播

背景与原理见 app/services/video_faststart.py。只挪索引不重新压缩,画质和大小不变。

用法(在 backend 目录下,**夜里没人上课时跑**):
    ./venv/bin/python scripts/faststart_phonetic_videos.py --dry-run
    ./venv/bin/python scripts/faststart_phonetic_videos.py --backup-dir private_media/phonetics_bak_YYYYMMDD

- 最近 10 分钟有人在看的那几节跳过(正在播的文件被换掉,播放器按旧索引取数据会出错),下次再跑即可
- --backup-dir: 替换前把原文件硬链接过去(同一块盘不多花时间;但旧数据会一直占着空间,
  确认学生端播放都正常后手动删掉这个目录)
- 可重复跑: 已经挪过的自动跳过
"""
import argparse
import asyncio
import os
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, func  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.core.timeutil import utc_now  # noqa: E402
from app.models import user  # noqa: F401,E402  (外键解析要用)
from app.models.phonetic import PhoneticVideo, PhoneticVideoView  # noqa: E402
from app.services import video_faststart  # noqa: E402

BUSY_MINUTES = 10


async def main(dry_run: bool, backup_dir: str | None) -> int:
    if not dry_run and not video_faststart.tools_available():
        print("服务器没装 ffmpeg/ffprobe,先 apt install ffmpeg")
        return 1
    async with AsyncSessionLocal() as db:
        videos = (await db.execute(
            select(PhoneticVideo.id, PhoneticVideo.title, PhoneticVideo.file_path)
            .order_by(PhoneticVideo.id)
            .execution_options(skip_tenant_filter=True)
        )).all()
        since = utc_now() - timedelta(minutes=BUSY_MINUTES)
        busy = set((await db.execute(
            select(PhoneticVideoView.video_id)
            .where(PhoneticVideoView.last_viewed_at >= since)
            .group_by(PhoneticVideoView.video_id)
            .having(func.count() > 0)
        )).scalars().all())

    counts = {"done": 0, "skipped": 0, "busy": 0, "missing": 0, "failed": 0}
    for vid, title, fp in videos:
        path = os.path.join(settings.PHONETIC_VIDEO_DIR, os.path.basename(fp or ""))
        if not fp or not os.path.isfile(path):
            counts["missing"] += 1
            print(f"[缺文件] id={vid} {title}")
            continue
        if not video_faststart.needs_faststart(path):
            counts["skipped"] += 1
            continue
        if vid in busy:
            counts["busy"] += 1
            print(f"[有人在看,跳过] id={vid} {title}")
            continue
        size_mb = os.path.getsize(path) / 1048576
        if dry_run:
            counts["done"] += 1
            print(f"[待处理] id={vid} {size_mb:.0f}MB {title}")
            continue
        status = await video_faststart.faststart_in_place(path, backup_dir=backup_dir)
        if status == "done":
            counts["done"] += 1
            async with AsyncSessionLocal() as db:
                v = await db.get(PhoneticVideo, vid)
                if v is not None:
                    v.file_size = os.path.getsize(path)
                    await db.commit()
            print(f"[完成] id={vid} {size_mb:.0f}MB {title}")
        elif status == "skipped":
            counts["skipped"] += 1
        else:
            counts["failed"] += 1
            print(f"[失败,原文件未动] id={vid} {title}: {status}")

    label = "待处理" if dry_run else "完成"
    print(f"\n{label} {counts['done']} / 已在文件头 {counts['skipped']} / 有人在看跳过 {counts['busy']}"
          f" / 缺文件 {counts['missing']} / 失败 {counts['failed']}")
    return 0 if counts["failed"] == 0 else 2


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只列出要处理的,不改文件")
    ap.add_argument("--backup-dir", default=None, help="替换前把原文件硬链接到这个目录")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.dry_run, args.backup_dir)))
