"""句子 / 音标视频作业(2026-10-21)

老师端: 布置(选句子单元或音标视频 + 学生 + 哪天开放)、看列表与完成情况、关闭/删除
学生端: 看自己的这类作业、点「去完成」拿到跳转目标

完成**不由前端报**: 每次列作业时按真实学习数据现判一遍(见 _refresh_completion),
判到学完就写 completed_at(只写不清)。数据模型与为什么单开一张表见 models/content_homework。
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student, get_current_teacher
from app.core.actor import acting_user, is_assistant_request
from app.core.database import get_db
from app.core.timeutil import local_day_utc_range, local_today
from app.models.content_homework import (
    KIND_DAILY_REVIEW, KIND_PHONETIC_VIDEO, KIND_READ_ALOUD, KIND_SENTENCE, KINDS,
    ContentHomework, ContentHomeworkStudent,
)
from app.models.phonetic import PhoneticVideo
from app.models.sentence import SentenceBook, SentenceUnit
from app.models.user import User
from app.models.word import Unit, WordBook
from app.services import audit_log
from app.services import read_aloud as ra
from app.services import content_homework as chw

teacher_router = APIRouter()
student_router = APIRouter()

KIND_LABEL = chw.KIND_LABEL
DAILY_REVIEW_NAME = chw.DAILY_REVIEW_NAME
MAX_REVIEW_DAYS = 31


# ---------- 目标(句子单元 / 音标视频)----------

async def _target_info(db: AsyncSession, kind: str, target_id: int, org_id: Optional[int]) -> Optional[dict]:
    """目标存在且对这个机构可见 → {name, book_id?, ...};否则 None。
    可见性**显式写**(本机构的 + 平台共享的),不押在隐式租户过滤器上"""
    if kind == KIND_DAILY_REVIEW:
        return {"name": DAILY_REVIEW_NAME, "book_id": None}
    if kind == KIND_SENTENCE:
        row = (await db.execute(
            select(SentenceUnit, SentenceBook)
            .join(SentenceBook, SentenceBook.id == SentenceUnit.book_id)
            .where(SentenceUnit.id == target_id)
            .execution_options(skip_tenant_filter=True)
        )).first()
        if row is None:
            return None
        unit, book = row
        if book.org_id is not None and org_id is not None and book.org_id != org_id:
            return None
        if not book.is_public:
            return None
        return {"name": f"{book.name} · {unit.name}", "book_id": book.id}
    if kind == KIND_PHONETIC_VIDEO:
        v = (await db.execute(
            select(PhoneticVideo).where(PhoneticVideo.id == target_id, PhoneticVideo.is_active.is_(True))
            .execution_options(skip_tenant_filter=True)
        )).scalar_one_or_none()
        if v is None:
            return None
        if v.org_id is not None and org_id is not None and v.org_id != org_id:
            return None
        return {"name": v.title, "book_id": None}
    if kind == KIND_READ_ALOUD:
        row = (await db.execute(
            select(Unit, WordBook).join(WordBook, WordBook.id == Unit.book_id)
            .where(Unit.id == target_id).execution_options(skip_tenant_filter=True)
        )).first()
        if row is None:
            return None
        unit, book = row
        if book.org_id is not None and org_id is not None and book.org_id != org_id:
            return None
        if not book.is_public and book.org_id is None:
            return None
        # 一句能跟读的例句都没有的单元布置了也做不成(永远完成不了)
        if not (await ra.eligible_sentences(db, [unit.id]))[unit.id]:
            return None
        return {"name": f"{book.name} · {unit.name}", "book_id": book.id}
    return None


# 完成判定、状态、目标名的唯一真源在 services/content_homework(看板、今日报告也读它)
_target_names = chw.target_names
_refresh_completion = chw.refresh_completion
_open_day = chw.open_day
_status = chw.status


# ---------- 老师端 ----------

class CreateIn(BaseModel):
    kind: str
    # 每日复习不用选内容(传空)
    target_ids: List[int] = Field(default_factory=list, max_length=30)
    student_ids: List[int] = Field(..., min_length=1, max_length=500)
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    # 北京日期 YYYY-MM-DD;空 = 今天
    available_date: Optional[str] = None
    # 多个目标时每份比前一份晚一天开放(一次布置一周)
    daily_sequence: bool = False
    # True = 只能开放当天做(同单词当日任务);False = 开放后一直能做(默认: 在家做的作业给孩子留余地)
    same_day_only: bool = False
    # 每日复习: 从开始日期起连续几天,每天一份(恒为当天截止)
    days: int = Field(1, ge=1, le=MAX_REVIEW_DAYS)


async def _students_teacher_can_assign(db: AsyncSession, teacher: User, ids: list[int]) -> list[User]:
    """只能布置给**本机构**的学生(admin 不限)。不校验的话改一下请求就能往别家机构塞作业"""
    q = select(User).where(User.id.in_(ids), User.role == "student")
    if teacher.role != "admin":
        q = q.where(User.org_id == teacher.org_id)
    return list((await db.execute(q)).scalars())


@teacher_router.post("/content-homework")
async def create_content_homework(
    body: CreateIn,
    http: Request,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    if body.kind not in KINDS:
        raise HTTPException(400, "作业类型不对")
    actor = acting_user(teacher)
    is_review = body.kind == KIND_DAILY_REVIEW
    org_scope = teacher.org_id if teacher.role != "admin" else None
    targets = [] if is_review else list(dict.fromkeys(body.target_ids))
    if not is_review and not targets:
        raise HTTPException(400, f"先选要布置的{KIND_LABEL[body.kind]}")
    infos = {}
    for tid in targets:
        info = await _target_info(db, body.kind, tid, org_scope)
        if info is None:
            raise HTTPException(404, f"{KIND_LABEL[body.kind]}不存在或已下架: {tid}")
        infos[tid] = info
    want = list(dict.fromkeys(body.student_ids))
    students = await _students_teacher_can_assign(db, teacher, want)
    if len(students) != len(want):
        raise HTTPException(404, "部分学生不存在,或不是你机构的学生")

    try:
        base = (datetime.strptime(body.available_date, "%Y-%m-%d").date()
                if body.available_date else local_today())
    except ValueError:
        raise HTTPException(400, "开始日期格式错误,应为 YYYY-MM-DD")
    if base < local_today():
        raise HTTPException(400, "开始日期不能早于今天")
    if base > local_today() + timedelta(days=60):
        raise HTTPException(400, "开始日期最多提前 60 天")

    # (目标 id, 开放日, 标题)
    if is_review:
        items = []
        for i in range(body.days):
            day = base + timedelta(days=i)
            label = f"{KIND_LABEL[body.kind]} · {day.month}月{day.day}日"
            items.append((0, day, f"{body.title.strip()} · {day.month}月{day.day}日" if (body.title or "").strip() else label))
    else:
        items = []
        for i, tid in enumerate(targets):
            day = base + timedelta(days=i) if (body.daily_sequence and len(targets) > 1) else base
            title = (body.title or "").strip() or f"{KIND_LABEL[body.kind]}:{infos[tid]['name']}"
            if body.title and len(targets) > 1:
                title = f"{body.title.strip()} · {infos[tid]['name']}"
            items.append((tid, day, title))

    ids = []
    for tid, day, title in items:
        open_at, day_end = local_day_utc_range(day)
        hw = ContentHomework(
            kind=body.kind, target_id=tid, title=title[:200], description=body.description,
            teacher_id=teacher.id, org_id=teacher.org_id,
            assigned_by=actor.id, assigned_by_name=(actor.full_name or actor.username or "")[:100] or None,
            # 每日复习恒为当天截止: 那一天的 20 个第二天就换了
            available_from=open_at, deadline=day_end if (body.same_day_only or is_review) else None,
        )
        db.add(hw)
        await db.flush()
        ids.append(hw.id)
        for s in students:
            db.add(ContentHomeworkStudent(homework_id=hw.id, student_id=s.id))

    names = [s.full_name or s.username for s in students]
    what = (f"连续 {len(ids)} 天" if is_review
            else f"{len(ids)} 份:{'、'.join(infos[t]['name'] for t in targets)}")
    audit_log.record(
        db, http, teacher, "homework.create",
        f"布置{KIND_LABEL[body.kind]}作业 {what},{base.isoformat()} 开放,给 {len(names)} 名学生",
        target_type="content_homework", target_id=ids[0],
        detail={"kind": body.kind, "homework_ids": ids, "target_ids": targets,
                "students": [{"id": s.id, "name": n} for s, n in zip(students, names)]},
    )
    await db.commit()
    return {"homework_ids": ids, "assigned": len(ids) * len(students)}


def _can_manage(teacher: User, hw: ContentHomework) -> bool:
    if not is_assistant_request(teacher):
        return True
    return hw.assigned_by == acting_user(teacher).id


async def _own(db: AsyncSession, teacher: User, homework_id: int) -> ContentHomework:
    hw = await db.get(ContentHomework, homework_id)
    if hw is None or (teacher.role != "admin" and hw.teacher_id != teacher.id):
        raise HTTPException(404, "作业不存在")
    return hw


@teacher_router.get("/content-homework")
async def list_content_homework(
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    rows = list((await db.execute(
        select(ContentHomework).where(ContentHomework.teacher_id == teacher.id)
        .order_by(ContentHomework.available_from.desc(), ContentHomework.id.desc()).limit(300)
    )).scalars())
    if not rows:
        return []
    links = [(s, h) for s, h in (await db.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomework.id.in_([h.id for h in rows]))
    )).all()]
    if await _refresh_completion(db, links):
        await db.commit()
    stats: dict[int, list[int]] = {}
    for s, h in links:
        st = stats.setdefault(h.id, [0, 0])
        st[0] += 1
        st[1] += s.completed_at is not None
    names = await _target_names(db, rows)
    return [{
        "id": h.id, "kind": h.kind, "kind_label": KIND_LABEL.get(h.kind, h.kind),
        "target_id": h.target_id, "target_name": names.get((h.kind, h.target_id), "(内容已删除)"),
        "title": h.title, "description": h.description,
        "available_date": (h.available_from + timedelta(hours=8)).date().isoformat(),
        "same_day_only": h.deadline is not None,
        "is_closed": bool(h.is_closed),
        "total": stats.get(h.id, [0, 0])[0], "completed": stats.get(h.id, [0, 0])[1],
        "assigned_by_name": h.assigned_by_name, "can_manage": _can_manage(teacher, h),
    } for h in rows]


@teacher_router.get("/content-homework/{homework_id}/students")
async def content_homework_students(
    homework_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    hw = await _own(db, teacher, homework_id)
    rows = (await db.execute(
        select(ContentHomeworkStudent, User).join(User, User.id == ContentHomeworkStudent.student_id)
        .where(ContentHomeworkStudent.homework_id == hw.id).order_by(User.full_name)
    )).all()
    if await _refresh_completion(db, [(s, hw) for s, _ in rows]):
        await db.commit()
    now = datetime.utcnow()
    return [{
        "student_id": u.id, "name": u.full_name or u.username, "status": _status(s, hw, now),
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
    } for s, u in rows]


@teacher_router.post("/content-homework/{homework_id}/toggle-closed")
async def toggle_content_homework(
    homework_id: int, http: Request,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    hw = await _own(db, teacher, homework_id)
    if not _can_manage(teacher, hw):
        raise HTTPException(403, "助教只能关闭自己布置的作业")
    hw.is_closed = not hw.is_closed
    audit_log.record(db, http, teacher, "homework.close" if hw.is_closed else "homework.reopen",
                     f"{'关闭' if hw.is_closed else '重新开放'}作业「{hw.title}」",
                     target_type="content_homework", target_id=hw.id)
    await db.commit()
    return {"is_closed": hw.is_closed}


@teacher_router.delete("/content-homework/{homework_id}")
async def delete_content_homework(
    homework_id: int, http: Request,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    hw = await _own(db, teacher, homework_id)
    if not _can_manage(teacher, hw):
        raise HTTPException(403, "助教只能删除自己布置的作业")
    await db.execute(delete(ContentHomeworkStudent).where(ContentHomeworkStudent.homework_id == hw.id))
    audit_log.record(db, http, teacher, "homework.delete", f"删除作业「{hw.title}」",
                     target_type="content_homework", target_id=hw.id)
    await db.delete(hw)
    await db.commit()
    return {"ok": True}


@teacher_router.get("/content-homework/targets")
async def content_homework_targets(
    kind: str,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """布置弹窗里的可选项: 句子 = 书 → 单元;视频 = 按讲师分组的视频列表;每日复习不用选"""
    if kind == KIND_DAILY_REVIEW:
        return []
    org_id = teacher.org_id if teacher.role != "admin" else None
    if kind == KIND_SENTENCE:
        q = select(SentenceBook, SentenceUnit).join(SentenceUnit, SentenceUnit.book_id == SentenceBook.id) \
            .where(SentenceBook.is_public.is_(True)).execution_options(skip_tenant_filter=True) \
            .order_by(SentenceBook.id, SentenceUnit.order_index, SentenceUnit.unit_number)
        if org_id is not None:
            q = q.where(or_(SentenceBook.org_id.is_(None), SentenceBook.org_id == org_id))
        books: dict[int, dict] = {}
        for b, u in (await db.execute(q)).all():
            books.setdefault(b.id, {"id": b.id, "name": b.name, "units": []})["units"].append(
                {"id": u.id, "name": u.name})
        return list(books.values())
    if kind == KIND_PHONETIC_VIDEO:
        q = select(PhoneticVideo).where(PhoneticVideo.is_active.is_(True)) \
            .execution_options(skip_tenant_filter=True) \
            .order_by(PhoneticVideo.lecturer, PhoneticVideo.category, PhoneticVideo.sort_order, PhoneticVideo.id)
        if org_id is not None:
            q = q.where(or_(PhoneticVideo.org_id.is_(None), PhoneticVideo.org_id == org_id))
        groups: dict[str, dict] = {}
        for v in (await db.execute(q)).scalars():
            name = (v.lecturer or "").strip() or "全校通用"
            groups.setdefault(name, {"id": name, "name": name, "units": []})["units"].append(
                {"id": v.id, "name": v.title})
        return list(groups.values())
    if kind == KIND_READ_ALOUD:
        # 单词书 → 单元;只列有能跟读例句的单元(一句都没有的布置了永远完成不了)
        q = select(WordBook, Unit).join(Unit, Unit.book_id == WordBook.id) \
            .execution_options(skip_tenant_filter=True) \
            .order_by(WordBook.id, Unit.unit_number)
        if org_id is not None:
            q = q.where(or_(and_(WordBook.org_id.is_(None), WordBook.is_public.is_(True)),
                            WordBook.org_id == org_id))
        pairs = (await db.execute(q)).all()
        counts = await ra.eligible_sentences(db, [u.id for _, u in pairs])
        books: dict[int, dict] = {}
        for b, u in pairs:
            n = len(counts.get(u.id, []))
            if n == 0:
                continue
            books.setdefault(b.id, {"id": b.id, "name": b.name, "units": []})["units"].append(
                {"id": u.id, "name": f"{u.name}({n} 句)"})
        return list(books.values())
    raise HTTPException(400, "作业类型不对")


# ---------- 学生端 ----------

@student_router.get("/content-homework")
async def my_content_homework(
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    links = [(s, h) for s, h in (await db.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomeworkStudent.student_id == student.id, ContentHomework.is_closed.is_(False))
        # 只给近 30 天开放的(以及未来的): 半年前的旧作业堆在列表里只是噪音
        .where(ContentHomework.available_from >= datetime.utcnow() - timedelta(days=30))
        .order_by(ContentHomework.available_from.desc(), ContentHomework.id.desc())
    )).all()]
    if await _refresh_completion(db, links):
        await db.commit()
    names = await _target_names(db, [h for _, h in links])
    teacher_ids = {h.teacher_id for _, h in links}
    teachers = {u.id: (u.full_name or u.username) for u in (await db.execute(
        select(User).where(User.id.in_(teacher_ids)))).scalars()} if teacher_ids else {}
    book_of: dict[int, int] = {}
    sids = [h.target_id for _, h in links if h.kind == KIND_SENTENCE]
    if sids:
        book_of = dict((await db.execute(
            select(SentenceUnit.id, SentenceUnit.book_id).where(SentenceUnit.id.in_(sids))
            .execution_options(skip_tenant_filter=True))).all())
    now = datetime.utcnow()
    out = []
    for s, h in links:
        name = names.get((h.kind, h.target_id))
        if name is None:
            continue    # 内容被删了: 学生端不显示(点进去也只会 404)
        # 跳转目标: 句子直接进单元学习页;视频进音标页,前端用 navigate state 的 openVideoId 直接打开那一节
        # (兑换单节码跳回来用的就是这条路,见 PhoneticsHub)
        if h.kind == KIND_SENTENCE:
            route = f"/student/sentences/{book_of.get(h.target_id, 0)}/{h.target_id}/learn"
        elif h.kind == KIND_DAILY_REVIEW:
            route = "/student/memory-curve"
        elif h.kind == KIND_READ_ALOUD:
            route = f"/student/units/{h.target_id}/read-aloud"
        else:
            route = "/student/phonetics"
        out.append({
            "id": s.id, "homework_id": h.id, "kind": h.kind, "kind_label": KIND_LABEL[h.kind],
            "title": h.title, "description": h.description, "target_name": name,
            "status": _status(s, h, now), "route": route, "target_id": h.target_id,
            "available_from": (h.available_from + timedelta(hours=8)).isoformat(),
            "deadline": (h.deadline + timedelta(hours=8)).isoformat() if h.deadline else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "teacher_name": teachers.get(h.teacher_id, ""),
        })
    return out
