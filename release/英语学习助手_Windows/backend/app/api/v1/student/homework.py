from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user import User
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, HomeworkAttemptRecord
from app.models.word import Unit, WordBook
from app.api.v1.auth import get_current_user

router = APIRouter()


# ========================================
# Pydantic Schemas
# ========================================

class StudentHomeworkResponse(BaseModel):
    id: int  # HomeworkStudentAssignment id
    homework_id: int
    title: str
    description: Optional[str]
    unit_id: int
    unit_name: str
    book_name: str
    learning_mode: str
    target_score: int
    min_completion_time: Optional[int]
    max_attempts: int
    deadline: Optional[str]
    assigned_at: str
    status: str
    started_at: Optional[str]
    completed_at: Optional[str]
    attempts_count: int
    best_score: int
    total_time_spent: int
    teacher_name: str

    class Config:
        from_attributes = True


class SubmitHomeworkAttemptRequest(BaseModel):
    score: int
    time_spent: int
    correct_count: int
    wrong_count: int
    total_words: int
    details: Optional[str] = None  # JSON字符串


class HomeworkAttemptResponse(BaseModel):
    id: int
    attempt_number: int
    score: int
    time_spent: int
    correct_count: int
    wrong_count: int
    total_words: int
    completed_at: str

    class Config:
        from_attributes = True


# ========================================
# 学生端API
# ========================================

@router.get("/my-homework", response_model=List[StudentHomeworkResponse])
async def get_my_homework(
    status: Optional[str] = None,  # pending, in_progress, completed, overdue
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取学生的作业列表"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以查看作业")

    # 构建查询
    query = (
        select(
            HomeworkStudentAssignment,
            HomeworkAssignment,
            Unit,
            WordBook,
            User.full_name.label('teacher_name')
        )
        .join(HomeworkAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .join(Unit, HomeworkAssignment.unit_id == Unit.id)
        .join(WordBook, Unit.book_id == WordBook.id)
        .join(User, HomeworkAssignment.teacher_id == User.id)
        .where(HomeworkStudentAssignment.student_id == current_user.id)
    )

    # 状态过滤
    if status:
        query = query.where(HomeworkStudentAssignment.status == status)

    query = query.order_by(HomeworkStudentAssignment.assigned_at.desc())

    result = await db.execute(query)

    homework_list = []
    for assignment, homework, unit, book, teacher_name in result.all():
        # 自动更新过期状态
        if (homework.deadline and
            datetime.now() > homework.deadline and
            assignment.status not in ['completed']):
            assignment.status = 'overdue'
            await db.commit()

        homework_list.append(StudentHomeworkResponse(
            id=assignment.id,
            homework_id=homework.id,
            title=homework.title,
            description=homework.description,
            unit_id=homework.unit_id,
            unit_name=unit.name,
            book_name=book.name,
            learning_mode=homework.learning_mode,
            target_score=homework.target_score,
            min_completion_time=homework.min_completion_time,
            max_attempts=homework.max_attempts,
            deadline=homework.deadline.isoformat() if homework.deadline else None,
            assigned_at=assignment.assigned_at.isoformat(),
            status=assignment.status,
            started_at=assignment.started_at.isoformat() if assignment.started_at else None,
            completed_at=assignment.completed_at.isoformat() if assignment.completed_at else None,
            attempts_count=assignment.attempts_count,
            best_score=assignment.best_score,
            total_time_spent=assignment.total_time_spent,
            teacher_name=teacher_name
        ))

    return homework_list


@router.post("/homework/{assignment_id}/start")
async def start_homework(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """开始做作业"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以操作")

    # 查找作业分配记录
    result = await db.execute(
        select(HomeworkStudentAssignment, HomeworkAssignment)
        .join(HomeworkAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            and_(
                HomeworkStudentAssignment.id == assignment_id,
                HomeworkStudentAssignment.student_id == current_user.id
            )
        )
    )
    assignment_hw = result.first()

    if not assignment_hw:
        raise HTTPException(status_code=404, detail="作业不存在")

    assignment, homework = assignment_hw

    # 检查是否超过最大尝试次数
    if assignment.attempts_count >= homework.max_attempts:
        raise HTTPException(status_code=400, detail="已达到最大尝试次数")

    # 检查是否过期
    if homework.deadline and datetime.now() > homework.deadline:
        assignment.status = 'overdue'
        await db.commit()
        raise HTTPException(status_code=400, detail="作业已过期")

    # 更新状态
    if assignment.status == 'pending':
        assignment.status = 'in_progress'
        assignment.started_at = datetime.now()
        await db.commit()

    return {
        "message": "开始作业",
        "unit_id": homework.unit_id,
        "learning_mode": homework.learning_mode
    }


@router.post("/homework/{assignment_id}/submit", response_model=dict)
async def submit_homework_attempt(
    assignment_id: int,
    request: SubmitHomeworkAttemptRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """提交作业尝试"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以操作")

    # 查找作业分配记录
    result = await db.execute(
        select(HomeworkStudentAssignment, HomeworkAssignment)
        .join(HomeworkAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            and_(
                HomeworkStudentAssignment.id == assignment_id,
                HomeworkStudentAssignment.student_id == current_user.id
            )
        )
    )
    assignment_hw = result.first()

    if not assignment_hw:
        raise HTTPException(status_code=404, detail="作业不存在")

    assignment, homework = assignment_hw

    # 检查是否超过最大尝试次数
    if assignment.attempts_count >= homework.max_attempts:
        raise HTTPException(status_code=400, detail="已达到最大尝试次数")

    # 增加尝试次数
    assignment.attempts_count += 1

    # 更新最佳分数
    if request.score > assignment.best_score:
        assignment.best_score = request.score

    # 更新总时间
    assignment.total_time_spent += request.time_spent

    # 检查是否达到目标分数
    is_passed = request.score >= homework.target_score
    if is_passed:
        assignment.status = 'completed'
        assignment.completed_at = datetime.now()

    # 创建尝试记录
    attempt = HomeworkAttemptRecord(
        homework_student_assignment_id=assignment.id,
        attempt_number=assignment.attempts_count,
        score=request.score,
        time_spent=request.time_spent,
        correct_count=request.correct_count,
        wrong_count=request.wrong_count,
        total_words=request.total_words,
        details=request.details
    )
    db.add(attempt)

    await db.commit()

    return {
        "message": "提交成功",
        "is_passed": is_passed,
        "score": request.score,
        "best_score": assignment.best_score,
        "attempts_count": assignment.attempts_count,
        "remaining_attempts": homework.max_attempts - assignment.attempts_count
    }


@router.get("/homework/{assignment_id}/attempts", response_model=List[HomeworkAttemptResponse])
async def get_my_homework_attempts(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取我的作业尝试记录"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以操作")

    # 验证作业分配记录
    result = await db.execute(
        select(HomeworkStudentAssignment).where(
            and_(
                HomeworkStudentAssignment.id == assignment_id,
                HomeworkStudentAssignment.student_id == current_user.id
            )
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="作业不存在")

    # 查询所有尝试记录
    result = await db.execute(
        select(HomeworkAttemptRecord)
        .where(HomeworkAttemptRecord.homework_student_assignment_id == assignment.id)
        .order_by(HomeworkAttemptRecord.attempt_number.desc())
    )

    attempts = []
    for attempt in result.scalars().all():
        attempts.append(HomeworkAttemptResponse(
            id=attempt.id,
            attempt_number=attempt.attempt_number,
            score=attempt.score,
            time_spent=attempt.time_spent,
            correct_count=attempt.correct_count,
            wrong_count=attempt.wrong_count,
            total_words=attempt.total_words,
            completed_at=attempt.completed_at.isoformat()
        ))

    return attempts
