from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func as sa_func, update, Integer
from datetime import datetime, timedelta
import math
import re

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
    FEED_XP, EVOLUTION_THRESHOLDS, MAX_PET_SLOTS, WORDS_PER_PET_SLOT, MAX_LEGEND_SLOTS,
    calculate_max_hp, calc_xp_to_next_level, apply_xp_and_level,
    pet_slots_for_words, next_pet_slot_threshold,
    legend_slots_for_words, next_legend_slot_threshold,
)
from app.core.pet_species import (
    ALLOWED_PET_SPECIES, get_pet_label, get_pet_stage_name,
    SEMI_LEGEND_WORDS, LEGEND_WORDS, TIER_LABELS,
    get_pet_tier, is_legendary, words_required_for,
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


# 受伤后自己慢慢好(2026-10-20): 每过 1 小时恢复最大 HP 的这么多;到 80% 解除受伤(与答题治疗同一条线)。
# 从 0 血到 80% 约 16 小时 —— 隔天回来就好了,当天想马上出战就答题治疗(一题 10%)。
# 为什么要有: 生产 444 只在用的宠物里 237 只是受伤状态,其中 181 只的主人 30 天以上没碰过宠物 ——
# 孩子隔了很久回来,第一眼看到的是一只受伤、要先答一串题才能玩的宠物,很多就直接走了
NATURAL_HEAL_PER_HOUR = 0.05
INJURY_CURED_AT = 0.8


async def apply_natural_heal(db: AsyncSession, pet: UserPet) -> bool:
    """按受伤以来过了多久回血,够 80% 就解除受伤。返回这次有没有痊愈。

    「受伤以来」取最近一条 injured 日志的时间(存量受伤宠物都有这条);找不到就按 last_interaction_at。
    起点血量取那条日志里记的「当前HP: x/y」(对战受伤都这么写),读不出就当 0 —— 只会让恢复慢一点,不会错放。
    目标血量 = 起点 + 每小时 5% × 小时数,**和现在的血量取大**: 只抬不压(中间答题回过的血不会被拉回去),
    按时间算所以重复调用幂等。
    不碰 last_interaction_at: 那是「孩子来没来过」,自然回血不算孩子来过。
    """
    if not pet.is_injured:
        return False
    row = (await db.execute(
        select(PetEventLog.created_at, PetEventLog.detail)
        .where(PetEventLog.pet_id == pet.id, PetEventLog.event_type == "injured")
        .order_by(PetEventLog.id.desc()).limit(1)
    )).first()
    injured_at = row[0] if row else pet.last_interaction_at
    if injured_at is None:
        return False
    max_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
    start_hp = 0
    m = re.search(r"HP[:：]\s*(\d+)\s*/", (row[1] or "") if row else "")
    if m:
        start_hp = min(max_hp, int(m.group(1)))
    hours = max(0.0, (datetime.utcnow() - injured_at).total_seconds() / 3600)
    target = min(max_hp, start_hp + int(max_hp * NATURAL_HEAL_PER_HOUR * hours))
    if target > (pet.current_hp or 0):
        pet.current_hp = target
    if (pet.current_hp or 0) >= max_hp * INJURY_CURED_AT:
        pet.is_injured = False
        db.add(PetEventLog(pet_id=pet.id, event_type="healed", detail="休息好了，宠物自己恢复了健康！"))
        return True
    return False


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
    # 受伤的按时间自己回血(见 apply_natural_heal)
    await apply_natural_heal(db, pet)

    # ⚠️ 2026-10-20 去掉了「≥2 天不来且饱食度 ≤15 → 挨饿受伤、血压到 40%」:
    # 孩子越久没来,回来时宠物越惨、门槛越高 —— 生产受伤的宠物里 181 只主人 30 天以上没来过,
    # 这条是在把回来的孩子往外推。饿了照样会显示(饱食度条 + 喂食按钮),惩罚到这一步就够了;
    # 受伤现在只来自对战(孩子自己选的风险),而且会随时间自己好。别加回来

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
    legend_used = sum(1 for pet in pets if is_legendary(pet.species))
    return PetCollectionResponse(
        pets=[build_pet_response(pet) for pet in pets],
        active_pet_id=active_pet.id if active_pet else None,
        learned_words=learned_words,
        unlocked_slots=unlocked_slots,
        # 普通格只统计普通宝可梦,传说不占普通格
        used_slots=len(pets) - legend_used,
        max_slots=MAX_PET_SLOTS,
        words_per_slot=WORDS_PER_PET_SLOT,
        next_slot_words=next_pet_slot_threshold(learned_words),
        recovery_goal_words=recovery_goal,
        recovery_words_remaining=max(0, recovery_goal - learned_words) if recovery_goal else 0,
        legend_unlocked_slots=legend_slots_for_words(learned_words),
        legend_used_slots=legend_used,
        legend_max_slots=MAX_LEGEND_SLOTS,
        next_legend_slot_words=next_legend_slot_threshold(learned_words),
        semi_legend_words=SEMI_LEGEND_WORDS,
        legend_words=LEGEND_WORDS,
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

    # 传说与普通两套名额分开算:传说不挤占普通 5 格,普通也不能拿传说格。
    if is_legendary(data.species):
        required = words_required_for(data.species)
        if learned_words < required:
            tier_label = TIER_LABELS[get_pet_tier(data.species)]
            remaining = required - learned_words
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{get_pet_label(data.species)}是{tier_label}宝可梦，"
                    f"需累计学习{required}个不同单词才会现身，还差{remaining}个"
                ),
            )
        legend_used = sum(1 for pet in existing_pets if is_legendary(pet.species))
        if legend_used >= legend_slots_for_words(learned_words):
            next_threshold = next_legend_slot_threshold(learned_words)
            if next_threshold is None:
                detail = f"传说队伍已满，最多可以拥有{MAX_LEGEND_SLOTS}只传说宝可梦"
            else:
                remaining = max(0, next_threshold - learned_words)
                detail = f"下一个传说名额需累计学习{next_threshold}个不同单词，还差{remaining}个"
            raise HTTPException(status_code=400, detail=detail)
    else:
        normal_used = sum(1 for pet in existing_pets if not is_legendary(pet.species))
        unlocked_slots = pet_slots_for_words(learned_words)
        if normal_used >= unlocked_slots:
            next_threshold = next_pet_slot_threshold(learned_words)
            if next_threshold is None:
                detail = f"宠物队伍已满，最多可以拥有{MAX_PET_SLOTS}只普通宝可梦"
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
        current_hp=calculate_max_hp(1, 0, data.species),
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
        detail=(
            f"领养了{get_pet_label(data.species)}，取名「{pet_name}」，"
            f"从{get_pet_stage_name(data.species, 0)}开始培养"
        ),
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

    now = datetime.utcnow()
    today_start, _ = local_today_utc_range()  # 北京今天起点(UTC),每日喂食上限按北京日重置
    today_feeds_sq = (
        select(sa_func.count(PetEventLog.id)).where(
            PetEventLog.pet_id == pet.id,
            PetEventLog.event_type == "feed",
            PetEventLog.created_at >= today_start,
        ).scalar_subquery()
    )
    # 扣粮 + 加经验 + 每日 3 次上限放进**一条条件 UPDATE**(2026-10-06 防多开):
    # 旧写法先数今天喂了几次、再在 Python 里扣,几个标签页同时点能一起越过上限。
    # 喂食日志与这条 UPDATE 同事务写入,下一个请求的子查询就数得到它
    claimed = await db.execute(
        update(UserPet)
        .where(UserPet.id == pet.id, UserPet.food_balance >= 5, today_feeds_sq < 3)
        .values(food_balance=UserPet.food_balance - 5, experience=UserPet.experience + FEED_XP)
        .execution_options(synchronize_session=False)
    )
    if (claimed.rowcount or 0) == 0:
        await db.commit()
        await db.refresh(pet)
        if (pet.food_balance or 0) < 5:
            raise HTTPException(status_code=400, detail="粮食不足，去练习赚粮食吧！")
        raise HTTPException(status_code=400, detail="今天已经喂了3次啦，明天再来吧！")
    db.add(PetEventLog(pet_id=pet.id, event_type="feed", detail=f"喂食 -5粮 +{FEED_XP}XP"))
    await db.refresh(pet)

    pet = apply_decay(pet)

    # 喂食属性变化(粮食与经验已在上面那条 UPDATE 里原子扣加)
    pet.hunger = min(100, pet.hunger + 25)
    pet.happiness = min(100, pet.happiness + 10)
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

    # 计算奖励。⚠️ 正确率与「有没有真的练」**按服务端的答题记录算**(2026-10-20),不信前端报的 score/total:
    # 以前前端报多少就按多少给,改一行 JS 就能无限刷粮。粮食在只能喂食(一天 3 次)的时候刷了也没用,
    # 但给粮食加任何用途之前必须先堵上。口径: 上一次领粮之后(最多回看 2 小时)本人的 learning_records ——
    # 生产 10 月以来 1063 次领粮只有 8 次对不上记录,口径吻合。
    # 没有新的答题记录 → 0 粮(不是报错: 前端是练完顺手调的,失败了孩子也看不到原因)
    since = now - timedelta(hours=2)
    last_earn = (await db.execute(
        select(sa_func.max(PetEventLog.created_at))
        .join(UserPet, UserPet.id == PetEventLog.pet_id)
        .where(UserPet.user_id == current_user.id, PetEventLog.event_type == "earn_food")
    )).scalar()
    if last_earn and last_earn > since:
        since = last_earn
    answered, correct = (await db.execute(
        select(sa_func.count(LearningRecord.id),
               sa_func.coalesce(sa_func.sum(sa_func.cast(LearningRecord.is_correct, Integer)), 0))
        .where(LearningRecord.user_id == current_user.id, LearningRecord.created_at > since)
    )).one()
    answered, correct = int(answered or 0), int(correct or 0)
    if not answered and data.mode == "spelling":
        # 句子练习不写 learning_records,只更新 sentence_mastery.last_practiced_at。
        # 那里没有逐题对错的流水,算不出这一次的正确率 —— 只认「真练过」,正确率按 0 档给(基础+模式+首练)
        from app.models.sentence_learning import SentenceMastery
        practiced = (await db.execute(
            select(sa_func.count(SentenceMastery.id)).where(
                SentenceMastery.user_id == current_user.id,
                SentenceMastery.last_practiced_at > since,
            )
        )).scalar() or 0
        if practiced:
            answered, correct = int(practiced), 0

    base = 2
    accuracy = (correct / answered) if answered else 0.0
    accuracy_bonus = math.floor(accuracy * 6)
    mode_map = {"flashcard": 0, "quiz": 1, "fillblank": 2, "spelling": 2, "classify": 2}
    mode_bonus = mode_map.get(data.mode, 0)
    daily_bonus = 3 if is_first_today else 0

    food_earned = (base + accuracy_bonus + mode_bonus + daily_bonus) if answered else 0
    if not answered:
        # 没有新的答题记录: 不发粮,也不记领粮日志(否则会占掉今天的「首练」加成)
        await db.commit()
        return EarnFoodResponse(
            food_earned=0, food_balance=pet.food_balance, is_first_today=is_first_today,
            breakdown={"base": 0, "accuracy_bonus": 0, "mode_bonus": 0, "daily_bonus": 0},
        )
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
