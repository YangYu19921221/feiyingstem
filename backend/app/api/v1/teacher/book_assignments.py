from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, Integer
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Literal
from datetime import datetime
from pydantic import BaseModel
import math

from app.core.database import get_db
from app.models.user import User
from app.models.learning import BookAssignment
from app.models.word import WordBook, Unit
from app.api.v1.auth import get_current_user
from app.services.scope_service import validate_scope, get_unit_groups, DEFAULT_GROUP_SIZE
from app.api.v1.teacher._permissions import get_my_class_student_ids

router = APIRouter()


# ========================================
# Pydantic Schemas
# ========================================

class AssignBookRequest(BaseModel):
    book_id: int
    student_ids: List[int]
    deadline: Optional[str] = None
    scope_type: Literal['book', 'unit', 'group'] = 'book'
    unit_id: Optional[int] = None
    group_index: Optional[int] = None


class BookAssignmentResponse(BaseModel):
    id: int
    book_id: int
    book_name: str
    student_id: int
    student_name: Optional[str]
    teacher_id: int
    assigned_at: str
    deadline: Optional[str]
    is_completed: bool
    scope_type: str
    unit_id: Optional[int]
    group_index: Optional[int]

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
    """分配单词本给学生，支持 book/unit/group 三级粒度"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="只有教师可以分配单词本")

    # 1) scope 参数校验
    try:
        validate_scope(request.scope_type, request.unit_id, request.group_index)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # 2) 验证单词本存在
    book_res = await db.execute(select(WordBook).where(WordBook.id == request.book_id))
    book = book_res.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="单词本不存在")

    # 3) 如果是 unit/group，校验 unit 存在（先于 group_index 范围检查）
    if request.scope_type in ('unit', 'group'):
        unit_res = await db.execute(select(Unit).where(Unit.id == request.unit_id))
        unit_obj = unit_res.scalar_one_or_none()
        if not unit_obj:
            raise HTTPException(status_code=404, detail="单元不存在")

    # 4) 如果是 group，校验 group_index 在合法范围
    if request.scope_type == 'group':
        try:
            groups = await get_unit_groups(db, request.unit_id)  # type: ignore[arg-type]
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if request.group_index < 1 or request.group_index > len(groups):  # type: ignore[operator]
            raise HTTPException(
                status_code=422,
                detail=f"组序号超出范围（单元共 {len(groups)} 组）"
            )

    # 5) 班级权限：所有 student_ids 必须在本教师班级（admin 跳过）
    if current_user.role == 'teacher' and request.student_ids:
        my_ids = await get_my_class_student_ids(db, current_user.id)
        bad = [sid for sid in request.student_ids if sid not in my_ids]
        if bad:
            raise HTTPException(
                status_code=403,
                detail=f"以下学生不在你的班级：{bad}"
            )

    # 6) 解析截止时间
    deadline_dt = None
    if request.deadline:
        try:
            deadline_dt = datetime.fromisoformat(request.deadline.replace('Z', '+00:00'))
        except Exception:
            raise HTTPException(status_code=400, detail="截止时间格式错误")

    # 7) 写入，用唯一约束兜底重复分配
    created = 0
    skipped = 0
    total = len(request.student_ids)

    for sid in request.student_ids:
        assignment = BookAssignment(
            book_id=request.book_id,
            student_id=sid,
            teacher_id=current_user.id,
            scope_type=request.scope_type,
            unit_id=request.unit_id,
            group_index=request.group_index,
            deadline=deadline_dt,
            is_completed=False,
        )
        try:
            async with db.begin_nested():
                db.add(assignment)
                await db.flush()
            created += 1
        except IntegrityError:
            skipped += 1

    await db.commit()

    return {
        "message": "分配完成",
        "created": created,
        "skipped": skipped,
        "total": total,
    }


@router.get("/books/{book_id}/units")
async def list_book_units(
    book_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取单词本下所有单元，包含每个单元的分组数"""
    if current_user.role not in ('teacher', 'admin'):
        raise HTTPException(status_code=403, detail="无权限")

    # 验证单词本存在
    book_res = await db.execute(select(WordBook).where(WordBook.id == book_id))
    if book_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="单词本不存在")

    res = await db.execute(
        select(Unit).where(Unit.book_id == book_id).order_by(Unit.order_index)
    )
    units = res.scalars().all()
    return [
        {
            "id": u.id,
            "unit_number": u.unit_number,
            "name": u.name,
            "word_count": u.word_count,
            "group_count": math.ceil(u.word_count / (u.group_size or DEFAULT_GROUP_SIZE)) if u.word_count else 0,
        }
        for u in units
    ]


@router.get("/units/{unit_id}/groups")
async def list_unit_groups(
    unit_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取单元的所有分组信息"""
    if current_user.role not in ('teacher', 'admin'):
        raise HTTPException(status_code=403, detail="无权限")

    try:
        return await get_unit_groups(db, unit_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


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
            is_completed=assignment.is_completed,
            scope_type=assignment.scope_type,
            unit_id=assignment.unit_id,
            group_index=assignment.group_index,
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
            is_completed=assignment.is_completed,
            scope_type=assignment.scope_type,
            unit_id=assignment.unit_id,
            group_index=assignment.group_index,
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
