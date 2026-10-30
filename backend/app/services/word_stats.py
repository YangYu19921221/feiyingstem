"""管理端 / 教师端「词汇总量」「单元数」的唯一口径(2026-10-30)。

以前直接数 words / units 整张表: 删书、删单元只删书和关联,词条和单元行不删(生产外键是关的,
删书时它的单元也留着),所以数字只涨不跌 —— 10-30 生产 words 表 144,970 行,还在某本书里的只有 91,420 条;
units 表 2,483 行,其中 850 个属于已删除的书。

现在只数**还在的书**里的:
- 词条: 还在的书的单元里的词 + 书上直接挂的词(book_words),按词条 id 去重。各书各有一份词条
  (导入时每本书新建、改词时 fork),同一个 apple 在 5 本书里算 5 条 —— 删一本书,数字就少这本书的词
- 不同单词: 上面这些按拼写(小写、去首尾空格)去重
- 单元: 书还在的单元
不删词条行: 学生的学习记录、掌握度还指着它们(10-30 生产 3,206 个书已删的词还被 word_mastery 用着)。
WordBook 是租户锚点(平台书 + 本机构),机构管理员 / 老师查到的就是自己看得到的书里的
"""
from __future__ import annotations

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.word import BookWord, Unit, UnitWord, Word, WordBook


def _live_word_ids():
    in_units = (select(UnitWord.word_id.label("word_id"))
                .join(Unit, Unit.id == UnitWord.unit_id)
                .join(WordBook, WordBook.id == Unit.book_id))
    on_books = (select(BookWord.word_id.label("word_id"))
                .join(WordBook, WordBook.id == BookWord.book_id))
    return union_all(in_units, on_books).subquery()


async def word_counts(db: AsyncSession) -> dict:
    ids = _live_word_ids()
    entries = (await db.execute(select(func.count(func.distinct(ids.c.word_id))))).scalar() or 0
    distinct = (await db.execute(
        select(func.count(func.distinct(func.lower(func.trim(Word.word)))))
        .where(Word.id.in_(select(ids.c.word_id)))
    )).scalar() or 0
    return {"total_words": int(entries), "distinct_words": int(distinct)}


async def unit_count(db: AsyncSession) -> int:
    return int((await db.execute(
        select(func.count(Unit.id)).join(WordBook, WordBook.id == Unit.book_id)
    )).scalar() or 0)
