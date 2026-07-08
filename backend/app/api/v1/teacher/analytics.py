"""
教师端数据分析API
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc, Integer
from typing import List, Optional
from datetime import datetime, date, timedelta

from app.core.database import get_db
from app.models.user import User, StudyCalendar, Class, ClassStudent
from app.models.word import Word, WordBook, Unit, WordDefinition
from app.models.learning import WordMastery, LearningRecord, StudySession, LearningProgress, HomeworkAssignment, HomeworkStudentAssignment, BookAssignment
from app.schemas.teacher_analytics import (
    StudentLearningStats, ClassOverviewStats, WordDifficultyStats,
    LearningModeStats, StudentProgressDetail, StudentWeakPoint,
    ClassRanking, StudyTrendData
)
from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import (
    get_my_class_student_ids,
    assert_student_in_my_class,
)
from app.api.v1._weekly_report import build_and_cache_weekly_report, WeeklyReportResponse

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
    # 0. 获取本教师班级内的学生ID集合
    my_student_ids = await get_my_class_student_ids(db, current_user.id)
    if not my_student_ids:
        return ClassOverviewStats(
            total_students=0,
            active_students=0,
            total_words_studied=0,
            average_mastered_words=0.0,
            average_accuracy=0.0,
            total_study_hours=0.0,
            average_study_time_per_student=0.0
        )

    # 1. 获取班级学生总数
    result = await db.execute(
        select(User).where(User.id.in_(my_student_ids))
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
        .where(
            and_(
                StudyCalendar.study_date >= seven_days_ago,
                StudyCalendar.user_id.in_(my_student_ids)
            )
        )
    )
    active_students = result.scalar() or 0

    # 3. 统计总学习单词数
    result = await db.execute(
        select(func.count(func.distinct(WordMastery.word_id)))
        .where(WordMastery.user_id.in_(my_student_ids))
    )
    total_words_studied = result.scalar() or 0

    # 4. 统计平均掌握单词数(掌握线对齐为 >=3;注:此处按 WordMastery 行计数,
    #    未按 lower(word) 去重,与 admin/student 端的去重口径略有差异)
    result = await db.execute(
        select(func.count(WordMastery.id))
        .where(
            and_(
                WordMastery.user_id.in_(my_student_ids),
                WordMastery.mastery_level >= 3
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
        .where(LearningRecord.user_id.in_(my_student_ids))
    )
    row = result.first()
    total_correct = row.total_correct or 0
    total_records = row.total_records or 0
    average_accuracy = (total_correct / total_records * 100) if total_records > 0 else 0

    # 6. 统计总学习时长
    result = await db.execute(
        select(func.sum(StudyCalendar.duration))
        .where(StudyCalendar.user_id.in_(my_student_ids))
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
    my_student_ids = await get_my_class_student_ids(db, current_user.id)
    if not my_student_ids:
        return []
    return await _build_students_stats(db, student_ids=my_student_ids)


async def _build_students_stats(
    db: AsyncSession,
    student_id: int | None = None,
    student_ids: set[int] | None = None,
) -> list[StudentLearningStats]:
    """
    聚合查询所有（或单个）学生的学习统计，避免 N+1。

    优先级：student_id > student_ids > 全部（不推荐，应通过调用方传 student_ids）
    当 student_id 不为 None 时，只返回该学生的统计。
    当 student_ids 不为 None 时，只返回该集合内学生的统计。
    """
    # 学生基本信息
    if student_id is not None:
        student_query = select(User).where(
            and_(User.role == "student", User.id == student_id)
        )
    elif student_ids is not None:
        student_query = select(User).where(User.id.in_(student_ids))
    else:
        raise ValueError("_build_students_stats requires student_id or student_ids; bare call is unsafe")

    result = await db.execute(student_query)
    students = result.scalars().all()
    if not students:
        return []
    student_map = {s.id: s for s in students}

    # 用于子查询过滤的 user_id 集合
    uid_set = {student_id} if student_id is not None else set(student_map.keys())

    # --- 聚合1: WordMastery 统计 (学习数/掌握数/平均掌握度/薄弱数) ---
    result = await db.execute(
        select(
            WordMastery.user_id,
            func.count(WordMastery.id).label("total_words"),
            func.sum((WordMastery.mastery_level >= 4).cast(Integer)).label("mastered"),
            func.avg(WordMastery.mastery_level).label("avg_mastery"),
            func.sum((WordMastery.mastery_level < 3).cast(Integer)).label("weak"),
        )
        .where(WordMastery.user_id.in_(uid_set))
        .group_by(WordMastery.user_id)
    )
    mastery_map = {}
    for row in result.all():
        mastery_map[row.user_id] = {
            "total_words": row.total_words or 0,
            "mastered": row.mastered or 0,
            "avg_mastery": row.avg_mastery or 0.0,
            "weak": row.weak or 0,
        }

    # --- 聚合2: StudyCalendar 统计 (学习天数/总时长/最后学习日期) ---
    result = await db.execute(
        select(
            StudyCalendar.user_id,
            func.count(StudyCalendar.id).label("study_days"),
            func.sum(StudyCalendar.duration).label("total_duration"),
            func.max(StudyCalendar.study_date).label("last_date"),
        )
        .where(StudyCalendar.user_id.in_(uid_set))
        .group_by(StudyCalendar.user_id)
    )
    calendar_map = {}
    for row in result.all():
        last_dt = datetime.combine(row.last_date, datetime.min.time()) if row.last_date else None
        calendar_map[row.user_id] = {
            "study_days": row.study_days or 0,
            "total_duration": row.total_duration or 0,
            "last_date": last_dt,
        }

    # --- 聚合3: LearningRecord 统计 (正确数/总数) ---
    result = await db.execute(
        select(
            LearningRecord.user_id,
            func.sum(LearningRecord.is_correct.cast(Integer)).label("correct"),
            func.count(LearningRecord.id).label("total"),
        )
        .where(LearningRecord.user_id.in_(uid_set))
        .group_by(LearningRecord.user_id)
    )
    record_map = {}
    for row in result.all():
        record_map[row.user_id] = {
            "correct": row.correct or 0,
            "total": row.total or 0,
        }

    # --- 组装结果 ---
    stats_list: list[StudentLearningStats] = []
    for sid, student in student_map.items():
        m = mastery_map.get(sid, {})
        c = calendar_map.get(sid, {})
        r = record_map.get(sid, {})

        total_words = m.get("total_words", 0)
        mastered_words = m.get("mastered", 0)
        avg_mastery = m.get("avg_mastery", 0.0)
        weak_count = m.get("weak", 0)

        study_days = c.get("study_days", 0)
        total_time = c.get("total_duration", 0)
        last_date = c.get("last_date")

        total_correct = r.get("correct", 0)
        total_records = r.get("total", 0)
        accuracy = (total_correct / total_records * 100) if total_records > 0 else 0

        stats_list.append(StudentLearningStats(
            user_id=sid,
            username=student.username,
            full_name=student.full_name or student.username,
            words_learned=total_words,
            total_learning_time=total_time,
            study_sessions=study_days,
            last_active=last_date,
            weak_words_count=weak_count,
            total_words_studied=total_words,
            mastered_words=mastered_words,
            average_mastery=round(avg_mastery, 2),
            total_study_days=study_days,
            total_study_time=total_time,
            last_study_date=last_date,
            total_correct=total_correct,
            total_wrong=total_records - total_correct,
            accuracy_rate=round(accuracy, 2),
        ))

    return stats_list


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
    # 验证该学生是否属于当前教师的班级
    await assert_student_in_my_class(db, current_user.id, student_id)

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

    # 只查询该学生的统计数据
    stats_list = await _build_students_stats(db, student_id=student_id)
    if stats_list:
        return stats_list[0]

    # 如果没有任何学习记录,返回空统计
    return StudentLearningStats(
        user_id=student.id,
        username=student.username,
        full_name=student.full_name or student.username,
        words_learned=0,
        total_learning_time=0,
        study_sessions=0,
        last_active=None,
        weak_words_count=0,
        total_words_studied=0,
        mastered_words=0,
        average_mastery=0.0,
        total_study_days=0,
        total_study_time=0,
        last_study_date=None,
        total_correct=0,
        total_wrong=0,
        accuracy_rate=0.0,
    )


@router.get("/student/{student_id}/weak-points", response_model=List[StudentWeakPoint])
async def get_student_weak_points(
    student_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取学生的薄弱单词"""
    # 验证该学生是否属于当前教师的班级
    await assert_student_in_my_class(db, current_user.id, student_id)

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
    my_student_ids = await get_my_class_student_ids(db, current_user.id)
    if not my_student_ids:
        return []

    # 查询班级内学生的单词掌握情况
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
     .where(WordMastery.user_id.in_(my_student_ids))\
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
    my_student_ids = await get_my_class_student_ids(db, current_user.id)
    if not my_student_ids:
        return []

    # 查询各模式的学习记录
    result = await db.execute(
        select(
            LearningRecord.learning_mode,
            func.count(LearningRecord.id).label('total_attempts'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct_count'),
            func.avg(LearningRecord.time_spent).label('avg_time')
        )
        .where(LearningRecord.user_id.in_(my_student_ids))
        .group_by(LearningRecord.learning_mode)
    )
    rows = result.all()

    # 查询各模式的会话数
    session_result = await db.execute(
        select(
            StudySession.learning_mode,
            func.count(StudySession.id).label('session_count')
        )
        .where(StudySession.user_id.in_(my_student_ids))
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
    my_student_ids = await get_my_class_student_ids(db, current_user.id)
    if not my_student_ids:
        return []

    # 获取本班学生统计
    all_stats = await _build_students_stats(db, student_ids=my_student_ids)

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


@router.get("/student/{student_id}/word-trends")
async def get_student_word_trends(
    student_id: int,
    period: str = Query("daily", regex="^(daily|monthly|yearly)$"),
    year: int = Query(None),
    month: int = Query(None),
    current_user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """获取指定学生的单词学习趋势（日/月/年）"""
    # 验证该学生是否属于当前教师的班级
    await assert_student_in_my_class(db, current_user.id, student_id)

    from app.api.v1.analytics import fetch_word_trends

    today = date.today()
    if year is None:
        year = today.year
    if month is None:
        month = today.month

    return await fetch_word_trends(db, student_id, period, year, month)


# ========================================
# 按班级 ID 的数据接口（Task 9）
# ========================================

@router.get("/classes/{class_id}/overview")
async def get_class_id_overview(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """获取指定班级的概览统计"""
    # 验证班级属于当前教师
    cls_res = await db.execute(
        select(Class).where(Class.id == class_id, Class.teacher_id == current_user.id)
    )
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="班级不存在或无权访问")

    # 获取该班级的活跃学生 ID
    stu_res = await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    student_ids = [row[0] for row in stu_res.all()]
    if not student_ids:
        return {
            "student_count": 0,
            "avg_accuracy": 0.0,
            "total_words_studied": 0,
            "mastered_words": 0,
        }

    # 聚合 WordMastery
    agg_res = await db.execute(
        select(
            func.count(func.distinct(WordMastery.word_id)).label("total_words_studied"),
            func.sum(WordMastery.correct_count).label("correct"),
            func.sum(WordMastery.total_encounters).label("attempts"),
        ).where(WordMastery.user_id.in_(student_ids))
    )
    agg = agg_res.one()
    total_words_studied = agg.total_words_studied or 0
    correct = int(agg.correct or 0)
    attempts = int(agg.attempts or 0)
    avg_accuracy = round(correct / attempts, 4) if attempts else 0.0

    mastered_res = await db.execute(
        select(func.count(WordMastery.id)).where(
            WordMastery.user_id.in_(student_ids),
            WordMastery.mastery_level >= 4,
        )
    )
    mastered_words = mastered_res.scalar() or 0

    return {
        "student_count": len(student_ids),
        "avg_accuracy": avg_accuracy,
        "total_words_studied": total_words_studied,
        "mastered_words": mastered_words,
    }


@router.get("/classes/{class_id}/word-completion")
async def get_class_word_completion(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """获取指定班级每个单词的学习/掌握情况"""
    cls_res = await db.execute(
        select(Class).where(Class.id == class_id, Class.teacher_id == current_user.id)
    )
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="班级不存在或无权访问")

    stu_res = await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    student_ids = [row[0] for row in stu_res.all()]
    if not student_ids:
        return []

    rows_res = await db.execute(
        select(
            WordMastery.word_id,
            Word.word,
            func.count(func.distinct(WordMastery.user_id)).label("learners"),
            func.sum(
                func.cast(WordMastery.mastery_level >= 4, Integer)
            ).label("mastered"),
        )
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id.in_(student_ids))
        .group_by(WordMastery.word_id, Word.word)
        .order_by(desc("learners"))
    )
    result = []
    for row in rows_res.all():
        result.append({
            "word_id": row.word_id,
            "word": row.word,
            "learners": row.learners,
            "mastered": int(row.mastered or 0),
        })
    return result


@router.get("/classes/{class_id}/assignments-progress")
async def get_class_assignments_progress(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """获取指定班级的所有分配作业进度"""
    cls_res = await db.execute(
        select(Class).where(Class.id == class_id, Class.teacher_id == current_user.id)
    )
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="班级不存在或无权访问")

    stu_res = await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    student_ids = [row[0] for row in stu_res.all()]
    if not student_ids:
        return {"book_assignments": [], "homework_assignments": []}

    # 单词本分配
    ba_res = await db.execute(
        select(BookAssignment).where(BookAssignment.student_id.in_(student_ids))
    )
    book_assignments = [
        {
            "id": ba.id,
            "book_id": ba.book_id,
            "scope_type": ba.scope_type,
            "unit_id": ba.unit_id,
            "group_index": ba.group_index,
            "is_completed": ba.is_completed,
            "student_id": ba.student_id,
        }
        for ba in ba_res.scalars().all()
    ]

    # 作业分配
    hw_res = await db.execute(
        select(
            HomeworkAssignment.id.label("homework_id"),
            HomeworkAssignment.title,
            HomeworkStudentAssignment.student_id,
            HomeworkStudentAssignment.status,
            HomeworkStudentAssignment.best_score,
        )
        .join(
            HomeworkStudentAssignment,
            HomeworkStudentAssignment.homework_id == HomeworkAssignment.id,
        )
        .where(HomeworkStudentAssignment.student_id.in_(student_ids))
    )
    homework_assignments = [
        {
            "homework_id": row.homework_id,
            "title": row.title,
            "student_id": row.student_id,
            "status": row.status,
            "best_score": row.best_score,
        }
        for row in hw_res.all()
    ]

    return {
        "book_assignments": book_assignments,
        "homework_assignments": homework_assignments,
    }


def _ranking_period_range(period: str):
    """把 period 解析成 UTC naive 区间 [start, end)；'all' 返回 (None, None)。
    周/月的日历边界计算复用 timeutil,与学生端 leaderboard 口径一致。"""
    from app.core.timeutil import (
        local_today, local_day_utc_range, local_week_utc_range, local_month_utc_range,
    )
    if period == "all":
        return None, None
    today = local_today()
    if period == "today":
        return local_day_utc_range(today)
    if period == "this_week":
        return local_week_utc_range(today)
    if period == "this_month":
        return local_month_utc_range(today)
    raise HTTPException(status_code=400, detail=f"不支持的时间维度: {period}")


async def _period_ranking_scores(db, student_ids, metric, start, end) -> dict:
    """周期口径下每个学生的分值。
    - mastered_words: 周期内答对的不重复 word_id 数（可回溯，替代累计快照）
    - study_time: 周期内 StudySession 时长(小时)
    - accuracy: 周期内答题正确率(%)
    """
    if metric == "mastered_words":
        res = await db.execute(
            select(
                LearningRecord.user_id,
                func.count(func.distinct(LearningRecord.word_id)),
            ).where(and_(
                LearningRecord.user_id.in_(student_ids),
                LearningRecord.is_correct.is_(True),
                LearningRecord.created_at >= start,
                LearningRecord.created_at < end,
            )).group_by(LearningRecord.user_id)
        )
        return {uid: float(v or 0) for uid, v in res.all()}
    if metric == "study_time":
        res = await db.execute(
            select(
                StudySession.user_id,
                func.coalesce(func.sum(StudySession.time_spent), 0),
            ).where(and_(
                StudySession.user_id.in_(student_ids),
                StudySession.started_at >= start,
                StudySession.started_at < end,
            )).group_by(StudySession.user_id)
        )
        return {uid: round(float(v or 0) / 3600, 2) for uid, v in res.all()}
    # accuracy
    res = await db.execute(
        select(
            LearningRecord.user_id,
            func.count(LearningRecord.id),
            func.sum(LearningRecord.is_correct.cast(Integer)),
        ).where(and_(
            LearningRecord.user_id.in_(student_ids),
            LearningRecord.created_at >= start,
            LearningRecord.created_at < end,
        )).group_by(LearningRecord.user_id)
    )
    out = {}
    for uid, total, correct in res.all():
        out[uid] = round((correct or 0) / total * 100, 2) if total else 0.0
    return out


@router.get("/classes/{class_id}/ranking", response_model=List[ClassRanking])
async def get_class_id_ranking(
    class_id: int,
    metric: str = Query("mastered_words", description="排行依据: mastered_words, accuracy, study_time"),
    period: str = Query("all", description="时间维度: today, this_week, this_month, all"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    获取指定班级的排行榜

    时间维度 period:
    - today / this_week / this_month: 该周期内的表现（按北京时间）
    - all: 累计（mastered_words 为掌握度≥4 快照，accuracy/study_time 为全期聚合）

    排行依据 metric:
    - mastered_words: 掌握单词数（周期口径 = 周期内答对的不重复单词数）
    - study_time: 学习时长（小时）
    - accuracy: 正确率（%）
    """
    if metric not in ("mastered_words", "accuracy", "study_time"):
        raise HTTPException(status_code=400, detail=f"不支持的排行指标: {metric}")

    cls_res = await db.execute(
        select(Class).where(Class.id == class_id, Class.teacher_id == current_user.id)
    )
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="班级不存在或无权访问")

    stu_res = await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    student_ids = {row[0] for row in stu_res.all()}
    if not student_ids:
        return []

    metric_name_map = {
        "mastered_words": "掌握单词数",
        "accuracy": "正确率",
        "study_time": "学习时长",
    }

    # 学生基本信息（用于展示名字）
    users_res = await db.execute(select(User).where(User.id.in_(student_ids)))
    users = {u.id: u for u in users_res.scalars().all()}

    start, end = _ranking_period_range(period)

    if period == "all":
        # 累计口径：复用既有聚合（mastered_words 用真实掌握度快照）
        all_stats = await _build_students_stats(db, student_ids=student_ids)
        if metric == "mastered_words":
            score_map = {s.user_id: float(s.mastered_words) for s in all_stats}
        elif metric == "accuracy":
            score_map = {s.user_id: s.accuracy_rate for s in all_stats}
        else:
            score_map = {s.user_id: round(s.total_study_time / 3600, 2) for s in all_stats}
    else:
        score_map = await _period_ranking_scores(db, student_ids, metric, start, end)

    # 组装：所有在册学生都列出（无数据补 0），按分值降序
    rows = []
    for uid in student_ids:
        u = users.get(uid)
        if not u:
            continue
        rows.append((uid, u, score_map.get(uid, 0.0)))
    rows.sort(key=lambda x: x[2], reverse=True)

    rankings = []
    for idx, (uid, u, score) in enumerate(rows[:limit], 1):
        rankings.append(ClassRanking(
            rank=idx,
            user_id=uid,
            username=u.username,
            full_name=u.full_name or u.username,
            score=round(score, 2),
            metric_name=metric_name_map.get(metric, metric),
        ))

    return rankings


# ========================================
# 学生 AI 学情周报
# ========================================

@router.get("/student/{student_id}/weekly-report", response_model=WeeklyReportResponse)
async def get_student_weekly_report(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """教师查看本班学生本周 AI 学情周报(与家长端共用同一份缓存)。"""
    await assert_student_in_my_class(db, current_user.id, student_id)
    return await build_and_cache_weekly_report(db, student_id, force=False)


@router.post("/student/{student_id}/weekly-report/regenerate", response_model=WeeklyReportResponse)
async def regenerate_student_weekly_report(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """教师强制重新生成本周周报。"""
    await assert_student_in_my_class(db, current_user.id, student_id)
    return await build_and_cache_weekly_report(db, student_id, force=True)
