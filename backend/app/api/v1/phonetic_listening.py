"""音标听力 —— 老师建题、学生听音写单词和音标

规则真源 services/phonetic_listening.py 文件头;数据模型见 models/phonetic_listening.py。

老师端(/teacher/phonetic-listening):
  GET  /books                        能放听力的教材(可见的;能不能改看 can_edit)
  GET  /books/{book_id}/sets         这本书的听力套
  POST /books/{book_id}/sets         新建一套(整套题一次给,全部校验过才落库)
  GET  /sets/{id}                    一套的全部题(老师看得到答案)
  PUT  /sets/{id}                    改整套(按题目 id 原地改,不删了重建 —— id 变了学生记录对不上)
  DELETE /sets/{id}                  删(软删 is_active=0,学生记录还在)
  POST /items/{id}/audio             上传老师录音(替换系统读音)
  DELETE /items/{id}/audio           去掉录音,改回系统读
  GET  /items/{id}/audio             老师试听
  GET  /sets/{id}/results            本班学生做得怎么样

学生端(/phonetic-practice/listening):
  GET  /sets                         能做的听力套(按教材分组)
  GET  /sets/{id}                    题目: 只有提示、格子数、有没有老师录音 —— **不给单词音标**
  GET  /items/{id}/audio             这题的老师录音(没有 404,前端改用系统读 /listening/items/{id}/tts)
  GET  /items/{id}/tts               系统读这题(服务端按单词 / 老师指定的发音合成,单词不出现在网址里)
  POST /check                        判一题(卡片模式,一页 9 个)
  POST /check-page                   整页一次交(整页模式,一页 20 个)
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.tenancy import current_org_id
from app.models.phonetic_listening import ListeningAttempt, ListeningItem, ListeningSet
from app.models.phonetic_practice import PhoneticBook
from app.models.user import User
from app.services import audit_log
from app.services import phonetic_listening as pl
from app.services.phonetic_tokenize import check_item, check_tts_text

logger = logging.getLogger(__name__)

teacher_router = APIRouter()
student_router = APIRouter()

def _audio_dir() -> str:
    """老师录音放在跟读录音旁边(private_media 下),不进 UPLOAD_DIR —— 那里经 /api/v1/files 公开无鉴权"""
    from app.core.config import settings
    d = os.path.join(os.path.dirname(os.path.abspath(settings.PHONETIC_AUDIO_DIR)), "phonetic_listening")
    os.makedirs(d, exist_ok=True)
    return d


def _require_staff(user: User) -> None:
    if user.role not in ("teacher", "org_admin", "admin"):
        raise HTTPException(status_code=403, detail="只有老师和管理员能管理音标听力")


def _org_of(user: User) -> Optional[int]:
    return None if user.role == "admin" else user.org_id


def _can_add(user: User) -> bool:
    """能建听力吗: 平台 admin,或有机构的老师 / 机构管理员(建的归自己机构,教材是平台预置的也行)"""
    return user.role == "admin" or user.org_id is not None


def _can_edit(s: ListeningSet, user: User) -> bool:
    return pl.can_edit_set(s.org_id, user.role, user.org_id)


async def _book_visible(db: AsyncSession, book_id: int, org_id: Optional[int]) -> Optional[PhoneticBook]:
    return (await db.execute(pl.visible_books(
        select(PhoneticBook).where(PhoneticBook.id == book_id), org_id
    ).execution_options(skip_tenant_filter=True))).scalar_one_or_none()


async def _set_visible(db: AsyncSession, set_id: int, org_id: Optional[int]):
    """(套, 教材) 都可见才返回 —— 套不是租户锚点,按机构的过滤必须显式写(visible_sets)"""
    row = (await db.execute(pl.visible_sets(
        select(ListeningSet, PhoneticBook).join(PhoneticBook, PhoneticBook.id == ListeningSet.book_id)
        .where(ListeningSet.id == set_id), org_id
    ).execution_options(skip_tenant_filter=True))).first()
    return row


async def _own_set(db: AsyncSession, set_id: int, user: User):
    row = await _set_visible(db, set_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这套听力不存在")
    s, b = row
    if not _can_edit(s, user):
        raise HTTPException(status_code=403, detail="这套听力是平台的,只能查看。要改可以自己新建一套")
    return s, b


async def _item_with_set(db: AsyncSession, item_id: int, org_id: Optional[int]):
    row = (await db.execute(pl.visible_sets(
        select(ListeningItem, ListeningSet, PhoneticBook)
        .join(ListeningSet, ListeningSet.id == ListeningItem.set_id)
        .join(PhoneticBook, PhoneticBook.id == ListeningSet.book_id)
        .where(ListeningItem.id == item_id), org_id
    ).execution_options(skip_tenant_filter=True))).first()
    return row


# ---------------------------------------------------------------- 老师: 教材与套


@teacher_router.get("/books")
async def teacher_books(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_staff(user)
    books = (await db.execute(pl.visible_books(select(PhoneticBook), _org_of(user))
                              .execution_options(skip_tenant_filter=True)
                              .order_by(PhoneticBook.org_id.is_(None), PhoneticBook.id))).scalars().all()
    counts = dict((await db.execute(pl.visible_sets(
        select(ListeningSet.book_id, func.count(ListeningSet.id))
        .join(PhoneticBook, PhoneticBook.id == ListeningSet.book_id), _org_of(user)
    ).execution_options(skip_tenant_filter=True).group_by(ListeningSet.book_id))).all())
    return [{"id": b.id, "name": b.name, "volume": b.volume, "is_preset": b.org_id is None,
             "can_edit": _can_add(user), "set_count": counts.get(b.id, 0)} for b in books]


@teacher_router.get("/books/{book_id}/sets")
async def teacher_sets(book_id: int, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    _require_staff(user)
    b = await _book_visible(db, book_id, _org_of(user))
    if b is None:
        raise HTTPException(status_code=404, detail="教材不存在")
    sets = (await db.execute(pl.visible_sets(
        select(ListeningSet).join(PhoneticBook, PhoneticBook.id == ListeningSet.book_id)
        .where(ListeningSet.book_id == book_id), _org_of(user)
    ).execution_options(skip_tenant_filter=True)
     .order_by(ListeningSet.sort_order, ListeningSet.id))).scalars().all()
    stats = {}
    if sets:
        for sid, n, n_audio in (await db.execute(
            select(ListeningItem.set_id, func.count(ListeningItem.id), func.count(ListeningItem.audio_path))
            .where(ListeningItem.set_id.in_([s.id for s in sets])).group_by(ListeningItem.set_id)
        )).all():
            stats[sid] = (n, n_audio)
    return {"can_edit": _can_add(user), "sets": [
        {"id": s.id, "title": s.title, "item_count": stats.get(s.id, (0, 0))[0],
         "audio_count": stats.get(s.id, (0, 0))[1], "can_edit": _can_edit(s, user),
         "is_platform": s.org_id is None} for s in sets]}


class ItemIn(BaseModel):
    id: Optional[int] = None            # 改的时候带上;新加的题不带
    word: str = Field(..., min_length=1, max_length=100)
    phonetic: str = Field(..., min_length=1, max_length=100)
    meaning: Optional[str] = Field(None, max_length=200)
    hint: Optional[str] = Field(None, max_length=200)
    tts: Optional[str] = Field(None, max_length=200)


class SetIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    items: List[ItemIn] = Field(..., min_length=1, max_length=pl.ITEMS_MAX)


def _check_items(items: List[ItemIn]):
    """逐题校验 → (可入库的 list, 错误清单)。有一题不对就一题都不落"""
    ok, errors = [], []
    for i, it in enumerate(items, 1):
        word = " ".join(it.word.split())
        if not word:
            errors.append(f"第 {i} 题没填单词")
            continue
        parsed, err = check_item(word, it.phonetic)
        if err:
            errors.append(f"第 {i} 题 {word}: {err}")
            continue
        tts, terr = check_tts_text(it.tts)
        if terr:
            errors.append(f"第 {i} 题 {word}: {terr}")
            continue
        ok.append({"id": it.id, "word": word, "answer": parsed["answer"], "core": parsed["core"],
                   "meaning": (it.meaning or "").strip() or None, "hint": pl.clean_hint(it.hint),
                   "tts": tts})
    return ok, errors


def _apply(item: ListeningItem, d: dict, order: int) -> None:
    item.word = d["word"]
    item.answer_json = json.dumps(d["answer"], ensure_ascii=False)
    item.answer_display = f"[{''.join(d['answer'])}]"
    item.core_indexes_json = json.dumps(d["core"])
    item.meaning = d["meaning"]
    item.hint = d["hint"]
    item.tts_text = d["tts"]
    item.order_index = order


async def _items_of(db: AsyncSession, set_id: int) -> dict:
    return {it.id: it for it in (await db.execute(
        select(ListeningItem).where(ListeningItem.set_id == set_id))).scalars()}


async def _replace_items(db: AsyncSession, s: ListeningSet, rows: List[dict], old: dict):
    """按 rows 重写这一套的题 → (题目 list, 要删的录音文件)。

    rows 里带 id 的原地改(id 不变,学生记录和老师录音都留着),不带 id 的新加,old 里没出现的删掉。
    调用方先确认 rows 里的 id 都在 old 里"""
    keep = {d["id"] for d in rows if d["id"] is not None}
    removed_files = []
    for iid, it in old.items():
        if iid not in keep:
            if it.audio_path:
                removed_files.append(it.audio_path)
            await db.delete(it)
    items = []
    for i, d in enumerate(rows):
        it = old.get(d["id"]) if d["id"] is not None else None
        if it is None:
            it = ListeningItem(set_id=s.id)
            db.add(it)
        elif it.word != d["word"] and it.audio_path:
            # 换了单词,老师之前录的是旧词 —— 留着就是读错的题
            removed_files.append(it.audio_path)
            it.audio_path = None
            it.audio_mime = None
        _apply(it, d, i)
        items.append(it)
    return items, removed_files


def _set_out(s: ListeningSet, items: List[ListeningItem], can_edit: bool) -> dict:
    return {"id": s.id, "book_id": s.book_id, "title": s.title, "can_edit": can_edit, "items": [
        {"id": it.id, "word": it.word, "phonetic": it.answer_display, "meaning": it.meaning,
         "hint": it.hint, "tts": it.tts_text, "has_audio": bool(it.audio_path)} for it in items]}


@teacher_router.post("/books/{book_id}/sets")
async def create_set(book_id: int, body: SetIn, request: Request, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    _require_staff(user)
    b = await _book_visible(db, book_id, _org_of(user))
    if b is None:
        raise HTTPException(status_code=404, detail="教材不存在")
    if not _can_add(user):
        raise HTTPException(status_code=403, detail="你的账号不属于任何机构,建不了听力")
    rows, errors = _check_items(body.items)
    if errors:
        raise HTTPException(status_code=400, detail={"code": "invalid_items", "message": errors[0],
                                                     "errors": errors})
    last = (await db.execute(select(func.max(ListeningSet.sort_order))
                             .where(ListeningSet.book_id == book_id))).scalar() or 0
    s = ListeningSet(book_id=b.id, title=body.title.strip(), sort_order=last + 10,
                     org_id=_org_of(user), created_by=user.id)
    db.add(s)
    await db.flush()
    items = []
    for i, d in enumerate(rows):
        it = ListeningItem(set_id=s.id)
        _apply(it, d, i)
        db.add(it)
        items.append(it)
    audit_log.record(db, request, user, "phonetic.listening_create",
                     f"新建音标听力「{s.title}」{len(items)} 题", target_type="phonetic_listening_set",
                     target_id=s.id)
    await db.commit()
    return _set_out(s, items, True)


IMPORT_SETS_MAX = 60      # 一本练习本几十页,一次导完


class ImportIn(BaseModel):
    """Excel 导入: 一个工作表 = 一套(表名就是套名)。前端用 SheetJS 解析成 JSON 传上来,后端不收文件"""
    sets: List[SetIn] = Field(..., min_length=1, max_length=IMPORT_SETS_MAX)
    replace: bool = False      # 同名的套覆盖(按单词对上原题,学生记录和录音留着)
    dry_run: bool = False      # 只校验,不写


def _norm_title(t: str) -> str:
    return " ".join((t or "").split())[:100]


@teacher_router.post("/books/{book_id}/import")
async def import_sets(book_id: int, body: ImportIn, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Excel 一次导入好几套。规则:
    - 整批要么全进要么全不进: 有一题不合格、表名重复,一套都不写,错误逐条列出
    - 导入的套归导入的人: 老师 / 机构管理员 = 本机构;平台 admin = 平台预置(所有机构都能用)
    - 同名 = 这本教材里**自己这一层**(本机构 / 平台)已有同名的套。不带 replace 回 409 列出是哪几套;
      带 replace 就改那一套: 同一个单词对上原来那一题(id 不变),新单词新加,表里没有的删掉。
      别的机构或平台有同名的不算 —— 那不是你的,导入只会建你自己的一套"""
    _require_staff(user)
    b = await _book_visible(db, book_id, _org_of(user))
    if b is None:
        raise HTTPException(status_code=404, detail="教材不存在")
    if not _can_add(user):
        raise HTTPException(status_code=403, detail="你的账号不属于任何机构,建不了听力")
    org = _org_of(user)

    errors: List[str] = []
    parsed: List[tuple[str, List[dict]]] = []
    seen: set[str] = set()
    for st in body.sets:
        title = _norm_title(st.title)
        if not title:
            errors.append("有一个工作表没有名字")
            continue
        if title in seen:
            errors.append(f"「{title}」出现了两次,改一下其中一个工作表的名字")
            continue
        seen.add(title)
        for it in st.items:
            it.id = None           # 导入不认前端带来的 id,按单词对题
        rows, errs = _check_items(st.items)
        errors.extend(f"「{title}」{e}" for e in errs)
        parsed.append((title, rows))
    if errors:
        raise HTTPException(status_code=400, detail={"code": "invalid_items", "message": errors[0],
                                                     "errors": errors})

    owner = ListeningSet.org_id.is_(None) if org is None else ListeningSet.org_id == org
    existing = {s.title: s for s in (await db.execute(
        select(ListeningSet).where(ListeningSet.book_id == b.id, ListeningSet.is_active.is_(True), owner)
        .order_by(ListeningSet.id))).scalars()}
    clash = [t for t, _ in parsed if t in existing]
    total = sum(len(r) for _, r in parsed)
    if body.dry_run:
        return {"sets": len(parsed), "items": total, "existing": clash,
                "new": [t for t, _ in parsed if t not in existing], "platform": org is None}
    if clash and not body.replace:
        raise HTTPException(status_code=409, detail={
            "code": "title_exists", "titles": clash,
            "message": f"这本教材里已经有同名的 {len(clash)} 套(「{'」「'.join(clash[:5])}」"
                       f"{'…' if len(clash) > 5 else ''}),勾上「覆盖同名的套」再导入,或者改一下工作表名"})

    last = (await db.execute(select(func.max(ListeningSet.sort_order))
                             .where(ListeningSet.book_id == b.id))).scalar() or 0
    removed_files: List[str] = []
    created = replaced = 0
    for title, rows in parsed:
        s = existing.get(title)
        if s is None:
            last += 10
            s = ListeningSet(book_id=b.id, title=title, sort_order=last, org_id=org, created_by=user.id)
            db.add(s)
            await db.flush()
            old: dict = {}
            created += 1
        else:
            old = await _items_of(db, s.id)
            pool: dict[str, list] = {}
            for it in sorted(old.values(), key=lambda x: (x.order_index, x.id)):
                pool.setdefault(pl.norm_word(it.word), []).append(it.id)
            for d in rows:
                ids = pool.get(pl.norm_word(d["word"]))
                d["id"] = ids.pop(0) if ids else None
            s.updated_at = datetime.utcnow()
            replaced += 1
        _items, gone = await _replace_items(db, s, rows, old)
        removed_files.extend(gone)
    where = "平台预置" if org is None else "本机构"
    audit_log.record(db, request, user, "phonetic.listening_import",
                     f"Excel 导入音标听力 {len(parsed)} 套 {total} 题({where},新建 {created} 套、覆盖 {replaced} 套)",
                     target_type="phonetic_book", target_id=b.id)
    await db.commit()
    for p in removed_files:
        _rm(p)
    return {"created": created, "replaced": replaced, "items": total, "platform": org is None}


@teacher_router.get("/sets/{set_id}")
async def teacher_get_set(set_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    _require_staff(user)
    row = await _set_visible(db, set_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这套听力不存在")
    s, b = row
    items = (await db.execute(select(ListeningItem).where(ListeningItem.set_id == s.id)
                              .order_by(ListeningItem.order_index, ListeningItem.id))).scalars().all()
    return _set_out(s, items, _can_edit(s, user))


@teacher_router.put("/sets/{set_id}")
async def update_set(set_id: int, body: SetIn, request: Request, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """改整套。带 id 的题原地改(id 不变,学生记录和老师录音都留着),不带 id 的新加,
    没出现的删掉(连同录音文件)。有一题不合格就一题都不改"""
    _require_staff(user)
    s, _b = await _own_set(db, set_id, user)
    rows, errors = _check_items(body.items)
    if errors:
        raise HTTPException(status_code=400, detail={"code": "invalid_items", "message": errors[0],
                                                     "errors": errors})
    old = await _items_of(db, s.id)
    if any(d["id"] is not None and d["id"] not in old for d in rows):
        raise HTTPException(status_code=400, detail="有的题不在这套里,一个都没改。刷新页面再试")
    items, removed_files = await _replace_items(db, s, rows, old)
    s.title = body.title.strip()
    s.updated_at = datetime.utcnow()
    audit_log.record(db, request, user, "phonetic.listening_update",
                     f"修改音标听力「{s.title}」{len(items)} 题", target_type="phonetic_listening_set",
                     target_id=s.id)
    await db.commit()
    for p in removed_files:
        _rm(p)
    return _set_out(s, items, True)


@teacher_router.delete("/sets/{set_id}")
async def delete_set(set_id: int, request: Request, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """软删: 学生做过的记录和作业还指着它。录音文件留着(恢复时还能用)"""
    _require_staff(user)
    s, _b = await _own_set(db, set_id, user)
    s.is_active = False
    audit_log.record(db, request, user, "phonetic.listening_delete", f"删除音标听力「{s.title}」",
                     target_type="phonetic_listening_set", target_id=s.id)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 老师: 录音


def _rm(rel: Optional[str]) -> None:
    if not rel:
        return
    try:
        os.remove(os.path.join(_audio_dir(), os.path.basename(rel)))
    except OSError:
        pass


@teacher_router.post("/items/{item_id}/audio")
async def upload_item_audio(item_id: int, request: Request, audio: UploadFile = File(...),
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_staff(user)
    row = await _item_with_set(db, item_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    it, s, b = row
    if not _can_edit(s, user):
        raise HTTPException(status_code=403, detail="这套听力是平台的,只能查看")
    mime = (audio.content_type or "").split(";")[0].strip().lower()
    if mime not in pl.AUDIO_MIME:
        raise HTTPException(status_code=400, detail="只能传录音文件(mp3 / m4a / wav / webm)")
    data = await audio.read(pl.AUDIO_MAX + 1)
    if len(data) > pl.AUDIO_MAX:
        raise HTTPException(status_code=400, detail="录音太长了,一个词录 1–3 秒就够(最大 2MB)")
    if len(data) < 200:
        raise HTTPException(status_code=400, detail="录音是空的,再录一次")
    name = f"{it.id}_{uuid.uuid4().hex[:8]}"
    path = os.path.join(_audio_dir(), name)
    with open(path, "wb") as f:
        f.write(data)
    old = it.audio_path
    it.audio_path = name
    it.audio_mime = mime
    audit_log.record(db, request, user, "phonetic.listening_audio",
                     f"音标听力「{s.title}」第 {it.order_index + 1} 题 {it.word} 换成老师录音",
                     target_type="phonetic_listening_item", target_id=it.id)
    await db.commit()
    _rm(old)
    return {"ok": True, "has_audio": True}


@teacher_router.delete("/items/{item_id}/audio")
async def delete_item_audio(item_id: int, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    _require_staff(user)
    row = await _item_with_set(db, item_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    it, s, _b = row
    if not _can_edit(s, user):
        raise HTTPException(status_code=403, detail="这套听力是平台的,只能查看")
    old = it.audio_path
    it.audio_path = None
    it.audio_mime = None
    await db.commit()
    _rm(old)
    return {"ok": True, "has_audio": False}


def _audio_response(it: ListeningItem):
    if not it.audio_path:
        raise HTTPException(status_code=404, detail="这道题没有老师录音")
    path = os.path.join(_audio_dir(), os.path.basename(it.audio_path))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="录音文件找不到了,请老师重新录")
    # private: 只给这个浏览器缓存;录音按文件名(带随机串)存,换了录音地址就变,不会拿到旧的
    return FileResponse(path, media_type=it.audio_mime or "audio/mpeg",
                        headers={"Cache-Control": "private, max-age=86400"})


@teacher_router.get("/items/{item_id}/audio")
async def teacher_item_audio(item_id: int, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    _require_staff(user)
    row = await _item_with_set(db, item_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    return _audio_response(row[0])


# ---------------------------------------------------------------- 老师: 学情


@teacher_router.get("/sets/{set_id}/results")
async def set_results(set_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """本班学生这一套做得怎么样: 每人每题第一次交的对不对 + 最后是不是做对了。平台 admin 看全部做过的人"""
    _require_staff(user)
    row = await _set_visible(db, set_id, _org_of(user))
    if row is None:
        raise HTTPException(status_code=404, detail="这套听力不存在")
    s, _b = row
    items = (await db.execute(select(ListeningItem).where(ListeningItem.set_id == s.id)
                              .order_by(ListeningItem.order_index, ListeningItem.id))).scalars().all()
    allowed = None
    if user.role != "admin":
        from app.api.v1.teacher._permissions import get_my_class_student_ids
        allowed = await get_my_class_student_ids(db, user.id)
        if not allowed:
            return {"items": [{"id": it.id, "word": it.word} for it in items], "students": []}
    q = select(ListeningAttempt).where(ListeningAttempt.set_id == s.id).order_by(ListeningAttempt.id)
    if allowed is not None:
        q = q.where(ListeningAttempt.user_id.in_(allowed))
    per: dict[int, dict[int, dict]] = {}
    for a in (await db.execute(q)).scalars():
        cell = per.setdefault(a.user_id, {}).setdefault(a.item_id, {
            "first_word": a.word_correct, "first_phonetic": a.phonetic_correct,
            "first_ok": a.is_correct, "wrote": a.word_submitted, "done": False, "ok": False})
        if a.is_correct or a.pass_number >= 2 or a.gave_up:
            cell["done"] = True
            cell["ok"] = cell["ok"] or a.is_correct
    ids = set(per) | (allowed or set())
    names = {u.id: (u.full_name or u.username) for u in (await db.execute(
        select(User).where(User.id.in_(ids)))).scalars()} if ids else {}
    students = []
    for uid in ids:
        cells = per.get(uid, {})
        students.append({
            "id": uid, "name": names.get(uid, f"#{uid}"),
            "done": sum(1 for c in cells.values() if c["done"]),
            "first_right": sum(1 for c in cells.values() if c["first_ok"]),
            "cells": {str(k): v for k, v in cells.items()},
        })
    students.sort(key=lambda x: (x["done"] == 0, -x["first_right"], x["name"]))
    return {"items": [{"id": it.id, "word": it.word, "phonetic": it.answer_display} for it in items],
            "students": students}


# ---------------------------------------------------------------- 学生


@student_router.get("/sets")
async def student_sets(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    org_id = None if user.role == "admin" else current_org_id.get()
    rows = (await db.execute(pl.visible_sets(
        select(ListeningSet, PhoneticBook).join(PhoneticBook, PhoneticBook.id == ListeningSet.book_id), org_id
    ).execution_options(skip_tenant_filter=True)
     .order_by(PhoneticBook.id, ListeningSet.sort_order, ListeningSet.id))).all()
    set_ids = [s.id for s, _ in rows]
    counts = dict((await db.execute(
        select(ListeningItem.set_id, func.count(ListeningItem.id))
        .where(ListeningItem.set_id.in_(set_ids)).group_by(ListeningItem.set_id)
    )).all()) if set_ids else {}
    mine = {}
    if set_ids:
        for sid, iid, ok, p2, gu in (await db.execute(
            select(ListeningAttempt.set_id, ListeningAttempt.item_id, ListeningAttempt.is_correct,
                   ListeningAttempt.pass_number, ListeningAttempt.gave_up)
            .where(ListeningAttempt.user_id == user.id, ListeningAttempt.set_id.in_(set_ids))
        )).all():
            m = mine.setdefault(sid, {"right": set(), "done": set()})
            if ok:
                m["right"].add(iid)
            if ok or p2 >= 2 or gu:
                m["done"].add(iid)
    books: dict[int, dict] = {}
    for s, b in rows:
        n = counts.get(s.id, 0)
        if not n:
            continue
        m = mine.get(s.id, {"right": set(), "done": set()})
        books.setdefault(b.id, {"id": b.id, "name": b.name, "sets": []})["sets"].append(
            {"id": s.id, "title": s.title, "item_count": n,
             "done_count": len(m["done"]), "right_count": len(m["right"])})
    return list(books.values())


@student_router.get("/sets/{set_id}")
async def student_get_set(set_id: int, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """题目只给提示、格子数、重音在哪格、有没有老师录音。**不给单词、音标、释义**"""
    org_id = None if user.role == "admin" else current_org_id.get()
    row = await _set_visible(db, set_id, org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这套听力不存在")
    s, b = row
    items = (await db.execute(select(ListeningItem).where(ListeningItem.set_id == s.id)
                              .order_by(ListeningItem.order_index, ListeningItem.id))).scalars().all()
    out = []
    for it in items:
        ans = pl.loads(it.answer_json, [])
        out.append({"id": it.id, "hint": it.hint, "slot_count": len(ans),
                    "stress_at": [i for i, t in enumerate(ans) if t == "ˈ"],
                    "has_audio": bool(it.audio_path)})
    return {"id": s.id, "title": s.title, "book_name": b.name, "items": out}


@student_router.get("/items/{item_id}/audio")
async def student_item_audio(item_id: int, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    org_id = None if user.role == "admin" else current_org_id.get()
    row = await _item_with_set(db, item_id, org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    return _audio_response(row[0])


@student_router.get("/items/{item_id}/tts")
async def student_item_tts(item_id: int, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    """系统读这一题。按题目 id 取,**单词不出现在网址里** —— 走 /pronunciation/edge-tts?word=xxx
    的话,孩子打开开发者工具看一眼请求就知道答案了"""
    org_id = None if user.role == "admin" else current_org_id.get()
    row = await _item_with_set(db, item_id, org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    it = row[0]
    from app.services import edge_tts_service
    if not edge_tts_service.is_available():
        raise HTTPException(status_code=503, detail="发音服务暂时用不了,请老师稍后再试")
    try:
        data = await edge_tts_service.generate_pronunciation(it.tts_text or it.word)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="发音合成失败,点一下再听一次")
    return Response(content=data, media_type="audio/mpeg",
                    headers={"Cache-Control": "private, max-age=86400"})


class CheckIn(BaseModel):
    item_id: int
    pass_number: int = Field(1, ge=1, le=2)
    word: Optional[str] = Field(None, max_length=100)
    phonetic: List[Optional[str]] = Field(default_factory=list, max_length=20)
    give_up: bool = False
    duration_ms: Optional[int] = Field(None, ge=0, le=3_600_000)


def _grade_and_record(db: AsyncSession, user: User, it: ListeningItem, s: ListeningSet,
                      word: Optional[str], phonetic: List[Optional[str]], pass_number: int,
                      give_up: bool, duration_ms: Optional[int]) -> dict:
    """判一题 + 记一行作答(不 commit)。单题和整页共用这一份 —— 两处各判一遍口径会漂。

    答案只在「这题结束了」才给: 做对 / 第二遍判完 / 看答案。第一遍错只说哪里错"""
    pass_number = 2 if give_up else pass_number
    g = pl.grade(it, word, phonetic, pass_number)
    if give_up:
        g["all_correct"] = False
    db.add(ListeningAttempt(
        user_id=user.id, item_id=it.id, set_id=s.id, pass_number=pass_number,
        word_submitted=(word or "")[:100], word_correct=g["word_ok"] and not give_up,
        phonetic_submitted_json=json.dumps(phonetic, ensure_ascii=False),
        phonetic_correct=g["phonetic_ok"] and not give_up,
        is_correct=g["all_correct"], gave_up=give_up, duration_ms=duration_ms,
        org_id=current_org_id.get(),
    ))
    finished = g["all_correct"] or pass_number >= 2
    out = {
        "item_id": it.id,
        "all_correct": g["all_correct"], "word_ok": g["word_ok"] and not give_up,
        "phonetic_ok": g["phonetic_ok"] and not give_up,
        "per_slot": g["per_slot"], "wrong_indexes": g["wrong_indexes"], "finished": finished,
    }
    if not finished:
        # 第二遍: 音标只填元音格(辅音回填);单词对了就锁住不用再写
        b = set(g["next_blanks"])
        out["next_blanks"] = g["next_blanks"]
        out["prefill"] = [None if i in b else a for i, a in enumerate(g["answer"])]
    else:
        out["answer"] = {"word": it.word, "phonetic_tokens": g["answer"],
                         "phonetic": it.answer_display, "meaning": it.meaning}
    return out


@student_router.post("/check")
async def check(body: CheckIn, db: AsyncSession = Depends(get_db),
                user: User = Depends(get_current_user)):
    """判一题(卡片模式)"""
    org_id = None if user.role == "admin" else current_org_id.get()
    row = await _item_with_set(db, body.item_id, org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这道题不存在")
    it, s, _b = row
    out = _grade_and_record(db, user, it, s, body.word, body.phonetic, body.pass_number,
                            body.give_up, body.duration_ms)
    await db.commit()
    return out


class PageAnswer(BaseModel):
    item_id: int
    word: Optional[str] = Field(None, max_length=100)
    phonetic: List[Optional[str]] = Field(default_factory=list, max_length=20)
    give_up: bool = False


class PageCheckIn(BaseModel):
    set_id: int
    pass_number: int = Field(1, ge=1, le=2)
    answers: List[PageAnswer] = Field(..., min_length=1, max_length=pl.ITEMS_MAX)
    duration_ms: Optional[int] = Field(None, ge=0, le=3_600_000)


@student_router.post("/check-page")
async def check_page(body: PageCheckIn, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """整页一次交(整页模式): 一页 20 题一起判,逐题规则和 /check 完全一样。
    题目必须都属于这一套(混进别的套的题整页拒,不判一半)"""
    org_id = None if user.role == "admin" else current_org_id.get()
    row = await _set_visible(db, body.set_id, org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这套听力不存在")
    s, _b = row
    ids = [a.item_id for a in body.answers]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="同一题交了两次,刷新页面再试")
    items = {it.id: it for it in (await db.execute(
        select(ListeningItem).where(ListeningItem.set_id == s.id, ListeningItem.id.in_(ids))
    )).scalars()}
    if len(items) != len(ids):
        raise HTTPException(status_code=400, detail="有的题不在这一套里,刷新页面再试")
    per = (body.duration_ms // len(ids)) if body.duration_ms else None
    results = [_grade_and_record(db, user, items[a.item_id], s, a.word, a.phonetic, body.pass_number,
                                 a.give_up, per) for a in body.answers]
    await db.commit()
    return {"right_count": sum(1 for r in results if r["all_correct"]), "total": len(results),
            "results": results}
