from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import List
from datetime import datetime

from app.core.database import get_db
from app.models.user import User
from app.models.learning import BookAssignment, LearningProgress
from app.models.word import WordBook, Unit
from app.api.v1.auth import get_current_user
from pydantic import BaseModel

router = APIRouter()


# ========================================
# Pydantic Schemas
# ========================================

class StudentBookAssignmentResponse(BaseModel):
    id: int
    book_id: int
    book_name: str
    book_description: str | None
    teacher_name: str
    assigned_at: str
    deadline: str | None
    is_completed: bool
    progress_percentage: float
    unit_count: int
    word_count: int

    class Config:
        from_attributes = True


# ========================================
# 学生端API
# ========================================

@router.get("/my-assignments", response_model=List[StudentBookAssignmentResponse])
async def get_my_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取学生被分配的单词本"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以查看分配")

    # 查询分配记录
    result = await db.execute(
        select(
            BookAssignment,
            WordBook,
            User.full_name.label('teacher_name')
        )
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .join(User, BookAssignment.teacher_id == User.id)
        .where(BookAssignment.student_id == current_user.id)
        .order_by(BookAssignment.assigned_at.desc())
    )

    assignments = []
    for assignment, book, teacher_name in result.all():
        # 统计单元数量
        unit_result = await db.execute(
            select(func.count(Unit.id)).where(Unit.book_id == book.id)
        )
        unit_count = unit_result.scalar() or 0

        # 统计单词总数
        word_result = await db.execute(
            select(func.sum(Unit.word_count)).where(Unit.book_id == book.id)
        )
        word_count = word_result.scalar() or 0

        # 计算完成进度
        progress_result = await db.execute(
            select(LearningProgress).where(
                and_(
                    LearningProgress.user_id == current_user.id,
                    LearningProgress.book_id == book.id,
                    LearningProgress.is_completed == True
                )
            )
        )
        completed_units = len(progress_result.scalars().all())
        progress_percentage = (completed_units / unit_count * 100) if unit_count > 0 else 0

        assignments.append(StudentBookAssignmentResponse(
            id=assignment.id,
            book_id=book.id,
            book_name=book.name,
            book_description=book.description,
            teacher_name=teacher_name,
            assigned_at=assignment.assigned_at.isoformat(),
            deadline=assignment.deadline.isoformat() if assignment.deadline else None,
            is_completed=assignment.is_completed,
            progress_percentage=round(progress_percentage, 2),
            unit_count=unit_count,
            word_count=word_count
        ))

    return assignments


@router.post("/assignments/{assignment_id}/complete")
async def mark_assignment_complete(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """标记分配为完成(当学生完成所有单元时自动调用)"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以操作")

    # 查找分配记录
    result = await db.execute(
        select(BookAssignment).where(
            and_(
                BookAssignment.id == assignment_id,
                BookAssignment.student_id == current_user.id
            )
        )
    )
    assignment = result.scalar_one_or_none()

    if not assignment:
        raise HTTPException(status_code=404, detail="分配记录不存在")

    # 检查是否所有单元都完成
    unit_result = await db.execute(
        select(Unit).where(Unit.book_id == assignment.book_id)
    )
    units = unit_result.scalars().all()

    completed_result = await db.execute(
        select(LearningProgress).where(
            and_(
                LearningProgress.user_id == current_user.id,
                LearningProgress.book_id == assignment.book_id,
                LearningProgress.is_completed == True
            )
        )
    )
    completed_units = completed_result.scalars().all()

    if len(completed_units) >= len(units):
        assignment.is_completed = True
        await db.commit()
        return {"message": "标记完成成功", "is_completed": True}
    else:
        return {
            "message": "还有单元未完成",
            "is_completed": False,
            "completed": len(completed_units),
            "total": len(units)
        }
