"""每晚自动备份(2026-11-08,用户「每天晚上12点备份,次日备份好的就把前一天的删除」)

做什么:
1. 数据库: 用 SQLite 的在线备份(不停服务、不用锁表,开着 WAL 也是完整的一份)导出一份,
   打开检查 quick_check == ok 才算数
2. uploads 目录(配图 / 封面 / 二维码等): 打成一个 tar.gz
   ⚠️ private_media/phonetics(音标视频 4.9G)不备份: 原片已经在腾讯云 COS 桶里(phonetics/)
3. 存两处: 本机 /www/backup/english-helper/nightly/ + 腾讯云 COS 桶 backup/nightly/
4. **两样都做好、检查过、COS 也传成功之后**,才删前一天的那份(两处都删);
   任何一步失败: 不删旧的、写失败原因、退出码非 0(管理端首页「每晚备份」卡片会标红)

结果写 private_media/backup/status.json(最近 30 次),管理端读它显示。

用法(生产机):
    cd /www/wwwroot/english-helper/backend && venv/bin/python scripts/nightly_backup.py
    加 --no-cos 只存本机(测试用);--keep N 保留最近 N 份(默认 1 = 只留最新那份)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

BJ = timezone(timedelta(hours=8))
DB_PATH = BACKEND / "english_helper.db"
UPLOADS = BACKEND / "uploads"
LOCAL_DIR = Path(os.environ.get("EH_BACKUP_DIR", "/www/backup/english-helper/nightly"))
STATUS_FILE = BACKEND / "private_media" / "backup" / "status.json"
COS_PREFIX = "backup/nightly/"
STATUS_KEEP = 30
MIN_FREE_GB = 5          # 本机剩不到这么多就不备份(备份会把磁盘写满,网站就挂了)


def now_bj() -> datetime:
    return datetime.now(BJ)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}" if unit != "B" else f"{int(n)}B"
        n /= 1024
    return f"{n:.1f}TB"


# ---------------- 状态记录 ----------------

def read_status() -> list[dict]:
    try:
        d = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def write_status(entry: dict) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    runs = read_status()
    runs.append(entry)
    tmp = STATUS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(runs[-STATUS_KEEP:], ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, STATUS_FILE)


# ---------------- 备份步骤 ----------------

def backup_db(dest: Path) -> dict:
    """SQLite 在线备份 API: 读的是一致的快照,服务照常写不受影响(WAL 里没合并的也会带上)"""
    tmp = dest.with_suffix(".db.part")
    for leftover in (tmp, Path(f"{tmp}-wal"), Path(f"{tmp}-shm"), Path(f"{tmp}-journal")):
        leftover.unlink(missing_ok=True)
    t0 = time.time()
    src = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=60)
    dst = sqlite3.connect(str(tmp))
    try:
        # 分批拷,每批之间让一下: 白天有人用也不卡(半夜其实没人)
        src.backup(dst, pages=4096, sleep=0.01)
        # 原库是 WAL 模式,拷出来的也会是;改回普通模式,备份就是一个单独的 .db 文件(不带 -wal / -shm)
        dst.execute("pragma journal_mode=delete")
    finally:
        dst.close()
        src.close()
    chk = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
    try:
        ok = chk.execute("pragma quick_check").fetchone()[0]
        users = chk.execute("select count(*) from users").fetchone()[0]
    finally:
        chk.close()
    if ok != "ok":
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"备份出来的数据库检查没过: {ok}")
    if users <= 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("备份出来的数据库里一个账号都没有,不对劲,没用这份")
    os.replace(tmp, dest)
    return {"size": dest.stat().st_size, "users": users, "secs": round(time.time() - t0, 1)}


def backup_uploads(dest: Path) -> dict:
    tmp = dest.with_suffix(".part")
    t0 = time.time()
    n = 0
    with tarfile.open(tmp, "w:gz", compresslevel=1) as tar:   # 图片本来就压缩过,压狠了只是费 CPU
        for p in sorted(UPLOADS.rglob("*")):
            if p.is_file() and not p.name.endswith((".tmp", ".part")):
                tar.add(p, arcname=str(p.relative_to(BACKEND)))
                n += 1
    with tarfile.open(tmp, "r:gz") as tar:                     # 读一遍目录,确认压缩包是好的
        got = sum(1 for m in tar.getmembers() if m.isfile())
    if got != n:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"上传文件压缩包不完整: 应有 {n} 个文件,包里 {got} 个")
    os.replace(tmp, dest)
    return {"size": dest.stat().st_size, "files": n, "secs": round(time.time() - t0, 1)}


def cos_client():
    from app.services import cos_video as cv
    c = cv.client()
    if c is None:
        raise RuntimeError("腾讯云 COS 没配置或连不上(.env 里的 COS_BUCKET / COS_SECRET_ID 等)")
    return c, cv._bucket


def cos_upload(c, bucket: str, path: Path) -> None:
    key = COS_PREFIX + path.name
    c.upload_file(Bucket=bucket, Key=key, LocalFilePath=str(path), PartSize=20, MAXThread=4)
    head = c.head_object(Bucket=bucket, Key=key)
    remote = int(head.get("Content-Length") or 0)
    if remote != path.stat().st_size:
        raise RuntimeError(f"传到 COS 的 {path.name} 大小不对: 本机 {path.stat().st_size},COS {remote}")


def cos_list(c, bucket: str) -> list[str]:
    keys, marker = [], ""
    while True:
        r = c.list_objects(Bucket=bucket, Prefix=COS_PREFIX, Marker=marker, MaxKeys=1000)
        keys += [o["Key"] for o in (r.get("Contents") or [])]
        if r.get("IsTruncated") != "true":
            return keys
        marker = r.get("NextMarker") or keys[-1]


def stamp_of(name: str) -> str | None:
    """eh-db-20261108-0000.db / eh-uploads-20261108-0000.tar.gz → 20261108-0000"""
    for pre in ("eh-db-", "eh-uploads-"):
        if name.startswith(pre):
            return name[len(pre):].split(".", 1)[0]
    return None


def prune(keep_stamps: set[str], c=None, bucket: str | None = None) -> list[str]:
    """只删本脚本自己生成的、不在保留名单里的文件(名字对不上的一律不碰)"""
    removed = []
    for p in LOCAL_DIR.iterdir():
        s = stamp_of(p.name)
        if s and s not in keep_stamps:
            p.unlink()
            removed.append(f"本机 {p.name}")
    if c is not None:
        for key in cos_list(c, bucket):
            s = stamp_of(key[len(COS_PREFIX):])
            if s and s not in keep_stamps:
                c.delete_object(Bucket=bucket, Key=key)
                removed.append(f"COS {key[len(COS_PREFIX):]}")
    return removed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cos", action="store_true", help="只存本机,不传 COS")
    ap.add_argument("--keep", type=int, default=1, help="保留最近几份(默认 1: 新的做好了就删掉前一天的)")
    args = ap.parse_args()

    started = now_bj()
    stamp = started.strftime("%Y%m%d-%H%M")
    entry: dict = {"at": started.isoformat(timespec="seconds"), "stamp": stamp, "ok": False}
    try:
        LOCAL_DIR.mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(LOCAL_DIR).free
        if free < MIN_FREE_GB * 2**30:
            raise RuntimeError(f"服务器磁盘只剩 {human(free)},低于 {MIN_FREE_GB}GB,这次没备份(备份会把磁盘写满)")

        db_file = LOCAL_DIR / f"eh-db-{stamp}.db"
        up_file = LOCAL_DIR / f"eh-uploads-{stamp}.tar.gz"
        entry["db"] = backup_db(db_file)
        entry["uploads"] = backup_uploads(up_file)

        c = bucket = None
        if not args.no_cos:
            c, bucket = cos_client()
            t0 = time.time()
            cos_upload(c, bucket, db_file)
            cos_upload(c, bucket, up_file)
            entry["cos"] = {"ok": True, "secs": round(time.time() - t0, 1)}
        else:
            entry["cos"] = {"ok": False, "skipped": True}

        # 走到这里 = 新的一份两处都好了,才删旧的
        stamps = sorted({s for s in (stamp_of(p.name) for p in LOCAL_DIR.iterdir()) if s}, reverse=True)
        keep = set(stamps[:max(1, args.keep)]) | {stamp}
        entry["removed"] = prune(keep, c, bucket)
        entry["ok"] = True
        entry["free_after"] = shutil.disk_usage(LOCAL_DIR).free
    except Exception as e:  # noqa: BLE001
        entry["error"] = str(e)[:300]
        entry["trace"] = traceback.format_exc()[-1500:]
    entry["secs"] = round((now_bj() - started).total_seconds(), 1)
    write_status(entry)

    if entry["ok"]:
        print(f"[{entry['at']}] 备份成功: 数据库 {human(entry['db']['size'])}({entry['db']['users']} 个账号),"
              f"上传文件 {human(entry['uploads']['size'])}({entry['uploads']['files']} 个),"
              f"{'已传 COS' if entry['cos'].get('ok') else '没传 COS'};删掉旧的 {len(entry['removed'])} 个,用时 {entry['secs']} 秒")
        return 0
    print(f"[{entry['at']}] 备份失败,旧的备份留着没删: {entry['error']}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
