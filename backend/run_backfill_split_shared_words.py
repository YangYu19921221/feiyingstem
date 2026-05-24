"""把跨 word_book 共享的 Word 行按 book 拆分成独立副本。

- 同一 book 内多个 unit 仍共享同一 Word 行（产品意图：删一处不再加一遍）。
- 跨 book 必拆，保证教师在 A 本编辑不会改到 B 本里看到的同名单词。
- 第一个 book 沿用原 word_id；其余 book 各自得到一份新的 Word + WordDefinition + WordTag 副本。
- learning_records / user_word_progress 等学习记录不动，留在原 word_id 上。

用法：
    python3 run_backfill_split_shared_words.py            # dry-run，事务回滚
    python3 run_backfill_split_shared_words.py --apply    # 真正提交，提交前会自动备份
"""
import datetime
import shutil
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).parent / "english_helper.db"


def fetch_columns_then_rows(cur):
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    return cols, rows


def run(apply: bool):
    if not DB.exists():
        print(f"❌ 数据库不存在: {DB}")
        sys.exit(1)

    if apply:
        bak = DB.with_name(
            f"english_helper.db.bak_pre_backfill_{datetime.datetime.now():%Y%m%d_%H%M%S}"
        )
        shutil.copy(DB, bak)
        print(f"📦 备份: {bak}")

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    cur.execute(
        """
        WITH refs AS (
            SELECT word_id, book_id FROM book_words
            UNION
            SELECT uw.word_id, u.book_id
            FROM unit_words uw JOIN units u ON u.id = uw.unit_id
        )
        SELECT word_id, GROUP_CONCAT(book_id ORDER BY book_id) AS books
        FROM refs
        GROUP BY word_id
        HAVING COUNT(DISTINCT book_id) > 1
        ORDER BY word_id;
        """
    )
    shared = cur.fetchall()
    print(f"📊 跨 book 共享的 word 数量: {len(shared)}")

    stats = dict(new_word=0, new_def=0, new_tag=0, uw_repoint=0, bw_repoint=0)

    try:
        cur.execute("BEGIN;")
        for word_id, books_csv in shared:
            books = sorted({int(b) for b in books_csv.split(",")})
            _keep, *clone_books = books

            cur.execute("SELECT * FROM words WHERE id=?", (word_id,))
            w_cols, w_rows = fetch_columns_then_rows(cur)
            if not w_rows:
                continue
            orig = dict(zip(w_cols, w_rows[0]))

            cur.execute(
                "SELECT * FROM word_definitions WHERE word_id=?", (word_id,)
            )
            d_cols, defs = fetch_columns_then_rows(cur)

            cur.execute("SELECT * FROM word_tags WHERE word_id=?", (word_id,))
            t_cols, tags = fetch_columns_then_rows(cur)

            ins_w_cols = [c for c in w_cols if c != "id"]
            ins_d_cols = [c for c in d_cols if c != "id"]
            ins_t_cols = [c for c in t_cols if c != "id"]
            w_ph = ",".join("?" for _ in ins_w_cols)
            d_ph = ",".join("?" for _ in ins_d_cols)
            t_ph = ",".join("?" for _ in ins_t_cols)

            for book_id in clone_books:
                cur.execute(
                    f"INSERT INTO words ({','.join(ins_w_cols)}) VALUES ({w_ph})",
                    [orig[c] for c in ins_w_cols],
                )
                new_id = cur.lastrowid
                stats["new_word"] += 1

                for d in defs:
                    d_dict = dict(zip(d_cols, d))
                    d_dict["word_id"] = new_id
                    cur.execute(
                        f"INSERT INTO word_definitions ({','.join(ins_d_cols)}) "
                        f"VALUES ({d_ph})",
                        [d_dict[c] for c in ins_d_cols],
                    )
                    stats["new_def"] += 1

                for t in tags:
                    t_dict = dict(zip(t_cols, t))
                    t_dict["word_id"] = new_id
                    cur.execute(
                        f"INSERT INTO word_tags ({','.join(ins_t_cols)}) "
                        f"VALUES ({t_ph})",
                        [t_dict[c] for c in ins_t_cols],
                    )
                    stats["new_tag"] += 1

                cur.execute(
                    """
                    UPDATE unit_words
                    SET word_id = ?
                    WHERE word_id = ?
                      AND unit_id IN (SELECT id FROM units WHERE book_id = ?);
                    """,
                    (new_id, word_id, book_id),
                )
                stats["uw_repoint"] += cur.rowcount

                cur.execute(
                    """
                    UPDATE book_words
                    SET word_id = ?
                    WHERE word_id = ? AND book_id = ?;
                    """,
                    (new_id, word_id, book_id),
                )
                stats["bw_repoint"] += cur.rowcount

        if apply:
            conn.commit()
            print("✅ 已提交")
        else:
            conn.rollback()
            print("🔁 dry-run 已回滚（未写入）")

        for k, v in stats.items():
            print(f"  {k}: {v}")
    except Exception as exc:
        conn.rollback()
        print(f"❌ 失败: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run(apply="--apply" in sys.argv)
