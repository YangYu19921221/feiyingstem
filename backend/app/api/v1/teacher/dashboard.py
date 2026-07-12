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

@router.get("/dashboard/stats")
async def get_teacher_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取教师仪表板统计数据

    注意路径必须是 /dashboard/stats:book_assignments 路由先注册且有 GET /stats,
    用 /stats 会被遮蔽(实测浏览器打到的是分配统计数组,仪表板全显示 0)。
    """
    teacher_id = current_user.id
    now = datetime.utcnow()
    week_start = now - timedelta(days=now.weekday())  # 本周一

    # 1. 总单词数(全局词库:词是批量导入的,created_by 为空;词库全校共享,按全局统计)
    result = await db.execute(select(func.count()).select_from(Word))
    total_words = result.scalar() or 0

    # 2. 单词本数(同上,全局)
    result = await db.execute(select(func.count()).select_from(WordBook))
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

    # 6. 今日完成学习的学生数(北京今天)
    from app.models.learning import StudySession
    from app.core.timeutil import local_today_utc_range
    today_start, _ = local_today_utc_range()

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
    if book_ids:
        result = await db.execute(
            select(func.count()).select_from(BookAssignment)
            .where(
                and_(
                    BookAssignment.book_id.in_(book_ids),
                    BookAssignment.assigned_at >= week_start
                )
            )
        )
        weekly_new_assignments = result.scalar() or 0
    else:
        weekly_new_assignments = 0

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


@router.get("/recent-activities")
async def get_recent_activities(
    days: int = 3,
    limit: int = 20,
    q: str = "",
    student_id: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    今日动态:本教师学生最近的完成事件(作业完成 + 单元学完)。

    - 作业完成:homework_student_assignments.status='completed',仅本教师布置的作业
    - 单元学完:learning_progress.is_completed,仅本教师班级的学生;
      同一学生同一单元多模式完成只显示一条(取最新时间)
    - q:按学生姓名/用户名/作业标题/书名/单元名模糊搜索
    - student_id:只看某个学生(实时课堂点学生查「最近做了哪些任务」)
    - 时间戳按 UTC 存储,输出转北京时间字符串,前端直接展示
    """
    from sqlalchemy import or_
    from app.models.learning import (
        HomeworkAssignment, HomeworkStudentAssignment, LearningProgress,
    )
    from app.api.v1.teacher._permissions import get_my_class_student_ids
    from app.core.timeutil import LOCAL_TZ
    from zoneinfo import ZoneInfo

    days = max(1, min(days, 30))
    limit = max(1, min(limit, 200))
    q = (q or "").strip()
    like = f"%{q}%" if q else None
    cutoff = datetime.utcnow() - timedelta(days=days)
    utc = ZoneInfo("UTC")

    def fmt_bjt(dt: datetime) -> str:
        """UTC naive → 北京时间 'MM-DD HH:MM'"""
        return dt.replace(tzinfo=utc).astimezone(LOCAL_TZ).strftime('%m-%d %H:%M')

    activities: list[dict] = []

    # 1) 作业完成事件(本教师布置的作业)
    hw_stmt = (
        select(
            HomeworkStudentAssignment.completed_at,
            HomeworkStudentAssignment.best_score,
            User.full_name,
            User.username,
            HomeworkAssignment.title,
        )
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .join(User, User.id == HomeworkStudentAssignment.student_id)
        .where(
            HomeworkStudentAssignment.status == 'completed',
            HomeworkStudentAssignment.completed_at.isnot(None),
            HomeworkStudentAssignment.completed_at >= cutoff,
            HomeworkAssignment.teacher_id == current_user.id,
        )
    )
    if like:
        hw_stmt = hw_stmt.where(or_(
            User.full_name.like(like),
            User.username.like(like),
            HomeworkAssignment.title.like(like),
        ))
    if student_id:
        hw_stmt = hw_stmt.where(HomeworkStudentAssignment.student_id == student_id)
    hw_res = await db.execute(
        hw_stmt.order_by(desc(HomeworkStudentAssignment.completed_at)).limit(limit)
    )
    for completed_at, best_score, student_name, username, title in hw_res.all():
        activities.append({
            "type": "homework",
            "student_name": student_name or username,
            "title": title,
            "score": best_score,
            "completed_at": completed_at,
        })

    # 2) 单元学完事件(本教师班级的学生)
    class_ids = await get_my_class_student_ids(db, current_user.id)
    if class_ids:
        lp_stmt = (
            select(
                LearningProgress.user_id,
                LearningProgress.unit_id,
                func.max(LearningProgress.completed_at).label('done_at'),
                User.full_name,
                User.username,
                Unit.unit_number,
                Unit.name,
                WordBook.name.label('book_name'),
            )
            .join(User, User.id == LearningProgress.user_id)
            .join(Unit, Unit.id == LearningProgress.unit_id)
            .join(WordBook, WordBook.id == Unit.book_id)
            .where(
                LearningProgress.is_completed == True,
                LearningProgress.completed_at.isnot(None),
                LearningProgress.completed_at >= cutoff,
                LearningProgress.user_id.in_(class_ids),
            )
        )
        if like:
            lp_stmt = lp_stmt.where(or_(
                User.full_name.like(like),
                User.username.like(like),
                Unit.name.like(like),
                WordBook.name.like(like),
            ))
        if student_id:
            lp_stmt = lp_stmt.where(LearningProgress.user_id == student_id)
        lp_res = await db.execute(
            # 同一学生同一单元多模式完成 → 合并成一条
            lp_stmt.group_by(LearningProgress.user_id, LearningProgress.unit_id,
                             User.full_name, User.username, Unit.unit_number, Unit.name, WordBook.name)
                   .order_by(desc('done_at'))
                   .limit(limit)
        )
        for _uid, _unit_id, done_at, student_name, username, unit_number, unit_name, book_name in lp_res.all():
            activities.append({
                "type": "unit",
                "student_name": student_name or username,
                "title": f"{book_name} · Unit {unit_number} {unit_name}",
                "score": None,
                "completed_at": done_at,
            })

    # 3) 合并排序,取最新 limit 条,时间转北京展示格式
    activities.sort(key=lambda a: a["completed_at"], reverse=True)
    return {
        "activities": [
            {
                "type": a["type"],
                "student_name": a["student_name"],
                "title": a["title"],
                "score": a["score"],
                "time": fmt_bjt(a["completed_at"]),
            }
            for a in activities[:limit]
        ]
    }
