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

class CreateHomeworkRequest(BaseModel):
    title: str
    description: Optional[str] = None
    unit_id: int
    learning_mode: str  # flashcard, spelling, fillblank, quiz
    student_ids: List[int]
    target_score: int = 80
    min_completion_time: Optional[int] = None
    max_attempts: int = 3
    deadline: Optional[str] = None


class HomeworkResponse(BaseModel):
    id: int
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
    created_at: str
    total_assigned: int
    completed_count: int
    in_progress_count: int
    pending_count: int

    class Config:
        from_attributes = True


class StudentHomeworkStatusResponse(BaseModel):
    id: int
    homework_id: int
    student_id: int
    student_name: str
    status: str
    assigned_at: str
    started_at: Optional[str]
    completed_at: Optional[str]
    attempts_count: int
    best_score: int
    total_time_spent: int

    class Config:
        from_attributes = True


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
# 教师端API
# ========================================

@router.post("/homework", response_model=dict)
async def create_homework(
    request: CreateHomeworkRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """创建作业并分配给学生"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="只有教师可以创建作业")

    # 验证单元存在
    result = await db.execute(
        select(Unit, WordBook)
        .join(WordBook, Unit.book_id == WordBook.id)
        .where(Unit.id == request.unit_id)
    )
    unit_book = result.first()
    if not unit_book:
        raise HTTPException(status_code=404, detail="单元不存在")

    unit, book = unit_book

    # 验证学生存在
    result = await db.execute(
        select(User).where(
            and_(
                User.id.in_(request.student_ids),
                User.role == 'student'
            )
        )
    )
    students = result.scalars().all()
    if len(students) != len(request.student_ids):
        raise HTTPException(status_code=404, detail="部分学生不存在或不是学生角色")

    # 解析截止时间
    deadline = None
    if request.deadline:
        try:
            deadline = datetime.fromisoformat(request.deadline.replace('Z', '+00:00'))
        except:
            raise HTTPException(status_code=400, detail="截止时间格式错误")

    # 创建作业
    homework = HomeworkAssignment(
        title=request.title,
        description=request.description,
        teacher_id=current_user.id,
        unit_id=request.unit_id,
        learning_mode=request.learning_mode,
        target_score=request.target_score,
        min_completion_time=request.min_completion_time,
        max_attempts=request.max_attempts,
        deadline=deadline
    )
    db.add(homework)
    await db.flush()  # 获取homework.id

    # 批量分配给学生
    assigned_count = 0
    skipped_count = 0

    for student_id in request.student_ids:
        # 检查是否已分配
        result = await db.execute(
            select(HomeworkStudentAssignment).where(
                and_(
                    HomeworkStudentAssignment.homework_id == homework.id,
                    HomeworkStudentAssignment.student_id == student_id
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            skipped_count += 1
            continue

        # 创建学生作业分配
        student_assignment = HomeworkStudentAssignment(
            homework_id=homework.id,
            student_id=student_id,
            status='pending'
        )
        db.add(student_assignment)
        assigned_count += 1

    await db.commit()

    return {
        "message": "作业创建成功",
        "homework_id": homework.id,
        "assigned_count": assigned_count,
        "skipped_count": skipped_count,
        "total": len(request.student_ids)
    }


@router.get("/homework", response_model=List[HomeworkResponse])
async def get_teacher_homework(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取教师创建的所有作业"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    result = await db.execute(
        select(HomeworkAssignment, Unit, WordBook)
        .join(Unit, HomeworkAssignment.unit_id == Unit.id)
        .join(WordBook, Unit.book_id == WordBook.id)
        .where(HomeworkAssignment.teacher_id == current_user.id)
        .order_by(HomeworkAssignment.created_at.desc())
    )

    homework_list = []
    for homework, unit, book in result.all():
        # 统计完成情况
        stats_result = await db.execute(
            select(
                func.count(HomeworkStudentAssignment.id).label('total'),
                func.sum(func.case((HomeworkStudentAssignment.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(func.case((HomeworkStudentAssignment.status == 'in_progress', 1), else_=0)).label('in_progress'),
                func.sum(func.case((HomeworkStudentAssignment.status == 'pending', 1), else_=0)).label('pending')
            )
            .where(HomeworkStudentAssignment.homework_id == homework.id)
        )
        stats = stats_result.first()

        homework_list.append(HomeworkResponse(
            id=homework.id,
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
            created_at=homework.created_at.isoformat(),
            total_assigned=stats.total or 0,
            completed_count=stats.completed or 0,
            in_progress_count=stats.in_progress or 0,
            pending_count=stats.pending or 0
        ))

    return homework_list


@router.get("/homework/{homework_id}/students", response_model=List[StudentHomeworkStatusResponse])
async def get_homework_student_status(
    homework_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取某个作业的学生完成情况"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    # 验证作业存在且属于当前教师
    result = await db.execute(
        select(HomeworkAssignment).where(
            and_(
                HomeworkAssignment.id == homework_id,
                HomeworkAssignment.teacher_id == current_user.id
            )
        )
    )
    homework = result.scalar_one_or_none()
    if not homework:
        raise HTTPException(status_code=404, detail="作业不存在")

    # 查询学生完成情况
    result = await db.execute(
        select(HomeworkStudentAssignment, User.full_name)
        .join(User, HomeworkStudentAssignment.student_id == User.id)
        .where(HomeworkStudentAssignment.homework_id == homework_id)
        .order_by(HomeworkStudentAssignment.assigned_at.desc())
    )

    student_list = []
    for assignment, student_name in result.all():
        student_list.append(StudentHomeworkStatusResponse(
            id=assignment.id,
            homework_id=assignment.homework_id,
            student_id=assignment.student_id,
            student_name=student_name,
            status=assignment.status,
            assigned_at=assignment.assigned_at.isoformat(),
            started_at=assignment.started_at.isoformat() if assignment.started_at else None,
            completed_at=assignment.completed_at.isoformat() if assignment.completed_at else None,
            attempts_count=assignment.attempts_count,
            best_score=assignment.best_score,
            total_time_spent=assignment.total_time_spent
        ))

    return student_list


@router.get("/homework/{homework_id}/student/{student_id}/attempts", response_model=List[HomeworkAttemptResponse])
async def get_student_homework_attempts(
    homework_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取学生某个作业的所有尝试记录"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    # 获取学生作业分配记录
    result = await db.execute(
        select(HomeworkStudentAssignment)
        .join(HomeworkAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            and_(
                HomeworkStudentAssignment.homework_id == homework_id,
                HomeworkStudentAssignment.student_id == student_id,
                HomeworkAssignment.teacher_id == current_user.id
            )
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="作业记录不存在")

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


@router.delete("/homework/{homework_id}")
async def delete_homework(
    homework_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """删除作业"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    result = await db.execute(
        select(HomeworkAssignment).where(
            and_(
                HomeworkAssignment.id == homework_id,
                HomeworkAssignment.teacher_id == current_user.id
            )
        )
    )
    homework = result.scalar_one_or_none()

    if not homework:
        raise HTTPException(status_code=404, detail="作业不存在")

    await db.delete(homework)
    await db.commit()

    return {"message": "删除成功"}
