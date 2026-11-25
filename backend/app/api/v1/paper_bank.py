"""试卷库 + 专项小卷(2026-11-22)。规则见 services/paper_bank.py(组卷、判分、把握度)和 services/paper_parse.py(拆卷)。

路由挂在 api/v1/content_homework.py 已有的 teacher_router / student_router 上(main.py 生产有 drift,不动它):

老师(本机构的卷子和题;试用期只开直营,见 paper_bank 设置):
    GET    /teacher/paper-bank/status                  能不能用、拆卷 AI 配没配、是不是平台管理员
    GET    /teacher/paper-bank/docs                    传过的卷子
    POST   /teacher/paper-bank/docs                    传一份(file + title + grade + note),后台拆
    GET    /teacher/paper-bank/docs/{id}               一份卷子 + 拆出来的题(带答案,核对用)
    PATCH  /teacher/paper-bank/docs/{id}               改名字 / 年级
    POST   /teacher/paper-bank/docs/{id}/retry         接着拆(只拆没拆出来的页)
    POST   /teacher/paper-bank/docs/{id}/approve-clean 没标黄的题一起通过
    DELETE /teacher/paper-bank/docs/{id}               删掉(题不再出给孩子;做过的记录留着)
    GET    /teacher/paper-bank/docs/{id}/pages/{p}/tiles/{t}   切好的小图
    GET    /teacher/paper-bank/items/{id}/image        这道题的原题图
    PUT    /teacher/paper-bank/items/{id}              改一道题 / 通过 / 不要
    GET    /teacher/paper-bank/kps                     知识点表 + 题库里每个点有几道题
    GET    /teacher/paper-bank/classes                 我的班
    GET    /teacher/paper-bank/class/{class_id}        全班每个知识点怎么样、每个孩子最该补的点
    POST   /teacher/paper-bank/print                   打印全班今天的小卷(没打开过的孩子当场给他挑一份)
平台管理员:
    GET/PUT /teacher/paper-bank/admin                  开放范围、每天能拆几页、小卷几题、拆卷用的 Key 和模型
    POST    /teacher/paper-bank/admin/test             试一下拆卷 AI 通不通
学生:
    GET  /student/paper-quiz/status                    能不能用、今天的小卷做到哪了
    POST /student/paper-quiz/today                     今天的小卷(没有就挑一份)
    GET  /student/paper-quiz/{id}                      一份小卷(做过的题带结果)
    POST /student/paper-quiz/{id}/answer               交一题 {item_id, answer, ms}(只认第一次)
    GET  /student/paper-quiz/{id}/summary              做完看今天练了哪些点
    GET  /student/paper-quiz/items/{id}/image          要看图的题的原题图(只给自己小卷里的题)
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import timedelta
from typing import Any, List, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_admin, get_current_student, get_current_teacher
from app.core.actor import acting_user
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.core.timeutil import local_today, utc_now
from app.models.paper_bank import PaperDoc, PaperItem, PaperPage, PaperQuiz
from app.models.system_config import AIProvider
from app.models.user import Class, ClassStudent, User
from app.services import audit_log
from app.services import paper_bank as pb
from app.services import paper_kp as kpm
from app.services import paper_parse as pp
from app.services import paper_tiles as ptl

teacher_router = APIRouter()
student_router = APIRouter()

MAX_BYTES = 80 * 1024 * 1024
NO_AI = "拆卷用的 AI 还没配好(小鹰老师的 Key 没填或停用了),请平台管理员在管理端首页「AI 学习助手」里看一下"
IMG_HEADERS = {"Cache-Control": "private, max-age=3600"}


# ---------------------------------------------------------------- 老师: 公共

async def _teacher_ok(db: AsyncSession, teacher: User) -> dict:
    ok, reason, s = await pb.availability(db, teacher)
    if not ok:
        raise HTTPException(403, reason)
    return s


def _scope(q, model, teacher: User):
    """只看本机构的(平台管理员看全部)。显式写,不押在隐式租户过滤上"""
    if teacher.role == "admin":
        return q
    return q.where(model.org_id == teacher.org_id)


async def _own_doc(db: AsyncSession, teacher: User, doc_id: int) -> PaperDoc:
    d = (await db.execute(_scope(select(PaperDoc).where(PaperDoc.id == doc_id), PaperDoc, teacher))).scalar_one_or_none()
    if d is None or d.status == "deleted":
        raise HTTPException(404, "没有这份卷子")
    return d


async def _own_item(db: AsyncSession, teacher: User, item_id: int) -> PaperItem:
    it = (await db.execute(_scope(select(PaperItem).where(PaperItem.id == item_id), PaperItem, teacher))).scalar_one_or_none()
    if it is None:
        raise HTTPException(404, "没有这道题")
    return it


@teacher_router.get("/paper-bank/status")
async def bank_status(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    ok, reason, s = await pb.availability(db, teacher)
    return {"enabled": ok, "reason": reason, "configured": (await pp.relay_conf(db)) is not None,
            "is_admin": teacher.role == "admin", "grades": list(pb.GRADES), "max_pages": ptl.MAX_PAGES,
            "max_mb": MAX_BYTES // (1024 * 1024), "quiz_size": s["quiz_size"]}


# ---------------------------------------------------------------- 老师: 卷子

@teacher_router.get("/paper-bank/docs")
async def list_docs(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    docs = list((await db.execute(_scope(select(PaperDoc).where(PaperDoc.status != "deleted"), PaperDoc, teacher)
                                  .order_by(PaperDoc.id.desc()).limit(200))).scalars())
    if await pp.expire_stale(db, docs):
        await db.commit()
    counts = await pb.doc_counts(db, [d.id for d in docs])
    return {"items": [pb.doc_out(d, counts.get(d.id)) for d in docs]}


async def _pages_today(db: AsyncSession, uploader: Optional[int]) -> int:
    """今天(北京日)传了多少页。时间在 Python 里比(SQLite 日期是字符串比较,微秒格式不一样会比错)"""
    from app.core.timeutil import local_day_utc_range
    start, end = local_day_utc_range(local_today())
    q = select(PaperDoc.created_at, PaperDoc.pages).where(PaperDoc.created_at >= start - timedelta(days=1))
    if uploader is not None:
        q = q.where(PaperDoc.uploaded_by == uploader)
    return sum(int(n or 0) for at, n in (await db.execute(q)).all() if at is not None and start <= at < end)


@teacher_router.post("/paper-bank/docs")
async def upload_doc(request: Request, file: UploadFile = File(...), title: str = Form(""), grade: str = Form(""),
                     note: str = Form(""), db: AsyncSession = Depends(get_db),
                     teacher: User = Depends(get_current_teacher)):
    s = await _teacher_ok(db, teacher)
    actor = acting_user(teacher)
    if await pp.relay_conf(db) is None:
        raise HTTPException(409, NO_AI)
    g = pb.norm_grade(grade)
    if g is None:
        raise HTTPException(400, "先选一下这份卷子是几年级的(孩子只会做到不高于自己年级的题)")
    kind = ptl.kind_of(file.filename or "", file.content_type or "")
    if kind == "doc":
        raise HTTPException(400, "老版 Word(.doc)读不了。在 Word 里点「文件 → 另存为」,选 .docx 或 PDF 再传")
    if kind is None:
        raise HTTPException(400, "只能传 PDF、照片(jpg / png)或 Word(.docx)")
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(400, f"文件太大了(最多 {MAX_BYTES // 1024 // 1024}MB),拆成几份再传")
    await check_rate(str(actor.id), "paper_upload", [(3600, 20)])
    try:
        if kind == "pdf":
            pages = await asyncio.to_thread(ptl.pdf_page_count, raw)
        elif kind == "docx":
            pages = len(await asyncio.to_thread(ptl.read_docx, raw, file.filename or ""))
        else:
            await asyncio.to_thread(ptl.read_image, raw)
            pages = 1
    except ptl.FileError as e:
        raise HTTPException(400, str(e))
    if pages > ptl.MAX_PAGES:
        raise HTTPException(400, f"一次最多传 {ptl.MAX_PAGES} 页,这份有 {pages} 页,拆成几份再传")
    digest = pp.sha1(raw)
    dup = (await db.execute(select(PaperDoc.id, PaperDoc.title).where(
        PaperDoc.file_sha1 == digest, PaperDoc.status != "deleted",
        PaperDoc.org_id.is_(None) if teacher.org_id is None else PaperDoc.org_id == teacher.org_id))).first()
    if dup is not None:
        raise HTTPException(409, {"code": "duplicate", "doc_id": dup[0],
                                  "message": f"这份文件已经传过了(「{dup[1]}」),不用再拆一次"})
    if await _pages_today(db, actor.id) + pages > s["daily_pages"]:
        raise HTTPException(429, f"每位老师每天最多拆 {s['daily_pages']} 页,今天的用完了,明天再传")
    if await _pages_today(db, None) + pages > s["daily_pages_all"]:
        raise HTTPException(429, "今天全平台拆卷的量用完了,明天再传(防止拆卷的 AI 费用失控)")
    name = os.path.basename(file.filename or "")[:120] or f"卷子.{kind}"
    doc = PaperDoc(org_id=teacher.org_id, title=(title.strip() or os.path.splitext(name)[0])[:120], grade=g,
                   note=note.strip()[:200] or None, file_name=name, file_kind=kind, file_sha1=digest, pages=pages,
                   status="queued", uploaded_by=actor.id,
                   uploaded_by_name=(actor.full_name or actor.username or "")[:100] or None)
    db.add(doc)
    await db.flush()
    await asyncio.to_thread(pp.save_source, doc.id, kind, raw)
    audit_log.record(db, request, teacher, "paper.upload", f"传卷子「{doc.title}」({g},{pages} 页)",
                     target_type="paper_doc", target_id=doc.id, detail={"file": name, "pages": pages})
    await db.commit()
    doc_id = doc.id
    await pp.run_later(pp.parse_job, doc_id)
    return {"id": doc_id}


@teacher_router.get("/paper-bank/docs/{doc_id}")
async def get_doc(doc_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    if await pp.expire_stale(db, [d]):
        await db.commit()
    items = list((await db.execute(select(PaperItem).where(PaperItem.doc_id == d.id)
                                   .order_by(PaperItem.seq, PaperItem.id))).scalars())
    pages = list((await db.execute(select(PaperPage).where(PaperPage.doc_id == d.id).order_by(PaperPage.page_no))).scalars())
    counts = await pb.doc_counts(db, [d.id])
    return {**pb.doc_out(d, counts.get(d.id)), "items": [pb.teacher_item(i) for i in items],
            "page_list": [{"page_no": p.page_no, "status": p.status, "tiles": len(p.tiles or []),
                           "text": bool(p.text)} for p in pages]}


class DocPatch(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    grade: Optional[str] = None


@teacher_router.patch("/paper-bank/docs/{doc_id}")
async def patch_doc(doc_id: int, body: DocPatch, db: AsyncSession = Depends(get_db),
                    teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    data = body.model_dump(exclude_unset=True)
    if "title" in data:
        t = (data["title"] or "").strip()
        if not t:
            raise HTTPException(400, "名字不能空着")
        d.title = t[:120]
    if "grade" in data:
        g = pb.norm_grade(data["grade"])
        if g is None:
            raise HTTPException(400, "年级不对")
        d.grade = g
        await db.execute(update(PaperItem).where(PaperItem.doc_id == d.id).values(grade=g)
                         .execution_options(synchronize_session=False))
    await db.commit()
    return pb.doc_out(d, (await pb.doc_counts(db, [d.id])).get(d.id))


class PaperRename(BaseModel):
    old: str = Field(..., max_length=200)
    new: str = Field(..., max_length=200)


@teacher_router.post("/paper-bank/docs/{doc_id}/rename-paper")
async def rename_paper(doc_id: int, body: PaperRename, db: AsyncSession = Depends(get_db),
                       teacher: User = Depends(get_current_teacher)):
    """把这份文件里一套卷的卷名整套改掉(模型没认出卷名时叫「第 N 页开始的一套卷」)"""
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    new = " ".join((body.new or "").split())[:120]
    if not new:
        raise HTTPException(400, "卷名不能空着")
    r = await db.execute(update(PaperItem).where(PaperItem.doc_id == d.id, PaperItem.paper_title == body.old)
                         .values(paper_title=new).execution_options(synchronize_session=False))
    if not r.rowcount:
        raise HTTPException(404, "这份文件里没有这套卷,刷新一下再试")
    await db.commit()
    return {"renamed": r.rowcount, "paper_title": new}


@teacher_router.post("/paper-bank/docs/{doc_id}/retry")
async def retry_doc(doc_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    if await pp.expire_stale(db, [d]):
        await db.commit()
    if d.status in ("queued", "parsing"):
        raise HTTPException(409, "还在拆,等一会儿")
    if await pp.relay_conf(db) is None:
        raise HTTPException(409, NO_AI)
    left = (await db.execute(select(PaperPage.id).where(PaperPage.doc_id == d.id, PaperPage.status != "done"))).all()
    has_pages = (await db.execute(select(PaperPage.id).where(PaperPage.doc_id == d.id).limit(1))).first() is not None
    if has_pages and not left:
        raise HTTPException(409, "每一页都拆好了,不用再拆")
    if not has_pages and not os.path.exists(pp.source_path(d.id, d.file_kind or "pdf")):
        raise HTTPException(409, "原文件已经没有了,重新传一次吧")
    await db.execute(update(PaperPage).where(PaperPage.doc_id == d.id, PaperPage.status != "done")
                     .values(status="pending", error=None).execution_options(synchronize_session=False))
    d.status, d.reason, d.started_at, d.finished_at = "queued", None, None, None
    await db.commit()
    await pp.run_later(pp.parse_job, d.id)
    return {"ok": True}


@teacher_router.post("/paper-bank/docs/{doc_id}/approve-clean")
async def approve_clean(doc_id: int, request: Request, db: AsyncSession = Depends(get_db),
                        teacher: User = Depends(get_current_teacher)):
    """没标黄、答案齐的题一起通过(标黄的要老师一道道看)"""
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    actor = acting_user(teacher)
    n = 0
    for it in (await db.execute(select(PaperItem).where(PaperItem.doc_id == d.id, PaperItem.status == "pending"))).scalars():
        if it.flags:
            continue
        try:
            pb.validate_edit(it, {})
        except pb.Invalid:
            continue
        it.status, it.reviewed_by, it.reviewed_at = "approved", actor.id, utc_now()
        n += 1
    audit_log.record(db, request, teacher, "paper.approve", f"「{d.title}」一起通过 {n} 道没标黄的题",
                     target_type="paper_doc", target_id=d.id)
    await db.commit()
    return {"approved": n}


@teacher_router.delete("/paper-bank/docs/{doc_id}")
async def delete_doc(doc_id: int, request: Request, db: AsyncSession = Depends(get_db),
                     teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    d = await _own_doc(db, teacher, doc_id)
    if d.status in ("queued", "parsing"):
        raise HTTPException(409, "还在拆,等拆完再删")
    d.status, d.deleted_at = "deleted", utc_now()
    audit_log.record(db, request, teacher, "paper.delete", f"删掉卷子「{d.title}」", target_type="paper_doc",
                     target_id=d.id)
    await db.commit()
    await asyncio.to_thread(pp.remove_files, d.id)
    return {"ok": True}


def _read(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


@teacher_router.get("/paper-bank/docs/{doc_id}/pages/{page_no}/tiles/{idx}")
async def doc_tile(doc_id: int, page_no: int, idx: int, db: AsyncSession = Depends(get_db),
                   teacher: User = Depends(get_current_teacher)):
    d = await _own_doc(db, teacher, doc_id)
    p = (await db.execute(select(PaperPage).where(PaperPage.doc_id == d.id, PaperPage.page_no == page_no))).scalar_one_or_none()
    if p is None or not 0 <= idx < len(p.tiles or []):
        raise HTTPException(404, "没有这块图")
    raw = await asyncio.to_thread(_read, pp.tile_path(d.id, p.tiles[idx]))
    if raw is None:
        raise HTTPException(404, "图已经没有了")
    return Response(raw, media_type="image/jpeg", headers=IMG_HEADERS)


async def _item_image(db: AsyncSession, it: PaperItem) -> bytes:
    p = (await db.execute(select(PaperPage).where(PaperPage.doc_id == it.doc_id, PaperPage.page_no == it.page_no))).scalar_one_or_none()
    if p is None or it.tile_idx is None or not 0 <= it.tile_idx < len(p.tiles or []):
        raise HTTPException(404, "这道题没有原题图")
    cache = os.path.join(pp.doc_dir(it.doc_id), f"item_{it.id}_{it.tile_idx}_{it.y0}_{it.y1}.jpg")
    raw = await asyncio.to_thread(_read, cache)
    if raw is not None:
        return raw
    tile = await asyncio.to_thread(_read, pp.tile_path(it.doc_id, p.tiles[it.tile_idx]))
    if tile is None:
        raise HTTPException(404, "原题图已经没有了")
    raw = await asyncio.to_thread(ptl.crop_item, tile, it.y0, it.y1)

    def save():
        try:
            with open(cache, "wb") as f:
                f.write(raw)
        except OSError:
            pass
    await asyncio.to_thread(save)
    return raw


@teacher_router.get("/paper-bank/items/{item_id}/image")
async def item_image(item_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    it = await _own_item(db, teacher, item_id)
    return Response(await _item_image(db, it), media_type="image/jpeg", headers=IMG_HEADERS)


class ItemEdit(BaseModel):
    stem: Optional[str] = Field(None, max_length=1000)
    options: Optional[List[str]] = Field(None, max_length=6)
    answer: Optional[Union[str, List[str]]] = None
    alts: Optional[List[Union[str, List[str]]]] = None
    base_word: Optional[str] = Field(None, max_length=60)
    explain: Optional[str] = Field(None, max_length=300)
    kps: Optional[List[str]] = Field(None, max_length=3)
    needs_image: Optional[bool] = None
    status: Optional[str] = None


@teacher_router.put("/paper-bank/items/{item_id}")
async def edit_item(item_id: int, body: ItemEdit, db: AsyncSession = Depends(get_db),
                    teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    it = await _own_item(db, teacher, item_id)
    data = body.model_dump(exclude_unset=True)
    status = data.pop("status", None)
    if status is not None and status not in ("approved", "rejected", "pending"):
        raise HTTPException(400, "状态不对")
    try:
        changes = pb.validate_edit(it, data)
    except pb.Invalid as e:
        raise HTTPException(400, str(e))
    # 只有答案真的变了才算「老师改过答案」(表单每次都把答案原样带回来)
    answer_changed = "answer" in changes and changes["answer"] != it.answer
    for k, v in changes.items():
        setattr(it, k, v)
    if changes:
        pb.retag(it)
        # 老师改过了: 模型那几条「拿不准」不作数了(老师看过了)
        it.flags = []
        if answer_changed:
            it.answer_source = "edited"
    if status is not None:
        it.status = status
        if status != "pending":
            it.reviewed_by, it.reviewed_at = acting_user(teacher).id, utc_now()
    elif changes and it.status == "pending":
        it.status = "approved"
        it.reviewed_by, it.reviewed_at = acting_user(teacher).id, utc_now()
    await db.commit()
    return pb.teacher_item(it)


@teacher_router.get("/paper-bank/kps")
async def kp_map(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    stats = await pb.bank_stats(db, None if teacher.role == "admin" else teacher.org_id)
    return {"points": kpm.public_map(), "bank": stats}


# ---------------------------------------------------------------- 老师: 班级

async def _class_students(db: AsyncSession, teacher: User, class_id: int) -> tuple[Class, list[User]]:
    c = (await db.execute(select(Class).where(Class.id == class_id, Class.teacher_id == teacher.id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404, "没有这个班,或者不是你的班")
    rows = list((await db.execute(select(User).join(ClassStudent, ClassStudent.student_id == User.id)
                                  .where(ClassStudent.class_id == c.id, ClassStudent.is_active.is_(True),
                                         User.role == "student", User.is_active.is_(True))
                                  .order_by(User.id))).scalars())
    return c, rows


@teacher_router.get("/paper-bank/classes")
async def my_classes(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    rows = list((await db.execute(select(Class).where(Class.teacher_id == teacher.id).order_by(Class.id))).scalars())
    return {"items": [{"id": c.id, "name": c.name} for c in rows]}


@teacher_router.get("/paper-bank/class/{class_id}")
async def class_view(class_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await _teacher_ok(db, teacher)
    c, students = await _class_students(db, teacher, class_id)
    data = await pb.class_overview(db, students, teacher.org_id)
    return {"class": {"id": c.id, "name": c.name, "students": len(students)}, **data}


class PrintIn(BaseModel):
    class_id: int
    student_ids: Optional[List[int]] = Field(None, max_length=200)


@teacher_router.post("/paper-bank/print")
async def print_class(body: PrintIn, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """打印全班今天的小卷: 每个孩子一份(和他在网页上看到的是同一份,纸上做完也能在网页上点答案)"""
    await _teacher_ok(db, teacher)
    _c, students = await _class_students(db, teacher, body.class_id)
    if body.student_ids:
        want = set(body.student_ids)
        students = [s for s in students if s.id in want]
    out, skipped = [], []
    for s in students:
        q, why = await pb.get_quiz(db, s)
        if q is None:
            g = await pb.student_grade(db, s)
            reason = (f"他按在学的书算是{g},题库里通过核对的题没有不高于{g}的" if g
                      else "题库里通过核对的题不够出一份")
            skipped.append({"id": s.id, "name": s.full_name or s.username, "reason": reason})
            continue
        items = await pb.quiz_items(db, q)
        rows = []
        for i, x in enumerate(q.items or [], 1):
            it = items.get(x["id"])
            if it is None:
                continue
            rows.append({**pb.public_item(it), "no": i, "answer_text": pb.answer_text(it), "explain": it.explain or "",
                         "label": pb.LABELS.get(x.get("why"), ""), "kp": kpm.BY_ID[x["kp"]].name if x.get("kp") in kpm.BY_ID else "",
                         "note": x.get("note") or ""})
        out.append({"student": {"id": s.id, "name": s.full_name or s.username}, "quiz_id": q.id,
                    "date": q.quiz_date.isoformat(), "items": rows})
    return {"papers": out, "skipped": skipped}


# ---------------------------------------------------------------- 平台管理员: 设置

async def _admin_state(db: AsyncSession) -> dict:
    s = await pb.get_settings(db)
    row = await pp.provider_row(db)
    extra = (row.extra_config or {}) if row else {}
    since = utc_now() - timedelta(days=7)
    docs = list((await db.execute(select(PaperDoc).where(PaperDoc.created_at >= since))).scalars())
    return {
        "settings": s, "scopes": list(pb.SCOPES),
        "provider": {
            # source: paper 用单独的 Key / tutor 用小鹰老师那个 / None 都没有
            "source": await pp.key_source(db),
            "configured": bool(row and row.api_key), "enabled": bool(row.enabled) if row else False,
            "model": (row.model_name if row else None) or pp.DEFAULT_MODEL,
            "fallback_model": extra.get("fallback_model", pp.DEFAULT_FALLBACK) if row else pp.DEFAULT_FALLBACK,
            "base_url": (row.base_url if row else None) or pp.DEFAULT_BASE_URL,
        },
        "usage": {"days": 7, "docs": len(docs), "pages": sum(d.pages or 0 for d in docs),
                  "input_tokens": sum(d.input_tokens or 0 for d in docs),
                  "output_tokens": sum(d.output_tokens or 0 for d in docs)},
    }


@teacher_router.get("/paper-bank/admin")
async def admin_get(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return await _admin_state(db)


class AdminIn(BaseModel):
    scope: Optional[str] = None
    daily_pages: Optional[int] = None
    daily_pages_all: Optional[int] = None
    quiz_size: Optional[int] = None
    api_key: Optional[str] = Field(None, max_length=400)     # 留空 = 不改
    model: Optional[str] = Field(None, max_length=60)
    fallback_model: Optional[str] = Field(None, max_length=60)  # 空串 = 不要备用
    base_url: Optional[str] = Field(None, max_length=200)
    enabled: Optional[bool] = None


@teacher_router.put("/paper-bank/admin")
async def admin_put(body: AdminIn, request: Request, db: AsyncSession = Depends(get_db),
                    admin: User = Depends(get_current_admin)):
    from app.api.v1.admin.ai_config import encrypt_api_key

    data = body.model_dump(exclude_unset=True)
    changed: list[str] = []
    try:
        before = await pb.get_settings(db)
        after = await pb.save_settings(db, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if before != after:
        changed.append(f"开放范围 {after['scope']},每位老师每天 {after['daily_pages']} 页,全平台 {after['daily_pages_all']} 页,"
                       f"小卷 {after['quiz_size']} 题")
    row = await pp.provider_row(db)
    key = (data.get("api_key") or "").strip()
    wants_model = any((data.get(k) or "").strip() for k in ("model", "fallback_model")) or "fallback_model" in data
    if row is None and (key or wants_model):
        # 没填单独的 Key 也建这一行(只存模型),api_key 空 = 用小鹰老师的 Key
        row = AIProvider(provider_name=pp.PROVIDER_NAME, display_name="Claude(拆卷专用)", enabled=True,
                         is_default=False, model_name=pp.DEFAULT_MODEL, base_url=pp.DEFAULT_BASE_URL,
                         api_key="", extra_config={"fallback_model": pp.DEFAULT_FALLBACK})
        db.add(row)
    if row is not None:
        # 「留空 = 不改」走显式分支: 空串不能把密钥清掉(AI 配置那次就是这样被抹掉的)
        if key and "***" not in key and "..." not in key:
            row.api_key = encrypt_api_key(key)
            changed.append("换了密钥")
        if "model" in data and (data["model"] or "").strip():
            row.model_name = data["model"].strip()
            changed.append(f"模型 {row.model_name}")
        if "fallback_model" in data:
            row.extra_config = {**(row.extra_config or {}), "fallback_model": (data["fallback_model"] or "").strip()}
            changed.append(f"备用模型 {(data['fallback_model'] or '').strip() or '不要'}")
        if "base_url" in data and (data["base_url"] or "").strip():
            row.base_url = data["base_url"].strip()
        if "enabled" in data and data["enabled"] is not None:
            row.enabled = bool(data["enabled"])
            changed.append("启用" if row.enabled else "停用")
        row.is_default = False      # 永远不当默认(见 admin/ai_config.DEDICATED_PROVIDERS)
    if changed:
        audit_log.record(db, request, admin, "system.paper_bank", "试卷库: " + ";".join(changed))
    await db.commit()
    return await _admin_state(db)


@teacher_router.post("/paper-bank/admin/test")
async def admin_test(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    """拿一段文字试一下: 能拆出题就算通"""
    conf = await pp.relay_conf(db)
    if conf is None:
        raise HTTPException(409, NO_AI)
    content = [{"type": "text", "text": "文件「测试」第 1 页(共 1 页)。卷子是初一的。这一段是文字(没有图):\n<<<\n"
                "二、单项选择\n21. He ___ football every day.\nA. play  B. plays  C. playing  D. is play\n>>>\n拆这一段。"}]
    t0 = time.monotonic()
    try:
        got, model, usage = await pp.call_models(conf, content)
    except pp.ModelsFailed as e:
        raise HTTPException(502, f"没调通: {e}")
    res = pp.normalize_page(got, 0)
    return {"ok": bool(res["items"]), "model": model, "seconds": round(time.monotonic() - t0, 1),
            "items": len(res["items"]), "usage": usage,
            "sample": res["items"][0] if res["items"] else None}


# ---------------------------------------------------------------- 学生

@student_router.get("/paper-quiz/status")
async def quiz_status(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    ok, reason, _s = await pb.availability(db, student)
    if not ok:
        return {"enabled": False, "reason": reason, "today": None}
    q, _ = await pb.get_quiz(db, student, create=False)
    if q is None:
        g = await pb.student_grade(db, student)
        pool = await pb.candidates(db, student.org_id, pb.grade_rank(g))
        return {"enabled": len(pool) >= pb.MIN_BANK, "reason": "" if len(pool) >= pb.MIN_BANK else "题库里还没有适合你的题",
                "today": None}
    return {"enabled": True, "reason": "", "today": {"id": q.id, "status": q.status, "answered": q.answered,
                                                      "right": q.right, "total": q.total}}


@student_router.post("/paper-quiz/today")
async def quiz_today(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    ok, reason, _s = await pb.availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    from app.api.v1.checkin import require_checkin
    await require_checkin(db, student.id)
    q, why = await pb.get_quiz(db, student)
    if q is None:
        raise HTTPException(404, {"code": "no_bank", "message": why})
    return await pb.quiz_out(db, q)


async def _my_quiz(db: AsyncSession, student: User, quiz_id: int) -> PaperQuiz:
    q = await db.get(PaperQuiz, quiz_id)
    if q is None or q.user_id != student.id:
        raise HTTPException(404, "没有这份小卷")
    return q


@student_router.get("/paper-quiz/{quiz_id}")
async def quiz_get(quiz_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    return await pb.quiz_out(db, await _my_quiz(db, student, quiz_id))


class AnswerIn(BaseModel):
    item_id: int
    answer: Union[str, List[str]] = Field(...)
    ms: Optional[int] = None


@student_router.post("/paper-quiz/{quiz_id}/answer")
async def quiz_answer(quiz_id: int, body: AnswerIn, db: AsyncSession = Depends(get_db),
                      student: User = Depends(get_current_student)):
    await check_rate(str(student.id), "paper_answer", [(60, 60)])
    given: Any = body.answer
    if isinstance(given, list):
        given = [str(x)[:80] for x in given[:6]]
    else:
        given = str(given)[:80]
    try:
        return await pb.submit(db, student, quiz_id, body.item_id, given, body.ms)
    except pb.QuizRule as e:
        raise HTTPException(400, str(e))


@student_router.get("/paper-quiz/{quiz_id}/summary")
async def quiz_summary(quiz_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    q = await _my_quiz(db, student, quiz_id)
    return {"points": await pb.quiz_summary(db, student, q), "right": q.right, "total": q.total, "status": q.status}


@student_router.get("/paper-quiz/items/{item_id}/image")
async def quiz_item_image(item_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """只给自己小卷里、要看图的题(题干里没把图写成文字的)"""
    mine = False
    for (items,) in (await db.execute(select(PaperQuiz.items).where(PaperQuiz.user_id == student.id)
                                      .order_by(PaperQuiz.id.desc()).limit(60))).all():
        if any(x.get("id") == item_id for x in (items or [])):
            mine = True
            break
    it = await db.get(PaperItem, item_id)
    if not mine or it is None or not it.needs_image:
        raise HTTPException(404, "没有这张图")
    return Response(await _item_image(db, it), media_type="image/jpeg", headers=IMG_HEADERS)
