"""
实时课堂:学生在线状态

学生端: POST /student/presence/heartbeat  (30s 周期 + 状态变化)
        POST /student/presence/switch     (切出/切回即时上报,兼容 sendBeacon)
教师端: GET  /teacher/classes/{class_id}/live  (5-10s 轮询快照)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.models.user import User, Class, ClassStudent
from app.api.v1.auth import get_current_student, get_current_teacher, get_current_user
from app.services import presence_service

router = APIRouter()


async def get_teacher_or_display(
    current_user: User = Depends(get_current_user),
) -> User:
    """教师/管理员/大屏展示账号。display 是只读投屏角色,仅放行只读快照端点"""
    if current_user.role not in ("teacher", "admin", "display"):
        raise HTTPException(status_code=403, detail="需要教师权限")
    return current_user


class HeartbeatRequest(BaseModel):
    visible: bool = True
    idle: bool = False
    unit_id: Optional[int] = None
    unit_name: Optional[str] = None


class SwitchRequest(BaseModel):
    leaving: bool


class FocusEventRequest(BaseModel):
    kind: str  # 'switch'(切屏) | 'distracted'(发呆60秒被全屏提醒)


@router.post("/student/presence/focus-event")
async def report_focus_event(
    data: FocusEventRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """走神事件落库:切屏/发呆计入 study_calendar,教师端每日数据展示"""
    from app.models.user import StudyCalendar
    from app.core.timeutil import local_today
    from sqlalchemy import func as sa_func
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    if data.kind not in ("switch", "distracted"):
        raise HTTPException(status_code=422, detail="kind 必须是 switch/distracted")
    today = local_today()
    # UPSERT 原子累加:先查后插会和学习记录提交竞态,当天首个事件可能撞唯一约束 500
    is_switch = data.kind == "switch"
    stmt = sqlite_insert(StudyCalendar).values(
        user_id=current_user.id,
        study_date=today,
        words_learned=0,
        duration=0,
        switch_count=1 if is_switch else 0,
        distracted_count=0 if is_switch else 1,
    ).on_conflict_do_update(
        index_elements=["user_id", "study_date"],
        set_={
            "switch_count": sa_func.coalesce(StudyCalendar.switch_count, 0) + (1 if is_switch else 0),
            "distracted_count": sa_func.coalesce(StudyCalendar.distracted_count, 0) + (0 if is_switch else 1),
        },
    )
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}


@router.post("/student/presence/heartbeat")
async def presence_heartbeat(
    data: HeartbeatRequest,
    current_user: User = Depends(get_current_student),
):
    presence_service.heartbeat(
        current_user.id,
        visible=data.visible,
        idle=data.idle,
        unit_id=data.unit_id,
        unit_name=data.unit_name,
    )
    return {"ok": True}


@router.post("/student/presence/switch")
async def presence_switch(
    data: SwitchRequest,
    current_user: User = Depends(get_current_student),
):
    presence_service.report_switch(current_user.id, leaving=data.leaving)
    return {"ok": True}


@router.get("/bigscreen/classes")
async def bigscreen_classes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_teacher_or_display),
):
    """大屏用班级列表:display/admin 看全部,教师看自己的班"""
    stmt = select(Class.id, Class.name).order_by(Class.name)
    if current_user.role == "teacher":
        stmt = stmt.where(Class.teacher_id == current_user.id)
    rows = (await db.execute(stmt)).all()
    return [{"id": r.id, "name": r.name} for r in rows]


@router.get("/bigscreen/classes/{class_id}/daily-stats")
async def bigscreen_daily_stats(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_teacher_or_display),
):
    """大屏用今日统计:复用班级管理的 daily-stats 口径。
    display 只读投屏账号可看任意班——通过班级归属教师身份代理调用,权限语义不变"""
    from app.api.v1.teacher.classes import get_class_daily_stats

    if current_user.role in ("teacher",):
        return await get_class_daily_stats(class_id=class_id, target_date=None, db=db, current_user=current_user)

    # display/admin:找到班级归属教师,以其身份调用(只读代理)
    cls_res = await db.execute(select(Class).where(Class.id == class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    owner_res = await db.execute(select(User).where(User.id == cls.teacher_id))
    owner = owner_res.scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="班级教师不存在")
    return await get_class_daily_stats(class_id=class_id, target_date=None, db=db, current_user=owner)


@router.get("/teacher/classes/{class_id}/live")
async def class_live_status(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_teacher_or_display),
):
    """班级实时状态快照(内存态 + 学习记录兜底)"""
    cls_res = await db.execute(select(Class).where(Class.id == class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    # display 大屏账号可看任意班(只读展示);教师只能看自己的班
    if current_user.role == 'teacher' and cls.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="不是你的班级")

    stu_res = await db.execute(
        select(User.id, User.username, User.full_name)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
    )
    rows = stu_res.all()
    name_map = {r.id: (r.full_name or r.username) for r in rows}

    live = presence_service.snapshot(list(name_map.keys()))
    for item in live:
        item["student_name"] = name_map.get(item["user_id"], "?")

    # ---- 学习记录兜底:没有心跳(旧版页面/未覆盖页面)但最近 3 分钟在答题的,判"在学" ----
    # 心跳功能上线后,学生长期不刷新的 SPA 老页面不发心跳,会被误判离线;
    # 答题记录是最硬的"在学"证据,以它兜底,不依赖前端版本。
    from datetime import datetime, timedelta
    from app.models.learning import LearningRecord, StudySession
    from app.models.word import Unit

    seen_ids = {x["user_id"] for x in live}
    covered = {x["user_id"] for x in live if x["status"] != "offline"}
    candidates = [uid for uid in name_map if uid not in covered]
    if candidates:
        cutoff = datetime.utcnow() - timedelta(minutes=3)
        rec_res = await db.execute(
            select(LearningRecord.user_id, func.count(LearningRecord.id))
            .where(
                LearningRecord.user_id.in_(candidates),
                LearningRecord.created_at >= cutoff,
            )
            .group_by(LearningRecord.user_id)
        )
        active_by_records = {uid for uid, _cnt in rec_res.all()}

        if active_by_records:
            # 带出最近会话的单元名(尽力而为)
            sess_res = await db.execute(
                select(StudySession.user_id, Unit.name)
                .join(Unit, Unit.id == StudySession.unit_id)
                .where(
                    StudySession.user_id.in_(active_by_records),
                    StudySession.started_at >= datetime.utcnow() - timedelta(hours=2),
                )
                .order_by(StudySession.started_at)
            )
            unit_by_user = {uid: uname for uid, uname in sess_res.all()}  # 后写覆盖=最新

            for uid in active_by_records:
                entry = {
                    "user_id": uid,
                    "student_name": name_map.get(uid, "?"),
                    "status": "studying",
                    "away_seconds": 0,
                    "switch_count_today": 0,
                    "unit_id": None,
                    "unit_name": unit_by_user.get(uid),
                    "last_seen_ago": 0,
                }
                if uid in seen_ids:
                    # 原来判了 offline → 替换为在学
                    live = [x for x in live if x["user_id"] != uid] + [entry]
                else:
                    live.append(entry)

    # 今日切屏/走神次数:以 study_calendar(focus-event 落库)为准 ——
    # 内存计数器进程重启就清零,库里是当天累积真实值,更准也跨重启。
    from app.models.user import StudyCalendar
    from app.core.timeutil import local_today
    today = local_today()
    cal_res = await db.execute(
        select(StudyCalendar.user_id, StudyCalendar.switch_count, StudyCalendar.distracted_count)
        .where(StudyCalendar.user_id.in_(list(name_map.keys())), StudyCalendar.study_date == today)
    )
    focus_by_user = {uid: (sw or 0, dc or 0) for uid, sw, dc in cal_res.all()}
    for item in live:
        sw, dc = focus_by_user.get(item["user_id"], (0, 0))
        item["switch_count_today"] = sw
        item["distracted_count_today"] = dc

    # 排序:切出置顶 > 疑似走神 > 学习中 > 离线;同状态按切屏次数降序
    order = {"away": 0, "distracted": 1, "studying": 2, "offline": 3}
    live.sort(key=lambda x: (order.get(x["status"], 9), -x["switch_count_today"]))

    online_ids = {x["user_id"] for x in live}
    return {
        "class_id": class_id,
        "class_name": cls.name,
        "total_students": len(rows),
        "online_count": len([x for x in live if x["status"] != "offline"]),
        "students": live,
        # 从未出现过的学生(今天没打开学习页)
        "never_seen": [
            {"user_id": uid, "student_name": nm}
            for uid, nm in name_map.items() if uid not in online_ids
        ],
    }
