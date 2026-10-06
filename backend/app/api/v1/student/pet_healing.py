from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, and_, func as sa_func
from datetime import datetime, timedelta
import math
import random

from app.core.database import get_db
from app.models.user import User
from app.models.pet import UserPet, PetEventLog, PetHealQuestion
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

    max_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
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


class HealAnswer(BaseModel):
    question_id: int
    answer: str = Field(..., max_length=500)


@router.post("/pet/heal")
async def heal_pet(
    body: HealAnswer,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    答治疗题回血(2026-10-06 重写,防多开刷血)。

    - 题目来自 GET /pet/healing-words(服务端落库、带正确释义),这里**服务端判分**,
      不再接受前端传 is_correct
    - 一题只能用一次: 条件 UPDATE「used_at IS NULL」认领,两个标签页同时交同一题只有一个算
    - 回血是一条 SQL 原子加(current_hp + 回血量,封顶 max),不是读出来加完写回
    每答对 1 题恢复最大 HP 的 10%;恢复到 80% 解除受伤。
    返回的 current_hp/hp_percent 已包含本次回血,前端直接用,不要再叠加增量。
    """
    # 正常答题一题要好几秒;限速挡脚本(进程内桶,多 worker 时各算各的,真正的闸门是一题一用)
    from app.services import rate_limit
    rate_limit.check(("pet-heal", current_user.id), 30, 60, "答得太快了,休息一下再继续")

    pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    q = (await db.execute(
        select(PetHealQuestion).where(
            PetHealQuestion.id == body.question_id,
            PetHealQuestion.user_id == current_user.id,
        )
    )).scalar_one_or_none()
    if not q or q.pet_id != pet.id:
        raise HTTPException(status_code=404, detail="这道题已失效,请刷新页面重新开始")
    correct_meaning = q.correct_meaning

    claimed = await db.execute(
        update(PetHealQuestion)
        .where(PetHealQuestion.id == q.id, PetHealQuestion.used_at.is_(None))
        .values(used_at=datetime.utcnow())
        .execution_options(synchronize_session=False)
    )
    if (claimed.rowcount or 0) == 0:
        await db.commit()
        raise HTTPException(status_code=409, detail="这道题已经答过了")

    max_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
    is_correct = body.answer.strip() == correct_meaning.strip()
    healed = 0
    if is_correct:
        heal = heal_amount_for(max_hp)
        res = await db.execute(
            update(UserPet)
            .where(UserPet.id == pet.id, UserPet.is_injured.is_(True))
            .values(current_hp=sa_func.min(max_hp, sa_func.coalesce(UserPet.current_hp, 0) + heal),
                    last_interaction_at=datetime.utcnow())
            .execution_options(synchronize_session=False)
        )
        if (res.rowcount or 0) == 1:
            healed = heal
            # HP 恢复到 80% 以上解除受伤 —— 同样条件 UPDATE,并发时只记一次「恢复健康」
            cured = await db.execute(
                update(UserPet)
                .where(UserPet.id == pet.id, UserPet.is_injured.is_(True),
                       UserPet.current_hp >= max_hp * 0.8)
                .values(is_injured=False)
                .execution_options(synchronize_session=False)
            )
            if (cured.rowcount or 0) == 1:
                db.add(PetEventLog(pet_id=pet.id, event_type="healed", detail="宠物恢复健康！"))
    await db.commit()
    await db.refresh(pet)

    return {
        "healed": healed,
        "is_correct": is_correct,
        "correct_answer": correct_meaning,
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
    出治疗题(随机抽词)。每题在服务端落一行(带正确释义),下发 question_id + 4 个选项,
    **不下发正确答案** —— 判分在 POST /pet/heal。
    """
    limit = max(1, min(limit, 20))
    pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    if not pet.is_injured:
        raise HTTPException(status_code=400, detail="宠物不需要治疗")

    # 优先从「学生已学过的单词」中抽取（word_mastery 有遇到记录的词）
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
    rows = (await db.execute(learned_stmt)).all()

    # 已学单词不足以出选择题（<4，无法凑够干扰项）时，回退到全库随机，保证功能可用
    if len(rows) < 4:
        fallback_stmt = (
            select(Word, WordDefinition)
            .join(WordDefinition, WordDefinition.word_id == Word.id)
            .where(WordDefinition.is_primary == True)
            .order_by(sa_func.random())
            .limit(limit)
        )
        rows = (await db.execute(fallback_stmt)).all()

    # 清掉一天前没用掉的旧题,表不无限涨
    await db.execute(delete(PetHealQuestion).where(and_(
        PetHealQuestion.user_id == current_user.id,
        PetHealQuestion.created_at < datetime.utcnow() - timedelta(days=1),
    )))

    meanings = list(dict.fromkeys(d.meaning for _, d in rows if d.meaning))
    out = []
    for word, definition in rows:
        if not definition.meaning:
            continue
        q = PetHealQuestion(user_id=current_user.id, pet_id=pet.id,
                            word_id=word.id, correct_meaning=definition.meaning)
        db.add(q)
        await db.flush()
        distractors = [m for m in meanings if m != definition.meaning]
        random.shuffle(distractors)
        options = [definition.meaning, *distractors[:3]]
        random.shuffle(options)
        out.append({
            "question_id": q.id,
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "part_of_speech": definition.part_of_speech,
            "options": options,
        })
    await db.commit()
    return out
