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

from app.api.v1.auth import get_current_admin, get_current_student, get_current_teacher
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
            "max_text": tt.MAX_TEXT}


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
async def my_conversations(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    rows = (await db.execute(
        select(TutorConversation).where(TutorConversation.user_id == student.id)
        .order_by(TutorConversation.updated_at.desc(), TutorConversation.id.desc()).limit(30)
    )).scalars().all()
    return {"items": [{"id": c.id, "title": c.title or "新对话", "message_count": c.message_count,
                       "updated_at": c.updated_at.isoformat() if c.updated_at else None} for c in rows]}


async def _own_conversation(db: AsyncSession, student: User, cid: int) -> TutorConversation:
    c = await db.get(TutorConversation, cid)
    if c is None or c.user_id != student.id:
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


async def _release_feedback(db: AsyncSession, quiz_id: int) -> None:
    from app.services import tutor_quiz
    await tutor_quiz.release_feedback(db, quiz_id)


async def _run_answer(queue: asyncio.Queue, user_id: int, conv_id: int, um_id: int, conf: tt.RelayConf,
                      system: list[dict], messages: list[dict], title: Optional[str], mode: str, cost: int,
                      ctx: Optional[dict] = None, feedback_quiz_id: Optional[int] = None) -> None:
    """在后台任务里跑模型、写库。孩子关了页面也跑完(回答落库,老师看得到)"""
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
            if refunded:
                await _mark_refunded(db, um_id)
                if cost:
                    await tt.refund(db, user_id, cost)
                if feedback_quiz_id:
                    await _release_feedback(db, feedback_quiz_id)
            if failed:
                await queue.put({"type": "error", "message": BUSY_MSG, "refunded": True})
            else:
                await queue.put({"type": "done", "message_id": msg.id, "stopped": turn.stopped,
                                 "refunded": refunded, "followup": await tt.followup_state(db, conv_id)})
    except Exception:  # noqa: BLE001
        logger.exception("学习助手回答失败 user=%s conv=%s", user_id, conv_id)
        with contextlib.suppress(Exception):
            async with session_factory() as db2:
                await _mark_refunded(db2, um_id)
                if cost:
                    await tt.refund(db2, user_id, cost)
                if feedback_quiz_id:
                    await _release_feedback(db2, feedback_quiz_id)
        await queue.put({"type": "error", "message": BUSY_MSG, "refunded": True})
    finally:
        with contextlib.suppress(Exception):
            await store.delete(_stop_key(um_id))
        await queue.put(None)


@student_router.post("/tutor/ask")
async def ask(
    text: str = Form(""),
    conversation_id: Optional[int] = Form(None),
    mode: str = Form("fast"),
    image: Optional[UploadFile] = File(None),
    quiz_id: Optional[int] = Form(None),
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
    # 做完聊天里的练习、请小鹰老师点评(services/tutor_quiz): 题目和对错由服务器从库里拼,不信前端传的
    from app.services import tutor_quiz
    fq = None
    if quiz_id:
        fq = await db.get(tutor_quiz.TutorQuiz, quiz_id)
        if fq is None or fq.user_id != student.id or fq.submitted_at is None:
            raise HTTPException(404, "没有这份练习")
        if fq.feedback_at is not None:
            raise HTTPException(409, "这份练习已经讲过了")
        mode, img = "fast", None
        text = tutor_quiz.feedback_display(fq)
        conversation_id = fq.conversation_id or conversation_id
    if not text and img is None:
        raise HTTPException(400, "先写下你想问的")

    conv: Optional[TutorConversation] = None
    if conversation_id:
        conv = await _own_conversation(db, student, conversation_id)

    stored_cost = None
    if fq is not None and fq.free_feedback:
        # 做完练习后的点评不扣次数,也不占「同一道题追问」那 3 次(用户 10-27)
        cost, stored_cost = 0, tt.COST_FEEDBACK
    elif conv is not None and mode == "fast" and img is None and await tt.followup_state(db, conv.id):
        # 同一道题的追问(快速回答、没有新照片)不另算,见 services/tutor 文件头「收费」
        cost = 0

    # 限速(防连点 / 脚本)在前,次数在后: 被限速的那一下不该扣次数
    await check_rate(str(student.id), "tutor", [(60, 6), (3600, 60)])
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
        title = None
        if conv is None:
            conv = TutorConversation(user_id=student.id, org_id=student.org_id, title="",
                                     message_count=0, updated_at=utc_now())
            db.add(conv)
            await db.flush()
        if not conv.title:
            title = tt.make_title(text, img is not None)
        um = TutorMessage(conversation_id=conv.id, user_id=student.id, role="user",
                          text=text, has_image=img is not None, mode=mode,
                          cost=stored_cost if stored_cost is not None else cost)
        db.add(um)
        conv.message_count = (conv.message_count or 0) + 1
        conv.updated_at = utc_now()
        await db.flush()
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
        raise

    content: list[dict] = []
    if img is not None:
        content.append({"type": "image", "source": {"type": "base64", "media_type": img[1], "data": img[0]}})
    content.append({"type": "text", "text": tutor_quiz.feedback_prompt(fq) if fq is not None else (text or "帮我看看这道题")})
    messages = history + [{"role": "user", "content": content}]
    system = tt.build_system(context, mode)
    left = (await tt.allowance_status(db, student.id, settings, student.org_id))["left"]

    queue: asyncio.Queue = asyncio.Queue()
    ctx = {"conversation_id": conv_id, "is_feedback": fq is not None and bool(fq.free_feedback)}
    task = asyncio.create_task(_run_answer(queue, student.id, conv_id, um_id, conf, system, messages, title, mode, cost,
                                           ctx, fq.id if fq is not None else None))
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
    if enabled:
        ids = [s[0] for s in await _my_class_students(db, teacher.id)]
        if ids:
            requested = int((await db.execute(
                select(func.count(TutorAllowance.user_id))
                .where(TutorAllowance.user_id.in_(ids), TutorAllowance.requested_at.isnot(None))
            )).scalar() or 0)
    return {"enabled": enabled, "requested": requested}


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
    return {"total_questions": int(total), "profile": profile,
            "items": [{"id": c.id, "title": c.title or "新对话",
                       "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                       "messages": by_conv[c.id]} for c in convs]}


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
    }


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


@admin_router.get("/tutor/pictures")
async def admin_pictures(db: AsyncSession = Depends(get_db), _admin: User = Depends(get_current_admin)):
    from app.models.tutor import WordPicture

    rows = (await db.execute(select(WordPicture).order_by(WordPicture.id.desc()).limit(60))).scalars().all()
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
        .join(User, User.id == TutorMessage.user_id).where(TutorMessage.role == "user")
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
    return {"org_id": org_id, "org_name": org.name, **await tt.pool_status(db, org_id),
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
