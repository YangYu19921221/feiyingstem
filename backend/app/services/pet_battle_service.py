"""宠物对战系统 - 核心业务逻辑"""
import json
import random
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, update

from app.models.pet_battle import PetBattle, PetBattleRound, PetBattleStats
from app.models.pet import UserPet, PetEventLog
from app.models.user import User
from app.models.learning import LearningRecord
from app.models.word import Word, WordDefinition
# 统一数值真源；calculate_initial_hp 是 calculate_max_hp 的别名，保留名字兼容既有 import
from app.core.pet_formulas import (
    MAX_PET_SLOTS, calculate_initial_hp, calculate_max_hp, apply_xp_and_level,
    pet_recovery_goal, pet_slots_for_words, next_pet_slot_threshold,
)
from app.core.pet_species import (
    get_pet_element,
    get_pet_stage_name,
    get_type_multiplier,
    get_type_text,
)


PET_CAPTURE_CHANCE = 0.20


def capture_roll_succeeds(roll: float) -> bool:
    """精灵球收服判定，单独保留为纯函数便于验证边界。"""
    return 0 <= roll < PET_CAPTURE_CHANCE


def next_combo_state(combo: int, charges: int, is_correct: bool) -> Tuple[int, int]:
    """计算答题后的连击与技能次数；每连续答对 3 题获得 1 次技能。"""
    if not is_correct:
        return 0, charges
    next_combo = combo + 1
    if next_combo % 3 == 0:
        charges += 1
    return next_combo, charges


def get_battle_pet_hp_data(battle: PetBattle) -> Dict[str, int]:
    """读取本场各宠物独立 HP；兼容尚未写入该字段的旧对战。"""
    if not battle.pet_hp_data:
        return {}
    try:
        data = json.loads(battle.pet_hp_data)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    hp_data = {}
    for pet_id, hp in data.items():
        if not str(pet_id).isdigit():
            continue
        try:
            hp_data[str(pet_id)] = max(0, int(hp))
        except (TypeError, ValueError):
            continue
    return hp_data


def get_pet_current_hp(pet: UserPet) -> int:
    """读取宠物自身 HP，并兼容旧记录中的空值或超出上限的数据。"""
    max_hp = calculate_max_hp(pet.level, pet.evolution_stage)
    current_hp = max_hp if pet.current_hp is None else pet.current_hp
    return min(max_hp, max(0, current_hp))


async def _learned_word_count(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(LearningRecord.user_id == user_id)
    )
    return int(result.scalar() or 0)


async def _settle_pet_capture(
    db: AsyncSession,
    battle: PetBattle,
    winner_id: Optional[int],
) -> Optional[dict]:
    """普通真人对战有 20% 概率收服败方出战宠物。"""
    if battle.is_ai_battle or winner_id is None:
        return None
    if winner_id not in (battle.player1_id, battle.player2_id):
        return None

    loser_id = battle.player2_id if winner_id == battle.player1_id else battle.player1_id
    loser_pet_id = battle.player2_pet_id if winner_id == battle.player1_id else battle.player1_pet_id
    loser_pet = await db.get(UserPet, loser_pet_id)
    if not loser_pet or loser_pet.user_id != loser_id:
        return None

    winner_result = await db.execute(
        select(UserPet).where(UserPet.user_id == winner_id).order_by(UserPet.id)
    )
    winner_pets = list(winner_result.scalars().all())
    learned_words = await _learned_word_count(db, winner_id)
    unlocked_slots = pet_slots_for_words(learned_words)
    result = {
        "eligible": False,
        "attempted": False,
        "success": False,
        "chance": int(PET_CAPTURE_CHANCE * 100),
        "winner_id": winner_id,
        "loser_id": loser_id,
        "pet_id": loser_pet.id,
        "pet_name": loser_pet.name,
        "pet_species": loser_pet.species,
        "loser_has_no_pets": False,
        "recovery_goal_words": None,
        "reason": "",
    }

    if len(winner_pets) >= MAX_PET_SLOTS:
        result["reason"] = "roster_full"
        return result
    if len(winner_pets) >= unlocked_slots:
        result["reason"] = "slot_locked"
        result["required_words"] = next_pet_slot_threshold(learned_words)
        return result
    if any(pet.species == loser_pet.species for pet in winner_pets):
        result["reason"] = "duplicate_species"
        return result

    result["eligible"] = True
    result["attempted"] = True
    battle.capture_attempted = True
    if not capture_roll_succeeds(random.random()):
        result["reason"] = "escaped"
        battle.capture_data = json.dumps(result, ensure_ascii=False)
        return result

    winner_active = next((pet for pet in winner_pets if pet.is_active), winner_pets[0])
    winner_food = winner_active.food_balance
    loser_food = loser_pet.food_balance
    remaining_result = await db.execute(
        select(UserPet)
        .where(UserPet.user_id == loser_id, UserPet.id != loser_pet.id)
        .order_by(UserPet.level.desc(), UserPet.id)
    )
    remaining_pets = list(remaining_result.scalars().all())

    loser_pet.is_active = False
    loser_pet.user_id = winner_id
    loser_pet.food_balance = winner_food
    db.add(PetEventLog(
        pet_id=loser_pet.id,
        event_type="captured",
        detail="在真人对战落败后被精灵球收服，培养等级与进化阶段已保留",
    ))

    loser_user = await db.get(User, loser_id)
    if remaining_pets:
        replacement = remaining_pets[0]
        replacement.is_active = True
        await db.execute(
            update(UserPet)
            .where(UserPet.user_id == loser_id, UserPet.id != loser_pet.id)
            .values(food_balance=loser_food)
        )
    elif loser_user:
        loser_learned_words = await _learned_word_count(db, loser_id)
        recovery_goal = pet_recovery_goal(loser_learned_words)
        loser_user.pet_food_reserve = loser_food
        loser_user.pet_recovery_goal_words = recovery_goal
        result["loser_has_no_pets"] = True
        result["recovery_goal_words"] = recovery_goal

    result["success"] = True
    result["reason"] = "captured"
    battle.capture_succeeded = True
    battle.captured_pet_id = loser_pet.id
    battle.capture_data = json.dumps(result, ensure_ascii=False)
    return result


def calculate_damage(
    attacker_level: int,
    attacker_stage: int,
    defender_level: int,
    defender_stage: int,
    is_correct: bool,
    combo: int,
    time_ms: int,
) -> int:
    """
    计算攻击伤害

    Args:
        attacker_level: 攻击方等级
        attacker_stage: 攻击方进化阶段
        defender_level: 防守方等级
        defender_stage: 防守方进化阶段
        is_correct: 是否答对
        combo: 当前连击数
        time_ms: 答题用时(毫秒)

    Returns:
        伤害值(答错返回负数,表示扣自己血)
    """
    if not is_correct:
        return -10  # 答错扣自己10HP

    # 基础伤害
    base_damage = 20

    # 等级差加成 (每高1级 +2伤害, 最多±10)
    level_diff = attacker_level - defender_level
    level_bonus = max(-10, min(10, level_diff * 2))

    # 进化阶段加成
    stage_bonus = attacker_stage * 8

    # 连击加成 (每连击1次 +5伤害)
    combo_bonus = combo * 5

    # 速度加成 (5秒内答对 +5, 3秒内 +10)
    speed_bonus = 0
    if time_ms < 3000:
        speed_bonus = 10
    elif time_ms < 5000:
        speed_bonus = 5

    total_damage = base_damage + level_bonus + stage_bonus + combo_bonus + speed_bonus

    return max(10, total_damage)  # 最低10伤害


def calculate_ultimate_damage(pet_species: str, pet_stage: int) -> int:
    """计算必杀技伤害"""
    base_ultimate_by_element = {
        "electric": 50,
        "fire": 45,
        "water": 38,
        "grass": 40,
        "dragon": 48,
        "fighting": 46,
        "rock": 45,
        "psychic": 44,
        "ghost": 44,
        "bug": 39,
        "fairy": 42,
        "normal": 42,
    }
    damage = base_ultimate_by_element.get(get_pet_element(pet_species), 40)
    stage_bonus = pet_stage * 10
    return damage + stage_bonus


# ========== 题目生成 ==========

async def _pick_battle_words(
    db: AsyncSession,
    wordbook_id: Optional[int],
    count: int,
    player_ids: Optional[List[int]] = None,
) -> List[Word]:
    """
    选取对战词池,优先级:
    1. 指定单词本 → 该书的词(走 units→unit_words;book_words 是空表,别用)
    2. 参战学生背过的词(LearningRecord 并集)——对战考自己学过的内容
    3. 兜底:全库随机(仅当学生一条学习记录都没有时)
    只选带释义的词,避免出题时被跳过导致题数缩水。
    """
    from app.models.word import Unit, UnitWord

    def _with_definition(stmt):
        return (
            stmt.join(WordDefinition, WordDefinition.word_id == Word.id)
            .group_by(Word.id)
            .order_by(func.random())
            .limit(count)
        )

    if wordbook_id:
        stmt = _with_definition(
            select(Word)
            .join(UnitWord, UnitWord.word_id == Word.id)
            .join(Unit, Unit.id == UnitWord.unit_id)
            .where(Unit.book_id == wordbook_id)
        )
        words = list((await db.execute(stmt)).scalars().all())
        if words:
            return words

    real_player_ids = [pid for pid in (player_ids or []) if pid and pid > 0]
    if real_player_ids:
        stmt = _with_definition(
            select(Word)
            .join(LearningRecord, LearningRecord.word_id == Word.id)
            .where(LearningRecord.user_id.in_(real_player_ids))
        )
        words = list((await db.execute(stmt)).scalars().all())
        if words:
            return words

    stmt = _with_definition(select(Word))
    return list((await db.execute(stmt)).scalars().all())


async def generate_battle_questions(
    db: AsyncSession,
    wordbook_id: Optional[int],
    count: int = 10,
    player_ids: Optional[List[int]] = None,
) -> List[Dict]:
    """
    生成对战题目

    Args:
        db: 数据库会话
        wordbook_id: 单词本ID(为空则从学生背过的词里抽)
        count: 题目数量
        player_ids: 参战玩家ID(AI 等负数ID自动忽略)

    Returns:
        题目列表
    """
    words = await _pick_battle_words(db, wordbook_id, count, player_ids)

    # 为每个单词生成选择题
    questions = []
    for word in words:
        # 获取单词的主要释义
        definition_result = await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == word.id)
            .order_by(WordDefinition.is_primary.desc())
            .limit(1)
        )
        main_def = definition_result.scalar_one_or_none()

        if not main_def:
            continue

        correct_meaning = main_def.meaning

        # 生成3个干扰项
        distractors_result = await db.execute(
            select(WordDefinition.meaning)
            .where(
                and_(
                    WordDefinition.word_id != word.id,
                    WordDefinition.meaning != correct_meaning,
                )
            )
            .order_by(func.random())
            .limit(3)
        )
        distractors = [row[0] for row in distractors_result.all()]

        if len(distractors) < 3:
            # 如果干扰项不足,补充通用选项
            fallback = ["高兴的", "悲伤的", "愤怒的", "害怕的", "惊讶的"]
            distractors.extend([f for f in fallback if f not in distractors and f != correct_meaning])
            distractors = distractors[:3]

        # 构建选项(随机排列)
        all_options = [correct_meaning] + distractors
        random.shuffle(all_options)
        correct_index = all_options.index(correct_meaning)
        correct_answer = chr(65 + correct_index)  # A/B/C/D

        options_formatted = [f"{chr(65+i)}. {opt}" for i, opt in enumerate(all_options)]

        questions.append({
            "word_id": word.id,
            "word": word.word,
            "question_text": f"单词 '{word.word}' 的意思是?",
            "options": options_formatted,
            "correct_answer": correct_answer,
        })

    if not questions:
        raise ValueError("没有可用的单词出题,先去学几个单词再来对战吧")

    # 词池不够时随机重复补足(同 PK 的 fill_with_repeats 策略),
    # 保证题目数 == 回合数,否则回合数越界会让整场对战中途崩掉。
    originals = list(questions)
    while len(questions) < count:
        questions.append(random.choice(originals))

    return questions


# ========== 对战逻辑 ==========

async def create_battle(
    db: AsyncSession,
    player1_id: int,
    player2_id: int,
    wordbook_id: Optional[int] = None,
    mode: str = "casual",
    max_rounds: int = 10,
) -> PetBattle:
    """创建对战"""
    # 检查双方宠物
    pet1_result = await db.execute(select(UserPet).where(
        UserPet.user_id == player1_id,
        UserPet.is_active.is_(True),
    ))
    pet1 = pet1_result.scalar_one_or_none()

    pet2_result = await db.execute(select(UserPet).where(
        UserPet.user_id == player2_id,
        UserPet.is_active.is_(True),
    ))
    pet2 = pet2_result.scalar_one_or_none()

    if not pet1 or not pet2:
        raise ValueError("双方必须都有宠物才能对战")

    # 每只宠物从自己的当前 HP 进入本场战斗。
    max_hp1 = calculate_initial_hp(pet1.level, pet1.evolution_stage)
    max_hp2 = calculate_initial_hp(pet2.level, pet2.evolution_stage)
    hp1 = get_pet_current_hp(pet1)
    hp2 = get_pet_current_hp(pet2)
    if hp1 <= 0 or hp2 <= 0:
        raise ValueError("双方宠物都需要有剩余生命值才能对战")

    # 生成题目(从参战学生背过的词里抽)
    questions = await generate_battle_questions(
        db, wordbook_id, max_rounds, player_ids=[player1_id, player2_id]
    )

    # 创建对战记录
    battle = PetBattle(
        player1_id=player1_id,
        player2_id=player2_id,
        player1_pet_id=pet1.id,
        player2_pet_id=pet2.id,
        wordbook_id=wordbook_id,
        mode=mode,
        max_rounds=max_rounds,
        player1_initial_hp=max_hp1,
        player2_initial_hp=max_hp2,
        player1_hp=hp1,
        player2_hp=hp2,
        questions_data=json.dumps(questions),
        pet_hp_data=json.dumps({str(pet1.id): hp1, str(pet2.id): hp2}),
        expires_at=datetime.utcnow() + timedelta(seconds=60),  # 60秒后过期
    )

    db.add(battle)
    await db.commit()
    await db.refresh(battle)

    return battle


async def accept_battle(db: AsyncSession, battle_id: int) -> PetBattle:
    """接受对战邀请"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise ValueError("对战不存在")

    if battle.status != "pending":
        raise ValueError(f"对战状态错误: {battle.status}")

    if battle.expires_at and datetime.utcnow() > battle.expires_at:
        battle.status = "cancelled"
        await db.commit()
        raise ValueError("对战邀请已过期")

    battle.status = "active"
    battle.started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(battle)

    return battle


async def process_round_answer(
    db: AsyncSession,
    battle_id: int,
    player_id: int,
    round_number: int,
    answer: str,
    time_ms: int,
    use_ultimate: bool = False,
) -> Tuple[PetBattle, PetBattleRound]:
    """
    处理回合答题

    Returns:
        (battle, round)
    """
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise ValueError("对战不存在")

    if battle.status != "active":
        raise ValueError("对战未进行中")
    if player_id not in (battle.player1_id, battle.player2_id):
        raise ValueError("无权参与此对战")

    # 获取或创建回合记录
    round_result = await db.execute(
        select(PetBattleRound).where(
            and_(
                PetBattleRound.battle_id == battle_id,
                PetBattleRound.round_number == round_number,
            )
        )
    )
    round_obj = round_result.scalar_one_or_none()

    # 获取题目数据
    questions = json.loads(battle.questions_data)
    if round_number > len(questions):
        raise ValueError("回合数超出范围")

    question = questions[round_number - 1]

    # 如果回合记录不存在,创建
    if not round_obj:
        round_obj = PetBattleRound(
            battle_id=battle_id,
            round_number=round_number,
            question_word_id=question["word_id"],
            question_text=question["question_text"],
            options=json.dumps(question["options"]),
            correct_answer=question["correct_answer"],
        )
        db.add(round_obj)
        await db.flush()

    # 判断是哪个玩家
    is_player1 = player_id == battle.player1_id

    # 检查是否已答题
    if is_player1 and round_obj.player1_answer:
        raise ValueError("已经答过题了")
    if not is_player1 and round_obj.player2_answer:
        raise ValueError("已经答过题了")

    # 判断正误
    is_correct = answer.upper() == question["correct_answer"]

    # 获取宠物信息
    if is_player1:
        attacker_pet = await db.get(UserPet, battle.player1_pet_id)
        defender_pet = await db.get(UserPet, battle.player2_pet_id)
        combo = battle.player1_combo
    else:
        attacker_pet = await db.get(UserPet, battle.player2_pet_id)
        defender_pet = await db.get(UserPet, battle.player1_pet_id)
        combo = battle.player2_combo

    available_charges = (
        battle.player1_ultimate_charges if is_player1
        else battle.player2_ultimate_charges
    )
    actual_used_ultimate = use_ultimate and is_correct and available_charges > 0

    # 技能只在答案正确且已有充能时释放；答错仍按普通答错结算且不消耗技能。
    if actual_used_ultimate:
        damage = calculate_ultimate_damage(attacker_pet.species, attacker_pet.evolution_stage)

        # 消耗充能
        if is_player1:
            battle.player1_ultimate_charges -= 1
        else:
            battle.player2_ultimate_charges -= 1
    else:
        # 普通攻击
        damage = calculate_damage(
            attacker_pet.level,
            attacker_pet.evolution_stage,
            defender_pet.level,
            defender_pet.evolution_stage,
            is_correct,
            combo,
            time_ms,
        )

    # 记录答题
    if is_player1:
        round_obj.player1_answer = answer
        round_obj.player1_correct = is_correct
        round_obj.player1_submit_time = datetime.utcnow()
        round_obj.player1_time_ms = time_ms
        round_obj.player1_damage = damage
        round_obj.player1_used_ultimate = actual_used_ultimate
    else:
        round_obj.player2_answer = answer
        round_obj.player2_correct = is_correct
        round_obj.player2_submit_time = datetime.utcnow()
        round_obj.player2_time_ms = time_ms
        round_obj.player2_damage = damage
        round_obj.player2_used_ultimate = actual_used_ultimate

    # 更新连击
    if is_player1:
        battle.player1_combo, battle.player1_ultimate_charges = next_combo_state(
            battle.player1_combo,
            battle.player1_ultimate_charges,
            is_correct,
        )
    else:
        battle.player2_combo, battle.player2_ultimate_charges = next_combo_state(
            battle.player2_combo,
            battle.player2_ultimate_charges,
            is_correct,
        )

    await db.commit()
    await db.refresh(battle)
    await db.refresh(round_obj)

    return battle, round_obj


async def switch_battle_pet(
    db: AsyncSession,
    battle_id: int,
    player_id: int,
    pet_id: int,
) -> PetBattle:
    """在回合结算窗口切换宠物；每只宠物保留自己的本场 HP。"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise ValueError("对战不存在")
    await db.refresh(battle)
    if battle.status != "active":
        raise ValueError("对战未进行中")
    if player_id not in (battle.player1_id, battle.player2_id):
        raise ValueError("无权切换此对战的宠物")

    is_player1 = player_id == battle.player1_id
    current_pet_id = battle.player1_pet_id if is_player1 else battle.player2_pet_id
    if pet_id == current_pet_id:
        raise ValueError("这只宠物已经在场上")

    current_pet = await db.get(UserPet, current_pet_id)
    target_pet = await db.get(UserPet, pet_id)
    if not target_pet or target_pet.user_id != player_id:
        raise ValueError("宠物不存在或不属于你")

    old_hp = battle.player1_hp if is_player1 else battle.player2_hp
    if old_hp <= 0:
        raise ValueError("宠物失去战斗能力后不能切换")

    hp_data = get_battle_pet_hp_data(battle)
    hp_data[str(current_pet_id)] = old_hp
    new_max_hp = calculate_max_hp(target_pet.level, target_pet.evolution_stage)
    new_hp = min(
        new_max_hp,
        hp_data.get(str(target_pet.id), get_pet_current_hp(target_pet)),
    )
    if target_pet.is_injured or new_hp <= 0:
        raise ValueError("受伤的宠物暂时不能出战")
    hp_data[str(target_pet.id)] = new_hp
    battle.pet_hp_data = json.dumps(hp_data, ensure_ascii=False)

    # 及时保存离场宠物的真实血量，断线或中途结束也不会丢失伤害。
    if current_pet:
        current_pet.current_hp = min(
            calculate_max_hp(current_pet.level, current_pet.evolution_stage),
            old_hp,
        )
    if is_player1:
        battle.player1_pet_id = target_pet.id
        battle.player1_initial_hp = new_max_hp
        battle.player1_hp = new_hp
    else:
        battle.player2_pet_id = target_pet.id
        battle.player2_initial_hp = new_max_hp
        battle.player2_hp = new_hp

    await db.commit()
    await db.refresh(battle)
    return battle


async def finalize_round(
    db: AsyncSession,
    battle_id: int,
    round_number: int,
) -> Tuple[PetBattle, PetBattleRound]:
    """
    结算回合结果(双方都答题后调用)
    """
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise ValueError("对战不存在")
    # 已结束/被判负的对战禁止再结算——防止断线重连的僵尸回合循环
    # 在血量归零后继续扣血、继续推进回合(此前"没血了游戏还在继续"的根因之一)
    if battle.status != "active":
        raise ValueError("对战未进行中")
    round_result = await db.execute(
        select(PetBattleRound).where(
            and_(
                PetBattleRound.battle_id == battle_id,
                PetBattleRound.round_number == round_number,
            )
        )
    )
    round_obj = round_result.scalar_one()

    # 属性克制倍率(与前端克制表一致),只作用于攻击伤害,答错的自损不受影响
    pet1 = await db.get(UserPet, battle.player1_pet_id)
    pet2 = await db.get(UserPet, battle.player2_pet_id)

    # 应用伤害
    if round_obj.player1_damage > 0:
        # 玩家1攻击玩家2
        mult = get_type_multiplier(pet1.species, pet2.species) if pet1 and pet2 else 1.0
        dealt = max(1, int(round_obj.player1_damage * mult))
        round_obj.player1_damage = dealt
        round_obj.player1_type_multiplier = mult
        round_obj.player1_type_text = get_type_text(mult) or None
        battle.player2_hp = max(0, battle.player2_hp - dealt)
        battle.player1_total_damage += dealt
    elif round_obj.player1_damage < 0:
        # 玩家1答错,扣自己血
        battle.player1_hp = max(0, battle.player1_hp + round_obj.player1_damage)

    if round_obj.player2_damage > 0:
        mult = get_type_multiplier(pet2.species, pet1.species) if pet1 and pet2 else 1.0
        dealt = max(1, int(round_obj.player2_damage * mult))
        round_obj.player2_damage = dealt
        round_obj.player2_type_multiplier = mult
        round_obj.player2_type_text = get_type_text(mult) or None
        battle.player1_hp = max(0, battle.player1_hp - dealt)
        battle.player2_total_damage += dealt
    elif round_obj.player2_damage < 0:
        battle.player2_hp = max(0, battle.player2_hp + round_obj.player2_damage)

    # 更新统计
    if round_obj.player1_correct:
        battle.player1_total_correct += 1
    if round_obj.player2_correct:
        battle.player2_total_correct += 1

    # 记录回合后HP
    round_obj.player1_hp_after = battle.player1_hp
    round_obj.player2_hp_after = battle.player2_hp
    hp_data = get_battle_pet_hp_data(battle)
    hp_data[str(battle.player1_pet_id)] = battle.player1_hp
    hp_data[str(battle.player2_pet_id)] = battle.player2_hp
    battle.pet_hp_data = json.dumps(hp_data, ensure_ascii=False)

    # 更新当前回合
    battle.current_round = round_number

    await db.commit()
    await db.refresh(battle)
    await db.refresh(round_obj)

    return battle, round_obj


async def check_battle_end(battle: PetBattle) -> Optional[int]:
    """
    检查对战是否结束

    Returns:
        winner_id 或 None(未结束)
    """
    # HP归零
    if battle.player1_hp <= 0 and battle.player2_hp <= 0:
        # 平局,正确率高的获胜
        if battle.player1_total_correct > battle.player2_total_correct:
            return battle.player1_id
        elif battle.player2_total_correct > battle.player1_total_correct:
            return battle.player2_id
        else:
            return None  # 真·平局
    elif battle.player1_hp <= 0:
        return battle.player2_id
    elif battle.player2_hp <= 0:
        return battle.player1_id

    # 回合数用尽
    if battle.current_round >= battle.max_rounds:
        if battle.player1_hp > battle.player2_hp:
            return battle.player1_id
        elif battle.player2_hp > battle.player1_hp:
            return battle.player2_id
        else:
            # HP相同,看正确率
            if battle.player1_total_correct > battle.player2_total_correct:
                return battle.player1_id
            elif battle.player2_total_correct > battle.player1_total_correct:
                return battle.player2_id
            else:
                return None  # 平局

    return None


async def finish_battle(
    db: AsyncSession,
    battle_id: int,
    winner_id: Optional[int],
    forfeiter_id: Optional[int] = None,
) -> Dict:
    """
    结束对战,结算奖励

    Args:
        forfeiter_id: 逃跑判负的玩家,奖励归零

    Returns:
        奖励数据
    """
    battle = await db.get(PetBattle, battle_id)
    await db.refresh(battle)
    if battle.status == "finished":
        capture = json.loads(battle.capture_data) if battle.capture_data else None
        return {"_capture": capture}

    battle.status = "finished"
    battle.winner_id = winner_id
    battle.finished_at = datetime.utcnow()

    # 计算奖励
    rewards = {}

    for player_id in [battle.player1_id, battle.player2_id]:
        is_winner = (player_id == winner_id) if winner_id else None
        is_draw = winner_id is None

        is_player1 = player_id == battle.player1_id
        correct_count = battle.player1_total_correct if is_player1 else battle.player2_total_correct
        combo_max = battle.player1_combo if is_player1 else battle.player2_combo
        # 基础奖励（经验较原值下调约一半，避免对战刷等级过快）
        if player_id == forfeiter_id:
            # 逃跑判负:什么都拿不到
            food = 0
            xp = 0
        elif is_winner:
            food = 15 + correct_count * 2
            xp = 50 + combo_max * 5
        elif is_draw:
            food = 12 + correct_count * 1
            xp = 30
        else:
            food = 8 + correct_count * 1
            xp = 25

        rewards[player_id] = {
            "food": food,
            "xp": xp,
            "rating_change": 0,  # 排位赛才有
        }

        # AI 训练师(负数ID)不发经验、不升级、不记统计,避免共享AI宠物越打越强
        if player_id <= 0:
            continue

        # 更新宠物
        pet = await db.get(UserPet, battle.player1_pet_id if is_player1 else battle.player2_pet_id)

        # 发放奖励
        pet.food_balance += food
        pet.experience += xp
        await db.execute(
            update(UserPet)
            .where(UserPet.user_id == player_id, UserPet.id != pet.id)
            .values(food_balance=pet.food_balance)
        )

        # 对战后立即结算升级+进化（此前只加经验不结算，会攒到下次喂食才一次性连跳多级）
        leveled_up, evolved = apply_xp_and_level(pet)
        if leveled_up:
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="level_up",
                detail=f"对战后升级到 Lv{pet.level}！",
            ))
        if evolved:
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="evolve",
                detail=f"进化为{get_pet_stage_name(pet.species, pet.evolution_stage)}！(Lv{pet.level})",
            ))

        # 更新统计
        stats_result = await db.execute(
            select(PetBattleStats).where(PetBattleStats.user_id == player_id)
        )
        stats = stats_result.scalar_one_or_none()

        if not stats:
            stats = PetBattleStats(user_id=player_id)
            db.add(stats)
            # 必须先 flush 让列默认值落到属性上,否则新玩家首战 total_battles 是 None,+=1 直接 500
            await db.flush()

        stats.total_battles += 1

        if is_winner:
            stats.wins += 1
            stats.current_win_streak += 1
            stats.current_lose_streak = 0
            stats.max_win_streak = max(stats.max_win_streak, stats.current_win_streak)
        elif is_draw:
            stats.draws += 1
            stats.current_win_streak = 0
            stats.current_lose_streak = 0
        else:
            stats.losses += 1
            stats.current_lose_streak += 1
            stats.current_win_streak = 0

        if is_player1:
            stats.total_damage_dealt += battle.player1_total_damage
            stats.total_damage_taken += battle.player2_total_damage
            stats.total_correct_answers += battle.player1_total_correct
        else:
            stats.total_damage_dealt += battle.player2_total_damage
            stats.total_damage_taken += battle.player1_total_damage
            stats.total_correct_answers += battle.player2_total_correct

        stats.updated_at = datetime.utcnow()

    # 分别结算所有实际上过场的宠物，切换不会覆盖彼此的血量。
    hp_data = get_battle_pet_hp_data(battle)
    hp_data[str(battle.player1_pet_id)] = battle.player1_hp
    hp_data[str(battle.player2_pet_id)] = battle.player2_hp
    if hp_data:
        pet_ids = [int(pet_id) for pet_id in hp_data]
        fought_result = await db.execute(select(UserPet).where(UserPet.id.in_(pet_ids)))
        # AI 训练师的宠物不落血量/受伤标记,它每次匹配都会重置
        battle_player_ids = {pid for pid in (battle.player1_id, battle.player2_id) if pid > 0}
        for fought_pet in fought_result.scalars().all():
            if fought_pet.user_id not in battle_player_ids:
                continue
            max_hp = calculate_max_hp(fought_pet.level, fought_pet.evolution_stage)
            fought_pet.current_hp = min(max_hp, hp_data[str(fought_pet.id)])
            if fought_pet.current_hp < max_hp * 0.5 and not fought_pet.is_injured:
                fought_pet.is_injured = True
                db.add(PetEventLog(
                    pet_id=fought_pet.id,
                    event_type="injured",
                    detail=f"对战后受伤，当前HP: {fought_pet.current_hp}/{max_hp}",
                ))

    capture = await _settle_pet_capture(db, battle, winner_id)
    rewards["_capture"] = capture

    await db.commit()

    return rewards


async def forfeit_battle(
    db: AsyncSession,
    battle_id: int,
    quitter_id: int,
) -> Optional[Dict]:
    """逃跑判负:对手判胜,逃跑方奖励归零、出战宠物本场血量清零(战后需治疗)。"""
    battle = await db.get(PetBattle, battle_id)
    if not battle or battle.status != "active":
        return None
    if quitter_id not in (battle.player1_id, battle.player2_id):
        return None

    winner_id = battle.player2_id if quitter_id == battle.player1_id else battle.player1_id
    if quitter_id == battle.player1_id:
        battle.player1_hp = 0
    else:
        battle.player2_hp = 0
    await db.commit()

    rewards = await finish_battle(db, battle_id, winner_id, forfeiter_id=quitter_id)
    return {"winner_id": winner_id, "rewards": rewards.get(winner_id)}
