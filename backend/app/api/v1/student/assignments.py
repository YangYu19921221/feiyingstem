from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models.user import User
from app.models.learning import BookAssignment, LearningProgress
from app.models.word import WordBook, Unit, UnitWord
from app.api.v1.auth import get_current_user
from app.services.scope_service import get_unit_groups, DEFAULT_GROUP_SIZE
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
    # 分配范围(严格模式):book=整本 / unit=单元 / group=单元内分组
    scope_type: str = 'book'
    unit_id: Optional[int] = None
    unit_name: Optional[str] = None
    unit_number: Optional[int] = None
    group_index: Optional[int] = None

    class Config:
        from_attributes = True


# ========================================
# 内部辅助
# ========================================

async def _unit_scope_stats(
    db: AsyncSession, user_id: int, unit: Unit, group_index: Optional[int]
) -> tuple[int, float, bool]:
    """单元/分组 scope 的 (词数, 进度百分比, 是否完成)。

    进度口径:该单元所有学习模式中 max(completed_words) / 词数;
    任一模式 is_completed → 完成(100%)。group 的完成判定放宽到单元级,
    与学习权限口径一致(分类学习流程本身按组推进)。
    """
    # 词数:group scope 精确到组,unit scope 为整单元
    if group_index is not None:
        try:
            groups = await get_unit_groups(db, unit.id)
            word_count = groups[group_index - 1]["word_count"] if 0 < group_index <= len(groups) else 0
        except ValueError:
            word_count = 0
    else:
        wc_res = await db.execute(
            select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit.id)
        )
        word_count = wc_res.scalar() or 0

    prog_res = await db.execute(
        select(LearningProgress).where(
            and_(
                LearningProgress.user_id == user_id,
                LearningProgress.unit_id == unit.id,
            )
        )
    )
    progresses = prog_res.scalars().all()
    max_completed = max((p.completed_words or 0 for p in progresses), default=0)
    is_done = any(p.is_completed for p in progresses)

    if is_done:
        pct = 100.0
    elif word_count > 0:
        pct = min(100.0, max_completed / word_count * 100)
    else:
        pct = 0.0
    return word_count, round(pct, 2), is_done


# ========================================
# 学生端API
# ========================================

@router.get("/my-assignments", response_model=List[StudentBookAssignmentResponse])
async def get_my_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取学生被分配的单词本/单元/分组(按 scope 展示,不再一律按整本书)"""

    if current_user.role != 'student':
        raise HTTPException(status_code=403, detail="只有学生可以查看分配")

    # 查询分配记录(LEFT JOIN 单元,unit/group scope 时带出单元信息)
    result = await db.execute(
        select(
            BookAssignment,
            WordBook,
            User.full_name.label('teacher_name'),
            Unit,
        )
        .join(WordBook, BookAssignment.book_id == WordBook.id)
        .join(User, BookAssignment.teacher_id == User.id)
        .outerjoin(Unit, BookAssignment.unit_id == Unit.id)
        .where(BookAssignment.student_id == current_user.id)
        .order_by(BookAssignment.assigned_at.desc())
    )

    assignments = []
    for assignment, book, teacher_name, unit in result.all():
        scope_type = assignment.scope_type or 'book'

        if scope_type in ('unit', 'group') and unit is not None:
            # ---- 单元/分组粒度:统计只看该单元(组) ----
            word_count, progress_percentage, scope_done = await _unit_scope_stats(
                db, current_user.id, unit, assignment.group_index if scope_type == 'group' else None
            )
            unit_count = 1
            # 学生学完即视为完成(不依赖 is_completed 字段回写,展示层自愈)
            is_completed = assignment.is_completed or scope_done
            unit_name, unit_number = unit.name, unit.unit_number
        else:
            # ---- 整本粒度:保持原口径 ----
            unit_result = await db.execute(
                select(func.count(Unit.id)).where(Unit.book_id == book.id)
            )
            unit_count = unit_result.scalar() or 0

            word_result = await db.execute(
                select(func.count(UnitWord.id))
                .join(Unit, UnitWord.unit_id == Unit.id)
                .where(Unit.book_id == book.id)
            )
            word_count = word_result.scalar() or 0

            # 完成进度 — 用 DISTINCT unit_id 避免多 learning_mode 重复计数
            progress_result = await db.execute(
                select(func.count(func.distinct(LearningProgress.unit_id))).where(
                    and_(
                        LearningProgress.user_id == current_user.id,
                        LearningProgress.book_id == book.id,
                        LearningProgress.is_completed == True
                    )
                )
            )
            completed_units = progress_result.scalar() or 0
            progress_percentage = round(
                (completed_units / unit_count * 100) if unit_count > 0 else 0, 2
            )
            is_completed = assignment.is_completed
            unit_name, unit_number = None, None

        assignments.append(StudentBookAssignmentResponse(
            id=assignment.id,
            book_id=book.id,
            book_name=book.name,
            book_description=book.description,
            teacher_name=teacher_name,
            assigned_at=assignment.assigned_at.isoformat(),
            deadline=assignment.deadline.isoformat() if assignment.deadline else None,
            is_completed=is_completed,
            progress_percentage=progress_percentage,
            unit_count=unit_count,
            word_count=word_count,
            scope_type=scope_type,
            unit_id=assignment.unit_id,
            unit_name=unit_name,
            unit_number=unit_number,
            group_index=assignment.group_index,
        ))

    return assignments


@router.post("/assignments/{assignment_id}/complete")
async def mark_assignment_complete(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """标记分配为完成(按 scope 判定:整本=所有单元完成;单元/分组=该单元完成)"""

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

    scope_type = assignment.scope_type or 'book'

    if scope_type in ('unit', 'group') and assignment.unit_id is not None:
        # 单元/分组 scope:该单元任一模式 is_completed 即完成
        done_res = await db.execute(
            select(func.count()).select_from(LearningProgress).where(
                and_(
                    LearningProgress.user_id == current_user.id,
                    LearningProgress.unit_id == assignment.unit_id,
                    LearningProgress.is_completed == True
                )
            )
        )
        if (done_res.scalar() or 0) > 0:
            assignment.is_completed = True
            await db.commit()
            return {"message": "标记完成成功", "is_completed": True}
        return {"message": "该单元还未完成", "is_completed": False, "completed": 0, "total": 1}

    # 整本 scope:检查是否所有单元都完成(原口径)
    unit_result = await db.execute(
        select(Unit).where(Unit.book_id == assignment.book_id)
    )
    units = unit_result.scalars().all()

    completed_result = await db.execute(
        select(func.count(func.distinct(LearningProgress.unit_id))).where(
            and_(
                LearningProgress.user_id == current_user.id,
                LearningProgress.book_id == assignment.book_id,
                LearningProgress.is_completed == True
            )
        )
    )
    completed_count = completed_result.scalar() or 0

    if completed_count >= len(units):
        assignment.is_completed = True
        await db.commit()
        return {"message": "标记完成成功", "is_completed": True}
    else:
        return {
            "message": "还有单元未完成",
            "is_completed": False,
            "completed": completed_count,
            "total": len(units)
        }
