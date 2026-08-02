"""
回填 word_mastery 计数器 + 重算掌握度(2026-07-25)

治的是写入侧历史欠账:单元考试(unit_exam.py)和错题闯关(mistake_book.py)原先
手写 `wrong_count += 1` 却不加 `total_encounters`,而等级算的是
`correct_count / total_encounters`:
- 1975 行 correct+wrong > total_encounters
- 730 行 correct_count > total_encounters → accuracy 算出 >1,掌握度被系统性抬高
- 3238 行 total_encounters 少于 learning_records 里的实际条数

口径:learning_records 是真源,按 (user_id, word_id) 重算:
  total_encounters = 记录条数
  correct_count    = is_correct=1 条数
  wrong_count      = is_correct=0 条数
  mastery_level    = services.mastery.level_for(correct_count, total_encounters)
分模式计数器(quiz/spelling/fillblank/flashcard)同样按模式重算。

⚠️ 拆分词保护(2026-07-25 生产实测踩到,务必保留):
`migrate_split_words_by_unit.py` 做单元级隔离时,**把 word_mastery 复制到新
word_id,但 learning_records 刻意留在原 word_id**(见该脚本 docstring)。
所以对拆分词副本,"计数器 > 记录数"是合法状态,不是脏数据 —— 生产实测
1215 行计数器高于记录、14987 行完全没有记录,经核对 100% 都是拆分词副本
(同拼写存在多个 word_id)。按记录重算会把这些学生的进度清零/降级。
因此本脚本只在"记录数 >= 现有计数器"时才回填(纯粹的漏加 total_encounters
场景),记录数更少的行一律跳过,绝不下调。

不动的东西:
- review_stage / next_review_at:SRS 排期是时序状态,无法从聚合还原,重排会
  把所有人的复习节奏打乱。等级修正后复习查询照样按 next_review_at 走。
- 没有任何 learning_records 的掌握度行:拆分词副本或手动"标记已掌握",保持原样。
- 计数器高于记录数的行:拆分词副本,保持原样(见上)。
- mistake_book 手动标记/闯关全对给的 level>=4 奖励:若该行同时需要回填计数器,
  等级会按真实答题重算。修完后运行时逻辑仍会在闯关全对时重新抬到 4。

用法:
    python migrations/migrate_backfill_word_mastery_counters.py --dry-run   # 只报告
    python migrations/migrate_backfill_word_mastery_counters.py            # 实际写入(自动备份)
"""
import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from migrations._dbutil import assert_backup_complete, backup_db  # noqa: E402
# 阶梯与分模式列名都取真源,别在这里复制 —— 复制一份就多一处会漂的地方。
# (MODE_COLUMNS 的顺序还决定下面 executemany 的列序,漂了会写错列)
from app.services.mastery import MODE_COLUMNS, level_for  # noqa: E402


def backfill(db_path: Path, dry_run: bool) -> int:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1. 按 (user_id, word_id) 聚合真实答题记录
    cur.execute("""
        SELECT user_id, word_id, learning_mode,
               COUNT(*) AS n,
               SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS ok
        FROM learning_records
        GROUP BY user_id, word_id, learning_mode
    """)
    truth: dict[tuple[int, int], dict] = {}
    for r in cur.fetchall():
        key = (r["user_id"], r["word_id"])
        t = truth.setdefault(key, {"enc": 0, "ok": 0, "modes": {}})
        t["enc"] += r["n"]
        t["ok"] += r["ok"] or 0
        if r["learning_mode"] in MODE_COLUMNS:
            m = t["modes"].setdefault(r["learning_mode"], [0, 0])
            m[0] += r["ok"] or 0
            m[1] += r["n"] - (r["ok"] or 0)

    # 2. 逐行比对现状
    cur.execute("""
        SELECT id, user_id, word_id, total_encounters, correct_count, wrong_count,
               mastery_level, flashcard_correct, flashcard_wrong, quiz_correct,
               quiz_wrong, spelling_correct, spelling_wrong, fillblank_correct,
               fillblank_wrong
        FROM word_mastery
    """)
    rows = cur.fetchall()

    updates = []
    stats = {
        "rows": len(rows), "no_records": 0, "counter_fixed": 0,
        "level_changed": 0, "level_up": 0, "level_down": 0,
        "lost_mastered": 0, "gained_mastered": 0, "impossible_acc_fixed": 0,
        "split_protected": 0,
    }

    for row in rows:
        t = truth.get((row["user_id"], row["word_id"]))
        if not t:
            stats["no_records"] += 1
            continue

        enc, ok = t["enc"], t["ok"]
        wrong = enc - ok

        # 拆分词保护:记录数少于现有计数器 → 该行是 migrate_split_words_by_unit
        # 复制过来的进度(记录留在原 word_id),按记录重算等于清零学生进度。
        # 只回填"记录更多"的行,绝不下调。
        if enc < (row["total_encounters"] or 0) or ok < (row["correct_count"] or 0):
            stats["split_protected"] += 1
            continue

        new_level = level_for(ok, enc)

        mode_vals = {}
        for mode, (c_col, w_col) in MODE_COLUMNS.items():
            c, w = t["modes"].get(mode, [0, 0])
            mode_vals[c_col] = c
            mode_vals[w_col] = w

        counter_drift = (
            row["total_encounters"] != enc
            or row["correct_count"] != ok
            or row["wrong_count"] != wrong
            or any(row[col] != val for col, val in mode_vals.items())
        )
        level_drift = row["mastery_level"] != new_level

        if not counter_drift and not level_drift:
            continue

        if counter_drift:
            stats["counter_fixed"] += 1
        if (row["correct_count"] or 0) > (row["total_encounters"] or 0):
            stats["impossible_acc_fixed"] += 1
        if level_drift:
            stats["level_changed"] += 1
            if new_level > row["mastery_level"]:
                stats["level_up"] += 1
            else:
                stats["level_down"] += 1
            if row["mastery_level"] >= 3 > new_level:
                stats["lost_mastered"] += 1
            if row["mastery_level"] < 3 <= new_level:
                stats["gained_mastered"] += 1

        updates.append((enc, ok, wrong, new_level, *mode_vals.values(), row["id"]))

    print(f"  扫描 {stats['rows']} 行,需修正 {len(updates)} 行")
    print(f"    计数器漂移        : {stats['counter_fixed']}")
    print(f"    其中正确率>100%   : {stats['impossible_acc_fixed']}")
    print(f"    掌握度变化        : {stats['level_changed']} (升 {stats['level_up']} / 降 {stats['level_down']})")
    print(f"    掌握线进出        : 掉出 {stats['lost_mastered']} / 新进 {stats['gained_mastered']}")
    print(f"    无答题记录(跳过)  : {stats['no_records']}")
    print(f"    拆分词保护(跳过)  : {stats['split_protected']}  ← 记录少于计数器,不下调")

    if dry_run:
        print("  [dry-run] 未写入")
        conn.close()
        return len(updates)

    if not updates:
        print("  无需修正")
        conn.close()
        return 0

    col_order = list(MODE_COLUMNS['flashcard']) + list(MODE_COLUMNS['quiz']) \
        + list(MODE_COLUMNS['spelling']) + list(MODE_COLUMNS['fillblank'])
    # mode_vals 的插入顺序即 MODE_COLUMNS 的遍历顺序,与这里一致
    set_clause = ", ".join(f"{c} = ?" for c in col_order)
    cur.executemany(
        f"""UPDATE word_mastery
            SET total_encounters = ?, correct_count = ?, wrong_count = ?,
                mastery_level = ?, {set_clause}
            WHERE id = ?""",
        updates,
    )
    conn.commit()
    print(f"  ✅ 已写入 {cur.rowcount if cur.rowcount > 0 else len(updates)} 行")

    # 3. 写后自检。
    # 只检"本次回填过的行"(记录数 >= 原计数器):这些必须三者恒等。
    # 拆分词副本不在回填范围,它们的 correct_count > total_encounters 是历史遗留,
    # 由 clone 时的源数据带过来,不属于本次治理范围 —— 拿它们判失败会永远红。
    cur.execute("""
        SELECT COUNT(*) FROM word_mastery
        WHERE total_encounters != correct_count + wrong_count
    """)
    bad_sum = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM word_mastery WHERE correct_count > total_encounters")
    bad_acc = cur.fetchone()[0]
    print(f"  自检(全表): 三者不等 {bad_sum} 行, 正确率>100% {bad_acc} 行")
    print("    ↑ 残留应全部是拆分词副本(见 docstring),下面按拼写重数校验:")

    cur.execute("""
        WITH dup AS (SELECT lower(word) sp FROM words GROUP BY lower(word) HAVING COUNT(*) > 1)
        SELECT COUNT(*) FROM word_mastery wm
        JOIN words w ON w.id = wm.word_id
        LEFT JOIN dup d ON d.sp = lower(w.word)
        WHERE wm.total_encounters != wm.correct_count + wm.wrong_count
          AND d.sp IS NULL
    """)
    bad_non_split = cur.fetchone()[0]
    print(f"    非拆分词的不一致行: {bad_non_split} (必须为 0)")
    if bad_non_split:
        print("  ⚠️  自检未通过,请检查")
        conn.close()
        return -1

    conn.close()
    return len(updates)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告不写入")
    ap.add_argument("--db", default=None, help="数据库路径(默认 backend/english_helper.db)")
    args = ap.parse_args()

    db_path = Path(args.db) if args.db else Path(__file__).resolve().parent.parent / "english_helper.db"
    if not db_path.exists():
        print(f"❌ 数据库不存在: {db_path}")
        return 1

    print(f"📦 word_mastery 计数器回填: {db_path}")

    if not args.dry_run:
        # 走共用的 WAL 安全备份:本脚本会重写整表的计数器与掌握度,
        # 回滚全靠这份备份,用 shutil.copy2 会漏掉 -wal 里未落盘的行
        backup = backup_db(db_path, "mastery_backfill")
        n_src, n_bak = assert_backup_complete(db_path, backup, "word_mastery")
        print(f"  已备份 → {backup.name}  (校验 word_mastery {n_src} vs {n_bak})")
        if n_src != n_bak:
            print("  ❌ 备份不完整,中止迁移")
            return 1

    result = backfill(db_path, args.dry_run)
    return 1 if result < 0 else 0


if __name__ == "__main__":
    sys.exit(main())
