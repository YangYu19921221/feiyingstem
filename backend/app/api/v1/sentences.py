"""
句子背诵 API — 教师端 CRUD + 学生端只读，同一个文件路由共享。
教师写操作前缀 /api/v1/sentences/，学生读操作复用，依赖前置中间件按权限分。
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from typing import List, Optional
from pydantic import BaseModel, Field
import csv
import io

from app.core.database import get_db
from app.api.v1.auth import get_current_user, get_current_teacher
from app.models.user import User
from app.models.sentence import SentenceBook, SentenceUnit, Sentence


router = APIRouter()


# ============================ Schemas ============================

class SentenceOut(BaseModel):
    id: int
    unit_id: int
    order_index: int
    english: str
    chinese: str
    phonetic: Optional[str] = None
    tts_text: Optional[str] = None
    difficulty: int = 3
    topic: Optional[str] = None
    grammar_focus: Optional[str] = None

    class Config:
        from_attributes = True


class SentenceCreate(BaseModel):
    english: str = Field(..., min_length=1, max_length=1000)
    chinese: str = Field(..., min_length=1, max_length=1000)
    phonetic: Optional[str] = None
    tts_text: Optional[str] = None
    difficulty: int = Field(3, ge=1, le=5)
    topic: Optional[str] = None
    grammar_focus: Optional[str] = None


class SentenceUpdate(BaseModel):
    english: Optional[str] = Field(None, min_length=1, max_length=1000)
    chinese: Optional[str] = Field(None, min_length=1, max_length=1000)
    phonetic: Optional[str] = None
    tts_text: Optional[str] = None
    difficulty: Optional[int] = Field(None, ge=1, le=5)
    topic: Optional[str] = None
    grammar_focus: Optional[str] = None
    order_index: Optional[int] = None


class UnitOut(BaseModel):
    id: int
    book_id: int
    unit_number: int
    name: str
    description: Optional[str] = None
    order_index: int = 0
    sentence_count: int = 0

    class Config:
        from_attributes = True


class UnitCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None


class UnitUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None


class BookOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    grade_level: Optional[str] = None
    volume: Optional[str] = None
    cover_color: str = "#5FD35F"
    cover_url: Optional[str] = None
    is_public: bool = True
    unit_count: int = 0
    sentence_count: int = 0

    class Config:
        from_attributes = True


class BookCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    grade_level: Optional[str] = None
    volume: Optional[str] = None
    cover_color: Optional[str] = "#5FD35F"


class BookUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    grade_level: Optional[str] = None
    volume: Optional[str] = None
    cover_color: Optional[str] = None


# ============================ 权限 helper ============================

async def _assert_book_owner(db: AsyncSession, book_id: int, user: User) -> SentenceBook:
    """教师只能改 / 删自己的；admin 不限"""
    b = (await db.execute(select(SentenceBook).where(SentenceBook.id == book_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "句子集不存在")
    if user.role != "admin" and b.created_by != user.id:
        raise HTTPException(403, "无权操作他人的句子集")
    return b


async def _assert_unit_owner(db: AsyncSession, unit_id: int, user: User) -> SentenceUnit:
    u = (await db.execute(select(SentenceUnit).where(SentenceUnit.id == unit_id))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "单元不存在")
    await _assert_book_owner(db, u.book_id, user)
    return u


async def _assert_sentence_owner(db: AsyncSession, sentence_id: int, user: User) -> Sentence:
    s = (await db.execute(select(Sentence).where(Sentence.id == sentence_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "句子不存在")
    await _assert_unit_owner(db, s.unit_id, user)
    return s


# ============================ 句子集 (Book) ============================

@router.get("/books", response_model=List[BookOut])
async def list_books(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    学生：所有公开句子集
    教师：自己创建的（不论公开与否）+ 其他教师公开的
    admin：全部
    """
    stmt = select(SentenceBook).order_by(SentenceBook.id.desc())
    role = getattr(current_user, "role", None)
    if role == "student":
        stmt = stmt.where(SentenceBook.is_public == True)
    elif role == "teacher":
        stmt = stmt.where(
            (SentenceBook.is_public == True) | (SentenceBook.created_by == current_user.id)
        )
    # admin 走原 stmt 拿全部
    res = await db.execute(stmt)
    books = res.scalars().all()

    counts_res = await db.execute(
        select(
            SentenceUnit.book_id,
            func.count(func.distinct(SentenceUnit.id)).label("unit_cnt"),
            func.count(Sentence.id).label("sentence_cnt"),
        )
        .outerjoin(Sentence, Sentence.unit_id == SentenceUnit.id)
        .group_by(SentenceUnit.book_id)
    )
    counts = {row.book_id: (row.unit_cnt, row.sentence_cnt) for row in counts_res.all()}

    return [
        BookOut(
            id=b.id, name=b.name, description=b.description,
            grade_level=b.grade_level, volume=b.volume,
            cover_color=b.cover_color or "#5FD35F", cover_url=b.cover_url,
            is_public=b.is_public,
            unit_count=counts.get(b.id, (0, 0))[0],
            sentence_count=counts.get(b.id, (0, 0))[1],
        )
        for b in books
    ]


@router.post("/books", response_model=BookOut)
async def create_book(
    body: BookCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    b = SentenceBook(
        name=body.name, description=body.description,
        grade_level=body.grade_level, volume=body.volume,
        cover_color=body.cover_color or "#5FD35F",
        is_public=True, created_by=current_user.id,
        # 多租户: admin建的是平台共享库(NULL),教师建的归本机构
        org_id=None if current_user.role == "admin" else current_user.org_id,
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return BookOut(
        id=b.id, name=b.name, description=b.description,
        grade_level=b.grade_level, volume=b.volume,
        cover_color=b.cover_color, is_public=b.is_public,
        unit_count=0, sentence_count=0,
    )


@router.patch("/books/{book_id}", response_model=BookOut)
async def update_book(
    book_id: int,
    body: BookUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    b = await _assert_book_owner(db, book_id, current_user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    await db.commit()
    await db.refresh(b)
    return BookOut(
        id=b.id, name=b.name, description=b.description,
        grade_level=b.grade_level, volume=b.volume,
        cover_color=b.cover_color or "#5FD35F", cover_url=b.cover_url,
        is_public=b.is_public, unit_count=0, sentence_count=0,
    )


@router.delete("/books/{book_id}")
async def delete_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    b = await _assert_book_owner(db, book_id, current_user)
    # SQLite 默认未启用 FK，显式级联清理子记录（unit → sentence）
    unit_ids = [
        row[0] for row in (await db.execute(
            select(SentenceUnit.id).where(SentenceUnit.book_id == book_id)
        )).all()
    ]
    if unit_ids:
        await db.execute(delete(Sentence).where(Sentence.unit_id.in_(unit_ids)))
        await db.execute(delete(SentenceUnit).where(SentenceUnit.id.in_(unit_ids)))
    await db.delete(b)
    await db.commit()
    return {"deleted": True}


# ============================ 单元 (Unit) ============================

@router.get("/books/{book_id}/units", response_model=List[UnitOut])
async def list_units(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(SentenceUnit, func.count(Sentence.id).label("cnt"))
        .outerjoin(Sentence, Sentence.unit_id == SentenceUnit.id)
        .where(SentenceUnit.book_id == book_id)
        .group_by(SentenceUnit.id)
        .order_by(SentenceUnit.order_index, SentenceUnit.unit_number)
    )
    out = []
    for u, cnt in res.all():
        out.append(UnitOut(
            id=u.id, book_id=u.book_id, unit_number=u.unit_number,
            name=u.name, description=u.description, order_index=u.order_index or 0,
            sentence_count=int(cnt or 0),
        ))
    return out


@router.post("/books/{book_id}/units", response_model=UnitOut)
async def create_unit(
    book_id: int,
    body: UnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await _assert_book_owner(db, book_id, current_user)
    max_num = (await db.execute(
        select(func.max(SentenceUnit.unit_number)).where(SentenceUnit.book_id == book_id)
    )).scalar() or 0
    u = SentenceUnit(
        book_id=book_id, unit_number=max_num + 1,
        name=body.name, description=body.description, order_index=max_num,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return UnitOut(
        id=u.id, book_id=u.book_id, unit_number=u.unit_number,
        name=u.name, description=u.description, order_index=u.order_index or 0,
        sentence_count=0,
    )


@router.patch("/units/{unit_id}", response_model=UnitOut)
async def update_unit(
    unit_id: int,
    body: UnitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    u = await _assert_unit_owner(db, unit_id, current_user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(u, k, v)
    await db.commit()
    await db.refresh(u)
    cnt = (await db.execute(select(func.count(Sentence.id)).where(Sentence.unit_id == unit_id))).scalar() or 0
    return UnitOut(
        id=u.id, book_id=u.book_id, unit_number=u.unit_number,
        name=u.name, description=u.description, order_index=u.order_index or 0,
        sentence_count=int(cnt),
    )


@router.delete("/units/{unit_id}")
async def delete_unit_endpoint(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    u = await _assert_unit_owner(db, unit_id, current_user)
    await db.execute(delete(Sentence).where(Sentence.unit_id == unit_id))
    await db.delete(u)
    await db.commit()
    return {"deleted": True}


# ============================ 句子 (Sentence) ============================

@router.get("/units/{unit_id}/sentences", response_model=List[SentenceOut])
async def list_sentences(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(Sentence).where(Sentence.unit_id == unit_id).order_by(Sentence.order_index, Sentence.id)
    )
    return list(res.scalars().all())


@router.post("/units/{unit_id}/sentences", response_model=SentenceOut)
async def create_sentence(
    unit_id: int,
    body: SentenceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await _assert_unit_owner(db, unit_id, current_user)
    max_idx = (await db.execute(
        select(func.max(Sentence.order_index)).where(Sentence.unit_id == unit_id)
    )).scalar() or 0
    s = Sentence(
        unit_id=unit_id, order_index=max_idx + 1,
        english=body.english.strip(), chinese=body.chinese.strip(),
        phonetic=body.phonetic, tts_text=body.tts_text,
        difficulty=body.difficulty, topic=body.topic, grammar_focus=body.grammar_focus,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


@router.patch("/sentences/{sentence_id}", response_model=SentenceOut)
async def update_sentence(
    sentence_id: int,
    body: SentenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    s = await _assert_sentence_owner(db, sentence_id, current_user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/sentences/{sentence_id}")
async def delete_sentence(
    sentence_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await _assert_sentence_owner(db, sentence_id, current_user)
    await db.execute(delete(Sentence).where(Sentence.id == sentence_id))
    await db.commit()
    return {"deleted": True}


# ============================ Excel/CSV 批量导入 ============================

class BulkImportResult(BaseModel):
    added: int
    skipped: int
    errors: List[str]


MAX_BULK_IMPORT_BYTES = 2 * 1024 * 1024  # 2 MB ≈ 数万行 CSV，远超教师常见用量


@router.post("/units/{unit_id}/bulk-import", response_model=BulkImportResult)
async def bulk_import(
    unit_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    上传 CSV 批量录入句子。表头列名英中双语都识别：
      english/英文/句子 · chinese/中文/翻译 · phonetic/音标 ·
      difficulty/难度 · topic/主题 · grammar_focus/语法
    只 english + chinese 必填。空行 / 重复英文整句跳过。
    """
    await _assert_unit_owner(db, unit_id, current_user)

    raw = await file.read()
    if len(raw) > MAX_BULK_IMPORT_BYTES:
        raise HTTPException(413, f"文件过大（>{MAX_BULK_IMPORT_BYTES // 1024} KB），请拆分后再传")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("gbk")
        except UnicodeDecodeError:
            raise HTTPException(400, "文件编码无法识别，请用 UTF-8 / GBK")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(400, "CSV 缺少表头")

    # 必须至少含 english 列（容错命名）
    eng_col_names = {"english", "英文", "句子", "english_sentence"}
    if not any(
        (h or "").strip().lower() in eng_col_names
        for h in reader.fieldnames
    ):
        raise HTTPException(400, "CSV 表头缺少 english（或「英文」「句子」）列")

    def col(row: dict, *keys: str) -> str:
        keys_lower = [k.lower() for k in keys]
        for actual, val in row.items():
            if actual and actual.strip().lower() in keys_lower:
                return (val or "").strip()
        return ""

    existing_eng_res = await db.execute(
        select(Sentence.english).where(Sentence.unit_id == unit_id)
    )
    existing_eng = {(row[0] or "").strip().lower() for row in existing_eng_res.all()}

    max_idx = (await db.execute(
        select(func.max(Sentence.order_index)).where(Sentence.unit_id == unit_id)
    )).scalar() or 0
    cur_idx = max_idx

    added = 0
    skipped_empty = 0
    skipped_dup = 0
    errors: List[str] = []
    BATCH = 200

    for row_no, row in enumerate(reader, start=2):
        en = col(row, "english", "英文", "句子", "english_sentence")
        cn = col(row, "chinese", "中文", "翻译", "translation")
        if not en or not cn:
            skipped_empty += 1
            continue
        if en.lower() in existing_eng:
            skipped_dup += 1
            continue

        try:
            diff_raw = col(row, "difficulty", "难度") or "3"
            diff = max(1, min(5, int(diff_raw)))
        except ValueError:
            diff = 3

        cur_idx += 1
        db.add(Sentence(
            unit_id=unit_id, order_index=cur_idx,
            english=en, chinese=cn,
            phonetic=col(row, "phonetic", "音标") or None,
            difficulty=diff,
            topic=col(row, "topic", "主题") or None,
            grammar_focus=col(row, "grammar_focus", "语法", "grammar") or None,
        ))
        existing_eng.add(en.lower())
        added += 1

        if added % BATCH == 0:
            await db.flush()  # 分批 flush 释放写锁

    await db.commit()
    if skipped_empty:
        errors.append(f"{skipped_empty} 行 english 或 chinese 为空")
    if skipped_dup:
        errors.append(f"{skipped_dup} 行 english 与已有句子重复")
    return BulkImportResult(added=added, skipped=skipped_empty + skipped_dup, errors=errors)
