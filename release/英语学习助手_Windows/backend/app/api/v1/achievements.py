"""
成就系统API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import List, Optional
from datetime import datetime, date, timedelta

from app.core.database import get_db
from app.models.user import User
from app.api.v1.auth import get_current_user
from pydantic import BaseModel

router = APIRouter()


# ========================================
# 等级系统配置
# ========================================

# 等级对应的经验值要求
LEVEL_THRESHOLDS = {
    1: 0,
    2: 100,
    3: 250,
    4: 500,
    5: 1000,
    6: 2000,
    7: 3500,
    8: 5500,
    9: 8000,
    10: 11000,
    11: 15000,
    12: 20000,
    13: 26000,
    14: 33000,
    15: 41000,
    16: 50000,
    17: 60000,
    18: 72000,
    19: 86000,
    20: 100000,
}

# 等级称号
LEVEL_TITLES = {
    1: "初学者",
    3: "学徒",
    5: "进阶者",
    8: "熟练者",
    10: "专家",
    15: "大师",
    20: "传奇",
}


def calculate_level(experience_points: int) -> dict:
    """根据经验值计算等级"""
    level = 1
    for lvl, threshold in sorted(LEVEL_THRESHOLDS.items()):
        if experience_points >= threshold:
            level = lvl
        else:
            break

    # 计算到下一级的进度
    next_level = level + 1
    current_threshold = LEVEL_THRESHOLDS.get(level, 0)
    next_threshold = LEVEL_THRESHOLDS.get(next_level, current_threshold + 5000)

    progress = 0
    if next_level in LEVEL_THRESHOLDS:
        progress = ((experience_points - current_threshold) /
                    (next_threshold - current_threshold) * 100)

    # 获取称号
    title = "初学者"
    for lvl in sorted(LEVEL_TITLES.keys(), reverse=True):
        if level >= lvl:
            title = LEVEL_TITLES[lvl]
            break

    return {
        "level": level,
        "experience_points": experience_points,
        "title": title,
        "progress_to_next": round(progress, 1),
        "next_level_requirement": next_threshold if next_level in LEVEL_THRESHOLDS else None
    }


# ========================================
# Pydantic Models
# ========================================

class Achievement(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    condition_type: Optional[str] = None
    condition_value: Optional[int] = None
    reward_points: int = 10
    unlocked: bool = False
    unlocked_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserAchievementResponse(BaseModel):
    achievements: List[Achievement]
    total_unlocked: int
    total_points: int


class CheckAchievementRequest(BaseModel):
    mode: str
    score: int
    total: int
    time_spent: Optional[int] = None


class UnlockedAchievement(BaseModel):
    id: int
    name: str
    description: str
    icon: str
    reward_points: int


# ========================================
# 辅助函数
# ========================================

async def get_user_stats(db: AsyncSession, user_id: int):
    """获取用户学习统计数据"""
    from app.models.learning import UserWordProgress, LearningRecord

    # 总学习单词数
    result = await db.execute(
        select(func.count(UserWordProgress.id))
        .where(and_(
            UserWordProgress.user_id == user_id,
            UserWordProgress.mastery_level >= 3  # 掌握度>=3算学会
        ))
    )
    total_words = result.scalar() or 0

    # 连续打卡天数
    from app.models.user import StudyCalendar
    result = await db.execute(
        select(StudyCalendar.study_date)
        .where(StudyCalendar.user_id == user_id)
        .order_by(StudyCalendar.study_date.desc())
        .limit(30)  # 只查最近30天
    )
    study_dates = [row[0] for row in result.fetchall()]

    consecutive_days = 0
    if study_dates:
        current_date = date.today()
        for i, study_date in enumerate(study_dates):
            expected_date = current_date - timedelta(days=i)
            if study_date == expected_date:
                consecutive_days += 1
            else:
                break

    return {
        'total_words': total_words,
        'consecutive_days': consecutive_days
    }


async def check_and_unlock_achievements(
    db: AsyncSession,
    user_id: int,
    stats: dict,
    test_score: Optional[int] = None,
    test_total: Optional[int] = None
) -> List[UnlockedAchievement]:
    """检查并解锁成就"""
    from app.models.user import Achievement as AchievementModel, UserAchievement

    # 获取所有成就
    result = await db.execute(select(AchievementModel))
    all_achievements = result.scalars().all()

    # 获取已解锁的成就ID
    result = await db.execute(
        select(UserAchievement.achievement_id)
        .where(UserAchievement.user_id == user_id)
    )
    unlocked_ids = set(row[0] for row in result.fetchall())

    newly_unlocked = []

    for achievement in all_achievements:
        if achievement.id in unlocked_ids:
            continue  # 已解锁,跳过

        should_unlock = False

        # 检查条件
        if achievement.condition_type == 'total_words':
            should_unlock = stats['total_words'] >= achievement.condition_value
        elif achievement.condition_type == 'consecutive_days':
            should_unlock = stats['consecutive_days'] >= achievement.condition_value
        elif achievement.condition_type == 'accuracy_rate' and test_score is not None and test_total is not None:
            accuracy = (test_score / test_total * 100) if test_total > 0 else 0
            should_unlock = accuracy >= achievement.condition_value
        elif achievement.condition_type == 'perfect_score' and test_score is not None and test_total is not None:
            should_unlock = test_score == test_total and test_total > 0

        if should_unlock:
            # 解锁成就
            user_achievement = UserAchievement(
                user_id=user_id,
                achievement_id=achievement.id
            )
            db.add(user_achievement)

            newly_unlocked.append(UnlockedAchievement(
                id=achievement.id,
                name=achievement.name,
                description=achievement.description or '',
                icon=achievement.icon or '🏆',
                reward_points=achievement.reward_points
            ))

    if newly_unlocked:
        await db.commit()

    return newly_unlocked


# ========================================
# API Endpoints
# ========================================

@router.get("/my", response_model=UserAchievementResponse)
async def get_my_achievements(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取当前用户的成就列表"""
    from app.models.user import Achievement as AchievementModel, UserAchievement

    # 获取所有成就
    result = await db.execute(select(AchievementModel))
    all_achievements = result.scalars().all()

    # 获取用户已解锁的成就
    result = await db.execute(
        select(UserAchievement)
        .where(UserAchievement.user_id == current_user.id)
    )
    user_achievements = {ua.achievement_id: ua for ua in result.scalars().all()}

    # 组合数据
    achievements_list = []
    total_points = 0

    for achievement in all_achievements:
        user_ach = user_achievements.get(achievement.id)
        is_unlocked = user_ach is not None

        achievements_list.append(Achievement(
            id=achievement.id,
            name=achievement.name,
            description=achievement.description,
            icon=achievement.icon,
            condition_type=achievement.condition_type,
            condition_value=achievement.condition_value,
            reward_points=achievement.reward_points,
            unlocked=is_unlocked,
            unlocked_at=user_ach.unlocked_at if user_ach else None
        ))

        if is_unlocked:
            total_points += achievement.reward_points

    return UserAchievementResponse(
        achievements=achievements_list,
        total_unlocked=len(user_achievements),
        total_points=total_points
    )


@router.post("/check", response_model=List[UnlockedAchievement])
async def check_achievements(
    request: CheckAchievementRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    检查并解锁新成就

    在学习完成后调用此接口,系统会自动检查是否满足成就条件并解锁
    """
    # 获取用户统计数据
    stats = await get_user_stats(db, current_user.id)

    # 检查并解锁成就
    newly_unlocked = await check_and_unlock_achievements(
        db=db,
        user_id=current_user.id,
        stats=stats,
        test_score=request.score,
        test_total=request.total
    )

    return newly_unlocked


@router.post("/record-study")
async def record_study(
    words_learned: int = 0,
    duration: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    记录学习打卡

    每天首次学习时调用,用于统计连续打卡天数
    """
    from app.models.user import StudyCalendar

    today = date.today()

    # 检查今天是否已打卡
    result = await db.execute(
        select(StudyCalendar)
        .where(and_(
            StudyCalendar.user_id == current_user.id,
            StudyCalendar.study_date == today
        ))
    )
    existing = result.scalar_one_or_none()

    if existing:
        # 更新今天的记录
        existing.words_learned += words_learned
        existing.duration += duration
    else:
        # 创建新记录
        calendar = StudyCalendar(
            user_id=current_user.id,
            study_date=today,
            words_learned=words_learned,
            duration=duration
        )
        db.add(calendar)

    await db.commit()

    return {"message": "学习记录已保存", "date": today}


@router.get("/stats")
async def get_my_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取当前用户的学习统计"""
    stats = await get_user_stats(db, current_user.id)

    # 获取总积分
    from app.models.user import UserAchievement, Achievement as AchievementModel
    result = await db.execute(
        select(func.sum(AchievementModel.reward_points))
        .join(UserAchievement, UserAchievement.achievement_id == AchievementModel.id)
        .where(UserAchievement.user_id == current_user.id)
    )
    total_points = result.scalar() or 0

    # 获取等级信息
    level_info = calculate_level(current_user.experience_points)

    return {
        **stats,
        'total_points': total_points,
        **level_info
    }


@router.post("/add-experience")
async def add_experience(
    points: int,
    reason: str = "学习奖励",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    添加经验值

    学习活动会自动获得经验值:
    - 学会一个单词: 10经验
    - 完成一次学习: 5经验
    - 连续打卡: 额外20经验
    - 完成作业: 50经验
    - 解锁成就: 成就积分等于经验值
    """
    old_level = current_user.level
    current_user.experience_points += points
    current_user.total_points += points

    # 重新计算等级
    level_info = calculate_level(current_user.experience_points)
    new_level = level_info['level']
    current_user.level = new_level

    await db.commit()

    level_up = new_level > old_level

    return {
        "message": f"{reason}: +{points}经验",
        "experience_gained": points,
        "level_up": level_up,
        "old_level": old_level,
        "new_level": new_level,
        **level_info
    }


@router.get("/leaderboard")
async def get_leaderboard(
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """获取等级排行榜"""
    result = await db.execute(
        select(User)
        .where(User.role == 'student')
        .order_by(User.level.desc(), User.experience_points.desc())
        .limit(limit)
    )
    users = result.scalars().all()

    leaderboard = []
    for rank, user in enumerate(users, 1):
        level_info = calculate_level(user.experience_points)
        leaderboard.append({
            "rank": rank,
            "user_id": user.id,
            "username": user.username,
            "full_name": user.full_name or user.username,
            **level_info
        })

    return leaderboard
