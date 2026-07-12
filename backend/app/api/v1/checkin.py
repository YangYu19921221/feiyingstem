"""
每日签到

学生端: GET  /student/checkin/today   今天是否已签到
        POST /student/checkin         签到(幂等)
教师端: GET  /teacher/classes/{class_id}/checkins?target_date=  某天班级签到列表

产品规则:学生每天使用平台前先签到;未签到时学习入口(units/{id}/start)拒绝。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.models.user import User, Class, ClassStudent, DailyCheckin
from app.api.v1.auth import get_current_student, get_current_teacher
from app.core.timeutil import local_today, LOCAL_TZ
from zoneinfo import ZoneInfo

router = APIRouter()

_UTC = ZoneInfo("UTC")


def _fmt_bjt(dt: datetime) -> str:
    return dt.replace(tzinfo=_UTC).astimezone(LOCAL_TZ).strftime('%H:%M')


async def has_checked_in_today(db: AsyncSession, user_id: int) -> bool:
    """学习入口权限检查用:今天(北京日)是否已签到"""
    res = await db.execute(
        select(DailyCheckin.id).where(
            and_(DailyCheckin.user_id == user_id, DailyCheckin.checkin_date == local_today())
        )
    )
    return res.scalar_one_or_none() is not None


@router.get("/student/checkin/today")
async def get_today_checkin(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    res = await db.execute(
        select(DailyCheckin).where(
            and_(DailyCheckin.user_id == current_user.id, DailyCheckin.checkin_date == local_today())
        )
    )
    row = res.scalar_one_or_none()
    return {
        "checked_in": row is not None,
        "checkin_time": _fmt_bjt(row.checkin_at) if row and row.checkin_at else None,
    }


@router.post("/student/checkin")
async def do_checkin(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """签到(幂等:重复签到返回已签)"""
    today = local_today()
    uid = current_user.id  # 先取出,避免 rollback 后 ORM 对象过期再访问触发 MissingGreenlet

    # 先查:已签直接返回(并发下仍可能撞唯一约束,再兜一层)
    res = await db.execute(
        select(DailyCheckin).where(
            and_(DailyCheckin.user_id == uid, DailyCheckin.checkin_date == today)
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        return {"checked_in": True, "checkin_time": _fmt_bjt(existing.checkin_at) if existing.checkin_at else None, "already": True}

    try:
        row = DailyCheckin(user_id=uid, checkin_date=today)
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return {"checked_in": True, "checkin_time": _fmt_bjt(row.checkin_at), "already": False}
    except IntegrityError:
        await db.rollback()
        res = await db.execute(
            select(DailyCheckin).where(
                and_(DailyCheckin.user_id == uid, DailyCheckin.checkin_date == today)
            )
        )
        row = res.scalar_one()
        return {"checked_in": True, "checkin_time": _fmt_bjt(row.checkin_at) if row.checkin_at else None, "already": True}


@router.get("/teacher/checkins")
async def all_classes_checkins(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,默认今天"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """总签到:老师名下所有班级(admin=全部班级)合并的某天签到情况。

    返回与单班级接口同构(checked/unchecked),每行多带 class_name;
    另附 by_class 各班签到率小结,方便一眼看出哪个班拖后腿。
    """
    if target_date:
        try:
            from datetime import date
            dt = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式错误,应为 YYYY-MM-DD")
    else:
        dt = local_today()

    cls_q = select(Class)
    if current_user.role != 'admin':
        cls_q = cls_q.where(Class.teacher_id == current_user.id)
    classes = (await db.execute(cls_q)).scalars().all()
    class_names = {c.id: c.name for c in classes}

    # 学生一次查全:同一学生进多个班时按第一个班归属,只计一次(签到本来就是人级别的)
    stu_res = await db.execute(
        select(User.id, User.username, User.full_name, ClassStudent.class_id)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id.in_(list(class_names.keys())), ClassStudent.is_active.is_(True))
    )
    name_map: dict[int, str] = {}
    stu_class: dict[int, int] = {}
    class_members: dict[int, set] = {cid: set() for cid in class_names}
    for r in stu_res.all():
        if r.id not in name_map:
            name_map[r.id] = r.full_name or r.username
            stu_class[r.id] = r.class_id
        class_members[r.class_id].add(r.id)

    checkins = []
    if name_map:
        ck_res = await db.execute(
            select(DailyCheckin).where(
                and_(DailyCheckin.user_id.in_(list(name_map.keys())), DailyCheckin.checkin_date == dt)
            ).order_by(DailyCheckin.checkin_at)
        )
        checkins = ck_res.scalars().all()
    checked_ids = {c.user_id for c in checkins}

    by_class = []
    for cid, members in class_members.items():
        if not members:
            continue
        done = len(members & checked_ids)
        by_class.append({
            "class_id": cid,
            "class_name": class_names[cid],
            "total": len(members),
            "checked": done,
        })
    by_class.sort(key=lambda x: (x["checked"] / x["total"] if x["total"] else 0))

    return {
        "class_id": 0,
        "class_name": "全部班级",
        "date": dt.isoformat(),
        "total_students": len(name_map),
        "checked_count": len(checkins),
        "checked": [
            {
                "user_id": c.user_id,
                "student_name": name_map.get(c.user_id, "?"),
                "class_name": class_names.get(stu_class.get(c.user_id, -1), ""),
                "checkin_time": _fmt_bjt(c.checkin_at) if c.checkin_at else None,
                "rank": i + 1,
            }
            for i, c in enumerate(checkins)
        ],
        "unchecked": [
            {
                "user_id": uid,
                "student_name": nm,
                "class_name": class_names.get(stu_class.get(uid, -1), ""),
            }
            for uid, nm in name_map.items() if uid not in checked_ids
        ],
        "by_class": by_class,
    }


@router.get("/teacher/classes/{class_id}/checkins")
async def class_checkins(
    class_id: int,
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,默认今天"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """某天班级签到列表:已签(按时间升序,前3名标注)+ 未签名单"""
    cls_res = await db.execute(select(Class).where(Class.id == class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role != 'admin' and cls.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="不是你的班级")

    if target_date:
        try:
            from datetime import date
            dt = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式错误,应为 YYYY-MM-DD")
    else:
        dt = local_today()

    stu_res = await db.execute(
        select(User.id, User.username, User.full_name)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
    )
    rows = stu_res.all()
    name_map = {r.id: (r.full_name or r.username) for r in rows}

    ck_res = await db.execute(
        select(DailyCheckin).where(
            and_(DailyCheckin.user_id.in_(list(name_map.keys())), DailyCheckin.checkin_date == dt)
        ).order_by(DailyCheckin.checkin_at)
    )
    checkins = ck_res.scalars().all()
    checked_ids = {c.user_id for c in checkins}

    return {
        "class_id": class_id,
        "class_name": cls.name,
        "date": dt.isoformat(),
        "total_students": len(rows),
        "checked_count": len(checkins),
        "checked": [
            {
                "user_id": c.user_id,
                "student_name": name_map.get(c.user_id, "?"),
                "checkin_time": _fmt_bjt(c.checkin_at) if c.checkin_at else None,
                "rank": i + 1,
            }
            for i, c in enumerate(checkins)
        ],
        "unchecked": [
            {"user_id": uid, "student_name": nm}
            for uid, nm in name_map.items() if uid not in checked_ids
        ],
    }
