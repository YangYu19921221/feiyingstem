"""音标跟读 — 学生端(看音标读出来)

**第一期不打分**,理由见 models/phonetic_practice.py 的 PhoneticReading 说明:
实测 whisper 判的是拼写相似度不是发音(bad 的音频去验 bed 判 66 分通过,
而 æ/e 正是本教材 1—1 要教的对立),机器判错一次孩子就不敢开口。

这一期的反馈 = 标准音/自己的音对比回放 + 老师抽听。
录音落**私有目录**,只经鉴权端点串流 —— 这是未成年人的声音,
绝不能落进 UPLOAD_DIR(那个目录整体公开无鉴权)。
"""
import json
import logging
import os
import re
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.tenancy import current_org_id
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticLesson, PhoneticItem, PhoneticReading,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# 允许的录音容器。iOS Safari 只出 audio/mp4,不能只认 webm
ALLOWED_AUDIO_MIME = {
    "audio/webm", "audio/webm;codecs=opus",
    "audio/mp4", "audio/mp4;codecs=mp4a.40.2",
    "audio/mpeg", "audio/ogg",
}
_EXT = {"audio/webm": ".webm", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/ogg": ".ogg"}


def _visible_item_q(base):
    """items/lessons 都不是租户锚点,必须 join 回 books 按 org 过滤"""
    org_id = current_org_id.get()
    q = base.join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id) \
            .join(PhoneticBook, PhoneticBook.id == PhoneticLesson.book_id) \
            .where(PhoneticBook.is_active == True)  # noqa: E712
    if org_id is not None:
        from sqlalchemy import or_
        q = q.where(or_(PhoneticBook.org_id == org_id, PhoneticBook.org_id.is_(None)))
    return q


class ReadingItemOut(BaseModel):
    """跟读题:**给音标不给单词**

    这才是「看音标读出来」——学音标的意义就在于见到生词能自己读。
    给了拼写孩子就照拼写猜了,音标成了摆设。
    单词在读完之后才揭示(前端拿 word_reveal 显示)。
    """
    id: int
    phonetic: str
    meaning: Optional[str] = None
    word_reveal: str


class ReadingLessonOut(BaseModel):
    id: int
    code: str
    title: str
    items: List[ReadingItemOut]


@router.get("/lessons/{lesson_id}/reading", response_model=ReadingLessonOut)
async def get_reading_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """取一节的跟读题(音标在前,单词读完才揭示)"""
    from sqlalchemy import or_
    org_id = current_org_id.get()
    lq = select(PhoneticLesson).join(
        PhoneticBook, PhoneticBook.id == PhoneticLesson.book_id
    ).where(PhoneticLesson.id == lesson_id,
            PhoneticBook.is_active == True)  # noqa: E712
    if org_id is not None:
        lq = lq.where(or_(PhoneticBook.org_id == org_id, PhoneticBook.org_id.is_(None)))
    ls = (await db.execute(lq)).scalars().first()
    if not ls:
        raise HTTPException(status_code=404, detail="这一节不存在")

    items = (await db.execute(
        select(PhoneticItem).where(PhoneticItem.lesson_id == lesson_id)
        .order_by(PhoneticItem.order_index, PhoneticItem.id)
    )).scalars().all()

    out = []
    for it in items:
        toks = []
        try:
            toks = json.loads(it.answer_json) or []
        except (ValueError, TypeError):
            pass
        if not toks:
            continue
        out.append(ReadingItemOut(
            id=it.id,
            phonetic=it.answer_display or f"[{''.join(toks)}]",
            meaning=it.meaning,
            word_reveal=it.word,
        ))
    return ReadingLessonOut(id=ls.id, code=ls.code, title=ls.title, items=out)


class ReadingSaved(BaseModel):
    id: int
    created_at: Optional[str] = None


@router.post("/readings", response_model=ReadingSaved)
async def upload_reading(
    audio: UploadFile = File(...),
    item_id: int = Form(...),
    duration_ms: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """存一条跟读录音。不判分,只留档给老师抽听"""
    it = (await db.execute(_visible_item_q(
        select(PhoneticItem)).where(PhoneticItem.id == item_id)
    )).scalars().first()
    if not it:
        raise HTTPException(status_code=404, detail="题目不存在")

    # content_type 可能带参数(audio/webm;codecs=opus),取主类型比对
    ctype = (audio.content_type or "").split(";")[0].strip().lower()
    if ctype not in {m.split(";")[0] for m in ALLOWED_AUDIO_MIME}:
        raise HTTPException(status_code=400, detail=f"不支持的音频格式: {ctype}")

    os.makedirs(settings.PHONETIC_AUDIO_DIR, exist_ok=True)
    name = f"{current_user.id}_{item_id}_{secrets.token_hex(8)}{_EXT.get(ctype, '.bin')}"
    path = os.path.join(settings.PHONETIC_AUDIO_DIR, name)

    # 流式落盘并边写边比对上限,不先整个读进内存
    size = 0
    limit = settings.MAX_PHONETIC_AUDIO_SIZE
    try:
        with open(path, "wb") as out:
            while chunk := await audio.read(256 * 1024):
                size += len(chunk)
                if size > limit:
                    out.close()
                    os.remove(path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"录音太大(上限 {limit // 1024}KB)")
                out.write(chunk)
    except HTTPException:
        raise
    except OSError as e:
        logger.error("跟读录音落盘失败: %s", e)
        raise HTTPException(status_code=500, detail="录音保存失败")

    if size == 0:
        os.remove(path)
        raise HTTPException(status_code=400, detail="录音是空的,请重录")

    row = PhoneticReading(
        user_id=current_user.id, item_id=it.id, lesson_id=it.lesson_id,
        file_path=name, mime_type=ctype, file_size=size,
        duration_ms=duration_ms, org_id=current_org_id.get(),
    )
    db.add(row)
    await db.flush()

    # 只留最近 N 条:不清理的话一个班一学期能堆出几十万个小文件
    keep = settings.PHONETIC_AUDIO_KEEP_PER_LESSON
    old = (await db.execute(
        select(PhoneticReading)
        .where(PhoneticReading.user_id == current_user.id,
               PhoneticReading.lesson_id == it.lesson_id)
        .order_by(PhoneticReading.id.desc())
        .offset(keep)
    )).scalars().all()
    for o in old:
        # 老师标记过的留着(那是教学记录),只删没听过的
        if o.teacher_mark:
            continue
        try:
            os.remove(os.path.join(settings.PHONETIC_AUDIO_DIR,
                                   os.path.basename(o.file_path)))
        except OSError:
            pass
        await db.delete(o)

    await db.commit()
    return ReadingSaved(id=row.id,
                        created_at=row.created_at.isoformat() if row.created_at else None)


class JudgeOut(BaseModel):
    """跟读判定结果

    verdict: pass=读对了(前端变绿自动下一个) / confused=念成了本节另一个词 /
             not_speech=压根没在读词(静音/噪音/说中文,撞了 SCORE_FLOOR) /
             silent=没听到 / uncertain=判不准 / off=判定不可用
    刻意不给分数:分数会被当成评价,而这个判定只够决定「要不要变绿」。

    ⚠️ near_miss / mismatch 是**旧 whisper 判定**的字符串,换成闭集打分后
    再没发过。前端曾经在等 near_miss,于是那个分支成了永不触发的死代码,
    一切静默按「出声就算读了」处理 —— 改这里必须连带改前端。
    """
    verdict: str
    heard: Optional[str] = None
    reason: Optional[str] = None
    reading_id: Optional[int] = None
    # 具体错错在哪(目前只有 extra_final_vowel=词尾多带一个音)。
    # 这比「更像哪个词」有用得多 —— 孩子没想读 daff,他想读 bad 只是收音拖了尾巴。
    # 给不出就是 None,前端那时才退回「机器听着更像 X」。
    error_code: Optional[str] = None
    error_hint: Optional[str] = None


@router.post("/readings/judge", response_model=JudgeOut)
async def judge_and_save(
    audio: UploadFile = File(...),
    item_id: int = Form(...),
    duration_ms: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """判「这个音标读对了没」+ 留档

    判定只决定变不变绿,不打分不拦路。判不准一律回 uncertain 让孩子再读,
    **绝不假通过** —— 放过念错的音等于没教(实测旧实现拿 bad 的音频验 bed 判 66 分通过)。
    """
    it = (await db.execute(_visible_item_q(
        select(PhoneticItem)).where(PhoneticItem.id == item_id)
    )).scalars().first()
    if not it:
        raise HTTPException(status_code=404, detail="题目不存在")

    data = await audio.read()
    if len(data) > settings.MAX_PHONETIC_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="录音太大")

    # 先落档:判定可能失败,但孩子的录音不能丢
    ctype = (audio.content_type or "audio/webm").split(";")[0].strip().lower()
    reading_id = await _save_audio(db, current_user, it, data, ctype, duration_ms)

    # 闭集候选 = 本节全部词。不让模型在 392 个音素里自由猜,而是问「更像哪个词」
    # —— 我们知道答案,不该浪费这个信息。实测这一改把 80% 提到 95%。
    rows = (await db.execute(
        select(PhoneticItem.word, PhoneticItem.answer_json)
        .where(PhoneticItem.lesson_id == it.lesson_id)
    )).all()
    candidates = {}
    for w, aj in rows:
        try:
            toks = json.loads(aj or "[]")
        except (ValueError, TypeError):
            continue
        if toks:
            candidates[w] = toks
    if not candidates:
        return JudgeOut(verdict="off", reading_id=reading_id)

    from app.services import phoneme_judge_client
    r = await phoneme_judge_client.judge(data, it.word, candidates)
    if not r:
        # 判定服务没起/超时 —— 前端退回纯对比回放模式,课照上
        return JudgeOut(verdict="off", reading_id=reading_id)

    return JudgeOut(verdict=r.get("verdict", "off"),
                    heard=r.get("best"),
                    reason=r.get("note") or r.get("reason"),
                    error_code=r.get("error_code"),
                    error_hint=r.get("error_hint"),
                    reading_id=reading_id)


async def _save_audio(db, user, item, data: bytes, ctype: str,
                      duration_ms: Optional[int]) -> Optional[int]:
    """落盘 + 建行,失败不抛(判定流程不该因为存档失败而中断)"""
    if not data:
        return None
    try:
        os.makedirs(settings.PHONETIC_AUDIO_DIR, exist_ok=True)
        name = f"{user.id}_{item.id}_{secrets.token_hex(8)}{_EXT.get(ctype, '.bin')}"
        with open(os.path.join(settings.PHONETIC_AUDIO_DIR, name), "wb") as f:
            f.write(data)
        row = PhoneticReading(
            user_id=user.id, item_id=item.id, lesson_id=item.lesson_id,
            file_path=name, mime_type=ctype, file_size=len(data),
            duration_ms=duration_ms, org_id=current_org_id.get(),
        )
        db.add(row)
        await db.flush()
        await _prune_old(db, user.id, item.lesson_id)
        await db.commit()
        return row.id
    except Exception as e:
        logger.warning("跟读录音存档失败: %s", e)
        await db.rollback()
        return None


async def _prune_old(db, user_id: int, lesson_id: int) -> None:
    """只留最近 N 条,老师标记过的保留(那是教学记录)"""
    keep = settings.PHONETIC_AUDIO_KEEP_PER_LESSON
    old = (await db.execute(
        select(PhoneticReading)
        .where(PhoneticReading.user_id == user_id,
               PhoneticReading.lesson_id == lesson_id)
        .order_by(PhoneticReading.id.desc()).offset(keep)
    )).scalars().all()
    for o in old:
        if o.teacher_mark:
            continue
        try:
            os.remove(os.path.join(settings.PHONETIC_AUDIO_DIR,
                                   os.path.basename(o.file_path)))
        except OSError:
            pass
        await db.delete(o)


@router.get("/readings/{reading_id}/audio")
async def stream_reading(
    reading_id: int,
    request: Request,
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """回放录音。**只有本人和本机构老师能听** —— 这是孩子的声音

    鉴权双通道:Authorization 头(fetch/axios)或 ?token=(<audio> 标签带不了请求头)。
    与音标视频串流同套路,复用 phonetics.py 的 _user_from_query_token。
    """
    from app.api.v1.phonetics import _user_from_query_token

    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        current_user = await _user_from_query_token(auth_header[7:].strip(), db)
    elif token:
        current_user = await _user_from_query_token(token, db)
    else:
        raise HTTPException(status_code=401, detail="需要登录后回放")

    row = (await db.execute(
        select(PhoneticReading).where(PhoneticReading.id == reading_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="录音不存在")

    is_owner = row.user_id == current_user.id
    is_staff = current_user.role in ("teacher", "org_admin", "admin")
    same_org = (current_user.role == "admin") or (row.org_id == current_user.org_id)
    if not (is_owner or (is_staff and same_org)):
        raise HTTPException(status_code=403, detail="不能听别人的录音")

    # 只用文件名拼接,杜绝 ../ 穿越
    path = os.path.join(settings.PHONETIC_AUDIO_DIR, os.path.basename(row.file_path))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="录音文件已丢失")
    return FileResponse(path, media_type=row.mime_type or "audio/webm")


class MyReadingOut(BaseModel):
    id: int
    item_id: int
    phonetic: str
    word: str
    duration_ms: Optional[int] = None
    teacher_mark: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/lessons/{lesson_id}/my-readings", response_model=List[MyReadingOut])
async def my_readings(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """我在这一节留下的录音,供自己回听"""
    rows = (await db.execute(
        select(PhoneticReading, PhoneticItem)
        .join(PhoneticItem, PhoneticItem.id == PhoneticReading.item_id)
        .where(PhoneticReading.user_id == current_user.id,
               PhoneticReading.lesson_id == lesson_id)
        .order_by(PhoneticReading.id.desc())
    )).all()
    out = []
    for r, it in rows:
        toks = []
        try:
            toks = json.loads(it.answer_json) or []
        except (ValueError, TypeError):
            pass
        out.append(MyReadingOut(
            id=r.id, item_id=it.id,
            phonetic=it.answer_display or f"[{''.join(toks)}]",
            word=it.word, duration_ms=r.duration_ms,
            teacher_mark=r.teacher_mark,
            created_at=r.created_at.isoformat() if r.created_at else None,
        ))
    return out
