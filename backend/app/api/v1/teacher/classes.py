"""
教师端班级管理API
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, Integer
from typing import List, Optional
from datetime import datetime, date, timedelta
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.user import User, Class, ClassStudent, StudyCalendar
from app.models.learning import WordMastery, LearningRecord, StudySession
from app.api.v1.auth import get_current_teacher

router = APIRouter()


# Schemas

class ClassCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None)

class ClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None

class ClassResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    teacher_id: int
    student_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True

class ClassStudentAdd(BaseModel):
    student_ids: List[int] = Field(...)


# Helper

async def _get_class_or_404(db: AsyncSession, class_id: int, teacher_id: int) -> Class:
    result = await db.execute(
        select(Class).where(and_(Class.id == class_id, Class.teacher_id == teacher_id))
    )
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "班级不存在")
    return cls


# 班级 CRUD

@router.get("/classes", response_model=List[ClassResponse])
async def list_classes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取教师的所有班级（含学生数）"""
    result = await db.execute(
        select(Class, func.count(ClassStudent.id).label("student_count"))
        .outerjoin(ClassStudent, ClassStudent.class_id == Class.id)
        .where(Class.teacher_id == current_user.id)
        .group_by(Class.id)
        .order_by(Class.created_at.desc())
    )
    return [
        ClassResponse(
            id=cls.id, name=cls.name, description=cls.description,
            teacher_id=cls.teacher_id, student_count=count,
            created_at=cls.created_at,
        )
        for cls, count in result.all()
    ]


@router.post("/classes", response_model=ClassResponse)
async def create_class(
    data: ClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """创建班级"""
    new_class = Class(name=data.name, description=data.description, teacher_id=current_user.id)
    db.add(new_class)
    await db.commit()
    await db.refresh(new_class)
    return ClassResponse(
        id=new_class.id, name=new_class.name, description=new_class.description,
        teacher_id=new_class.teacher_id, student_count=0, created_at=new_class.created_at,
    )


@router.put("/classes/{class_id}", response_model=ClassResponse)
async def update_class(
    class_id: int, data: ClassUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """更新班级"""
    cls = await _get_class_or_404(db, class_id, current_user.id)
    if data.name is not None:
        cls.name = data.name
    if data.description is not None:
        cls.description = data.description
    await db.commit()
    await db.refresh(cls)

    count_result = await db.execute(
        select(func.count(ClassStudent.id)).where(ClassStudent.class_id == cls.id)
    )
    return ClassResponse(
        id=cls.id, name=cls.name, description=cls.description,
        teacher_id=cls.teacher_id, student_count=count_result.scalar() or 0,
        created_at=cls.created_at,
    )


@router.delete("/classes/{class_id}")
async def delete_class(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """删除班级"""
    cls = await _get_class_or_404(db, class_id, current_user.id)
    await db.delete(cls)
    await db.commit()
    return {"message": "班级已删除"}


# 班级学生管理

@router.get("/classes/{class_id}/students")
async def get_class_students(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取班级学生列表"""
    await _get_class_or_404(db, class_id, current_user.id)
    result = await db.execute(
        select(User, ClassStudent.joined_at)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id)
        .order_by(User.username)
    )
    return [
        {
            "id": user.id, "username": user.username,
            "full_name": user.full_name or user.username,
            "phone": user.phone, "is_active": user.is_active,
            "joined_at": joined_at.isoformat() if joined_at else None,
        }
        for user, joined_at in result.all()
    ]


@router.post("/classes/{class_id}/students")
async def add_students_to_class(
    class_id: int, data: ClassStudentAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """批量添加学生到班级"""
    await _get_class_or_404(db, class_id, current_user.id)

    # 批量查询有效学生
    valid_result = await db.execute(
        select(User.id).where(and_(User.id.in_(data.student_ids), User.role == "student"))
    )
    valid_ids = {r[0] for r in valid_result.all()}

    # 批量查询已在班级中的
    existing_result = await db.execute(
        select(ClassStudent.student_id).where(
            and_(ClassStudent.class_id == class_id, ClassStudent.student_id.in_(valid_ids))
        )
    )
    existing_ids = {r[0] for r in existing_result.all()}

    to_add = valid_ids - existing_ids
    for sid in to_add:
        db.add(ClassStudent(class_id=class_id, student_id=sid))

    await db.commit()
    return {"message": f"已添加 {len(to_add)} 名学生", "added": len(to_add)}


@router.delete("/classes/{class_id}/students/{student_id}")
async def remove_student_from_class(
    class_id: int, student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """从班级移除学生"""
    await _get_class_or_404(db, class_id, current_user.id)
    result = await db.execute(
        select(ClassStudent).where(
            and_(ClassStudent.class_id == class_id, ClassStudent.student_id == student_id)
        )
    )
    cs = result.scalar_one_or_none()
    if not cs:
        raise HTTPException(404, "学生不在该班级中")
    await db.delete(cs)
    await db.commit()
    return {"message": "已移除"}


@router.get("/classes/{class_id}/available-students")
async def get_available_students(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取未分配到该班级的学生列表"""
    await _get_class_or_404(db, class_id, current_user.id)

    existing_result = await db.execute(
        select(ClassStudent.student_id).where(ClassStudent.class_id == class_id)
    )
    existing_ids = [r[0] for r in existing_result.all()]

    query = select(User).where(and_(User.role == "student", User.is_active == True))
    if existing_ids:
        query = query.where(User.id.notin_(existing_ids))

    result = await db.execute(query.order_by(User.username))
    return [
        {"id": s.id, "username": s.username, "full_name": s.full_name or s.username, "phone": s.phone}
        for s in result.scalars().all()
    ]


# 班级学生每日学习数据

@router.get("/classes/{class_id}/daily-stats")
async def get_class_daily_stats(
    class_id: int,
    target_date: Optional[str] = Query(None, description="日期 YYYY-MM-DD，默认今天"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取班级所有学生的某天学习数据汇总"""
    await _get_class_or_404(db, class_id, current_user.id)

    if target_date:
        try:
            dt = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "日期格式错误，应为 YYYY-MM-DD")
    else:
        dt = date.today()

    day_start = datetime.combine(dt, datetime.min.time())
    day_end = datetime.combine(dt + timedelta(days=1), datetime.min.time())

    # 获取班级学生
    students_result = await db.execute(
        select(User)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id)
        .order_by(User.username)
    )
    students = students_result.scalars().all()
    if not students:
        return {"class_id": class_id, "date": dt.isoformat(), "students": []}

    student_ids = [s.id for s in students]

    # 批量查询学习日历
    cal_result = await db.execute(
        select(StudyCalendar).where(
            and_(StudyCalendar.user_id.in_(student_ids), StudyCalendar.study_date == dt)
        )
    )
    cal_map = {c.user_id: c for c in cal_result.scalars().all()}

    # 批量查询学习记录
    rec_result = await db.execute(
        select(
            LearningRecord.user_id,
            func.count(LearningRecord.id).label('total'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
        )
        .where(and_(
            LearningRecord.user_id.in_(student_ids),
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end
        ))
        .group_by(LearningRecord.user_id)
    )
    rec_map = {r.user_id: (r.total or 0, r.correct or 0) for r in rec_result.all()}

    # 批量查询会话数
    sess_result = await db.execute(
        select(StudySession.user_id, func.count(StudySession.id).label('cnt'))
        .where(and_(
            StudySession.user_id.in_(student_ids),
            StudySession.started_at >= day_start,
            StudySession.started_at < day_end
        ))
        .group_by(StudySession.user_id)
    )
    sess_map = {r.user_id: r.cnt for r in sess_result.all()}

    daily_stats = []
    for student in students:
        cal = cal_map.get(student.id)
        total_records, correct = rec_map.get(student.id, (0, 0))
        sessions = sess_map.get(student.id, 0)
        accuracy = (correct / total_records * 100) if total_records > 0 else 0

        daily_stats.append({
            "user_id": student.id,
            "username": student.username,
            "full_name": student.full_name or student.username,
            "study_date": dt.isoformat(),
            "words_learned": cal.words_learned if cal else 0,
            "study_duration": cal.duration if cal else 0,
            "correct_count": correct,
            "wrong_count": total_records - correct,
            "accuracy_rate": round(accuracy, 1),
            "sessions_count": sessions,
        })

    return {"class_id": class_id, "date": dt.isoformat(), "students": daily_stats}


@router.get("/classes/{class_id}/student/{student_id}/detail")
async def get_class_student_detail(
    class_id: int, student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取班级中某个学生的详细学习数据（当日+累计+7天趋势）"""
    await _get_class_or_404(db, class_id, current_user.id)

    result = await db.execute(
        select(ClassStudent).where(
            and_(ClassStudent.class_id == class_id, ClassStudent.student_id == student_id)
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "学生不在该班级中")

    result = await db.execute(select(User).where(User.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")

    today = date.today()
    day_start = datetime.combine(today, datetime.min.time())
    day_end = datetime.combine(today + timedelta(days=1), datetime.min.time())

    # 当日: 日历
    cal_result = await db.execute(
        select(StudyCalendar).where(
            and_(StudyCalendar.user_id == student_id, StudyCalendar.study_date == today)
        )
    )
    cal = cal_result.scalar_one_or_none()

    # 当日: 学习记录
    rec_result = await db.execute(
        select(
            func.count(LearningRecord.id).label('total'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
        ).where(and_(
            LearningRecord.user_id == student_id,
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end
        ))
    )
    rec_row = rec_result.first()
    today_total = rec_row.total or 0
    today_correct = rec_row.correct or 0
    today_accuracy = (today_correct / today_total * 100) if today_total > 0 else 0

    # 当日: 会话数
    sess_result = await db.execute(
        select(func.count(StudySession.id)).where(and_(
            StudySession.user_id == student_id,
            StudySession.started_at >= day_start, StudySession.started_at < day_end
        ))
    )
    today_sessions = sess_result.scalar() or 0

    # 累计: WordMastery 聚合 (1 query)
    mastery_result = await db.execute(
        select(
            func.count(WordMastery.id).label('total'),
            func.sum((WordMastery.mastery_level >= 4).cast(Integer)).label('mastered'),
            func.sum((WordMastery.mastery_level < 3).cast(Integer)).label('weak'),
        ).where(WordMastery.user_id == student_id)
    )
    m_row = mastery_result.first()
    total_words_learned = m_row.total or 0
    total_mastered = m_row.mastered or 0
    weak_words_count = m_row.weak or 0

    # 累计: StudyCalendar 聚合 (1 query)
    cal_agg_result = await db.execute(
        select(
            func.count(StudyCalendar.id).label('days'),
            func.sum(StudyCalendar.duration).label('time'),
            func.max(StudyCalendar.study_date).label('last_date'),
        ).where(StudyCalendar.user_id == student_id)
    )
    cal_agg = cal_agg_result.first()
    total_study_days = cal_agg.days or 0
    total_study_time = cal_agg.time or 0
    last_active = datetime.combine(cal_agg.last_date, datetime.min.time()) if cal_agg.last_date else None

    # 累计: LearningRecord 聚合 (1 query)
    overall_result = await db.execute(
        select(
            func.count(LearningRecord.id).label('total'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
        ).where(LearningRecord.user_id == student_id)
    )
    overall_row = overall_result.first()
    overall_total = overall_row.total or 0
    overall_correct = overall_row.correct or 0
    overall_accuracy = (overall_correct / overall_total * 100) if overall_total > 0 else 0

    # 最近7天趋势 (1 query)
    week_start = today - timedelta(days=6)
    trend_result = await db.execute(
        select(StudyCalendar.study_date, StudyCalendar.words_learned).where(
            and_(StudyCalendar.user_id == student_id, StudyCalendar.study_date >= week_start)
        )
    )
    trend_map = {r.study_date: r.words_learned for r in trend_result.all()}

    recent_words = []
    recent_dates = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        recent_dates.append(d.strftime("%m/%d"))
        recent_words.append(trend_map.get(d, 0))

    return {
        "user_id": student.id,
        "username": student.username,
        "full_name": student.full_name or student.username,
        "today_words": cal.words_learned if cal else 0,
        "today_duration": cal.duration if cal else 0,
        "today_accuracy": round(today_accuracy, 1),
        "today_sessions": today_sessions,
        "total_words_learned": total_words_learned,
        "total_mastered": total_mastered,
        "total_study_days": total_study_days,
        "total_study_time": total_study_time,
        "overall_accuracy": round(overall_accuracy, 1),
        "weak_words_count": weak_words_count,
        "last_active": last_active.isoformat() if last_active else None,
        "recent_daily_words": recent_words,
        "recent_daily_dates": recent_dates,
    }
