"""
放开 pk_rooms.max_players 上限:20 → 200(2026-07-26)

为什么必须改库:`CHECK(max_players BETWEEN 2 AND 20)` 是建表时写进 DDL 的。
只放开前端和 Pydantic 的话,30 人房能正常建、能正常打完整场比赛,
但 `persist_finished_room()` 在**对局结束时**才写 pk_rooms —— 那一刻 CHECK 失败,
整场成绩(pk_room_players + pk_answer_records)全部丢失。
即"打完才炸",比一开始就报错更难查,所以库必须先改。

SQLite 不支持 ALTER TABLE 改 CHECK,只能重建表:
建新表 → 搬数据 → 换名 → 补索引。外键 pk_room_players / pk_answer_records
用的是 pk_rooms.id,重建时 id 原样保留,引用不受影响。

上限定 200 而非无限:原来卡 20 是因为实时榜每人每答一题都向全房广播全量榜单,
流量按房间人数²涨,30 人房就吃掉 12M 上行一半。该瓶颈已在
pk_websocket.py 解掉(榜单合并推送 + 按人裁剪前10名),200 人单房约占 12M 的 30%。
留 200 这个硬顶只为防手滑填 99999 把内存/带宽打爆。

用法:
    python migrations/migrate_pk_rooms_max_players.py --dry-run
    python migrations/migrate_pk_rooms_max_players.py          # 自动备份后执行
"""
import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from migrations._dbutil import assert_backup_complete, backup_db  # noqa: E402
# 上限取 Python 侧唯一真源,别在这里写字面量(写了就会和 ORM/schema 漂)
from app.core.config import PK_MAX_PLAYERS as NEW_MAX  # noqa: E402

NEW_TABLE_DDL = f"""
CREATE TABLE pk_rooms_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code VARCHAR(6) UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    unit_id INTEGER,
    max_players INTEGER NOT NULL DEFAULT 4 CHECK(max_players BETWEEN 2 AND {NEW_MAX}),
    status VARCHAR(10) NOT NULL,
    word_ids TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    org_id INTEGER NOT NULL DEFAULT 1,
    mode VARCHAR(12) NOT NULL DEFAULT 'individual',
    FOREIGN KEY (host_id) REFERENCES users(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
)
"""

COLS = ("id, invite_code, host_id, unit_id, max_players, status, word_ids, "
        "created_at, started_at, finished_at, org_id, mode")


def current_max(cur) -> int | None:
    row = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='pk_rooms'"
    ).fetchone()
    if not row:
        return None
    sql = row[0] or ""
    import re
    m = re.search(r"max_players\s+INTEGER[^,]*?BETWEEN\s+\d+\s+AND\s+(\d+)", sql, re.I)
    return int(m.group(1)) if m else 0   # 0 = 没有 CHECK 约束


def migrate(db_path: Path, dry_run: bool) -> int:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cap = current_max(cur)
    if cap is None:
        print("  ⚠️  pk_rooms 表不存在,跳过(新库由 create_all 按模型建,已是新上限)")
        conn.close()
        return 0
    print(f"  当前 CHECK 上限: {cap if cap else '无约束'}")
    if cap == 0 or cap >= NEW_MAX:
        print(f"  ✅ 已是 ≥{NEW_MAX} 或无约束,无需迁移(幂等)")
        conn.close()
        return 0

    rooms = cur.execute("SELECT COUNT(*) FROM pk_rooms").fetchone()[0]
    players = cur.execute("SELECT COUNT(*) FROM pk_room_players").fetchone()[0]
    answers = cur.execute("SELECT COUNT(*) FROM pk_answer_records").fetchone()[0]
    print(f"  待搬数据: pk_rooms {rooms} 行(关联 players {players} / answers {answers})")

    if dry_run:
        print(f"  [dry-run] 将重建 pk_rooms,CHECK 改为 BETWEEN 2 AND {NEW_MAX}")
        conn.close()
        return rooms

    cur.execute("PRAGMA foreign_keys=OFF")
    try:
        cur.execute("BEGIN IMMEDIATE")
        cur.execute("DROP TABLE IF EXISTS pk_rooms_new")
        cur.executescript(NEW_TABLE_DDL)
        cur.execute(f"INSERT INTO pk_rooms_new ({COLS}) SELECT {COLS} FROM pk_rooms")
        cur.execute("DROP TABLE pk_rooms")
        cur.execute("ALTER TABLE pk_rooms_new RENAME TO pk_rooms")
        # 索引随旧表一起被删,必须重建(否则邀请码查询退化成全表扫)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pk_rooms_invite ON pk_rooms(invite_code)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pk_rooms_status ON pk_rooms(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pk_rooms_org ON pk_rooms(org_id)")
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"  ❌ 迁移失败已回滚: {e}")
        conn.close()
        return -1
    finally:
        cur.execute("PRAGMA foreign_keys=ON")

    # 自检:行数一致 + 新上限生效 + 外键完整 + 索引齐全
    after = cur.execute("SELECT COUNT(*) FROM pk_rooms").fetchone()[0]
    new_cap = current_max(cur)
    idx = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pk_rooms'").fetchall()}
    orphan = cur.execute(
        "SELECT COUNT(*) FROM pk_room_players p "
        "LEFT JOIN pk_rooms r ON r.id = p.room_id WHERE r.id IS NULL").fetchone()[0]
    # 只检本次动到的三张表。
    # ⚠️ 别用全库 PRAGMA foreign_key_check 判成败:这个库本来就有上万条历史外键悬空
    # (实测原库 11972 条,多为 redemption_codes/pk_rooms.host_id 指向已删用户),
    # 拿全库判会永远红,把"迁移没问题"误报成失败。
    fk_bad = [r for r in cur.execute("PRAGMA foreign_key_check('pk_rooms')").fetchall()]
    fk_bad += [r for r in cur.execute("PRAGMA foreign_key_check('pk_room_players')").fetchall()]
    fk_bad += [r for r in cur.execute("PRAGMA foreign_key_check('pk_answer_records')").fetchall()]
    # 只关心「子表 → pk_rooms」的引用有没有被搬断,那才是本次重建可能破坏的东西。
    # 指向 users 的悬空引用是历史脏数据(删用户时 PK 记录没级联清),重建前后一样存在,
    # 拿它判成败会永远红 —— 曾因此把一次正常迁移误报为失败。
    fk_bad = [r for r in fk_bad if r[2] != "users"]

    print(f"  自检: 行数 {rooms}→{after} ({'OK' if after == rooms else '不一致!'})")
    print(f"        新 CHECK 上限 = {new_cap} ({'OK' if new_cap == NEW_MAX else '异常'})")
    print(f"        孤儿 player 行 = {orphan} (须为 0)")
    print(f"        本表外键检查 = {len(fk_bad)} 处问题 (须为 0;全库历史悬空不计)")
    print(f"        索引 = {len(idx & {'idx_pk_rooms_invite','idx_pk_rooms_status','idx_pk_rooms_org'})}/3 已重建")

    ok = (after == rooms and new_cap == NEW_MAX and orphan == 0 and not fk_bad)
    if not ok:
        print("  ⚠️  自检未通过,请用备份回滚")
        conn.close()
        return -1

    # 写入测试:确认 30 人能进、41 人被拦
    try:
        cur.execute("BEGIN")
        cur.execute("INSERT INTO pk_rooms (invite_code,host_id,max_players,status,word_ids) "
                    "VALUES ('ZZTST1',1,30,'waiting','[]')")
        print("        30 人房可写入 = OK")
        try:
            cur.execute("INSERT INTO pk_rooms (invite_code,host_id,max_players,status,word_ids) "
                        f"VALUES ('ZZTST2',1,{NEW_MAX+1},'waiting','[]')")
            print(f"        ⚠️  {NEW_MAX+1} 人竟然写入成功,CHECK 没生效")
            ok = False
        except sqlite3.IntegrityError:
            print(f"        {NEW_MAX+1} 人被 CHECK 拦下 = OK")
    finally:
        conn.rollback()   # 测试数据一律不留

    conn.close()
    print(f"  ✅ 迁移完成,上限 {cap} → {NEW_MAX}")
    return after if ok else -1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--db", default=None)
    a = ap.parse_args()

    db_path = Path(a.db) if a.db else Path(__file__).resolve().parent.parent / "english_helper.db"
    if not db_path.exists():
        print(f"❌ 数据库不存在: {db_path}")
        return 1

    print(f"📦 pk_rooms.max_players 上限放开至 {NEW_MAX}: {db_path}")
    if not a.dry_run:
        bak = backup_db(db_path, "pkmax")
        n_src, n_bak = assert_backup_complete(db_path, bak, "pk_answer_records")
        print(f"  已备份 → {bak.name}  (校验 pk_answer_records {n_src} vs {n_bak})")
        if n_src != n_bak:
            print("  ❌ 备份不完整,中止迁移")
            return 1

    return 1 if migrate(db_path, a.dry_run) < 0 else 0


if __name__ == "__main__":
    sys.exit(main())
