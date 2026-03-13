from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, Integer
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models.user import User
from app.models.learning import BookAssignment
from app.models.word import WordBook
from app.api.v1.auth import get_current_user
from pydantic import BaseModel

router = APIRouter()


# ========================================
# Pydantic Schemas
# ========================================

class AssignBookRequest(BaseModel):
    book_id: int
    student_ids: List[int]
    deadline: Optional[str] = None


class BookAssignmentResponse(BaseModel):
    id: int
    book_id: int
    book_name: str
    student_id: int
    student_name: str
    teacher_id: int
    assigned_at: str
    deadline: Optional[str]
    is_completed: bool

    class Config:
        from_attributes = True


class AssignmentStatsResponse(BaseModel):
    book_id: int
    book_name: str
    total_assigned: int
    completed_count: int
    in_progress_count: int


# ========================================
# 教师端API
# ========================================

@router.get("/books")
async def get_word_books(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取所有单词本列表(教师端)"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="只有教师可以访问此接口")

    result = await db.execute(select(WordBook).order_by(WordBook.created_at.desc()))
    books = result.scalars().all()

    return [
        {
            "id": book.id,
            "name": book.name,
            "description": book.description,
            "grade_level": book.grade_level,
            "is_public": book.is_public,
            "created_at": book.created_at.isoformat() if book.created_at else None
        }
        for book in books
    ]


@router.post("/assign", response_model=dict)
async def assign_book_to_students(
    request: AssignBookRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """分配单词本给学生"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="只有教师可以分配单词本")

    # 验证单词本存在
    result = await db.execute(select(WordBook).where(WordBook.id == request.book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="单词本不存在")

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

    # 批量创建分配记录(跳过已存在的)
    assigned_count = 0
    skipped_count = 0

    for student_id in request.student_ids:
        # 检查是否已分配
        result = await db.execute(
            select(BookAssignment).where(
                and_(
                    BookAssignment.book_id == request.book_id,
                    BookAssignment.student_id == student_id
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            skipped_count += 1
            continue

        # 创建新分配
        assignment = BookAssignment(
            book_id=request.book_id,
            student_id=student_id,
            teacher_id=current_user.id,
            deadline=deadline,
            is_completed=False
        )
        db.add(assignment)
        assigned_count += 1

    await db.commit()

    return {
        "message": "分配成功",
        "assigned_count": assigned_count,
        "skipped_count": skipped_count,
        "total": len(request.student_ids)
    }


@router.get("/book/{book_id}/assignments", response_model=List[BookAssignmentResponse])
async def get_book_assignments(
    book_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取单词本的分配情况"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    # 查询分配记录
    result = await db.execute(
        select(
            BookAssignment,
            User.full_name.label('student_name'),
            WordBook.name.label('book_name')
        )
        .join(User, BookAssignment.student_id == User.id)
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.book_id == book_id)
        .order_by(BookAssignment.assigned_at.desc())
    )

    assignments = []
    for assignment, student_name, book_name in result.all():
        assignments.append(BookAssignmentResponse(
            id=assignment.id,
            book_id=assignment.book_id,
            book_name=book_name,
            student_id=assignment.student_id,
            student_name=student_name,
            teacher_id=assignment.teacher_id,
            assigned_at=assignment.assigned_at.isoformat(),
            deadline=assignment.deadline.isoformat() if assignment.deadline else None,
            is_completed=assignment.is_completed
        ))

    return assignments


@router.get("/assignments", response_model=List[BookAssignmentResponse])
async def get_teacher_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取教师的所有分配记录"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    result = await db.execute(
        select(
            BookAssignment,
            User.full_name.label('student_name'),
            WordBook.name.label('book_name')
        )
        .join(User, BookAssignment.student_id == User.id)
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.teacher_id == current_user.id)
        .order_by(BookAssignment.assigned_at.desc())
    )

    assignments = []
    for assignment, student_name, book_name in result.all():
        assignments.append(BookAssignmentResponse(
            id=assignment.id,
            book_id=assignment.book_id,
            book_name=book_name,
            student_id=assignment.student_id,
            student_name=student_name,
            teacher_id=assignment.teacher_id,
            assigned_at=assignment.assigned_at.isoformat(),
            deadline=assignment.deadline.isoformat() if assignment.deadline else None,
            is_completed=assignment.is_completed
        ))

    return assignments


@router.get("/stats", response_model=List[AssignmentStatsResponse])
async def get_assignment_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取分配统计"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    # 统计每个单词本的分配情况
    result = await db.execute(
        select(
            BookAssignment.book_id,
            WordBook.name,
            func.count(BookAssignment.id).label('total'),
            func.sum(func.cast(BookAssignment.is_completed, Integer)).label('completed')
        )
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.teacher_id == current_user.id)
        .group_by(BookAssignment.book_id, WordBook.name)
    )

    stats = []
    for book_id, book_name, total, completed in result.all():
        completed = completed or 0
        stats.append(AssignmentStatsResponse(
            book_id=book_id,
            book_name=book_name,
            total_assigned=total,
            completed_count=completed,
            in_progress_count=total - completed
        ))

    return stats


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """删除分配记录"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="无权限")

    result = await db.execute(
        select(BookAssignment).where(
            and_(
                BookAssignment.id == assignment_id,
                BookAssignment.teacher_id == current_user.id
            )
        )
    )
    assignment = result.scalar_one_or_none()

    if not assignment:
        raise HTTPException(status_code=404, detail="分配记录不存在")

    await db.delete(assignment)
    await db.commit()

    return {"message": "删除成功"}
