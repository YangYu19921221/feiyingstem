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
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.tenancy import current_org_id
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticItem, PhoneticLesson,
)
from app.models.user import User
from app.services.phonetic_tokenize import check_item, lesson_highlight

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
        select(PhoneticLesson.book_id, func.count(PhoneticItem.id))
        .join(PhoneticItem, PhoneticItem.lesson_id == PhoneticLesson.id)
        .where(PhoneticLesson.book_id.in_(ids))
        .group_by(PhoneticLesson.book_id)
    )).all()
    it_cnt = {bid: n for bid, n in it_rows}

    out = []
    for b in books:
        preset = b.org_id is None
        out.append(BookOut(
            id=b.id, name=b.name, volume=b.volume, description=b.description,
            is_active=bool(b.is_active),
            lesson_count=ls_cnt.get(b.id, 0), item_count=it_cnt.get(b.id, 0),
            is_preset=preset,
            can_edit=(current_user.role == "admin") or not preset,
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
        select(PhoneticLesson, func.count(PhoneticItem.id))
        .outerjoin(PhoneticItem, PhoneticItem.lesson_id == PhoneticLesson.id)
        .where(PhoneticLesson.book_id == book_id)
        .group_by(PhoneticLesson.id)
        .order_by(PhoneticLesson.lesson_number, PhoneticLesson.id)
    )).all()
    return [LessonBrief(
        id=ls.id, code=ls.code, title=ls.title,
        lesson_number=ls.lesson_number, item_count=n,
        removed_count=ls.removed_count or 0,
    ) for ls, n in rows]


# ---------------------------------------------------------------- 校验 / 导入


class ImportRow(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    phonetic: str = Field(..., min_length=1, max_length=200)
    meaning: Optional[str] = Field(None, max_length=200)


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

        items = []
        for r in ls.rows:
            word = r.word.strip()
            if not word:
                continue
            ok, err = check_item(word, r.phonetic)
            if err:
                errors.append(RowError(lesson=ls.title, word=word, reason=err))
                continue
            ok["meaning"] = (r.meaning or "").strip() or None
            items.append(ok)
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
    if same:
        if not payload.replace:
            raise HTTPException(
                status_code=409,
                detail=f"已经有一本叫「{name}」的教材了。要覆盖请勾选「替换同名教材」")
        # 覆盖 = 连节带题全删。学生的答题记录(phonetic_textbook_attempts)
        # 引用 item_id,这里不动它 —— 删了历史记录等于抹掉学情
        ls_ids = [r[0] for r in await db.execute(
            select(PhoneticLesson.id).where(PhoneticLesson.book_id == same.id))]
        if ls_ids:
            await db.execute(delete(PhoneticItem).where(
                PhoneticItem.lesson_id.in_(ls_ids)))
        await db.execute(delete(PhoneticLesson).where(
            PhoneticLesson.book_id == same.id))
        await db.delete(same)
        await db.flush()
        replaced = True

    book = PhoneticBook(
        name=name, volume=(payload.volume or None),
        description=(payload.description or None),
        org_id=org_id, created_by=current_user.id,
    )
    db.add(book)
    await db.flush()

    total = 0
    for n, p in enumerate(parsed, 1):
        ls = PhoneticLesson(
            book_id=book.id, code=p["code"], title=p["title"],
            lesson_number=n, removed_count=0,
            highlight_json=json.dumps(p["highlight"], ensure_ascii=False),
        )
        db.add(ls)
        await db.flush()
        for oi, it in enumerate(p["items"]):
            db.add(PhoneticItem(
                lesson_id=ls.id, word=it["word"], meaning=it.get("meaning"),
                answer_json=json.dumps(it["answer"], ensure_ascii=False),
                answer_display=f"[{''.join(it['answer'])}]",
                core_indexes_json=json.dumps(it["core"]),
                order_index=oi,
            ))
            total += 1
    await db.commit()
    logger.info("音标教材导入: book_id=%s %s 节 %s 题 by user=%s",
                book.id, len(parsed), total, current_user.id)
    return ImportOut(book_id=book.id, book_name=name,
                     lesson_count=len(parsed), item_count=total,
                     replaced=replaced)


class BookPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    volume: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    is_active: Optional[bool] = None


@router.patch("/books/{book_id}", response_model=BookOut)
async def update_book(
    book_id: int,
    patch: BookPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """改教材名/册次/上下架。

    「留空=不修改」必须走 exclude_unset —— 直接 `if patch.x` 会让空串
    静默跳过(CLAUDE.md 记过 AI 配置密钥被这么清空过)。
    """
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    data = patch.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        b.name = data["name"].strip()
    if "volume" in data:
        b.volume = (data["volume"] or "").strip() or None
    if "description" in data:
        b.description = (data["description"] or "").strip() or None
    if "is_active" in data and data["is_active"] is not None:
        b.is_active = bool(data["is_active"])
    await db.commit()

    n_ls = (await db.execute(select(func.count(PhoneticLesson.id))
                             .where(PhoneticLesson.book_id == b.id))).scalar() or 0
    n_it = (await db.execute(
        select(func.count(PhoneticItem.id))
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .where(PhoneticLesson.book_id == b.id))).scalar() or 0
    return BookOut(id=b.id, name=b.name, volume=b.volume,
                   description=b.description, is_active=bool(b.is_active),
                   lesson_count=n_ls, item_count=n_it,
                   is_preset=b.org_id is None,
                   can_edit=True)


@router.delete("/books/{book_id}")
async def delete_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """删整本。学生的答题记录不删(那是学情,抹掉等于丢数据)"""
    _require_staff(current_user)
    b = await _own_book(db, book_id, current_user)
    ls_ids = [r[0] for r in await db.execute(
        select(PhoneticLesson.id).where(PhoneticLesson.book_id == b.id))]
    if ls_ids:
        await db.execute(delete(PhoneticItem).where(
            PhoneticItem.lesson_id.in_(ls_ids)))
    await db.execute(delete(PhoneticLesson).where(
        PhoneticLesson.book_id == b.id))
    await db.delete(b)
    await db.commit()
    return {"deleted": True, "lesson_count": len(ls_ids)}
