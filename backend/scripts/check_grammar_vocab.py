"""核对语法小课(句子积木)里的英文词,是不是都在课本的词表里

规划里的硬规矩: 例句只用课本学过的词 —— 孩子的脑子只对付语法这一件事,不能再被生词绊住。
第一条线(app/grammar/lessons_present.py)写的是「只用三四年级课本里的词」,这个脚本对着词库查。

用法(在 backend 目录里跑,只读数据库):
    ./venv/bin/python scripts/check_grammar_vocab.py                    # 默认对人教版三、四年级(按书名找)
    ./venv/bin/python scripts/check_grammar_vocab.py --books 19,20,21,22  # 指定书的 id
    ./venv/bin/python scripts/check_grammar_vocab.py --db /path/to/x.db   # 换一个库(默认 backend/english_helper.db)
    ./venv/bin/python scripts/check_grammar_vocab.py --strict             # 有课本外的词就退出码 1

怎么算「在课本里」:
- 课本词条按空格拆成单个词(短语 "play football" 算 play 和 football 都学过)
- 课里的词先原样找,找不到再按原形找: 动作词带尾巴的(likes → like,blocks.S_FORMS)、
  名词复数(cats → cat、boxes → box)
- 语法小课本身要教的那几个词不算生词(am is are / do does / not 和它们的缩写、I you he she it we they、
  a an the、my your、yes no、and): 课本词表按单元收「新词」,这些词常常不单独列
- 人名(课里的 Amy Mike 这些)不算
结果按课列出课本外的词。**它只查词,不查这个词是在哪个单元学的** —— 按单元对进度要等人教版对照表做出来。
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.grammar import blocks as B  # noqa: E402
from app.grammar import course as C  # noqa: E402
from app.services.grammar_course import LESSONS  # noqa: E402

# 小课自己要教的词 + 最基础的小词: 课本词表里常常不单独列
TAUGHT = {
    "am", "is", "are", "isn't", "aren't", "do", "does", "don't", "doesn't", "not",
    "i", "you", "he", "she", "it", "we", "they",
    "a", "an", "the", "my", "your", "yes", "no", "and", "to", "at",
}
NAMES = {"amy", "mike", "sarah", "john", "tom", "lily"}
DEFAULT_BOOK_PATTERNS = ("%人教版三年级%", "%人教版四年级%")


def book_words(db: sqlite3.Connection, book_ids: list[int]) -> set[str]:
    marks = ",".join("?" * len(book_ids))
    rows = db.execute(
        f"SELECT DISTINCT w.word FROM words w JOIN unit_words uw ON uw.word_id = w.id "
        f"JOIN units u ON u.id = uw.unit_id WHERE u.book_id IN ({marks})", book_ids).fetchall()
    out: set[str] = set()
    for (word,) in rows:
        for part in re.split(r"[\s/,()…]+", (word or "").lower()):
            part = part.strip(".?!'\"")
            if part:
                out.add(part)
    return out


def base_forms(word: str) -> list[str]:
    """这个词可能的原形(先自己,再去尾巴)"""
    out = [word]
    if word in B.S_FORMS:
        out.append(B.S_FORMS[word])
    if word.endswith("ies") and len(word) > 4:
        out.append(word[:-3] + "y")
    if word.endswith("es") and len(word) > 3:
        out.append(word[:-2])
    if word.endswith("s") and len(word) > 2:
        out.append(word[:-1])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(BACKEND / "english_helper.db"))
    ap.add_argument("--books", default="", help="书的 id,逗号分隔;不写就按书名找人教版三、四年级")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    if args.books:
        ids = [int(x) for x in args.books.split(",") if x.strip()]
    else:
        ids = [r[0] for pat in DEFAULT_BOOK_PATTERNS
               for r in db.execute("SELECT id FROM word_books WHERE name LIKE ?", (pat,)).fetchall()]
    if not ids:
        raise SystemExit("没找到课本。用 --books 指定书的 id")
    names = db.execute(f"SELECT id, name FROM word_books WHERE id IN ({','.join('?' * len(ids))}) ORDER BY id", ids).fetchall()
    known = book_words(db, ids)
    print("对着这几本书查: " + "、".join(f"{n}(id {i})" for i, n in names))
    print(f"课本词表(拆成单个词): {len(known)} 个\n")

    total_out: set[str] = set()
    for lid, ls in sorted(LESSONS.items()):
        words = C.words(ls)
        outside = sorted(w for w in words
                         if w not in TAUGHT and w not in NAMES and not any(f in known for f in base_forms(w)))
        total_out |= set(outside)
        mark = "✓" if not outside else "✗"
        print(f"{mark} {lid} {ls['name']}: 用了 {len(words)} 个词" + (f",课本外的 {len(outside)} 个: {'、'.join(outside)}" if outside else ""))
    print(f"\n课本外的词一共 {len(total_out)} 个" + (": " + "、".join(sorted(total_out)) if total_out else ""))
    return 1 if (args.strict and total_out) else 0


if __name__ == "__main__":
    raise SystemExit(main())
