from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func as sa_func, update
from datetime import datetime, timedelta
import math

from app.core.database import get_db
from app.core.timeutil import local_today_utc_range
from app.models.user import User
from app.models.pet import UserPet, PetEventLog
from app.models.learning import LearningRecord
from app.models.word import Word
from app.schemas.pet import (
    PetCreate, PetSwitchRequest, PetResponse, PetCollectionResponse, PetFeedResponse, PetEventResponse,
    EarnFoodRequest, EarnFoodResponse,
    PetLeaderboardEntry, PetLeaderboardResponse,
)
from app.api.v1.auth import get_current_student
from app.core.pet_formulas import (
    FEED_XP, EVOLUTION_THRESHOLDS, MAX_PET_SLOTS, WORDS_PER_PET_SLOT,
    calculate_max_hp, calc_xp_to_next_level, apply_xp_and_level,
    pet_slots_for_words, next_pet_slot_threshold,
)
from app.core.pet_species import (
    ALLOWED_PET_SPECIES, get_pet_label, get_pet_stage_name,
)

router = APIRouter()


async def get_active_pet(db: AsyncSession, user_id: int) -> UserPet | None:
    result = await db.execute(
        select(UserPet)
        .where(UserPet.user_id == user_id, UserPet.is_active.is_(True))
        .order_by(UserPet.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_learned_word_count(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(sa_func.count(sa_func.distinct(LearningRecord.word_id)))
        .where(LearningRecord.user_id == user_id)
    )
    return int(result.scalar() or 0)


async def sync_food_balance(db: AsyncSession, user_id: int, balance: int, *, except_pet_id: int | None = None) -> None:
    stmt = update(UserPet).where(UserPet.user_id == user_id)
    if except_pet_id is not None:
        stmt = stmt.where(UserPet.id != except_pet_id)
    await db.execute(stmt.values(food_balance=balance))


def apply_decay(pet: UserPet) -> UserPet:
    """计算属性衰减：超过2天不互动，每天 happiness-8, hunger-10，最低不低于10/5"""
    if not pet.last_interaction_at:
        return pet
    now = datetime.utcnow()
    delta = now - pet.last_interaction_at
    days_inactive = delta.days
    if days_inactive >= 2:
        decay_days = days_inactive - 1  # 第2天开始衰减
        pet.happiness = max(5, pet.happiness - decay_days * 8)
        pet.hunger = max(10, pet.hunger - decay_days * 10)
    return pet


def build_pet_response(pet: UserPet) -> PetResponse:
    return PetResponse(
        id=pet.id,
        user_id=pet.user_id,
        name=pet.name,
        species=pet.species,
        level=pet.level,
        experience=pet.experience,
        happiness=pet.happiness,
        hunger=pet.hunger,
        evolution_stage=pet.evolution_stage,
        xp_to_next_level=calc_xp_to_next_level(pet.level),
        xp_per_feed=FEED_XP,
        evolution_stage_name=get_pet_stage_name(pet.species, pet.evolution_stage),
        food_balance=pet.food_balance,
        current_hp=pet.current_hp,
        is_injured=pet.is_injured,
        is_active=pet.is_active,
        last_fed_at=pet.last_fed_at,
        last_interaction_at=pet.last_interaction_at,
        created_at=pet.created_at,
    )


@router.get("/pet")
async def get_my_pet(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取我的宠物（含衰减计算）"""
    pet = await get_active_pet(db, current_user.id)
    if not pet:
        return None
    pet = apply_decay(pet)

    # 长期不喂养（≥2天不互动）且饱食度过低 → 宠物挨饿受伤，需背单词治疗
    # 只在查看时判定：喂食路径会先抬高饱食度不会误伤；治疗/喂食都会刷新 last_interaction_at
    # 使 days_inactive 归零，故治疗后不会立刻复发
    if not pet.is_injured and pet.last_interaction_at:
        days_inactive = (datetime.utcnow() - pet.last_interaction_at).days
        if days_inactive >= 2 and pet.hunger <= 15:
            max_hp = calculate_max_hp(pet.level, pet.evolution_stage)
            pet.is_injured = True
            pet.current_hp = min(pet.current_hp, int(max_hp * 0.4))
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="injured",
                detail="太久没喂食，宠物挨饿受伤了！背单词可以治疗它",
            ))

    await db.commit()
    return build_pet_response(pet)


@router.get("/pet/collection", response_model=PetCollectionResponse)
async def get_pet_collection(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取全部已领养宠物，以及由累计去重学习单词数解锁的队伍容量。"""
    result = await db.execute(
        select(UserPet)
        .where(UserPet.user_id == current_user.id)
        .order_by(desc(UserPet.is_active), UserPet.created_at, UserPet.id)
    )
    pets = list(result.scalars().all())
    learned_words = await get_learned_word_count(db, current_user.id)
    unlocked_slots = pet_slots_for_words(learned_words)
    active_pet = next((pet for pet in pets if pet.is_active), None)
    recovery_goal = current_user.pet_recovery_goal_words
    return PetCollectionResponse(
        pets=[build_pet_response(pet) for pet in pets],
        active_pet_id=active_pet.id if active_pet else None,
        learned_words=learned_words,
        unlocked_slots=unlocked_slots,
        used_slots=len(pets),
        max_slots=MAX_PET_SLOTS,
        words_per_slot=WORDS_PER_PET_SLOT,
        next_slot_words=next_pet_slot_threshold(learned_words),
        recovery_goal_words=recovery_goal,
        recovery_words_remaining=max(0, recovery_goal - learned_words) if recovery_goal else 0,
    )


@router.post("/pet/switch", response_model=PetResponse)
async def switch_pet(
    data: PetSwitchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """切换当前养成/出战伙伴，所有已拥有宠物保留各自培养进度。"""
    target = await db.get(UserPet, data.pet_id)
    if not target or target.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="没有找到这只宠物")
    if target.is_active:
        raise HTTPException(status_code=400, detail="这已经是你当前的伙伴")

    current = await get_active_pet(db, current_user.id)
    shared_food = current.food_balance if current else target.food_balance
    await db.execute(
        update(UserPet)
        .where(UserPet.user_id == current_user.id)
        .values(is_active=False, food_balance=shared_food)
    )
    target.is_active = True
    target.food_balance = shared_food
    target.last_interaction_at = datetime.utcnow()

    db.add(PetEventLog(
        pet_id=target.id,
        event_type="switch",
        detail=f"切换{get_pet_label(target.species)}「{target.name}」为当前伙伴，培养进度已保留",
    ))
    await db.commit()
    await db.refresh(target)
    return build_pet_response(target)


@router.post("/pet", response_model=PetResponse)
async def adopt_pet(
    data: PetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """领养新宠物；首只免费，此后按累计学习单词数解锁，最多 5 只。"""
    if data.species not in ALLOWED_PET_SPECIES:
        raise HTTPException(status_code=400, detail="暂不支持这种宠物")
    pet_name = data.name.strip()
    if not pet_name:
        raise HTTPException(status_code=400, detail="请给新伙伴取一个名字")

    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id).order_by(UserPet.id)
    )
    existing_pets = list(result.scalars().all())
    if any(pet.species == data.species for pet in existing_pets):
        raise HTTPException(status_code=400, detail="这个宝可梦家族已经领养过了")

    learned_words = await get_learned_word_count(db, current_user.id)
    recovery_goal = current_user.pet_recovery_goal_words
    if not existing_pets and recovery_goal and learned_words < recovery_goal:
        remaining = recovery_goal - learned_words
        raise HTTPException(
            status_code=400,
            detail=f"最后一只伙伴被收服后需再学习2000个不同单词，还差{remaining}个",
        )

    unlocked_slots = pet_slots_for_words(learned_words)
    if len(existing_pets) >= unlocked_slots:
        next_threshold = next_pet_slot_threshold(learned_words)
        if next_threshold is None:
            detail = "宠物队伍已满，最多可以拥有5只宝可梦"
        else:
            remaining = max(0, next_threshold - learned_words)
            detail = f"下一个领养名额需累计学习{next_threshold}个不同单词，还差{remaining}个"
        raise HTTPException(status_code=400, detail=detail)

    active_pet = next((pet for pet in existing_pets if pet.is_active), None)
    shared_food = active_pet.food_balance if active_pet else (
        existing_pets[0].food_balance if existing_pets
        else (current_user.pet_food_reserve if current_user.pet_food_reserve is not None else 10)
    )
    if existing_pets:
        await db.execute(
            update(UserPet)
            .where(UserPet.user_id == current_user.id)
            .values(is_active=False, food_balance=shared_food)
        )

    pet = UserPet(
        user_id=current_user.id,
        name=pet_name,
        species=data.species,
        current_hp=calculate_max_hp(1, 0),
        food_balance=shared_food,
        is_active=True,
    )
    db.add(pet)
    await db.flush()

    if not existing_pets and recovery_goal:
        current_user.pet_recovery_goal_words = None
        current_user.pet_food_reserve = None

    log = PetEventLog(
        pet_id=pet.id,
        event_type="adopt",
        detail=f"领养了{get_pet_label(data.species)}，取名「{pet_name}」，从伙伴蛋开始培养",
    )
    db.add(log)
    await db.commit()
    await db.refresh(pet)
    return build_pet_response(pet)


@router.post("/pet/feed", response_model=PetFeedResponse)
async def feed_pet(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """喂食当前伙伴：花费5粮，hunger+25, happiness+10, xp+8，每日上限3次。"""
    pet = await get_active_pet(db, current_user.id)
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    # 检查粮食余额
    if pet.food_balance < 5:
        raise HTTPException(status_code=400, detail="粮食不足，去练习赚粮食吧！")

    # 检查每日喂食上限（3次）
    now = datetime.utcnow()
    today_start, _ = local_today_utc_range()  # 北京今天起点(UTC),每日喂食上限按北京日重置
    feed_count_result = await db.execute(
        select(sa_func.count(PetEventLog.id)).where(
            PetEventLog.pet_id == pet.id,
            PetEventLog.event_type == "feed",
            PetEventLog.created_at >= today_start,
        )
    )
    today_feeds = feed_count_result.scalar() or 0
    if today_feeds >= 3:
        raise HTTPException(status_code=400, detail="今天已经喂了3次啦，明天再来吧！")

    pet = apply_decay(pet)

    # 扣除粮食，喂食属性变化
    pet.food_balance -= 5
    pet.hunger = min(100, pet.hunger + 25)
    pet.happiness = min(100, pet.happiness + 10)
    pet.experience += FEED_XP
    pet.last_fed_at = now
    pet.last_interaction_at = now
    await sync_food_balance(db, current_user.id, pet.food_balance, except_pet_id=pet.id)

    # 结算升级与进化（共享逻辑）
    leveled_up, evolved = apply_xp_and_level(pet)
    if evolved:
        db.add(PetEventLog(
            pet_id=pet.id,
            event_type="evolve",
            detail=f"进化为{get_pet_stage_name(pet.species, pet.evolution_stage)}！(Lv{pet.level})",
        ))

    db.add(PetEventLog(
        pet_id=pet.id,
        event_type="feed",
        detail=f"喂食 -5粮 +{FEED_XP}XP (Lv{pet.level})",
    ))

    await db.commit()
    await db.refresh(pet)

    return PetFeedResponse(
        message="喂食成功！" + (" 升级了！" if leveled_up else "") + (" 进化了！" if evolved else ""),
        pet=build_pet_response(pet),
        leveled_up=leveled_up,
        evolved=evolved,
        new_level=pet.level if leveled_up else None,
        new_stage=pet.evolution_stage if evolved else None,
    )


@router.post("/pet/earn-food", response_model=EarnFoodResponse)
async def earn_food(
    data: EarnFoodRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """完成练习后赚取宠物粮"""
    pet = await get_active_pet(db, current_user.id)
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    now = datetime.utcnow()
    today_start, _ = local_today_utc_range()  # 北京今天起点(UTC),每日喂食上限按北京日重置

    # 检查是否今日首练
    earn_count_result = await db.execute(
        select(sa_func.count(PetEventLog.id))
        .join(UserPet, UserPet.id == PetEventLog.pet_id)
        .where(
            UserPet.user_id == current_user.id,
            PetEventLog.event_type == "earn_food",
            PetEventLog.created_at >= today_start,
        )
    )
    is_first_today = (earn_count_result.scalar() or 0) == 0

    # 计算奖励
    base = 2
    accuracy = data.score / data.total
    accuracy_bonus = math.floor(accuracy * 6)
    mode_map = {"flashcard": 0, "quiz": 1, "fillblank": 2, "spelling": 2, "classify": 2}
    mode_bonus = mode_map.get(data.mode, 0)
    daily_bonus = 3 if is_first_today else 0

    food_earned = base + accuracy_bonus + mode_bonus + daily_bonus
    pet.food_balance += food_earned
    pet.last_interaction_at = now
    await sync_food_balance(db, current_user.id, pet.food_balance, except_pet_id=pet.id)

    db.add(PetEventLog(
        pet_id=pet.id,
        event_type="earn_food",
        detail=f"练习({data.mode})得{food_earned}粮 [基础{base}+正确率{accuracy_bonus}+模式{mode_bonus}+首练{daily_bonus}]",
    ))

    await db.commit()
    await db.refresh(pet)

    return EarnFoodResponse(
        food_earned=food_earned,
        food_balance=pet.food_balance,
        is_first_today=is_first_today,
        breakdown={
            "base": base,
            "accuracy_bonus": accuracy_bonus,
            "mode_bonus": mode_bonus,
            "daily_bonus": daily_bonus,
        },
    )


@router.get("/pet/events", response_model=list[PetEventResponse])
async def get_pet_events(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取宠物事件历史"""
    pet = await get_active_pet(db, current_user.id)
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    result = await db.execute(
        select(PetEventLog)
        .where(PetEventLog.pet_id == pet.id)
        .order_by(desc(PetEventLog.created_at))
        .limit(50)
    )
    events = result.scalars().all()
    return events


@router.get("/pet/leaderboard", response_model=PetLeaderboardResponse)
async def get_pet_leaderboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """宠物排行榜：按进化阶段、等级、经验排序，返回 top 50 + 当前用户排名"""
    # 查询所有宠物，JOIN users 表获取用户名
    stmt = (
        select(UserPet, User.username)
        .join(User, User.id == UserPet.user_id)
        .where(UserPet.is_active.is_(True))
        .order_by(
            desc(UserPet.evolution_stage),
            desc(UserPet.level),
            desc(UserPet.experience),
        )
    )
    result = await db.execute(stmt)
    rows = result.all()

    entries: list[PetLeaderboardEntry] = []
    my_rank: int | None = None

    for i, (pet, username) in enumerate(rows):
        rank = i + 1
        if rank <= 50:
            entries.append(PetLeaderboardEntry(
                rank=rank,
                username=username,
                pet_name=pet.name,
                species=pet.species,
                level=pet.level,
                evolution_stage=pet.evolution_stage,
                evolution_stage_name=get_pet_stage_name(pet.species, pet.evolution_stage),
            ))
        if pet.user_id == current_user.id:
            my_rank = rank

    return PetLeaderboardResponse(entries=entries, my_rank=my_rank)
