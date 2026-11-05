"""教师端音标教材管理 —— 网页上传 Excel,不必再 ssh 上服务器跑脚本

## 为什么有这个文件
音标教材此前**只能命令行导入**(scripts/import_phonetic_book.py),
而单词早就能在教师端网页导入。结果是老师加不了新音标教材、改不了题目,
唯一入口在能 ssh 的人手上 —— 这是个真缺口,不是设计取舍。

## 与单词导入对齐的做法
前端用 SheetJS 解 Excel、把行数据当 JSON 传过来(与 TeacherBooks.tsx 同套路),
后端不收文件。理由:①省掉服务端 openpyxl 依赖与临时文件 ②失败在浏览器就能看到
③单词导入已经这么做了,两处保持一致。

## 音标切分不在这里实现
走 services/phonetic_tokenize(唯一真源,与命令行脚本共用)。
在这里再写一份归一规则 = 学生做不对的死题。

## 校验先行,失败不落库
一整本要么全进要么全不进。导一半留个残缺教材在库里,学生做到中间发现没题,
比直接失败糟糕得多 —— 所以先全量校验,有错就返回错误清单、一行都不写。
"""
import json
import logging
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.tenancy import current_org_id
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticItem, PhoneticLesson,
)
from app.models.user import User
from app.services import audit_log
from app.services.phonetic_ids import IdAllocator
from app.services.phonetic_tokenize import check_item, check_tts_text, lesson_highlight

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_staff(user: User) -> None:
    """教师及以上才能碰教材。学生端只读"""
    if user.role not in ("teacher", "org_admin", "admin"):
        raise HTTPException(status_code=403, detail="只有老师和管理员能管理音标教材")


async def _own_book(db: AsyncSession, book_id: int, user: User) -> PhoneticBook:
    """取书并判归属。

    平台预置教材(org_id 为 NULL)对机构是**只读** —— 那是所有机构共享的,
    一个机构改了会影响别人。只有 admin 能动它。
    """
    b = (await db.execute(
        select(PhoneticBook).where(PhoneticBook.id == book_id)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="教材不存在")
    if user.role == "admin":
        return b
    if b.org_id is None:
        raise HTTPException(
            status_code=403,
            detail="这是平台预置教材,只能查看。请自己上传一本再编辑")
    if b.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="教材不存在")
    return b


# ---------------------------------------------------------------- 列表


class LessonBrief(BaseModel):
    id: int
    code: str
    title: str
    lesson_number: int
    item_count: int
    removed_count: int
    # 这一节有几个词指定了发音
    tts_count: int = 0


class BookOut(BaseModel):
    id: int
    name: str
    volume: Optional[str] = None
    description: Optional[str] = None
    is_active: bool
    lesson_count: int
    item_count: int
    # 平台预置(org_id 为 NULL)对机构只读,前端据此隐藏编辑按钮
    is_preset: bool
    can_edit: bool
    # 指定了发音的词数
    tts_count: int = 0


@router.get("/books", response_model=List[BookOut])
async def list_books(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """列出能看到的音标教材:本机构的 + 平台预置的"""
    _require_staff(current_user)
    org_id = current_org_id.get()

    q = select(PhoneticBook).execution_options(skip_tenant_filter=True)
    if current_user.role != "admin":
        from sqlalchemy import or_
        q = q.where(or_(PhoneticBook.org_id == org_id,
                        PhoneticBook.org_id.is_(None)))
    books = (await db.execute(q.order_by(PhoneticBook.id.desc()))).scalars().all()
    if not books:
        return []

    ids = [b.id for b in books]
    # 一次聚合出各书的节数与题数,避免 N+1
    ls_rows = (await db.execute(
        select(PhoneticLesson.book_id, func.count(PhoneticLesson.id))
        .where(PhoneticLesson.book_id.in_(ids))
        .group_by(PhoneticLesson.book_id)
    )).all()
    ls_cnt = {bid: n for bid, n in ls_rows}
    it_rows = (await db.execute(
        select(PhoneticLesson.book_id, func.count(PhoneticItem.id), func.count(PhoneticItem.tts_text))
        .join(PhoneticItem, PhoneticItem.lesson_id == PhoneticLesson.id)
        .where(PhoneticLesson.book_id.in_(ids))
        .group_by(PhoneticLesson.book_id)
    )).all()
    it_cnt = {bid: n for bid, n, _ in it_rows}
    tts_cnt = {bid: nt for bid, _, nt in it_rows}

    out = []
    for b in books:
        preset = b.org_id is None
        out.append(BookOut(
            id=b.id, name=b.name, volume=b.volume, description=b.description,
            is_active=bool(b.is_active),
            lesson_count=ls_cnt.get(b.id, 0), item_count=it_cnt.get(b.id, 0),
            is_preset=preset,
            can_edit=(current_user.role == "admin") or not preset,
            tts_count=tts_cnt.get(b.id, 0),
        ))
    return out


@router.get("/books/{book_id}/lessons", response_model=List[LessonBrief])
async def list_lessons(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """看一本书的分节。平台预置的也能看(只是不能改)"""
    _require_staff(current_user)
    b = (await db.execute(
        select(PhoneticBook).where(PhoneticBook.id == book_id)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(status_code=404, detail="教材不存在")
    if current_user.role != "admin" and b.org_id is not None \
            and b.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="教材不存在")

    rows = (await db.execute(
        select(PhoneticLesson, func.count(PhoneticItem.id), func.count(PhoneticItem.tts_text))
        .outerjoin(PhoneticItem, PhoneticItem.lesson_id == PhoneticLesson.id)
        .where(PhoneticLesson.book_id == book_id)
        .group_by(PhoneticLesson.id)
        .order_by(PhoneticLesson.lesson_number, PhoneticLesson.id)
    )).all()
    return [LessonBrief(
        id=ls.id, code=ls.code, title=ls.title,
        lesson_number=ls.lesson_number, item_count=n,
        removed_count=ls.removed_count or 0, tts_count=nt,
    ) for ls, n, nt in rows]


# ---------------------------------------------------------------- 校验 / 导入


class ImportRow(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    phonetic: str = Field(..., min_length=1, max_length=200)
    meaning: Optional[str] = Field(None, max_length=200)
    # 「发音」列(可选): 标准音按这个读。空 = 按单词读。校验在 phonetic_tokenize.check_tts_text
    tts: Optional[str] = Field(None, max_length=200)


class ImportLesson(BaseModel):
    """一节。code 形如「1—1」,title 是 sheet 名"""
    code: str = Field(..., min_length=1, max_length=20)
    title: str = Field(..., min_length=1, max_length=200)
    rows: List[ImportRow]


class ImportIn(BaseModel):
    book_name: str = Field(..., min_length=1, max_length=200)
    volume: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    lessons: List[ImportLesson]
    # 同名教材已存在时是否覆盖。默认不覆盖,避免手滑抹掉整本
    replace: bool = False


class RowError(BaseModel):
    lesson: str
    word: str
    reason: str


class ValidateOut(BaseModel):
    ok: bool
    lesson_count: int
    item_count: int
    errors: List[RowError]
    # 同名教材是否已存在 —— 前端据此决定要不要弹「覆盖」确认
    existing_book_id: Optional[int] = None
    existing_item_count: Optional[int] = None
    # 填了「发音」的行数
    tts_count: int = 0


def _check_rows(lesson_label: str, rows) -> tuple[list, list]:
    """一节的行 → (可入库的题, 错误)。导入、加一节、改题三处共用,口径只有这一份"""
    items, errors = [], []
    for r in rows:
        word = " ".join((r.word or "").split())
        if not word:
            continue
        ok, err = check_item(word, r.phonetic)
        if err:
            errors.append(RowError(lesson=lesson_label, word=word, reason=err))
            continue
        tts, terr = check_tts_text(r.tts)
        if terr:
            errors.append(RowError(lesson=lesson_label, word=word, reason=terr))
            continue
        ok["meaning"] = (r.meaning or "").strip() or None
        ok["tts_text"] = tts
        ok["id"] = getattr(r, "id", None)
        items.append(ok)
    return items, errors


def _norm_word(w: Optional[str]) -> str:
    return " ".join((w or "").replace("\u2019", "'").split()).lower()


def _norm_code(raw: str) -> str:
    """小节编号: 「1-1」「1 — 1」都写成「1—1」(学生目录里显示的就是它)"""
    t = " ".join((raw or "").split())
    return re.sub(r"^(\d+)\s*[-–—]\s*(\d+)", r"\1—\2", t)[:20]


async def _sync_items(db: AsyncSession, ls: PhoneticLesson, rows: List[dict],
                      old: dict, item_ids: IdAllocator) -> List[PhoneticItem]:
    """把 rows 写成这一节的题(rows 是 _check_rows 的输出,可带 id)。

    - 带 id、单词没变的原地改: id 不变,学生写音标记录、跟读录音都还对得上
    - **单词变了按新题**(新 id),旧题删掉: 原地改的话,学生写 bad 的记录和录音会算到 bed 头上
    - 不带 id 的新加;old 里没出现的删掉。学生的作答 / 录音记录一律不删(那是学情)
    调用方先确认 rows 里的 id 都在 old 里"""
    keep: set[int] = set()
    out = []
    for i, d in enumerate(rows):
        it = old.get(d.get("id")) if d.get("id") is not None else None
        if it is not None and (it.id in keep or _norm_word(it.word) != _norm_word(d["word"])):
            it = None
        if it is None:
            it = PhoneticItem(id=item_ids.next(), lesson_id=ls.id)
            db.add(it)
        else:
            keep.add(it.id)
        it.word = d["word"]
        it.meaning = d.get("meaning")
        it.answer_json = json.dumps(d["answer"], ensure_ascii=False)
        it.answer_display = f"[{''.join(d['answer'])}]"
        it.core_indexes_json = json.dumps(d["core"])
        it.order_index = i
        it.tts_text = d.get("tts_text")
        out.append(it)
    for iid, it in old.items():
        if iid not in keep:
            await db.delete(it)
    ls.highlight_json = json.dumps(lesson_highlight(rows), ensure_ascii=False)
    return out


async def _items_of(db: AsyncSession, lesson_id: int) -> dict:
    return {it.id: it for it in (await db.execute(
        select(PhoneticItem).where(PhoneticItem.lesson_id == lesson_id))).scalars()}


def _parse(payload: ImportIn):
    """全量校验 → (可入库的节列表, 错误清单)。不写库"""
    parsed, errors = [], []
    seen_code = {}
    for ls in payload.lessons:
        code = ls.code.strip()

        # ⚠️ 小节编号在一本书里必须唯一(phonetic_lessons 有
        # UniqueConstraint(book_id, code))。前端 codeOf() 只取 sheet 名的数字前缀,
        # 「1—1 拼读」和「1—1 复习」会切出同一个 1—1 —— 不在这里拦,
        # 就会在写库时撞唯一约束抛 IntegrityError → 500,老师只看到
        # 「Internal Server Error」,完全不知道是两个表撞了编号。
        if code in seen_code:
            errors.append(RowError(
                lesson=ls.title, word="(整节)",
                reason=f"小节编号「{code}」和工作表「{seen_code[code]}」重复了,"
                       f"一本教材里每节的编号必须唯一 —— 请改掉其中一个表名"))
            continue
        seen_code[code] = ls.title.strip()

        items, errs = _check_rows(ls.title, ls.rows)
        errors.extend(errs)
        if items:
            parsed.append(dict(code=code, title=ls.title.strip(),
                               items=items, highlight=lesson_highlight(items)))
    return parsed, errors


async def _find_same_name(db: AsyncSession, name: str, org_id, is_admin: bool):
    """同名教材查重。机构只在自己范围内查重(平台预置的同名不算冲突)"""
    q = select(PhoneticBook).where(PhoneticBook.name == name) \
        .execution_options(skip_tenant_filter=True)
    q = q.where(PhoneticBook.org_id.is_(None)) if is_admin and org_id is None \
        else q.where(PhoneticBook.org_id == org_id)
    return (await db.execute(q)).scalars().first()


@router.post("/books/validate", response_model=ValidateOut)
async def validate_import(
    payload: ImportIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """先校验再导 —— 让老师在写库**之前**就看到哪几行有问题。

    音标里只要有一个键盘上没有的符号,那题学生就永远填不出来。
    与其导进去等学生卡住,不如在这里指名道姓列出来。
    """
    _require_staff(current_user)
    parsed, errors = _parse(payload)
    org_id = None if current_user.role == "admin" else current_user.org_id
    same = await _find_same_name(db, payload.book_name.strip(), org_id,
                                 current_user.role == "admin")
    exist_n = None
    if same:
        exist_n = (await db.execute(
            select(func.count(PhoneticItem.id))
            .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
            .where(PhoneticLesson.book_id == same.id)
        )).scalar() or 0
    return ValidateOut(
        ok=(not errors and bool(parsed)),
        lesson_count=len(parsed),
        item_count=sum(len(p["items"]) for p in parsed),
        errors=errors[:200],
        existing_book_id=same.id if same else None,
        existing_item_count=exist_n,
        tts_count=sum(1 for p in parsed for it in p["items"] if it.get("tts_text")),
    )


class ImportOut(BaseModel):
    book_id: int
    book_name: str
    lesson_count: int
    item_count: int
    replaced: bool


@router.post("/books/import", response_model=ImportOut)
async def import_book(
    payload: ImportIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """导入一本音标教材。**有任何一行不合格就整本不导**

    要么全进要么全不进:导一半留个残缺教材,学生做到中间发现没题,
    比直接失败糟糕得多。
    """
    _require_staff(current_user)
    parsed, errors = _parse(payload)
    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"有 {len(errors)} 行音标不合格,已全部取消导入。"
                   f"先在「校验」里看清单改好 Excel 再传")
    if not parsed:
        raise HTTPException(status_code=400, detail="没有解析出任何小节")

    # 机构上传的归自己;平台 admin 上传的 org_id 留空 = 所有机构共享
    org_id = None if current_user.role == "admin" else current_user.org_id
    name = payload.book_name.strip()
    same = await _find_same_name(db, name, org_id, current_user.role == "admin")
    replaced = False
    if same and not payload.replace:
        raise HTTPException(
            status_code=409,
            detail=f"已经有一本叫「{name}」的教材了。要覆盖请勾选「替换同名教材」")

    lesson_ids = await IdAllocator.for_phonetic_lessons(db)
    item_ids = await IdAllocator.for_phonetic_items(db)
    if same:
        # 覆盖 = **原地改**,不是删了重建: 书 id 不变(挂在下面的音标听力、作业都还在),
        # 同一个编号的节、同一节里同一个单词的题 id 不变(学生的写音标记录、跟读录音都还对得上)。
        # Excel 里没有的节 / 题删掉;学生的作答记录一律不删
        book = same
        book.volume = (payload.volume or None) if payload.volume is not None else book.volume
        if payload.description is not None:
            book.description = payload.description or None
        old_lessons = {ls.code: ls for ls in (await db.execute(
            select(PhoneticLesson).where(PhoneticLesson.book_id == book.id))).scalars()}
        replaced = True
    else:
        book = PhoneticBook(
            id=(await IdAllocator.for_phonetic_books(db)).next(),
            name=name, volume=(payload.volume or None),
            description=(payload.description or None),
            org_id=org_id, created_by=current_user.id,
        )
        db.add(book)
        await db.flush()
        old_lessons = {}

    total = 0
    for n, p in enumerate(parsed, 1):
        ls = old_lessons.pop(p["code"], None)
        old_items: dict = {}
        if ls is None:
            ls = PhoneticLesson(id=lesson_ids.next(), book_id=book.id, code=p["code"], removed_count=0)
            db.add(ls)
        else:
            old_items = await _items_of(db, ls.id)
            pool: dict[str, list] = {}
            for it in sorted(old_items.values(), key=lambda x: (x.order_index, x.id)):
                pool.setdefault(_norm_word(it.word), []).append(it.id)
            for d in p["items"]:
                ids = pool.get(_norm_word(d["word"]))
                d["id"] = ids.pop(0) if ids else None
        ls.title = p["title"]
        ls.lesson_number = n
        await _sync_items(db, ls, p["items"], old_items, item_ids)
        total += len(p["items"])
    for ls in old_lessons.values():
        await db.execute(delete(PhoneticItem).where(PhoneticItem.lesson_id == ls.id))
        await db.delete(ls)
    audit_log.record(db, request, current_user, "phonetic.book_import",
                     f"{'覆盖' if replaced else '导入'}音标教材「{name}」{len(parsed)} 节 {total} 题",
                     target_type="phonetic_book", target_id=book.id)
    await db.commit()
    logger.info("音标教材导入: book_id=%s %s 节 %s 题 by user=%s",
                book.id, len(parsed), total, current_user.id)
    return ImportOut(book_id=book.id, book_name=name,
                     lesson_count=len(parsed), item_count=total,
                     replaced=replaced)


# ---------------------------------------------------------------- 发音(只改发音,不动题)
#
# 2026-10-30 用户「有的长音或者短音发音的后台传的时候可以增加个重发音按我给的单词发音吗」。
# 新教材在上传的 Excel 里加「发音」列就行(见 ImportRow.tts)。已经在用的教材要改发音,
# **不能走整本替换**: 替换会删掉所有题重建,id 全换,学生「写对 N 个」、跟读录音都对不上了。
# 所以单独两条: 列出整本的题 → 在页面上逐个填、试听 → 按题目 id 只写 tts_text。


class TtsItemOut(BaseModel):
    id: int
    lesson_id: int
    code: str
    word: str
    phonetic: str
    meaning: Optional[str] = None
    tts_text: Optional[str] = None


@router.get("/books/{book_id}/items", response_model=List[TtsItemOut])
async def list_book_items(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """整本的题(改发音用)。平台预置的也能看,只是改要平台管理员"""
    _require_staff(current_user)
    b = (await db.execute(
        select(PhoneticBook).where(PhoneticBook.id == book_id)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if not b or (current_user.role != "admin" and b.org_id is not None
                 and b.org_id != current_user.org_id):
        raise HTTPException(status_code=404, detail="教材不存在")
    rows = (await db.execute(
        select(PhoneticItem, PhoneticLesson.code)
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .where(PhoneticLesson.book_id == book_id)
        .order_by(PhoneticLesson.lesson_number, PhoneticLesson.id,
                  PhoneticItem.order_index, PhoneticItem.id)
    )).all()
    return [TtsItemOut(
        id=it.id, lesson_id=it.lesson_id, code=code, word=it.word,
        phonetic=it.answer_display or f"[{''.join(json.loads(it.answer_json or '[]'))}]",
        meaning=it.meaning, tts_text=it.tts_text,
    ) for it, code in rows]


class TtsChange(BaseModel):
    id: int
    # 空 / null = 改回按单词读
    tts: Optional[str] = Field(None, max_length=200)


class TtsIn(BaseModel):
    items: List[TtsChange] = Field(..., min_length=1, max_length=2000)


class TtsOut(BaseModel):
    updated: int
    # 这本书现在一共有几个词指定了发音
    with_tts: int


@router.post("/books/{book_id}/tts", response_model=TtsOut)
async def update_book_tts(
    book_id: int,
    payload: TtsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """只改发音,按题目 id。题目、id、学生进度和录音都不动

    有一个不合格(发音不是英文 / 题不是这本书的)就一个都不改 —— 和导入一样不改一半。
    平台预置教材只有平台管理员能改(_own_book)。
    """
    _require_staff(current_user)
    book = await _own_book(db, book_id, current_user)

    errors, wanted = [], {}
    for c in payload.items:
        tts, err = check_tts_text(c.tts)
        if err:
            errors.append(err)
        else:
            wanted[c.id] = tts
    if errors:
        raise HTTPException(status_code=400, detail=f"一个都没改:{errors[0]}")

    rows = (await db.execute(
        select(PhoneticItem)
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .where(PhoneticLesson.book_id == book.id, PhoneticItem.id.in_(list(wanted)))
    )).scalars().all()
    if len(rows) != len(wanted):
        # 别的书的题混进来了(或者刚被删掉)—— 不能顺手改到别人的书上
        raise HTTPException(status_code=400, detail="有的题不在这本书里,一个都没改。刷新页面再试")
    updated = 0
    for it in rows:
        if it.tts_text != wanted[it.id]:
            it.tts_text = wanted[it.id]
            updated += 1
    await db.flush()
    with_tts = (await db.execute(
        select(func.count(PhoneticItem.tts_text))
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .where(PhoneticLesson.book_id == book.id)
    )).scalar() or 0
    await db.commit()
    logger.info("音标教材改发音: book_id=%s 改 %s 个 by user=%s", book.id, updated, current_user.id)
    return TtsOut(updated=updated, with_tts=with_tts)


class BookPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    volume: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    is_active: Optional[bool] = None


@router.patch("/books/{book_id}", response_model=BookOut)
async def update_book(
    book_id: int,
    patch: BookPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """改教材名 / 册次 / 简介 / 上下架。

    「留空=不修改」走 exclude_unset;名字传了空串是 422(min_length=1),不会被静默跳过。
    改名要查重: 同一层(本机构 / 平台)里不能有两本同名 —— 导入时按名字找「要覆盖的那本」,重名就找错书。
    """
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    data = patch.model_dump(exclude_unset=True)
    changes = []
    if "name" in data:
        name = " ".join((data["name"] or "").split())
        if not name:
            raise HTTPException(status_code=400, detail="教材名不能为空")
        if name != b.name:
            same = await _find_same_name(db, name, b.org_id, b.org_id is None)
            if same and same.id != b.id:
                raise HTTPException(status_code=409, detail=f"已经有一本叫「{name}」的教材了,换个名字")
            changes.append(f"名字「{b.name}」→「{name}」")
            b.name = name
    if "volume" in data:
        b.volume = (data["volume"] or "").strip() or None
    if "description" in data:
        b.description = (data["description"] or "").strip() or None
    if "is_active" in data and data["is_active"] is not None and bool(data["is_active"]) != bool(b.is_active):
        b.is_active = bool(data["is_active"])
        changes.append("上架" if b.is_active else "下架")
    audit_log.record(db, request, current_user, "phonetic.book_update",
                     f"改音标教材「{b.name}」" + (":" + "、".join(changes) if changes else ""),
                     target_type="phonetic_book", target_id=b.id)
    await db.commit()
    return await _book_out(db, b, current_user)


async def _book_out(db: AsyncSession, b: PhoneticBook, user: User) -> BookOut:
    n_ls = (await db.execute(select(func.count(PhoneticLesson.id))
                             .where(PhoneticLesson.book_id == b.id))).scalar() or 0
    n_it, n_tts = (await db.execute(
        select(func.count(PhoneticItem.id), func.count(PhoneticItem.tts_text))
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .where(PhoneticLesson.book_id == b.id))).one()
    return BookOut(id=b.id, name=b.name, volume=b.volume,
                   description=b.description, is_active=bool(b.is_active),
                   lesson_count=n_ls, item_count=n_it or 0,
                   is_preset=b.org_id is None,
                   can_edit=user.role == "admin" or b.org_id is not None,
                   tts_count=n_tts or 0)


@router.delete("/books/{book_id}")
async def delete_book(
    book_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删整本。学生的答题记录不删(那是学情,抹掉等于丢数据);挂在下面的音标听力一起停用。
    删之前前端先调 /usage 把影响摆给老师看"""
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    from app.models.phonetic_listening import ListeningSet
    n_sets = (await db.execute(
        update(ListeningSet).where(ListeningSet.book_id == b.id, ListeningSet.is_active.is_(True))
        .values(is_active=False))).rowcount or 0
    ls_ids = [r[0] for r in await db.execute(
        select(PhoneticLesson.id).where(PhoneticLesson.book_id == b.id))]
    if ls_ids:
        await db.execute(delete(PhoneticItem).where(
            PhoneticItem.lesson_id.in_(ls_ids)))
    await db.execute(delete(PhoneticLesson).where(
        PhoneticLesson.book_id == b.id))
    audit_log.record(db, request, current_user, "phonetic.book_delete",
                     f"删除音标教材「{b.name}」{len(ls_ids)} 节" + (f",停用 {n_sets} 套听力" if n_sets else ""),
                     target_type="phonetic_book", target_id=b.id)
    await db.delete(b)
    await db.commit()
    return {"deleted": True, "lesson_count": len(ls_ids), "listening_sets": n_sets}


# ---------------------------------------------------------------- 分节 / 题目的增删改(2026-11-05)
#
# 用户「我需要可以改教材的名字 还有些增删改查的功能你设计完善点」。以前一本教材建好后只能整本替换,
# 想改一个词、加一节、调个顺序都得重新传 Excel。这里补齐按节、按题改,规矩和导入一样:
# - 平台预置只有平台 admin 能改(_own_book),别家的书 404
# - 有一题音标不合格整批不写,错误逐条列出
# - 题目 id 尽量不变: 单词没改的题原地改;**单词改了算新题**(否则学生写 bad 的记录会算到 bed 头上)
# - 学生的作答 / 跟读录音一律不删;删节 / 删题前先给老师看会影响多少(/usage)
# - 新建的节 / 题用不复用的 id(services/phonetic_ids)


async def _own_lesson(db: AsyncSession, lesson_id: int, user: User) -> tuple[PhoneticLesson, PhoneticBook]:
    ls = (await db.execute(select(PhoneticLesson).where(PhoneticLesson.id == lesson_id))).scalar_one_or_none()
    if ls is None:
        raise HTTPException(status_code=404, detail="这一节不存在")
    b = await _own_book(db, ls.book_id, user)
    return ls, b


async def _usage(db: AsyncSession, lesson_ids: List[int], book_id: Optional[int] = None) -> dict:
    """这些节有多少学生记录 / 作业 / 听力 —— 删之前给老师看"""
    from app.models.content_homework import ContentHomework, KIND_PHONETIC_READ, KIND_PHONETIC_WRITE
    from app.models.phonetic_listening import ListeningSet
    from app.models.phonetic_practice import PhoneticAttempt, PhoneticReading
    out = {"students": 0, "attempts": 0, "readings": 0, "homework": 0, "listening_sets": 0}
    if lesson_ids:
        a = (await db.execute(select(func.count(PhoneticAttempt.id), func.count(func.distinct(PhoneticAttempt.user_id)))
                              .where(PhoneticAttempt.lesson_id.in_(lesson_ids)))).one()
        r = (await db.execute(select(func.count(PhoneticReading.id), func.count(func.distinct(PhoneticReading.user_id)))
                              .where(PhoneticReading.lesson_id.in_(lesson_ids)))).one()
        uids = set((await db.execute(select(func.distinct(PhoneticAttempt.user_id))
                                     .where(PhoneticAttempt.lesson_id.in_(lesson_ids)))).scalars())
        uids |= set((await db.execute(select(func.distinct(PhoneticReading.user_id))
                                      .where(PhoneticReading.lesson_id.in_(lesson_ids)))).scalars())
        out.update(attempts=a[0] or 0, readings=r[0] or 0, students=len(uids))
        out["homework"] = (await db.execute(select(func.count(ContentHomework.id)).where(
            ContentHomework.kind.in_((KIND_PHONETIC_WRITE, KIND_PHONETIC_READ)),
            ContentHomework.target_id.in_(lesson_ids), ContentHomework.is_closed.is_(False))
            .execution_options(skip_tenant_filter=True))).scalar() or 0
    if book_id is not None:
        out["listening_sets"] = (await db.execute(select(func.count(ListeningSet.id)).where(
            ListeningSet.book_id == book_id, ListeningSet.is_active.is_(True))
            .execution_options(skip_tenant_filter=True))).scalar() or 0
    return out


@router.get("/books/{book_id}/usage")
async def book_usage(book_id: int, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """删整本前看影响: 多少学生练过、几份没关的作业、几套听力(所有机构一起算 —— 平台预置删了大家都没了)"""
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    ids = list((await db.execute(select(PhoneticLesson.id).where(PhoneticLesson.book_id == b.id))).scalars())
    return await _usage(db, ids, b.id)


@router.get("/lessons/{lesson_id}/usage")
async def lesson_usage(lesson_id: int, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _require_staff(current_user)
    ls, _b = await _own_lesson(db, lesson_id, current_user)
    return await _usage(db, [ls.id])


class LessonItemOut(BaseModel):
    id: int
    word: str
    phonetic: str
    meaning: Optional[str] = None
    tts: Optional[str] = None


class LessonDetailOut(BaseModel):
    id: int
    book_id: int
    code: str
    title: str
    can_edit: bool
    items: List[LessonItemOut]


async def _lesson_detail(db: AsyncSession, ls: PhoneticLesson, can_edit: bool) -> LessonDetailOut:
    items = (await db.execute(select(PhoneticItem).where(PhoneticItem.lesson_id == ls.id)
                              .order_by(PhoneticItem.order_index, PhoneticItem.id))).scalars().all()
    return LessonDetailOut(id=ls.id, book_id=ls.book_id, code=ls.code, title=ls.title, can_edit=can_edit, items=[
        LessonItemOut(id=it.id, word=it.word, meaning=it.meaning, tts=it.tts_text,
                      phonetic=it.answer_display or f"[{''.join(json.loads(it.answer_json or '[]'))}]")
        for it in items])


@router.get("/lessons/{lesson_id}", response_model=LessonDetailOut)
async def get_lesson_for_edit(lesson_id: int, db: AsyncSession = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    """一节的题(带答案,老师编辑用)。平台预置的老师也能看,只读"""
    _require_staff(current_user)
    ls = (await db.execute(select(PhoneticLesson).where(PhoneticLesson.id == lesson_id))).scalar_one_or_none()
    if ls is None:
        raise HTTPException(status_code=404, detail="这一节不存在")
    b = (await db.execute(select(PhoneticBook).where(PhoneticBook.id == ls.book_id)
                          .execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if b is None or (current_user.role != "admin" and b.org_id is not None and b.org_id != current_user.org_id):
        raise HTTPException(status_code=404, detail="这一节不存在")
    return await _lesson_detail(db, ls, current_user.role == "admin" or b.org_id is not None)


class EditRow(BaseModel):
    id: Optional[int] = None            # 改的时候带上;新加的题不带
    word: str = Field(..., min_length=1, max_length=100)
    phonetic: str = Field(..., min_length=1, max_length=200)
    meaning: Optional[str] = Field(None, max_length=200)
    tts: Optional[str] = Field(None, max_length=200)


class LessonIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    title: Optional[str] = Field(None, max_length=200)
    rows: List[EditRow] = Field(default_factory=list, max_length=200)


def _rows_or_400(label: str, rows: List[EditRow]) -> List[dict]:
    items, errors = _check_rows(label, rows)
    if errors:
        raise HTTPException(status_code=400, detail={
            "code": "invalid_items", "message": f"{errors[0].word}: {errors[0].reason}",
            "errors": [f"{e.word}: {e.reason}" for e in errors]})
    return items


async def _code_taken(db: AsyncSession, book_id: int, code: str, except_id: Optional[int] = None) -> bool:
    q = select(PhoneticLesson.id).where(PhoneticLesson.book_id == book_id, PhoneticLesson.code == code)
    if except_id is not None:
        q = q.where(PhoneticLesson.id != except_id)
    return (await db.execute(q)).first() is not None


@router.post("/books/{book_id}/lessons", response_model=LessonDetailOut)
async def add_lesson(book_id: int, body: LessonIn, request: Request, db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """加一节(排在最后)。题可以先空着,之后在「编辑」里加"""
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    code = _norm_code(body.code)
    if not code:
        raise HTTPException(status_code=400, detail="小节编号不能为空,写成「1—1」这样")
    if await _code_taken(db, b.id, code):
        raise HTTPException(status_code=409, detail=f"这本教材里已经有「{code}」这一节了,换个编号")
    title = " ".join((body.title or "").split()) or code
    items = _rows_or_400(title, body.rows)
    last = (await db.execute(select(func.max(PhoneticLesson.lesson_number))
                             .where(PhoneticLesson.book_id == b.id))).scalar() or 0
    ls = PhoneticLesson(id=(await IdAllocator.for_phonetic_lessons(db)).next(), book_id=b.id, code=code,
                        title=title[:200], lesson_number=last + 1, removed_count=0)
    db.add(ls)
    await _sync_items(db, ls, [dict(d, id=None) for d in items], {}, await IdAllocator.for_phonetic_items(db))
    audit_log.record(db, request, current_user, "phonetic.lesson_add",
                     f"音标教材「{b.name}」加一节 {code}({len(items)} 题)",
                     target_type="phonetic_lesson", target_id=ls.id)
    await db.commit()
    return await _lesson_detail(db, ls, True)


@router.put("/lessons/{lesson_id}", response_model=LessonDetailOut)
async def update_lesson(lesson_id: int, body: LessonIn, request: Request, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    """改一节: 编号、名字、题目一次存。有一题不合格一题都不改"""
    _require_staff(current_user)
    ls, b = await _own_lesson(db, lesson_id, current_user)
    code = _norm_code(body.code)
    if not code:
        raise HTTPException(status_code=400, detail="小节编号不能为空,写成「1—1」这样")
    if await _code_taken(db, b.id, code, except_id=ls.id):
        raise HTTPException(status_code=409, detail=f"这本教材里已经有「{code}」这一节了,换个编号")
    title = " ".join((body.title or "").split()) or code
    items = _rows_or_400(title, body.rows)
    if not items:
        raise HTTPException(status_code=400, detail="一节至少要有一题。整节不要了点「删除这一节」")
    old = await _items_of(db, ls.id)
    if any(d["id"] is not None and d["id"] not in old for d in items):
        raise HTTPException(status_code=400, detail="有的题不在这一节里,一个都没改。刷新页面再试")
    before = len(old)
    ls.code, ls.title = code, title[:200]
    await _sync_items(db, ls, items, old, await IdAllocator.for_phonetic_items(db))
    audit_log.record(db, request, current_user, "phonetic.lesson_update",
                     f"改音标教材「{b.name}」{code}: {before} 题 → {len(items)} 题",
                     target_type="phonetic_lesson", target_id=ls.id)
    await db.commit()
    return await _lesson_detail(db, ls, True)


@router.delete("/lessons/{lesson_id}")
async def delete_lesson(lesson_id: int, request: Request, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    """删一节。学生的记录留着(学情);布置了这一节的作业学生那边不再显示(内容已删)"""
    _require_staff(current_user)
    ls, b = await _own_lesson(db, lesson_id, current_user)
    n = (await db.execute(delete(PhoneticItem).where(PhoneticItem.lesson_id == ls.id))).rowcount or 0
    audit_log.record(db, request, current_user, "phonetic.lesson_delete",
                     f"删除音标教材「{b.name}」{ls.code}({n} 题)",
                     target_type="phonetic_lesson", target_id=ls.id)
    await db.delete(ls)
    await db.commit()
    return {"deleted": True, "item_count": n}


class ReorderIn(BaseModel):
    lesson_ids: List[int] = Field(..., min_length=1, max_length=500)


@router.post("/books/{book_id}/lessons/reorder")
async def reorder_lessons(book_id: int, body: ReorderIn, request: Request, db: AsyncSession = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """整本重排。名单必须恰好是这本书的全部节,少了 / 多了 409 一条不写(中途有人加了节就别按旧名单写)"""
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    rows = {ls.id: ls for ls in (await db.execute(
        select(PhoneticLesson).where(PhoneticLesson.book_id == b.id))).scalars()}
    if len(body.lesson_ids) != len(set(body.lesson_ids)) or set(body.lesson_ids) != set(rows):
        raise HTTPException(status_code=409, detail="小节名单和现在的对不上(可能刚有人加了或删了一节),刷新页面再排")
    for n, lid in enumerate(body.lesson_ids, 1):
        rows[lid].lesson_number = n
    audit_log.record(db, request, current_user, "phonetic.lesson_reorder", f"调整音标教材「{b.name}」小节顺序",
                     target_type="phonetic_book", target_id=b.id)
    await db.commit()
    return {"ok": True}


# 音标听力(2026-11-03)老师端挂在这里: /api/v1/teacher/phonetic-books/listening/*。main.py 不动
from app.api.v1 import phonetic_listening as _listening  # noqa: E402
router.include_router(_listening.teacher_router, prefix="/listening")

# 音标学习报告(2026-11-03)老师端: /api/v1/teacher/phonetic-books/report/*
from app.api.v1 import phonetic_report as _report  # noqa: E402
router.include_router(_report.teacher_router, prefix="/report")
