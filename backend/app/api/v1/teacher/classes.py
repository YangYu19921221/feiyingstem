"""
教师端班级管理API
"""
import secrets
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, Integer, update, delete
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, date, timedelta, timezone
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.user import User, Class, ClassStudent, StudyCalendar, ClassInviteCode
from app.models.learning import WordMastery, LearningRecord, StudySession
from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class, get_my_class_student_ids
from app.services.auth_service import get_password_hash, generate_random_password

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
    """获取教师的所有班级（含在册学生数，已过滤 is_active=True）"""
    result = await db.execute(
        select(Class, func.count(ClassStudent.id).label("student_count"))
        .outerjoin(
            ClassStudent,
            (ClassStudent.class_id == Class.id) & (ClassStudent.is_active.is_(True)),
        )
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
    q: Optional[str] = Query(None, description="搜索学生姓名或用户名"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取班级学生列表（仅 active），支持 q= 搜索"""
    await _get_class_or_404(db, class_id, current_user.id)
    stmt = (
        select(User, ClassStudent.joined_at)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.full_name.like(like)) | (User.username.like(like)))
    result = await db.execute(stmt.order_by(User.username))
    return [
        {
            "id": user.id, "username": user.username,
            "full_name": user.full_name,
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
    """
    批量添加学生到班级
    池子规则：散户 + 该教师其他班的学生
    - 在别的教师班里 active 的 → 409 拒绝（避免抢学生）
    - 在我自己其他班 active 的 → 自动从源班 set is_active=False（视作内部转班）
    """
    await _get_class_or_404(db, class_id, current_user.id)
    if not data.student_ids:
        return {"added": 0, "transferred": 0}

    # 拉所有该学生当前的 active 班级关系
    cur_links_res = await db.execute(
        select(ClassStudent, Class)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            ClassStudent.student_id.in_(data.student_ids),
            ClassStudent.is_active.is_(True),
        )
    )
    cur_links = cur_links_res.all()

    # 检测"在别的教师班里"的，直接拒绝
    blocked = []
    for link, cls in cur_links:
        if cls.teacher_id != current_user.id:
            blocked.append(link.student_id)
    if blocked:
        raise HTTPException(409, f"以下学生已在其他教师的班级，无法直接添加：{sorted(set(blocked))}")

    # 对在我自己其他班 active 的，关闭旧关系（内部转班）
    transferred = 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for link, cls in cur_links:
        if cls.teacher_id == current_user.id and link.class_id != class_id:
            link.is_active = False
            link.left_at = now
            transferred += 1
        elif link.class_id == class_id:
            # 已在本班 active —— 跳过（不重复添加）
            data.student_ids = [sid for sid in data.student_ids if sid != link.student_id]

    # 对剩下的目标学生，开新关系（同时检查同班是否有 inactive 历史 → 复活）
    if data.student_ids:
        existing_inactive_res = await db.execute(
            select(ClassStudent).where(
                ClassStudent.class_id == class_id,
                ClassStudent.student_id.in_(data.student_ids),
                ClassStudent.is_active.is_(False),
            )
        )
        revive_map = {row.student_id: row for row in existing_inactive_res.scalars().all()}

        for sid in data.student_ids:
            if sid in revive_map:
                row = revive_map[sid]
                row.is_active = True
                row.left_at = None
            else:
                db.add(ClassStudent(class_id=class_id, student_id=sid, is_active=True))

    await db.commit()
    return {"added": len(data.student_ids), "transferred": transferred}


@router.delete("/classes/{class_id}/students/{student_id}")
async def remove_student_from_class(
    class_id: int, student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """软删除：将学生标记为 is_active=False"""
    await _get_class_or_404(db, class_id, current_user.id)
    result = await db.execute(
        update(ClassStudent)
        .where(
            ClassStudent.class_id == class_id,
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        )
        .values(is_active=False, left_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )
    if result.rowcount == 0:
        raise HTTPException(404, "学生不在该班级或已移出")
    await db.commit()
    return {"removed": True}


# 同教师内转班
class TeacherTransferRequest(BaseModel):
    from_class_id: int
    to_class_id: int


@router.post("/students/{student_id}/transfer")
async def teacher_transfer_student(
    student_id: int,
    body: TeacherTransferRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """同教师内转班 — 原子事务

    限制：
    - from_class_id 与 to_class_id 必须都属于当前教师
    - 学生必须当前在 from_class_id 班级（is_active=True）
    - 不允许 from == to
    跨教师转班请走 admin 端 /admin/students/{id}/transfer
    """
    if body.from_class_id == body.to_class_id:
        raise HTTPException(400, "源班级与目标班级不能相同")

    await _get_class_or_404(db, body.from_class_id, current_user.id)
    await _get_class_or_404(db, body.to_class_id, current_user.id)

    cur_res = await db.execute(
        select(ClassStudent).where(
            ClassStudent.class_id == body.from_class_id,
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        )
    )
    if cur_res.scalar_one_or_none() is None:
        raise HTTPException(404, "学生不在源班级")

    dup_res = await db.execute(
        select(ClassStudent).where(
            ClassStudent.class_id == body.to_class_id,
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        )
    )
    if dup_res.scalar_one_or_none() is not None:
        raise HTTPException(409, "学生已在目标班级")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.execute(
        update(ClassStudent)
        .where(
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        )
        .values(is_active=False, left_at=now)
    )
    db.add(
        ClassStudent(
            class_id=body.to_class_id,
            student_id=student_id,
            is_active=True,
        )
    )
    await db.commit()
    return {"transferred": True, "from_class_id": body.from_class_id, "to_class_id": body.to_class_id}


@router.get("/classes/{class_id}/available-students")
async def get_available_students(
    class_id: int,
    q: Optional[str] = Query(None, description="按用户名/姓名/手机/邮箱模糊搜索"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    可加入该班的学生池：
      - 不在任何"真实存在的"active 班里的散户（自助注册的孩子）
      - ∪ 当前教师其他班里 active 的学生（不含本班）
    支持 q 搜索 + 分页，返回 {items, total, page, size}
    """
    await _get_class_or_404(db, class_id, current_user.id)

    # 1) 不在本班 active 的所有 active 学生
    in_this_class_subq = (
        select(ClassStudent.student_id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
    ).scalar_subquery()

    # 2) "属于其它教师班级"的学生（被排除）
    other_teacher_subq = (
        select(ClassStudent.student_id)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            ClassStudent.is_active.is_(True),
            Class.teacher_id != current_user.id,
        )
    ).scalar_subquery()

    base = (
        select(User)
        .where(
            User.role == "student",
            User.is_active == True,
            User.id.notin_(in_this_class_subq),
            User.id.notin_(other_teacher_subq),
        )
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        base = base.where(
            or_(
                User.username.like(like),
                User.full_name.like(like),
                User.phone.like(like),
                User.email.like(like),
            )
        )

    total_res = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_res.scalar() or 0

    res = await db.execute(
        base.order_by(User.created_at.desc()).offset((page - 1) * size).limit(size)
    )
    students = res.scalars().all()

    # 标记每个学生的"来源"：unassigned（散户）/ my_class:N（我自己其他班）
    my_class_map_res = await db.execute(
        select(ClassStudent.student_id, Class.id, Class.name)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            Class.teacher_id == current_user.id,
            ClassStudent.is_active.is_(True),
            ClassStudent.class_id != class_id,
            ClassStudent.student_id.in_([s.id for s in students]) if students else False,
        )
    )
    src_map: dict = {}
    for sid, cid, cname in my_class_map_res.all():
        src_map[sid] = {"class_id": cid, "class_name": cname}

    items = []
    for s in students:
        from_class = src_map.get(s.id)
        items.append({
            "id": s.id,
            "username": s.username,
            "full_name": s.full_name or s.username,
            "phone": s.phone,
            "email": s.email,
            "from_class": from_class,  # None = 散户；非空 = 我其他班的学生
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "size": size}


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
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
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
            and_(ClassStudent.class_id == class_id, ClassStudent.student_id == student_id,
                 ClassStudent.is_active.is_(True))
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


@router.get("/student/{student_id}/ai-advice")
async def get_student_ai_advice(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """基于学生学习数据生成AI学习建议"""
    await assert_student_in_my_class(db, current_user.id, student_id)
    result = await db.execute(select(User).where(User.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")

    today = date.today()

    # 聚合数据
    mastery_result = await db.execute(
        select(
            func.count(WordMastery.id).label('total'),
            func.sum((WordMastery.mastery_level >= 4).cast(Integer)).label('mastered'),
            func.sum((WordMastery.mastery_level < 3).cast(Integer)).label('weak'),
        ).where(WordMastery.user_id == student_id)
    )
    m = mastery_result.first()
    total_words = m.total or 0
    mastered = m.mastered or 0
    weak = m.weak or 0

    rec_result = await db.execute(
        select(
            func.count(LearningRecord.id).label('total'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
        ).where(LearningRecord.user_id == student_id)
    )
    r = rec_result.first()
    total_records = r.total or 0
    correct = r.correct or 0
    accuracy = (correct / total_records * 100) if total_records > 0 else 0

    cal_result = await db.execute(
        select(
            func.count(StudyCalendar.id).label('days'),
            func.sum(StudyCalendar.duration).label('time'),
            func.max(StudyCalendar.study_date).label('last'),
        ).where(StudyCalendar.user_id == student_id)
    )
    c = cal_result.first()
    study_days = c.days or 0
    study_time = c.time or 0
    last_date = c.last

    # 各题型错误率
    mode_result = await db.execute(
        select(
            LearningRecord.learning_mode,
            func.count(LearningRecord.id).label('total'),
            func.sum(LearningRecord.is_correct.cast(Integer)).label('correct'),
        )
        .where(LearningRecord.user_id == student_id)
        .group_by(LearningRecord.learning_mode)
    )
    mode_stats = {}
    for row in mode_result.all():
        t = row.total or 0
        c_val = row.correct or 0
        mode_stats[row.learning_mode] = {
            "total": t, "correct": c_val,
            "accuracy": round(c_val / t * 100, 1) if t > 0 else 0
        }

    # 生成建议
    alerts = []       # 预警
    suggestions = []  # 建议
    level = "normal"  # normal / warning / danger

    # 1. 数据不足
    if total_words == 0:
        return {
            "student_name": student.full_name or student.username,
            "level": "info",
            "score_summary": "暂无数据",
            "alerts": [],
            "suggestions": ["该学生还没有开始学习，请督促尽快开始"],
            "mode_analysis": {},
            "study_habit": "暂无学习记录",
        }

    # 2. 准确率评估
    if accuracy < 40:
        level = "danger"
        alerts.append(f"整体准确率仅 {accuracy:.0f}%，远低于及格线，需要重点关注")
        suggestions.append("建议回到基础单元重新学习，不要急于求进")
        suggestions.append("每天学习量减少到5-10个单词，确保每个都掌握")
    elif accuracy < 60:
        level = "warning"
        alerts.append(f"整体准确率 {accuracy:.0f}%，低于及格线，需要加强练习")
        suggestions.append("建议增加复习频次，每天至少复习一次已学单词")
    elif accuracy < 80:
        suggestions.append(f"准确率 {accuracy:.0f}%，还有提升空间，建议多做错题练习")

    # 3. 薄弱单词评估
    weak_ratio = (weak / total_words * 100) if total_words > 0 else 0
    if weak_ratio > 50:
        alerts.append(f"薄弱单词占比高达 {weak_ratio:.0f}%（{weak}/{total_words}），掌握度不足")
        suggestions.append("建议使用错题集功能重点攻克薄弱单词")
    elif weak_ratio > 30:
        suggestions.append(f"薄弱单词 {weak} 个，建议每天安排错题练习")

    # 4. 学习习惯评估
    days_since_last = (today - last_date).days if last_date else 999
    if days_since_last > 7:
        alerts.append(f"已经 {days_since_last} 天没有学习了，学习中断会导致遗忘加速")
        suggestions.append("建议立即恢复学习，先从复习已学单词开始")
        if level == "normal":
            level = "warning"
    elif days_since_last > 3:
        suggestions.append(f"已 {days_since_last} 天未学习，建议保持每日学习习惯")

    avg_daily_time = (study_time / study_days) if study_days > 0 else 0
    if avg_daily_time < 300 and study_days > 0:  # 少于5分钟
        suggestions.append(f"平均每天学习仅 {avg_daily_time // 60} 分钟，建议每天至少学习15-20分钟")

    habit_desc = f"累计学习 {study_days} 天，平均每天 {avg_daily_time // 60} 分钟"

    # 5. 各题型分析
    mode_names = {"classify": "分类记忆", "spelling": "拼写", "fillblank": "填空", "quiz": "选择题"}
    weakest_mode = None
    weakest_acc = 100
    for mode, stats in mode_stats.items():
        if stats["total"] >= 3 and stats["accuracy"] < weakest_acc:
            weakest_acc = stats["accuracy"]
            weakest_mode = mode

    if weakest_mode and weakest_acc < 50:
        name = mode_names.get(weakest_mode, weakest_mode)
        suggestions.append(f"「{name}」题型准确率最低（{weakest_acc}%），建议重点加强该类型练习")

    # 6. 进步建议
    mastery_rate = (mastered / total_words * 100) if total_words > 0 else 0
    if mastery_rate > 80:
        suggestions.append("掌握率很高，可以尝试进阶到更难的单元")
    elif mastery_rate > 50:
        suggestions.append("掌握进度不错，继续保持，注意复习薄弱单词")

    if not suggestions:
        suggestions.append("学习状态良好，继续保持！")

    score_summary = f"学习 {total_words} 词 · 掌握 {mastered} 词 · 准确率 {accuracy:.0f}%"

    return {
        "student_name": student.full_name or student.username,
        "level": level,
        "score_summary": score_summary,
        "alerts": alerts,
        "suggestions": suggestions,
        "mode_analysis": {mode_names.get(k, k): v for k, v in mode_stats.items()},
        "study_habit": habit_desc,
    }


# ========================================
# 教师端学生 CRUD（"我的学生" — 直接归到该教师名下）
# ========================================

DEFAULT_TEACHER_CLASS_NAME = "我的学生"


async def _get_or_create_default_class(db: AsyncSession, teacher_id: int) -> Class:
    """教师没有任何班级时建一个默认班；否则返回最早创建的班级"""
    res = await db.execute(
        select(Class).where(Class.teacher_id == teacher_id).order_by(Class.id)
    )
    cls = res.scalars().first()
    if cls:
        return cls
    cls = Class(name=DEFAULT_TEACHER_CLASS_NAME, description="默认班级", teacher_id=teacher_id)
    db.add(cls)
    await db.flush()
    return cls


class TeacherStudentCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    class_id: Optional[int] = None  # 不传则放进默认班


@router.post("/students")
async def create_student(
    body: TeacherStudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    教师创建学生 — 创建后自动加入指定班级（不传则进默认班）
    返回学生 + 初始密码（密码不传则随机生成，仅返回一次）
    """
    if body.class_id is not None:
        await _get_class_or_404(db, body.class_id, current_user.id)
        target_class_id = body.class_id
    else:
        cls = await _get_or_create_default_class(db, current_user.id)
        target_class_id = cls.id

    pwd = body.password or generate_random_password()
    new_user = User(
        username=body.username,
        email=body.email or f"{body.username}@feiying.local",
        full_name=body.full_name or body.username,
        hashed_password=get_password_hash(pwd),
        role="student",
        is_active=True,
    )
    db.add(new_user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="用户名或邮箱已存在")

    db.add(ClassStudent(class_id=target_class_id, student_id=new_user.id, is_active=True))
    await db.commit()
    await db.refresh(new_user)
    return {
        "id": new_user.id,
        "username": new_user.username,
        "full_name": new_user.full_name,
        "email": new_user.email,
        "is_active": new_user.is_active,
        "class_id": target_class_id,
        "initial_password": pwd,
    }


@router.get("/students")
async def list_my_students(
    q: Optional[str] = Query(None, description="按用户名/姓名/手机/邮箱模糊搜索"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """教师"我的学生" — 自己班里在册的所有学生，支持 q 搜索 + 分页"""
    ids = await get_my_class_student_ids(db, current_user.id)
    if not ids:
        return {"items": [], "total": 0, "page": page, "size": size}
    stmt = select(User).where(User.id.in_(ids), User.is_active == True)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.username.like(like),
                User.full_name.like(like),
                User.email.like(like),
                User.phone.like(like),
            )
        )

    total_res = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = total_res.scalar() or 0

    res = await db.execute(
        stmt.order_by(User.username).offset((page - 1) * size).limit(size)
    )
    items = [
        {
            "id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "phone": u.phone,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login": u.last_login.isoformat() if u.last_login else None,
        }
        for u in res.scalars().all()
    ]
    return {"items": items, "total": total, "page": page, "size": size}


# ========================================
# 班级邀请码（教师生成 → 学生输入加入）
# ========================================

INVITE_CODE_TTL_HOURS = 24


def _gen_invite_code() -> str:
    """6 位数字"""
    return "".join(secrets.choice("0123456789") for _ in range(6))


class InviteCodeResponse(BaseModel):
    code: str
    class_id: int
    class_name: str
    expires_at: datetime
    hours_left: int
    redemption_count: int


@router.post("/classes/{class_id}/invite-code", response_model=InviteCodeResponse)
async def create_class_invite_code(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """生成或刷新班级邀请码（24h 有效）— 同一班只保留最新一条"""
    cls = await _get_class_or_404(db, class_id, current_user.id)

    # 删旧码（无论是否过期），只保留最新
    await db.execute(
        delete(ClassInviteCode).where(ClassInviteCode.class_id == class_id)
    )

    code = ""
    for _ in range(5):
        candidate = _gen_invite_code()
        check = await db.execute(
            select(ClassInviteCode).where(ClassInviteCode.code == candidate)
        )
        if not check.scalar_one_or_none():
            code = candidate
            break
    if not code:
        raise HTTPException(500, "邀请码生成失败，请重试")

    expires_at = datetime.utcnow() + timedelta(hours=INVITE_CODE_TTL_HOURS)
    db.add(ClassInviteCode(
        code=code,
        class_id=class_id,
        teacher_id=current_user.id,
        expires_at=expires_at,
    ))
    await db.commit()
    return InviteCodeResponse(
        code=code, class_id=class_id, class_name=cls.name,
        expires_at=expires_at, hours_left=INVITE_CODE_TTL_HOURS,
        redemption_count=0,
    )


@router.get("/classes/{class_id}/invite-code")
async def get_class_invite_code(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """查看当前班级未过期的邀请码（可能没有，返回 null）"""
    cls = await _get_class_or_404(db, class_id, current_user.id)
    res = await db.execute(
        select(ClassInviteCode).where(ClassInviteCode.class_id == class_id)
    )
    code_row = res.scalar_one_or_none()
    if not code_row:
        return None
    if code_row.expires_at < datetime.utcnow():
        return None
    seconds_left = max(0, int((code_row.expires_at - datetime.utcnow()).total_seconds()))
    hours_left = seconds_left // 3600
    return {
        "code": code_row.code,
        "class_id": class_id,
        "class_name": cls.name,
        "expires_at": code_row.expires_at.isoformat(),
        "hours_left": hours_left,
        "redemption_count": code_row.redemption_count or 0,
    }


# ========================================
# Excel 批量入班（手机号匹配）
# ========================================

class BatchByPhonesRequest(BaseModel):
    phones: List[str] = Field(..., min_length=1, max_length=500)


@router.post("/classes/{class_id}/students-by-phones")
async def add_students_by_phones(
    class_id: int,
    body: BatchByPhonesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    Excel 批量入班 — 按手机号精确匹配 active student
    - 命中且符合池子规则 → 入班（含我自己其他班的"内部转班"）
    - 在别的教师班里 active → 跳过并列在 blocked
    - DB 找不到 → 列在 not_found
    - 已经在本班 active → 列在 already_in
    """
    await _get_class_or_404(db, class_id, current_user.id)

    phones = list({p.strip() for p in body.phones if p and p.strip()})
    if not phones:
        return {"added": 0, "transferred": 0, "not_found": [], "blocked": [], "already_in": []}

    res = await db.execute(
        select(User).where(
            User.phone.in_(phones),
            User.role == "student",
            User.is_active == True,
        )
    )
    found_users = res.scalars().all()
    found_phone_to_user = {u.phone: u for u in found_users}
    not_found = [p for p in phones if p not in found_phone_to_user]

    if not found_users:
        return {"added": 0, "transferred": 0, "not_found": not_found, "blocked": [], "already_in": []}

    user_ids = [u.id for u in found_users]
    cur_links_res = await db.execute(
        select(ClassStudent, Class)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            ClassStudent.student_id.in_(user_ids),
            ClassStudent.is_active.is_(True),
        )
    )
    links = cur_links_res.all()

    uid_to_phone = {u.id: u.phone for u in found_users}
    blocked_phones: List[str] = []
    already_in_phones: List[str] = []
    transfer_targets: List[int] = []
    skip_user_ids: set = set()

    for link, cls in links:
        if cls.teacher_id != current_user.id:
            blocked_phones.append(uid_to_phone[link.student_id])
            skip_user_ids.add(link.student_id)
        elif link.class_id == class_id:
            already_in_phones.append(uid_to_phone[link.student_id])
            skip_user_ids.add(link.student_id)
        else:
            transfer_targets.append(link.id)

    transferred = 0
    if transfer_targets:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.execute(
            update(ClassStudent)
            .where(ClassStudent.id.in_(transfer_targets))
            .values(is_active=False, left_at=now)
        )
        transferred = len(transfer_targets)

    target_ids = [u.id for u in found_users if u.id not in skip_user_ids]
    if not target_ids:
        await db.commit()
        return {
            "added": 0, "transferred": transferred,
            "not_found": not_found,
            "blocked": sorted(set(blocked_phones)),
            "already_in": sorted(set(already_in_phones)),
        }

    inactive_res = await db.execute(
        select(ClassStudent).where(
            ClassStudent.class_id == class_id,
            ClassStudent.student_id.in_(target_ids),
            ClassStudent.is_active.is_(False),
        )
    )
    revive_map = {r.student_id: r for r in inactive_res.scalars().all()}

    for sid in target_ids:
        if sid in revive_map:
            row = revive_map[sid]
            row.is_active = True
            row.left_at = None
        else:
            db.add(ClassStudent(class_id=class_id, student_id=sid, is_active=True))

    await db.commit()
    return {
        "added": len(target_ids),
        "transferred": transferred,
        "not_found": not_found,
        "blocked": sorted(set(blocked_phones)),
        "already_in": sorted(set(already_in_phones)),
    }
