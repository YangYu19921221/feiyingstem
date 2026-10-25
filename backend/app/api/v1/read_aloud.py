"""例句跟读接口(2026-10-24)。规则与口径见 services/read_aloud.py

学生: GET  /student/units/{unit_id}/read-aloud     这一轮读哪几句(单元权限与取词表同一道闸门)
      POST /student/units/{unit_id}/read-aloud     传一句的录音(孩子不等结果,失败前端静默)
老师: GET  /teacher/students/{sid}/read-aloud      本班学生最近的跟读(转写结果 + 能不能回放)
      GET  /teacher/read-aloud/{rid}/audio         回放录音(14 天内,只放行本班)
      PUT  /teacher/read-aloud/{rid}/verdict       标「读对了 / 没读对」,用来核对机器判断准不准
"""
import os
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student, get_current_teacher
from app.api.v1.checkin import has_checked_in_today
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.models.content_homework import KIND_READ_ALOUD, ContentHomework, ContentHomeworkStudent
from app.models.read_aloud import ReadAloudRecording
from app.models.user import User
from app.models.word import Unit, WordBook, WordDefinition
from app.services import read_aloud as ra
from app.services.scope_service import can_enter_unit, deny_message

student_router = APIRouter()
teacher_router = APIRouter()

_MIME = {"audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/mpeg": ".mp3"}


async def _read_aloud_homework_grants(db: AsyncSession, student_id: int, unit: Unit) -> bool:
    """老师布置了这个单元的跟读作业(已开放、没关闭)→ 放行跟读,即使这本书没分配给孩子
    (单词作业也是「布置即放行」)。新政策卡包书/专属内容照旧不放行: 作业不能成为绕开卡包的后门"""
    from app.services.card_pack import is_exclusive_locked, is_gated_for_student
    if await is_gated_for_student(db, student_id, unit.book_id) or \
            await is_exclusive_locked(db, student_id, unit.book_id):
        return False
    hit = (await db.execute(
        select(ContentHomeworkStudent.id)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomeworkStudent.student_id == student_id,
               ContentHomework.kind == KIND_READ_ALOUD,
               ContentHomework.target_id == unit.id,
               ContentHomework.is_closed.is_(False),
               ContentHomework.available_from <= datetime.utcnow())
        .limit(1)
    )).first()
    return hit is not None


async def _enter(db: AsyncSession, student: User, unit_id: int, assignment_id: Optional[int]) -> Unit:
    """与取词表(/student/units/{id}/start)同一道闸门: 签到 + 单元在可学范围内(或有这个单元的跟读作业)"""
    row = (await db.execute(
        select(Unit, WordBook).join(WordBook, WordBook.id == Unit.book_id).where(Unit.id == unit_id)
    )).one_or_none()
    if row is None:
        raise HTTPException(404, "单元不存在")
    unit = row[0]
    if not await has_checked_in_today(db, student.id):
        raise HTTPException(403, "今天还没有签到,请先回到首页签到")
    if not await can_enter_unit(db, student.id, unit.book_id, unit_id, assignment_id) and \
            not await _read_aloud_homework_grants(db, student.id, unit):
        raise HTTPException(403, await deny_message(db, student.id, unit_id))
    return unit


@student_router.get("/units/{unit_id}/read-aloud")
async def read_aloud_round(
    unit_id: int,
    assignment_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    await check_rate(str(student.id), "read_aloud_round", [(60.0, 30)])
    unit = await _enter(db, student, unit_id, assignment_id)
    items = await ra.pick_round(db, student.id, unit_id)
    return {"unit_id": unit_id, "unit_name": unit.name, "round_size": ra.ROUND_SIZE,
            "keep_days": ra.KEEP_DAYS, "items": items}


@student_router.post("/units/{unit_id}/read-aloud")
async def upload_read_aloud(
    unit_id: int,
    audio: UploadFile = File(...),
    word_id: int = Form(...),
    assignment_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    await check_rate(str(student.id), "read_aloud_upload", [(60.0, 40)])
    await _enter(db, student, unit_id, assignment_id)
    # 读的那句以服务端为准(这个词在这个单元里能跟读的那条),不信前端传的文本
    item = next((s for s in (await ra.eligible_sentences(db, [unit_id]))[unit_id] if s["word_id"] == word_id), None)
    if item is None:
        raise HTTPException(400, "这个词不在这个单元,或没有能跟读的例句")
    ctype = (audio.content_type or "").split(";")[0].strip().lower()
    if ctype not in _MIME:
        raise HTTPException(400, f"不支持的音频格式: {ctype}")
    data = await audio.read(settings.MAX_SENTENCE_SPEECH_SIZE + 1)
    if len(data) > settings.MAX_SENTENCE_SPEECH_SIZE:
        raise HTTPException(413, "录音太长")
    if len(data) < 2000:
        raise HTTPException(400, "录音是空的")
    os.makedirs(ra.AUDIO_DIR, exist_ok=True)
    name = f"{student.id}_{unit_id}_{word_id}_{secrets.token_hex(8)}{_MIME[ctype]}"
    with open(ra.audio_path(name), "wb") as f:
        f.write(data)
    db.add(ReadAloudRecording(
        user_id=student.id, unit_id=unit_id, word_id=word_id, definition_id=item["definition_id"],
        sentence=item["sentence"], org_id=student.org_id, file_path=name, status="pending",
        created_at=datetime.utcnow(),
    ))
    await db.commit()
    return {"success": True}


# ---------- 老师端 ----------

async def _own_row(db: AsyncSession, teacher: User, rid: int) -> ReadAloudRecording:
    row = await db.get(ReadAloudRecording, rid)
    if row is None:
        raise HTTPException(404, "录音不存在")
    await assert_student_in_my_class(db, teacher.id, row.user_id)
    return row


@teacher_router.get("/students/{student_id}/read-aloud")
async def student_read_aloud(
    student_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    await assert_student_in_my_class(db, teacher.id, student_id)
    rows = (await db.execute(
        select(ReadAloudRecording, Unit.name, WordDefinition.example_translation)
        .join(Unit, Unit.id == ReadAloudRecording.unit_id, isouter=True)
        .join(WordDefinition, WordDefinition.id == ReadAloudRecording.definition_id, isouter=True)
        .where(ReadAloudRecording.user_id == student_id)
        .order_by(ReadAloudRecording.id.desc()).limit(limit)
        .execution_options(skip_tenant_filter=True)
    )).all()
    items = [{
        "id": r.id, "unit_name": un or "", "sentence": r.sentence, "translation": tr or "",
        "status": r.status, "transcript": r.transcript,
        "missed_words": [w for w in (r.missed_words or "").split(",") if w],
        "passed": r.passed, "teacher_verdict": r.teacher_verdict,
        "has_audio": r.file_path is not None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r, un, tr in rows]
    done = [i for i in items if i["status"] == "done"]
    marked = [i for i in done if i["teacher_verdict"]]
    return {
        "keep_days": ra.KEEP_DAYS,
        "items": items,
        "summary": {
            "total": len(items), "done": len(done),
            "passed": sum(1 for i in done if i["passed"]),
            "pending": sum(1 for i in items if i["status"] == "pending"),
            # 老师标过的里面,机器判断和老师一致的有几条(验证识别准不准)
            "marked": len(marked),
            "agree": sum(1 for i in marked if (i["teacher_verdict"] == "ok") == bool(i["passed"])),
        },
    }


@teacher_router.get("/read-aloud/{rid}/audio")
async def read_aloud_audio(rid: int, db: AsyncSession = Depends(get_db),
                           teacher: User = Depends(get_current_teacher)):
    row = await _own_row(db, teacher, rid)
    path = ra.audio_path(row.file_path) if row.file_path else None
    if not path or not os.path.exists(path):
        raise HTTPException(410, f"录音只保留 {ra.KEEP_DAYS} 天,这条已经删除")
    ext = os.path.splitext(path)[1]
    media = {v: k for k, v in _MIME.items()}.get(ext, "application/octet-stream")
    # 孩子的声音: 不让代理和浏览器缓存
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})


class VerdictIn(BaseModel):
    verdict: Optional[str] = None   # ok / bad / null(取消标记)


@teacher_router.put("/read-aloud/{rid}/verdict")
async def set_read_aloud_verdict(rid: int, body: VerdictIn, db: AsyncSession = Depends(get_db),
                                 teacher: User = Depends(get_current_teacher)):
    if body.verdict not in (None, "ok", "bad"):
        raise HTTPException(400, "只能标「读对了」或「没读对」")
    row = await _own_row(db, teacher, rid)
    row.teacher_verdict = body.verdict
    row.verdict_by = teacher.id if body.verdict else None
    row.verdict_at = datetime.utcnow() if body.verdict else None
    await db.commit()
    return {"teacher_verdict": row.teacher_verdict}
