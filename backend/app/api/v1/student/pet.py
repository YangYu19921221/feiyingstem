from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func as sa_func
from datetime import datetime, timedelta
import math

from app.core.database import get_db
from app.models.user import User
from app.models.pet import UserPet, PetEventLog
from app.schemas.pet import (
    PetCreate, PetResponse, PetFeedResponse, PetEventResponse,
    EarnFoodRequest, EarnFoodResponse,
    PetLeaderboardEntry, PetLeaderboardResponse,
)
from app.api.v1.auth import get_current_student

router = APIRouter()

# 进化阈值: egg(Lv1) → 基础形态(Lv5) → 一阶进化(Lv15) → 最终进化(Lv30)
EVOLUTION_THRESHOLDS = {0: 5, 1: 15, 2: 30}
STAGE_NAMES = {0: "蛋", 1: "基础形态", 2: "一阶进化", 3: "最终进化"}


def calc_xp_to_next_level(level: int) -> int:
    """每级所需 XP = 80 + level × 40，越高级越难升"""
    return 80 + level * 40


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
        evolution_stage_name=STAGE_NAMES.get(pet.evolution_stage, "未知"),
        food_balance=pet.food_balance,
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
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    pet = result.scalar_one_or_none()
    if not pet:
        return None
    pet = apply_decay(pet)
    await db.commit()
    return build_pet_response(pet)


@router.post("/pet", response_model=PetResponse)
async def adopt_pet(
    data: PetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """领养宠物（每人限一只）"""
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="你已经有一只宠物了！")

    pet = UserPet(
        user_id=current_user.id,
        name=data.name,
        species=data.species,
    )
    db.add(pet)
    await db.flush()

    log = PetEventLog(
        pet_id=pet.id,
        event_type="adopt",
        detail=f"领养了一只{data.species}，取名「{data.name}」",
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
    """喂食宠物：花费5粮，hunger+25, happiness+10, xp+15，每日上限3次"""
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    pet = result.scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    # 检查粮食余额
    if pet.food_balance < 5:
        raise HTTPException(status_code=400, detail="粮食不足，去练习赚粮食吧！")

    # 检查每日喂食上限（3次）
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
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
    pet.experience += 15
    pet.last_fed_at = now
    pet.last_interaction_at = now

    leveled_up = False
    evolved = False

    # 检查升级
    xp_needed = calc_xp_to_next_level(pet.level)
    while pet.experience >= xp_needed:
        pet.experience -= xp_needed
        pet.level += 1
        leveled_up = True
        xp_needed = calc_xp_to_next_level(pet.level)

    # 检查进化
    if pet.evolution_stage in EVOLUTION_THRESHOLDS:
        threshold = EVOLUTION_THRESHOLDS[pet.evolution_stage]
        if pet.level >= threshold:
            pet.evolution_stage += 1
            evolved = True
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="evolve",
                detail=f"进化到{STAGE_NAMES.get(pet.evolution_stage, '未知')}阶段！(Lv{pet.level})",
            ))

    db.add(PetEventLog(
        pet_id=pet.id,
        event_type="feed",
        detail=f"喂食 -5粮 +15XP (Lv{pet.level})",
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
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    pet = result.scalar_one_or_none()
    if not pet:
        raise HTTPException(status_code=404, detail="还没有宠物")

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # 检查是否今日首练
    earn_count_result = await db.execute(
        select(sa_func.count(PetEventLog.id)).where(
            PetEventLog.pet_id == pet.id,
            PetEventLog.event_type == "earn_food",
            PetEventLog.created_at >= today_start,
        )
    )
    is_first_today = (earn_count_result.scalar() or 0) == 0

    # 计算奖励
    base = 2
    accuracy = data.score / data.total
    accuracy_bonus = math.floor(accuracy * 6)
    mode_map = {"flashcard": 0, "quiz": 1, "fillblank": 2, "spelling": 2}
    mode_bonus = mode_map.get(data.mode, 0)
    daily_bonus = 3 if is_first_today else 0

    food_earned = base + accuracy_bonus + mode_bonus + daily_bonus
    pet.food_balance += food_earned
    pet.last_interaction_at = now

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
    result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    pet = result.scalar_one_or_none()
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
                evolution_stage_name=STAGE_NAMES.get(pet.evolution_stage, "未知"),
            ))
        if pet.user_id == current_user.id:
            my_rank = rank

    return PetLeaderboardResponse(entries=entries, my_rank=my_rank)
