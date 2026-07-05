"""宠物对战系统 - 核心业务逻辑"""
import json
import random
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func

from app.models.pet_battle import PetBattle, PetBattleRound, PetBattleStats
from app.models.pet import UserPet, PetEventLog
from app.models.user import User
from app.models.word import Word, WordDefinition
# 统一数值真源；calculate_initial_hp 是 calculate_max_hp 的别名，保留名字兼容既有 import
from app.core.pet_formulas import (
    calculate_initial_hp, calculate_max_hp, STAGE_NAMES, apply_xp_and_level,
)


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
    base_ultimate = {
        "pikachu": 50,
        "bulbasaur": 40,
        "charmander": 45,
        "squirtle": 35,
        "eevee": 42,
        # 其他宠物默认
    }
    damage = base_ultimate.get(pet_species, 40)
    stage_bonus = pet_stage * 10
    return damage + stage_bonus


# ========== 题目生成 ==========

async def generate_battle_questions(
    db: AsyncSession,
    wordbook_id: Optional[int],
    count: int = 10,
) -> List[Dict]:
    """
    生成对战题目

    Args:
        db: 数据库会话
        wordbook_id: 单词本ID(为空则随机)
        count: 题目数量

    Returns:
        题目列表
    """
    # 查询单词
    if wordbook_id:
        # 从指定单词本抽取
        from app.models.word import BookWord
        stmt = (
            select(Word)
            .join(BookWord, BookWord.word_id == Word.id)
            .where(BookWord.book_id == wordbook_id)
            .order_by(func.random())
            .limit(count)
        )
    else:
        # 随机抽取
        stmt = select(Word).order_by(func.random()).limit(count)

    result = await db.execute(stmt)
    words = result.scalars().all()

    if len(words) < count:
        raise ValueError(f"单词不足,需要{count}个,只找到{len(words)}个")

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
    pet1_result = await db.execute(select(UserPet).where(UserPet.user_id == player1_id))
    pet1 = pet1_result.scalar_one_or_none()

    pet2_result = await db.execute(select(UserPet).where(UserPet.user_id == player2_id))
    pet2 = pet2_result.scalar_one_or_none()

    if not pet1 or not pet2:
        raise ValueError("双方必须都有宠物才能对战")

    # 计算初始HP
    hp1 = calculate_initial_hp(pet1.level, pet1.evolution_stage)
    hp2 = calculate_initial_hp(pet2.level, pet2.evolution_stage)

    # 生成题目
    questions = await generate_battle_questions(db, wordbook_id, max_rounds)

    # 创建对战记录
    battle = PetBattle(
        player1_id=player1_id,
        player2_id=player2_id,
        player1_pet_id=pet1.id,
        player2_pet_id=pet2.id,
        wordbook_id=wordbook_id,
        mode=mode,
        max_rounds=max_rounds,
        player1_initial_hp=hp1,
        player2_initial_hp=hp2,
        player1_hp=hp1,
        player2_hp=hp2,
        questions_data=json.dumps(questions),
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

    # 计算伤害
    if use_ultimate:
        # 使用必杀技
        if (is_player1 and battle.player1_ultimate_charges < 1) or \
           (not is_player1 and battle.player2_ultimate_charges < 1):
            raise ValueError("必杀技充能不足")

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
        round_obj.player1_used_ultimate = use_ultimate
    else:
        round_obj.player2_answer = answer
        round_obj.player2_correct = is_correct
        round_obj.player2_submit_time = datetime.utcnow()
        round_obj.player2_time_ms = time_ms
        round_obj.player2_damage = damage
        round_obj.player2_used_ultimate = use_ultimate

    # 更新连击
    if is_correct:
        if is_player1:
            battle.player1_combo += 1
            # 每3连击充能1次
            if battle.player1_combo % 3 == 0:
                battle.player1_ultimate_charges += 1
        else:
            battle.player2_combo += 1
            if battle.player2_combo % 3 == 0:
                battle.player2_ultimate_charges += 1
    else:
        if is_player1:
            battle.player1_combo = 0
        else:
            battle.player2_combo = 0

    await db.commit()
    await db.refresh(battle)
    await db.refresh(round_obj)

    return battle, round_obj


async def finalize_round(
    db: AsyncSession,
    battle_id: int,
    round_number: int,
) -> Tuple[PetBattle, PetBattleRound]:
    """
    结算回合结果(双方都答题后调用)
    """
    battle = await db.get(PetBattle, battle_id)
    round_result = await db.execute(
        select(PetBattleRound).where(
            and_(
                PetBattleRound.battle_id == battle_id,
                PetBattleRound.round_number == round_number,
            )
        )
    )
    round_obj = round_result.scalar_one()

    # 应用伤害
    if round_obj.player1_damage > 0:
        # 玩家1攻击玩家2
        battle.player2_hp = max(0, battle.player2_hp - round_obj.player1_damage)
        battle.player1_total_damage += round_obj.player1_damage
    elif round_obj.player1_damage < 0:
        # 玩家1答错,扣自己血
        battle.player1_hp = max(0, battle.player1_hp + round_obj.player1_damage)

    if round_obj.player2_damage > 0:
        battle.player1_hp = max(0, battle.player1_hp - round_obj.player2_damage)
        battle.player2_total_damage += round_obj.player2_damage
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
) -> Dict:
    """
    结束对战,结算奖励

    Returns:
        奖励数据
    """
    battle = await db.get(PetBattle, battle_id)
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
        final_hp = battle.player1_hp if is_player1 else battle.player2_hp

        # 基础奖励（经验较原值下调约一半，避免对战刷等级过快）
        if is_winner:
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

        # 更新宠物
        pet = await db.get(UserPet, battle.player1_pet_id if is_player1 else battle.player2_pet_id)

        # 发放奖励
        pet.food_balance += food
        pet.experience += xp

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
                detail=f"进化到{STAGE_NAMES.get(pet.evolution_stage, '未知')}阶段！(Lv{pet.level})",
            ))

        # 更新当前HP
        pet.current_hp = final_hp

        # 计算最大HP（升级后重新计算，阈值随等级变化）
        max_hp = calculate_max_hp(pet.level, pet.evolution_stage)

        # 如果HP < 50%，标记为受伤
        if pet.current_hp < max_hp * 0.5:
            pet.is_injured = True
            db.add(PetEventLog(
                pet_id=pet.id,
                event_type="injured",
                detail=f"对战后受伤，当前HP: {pet.current_hp}/{max_hp}"
            ))

        # 更新统计
        stats_result = await db.execute(
            select(PetBattleStats).where(PetBattleStats.user_id == player_id)
        )
        stats = stats_result.scalar_one_or_none()

        if not stats:
            stats = PetBattleStats(user_id=player_id)
            db.add(stats)

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

    await db.commit()

    return rewards
