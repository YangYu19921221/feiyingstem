"""
班级光荣榜聚合逻辑

三类榜单（基于 StudySession + LearningProgress 数据）：
- perfect_king ：本月本班"满分会话"次数最多者
                 满分定义：correct_count == words_studied AND words_studied >= 5
- speed_king   ：本月本班"满分会话"中 time_spent 最短者
- progress_star：本月最近 3 次会话平均正确率 vs 上月最后 3 次平均正确率，
                 差值最大且 >= 10%

性能：单班级数据量小（几十人 * 几十次会话 / 月），直接 SQL 聚合即可。
"""
from datetime import datetime
from typing import Optional, Dict
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Class, ClassStudent
from app.models.learning import StudySession


PROGRESS_MIN_DELTA = 10  # 进步之星：差值 >= 10% 才上榜


def _month_range(now: datetime) -> tuple[datetime, datetime]:
    """返回 (本月第一天 00:00, 下月第一天 00:00)"""
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if first.month == 12:
        next_first = first.replace(year=first.year + 1, month=1)
    else:
        next_first = first.replace(month=first.month + 1)
    return first, next_first


async def get_student_class(db: AsyncSession, user_id: int) -> Optional[Class]:
    """查学生所在班级（取第一个 active 的）"""
    res = await db.execute(
        select(Class)
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .where(
            ClassStudent.student_id == user_id,
            ClassStudent.is_active.is_(True),
        )
        .limit(1)
    )
    return res.scalar_one_or_none()


async def get_class_student_ids(db: AsyncSession, class_id: int) -> list[int]:
    res = await db.execute(
        select(ClassStudent.student_id)
        .where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    return [r[0] for r in res.all()]


async def get_user_brief(db: AsyncSession, user_id: int) -> Optional[Dict]:
    res = await db.execute(
        select(User.id, User.full_name, User.username, User.hero_id)
        .where(User.id == user_id)
    )
    row = res.first()
    if not row:
        return None
    return {
        "user_id": row[0],
        "nickname": row[1] or row[2],
        "hero_id": row[3],
    }


async def compute_perfect_king(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """本月满分会话次数最多的学生"""
    if not student_ids:
        return None
    res = await db.execute(
        select(
            StudySession.user_id,
            func.count(StudySession.id).label("perfect_count"),
        )
        .where(
            StudySession.user_id.in_(student_ids),
            StudySession.started_at >= month_start,
            StudySession.started_at < month_end,
            StudySession.words_studied >= 5,
            StudySession.correct_count == StudySession.words_studied,
        )
        .group_by(StudySession.user_id)
        .order_by(func.count(StudySession.id).desc())
        .limit(1)
    )
    row = res.first()
    if not row:
        return None
    user = await get_user_brief(db, row[0])
    if not user:
        return None
    return {
        **user,
        "metric": row[1],
        "metric_label": f"{row[1]} 次满分通关",
    }


async def compute_speed_king(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """本月最快满分通关者"""
    if not student_ids:
        return None
    res = await db.execute(
        select(
            StudySession.user_id,
            func.min(StudySession.time_spent).label("min_time"),
        )
        .where(
            StudySession.user_id.in_(student_ids),
            StudySession.started_at >= month_start,
            StudySession.started_at < month_end,
            StudySession.words_studied >= 5,
            StudySession.correct_count == StudySession.words_studied,
            StudySession.time_spent > 0,
        )
        .group_by(StudySession.user_id)
        .order_by(func.min(StudySession.time_spent).asc())
        .limit(1)
    )
    row = res.first()
    if not row:
        return None
    user = await get_user_brief(db, row[0])
    if not user:
        return None
    return {
        **user,
        "metric": row[1],
        "metric_label": f"最快 {row[1]} 秒满分通关",
    }


async def compute_progress_star(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """
    进步之星：本月最近 3 次会话平均正确率 vs 上月最后 3 次平均正确率，
    差值最大且 >= PROGRESS_MIN_DELTA 才上榜
    """
    if not student_ids:
        return None
    if month_start.month == 1:
        prev_start = month_start.replace(year=month_start.year - 1, month=12)
    else:
        prev_start = month_start.replace(month=month_start.month - 1)

    best_user_id = None
    best_delta = -999

    for uid in student_ids:
        # 本月最近 3 次
        cur_res = await db.execute(
            select(StudySession.correct_count, StudySession.words_studied)
            .where(
                StudySession.user_id == uid,
                StudySession.started_at >= month_start,
                StudySession.started_at < month_end,
                StudySession.words_studied > 0,
            )
            .order_by(StudySession.started_at.desc())
            .limit(3)
        )
        cur_rows = cur_res.all()
        if len(cur_rows) < 1:
            continue
        cur_acc = sum(r[0] / r[1] * 100 for r in cur_rows) / len(cur_rows)

        # 上月最后 3 次
        prev_res = await db.execute(
            select(StudySession.correct_count, StudySession.words_studied)
            .where(
                StudySession.user_id == uid,
                StudySession.started_at >= prev_start,
                StudySession.started_at < month_start,
                StudySession.words_studied > 0,
            )
            .order_by(StudySession.started_at.desc())
            .limit(3)
        )
        prev_rows = prev_res.all()
        if len(prev_rows) < 1:
            continue
        prev_acc = sum(r[0] / r[1] * 100 for r in prev_rows) / len(prev_rows)

        delta = cur_acc - prev_acc
        if delta > best_delta:
            best_delta = delta
            best_user_id = uid

    if best_user_id is None or best_delta < PROGRESS_MIN_DELTA:
        return None

    user = await get_user_brief(db, best_user_id)
    if not user:
        return None
    return {
        **user,
        "metric": int(round(best_delta)),
        "metric_label": f"本月进步 {int(round(best_delta))} 分",
    }


async def build_hall_of_fame(db: AsyncSession, student_user_id: int) -> Dict:
    now = datetime.utcnow()
    cls = await get_student_class(db, student_user_id)
    period = now.strftime("%Y-%m")

    if not cls:
        return {
            "class_id": None,
            "class_name": None,
            "period": period,
            "champions": {
                "perfect_king": None,
                "speed_king": None,
                "progress_star": None,
            },
        }

    student_ids = await get_class_student_ids(db, cls.id)
    month_start, month_end = _month_range(now)

    perfect = await compute_perfect_king(db, student_ids, month_start, month_end)
    speed = await compute_speed_king(db, student_ids, month_start, month_end)
    progress = await compute_progress_star(db, student_ids, month_start, month_end)

    return {
        "class_id": cls.id,
        "class_name": cls.name,
        "period": period,
        "champions": {
            "perfect_king": perfect,
            "speed_king": speed,
            "progress_star": progress,
        },
    }
