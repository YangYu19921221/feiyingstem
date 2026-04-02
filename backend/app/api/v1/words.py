from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from typing import List, Optional
from app.core.database import get_db
from app.models.word import Word, WordDefinition, WordTag, WordBook, BookWord
from app.models.user import User
from app.schemas.word import (
    WordCreate, WordResponse, WordUpdate, WordListItem,
    WordBookCreate, WordBookResponse, WordBookDetailResponse,
    WordBatchImport, WordBatchImportResponse
)
from app.api.v1.auth import get_current_teacher

router = APIRouter()

# ========================================
# 单词本管理 (Must come BEFORE /{word_id} to avoid route conflict)
# ========================================

@router.post("/books", response_model=WordBookResponse, status_code=status.HTTP_201_CREATED)
async def create_word_book(
    book_data: WordBookCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建单词本"""
    db_book = WordBook(
        name=book_data.name,
        description=book_data.description,
        grade_level=book_data.grade_level,
        volume=book_data.volume,
        is_public=book_data.is_public,
        cover_color=book_data.cover_color,
        # created_by=current_user.id
    )
    db.add(db_book)
    await db.flush()

    # 添加单词到单词本
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

    # 获取单词列表
    words_result = await db.execute(
        select(Word)
        .join(BookWord, BookWord.word_id == Word.id)
        .where(BookWord.book_id == book_id)
        .order_by(BookWord.order_index)
    )
    words = words_result.scalars().all()

    # 构建单词列表
    word_list = []
    for word in words:
        def_result = await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == word.id)
            .order_by(WordDefinition.is_primary.desc())
            .limit(1)
        )
        definition = def_result.scalar_one_or_none()

        word_list.append(WordListItem(
            id=word.id,
            word=word.word,
            phonetic=word.phonetic,
            difficulty=word.difficulty,
            grade_level=word.grade_level,
            primary_meaning=definition.meaning if definition else None
        ))

    return WordBookDetailResponse(
        id=db_book.id,
        name=db_book.name,
        description=db_book.description,
        grade_level=db_book.grade_level,
        volume=db_book.volume,
        is_public=db_book.is_public,
        cover_color=db_book.cover_color,
        created_by=db_book.created_by or 0,
        word_count=len(word_list),
        created_at=db_book.created_at,
        words=word_list
    )


@router.get("/books", response_model=List[WordBookResponse])
async def list_word_books(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    grade_level: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """获取单词本列表"""
    query = select(WordBook).where(WordBook.is_public == True)

    if grade_level:
        query = query.where(WordBook.grade_level == grade_level)

    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    books = result.scalars().all()

    # 统计每个单词本的单词数
    book_list = []
    for book in books:
        count_result = await db.execute(
            select(func.count(BookWord.id)).where(BookWord.book_id == book.id)
        )
        word_count = count_result.scalar() or 0

        book_list.append(WordBookResponse(
            id=book.id,
            name=book.name,
            description=book.description,
            grade_level=book.grade_level,
            volume=book.volume,
            is_public=book.is_public,
            cover_color=book.cover_color,
            created_by=book.created_by or 0,
            word_count=word_count,
            created_at=book.created_at
        ))

    return book_list


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

@router.post("/", response_model=WordResponse, status_code=status.HTTP_201_CREATED)
async def create_word(
    word_data: WordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    老师录入单词
    - 支持一词多义
    - 支持标签分类
    """
    # 检查单词是否已存在（忽略大小写查重，但保留原始大小写存储）
    result = await db.execute(select(Word).where(func.lower(Word.word) == word_data.word.strip().lower()))
    existing_word = result.scalar_one_or_none()

    if existing_word:
        # 返回已有单词的信息，前端可以直接将其添加到单元
        return await get_word_detail(existing_word.id, db)

    # 创建单词（保留原始大小写）
    db_word = Word(
        word=word_data.word.strip(),
        phonetic=word_data.phonetic,
        syllables=word_data.syllables,
        difficulty=word_data.difficulty,
        grade_level=word_data.grade_level,
        audio_url=word_data.audio_url,
        image_url=word_data.image_url,
        # created_by=current_user.id
    )
    db.add(db_word)
    await db.flush()

    # 创建释义
    for def_data in word_data.definitions:
        db_definition = WordDefinition(
            word_id=db_word.id,
            part_of_speech=def_data.part_of_speech,
            meaning=def_data.meaning,
            example_sentence=def_data.example_sentence,
            example_translation=def_data.example_translation,
            is_primary=def_data.is_primary
        )
        db.add(db_definition)

    # 创建标签
    for tag in word_data.tags:
        db_tag = WordTag(word_id=db_word.id, tag=tag)
        db.add(db_tag)

    await db.commit()
    await db.refresh(db_word)

    # 构建响应
    return await get_word_detail(db_word.id, db)


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
    query = select(Word)

    # 筛选条件
    if grade_level:
        query = query.where(Word.grade_level == grade_level)
    if difficulty:
        query = query.where(Word.difficulty == difficulty)
    if search:
        query = query.where(
            or_(
                func.lower(Word.word).like(f"%{search.lower()}%"),
                Word.phonetic.like(f"%{search}%")
            )
        )
    if tag:
        # 需要join标签表
        query = query.join(WordTag).where(WordTag.tag == tag)

    # 分页
    query = query.offset(skip).limit(limit)

    result = await db.execute(query)
    words = result.scalars().all()

    # 构建响应(获取主要释义)
    word_list = []
    for word in words:
        # 获取主要释义
        def_result = await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == word.id)
            .order_by(WordDefinition.is_primary.desc())
            .limit(1)
        )
        definition = def_result.scalar_one_or_none()

        word_list.append(WordListItem(
            id=word.id,
            word=word.word,
            phonetic=word.phonetic,
            difficulty=word.difficulty,
            grade_level=word.grade_level,
            primary_meaning=definition.meaning if definition else None
        ))

    return word_list


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
    """批量导入单词"""
    success_count = 0
    failed_count = 0
    failed_words = []

    for word_data in import_data.words:
        try:
            # 检查是否已存在
            result = await db.execute(
                select(Word).where(func.lower(Word.word) == word_data.word.lower())
            )
            if result.scalar_one_or_none():
                failed_words.append(f"{word_data.word} (已存在)")
                failed_count += 1
                continue

            db_word = Word(
                word=word_data.word.strip(),
                phonetic=word_data.phonetic,
                syllables=word_data.syllables,
                difficulty=word_data.difficulty,
                grade_level=word_data.grade_level,
                audio_url=word_data.audio_url,
                image_url=word_data.image_url,
            )
            db.add(db_word)
            await db.flush()

            # 创建释义
            for def_data in word_data.definitions:
                db_definition = WordDefinition(
                    word_id=db_word.id,
                    **def_data.model_dump()
                )
                db.add(db_definition)

            # 创建标签
            for tag in word_data.tags:
                db_tag = WordTag(word_id=db_word.id, tag=tag)
                db.add(db_tag)

            # 如果指定了单词本,添加到单词本
            if import_data.book_id:
                book_word = BookWord(
                    book_id=import_data.book_id,
                    word_id=db_word.id,
                    order_index=success_count
                )
                db.add(book_word)

            success_count += 1

        except Exception as e:
            failed_words.append(f"{word_data.word} ({str(e)})")
            failed_count += 1

    await db.commit()

    return WordBatchImportResponse(
        success_count=success_count,
        failed_count=failed_count,
        failed_words=failed_words
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
