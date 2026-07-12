from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_, case
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user import User
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, HomeworkAttemptRecord
from app.models.word import Unit, WordBook
from app.api.v1.auth import get_current_user
from app.services.scope_service import get_unit_groups

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
    group_index: Optional[int] = None  # null=整单元, 有值=指定分组
    # 单元多选:一次为多个单元各建一份作业(优先于 unit_id;多选时忽略 group_index)
    unit_ids: Optional[List[int]] = None


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
    is_closed: bool = False

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
    """创建作业并分配给学生。unit_ids 多选时为每个单元各建一份作业(标题自动带单元名)"""

    if current_user.role not in ['teacher', 'admin']:
        raise HTTPException(status_code=403, detail="只有教师可以创建作业")

    # 归一化单元目标:多选去重保序;单选保持旧行为
    if request.unit_ids:
        unit_targets = list(dict.fromkeys(request.unit_ids))
    else:
        unit_targets = [request.unit_id]
    multi = len(unit_targets) > 1

    # 验证所有单元存在
    result = await db.execute(
        select(Unit, WordBook)
        .join(WordBook, Unit.book_id == WordBook.id)
        .where(Unit.id.in_(unit_targets))
    )
    unit_map = {u.id: (u, b) for u, b in result.all()}
    missing = [uid for uid in unit_targets if uid not in unit_map]
    if missing:
        raise HTTPException(status_code=404, detail=f"单元不存在: {missing}")

    # 验证 group_index 在合法范围(仅单单元时有意义;多选时忽略)
    group_index = None if multi else request.group_index
    if group_index is not None:
        try:
            groups = await get_unit_groups(db, unit_targets[0])
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if group_index < 1 or group_index > len(groups):
            raise HTTPException(
                status_code=422,
                detail=f"组序号超出范围（单元共 {len(groups)} 组）"
            )

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

    # 逐单元创建作业(多选时标题带单元名区分,各自独立追踪完成情况)
    homework_ids = []
    assigned_count = 0
    skipped_count = 0

    for uid in unit_targets:
        unit, _book = unit_map[uid]
        homework = HomeworkAssignment(
            title=f"{request.title} · {unit.name}" if multi else request.title,
            description=request.description,
            teacher_id=current_user.id,
            unit_id=uid,
            learning_mode=request.learning_mode,
            target_score=request.target_score,
            min_completion_time=request.min_completion_time,
            max_attempts=request.max_attempts,
            deadline=deadline,
            group_index=group_index,
        )
        db.add(homework)
        await db.flush()  # 获取homework.id
        homework_ids.append(homework.id)

        for student_id in request.student_ids:
            # 新建的 homework 不会有旧分配,直接创建即可(homework_id 唯一约束兜底)
            student_assignment = HomeworkStudentAssignment(
                homework_id=homework.id,
                student_id=student_id,
                status='pending'
            )
            db.add(student_assignment)
            assigned_count += 1

    await db.commit()

    return {
        "message": f"作业创建成功({len(homework_ids)} 份)" if multi else "作业创建成功",
        "homework_id": homework_ids[0],
        "homework_ids": homework_ids,
        "assigned_count": assigned_count,
        "skipped_count": skipped_count,
        "total": len(request.student_ids) * len(unit_targets)
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
        # 统计完成情况(case 需从 sqlalchemy 顶层导入;func.case 会生成不认识 else_ 的通用函数)
        stats_result = await db.execute(
            select(
                func.count(HomeworkStudentAssignment.id).label('total'),
                func.sum(case((HomeworkStudentAssignment.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((HomeworkStudentAssignment.status == 'in_progress', 1), else_=0)).label('in_progress'),
                func.sum(case((HomeworkStudentAssignment.status == 'pending', 1), else_=0)).label('pending')
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
            pending_count=stats.pending or 0,
            is_closed=bool(homework.is_closed),
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
        select(HomeworkStudentAssignment, User.full_name, User.username)
        .join(User, HomeworkStudentAssignment.student_id == User.id)
        .where(HomeworkStudentAssignment.homework_id == homework_id)
        .order_by(HomeworkStudentAssignment.assigned_at.desc())
    )

    student_list = []
    for assignment, student_name, username in result.all():
        student_list.append(StudentHomeworkStatusResponse(
            id=assignment.id,
            homework_id=assignment.homework_id,
            student_id=assignment.student_id,
            # 手机注册学生 full_name 为空,回落 username(否则 str 校验炸 500)
            student_name=student_name or username or f"学生{assignment.student_id}",
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


@router.post("/homework/{homework_id}/toggle-closed")
async def toggle_homework_closed(
    homework_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """关闭/重新开放作业。关闭 = 学生端隐藏、不能再交卷,做题记录全部保留(区别于删除)"""
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
    homework.is_closed = not bool(homework.is_closed)
    await db.commit()
    return {"homework_id": homework_id, "is_closed": homework.is_closed,
            "message": "作业已关闭(学生做题记录已保留)" if homework.is_closed else "作业已重新开放"}


@router.delete("/homework/{homework_id}")
async def delete_homework(
    homework_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """删除/撤回作业(连带清理学生分配与尝试记录)。

    SQLite 默认不开 PRAGMA foreign_keys,ondelete=CASCADE 不生效
    (实测生产已有 5 条孤儿分配行,学生端「我的作业」会 JOIN 出脏数据),
    这里显式手动级联删除。
    """

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

    # 手动级联:先删尝试记录,再删学生分配,最后删作业本体
    from sqlalchemy import delete as sa_delete
    assign_ids = (await db.execute(
        select(HomeworkStudentAssignment.id).where(HomeworkStudentAssignment.homework_id == homework_id)
    )).scalars().all()
    if assign_ids:
        await db.execute(sa_delete(HomeworkAttemptRecord).where(
            HomeworkAttemptRecord.homework_student_assignment_id.in_(assign_ids)
        ))
        await db.execute(sa_delete(HomeworkStudentAssignment).where(
            HomeworkStudentAssignment.homework_id == homework_id
        ))
    await db.delete(homework)
    await db.commit()

    return {"message": "删除成功"}
