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
        select(
            BookAssignment.scope_type, BookAssignment.unit_id,
            BookAssignment.grant_type, BookAssignment.expires_at,
            BookAssignment.times_left, BookAssignment.last_consumed_date,
        ).where(
            BookAssignment.student_id == student_id,
            BookAssignment.book_id == book_id,
        )
    )
    # 兑换卡授权(次卡/包月)过期或用尽后不再算授权。这里是「学生能学什么」的唯一
    # 闸门,过滤收在这一处,单元解锁/作业/任务分母全都跟着生效。
    # 老师直接分配的行 grant_type 为 NULL,恒判活,旧行为零影响。
    from app.services.subscription_service import is_assignment_active
    from app.core.timeutil import local_today
    _today = local_today().isoformat()

    class _A:  # 轻量壳:只为复用 is_assignment_active 的口径,避免两处判活漂移
        __slots__ = ("grant_type", "expires_at", "times_left", "last_consumed_date")

        def __init__(self, gt, ea, tl, lcd):
            self.grant_type, self.expires_at, self.times_left, self.last_consumed_date = gt, ea, tl, lcd

    # 新政策机构的卡包书: 只认兑换码开出来的行(grant_type 非空),老师直接分配的不算,
    # 作业也不开书 —— 否则老师分配/布置作业就能绕开卡包(见 card_pack.gated_book_ids)
    from app.services.card_pack import is_gated_for_student, is_exclusive_locked
    if await is_exclusive_locked(db, student_id, book_id):
        return set()  # 飞鹰专属内容没开通: 谁分配的都不算
    gated = await is_gated_for_student(db, student_id, book_id)
    rows = [
        (scope_type, unit_id)
        for scope_type, unit_id, gt, ea, tl, lcd in res.all()
        if is_assignment_active(_A(gt, ea, tl, lcd), _today) and (not gated or gt is not None)
    ]
    allowed: set[int] = set()
    for scope_type, unit_id in rows:
        # 历史数据 scope_type 可能为 NULL,按整本处理(与旧行为一致)
        if scope_type in (None, "book"):
            return None
        if unit_id is not None:
            allowed.add(unit_id)

    if gated:
        return allowed

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
    # 「只能从作业进入」的作业不并入:它的授权只在请求带 assignment_id 时生效
    # (见 homework_grants_unit),否则学生从书本里就能自学到它。
    from datetime import datetime as _dt
    from sqlalchemy import or_ as _or
    hw_res = await db.execute(
        select(HomeworkAssignment.unit_id)
        .join(HomeworkStudentAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .join(Unit, Unit.id == HomeworkAssignment.unit_id)
        .where(
            HomeworkStudentAssignment.student_id == student_id,
            Unit.book_id == book_id,
            HomeworkAssignment.entry_mode != "homework_only",
            _or(
                HomeworkAssignment.available_from.is_(None),
                HomeworkAssignment.available_from <= _dt.utcnow(),
            ),
        )
    )
    allowed.update(uid for (uid,) in hw_res.all() if uid is not None)
    return allowed


async def homework_grants_unit(
    db: AsyncSession, student_id: int, assignment_id: Optional[int], unit_id: int
) -> bool:
    """从作业入口进来时,这份作业是否授权学生进这个单元。

    assignment_id 是 homework_student_assignments.id(前端 location.state.assignmentId)。
    四个条件缺一不可: 是发给本人的 / 单元对得上 / 已开放 / 没被关闭。
    不看 entry_mode —— open 作业的单元本来就在白名单里,这里放行也是同一结论。
    """
    if not assignment_id:
        return False
    from datetime import datetime as _dt
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    row = (await db.execute(
        select(HomeworkAssignment.unit_id, HomeworkAssignment.available_from, HomeworkAssignment.is_closed)
        .join(HomeworkStudentAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            HomeworkStudentAssignment.id == assignment_id,
            HomeworkStudentAssignment.student_id == student_id,
        )
    )).one_or_none()
    if row is None:
        return False
    hw_unit_id, available_from, is_closed = row
    if hw_unit_id != unit_id or is_closed:
        return False
    return available_from is None or available_from <= _dt.utcnow()


async def can_enter_unit(
    db: AsyncSession, student_id: int, book_id: int, unit_id: int,
    assignment_id: Optional[int] = None,
) -> bool:
    """学生能否进这个单元: 白名单(书本分配 ∪ 普通作业)或带着授权它的作业进来。
    取词/出题/考试几个端点共用这一份判定,别各写一套。"""
    allowed = await get_allowed_unit_ids(db, student_id, book_id)
    if allowed is None or unit_id in allowed:
        return True
    # 新政策卡包书: 从作业入口进也不放行(否则「只能从作业进入」的作业就是绕开卡包的后门)
    from app.services.card_pack import is_gated_for_student, is_exclusive_locked
    if await is_gated_for_student(db, student_id, book_id) or \
            await is_exclusive_locked(db, student_id, book_id):
        return False
    return await homework_grants_unit(db, student_id, assignment_id, unit_id)


async def homework_only_unit_ids(
    db: AsyncSession, student_id: int, book_id: Optional[int] = None,
    unit_id: Optional[int] = None,
) -> set[int]:
    """发给该生、已开放、未关闭的「只能从作业进入」作业所在的单元 —— 用于给被拒的学生
    说清原因(「要从作业里进」而不是「还没分配给你」,后者会让孩子以为老师漏布置了)。"""
    from datetime import datetime as _dt
    from sqlalchemy import or_ as _or
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    q = (
        select(HomeworkAssignment.unit_id)
        .join(HomeworkStudentAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            HomeworkStudentAssignment.student_id == student_id,
            HomeworkAssignment.entry_mode == "homework_only",
            HomeworkAssignment.is_closed.is_(False),
            _or(
                HomeworkAssignment.available_from.is_(None),
                HomeworkAssignment.available_from <= _dt.utcnow(),
            ),
        )
    )
    if book_id is not None:
        q = q.join(Unit, Unit.id == HomeworkAssignment.unit_id).where(Unit.book_id == book_id)
    if unit_id is not None:
        q = q.where(HomeworkAssignment.unit_id == unit_id)
    return {uid for (uid,) in (await db.execute(q)).all() if uid is not None}


async def is_homework_only_unit(db: AsyncSession, student_id: int, unit_id: int) -> bool:
    return bool(await homework_only_unit_ids(db, student_id, unit_id=unit_id))


HOMEWORK_ONLY_DENY_MSG = "这个单元要从作业里进入:回首页点「我的作业」开始"
NOT_ASSIGNED_MSG = "这个单元还没有分配给你,请联系老师"


async def deny_message(db: AsyncSession, student_id: int, unit_id: int) -> str:
    from app.services.card_pack import (is_gated_for_student, is_exclusive_locked,
                                        PACK_CARD_REQUIRED_MSG, EXCLUSIVE_REQUIRED_MSG)
    book_id = (await db.execute(select(Unit.book_id).where(Unit.id == unit_id))).scalar_one_or_none()
    if book_id is not None and await is_exclusive_locked(db, student_id, book_id):
        return EXCLUSIVE_REQUIRED_MSG
    if book_id is not None and await is_gated_for_student(db, student_id, book_id):
        return PACK_CARD_REQUIRED_MSG
    if await is_homework_only_unit(db, student_id, unit_id):
        return HOMEWORK_ONLY_DENY_MSG
    return NOT_ASSIGNED_MSG


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


async def get_group_word_ids(db: AsyncSession, unit_id: int, group_index: int) -> list[int]:
    """某一组的 word_id 列表(按 order_index)。组号 1 基,越界抛 ValueError。
    与 get_unit_groups 同一份切法 —— 作业按组布置时,学生端取词必须走这里,
    否则老师选的「第2组」到学生那边会变成整单元。"""
    groups = await get_unit_groups(db, unit_id)
    if group_index < 1 or group_index > len(groups):
        raise ValueError(f"组序号 {group_index} 超出范围（单元共 {len(groups)} 组）")
    return groups[group_index - 1]["word_ids"]


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
