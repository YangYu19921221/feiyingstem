"""把出好的分类卡配图配给某几本书里的词(2026-11-06)

用法(生产机先 cd 到 backend,库是相对路径):
    ./venv/bin/python scripts/import_word_art.py <图片目录> --books 335,281 --dry-run
    ./venv/bin/python scripts/import_word_art.py <图片目录> --books 335,281
    ./venv/bin/python scripts/import_word_art.py <图片目录> --books all --dry-run   # 全库

图片目录里要有出图脚本写的 results.json + {slug}.jpg。只认 OCR 核对过的(ok)和退回不带字的(no_text)。
图拷到 UPLOAD_DIR/word-art/,words.image_url 写 /api/v1/files/word-art/{slug}.jpg?v=散列。
已经有别的图(不是配图)的词不覆盖。规则见 app/services/word_art.py。
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.services import word_art  # noqa: E402


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir")
    ap.add_argument("--books", required=True, help="书 id,逗号分隔;all = 全部书")
    ap.add_argument("--dry-run", action="store_true", help="只看会配多少,不拷图不写库")
    args = ap.parse_args()
    async with AsyncSessionLocal() as db:
        if args.books.strip() == "all":
            book_ids = await word_art.all_book_ids(db)
        else:
            book_ids = [int(x) for x in args.books.split(",") if x.strip()]
        rep = await word_art.import_from_dir(
            db, args.src_dir, book_ids, settings.UPLOAD_DIR, dry_run=args.dry_run,
        )
    tag = "(只看,没写)" if args.dry_run else ""
    label = f"全部 {len(book_ids)} 本书" if args.books.strip() == "all" else f"书 {book_ids}"
    print(f"{label}: 有图可配 {rep.matched} 个词条,这次写 {rep.filled} 个{tag},"
          f"本来就是这张 {rep.unchanged} 个,已有别的图不动 {rep.kept_other} 个,拷图 {rep.copied} 张")
    if rep.unmatched_words:
        print(f"书里没图的词 {len(rep.unmatched_words)} 个: {', '.join(rep.unmatched_words[:40])}")
    if rep.meaning_mismatch:
        print(f"同拼写但意思不一样、没配 {len(rep.meaning_mismatch)} 条: {' | '.join(rep.meaning_mismatch[:15])}")
    if rep.unused_images:
        print(f"有图但书里没这个词 {len(rep.unused_images)} 张: {', '.join(rep.unused_images[:40])}")


if __name__ == "__main__":
    asyncio.run(main())
