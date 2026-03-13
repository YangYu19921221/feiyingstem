from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, and_
from typing import List
from app.core.database import get_db
from app.models.word import Word, WordBook, Unit, UnitWord
from app.models.user import User
from app.schemas.unit import (
    UnitCreate, UnitUpdate, UnitResponse, UnitDetailResponse,
    UnitWordAdd, UnitWordAddResponse
)
from app.api.v1.auth import get_current_teacher

router = APIRouter()

# ========================================
# 单元管理 CRUD
# ========================================

@router.post("/books/{book_id}/units", response_model=UnitResponse, status_code=status.HTTP_201_CREATED)
async def create_unit(
    book_id: int,
    unit_data: UnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    创建新单元

    - 教师在单词本下创建单元
    - 自动验证单元序号唯一性
    """
    # 1. 验证单词本是否存在
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    word_book = result.scalar_one_or_none()

    if not word_book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单词本ID {book_id} 不存在"
        )

    # 2. 检查单元序号是否重复
    result = await db.execute(
        select(Unit).where(
            and_(Unit.book_id == book_id, Unit.unit_number == unit_data.unit_number)
        )
    )
    existing_unit = result.scalar_one_or_none()

    if existing_unit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"单元序号 {unit_data.unit_number} 已存在,请使用其他序号"
        )

    # 3. 创建单元
    db_unit = Unit(
        book_id=book_id,
        unit_number=unit_data.unit_number,
        name=unit_data.name,
        description=unit_data.description,
        order_index=unit_data.order_index,
    )
    db.add(db_unit)
    await db.commit()
    await db.refresh(db_unit)

    return db_unit


@router.get("/books/{book_id}/units", response_model=List[UnitResponse])
async def get_units_by_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取单词本下的所有单元

    - 按 order_index 排序
    - 返回单元基本信息和单词数量
    """
    # 1. 验证单词本是否存在
    result = await db.execute(select(WordBook).where(WordBook.id == book_id))
    word_book = result.scalar_one_or_none()

    if not word_book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单词本ID {book_id} 不存在"
        )

    # 2. 获取所有单元
    result = await db.execute(
        select(Unit)
        .where(Unit.book_id == book_id)
        .order_by(Unit.order_index, Unit.unit_number)
    )
    units = result.scalars().all()

    return units


@router.get("/units/{unit_id}", response_model=UnitDetailResponse)
async def get_unit_detail(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    获取单元详情(包含单词列表)

    - 返回单元信息
    - 包含该单元下的所有单词
    """
    # 1. 获取单元
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 获取单元下的单词
    result = await db.execute(
        select(Word, UnitWord.order_index)
        .join(UnitWord, Word.id == UnitWord.word_id)
        .where(UnitWord.unit_id == unit_id)
        .order_by(UnitWord.order_index)
    )
    word_rows = result.all()

    # 3. 组装响应数据
    words = [
        {
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "difficulty": word.difficulty,
            "order_index": order_index
        }
        for word, order_index in word_rows
    ]

    # 4. 构造响应
    unit_dict = {
        "id": unit.id,
        "book_id": unit.book_id,
        "unit_number": unit.unit_number,
        "name": unit.name,
        "description": unit.description,
        "order_index": unit.order_index,
        "word_count": unit.word_count,
        "created_at": unit.created_at,
        "updated_at": unit.updated_at,
        "words": words
    }

    return unit_dict


@router.put("/units/{unit_id}", response_model=UnitResponse)
async def update_unit(
    unit_id: int,
    unit_data: UnitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    更新单元信息

    - 可以修改单元名称、描述、排序
    - 不能修改单元序号(unit_number)
    """
    # 1. 获取单元
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 更新字段
    update_data = unit_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(unit, field, value)

    await db.commit()
    await db.refresh(unit)

    return unit


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_unit(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    删除单元

    - 会级联删除 unit_words 关联数据
    - 不会删除单词本身
    """
    # 1. 获取单元
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 删除单元(级联删除 unit_words)
    await db.delete(unit)
    await db.commit()

    return None


# ========================================
# 单元-单词关联管理
# ========================================

@router.post("/units/{unit_id}/words", response_model=UnitWordAddResponse)
async def add_words_to_unit(
    unit_id: int,
    word_data: UnitWordAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    添加单词到单元

    - 支持批量添加
    - 自动验证单词是否存在
    - 自动设置排序索引
    """
    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 获取当前单元已有的单词数量(用于计算order_index)
    result = await db.execute(
        select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit_id)
    )
    current_word_count = result.scalar()

    # 3. 批量添加单词
    success_count = 0
    failed_count = 0
    failed_word_ids = []

    for idx, word_id in enumerate(word_data.word_ids):
        # 验证单词是否存在
        result = await db.execute(select(Word).where(Word.id == word_id))
        word = result.scalar_one_or_none()

        if not word:
            failed_count += 1
            failed_word_ids.append(word_id)
            continue

        # 检查是否已存在
        result = await db.execute(
            select(UnitWord).where(
                and_(UnitWord.unit_id == unit_id, UnitWord.word_id == word_id)
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            # 已存在,跳过
            continue

        # 添加到单元
        unit_word = UnitWord(
            unit_id=unit_id,
            word_id=word_id,
            order_index=current_word_count + idx
        )
        db.add(unit_word)
        success_count += 1

    # 4. 更新单元的单词数量
    result = await db.execute(
        select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit_id)
    )
    unit.word_count = result.scalar()

    await db.commit()

    return {
        "success_count": success_count,
        "failed_count": failed_count,
        "failed_word_ids": failed_word_ids,
        "message": f"成功添加 {success_count} 个单词到单元"
    }


@router.delete("/units/{unit_id}/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_word_from_unit(
    unit_id: int,
    word_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """
    从单元移除单词

    - 只删除关联关系
    - 不删除单词本身
    """
    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {unit_id} 不存在"
        )

    # 2. 删除关联
    result = await db.execute(
        delete(UnitWord).where(
            and_(UnitWord.unit_id == unit_id, UnitWord.word_id == word_id)
        )
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单词ID {word_id} 不在单元ID {unit_id} 中"
        )

    # 3. 更新单元的单词数量
    result = await db.execute(
        select(func.count()).select_from(UnitWord).where(UnitWord.unit_id == unit_id)
    )
    unit.word_count = result.scalar()

    await db.commit()

    return None
