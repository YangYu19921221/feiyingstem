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
from app.models.autopilot import AutopilotClass, AutopilotClassSync, AutopilotDispatch, AutopilotStudent
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
    from app.services import catchup
    sync = await db.get(AutopilotClassSync, class_id)
    if sync is not None and sync.enabled:
        diag = await catchup.count_by_status(db, [s["id"] for s in students])
        for s_ in students:
            s_["catchup"] = {"diagnosis": diag.get(s_["id"]), "progress": await catchup.gap_progress(db, s_["id"])}
    return {"class": _class_out(c, ac), "students": students, "sync": await _sync_out(db, c, sync)}


# ---------------------------------------------------------------- 跟学校进度 + 查缺补漏(services/catchup,试点)

async def _sync_out(db: AsyncSession, c: Class, sync: Optional[AutopilotClassSync]) -> dict:
    from app.services import catchup
    book = await db.get(WordBook, sync.school_book_id) if sync and sync.school_book_id else None
    unit = await db.get(Unit, sync.school_unit_id) if sync and sync.school_unit_id else None
    return {"enabled": bool(sync and sync.enabled),
            # 每一项老师自己选: 当前值 + 默认 + 会怎样 + 风险(真源 services/catchup.OPTIONS,页面原样显示)
            "options": await catchup.class_options(db, c.id), "option_meta": catchup.OPTIONS,
            "school_book_id": book.id if book else None, "school_book_name": book.name if book else "",
            "school_unit_id": unit.id if unit else None, "school_unit_name": unit.name if unit else "",
            "updated_by_name": (sync.updated_by_name if sync else None) or ""}


@teacher_router.get("/autopilot/classes/{class_id}/sync-books")
async def autopilot_sync_books(class_id: int, db: AsyncSession = Depends(get_db),
                               teacher: User = Depends(get_current_teacher)):
    """选「学校这周讲到哪」用: 班里孩子在学的书和每本的单元"""
    c = await _my_class(db, teacher, class_id)
    from app.models.learning import LearningProgress
    from app.models.user import ClassStudent
    rows = (await db.execute(
        select(Unit.book_id, func.count(func.distinct(LearningProgress.user_id)))
        .join(LearningProgress, LearningProgress.unit_id == Unit.id)
        .join(ClassStudent, ClassStudent.student_id == LearningProgress.user_id)
        .join(WordBook, WordBook.id == Unit.book_id)
        .where(ClassStudent.class_id == c.id, ClassStudent.is_active.is_(True))
        .group_by(Unit.book_id).order_by(func.count(func.distinct(LearningProgress.user_id)).desc()).limit(12))).all()
    out = []
    for bid, n in rows:
        b = await db.get(WordBook, bid)
        units = (await db.execute(select(Unit.id, Unit.name).where(Unit.book_id == bid)
                                  .order_by(Unit.order_index, Unit.unit_number, Unit.id))).all()
        out.append({"id": bid, "name": b.name if b else "", "kids": n,
                    "units": [{"id": u, "name": nm or ""} for u, nm in units]})
    return {"books": out}


class SyncIn(BaseModel):
    enabled: Optional[bool] = None
    school_book_id: Optional[int] = None
    school_unit_id: Optional[int] = None
    # 只带改了的那几项;{"reset": true} = 全部恢复默认
    options: Optional[dict] = None


@teacher_router.put("/autopilot/classes/{class_id}/sync")
async def update_autopilot_sync(class_id: int, body: SyncIn, request: Request, db: AsyncSession = Depends(get_db),
                                teacher: User = Depends(get_current_teacher)):
    c = await _my_class(db, teacher, class_id)
    data = body.model_dump(exclude_unset=True)
    sync = await db.get(AutopilotClassSync, class_id)
    if sync is None:
        sync = AutopilotClassSync(class_id=class_id, org_id=c.org_id, enabled=False)
        db.add(sync)
    changes = []
    requested = 0
    from app.services import catchup
    if "options" in data and data["options"] is not None:
        from app.models.autopilot import AutopilotSyncOptions
        raw = dict(data["options"])
        reset = raw.pop("reset", False) is True
        try:
            new = {} if reset else catchup.check_options(raw)
        except ValueError as e:
            raise HTTPException(400, str(e))
        row = await db.get(AutopilotSyncOptions, class_id)
        cur = {} if reset else {k: v for k, v in (await catchup.class_options(db, class_id)).items()
                                if v != catchup.OPTION_DEFAULTS[k]}
        cur.update(new)
        cur = {k: v for k, v in cur.items() if v != catchup.OPTION_DEFAULTS[k]}   # 只存和默认不一样的
        if row is None:
            row = AutopilotSyncOptions(class_id=class_id)
            db.add(row)
        row.options = json.dumps(cur, ensure_ascii=False) if cur else None
        labels = {o["key"]: o for o in catchup.OPTIONS}
        if reset:
            changes.append("查缺补漏的选择全部恢复默认")
        for k, v in new.items():
            ch = next((c_["label"] for c_ in labels[k]["choices"] if c_["value"] == v), str(v))
            changes.append(f"{labels[k]['label']}: {ch}")
        await db.flush()
    if "enabled" in data and bool(data["enabled"]) != bool(sync.enabled):
        forbid_assistant(teacher, "打开 / 关掉跟学校进度")
        sync.enabled = bool(data["enabled"])
        changes.append("打开跟学校进度 + 查缺补漏" if sync.enabled else "关掉跟学校进度 + 查缺补漏")
        if sync.enabled and (await catchup.class_options(db, class_id))["auto_diagnose_on_enable"]:
            # 第一次打开不用老师再点: 全班每人一次摸底(孩子首页出现「先摸摸底」;已经有没做完的不重复建)
            me = acting_user(teacher)
            for u in await ap.class_students(db, class_id):
                before = await catchup.latest(db, u.id)
                if before is not None and before.status in ("pending", "doing", "done"):
                    continue
                await catchup.request(db, u.id, u.org_id, me.id, me.full_name or me.username or "")
                requested += 1
            if requested:
                changes.append(f"全班 {requested} 个孩子自动摸底")
    # 「键在才改」;都传 null = 不设(按每个孩子最近在学的单元)
    if "school_book_id" in data or "school_unit_id" in data:
        bid, uid = data.get("school_book_id"), data.get("school_unit_id")
        if uid is not None:
            u = await db.get(Unit, uid)
            if u is None or (bid is not None and u.book_id != bid):
                raise HTTPException(400, "这个单元不在选的书里")
            bid = u.book_id
        if bid is not None and await db.get(WordBook, bid) is None:
            raise HTTPException(400, "没有这本书")
        sync.school_book_id, sync.school_unit_id = bid, uid
        changes.append("学校讲到: " + (f"书 {bid} 单元 {uid}" if uid else "按每个孩子最近在学的单元"))
    me = acting_user(teacher)
    sync.updated_by = me.id
    sync.updated_by_name = (me.full_name or me.username or "")[:100] or None
    if changes:
        audit_log.record(db, request, teacher, "autopilot.sync", f"「{c.name}」" + ";".join(changes),
                         target_type="class", target_id=c.id, detail=data)
    await db.commit()
    return {**await _sync_out(db, c, sync), "requested": requested}


@teacher_router.get("/autopilot/classes/{class_id}/book-gaps")
async def autopilot_book_gaps(class_id: int, db: AsyncSession = Depends(get_db),
                              teacher: User = Depends(get_current_teacher)):
    """「开书」: 没开书 / 要补的书没开 / 要兑卡 / 不知道在学哪本(规则见 services/catchup 文件头第 6 条)"""
    c = await _my_class(db, teacher, class_id)
    from app.services import catchup
    return await catchup.book_gaps(db, await ap.class_students(db, c.id))


class OpenBookItem(BaseModel):
    student_id: int
    book_id: int


class OpenBooksIn(BaseModel):
    items: list[OpenBookItem] = Field(..., min_length=1, max_length=500)


@teacher_router.post("/autopilot/classes/{class_id}/open-books")
async def autopilot_open_books(class_id: int, body: OpenBooksIn, request: Request, db: AsyncSession = Depends(get_db),
                               teacher: User = Depends(get_current_teacher)):
    """老师勾了一键开书(整本)。要兑卡 / 专属没开通的跳过并说明;有一个不是这个班的整批 403。
    和「分配单词本」同一张表、同一套锁书规则,只是一次给好几个孩子各开各的"""
    from sqlalchemy.exc import IntegrityError
    from app.models.learning import BookAssignment
    from app.services import card_pack
    from app.services.scope_service import get_allowed_unit_ids
    c = await _my_class(db, teacher, class_id)
    roster = {u.id: u for u in await ap.class_students(db, class_id)}
    if any(i.student_id not in roster for i in body.items):
        raise HTTPException(403, "有的孩子不在这个班")
    created, already, locked, missing = 0, 0, [], 0
    done_names: dict[str, list[str]] = {}
    me = acting_user(teacher)
    for it in {(i.student_id, i.book_id): i for i in body.items}.values():
        u = roster[it.student_id]
        book = await db.get(WordBook, it.book_id)
        if book is None:
            missing += 1
            continue
        reason = await card_pack.lock_reason(db, u.org_id, book.id)
        if reason:
            locked.append({"student_id": u.id, "book_name": book.name, "reason": reason})
            continue
        if await get_allowed_unit_ids(db, u.id, book.id) is None:
            already += 1
            continue
        try:
            async with db.begin_nested():
                db.add(BookAssignment(book_id=book.id, student_id=u.id, teacher_id=c.teacher_id, scope_type="book",
                                      is_completed=False))
                await db.flush()
            created += 1
            done_names.setdefault(book.name, []).append((u.full_name or u.username or "")[:20])
        except IntegrityError:
            already += 1
    if created:
        audit_log.record(
            db, request, teacher, "book.assign",
            f"「{c.name}」查缺补漏开书: 给 {created} 个孩子开了整本(" + ";".join(
                f"《{b}》{len(v)} 人" for b, v in done_names.items()) + ")",
            target_type="class", target_id=c.id,
            detail={"by": me.id, "books": done_names, "locked": locked})
    await db.commit()
    ap._groups_cache.clear()
    return {"created": created, "already": already, "locked": locked, "missing": missing}


class CatchupIn(BaseModel):
    student_ids: list[int] = Field(..., min_length=1, max_length=200)


@teacher_router.post("/autopilot/classes/{class_id}/catchup")
async def request_catchup(class_id: int, body: CatchupIn, request: Request, db: AsyncSession = Depends(get_db),
                          teacher: User = Depends(get_current_teacher)):
    """让这些孩子做一次摸底(孩子首页会出现「先摸摸底」)。有一个不是这个班的整批 403"""
    c = await _my_class(db, teacher, class_id)
    from app.services import catchup
    roster = {u.id for u in await ap.class_students(db, class_id)}
    bad = [i for i in body.student_ids if i not in roster]
    if bad:
        raise HTTPException(403, "有的孩子不在这个班")
    me = acting_user(teacher)
    n = 0
    for sid in dict.fromkeys(body.student_ids):
        stu = await db.get(User, sid)
        before = await catchup.latest(db, sid)
        d = await catchup.request(db, sid, stu.org_id if stu else c.org_id, me.id, me.full_name or me.username or "")
        n += 1 if before is None or before.id != d.id else 0
    audit_log.record(db, request, teacher, "autopilot.catchup", f"「{c.name}」让 {n} 个孩子做摸底",
                     target_type="class", target_id=c.id, detail={"student_ids": body.student_ids})
    await db.commit()
    return {"requested": n}


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
    from app.api.v1.checkin import require_checkin
    await require_checkin(db, student.id)   # 小鹰老师排的每一步都要先签到
    out = await ap.dispatch_extra(db, student)
    if not out["ok"]:
        raise HTTPException(409, out["message"])
    return out


# ---------------------------------------------------------------- 学生: 摸底

async def _my_diag(db: AsyncSession, student: User):
    from app.services import catchup
    d = await catchup.latest(db, student.id)
    if d is None or d.status not in ("pending", "doing", "done", "skipped"):
        return None
    return d


async def _diag_out(db: AsyncSession, d) -> dict:
    from app.services import catchup
    if d.status in ("done", "skipped"):
        return {"status": d.status, "result": await catchup.summary(db, d)}
    s = await catchup.compute(db, d)
    if s.next is None:   # 测完了(连着几个单元都会 / 测满 / 测到头): 自动结束
        res = await catchup.finish(db, d)
        await db.commit()
        return {"status": "done", "result": res}
    opts = await catchup.student_options(db, d.student_id)
    return {"status": d.status, "answered": s.answered, "left": catchup.est_left(s, d, opts["max_questions"]),
            "units_done": len(s.verdicts), "question": await catchup.question_out(db, d, s),
            "minutes": max(1, round(opts["max_questions"] * catchup.SECONDS_PER_Q / 60)),
            "can_finish_early": opts["allow_finish_early"]}


@student_router.get("/catchup")
async def my_catchup(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    d = await _my_diag(db, student)
    if d is None:
        return {"status": "none"}
    from app.services import catchup
    if d.units is None:
        await catchup.begin(db, d)
        await db.commit()
    return await _diag_out(db, d)


class CatchupAnswerIn(BaseModel):
    word_id: int
    choice: Optional[int] = Field(None, ge=0, le=5)
    text: Optional[str] = Field(None, max_length=60)
    dont_know: bool = False


@student_router.post("/catchup/answer")
async def answer_catchup(body: CatchupAnswerIn, db: AsyncSession = Depends(get_db),
                         student: User = Depends(get_current_student)):
    from app.services import catchup
    d = await _my_diag(db, student)
    if d is None or d.status not in ("pending", "doing") or d.units is None:
        raise HTTPException(409, "现在没有要做的摸底")
    r = await catchup.answer(db, d, body.word_id, body.choice, body.text, body.dont_know)
    await db.commit()
    return {**r, **await _diag_out(db, d)}


@student_router.post("/catchup/finish")
async def finish_catchup(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """孩子「先测到这」: 测过的单元照样算,没测的以后再说"""
    from app.services import catchup
    d = await _my_diag(db, student)
    if d is None or d.status not in ("pending", "doing"):
        raise HTTPException(409, "现在没有要做的摸底")
    if not (await catchup.student_options(db, student.id))["allow_finish_early"]:
        raise HTTPException(409, "老师设了要测完才能结束,再坚持一下")
    if d.units is None:
        await catchup.begin(db, d)
    res = await catchup.finish(db, d, early=True)
    await db.commit()
    return {"status": "done", "result": res}


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
