"""
教师端数据分析API
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc, Integer
from typing import List, Optional
from datetime import datetime, date, timedelta

from app.core.database import get_db
from app.models.user import User, StudyCalendar
from app.models.word import Word, WordBook, Unit, WordDefinition
from app.models.learning import WordMastery, LearningRecord, StudySession, LearningProgress
from app.schemas.teacher_analytics import (
    StudentLearningStats, ClassOverviewStats, WordDifficultyStats,
    LearningModeStats, StudentProgressDetail, StudentWeakPoint,
    ClassRanking, StudyTrendData
)
from app.api.v1.auth import get_current_teacher

router = APIRouter()


# ========================================
# 班级整体数据分析
# ========================================

@router.get("/class/overview", response_model=ClassOverviewStats)
async def get_class_overview(
    days: int = Query(30, ge=1, le=365, description="统计最近N天的数据"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取班级整体数据概览

    - 总学生数
    - 活跃学生数(最近7天有学习记录)
    - 总学习单词数
    - 平均掌握单词数
    - 平均准确率
    """
    # 1. 获取所有学生
    result = await db.execute(
        select(User).where(User.role == "student")
    )
    all_students = result.scalars().all()
    total_students = len(all_students)

    if total_students == 0:
        return ClassOverviewStats(
            total_students=0,
            active_students=0,
            total_words_studied=0,
            average_mastered_words=0.0,
            average_accuracy=0.0,
            total_study_hours=0.0,
            average_study_time_per_student=0.0
        )

    # 2. 统计活跃学生(最近7天有学习记录)
    seven_days_ago = date.today() - timedelta(days=7)
    result = await db.execute(
        select(func.count(func.distinct(StudyCalendar.user_id)))
        .where(StudyCalendar.study_date >= seven_days_ago)
    )
    active_students = result.scalar() or 0

    # 3. 统计总学习单词数
    result = await db.execute(
        select(func.count(func.distinct(WordMastery.word_id)))
        .join(User, WordMastery.user_id == User.id)
        .where(User.role == "student")
    )
    total_words_studied = result.scalar() or 0

    # 4. 统计平均掌握单词数(掌握度>=4)
    result = await db.execute(
        select(func.count(WordMastery.id))
        .join(User, WordMastery.user_id == User.id)
        .where(
            and_(
                User.role == "student",
                WordMastery.mastery_level >= 4
            )
        )
    )
    total_mastered = result.scalar() or 0
    average_mastered_words = total_mastered / total_students if total_students > 0 else 0

    # 5. 统计平均准确率
    result = await db.execute(
        select(
            func.sum(LearningRecord.is_correct.cast(Integer)).label('total_correct'),
            func.count(LearningRecord.id).label('total_records')
        )
        .join(User, LearningRecord.user_id == User.id)
        .where(User.role == "student")
    )
    row = result.first()
    total_correct = row.total_correct or 0
    total_records = row.total_records or 0
    average_accuracy = (total_correct / total_records * 100) if total_records > 0 else 0

    # 6. 统计总学习时长
    result = await db.execute(
        select(func.sum(StudyCalendar.duration))
        .join(User, StudyCalendar.user_id == User.id)
        .where(User.role == "student")
    )
    total_study_seconds = result.scalar() or 0
    total_study_hours = total_study_seconds / 3600

    average_study_time_per_student = total_study_hours / total_students if total_students > 0 else 0

    return ClassOverviewStats(
        total_students=total_students,
        active_students=active_students,
        total_words_studied=total_words_studied,
        average_mastered_words=round(average_mastered_words, 1),
        average_accuracy=round(average_accuracy, 2),
        total_study_hours=round(total_study_hours, 1),
        average_study_time_per_student=round(average_study_time_per_student, 1)
    )


@router.get("/class/students", response_model=List[StudentLearningStats])
async def get_all_students_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取所有学生的学习统计

    返回每个学生的:
    - 学习单词数
    - 掌握单词数
    - 平均掌握度
    - 学习天数
    - 学习时长
    - 准确率
    """
    # 获取所有学生
    result = await db.execute(
        select(User).where(User.role == "student")
    )
    students = result.scalars().all()

    students_stats = []

    for student in students:
        # 统计该学生的数据

        # 学习单词数
        result = await db.execute(
            select(func.count(WordMastery.id))
            .where(WordMastery.user_id == student.id)
        )
        total_words_studied = result.scalar() or 0

        # 掌握单词数
        result = await db.execute(
            select(func.count(WordMastery.id))
            .where(
                and_(
                    WordMastery.user_id == student.id,
                    WordMastery.mastery_level >= 4
                )
            )
        )
        mastered_words = result.scalar() or 0

        # 平均掌握度
        result = await db.execute(
            select(func.avg(WordMastery.mastery_level))
            .where(WordMastery.user_id == student.id)
        )
        average_mastery = result.scalar() or 0.0

        # 学习天数
        result = await db.execute(
            select(func.count(StudyCalendar.id))
            .where(StudyCalendar.user_id == student.id)
        )
        total_study_days = result.scalar() or 0

        # 学习时长
        result = await db.execute(
            select(func.sum(StudyCalendar.duration))
            .where(StudyCalendar.user_id == student.id)
        )
        total_study_time = result.scalar() or 0

        # 最后学习日期
        result = await db.execute(
            select(StudyCalendar.study_date)
            .where(StudyCalendar.user_id == student.id)
            .order_by(StudyCalendar.study_date.desc())
            .limit(1)
        )
        last_date_row = result.first()
        last_study_date = datetime.combine(last_date_row[0], datetime.min.time()) if last_date_row else None

        # 准确率
        result = await db.execute(
            select(
                func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
                func.count(LearningRecord.id).label('total')
            )
            .where(LearningRecord.user_id == student.id)
        )
        row = result.first()
        total_correct = row.correct or 0
        total_records = row.total or 0
        accuracy_rate = (total_correct / total_records * 100) if total_records > 0 else 0

        # 薄弱单词数(掌握度<3)
        result = await db.execute(
            select(func.count(WordMastery.id))
            .where(
                and_(
                    WordMastery.user_id == student.id,
                    WordMastery.mastery_level < 3
                )
            )
        )
        weak_words_count = result.scalar() or 0

        students_stats.append(StudentLearningStats(
            user_id=student.id,
            username=student.username,
            full_name=student.full_name or student.username,
            # 新字段(前端期望)
            words_learned=total_words_studied,
            total_learning_time=total_study_time,
            study_sessions=total_study_days,  # 暂时用学习天数代替会话数
            last_active=last_study_date,
            weak_words_count=weak_words_count,
            # 旧字段(保留兼容性)
            total_words_studied=total_words_studied,
            mastered_words=mastered_words,
            average_mastery=round(average_mastery, 2),
            total_study_days=total_study_days,
            total_study_time=total_study_time,
            last_study_date=last_study_date,
            total_correct=total_correct,
            total_wrong=total_records - total_correct,
            accuracy_rate=round(accuracy_rate, 2)
        ))

    return students_stats


# ========================================
# 学生个人数据分析
# ========================================

@router.get("/student/{student_id}/stats", response_model=StudentLearningStats)
async def get_student_stats(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取单个学生的详细统计"""
    # 验证学生是否存在
    result = await db.execute(
        select(User).where(
            and_(
                User.id == student_id,
                User.role == "student"
            )
        )
    )
    student = result.scalar_one_or_none()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"学生ID {student_id} 不存在"
        )

    # 复用上面的逻辑获取统计数据(简化处理)
    all_stats = await get_all_students_stats(db, current_user)
    for stats in all_stats:
        if stats.user_id == student_id:
            return stats

    # 如果没有任何学习记录,返回空统计
    return StudentLearningStats(
        user_id=student.id,
        username=student.username,
        full_name=student.full_name or student.username,
        # 新字段
        words_learned=0,
        total_learning_time=0,
        study_sessions=0,
        last_active=None,
        weak_words_count=0,
        # 旧字段
        total_words_studied=0,
        mastered_words=0,
        average_mastery=0.0,
        total_study_days=0,
        total_study_time=0,
        last_study_date=None,
        total_correct=0,
        total_wrong=0,
        accuracy_rate=0.0
    )


@router.get("/student/{student_id}/weak-points", response_model=List[StudentWeakPoint])
async def get_student_weak_points(
    student_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取学生的薄弱单词"""
    # 查询掌握度低的单词
    result = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, WordMastery.word_id == Word.id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(
            and_(
                WordMastery.user_id == student_id,
                WordMastery.mastery_level < 3
            )
        )
        .order_by(WordMastery.mastery_level.asc(), WordMastery.last_practiced_at.asc())
        .limit(limit)
    )
    rows = result.all()

    weak_points = []
    for mastery, word, definition in rows:
        total_attempts = mastery.correct_count + mastery.wrong_count
        error_rate = (mastery.wrong_count / total_attempts * 100) if total_attempts > 0 else 0
        accuracy_rate = 100 - error_rate

        # 获取该单词在哪些学习模式中出现过错误
        learning_modes = []
        if mastery.flashcard_wrong > 0:
            learning_modes.append('flashcard')
        if mastery.quiz_wrong > 0:
            learning_modes.append('quiz')
        if mastery.spelling_wrong > 0:
            learning_modes.append('spelling')
        if mastery.fillblank_wrong > 0:
            learning_modes.append('fillblank')

        # 如果last_practiced_at为空，使用created_at作为备用
        last_time = mastery.last_practiced_at or mastery.created_at

        weak_points.append(StudentWeakPoint(
            word_id=word.id,
            word=word.word,
            meaning=definition.meaning if definition else "无释义",
            mastery_level=mastery.mastery_level,
            correct_count=mastery.correct_count,
            wrong_count=mastery.wrong_count,
            error_count=mastery.wrong_count,  # 别名
            total_attempts=total_attempts,
            error_rate=round(error_rate, 2),
            accuracy_rate=round(accuracy_rate, 2),
            last_practiced_at=last_time,
            last_error_at=last_time,  # 别名
            learning_modes=learning_modes
        ))

    return weak_points


# ========================================
# 单词难度分析
# ========================================

@router.get("/words/difficulty", response_model=List[WordDifficultyStats])
async def get_words_difficulty_analysis(
    book_id: Optional[int] = Query(None, description="筛选单词本"),
    sort_by: str = Query("error_rate", description="排序方式: error_rate, attempts"),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取单词难度分析

    返回全班对每个单词的掌握情况:
    - 答题次数
    - 正确/错误次数
    - 错误率
    - 掌握/困难的学生数
    """
    # 查询所有学生的单词掌握情况
    query = select(
        Word.id.label('word_id'),
        Word.word,
        Word.phonetic,
        WordDefinition.meaning,
        func.count(WordMastery.id).label('students_count'),
        func.sum(WordMastery.total_encounters).label('total_attempts'),
        func.sum(WordMastery.correct_count).label('total_correct'),
        func.sum(WordMastery.wrong_count).label('total_wrong'),
        func.sum((WordMastery.mastery_level >= 4).cast(Integer)).label('students_mastered'),
        func.sum((WordMastery.mastery_level < 2).cast(Integer)).label('students_struggling')
    ).select_from(Word)\
     .join(WordMastery, Word.id == WordMastery.word_id)\
     .outerjoin(WordDefinition, and_(
         WordDefinition.word_id == Word.id,
         WordDefinition.is_primary == True
     ))\
     .join(User, WordMastery.user_id == User.id)\
     .where(User.role == "student")\
     .group_by(Word.id, Word.word, Word.phonetic, WordDefinition.meaning)

    # 如果指定了单词本,只查询该单词本的单词
    if book_id:
        from app.models.word import UnitWord, Unit
        query = query.join(UnitWord, Word.id == UnitWord.word_id)\
                     .join(Unit, UnitWord.unit_id == Unit.id)\
                     .where(Unit.book_id == book_id)

    result = await db.execute(query)
    rows = result.all()

    word_stats = []
    for row in rows:
        total_attempts = row.total_attempts or 0
        total_correct = row.total_correct or 0
        total_wrong = row.total_wrong or 0
        error_rate = (total_wrong / total_attempts * 100) if total_attempts > 0 else 0

        word_stats.append(WordDifficultyStats(
            word_id=row.word_id,
            word=row.word,
            phonetic=row.phonetic,
            meaning=row.meaning or "无释义",
            total_attempts=total_attempts,
            correct_count=total_correct,
            wrong_count=total_wrong,
            error_rate=round(error_rate, 2),
            students_mastered=row.students_mastered or 0,
            students_struggling=row.students_struggling or 0
        ))

    # 排序
    if sort_by == "error_rate":
        word_stats.sort(key=lambda x: x.error_rate, reverse=True)
    elif sort_by == "attempts":
        word_stats.sort(key=lambda x: x.total_attempts, reverse=True)

    return word_stats[:limit]


# ========================================
# 学习模式效果分析
# ========================================

@router.get("/modes/stats", response_model=List[LearningModeStats])
async def get_learning_modes_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取各学习模式的统计数据"""
    # 查询各模式的学习记录
    result = await db.execute(
        select(
            LearningRecord.learning_mode,
            func.count(LearningRecord.id).label('total_attempts'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct_count'),
            func.avg(LearningRecord.time_spent).label('avg_time')
        )
        .join(User, LearningRecord.user_id == User.id)
        .where(User.role == "student")
        .group_by(LearningRecord.learning_mode)
    )
    rows = result.all()

    # 查询各模式的会话数
    session_result = await db.execute(
        select(
            StudySession.learning_mode,
            func.count(StudySession.id).label('session_count')
        )
        .join(User, StudySession.user_id == User.id)
        .where(User.role == "student")
        .group_by(StudySession.learning_mode)
    )
    session_rows = session_result.all()
    session_dict = {row.learning_mode: row.session_count for row in session_rows}

    mode_stats = []
    for row in rows:
        total_attempts = row.total_attempts or 0
        correct_count = row.correct_count or 0
        wrong_count = total_attempts - correct_count
        avg_accuracy = (correct_count / total_attempts * 100) if total_attempts > 0 else 0
        avg_time = (row.avg_time / 1000) if row.avg_time else 0  # 毫秒转秒

        mode_stats.append(LearningModeStats(
            learning_mode=row.learning_mode or 'unknown',
            total_sessions=session_dict.get(row.learning_mode, 0),
            total_attempts=total_attempts,
            correct_count=correct_count,
            wrong_count=wrong_count,
            average_accuracy=round(avg_accuracy, 2),
            average_time_per_word=round(avg_time, 2)
        ))

    return mode_stats


# ========================================
# 班级排行榜
# ========================================

@router.get("/class/ranking", response_model=List[ClassRanking])
async def get_class_ranking(
    metric: str = Query("mastered_words", description="排行依据: mastered_words, accuracy, study_time"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取班级排行榜

    可选排行依据:
    - mastered_words: 掌握单词数
    - accuracy: 准确率
    - study_time: 学习时长
    """
    # 获取所有学生统计
    all_stats = await get_all_students_stats(db, current_user)

    # 根据指标排序
    metric_name_map = {
        "mastered_words": "掌握单词数",
        "accuracy": "准确率",
        "study_time": "学习时长"
    }

    if metric == "mastered_words":
        all_stats.sort(key=lambda x: x.mastered_words, reverse=True)
        score_func = lambda x: float(x.mastered_words)
    elif metric == "accuracy":
        all_stats.sort(key=lambda x: x.accuracy_rate, reverse=True)
        score_func = lambda x: x.accuracy_rate
    elif metric == "study_time":
        all_stats.sort(key=lambda x: x.total_study_time, reverse=True)
        score_func = lambda x: float(x.total_study_time / 3600)  # 转换为小时
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的排行指标: {metric}"
        )

    # 构建排行榜
    rankings = []
    for idx, stats in enumerate(all_stats[:limit], 1):
        rankings.append(ClassRanking(
            rank=idx,
            user_id=stats.user_id,
            username=stats.username,
            full_name=stats.full_name,
            score=round(score_func(stats), 2),
            metric_name=metric_name_map.get(metric, metric)
        ))

    return rankings
