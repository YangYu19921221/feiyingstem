"""
学习记录API - 记录学生的学习数据
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import List
from datetime import datetime, date, timedelta
from collections import defaultdict
import logging

from app.core.database import get_db
from app.models.user import User, StudyCalendar
from app.models.word import Unit, Word, WordDefinition
from app.models.learning import (
    LearningRecord, WordMastery, StudySession, LearningProgress
)
from app.schemas.learning_record import (
    LearningRecordBatchCreate, LearningRecordResponse,
    StudySessionCreate, StudySessionUpdate, StudySessionResponse,
    WordMasteryResponse, StudyCalendarUpdate,
    ReviewWordResponse, ReviewRecordBatchCreate
)
from app.api.v1.auth import get_current_student
from app.services.learning_quality import learning_quality_service

router = APIRouter()
logger = logging.getLogger(__name__)

# 艾宾浩斯间隔重复时间表（小时）
SRS_INTERVALS = [
    0.083,   # Stage 0→1: 5分钟
    0.5,     # Stage 1→2: 30分钟
    12,      # Stage 2→3: 12小时
    24,      # Stage 3→4: 1天
    48,      # Stage 4→5: 2天
    96,      # Stage 5→6: 4天
    168,     # Stage 6→7: 7天
    360,     # Stage 7→8: 15天
    720,     # Stage 8→毕业: 30天
]

SRS_LABELS = ["5分钟", "30分钟", "12小时", "1天", "2天", "4天", "7天", "15天", "30天", "已掌握"]


async def update_study_calendar(db: AsyncSession, user_id: int, record_count: int, total_time_ms: int):
    """更新学习日历（共用辅助函数）"""
    today = date.today()
    result = await db.execute(
        select(StudyCalendar).where(
            and_(StudyCalendar.user_id == user_id, StudyCalendar.study_date == today)
        )
    )
    calendar_record = result.scalar_one_or_none()

    if calendar_record:
        calendar_record.words_learned += record_count
        calendar_record.duration += total_time_ms // 1000
    else:
        calendar_record = StudyCalendar(
            user_id=user_id,
            study_date=today,
            words_learned=record_count,
            duration=total_time_ms // 1000
        )
        db.add(calendar_record)


# ========================================
# 学习记录 API
# ========================================

@router.post("/records", response_model=dict)
async def create_learning_records(
    data: LearningRecordBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    批量创建学习记录

    功能:
    1. 记录每个单词的答题情况
    2. 更新单词掌握度
    3. 更新学习日历
    """
    user_id = current_user.id

    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == data.unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {data.unit_id} 不存在"
        )

    # 2. 创建学习记录并更新单词掌握度
    created_records = []
    total_correct = 0
    total_wrong = 0

    for record_data in data.records:
        # 创建学习记录
        learning_record = LearningRecord(
            user_id=user_id,
            word_id=record_data.word_id,
            learning_mode=record_data.learning_mode,
            is_correct=record_data.is_correct,
            time_spent=record_data.time_spent
        )
        db.add(learning_record)
        created_records.append(learning_record)

        if record_data.is_correct:
            total_correct += 1
        else:
            total_wrong += 1

        # 更新或创建单词掌握度记录
        await update_word_mastery(
            db, user_id, record_data.word_id,
            record_data.learning_mode, record_data.is_correct
        )

    # 3. 更新学习日历
    total_time_ms = sum(r.time_spent for r in data.records)
    await update_study_calendar(db, user_id, len(data.records), total_time_ms)

    await db.commit()

    # 4. 计算学习质量分数
    records_for_analysis = [
        {
            "word_id": r.word_id,
            "is_correct": r.is_correct,
            "time_spent": r.time_spent,
        }
        for r in data.records
    ]
    quality_result = learning_quality_service.calculate_quality_score(records_for_analysis)

    # 如果检测到可疑行为，记录日志
    if quality_result.get("suspicious"):
        logger.warning(
            f"可疑学习行为: user_id={user_id}, unit_id={data.unit_id}, "
            f"flags={quality_result.get('flags')}, score={quality_result.get('score')}"
        )

    return {
        "success": True,
        "message": f"成功记录 {len(created_records)} 条学习数据",
        "total_records": len(created_records),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "quality": {
            "score": quality_result.get("score", 50),
            "level": learning_quality_service.get_quality_level(quality_result.get("score", 50)),
            "flags": quality_result.get("flags", []),
            "suspicious": quality_result.get("suspicious", False)
        }
    }


async def update_word_mastery(
    db: AsyncSession,
    user_id: int,
    word_id: int,
    learning_mode: str,
    is_correct: bool
):
    """更新单词掌握度"""
    # 查询现有掌握度记录
    result = await db.execute(
        select(WordMastery).where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id == word_id
            )
        )
    )
    mastery = result.scalar_one_or_none()

    if not mastery:
        # 创建新记录
        mastery = WordMastery(
            user_id=user_id,
            word_id=word_id,
            total_encounters=0,
            correct_count=0,
            wrong_count=0,
            mastery_level=0,
            flashcard_correct=0,
            flashcard_wrong=0,
            quiz_correct=0,
            quiz_wrong=0,
            spelling_correct=0,
            spelling_wrong=0,
            fillblank_correct=0,
            fillblank_wrong=0,
        )
        db.add(mastery)

    # 更新统计数据
    mastery.total_encounters += 1
    if is_correct:
        mastery.correct_count += 1
    else:
        mastery.wrong_count += 1

    # 更新各模式统计
    mode_mapping = {
        'flashcard': ('flashcard_correct', 'flashcard_wrong'),
        'quiz': ('quiz_correct', 'quiz_wrong'),
        'spelling': ('spelling_correct', 'spelling_wrong'),
        'fillblank': ('fillblank_correct', 'fillblank_wrong')
    }

    if learning_mode in mode_mapping:
        correct_field, wrong_field = mode_mapping[learning_mode]
        if is_correct:
            current_value = getattr(mastery, correct_field, 0) or 0
            setattr(mastery, correct_field, current_value + 1)
        else:
            current_value = getattr(mastery, wrong_field, 0) or 0
            setattr(mastery, wrong_field, current_value + 1)

    # 🆕 优化掌握度等级计算 (0-5级) - 基于艾宾浩斯遗忘曲线
    if mastery.total_encounters > 0:
        accuracy = mastery.correct_count / mastery.total_encounters

        # 等级5 - 完全掌握: 连续5次正确,准确率>=90%
        if mastery.correct_count >= 5 and accuracy >= 0.90:
            mastery.mastery_level = 5

        # 等级4 - 熟练掌握: 至少答对4次,准确率>=80%
        elif mastery.correct_count >= 4 and accuracy >= 0.80:
            mastery.mastery_level = 4

        # 等级3 - 基本掌握: 至少答对3次,准确率>=70%
        elif mastery.correct_count >= 3 and accuracy >= 0.70:
            mastery.mastery_level = 3

        # 等级2 - 初步认识: 至少答对2次,或答对1次且准确率>=60%
        elif mastery.correct_count >= 2 or (mastery.correct_count >= 1 and accuracy >= 0.60):
            mastery.mastery_level = 2

        # 等级1 - 刚接触: 答对过1次
        elif mastery.correct_count >= 1:
            mastery.mastery_level = 1

        # 等级0 - 未掌握: 从未答对
        else:
            mastery.mastery_level = 0

    # 更新时间戳
    mastery.last_practiced_at = datetime.utcnow()

    # 计算下次复习时间(艾宾浩斯间隔重复算法)
    if is_correct:
        current_stage = mastery.review_stage or 0
        if current_stage < len(SRS_INTERVALS):
            interval_hours = SRS_INTERVALS[current_stage]
            mastery.review_stage = current_stage + 1
        else:
            interval_hours = 720  # 毕业后30天复习一次
            mastery.review_stage = len(SRS_INTERVALS)
    else:
        # 答错回退2个阶段（不完全重置，避免因一次失误惩罚过重）
        current_stage = mastery.review_stage or 0
        mastery.review_stage = max(0, current_stage - 2)
        interval_hours = SRS_INTERVALS[mastery.review_stage]

    mastery.next_review_at = datetime.utcnow() + timedelta(hours=interval_hours)


# ========================================
# 学习会话 API
# ========================================

@router.post("/sessions", response_model=StudySessionResponse)
async def create_study_session(
    data: StudySessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    开始学习会话

    当学生开始学习一个单元时调用此接口
    """
    user_id = current_user.id

    # 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == data.unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {data.unit_id} 不存在"
        )

    # 创建学习会话
    session = StudySession(
        user_id=user_id,
        book_id=unit.book_id,
        unit_id=data.unit_id,
        learning_mode=data.learning_mode,
        words_studied=0,
        correct_count=0,
        wrong_count=0,
        time_spent=0
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return session


@router.put("/sessions/{session_id}", response_model=StudySessionResponse)
async def update_study_session(
    session_id: int,
    data: StudySessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    更新学习会话

    当学生完成学习时调用此接口
    """
    user_id = current_user.id

    # 查询会话
    result = await db.execute(
        select(StudySession).where(
            and_(
                StudySession.id == session_id,
                StudySession.user_id == user_id
            )
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="学习会话不存在"
        )

    # 更新会话数据
    session.words_studied = data.words_studied
    session.correct_count = data.correct_count
    session.wrong_count = data.wrong_count
    session.time_spent = data.time_spent
    session.ended_at = datetime.utcnow()

    await db.commit()
    await db.refresh(session)

    return session


# ========================================
# 单词掌握度 API
# ========================================

@router.get("/mastery/{word_id}", response_model=WordMasteryResponse)
async def get_word_mastery(
    word_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取单个单词的掌握度"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery).where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id == word_id
            )
        )
    )
    mastery = result.scalar_one_or_none()

    if not mastery:
        # 返回一个默认的掌握度对象,而不是404错误
        # 这样前端就不会看到404错误了
        from datetime import datetime
        return WordMasteryResponse(
            id=0,
            user_id=user_id,
            word_id=word_id,
            total_encounters=0,
            correct_count=0,
            wrong_count=0,
            mastery_level=0,
            flashcard_correct=0,
            flashcard_wrong=0,
            quiz_correct=0,
            quiz_wrong=0,
            spelling_correct=0,
            spelling_wrong=0,
            fillblank_correct=0,
            fillblank_wrong=0,
            last_practiced_at=None,
            next_review_at=None,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )

    return mastery


@router.get("/mastery", response_model=List[WordMasteryResponse])
async def get_all_mastery(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取所有单词的掌握度"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery)
        .where(WordMastery.user_id == user_id)
        .order_by(WordMastery.last_practiced_at.desc())
        .offset(skip)
        .limit(limit)
    )
    masteries = result.scalars().all()

    return masteries


@router.get("/weak-words", response_model=List[WordMasteryResponse])
async def get_weak_words(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取薄弱单词(掌握度低的单词)"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery)
        .where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.mastery_level < 3
            )
        )
        .order_by(WordMastery.mastery_level.asc(), WordMastery.last_practiced_at.asc())
        .limit(limit)
    )
    weak_words = result.scalars().all()

    return weak_words


@router.get("/review-due", response_model=List[ReviewWordResponse])
async def get_review_due_words(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取需要复习的单词（含完整单词信息）"""
    user_id = current_user.id
    now = datetime.utcnow()

    result = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, WordMastery.word_id == Word.id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(and_(
            WordMastery.user_id == user_id,
            WordMastery.next_review_at <= now
        ))
        .order_by(WordMastery.next_review_at.asc())
        .limit(limit)
    )
    rows = result.all()

    review_words = []
    for mastery, word, definition in rows:
        review_words.append(ReviewWordResponse(
            mastery_id=mastery.id,
            word_id=word.id,
            mastery_level=mastery.mastery_level,
            review_stage=mastery.review_stage or 0,
            next_review_at=mastery.next_review_at,
            last_practiced_at=mastery.last_practiced_at,
            word=word.word,
            phonetic=word.phonetic,
            syllables=word.syllables,
            meaning=definition.meaning if definition else None,
            part_of_speech=definition.part_of_speech if definition else None,
            example_sentence=definition.example_sentence if definition else None,
            example_translation=definition.example_translation if definition else None,
            difficulty=word.difficulty or 1,
        ))

    return review_words


@router.get("/memory-curve-stats")
async def get_memory_curve_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取记忆曲线统计数据"""
    user_id = current_user.id
    now = datetime.utcnow()

    # 查询该用户所有的单词掌握记录
    result = await db.execute(
        select(WordMastery).where(WordMastery.user_id == user_id)
    )
    all_mastery = result.scalars().all()

    if not all_mastery:
        return {
            "due_today": 0,
            "due_tomorrow": 0,
            "upcoming_7_days": [],
            "stage_distribution": [
                {"stage": i, "label": SRS_LABELS[i], "count": 0}
                for i in range(len(SRS_LABELS))
            ],
            "total_learned": 0,
            "total_mastered": 0,
            "retention_rate": 0,
        }

    # 预计算7天的日期边界
    day_boundaries = []
    for day_offset in range(7):
        day_start = (now + timedelta(days=day_offset)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        day_boundaries.append((day_start, day_end, day_offset))

    tomorrow = now + timedelta(days=1)

    # 单次遍历统计所有指标
    due_today = 0
    due_tomorrow = 0
    day_counts = [0] * 7
    stage_counts = defaultdict(int)
    total_mastered = 0
    mastered_count = 0

    for m in all_mastery:
        stage = m.review_stage or 0
        stage_counts[stage] += 1

        if stage >= len(SRS_INTERVALS):
            total_mastered += 1
        if m.mastery_level >= 3:
            mastered_count += 1

        if m.next_review_at:
            if m.next_review_at <= now:
                due_today += 1
            elif m.next_review_at <= tomorrow:
                due_tomorrow += 1

            for day_start, day_end, offset in day_boundaries:
                if offset == 0:
                    if m.next_review_at <= day_end:
                        day_counts[offset] += 1
                elif day_start < m.next_review_at <= day_end:
                    day_counts[offset] += 1

    # 构造7天预测
    WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    upcoming_7_days = []
    for day_start, _, offset in day_boundaries:
        upcoming_7_days.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "weekday": WEEKDAYS[day_start.weekday()],
            "count": day_counts[offset],
            "is_today": offset == 0,
        })

    # SRS阶段分布
    stage_distribution = []
    for i in range(len(SRS_LABELS)):
        if i < len(SRS_INTERVALS):
            count = stage_counts.get(i, 0)
        else:
            count = total_mastered
        stage_distribution.append({
            "stage": i,
            "label": SRS_LABELS[i],
            "count": count,
        })

    total_learned = len(all_mastery)
    retention_rate = round(mastered_count / total_learned * 100, 1) if total_learned > 0 else 0

    return {
        "due_today": due_today,
        "due_tomorrow": due_tomorrow,
        "upcoming_7_days": upcoming_7_days,
        "stage_distribution": stage_distribution,
        "total_learned": total_learned,
        "total_mastered": total_mastered,
        "retention_rate": retention_rate,
    }


@router.get("/review-due-count")
async def get_review_due_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """仅返回今日待复习数量（轻量级，用于仪表板）"""
    now = datetime.utcnow()
    result = await db.execute(
        select(func.count(WordMastery.id)).where(
            and_(
                WordMastery.user_id == current_user.id,
                WordMastery.next_review_at <= now
            )
        )
    )
    count = result.scalar() or 0
    return {"due_today": count}


@router.post("/review-records")
async def submit_review_records(
    data: ReviewRecordBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """提交复习记录（不需要unit_id）"""
    user_id = current_user.id

    total_correct = 0
    total_wrong = 0

    for record_data in data.records:
        # 创建学习记录
        learning_record = LearningRecord(
            user_id=user_id,
            word_id=record_data.word_id,
            learning_mode="review",
            is_correct=record_data.is_correct,
            time_spent=record_data.time_spent
        )
        db.add(learning_record)

        if record_data.is_correct:
            total_correct += 1
        else:
            total_wrong += 1

        # 更新单词掌握度
        await update_word_mastery(
            db, user_id, record_data.word_id,
            record_data.learning_mode, record_data.is_correct
        )

    # 更新学习日历
    total_time_ms = sum(r.time_spent for r in data.records)
    await update_study_calendar(db, user_id, len(data.records), total_time_ms)

    await db.commit()

    return {
        "success": True,
        "message": f"成功记录 {len(data.records)} 条复习数据",
        "total_records": len(data.records),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
    }
