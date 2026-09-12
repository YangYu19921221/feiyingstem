"""管理员 - 按班级的学生名册 / 学生学习详情 / 学习统计时序

复用教师端的查询模式(teacher/classes.py, teacher/analytics.py),但去掉
"必须是本班班主任"的归属校验,改用 get_current_admin —— 管理员可查任意班级。

口径统一(见 CLAUDE.md):
- "已掌握" = 掌握度 >= 3,按 lower(word) 去重取 max(mastery_level)
- "薄弱" = 未达掌握线 **且** 在计分模式里真答错过;未达线但没错过的算"待巩固"
  (统一走 services/weak_words.py,别在这里手写 mastery_level < 3)
- 分天一律按北京时间(timeutil.local_today / local_day_utc_range)
- 时长以 StudyCalendar.duration(秒) 为主源;LearningRecord.time_spent 是毫秒,不在此用
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, and_, case, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range
from app.models.user import User, Class, ClassStudent, StudyCalendar, DailyCheckin
from app.models.learning import (
    WordMastery, LearningRecord, StudySession,
    HomeworkAssignment, HomeworkStudentAssignment,
)
from app.models.word import Word
from app.api.v1.auth import get_current_admin_or_org_admin
from app.services.weak_words import mastery_buckets, NON_LEARNED_MODES
from app.services import daily_words, study_time

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

    # 累计: 按 lower(word) 去重,掌握线 >=3;薄弱=未达掌握线且真答错过,
    # 只是练得少的全对词归"待巩固"(口径见 services/weak_words.py,与教师端同源)
    buckets = (await mastery_buckets(db, [student_id])).get(student_id, {})
    total_words_learned = buckets.get("words", 0)
    total_mastered = buckets.get("mastered", 0)
    weak_words_count = buckets.get("weak", 0)
    pending_words_count = buckets.get("pending", 0)

    # 累计: StudyCalendar 聚合(天数/最后活跃日);
    # 时长走 services/study_time 统一口径,裸 sum(duration) 会带进 07-09 前的旧脏数据
    cal_agg_result = await db.execute(
        select(
            func.count(StudyCalendar.id).label("days"),
            func.max(StudyCalendar.study_date).label("last_date"),
        ).where(StudyCalendar.user_id == student_id)
    )
    cal_agg = cal_agg_result.first()
    total_study_days = cal_agg.days or 0
    total_study_time = await study_time.seconds_total(db, student_id)
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

    # 近7天趋势 + 今日词数:走 services/daily_words 实算,不读 StudyCalendar.words_learned
    # (该字段 2026-07-27 前是跨批次累加,一天练多轮会叠加;与教师端班级表口径统一)
    recent_dates, days = [], []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        days.append(d)
        recent_dates.append(d.strftime("%m/%d"))
    trend_map = await daily_words.words_by_day(db, student_id, days)
    recent_words = [trend_map.get(d, 0) for d in days]

    return {
        "user_id": student.id,
        "username": student.username,
        "full_name": student.full_name or student.username,
        "today_words": trend_map.get(today, 0),
        # 今日时长走统一口径(与累计、教师端每日表同源),不裸读日历行
        "today_duration": await study_time.seconds_on_day(db, student_id, today),
        "today_accuracy": round(today_accuracy, 1),
        "today_sessions": today_sessions,
        "total_words_learned": total_words_learned,
        "total_mastered": total_mastered,
        "total_study_days": total_study_days,
        "total_study_time": total_study_time,
        "overall_accuracy": round(overall_accuracy, 1),
        "weak_words_count": weak_words_count,
        "pending_words_count": pending_words_count,
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

    # 查询1: LearningRecord 按北京日分组,一次拿到每天的 训练量 + 词汇量。
    # 词汇量必须 distinct(lower(word)) 且排除 classify(全站统一口径,见 daily_words):
    # 原来用 distinct(word_id) 且不排除 classify —— 单元级隔离下同一拼写有多个 word_id
    # 会虚高,而且只拖过分类卡片的学生也会显示"有词汇量"。
    # 训练量是"答了多少题",classify 也算,所以那一列不加模式过滤。
    bj_date = func.date(LearningRecord.created_at, "+8 hours")
    lr_rows = await db.execute(
        select(
            bj_date.label("d"),
            func.count(LearningRecord.id).label("training"),
            func.count(func.distinct(
                case((LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
                      func.lower(Word.word)), else_=None)
            )).label("vocab"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id.in_(ids),
            LearningRecord.created_at >= win_start,
            LearningRecord.created_at < win_end,
        )).group_by(bj_date)
    )
    lr_map = {r.d: r for r in lr_rows.all()}  # key: 'YYYY-MM-DD'

    # 查询2: 每天时长走 services/study_time 统一口径(逐生逐日封顶后再按天汇总)。
    # 原先是 sum(StudyCalendar.duration) 不封顶,一个学生的旧脏数据就能把
    # 整条班级曲线顶到几千小时
    cal_map = await study_time.group_seconds_by_day(db, ids, days)

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


# ─────────────────────────────────────────────────────────────
# 4. 教师维度的教学数据(管理端「教师详情」页,2026-09-12)
# ─────────────────────────────────────────────────────────────

# 「近 N 天」窗口。7 天是默认视图,30 天用来看趋势是否稳定
_TEACHER_WINDOWS = (7, 30)

# 界面必须显示这句(三个端点都下发): 签到 ≠ 线下到课。
# 机构会拿这些数考核老师,把"用 App 的活跃度"说成"到课率"是拿错数据做决定。
# 真正的到课率需要新做老师点名功能(live_attendance 只覆盖直播课且生产几乎没数据)。
_CHECKIN_NOTE = (
    "签到率 = 学生当天打开 App 完成签到的人天 ÷ 应签人天，"
    "反映使用活跃度，不等于线下到课率。"
)


async def _teacher_or_404(db: AsyncSession, teacher_id: int) -> User:
    """取老师。管理员不校验归属,但**必须锁 role=teacher** ——
    否则传个学生 id 进来会算出一堆空指标,让人以为系统坏了。
    多租户: select(User) 经 tenancy 过滤,org_admin 传别家老师的 id 自然 404。
    """
    t = (await db.execute(
        select(User).where(User.id == teacher_id, User.role == "teacher")
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "教师不存在")
    return t


async def _checkin_counts(
    db: AsyncSession, student_ids: list[int], start_day: date, end_day: date,
) -> dict[int, int]:
    """区间内每个学生的签到天数 → {student_id: 天数}。

    ⚠️ 这是**签到率**不是线下到课率: daily_checkins 记的是"学生当天打开 App 签了到"。
    系统里没有老师点名的数据,所以界面文案一律写「签到」,不能写「出勤/到课」——
    拿签到率冒充到课率,机构会据此考核老师,那是拿错数据做决定。
    (直播考勤 live_attendance 才是"来上课了",但生产只有 14 行、3 节课,做出来全是 0。)
    """
    if not student_ids:
        return {}
    rows = (await db.execute(
        select(DailyCheckin.user_id, func.count(DailyCheckin.id))
        .where(
            DailyCheckin.user_id.in_(student_ids),
            DailyCheckin.checkin_date >= start_day,
            DailyCheckin.checkin_date <= end_day,
        )
        .group_by(DailyCheckin.user_id)
    )).all()
    return {uid: n for uid, n in rows}


async def _active_student_ids(
    db: AsyncSession, student_ids: list[int], start_day: date, end_day: date,
) -> set[int]:
    """区间内**真的学过**的学生(有 learning_record)。

    与签到分开算是刻意的: 签了到但一道题没做 = 打卡走人,这两个数放在一起
    才看得出班级是"真在学"还是"只在签到"。
    """
    if not student_ids:
        return set()
    win_start, _ = local_day_utc_range(start_day)
    _, win_end = local_day_utc_range(end_day)
    rows = (await db.execute(
        select(func.distinct(LearningRecord.user_id))
        .where(
            LearningRecord.user_id.in_(student_ids),
            LearningRecord.created_at >= win_start,
            LearningRecord.created_at < win_end,
        )
    )).all()
    return {r[0] for r in rows}


async def _vocab_by_student(
    db: AsyncSession, student_ids: list[int], start_day: date, end_day: date,
) -> tuple[dict[int, int], dict[int, int]]:
    """区间内每人的 (词汇量, 训练量)。

    口径与 admin_class_stats_summary 完全一致,别在这里另起一套:
    - 词汇量 = distinct(lower(word)) 且**排除 classify 自评**(只拖过卡片不算学会)
    - 训练量 = 答题条数,classify 也算(它确实是"答了题")
    """
    if not student_ids:
        return {}, {}
    win_start, _ = local_day_utc_range(start_day)
    _, win_end = local_day_utc_range(end_day)
    rows = (await db.execute(
        select(
            LearningRecord.user_id,
            func.count(func.distinct(
                case((LearningRecord.learning_mode.notin_(NON_LEARNED_MODES),
                      func.lower(Word.word)), else_=None)
            )),
            func.count(LearningRecord.id),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(
            LearningRecord.user_id.in_(student_ids),
            LearningRecord.created_at >= win_start,
            LearningRecord.created_at < win_end,
        )
        .group_by(LearningRecord.user_id)
    )).all()
    return ({uid: v or 0 for uid, v, _ in rows},
            {uid: t or 0 for uid, _, t in rows})


def _rate(numerator: int, denominator: int) -> float:
    """百分比(一位小数)。分母 0 时返回 0 而不是抛错/NaN —— 空班级是正常状态。"""
    if not denominator:
        return 0.0
    return round(numerator * 100.0 / denominator, 1)


@router.get("/teachers/{teacher_id}/analytics")
async def admin_teacher_analytics(
    teacher_id: int,
    days: int = Query(7, description="统计窗口天数(7 或 30)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """一位老师的教学数据: 汇总 + 逐班明细。

    ## 指标口径(全部复用现有真源,不新造)
    - 学习时长: services/study_time(全站唯一真源,逐日封顶。别改用
      LearningRecord.time_spent —— 那是毫秒且会把发呆算进去)
    - 词汇量/训练量: 与 admin_class_stats_summary 同源(见 _vocab_by_student)
    - 签到率: 已签到人天 / (在读学生数 × 天数)。**是签到不是到课**,见 _checkin_counts
    - 活跃率: 区间内真做过题的人 / 在读学生数

    ## 为什么一次全返回
    逐班 N 次请求会让 9 个班的老师打 9 轮网络;这里每个指标一条 GROUP BY 覆盖
    全部班级的学生,再在内存里按班分桶。老师最多几十个班,内存分桶代价可忽略。
    """
    teacher = await _teacher_or_404(db, teacher_id)
    if days not in _TEACHER_WINDOWS:
        days = 7

    end_day = local_today()
    start_day = end_day - timedelta(days=days - 1)

    # 名下班级
    classes = (await db.execute(
        select(Class).where(Class.teacher_id == teacher_id).order_by(Class.id)
    )).scalars().all()

    # 一次拿到「班 → 在读学生」映射(不按班 N 次查)
    class_ids = [c.id for c in classes]
    roster: dict[int, list[int]] = {cid: [] for cid in class_ids}
    if class_ids:
        rows = (await db.execute(
            select(ClassStudent.class_id, ClassStudent.student_id)
            .join(User, User.id == ClassStudent.student_id)
            .where(
                ClassStudent.class_id.in_(class_ids),
                ClassStudent.is_active.is_(True),
                User.role == "student",
                User.is_active.is_(True),
            )
        )).all()
        for cid, sid in rows:
            roster[cid].append(sid)

    # 全部学生去重(一个学生可能在同一老师的两个班里,汇总必须去重)
    all_students = sorted({sid for ids in roster.values() for sid in ids})

    # 四个指标各一条查询,覆盖所有班的学生
    checkins = await _checkin_counts(db, all_students, start_day, end_day)
    actives = await _active_student_ids(db, all_students, start_day, end_day)
    vocab, training = await _vocab_by_student(db, all_students, start_day, end_day)
    seconds = await study_time.seconds_by_student(db, all_students, start_day, end_day)

    # 作业: 这位老师在窗口内布置的份数与完成率
    hw_rows = (await db.execute(
        select(
            func.count(func.distinct(HomeworkAssignment.id)),
            func.count(HomeworkStudentAssignment.id),
            func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0)),
        )
        .select_from(HomeworkAssignment)
        .outerjoin(HomeworkStudentAssignment,
                   HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(
            HomeworkAssignment.teacher_id == teacher_id,
            HomeworkAssignment.created_at >= local_day_utc_range(start_day)[0],
        )
    )).one()
    hw_count, hw_targets, hw_done = (hw_rows[0] or 0), (hw_rows[1] or 0), (hw_rows[2] or 0)

    def bucket(ids: list[int]) -> dict:
        """一个班(或全部)的指标。ids 已是在读学生 id 列表。"""
        n = len(ids)
        checked = sum(checkins.get(i, 0) for i in ids)
        return {
            "student_count": n,
            # 签到人天 / 应签人天。学生中途入班会让分母偏大(按满窗口算),
            # 这是刻意的保守口径 —— 宁可显示偏低,也不要因为算法复杂而让人看不懂
            "checkin_rate": _rate(checked, n * days),
            "checkin_days": checked,
            "active_students": sum(1 for i in ids if i in actives),
            "active_rate": _rate(sum(1 for i in ids if i in actives), n),
            "study_minutes": round(sum(seconds.get(i, 0) for i in ids) / 60),
            "vocab": sum(vocab.get(i, 0) for i in ids),
            "training": sum(training.get(i, 0) for i in ids),
        }

    return {
        "teacher": {
            "id": teacher.id, "username": teacher.username,
            "full_name": teacher.full_name, "is_active": teacher.is_active,
            "last_login": teacher.last_login,
        },
        "window": {"days": days,
                   "start": start_day.isoformat(), "end": end_day.isoformat()},
        "summary": {
            **bucket(all_students),
            "class_count": len(classes),
            "homework_assigned": hw_count,
            "homework_completion_rate": _rate(hw_done, hw_targets),
        },
        "classes": [
            {"class_id": c.id, "name": c.name, **bucket(roster[c.id])}
            for c in classes
        ],
        "checkin_note": _CHECKIN_NOTE,
    }


@router.get("/teachers-overview")
async def admin_teachers_overview(
    days: int = Query(7, description="统计窗口天数(7 或 30)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """**所有**老师的教学数据一览(横向对比,找出带得好/带得差的)。

    与 admin_teacher_analytics 的分工: 那个是单个老师下钻到班,这个是全员横排。
    两者共用同一批口径函数(_checkin_counts/_active_student_ids/_vocab_by_student),
    不会出现"列表里 60%、点进去 55%"的漂移。

    ## 查询规模
    指标查询与老师数**无关** —— 一次性把所有在读学生查出来算,再按老师分桶。
    生产 14 个老师 / 135 个学生,总共 6 条查询。老师涨到几百个也不会变慢。

    多租户: select(User)/select(Class) 都经 tenancy 过滤,org_admin 只看到本机构。
    """
    if days not in _TEACHER_WINDOWS:
        days = 7
    end_day = local_today()
    start_day = end_day - timedelta(days=days - 1)

    teachers = (await db.execute(
        select(User).where(User.role == "teacher").order_by(User.id)
    )).scalars().all()
    if not teachers:
        return {"window": {"days": days, "start": start_day.isoformat(),
                           "end": end_day.isoformat()},
                "teachers": [], "totals": {}, "checkin_note": _CHECKIN_NOTE}

    tids = [t.id for t in teachers]

    # 老师 → 班级 → 学生。两条查询,不按老师 N 次查
    cls_rows = (await db.execute(
        select(Class.id, Class.teacher_id)
        .where(Class.teacher_id.in_(tids))
    )).all()
    teacher_of_class = {cid: tid for cid, tid in cls_rows}
    class_ids = list(teacher_of_class)

    students_of_teacher: dict[int, set[int]] = {tid: set() for tid in tids}
    if class_ids:
        rows = (await db.execute(
            select(ClassStudent.class_id, ClassStudent.student_id)
            .join(User, User.id == ClassStudent.student_id)
            .where(
                ClassStudent.class_id.in_(class_ids),
                ClassStudent.is_active.is_(True),
                User.role == "student",
                User.is_active.is_(True),
            )
        )).all()
        for cid, sid in rows:
            students_of_teacher[teacher_of_class[cid]].add(sid)

    all_students = sorted({s for ss in students_of_teacher.values() for s in ss})
    checkins = await _checkin_counts(db, all_students, start_day, end_day)
    actives = await _active_student_ids(db, all_students, start_day, end_day)
    vocab, training = await _vocab_by_student(db, all_students, start_day, end_day)
    seconds = await study_time.seconds_by_student(db, all_students, start_day, end_day)

    class_count_of: dict[int, int] = {tid: 0 for tid in tids}
    for _cid, tid in cls_rows:
        class_count_of[tid] += 1

    out = []
    for t in teachers:
        ids = sorted(students_of_teacher[t.id])
        n = len(ids)
        checked = sum(checkins.get(i, 0) for i in ids)
        act = sum(1 for i in ids if i in actives)
        out.append({
            "teacher_id": t.id, "username": t.username,
            "full_name": t.full_name, "is_active": t.is_active,
            "last_login": t.last_login,
            "class_count": class_count_of[t.id],
            "student_count": n,
            "checkin_rate": _rate(checked, n * days),
            "active_students": act,
            "active_rate": _rate(act, n),
            "study_minutes": round(sum(seconds.get(i, 0) for i in ids) / 60),
            "vocab": sum(vocab.get(i, 0) for i in ids),
            "training": sum(training.get(i, 0) for i in ids),
        })

    # 全机构合计: 学生按**全局去重**(同一学生在两个老师名下只算一次),
    # 不能把各老师的数字相加 —— 那会重复计数
    total_checked = sum(checkins.get(i, 0) for i in all_students)
    total_act = sum(1 for i in all_students if i in actives)
    return {
        "window": {"days": days, "start": start_day.isoformat(),
                   "end": end_day.isoformat()},
        "teachers": out,
        "totals": {
            "teacher_count": len(teachers),
            "student_count": len(all_students),
            "checkin_rate": _rate(total_checked, len(all_students) * days),
            "active_students": total_act,
            "active_rate": _rate(total_act, len(all_students)),
            "study_minutes": round(sum(seconds.get(i, 0) for i in all_students) / 60),
            "vocab": sum(vocab.get(i, 0) for i in all_students),
        },
        "checkin_note": _CHECKIN_NOTE,
    }


@router.get("/checkins")
async def admin_checkins(
    day: Optional[str] = Query(None, description="查某一天(YYYY-MM-DD),默认今天"),
    class_id: Optional[int] = Query(None, description="只看某个班"),
    teacher_id: Optional[int] = Query(None, description="只看某位老师名下"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """某一天**所有学生**的签到明细(谁签了、几点签的、谁没签)。

    这是「管理端要能看所有教师端所有学生的签到」那条需求的落点:
    不用逐个老师点进去,一天一张表看全。可按班/按老师筛。

    未签到的学生**也要列出来**并标记 checked=false —— 只列签到的人,
    看的人无法回答"今天谁没来",而那恰恰是查签到的主要目的。
    """
    target = local_today()
    if day:
        try:
            target = date.fromisoformat(day)
        except ValueError:
            raise HTTPException(400, "日期格式应为 YYYY-MM-DD")

    # 学生范围: 经 tenancy 过滤(org_admin 只看本机构),再按班/老师收窄
    q = (
        select(ClassStudent.student_id, Class.id, Class.name, Class.teacher_id)
        .join(Class, Class.id == ClassStudent.class_id)
        .join(User, User.id == ClassStudent.student_id)
        .where(
            ClassStudent.is_active.is_(True),
            User.role == "student",
            User.is_active.is_(True),
        )
    )
    if class_id is not None:
        q = q.where(Class.id == class_id)
    if teacher_id is not None:
        q = q.where(Class.teacher_id == teacher_id)
    rows = (await db.execute(q)).all()

    sids = sorted({r[0] for r in rows})
    if not sids:
        return {"day": target.isoformat(), "total": 0, "checked": 0,
                "checkin_rate": 0.0, "students": [], "checkin_note": _CHECKIN_NOTE}

    # 姓名 + 老师名一次查出(不在循环里查库)
    name_of = {uid: (fn or un) for uid, un, fn in (await db.execute(
        select(User.id, User.username, User.full_name).where(User.id.in_(sids))
    )).all()}
    tids = sorted({r[3] for r in rows})
    teacher_name = {uid: (fn or un) for uid, un, fn in (await db.execute(
        select(User.id, User.username, User.full_name).where(User.id.in_(tids))
    )).all()} if tids else {}

    # 当天签到时刻
    checked_at = {uid: at for uid, at in (await db.execute(
        select(DailyCheckin.user_id, DailyCheckin.checkin_at)
        .where(DailyCheckin.user_id.in_(sids), DailyCheckin.checkin_date == target)
    )).all()}

    students = []
    for sid, cid, cname, tid in sorted(rows, key=lambda r: (r[2] or "", name_of.get(r[0], ""))):
        students.append({
            "student_id": sid, "name": name_of.get(sid, f"#{sid}"),
            "class_id": cid, "class_name": cname,
            "teacher_id": tid, "teacher_name": teacher_name.get(tid),
            "checked": sid in checked_at,
            # 签到时刻存 UTC,转北京时间给人看(差 8 小时会让"早上签的"显示成前一天深夜)
            "checked_at": (checked_at[sid] + timedelta(hours=8)).strftime("%H:%M")
                          if sid in checked_at else None,
        })

    checked_n = sum(1 for s in students if s["checked"])
    return {
        "day": target.isoformat(),
        "total": len(students), "checked": checked_n,
        "checkin_rate": _rate(checked_n, len(students)),
        "students": students,
        "checkin_note": _CHECKIN_NOTE,
    }
