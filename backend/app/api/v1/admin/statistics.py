from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordBook, Unit
from app.models.learning import LearningProgress, StudySession
from app.api.v1.auth import get_current_admin

router = APIRouter()

@router.get("/stats")
async def get_statistics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin)
):
    """
    获取系统统计数据
    """
    # 获取今天和本周的起始时间
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    week_start = today_start - timedelta(days=now.weekday())  # 本周一

    # 1. 总用户数
    result = await db.execute(select(func.count()).select_from(User))
    total_users = result.scalar() or 0

    # 2. 总单词数
    result = await db.execute(select(func.count()).select_from(Word))
    total_words = result.scalar() or 0

    # 3. 总单词本数
    result = await db.execute(select(func.count()).select_from(WordBook))
    total_books = result.scalar() or 0

    # 4. 总单元数
    result = await db.execute(select(func.count()).select_from(Unit))
    total_units = result.scalar() or 0

    # 5. 今日活跃用户数 (今天有学习记录的用户)
    result = await db.execute(
        select(func.count(func.distinct(StudySession.user_id)))
        .where(StudySession.started_at >= today_start)
    )
    active_users_today = result.scalar() or 0

    # 6. 本周活跃用户数
    result = await db.execute(
        select(func.count(func.distinct(StudySession.user_id)))
        .where(StudySession.started_at >= week_start)
    )
    active_users_week = result.scalar() or 0

    # 7. 今日学习次数 (学习会话数)
    result = await db.execute(
        select(func.count()).select_from(StudySession)
        .where(StudySession.started_at >= today_start)
    )
    learning_records_today = result.scalar() or 0

    # 8. 本周学习次数
    result = await db.execute(
        select(func.count()).select_from(StudySession)
        .where(StudySession.started_at >= week_start)
    )
    learning_records_week = result.scalar() or 0

    # 9. 用户角色分布
    result = await db.execute(
        select(User.role, func.count())
        .group_by(User.role)
    )
    role_distribution = {}
    for role, count in result.all():
        role_distribution[role] = count

    return {
        "total_users": total_users,
        "total_words": total_words,
        "total_books": total_books,
        "total_units": total_units,
        "active_users_today": active_users_today,
        "active_users_week": active_users_week,
        "learning_records_today": learning_records_today,
        "learning_records_week": learning_records_week,
        "role_distribution": role_distribution,
        "students": role_distribution.get("student", 0),
        "teachers": role_distribution.get("teacher", 0),
        "admins": role_distribution.get("admin", 0),
    }
