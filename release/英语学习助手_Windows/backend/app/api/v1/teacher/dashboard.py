from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordBook, Unit
from app.models.reading import ReadingPassage
from app.api.v1.auth import get_current_teacher

router = APIRouter()

@router.get("/stats")
async def get_teacher_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取教师仪表板统计数据
    """
    teacher_id = current_user.id
    now = datetime.utcnow()
    week_start = now - timedelta(days=now.weekday())  # 本周一

    # 1. 总单词数 (教师创建的单词)
    result = await db.execute(
        select(func.count()).select_from(Word)
        .where(Word.created_by == teacher_id)
    )
    total_words = result.scalar() or 0

    # 2. 单词本数 (教师创建的单词本)
    result = await db.execute(
        select(func.count()).select_from(WordBook)
        .where(WordBook.created_by == teacher_id)
    )
    total_books = result.scalar() or 0

    # 3. 学生人数 (所有学生用户)
    result = await db.execute(
        select(func.count()).select_from(User)
        .where(
            and_(
                User.role == 'student',
                User.is_active == True
            )
        )
    )
    total_students = result.scalar() or 0

    # 4. 本周阅读文章数 (作为"本周试卷"的替代,因为没有试卷表)
    result = await db.execute(
        select(func.count()).select_from(ReadingPassage)
        .where(
            and_(
                ReadingPassage.created_by == teacher_id,
                ReadingPassage.created_at >= week_start
            )
        )
    )
    weekly_passages = result.scalar() or 0

    # 5. 最近录入的单词 (最新5个)
    result = await db.execute(
        select(Word)
        .where(Word.created_by == teacher_id)
        .order_by(desc(Word.created_at))
        .limit(5)
    )
    recent_words_data = result.scalars().all()
    recent_words = []
    for word in recent_words_data:
        recent_words.append({
            "word": word.word,
            "status": "published",  # 简化处理,都显示为已发布
            "date": word.created_at.strftime('%Y-%m-%d') if word.created_at else ""
        })

    # 6. 今日完成学习的学生数
    from app.models.learning import StudySession
    today_start = datetime(now.year, now.month, now.day)

    result = await db.execute(
        select(func.count(func.distinct(StudySession.user_id)))
        .select_from(StudySession)
        .where(StudySession.started_at >= today_start)
    )
    today_active_students = result.scalar() or 0

    # 7. 单词本分配统计
    from app.models.learning import BookAssignment

    # 待分配单词本数 (教师创建但未分配的单词本)
    result = await db.execute(
        select(WordBook)
        .where(WordBook.created_by == teacher_id)
    )
    all_books = result.scalars().all()
    book_ids = [book.id for book in all_books]

    if book_ids:
        result = await db.execute(
            select(func.count(func.distinct(BookAssignment.book_id)))
            .select_from(BookAssignment)
            .where(BookAssignment.book_id.in_(book_ids))
        )
        assigned_books = result.scalar() or 0
    else:
        assigned_books = 0

    pending_assignments = len(book_ids) - assigned_books

    # 本周新增分配
    result = await db.execute(
        select(func.count()).select_from(BookAssignment)
        .where(
            and_(
                BookAssignment.book_id.in_(book_ids) if book_ids else False,
                BookAssignment.assigned_at >= week_start
            )
        )
    )
    weekly_new_assignments = result.scalar() or 0

    # 学生完成率 (简化计算)
    if total_students > 0 and today_active_students > 0:
        completion_rate = (today_active_students / total_students * 100)
    else:
        completion_rate = 0

    return {
        "total_words": total_words,
        "total_books": total_books,
        "total_students": total_students,
        "weekly_passages": weekly_passages,
        "recent_words": recent_words,
        "today_active_students": today_active_students,
        "pending_assignments": max(pending_assignments, 0),
        "completion_rate": round(completion_rate, 1),
        "weekly_new_assignments": weekly_new_assignments
    }
