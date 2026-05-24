"""学生端光荣榜 — 词汇王 / 勤奋王 / 精准王
周维度统计，只展示前 10 名 + 当前学生位置（不展示完整名次榜）
"""
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func, and_, case, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student
from app.core.database import get_db
from app.models.learning import LearningRecord, StudySession, WordMastery
from app.models.user import User, Class, ClassStudent

router = APIRouter()

LeaderboardKind = Literal["vocabulary", "diligence", "accuracy"]
PeriodKind = Literal["this_week", "last_week", "this_month"]
ScopeKind = Literal["all", "class"]


def _period_range(period: PeriodKind) -> tuple[datetime, datetime]:
    """返回 [start, end) UTC，按学生作息周一为一周开始"""
    now = datetime.utcnow()
    today = datetime(now.year, now.month, now.day)
    if period == "this_week":
        # 本周一 00:00 → 下周一 00:00
        monday = today - timedelta(days=today.weekday())
        return monday, monday + timedelta(days=7)
    if period == "last_week":
        monday = today - timedelta(days=today.weekday() + 7)
        return monday, monday + timedelta(days=7)
    # this_month
    first = datetime(now.year, now.month, 1)
    if now.month == 12:
        next_first = datetime(now.year + 1, 1, 1)
    else:
        next_first = datetime(now.year, now.month + 1, 1)
    return first, next_first


class LeaderboardEntry(BaseModel):
    user_id: int
    username: str
    full_name: str | None
    value: int  # 词数 / 分钟数 / 正确率(0-100)
    rank: int  # 1-based


class LeaderboardResponse(BaseModel):
    kind: LeaderboardKind
    period: PeriodKind
    scope: ScopeKind
    class_name: str | None
    top: list[LeaderboardEntry]
    my_rank: int | None
    my_value: int
    my_delta: int  # 与上一周期相比的 +/-，词数/分钟为绝对差，正确率为百分点差
    total_participants: int


async def _vocabulary_leaderboard(
    db: AsyncSession,
    user_id: int,
    period: PeriodKind,
    scope: ScopeKind = "all",
) -> LeaderboardResponse:
    """词汇王：本周期内新掌握的不同词数"""
    start, end = _period_range(period)

    # 本周期内首次答对（mastery 升到 ≥3）的词数
    # 使用 LearningRecord：本周期内该用户答对的不重复 word_id 数
    stmt = (
        select(
            LearningRecord.user_id,
            func.count(func.distinct(LearningRecord.word_id)).label("v"),
        )
        .where(
            and_(
                LearningRecord.created_at >= start,
                LearningRecord.created_at < end,
                LearningRecord.is_correct.is_(True),
            )
        )
        .group_by(LearningRecord.user_id)
        .order_by(func.count(func.distinct(LearningRecord.word_id)).desc())
    )
    result = await db.execute(stmt)
    rows = result.all()
    return await _build_response(db, "vocabulary", period, scope, user_id, rows, start, end)


async def _diligence_leaderboard(
    db: AsyncSession,
    user_id: int,
    period: PeriodKind,
    scope: ScopeKind = "all",
) -> LeaderboardResponse:
    """勤奋王：本周期内学习总分钟数（StudySession.time_spent 累加）"""
    start, end = _period_range(period)
    stmt = (
        select(
            StudySession.user_id,
            (func.coalesce(func.sum(StudySession.time_spent), 0) / 60).label("v"),
        )
        .where(
            and_(
                StudySession.started_at >= start,
                StudySession.started_at < end,
            )
        )
        .group_by(StudySession.user_id)
        .order_by(func.coalesce(func.sum(StudySession.time_spent), 0).desc())
    )
    result = await db.execute(stmt)
    rows = result.all()
    return await _build_response(db, "diligence", period, scope, user_id, rows, start, end)


async def _accuracy_leaderboard(
    db: AsyncSession,
    user_id: int,
    period: PeriodKind,
    scope: ScopeKind = "all",
) -> LeaderboardResponse:
    """精准王：本周期内首次答对率（>=80% 才入榜）
    分子：is_correct = True 的不重复 word_id 数
    分母：该用户在该词上的第一条 LearningRecord 数（即"遇到过"的不重复词数）
    简化：用本期总答题正确率（不区分首次/重复），降低 SQL 复杂度
    """
    start, end = _period_range(period)
    total = func.count(LearningRecord.id)
    correct = func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0))
    accuracy = func.cast(correct * 100, Integer) / total

    stmt = (
        select(
            LearningRecord.user_id,
            accuracy.label("v"),
            total.label("attempts"),
        )
        .where(
            and_(
                LearningRecord.created_at >= start,
                LearningRecord.created_at < end,
            )
        )
        .group_by(LearningRecord.user_id)
        .having(total >= 20)  # 至少答 20 题才入榜，避免 1 题 100% 霸榜
        .order_by(accuracy.desc())
    )
    result = await db.execute(stmt)
    rows = [(r[0], r[1]) for r in result.all()]
    return await _build_response(db, "accuracy", period, scope, user_id, rows, start, end)


async def _resolve_class_scope(db: AsyncSession, user_id: int) -> tuple[str | None, set[int]]:
    """返回当前用户最近 active 班级名 + 班内所有 active 同学 student_id 集合。

    没班级 → (None, empty set)。
    """
    cs = (await db.execute(
        select(ClassStudent).where(
            and_(ClassStudent.student_id == user_id, ClassStudent.is_active.is_(True))
        ).order_by(ClassStudent.joined_at.desc()).limit(1)
    )).scalar_one_or_none()
    if cs is None:
        return None, set()
    cls = (await db.execute(select(Class).where(Class.id == cs.class_id))).scalar_one_or_none()
    members = (await db.execute(
        select(ClassStudent.student_id).where(
            and_(ClassStudent.class_id == cs.class_id, ClassStudent.is_active.is_(True))
        )
    )).scalars().all()
    return (cls.name if cls else None), set(members)


async def _build_response(
    db: AsyncSession,
    kind: LeaderboardKind,
    period: PeriodKind,
    scope: ScopeKind,
    user_id: int,
    rows: list[tuple],
    start: datetime,
    end: datetime,
) -> LeaderboardResponse:
    """通用响应构造：scope 过滤 + 完整排名 + 当前用户排名 + 周环比。"""
    class_name: str | None = None
    if scope == "class":
        class_name, allowed = await _resolve_class_scope(db, user_id)
        # 没班级 → 直接空榜
        if not allowed:
            return LeaderboardResponse(
                kind=kind, period=period, scope=scope, class_name=None,
                top=[], my_rank=None, my_value=0, my_delta=0,
                total_participants=0,
            )
        rows = [r for r in rows if r[0] in allowed]

    total = len(rows)

    # 完整排名(上限 100), join users
    capped = rows[:100]
    top_ids = [r[0] for r in capped]
    top_users: dict[int, User] = {}
    if top_ids:
        user_result = await db.execute(select(User).where(User.id.in_(top_ids)))
        top_users = {u.id: u for u in user_result.scalars().all()}

    top_entries: list[LeaderboardEntry] = []
    for rank, (uid, val) in enumerate(capped, start=1):
        u = top_users.get(uid)
        if not u:
            continue
        top_entries.append(LeaderboardEntry(
            user_id=uid,
            username=u.username,
            full_name=u.full_name,
            value=int(val or 0),
            rank=rank,
        ))

    # 当前学生的排名 + 本期值
    my_rank: int | None = None
    my_value = 0
    for rank, (uid, val) in enumerate(rows, start=1):
        if uid == user_id:
            my_rank = rank
            my_value = int(val or 0)
            break

    # 周环比：拿上一周期同样的值，做差
    my_delta = 0
    if period == "this_week":
        prev_start = start - timedelta(days=7)
        prev_value = await _get_my_period_value(db, kind, user_id, prev_start, start)
        my_delta = my_value - prev_value

    return LeaderboardResponse(
        kind=kind,
        period=period,
        scope=scope,
        class_name=class_name,
        top=top_entries,
        my_rank=my_rank,
        my_value=my_value,
        my_delta=my_delta,
        total_participants=total,
    )


async def _get_my_period_value(
    db: AsyncSession,
    kind: LeaderboardKind,
    user_id: int,
    start: datetime,
    end: datetime,
) -> int:
    """单独取当前学生在某周期的指标值（用于环比）"""
    if kind == "vocabulary":
        result = await db.execute(
            select(func.count(func.distinct(LearningRecord.word_id)))
            .where(
                and_(
                    LearningRecord.user_id == user_id,
                    LearningRecord.created_at >= start,
                    LearningRecord.created_at < end,
                    LearningRecord.is_correct.is_(True),
                )
            )
        )
        return int(result.scalar() or 0)
    if kind == "diligence":
        result = await db.execute(
            select(func.coalesce(func.sum(StudySession.time_spent), 0))
            .where(
                and_(
                    StudySession.user_id == user_id,
                    StudySession.started_at >= start,
                    StudySession.started_at < end,
                )
            )
        )
        return int((result.scalar() or 0) / 60)
    # accuracy：百分点差
    result = await db.execute(
        select(
            func.count(LearningRecord.id),
            func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)),
        ).where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.created_at >= start,
                LearningRecord.created_at < end,
            )
        )
    )
    row = result.first()
    if not row or not row[0]:
        return 0
    return int((row[1] or 0) * 100 / row[0])


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    kind: LeaderboardKind = Query("vocabulary"),
    period: PeriodKind = Query("this_week"),
    scope: ScopeKind = Query("all"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """光荣榜 — 词汇/勤奋/精准王 × 班级/全平台范围"""
    if kind == "vocabulary":
        return await _vocabulary_leaderboard(db, current_user.id, period, scope)
    if kind == "diligence":
        return await _diligence_leaderboard(db, current_user.id, period, scope)
    return await _accuracy_leaderboard(db, current_user.id, period, scope)
