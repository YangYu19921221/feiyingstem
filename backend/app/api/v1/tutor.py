"""AI 学习助手接口(2026-10-26)。规则见 services/tutor.py

学生: GET  /student/tutor/status                    能不能用、一共还剩几次、深度思考开没开
      GET  /student/tutor/conversations             我的对话(最近 30 段)
      GET  /student/tutor/conversations/{id}        一段对话的全部消息
      POST /student/tutor/ask                       提问(文字 + 可选一张照片 + mode=fast|deep),回答按 SSE 一段段推
      POST /student/tutor/stop                      停下正在出的回答(一个字没出就退回次数)
      POST /student/tutor/request-more              次数用完了,请老师加
老师: GET  /teacher/students/{sid}/tutor            本班学生和助手的对话(只读)
      GET  /teacher/tutor/available                 本校开没开(公告用)
      GET  /teacher/tutor/students                  本班学生用了几次 / 还剩几次 / 谁在请求加
      POST /teacher/tutor/grant                     给本班学生加次数
管理: GET  /admin/tutor                             开放范围 / 次数 / 模型 / 近 7 天用量
      PUT  /admin/tutor                             改上面这些(密钥留空 = 不改)
      POST /admin/tutor/test                        主模型和备用各发一句「ping」,看通不通

回答是流式的: 浏览器收到一段字就显示一段(孩子不用干等十几秒)。
⚠️ SSE 三件事: X-Accel-Buffering: no(nginx 不攒着一起发)、no-store(全局 proxy_cache)、
回答在后台任务里跑、自己开数据库会话 —— 孩子中途关页面,这次回答照样写库,老师照样看得到
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_admin, get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.database import AsyncSessionLocal, get_db
from app.core.rate_limit import check_rate
from app.core.timeutil import utc_now
from app.models.system_config import AIProvider
from app.core.shared_store import store
from app.models.tutor import TutorAllowance, TutorConversation, TutorMessage
from app.models.user import Class, ClassStudent, User
from app.services import audit_log
from app.services import tutor as tt

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
    if not tt.scope_allows(settings["scope"], user):
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
    a = await tt.allowance_status(db, student.id, settings)
    return {"enabled": ok, "reason": reason, **a, "free_total": settings["free_total"],
            "deep_enabled": bool(conf and conf.deep_enabled), "deep_cost": settings["deep_cost"],
            "max_text": tt.MAX_TEXT}


@student_router.post("/tutor/request-more")
async def tutor_request_more(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    """次数用完了点「请老师加」: 老师的「学习助手次数」页把这些孩子排在最前面"""
    await tt.request_more(db, student.id)
    await db.commit()
    return {"ok": True}


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
    return {"id": c.id, "title": c.title or "新对话", "messages": [_msg_out(m) for m in msgs]}


async def _run_answer(queue: asyncio.Queue, user_id: int, conv_id: int, um_id: int, conf: tt.RelayConf,
                      system: list[dict], messages: list[dict], title: Optional[str], mode: str, cost: int) -> None:
    """在后台任务里跑模型、写库。孩子关了页面也跑完(回答落库,老师看得到)"""
    async def emit(ev: dict):
        await queue.put(ev)

    async def should_stop() -> bool:
        return bool(await store.get(_stop_key(um_id)))

    try:
        async with session_factory() as db:
            user = await db.get(User, user_id)
            turn = await tt.answer(db, user, conf, system, messages, emit, mode=mode, should_stop=should_stop)
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
                await tt.refund(db, user_id, cost)
            if failed:
                await queue.put({"type": "error", "message": BUSY_MSG, "refunded": True})
            else:
                await queue.put({"type": "done", "message_id": msg.id, "stopped": turn.stopped,
                                 "refunded": refunded})
    except Exception:  # noqa: BLE001
        logger.exception("学习助手回答失败 user=%s conv=%s", user_id, conv_id)
        with contextlib.suppress(Exception):
            async with session_factory() as db2:
                await tt.refund(db2, user_id, cost)
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
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    ok, reason, settings = await _availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    conf = await tt.relay_conf(db)
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
    if not text and img is None:
        raise HTTPException(400, "先写下你想问的")

    conv: Optional[TutorConversation] = None
    if conversation_id:
        conv = await _own_conversation(db, student, conversation_id)

    # 限速(防连点 / 脚本)在前,次数在后: 被限速的那一下不该扣次数
    await check_rate(str(student.id), "tutor", [(60, 6), (3600, 60)])
    if not await tt.consume(db, student.id, cost, settings["free_total"]):
        left = (await tt.allowance_status(db, student.id, settings))["left"]
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
                          text=text, has_image=img is not None, mode=mode)
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
        await tt.refund(db, student.id, cost)
        raise

    content: list[dict] = []
    if img is not None:
        content.append({"type": "image", "source": {"type": "base64", "media_type": img[1], "data": img[0]}})
    content.append({"type": "text", "text": text or "帮我看看这道题"})
    messages = history + [{"role": "user", "content": content}]
    system = tt.build_system(context, mode)
    left = (await tt.allowance_status(db, student.id, settings))["left"]

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(_run_answer(queue, student.id, conv_id, um_id, conf, system, messages, title, mode, cost))
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
    settings = await tt.get_settings(db)
    enabled = tt.scope_allows(settings["scope"], teacher) and await tt.relay_conf(db) is not None
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
        total = settings["free_total"] + extra
        items.append({"id": uid, "username": uname, "full_name": fname, "class_name": cname,
                      "used": used, "extra": extra, "total": total, "left": max(0, total - used),
                      "questions": int(asked.get(uid, 0)),
                      "requested_at": r.requested_at.isoformat() if r and r.requested_at else None})
    items.sort(key=lambda x: (x["requested_at"] is None, x["left"], x["class_name"]))
    return {"free_total": settings["free_total"], "deep_cost": settings["deep_cost"],
            "enabled": tt.scope_allows(settings["scope"], teacher), "items": items,
            "requested": sum(1 for x in items if x["requested_at"])}


class GrantIn(BaseModel):
    student_ids: list[int] = Field(..., min_length=1, max_length=200)
    add: int = Field(..., ge=1, le=GRANT_MAX)


@teacher_router.post("/tutor/grant")
async def teacher_tutor_grant(body: GrantIn, request: Request, db: AsyncSession = Depends(get_db),
                              teacher: User = Depends(get_current_teacher)):
    """给本班学生加次数。有一个不是本班的整批 403(和陪跑批量发点评同口径)"""
    mine = {s[0] for s in await _my_class_students(db, teacher.id)}
    ids = sorted(set(body.student_ids))
    if any(i not in mine for i in ids):
        raise HTTPException(403, "只能给自己班的学生加")
    await tt.grant(db, ids, body.add)
    audit_log.record(db, request, teacher, "tutor.grant",
                     f"给 {len(ids)} 个学生各加学习助手 {body.add} 次",
                     target_type="user", target_id=ids[0] if len(ids) == 1 else None,
                     detail={"student_ids": ids, "add": body.add})
    await db.commit()
    return {"ok": True, "count": len(ids)}


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
    return {"total_questions": int(total),
            "items": [{"id": c.id, "title": c.title or "新对话",
                       "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                       "messages": by_conv[c.id]} for c in convs]}


# ---------------------------------------------------------------- 管理端

class TutorAdminIn(BaseModel):
    scope: str = Field(..., pattern="^(off|hq|all)$")
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
    }


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
    conf_extra = (row.extra_config or {}) if row else {}
    audit_log.record(db, request, admin, "system.tutor",
                     f"学习助手: 开放范围 {dict(off='关闭', hq='只开直营', all='全部机构')[body.scope]},"
                     f"每个学生送 {body.free_total} 次,深度思考算 {body.deep_cost} 次" + (",换了密钥" if key else ""),
                     detail={"scope": body.scope, "free_total": body.free_total, "deep_cost": body.deep_cost,
                             "model": row.model_name if row else None,
                             "fallback_model": conf_extra.get("fallback_model"),
                             "deep_model": conf_extra.get("deep_model"),
                             "deep_fallback_model": conf_extra.get("deep_fallback_model")})
    await db.commit()
    return await _admin_state(db)


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
