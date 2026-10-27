"""给已经画好的单词记忆图重新印字(10-27: 图下面印单词 / 音标 / 中文)。不重画、不花钱。

用法(在 backend 目录): venv/bin/python scripts/recompose_word_pictures.py [--dry-run]
- 有原画({名字}_art.jpg)的用原画;印字之前画的老图(768 见方、没有原画)就把老图当原画
- 已经是 768×960 成图又找不到原画的跳过(不在印过字的图上再印一遍)
"""
import asyncio
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.tutor import WordPicture  # noqa: E402
from app.services import word_picture as wp  # noqa: E402


async def main(dry: bool) -> None:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(WordPicture).where(WordPicture.status == "ready"))).scalars().all()
        for p in rows:
            name = os.path.basename((p.url or "")[len(wp.URL_PREFIX):].split("?")[0])
            card = os.path.join(wp._pic_dir(), name)
            art = wp.art_path(p.url)
            if art and os.path.exists(art):
                src = art
            elif os.path.exists(card) and Image.open(card).size[0] == Image.open(card).size[1]:
                src = card
            else:
                print(f"跳过 {p.id} {p.word}: 找不到原画")
                continue
            print(f"{'(试跑) ' if dry else ''}{p.id} {p.word} ← {os.path.basename(src)}")
            if dry:
                continue
            raw = open(src, "rb").read()
            old = p.url
            p.url = await wp.save_card(db, p.id, p.word, p.meaning, raw)
            await db.commit()
            if old and old != p.url:
                wp._remove_file(old)
            print(f"   → {p.url}")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
