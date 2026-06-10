from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, delete
from typing import List, Optional
from app.core.database import get_db
from app.models.word import Word, WordDefinition, WordTag, WordBook, BookWord, Unit, UnitWord
from app.models.user import User
from app.schemas.word import (
    WordCreate, WordResponse, WordUpdate, WordListItem,
    WordBookCreate, WordBookResponse, WordBookDetailResponse, WordBookUpdate,
    WordBatchImport, WordBatchImportResponse
)
from app.api.v1.auth import get_current_teacher
from app.services.image_service import generate_book_cover

router = APIRouter()

# ========================================
# 单词本管理 (Must come BEFORE /{word_id} to avoid route conflict)
# ========================================

@router.post("/books", response_model=WordBookResponse, status_code=status.HTTP_201_CREATED)
async def create_word_book(
    book_data: WordBookCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建单词本（同步生成 AI 封面，失败降级到 cover_color）"""
    cover_url = await generate_book_cover(
        name=book_data.name,
        grade_level=book_data.grade_level,
        description=book_data.description,
    )

    db_book = WordBook(
        name=book_data.name,
        description=book_data.description,
        grade_level=book_data.grade_level,
        volume=book_data.volume,
        is_public=book_data.is_public,
        cover_color=book_data.cover_color,
        cover_url=cover_url,
    )
    db.add(db_book)
    await db.flush()

    for idx, word_id in enumerate(book_data.word_ids):
        book_word = BookWord(
            book_id=db_book.id,
            word_id=word_id,
            order_index=idx
        )
        db.add(book_word)

    await db.commit()

    return WordBookResponse(
        id=db_book.id,
        name=db_book.name,
        description=db_book.description,
        grade_level=db_book.grade_level,
        volume=db_book.volume,
        is_public=db_book.is_public,
        cover_color=db_book.cover_color,
        cover_url=db_book.cover_url,
        created_by=db_book.created_by or 0,
        word_count=len(book_data.word_ids),
        created_at=db_book.created_at
    )


@router.get("/books/{book_id}", response_model=WordBookDetailResponse)
async def get_word_book(
    book_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取单词本详情(含单词列表)"""
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    db_book = result.scalar_one_or_none()

    if not db_book:
        raise HTTPException(status_code=404, detail="单词本不存在")

    # 获取单词列表（含主要释义，一次查询）
    words_result = await db.execute(
        select(Word, WordDefinition.meaning)
        .join(BookWord, BookWord.word_id == Word.id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(BookWord.book_id == book_id)
        .order_by(BookWord.order_index)
    )
    rows = words_result.all()

    word_list = [
        WordListItem(
            id=word.id,
            word=word.word,
            phonetic=word.phonetic,
            syllables=word.syllables,
            tts_text=word.tts_text,
            difficulty=word.difficulty,
            grade_level=word.grade_level,
            primary_meaning=meaning,
        )
        for word, meaning in rows
    ]

    return WordBookDetailResponse(
        id=db_book.id,
        name=db_book.name,
        description=db_book.description,
        grade_level=db_book.grade_level,
        volume=db_book.volume,
        is_public=db_book.is_public,
        cover_color=db_book.cover_color,
        cover_url=db_book.cover_url,
        created_by=db_book.created_by or 0,
        word_count=len(word_list),
        created_at=db_book.created_at,
        words=word_list
    )


@router.get("/books", response_model=List[WordBookResponse])
async def list_word_books(
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    grade_level: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """获取单词本列表（默认一次返回 500 本，教师端无需分页）"""
    query = select(WordBook).where(WordBook.is_public == True)

    if grade_level:
        query = query.where(WordBook.grade_level == grade_level)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    books = result.scalars().all()

    if not books:
        return []

    # 一次性统计所有相关单词本的单词数
    book_ids = [b.id for b in books]
    count_result = await db.execute(
        select(BookWord.book_id, func.count(BookWord.id).label("cnt"))
        .where(BookWord.book_id.in_(book_ids))
        .group_by(BookWord.book_id)
    )
    count_map = {row.book_id: row.cnt for row in count_result.all()}

    return [
        WordBookResponse(
            id=book.id,
            name=book.name,
            description=book.description,
            grade_level=book.grade_level,
            volume=book.volume,
            is_public=book.is_public,
            cover_color=book.cover_color,
            cover_url=book.cover_url,
            created_by=book.created_by or 0,
            word_count=count_map.get(book.id, 0),
            created_at=book.created_at,
        )
        for book in books
    ]


@router.patch("/books/{book_id}", response_model=WordBookResponse)
async def update_word_book(
    book_id: int,
    body: WordBookUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """更新单词本（重命名、描述、年级、册次、封面色、公开状态）"""
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="单词本不存在")
    if book.created_by and book.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权编辑此单词本")

    data = body.model_dump(exclude_unset=True)
    if "name" in data and not (data["name"] or "").strip():
        raise HTTPException(status_code=400, detail="名称不能为空")
    for k, v in data.items():
        setattr(book, k, v.strip() if isinstance(v, str) else v)
    await db.commit()
    await db.refresh(book)

    word_count_res = await db.execute(
        select(func.count(BookWord.id)).where(BookWord.book_id == book.id)
    )
    word_count = int(word_count_res.scalar() or 0)

    return WordBookResponse(
        id=book.id, name=book.name, description=book.description,
        grade_level=book.grade_level, volume=book.volume,
        is_public=book.is_public, cover_color=book.cover_color,
        cover_url=book.cover_url, created_by=book.created_by or 0,
        word_count=word_count, created_at=book.created_at,
    )


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """删除单词本"""
    # 查找单词本
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    book = result.scalar_one_or_none()

    if not book:
        raise HTTPException(status_code=404, detail="单词本不存在")

    # 检查权限 - 只有创建者可以删除
    if book.created_by and book.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此单词本")

    # 删除单词本
    await db.delete(book)
    await db.commit()

    return None


@router.post("/books/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_word_books(
    book_ids: List[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """批量删除单词本"""
    if not book_ids:
        raise HTTPException(status_code=400, detail="请提供要删除的单词本ID")

    deleted_count = 0
    failed_count = 0

    for book_id in book_ids:
        result = await db.execute(select(WordBook).where(WordBook.id == book_id))
        book = result.scalar_one_or_none()

        if not book:
            failed_count += 1
            continue

        # 检查权限
        if book.created_by and book.created_by != current_user.id:
            failed_count += 1
            continue

        await db.delete(book)
        deleted_count += 1

    await db.commit()

    return {
        "message": "批量删除完成",
        "deleted_count": deleted_count,
        "failed_count": failed_count,
        "total": len(book_ids)
    }


# ========================================
# 单词CRUD操作
# ========================================

async def _overwrite_word_fields(db: AsyncSession, target: Word, word_data: WordCreate) -> None:
    """整体覆盖 target 的基础字段 + definitions + tags。

    Why: 老师"重传同拼写"语义 = 此次填写的就是正确版本,
    旧 definitions/tags 必须整体替换,否则旧例句/翻译会沾染新版本。
    不 commit, 由调用方决定事务边界。
    """
    target.word = word_data.word.strip()
    target.phonetic = word_data.phonetic
    target.syllables = word_data.syllables
    target.tts_text = word_data.tts_text
    target.difficulty = word_data.difficulty
    target.grade_level = word_data.grade_level
    if word_data.audio_url is not None:
        target.audio_url = word_data.audio_url
    if word_data.image_url is not None:
        target.image_url = word_data.image_url

    await db.execute(delete(WordDefinition).where(WordDefinition.word_id == target.id))
    await db.execute(delete(WordTag).where(WordTag.word_id == target.id))
    await db.flush()

    for d in word_data.definitions:
        db.add(WordDefinition(
            word_id=target.id,
            part_of_speech=d.part_of_speech,
            meaning=d.meaning,
            example_sentence=d.example_sentence,
            example_translation=d.example_translation,
            is_primary=d.is_primary,
        ))
    for tag in word_data.tags:
        db.add(WordTag(word_id=target.id, tag=tag))


async def _create_new_word_row(db: AsyncSession, word_data: WordCreate) -> Word:
    """新建一条 Word + definitions + tags;不 commit;返回带 id 的对象。"""
    new_word = Word(
        word=word_data.word.strip(),
        phonetic=word_data.phonetic,
        syllables=word_data.syllables,
        tts_text=word_data.tts_text,
        difficulty=word_data.difficulty,
        grade_level=word_data.grade_level,
        audio_url=word_data.audio_url,
        image_url=word_data.image_url,
    )
    db.add(new_word)
    await db.flush()
    for d in word_data.definitions:
        db.add(WordDefinition(
            word_id=new_word.id,
            part_of_speech=d.part_of_speech,
            meaning=d.meaning,
            example_sentence=d.example_sentence,
            example_translation=d.example_translation,
            is_primary=d.is_primary,
        ))
    for tag in word_data.tags:
        db.add(WordTag(word_id=new_word.id, tag=tag))
    return new_word


async def _upsert_word(
    db: AsyncSession, word_data: WordCreate, book_id: Optional[int]
) -> Word:
    """书范围隔离的 upsert。

    book_id is None: 维持全局去重 + 覆盖语义(代表行 = 同拼写中 id 最小)。
    book_id 给定: 严格按"本书"作用域:
      - 本书内已有同拼写, 同时被别的书引用 → fork 新 Word, 把本书的 BookWord/UnitWord 重指向新 Word, 别的书不变
      - 本书内已有同拼写, 本书独占 → 直接覆盖
      - 本书内没有同拼写 → 新建 Word + BookWord(book_id, new) 关联本书
    """
    spelling = word_data.word.strip().lower()

    if book_id is None:
        rep = (await db.execute(
            select(Word).where(func.lower(Word.word) == spelling)
            .order_by(Word.id).limit(1)
        )).scalars().first()
        if rep is not None:
            await _overwrite_word_fields(db, rep, word_data)
            return rep
        return await _create_new_word_row(db, word_data)

    # book-scoped: 本书内是否已有该拼写? 既看 BookWord 直挂, 也看 UnitWord 间接挂
    in_book_via_bw = (await db.execute(
        select(Word).join(BookWord, BookWord.word_id == Word.id)
        .where(BookWord.book_id == book_id)
        .where(func.lower(Word.word) == spelling)
        .order_by(Word.id).limit(1)
    )).scalars().first()
    in_book_via_unit = (await db.execute(
        select(Word).join(UnitWord, UnitWord.word_id == Word.id)
        .join(Unit, Unit.id == UnitWord.unit_id)
        .where(Unit.book_id == book_id)
        .where(func.lower(Word.word) == spelling)
        .order_by(Word.id).limit(1)
    )).scalars().first()
    in_book = in_book_via_bw or in_book_via_unit

    if in_book is None:
        new_word = await _create_new_word_row(db, word_data)
        db.add(BookWord(book_id=book_id, word_id=new_word.id, order_index=0))
        return new_word

    # 是否被别的书 (BookWord 或 跨书 unit) 引用?
    other_bw = (await db.execute(
        select(func.count(BookWord.id))
        .where(BookWord.word_id == in_book.id)
        .where(BookWord.book_id != book_id)
    )).scalar() or 0
    other_unit_books = (await db.execute(
        select(func.count(func.distinct(Unit.book_id)))
        .select_from(UnitWord)
        .join(Unit, Unit.id == UnitWord.unit_id)
        .where(UnitWord.word_id == in_book.id)
        .where(Unit.book_id != book_id)
    )).scalar() or 0

    if other_bw + other_unit_books > 0:
        # fork: 新建 Word, 把本书的 BookWord/UnitWord 改指过去
        new_word = await _create_new_word_row(db, word_data)
        await db.execute(
            BookWord.__table__.update()
            .where(BookWord.book_id == book_id)
            .where(BookWord.word_id == in_book.id)
            .values(word_id=new_word.id)
        )
        # 把"本书内"所有指向旧 word 的 UnitWord 改指到新 word
        own_unit_ids_subq = select(Unit.id).where(Unit.book_id == book_id).scalar_subquery()
        await db.execute(
            UnitWord.__table__.update()
            .where(UnitWord.word_id == in_book.id)
            .where(UnitWord.unit_id.in_(own_unit_ids_subq))
            .values(word_id=new_word.id)
        )
        # 若本书内既无 BookWord 也无 UnitWord 入口(理论不会到这分支), 兜底加挂
        return new_word

    # 本书独占 → 原地覆盖
    await _overwrite_word_fields(db, in_book, word_data)
    return in_book


@router.post("/", response_model=WordResponse, status_code=status.HTTP_201_CREATED)
async def create_word(
    word_data: WordCreate,
    book_id: Optional[int] = Query(None, description="把单词归属到指定单词本(决定隔离范围)"),
    force_new: bool = Query(False, description="强制新建一行,跳过同拼写去重(用于一词多音同批导入)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """老师录入单词。带 book_id 走 book 隔离;不带 book_id 走全局去重+覆盖。

    force_new=True 时直接新建一行并挂到 book_id(若给定),
    不做同拼写查重——支持一词多音(同拼写、不同读音/词性)在同一本书内并存。
    """
    if force_new:
        new_word = await _create_new_word_row(db, word_data)
        if book_id is not None:
            db.add(BookWord(book_id=book_id, word_id=new_word.id, order_index=0))
        await db.commit()
        return await get_word_detail(new_word.id, db)

    target = await _upsert_word(db, word_data, book_id)
    await db.commit()
    return await get_word_detail(target.id, db)


@router.get("/{word_id}", response_model=WordResponse)
async def get_word(
    word_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取单词详细信息"""
    return await get_word_detail(word_id, db)


@router.get("/", response_model=List[WordListItem])
async def list_words(
    skip: int = Query(0, ge=0, description="跳过数量"),
    limit: int = Query(20, ge=1, le=100, description="返回数量"),
    grade_level: Optional[str] = Query(None, description="年级筛选"),
    difficulty: Optional[int] = Query(None, ge=1, le=5, description="难度筛选"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    db: AsyncSession = Depends(get_db)
):
    """
    获取单词列表
    - 支持分页
    - 支持按年级/难度/标签筛选
    - 支持关键词搜索
    """
    # 同拼写多副本时只显示最早一条 (id 最小)。fork 副本不在全局列表暴露。
    # 注意: dedup 必须在 SQL 层完成,放在 offset/limit 之前。否则 Python 侧
    # 去重会让分页失真:每页可能 < limit、跨页可能漏拼写。
    rep_ids = select(func.min(Word.id).label("id")).group_by(func.lower(Word.word))

    if grade_level:
        rep_ids = rep_ids.where(Word.grade_level == grade_level)
    if difficulty:
        rep_ids = rep_ids.where(Word.difficulty == difficulty)
    if search:
        rep_ids = rep_ids.where(
            or_(
                func.lower(Word.word).like(f"%{search.lower()}%"),
                Word.phonetic.like(f"%{search}%")
            )
        )
    if tag:
        rep_ids = rep_ids.join(WordTag, WordTag.word_id == Word.id).where(WordTag.tag == tag)

    rep_subq = rep_ids.subquery()

    query = (
        select(Word)
        .join(rep_subq, Word.id == rep_subq.c.id)
        .order_by(Word.id)
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    words = list(result.scalars().all())

    # 构建响应(一次查询获取所有单词的主要释义)
    if not words:
        return []

    word_ids = [w.id for w in words]
    def_result = await db.execute(
        select(WordDefinition.word_id, WordDefinition.meaning)
        .where(
            and_(
                WordDefinition.word_id.in_(word_ids),
                WordDefinition.is_primary == True
            )
        )
    )
    meaning_map = {row.word_id: row.meaning for row in def_result.all()}

    return [
        WordListItem(
            id=word.id,
            word=word.word,
            phonetic=word.phonetic,
            syllables=word.syllables,
            tts_text=word.tts_text,
            difficulty=word.difficulty,
            grade_level=word.grade_level,
            primary_meaning=meaning_map.get(word.id),
        )
        for word in words
    ]


@router.put("/{word_id}", response_model=WordResponse)
async def update_word(
    word_id: int,
    word_data: WordUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新单词信息"""
    result = await db.execute(select(Word).where(Word.id == word_id))
    db_word = result.scalar_one_or_none()

    if not db_word:
        raise HTTPException(status_code=404, detail="单词不存在")

    # 更新基本信息
    update_data = word_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field not in ['definitions', 'tags'] and value is not None:
            setattr(db_word, field, value)

    # 更新释义
    if word_data.definitions is not None:
        # 删除旧释义
        await db.execute(
            select(WordDefinition).where(WordDefinition.word_id == word_id)
        )
        # 创建新释义
        for def_data in word_data.definitions:
            db_definition = WordDefinition(
                word_id=word_id,
                **def_data.model_dump()
            )
            db.add(db_definition)

    # 更新标签
    if word_data.tags is not None:
        # 删除旧标签
        await db.execute(
            select(WordTag).where(WordTag.word_id == word_id)
        )
        # 创建新标签
        for tag in word_data.tags:
            db_tag = WordTag(word_id=word_id, tag=tag)
            db.add(db_tag)

    await db.commit()
    return await get_word_detail(word_id, db)


@router.delete("/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word(
    word_id: int,
    db: AsyncSession = Depends(get_db)
):
    """删除单词"""
    result = await db.execute(select(Word).where(Word.id == word_id))
    db_word = result.scalar_one_or_none()

    if not db_word:
        raise HTTPException(status_code=404, detail="单词不存在")

    await db.delete(db_word)
    await db.commit()
    return None


@router.post("/batch-delete", status_code=status.HTTP_200_OK)
async def batch_delete_words(
    word_ids: List[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """批量删除单词"""
    if not word_ids:
        raise HTTPException(status_code=400, detail="请提供要删除的单词ID")

    deleted_count = 0
    failed_count = 0

    for word_id in word_ids:
        result = await db.execute(select(Word).where(Word.id == word_id))
        word = result.scalar_one_or_none()

        if not word:
            failed_count += 1
            continue

        await db.delete(word)
        deleted_count += 1

    await db.commit()

    return {
        "message": "批量删除完成",
        "deleted_count": deleted_count,
        "failed_count": failed_count,
        "total": len(word_ids)
    }


# ========================================
# 批量操作
# ========================================

@router.post("/batch-import", response_model=WordBatchImportResponse)
async def batch_import_words(
    import_data: WordBatchImport,
    db: AsyncSession = Depends(get_db)
):
    """批量导入单词。

    带 book_id 时按本书作用域 upsert(同拼写在本书内 → 覆盖,
    在别的书内 → fork 新副本到本书);
    不带 book_id 时按全局覆盖。任一已存在条目计入 success_count。
    """
    success_count = 0
    failed_count = 0
    failed_words = []

    for word_data in import_data.words:
        try:
            await _upsert_word(db, word_data, import_data.book_id)
            success_count += 1
        except Exception as e:
            failed_words.append(f"{word_data.word} ({str(e)})")
            failed_count += 1

    await db.commit()

    return WordBatchImportResponse(
        success_count=success_count,
        failed_count=failed_count,
        failed_words=failed_words,
    )


# ========================================
# 辅助函数
# ========================================

async def get_word_detail(word_id: int, db: AsyncSession) -> WordResponse:
    """获取单词完整信息"""
    result = await db.execute(select(Word).where(Word.id == word_id))
    db_word = result.scalar_one_or_none()

    if not db_word:
        raise HTTPException(status_code=404, detail="单词不存在")

    # 获取释义
    def_result = await db.execute(
        select(WordDefinition).where(WordDefinition.word_id == word_id)
    )
    definitions = def_result.scalars().all()

    # 获取标签
    tag_result = await db.execute(
        select(WordTag.tag).where(WordTag.word_id == word_id)
    )
    tags = [row[0] for row in tag_result.all()]

    return WordResponse(
        id=db_word.id,
        word=db_word.word,
        phonetic=db_word.phonetic,
        syllables=db_word.syllables,
        tts_text=db_word.tts_text,
        difficulty=db_word.difficulty,
        grade_level=db_word.grade_level,
        audio_url=db_word.audio_url,
        image_url=db_word.image_url,
        definitions=[
            {
                "id": d.id,
                "part_of_speech": d.part_of_speech,
                "meaning": d.meaning,
                "example_sentence": d.example_sentence,
                "example_translation": d.example_translation,
                "is_primary": d.is_primary
            }
            for d in definitions
        ],
        tags=tags,
        created_at=db_word.created_at,
        updated_at=db_word.updated_at
    )
