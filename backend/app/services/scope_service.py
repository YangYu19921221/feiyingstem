"""分配范围（Scope）服务 - 在 Book / Unit / Group 三级粒度间转换"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.word import Word, Unit, UnitWord, BookWord

DEFAULT_GROUP_SIZE = 10


async def get_allowed_unit_ids(
    db: AsyncSession, student_id: int, book_id: int
) -> Optional[set[int]]:
    """学生在某本书下可学的单元白名单(严格模式)。

    返回值语义:
    - None      → 整本可学(存在任一 scope_type='book' 的分配)
    - set()     → 一个单元都不能学(该书没有任何分配)
    - {ids...}  → 只能学这些单元(unit/group 分配 ∪ 作业单元;group 权限放宽到单元级)

    作业自带授权:老师通过「作业管理」布置过的单元,学生必须能进,
    即使该单元不在单词本分配范围内——否则作业流程会被 403 挡死。

    全托机构(access_mode='all_books')补充语义:没有任何分配的书也整本可学
    (返回 None 而不是 set())——该模式按时间+人数付费,不逐本限制。
    但老师**主动做过**单元/分组分配的书仍按白名单走:全托放开的是付费墙,
    不是老师的教学管控(分配即权限的严格模式是刻意保留的收紧工具)。
    """
    from app.models.learning import (  # 局部导入,避免模型/服务层循环依赖
        BookAssignment, HomeworkAssignment, HomeworkStudentAssignment,
    )

    res = await db.execute(
        select(BookAssignment.scope_type, BookAssignment.unit_id).where(
            BookAssignment.student_id == student_id,
            BookAssignment.book_id == book_id,
        )
    )
    rows = res.all()
    allowed: set[int] = set()
    for scope_type, unit_id in rows:
        # 历史数据 scope_type 可能为 NULL,按整本处理(与旧行为一致)
        if scope_type in (None, "book"):
            return None
        if unit_id is not None:
            allowed.add(unit_id)

    # 全托机构 + 这本书老师没做过任何分配 → 整本可学
    if not rows:
        from app.core.tenancy import check_org_all_books
        from app.models.user import User
        org_id = (await db.execute(
            select(User.org_id).where(User.id == student_id)
        )).scalar_one_or_none()
        if org_id and await check_org_all_books(db, org_id):
            return None

    # 并入该书下布置给该学生的作业单元(定时布置未开放的不算——
    # 到开放日之前单元不解锁,否则学生能提前进去把下周的任务学掉)
    from datetime import datetime as _dt
    from sqlalchemy import or_ as _or
    hw_res = await db.execute(
        select(HomeworkAssignment.unit_id)
        .join(HomeworkStudentAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .join(Unit, Unit.id == HomeworkAssignment.unit_id)
        .where(
            HomeworkStudentAssignment.student_id == student_id,
            Unit.book_id == book_id,
            _or(
                HomeworkAssignment.available_from.is_(None),
                HomeworkAssignment.available_from <= _dt.utcnow(),
            ),
        )
    )
    allowed.update(uid for (uid,) in hw_res.all() if uid is not None)
    return allowed


def validate_scope(scope_type: str, unit_id: Optional[int], group_index: Optional[int]) -> None:
    """422 级别的应用层校验"""
    if scope_type not in ("book", "unit", "group"):
        raise ValueError(f"非法 scope_type: {scope_type}")
    if scope_type == "book" and (unit_id is not None or group_index is not None):
        raise ValueError("scope_type=book 时 unit_id 和 group_index 必须为空")
    if scope_type == "unit":
        if unit_id is None:
            raise ValueError("scope_type=unit 时 unit_id 必填")
        if group_index is not None:
            raise ValueError("scope_type=unit 时 group_index 必须为空")
    if scope_type == "group":
        if unit_id is None or group_index is None:
            raise ValueError("scope_type=group 时 unit_id 和 group_index 必填")


async def _get_unit_with_words(db: AsyncSession, unit_id: int) -> tuple[Unit, list[UnitWord]]:
    """加载单元及按 order_index 排序的 unit_words"""
    unit_res = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = unit_res.scalar_one_or_none()
    if unit is None:
        raise ValueError(f"单元不存在: {unit_id}")
    words_res = await db.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_id).order_by(UnitWord.order_index)
    )
    return unit, list(words_res.scalars().all())


async def get_unit_groups(db: AsyncSession, unit_id: int) -> list[dict]:
    """返回 [{index, word_ids, word_count}, ...]"""
    unit, uwords = await _get_unit_with_words(db, unit_id)
    size = unit.group_size or DEFAULT_GROUP_SIZE
    groups: list[dict] = []
    for i in range(0, len(uwords), size):
        chunk = uwords[i:i + size]
        groups.append({
            "index": i // size + 1,
            "word_ids": [w.word_id for w in chunk],
            "word_count": len(chunk),
        })
    return groups


async def get_group_words(db: AsyncSession, unit_id: int, group_index: int) -> list[Word]:
    """按 order_index 切片取出某一组的 Word 实体"""
    if group_index < 1:
        raise ValueError("group_index 必须 >= 1")
    unit, uwords = await _get_unit_with_words(db, unit_id)
    size = unit.group_size or DEFAULT_GROUP_SIZE
    total_groups = (len(uwords) + size - 1) // size
    if group_index > total_groups:
        raise ValueError(f"group_index 超出范围（共 {total_groups} 组）")
    chunk = uwords[(group_index - 1) * size: group_index * size]
    word_ids = [w.word_id for w in chunk]
    res = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    by_id = {w.id: w for w in res.scalars().all()}
    return [by_id[wid] for wid in word_ids if wid in by_id]


async def _get_book_words(db: AsyncSession, book_id: int) -> list[Word]:
    res = await db.execute(
        select(Word).join(BookWord, BookWord.word_id == Word.id)
        .where(BookWord.book_id == book_id).order_by(BookWord.order_index)
    )
    # 单元级隔离后,同一本书的不同单元各有一份同拼写副本,book_words 里会出现
    # 多条同拼写行;book 作用域学习按拼写去重(保留 order_index 最靠前的那条),
    # 避免学生在整本学习时同一个词出现多次。
    seen: set[str] = set()
    deduped: list[Word] = []
    for w in res.scalars().all():
        key = (w.word or "").strip().lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(w)
    return deduped


async def _get_unit_words_full(db: AsyncSession, unit_id: int) -> list[Word]:
    _, uwords = await _get_unit_with_words(db, unit_id)
    word_ids = [w.word_id for w in uwords]
    if not word_ids:
        return []
    res = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    by_id = {w.id: w for w in res.scalars().all()}
    return [by_id[wid] for wid in word_ids if wid in by_id]


async def get_scope_words(
    db: AsyncSession,
    scope_type: str,
    book_id: int,
    unit_id: Optional[int] = None,
    group_index: Optional[int] = None,
) -> list[Word]:
    """统一入口：根据 scope_type 派发"""
    validate_scope(scope_type, unit_id, group_index)
    if scope_type == "book":
        return await _get_book_words(db, book_id)
    if scope_type == "unit":
        return await _get_unit_words_full(db, unit_id)
    return await get_group_words(db, unit_id, group_index)
