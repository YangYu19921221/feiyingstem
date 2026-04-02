from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.user import User
from app.models.learning import LearningProgress, StudySession, LearningRecord
from app.models.word import WordBook
from app.api.v1.auth import get_current_student

router = APIRouter()

@router.get("/stats")
async def get_student_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取学生仪表板统计数据
    """
    user_id = current_user.id
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)

    # 1. 学习单词总数 (所有学习进度中的单词数)
    result = await db.execute(
        select(func.sum(LearningProgress.total_words))
        .where(LearningProgress.user_id == user_id)
    )
    total_words_studied = result.scalar() or 0

    # 2. 今日学习单词数
    result = await db.execute(
        select(func.count()).select_from(StudySession)
        .where(
            and_(
                StudySession.user_id == user_id,
                StudySession.started_at >= today_start
            )
        )
    )
    today_words = result.scalar() or 0

    # 3. 已掌握单词数 (completed_words总和)
    result = await db.execute(
        select(func.sum(LearningProgress.completed_words))
        .where(LearningProgress.user_id == user_id)
    )
    mastered_words = result.scalar() or 0

    # 4. 掌握率
    mastery_rate = (mastered_words / total_words_studied * 100) if total_words_studied > 0 else 0

    # 5. 连续打卡天数 (从今天往前计算)
    streak_days = 0
    check_date = today_start
    while True:
        result = await db.execute(
            select(func.count()).select_from(StudySession)
            .where(
                and_(
                    StudySession.user_id == user_id,
                    StudySession.started_at >= check_date,
                    StudySession.started_at < check_date + timedelta(days=1)
                )
            )
        )
        count = result.scalar() or 0
        if count > 0:
            streak_days += 1
            check_date = check_date - timedelta(days=1)
        else:
            break
        # 最多查询30天
        if streak_days >= 30:
            break

    # 6. 学习总时长(分钟) - 从StudySession计算
    result = await db.execute(
        select(StudySession.started_at, StudySession.ended_at)
        .where(StudySession.user_id == user_id)
    )
    sessions = result.all()
    total_minutes = 0
    for started, ended in sessions:
        if started and ended:
            duration = (ended - started).total_seconds() / 60
            total_minutes += duration

    # 7. 排名百分比 (根据经验值)
    # 获取所有学生的经验值排名
    result = await db.execute(
        select(func.count())
        .select_from(User)
        .where(
            and_(
                User.role == 'student',
                User.experience_points > current_user.experience_points
            )
        )
    )
    higher_ranked = result.scalar() or 0

    result = await db.execute(
        select(func.count())
        .select_from(User)
        .where(User.role == 'student')
    )
    total_students = result.scalar() or 1

    rank_percentage = 100 - (higher_ranked / total_students * 100)

    # 满分轮次
    result = await db.execute(
        select(func.count()).select_from(StudySession)
        .where(
            and_(
                StudySession.user_id == user_id,
                StudySession.wrong_count == 0,
                StudySession.correct_count > 0,
            )
        )
    )
    perfect_sessions = result.scalar() or 0

    # 总完成会话数
    result = await db.execute(
        select(func.count()).select_from(StudySession)
        .where(
            and_(
                StudySession.user_id == user_id,
                StudySession.correct_count > 0,
            )
        )
    )
    total_sessions = result.scalar() or 0

    # 首次正确率
    result = await db.execute(
        select(
            func.count(func.distinct(LearningRecord.word_id))
        ).where(LearningRecord.user_id == user_id)
    )
    total_unique_words = result.scalar() or 0

    first_record_subq = (
        select(
            LearningRecord.word_id,
            func.min(LearningRecord.id).label('first_id')
        )
        .where(LearningRecord.user_id == user_id)
        .group_by(LearningRecord.word_id)
        .subquery()
    )
    result = await db.execute(
        select(func.count())
        .select_from(LearningRecord)
        .join(first_record_subq, LearningRecord.id == first_record_subq.c.first_id)
        .where(LearningRecord.is_correct == True)
    )
    first_time_correct = result.scalar() or 0
    first_time_accuracy = (first_time_correct / total_unique_words * 100) if total_unique_words > 0 else 0

    return {
        "total_words_studied": int(total_words_studied),
        "today_words": today_words,
        "mastered_words": int(mastered_words),
        "mastery_rate": round(mastery_rate, 1),
        "streak_days": streak_days,
        "total_minutes": int(total_minutes),
        "rank_percentage": round(rank_percentage, 0),
        "level": current_user.level or 1,
        "experience_points": current_user.experience_points or 0,
        "total_points": current_user.total_points or 0,
        "perfect_sessions": perfect_sessions,
        "total_sessions": total_sessions,
        "first_time_accuracy": round(first_time_accuracy, 1),
    }
