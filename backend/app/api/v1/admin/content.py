"""
管理员 - 内容管理API
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc

from app.core.database import get_db
from app.api.v1.auth import get_current_admin
from app.models.user import User
from app.models.word import WordBook, Unit, Word, WordDefinition
from app.models.reading import ReadingPassage

router = APIRouter()


@router.get("/stats")
async def get_content_stats(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取内容统计信息
    """
    # 单词本统计
    book_query = select(func.count()).select_from(WordBook)
    book_result = await db.execute(book_query)
    total_books = book_result.scalar()

    public_book_query = select(func.count()).select_from(WordBook).where(WordBook.is_public == True)
    public_book_result = await db.execute(public_book_query)
    public_books = public_book_result.scalar()

    # 单词统计
    word_query = select(func.count()).select_from(Word)
    word_result = await db.execute(word_query)
    total_words = word_result.scalar()

    # 单元统计
    unit_query = select(func.count()).select_from(Unit)
    unit_result = await db.execute(unit_query)
    total_units = unit_result.scalar()

    # 阅读文章统计
    passage_query = select(func.count()).select_from(ReadingPassage)
    passage_result = await db.execute(passage_query)
    total_passages = passage_result.scalar()

    return {
        "word_books": {
            "total": total_books,
            "public": public_books,
            "private": total_books - public_books
        },
        "words": total_words,
        "units": total_units,
        "reading_passages": total_passages
    }


@router.get("/word-books")
async def get_all_word_books(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    is_public: Optional[bool] = Query(None),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有单词本列表
    """
    query = select(WordBook)

    if is_public is not None:
        query = query.where(WordBook.is_public == is_public)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                WordBook.name.ilike(search_pattern),
                WordBook.description.ilike(search_pattern)
            )
        )

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(desc(WordBook.created_at))

    result = await db.execute(query)
    books = result.scalars().all()

    return {
        "books": [
            {
                "id": book.id,
                "name": book.name,
                "description": book.description,
                "grade_level": book.grade_level,
                "is_public": book.is_public,
                "cover_color": book.cover_color,
                "created_by": book.created_by,
                "created_at": book.created_at.isoformat() if book.created_at else None
            }
            for book in books
        ],
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.get("/words")
async def get_all_words(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有单词列表
    """
    query = select(Word)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                Word.word.ilike(search_pattern),
                Word.phonetic.ilike(search_pattern)
            )
        )

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(desc(Word.created_at))

    result = await db.execute(query)
    words = result.scalars().all()

    # 获取单词的释义
    words_with_definitions = []
    for word in words:
        definitions_query = select(WordDefinition).where(WordDefinition.word_id == word.id)
        definitions_result = await db.execute(definitions_query)
        definitions = definitions_result.scalars().all()

        words_with_definitions.append({
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "audio_url": word.audio_url,
            "image_url": word.image_url,
            "difficulty": word.difficulty,
            "grade_level": word.grade_level,
            "created_at": word.created_at.isoformat() if word.created_at else None,
            "definitions": [
                {
                    "part_of_speech": d.part_of_speech,
                    "meaning": d.meaning,
                    "example_sentence": d.example_sentence,
                    "example_translation": d.example_translation,
                    "is_primary": d.is_primary
                }
                for d in definitions
            ]
        })

    return {
        "words": words_with_definitions,
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.get("/reading-passages")
async def get_all_reading_passages(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有阅读文章列表
    """
    query = select(ReadingPassage)

    if difficulty:
        query = query.where(ReadingPassage.difficulty == difficulty)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                ReadingPassage.title.ilike(search_pattern),
                ReadingPassage.content.ilike(search_pattern)
            )
        )

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size).order_by(desc(ReadingPassage.created_at))

    result = await db.execute(query)
    passages = result.scalars().all()

    return {
        "passages": [
            {
                "id": passage.id,
                "title": passage.title,
                "difficulty": passage.difficulty,
                "word_count": passage.word_count,
                "created_by": passage.created_by,
                "created_at": passage.created_at.isoformat() if passage.created_at else None
            }
            for passage in passages
        ],
        "total": total,
        "page": page,
        "page_size": page_size
    }


@router.delete("/word-books/{book_id}")
async def delete_word_book(
    book_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    删除单词本
    """
    query = select(WordBook).where(WordBook.id == book_id)
    result = await db.execute(query)
    book = result.scalar_one_or_none()

    if not book:
        raise HTTPException(status_code=404, detail="单词本不存在")

    await db.delete(book)
    await db.commit()

    return {"message": "单词本已删除"}


@router.delete("/words/{word_id}")
async def delete_word(
    word_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    删除单词
    """
    query = select(Word).where(Word.id == word_id)
    result = await db.execute(query)
    word = result.scalar_one_or_none()

    if not word:
        raise HTTPException(status_code=404, detail="单词不存在")

    await db.delete(word)
    await db.commit()

    return {"message": "单词已删除"}


@router.delete("/reading-passages/{passage_id}")
async def delete_reading_passage(
    passage_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    删除阅读文章
    """
    query = select(ReadingPassage).where(ReadingPassage.id == passage_id)
    result = await db.execute(query)
    passage = result.scalar_one_or_none()

    if not passage:
        raise HTTPException(status_code=404, detail="阅读文章不存在")

    await db.delete(passage)
    await db.commit()

    return {"message": "阅读文章已删除"}
