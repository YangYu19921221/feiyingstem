# -*- coding: utf-8 -*-
"""AI对手生成服务"""
import random
from typing import Dict, Any
from app.core.pet_species import ALLOWED_PET_SPECIES

# AI对手名称池
AI_NAMES = [
    "AI训练师·小智",
    "AI训练师·小霞",
    "AI训练师·小刚",
    "AI训练师·小茂",
    "AI训练师·小蓝",
    "电脑精灵训练师",
    "虚拟对战助手",
    "智能陪练",
    "数码训练大师",
    "AI对战专家",
]

# AI宠物种类池（可以选择与玩家不同的）
AI_PET_SPECIES = sorted(ALLOWED_PET_SPECIES)


def generate_ai_opponent(player_level: int, player_pet_species: str) -> Dict[str, Any]:
    """
    生成AI对手配置

    Args:
        player_level: 玩家宠物等级
        player_pet_species: 玩家宠物种类

    Returns:
        AI对手配置字典
    """
    # AI等级：玩家等级 ±2
    ai_level = max(1, player_level + random.randint(-2, 2))

    # 随机选择AI宠物（避免与玩家相同，增加多样性）
    available_species = [s for s in AI_PET_SPECIES if s != player_pet_species]
    if not available_species:
        available_species = AI_PET_SPECIES
    ai_species = random.choice(available_species)

    # 根据玩家等级调整AI难度
    if player_level <= 5:
        # 新手：AI较弱
        ai_accuracy = 0.55
        ai_speed_min = 4000  # 4-9秒答题
        ai_speed_max = 9000
    elif player_level <= 10:
        # 初级：AI中等
        ai_accuracy = 0.65
        ai_speed_min = 3500
        ai_speed_max = 8000
    elif player_level <= 20:
        # 中级：AI较强
        ai_accuracy = 0.75
        ai_speed_min = 3000
        ai_speed_max = 7000
    else:
        # 高级：AI很强
        ai_accuracy = 0.85
        ai_speed_min = 2500
        ai_speed_max = 6000

    # 随机选择AI名称
    ai_name = random.choice(AI_NAMES)

    return {
        'name': ai_name,
        'level': ai_level,
        'species': ai_species,
        'accuracy': ai_accuracy,  # 答题正确率
        'speed_min_ms': ai_speed_min,  # 最快答题时间
        'speed_max_ms': ai_speed_max,  # 最慢答题时间
    }


def ai_should_answer_correctly(accuracy: float) -> bool:
    """
    根据AI正确率判断本题是否答对

    Args:
        accuracy: AI正确率 (0-1)

    Returns:
        是否答对
    """
    return random.random() < accuracy


def generate_ai_answer_time(speed_min_ms: int, speed_max_ms: int) -> int:
    """
    生成AI答题时间

    Args:
        speed_min_ms: 最快时间
        speed_max_ms: 最慢时间

    Returns:
        答题时间（毫秒）
    """
    # 使用正态分布，让答题时间更自然
    mean = (speed_min_ms + speed_max_ms) / 2
    std = (speed_max_ms - speed_min_ms) / 4

    time = random.gauss(mean, std)
    time = max(speed_min_ms, min(speed_max_ms, time))

    return int(time)


def generate_ai_wrong_answer(correct_answer: str, options: list) -> str:
    """
    生成AI的错误答案

    Args:
        correct_answer: 正确答案（A/B/C/D）
        options: 所有选项列表

    Returns:
        错误答案
    """
    # 从错误选项中随机选择
    wrong_options = [opt for opt in ['A', 'B', 'C', 'D'] if opt != correct_answer and opt in [o[0] for o in options]]

    if wrong_options:
        return random.choice(wrong_options)
    else:
        # 兜底：返回第一个选项
        return 'A'


def calculate_ai_ultimate_usage_chance(combo: int, ultimate_charges: int) -> bool:
    """
    判断AI是否使用必杀技

    Args:
        combo: 当前连击数
        ultimate_charges: 必杀技充能数

    Returns:
        是否使用必杀技
    """
    if ultimate_charges <= 0:
        return False

    # AI策略：连击数越高，越倾向于使用必杀技
    if combo >= 5:
        return random.random() < 0.8  # 80%概率使用
    elif combo >= 3:
        return random.random() < 0.5  # 50%概率使用
    else:
        return random.random() < 0.2  # 20%概率使用
