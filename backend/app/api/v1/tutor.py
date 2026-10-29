"""AI 学习助手接口(2026-10-26)。规则见 services/tutor.py

学生: GET  /student/tutor/status                    能不能用、一共还剩几次、深度思考开没开
      GET  /student/tutor/conversations             我的对话(最近 30 段)
      GET  /student/tutor/conversations/{id}        一段对话的全部消息
      POST /student/tutor/ask                       提问(文字 + 可选一张照片 + mode=fast|deep),回答按 SSE 一段段推
      POST /student/tutor/stop                      停下正在出的回答(一个字没出就退回次数)
      POST /student/tutor/request-more              次数用完了,请老师加
      GET  /student/tutor/pictures/word/{word_id}   这个词有没有记忆图(错题本「看记忆图」先问这个,不扣次数)
      POST /student/tutor/pictures                  要一张记忆图(有就给,没有就扣 1 次开画,services/word_picture)
      GET  /student/tutor/pictures/{pic_id}         画好没有(前端每 3 秒问一次)
老师: GET  /teacher/students/{sid}/tutor            本班学生和助手的对话(只读)+ 助手看到的这个孩子的学情摘要
      GET  /teacher/tutor/available                 本校开没开(公告用)
      GET  /teacher/tutor/students                  本班学生用了几次 / 还剩几次 / 谁在请求加 / 机构次数池还剩几次
      POST /teacher/tutor/grant                     给本班学生加次数(加盟机构从机构次数池里扣,池里不够 409)
管理: GET  /admin/tutor                             开放范围 / 次数 / 模型 / 近 7 天用量
      PUT  /admin/tutor                             改上面这些(密钥留空 = 不改)
      POST /admin/tutor/test                        主模型和备用各发一句「ping」,看通不通
      GET  /admin/tutor/pools                       各机构的学习助手次数池
      GET  /admin/tutor/pools/{org_id}              一个机构的次数池和到账记录
      POST /admin/tutor/pools/{org_id}              机构进货到账加次数 / 扣回(合同第三条第 10 款)
      GET  /admin/tutor/pictures                    画过的记忆图(最近 60 张)
      DELETE /admin/tutor/pictures/{pic_id}         删掉一张不合适的图(下次有人点再画)

回答是流式的: 浏览器收到一段字就显示一段(孩子不用干等十几秒)。
⚠️ SSE 三件事: X-Accel-Buffering: no(nginx 不攒着一起发)、no-store(全局 proxy_cache)、
回答在后台任务里跑、自己开数据库会话 —— 孩子中途关页面,这次回答照样写库,老师照样看得到
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Optional, Union

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_admin, get_current_student, get_current_teacher, require_role
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.database import AsyncSessionLocal, get_db
from app.core.rate_limit import check_rate
from app.core.timeutil import utc_now
from app.models.system_config import AIProvider
from app.core.shared_store import store
from app.models.organization import Organization
from app.models.tutor import TutorAllowance, TutorConversation, TutorMessage, TutorOrgPool, TutorPoolLedger
from app.models.user import Class, ClassStudent, User
from app.services import audit_log
from app.services import tutor as tt
from app.services import word_picture as wp

logger = logging.getLogger(__name__)

student_router = APIRouter()
teacher_router = APIRouter()
admin_router = APIRouter()

IMAGE_MAX_BYTES = 8 * 1024 * 1024
IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
# 测试里换成共用测试会话的工厂
session_factory = AsyncSessionLocal
_running: set[asyncio.Task] = set()

BUSY_MSG = "小鹰老师现在有点忙,过一会儿再问一次吧(这次不算次数)"


def _sse(ev: dict) -> bytes:
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode()


async def _availability(db: AsyncSession, user: User) -> tuple[bool, str, dict]:
    settings = await tt.get_settings(db)
    if not await tt.scope_allows(db, settings["scope"], user):
        return False, "学习助手还在试用,你们学校暂时没开放", settings
    if await tt.relay_conf(db) is None:
        return False, "学习助手还没配置好,请告诉老师", settings
    return True, "", settings


STOPPED = "停下了"


def _msg_out(m: TutorMessage) -> dict:
    stopped = m.error == STOPPED
    return {"id": m.id, "role": m.role, "text": m.text, "has_image": bool(m.has_image),
            "cards": m.cards or [], "failed": bool(m.error) and not m.text and not stopped,
            "stopped": stopped, "mode": m.mode or "fast",
            "created_at": m.created_at.isoformat() if m.created_at else None}


def _stop_key(user_message_id: int) -> str:
    return f"tutor:stop:{user_message_id}"


# ---------------------------------------------------------------- 学生

@student_router.get("/tutor/status")
async def tutor_status(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    ok, reason, settings = await _availability(db, student)
    conf = await tt.relay_conf(db) if ok else None
    a = await tt.allowance_status(db, student.id, settings, student.org_id)
    return {"enabled": ok, "reason": reason, **a, "free_total": await tt.free_for(db, student.org_id, settings),
            "card_times": await tt.card_times(db, student.id),
            "deep_enabled": bool(conf and conf.deep_enabled), "deep_cost": settings["deep_cost"],
            "followup_free": tt.FOLLOWUP_FREE, "followup_minutes": tt.FOLLOWUP_MINUTES,
            "picture_enabled": ok and await wp.available(db), "picture_cost": wp.COST,
            "max_text": tt.MAX_TEXT, "voice_enabled": ok and _voice_ok(),
            "review": await _review_or_none(db, student) if ok else None}


async def _review_or_none(db: AsyncSession, student: User) -> Optional[dict]:
    """首页小鹰老师卡片上的「考考你」(services/tutor_notes);算不出来不影响状态接口"""
    from app.services import tutor_notes
    try:
        return await tutor_notes.review_question(db, student.id)
    except Exception:  # noqa: BLE001
        logger.exception("考考你失败 user=%s", student.id)
        return None


def _voice_ok() -> bool:
    """「按住说话」: 服务器装了 Whisper 才开(services/tutor_voice)"""
    from app.services import sentence_speech
    return sentence_speech.is_available()


@student_router.post("/tutor/request-more")
async def tutor_request_more(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """次数用完了点「请老师加」: 老师的「学习助手次数」页把这些孩子排在最前面"""
    await tt.request_more(db, student.id)
    await db.commit()
    return {"ok": True}


class PictureIn(BaseModel):
    word_id: int


@student_router.get("/tutor/pictures/word/{word_id}")
async def picture_for_word(word_id: int, db: AsyncSession = Depends(get_db),
                           student: User = Depends(get_current_student)):
    """这个词有没有画好的记忆图。没有 = exists false(不扣次数,前端据此写「画一张(用 1 次)」)"""
    found = await wp.find_word(db, word_id=word_id)
    if found is None:
        raise HTTPException(404, "没有这个词")
    p = await wp.lookup(db, *found)
    o = wp.out(p) if p else None
    return {"word": found[0], "exists": bool(o and o["status"] in ("ready", "pending")), "picture": o,
            "enabled": await wp.available(db), "cost": wp.COST}


@student_router.post("/tutor/pictures")
async def request_picture(body: PictureIn, db: AsyncSession = Depends(get_db),
                          student: User = Depends(get_current_student)):
    ok, reason, _ = await _availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    found = await wp.find_word(db, word_id=body.word_id)
    if found is None:
        raise HTTPException(404, "没有这个词")
    await check_rate(str(student.id), "tutor_pic", [(60, 6)])
    try:
        return await wp.request(db, student, *found)
    except wp.PictureRefused as e:
        raise HTTPException(429, str(e))


@student_router.get("/tutor/pictures/{pic_id}")
async def picture_status(pic_id: int, db: AsyncSession = Depends(get_db),
                         _student: User = Depends(get_current_student)):
    """图是全平台共用的(只有单词的画面),谁都能看"""
    from app.models.tutor import WordPicture

    p = (await db.execute(select(WordPicture).where(WordPicture.id == pic_id)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "没有这张图")
    return wp.out(p)


class StopIn(BaseModel):
    user_message_id: int


@student_router.post("/tutor/stop")
async def tutor_stop(body: StopIn, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """停下正在出的回答。回答在哪个进程跑都看得到(放共享存储),那边每秒看一次"""
    m = await db.get(TutorMessage, body.user_message_id)
    if m is None or m.user_id != student.id or m.role != "user":
        raise HTTPException(404, "没有这条提问")
    await store.set(_stop_key(m.id), "1", 300)
    return {"ok": True}


@student_router.get("/tutor/conversations")
async def my_conversations(q: Optional[str] = Query(None, max_length=100), offset: int = Query(0, ge=0, le=10000),
                           limit: int = Query(30, ge=1, le=50),
                           db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """我的对话: 收藏的在前,其余按最后一次提问倒序;q 搜标题和内容。分组 / 保留天数见 services/tutor_history"""
    from app.services import tutor_history

    return await tutor_history.list_page(db, student.id, q, offset, limit)


class ConversationPatchIn(BaseModel):
    # 只改传了的字段(显式分支): 只点收藏时不带 title,不能把标题清掉
    title: Optional[str] = Field(None, max_length=100)
    starred: Optional[bool] = None


@student_router.patch("/tutor/conversations/{cid}")
async def patch_conversation(cid: int, body: ConversationPatchIn, db: AsyncSession = Depends(get_db),
                             student: User = Depends(get_current_student)):
    """改标题 / 收藏。不动 updated_at(改个名不该把对话挪到「今天」那组)"""
    from app.services import tutor_history

    await check_rate(str(student.id), "tutor_conv_edit", [(60, 30)])
    c = await _own_conversation(db, student, cid)
    sent = body.model_fields_set
    if "title" in sent:
        title = tutor_history.clean_title(body.title)
        if not title:
            raise HTTPException(400, "标题不能是空的")
        c.title = title
    if "starred" in sent and body.starred is not None:
        c.starred = bool(body.starred)
    await db.commit()
    return tutor_history.item_out(c)


@student_router.delete("/tutor/conversations/{cid}")
async def delete_conversation(cid: int, db: AsyncSession = Depends(get_db),
                              student: User = Depends(get_current_student)):
    """孩子删对话: 孩子这边马上看不到;老师 30 天内还看得到,之后到期真删(services/tutor_history)"""
    from app.services import tutor_history

    await check_rate(str(student.id), "tutor_conv_edit", [(60, 30)])
    c = await _own_conversation(db, student, cid)
    c.deleted_at = utc_now()
    await db.commit()
    return {"ok": True, "deleted_keep_days": tutor_history.DELETED_KEEP_DAYS}


class TutorPrefsIn(BaseModel):
    # 只改传了的字段(显式分支): grade 传 null / 空串 = 改回按书推断;pace 传 auto = 改回自动
    grade: Optional[str] = Field(None, max_length=10)
    pace: Optional[str] = Field(None, pattern="^(auto|simple|normal|deep)$")


async def _save_prefs(db: AsyncSession, user: User, body: TutorPrefsIn, by: str) -> dict:
    from app.services import tutor_level

    try:
        await tutor_level.save_prefs(db, user.id, {k: getattr(body, k) for k in body.model_fields_set}, by)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return await tutor_level.level_info(db, user)


@student_router.get("/tutor/prefs")
async def my_tutor_prefs(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """小鹰老师现在按什么讲: 年级(设的 / 按书推断)和讲解方式(自动 / 选的),规则见 services/tutor_level"""
    from app.services import tutor_level

    return await tutor_level.level_info(db, student)


@student_router.put("/tutor/prefs")
async def set_my_tutor_prefs(body: TutorPrefsIn, db: AsyncSession = Depends(get_db),
                             student: User = Depends(get_current_student)):
    await check_rate(str(student.id), "tutor_prefs", [(60, 20)])
    return await _save_prefs(db, student, body, "student")


async def _own_conversation(db: AsyncSession, student: User, cid: int) -> TutorConversation:
    c = await db.get(TutorConversation, cid)
    # 孩子删掉的对话当作没有: 打不开、不能接着问、不能再改
    if c is None or c.user_id != student.id or c.deleted_at is not None:
        raise HTTPException(404, "没有这段对话")
    return c


@student_router.get("/tutor/conversations/{cid}")
async def conversation_detail(cid: int, db: AsyncSession = Depends(get_db),
                              student: User = Depends(get_current_student)):
    c = await _own_conversation(db, student, cid)
    msgs = (await db.execute(
        select(TutorMessage).where(TutorMessage.conversation_id == c.id).order_by(TutorMessage.id)
    )).scalars().all()
    from app.services import tutor_quiz
    out = await tutor_quiz.attach(db, await _with_pictures(db, [_msg_out(m) for m in msgs]))
    return {"id": c.id, "title": c.title or "新对话", "messages": out, "followup": await tt.followup_state(db, c.id)}


class QuizSubmitIn(BaseModel):
    answers: list[Optional[Union[int, str]]] = Field(default_factory=list, max_length=10)


@student_router.post("/tutor/quizzes/{quiz_id}/submit")
async def submit_quiz(quiz_id: int, body: QuizSubmitIn, db: AsyncSession = Depends(get_db),
                      student: User = Depends(get_current_student)):
    """交聊天里的练习: 服务器判分(答案不下发),第一次交的记进小鹰老师的笔记;
    feedback=True 时前端接着用 quiz_id 问一句,让小鹰老师点评(services/tutor_quiz)"""
    from app.services import tutor_quiz

    await check_rate(str(student.id), "tutor_quiz", [(60, 20)])
    answers = [a if isinstance(a, int) and not isinstance(a, bool) else str(a or "")[:200] for a in body.answers]
    try:
        return await tutor_quiz.submit(db, student.id, quiz_id, answers)
    except tutor_quiz.QuizNotFound:
        raise HTTPException(404, "没有这份练习")


async def _with_pictures(db: AsyncSession, msgs: list[dict]) -> list[dict]:
    """消息里存的图片卡是画图那一刻的状态(pending),读的时候换成现在的"""
    from app.models.tutor import WordPicture

    ids = {c["pic_id"] for m in msgs for c in m["cards"] if c.get("type") == "picture" and c.get("pic_id")}
    if not ids:
        return msgs
    pics = {p.id: wp.out(p) for p in (await db.execute(select(WordPicture).where(WordPicture.id.in_(ids)))).scalars()}
    for m in msgs:
        m["cards"] = [({**c, "status": pics[c["pic_id"]]["status"], "url": pics[c["pic_id"]]["url"]}
                       if c.get("type") == "picture" and c.get("pic_id") in pics else c) for c in m["cards"]]
    return msgs


async def _mark_refunded(db: AsyncSession, um_id: int) -> None:
    await db.execute(update(TutorMessage).where(TutorMessage.id == um_id).values(cost=tt.COST_REFUNDED)
                     .execution_options(synchronize_session=False))
    await db.commit()


async def _care_refund(db: AsyncSession, user_id: int, um_id: int, cost: int) -> None:
    """小鹰老师判断孩子在说难过的事(调了 flag_concern): 这一问退回次数,记成 COST_CARE(一天 CARE_DAILY 次)"""
    from app.services import tutor_safety
    if not await tutor_safety.care_is_free(user_id):
        return
    await db.execute(update(TutorMessage).where(TutorMessage.id == um_id).values(cost=tt.COST_CARE)
                     .execution_options(synchronize_session=False))
    await db.commit()
    await tt.refund(db, user_id, cost)


async def _release_feedback(db: AsyncSession, quiz_id: int) -> None:
    from app.services import tutor_quiz
    await tutor_quiz.release_feedback(db, quiz_id)


async def _run_answer(queue: asyncio.Queue, user_id: int, conv_id: int, um_id: int, conf: tt.RelayConf,
                      system: list[dict], messages: list[dict], title: Optional[str], mode: str, cost: int,
                      ctx: Optional[dict] = None, feedback_quiz_id: Optional[int] = None,
                      review_claimed: bool = False, refund_fn=None, followup: bool = True) -> None:
    """在后台任务里跑模型、写库。孩子关了页面也跑完(回答落库,老师看得到)。
    refund_fn(db): 退回次数的另一种办法(教师端退老师本月的和机构池,services/teacher_tutor);None = 退学生的次数"""
    async def give_back(db_):
        if refund_fn is not None:
            await refund_fn(db_)
        elif cost:
            await tt.refund(db_, user_id, cost)

    async def emit(ev: dict):
        await queue.put(ev)

    async def should_stop() -> bool:
        return bool(await store.get(_stop_key(um_id)))

    try:
        async with session_factory() as db:
            user = await db.get(User, user_id)
            turn = await tt.answer(db, user, conf, system, messages, emit, mode=mode, should_stop=should_stop, ctx=ctx)
            text = tt.plain(turn.text.strip())
            failed = bool(turn.error) and not text
            # 停下时一个字没出 = 孩子什么都没拿到,和没调通一样退回
            refunded = failed or (turn.stopped and not text and not turn.cards)
            msg = TutorMessage(
                conversation_id=conv_id, user_id=user_id, role="assistant", text=text, mode=mode,
                cards=turn.cards or None, tools=",".join(turn.tools)[:200] or None, model=turn.model,
                input_tokens=turn.usage["input_tokens"], output_tokens=turn.usage["output_tokens"],
                cache_read_tokens=turn.usage["cache_read_input_tokens"],
                cache_write_tokens=turn.usage["cache_creation_input_tokens"],
                error=(turn.error or (STOPPED if turn.stopped else None) or "")[:200] or None,
            )
            db.add(msg)
            conv = await db.get(TutorConversation, conv_id)
            if conv is not None:
                conv.message_count = (conv.message_count or 0) + 1
                conv.updated_at = utc_now()
                if title and not conv.title:
                    conv.title = title
            await db.commit()
            if not refunded and cost and "flag_concern" in turn.tools:
                await _care_refund(db, user_id, um_id, cost)
            if refunded:
                await _mark_refunded(db, um_id)
                if cost:
                    await give_back(db)
                if feedback_quiz_id:
                    await _release_feedback(db, feedback_quiz_id)
                if review_claimed:
                    from app.services import tutor_notes
                    await tutor_notes.release_review(user_id)
            if failed:
                await queue.put({"type": "error", "message": BUSY_MSG, "refunded": True})
            else:
                await queue.put({"type": "done", "message_id": msg.id, "stopped": turn.stopped,
                                 "refunded": refunded,
                                 "followup": await tt.followup_state(db, conv_id) if followup else None})
    except Exception:  # noqa: BLE001
        logger.exception("学习助手回答失败 user=%s conv=%s", user_id, conv_id)
        with contextlib.suppress(Exception):
            async with session_factory() as db2:
                await _mark_refunded(db2, um_id)
                if cost:
                    await give_back(db2)
                if feedback_quiz_id:
                    await _release_feedback(db2, feedback_quiz_id)
                if review_claimed:
                    from app.services import tutor_notes
                    await tutor_notes.release_review(user_id)
        await queue.put({"type": "error", "message": BUSY_MSG, "refunded": True})
    finally:
        with contextlib.suppress(Exception):
            await store.delete(_stop_key(um_id))
        await queue.put(None)


@student_router.post("/tutor/voice")
async def upload_voice(audio: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                       student: User = Depends(get_current_student)):
    """「按住说话」: 录音进转写队列,返回 id;前端每秒问 GET /tutor/voice/{id} 拿文字(services/tutor_voice)"""
    from app.services import sentence_speech, tutor_voice
    ok, reason, _ = await _availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    if not sentence_speech.is_available():
        raise HTTPException(503, "服务器暂时听不了语音,打字问吧")
    ext = tutor_voice.ext_for(audio.content_type)
    if ext is None:
        raise HTTPException(400, "这段录音的格式不支持,打字问吧")
    raw = await audio.read(tutor_voice.MAX_BYTES + 1)
    if not raw:
        raise HTTPException(400, "没录到声音,再按住说一次")
    if len(raw) > tutor_voice.MAX_BYTES:
        raise HTTPException(400, f"说得太长了,一次说 {tutor_voice.MAX_SECONDS} 秒以内")
    await check_rate(str(student.id), "tutor_voice", [(60, 10), (3600, 60)])
    clip = await tutor_voice.save(db, student.id, raw, ext)
    return {"id": clip.id, "status": clip.status}


@student_router.get("/tutor/voice/{clip_id}")
async def voice_result(clip_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    from app.models.tutor import TutorVoiceClip
    c = await db.get(TutorVoiceClip, clip_id)
    if c is None or c.user_id != student.id:
        raise HTTPException(404, "没有这段录音")
    return {"id": c.id, "status": c.status, "text": c.text or ""}


async def _read_uploads(image: Optional[UploadFile], file: Optional[UploadFile]):
    """照片压缩成 JPEG;文件(PDF / Word / txt,services/tutor_files)只取文字给模型看,不存。学生端、教师端共用"""
    from app.services import tutor_files

    img: Optional[tuple[str, str]] = None
    if image is not None and image.filename:
        if (image.content_type or "").lower() not in IMAGE_MIME:
            raise HTTPException(400, "只能发 jpg / png 照片")
        raw = await image.read(IMAGE_MAX_BYTES + 1)
        if len(raw) > IMAGE_MAX_BYTES:
            raise HTTPException(400, "照片太大了,换一张小一点的")
        try:
            img = await asyncio.to_thread(tt.prepare_image, raw)
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "这张照片打不开,换一张试试")
    doc = None
    if file is not None and file.filename:
        if img is not None:
            raise HTTPException(400, "照片和文件一次只能发一样")
        raw_f = await file.read(tutor_files.MAX_BYTES + 1)
        try:
            doc = await tutor_files.extract(file.filename, raw_f)
        except tutor_files.FileRejected as e:
            raise HTTPException(400, str(e))
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "这份文件打不开,换一份试试")
    return img, doc


def _content_blocks(img, doc, ask_text: str) -> list[dict]:
    content: list[dict] = []
    if img is not None:
        content.append({"type": "image", "source": {"type": "base64", "media_type": img[1], "data": img[0]}})
    if doc is not None:
        content.append({"type": "text", "text": doc.prompt_block()})
        for b64, mime in doc.images:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
    content.append({"type": "text", "text": ask_text})
    return content


@student_router.post("/tutor/ask")
async def ask(
    text: str = Form(""),
    conversation_id: Optional[int] = Form(None),
    mode: str = Form("fast"),
    image: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    quiz_id: Optional[int] = Form(None),
    care: bool = Form(False),
    review_note_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    ok, reason, settings = await _availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    conf = await tt.relay_conf(db)
    conf.pictures = await wp.available(db)
    if mode not in tt.MODES:
        mode = "fast"
    if mode == "deep" and not conf.deep_enabled:
        raise HTTPException(400, "深度思考现在没开,先用快速回答吧")
    cost = tt.cost_of(mode, settings)
    text = (text or "").strip()
    if len(text) > tt.MAX_TEXT:
        raise HTTPException(400, f"一次最多写 {tt.MAX_TEXT} 个字,分开问吧")

    img, doc = await _read_uploads(image, file)
    # 做完聊天里的练习、请小鹰老师点评(services/tutor_quiz): 题目和对错由服务器从库里拼,不信前端传的
    from app.services import tutor_quiz
    fq = None
    if quiz_id:
        fq = await db.get(tutor_quiz.TutorQuiz, quiz_id)
        if fq is None or fq.user_id != student.id or fq.submitted_at is None:
            raise HTTPException(404, "没有这份练习")
        if fq.feedback_at is not None:
            raise HTTPException(409, "这份练习已经讲过了")
        mode, img, doc = "fast", None, None
        text = tutor_quiz.feedback_display(fq)
        conversation_id = fq.conversation_id or conversation_id
    # 首页「考考你」(services/tutor_notes): 考哪个点由服务器从笔记里拼,不信前端传的字
    from app.services import tutor_notes
    rn = None
    if review_note_id and fq is None:
        rn = await tutor_notes.review_note(db, student.id, review_note_id)
        if rn is None:
            raise HTTPException(404, "这个点今天不用考了")
        mode, img, doc = "fast", None, None
        text = f"考考我: {rn.topic}"
    if not text and img is None and doc is None:
        raise HTTPException(400, "先写下你想问的")

    conv: Optional[TutorConversation] = None
    if conversation_id:
        conv = await _own_conversation(db, student, conversation_id)

    from app.services import tutor_safety
    # 孩子说到难过、被欺负、想伤害自己(services/tutor_safety): 只看孩子自己写的字,练习点评那条不看
    concern = tutor_safety.detect(text) if fq is None else None
    # 次数用完了的孩子点「想说说心里话」进来的(care=1): 只回应心里话,不讲题(CARE_BUTTON_NOTE),一天最多 CARE_BUTTON_DAILY 次
    care_button = bool(care) and fq is None and img is None and doc is None
    stored_cost = None
    if concern is not None and await tutor_safety.care_is_free(student.id):
        # 这一问不扣次数,也不算追问(次数用完了也能说);一天最多 CARE_DAILY 次,超了照常扣
        cost, stored_cost = 0, tt.COST_CARE
    elif care_button and await tutor_safety.care_button_is_free(student.id):
        cost, stored_cost = 0, tt.COST_CARE
    elif fq is not None and fq.free_feedback:
        # 做完练习后的点评不扣次数,也不占「同一道题追问」那 3 次(用户 10-27)
        cost, stored_cost = 0, tt.COST_FEEDBACK
    elif rn is not None:
        # 首页「考考你」: 今天第一次不扣(一天 REVIEW_DAILY 次,限速之后再占,见下面);超了照常扣
        cost, stored_cost = 0, tt.COST_REVIEW
    elif conv is not None and mode == "fast" and img is None and doc is None and await tt.followup_state(db, conv.id):
        # 同一道题的追问(快速回答、没有新照片)不另算,见 services/tutor 文件头「收费」
        cost = 0

    # 限速(防连点 / 脚本)在前,次数在后: 被限速的那一下不该扣次数
    await check_rate(str(student.id), "tutor", [(60, 6), (3600, 60)])
    review_claimed = False
    if rn is not None:
        review_claimed = await tutor_notes.claim_review(student.id)
        if not review_claimed:
            cost, stored_cost = tt.cost_of("fast", settings), None
    if fq is not None:
        # 一份练习只点评一次: 条件 UPDATE 认领,两个请求同时到只有一个拿到
        fq = await tutor_quiz.claim_feedback(db, student.id, fq.id)
        await db.commit()
        if fq is None:
            raise HTTPException(409, "这份练习已经讲过了")
    if cost and not await tt.consume(db, student.id, cost, await tt.free_for(db, student.org_id, settings)):
        if fq is not None:
            await tutor_quiz.release_feedback(db, fq.id)
        left = (await tt.allowance_status(db, student.id, settings, student.org_id))["left"]
        if mode == "deep" and left > 0:
            raise HTTPException(429, f"深度思考一次算 {cost} 次,你还剩 {left} 次,先用快速回答吧")
        raise HTTPException(429, "次数用完了,点「请老师加次数」让老师给你加")

    try:
        # 次数那一行先建好: 没有这一行时「用了几次」按收到过几次回答现算(10-26 第一版的口径),
        # 第一问就是不扣次数的(考考你 / 说心里话)会被算成用了 1 次
        await tt._ensure_allowance(db, student.id)
        title = None
        if conv is None:
            conv = TutorConversation(user_id=student.id, org_id=student.org_id, title="",
                                     message_count=0, updated_at=utc_now())
            db.add(conv)
            await db.flush()
        if not conv.title:
            title = tt.make_title(text, img is not None, doc.name if doc else None)
        um = TutorMessage(conversation_id=conv.id, user_id=student.id, role="user",
                          text=text, has_image=img is not None, mode=mode,
                          cards=[doc.card()] if doc else None,
                          cost=stored_cost if stored_cost is not None else cost)
        db.add(um)
        conv.message_count = (conv.message_count or 0) + 1
        conv.updated_at = utc_now()
        await db.flush()
        if concern is not None:
            # 和提问同一个事务: 提问落库了,提醒一定在
            await tutor_safety.record(db, user_id=student.id, org_id=student.org_id, conversation_id=conv.id,
                                      message_id=um.id, level=concern[0], source="keyword", matched=concern[1],
                                      excerpt=text)
        history = await tt.history_messages(db, conv.id, um.id)
        context = await tt.student_context(db, student)
        conv_id, um_id = conv.id, um.id
        await db.commit()
    except Exception:
        await db.rollback()
        if cost:
            await tt.refund(db, student.id, cost)
        if fq is not None:
            await tutor_quiz.release_feedback(db, fq.id)
        if review_claimed:
            await tutor_notes.release_review(student.id)
        raise

    content: list[dict] = []
    if img is not None:
        content.append({"type": "image", "source": {"type": "base64", "media_type": img[1], "data": img[0]}})
    if doc is not None:
        content.append({"type": "text", "text": doc.prompt_block()})
        for b64, mime in doc.images:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
    if fq is not None:
        ask_text = tutor_quiz.feedback_prompt(fq)
    elif rn is not None:
        ask_text = tutor_notes.review_prompt(rn)
    elif doc is not None:
        ask_text = text or "帮我看看这份文件"
    else:
        ask_text = text or "帮我看看这道题"
    content.append({"type": "text", "text": ask_text})
    messages = history + [{"role": "user", "content": content}]
    if concern is not None:
        context += "\n\n" + tt.CARE_NOTE
    if care_button and stored_cost == tt.COST_CARE and concern is None:
        context += "\n\n" + tt.CARE_BUTTON_NOTE
    if fq is None and rn is None and text:
        # 问到的词先按课本查好,省掉一轮 lookup_word(services/tutor「提速」)
        pre = await tt.prefetch_words(db, text)
        if pre:
            context += "\n\n" + pre
    system = tt.build_system(context, mode)
    left = (await tt.allowance_status(db, student.id, settings, student.org_id))["left"]

    queue: asyncio.Queue = asyncio.Queue()
    ctx = {"conversation_id": conv_id, "is_feedback": fq is not None and bool(fq.free_feedback),
           "user_message_id": um_id, "user_text": text}
    task = asyncio.create_task(_run_answer(queue, student.id, conv_id, um_id, conf, system, messages, title, mode, cost,
                                           ctx, fq.id if fq is not None else None, review_claimed))
    _running.add(task)
    task.add_done_callback(_running.discard)

    async def gen():
        yield _sse({"type": "meta", "conversation_id": conv_id, "user_message_id": um_id, "left": left,
                    "mode": mode, "cost": cost})
        while True:
            ev = await queue.get()
            if ev is None:
                break
            yield _sse(ev)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- 老师(只读,本班)

@teacher_router.get("/tutor/available")
async def teacher_tutor_available(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """本校学生能不能用学习助手(公告按它决定弹不弹,试用期只开直营)+ 几个本班学生在请求加次数(工作台提醒)"""
    enabled = await tt.available_to(db, teacher)
    requested = 0
    ids = [s[0] for s in await _my_class_students(db, teacher.id)]
    if enabled:
        if ids:
            requested = int((await db.execute(
                select(func.count(TutorAllowance.user_id))
                .where(TutorAllowance.user_id.in_(ids), TutorAllowance.requested_at.isnot(None))
            )).scalar() or 0)
    # 需要关心的孩子(services/tutor_safety): 本班没处理的,urgent 单独数(工作台红条)
    alerts = await _alert_counts(db, ids)
    # 要请老师当面讲的点(services/tutor_notes「交给老师」)
    from app.services import teacher_tutor as tch, tutor_notes
    handoffs = await tutor_notes.handoff_count(db, ids) if enabled else 0
    me_ok, _ = await tch.availability(db, teacher)
    return {"enabled": enabled, "requested": requested, "alerts": alerts, "handoffs": handoffs, "me_enabled": me_ok}


async def _alert_counts(db: AsyncSession, student_ids: list[int]) -> dict:
    from app.models.tutor import TutorAlert
    if not student_ids:
        return {"open": 0, "urgent": 0}
    rows = dict((await db.execute(
        select(TutorAlert.level, func.count(TutorAlert.id))
        .where(TutorAlert.user_id.in_(student_ids), TutorAlert.handled_at.is_(None))
        .group_by(TutorAlert.level))).all())
    return {"open": int(sum(rows.values())), "urgent": int(rows.get("urgent", 0))}


GRANT_MAX = 100   # 老师一次最多加几次


async def _my_class_students(db: AsyncSession, teacher_id: int) -> list[tuple[int, str, str, str]]:
    """本班在读学生 (id, 用户名, 姓名, 班级名);一个孩子在几个班只列第一个班"""
    rows = (await db.execute(
        select(User.id, User.username, User.full_name, Class.name)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher_id, ClassStudent.is_active.is_(True), User.role == "student")
        .order_by(Class.name, User.id)
    )).all()
    seen: set[int] = set()
    out = []
    for uid, uname, fname, cname in rows:
        if uid not in seen:
            seen.add(uid)
            out.append((uid, uname, fname or "", cname))
    return out


@teacher_router.get("/tutor/students")
async def teacher_tutor_students(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """本班学生的学习助手次数: 送了几次 / 老师加了几次 / 用了几次 / 还剩几次 / 有没有在请求加。
    请求加的排最前,其次剩得少的"""
    settings = await tt.get_settings(db)
    free = await tt.free_for(db, teacher.org_id, settings)    # 老政策加盟机构不送免费次数(用户 10-27)
    students = await _my_class_students(db, teacher.id)
    ids = [s[0] for s in students]
    rows = {}
    asked = {}
    if ids:
        rows = {r.user_id: r for r in (await db.execute(
            select(TutorAllowance).where(TutorAllowance.user_id.in_(ids)))).scalars().all()}
        asked = dict((await db.execute(
            select(TutorMessage.user_id, func.count(TutorMessage.id))
            .where(TutorMessage.user_id.in_(ids), TutorMessage.role == "user")
            .group_by(TutorMessage.user_id))).all())
    items = []
    for uid, uname, fname, cname in students:
        r = rows.get(uid)
        used, extra = (r.used, r.extra) if r else (0, 0)
        total = free + extra
        items.append({"id": uid, "username": uname, "full_name": fname, "class_name": cname,
                      "used": used, "extra": extra, "total": total, "left": max(0, total - used),
                      "questions": int(asked.get(uid, 0)),
                      "requested_at": r.requested_at.isoformat() if r and r.requested_at else None})
    items.sort(key=lambda x: (x["requested_at"] is None, x["left"], x["class_name"]))
    # 加盟机构: 老师加的次数从机构次数池里扣,页面上写明池里还剩几次;直营没有池子(None)
    pool = await tt.pool_status(db, teacher.org_id) if tt.uses_pool(teacher.org_id) else None
    return {"free_total": free, "deep_cost": settings["deep_cost"],
            "enabled": await tt.scope_allows(db, settings["scope"], teacher), "items": items,
            "requested": sum(1 for x in items if x["requested_at"]), "pool": pool,
            "card_times": tt.CARD_TUTOR_TIMES}


class GrantIn(BaseModel):
    student_ids: list[int] = Field(..., min_length=1, max_length=200)
    add: int = Field(..., ge=1, le=GRANT_MAX)


@teacher_router.post("/tutor/grant")
async def teacher_tutor_grant(body: GrantIn, request: Request, db: AsyncSession = Depends(get_db),
                              teacher: User = Depends(get_current_teacher)):
    """给本班学生加次数。有一个不是本班的整批 403(和陪跑批量发点评同口径)。
    加盟机构从机构次数池里扣(合同第三条第 10 款: 机构向平台按次进货),池里不够整批 409、一个都不加;
    直营不走池子"""
    org_id = teacher.org_id
    mine = {s[0] for s in await _my_class_students(db, teacher.id)}
    ids = sorted(set(body.student_ids))
    if any(i not in mine for i in ids):
        raise HTTPException(403, "只能给自己班的学生加")
    incs = await tt.plan_grant(db, ids, body.add)
    need = sum(incs.values())
    if tt.uses_pool(org_id) and need > 0 and not await tt.take_from_pool(db, org_id, need):
        # 没 commit 就抛: 刚才建的空行跟着会话一起丢,不用 rollback(rollback 会让 teacher 过期)
        left = (await tt.pool_status(db, org_id))["left"]
        raise HTTPException(409, f"本机构的学习助手次数还剩 {left} 次,这次要 {need} 次,不够加。"
                                 "请机构管理员向平台购买次数后再加")
    await tt.apply_grant(db, incs, teacher.id)
    capped = sum(1 for v in incs.values() if v < body.add)
    audit_log.record(db, request, teacher, "tutor.grant",
                     f"给 {len(ids)} 个学生各加学习助手 {body.add} 次" + (f"(从机构次数池扣 {need} 次)" if tt.uses_pool(org_id) else ""),
                     target_type="user", target_id=ids[0] if len(ids) == 1 else None,
                     detail={"student_ids": ids, "add": body.add, "added": incs, "pool_used": need if tt.uses_pool(org_id) else 0})
    await db.commit()
    pool = await tt.pool_status(db, org_id) if tt.uses_pool(org_id) else None
    return {"ok": True, "count": len(ids), "added": need, "capped": capped, "pool": pool}


@teacher_router.get("/students/{student_id}/tutor")
async def student_tutor_log(student_id: int, limit: int = Query(20, ge=1, le=50),
                            db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    await assert_student_in_my_class(db, teacher.id, student_id)
    convs = (await db.execute(
        select(TutorConversation).where(TutorConversation.user_id == student_id)
        .order_by(TutorConversation.updated_at.desc(), TutorConversation.id.desc()).limit(limit)
    )).scalars().all()
    ids = [c.id for c in convs]
    by_conv: dict[int, list[dict]] = {i: [] for i in ids}
    if ids:
        for m in (await db.execute(
            select(TutorMessage).where(TutorMessage.conversation_id.in_(ids)).order_by(TutorMessage.id)
        )).scalars().all():
            by_conv[m.conversation_id].append(_msg_out(m))
    total = (await db.execute(
        select(func.count(TutorMessage.id)).where(TutorMessage.user_id == student_id, TutorMessage.role == "user")
    )).scalar() or 0
    # 助手看到的这个孩子的学情(老师能看到助手知道什么);没问过的学生不算(省一次查询)
    profile = None
    if total:
        from app.services.tutor_profile import profile_lines
        student = await db.get(User, student_id)
        if student is not None:
            profile = await profile_lines(db, student)
    from app.services import tutor_quiz
    for c in convs:
        by_conv[c.id] = await tutor_quiz.attach(db, await _with_pictures(db, by_conv[c.id]), teacher=True)
    from app.models.tutor import TutorAlert
    from app.services import tutor_safety
    alerts = [tutor_safety.out(a) for a in (await db.execute(
        select(TutorAlert).where(TutorAlert.user_id == student_id).order_by(TutorAlert.id.desc()).limit(10)
    )).scalars().all()]
    return {"total_questions": int(total), "profile": profile, "alerts": alerts,
            "items": [{"id": c.id, "title": c.title or "新对话",
                       "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                       # 孩子删掉的老师 30 天内还看得到(services/tutor_history),标出来
                       "deleted": c.deleted_at is not None, "starred": bool(c.starred),
                       "messages": by_conv[c.id]} for c in convs],
            "prefs": await _level_or_none(db, student_id)}


async def _level_or_none(db: AsyncSession, student_id: int) -> Optional[dict]:
    from app.services import tutor_level

    student = await db.get(User, student_id)
    return await tutor_level.level_info(db, student) if student is not None else None


@teacher_router.put("/students/{student_id}/tutor-prefs")
async def set_student_tutor_prefs(student_id: int, body: TutorPrefsIn, db: AsyncSession = Depends(get_db),
                                  teacher: User = Depends(get_current_teacher)):
    """老师替本班学生设年级 / 讲解方式(学生也能自己改,后设的为准)"""
    await assert_student_in_my_class(db, teacher.id, student_id)
    student = await db.get(User, student_id)
    if student is None:
        raise HTTPException(404, "没有这个学生")
    return await _save_prefs(db, student, body, "teacher")


# ---------------------------------------------------------------- 管理端

class TutorAdminIn(BaseModel):
    scope: str = Field(..., pattern="^(off|hq|pack|all)$")
    free_total: int = Field(..., ge=1, le=1000)
    deep_cost: int = Field(2, ge=1, le=10)
    model: Optional[str] = Field(None, max_length=100)
    fallback_model: Optional[str] = Field(None, max_length=100)
    # 深度思考的模型: 空串 = 关掉深度思考(显式分支,不能当成「没填」)
    deep_model: Optional[str] = Field(None, max_length=100)
    deep_fallback_model: Optional[str] = Field(None, max_length=100)
    base_url: Optional[str] = Field(None, max_length=255)
    # 留空 = 不改(显式分支,见 CLAUDE.md「留空=不修改」那条)
    api_key: Optional[str] = Field(None, max_length=400)
    # 画记忆图(services/word_picture): 单独一个 Key,和答题那个分开;都留空 = 不动
    picture_enabled: Optional[bool] = None
    picture_daily_limit: Optional[int] = Field(None, ge=1, le=50)
    picture_model: Optional[str] = Field(None, max_length=100)
    picture_quality: Optional[str] = Field(None, pattern="^(low|medium|high)$")
    picture_base_url: Optional[str] = Field(None, max_length=255)
    picture_api_key: Optional[str] = Field(None, max_length=400)


async def _provider_row(db: AsyncSession) -> Optional[AIProvider]:
    return (await db.execute(select(AIProvider).where(AIProvider.provider_name == tt.PROVIDER_NAME))).scalar_one_or_none()


async def _admin_state(db: AsyncSession) -> dict:
    from app.api.v1.admin.ai_config import decrypt_api_key, mask_api_key

    settings = await tt.get_settings(db)
    row = await _provider_row(db)
    key = decrypt_api_key(row.api_key) if row and row.api_key else ""
    return {
        **settings,
        "provider": None if row is None else {
            "enabled": bool(row.enabled),
            "base_url": row.base_url,
            "model": row.model_name,
            "fallback_model": (row.extra_config or {}).get("fallback_model"),
            "deep_model": tt._extra_model(row.extra_config or {}, "deep_model", tt.DEFAULT_DEEP_MODEL),
            "deep_fallback_model": tt._extra_model(row.extra_config or {}, "deep_fallback_model",
                                                   tt.DEFAULT_DEEP_FALLBACK),
            "api_key_masked": mask_api_key(key) if key and key != "DECRYPTION_FAILED" else "",
            "key_ok": bool(key) and key != "DECRYPTION_FAILED",
        },
        "usage": await tt.usage_summary(db, days=7),
        "picture": await _picture_state(db),
        "teacher": await _teacher_state(db),
    }


async def _teacher_state(db: AsyncSession) -> dict:
    from app.services import teacher_tutor as tch
    return {**await tch.get_settings(db), **await tch.month_summary(db), "price": tt.POOL_PRICE}


async def _picture_state(db: AsyncSession) -> dict:
    from app.api.v1.admin.ai_config import decrypt_api_key, mask_api_key
    from app.models.tutor import WordPicture

    ps = await wp.get_settings(db)
    row = await wp.provider_row(db)
    key = decrypt_api_key(row.api_key) if row and row.api_key else ""
    counts = dict((await db.execute(select(WordPicture.status, func.count(WordPicture.id))
                                    .group_by(WordPicture.status))).all())
    return {**ps, "cost": wp.COST, "counts": counts,
            "provider": None if row is None else {
                "model": row.model_name, "base_url": row.base_url,
                "quality": (row.extra_config or {}).get("quality") or wp.DEFAULT_QUALITY,
                "api_key_masked": mask_api_key(key) if key and key != "DECRYPTION_FAILED" else "",
                "key_ok": bool(key) and key != "DECRYPTION_FAILED"}}


@admin_router.get("/tutor")
async def admin_tutor(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    return await _admin_state(db)


@admin_router.get("/tutor/health")
async def admin_tutor_health(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    """中转钱包余额、两个 Key 还能不能用、最近 1 小时失败几次(services/tutor_relay_health)"""
    from app.services import tutor_relay_health
    return await tutor_relay_health.last(db)


@admin_router.post("/tutor/health/check")
async def admin_tutor_health_check(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    from app.services import tutor_relay_health
    await tutor_relay_health.check(db)
    return await tutor_relay_health.last(db)


@admin_router.put("/tutor")
async def admin_tutor_update(body: TutorAdminIn, request: Request, db: AsyncSession = Depends(get_db),
                             admin: User = Depends(get_current_admin)):
    from app.api.v1.admin.ai_config import encrypt_api_key

    row = await _provider_row(db)
    key = (body.api_key or "").strip()
    if row is None and (key or body.model):
        if not key or not body.model:
            raise HTTPException(400, "第一次配置要同时填密钥和模型")
        row = AIProvider(provider_name=tt.PROVIDER_NAME, display_name="Claude(学习助手专用)",
                         enabled=True, is_default=False, extra_config={})
        db.add(row)
    if row is not None:
        if key and "***" not in key and "..." not in key:
            row.api_key = encrypt_api_key(key)
        if body.model is not None and body.model.strip():
            row.model_name = body.model.strip()
        if body.base_url is not None:
            row.base_url = body.base_url.strip() or None
        extra = dict(row.extra_config or {})
        if body.fallback_model is not None:
            fb = body.fallback_model.strip()
            if fb:
                extra["fallback_model"] = fb
            else:
                extra.pop("fallback_model", None)
        # 深度思考两个模型: 传了就存(空串也存 = 关掉);没传不动
        for k in ("deep_model", "deep_fallback_model"):
            v = getattr(body, k)
            if v is not None:
                extra[k] = v.strip()
        row.extra_config = extra
        row.is_default = False     # 永远不当默认(见 admin/ai_config.TUTOR_PROVIDER)
    await tt.save_settings(db, body.scope, body.free_total, body.deep_cost)
    pic_changed = await _save_picture(db, body)
    conf_extra = (row.extra_config or {}) if row else {}
    audit_log.record(db, request, admin, "system.tutor",
                     f"学习助手: 开放范围 {dict(off='关闭', hq='只开直营', pack='直营 + 卡包机构', all='全部机构')[body.scope]},"
                     f"每个学生送 {body.free_total} 次,深度思考算 {body.deep_cost} 次" + (",换了密钥" if key else "")
                     + (f",画图: {pic_changed}" if pic_changed else ""),
                     detail={"scope": body.scope, "free_total": body.free_total, "deep_cost": body.deep_cost,
                             "model": row.model_name if row else None,
                             "fallback_model": conf_extra.get("fallback_model"),
                             "deep_model": conf_extra.get("deep_model"),
                             "deep_fallback_model": conf_extra.get("deep_fallback_model")})
    await db.commit()
    # 换了 Key / 地址: 上次的检查结果不作数了,下次打开卡片重新查
    from app.services import tutor_relay_health
    await store.delete(tutor_relay_health.STORE_KEY)
    return await _admin_state(db)


async def _save_picture(db: AsyncSession, body: TutorAdminIn) -> str:
    """画图那一组设置;返回改了什么(写进操作记录,不含密钥)"""
    from app.api.v1.admin.ai_config import encrypt_api_key

    changed: list[str] = []
    ps = await wp.get_settings(db)
    enabled = ps["enabled"] if body.picture_enabled is None else body.picture_enabled
    limit = ps["daily_limit"] if body.picture_daily_limit is None else body.picture_daily_limit
    if (enabled, limit) != (ps["enabled"], ps["daily_limit"]):
        await wp.save_settings(db, enabled, limit)
        changed.append(f"{'开' if enabled else '关'},每人每天 {limit} 张")
    row = await wp.provider_row(db)
    key = (body.picture_api_key or "").strip()
    if row is None and key:
        row = AIProvider(provider_name=wp.PROVIDER_NAME, display_name="画记忆图(学习助手专用)",
                         enabled=True, is_default=False, model_name=wp.DEFAULT_MODEL,
                         base_url="https://hk.hueling.cc", extra_config={"quality": wp.DEFAULT_QUALITY})
        db.add(row)
    if row is None:
        return ";".join(changed)
    if key and "***" not in key and "..." not in key:
        row.api_key = encrypt_api_key(key)
        changed.append("换了密钥")
    if body.picture_model is not None and body.picture_model.strip():
        row.model_name = body.picture_model.strip()
        changed.append(f"模型 {row.model_name}")
    if body.picture_base_url is not None and body.picture_base_url.strip():
        row.base_url = body.picture_base_url.strip()
    if body.picture_quality is not None:
        row.extra_config = {**(row.extra_config or {}), "quality": body.picture_quality}
    row.is_default = False     # 永远不当默认(见 admin/ai_config.DEDICATED_PROVIDERS)
    return ";".join(changed)


@admin_router.put("/tutor/teacher")
async def admin_teacher_tutor_update(body: TeacherTutorAdminIn, request: Request, db: AsyncSession = Depends(get_db),
                                     admin: User = Depends(get_current_admin)):
    """教师端小鹰老师: 开不开、每位老师每月几次(services/teacher_tutor)"""
    from app.services import teacher_tutor as tch
    await tch.save_settings(db, body.enabled, body.monthly)
    audit_log.record(db, request, admin, "system.teacher_tutor",
                     f"教师端小鹰老师: {'开' if body.enabled else '关'},每位老师每月 {body.monthly} 次",
                     detail={"enabled": body.enabled, "monthly": body.monthly})
    await db.commit()
    return await _teacher_state(db)


@admin_router.get("/tutor/pictures")
async def admin_pictures(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    from app.models.tutor import WordPicture

    # 删掉的不列(用户 10-27「图片删除了占位图也不要了」);有人再点画,这一行回到 pending 又会出现
    rows = (await db.execute(select(WordPicture).where(WordPicture.status != "removed")
                             .order_by(WordPicture.id.desc()).limit(60))).scalars().all()
    return {"items": [{**wp.out(p), "model": p.model,
                       "created_at": p.created_at.isoformat() if p.created_at else None} for p in rows]}


@admin_router.delete("/tutor/pictures/{pic_id}")
async def admin_remove_picture(pic_id: int, request: Request, db: AsyncSession = Depends(get_db),
                               admin: User = Depends(get_current_admin)):
    p = await wp.remove(db, pic_id, admin.id)
    if p is None:
        raise HTTPException(404, "没有这张图")
    audit_log.record(db, request, admin, "tutor.picture_remove", f"删掉记忆图「{p.word}」",
                     target_type="word_picture", target_id=pic_id, detail={"word": p.word, "meaning": p.meaning})
    await db.commit()
    return {"ok": True}


@admin_router.post("/tutor/test")
async def admin_tutor_test(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    conf = await tt.relay_conf(db)
    if conf is None:
        raise HTTPException(400, "还没配置密钥和模型")
    out = []
    targets = [("fast", m) for m in conf.chain("fast")] + [("deep", m) for m in conf.chain("deep")]
    async with tt.new_client() as cli:
        for mode, m in targets:
            t0 = asyncio.get_running_loop().time()
            body = {"model": m, "max_tokens": 64 if mode == "deep" else 8,
                    "messages": [{"role": "user", "content": "ping"}]}
            if mode == "deep":
                body["thinking"] = {"type": "adaptive"}
                body["output_config"] = {"effort": "low"}
            else:
                # 和真提问同一套参数(sonnet-5-5 要 between_tools),测出来的才是真能不能用
                body.update(tt.fast_thinking(m))
            try:
                r = await cli.post(f"{conf.base_url}/v1/messages", headers=tt._headers(conf), json=body)
                ok = r.status_code == 200
                if ok:
                    msg = "通"
                elif "No available accounts" in r.text:
                    msg = "中转这个分组暂时没有这个模型的号(会自动用备用)"
                elif r.status_code == 404:
                    msg = "中转没有这个模型,检查名字"
                else:
                    msg = f"{r.status_code} {r.text[:120]}"
            except httpx.HTTPError as e:
                ok, msg = False, type(e).__name__
            out.append({"model": m, "mode": mode, "ok": ok, "message": msg,
                        "ms": int((asyncio.get_running_loop().time() - t0) * 1000)})
    return {"results": out}


# ---------------------------------------------------------------- 管理端: 机构次数池(合同第三条第 10 款)

class PoolIn(BaseModel):
    # 正数 = 加次数;负数 = 扣回(录错了),最多扣到已经分给学生的那部分
    times: int = Field(..., ge=-100000, le=100000)
    note: Optional[str] = Field(None, max_length=200)
    # purchase = 机构付了钱(按 ¥0.3/次记金额)/ gift = 平台赠送(不收费、不受起订量)。扣回不看这个(10-27)
    source: str = Field("purchase", pattern="^(purchase|gift)$")


@admin_router.get("/tutor/pools")
async def admin_tutor_pools(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    rows = (await db.execute(select(TutorOrgPool))).scalars().all()
    return {"price": tt.POOL_PRICE, "min_buy": tt.POOL_MIN_BUY, "card_times": tt.CARD_TUTOR_TIMES,
            "items": {r.org_id: {"total": r.total, "used": r.used, "left": max(0, r.total - r.used)} for r in rows}}


@admin_router.get("/tutor/orgs")
async def admin_tutor_orgs(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    """平台总览: 每个机构开没开学习助手(为什么开)、机构次数池(进货 / 赠送 / 已分 / 还剩)、多少学生、多少人问过。
    给机构发次数在这里点进去(OrgTutorPoolDialog);发过次数的机构自动开通(services/tutor.org_open_reason)"""
    settings = await tt.get_settings(db)
    orgs = (await db.execute(select(Organization.id, Organization.name, Organization.status, Organization.card_plan)
                             .order_by(Organization.id))).all()
    students = dict((await db.execute(
        select(User.org_id, func.count(User.id)).where(User.role == "student", User.is_active.is_(True))
        .group_by(User.org_id).execution_options(skip_tenant_filter=True))).all())
    asked = dict((await db.execute(
        select(User.org_id, func.count(func.distinct(TutorMessage.user_id)))
        .join(User, User.id == TutorMessage.user_id).where(TutorMessage.role == "user", User.role == "student")
        .group_by(User.org_id).execution_options(skip_tenant_filter=True))).all())
    items = []
    for oid, name, status, plan in orgs:
        items.append({"id": oid, "name": name, "status": status, "card_plan": plan,
                      "open": await tt.org_open_reason(db, settings["scope"], oid),
                      "uses_pool": tt.uses_pool(oid),
                      "pool": await tt.pool_status(db, oid) if tt.uses_pool(oid) else None,
                      "free_per_student": await tt.free_for(db, oid, settings),
                      "students": int(students.get(oid, 0)), "asked_students": int(asked.get(oid, 0))})
    return {"scope": settings["scope"], "price": tt.POOL_PRICE, "min_buy": tt.POOL_MIN_BUY,
            "card_times": tt.CARD_TUTOR_TIMES, "items": items}


async def _pool_org(db: AsyncSession, org_id: int) -> Organization:
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "机构不存在")
    if not tt.uses_pool(org_id):
        raise HTTPException(400, "直营不用次数池,老师直接给学生加")
    return org


@admin_router.get("/tutor/pools/{org_id}")
async def admin_tutor_pool(org_id: int, db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    org = await _pool_org(db, org_id)
    ledger = (await db.execute(select(TutorPoolLedger).where(TutorPoolLedger.org_id == org_id)
                               .order_by(TutorPoolLedger.id.desc()).limit(50))).scalars().all()
    from app.services import teacher_tutor as tch
    return {"org_id": org_id, "org_name": org.name, **await tt.pool_status(db, org_id),
            "teacher_used": await tch.usage_by_org(db, org_id),
            "ledger": [{"id": r.id, "times": r.times, "source": r.source, "note": r.note,
                        "created_at": r.created_at.isoformat() if r.created_at else None} for r in ledger]}


@admin_router.post("/tutor/pools/{org_id}")
async def admin_tutor_pool_credit(org_id: int, body: PoolIn, request: Request, db: AsyncSession = Depends(get_db),
                                  admin: User = Depends(get_current_admin)):
    org = await _pool_org(db, org_id)
    org_name = org.name
    if body.times == 0:
        raise HTTPException(400, "次数不能是 0")
    if not await tt.credit_pool(db, org_id, body.times, body.note, admin.id, body.source):
        st = await tt.pool_status(db, org_id)
        raise HTTPException(409, f"已经有 {st['used']} 次分给学生了,最多只能扣回 {st['left']} 次")
    if body.times < 0:
        what = f"扣回 {-body.times} 次"
    elif body.source == "gift":
        what = f"平台赠送 {body.times} 次(不收费)"
    else:
        what = f"进货到账 {body.times} 次(¥{body.times * tt.POOL_PRICE:,.0f})"
    audit_log.record(db, request, admin, "org.tutor_pool", f"{org_name}: 学习助手次数{what}",
                     target_type="organization", target_id=org_id,
                     detail={"times": body.times, "note": body.note, "source": body.source if body.times > 0 else "adjust"})
    await db.commit()
    return await admin_tutor_pool(org_id, db, admin)


# ---------------------------------------------------------------- 需要关心的孩子(services/tutor_safety)

class AlertHandleIn(BaseModel):
    note: str = Field("", max_length=200)


async def _alerts_page(db: AsyncSession, where, status: str, limit: int) -> list[dict]:
    from app.models.tutor import TutorAlert
    from app.services import tutor_safety

    q = select(TutorAlert).where(*where)
    if status == "open":
        q = q.where(TutorAlert.handled_at.is_(None))
    elif status == "done":
        q = q.where(TutorAlert.handled_at.isnot(None))
    # 没处理的在前,urgent 在前,新的在前
    q = q.order_by(TutorAlert.handled_at.isnot(None), (TutorAlert.level != "urgent"), TutorAlert.id.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    uids = {a.user_id for a in rows}
    names, classes, orgs = {}, {}, {}
    if uids:
        for uid, uname, fname, oid in (await db.execute(
            select(User.id, User.username, User.full_name, User.org_id).where(User.id.in_(uids))
            .execution_options(skip_tenant_filter=True))).all():
            names[uid] = fname or uname
            orgs[uid] = oid
        for sid, cname in (await db.execute(
            select(ClassStudent.student_id, Class.name).join(Class, Class.id == ClassStudent.class_id)
            .where(ClassStudent.student_id.in_(uids), ClassStudent.is_active.is_(True))
            .execution_options(skip_tenant_filter=True))).all():
            classes.setdefault(sid, cname)
    org_names = {}
    oids = {o for o in orgs.values() if o}
    if oids:
        org_names = dict((await db.execute(select(Organization.id, Organization.name)
                                           .where(Organization.id.in_(oids)))).all())
    return [tutor_safety.out(a, names.get(a.user_id), classes.get(a.user_id), org_names.get(orgs.get(a.user_id)))
            for a in rows]


async def _handle_alert(db: AsyncSession, request: Request, actor: User, alert, note: str) -> dict:
    from app.core.actor import acting_user
    from app.services import tutor_safety

    if alert.handled_at is None:
        real = acting_user(actor)
        alert.handled_at = utc_now()
        alert.handled_by = real.id
        alert.handled_by_name = (real.full_name or real.username)[:60]
        alert.handled_note = (note or "").strip()[:200] or None
        audit_log.record(db, request, actor, "tutor.alert_handle",
                         f"处理了学习助手提醒(学生 {alert.user_id})", target_type="tutor_alert", target_id=alert.id,
                         detail={"level": alert.level, "note": alert.handled_note})
        await db.commit()
    return tutor_safety.out(alert)


@teacher_router.get("/tutor/alerts")
async def teacher_alerts(status: str = Query("open", pattern="^(open|done|all)$"), limit: int = Query(100, ge=1, le=200),
                         db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """本班孩子在学习助手里说到难过、被欺负、想伤害自己的(没处理的在前)"""
    from app.models.tutor import TutorAlert
    ids = [s[0] for s in await _my_class_students(db, teacher.id)]
    if not ids:
        return {"items": [], "counts": {"open": 0, "urgent": 0}}
    return {"items": await _alerts_page(db, [TutorAlert.user_id.in_(ids)], status, limit),
            "counts": await _alert_counts(db, ids)}


@teacher_router.post("/tutor/alerts/{alert_id}/handle")
async def teacher_handle_alert(alert_id: int, body: AlertHandleIn, request: Request,
                               db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    from app.models.tutor import TutorAlert
    a = await db.get(TutorAlert, alert_id)
    if a is None:
        raise HTTPException(404, "没有这条提醒")
    await assert_student_in_my_class(db, teacher.id, a.user_id)
    return await _handle_alert(db, request, teacher, a, body.note)


get_admin_or_org_admin = require_role("admin", "org_admin")


def _alert_scope(user: User):
    """平台管理员看全部;机构管理员只看本机构(TutorAlert 不是租户锚点表,机构过滤要显式写)"""
    from app.models.tutor import TutorAlert
    return [] if user.role == "admin" else [TutorAlert.org_id == user.org_id]


@admin_router.get("/tutor/alerts")
async def admin_alerts(status: str = Query("open", pattern="^(open|done|all)$"), limit: int = Query(100, ge=1, le=200),
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_admin_or_org_admin)):
    from app.models.tutor import TutorAlert
    where = _alert_scope(user)
    counts = dict((await db.execute(
        select(TutorAlert.level, func.count(TutorAlert.id)).where(*where, TutorAlert.handled_at.is_(None))
        .group_by(TutorAlert.level))).all())
    return {"items": await _alerts_page(db, where, status, limit),
            "counts": {"open": int(sum(counts.values())), "urgent": int(counts.get("urgent", 0))}}


@admin_router.post("/tutor/alerts/{alert_id}/handle")
async def admin_handle_alert(alert_id: int, body: AlertHandleIn, request: Request,
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_admin_or_org_admin)):
    from app.models.tutor import TutorAlert
    a = await db.get(TutorAlert, alert_id)
    if a is None or (user.role != "admin" and a.org_id != user.org_id):
        raise HTTPException(404, "没有这条提醒")
    return await _handle_alert(db, request, user, a, body.note)


# ---------------------------------------------------------------- 全班汇总 / 效果(services/tutor_insight)

@teacher_router.get("/tutor/summary")
async def teacher_tutor_summary(days: int = Query(7, ge=1, le=30),
                                db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """本班这几天: 谁问了几次、卡在哪、需要关心的孩子、问过的词后来拼对没有"""
    from app.services import tutor_insight
    return await tutor_insight.class_summary(db, await _my_class_students(db, teacher.id), days)


@admin_router.get("/tutor/effect")
async def admin_tutor_effect(db: AsyncSession = Depends(get_db), user: User = Depends(get_admin_or_org_admin)):
    from app.services import tutor_insight
    return await tutor_insight.effect(db, org_id=None if user.role == "admin" else user.org_id)


# ---------------------------------------------------------------- 教师端: 老师自己问小鹰老师(services/teacher_tutor)
# 对话存在同一张表里,user_id = 真实操作人(助教问的记在助教自己名下,不和主老师的对话混在一起);
# 次数和本班名单按主老师(认证层把助教换成了主老师)

class TeacherTutorAdminIn(BaseModel):
    enabled: bool
    monthly: int = Field(..., ge=1, le=10000)


def _me(teacher: User) -> User:
    from app.core.actor import acting_user
    return acting_user(teacher)


async def _teacher_conf(db: AsyncSession) -> Optional[tt.RelayConf]:
    from app.services import teacher_tutor as tch
    conf = await tt.relay_conf(db)
    if conf is None:
        return None
    conf.pictures = False
    conf.tools, conf.runner = tch.TOOLS, tch.run_tool
    conf.max_tokens, conf.tool_status = tch.MAX_TOKENS, tch.TOOL_STATUS
    return conf


async def _own_teacher_conversation(db: AsyncSession, teacher: User, cid: int) -> TutorConversation:
    c = await db.get(TutorConversation, cid)
    if c is None or c.user_id != _me(teacher).id or c.deleted_at is not None:
        raise HTTPException(404, "没有这段对话")
    return c


@teacher_router.get("/tutor/me/status")
async def teacher_my_tutor_status(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    from app.services import teacher_tutor as tch
    ok, reason = await tch.availability(db, teacher)
    conf = await tt.relay_conf(db) if ok else None
    settings = await tt.get_settings(db)
    return {"enabled": ok, "reason": reason, **await tch.status(db, teacher),
            "deep_enabled": bool(conf and conf.deep_enabled), "deep_cost": settings["deep_cost"],
            "max_text": tch.MAX_TEXT, "voice_enabled": ok and _voice_ok()}


@teacher_router.get("/tutor/me/roster")
async def teacher_my_tutor_roster(db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    """回答里的学生代号(S+id)换成名字用。只给页面,不给模型"""
    from app.services import teacher_tutor as tch
    return {"items": tch.roster_out(await tch.roster(db, teacher.id))}


@teacher_router.post("/tutor/me/ask")
async def teacher_ask(
    text: str = Form(""),
    conversation_id: Optional[int] = Form(None),
    mode: str = Form("fast"),
    image: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    from app.services import teacher_tutor as tch
    ok, reason = await tch.availability(db, teacher)
    if not ok:
        raise HTTPException(403, reason)
    conf = await _teacher_conf(db)
    if conf is None:
        raise HTTPException(403, "小鹰老师还没配置好,请联系平台")
    if mode not in tt.MODES:
        mode = "fast"
    if mode == "deep" and not conf.deep_enabled:
        raise HTTPException(400, "深度思考现在没开,先用快速回答吧")
    settings = await tt.get_settings(db)
    cost = tt.cost_of(mode, settings)
    text = (text or "").strip()
    if len(text) > tch.MAX_TEXT:
        raise HTTPException(400, f"一次最多写 {tch.MAX_TEXT} 个字,分开问吧")
    img, doc = await _read_uploads(image, file)
    if not text and img is None and doc is None:
        raise HTTPException(400, "先写下你想问的")
    me = _me(teacher)
    conv: Optional[TutorConversation] = None
    if conversation_id:
        conv = await _own_teacher_conversation(db, teacher, conversation_id)

    await check_rate(str(me.id), "teacher_tutor", [(60, 10), (3600, 120)])
    teacher_id, org_id = teacher.id, teacher.org_id
    ok_c, why, month = await tch.consume(db, teacher, cost)
    if not ok_c:
        st = await tch.status(db, teacher)
        if why == "pool":
            raise HTTPException(429, f"本机构的学习助手次数还剩 {st['pool_left']} 次,不够这次用。请机构管理员向平台购买次数")
        if mode == "deep" and st["month_left"] > 0:
            raise HTTPException(429, f"深度思考一次算 {cost} 次,这个月你还剩 {st['month_left']} 次,先用快速回答吧")
        raise HTTPException(429, f"这个月的 {st['monthly']} 次用完了,下个月 1 号恢复")

    async def give_back(db_):
        await tch.refund(db_, teacher_id, org_id, month, cost)

    ros = await tch.roster(db, teacher_id)
    try:
        title = None
        if conv is None:
            conv = TutorConversation(user_id=me.id, org_id=org_id, title="", message_count=0, updated_at=utc_now())
            db.add(conv)
            await db.flush()
        if not conv.title:
            title = tt.make_title(text, img is not None, doc.name if doc else None)
        um = TutorMessage(conversation_id=conv.id, user_id=me.id, role="user", text=text, has_image=img is not None,
                          mode=mode, cards=[doc.card()] if doc else None, cost=cost)
        db.add(um)
        conv.message_count = (conv.message_count or 0) + 1
        conv.updated_at = utc_now()
        await db.flush()
        history = tch.pseudonymize_history(await tt.history_messages(db, conv.id, um.id), ros)
        conv_id, um_id, me_id = conv.id, um.id, me.id
        await db.commit()
    except Exception:
        await db.rollback()
        await give_back(db)
        raise

    ask_text = tch.pseudonymize(text, ros) or ("帮我看看这份文件" if doc is not None else "帮我看看这张图")
    messages = history + [{"role": "user", "content": _content_blocks(img, doc, ask_text)}]
    context = tch.teacher_context(ros)
    if text:
        pre = await tt.prefetch_words(db, text)
        if pre:
            context += "\n\n" + pre.replace("孩子这次问到的词", "老师这次问到的词")
    system = tch.build_system(context, mode)
    left = (await tch.status(db, teacher))["left"]

    queue: asyncio.Queue = asyncio.Queue()
    ctx = {"conversation_id": conv_id, "user_message_id": um_id, "user_text": text, "roster": ros}
    task = asyncio.create_task(_run_answer(queue, me_id, conv_id, um_id, conf, system, messages, title, mode, cost,
                                           ctx, refund_fn=give_back, followup=False))
    _running.add(task)
    task.add_done_callback(_running.discard)

    async def gen():
        yield _sse({"type": "meta", "conversation_id": conv_id, "user_message_id": um_id, "left": left,
                    "mode": mode, "cost": cost})
        while True:
            ev = await queue.get()
            if ev is None:
                break
            yield _sse(ev)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@teacher_router.post("/tutor/me/stop")
async def teacher_tutor_stop(body: StopIn, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    m = await db.get(TutorMessage, body.user_message_id)
    if m is None or m.user_id != _me(teacher).id or m.role != "user":
        raise HTTPException(404, "没有这条提问")
    await store.set(_stop_key(m.id), "1", 300)
    return {"ok": True}


@teacher_router.get("/tutor/me/conversations")
async def teacher_my_conversations(q: Optional[str] = Query(None, max_length=100), offset: int = Query(0, ge=0, le=10000),
                                   limit: int = Query(30, ge=1, le=50),
                                   db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    from app.services import tutor_history
    return await tutor_history.list_page(db, _me(teacher).id, q, offset, limit)


@teacher_router.get("/tutor/me/conversations/{cid}")
async def teacher_conversation_detail(cid: int, db: AsyncSession = Depends(get_db),
                                      teacher: User = Depends(get_current_teacher)):
    c = await _own_teacher_conversation(db, teacher, cid)
    msgs = (await db.execute(select(TutorMessage).where(TutorMessage.conversation_id == c.id)
                             .order_by(TutorMessage.id))).scalars().all()
    return {"id": c.id, "title": c.title or "新对话", "messages": [_msg_out(m) for m in msgs], "followup": None}


@teacher_router.patch("/tutor/me/conversations/{cid}")
async def teacher_patch_conversation(cid: int, body: ConversationPatchIn, db: AsyncSession = Depends(get_db),
                                     teacher: User = Depends(get_current_teacher)):
    from app.services import tutor_history
    await check_rate(str(_me(teacher).id), "tutor_conv_edit", [(60, 30)])
    c = await _own_teacher_conversation(db, teacher, cid)
    sent = body.model_fields_set
    if "title" in sent:
        title = tutor_history.clean_title(body.title)
        if not title:
            raise HTTPException(400, "标题不能是空的")
        c.title = title
    if "starred" in sent and body.starred is not None:
        c.starred = bool(body.starred)
    await db.commit()
    return tutor_history.item_out(c)


@teacher_router.delete("/tutor/me/conversations/{cid}")
async def teacher_delete_conversation(cid: int, db: AsyncSession = Depends(get_db),
                                      teacher: User = Depends(get_current_teacher)):
    from app.services import tutor_history
    await check_rate(str(_me(teacher).id), "tutor_conv_edit", [(60, 30)])
    c = await _own_teacher_conversation(db, teacher, cid)
    c.deleted_at = utc_now()
    await db.commit()
    return {"ok": True, "deleted_keep_days": tutor_history.DELETED_KEEP_DAYS}


@teacher_router.post("/tutor/me/voice")
async def teacher_upload_voice(audio: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                               teacher: User = Depends(get_current_teacher)):
    from app.services import sentence_speech, teacher_tutor as tch, tutor_voice
    ok, reason = await tch.availability(db, teacher)
    if not ok:
        raise HTTPException(403, reason)
    if not sentence_speech.is_available():
        raise HTTPException(503, "服务器暂时听不了语音,打字问吧")
    ext = tutor_voice.ext_for(audio.content_type)
    if ext is None:
        raise HTTPException(400, "这段录音的格式不支持,打字问吧")
    raw = await audio.read(tutor_voice.MAX_BYTES + 1)
    if not raw:
        raise HTTPException(400, "没录到声音,再说一次")
    if len(raw) > tutor_voice.MAX_BYTES:
        raise HTTPException(400, f"说得太长了,一次说 {tutor_voice.MAX_SECONDS} 秒以内")
    me = _me(teacher)
    await check_rate(str(me.id), "tutor_voice", [(60, 10), (3600, 60)])
    clip = await tutor_voice.save(db, me.id, raw, ext)
    return {"id": clip.id, "status": clip.status}


@teacher_router.get("/tutor/me/voice/{clip_id}")
async def teacher_voice_result(clip_id: int, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_teacher)):
    from app.models.tutor import TutorVoiceClip
    c = await db.get(TutorVoiceClip, clip_id)
    if c is None or c.user_id != _me(teacher).id:
        raise HTTPException(404, "没有这段录音")
    return {"id": c.id, "status": c.status, "text": c.text or ""}


# ---------------------------------------------------------------- 教师端: 要请老师当面讲的点(services/tutor_notes「交给老师」)

class HandoffIn(BaseModel):
    note: Optional[str] = Field(None, max_length=200)


@teacher_router.get("/tutor/handoffs")
async def teacher_handoffs(all: bool = Query(False), db: AsyncSession = Depends(get_db),
                           teacher: User = Depends(get_current_teacher)):
    """本班孩子练习里同一个点错了好几次、小鹰老师讲不会的。all=1 连讲过的也列"""
    from app.services import tutor_notes
    students = await _my_class_students(db, teacher.id)
    by = {s[0]: s for s in students}
    items = await tutor_notes.handoffs(db, list(by), include_handled=all)
    for it in items:
        s = by[it["student_id"]]
        # 老师自己看的页面: 姓名没填就用用户名(和「这几天谁问了」同口径);
        # coach.child_name 会把带数字的用户名藏成「孩子」,那是给发家长群的图用的,这里老师会认不出是谁
        it["student_name"] = s[2] or s[1]
        it["class_name"] = s[3]
    return {"items": items, "pending": sum(1 for x in items if x["pending"]), "threshold": tutor_notes.HANDOFF_WRONG}


@teacher_router.post("/tutor/handoffs/{note_id}")
async def teacher_handle_handoff(note_id: int, body: HandoffIn, db: AsyncSession = Depends(get_db),
                                 teacher: User = Depends(get_current_teacher)):
    """老师讲过了。之后孩子又错了会重新出现在列表里"""
    from app.models.tutor import TutorNote
    from app.services import tutor_notes
    note = await db.get(TutorNote, note_id)
    if note is None:
        raise HTTPException(404, "没有这一条")
    await assert_student_in_my_class(db, teacher.id, note.user_id)
    me = _me(teacher)
    await tutor_notes.handle_handoff(db, note, me.id, me.full_name or me.username or "", body.note)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 小鹰老师自动布置作业(2026-10-29)
# 路由写在 api/v1/autopilot.py,挂在这里的三个 router 上: main.py 生产有 drift,不为它改 main.py
from app.api.v1 import autopilot as _autopilot_api  # noqa: E402

student_router.include_router(_autopilot_api.student_router)
teacher_router.include_router(_autopilot_api.teacher_router)
admin_router.include_router(_autopilot_api.admin_router)
