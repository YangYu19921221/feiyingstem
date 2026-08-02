"""
迁移脚本共用的数据库工具。

放在这里的原因:每个迁移都要"先备份再改",而备份这件事在 WAL 模式下有个
非直觉的坑(见 backup_db),已经因此踩过一次 —— 让每个脚本各写一遍必然再踩。
"""
import sqlite3
from datetime import datetime
from pathlib import Path


def backup_db(db_path: Path, tag: str) -> Path:
    """
    备份 SQLite 库,返回备份文件路径。

    ⚠️ 必须用 sqlite3 的 backup API,不能 shutil.copy2(2026-07-26 实测踩到):
    库开着 WAL,最近的写入还在 `-wal` 文件里没 checkpoint 到主库。
    只拷主文件 → 备份少数据(本地实测主库 11262 行、copy2 备份只有 7374 行;
    生产 WAL 有 17MB 未落盘)。backup API 会把 WAL 内容一起合并进备份,
    拿到的是完整一致快照。
    """
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = db_path.with_name(f"{db_path.name}.bak_{tag}_{stamp}")
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(bak)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()
    return bak


def assert_backup_complete(db_path: Path, bak_path: Path, table: str) -> tuple[int, int]:
    """
    比对主库与备份的行数,返回 (主库行数, 备份行数)。

    调用方据此判断是否中止迁移 —— 备份不完整时改库等于没有回滚路径。
    """
    n_src = sqlite3.connect(db_path).execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    n_bak = sqlite3.connect(bak_path).execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    return n_src, n_bak
