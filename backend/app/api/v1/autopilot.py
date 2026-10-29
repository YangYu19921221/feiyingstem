"""小鹰老师自动布置作业(2026-10-29)的接口。规则见 services/autopilot.py 文件头。

路由挂在 tutor.py 的三个 router 上(main.py 生产有 drift,不动它):
- 老师 /teacher/autopilot/*: 班级设置、全班一览、按建议布置、撤回今天的、孩子单独设置、需要你处理
- 学生 /student/autopilot/*: 首页那张卡、再来一份、过关检测每一次都记
- 平台 /admin/autopilot: 总开关 + 今天派了多少
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_admin, get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.actor import acting_user, forbid_assistant
from app.core.database import get_db
from app.core.timeutil import local_today
from app.models.autopilot import AutopilotClass, AutopilotDispatch, AutopilotStudent
from app.models.user import Class, User
from app.models.word import Unit, WordBook
from app.services import audit_log
from app.services import autopilot as ap

teacher_router = APIRouter()
student_router = APIRouter()
admin_router = APIRouter()


# ---------------------------------------------------------------- 老师

async def _my_class(db: AsyncSession, teacher: User, class_id: int) -> Class:
    c = (await db.execute(select(Class).where(Class.id == class_id, Class.teacher_id == teacher.id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "没有这个班,或者不是你的班")
    return c


async def _class_settings(db: AsyncSession, class_id: int) -> Optional[AutopilotClass]:
    return (await db.execute(select(AutopilotClass).where(AutopilotClass.class_id == class_id))).scalar_one_or_none()


def _class_out(c: Class, ac: Optional[AutopilotClass]) -> dict:
    today = local_today()
    loc, why = ap.location_for(ac, today)
    return {
        "class_id": c.id, "name": c.name,
        "mode": ac.mode if ac else "manual",
        "class_days": ap.class_days_of(ac), "default_location": (ac.default_location if ac else None) or "classroom",
        "day_overrides": ap.overrides_of(ac),
        "max_words": ac.max_words if ac else None, "pass_line": ac.pass_line if ac else None,
        "paused": bool(ac.paused) if ac else False,
        "today_location": loc, "today_location_reason": why,
        "updated_by_name": ac.updated_by_name if ac else None,
    }


@teacher_router.get("/autopilot/overview")
async def autopilot_overview(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    settings = await ap.get_settings(db)
    classes = list((await db.execute(select(Class).where(Class.teacher_id == teacher.id).order_by(Class.id))).scalars())
    acs = {a.class_id: a for a in (await db.execute(select(AutopilotClass).where(
        AutopilotClass.class_id.in_([c.id for c in classes])))).scalars()} if classes else {}
    todo = await ap.todo(db, teacher.id) if settings["enabled"] else []
    return {
        "enabled": settings["enabled"],
        "classes": [_class_out(c, acs.get(c.id)) for c in classes],
        "todo": todo,
        "rules": {"tiers": list(ap.TIERS), "pass_lines": list(ap.PASS_LINES), "new_kid_words": ap.NEW_KID_TIER,
                  "graduate_rounds": ap.GRADUATE_ROUNDS, "extra_batches": ap.MAX_EXTRA_BATCHES,
                  "evening": f"{ap.EVENING[0]}:{ap.EVENING[1]:02d}"},
    }


@teacher_router.get("/autopilot/classes/{class_id}")
async def autopilot_class(class_id: int, db: AsyncSession = Depends(get_db),
                          teacher: User = Depends(get_current_teacher)):
    c = await _my_class(db, teacher, class_id)
    ac = await _class_settings(db, class_id)
    students = await ap.class_board(db, c, ac)
    await db.commit()   # 第一次看会补历史轮次、定档位
    return {"class": _class_out(c, ac), "students": students}


class ClassIn(BaseModel):
    mode: Optional[str] = None
    class_days: Optional[list[int]] = None
    default_location: Optional[str] = None
    max_words: Optional[int] = Field(None, ge=0, le=500)
    pass_line: Optional[int] = Field(None, ge=0, le=100)
    paused: Optional[bool] = None
    # 临时改某一天: {"date": "2026-10-30", "location": "home" / "classroom" / ""(取消)}
    day_override: Optional[dict] = None


@teacher_router.put("/autopilot/classes/{class_id}")
async def update_autopilot_class(class_id: int, body: ClassIn, request: Request, db: AsyncSession = Depends(get_db),
                                 teacher: User = Depends(get_current_teacher)):
    c = await _my_class(db, teacher, class_id)
    data = body.model_dump(exclude_unset=True)
    ac = await _class_settings(db, class_id)
    if ac is None:
        ac = AutopilotClass(class_id=class_id, org_id=c.org_id, mode="manual", default_location="classroom")
        db.add(ac)
    changes = []
    # 「键在才改」: 没带的字段不动;max_words / pass_line 传 0 或 null = 取消限制(显式分支)
    if "mode" in data:
        if data["mode"] not in ("auto", "manual"):
            raise HTTPException(400, "模式只能是自动或手动")
        if data["mode"] != ac.mode:
            forbid_assistant(teacher, "切换自动 / 手动")
            changes.append("改成" + ("自动(孩子签到就派)" if data["mode"] == "auto" else "手动(老师点了才派)"))
        ac.mode = data["mode"]
    if "class_days" in data:
        days = sorted({d for d in (data["class_days"] or []) if isinstance(d, int) and 0 <= d <= 6})
        ac.class_days = ",".join(str(d) for d in days) or None
        changes.append("来电教室: " + ("每周" + "、".join(ap.WEEKDAYS[d] for d in days) if days else "不设"))
    if "default_location" in data:
        if data["default_location"] not in ap.LOCATIONS:
            raise HTTPException(400, "默认地点只能是电教室或家里")
        ac.default_location = data["default_location"]
    if "max_words" in data:
        ac.max_words = data["max_words"] or None
        changes.append(f"全班每天最多 {ac.max_words} 个" if ac.max_words else "取消全班每天上限")
    if "pass_line" in data:
        v = data["pass_line"] or None
        if v is not None and v not in ap.PASS_LINES:
            raise HTTPException(400, "过关线只能是 80 / 85 / 90 / 95")
        ac.pass_line = v
        changes.append(f"全班过关线固定 {v}" if v else "过关线按每个孩子的能力")
        await db.flush()
        await ap.sync_today_target(db, [u.id for u in await ap.class_students(db, class_id)])
    if "paused" in data:
        ac.paused = bool(data["paused"])
        changes.append("暂停" if ac.paused else "恢复")
    if "day_override" in data and data["day_override"]:
        d = str(data["day_override"].get("date") or "")[:10]
        loc = data["day_override"].get("location") or ""
        try:
            day = ap._pd(d)
        except Exception:  # noqa: BLE001
            day = None
        if day is None or day < local_today():
            raise HTTPException(400, "日期不对(只能改今天和以后)")
        ov = ap.overrides_of(ac)
        # 过去的日子清掉,别越攒越多
        ov = {k: v for k, v in ov.items() if k >= ap._ds(local_today())}
        if loc in ap.LOCATIONS:
            ov[d] = loc
        else:
            ov.pop(d, None)
        ac.day_overrides = json.dumps(ov) if ov else None
        changes.append(f"{d} 改成" + ({"classroom": "电教室", "home": "在家"}.get(loc) or "按每周设置"))
    me = acting_user(teacher)
    ac.updated_by = me.id
    ac.updated_by_name = (me.full_name or me.username or "")[:100] or None
    if changes:
        audit_log.record(db, request, teacher, "autopilot.class", f"「{c.name}」小鹰老师自动布置: " + ";".join(changes),
                         target_type="class", target_id=c.id, detail=data)
    await db.commit()
    return _class_out(c, ac)


class StudentIn(BaseModel):
    fixed_words: Optional[int] = Field(None, ge=0, le=500)
    fixed_pass_line: Optional[int] = Field(None, ge=0, le=100)
    paused: Optional[bool] = None
    book_id: Optional[int] = None
    start_unit_id: Optional[int] = None


@teacher_router.put("/autopilot/students/{student_id}")
async def update_autopilot_student(student_id: int, body: StudentIn, request: Request,
                                   db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await assert_student_in_my_class(db, teacher.id, student_id)
    stu = await db.get(User, student_id)
    st = await ap.student_row(db, student_id, stu.org_id if stu else None)
    data = body.model_dump(exclude_unset=True)
    changes = []
    if "fixed_words" in data:
        st.fixed_words = data["fixed_words"] or None
        changes.append(f"每天固定 {st.fixed_words} 个" if st.fixed_words else "每天的量交给小鹰老师")
    if "fixed_pass_line" in data:
        v = data["fixed_pass_line"] or None
        if v is not None and v not in ap.PASS_LINES:
            raise HTTPException(400, "过关线只能是 80 / 85 / 90 / 95")
        st.fixed_pass_line = v
        changes.append(f"过关线固定 {v}" if v else "过关线交给小鹰老师")
        await db.flush()
        await ap.sync_today_target(db, [student_id])
    if "paused" in data:
        st.paused = bool(data["paused"])
        changes.append("暂停" if st.paused else "恢复")
    if "book_id" in data:
        b = data["book_id"] or None
        if b is not None:
            allowed = await ap.get_allowed_unit_ids(db, student_id, b)
            if allowed is not None and not allowed:
                raise HTTPException(400, "这本书他现在不能学(没分配,或者要兑换学习卡)")
        st.book_id = b
        if "start_unit_id" not in data:
            st.start_unit_id = None
        changes.append("指定了书" if b else "书交给小鹰老师挑")
    if "start_unit_id" in data:
        u = data["start_unit_id"] or None
        if u is not None:
            ub = (await db.execute(select(Unit.book_id).where(Unit.id == u))).scalar_one_or_none()
            if ub is None or (st.book_id and ub != st.book_id):
                raise HTTPException(400, "这个单元不在指定的书里")
            if not st.book_id:
                st.book_id = ub
        st.start_unit_id = u
        changes.append("指定了从哪个单元开始" if u else "从第一个没学过的单元开始")
    if changes and st.enrolled_at is None and (st.fixed_words or st.fixed_pass_line):
        st.enrolled_at = ap.utc_now()
    if changes:
        audit_log.record(db, request, teacher, "autopilot.student",
                         f"「{(stu.full_name or stu.username) if stu else student_id}」小鹰老师设置: " + ";".join(changes),
                         target_type="student", target_id=student_id, detail=data)
    await db.commit()
    return {"ok": True}


@teacher_router.get("/autopilot/students/{student_id}/preview")
async def autopilot_preview(student_id: int, db: AsyncSession = Depends(get_db),
                            teacher: User = Depends(get_current_teacher)):
    await assert_student_in_my_class(db, teacher.id, student_id)
    stu = await db.get(User, student_id)
    cls, ac = await ap.class_of_student(db, student_id)
    out = await ap.preview(db, stu, cls, ac)
    await db.commit()
    return out


@teacher_router.get("/autopilot/students/{student_id}/books")
async def autopilot_books(student_id: int, db: AsyncSession = Depends(get_db),
                          teacher: User = Depends(get_current_teacher)):
    """给老师挑「从哪本书哪个单元开始」: 他现在能学的书 + 每本的单元"""
    await assert_student_in_my_class(db, teacher.id, student_id)
    out = []
    for b in await ap.accessible_books(db, student_id):
        name = (await db.execute(select(WordBook.name).where(WordBook.id == b))).scalar_one_or_none() or ""
        allowed = await ap.get_allowed_unit_ids(db, student_id, b)
        units = [{"id": u, "name": n} for u, n in (await db.execute(
            select(Unit.id, Unit.name).where(Unit.book_id == b).order_by(Unit.order_index, Unit.unit_number, Unit.id)
        )).all() if allowed is None or u in allowed]
        out.append({"id": b, "name": name, "units": units})
    return {"books": out}


@teacher_router.get("/autopilot/classes/{class_id}/suggestions")
async def autopilot_suggestions(class_id: int, db: AsyncSession = Depends(get_db),
                                teacher: User = Depends(get_current_teacher)):
    """手动班: 今天还没派的孩子,小鹰老师建议派什么(不派,老师看了点「按建议布置」才派)"""
    c = await _my_class(db, teacher, class_id)
    ac = await _class_settings(db, class_id)
    ts = ap._ds(local_today())
    done = {i for (i,) in (await db.execute(select(AutopilotDispatch.student_id).where(
        AutopilotDispatch.day == ts, AutopilotDispatch.status == "dispatched"))).all()}
    out = {}
    for s in await ap.class_students(db, class_id):
        if s.id not in done:
            out[str(s.id)] = await ap.preview(db, s, c, ac)
    await db.commit()
    return {"suggestions": out}


class DispatchIn(BaseModel):
    student_ids: list[int] = Field(..., min_length=1, max_length=200)


@teacher_router.post("/autopilot/classes/{class_id}/dispatch")
async def autopilot_dispatch(class_id: int, body: DispatchIn, request: Request, db: AsyncSession = Depends(get_db),
                             teacher: User = Depends(get_current_teacher)):
    """手动班: 老师看了建议,点「按建议布置」。一个孩子一天还是只派一次"""
    c = await _my_class(db, teacher, class_id)
    settings = await ap.get_settings(db)
    if not settings["enabled"]:
        raise HTTPException(403, "平台暂时关掉了小鹰老师自动布置")
    in_class = {s.id: s for s in await ap.class_students(db, class_id)}
    bad = [i for i in body.student_ids if i not in in_class]
    if bad:
        raise HTTPException(403, "有的孩子不在这个班")
    me = acting_user(teacher)
    out = []
    for sid in dict.fromkeys(body.student_ids):
        r = await ap.ensure_dispatch(db, in_class[sid], source="teacher", actor=me, cls=c, request=request)
        out.append({"student_id": sid, **{k: r.get(k) for k in ("status", "reason", "already")}})
    return {"results": out, "dispatched": sum(1 for r in out if r["status"] == "dispatched" and not r.get("already"))}


@teacher_router.post("/autopilot/students/{student_id}/undo")
async def autopilot_undo(student_id: int, request: Request, db: AsyncSession = Depends(get_db),
                         teacher: User = Depends(get_current_teacher)):
    """撤回今天小鹰老师派的(孩子已经开始做的那几份留着)"""
    await assert_student_in_my_class(db, teacher.id, student_id)
    n = await ap.undo_today(db, student_id)
    stu = await db.get(User, student_id)
    if n:
        audit_log.record(db, request, teacher, "autopilot.undo",
                         f"撤回{ap.AUTHOR}今天给「{(stu.full_name or stu.username) if stu else student_id}」派的 {n} 份",
                         target_type="student", target_id=student_id)
    await db.commit()
    return {"removed": n}


@teacher_router.get("/autopilot/todo")
async def autopilot_todo(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    settings = await ap.get_settings(db)
    return {"items": await ap.todo(db, teacher.id) if settings["enabled"] else []}


# ---------------------------------------------------------------- 学生

@student_router.get("/autopilot/today")
async def my_autopilot_today(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    out = await ap.today_view(db, student)
    if out.get("comment_pending"):
        await ap.run_later(ap.comment_quietly, out["dispatch_id"])
    return out


@student_router.post("/autopilot/extra")
async def my_autopilot_extra(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    out = await ap.dispatch_extra(db, student)
    if not out["ok"]:
        raise HTTPException(409, out["message"])
    return out


class AttemptIn(BaseModel):
    unit_id: int
    word_ids: list[int] = Field(..., min_length=1, max_length=200)
    score: int = Field(..., ge=0, le=100)
    client_batch_id: Optional[str] = None


@student_router.post("/autopilot/attempt")
async def my_autopilot_attempt(body: AttemptIn, db: AsyncSession = Depends(get_db),
                               student: User = Depends(get_current_student)):
    """过关检测每一次都记(过了没过都记)。过没过按服务器的过关线判;今天派的、这几组都过了的作业顺手标完成"""
    from app.api.v1.student.learning_records import claim_client_batch
    if not await claim_client_batch(db, body.client_batch_id, student.id):
        return {"duplicate": True}
    sid = student.id
    out = await ap.record_attempt(db, student, body.unit_id, body.word_ids, body.score)
    done = await ap.complete_tasks(db, sid, body.unit_id, body.score) if out["passed"] else []
    await db.commit()
    if done:
        from app.services.coin_service import award_task_coins_isolated
        out["coin_awarded"] = await award_task_coins_isolated({(sid, local_today())}) > 0
        await ap.run_later(ap.after_submit, sid)
    out["completed_homework"] = done
    return out


# ---------------------------------------------------------------- 平台

class AdminIn(BaseModel):
    enabled: bool


async def _admin_stats(db: AsyncSession) -> dict:
    ts = ap._ds(local_today())
    auto_classes = (await db.execute(select(func.count()).select_from(AutopilotClass)
                                     .where(AutopilotClass.mode == "auto"))).scalar() or 0
    rows = dict((await db.execute(select(AutopilotDispatch.status, func.count()).where(AutopilotDispatch.day == ts)
                                  .group_by(AutopilotDispatch.status))).all())
    ai = (await db.execute(select(func.count(), func.coalesce(func.sum(AutopilotDispatch.comment_tokens), 0)).where(
        AutopilotDispatch.day == ts, AutopilotDispatch.comment_source == "ai"))).one()
    enrolled = (await db.execute(select(func.count()).select_from(AutopilotStudent)
                                 .where(AutopilotStudent.enrolled_at.is_not(None)))).scalar() or 0
    return {"auto_classes": int(auto_classes), "today": {k: int(v) for k, v in rows.items()},
            "ai_comments_today": int(ai[0] or 0), "ai_tokens_today": int(ai[1] or 0), "students": int(enrolled)}


@admin_router.get("/autopilot")
async def admin_autopilot(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return {**await ap.get_settings(db), **await _admin_stats(db)}


@admin_router.put("/autopilot")
async def admin_autopilot_save(body: AdminIn, request: Request, db: AsyncSession = Depends(get_db),
                               admin: User = Depends(get_current_admin)):
    out = await ap.save_settings(db, body.enabled)
    audit_log.record(db, request, admin, "autopilot.settings",
                     f"小鹰老师自动布置: {'打开' if body.enabled else '关掉'}(全平台)", detail=out)
    await db.commit()
    return {**out, **await _admin_stats(db)}
