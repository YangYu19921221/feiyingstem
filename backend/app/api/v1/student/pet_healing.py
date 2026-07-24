from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sa_func
from datetime import datetime
import math

from app.core.database import get_db
from app.models.user import User
from app.models.pet import UserPet, PetEventLog
from app.models.word import Word, WordDefinition
from app.api.v1.auth import get_current_student
from app.core.pet_formulas import calculate_max_hp

router = APIRouter()


def heal_amount_for(max_hp: int) -> int:
    """每答对1题的回血量 = 最大HP的10%（至少5），高级宠物不必答太多题"""
    return max(5, round(max_hp * 0.1))


# ========== 宠物治疗系统 ==========

@router.get("/pet/healing-status")
async def get_healing_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取宠物治疗状态"""
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    max_hp = calculate_max_hp(pet.level, pet.evolution_stage)
    hp_percent = (pet.current_hp / max_hp) * 100
    heal_per_question = heal_amount_for(max_hp)

    # 计算需要治疗的题目数
    if pet.is_injured:
        target_hp = int(max_hp * 0.8)  # 恢复到80%
        needed_heal = max(0, target_hp - pet.current_hp)
        questions_needed = math.ceil(needed_heal / heal_per_question)
    else:
        questions_needed = 0

    return {
        "pet_id": pet.id,
        "pet_name": pet.name,
        "current_hp": pet.current_hp,
        "max_hp": max_hp,
        "hp_percent": round(hp_percent, 1),
        "is_injured": pet.is_injured,
        "questions_needed": questions_needed,
        "heal_per_question": heal_per_question,
    }


@router.post("/pet/heal")
async def heal_pet(
    word_id: int,
    is_correct: bool,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    通过答对单词题来治疗宠物

    每答对1题恢复5 HP
    """
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    if not pet.is_injured:
        raise HTTPException(status_code=400, detail="宠物不需要治疗")

    max_hp = calculate_max_hp(pet.level, pet.evolution_stage)

    # 答对才恢复HP（每题回血 = 最大HP的10%）
    healed = 0
    if is_correct:
        healed = heal_amount_for(max_hp)
        pet.current_hp = min(max_hp, pet.current_hp + healed)

        # HP恢复到80%以上，解除受伤状态
        if pet.current_hp >= max_hp * 0.8:
            pet.is_injured = False
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="healed",
                detail=f"宠物恢复健康！当前HP: {pet.current_hp}/{max_hp}"
            ))

    pet.last_interaction_at = datetime.utcnow()
    await db.commit()
    await db.refresh(pet)

    return {
        "healed": healed,
        "current_hp": pet.current_hp,
        "max_hp": max_hp,
        "is_healthy": not pet.is_injured,
        "hp_percent": round((pet.current_hp / max_hp) * 100, 1),
    }


@router.get("/pet/healing-words")
async def get_healing_words(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    获取用于治疗的单词题目（随机抽取）
    """
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )
    pet = result.scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    if not pet.is_injured:
        raise HTTPException(status_code=400, detail="宠物不需要治疗")

    # 优先从「学生已学过的单词」中抽取（word_mastery 有遇到记录的词）
    from app.models.word import WordDefinition
    from app.models.learning import WordMastery
    learned_stmt = (
        select(Word, WordDefinition)
        .join(WordDefinition, WordDefinition.word_id == Word.id)
        .join(WordMastery, WordMastery.word_id == Word.id)
        .where(
            WordMastery.user_id == current_user.id,
            WordMastery.total_encounters > 0,
            WordDefinition.is_primary == True,
        )
        .order_by(sa_func.random())
        .limit(limit)
    )
    result = await db.execute(learned_stmt)
    rows = result.all()

    # 已学单词不足以出选择题（<4，无法凑够干扰项）时，回退到全库随机，保证功能可用
    if len(rows) < 4:
        fallback_stmt = (
            select(Word, WordDefinition)
            .join(WordDefinition, WordDefinition.word_id == Word.id)
            .where(WordDefinition.is_primary == True)
            .order_by(sa_func.random())
            .limit(limit)
        )
        result = await db.execute(fallback_stmt)
        rows = result.all()

    words = []
    for word, definition in rows:
        words.append({
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "meaning": definition.meaning,
            "part_of_speech": definition.part_of_speech,
        })

    return words
