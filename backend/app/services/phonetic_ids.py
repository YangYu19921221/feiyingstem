"""音标教材 / 音标听力新建行的 id —— 永远不复用删掉的 id(2026-11-05)

这几张表的主键是 `INTEGER PRIMARY KEY`,**不带 AUTOINCREMENT**: SQLite 发新 id 用的是「现在最大的 id + 1」。
删掉最大的那几行再新建,新行就拿到被删行的 id —— 而学生的写音标记录、跟读录音、作业还按 id 指着旧行,
于是旧记录算到了另一道题头上(报告里出现「这个词你第一遍写错了」,其实写错的是另一个词)。
音标视频 2026-09 就因此让新视频继承了旧视频的观看记录(CLAUDE.md 有记)。

做法: 新建时自己给 id = max(表里现有的, 所有引用它的地方) + 1。引用全部扫一遍,
就算行删光了,只要还有记录指着某个 id,这个 id 就不会再发出去。

⚠️ 两个人同一秒都在新建会算出同一个 id → 撞主键报错(不会写错数据)。老师后台编辑这种低频操作可以接受。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _max(db: AsyncSession, col, *where) -> int:
    q = select(func.max(col))
    for w in where:
        q = q.where(w)
    # 必须跨机构取最大值: 按机构过滤后的最大值会小于全表,照样复用别家的 id
    return (await db.execute(q.execution_options(skip_tenant_filter=True))).scalar() or 0


class IdAllocator:
    """一次请求里连续发 id。用法: ids = await IdAllocator.for_items(db); it.id = ids.next()"""

    def __init__(self, floor: int):
        self._n = floor

    def next(self) -> int:
        self._n += 1
        return self._n

    @classmethod
    async def for_phonetic_books(cls, db: AsyncSession) -> "IdAllocator":
        # 听力套按 book_id 挂在教材下: 书删了套还在(停用),新书接手旧 id 就会冒出别人的听力
        from app.models.phonetic_listening import ListeningSet
        from app.models.phonetic_practice import PhoneticBook, PhoneticLesson
        floor = max(await _max(db, PhoneticBook.id), await _max(db, PhoneticLesson.book_id),
                    await _max(db, ListeningSet.book_id))
        return cls(floor)

    @classmethod
    async def for_phonetic_items(cls, db: AsyncSession) -> "IdAllocator":
        from app.models.phonetic_practice import PhoneticAttempt, PhoneticItem, PhoneticReading
        floor = max(await _max(db, PhoneticItem.id), await _max(db, PhoneticAttempt.item_id),
                    await _max(db, PhoneticReading.item_id))
        return cls(floor)

    @classmethod
    async def for_phonetic_lessons(cls, db: AsyncSession) -> "IdAllocator":
        from app.models.content_homework import ContentHomework, KIND_PHONETIC_READ, KIND_PHONETIC_WRITE
        from app.models.phonetic_practice import PhoneticAttempt, PhoneticLesson, PhoneticReading
        floor = max(await _max(db, PhoneticLesson.id), await _max(db, PhoneticAttempt.lesson_id),
                    await _max(db, PhoneticReading.lesson_id),
                    await _max(db, ContentHomework.target_id,
                               ContentHomework.kind.in_((KIND_PHONETIC_WRITE, KIND_PHONETIC_READ))))
        return cls(floor)
