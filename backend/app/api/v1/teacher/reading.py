"""
教师端阅读理解管理API
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from typing import List, Optional
import json

from app.core.database import get_db


def _safe_json_loads(value):
    """安全解析 JSON 字符串，失败返回 None"""
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None
from app.models.user import User
from app.models.reading import (
    ReadingPassage, ReadingVocabulary, ReadingQuestion,
    QuestionOption, QuestionAnswer, ReadingAssignment, ReadingAttempt
)
from app.schemas.reading import (
    ReadingPassageCreate, ReadingPassageUpdate, ReadingPassageResponse,
    ReadingPassageWithAnswers, VocabularyItem, VocabularyResponse,
    ReadingQuestionCreate, ReadingQuestionWithAnswer,
    AssignReadingRequest, ReadingAssignmentResponse
)
from app.api.v1.auth import get_current_teacher

router = APIRouter()


# ========================================
# 文章管理
# ========================================

@router.get("/passages", response_model=List[ReadingPassageResponse])
async def get_teacher_passages(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    topic: Optional[str] = None,
    difficulty: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取教师创建的所有阅读文章列表
    """
    query = select(ReadingPassage).where(ReadingPassage.created_by == current_user.id)

    if topic:
        query = query.where(ReadingPassage.topic == topic)
    if difficulty:
        query = query.where(ReadingPassage.difficulty == difficulty)

    query = query.order_by(desc(ReadingPassage.created_at)).offset(skip).limit(limit)

    result = await db.execute(query)
    passages = result.scalars().all()

    return passages


@router.post("/passages", response_model=ReadingPassageResponse, status_code=status.HTTP_201_CREATED)
async def create_passage(
    passage_data: ReadingPassageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    创建新的阅读文章
    """
    # 计算单词数
    word_count = len(passage_data.content.split())

    # 创建文章
    passage = ReadingPassage(
        title=passage_data.title,
        content=passage_data.content,
        content_translation=passage_data.content_translation,
        difficulty=passage_data.difficulty,
        grade_level=passage_data.grade_level,
        word_count=word_count,
        topic=passage_data.topic,
        tags=json.dumps(passage_data.tags) if passage_data.tags else None,
        is_public=passage_data.is_public,
        cover_image=passage_data.cover_image,
        created_by=current_user.id,
        source='manual'
    )

    db.add(passage)
    await db.commit()
    await db.refresh(passage)

    return passage


@router.get("/passages/{passage_id}", response_model=ReadingPassageWithAnswers)
async def get_passage_detail(
    passage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取文章详情(含词汇、题目和答案)
    """
    # 获取文章
    result = await db.execute(
        select(ReadingPassage).where(
            and_(
                ReadingPassage.id == passage_id,
                or_(
                    ReadingPassage.created_by == current_user.id,
                    ReadingPassage.is_public == True
                )
            )
        )
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"文章ID {passage_id} 不存在或无权访问"
        )

    # 获取词汇
    result = await db.execute(
        select(ReadingVocabulary).where(ReadingVocabulary.passage_id == passage_id)
    )
    vocabularies = result.scalars().all()

    # 获取题目
    result = await db.execute(
        select(ReadingQuestion)
        .where(ReadingQuestion.passage_id == passage_id)
        .order_by(ReadingQuestion.order_index)
    )
    questions = result.scalars().all()

    # 为每个题目加载选项和答案
    questions_with_answers = []
    for question in questions:
        # 加载选项
        result = await db.execute(
            select(QuestionOption)
            .where(QuestionOption.question_id == question.id)
            .order_by(QuestionOption.order_index)
        )
        options = result.scalars().all()

        # 加载答案
        result = await db.execute(
            select(QuestionAnswer)
            .where(QuestionAnswer.question_id == question.id)
            .where(QuestionAnswer.is_primary == True)
        )
        answer_record = result.scalar_one_or_none()

        question_dict = {
            "id": question.id,
            "passage_id": question.passage_id,
            "question_type": question.question_type,
            "question_text": question.question_text,
            "order_index": question.order_index,
            "points": question.points,
            "source": question.source,
            "created_at": question.created_at,
            "options": options,
            "answer": {
                "answer_text": answer_record.answer_text,
                "answer_explanation": answer_record.answer_explanation,
                "is_primary": answer_record.is_primary,
                "accept_alternatives": _safe_json_loads(answer_record.accept_alternatives)
            } if answer_record else None
        }
        questions_with_answers.append(question_dict)

    # 组装响应
    response = ReadingPassageWithAnswers(
        **passage.__dict__,
        vocabularies=vocabularies,
        questions=questions_with_answers
    )

    return response


@router.put("/passages/{passage_id}", response_model=ReadingPassageResponse)
async def update_passage(
    passage_id: int,
    passage_data: ReadingPassageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    更新阅读文章
    """
    # 获取文章
    result = await db.execute(
        select(ReadingPassage).where(
            and_(
                ReadingPassage.id == passage_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"文章ID {passage_id} 不存在或无权修改"
        )

    # 更新字段
    update_data = passage_data.model_dump(exclude_unset=True)

    if 'tags' in update_data and update_data['tags'] is not None:
        update_data['tags'] = json.dumps(update_data['tags'])

    if 'content' in update_data:
        # 重新计算单词数
        update_data['word_count'] = len(update_data['content'].split())

    for field, value in update_data.items():
        setattr(passage, field, value)

    await db.commit()
    await db.refresh(passage)

    return passage


@router.delete("/passages/{passage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passage(
    passage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    删除阅读文章
    """
    result = await db.execute(
        select(ReadingPassage).where(
            and_(
                ReadingPassage.id == passage_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"文章ID {passage_id} 不存在或无权删除"
        )

    await db.delete(passage)
    await db.commit()


# ========================================
# 词汇管理
# ========================================

@router.post("/passages/{passage_id}/vocabulary", response_model=VocabularyResponse, status_code=status.HTTP_201_CREATED)
async def add_vocabulary(
    passage_id: int,
    vocab_data: VocabularyItem,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    为文章添加词汇注释
    """
    # 验证文章所有权
    result = await db.execute(
        select(ReadingPassage).where(
            and_(
                ReadingPassage.id == passage_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在或无权修改"
        )

    vocabulary = ReadingVocabulary(
        passage_id=passage_id,
        **vocab_data.model_dump()
    )

    db.add(vocabulary)
    await db.commit()
    await db.refresh(vocabulary)

    return vocabulary


@router.delete("/vocabulary/{vocab_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vocabulary(
    vocab_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    删除词汇注释
    """
    result = await db.execute(
        select(ReadingVocabulary)
        .join(ReadingPassage, ReadingVocabulary.passage_id == ReadingPassage.id)
        .where(
            and_(
                ReadingVocabulary.id == vocab_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    vocabulary = result.scalar_one_or_none()

    if not vocabulary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="词汇不存在或无权删除"
        )

    await db.delete(vocabulary)
    await db.commit()


# ========================================
# 题目管理
# ========================================

@router.post("/passages/{passage_id}/questions", response_model=ReadingQuestionWithAnswer, status_code=status.HTTP_201_CREATED)
async def add_question(
    passage_id: int,
    question_data: ReadingQuestionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    为文章添加题目
    """
    # 验证文章所有权
    result = await db.execute(
        select(ReadingPassage).where(
            and_(
                ReadingPassage.id == passage_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在或无权修改"
        )

    # 创建题目
    question = ReadingQuestion(
        passage_id=passage_id,
        question_type=question_data.question_type,
        question_text=question_data.question_text,
        order_index=question_data.order_index,
        points=question_data.points,
        source='manual'
    )

    db.add(question)
    await db.flush()

    # 添加选项(选择题)
    if question_data.options:
        for opt_data in question_data.options:
            option = QuestionOption(
                question_id=question.id,
                **opt_data.model_dump()
            )
            db.add(option)

    # 添加答案(填空/简答题)
    if question_data.answer:
        answer = QuestionAnswer(
            question_id=question.id,
            answer_text=question_data.answer.answer_text,
            answer_explanation=question_data.answer.answer_explanation,
            is_primary=question_data.answer.is_primary,
            accept_alternatives=json.dumps(question_data.answer.accept_alternatives) if question_data.answer.accept_alternatives else None
        )
        db.add(answer)

    await db.commit()
    await db.refresh(question)

    # 重新加载选项和答案
    result = await db.execute(
        select(QuestionOption).where(QuestionOption.question_id == question.id)
    )
    options = result.scalars().all()

    result = await db.execute(
        select(QuestionAnswer).where(
            and_(
                QuestionAnswer.question_id == question.id,
                QuestionAnswer.is_primary == True
            )
        )
    )
    answer_record = result.scalar_one_or_none()

    response = {
        **question.__dict__,
        "options": options,
        "answer": answer_record.__dict__ if answer_record else None
    }

    return response


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    删除题目
    """
    result = await db.execute(
        select(ReadingQuestion)
        .join(ReadingPassage, ReadingQuestion.passage_id == ReadingPassage.id)
        .where(
            and_(
                ReadingQuestion.id == question_id,
                ReadingPassage.created_by == current_user.id
            )
        )
    )
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="题目不存在或无权删除"
        )

    await db.delete(question)
    await db.commit()


# ========================================
# 作业分配
# ========================================

@router.post("/assignments", response_model=List[ReadingAssignmentResponse], status_code=status.HTTP_201_CREATED)
async def assign_reading(
    assignment_data: AssignReadingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    分配阅读作业给学生
    """
    # 验证文章存在
    result = await db.execute(
        select(ReadingPassage).where(ReadingPassage.id == assignment_data.passage_id)
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )

    # 为每个学生创建作业
    assignments = []
    for student_id in assignment_data.student_ids:
        # 检查是否已分配
        result = await db.execute(
            select(ReadingAssignment).where(
                and_(
                    ReadingAssignment.passage_id == assignment_data.passage_id,
                    ReadingAssignment.student_id == student_id
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            continue  # 跳过已分配的

        assignment = ReadingAssignment(
            passage_id=assignment_data.passage_id,
            student_id=student_id,
            teacher_id=current_user.id,
            deadline=assignment_data.deadline,
            min_score=assignment_data.min_score,
            max_attempts=assignment_data.max_attempts
        )
        db.add(assignment)
        assignments.append(assignment)

    await db.commit()

    # 刷新所有作业
    for assignment in assignments:
        await db.refresh(assignment)

    return assignments


@router.get("/assignments/passage/{passage_id}", response_model=List[dict])
async def get_passage_assignments(
    passage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取某个文章的所有作业分配情况(含学生答题情况)
    """
    result = await db.execute(
        select(ReadingAssignment, User.full_name, User.username)
        .join(User, ReadingAssignment.student_id == User.id)
        .where(
            and_(
                ReadingAssignment.passage_id == passage_id,
                ReadingAssignment.teacher_id == current_user.id
            )
        )
    )

    assignments_data = []
    for assignment, full_name, username in result:
        # 获取学生的答题记录
        attempts_result = await db.execute(
            select(ReadingAttempt)
            .where(
                and_(
                    ReadingAttempt.passage_id == passage_id,
                    ReadingAttempt.user_id == assignment.student_id
                )
            )
            .order_by(desc(ReadingAttempt.started_at))
        )
        attempts = attempts_result.scalars().all()

        best_score = max([a.score for a in attempts]) if attempts else None

        assignments_data.append({
            "assignment_id": assignment.id,
            "student_id": assignment.student_id,
            "student_name": full_name,
            "username": username,
            "assigned_at": assignment.assigned_at,
            "deadline": assignment.deadline,
            "is_completed": assignment.is_completed,
            "min_score": assignment.min_score,
            "max_attempts": assignment.max_attempts,
            "attempts_count": len(attempts),
            "best_score": best_score,
            "latest_attempt": attempts[0].__dict__ if attempts else None
        })

    return assignments_data
