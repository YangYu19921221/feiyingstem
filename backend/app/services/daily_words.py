"""「某天/某时段学了多少单词」的全站唯一口径。

背景(2026-07-27 修):同一个学生同一天,在教师端班级表、教师端学生详情、家长端、
学生端图表里能看到**四个不同的数字**,因为代码里存在四种"学了一个词"的定义:

1. `distinct(lower(word))` + 排除 classify  ← 唯一正确的口径(本模块)
2. `distinct(word_id)`(不排除 classify)     ← 同一拼写在不同单元有多个 word_id,虚高
3. `distinct(word_id)` + 必须答对             ← 又一套,家长端周报在用
4. `StudyCalendar.words_learned` 字段         ← **跨批次累加**,一天练三轮加三遍

为什么按拼写去重而不是 word_id:单元级隔离时同一个词在每本书/每单元都有独立
word_id(见 migrate_split_words_by_unit),按 word_id 数会把"apple"数成好几个。

为什么排除 classify:分类识别只是学生自评"熟/生",没有真的作答;而且一个词在
分类循环里会被反复标记多次(实测 70 词产生 1260 条记录)。

⚠️ 任何"学了多少词"的展示都必须调这里,不要再手写聚合 —— 手写副本的形状
一定会漂,这个模块存在的原因就是它已经漂过四次。
"""
from datetime import date, datetime
from typing import Iterable, Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range
from app.models.learning import LearningRecord
from app.models.word import Word
from app.services.weak_words import NON_LEARNED_MODES


def _base_conditions(user_ids: list[int], start: datetime, end: datetime):
    return [
        LearningRecord.user_id.in_(user_ids),
        LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
        LearningRecord.created_at >= start,
        LearningRecord.created_at < end,
    ]


async def words_by_student(
    db: AsyncSession,
    user_ids: Iterable[int],
    start: datetime,
    end: datetime,
) -> dict[int, int]:
    """一段时间内每个学生的去重学词数 → {user_id: 词数}。

    用于「一天 × 多个学生」(班级日报、大屏排行、金币单词王)。
    查不到记录的学生不会出现在返回里,调用方用 .get(uid, 0) 兜底。
    """
    uids = list(user_ids)
    if not uids:
        return {}
    rows = (await db.execute(
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))).label("cnt"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(*_base_conditions(uids, start, end)))
        .group_by(LearningRecord.user_id)
    )).all()
    return {r.user_id: (r.cnt or 0) for r in rows}


async def words_total(
    db: AsyncSession,
    user_ids: Iterable[int],
    start: datetime,
    end: datetime,
) -> int:
    """一段时间内的去重学词数合计(单个学生传 [uid] 即可)。

    ⚠️ 多学生时这是「全体合并去重」的结果,不是各人之和 ——
    要各人之和请用 words_by_student() 再自行求和。
    """
    uids = list(user_ids)
    if not uids:
        return 0
    return int((await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(LearningRecord)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(*_base_conditions(uids, start, end)))
    )).scalar() or 0)


async def words_on_day(db: AsyncSession, user_id: int, d: date) -> int:
    """某学生某个北京日历日的去重学词数。"""
    start, end = local_day_utc_range(d)
    return await words_total(db, [user_id], start, end)


async def words_sum_rows(
    db: AsyncSession,
    allowed,
    start_day: date,
    end_day: date,
) -> list[tuple[int, int]]:
    """区间内每个学生的「各天去重词数之和」,按词数降序 → [(user_id, 词数)]。

    口径:**当天重复的词只算一次,跨天可以再算**(用户 2026-07-27 明确的规则)。
    所以是"逐天去重再相加",不是"整个区间去重" —— 后者表达的是"见过多少不同的词",
    会让连续一周复习同一批词的学生显示成只学了一批,抹掉复习的工作量。

    allowed 支持三种形态:None=不限学生、id 集合/列表、SQL 子查询。
    子查询形态给"全机构榜"用 —— 不把整机构 id 物化到 Python 再 IN 回去,
    否则机构大了会撞 SQLite 绑定参数上限。

    用一条 group by (学生, 天) 的 SQL 算完,不要在调用方按学生×天循环发 SQL。
    """
    start, _ = local_day_utc_range(start_day)
    _, end = local_day_utc_range(end_day)
    local_day = func.date(LearningRecord.created_at, "+8 hours")

    conds = [
        LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
        LearningRecord.created_at >= start,
        LearningRecord.created_at < end,
    ]
    if allowed is not None:
        conds.append(LearningRecord.user_id.in_(allowed))

    per_day = (
        select(
            LearningRecord.user_id.label("uid"),
            local_day.label("d"),
            func.count(func.distinct(func.lower(Word.word))).label("cnt"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(*conds))
        .group_by(LearningRecord.user_id, local_day)
        .subquery()
    )
    total = func.sum(per_day.c.cnt)
    rows = (await db.execute(
        select(per_day.c.uid, total.label("total"))
        .group_by(per_day.c.uid)
        .order_by(total.desc())
    )).all()
    return [(r.uid, int(r.total or 0)) for r in rows]


async def words_sum_by_student(
    db: AsyncSession,
    user_ids: Iterable[int],
    start_day: date,
    end_day: date,
) -> dict[int, int]:
    """区间内每个学生的「各天去重词数之和」→ {user_id: 词数}。含首尾两天。

    口径同 words_sum_rows(逐天去重再相加),这里只是把结果转成 dict 方便按 uid 取。
    """
    uids = list(user_ids)
    if not uids:
        return {}
    return dict(await words_sum_rows(db, uids, start_day, end_day))


async def words_by_day(
    db: AsyncSession,
    user_id: int,
    days: Iterable[date],
) -> dict[date, int]:
    """某学生在若干天里每天的去重学词数 → {date: 词数}。

    用于趋势图/热力图(「一个学生 × 多天」)。一次查询按天分组算完,
    不要在调用方按天循环发 N 条 SQL —— 30 天热力图那样会发 30 次。

    去重是**按天各自去重**:同一个词今天练、明天又练,两天各算 1 个。
    这符合"今天学了多少词"的语义(而非"这段时间见过多少不同的词")。
    """
    day_list = sorted(set(days))
    if not day_list:
        return {}
    start, _ = local_day_utc_range(day_list[0])
    _, end = local_day_utc_range(day_list[-1])

    # SQLite 没有时区函数,按「UTC 时间 + 8 小时」取日期即北京日历日,
    # 与 timeutil.local_day_utc_range 的口径互为逆运算
    local_day = func.date(LearningRecord.created_at, "+8 hours")
    rows = (await db.execute(
        select(
            local_day.label("d"),
            func.count(func.distinct(func.lower(Word.word))).label("cnt"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(*_base_conditions([user_id], start, end)))
        .group_by(local_day)
    )).all()

    got = {str(r.d): (r.cnt or 0) for r in rows}
    return {d: got.get(d.isoformat(), 0) for d in day_list}
