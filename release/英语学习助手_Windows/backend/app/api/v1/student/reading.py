"""
学生端阅读理解功能API
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from typing import List, Optional
import json
from datetime import datetime

from app.core.database import get_db
from app.models.user import User
from app.models.reading import (
    ReadingPassage, ReadingVocabulary, ReadingQuestion,
    QuestionOption, QuestionAnswer, ReadingAssignment, ReadingAttempt
)
from app.schemas.reading import (
    StudentPassageListItem, ReadingPassageDetail,
    SubmitReadingAttempt, ReadingAttemptResult, QuestionResult
)
from app.api.v1.auth import get_current_student

router = APIRouter()


# ========================================
# 学生端文章列表
# ========================================

@router.get("/reading/passages", response_model=List[StudentPassageListItem])
async def get_student_passages(
    topic: Optional[str] = None,
    difficulty: Optional[int] = None,
    only_assigned: bool = Query(False, description="只显示被分配的文章"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取学生可访问的阅读文章列表

    - 被分配的文章
    - 公开的文章
    """
    user_id = current_user.id

    # 获取被分配的文章ID列表
    result = await db.execute(
        select(ReadingAssignment.passage_id, ReadingAssignment.deadline)
        .where(ReadingAssignment.student_id == user_id)
    )
    assigned_data = {row[0]: row[1] for row in result}

    # 构建查询
    if only_assigned:
        query = select(ReadingPassage).where(ReadingPassage.id.in_(assigned_data.keys()))
    else:
        query = select(ReadingPassage).where(
            or_(
                ReadingPassage.id.in_(assigned_data.keys()),
                ReadingPassage.is_public == True
            )
        )

    if topic:
        query = query.where(ReadingPassage.topic == topic)
    if difficulty:
        query = query.where(ReadingPassage.difficulty == difficulty)

    query = query.order_by(desc(ReadingPassage.created_at))

    result = await db.execute(query)
    passages = result.scalars().all()

    # 为每个文章添加学生的学习状态
    passages_data = []
    for passage in passages:
        # 获取题目数量
        result = await db.execute(
            select(func.count()).select_from(ReadingQuestion).where(ReadingQuestion.passage_id == passage.id)
        )
        question_count = result.scalar()

        # 获取学生的答题记录
        result = await db.execute(
            select(ReadingAttempt)
            .where(
                and_(
                    ReadingAttempt.passage_id == passage.id,
                    ReadingAttempt.user_id == user_id
                )
            )
            .order_by(desc(ReadingAttempt.started_at))
        )
        attempts = result.scalars().all()

        best_score = max([a.score for a in attempts]) if attempts else None
        is_completed = any([a.is_passed for a in attempts])

        passages_data.append(StudentPassageListItem(
            id=passage.id,
            title=passage.title,
            topic=passage.topic,
            difficulty=passage.difficulty,
            grade_level=passage.grade_level,
            word_count=passage.word_count,
            question_count=question_count,
            cover_image=passage.cover_image,
            is_assigned=passage.id in assigned_data,
            is_started=len(attempts) > 0,
            is_completed=is_completed,
            best_score=best_score,
            attempts_count=len(attempts),
            deadline=assigned_data.get(passage.id)
        ))

    return passages_data


# ========================================
# 文章详情(学生端,不含答案)
# ========================================

@router.get("/reading/passages/{passage_id}", response_model=ReadingPassageDetail)
async def get_passage_for_student(
    passage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取文章详情(学生端,不含答案)

    - 只返回题目,不返回答案
    - 增加阅读次数统计
    """
    user_id = current_user.id

    # 验证学生是否可以访问此文章
    result = await db.execute(
        select(ReadingPassage).where(ReadingPassage.id == passage_id)
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"文章ID {passage_id} 不存在"
        )

    # 检查访问权限(被分配或公开)
    result = await db.execute(
        select(ReadingAssignment).where(
            and_(
                ReadingAssignment.passage_id == passage_id,
                ReadingAssignment.student_id == user_id
            )
        )
    )
    is_assigned = result.scalar_one_or_none() is not None

    if not is_assigned and not passage.is_public:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您没有权限访问此文章"
        )

    # 增加阅读次数
    passage.view_count += 1
    await db.commit()

    # 获取词汇
    result = await db.execute(
        select(ReadingVocabulary).where(ReadingVocabulary.passage_id == passage_id)
    )
    vocabularies = result.scalars().all()

    # 获取题目(不含答案)
    result = await db.execute(
        select(ReadingQuestion)
        .where(ReadingQuestion.passage_id == passage_id)
        .order_by(ReadingQuestion.order_index)
    )
    questions = result.scalars().all()

    # 为每个题目加载选项(不加载答案)
    questions_with_options = []
    for question in questions:
        # 加载选项(但不标记哪个是正确答案)
        result = await db.execute(
            select(QuestionOption.id, QuestionOption.option_text, QuestionOption.option_label, QuestionOption.order_index)
            .where(QuestionOption.question_id == question.id)
            .order_by(QuestionOption.order_index)
        )
        options_data = result.all()

        # 不返回 is_correct 字段
        options = [
            {
                "id": opt[0],
                "option_text": opt[1],
                "option_label": opt[2],
                "order_index": opt[3],
                "is_correct": False  # 学生端隐藏答案
            }
            for opt in options_data
        ]

        questions_with_options.append({
            **question.__dict__,
            "options": options
        })

    # 组装响应
    response = ReadingPassageDetail(
        **passage.__dict__,
        vocabularies=vocabularies,
        questions=questions_with_options
    )

    return response


# ========================================
# 提交答题
# ========================================

@router.post("/reading/submit", response_model=ReadingAttemptResult)
async def submit_reading_attempt(
    submission: SubmitReadingAttempt,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    提交阅读理解答题

    - 自动判分
    - 返回详细的答题结果
    """
    user_id = current_user.id
    passage_id = submission.passage_id

    # 验证文章是否存在
    result = await db.execute(
        select(ReadingPassage).where(ReadingPassage.id == passage_id)
    )
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文章不存在"
        )

    # 检查是否有作业限制
    assignment = None
    if submission.assignment_id:
        result = await db.execute(
            select(ReadingAssignment).where(
                and_(
                    ReadingAssignment.id == submission.assignment_id,
                    ReadingAssignment.student_id == user_id
                )
            )
        )
        assignment = result.scalar_one_or_none()

        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="作业不存在"
            )

        # 检查尝试次数限制
        result = await db.execute(
            select(func.count())
            .select_from(ReadingAttempt)
            .where(
                and_(
                    ReadingAttempt.assignment_id == assignment.id,
                    ReadingAttempt.user_id == user_id
                )
            )
        )
        attempts_count = result.scalar()

        if attempts_count >= assignment.max_attempts:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"已超过最大尝试次数({assignment.max_attempts}次)"
            )

    # 计算尝试次数
    result = await db.execute(
        select(func.count())
        .select_from(ReadingAttempt)
        .where(
            and_(
                ReadingAttempt.passage_id == passage_id,
                ReadingAttempt.user_id == user_id
            )
        )
    )
    attempt_number = result.scalar() + 1

    # 判分
    question_results = []
    total_score = 0
    earned_score = 0

    for answer_submission in submission.answers:
        question_id = answer_submission.question_id
        user_answer = answer_submission.answer.strip()

        # 获取题目
        result = await db.execute(
            select(ReadingQuestion).where(ReadingQuestion.id == question_id)
        )
        question = result.scalar_one_or_none()

        if not question:
            continue

        total_score += question.points

        is_correct = False
        correct_answer = ""
        explanation = ""

        # 根据题型判分
        if question.question_type in ['multiple_choice', 'true_false']:
            # 选择题/判断题 - 查找正确选项
            result = await db.execute(
                select(QuestionOption)
                .where(
                    and_(
                        QuestionOption.question_id == question_id,
                        QuestionOption.is_correct == True
                    )
                )
            )
            correct_option = result.scalar_one_or_none()

            if correct_option:
                correct_answer = correct_option.option_label
                is_correct = user_answer.upper() == correct_option.option_label.upper()

        else:
            # 填空题/简答题 - 查找标准答案
            result = await db.execute(
                select(QuestionAnswer)
                .where(
                    and_(
                        QuestionAnswer.question_id == question_id,
                        QuestionAnswer.is_primary == True
                    )
                )
            )
            answer_record = result.scalar_one_or_none()

            if answer_record:
                correct_answer = answer_record.answer_text
                explanation = answer_record.answer_explanation or ""

                # 检查答案是否正确(忽略大小写和首尾空格)
                is_correct = user_answer.lower() == answer_record.answer_text.lower()

                # 检查替代答案
                if not is_correct and answer_record.accept_alternatives:
                    alternatives = json.loads(answer_record.accept_alternatives)
                    is_correct = user_answer.lower() in [alt.lower() for alt in alternatives]

        if is_correct:
            earned_score += question.points

        question_results.append(QuestionResult(
            question_id=question_id,
            is_correct=is_correct,
            user_answer=user_answer,
            correct_answer=correct_answer,
            explanation=explanation,
            points=question.points,
            earned_points=question.points if is_correct else 0
        ))

    # 计算百分比
    percentage = (earned_score / total_score * 100) if total_score > 0 else 0
    is_passed = (not assignment) or (not assignment.min_score) or (earned_score >= assignment.min_score)

    # 保存答题记录
    attempt = ReadingAttempt(
        user_id=user_id,
        passage_id=passage_id,
        assignment_id=submission.assignment_id,
        attempt_number=attempt_number,
        score=earned_score,
        total_points=total_score,
        percentage=percentage,
        time_spent=submission.time_spent,
        submitted_at=datetime.now(),
        answers=json.dumps([a.model_dump() for a in submission.answers]),
        is_passed=is_passed
    )

    db.add(attempt)

    # 更新作业完成状态
    if assignment and is_passed:
        assignment.is_completed = True

    # 更新文章完成次数
    if is_passed:
        passage.completion_count += 1

        # 更新平均分
        result = await db.execute(
            select(func.avg(ReadingAttempt.score))
            .where(
                and_(
                    ReadingAttempt.passage_id == passage_id,
                    ReadingAttempt.is_passed == True
                )
            )
        )
        avg = result.scalar()
        if avg:
            passage.avg_score = float(avg)

    await db.commit()
    await db.refresh(attempt)

    # 返回结果
    return ReadingAttemptResult(
        attempt_id=attempt.id,
        score=earned_score,
        total_points=total_score,
        percentage=percentage,
        is_passed=is_passed,
        question_results=question_results
    )


# ========================================
# 答题历史
# ========================================

@router.get("/reading/attempts/{passage_id}", response_model=List[dict])
async def get_reading_attempts(
    passage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取学生某篇文章的答题历史
    """
    result = await db.execute(
        select(ReadingAttempt)
        .where(
            and_(
                ReadingAttempt.passage_id == passage_id,
                ReadingAttempt.user_id == current_user.id
            )
        )
        .order_by(desc(ReadingAttempt.started_at))
    )
    attempts = result.scalars().all()

    return [
        {
            "id": attempt.id,
            "attempt_number": attempt.attempt_number,
            "score": attempt.score,
            "total_points": attempt.total_points,
            "percentage": attempt.percentage,
            "is_passed": attempt.is_passed,
            "time_spent": attempt.time_spent,
            "started_at": attempt.started_at,
            "submitted_at": attempt.submitted_at
        }
        for attempt in attempts
    ]
