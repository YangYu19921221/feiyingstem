"""
学习数据分析API
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, Integer, case
from typing import List, Dict, Any, Optional
from datetime import datetime, date, timedelta
import math

from app.core.database import get_db
from app.models.user import User
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
