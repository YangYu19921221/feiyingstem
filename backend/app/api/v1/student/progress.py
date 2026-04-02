from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import List
from datetime import datetime

from app.core.database import get_db
from app.models.word import Word, WordBook, Unit, UnitWord, WordDefinition
from app.models.user import User
from app.models.learning import LearningProgress, StudySession, BookAssignment
from app.schemas.progress import (
    StartLearningRequest, StartLearningResponse,
    UpdateProgressRequest, UpdateProgressResponse,
    UnitProgressResponse, BookProgressResponse,
    StudentBookListItem
)
from app.api.v1.auth import get_current_student

router = APIRouter()


def _build_unit_info(unit: Unit, word_book: WordBook) -> dict:
    """构建 unit_info 响应字典"""
    return {
        "id": unit.id,
        "unit_number": unit.unit_number,
        "name": unit.name,
        "description": unit.description,
        "book_id": unit.book_id,
        "grade_level": word_book.grade_level if word_book else None,
    }

# ========================================
# 开始/继续学习 (断点续学核心)
# ========================================

@router.post("/units/{unit_id}/start", response_model=StartLearningResponse)
async def start_learning(
    unit_id: int,
    request: StartLearningRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    开始或继续学习单元

    核心功能: 断点续学
    - 如果有学习进度记录,从 current_word_index 继续
    - 如果没有记录,创建新记录,从第0个单词开始
    """
    # 从认证用户获取user_id
    user_id = current_user.id
    learning_mode = request.learning_mode

    # 1. 验证单元是否存在，同时获取单词本的 grade_level
    result = await db.execute(
        select(Unit, WordBook)
        .join(WordBook, WordBook.id == Unit.book_id)
        .where(Unit.id == unit_id)
    )
    row = result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )
    unit, word_book = row

    # 2. 获取该单元的所有单词(按order_index排序)
    result = await db.execute(
        select(Word, WordDefinition, UnitWord.order_index)
        .join(UnitWord, Word.id == UnitWord.word_id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(UnitWord.unit_id == unit_id)
        .order_by(UnitWord.order_index)
    )
    word_rows = result.all()

    # 3. 组装单词列表
    words = []
    for word, definition, order_idx in word_rows:
        # 如果没有 primary 释义，查找第一个释义作为 fallback
        meaning_text = None
        pos_text = None
        example_text = None
        example_trans = None
        if definition:
            meaning_text = definition.meaning
            pos_text = definition.part_of_speech
            example_text = definition.example_sentence
            example_trans = definition.example_translation
        else:
            # fallback: 查第一个释义
            fallback = await db.execute(
                select(WordDefinition).where(WordDefinition.word_id == word.id).limit(1)
            )
            fb_def = fallback.scalar_one_or_none()
            if fb_def:
                meaning_text = fb_def.meaning
                pos_text = fb_def.part_of_speech
                example_text = fb_def.example_sentence
                example_trans = fb_def.example_translation

        word_dict = {
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "syllables": word.syllables,
            "difficulty": word.difficulty,
            "audio_url": word.audio_url,
            "image_url": word.image_url,
            "order_index": order_idx,
            "meaning": meaning_text,
            "part_of_speech": pos_text,
            "example_sentence": example_text,
            "example_translation": example_trans,
        }
        words.append(word_dict)

    total_words = len(words)

    # 4. 如果单元没有单词,直接返回提示信息
    if total_words == 0:
        return StartLearningResponse(
            has_existing_progress=False,
            current_word_index=0,
            completed_words=0,
            total_words=0,
            progress_percentage=0.0,
            words=[],
            message=f"该单元暂时没有单词,请联系老师添加单词后再开始学习",
            unit_info=_build_unit_info(unit, word_book)
        )

    # 5. 查询是否有学习进度记录
    result = await db.execute(
        select(LearningProgress).where(
            and_(
                LearningProgress.user_id == user_id,
                LearningProgress.unit_id == unit_id,
                LearningProgress.learning_mode == learning_mode
            )
        )
    )
    progress = result.scalar_one_or_none()

    # 6. 如果有进度记录(断点续学)
    if progress:
        current_word_index = progress.current_word_index
        completed_words = progress.completed_words
        has_existing_progress = True

        # 如果已经完成,从头开始
        if progress.is_completed:
            current_word_index = 0
            completed_words = 0
            progress.is_completed = False
            progress.current_word_index = 0
            progress.completed_words = 0
            message = "该单元已完成,现在重新开始学习"
        else:
            message = f"继续上次的学习,从第 {current_word_index + 1} 个单词开始"

        # 更新最后学习时间
        progress.last_studied_at = datetime.utcnow()
        progress.total_words = total_words

    else:
        # 7. 如果没有进度记录,创建新记录
        current_word_index = 0
        completed_words = 0
        has_existing_progress = False
        message = "首次学习该单元,从第 1 个单词开始"

        # 创建新的学习进度记录
        progress = LearningProgress(
            user_id=user_id,
            book_id=unit.book_id,
            unit_id=unit_id,
            learning_mode=learning_mode,
            current_word_index=0,
            current_word_id=words[0]["id"] if words else None,
            completed_words=0,
            total_words=total_words,
            is_completed=False,
            last_studied_at=datetime.utcnow(),
            started_at=datetime.utcnow()
        )
        db.add(progress)

    await db.commit()
    await db.refresh(progress)

    # 7. 计算进度百分比
    progress_percentage = (completed_words / total_words * 100) if total_words > 0 else 0.0

    # 8. 返回响应
    return StartLearningResponse(
        has_existing_progress=has_existing_progress,
        current_word_index=current_word_index,
        completed_words=completed_words,
        total_words=total_words,
        progress_percentage=round(progress_percentage, 2),
        words=words,
        message=message,
        unit_info=_build_unit_info(unit, word_book)
    )


# ========================================
# 更新学习进度
# ========================================

@router.put("/progress", response_model=UpdateProgressResponse)
async def update_progress(
    request: UpdateProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    更新学习进度

    功能:
    - 更新 current_word_index
    - 更新 completed_words
    - 更新 is_completed
    - 记录 last_studied_at
    """
    # 从认证用户获取user_id
    user_id = current_user.id

    # 1. 查询学习进度记录
    result = await db.execute(
        select(LearningProgress).where(
            and_(
                LearningProgress.user_id == user_id,
                LearningProgress.unit_id == request.unit_id,
                LearningProgress.learning_mode == request.learning_mode
            )
        )
    )
    progress = result.scalar_one_or_none()

    if not progress:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="学习进度记录不存在,请先调用开始学习接口"
        )

    # 2. 更新进度
    progress.current_word_index = request.current_word_index
    progress.current_word_id = request.current_word_id
    progress.last_studied_at = datetime.utcnow()

    # 3. 更新完成状态
    if request.is_completed:
        progress.is_completed = True
        progress.completed_at = datetime.utcnow()
        progress.completed_words = progress.total_words
        message = "恭喜!您已完成该单元的学习"
    else:
        # 根据当前索引计算已完成单词数
        progress.completed_words = request.current_word_index
        message = "学习进度已更新"

    await db.commit()
    await db.refresh(progress)

    # 4. 计算进度百分比
    progress_percentage = (progress.completed_words / progress.total_words * 100) if progress.total_words > 0 else 0.0

    return UpdateProgressResponse(
        success=True,
        message=message,
        progress_percentage=round(progress_percentage, 2),
        completed_words=progress.completed_words,
        total_words=progress.total_words,
        is_completed=progress.is_completed
    )


# ========================================
# 获取单词本进度总览
# ========================================

@router.get("/books/{book_id}/progress", response_model=BookProgressResponse)
async def get_book_progress(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取单词本的学习进度总览

    返回:
    - 单词本信息
    - 每个单元的进度
    - 整体完成百分比
    """
    # 从认证用户获取user_id
    user_id = current_user.id

    # 1. 验证单词本是否存在
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    book = result.scalar_one_or_none()

    if not book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单词本ID {book_id} 不存在"
        )

    # 2. 获取该单词本下的所有单元
    result = await db.execute(
        select(Unit)
        .where(Unit.book_id == book_id)
        .order_by(Unit.order_index, Unit.unit_number)
    )
    units = result.scalars().all()

    # 3. 获取每个单元的学习进度
    unit_progresses = []
    total_words_in_book = 0
    total_completed_words = 0

    for unit in units:
        # 查询该单元的学习进度(所有模式)
        result = await db.execute(
            select(LearningProgress).where(
                and_(
                    LearningProgress.user_id == user_id,
                    LearningProgress.unit_id == unit.id
                )
            )
        )
        progresses = result.scalars().all()

        # 计算该单元的整体进度(取所有模式的最大进度)
        max_completed = 0
        has_progress = False
        current_word_index = 0
        last_studied_at = None
        learning_mode = None
        is_completed = False

        if progresses:
            has_progress = True
            for p in progresses:
                if p.completed_words > max_completed:
                    max_completed = p.completed_words
                    current_word_index = p.current_word_index
                    last_studied_at = p.last_studied_at
                    learning_mode = p.learning_mode
                    is_completed = p.is_completed

        word_count_result = await db.execute(
            select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit.id)
        )
        word_count = word_count_result.scalar() or 0
        progress_percentage = (max_completed / word_count * 100) if word_count > 0 else 0.0

        total_words_in_book += word_count
        total_completed_words += max_completed

        unit_progresses.append(UnitProgressResponse(
            unit_id=unit.id,
            unit_number=unit.unit_number,
            unit_name=unit.name,
            word_count=word_count,
            completed_words=max_completed,
            progress_percentage=round(progress_percentage, 2),
            has_progress=has_progress,
            current_word_index=current_word_index,
            last_studied_at=last_studied_at,
            learning_mode=learning_mode,
            is_completed=is_completed
        ))

    # 4. 计算整体进度
    overall_progress = (total_completed_words / total_words_in_book * 100) if total_words_in_book > 0 else 0.0

    return BookProgressResponse(
        book_id=book.id,
        book_name=book.name,
        unit_count=len(units),
        word_count=total_words_in_book,
        completed_words=total_completed_words,
        progress_percentage=round(overall_progress, 2),
        units=unit_progresses
    )


# ========================================
# 获取单元详细进度
# ========================================

@router.get("/units/{unit_id}/progress", response_model=UnitProgressResponse)
async def get_unit_progress(
    unit_id: int,
    learning_mode: str = "flashcard",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取单元的详细学习进度

    返回指定学习模式下的进度
    """
    # 从认证用户获取user_id
    user_id = current_user.id

    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 查询学习进度
    result = await db.execute(
        select(LearningProgress).where(
            and_(
                LearningProgress.user_id == user_id,
                LearningProgress.unit_id == unit_id,
                LearningProgress.learning_mode == learning_mode
            )
        )
    )
    progress = result.scalar_one_or_none()

    # 实时查单词数
    uc_result = await db.execute(
        select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit.id)
    )
    real_wc = uc_result.scalar() or 0

    # 3. 组装响应
    if progress:
        progress_percentage = (progress.completed_words / progress.total_words * 100) if progress.total_words > 0 else 0.0

        return UnitProgressResponse(
            unit_id=unit.id,
            unit_number=unit.unit_number,
            unit_name=unit.name,
            word_count=real_wc,
            completed_words=progress.completed_words,
            progress_percentage=round(progress_percentage, 2),
            has_progress=True,
            current_word_index=progress.current_word_index,
            last_studied_at=progress.last_studied_at,
            learning_mode=progress.learning_mode,
            is_completed=progress.is_completed
        )
    else:
        return UnitProgressResponse(
            unit_id=unit.id,
            unit_number=unit.unit_number,
            unit_name=unit.name,
            word_count=real_wc,
            completed_words=0,
            progress_percentage=0.0,
            has_progress=False,
            current_word_index=0,
            last_studied_at=None,
            learning_mode=None,
            is_completed=False
        )


# ========================================
# 获取学生的单词本列表
# ========================================

@router.get("/books", response_model=List[StudentBookListItem])
async def get_student_books(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取学生已购买/已分配的单词本(含学习进度)
    只返回通过 BookAssignment 分配给该学生的单词本
    """
    user_id = current_user.id

    # 1. 获取该学生已分配的单词本
    result = await db.execute(
        select(WordBook)
        .join(BookAssignment, BookAssignment.book_id == WordBook.id)
        .where(BookAssignment.student_id == user_id)
        .order_by(WordBook.created_at.desc())
    )
    books = result.scalars().all()

    # 2. 为每个单词本计算进度
    book_list = []

    for book in books:
        # 获取该单词本下的所有单元
        result = await db.execute(
            select(func.count()).select_from(Unit).where(Unit.book_id == book.id)
        )
        unit_count = result.scalar()

        # 获取总单词数（实时计算）
        result = await db.execute(
            select(func.count()).select_from(UnitWord)
            .join(Unit, UnitWord.unit_id == Unit.id)
            .where(Unit.book_id == book.id)
        )
        word_count = result.scalar() or 0

        # 获取该单词本的学习进度
        result = await db.execute(
            select(LearningProgress)
            .where(
                and_(
                    LearningProgress.user_id == user_id,
                    LearningProgress.book_id == book.id
                )
            )
        )
        progresses = result.scalars().all()

        # 计算已完成单词数(取所有单元所有模式的最大进度)
        completed_words = sum([p.completed_words for p in progresses]) if progresses else 0

        # 计算进度百分比
        progress_percentage = (completed_words / word_count * 100) if word_count > 0 else 0.0

        book_list.append(StudentBookListItem(
            id=book.id,
            name=book.name,
            description=book.description,
            grade_level=book.grade_level,
            cover_color=book.cover_color,
            unit_count=unit_count,
            word_count=word_count,
            progress_percentage=round(progress_percentage, 2),
            created_at=book.created_at
        ))

    return book_list
