"""
学习数据分析API
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, Integer, case
from typing import List, Dict, Any, Optional
from datetime import datetime, date, timedelta
import math

from app.core.database import get_db
from app.models.user import User
from app.models.user import StudyCalendar
from app.models.learning import WordMastery, LearningRecord
from app.api.v1.auth import get_current_user
from pydantic import BaseModel

router = APIRouter()


# ========================================
# Pydantic Models
# ========================================

class DailyStats(BaseModel):
    date: str
    words_learned: int
    duration: int
    accuracy: float

    class Config:
        from_attributes = True


class WeeklyStats(BaseModel):
    week_start: str
    total_words: int
    total_duration: int
    avg_accuracy: float
    study_days: int


class LearningOverview(BaseModel):
    total_words: int
    mastered_words: int
    learning_words: int
    weak_words: int
    total_study_days: int
    total_duration: int
    avg_daily_words: float
    current_streak: int


class ModeStats(BaseModel):
    mode: str
    count: int
    avg_accuracy: float
    total_words: int


class RecentActivity(BaseModel):
    date: str
    mode: str
    unit_name: str
    score: int
    total: int
    duration: int


class RetentionDataPoint(BaseModel):
    hours_since_learning: float
    label: str
    theoretical_retention: float
    actual_retention: Optional[float] = None
    sample_size: int = 0


class RetentionCurveResponse(BaseModel):
    data_points: List[RetentionDataPoint]
    total_words_learned: int
    has_enough_data: bool
    message: str


# ========================================
# API Endpoints
# ========================================

@router.get("/overview", response_model=LearningOverview)
async def get_learning_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取学习总览数据"""

    # 总学习单词数
    result = await db.execute(
        select(func.count(UserWordProgress.id))
        .where(UserWordProgress.user_id == current_user.id)
    )
    total_words = result.scalar() or 0

    # 已掌握单词数(掌握度>=4)
    result = await db.execute(
        select(func.count(UserWordProgress.id))
        .where(and_(
            UserWordProgress.user_id == current_user.id,
            UserWordProgress.mastery_level >= 4
        ))
    )
    mastered_words = result.scalar() or 0

    # 学习中单词数(掌握度2-3)
    result = await db.execute(
        select(func.count(UserWordProgress.id))
        .where(and_(
            UserWordProgress.user_id == current_user.id,
            UserWordProgress.mastery_level >= 2,
            UserWordProgress.mastery_level < 4
        ))
    )
    learning_words = result.scalar() or 0

    # 薄弱单词数(掌握度<2)
    result = await db.execute(
        select(func.count(UserWordProgress.id))
        .where(and_(
            UserWordProgress.user_id == current_user.id,
            UserWordProgress.mastery_level < 2
        ))
    )
    weak_words = result.scalar() or 0

    # 总学习天数
    result = await db.execute(
        select(func.count(StudyCalendar.id))
        .where(StudyCalendar.user_id == current_user.id)
    )
    total_study_days = result.scalar() or 0

    # 总学习时长
    result = await db.execute(
        select(func.sum(StudyCalendar.duration))
        .where(StudyCalendar.user_id == current_user.id)
    )
    total_duration = result.scalar() or 0

    # 平均每天学习单词数
    avg_daily_words = total_words / total_study_days if total_study_days > 0 else 0

    # 当前连续打卡天数
    result = await db.execute(
        select(StudyCalendar.study_date)
        .where(StudyCalendar.user_id == current_user.id)
        .order_by(StudyCalendar.study_date.desc())
        .limit(30)
    )
    study_dates = [row[0] for row in result.fetchall()]

    current_streak = 0
    if study_dates:
        today = date.today()
        for i, study_date in enumerate(study_dates):
            expected_date = today - timedelta(days=i)
            if study_date == expected_date:
                current_streak += 1
            else:
                break

    return LearningOverview(
        total_words=total_words,
        mastered_words=mastered_words,
        learning_words=learning_words,
        weak_words=weak_words,
        total_study_days=total_study_days,
        total_duration=total_duration,
        avg_daily_words=round(avg_daily_words, 1),
        current_streak=current_streak
    )


@router.get("/daily-stats", response_model=List[DailyStats])
async def get_daily_stats(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取每日学习统计(最近N天)"""

    start_date = date.today() - timedelta(days=days-1)

    result = await db.execute(
        select(StudyCalendar)
        .where(and_(
            StudyCalendar.user_id == current_user.id,
            StudyCalendar.study_date >= start_date
        ))
        .order_by(StudyCalendar.study_date)
    )
    records = result.scalars().all()

    # 填充所有日期(包括没有学习的日期)
    daily_stats = []
    current_date = start_date
    records_dict = {r.study_date: r for r in records}

    while current_date <= date.today():
        record = records_dict.get(current_date)
        daily_stats.append(DailyStats(
            date=current_date.isoformat(),
            words_learned=record.words_learned if record else 0,
            duration=record.duration if record else 0,
            accuracy=0.0  # 暂时为0,可以从learning_records计算
        ))
        current_date += timedelta(days=1)

    return daily_stats


@router.get("/mode-stats", response_model=List[ModeStats])
async def get_mode_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取各学习模式的统计数据"""

    # 查询各模式的学习进度
    result = await db.execute(
        select(
            LearningProgress.learning_mode,
            func.count(LearningProgress.id).label('count'),
            func.avg(
                func.cast(LearningProgress.completed_words, float) /
                func.nullif(LearningProgress.total_words, 0) * 100
            ).label('avg_accuracy'),
            func.sum(LearningProgress.completed_words).label('total_words')
        )
        .where(LearningProgress.user_id == current_user.id)
        .group_by(LearningProgress.learning_mode)
    )

    mode_stats = []
    for row in result:
        mode, count, avg_accuracy, total_words = row
        mode_stats.append(ModeStats(
            mode=mode or 'flashcard',
            count=count or 0,
            avg_accuracy=round(avg_accuracy or 0, 1),
            total_words=total_words or 0
        ))

    return mode_stats


@router.get("/recent-activities", response_model=List[RecentActivity])
async def get_recent_activities(
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取最近的学习活动"""

    result = await db.execute(
        select(LearningProgress)
        .where(LearningProgress.user_id == current_user.id)
        .order_by(desc(LearningProgress.last_studied_at))
        .limit(limit)
    )
    records = result.scalars().all()

    activities = []
    for record in records:
        if record.last_studied_at:
            # 获取单元名称
            from app.models.word import Unit
            unit_result = await db.execute(
                select(Unit.name).where(Unit.id == record.unit_id)
            )
            unit_name = unit_result.scalar() or "未知单元"

            activities.append(RecentActivity(
                date=record.last_studied_at.isoformat(),
                mode=record.learning_mode or 'flashcard',
                unit_name=unit_name,
                score=record.completed_words,
                total=record.total_words,
                duration=0  # 暂时为0,可以从其他表获取
            ))

    return activities


@router.get("/calendar-data")
async def get_calendar_data(
    year: int,
    month: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取日历热力图数据"""

    # 获取指定月份的第一天和最后一天
    from calendar import monthrange
    first_day = date(year, month, 1)
    last_day = date(year, month, monthrange(year, month)[1])

    result = await db.execute(
        select(StudyCalendar)
        .where(and_(
            StudyCalendar.user_id == current_user.id,
            StudyCalendar.study_date >= first_day,
            StudyCalendar.study_date <= last_day
        ))
    )
    records = result.scalars().all()

    calendar_data = {}
    for record in records:
        calendar_data[record.study_date.isoformat()] = {
            'words_learned': record.words_learned,
            'duration': record.duration,
            'level': min(4, record.words_learned // 10)  # 0-4级热力
        }

    return calendar_data


@router.get("/retention-curve", response_model=RetentionCurveResponse)
async def get_retention_curve(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取记忆曲线数据 - 艾宾浩斯理论曲线 vs 实际保留率"""

    # 时间点定义 (小时)
    time_points = [
        (1, "1小时"),
        (24, "1天"),
        (48, "2天"),
        (96, "4天"),
        (168, "7天"),
        (336, "14天"),
        (720, "30天"),
    ]

    # 稳定性常数 S=36 (小时)
    S = 36.0

    # 查询用户总学习单词数
    total_result = await db.execute(
        select(func.count(WordMastery.id))
        .where(WordMastery.user_id == current_user.id)
    )
    total_words_learned = total_result.scalar() or 0

    now = datetime.utcnow()
    data_points = []
    has_any_actual = False

    for hours, label in time_points:
        # 理论保留率: R = e^(-t/S) * 100
        theoretical = math.exp(-hours / S) * 100

        # 实际保留率: 查询在 [hours-窗口, hours+窗口] 前学习的单词
        # 窗口大小随时间点增大
        if hours <= 1:
            window_hours = 1
        elif hours <= 48:
            window_hours = 12
        elif hours <= 168:
            window_hours = 24
        else:
            window_hours = 72

        window_start = now - timedelta(hours=hours + window_hours)
        window_end = now - timedelta(hours=max(0, hours - window_hours))

        # 查询该窗口内首次学习的单词
        result = await db.execute(
            select(
                func.count(WordMastery.id).label('total'),
                func.sum(
                    case(
                        (WordMastery.mastery_level >= 3, 1),
                        else_=0
                    )
                ).label('retained')
            )
            .where(
                and_(
                    WordMastery.user_id == current_user.id,
                    WordMastery.created_at >= window_start,
                    WordMastery.created_at <= window_end,
                )
            )
        )
        row = result.first()
        sample_size = row.total if row and row.total else 0
        actual_retention = None

        if sample_size >= 3:
            retained = row.retained or 0
            actual_retention = round((retained / sample_size) * 100, 1)
            has_any_actual = True

        data_points.append(RetentionDataPoint(
            hours_since_learning=hours,
            label=label,
            theoretical_retention=round(theoretical, 1),
            actual_retention=actual_retention,
            sample_size=sample_size,
        ))

    if has_any_actual:
        message = "记忆曲线数据已生成，蓝色实线为你的实际保留率"
    elif total_words_learned > 0:
        message = "学习数据还不够多，暂时只显示理论遗忘曲线，继续学习后会显示你的实际数据"
    else:
        message = "还没有学习记录，开始学习后即可查看记忆曲线"

    return RetentionCurveResponse(
        data_points=data_points,
        total_words_learned=total_words_learned,
        has_enough_data=has_any_actual,
        message=message,
    )


# ========================================
# 单词学习趋势 (日/月/年)
# ========================================

async def fetch_word_trends(db: AsyncSession, user_id: int, period: str, year: int, month: int):
    """
    查询用户的单词学习趋势数据（共用函数，学生端和教师端复用）
    period: daily | monthly | yearly
    """
    import calendar as cal
    from collections import defaultdict

    if period == "daily":
        # 查当月每天的数据
        first_day = date(year, month, 1)
        days_in_month = cal.monthrange(year, month)[1]
        last_day = date(year, month, days_in_month)

        result = await db.execute(
            select(StudyCalendar)
            .where(and_(
                StudyCalendar.user_id == user_id,
                StudyCalendar.study_date >= first_day,
                StudyCalendar.study_date <= last_day,
            ))
        )
        records = {r.study_date: r for r in result.scalars().all()}

        # 查当月新掌握的单词数（mastery_level >= 3 且 updated_at 在当月）
        mastered_result = await db.execute(
            select(func.count(WordMastery.id))
            .where(and_(
                WordMastery.user_id == user_id,
                WordMastery.mastery_level >= 3,
                WordMastery.updated_at >= datetime(year, month, 1),
                WordMastery.updated_at < datetime(year, month, days_in_month, 23, 59, 59),
            ))
        )
        total_mastered = mastered_result.scalar() or 0

        data = []
        total_words = 0
        total_duration = 0
        study_days = 0
        for day in range(1, days_in_month + 1):
            d = date(year, month, day)
            rec = records.get(d)
            words = rec.words_learned if rec else 0
            dur = rec.duration if rec else 0
            total_words += words
            total_duration += dur
            if words > 0:
                study_days += 1
            data.append({
                "label": f"{month}/{day}",
                "date": d.isoformat(),
                "words_learned": words,
                "duration_minutes": round(dur / 60, 1),
            })

        # 查上月数据做环比
        prev_month = month - 1 if month > 1 else 12
        prev_year = year if month > 1 else year - 1
        prev_days = cal.monthrange(prev_year, prev_month)[1]
        prev_result = await db.execute(
            select(func.sum(StudyCalendar.words_learned), func.sum(StudyCalendar.duration))
            .where(and_(
                StudyCalendar.user_id == user_id,
                StudyCalendar.study_date >= date(prev_year, prev_month, 1),
                StudyCalendar.study_date <= date(prev_year, prev_month, prev_days),
            ))
        )
        prev_row = prev_result.one()
        prev_words = prev_row[0] or 0
        prev_duration = prev_row[1] or 0

        return {
            "period": "daily",
            "year": year,
            "month": month,
            "data": data,
            "summary": {
                "total_words": total_words,
                "total_mastered": total_mastered,
                "total_duration_minutes": round(total_duration / 60),
                "avg_daily_words": round(total_words / max(study_days, 1), 1),
                "study_days": study_days,
                "prev_total_words": prev_words,
                "prev_total_duration_minutes": round(prev_duration / 60),
            },
        }

    elif period == "monthly":
        # 查当年12个月的数据
        result = await db.execute(
            select(StudyCalendar)
            .where(and_(
                StudyCalendar.user_id == user_id,
                StudyCalendar.study_date >= date(year, 1, 1),
                StudyCalendar.study_date <= date(year, 12, 31),
            ))
        )
        all_records = result.scalars().all()

        # 按月份分组
        monthly_data = defaultdict(lambda: {"words": 0, "duration": 0, "days": 0})
        for rec in all_records:
            m = rec.study_date.month
            monthly_data[m]["words"] += rec.words_learned
            monthly_data[m]["duration"] += rec.duration
            if rec.words_learned > 0:
                monthly_data[m]["days"] += 1

        # 查每月掌握数
        mastered_by_month = defaultdict(int)
        mastered_result = await db.execute(
            select(WordMastery.updated_at)
            .where(and_(
                WordMastery.user_id == user_id,
                WordMastery.mastery_level >= 3,
                WordMastery.updated_at >= datetime(year, 1, 1),
                WordMastery.updated_at <= datetime(year, 12, 31, 23, 59, 59),
            ))
        )
        for row in mastered_result.scalars().all():
            if row:
                mastered_by_month[row.month] += 1

        MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
        data = []
        total_words = 0
        total_duration = 0
        total_mastered = 0
        total_study_days = 0
        for m in range(1, 13):
            md = monthly_data[m]
            total_words += md["words"]
            total_duration += md["duration"]
            total_mastered += mastered_by_month[m]
            total_study_days += md["days"]
            data.append({
                "label": MONTH_LABELS[m - 1],
                "date": f"{year}-{m:02d}",
                "words_learned": md["words"],
                "words_mastered": mastered_by_month[m],
                "duration_minutes": round(md["duration"] / 60, 1),
            })

        # 查上一年数据做同比
        prev_result = await db.execute(
            select(func.sum(StudyCalendar.words_learned), func.sum(StudyCalendar.duration))
            .where(and_(
                StudyCalendar.user_id == user_id,
                StudyCalendar.study_date >= date(year - 1, 1, 1),
                StudyCalendar.study_date <= date(year - 1, 12, 31),
            ))
        )
        prev_row = prev_result.one()
        prev_words = prev_row[0] or 0
        prev_duration = prev_row[1] or 0

        return {
            "period": "monthly",
            "year": year,
            "data": data,
            "summary": {
                "total_words": total_words,
                "total_mastered": total_mastered,
                "total_duration_minutes": round(total_duration / 60),
                "avg_daily_words": round(total_words / max(total_study_days, 1), 1),
                "study_days": total_study_days,
                "prev_total_words": prev_words,
                "prev_total_duration_minutes": round(prev_duration / 60),
            },
        }

    else:  # yearly
        # 查所有年份的数据
        result = await db.execute(
            select(StudyCalendar)
            .where(StudyCalendar.user_id == user_id)
            .order_by(StudyCalendar.study_date)
        )
        all_records = result.scalars().all()

        yearly_data = defaultdict(lambda: {"words": 0, "duration": 0, "days": 0})
        for rec in all_records:
            y = rec.study_date.year
            yearly_data[y]["words"] += rec.words_learned
            yearly_data[y]["duration"] += rec.duration
            if rec.words_learned > 0:
                yearly_data[y]["days"] += 1

        if not yearly_data:
            current_year = date.today().year
            yearly_data[current_year] = {"words": 0, "duration": 0, "days": 0}

        data = []
        total_words = 0
        total_duration = 0
        for y in sorted(yearly_data.keys()):
            yd = yearly_data[y]
            total_words += yd["words"]
            total_duration += yd["duration"]
            data.append({
                "label": f"{y}年",
                "date": str(y),
                "words_learned": yd["words"],
                "duration_minutes": round(yd["duration"] / 60, 1),
                "study_days": yd["days"],
            })

        return {
            "period": "yearly",
            "data": data,
            "summary": {
                "total_words": total_words,
                "total_duration_minutes": round(total_duration / 60),
                "study_days": sum(yd["days"] for yd in yearly_data.values()),
            },
        }


@router.get("/word-trends")
async def get_word_trends(
    period: str = Query("daily", regex="^(daily|monthly|yearly)$"),
    year: int = Query(None),
    month: int = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取单词学习趋势（日/月/年）"""
    today = date.today()
    if year is None:
        year = today.year
    if month is None:
        month = today.month

    return await fetch_word_trends(db, current_user.id, period, year, month)
