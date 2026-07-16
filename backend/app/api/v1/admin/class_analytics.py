"""管理员 - 按班级的学生名册 / 学生学习详情 / 学习统计时序

复用教师端的查询模式(teacher/classes.py, teacher/analytics.py),但去掉
"必须是本班班主任"的归属校验,改用 get_current_admin —— 管理员可查任意班级。

口径统一(见 CLAUDE.md):
- "已掌握" = 掌握度 >= 3,按 lower(word) 去重取 max(mastery_level)
- 分天一律按北京时间(timeutil.local_today / local_day_utc_range)
- 时长以 StudyCalendar.duration(秒) 为主源;LearningRecord.time_spent 是毫秒,不在此用
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range
from app.models.user import User, Class, ClassStudent, StudyCalendar
from app.models.learning import WordMastery, LearningRecord, StudySession
from app.models.word import Word
from app.api.v1.auth import get_current_admin_or_org_admin

router = APIRouter()


async def _class_or_404(db: AsyncSession, class_id: int) -> Class:
    """取班级(管理员不校验归属,只校验存在)"""
    result = await db.execute(select(Class).where(Class.id == class_id))
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "班级不存在")
    return cls


async def _class_student_ids(db: AsyncSession, class_id: int) -> list[int]:
    """班级在册学生 id。口径与教师端一致:enrollment active + user 本身是 active student。"""
    result = await db.execute(
        select(ClassStudent.student_id)
        .join(User, User.id == ClassStudent.student_id)
        .where(and_(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
            User.role == "student",
            User.is_active.is_(True),
        ))
    )
    return [row[0] for row in result.all()]


# ─────────────────────────────────────────────────────────────
# 1. 班级学生名册(admin 版,解决教师端接口对 admin 404 的问题)
# ─────────────────────────────────────────────────────────────
@router.get("/classes/{class_id}/students")
async def admin_class_students(
    class_id: int,
    q: Optional[str] = Query(None, description="搜索学生姓名或用户名"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """管理员查看班级学生名册。口径与教师端一致:enrollment active + active student。"""
    await _class_or_404(db, class_id)
    stmt = (
        select(User, ClassStudent.joined_at)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(and_(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
            User.role == "student",
            User.is_active.is_(True),
        ))
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.full_name.like(like)) | (User.username.like(like)))
    result = await db.execute(stmt.order_by(User.username))
    return [
        {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "joined_at": joined_at.isoformat() if joined_at else None,
        }
        for user, joined_at in result.all()
    ]


# ─────────────────────────────────────────────────────────────
# 2. 学生学习详情(admin 版):当日 + 累计 + 近7天
# ─────────────────────────────────────────────────────────────
@router.get("/students/{student_id}/detail")
async def admin_student_detail(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """管理员查看任意学生的学习详情(当日+累计+7天趋势)。掌握线 >=3,lower(word) 去重。"""
    result = await db.execute(select(User).where(User.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")

    today = local_today()
    day_start, day_end = local_day_utc_range(today)

    # 当日: 日历
    cal_result = await db.execute(
        select(StudyCalendar).where(
            and_(StudyCalendar.user_id == student_id, StudyCalendar.study_date == today)
        )
    )
    cal = cal_result.scalar_one_or_none()

    # 当日: 学习记录(UTC 区间)
    rec_result = await db.execute(
        select(
            func.count(LearningRecord.id).label("total"),
            func.sum(LearningRecord.is_correct.cast(Integer)).label("correct"),
        ).where(and_(
            LearningRecord.user_id == student_id,
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
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
            StudySession.started_at >= day_start, StudySession.started_at < day_end,
        ))
    )
    today_sessions = sess_result.scalar() or 0

    # 累计: WordMastery 按 lower(word) 去重,掌握线 >=3
    mastery_result = await db.execute(
        select(func.lower(Word.word).label("sp"), func.max(WordMastery.mastery_level).label("lvl"))
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id == student_id)
        .group_by(func.lower(Word.word))
    )
    m_rows = mastery_result.all()
    total_words_learned = len(m_rows)
    total_mastered = sum(1 for r in m_rows if (r.lvl or 0) >= 3)
    weak_words_count = sum(1 for r in m_rows if (r.lvl or 0) < 3)

    # 累计: StudyCalendar 聚合
    cal_agg_result = await db.execute(
        select(
            func.count(StudyCalendar.id).label("days"),
            func.sum(StudyCalendar.duration).label("time"),
            func.max(StudyCalendar.study_date).label("last_date"),
        ).where(StudyCalendar.user_id == student_id)
    )
    cal_agg = cal_agg_result.first()
    total_study_days = cal_agg.days or 0
    total_study_time = cal_agg.time or 0
    last_active = datetime.combine(cal_agg.last_date, datetime.min.time()) if cal_agg.last_date else None

    # 累计: LearningRecord 聚合
    overall_result = await db.execute(
        select(
            func.count(LearningRecord.id).label("total"),
            func.sum(LearningRecord.is_correct.cast(Integer)).label("correct"),
        ).where(LearningRecord.user_id == student_id)
    )
    overall_row = overall_result.first()
    overall_total = overall_row.total or 0
    overall_correct = overall_row.correct or 0
    overall_accuracy = (overall_correct / overall_total * 100) if overall_total > 0 else 0

    # 近7天趋势(按天补零)
    week_start = today - timedelta(days=6)
    trend_result = await db.execute(
        select(StudyCalendar.study_date, StudyCalendar.words_learned).where(
            and_(StudyCalendar.user_id == student_id, StudyCalendar.study_date >= week_start)
        )
    )
    trend_map = {r.study_date: r.words_learned for r in trend_result.all()}
    recent_words, recent_dates = [], []
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


# ─────────────────────────────────────────────────────────────
# 3. 按班级学习统计时序(柱状图数据源)
# ─────────────────────────────────────────────────────────────
@router.get("/classes/{class_id}/stats-summary")
async def admin_class_stats_summary(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """一次性返回班级的 今日/昨日/近7天 各指标 + 词汇总量,供前端柱状图下拉切换。

    指标: training=训练量(答题数), vocab=词汇量(distinct), time=学习时间(秒)。
    train_vocab(训练词汇) 与 vocab 同源,前端按需复用 vocab。

    用 2 条 GROUP BY date 查询覆盖整个 7 天窗口(而非逐日 N+1):
    北京无夏令时,恒为 UTC+8,故可用 SQLite 的 date(created_at,'+8 hours') 按北京日分组。
    """
    await _class_or_404(db, class_id)
    ids = await _class_student_ids(db, class_id)

    today = local_today()
    yesterday = today - timedelta(days=1)
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]  # 从早到晚 7 天

    empty = {"training": 0, "vocab": 0, "time": 0}
    if not ids:
        zero7 = [{"date": d.strftime("%m/%d"), "value": 0} for d in days]
        return {
            "today": empty, "yesterday": empty,
            "last7days": {"training": list(zero7), "vocab": list(zero7), "time": list(zero7)},
            "total_vocab": 0,
        }

    # 窗口的 UTC 区间 [周起, 明日起)
    win_start, _ = local_day_utc_range(days[0])
    _, win_end = local_day_utc_range(today)

    # 查询1: LearningRecord 按北京日分组,一次拿到每天的 训练量 + 词汇量
    bj_date = func.date(LearningRecord.created_at, "+8 hours")
    lr_rows = await db.execute(
        select(
            bj_date.label("d"),
            func.count(LearningRecord.id).label("training"),
            func.count(func.distinct(LearningRecord.word_id)).label("vocab"),
        ).where(and_(
            LearningRecord.user_id.in_(ids),
            LearningRecord.created_at >= win_start,
            LearningRecord.created_at < win_end,
        )).group_by(bj_date)
    )
    lr_map = {r.d: r for r in lr_rows.all()}  # key: 'YYYY-MM-DD'

    # 查询2: StudyCalendar 按 study_date 分组拿每天时长(study_date 本就是北京日)
    cal_rows = await db.execute(
        select(StudyCalendar.study_date, func.sum(StudyCalendar.duration).label("time"))
        .where(and_(
            StudyCalendar.user_id.in_(ids),
            StudyCalendar.study_date >= days[0],
        )).group_by(StudyCalendar.study_date)
    )
    cal_map = {r.study_date: (r.time or 0) for r in cal_rows.all()}

    def metric_of(d: date) -> dict:
        lr = lr_map.get(d.isoformat())
        return {
            "training": (lr.training if lr else 0) or 0,
            "vocab": (lr.vocab if lr else 0) or 0,
            "time": cal_map.get(d, 0),
        }

    series = {"training": [], "vocab": [], "time": []}
    for d in days:
        m = metric_of(d)
        label = d.strftime("%m/%d")
        for k in series:
            series[k].append({"date": label, "value": m[k]})

    # 词汇总量: 班级所有学生学过的不同拼写数(lower(word) 去重)
    tv = await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(WordMastery)
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id.in_(ids))
    )
    total_vocab = tv.scalar() or 0

    return {
        "today": metric_of(today),
        "yesterday": metric_of(yesterday),
        "last7days": series,
        "total_vocab": total_vocab,
    }
