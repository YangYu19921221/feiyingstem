"""
学生端错题集API
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, case
from datetime import datetime, timedelta, date
from typing import List

from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.models.learning import LearningRecord, WordMastery
from app.api.v1.auth import get_current_student
from app.schemas.mistake_book import (
    MistakeWordDetail,
    MistakeWordPage,
    MistakeBookStats,
    MistakePracticeRequest,
    MistakePracticeResponse,
    ChallengeLevelsResponse,
    ChallengeLevel,
    ChallengeLevelWord,
    ChallengeSubmitRequest,
    ChallengeSubmitResult,
    ChallengeAnswerItem,
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


@router.get("/mistake-book/words", response_model=MistakeWordPage)
async def get_mistake_words(
    only_unresolved: bool = True,
    unit_id: int = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    获取错题单词列表（分页）

    参数:
    - only_unresolved: 只显示未解决的错题 (掌握度 < 4)
    - unit_id: 筛选指定单元的错题
    - page: 页码（从1开始）
    - page_size: 每页数量（默认20）
    """
    user_id = current_user.id
    week_ago = datetime.utcnow() - timedelta(days=7)

    # 构建查询:获取所有答错的单词及其统计
    query = (
        select(
            Word.id,
            Word.word,
            Word.phonetic,
            WordDefinition.meaning,
            WordDefinition.part_of_speech,
            func.count(LearningRecord.id).label('total_mistakes'),
            func.count(case(
                (LearningRecord.created_at >= week_ago, LearningRecord.id),
                else_=None
            )).label('recent_mistakes'),
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

    # 先获取总数
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    # 分页
    total_pages = max(1, (total + page_size - 1) // page_size)
    offset = (page - 1) * page_size
    query = query.limit(page_size).offset(offset)

    result = await db.execute(query)
    rows = result.fetchall()

    mistake_words = [
        MistakeWordDetail(
            word_id=row.id,
            word=row.word,
            phonetic=row.phonetic,
            meaning=row.meaning,
            part_of_speech=row.part_of_speech,
            total_mistakes=row.total_mistakes,
            recent_mistakes=row.recent_mistakes,
            last_mistake_at=row.last_mistake_at,
            mastery_level=row.mastery_level or 0,
            correct_count=row.correct_count or 0,
            wrong_count=row.wrong_count or 0,
            flashcard_wrong=row.flashcard_wrong or 0,
            quiz_wrong=row.quiz_wrong or 0,
            spelling_wrong=row.spelling_wrong or 0,
            fillblank_wrong=row.fillblank_wrong or 0,
            is_resolved=(row.mastery_level or 0) >= 4,
        )
        for row in rows
    ]

    return MistakeWordPage(
        items=mistake_words,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


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


@router.get("/mistake-book/challenge-levels", response_model=ChallengeLevelsResponse)
async def get_challenge_levels(
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    获取错题闯关关卡列表
    将未解决错题按掌握度降序排列，每5个一组分为关卡
    """
    user_id = current_user.id

    # 查询所有未解决的错题单词 (mastery_level < 4)
    query = (
        select(
            Word.id,
            Word.word,
            WordDefinition.meaning,
            Word.phonetic,
            WordDefinition.part_of_speech,
            WordMastery.mastery_level,
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
                LearningRecord.is_correct == False,
            )
        )
        .group_by(Word.id, WordDefinition.id, WordMastery.mastery_level)
        .having(
            or_(
                WordMastery.mastery_level == None,
                WordMastery.mastery_level < 4
            )
        )
        .order_by(desc(WordMastery.mastery_level))
    )

    result = await db.execute(query)
    rows = result.fetchall()

    if not rows:
        return ChallengeLevelsResponse(
            levels=[],
            total_levels=0,
            cleared_levels=0,
            total_unresolved=0,
            message="没有未解决的错题，太棒了！"
        )

    # 每5个一组分为关卡
    words_per_level = 5
    levels = []
    for i in range(0, len(rows), words_per_level):
        chunk = rows[i:i + words_per_level]
        level_num = (i // words_per_level) + 1

        level_words = [
            ChallengeLevelWord(
                word_id=row.id,
                word=row.word,
                meaning=row.meaning,
                phonetic=row.phonetic,
                part_of_speech=row.part_of_speech,
            )
            for row in chunk
        ]

        # 判断关卡状态: 所有词 mastery >= 4 为 cleared
        all_cleared = all(
            (row.mastery_level or 0) >= 4 for row in chunk
        )

        if all_cleared:
            level_status = "cleared"
        elif level_num == 1:
            level_status = "unlocked"
        else:
            # 前一关是否已通关
            prev_cleared = len(levels) > 0 and levels[-1].status == "cleared"
            level_status = "unlocked" if prev_cleared else "locked"

        levels.append(ChallengeLevel(
            level=level_num,
            status=level_status,
            words=level_words,
            word_count=len(level_words),
        ))

    cleared_count = sum(1 for l in levels if l.status == "cleared")

    return ChallengeLevelsResponse(
        levels=levels,
        total_levels=len(levels),
        cleared_levels=cleared_count,
        total_unresolved=len(rows),
        message=f"共 {len(levels)} 关，已通关 {cleared_count} 关",
    )


@router.post("/mistake-book/challenge-submit", response_model=ChallengeSubmitResult)
async def submit_challenge_level(
    request: ChallengeSubmitRequest,
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db)
):
    """
    提交闯关答题结果
    全部答对: 标记单词 mastery_level = max(current, 4)
    有错: 记录学习记录但不标记解决
    """
    user_id = current_user.id
    now = datetime.utcnow()

    correct_count = 0
    wrong_words = []

    for answer in request.answers:
        # 查询正确答案
        word_result = await db.execute(
            select(Word).where(Word.id == answer.word_id)
        )
        word = word_result.scalar_one_or_none()
        if not word:
            continue

        is_correct = answer.user_answer.strip() == word.word.strip()

        # 记录学习记录
        record = LearningRecord(
            user_id=user_id,
            word_id=answer.word_id,
            learning_mode='spelling',
            is_correct=is_correct,
            created_at=now,
        )
        db.add(record)

        # 获取或创建掌握度记录
        mastery_result = await db.execute(
            select(WordMastery).where(
                and_(
                    WordMastery.user_id == user_id,
                    WordMastery.word_id == answer.word_id,
                )
            )
        )
        mastery = mastery_result.scalar_one_or_none()
        if not mastery:
            mastery = WordMastery(
                user_id=user_id,
                word_id=answer.word_id,
                mastery_level=0,
                correct_count=0,
                wrong_count=0,
                created_at=now,
            )
            db.add(mastery)
            await db.flush()

        if is_correct:
            correct_count += 1
            mastery.correct_count = (mastery.correct_count or 0) + 1
            mastery.last_practiced_at = now
        else:
            mastery.wrong_count = (mastery.wrong_count or 0) + 1
            mastery.last_practiced_at = now
            # 获取释义用于返回
            def_result = await db.execute(
                select(WordDefinition).where(
                    WordDefinition.word_id == answer.word_id
                )
            )
            definition = def_result.scalar_one_or_none()
            wrong_words.append(ChallengeLevelWord(
                word_id=answer.word_id,
                word=word.word,
                meaning=definition.meaning if definition else "",
                phonetic=word.phonetic,
                part_of_speech=definition.part_of_speech if definition else None,
            ))

    total_count = len(request.answers)
    passed = correct_count == total_count

    # 全部答对: 提升掌握度到4
    if passed:
        for answer in request.answers:
            mastery_result = await db.execute(
                select(WordMastery).where(
                    and_(
                        WordMastery.user_id == user_id,
                        WordMastery.word_id == answer.word_id,
                    )
                )
            )
            mastery = mastery_result.scalar_one_or_none()
            if mastery:
                if mastery.mastery_level < 4:
                    mastery.mastery_level = 4
                    mastery.last_practiced_at = now
            else:
                mastery = WordMastery(
                    user_id=user_id,
                    word_id=answer.word_id,
                    mastery_level=4,
                    correct_count=1,
                    wrong_count=0,
                    created_at=now,
                    last_practiced_at=now,
                )
                db.add(mastery)

    await db.commit()

    if passed:
        message = f"🎉 全部答对！第 {request.level} 关通关成功！"
    else:
        message = f"答对 {correct_count}/{total_count}，还有 {total_count - correct_count} 个需要再练练"

    return ChallengeSubmitResult(
        passed=passed,
        correct_count=correct_count,
        total_count=total_count,
        wrong_words=wrong_words,
        message=message,
    )
