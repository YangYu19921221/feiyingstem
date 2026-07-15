"""管理员 - 给学生管理订阅书本 + 查学生考试成绩

加书复用 book_assignments 表(owned 即由此判定);考试成绩合并
单元考试(ExamSubmission)与小组过关检测(GroupExamRecord)按时间倒序。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.word import WordBook, Unit
from app.models.learning import BookAssignment, ExamSubmission, ExamPaper, GroupExamRecord
from app.api.v1.auth import get_current_admin, get_current_admin_or_org_admin

router = APIRouter()


class AddBookRequest(BaseModel):
    book_id: int


async def _student_or_404(db: AsyncSession, student_id: int) -> User:
    res = await db.execute(select(User).where(User.id == student_id))
    stu = res.scalar_one_or_none()
    if not stu:
        raise HTTPException(404, "学生不存在")
    return stu


# ─────────────────────────────────────────────
# 订阅书本
# ─────────────────────────────────────────────
@router.get("/students/{student_id}/books")
async def list_student_books(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """列出学生已授权的书本(book_assignments)。"""
    await _student_or_404(db, student_id)
    rows = await db.execute(
        select(BookAssignment, WordBook.name)
        .join(WordBook, WordBook.id == BookAssignment.book_id)
        .where(BookAssignment.student_id == student_id)
        .order_by(desc(BookAssignment.assigned_at))
    )
    return [
        {
            "assignment_id": a.id,
            "book_id": a.book_id,
            "book_name": name,
            "scope_type": a.scope_type,
            "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
        }
        for a, name in rows.all()
    ]


@router.post("/students/{student_id}/books")
async def add_student_book(
    student_id: int,
    body: AddBookRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """给学生整本授权一本单词本(已存在则不重复加)。"""
    await _student_or_404(db, student_id)
    book = (await db.execute(select(WordBook).where(WordBook.id == body.book_id))).scalar_one_or_none()
    if not book:
        raise HTTPException(404, "单词本不存在")

    # 查重: 同书已整本授权则跳过
    existing = (await db.execute(
        select(BookAssignment).where(and_(
            BookAssignment.student_id == student_id,
            BookAssignment.book_id == body.book_id,
            BookAssignment.scope_type == "book",
        ))
    )).scalar_one_or_none()
    if existing:
        return {"success": True, "assignment_id": existing.id, "already": True}

    assignment = BookAssignment(
        book_id=body.book_id,
        student_id=student_id,
        teacher_id=current_user.id,  # admin 作为分配者
        scope_type="book",
    )
    db.add(assignment)
    await db.commit()
    return {"success": True, "assignment_id": assignment.id, "already": False}


@router.delete("/students/{student_id}/books/{assignment_id}")
async def remove_student_book(
    student_id: int,
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """取消一条书本授权(校验归属此学生)。"""
    a = (await db.execute(
        select(BookAssignment).where(and_(
            BookAssignment.id == assignment_id,
            BookAssignment.student_id == student_id,
        ))
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "授权记录不存在")
    await db.delete(a)
    await db.commit()
    return {"deleted": True}


# ─────────────────────────────────────────────
# 考试成绩(单元 + 小组,合并按时间倒序)
# ─────────────────────────────────────────────
@router.get("/students/{student_id}/exams")
async def list_student_exams(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """学生的单元考试 + 小组过关检测历史,合并按时间倒序。"""
    await _student_or_404(db, student_id)

    items = []

    # 单元考试: ExamSubmission + paper.title 兜底单元名,有 unit_id 则 JOIN units
    unit_rows = await db.execute(
        select(ExamSubmission, ExamPaper.title, Unit.name)
        .join(ExamPaper, ExamPaper.id == ExamSubmission.paper_id)
        .outerjoin(Unit, Unit.id == ExamSubmission.unit_id)
        .where(ExamSubmission.user_id == student_id)
        .order_by(desc(ExamSubmission.submitted_at))
    )
    for sub, title, unit_name in unit_rows.all():
        total = sub.total_score or 0
        score = sub.score or 0
        accuracy = round(score / total * 100, 1) if total > 0 else 0
        items.append({
            "type": "unit",
            "label": unit_name or title or "单元考试",
            "score": score,
            "total_score": total,
            "accuracy": accuracy,
            "at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        })

    # 小组过关检测
    group_rows = await db.execute(
        select(GroupExamRecord, Unit.name)
        .outerjoin(Unit, Unit.id == GroupExamRecord.unit_id)
        .where(GroupExamRecord.user_id == student_id)
        .order_by(desc(GroupExamRecord.created_at))
    )
    for rec, unit_name in group_rows.all():
        base = unit_name or "小组过关"
        items.append({
            "type": "group",
            "label": f"{base} · 第{(rec.group_index or 0) + 1}组",
            "score": rec.score or 0,
            "total_score": 100,
            "accuracy": rec.score or 0,  # 小组分数本就是百分制
            "correct_count": rec.correct_count or 0,
            "total_questions": rec.total_questions or 0,
            "at": rec.created_at.isoformat() if rec.created_at else None,
        })

    # 合并按时间倒序(None 时间排最后)
    items.sort(key=lambda x: x["at"] or "", reverse=True)
    return items
