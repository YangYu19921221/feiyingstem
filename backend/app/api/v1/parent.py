"""家长端 API
- 学生生成绑定码 → 家长用绑定码注册并自动绑定
- 已注册家长可继续绑定其他孩子（多孩支持）
- 家长看自己孩子的完整学习数据看板
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_, case, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range, local_today_utc_range
from app.api.v1.auth import get_current_student, get_current_parent
from app.services.auth_service import get_password_hash, verify_password, create_access_token
from app.models.user import User, ParentStudentLink, ParentBindCode
from app.models.learning import LearningRecord, StudySession, WordMastery
from app.models.word import Word, WordDefinition

router = APIRouter()


# ================== Schemas ==================

class BindCodeResponse(BaseModel):
    code: str
    expires_at: datetime
    minutes_left: int


class ParentRegisterRequest(BaseModel):
    bind_code: str = Field(..., min_length=6, max_length=8)
    phone: str = Field(..., min_length=11, max_length=20)
    password: str = Field(..., min_length=6, max_length=64)
    full_name: Optional[str] = Field(None, max_length=50)


class ParentLoginRequest(BaseModel):
    phone: str
    password: str


class ParentTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    parent_id: int
    full_name: Optional[str]


class ChildSummary(BaseModel):
    student_id: int
    username: str
    full_name: Optional[str]
    today_minutes: int
    today_words: int
    streak_days: int


class BindAdditionalRequest(BaseModel):
    bind_code: str = Field(..., min_length=6, max_length=8)


# ================== 学生：生成绑定码 ==================

@router.post("/student/parent-bind-codes", response_model=BindCodeResponse)
async def generate_parent_bind_code(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """学生发起 — 生成 6 位绑定码（5 分钟有效），告诉家长去注册"""
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    expires_at = datetime.utcnow() + timedelta(minutes=5)
    db.add(ParentBindCode(code=code, student_id=current_user.id, expires_at=expires_at))
    await db.commit()
    return BindCodeResponse(code=code, expires_at=expires_at, minutes_left=5)


# ================== 家长：注册（含绑定）==================

@router.post("/parent/register", response_model=ParentTokenResponse)
async def parent_register(
    data: ParentRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """家长注册：绑定码必填，验证后建账户 + 自动绑定该孩子"""
    # 1. 校验绑定码
    res = await db.execute(
        select(ParentBindCode).where(ParentBindCode.code == data.bind_code)
    )
    code_row = res.scalar_one_or_none()
    if not code_row:
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "绑定码无效，请让孩子重新生成"})
    if code_row.used_at is not None:
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "绑定码已使用，请让孩子重新生成"})
    if code_row.expires_at < datetime.utcnow():
        raise HTTPException(400, detail={"code": "invalid_bind_code", "message": "绑定码已过期，请让孩子重新生成"})

    # 2. 校验手机号未占用
    existing = await db.execute(
        select(User).where(User.phone == data.phone)
    )
    existing_user = existing.scalar_one_or_none()
    if existing_user:
        # 如果已是家长账号 → 提示登录
        if existing_user.role == "parent":
            raise HTTPException(400, detail={"code": "phone_taken", "message": "该手机号已注册为家长，直接登录就能绑定新孩子"})
        raise HTTPException(400, detail={"code": "phone_taken", "message": "该手机号已被其它角色注册"})

    # 3. 创建家长账号
    parent = User(
        username=f"parent_{data.phone}",
        email=f"{data.phone}@parent.local",
        phone=data.phone,
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name or f"{data.phone[-4:]} 的家长",
        role="parent",
    )
    db.add(parent)
    await db.flush()

    # 4. 创建绑定关系 + 标记码已用
    db.add(ParentStudentLink(parent_id=parent.id, student_id=code_row.student_id))
    code_row.used_at = datetime.utcnow()
    await db.commit()

    # 5. 直接发 token 让前端登录
    token = create_access_token({"sub": str(parent.id)})
    return ParentTokenResponse(
        access_token=token,
        parent_id=parent.id,
        full_name=parent.full_name,
    )


# ================== 家长：登录 ==================

@router.post("/parent/login", response_model=ParentTokenResponse)
async def parent_login(
    data: ParentLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(select(User).where(User.phone == data.phone))
    user = res.scalar_one_or_none()
    if not user or user.role != "parent":
        raise HTTPException(401, detail={"code": "user_not_found", "message": "该手机号还没有注册家长账号"})
    if not verify_password(data.password, user.hashed_password):
        raise HTTPException(401, detail={"code": "wrong_password", "message": "密码不正确，请重试"})
    if not user.is_active:
        raise HTTPException(403, detail={"code": "inactive", "message": "账号已被禁用，请联系管理员"})

    token = create_access_token({"sub": str(user.id)})
    return ParentTokenResponse(
        access_token=token,
        parent_id=user.id,
        full_name=user.full_name,
    )


# ================== 家长：再绑定一个孩子 ==================

@router.post("/parent/bind", response_model=ChildSummary)
async def parent_bind_additional_child(
    data: BindAdditionalRequest,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """已登录家长再绑定一个新孩子"""
    res = await db.execute(
        select(ParentBindCode).where(ParentBindCode.code == data.bind_code)
    )
    code_row = res.scalar_one_or_none()
    if not code_row or code_row.used_at is not None or code_row.expires_at < datetime.utcnow():
        raise HTTPException(400, "绑定码无效或已过期")

    # 是否已绑过
    existing = await db.execute(
        select(ParentStudentLink).where(
            and_(
                ParentStudentLink.parent_id == current_parent.id,
                ParentStudentLink.student_id == code_row.student_id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "已经绑定过这个孩子")

    db.add(ParentStudentLink(parent_id=current_parent.id, student_id=code_row.student_id))
    code_row.used_at = datetime.utcnow()
    await db.commit()

    return await _build_child_summary(db, code_row.student_id)


# ================== 家长：我的孩子列表 ==================

@router.get("/parent/children", response_model=list[ChildSummary])
async def parent_list_children(
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    res = await db.execute(
        select(ParentStudentLink.student_id)
        .where(ParentStudentLink.parent_id == current_parent.id)
    )
    student_ids = [r[0] for r in res.all()]
    return [await _build_child_summary(db, sid) for sid in student_ids]


async def _build_child_summary(db: AsyncSession, student_id: int) -> ChildSummary:
    res = await db.execute(select(User).where(User.id == student_id))
    student = res.scalar_one()

    today, tomorrow = local_today_utc_range()  # 北京今天的 UTC 区间

    # 今日学习分钟
    res = await db.execute(
        select(func.coalesce(func.sum(StudySession.time_spent), 0))
        .where(and_(
            StudySession.user_id == student_id,
            StudySession.started_at >= today,
            StudySession.started_at < tomorrow,
        ))
    )
    today_minutes = int((res.scalar() or 0) / 60)

    # 今日新学单词数（不重复）
    res = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(and_(
            LearningRecord.user_id == student_id,
            LearningRecord.created_at >= today,
            LearningRecord.created_at < tomorrow,
        ))
    )
    today_words = int(res.scalar() or 0)

    # 连续打卡：复用 dashboard 简化版
    streak_days = 0
    cur = today
    while True:
        nxt = cur + timedelta(days=1)
        res = await db.execute(
            select(func.count(LearningRecord.id))
            .where(and_(
                LearningRecord.user_id == student_id,
                LearningRecord.created_at >= cur,
                LearningRecord.created_at < nxt,
            ))
        )
        if (res.scalar() or 0) > 0:
            streak_days += 1
            cur -= timedelta(days=1)
            if streak_days >= 365:
                break
        else:
            break

    return ChildSummary(
        student_id=student.id,
        username=student.username,
        full_name=student.full_name,
        today_minutes=today_minutes,
        today_words=today_words,
        streak_days=streak_days,
    )


# ================== 家长：单孩完整看板 ==================

class WeakWordItem(BaseModel):
    word: str
    meaning: Optional[str]
    wrong_count: int


class BookProgressItem(BaseModel):
    book_id: int
    book_name: str
    progress_percentage: float
    completed_units: int
    total_units: int


class RankInfo(BaseModel):
    rank: Optional[int]
    total: int
    value: int


class HeatmapDay(BaseModel):
    date: str
    minutes: int


class ChildDashboard(BaseModel):
    student_id: int
    full_name: Optional[str]
    username: str
    # 今日 + 累计
    today_minutes: int
    today_words: int
    streak_days: int
    # 复习进度（与 /student/review-progress 同口径）
    review_due_today: int = 0
    review_done_today: int = 0
    graduated_words: int = 0
    total_words_learned: int
    total_words_mastered: int
    total_minutes: int
    # 本周对比
    this_week_minutes: int
    last_week_minutes: int
    this_week_words: int
    last_week_words: int
    this_week_accuracy: int
    last_week_accuracy: int
    # 排名（系统全部学生）
    rank_vocabulary: RankInfo
    rank_diligence: RankInfo
    rank_accuracy: RankInfo
    # 30 天热力图
    heatmap: list[HeatmapDay]
    # 薄弱词
    weak_words: list[WeakWordItem]
    # 单词本进度
    books: list[BookProgressItem]
    # 成就
    unlocked_achievements: int
    total_achievements: int


@router.get("/parent/children/{student_id}/dashboard", response_model=ChildDashboard)
async def parent_child_dashboard(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    """家长看孩子完整数据看板"""
    # 1. 校验权限：必须是自己绑定的孩子
    res = await db.execute(
        select(ParentStudentLink).where(and_(
            ParentStudentLink.parent_id == current_parent.id,
            ParentStudentLink.student_id == student_id,
        ))
    )
    if not res.scalar_one_or_none():
        raise HTTPException(403, "无权查看该孩子的数据")

    res = await db.execute(select(User).where(User.id == student_id))
    student = res.scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")

    now = datetime.utcnow()
    _today_d = local_today()
    today, tomorrow = local_day_utc_range(_today_d)
    _monday = _today_d - timedelta(days=_today_d.weekday())
    week_start, _ = local_day_utc_range(_monday)
    week_end, _ = local_day_utc_range(_monday + timedelta(days=7))
    last_week_start, _ = local_day_utc_range(_monday - timedelta(days=7))

    # 今日 / 累计
    res = await db.execute(
        select(func.coalesce(func.sum(StudySession.time_spent), 0))
        .where(and_(StudySession.user_id == student_id, StudySession.started_at >= today, StudySession.started_at < tomorrow))
    )
    today_minutes = int((res.scalar() or 0) / 60)

    res = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= today, LearningRecord.created_at < tomorrow))
    )
    today_words = int(res.scalar() or 0)

    res = await db.execute(
        select(func.coalesce(func.sum(StudySession.time_spent), 0))
        .where(StudySession.user_id == student_id)
    )
    total_minutes = int((res.scalar() or 0) / 60)

    res = await db.execute(
        select(func.count(WordMastery.id)).where(WordMastery.user_id == student_id)
    )
    total_words_learned = int(res.scalar() or 0)

    res = await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(WordMastery).join(Word, Word.id == WordMastery.word_id)
        .where(and_(WordMastery.user_id == student_id, WordMastery.mastery_level >= 3))
    )
    total_words_mastered = int(res.scalar() or 0)

    # streak
    streak_days = 0
    cur = today
    for _ in range(365):
        nxt = cur + timedelta(days=1)
        res = await db.execute(
            select(func.count(LearningRecord.id))
            .where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= cur, LearningRecord.created_at < nxt))
        )
        if (res.scalar() or 0) > 0:
            streak_days += 1
            cur -= timedelta(days=1)
        else:
            break

    # 本周/上周对比
    async def period_stats(start: datetime, end: datetime) -> tuple[int, int, int]:
        r1 = await db.execute(
            select(func.coalesce(func.sum(StudySession.time_spent), 0))
            .where(and_(StudySession.user_id == student_id, StudySession.started_at >= start, StudySession.started_at < end))
        )
        minutes = int((r1.scalar() or 0) / 60)
        r2 = await db.execute(
            select(func.count(func.distinct(LearningRecord.word_id)))
            .where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= start, LearningRecord.created_at < end, LearningRecord.is_correct.is_(True)))
        )
        words = int(r2.scalar() or 0)
        r3 = await db.execute(
            select(
                func.count(LearningRecord.id),
                func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)),
            ).where(and_(LearningRecord.user_id == student_id, LearningRecord.created_at >= start, LearningRecord.created_at < end))
        )
        row = r3.first()
        accuracy = int((row[1] or 0) * 100 / row[0]) if row and row[0] else 0
        return minutes, words, accuracy

    this_week_minutes, this_week_words, this_week_accuracy = await period_stats(week_start, week_end)
    last_week_minutes, last_week_words, last_week_accuracy = await period_stats(last_week_start, week_start)

    # 系统全部学生中的排名
    async def rank_info(metric_query, my_value: int) -> RankInfo:
        res = await db.execute(metric_query)
        rows = res.all()
        my_rank = None
        for rank, row in enumerate(rows, start=1):
            if row[0] == student_id:
                my_rank = rank
                break
        return RankInfo(rank=my_rank, total=len(rows), value=my_value)

    # 词汇王（本周）
    vocab_query = (
        select(
            LearningRecord.user_id,
            func.count(func.distinct(LearningRecord.word_id)).label("v"),
        )
        .where(and_(LearningRecord.created_at >= week_start, LearningRecord.created_at < week_end, LearningRecord.is_correct.is_(True)))
        .group_by(LearningRecord.user_id)
        .order_by(func.count(func.distinct(LearningRecord.word_id)).desc())
    )
    rank_vocabulary = await rank_info(vocab_query, this_week_words)

    # 勤奋王（本周）
    diligence_query = (
        select(StudySession.user_id, func.coalesce(func.sum(StudySession.time_spent), 0).label("v"))
        .where(and_(StudySession.started_at >= week_start, StudySession.started_at < week_end))
        .group_by(StudySession.user_id)
        .order_by(func.coalesce(func.sum(StudySession.time_spent), 0).desc())
    )
    rank_diligence = await rank_info(diligence_query, this_week_minutes)

    # 精准王（本周，>=20 题）
    accuracy_query = (
        select(
            LearningRecord.user_id,
            (func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)) * 100 / func.count(LearningRecord.id)).label("v"),
        )
        .where(and_(LearningRecord.created_at >= week_start, LearningRecord.created_at < week_end))
        .group_by(LearningRecord.user_id)
        .having(func.count(LearningRecord.id) >= 20)
        .order_by((func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)) * 100 / func.count(LearningRecord.id)).desc())
    )
    rank_accuracy = await rank_info(accuracy_query, this_week_accuracy)

    # 30 天热力图
    heatmap_start = today - timedelta(days=29)
    res = await db.execute(
        select(
            func.date(StudySession.started_at),
            func.coalesce(func.sum(StudySession.time_spent), 0),
        )
        .where(and_(
            StudySession.user_id == student_id,
            StudySession.started_at >= heatmap_start,
            StudySession.started_at < tomorrow,
        ))
        .group_by(func.date(StudySession.started_at))
    )
    heatmap_map = {str(r[0]): int((r[1] or 0) / 60) for r in res.all()}
    heatmap = []
    for i in range(30):
        d = (heatmap_start + timedelta(days=i)).date()
        heatmap.append(HeatmapDay(date=str(d), minutes=heatmap_map.get(str(d), 0)))

    # 薄弱词 TOP 10
    res = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, Word.id == WordMastery.word_id)
        .outerjoin(WordDefinition, and_(WordDefinition.word_id == Word.id, WordDefinition.is_primary.is_(True)))
        .where(and_(WordMastery.user_id == student_id, WordMastery.wrong_count > 0))
        .order_by(WordMastery.wrong_count.desc(), WordMastery.mastery_level.asc())
        .limit(10)
    )
    weak_words = [
        WeakWordItem(
            word=w.word,
            meaning=d.meaning if d else None,
            wrong_count=m.wrong_count or 0,
        )
        for m, w, d in res.all()
    ]

    # 单词本进度（复用 student/progress 的 logic 简化）
    from app.models.word import WordBook, Unit, BookWord
    from app.models.learning import LearningProgress, BookAssignment
    res = await db.execute(
        select(WordBook)
        .join(BookAssignment, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.student_id == student_id)
    )
    books = res.scalars().all()
    book_items: list[BookProgressItem] = []
    for book in books:
        unit_res = await db.execute(select(Unit).where(Unit.book_id == book.id))
        units = unit_res.scalars().all()
        unit_count = len(units)
        completed_units = 0
        for u in units:
            # 一个单元在不同 learning_mode 下可能有多条 LearningProgress
            # 任意一种模式完成即视为单元完成
            lp_res = await db.execute(
                select(func.max(func.cast(LearningProgress.is_completed, Integer)))
                .where(and_(
                    LearningProgress.user_id == student_id,
                    LearningProgress.unit_id == u.id,
                ))
            )
            if (lp_res.scalar() or 0) == 1:
                completed_units += 1
        progress_pct = (completed_units / unit_count * 100) if unit_count > 0 else 0
        book_items.append(BookProgressItem(
            book_id=book.id,
            book_name=book.name,
            progress_percentage=round(progress_pct, 1),
            completed_units=completed_units,
            total_units=unit_count,
        ))

    # 成就解锁数
    from app.models.user import Achievement, UserAchievement
    res = await db.execute(select(func.count(Achievement.id)))
    total_ach = int(res.scalar() or 0)
    res = await db.execute(
        select(func.count(UserAchievement.id))
        .where(UserAchievement.user_id == student_id)
    )
    unlocked_ach = int(res.scalar() or 0)

    # 复习进度（与 /student/review-progress 同口径）
    from app.api.v1.student.learning_records import compute_review_progress
    review_prog = await compute_review_progress(db, student_id)

    return ChildDashboard(
        student_id=student.id,
        full_name=student.full_name,
        username=student.username,
        today_minutes=today_minutes,
        today_words=today_words,
        streak_days=streak_days,
        review_due_today=review_prog["review_due_today"],
        review_done_today=review_prog["review_done_today"],
        graduated_words=review_prog["graduated_words"],
        total_words_learned=total_words_learned,
        total_words_mastered=total_words_mastered,
        total_minutes=total_minutes,
        this_week_minutes=this_week_minutes,
        last_week_minutes=last_week_minutes,
        this_week_words=this_week_words,
        last_week_words=last_week_words,
        this_week_accuracy=this_week_accuracy,
        last_week_accuracy=last_week_accuracy,
        rank_vocabulary=rank_vocabulary,
        rank_diligence=rank_diligence,
        rank_accuracy=rank_accuracy,
        heatmap=heatmap,
        weak_words=weak_words,
        books=book_items,
        unlocked_achievements=unlocked_ach,
        total_achievements=total_ach,
    )
