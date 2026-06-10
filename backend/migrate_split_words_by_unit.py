#!/usr/bin/env python3
"""
把"被多个单元共享的同一条 Word"拆分成"每个单元一份独立副本",实现单元级隔离。

规则:
- 对每个被 >1 个 unit 引用的 word_id:
  - 第一个 unit(按 unit_id 升序)沿用原 Word 行,不动
  - 其余每个 unit 各 clone 一份新 Word(+ definitions + tags),
    把该 unit 的 unit_words.word_id 改指新副本
  - 复制学生学习进度 word_mastery(原 word_id 的所有学生记录 → 新副本),
    避免进度清零
  - 维护 book_words:确保新副本在其所属 book 下有 BookWord 关联
- 学习记录类表(learning_records 等)保留在原 word_id 不动(历史统计),
  仅 word_mastery(掌握度/SRS)做复制,保证学生看到的进度连续

幂等:脚本只处理"当前仍被多 unit 共享"的 word,重复跑不会重复拆分
(因为拆分后每个 word 只剩 1 个 unit 引用)。

用法:
  python3 migrate_split_words_by_unit.py <db_path> [--apply]
  不带 --apply 为 dry-run,只打印将要做的事,不写库。
"""
import sqlite3
import sys

WORD_COLS = [
    "word", "phonetic", "syllables", "tts_text", "difficulty",
    "grade_level", "audio_url", "image_url", "created_by",
]
MASTERY_COLS = [
    "total_encounters", "correct_count", "wrong_count", "mastery_level",
    "flashcard_correct", "flashcard_wrong", "quiz_correct", "quiz_wrong",
    "spelling_correct", "spelling_wrong", "fillblank_correct", "fillblank_wrong",
    "last_practiced_at", "next_review_at", "review_stage",
]


def clone_word(cur, src_word_id):
    """clone 一条 Word + definitions + tags,返回新 word_id。"""
    row = cur.execute(
        f"SELECT {', '.join(WORD_COLS)} FROM words WHERE id=?", (src_word_id,)
    ).fetchone()
    placeholders = ", ".join(["?"] * len(WORD_COLS))
    cur.execute(
        f"INSERT INTO words ({', '.join(WORD_COLS)}) VALUES ({placeholders})",
        tuple(row),
    )
    new_id = cur.lastrowid

    defs = cur.execute(
        "SELECT part_of_speech, meaning, example_sentence, example_translation, is_primary "
        "FROM word_definitions WHERE word_id=?", (src_word_id,)
    ).fetchall()
    for d in defs:
        cur.execute(
            "INSERT INTO word_definitions (word_id, part_of_speech, meaning, "
            "example_sentence, example_translation, is_primary) VALUES (?,?,?,?,?,?)",
            (new_id, *d),
        )

    tags = cur.execute(
        "SELECT tag FROM word_tags WHERE word_id=?", (src_word_id,)
    ).fetchall()
    for t in tags:
        cur.execute(
            "INSERT INTO word_tags (word_id, tag) VALUES (?, ?)", (new_id, t[0])
        )
    return new_id


def copy_mastery(cur, src_word_id, dst_word_id):
    """把原词的所有学生掌握度复制到新副本(新副本此前无记录)。"""
    rows = cur.execute(
        f"SELECT user_id, {', '.join(MASTERY_COLS)} FROM word_mastery WHERE word_id=?",
        (src_word_id,),
    ).fetchall()
    n = 0
    for r in rows:
        user_id = r[0]
        # 新副本理论上无记录,UNIQUE(user_id,word_id) 兜底用 OR IGNORE
        cur.execute(
            f"INSERT OR IGNORE INTO word_mastery (user_id, word_id, {', '.join(MASTERY_COLS)}) "
            f"VALUES (?, ?, {', '.join(['?'] * len(MASTERY_COLS))})",
            (user_id, dst_word_id, *r[1:]),
        )
        n += cur.rowcount
    return n


def ensure_book_word(cur, book_id, word_id):
    """确保 (book_id, word_id) 有 BookWord 关联(没有则补)。"""
    if book_id is None:
        return
    exists = cur.execute(
        "SELECT 1 FROM book_words WHERE book_id=? AND word_id=? LIMIT 1",
        (book_id, word_id),
    ).fetchone()
    if not exists:
        cur.execute(
            "INSERT INTO book_words (book_id, word_id, order_index) VALUES (?,?,0)",
            (book_id, word_id),
        )


def main():
    if len(sys.argv) < 2:
        print("用法: python3 migrate_split_words_by_unit.py <db_path> [--apply]")
        sys.exit(1)
    db_path = sys.argv[1]
    apply = "--apply" in sys.argv

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 找被多个 unit 引用的 word
    shared = cur.execute(
        "SELECT word_id, COUNT(DISTINCT unit_id) c FROM unit_words "
        "GROUP BY word_id HAVING c > 1 ORDER BY word_id"
    ).fetchall()

    print(f"被多单元共享的 word 数: {len(shared)}")
    total_clones = 0
    total_mastery = 0

    for word_id, unit_count in shared:
        # 该 word 涉及的 unit(按 unit_id 升序),第一个留原 word。
        # JOIN units 过滤掉指向已删除单元的孤儿 unit_words。
        uw_rows = cur.execute(
            "SELECT uw.id, uw.unit_id, u.book_id "
            "FROM unit_words uw JOIN units u ON u.id = uw.unit_id "
            "WHERE uw.word_id=? ORDER BY uw.unit_id", (word_id,)
        ).fetchall()
        # 有效单元 <=1 则无需拆分(共享数是被孤儿记录撑大的)
        if len(uw_rows) <= 1:
            continue
        keep_unit = uw_rows[0][1]
        rest = uw_rows[1:]
        for uw_id, unit_id, book_id in rest:
            if apply:
                new_word_id = clone_word(cur, word_id)
                cur.execute(
                    "UPDATE unit_words SET word_id=? WHERE id=?", (new_word_id, uw_id)
                )
                m = copy_mastery(cur, word_id, new_word_id)
                ensure_book_word(cur, book_id, new_word_id)
                total_mastery += m
            total_clones += 1

    print(f"将 clone 新副本数: {total_clones}")
    if apply:
        print(f"复制掌握度记录数: {total_mastery}")
        conn.commit()
        print("已提交 (--apply)")
    else:
        print("DRY-RUN,未写库。加 --apply 实际执行。")
    conn.close()


if __name__ == "__main__":
    main()
