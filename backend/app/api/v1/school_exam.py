"""学校考试 · 丢分分析(2026-11-26)。规则见 services/school_exam.py 文件头。

路由挂在 api/v1/content_homework.py 已有的 teacher_router / student_router 上(main.py 生产有 drift,不动它)。
和试卷库同一个开放范围(paper_bank 设置: 试用期只开直营)。

老师(只能看自己的班):
    GET    /teacher/school-exams/meta                       能不能用、我的班、可选的卷子(试卷库里拆好的)、默认大题
    GET    /teacher/school-exams                            建过的考试(?class_id= 只看一个班)
    POST   /teacher/school-exams                            建一次考试
    GET    /teacher/school-exams/{id}                       考试 + 全班汇总
    PATCH  /teacher/school-exams/{id}                       改名字 / 日期 / 卷子 / 大题 / 孩子能不能自己传
    DELETE /teacher/school-exams/{id}                       删掉(软删)
    PUT    /teacher/school-exams/{id}/scores                录分 {rows: [{student_id, total, sections: {大题: 分}}]}
    GET    /teacher/school-exams/{id}/students/{sid}        一个孩子的「这次考试丢分在哪」+ 读出来的每道题
    POST   /teacher/school-exams/{id}/students/{sid}/sheets 替孩子传卷子照片(files)
    PUT    /teacher/school-exams/{id}/students/{sid}/items/{item_id}   确认 / 改判一道题 {correct}
学生:
    GET    /student/school-exams                            我班上的考试 + 我传了没有
    GET    /student/school-exams/{id}                       我的「这次考试丢分在哪」
    POST   /student/school-exams/{id}/sheets                传我批改过的卷子照片(files)
"""
from __future__ import annotations

import asyncio
from datetime import date
from typing import Dict, List, Optional, Union

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student, get_current_teacher
from app.core.actor import acting_user
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.core.timeutil import utc_now
from app.models.paper_bank import PaperDoc, PaperItem
from app.models.school_exam import SchoolExam
from app.models.user import Class, ClassStudent, User
from app.services import audit_log
from app.services import homework_check as hc
from app.services import paper_bank as pb
from app.services import school_exam as se

teacher_router = APIRouter()
student_router = APIRouter()

MAX_PHOTO_BYTES = 10 * 1024 * 1024


# ---------------------------------------------------------------- 公共

async def _ok(db: AsyncSession, user: User) -> None:
    ok, reason, _s = await pb.availability(db, user)
    if not ok:
        raise HTTPException(403, reason)


async def _my_class(db: AsyncSession, teacher: User, class_id: int) -> tuple[Class, list[User]]:
    c = (await db.execute(select(Class).where(Class.id == class_id, Class.teacher_id == teacher.id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "没有这个班,或者不是你的班")
    rows = list((await db.execute(select(User).join(ClassStudent, ClassStudent.student_id == User.id)
                                  .where(ClassStudent.class_id == c.id, ClassStudent.is_active.is_(True),
                                         User.role == "student", User.is_active.is_(True))
                                  .order_by(User.id))).scalars())
    return c, rows


async def _my_exam(db: AsyncSession, teacher: User, exam_id: int) -> tuple[SchoolExam, Class, list[User]]:
    e = await db.get(SchoolExam, exam_id)
    if e is None or e.deleted_at is not None:
        raise HTTPException(404, "没有这次考试")
    c, students = await _my_class(db, teacher, e.class_id)
    return e, c, students


async def _doc_for(db: AsyncSession, teacher: User, doc_id: Optional[int]) -> Optional[PaperDoc]:
    if not doc_id:
        return None
    q = select(PaperDoc).where(PaperDoc.id == doc_id, PaperDoc.status != "deleted")
    if teacher.role != "admin":
        q = q.where(PaperDoc.org_id == teacher.org_id)
    d = (await db.execute(q)).scalar_one_or_none()
    if d is None:
        raise HTTPException(400, "这份卷子在试卷库里找不到了")
    return d


async def _read_photos(files: List[UploadFile]) -> list[str]:
    if not files:
        raise HTTPException(400, "先拍一张卷子")
    if len(files) > se.MAX_PAGES:
        raise HTTPException(400, f"一次最多传 {se.MAX_PAGES} 页")
    out = []
    for f in files:
        raw = await f.read(MAX_PHOTO_BYTES + 1)
        if len(raw) > MAX_PHOTO_BYTES:
            raise HTTPException(400, "有一张照片太大了(最多 10MB)")
        try:
            b64, _mime = await asyncio.to_thread(hc.prepare_image, raw)
        except ValueError:
            raise HTTPException(400, "有一张照片太小了,离近一点、整页拍清楚")
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "有一张不是照片(只能传 jpg / png),换一张再传")
        out.append(b64)
    return out


# ---------------------------------------------------------------- 老师

@teacher_router.get("/school-exams/meta")
async def meta(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    ok, reason, _s = await pb.availability(db, teacher)
    classes = list((await db.execute(select(Class).where(Class.teacher_id == teacher.id).order_by(Class.id))).scalars())
    docs = []
    if ok:
        q = select(PaperDoc).where(PaperDoc.status != "deleted")
        if teacher.role != "admin":
            q = q.where(PaperDoc.org_id == teacher.org_id)
        rows = list((await db.execute(q.order_by(PaperDoc.id.desc()).limit(100))).scalars())
        titles: Dict[int, Dict[str, int]] = {}
        if rows:
            for did, t, n in (await db.execute(select(PaperItem.doc_id, PaperItem.paper_title, func.count())
                                               .where(PaperItem.doc_id.in_([d.id for d in rows]),
                                                      PaperItem.status != "rejected")
                                               .group_by(PaperItem.doc_id, PaperItem.paper_title))).all():
                titles.setdefault(did, {})[t or ""] = int(n)
        docs = [{"id": d.id, "title": d.title, "grade": d.grade, "status": d.status,
                 "papers": [{"title": t, "items": n} for t, n in (titles.get(d.id) or {}).items()]} for d in rows]
    return {"enabled": ok, "reason": reason, "classes": [{"id": c.id, "name": c.name} for c in classes],
            "docs": docs, "default_sections": se.DEFAULT_SECTIONS, "max_pages": se.MAX_PAGES,
            "max_sheets": se.MAX_SHEETS}


@teacher_router.get("/school-exams")
async def list_exams(class_id: Optional[int] = None, db: AsyncSession = Depends(get_db),
                     teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    mine = [c.id for c in (await db.execute(select(Class).where(Class.teacher_id == teacher.id))).scalars()]
    if class_id is not None:
        mine = [c for c in mine if c == class_id]
    if not mine:
        return {"items": []}
    rows = list((await db.execute(select(SchoolExam).where(SchoolExam.class_id.in_(mine), SchoolExam.deleted_at.is_(None))
                                  .order_by(SchoolExam.exam_date.desc(), SchoolExam.id.desc()).limit(200))).scalars())
    names = {c.id: c.name for c in (await db.execute(select(Class).where(Class.id.in_(mine)))).scalars()}
    return {"items": [{**se.exam_out(e), "class_name": names.get(e.class_id)} for e in rows]}


class ExamIn(BaseModel):
    class_id: int
    name: str = Field(..., max_length=60)
    exam_date: Optional[date] = None
    doc_id: Optional[int] = None
    paper_title: Optional[str] = Field(None, max_length=120)
    sections: Optional[List[dict]] = Field(None, max_length=20)
    full_score: Optional[float] = Field(None, ge=0, le=1000)
    open_upload: bool = True


def _check_name(name: str) -> str:
    n = " ".join((name or "").split())[:60]
    if not n:
        raise HTTPException(400, "给这次考试起个名字,比如「七上期中考试」")
    return n


@teacher_router.post("/school-exams")
async def create_exam(body: ExamIn, request: Request, db: AsyncSession = Depends(get_db),
                      teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    c, _students = await _my_class(db, teacher, body.class_id)
    doc = await _doc_for(db, teacher, body.doc_id)
    sections = se.clean_sections(body.sections if body.sections is not None else se.DEFAULT_SECTIONS)
    if not sections:
        raise HTTPException(400, "至少写一道大题(比如「单项选择」)")
    actor = acting_user(teacher)
    e = SchoolExam(org_id=c.org_id, class_id=c.id, teacher_id=teacher.id, name=_check_name(body.name),
                   exam_date=body.exam_date, doc_id=doc.id if doc else None,
                   paper_title=(body.paper_title or None) if doc else None, sections=sections,
                   full_score=body.full_score or None, open_upload=body.open_upload, created_by=actor.id,
                   created_by_name=(actor.full_name or actor.username or "")[:100] or None)
    db.add(e)
    await db.flush()
    audit_log.record(db, request, teacher, "school_exam.create", f"建考试「{e.name}」({c.name})",
                     target_type="school_exam", target_id=e.id)
    await db.commit()
    return se.exam_out(e, doc)


@teacher_router.get("/school-exams/{exam_id}")
async def get_exam(exam_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, c, students = await _my_exam(db, teacher, exam_id)
    await se.expire_stale(db, e.id)
    doc = await db.get(PaperDoc, e.doc_id) if e.doc_id else None
    report = await se.class_report(db, e, students)
    return {"exam": {**se.exam_out(e, doc, report["items_total"]), "class_name": c.name}, **report}


class ExamPatch(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    exam_date: Optional[date] = None
    doc_id: Optional[int] = None
    paper_title: Optional[str] = Field(None, max_length=120)
    sections: Optional[List[dict]] = Field(None, max_length=20)
    full_score: Optional[float] = Field(None, ge=0, le=1000)
    open_upload: Optional[bool] = None


@teacher_router.patch("/school-exams/{exam_id}")
async def patch_exam(exam_id: int, body: ExamPatch, db: AsyncSession = Depends(get_db),
                     teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, _c, _s = await _my_exam(db, teacher, exam_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        e.name = _check_name(data["name"] or "")
    if "exam_date" in data:
        e.exam_date = data["exam_date"]
    if "doc_id" in data:
        doc = await _doc_for(db, teacher, data["doc_id"])
        e.doc_id = doc.id if doc else None
        if doc is None:
            e.paper_title = None
    if "paper_title" in data:
        e.paper_title = (data["paper_title"] or None) if e.doc_id else None
    if "sections" in data:
        secs = se.clean_sections(data["sections"])
        if not secs:
            raise HTTPException(400, "至少写一道大题")
        e.sections = secs
    if "full_score" in data:
        e.full_score = data["full_score"] or None
    if "open_upload" in data and data["open_upload"] is not None:
        e.open_upload = bool(data["open_upload"])
    await db.commit()
    doc = await db.get(PaperDoc, e.doc_id) if e.doc_id else None
    return se.exam_out(e, doc)


@teacher_router.delete("/school-exams/{exam_id}")
async def delete_exam(exam_id: int, request: Request, db: AsyncSession = Depends(get_db),
                      teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, c, _s = await _my_exam(db, teacher, exam_id)
    e.deleted_at = utc_now()
    audit_log.record(db, request, teacher, "school_exam.delete", f"删考试「{e.name}」({c.name})",
                     target_type="school_exam", target_id=e.id)
    await db.commit()
    return {"ok": True}


class ScoreRow(BaseModel):
    student_id: int
    total: Optional[Union[float, str]] = None
    sections: Dict[str, Optional[Union[float, str]]] = Field(default_factory=dict)


class ScoresIn(BaseModel):
    rows: List[ScoreRow] = Field(..., max_length=300)


@teacher_router.put("/school-exams/{exam_id}/scores")
async def put_scores(exam_id: int, body: ScoresIn, request: Request, db: AsyncSession = Depends(get_db),
                     teacher: User = Depends(get_current_teacher)):
    """录分: 每一行就是这个孩子这次的分(空着 = 清掉这一项)。老师录的照片不会覆盖"""
    await _ok(db, teacher)
    e, _c, students = await _my_exam(db, teacher, exam_id)
    ids = {s.id for s in students}
    if any(r.student_id not in ids for r in body.rows):
        raise HTTPException(403, "有的孩子不在这个班")
    n = 0
    for r in body.rows:
        row = await se.score_row(db, e.id, r.student_id)
        if se.set_scores(e, row, r.total, dict(r.sections), "teacher"):
            n += 1
    audit_log.record(db, request, teacher, "school_exam.scores", f"「{e.name}」录分,改了 {n} 个孩子",
                     target_type="school_exam", target_id=e.id)
    await db.commit()
    return {"changed": n}


@teacher_router.get("/school-exams/{exam_id}/students/{student_id}")
async def student_detail(exam_id: int, student_id: int, db: AsyncSession = Depends(get_db),
                         teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, _c, students = await _my_exam(db, teacher, exam_id)
    st = next((s for s in students if s.id == student_id), None)
    if st is None:
        raise HTTPException(404, "这个孩子不在这个班")
    await se.expire_stale(db, e.id)
    return {"student": {"id": st.id, "name": st.full_name or st.username},
            **(await se.student_report(db, e, st.id, teacher=True))}


@teacher_router.post("/school-exams/{exam_id}/students/{student_id}/sheets")
async def teacher_upload(exam_id: int, student_id: int, files: List[UploadFile] = File(...),
                         db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, _c, students = await _my_exam(db, teacher, exam_id)
    st = next((s for s in students if s.id == student_id), None)
    if st is None:
        raise HTTPException(404, "这个孩子不在这个班")
    actor = acting_user(teacher)
    await check_rate(str(actor.id), "school_sheet", [(3600, 120)])
    images = await _read_photos(files)
    try:
        sid = await se.start_sheet(db, e, st, actor, images)
    except se.Rule as err:
        raise HTTPException(409, str(err))
    return {"sheet_id": sid}


class ResolveIn(BaseModel):
    correct: bool


@teacher_router.put("/school-exams/{exam_id}/students/{student_id}/items/{item_id}")
async def resolve_item(exam_id: int, student_id: int, item_id: int, body: ResolveIn,
                       db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _ok(db, teacher)
    e, _c, students = await _my_exam(db, teacher, exam_id)
    if student_id not in {s.id for s in students}:
        raise HTTPException(404, "这个孩子不在这个班")
    try:
        return await se.resolve(db, e, student_id, item_id, body.correct)
    except se.Rule as err:
        raise HTTPException(404, str(err))


# ---------------------------------------------------------------- 学生

async def _student_exams(db: AsyncSession, student: User) -> list[SchoolExam]:
    cls = [c for (c,) in (await db.execute(select(ClassStudent.class_id).where(
        ClassStudent.student_id == student.id, ClassStudent.is_active.is_(True)))).all()]
    if not cls:
        return []
    return list((await db.execute(select(SchoolExam).where(
        SchoolExam.class_id.in_(cls), SchoolExam.deleted_at.is_(None), SchoolExam.org_id == student.org_id)
        .order_by(SchoolExam.exam_date.desc(), SchoolExam.id.desc()).limit(30))).scalars())


async def _student_exam(db: AsyncSession, student: User, exam_id: int) -> SchoolExam:
    e = next((x for x in await _student_exams(db, student) if x.id == exam_id), None)
    if e is None:
        raise HTTPException(404, "没有这次考试")
    return e


@student_router.get("/school-exams")
async def my_exams(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    ok, reason, _s = await pb.availability(db, student)
    if not ok:
        return {"enabled": False, "reason": reason, "items": []}
    out = []
    for e in await _student_exams(db, student):
        sheet = await se.latest_sheet(db, e.id, student.id)
        out.append({**se.exam_out(e), "sheet": se.sheet_out(sheet), "can_upload": bool(e.open_upload and e.doc_id)})
    return {"enabled": True, "reason": "", "items": out, "max_pages": se.MAX_PAGES}


@student_router.get("/school-exams/{exam_id}")
async def my_report(exam_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    await _ok(db, student)
    e = await _student_exam(db, student, exam_id)
    await se.expire_stale(db, e.id)
    rep = await se.student_report(db, e, student.id, teacher=False)
    return {**rep, "can_upload": bool(e.open_upload and e.doc_id), "max_pages": se.MAX_PAGES}


@student_router.post("/school-exams/{exam_id}/sheets")
async def student_upload(exam_id: int, files: List[UploadFile] = File(...), db: AsyncSession = Depends(get_db),
                         student: User = Depends(get_current_student)):
    await _ok(db, student)
    e = await _student_exam(db, student, exam_id)
    if not e.open_upload:
        raise HTTPException(409, "这次考试老师说由老师来传卷子")
    await check_rate(str(student.id), "school_sheet", [(3600, 10)])
    images = await _read_photos(files)
    try:
        sid = await se.start_sheet(db, e, student, student, images)
    except se.Rule as err:
        raise HTTPException(409, str(err))
    return {"sheet_id": sid}
