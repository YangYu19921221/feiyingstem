"""
学习记录API - 记录学生的学习数据
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List
from datetime import datetime, date, timedelta
import logging

from app.core.database import get_db
from app.models.user import User, StudyCalendar
from app.models.word import Unit, Word
from app.models.learning import (
    LearningRecord, WordMastery, StudySession, LearningProgress
)
from app.schemas.learning_record import (
    LearningRecordBatchCreate, LearningRecordResponse,
    StudySessionCreate, StudySessionUpdate, StudySessionResponse,
    WordMasteryResponse, StudyCalendarUpdate
)
from app.api.v1.auth import get_current_student
from app.services.learning_quality import learning_quality_service

router = APIRouter()
logger = logging.getLogger(__name__)


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
    today = date.today()
    result = await db.execute(
        select(StudyCalendar).where(
            and_(
                StudyCalendar.user_id == user_id,
                StudyCalendar.study_date == today
            )
        )
    )
    calendar_record = result.scalar_one_or_none()

    if calendar_record:
        # 更新今天的记录
        calendar_record.words_learned += len(data.records)
        calendar_record.duration += sum(r.time_spent for r in data.records) // 1000
    else:
        # 创建今天的记录
        calendar_record = StudyCalendar(
            user_id=user_id,
            study_date=today,
            words_learned=len(data.records),
            duration=sum(r.time_spent for r in data.records) // 1000
        )
        db.add(calendar_record)

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

    # 计算下次复习时间(间隔重复算法 - 简化版)
    if mastery.mastery_level >= 4:
        # 掌握良好,7天后复习
        mastery.next_review_at = datetime.utcnow() + timedelta(days=7)
    elif mastery.mastery_level >= 2:
        # 一般掌握,3天后复习
        mastery.next_review_at = datetime.utcnow() + timedelta(days=3)
    else:
        # 掌握较差,1天后复习
        mastery.next_review_at = datetime.utcnow() + timedelta(days=1)


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


@router.get("/review-due", response_model=List[WordMasteryResponse])
async def get_review_due_words(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取需要复习的单词"""
    user_id = current_user.id
    now = datetime.utcnow()

    result = await db.execute(
        select(WordMastery)
        .where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.next_review_at <= now
            )
        )
        .order_by(WordMastery.next_review_at.asc())
        .limit(limit)
    )
    review_words = result.scalars().all()

    return review_words
