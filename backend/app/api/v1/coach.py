"""陪跑(2026-10-21)—— 老师每天看谁没来、谁没做完,复制提醒发家长,给每个孩子留一句话

口径真源 services/coach.py。三端:
- 老师 /teacher/coach/*: 看板(本班学生)、写/改/删今天的点评、批量发草稿
- 学生 /student/coach-note: 首页「老师的话」,看了记已读
- 家长 /parent/children/{id}/coach-notes: 最近两周的点评,看了记已读

范围: 老师只看自己班里 active 的学生(助教请求在认证层已换成主老师,天然同一批学生);
写的人记真实账号(助教写的落款是助教)。点评不进操作记录 —— 一天几十条会淹掉追责日志。
"""
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_parent, get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import get_my_class_student_ids
from app.core.actor import acting_user
from app.core.database import get_db
from app.core.timeutil import local_today
from app.models.coach import CoachNote
from app.models.user import Class, ClassStudent, ParentStudentLink, User
from app.services import coach as svc

teacher_router = APIRouter()
student_router = APIRouter()
parent_router = APIRouter()


async def _my_students(db: AsyncSession, teacher: User) -> tuple[list[User], dict[int, str]]:
    sids = await get_my_class_student_ids(db, teacher.id)
    if not sids:
        return [], {}
    students = list((await db.execute(select(User).where(User.id.in_(sids), User.is_active.is_(True)))).scalars())
    class_of: dict[int, str] = {}
    for sid, cname in (await db.execute(
        select(ClassStudent.student_id, Class.name)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher.id, ClassStudent.is_active.is_(True), ClassStudent.student_id.in_(sids))
        .order_by(Class.id)
    )).all():
        class_of.setdefault(sid, cname)
    return students, class_of


@teacher_router.get("/coach/board")
async def coach_board(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    today = local_today()
    students, class_of = await _my_students(db, current_user)
    items = await svc.board(db, students, class_of, today)
    counts = {k: 0 for k in svc.STATUS_ORDER}
    for it in items:
        counts[it["status"]] += 1
    return {
        "date": today.isoformat(),
        "items": items,
        "counts": counts,
        "struggling": sum(1 for it in items if it["struggling"]),
        "noted": sum(1 for it in items if it["note"]),
        "absent_days": svc.ABSENT_DAYS,
    }


class NoteIn(BaseModel):
    content: str = Field(..., max_length=svc.NOTE_MAX_LEN)


class BatchNoteItem(BaseModel):
    student_id: int
    content: str = Field(..., max_length=svc.NOTE_MAX_LEN)


class BatchNoteIn(BaseModel):
    items: List[BatchNoteItem] = Field(..., min_length=1, max_length=300)


async def _upsert(db: AsyncSession, teacher: User, student_id: int, content: str) -> CoachNote:
    today = local_today()
    author = acting_user(teacher)
    note = (await db.execute(
        select(CoachNote).where(CoachNote.student_id == student_id, CoachNote.note_date == today)
    )).scalar_one_or_none()
    if note is None:
        note = CoachNote(student_id=student_id, note_date=today, teacher_id=teacher.id,
                         org_id=teacher.org_id, content=content)
        db.add(note)
    elif note.content != content:
        note.content = content
        # 改了就要重新让孩子/家长看到
        note.read_by_student_at = None
        note.read_by_parent_at = None
    note.teacher_id = teacher.id
    note.author_id = author.id
    note.author_name = (author.full_name or author.username or "")[:100] or None
    return note


def _clean(content: str) -> str:
    text = (content or "").strip()
    if not text:
        raise HTTPException(400, "点评不能是空的;不想写就点「删除」")
    return text


@teacher_router.put("/coach/notes/{student_id}")
async def save_coach_note(
    student_id: int,
    body: NoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    text = _clean(body.content)
    if student_id not in await get_my_class_student_ids(db, current_user.id):
        raise HTTPException(403, "无权操作该学生")
    note = await _upsert(db, current_user, student_id, text)
    await db.commit()
    return {"content": note.content, "author_name": note.author_name or ""}


@teacher_router.post("/coach/notes/batch")
async def save_coach_notes_batch(
    body: BatchNoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """一次发多条(老师在看板上勾选、确认过草稿后一起发)。有一个不是本班的就整批拒"""
    mine = await get_my_class_student_ids(db, current_user.id)
    seen: dict[int, str] = {}
    for it in body.items:
        if it.student_id not in mine:
            raise HTTPException(403, "只能给自己班里的学生写点评")
        seen[it.student_id] = _clean(it.content)
    for sid, text in seen.items():
        await _upsert(db, current_user, sid, text)
    await db.commit()
    return {"saved": len(seen)}


@teacher_router.delete("/coach/notes/{student_id}")
async def delete_coach_note(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    if student_id not in await get_my_class_student_ids(db, current_user.id):
        raise HTTPException(403, "无权操作该学生")
    note = (await db.execute(
        select(CoachNote).where(CoachNote.student_id == student_id, CoachNote.note_date == local_today())
    )).scalar_one_or_none()
    if note is not None:
        await db.delete(note)
        await db.commit()
    return {"ok": True}


def _out(n: CoachNote) -> dict:
    return {"date": n.note_date.isoformat(), "content": n.content, "author_name": n.author_name or "老师"}


@student_router.get("/coach-note")
async def my_coach_note(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """首页「老师的话」: 最近 3 天里最新的一条。看了就记已读(老师看板上能看到孩子看没看)"""
    today = local_today()
    note = (await db.execute(
        select(CoachNote).where(CoachNote.student_id == current_user.id,
                                CoachNote.note_date > today - timedelta(days=3))
        .order_by(CoachNote.note_date.desc()).limit(1)
    )).scalar_one_or_none()
    if note is None:
        return {"note": None}
    out = {**_out(note), "is_today": note.note_date == today}
    if note.read_by_student_at is None:
        note.read_by_student_at = datetime.utcnow()
        await db.commit()
    return {"note": out}


@parent_router.get("/parent/children/{student_id}/coach-notes")
async def parent_coach_notes(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    linked = (await db.execute(
        select(ParentStudentLink.id).where(and_(
            ParentStudentLink.parent_id == current_parent.id,
            ParentStudentLink.student_id == student_id,
        )).limit(1)
    )).scalar_one_or_none()
    if linked is None:
        raise HTTPException(403, "无权查看该孩子的数据")
    notes = list((await db.execute(
        select(CoachNote).where(CoachNote.student_id == student_id,
                                CoachNote.note_date > local_today() - timedelta(days=14))
        .order_by(CoachNote.note_date.desc())
    )).scalars())
    unread = [n for n in notes if n.read_by_parent_at is None]
    if unread:
        now = datetime.utcnow()
        for n in unread:
            n.read_by_parent_at = now
        await db.commit()
    return {"items": [_out(n) for n in notes]}
