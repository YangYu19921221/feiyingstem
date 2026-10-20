"""存量音标视频: 批量压「流畅」版(480p 低码率副本)

背景与参数见 app/services/video_lite.py。原片一个字节都不动,流畅版放在原片旁边(`*.lite.mp4`)。

用法(在 backend 目录下,**夜里没人上课时跑**,压缩吃 CPU):
    ./venv/bin/python scripts/gen_phonetic_lite.py --dry-run
    ./venv/bin/python scripts/gen_phonetic_lite.py --threads 3

- 可重复跑: 已经有流畅版的、判过「压完没小多少」的自动跳过
- 只在 23 点到次日 7 点之间跑;到 7 点还没跑完就停,剩下的等学生换票时由服务慢慢补(nice 19、一次一个)。
  确实要白天跑(比如测试)加 --any-time
- 先清掉压到一半留下的临时文件
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import user  # noqa: F401,E402  (外键解析要用)
from app.models.phonetic import PhoneticVideo  # noqa: E402
from app.services import video_faststart, video_lite  # noqa: E402

STOP_HOUR = 7      # 早上 7 点以后停
START_HOUR = 23    # 晚上 23 点以后才开始


async def main(dry_run: bool, threads: int, any_time: bool = False) -> int:
    if not dry_run and not video_faststart.tools_available():
        print("服务器没装 ffmpeg/ffprobe,先 apt install ffmpeg")
        return 1
    removed = video_lite.cleanup_stale_tmp(settings.PHONETIC_VIDEO_DIR)
    if removed:
        print(f"清掉 {removed} 个压到一半留下的临时文件")
    async with AsyncSessionLocal() as db:
        videos = (await db.execute(
            select(PhoneticVideo.id, PhoneticVideo.title, PhoneticVideo.file_path)
            .where(PhoneticVideo.is_active.is_(True))
            .order_by(PhoneticVideo.id)
            .execution_options(skip_tenant_filter=True)
        )).all()

    def daytime() -> bool:
        return STOP_HOUR <= datetime.now().hour < START_HOUR

    if not dry_run and not any_time and daytime():
        print(f"现在是白天({STOP_HOUR}–{START_HOUR} 点有人上课),不跑。确实要现在跑加 --any-time")
        return 0

    counts: dict[str, int] = {}
    saved = 0
    for vid, title, fp in videos:
        if not dry_run and not any_time and daytime():
            print(f"已到 {STOP_HOUR} 点,停下(剩下的由服务在有人看时慢慢补)")
            break
        path = os.path.join(settings.PHONETIC_VIDEO_DIR, os.path.basename(fp or ""))
        if not fp or not os.path.isfile(path):
            counts["missing"] = counts.get("missing", 0) + 1
            print(f"[缺文件] id={vid} {title}")
            continue
        if video_lite.has_lite(path):
            counts["exists"] = counts.get("exists", 0) + 1
            continue
        size_mb = os.path.getsize(path) / 1048576
        if dry_run:
            counts["todo"] = counts.get("todo", 0) + 1
            print(f"[待压] id={vid} {size_mb:.0f}MB {title}")
            continue
        status = await video_lite.make_lite(path, threads=threads)
        key = status.split(":")[0]
        counts[key] = counts.get(key, 0) + 1
        if status == "done":
            lite_mb = os.path.getsize(video_lite.lite_path_for(path)) / 1048576
            saved += size_mb - lite_mb
            print(f"[完成] id={vid} {size_mb:.0f}MB → {lite_mb:.0f}MB {title}")
        elif status == "not_smaller":
            print(f"[不值得压,跳过] id={vid} {size_mb:.0f}MB {title}")
        elif status.startswith("failed"):
            print(f"[失败,原片未动] id={vid} {title}: {status}")

    print("\n" + " / ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    if not dry_run:
        print(f"流畅版比原片合计小 {saved:.0f}MB")
    return 0 if counts.get("failed", 0) == 0 else 2


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只列出要压的,不动文件")
    ap.add_argument("--threads", type=int, default=3, help="ffmpeg 线程数(夜里可以多给,白天别超过 2)")
    ap.add_argument("--any-time", action="store_true",
                    help="不管几点都跑(默认只在 23 点到次日 7 点之间跑)")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.dry_run, args.threads, args.any_time)))
