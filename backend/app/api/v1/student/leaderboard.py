"""学生端光荣榜 — 词汇王 / 勤奋王 / 精准王
周维度统计。展示前 10 名 + 当前学生「邻居区」（我的上下各 2 名）。
支持 scope=班级榜 / 全平台榜（无班级时自动回退到全平台）。
"""
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_, case, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student
from app.core.database import get_db
from app.core.timeutil import (
    local_today, local_day_utc_range, local_week_utc_range, local_month_utc_range,
)
from app.models.learning import LearningRecord, StudySession, WordMastery
from app.models.user import User, Class, ClassStudent
from app.models.word import Word

router = APIRouter()

LeaderboardKind = Literal["vocabulary", "diligence", "accuracy"]
PeriodKind = Literal["today", "this_week", "last_week", "this_month"]
ScopeKind = Literal["class", "global"]


def _period_range(period: PeriodKind) -> tuple[datetime, datetime]:
    """返回 [start, end) UTC,按北京时间周一为一周开始/月初。
    先按北京日历算出起止日,再转成 UTC 区间与 UTC 时间戳比较。"""
    today = local_today()
    if period == "today":
        return local_day_utc_range(today)
    if period == "this_week":
        return local_week_utc_range(today)
    if period == "last_week":
        return local_week_utc_range(today - timedelta(days=7))
    return local_month_utc_range(today)


class LeaderboardEntry(BaseModel):
    user_id: int
    username: str
    full_name: str | None
    value: int  # 词数 / 分钟数 / 正确率(0-100)
    rank: int  # 1-based


class LeaderboardResponse(BaseModel):
    kind: LeaderboardKind
    period: PeriodKind
    scope: ScopeKind          # 实际生效的范围（无班级时即使请求 class 也回 global）
    has_class: bool           # 学生是否在某个班级里（决定前端是否显示班级榜开关）
    class_name: str | None
    top: list[LeaderboardEntry]
    neighbors: list[LeaderboardEntry]  # 我的上下各 2 名（含自己），按 rank 升序
    my_rank: int | None
    my_value: int
    my_delta: int             # 与上一周期相比的 +/-；正确率为百分点差
    total_participants: int


async def _resolve_scope(
    db: AsyncSession, user_id: int, scope: ScopeKind,
) -> tuple[ScopeKind, set[int] | None, bool, str | None]:
    """解析范围。返回 (生效scope, 允许的user_id集合或None, 是否有班级, 班级名)。
    allowed 为 None 表示不限制（全平台）。学生在多个班级时取最近加入的一个。
    """
    row = (await db.execute(
        select(ClassStudent.class_id, Class.name)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(and_(
            ClassStudent.student_id == user_id,
            ClassStudent.is_active.is_(True),
        ))
        .order_by(ClassStudent.joined_at.desc())
    )).first()

    has_class = row is not None
    class_name = row[1] if row else None

    if scope == "class" and has_class:
        members = await db.execute(
            select(ClassStudent.student_id).where(and_(
                ClassStudent.class_id == row[0],
                ClassStudent.is_active.is_(True),
            ))
        )
        return "class", {r[0] for r in members.all()}, has_class, class_name

    return "global", None, has_class, class_name


async def _vocabulary_rows(db, period, allowed):
    """词汇王:本周期内学过的不重复单词数(按拼写去重,与教师端每日数据同口径)。

    两处口径修正(否则学生端名次和教师端/大屏对不上):
    - 按 LOWER(word.word) 拼写去重:单元级隔离后同一拼写在不同单元是不同 word_id,
      按 word_id 数会虚高
    - 不再要求 is_correct:教师端「学了多少词」统计的是接触过的词;答错也算学过
    """
    start, end = _period_range(period)
    conds = [
        LearningRecord.created_at >= start,
        LearningRecord.created_at < end,
    ]
    if allowed is not None:
        conds.append(LearningRecord.user_id.in_(allowed))
    stmt = (
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))).label("v"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(*conds))
        .group_by(LearningRecord.user_id)
        .order_by(func.count(func.distinct(func.lower(Word.word))).desc())
    )
    return [(r[0], r[1]) for r in (await db.execute(stmt)).all()]


async def _diligence_rows(db, period, allowed):
    """勤奋王：本周期内学习总分钟数"""
    start, end = _period_range(period)
    conds = [StudySession.started_at >= start, StudySession.started_at < end]
    if allowed is not None:
        conds.append(StudySession.user_id.in_(allowed))
    stmt = (
        select(
            StudySession.user_id,
            (func.coalesce(func.sum(StudySession.time_spent), 0) / 60).label("v"),
        )
        .where(and_(*conds))
        .group_by(StudySession.user_id)
        .order_by(func.coalesce(func.sum(StudySession.time_spent), 0).desc())
    )
    return [(r[0], r[1]) for r in (await db.execute(stmt)).all()]


async def _accuracy_rows(db, period, allowed):
    """精准王：本周期答题正确率（至少 20 题才入榜）"""
    start, end = _period_range(period)
    total = func.count(LearningRecord.id)
    correct = func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0))
    accuracy = func.cast(correct * 100, Integer) / total
    conds = [LearningRecord.created_at >= start, LearningRecord.created_at < end]
    if allowed is not None:
        conds.append(LearningRecord.user_id.in_(allowed))
    stmt = (
        select(LearningRecord.user_id, accuracy.label("v"))
        .where(and_(*conds))
        .group_by(LearningRecord.user_id)
        .having(total >= 20)
        .order_by(accuracy.desc())
    )
    return [(r[0], r[1]) for r in (await db.execute(stmt)).all()]


def _slice_entries(rows, users, lo, hi) -> list[LeaderboardEntry]:
    """把 rows[lo-1:hi]（1-based rank 区间）构造成 entry 列表"""
    out: list[LeaderboardEntry] = []
    for offset, (uid, val) in enumerate(rows[lo - 1:hi]):
        u = users.get(uid)
        if not u:
            continue
        out.append(LeaderboardEntry(
            user_id=uid,
            username=u.username,
            full_name=u.full_name,
            value=int(val or 0),
            rank=lo + offset,
        ))
    return out


async def _build_response(
    db, kind, period, scope, has_class, class_name, user_id, rows,
) -> LeaderboardResponse:
    """通用响应：top10 + 邻居区 + 我的名次 + 总人数 + 周环比"""
    start, end = _period_range(period)
    total = len(rows)

    # 我的名次 / 本期值
    my_rank: int | None = None
    my_value = 0
    for rank, (uid, val) in enumerate(rows, start=1):
        if uid == user_id:
            my_rank, my_value = rank, int(val or 0)
            break

    # 一次性取齐 top10 + 邻居区所需的用户
    nb_lo = max(1, my_rank - 2) if my_rank else 0
    nb_hi = min(total, my_rank + 2) if my_rank else -1
    need_ids = {r[0] for r in rows[:10]}
    if my_rank:
        need_ids |= {r[0] for r in rows[nb_lo - 1:nb_hi]}
    users: dict[int, User] = {}
    if need_ids:
        res = await db.execute(select(User).where(User.id.in_(need_ids)))
        users = {u.id: u for u in res.scalars().all()}

    top_entries = _slice_entries(rows, users, 1, 10)
    neighbors = _slice_entries(rows, users, nb_lo, nb_hi) if my_rank else []

    # 周环比（我自己的值，与范围无关）
    my_delta = 0
    if period == "this_week":
        prev_value = await _get_my_period_value(
            db, kind, user_id, start - timedelta(days=7), start,
        )
        my_delta = my_value - prev_value

    return LeaderboardResponse(
        kind=kind, period=period, scope=scope,
        has_class=has_class, class_name=class_name,
        top=top_entries, neighbors=neighbors,
        my_rank=my_rank, my_value=my_value, my_delta=my_delta,
        total_participants=total,
    )


async def _get_my_period_value(db, kind, user_id, start, end) -> int:
    """当前学生在某周期的指标值（用于环比，全口径不分范围）"""
    if kind == "vocabulary":
        r = await db.execute(
            select(func.count(func.distinct(func.lower(Word.word))))
            .select_from(LearningRecord)
            .join(Word, Word.id == LearningRecord.word_id)
            .where(and_(
                LearningRecord.user_id == user_id,
                LearningRecord.created_at >= start,
                LearningRecord.created_at < end,
            ))
        )
        return int(r.scalar() or 0)
    if kind == "diligence":
        r = await db.execute(
            select(func.coalesce(func.sum(StudySession.time_spent), 0)).where(and_(
                StudySession.user_id == user_id,
                StudySession.started_at >= start,
                StudySession.started_at < end,
            ))
        )
        return int((r.scalar() or 0) / 60)
    r = await db.execute(
        select(
            func.count(LearningRecord.id),
            func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)),
        ).where(and_(
            LearningRecord.user_id == user_id,
            LearningRecord.created_at >= start,
            LearningRecord.created_at < end,
        ))
    )
    row = r.first()
    if not row or not row[0]:
        return 0
    return int((row[1] or 0) * 100 / row[0])


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    kind: LeaderboardKind = Query("vocabulary"),
    period: PeriodKind = Query("this_week"),
    scope: ScopeKind = Query("class"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """光荣榜 — 词汇/勤奋/精准王 × 三种周期 × 班级榜/全平台榜"""
    eff_scope, allowed, has_class, class_name = await _resolve_scope(
        db, current_user.id, scope,
    )
    if kind == "vocabulary":
        rows = await _vocabulary_rows(db, period, allowed)
    elif kind == "diligence":
        rows = await _diligence_rows(db, period, allowed)
    else:
        rows = await _accuracy_rows(db, period, allowed)
    return await _build_response(
        db, kind, period, eff_scope, has_class, class_name, current_user.id, rows,
    )
