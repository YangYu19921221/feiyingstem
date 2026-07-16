from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc, Integer
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.timeutil import local_today_utc_range
from app.models.user import User, StudyCalendar
from app.models.learning import LearningProgress, StudySession, LearningRecord
from app.models.word import WordBook, Unit
from app.api.v1.auth import get_current_student

router = APIRouter()


@router.get("/daily-plan")
async def get_daily_plan(
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """今日智能任务: 把「到期复习 → 错题闯关 → 新词学习」编排成一条默认路径。

    间隔重复的效果取决于"到期了有没有真的复习",而孩子自选时永远选新词跳过复习——
    这里替他排好顺序,学生端只看到一个"开始今日任务"按钮。
    数据全部来自既有表,无新增状态;done 口径服务端统一判定,前端只管渲染。
    """
    from app.models.learning import WordMastery, ChallengeReview

    now = datetime.utcnow()
    day_start, day_end = local_today_utc_range()

    # 1) 记忆曲线到期复习词数(与 /student/review-due-count 同口径)
    review_due = (await db.execute(
        select(func.count(WordMastery.id)).where(and_(
            WordMastery.user_id == current_user.id,
            WordMastery.next_review_at.isnot(None),
            WordMastery.next_review_at <= now,
        ))
    )).scalar() or 0

    # 2) 错题闯关到期数
    challenge_due = (await db.execute(
        select(func.count(ChallengeReview.id)).where(and_(
            ChallengeReview.user_id == current_user.id,
            ChallengeReview.next_review_at <= now,
        ))
    )).scalar() or 0

    # 3) 今日已学词数(distinct lower(word),与教师端学情口径一致——
    #    单元隔离下同拼写多 word_id,按 word_id 算会虚高,学生端与老师端对不上)
    NEW_WORDS_TARGET = 10
    from app.models.word import Word
    today_words = (await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(LearningRecord)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id == current_user.id,
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
        ))
    )).scalar() or 0

    steps = [
        {
            "key": "review", "label": "记忆复习", "icon": "🧠",
            "desc": f"{review_due} 个词到期待复习" if review_due else "今日无到期复习",
            "count": review_due, "done": review_due == 0,
            "route": "/student/memory-curve",
        },
        {
            "key": "challenge", "label": "错题闯关", "icon": "⚔️",
            "desc": f"{challenge_due} 个错词等你征服" if challenge_due else "错题全部消灭",
            "count": challenge_due, "done": challenge_due == 0,
            "route": "/student/mistake-challenge",
        },
        {
            "key": "new", "label": "今日学词", "icon": "📚",
            "desc": f"已学 {min(today_words, NEW_WORDS_TARGET)}/{NEW_WORDS_TARGET} 个",
            "count": max(0, NEW_WORDS_TARGET - today_words),
            "done": today_words >= NEW_WORDS_TARGET,
            "route": "/dashboard",  # 前端跳"继续学习"入口(单元选择)
        },
    ]
    all_done = all(s["done"] for s in steps)
    return {
        "steps": steps,
        "all_done": all_done,
        "today_words": today_words,
        "target": NEW_WORDS_TARGET,
    }


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
    # 北京"今天"起点(UTC),与 UTC 存储的 started_at 比较;按北京日历日分天
    today_start, _ = local_today_utc_range()

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

    # 6. 学习总时长(分钟) - 优先从study_calendar汇总，兜底从StudySession计算
    result = await db.execute(
        select(func.sum(StudyCalendar.duration))
        .where(StudyCalendar.user_id == user_id)
    )
    calendar_seconds = result.scalar() or 0

    # 也从session的time_spent取
    result = await db.execute(
        select(func.sum(StudySession.time_spent))
        .where(StudySession.user_id == user_id)
    )
    session_seconds = result.scalar() or 0

    total_minutes = max(calendar_seconds, session_seconds) // 60

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

    # 满分轮次 / 总轮次：完整走完单元（words_studied >= word_count）才计入
    result = await db.execute(
        select(
            func.count().label("total"),
            func.sum(
                func.cast(
                    and_(
                        StudySession.wrong_count == 0,
                        StudySession.correct_count > 0,
                    ),
                    Integer,
                )
            ).label("perfect"),
        )
        .select_from(StudySession)
        .join(Unit, Unit.id == StudySession.unit_id)
        .where(
            and_(
                StudySession.user_id == user_id,
                StudySession.words_studied >= Unit.word_count,
                Unit.word_count > 0,
            )
        )
    )
    total_sessions, perfect_sessions = result.one()
    total_sessions = total_sessions or 0
    perfect_sessions = perfect_sessions or 0

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
