"""
学生端错题集API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from datetime import datetime, timedelta, date
from typing import List

from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.models.learning import LearningRecord, WordMastery
from app.api.v1.auth import get_current_student
from app.schemas.mistake_book import (
    MistakeWordDetail,
    MistakeBookStats,
    MistakePracticeRequest,
    MistakePracticeResponse,
)

router = APIRouter()


@router.get("/mistake-book/stats", response_model=MistakeBookStats)
async def get_mistake_book_stats(
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    获取错题集统计信息
    """
    user_id = current_user.id

    # 查询所有答错的单词ID (去重)
    result = await db.execute(
        select(func.distinct(LearningRecord.word_id))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False
            )
        )
    )
    mistake_word_ids = [row[0] for row in result.fetchall()]
    total_mistakes = len(mistake_word_ids)

    if total_mistakes == 0:
        return MistakeBookStats(
            total_mistakes=0,
            unresolved_mistakes=0,
            resolved_mistakes=0
        )

    # 查询未解决的错题 (掌握度 < 4)
    result = await db.execute(
        select(func.count(WordMastery.id))
        .where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id.in_(mistake_word_ids),
                WordMastery.mastery_level < 4
            )
        )
    )
    unresolved_mistakes = result.scalar() or 0
    resolved_mistakes = total_mistakes - unresolved_mistakes

    # 按学习模式统计
    flashcard_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False,
                LearningRecord.learning_mode == 'flashcard'
            )
        )
    )
    flashcard_mistakes = flashcard_result.scalar() or 0

    quiz_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False,
                LearningRecord.learning_mode == 'quiz'
            )
        )
    )
    quiz_mistakes = quiz_result.scalar() or 0

    spelling_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False,
                LearningRecord.learning_mode == 'spelling'
            )
        )
    )
    spelling_mistakes = spelling_result.scalar() or 0

    fillblank_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False,
                LearningRecord.learning_mode == 'fillblank'
            )
        )
    )
    fillblank_mistakes = fillblank_result.scalar() or 0

    # 今天和本周练习的错题数
    today = date.today()
    week_ago = today - timedelta(days=7)

    today_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.word_id.in_(mistake_word_ids),
                func.date(LearningRecord.created_at) == today
            )
        )
    )
    today_practice_count = today_result.scalar() or 0

    week_result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.word_id.in_(mistake_word_ids),
                func.date(LearningRecord.created_at) >= week_ago
            )
        )
    )
    week_practice_count = week_result.scalar() or 0

    return MistakeBookStats(
        total_mistakes=total_mistakes,
        unresolved_mistakes=unresolved_mistakes,
        resolved_mistakes=resolved_mistakes,
        flashcard_mistakes=flashcard_mistakes,
        quiz_mistakes=quiz_mistakes,
        spelling_mistakes=spelling_mistakes,
        fillblank_mistakes=fillblank_mistakes,
        today_practice_count=today_practice_count,
        week_practice_count=week_practice_count,
    )


@router.get("/mistake-book/words", response_model=List[MistakeWordDetail])
async def get_mistake_words(
    only_unresolved: bool = True,
    unit_id: int = None,
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    获取错题单词列表

    参数:
    - only_unresolved: 只显示未解决的错题 (掌握度 < 4)
    - unit_id: 筛选指定单元的错题
    """
    user_id = current_user.id

    # 构建查询:获取所有答错的单词及其统计
    query = (
        select(
            Word.id,
            Word.word,
            Word.phonetic,
            WordDefinition.meaning,
            WordDefinition.part_of_speech,
            func.count(LearningRecord.id).label('total_mistakes'),
            func.max(LearningRecord.created_at).label('last_mistake_at'),
            WordMastery.mastery_level,
            WordMastery.correct_count,
            WordMastery.wrong_count,
            WordMastery.flashcard_wrong,
            WordMastery.quiz_wrong,
            WordMastery.spelling_wrong,
            WordMastery.fillblank_wrong,
        )
        .join(WordDefinition, Word.id == WordDefinition.word_id)
        .join(LearningRecord, Word.id == LearningRecord.word_id)
        .outerjoin(
            WordMastery,
            and_(
                WordMastery.word_id == Word.id,
                WordMastery.user_id == user_id
            )
        )
        .where(
            and_(
                LearningRecord.user_id == user_id,
                LearningRecord.is_correct == False
            )
        )
        .group_by(
            Word.id,
            WordDefinition.id,
            WordMastery.mastery_level,
            WordMastery.correct_count,
            WordMastery.wrong_count,
            WordMastery.flashcard_wrong,
            WordMastery.quiz_wrong,
            WordMastery.spelling_wrong,
            WordMastery.fillblank_wrong,
        )
    )

    # 如果只显示未解决的错题
    if only_unresolved:
        query = query.having(
            or_(
                WordMastery.mastery_level == None,
                WordMastery.mastery_level < 4
            )
        )

    # 如果指定了单元ID
    if unit_id:
        from app.models.word import UnitWord
        query = query.join(UnitWord, Word.id == UnitWord.word_id).where(UnitWord.unit_id == unit_id)

    # 按错误次数降序排列
    query = query.order_by(desc('total_mistakes'))

    result = await db.execute(query)
    rows = result.fetchall()

    # 计算最近7天的错误次数
    week_ago = datetime.utcnow() - timedelta(days=7)

    mistake_words = []
    for row in rows:
        # 查询最近7天的错误次数
        recent_result = await db.execute(
            select(func.count(LearningRecord.id))
            .where(
                and_(
                    LearningRecord.user_id == user_id,
                    LearningRecord.word_id == row.id,
                    LearningRecord.is_correct == False,
                    LearningRecord.created_at >= week_ago
                )
            )
        )
        recent_mistakes = recent_result.scalar() or 0

        mastery_level = row.mastery_level or 0
        is_resolved = mastery_level >= 4

        mistake_words.append(MistakeWordDetail(
            word_id=row.id,
            word=row.word,
            phonetic=row.phonetic,
            meaning=row.meaning,
            part_of_speech=row.part_of_speech,
            total_mistakes=row.total_mistakes,
            recent_mistakes=recent_mistakes,
            last_mistake_at=row.last_mistake_at,
            mastery_level=mastery_level,
            correct_count=row.correct_count or 0,
            wrong_count=row.wrong_count or 0,
            flashcard_wrong=row.flashcard_wrong or 0,
            quiz_wrong=row.quiz_wrong or 0,
            spelling_wrong=row.spelling_wrong or 0,
            fillblank_wrong=row.fillblank_wrong or 0,
            is_resolved=is_resolved,
        ))

    return mistake_words


@router.post("/mistake-book/practice", response_model=MistakePracticeResponse)
async def start_mistake_practice(
    request: MistakePracticeRequest,
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    开始错题练习

    返回需要练习的错题单词列表,按优先级排序:
    1. 最近错误次数多的
    2. 掌握度低的
    3. 总错误次数多的
    """
    user_id = current_user.id

    # 获取错题单词列表
    mistake_words = await get_mistake_words(
        only_unresolved=request.only_unresolved,
        unit_id=request.unit_id,
        current_user=current_user,
        db=db
    )

    if not mistake_words:
        return MistakePracticeResponse(
            total_mistakes=0,
            practice_words=[],
            message="恭喜!暂时没有需要练习的错题。"
        )

    # 智能排序:优先练习最需要掌握的单词
    # 排序规则: 最近错误次数 > 低掌握度 > 总错误次数
    sorted_words = sorted(
        mistake_words,
        key=lambda w: (
            -w.recent_mistakes,  # 最近错误次数多的优先
            w.mastery_level,  # 掌握度低的优先
            -w.total_mistakes  # 总错误次数多的优先
        )
    )

    # 限制数量
    practice_words = sorted_words[:request.limit]

    message = f"为你准备了 {len(practice_words)} 个错题进行练习,加油!"
    if request.only_unresolved:
        message += " (只包含未掌握的错题)"

    return MistakePracticeResponse(
        total_mistakes=len(mistake_words),
        practice_words=practice_words,
        message=message
    )


@router.delete("/mistake-book/words/{word_id}")
async def mark_mistake_as_resolved(
    word_id: int,
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    手动标记错题为已解决
    (实际上通过提升掌握度来实现,这里提供一个快捷方式)
    """
    user_id = current_user.id

    # 查询单词掌握度
    result = await db.execute(
        select(WordMastery)
        .where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id == word_id
            )
        )
    )
    mastery = result.scalar_one_or_none()

    if not mastery:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="该单词没有学习记录"
        )

    if mastery.mastery_level >= 4:
        return {
            "success": True,
            "message": "该单词已经掌握了!"
        }

    # 提升掌握度到4级
    mastery.mastery_level = 4
    await db.commit()

    return {
        "success": True,
        "message": "已标记为已掌握!"
    }
