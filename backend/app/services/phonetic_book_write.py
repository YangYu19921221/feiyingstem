"""音标教材写库(唯一入口,2026-11-05)

网页导入(api/v1/teacher/phonetic_books.py)、改一节、命令行导入(scripts/import_phonetic_book.py)
都走这里,规矩只有一份:
- **覆盖同名 = 原地改**,不是删了重建: 书 id 不变(挂在下面的音标听力、作业都还在);
  同一个编号的节、同一节里同一个单词的题 id 不变(学生的写音标记录、跟读录音都还对得上)。
  Excel 里没有的节 / 题删掉;学生的作答 / 录音记录一律不删(那是学情)
- **单词改了算新题**(新 id): 原地改的话,学生写 bad 的记录和录音会算到 bed 头上
- 新建的书 / 节 / 题 id 永不复用删掉的(services/phonetic_ids)

调用方负责: 校验(phonetic_tokenize.check_item / check_tts_text)、权限、查同名、提交事务。
"""
from __future__ import annotations

import json
from typing import List, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phonetic_practice import PhoneticBook, PhoneticItem, PhoneticLesson
from app.services.phonetic_ids import IdAllocator
from app.services.phonetic_tokenize import lesson_highlight


def norm_word(w: Optional[str]) -> str:
    """对题用的单词键: 大小写、多余空格、弯撇号都不算不同"""
    return " ".join((w or "").replace("’", "'").split()).lower()


async def items_of(db: AsyncSession, lesson_id: int) -> dict:
    return {it.id: it for it in (await db.execute(
        select(PhoneticItem).where(PhoneticItem.lesson_id == lesson_id))).scalars()}


async def sync_items(db: AsyncSession, ls: PhoneticLesson, rows: List[dict],
                     old: dict, item_ids: IdAllocator) -> List[PhoneticItem]:
    """把 rows 写成这一节的题。rows 每条: word / answer / core / meaning / tts_text,可带 id(要保留的旧题)。

    带 id 且单词没变的原地改;单词变了按新题;不带 id 的新加;old 里没留下的删掉。
    调用方先确认 rows 里的 id 都在 old 里"""
    keep: set[int] = set()
    out = []
    for i, d in enumerate(rows):
        it = old.get(d.get("id")) if d.get("id") is not None else None
        if it is not None and (it.id in keep or norm_word(it.word) != norm_word(d["word"])):
            it = None
        if it is None:
            it = PhoneticItem(id=item_ids.next(), lesson_id=ls.id)
            db.add(it)
        else:
            keep.add(it.id)
        it.word = d["word"]
        it.meaning = d.get("meaning")
        it.answer_json = json.dumps(d["answer"], ensure_ascii=False)
        it.answer_display = f"[{''.join(d['answer'])}]"
        it.core_indexes_json = json.dumps(d["core"])
        it.order_index = i
        it.tts_text = d.get("tts_text")
        out.append(it)
    for iid, it in old.items():
        if iid not in keep:
            await db.delete(it)
    ls.highlight_json = json.dumps(lesson_highlight(rows), ensure_ascii=False)
    return out


async def write_book(db: AsyncSession, *, existing: Optional[PhoneticBook], name: str,
                     volume: Optional[str], description: Optional[str], org_id: Optional[int],
                     created_by: Optional[int], lessons: List[dict]) -> tuple[PhoneticBook, int]:
    """整本写进去 → (书, 题数)。existing 不为空 = 覆盖那一本(原地改)。

    lessons 每条: code / title / items(sync_items 的 rows),可选 removed(「已剔 N 词」,命令行导入用)。
    volume / description 传 None 时覆盖不改原值(网页导入不一定带册次)"""
    lesson_ids = await IdAllocator.for_phonetic_lessons(db)
    item_ids = await IdAllocator.for_phonetic_items(db)
    if existing is not None:
        book = existing
        if volume is not None:
            book.volume = volume or None
        if description is not None:
            book.description = description or None
        old_lessons = {ls.code: ls for ls in (await db.execute(
            select(PhoneticLesson).where(PhoneticLesson.book_id == book.id))).scalars()}
    else:
        book = PhoneticBook(id=(await IdAllocator.for_phonetic_books(db)).next(), name=name,
                            volume=volume or None, description=description or None,
                            org_id=org_id, created_by=created_by)
        db.add(book)
        await db.flush()
        old_lessons = {}

    total = 0
    for n, p in enumerate(lessons, 1):
        ls = old_lessons.pop(p["code"], None)
        old_items: dict = {}
        if ls is None:
            ls = PhoneticLesson(id=lesson_ids.next(), book_id=book.id, code=p["code"], removed_count=0)
            db.add(ls)
        else:
            old_items = await items_of(db, ls.id)
            # 同一个单词对上原来那一题(同一节里同一个词出现两次就按先后对)
            pool: dict[str, list] = {}
            for it in sorted(old_items.values(), key=lambda x: (x.order_index, x.id)):
                pool.setdefault(norm_word(it.word), []).append(it.id)
            for d in p["items"]:
                ids = pool.get(norm_word(d["word"]))
                d["id"] = ids.pop(0) if ids else None
        ls.title = p["title"]
        ls.lesson_number = n
        if "removed" in p:
            ls.removed_count = p["removed"]
        await sync_items(db, ls, p["items"], old_items, item_ids)
        total += len(p["items"])
    for ls in old_lessons.values():
        await db.execute(delete(PhoneticItem).where(PhoneticItem.lesson_id == ls.id))
        await db.delete(ls)
    return book, total
