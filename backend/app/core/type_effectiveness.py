# -*- coding: utf-8 -*-
"""
宝可梦属性克制系统
基于经典18属性体系
"""

from enum import Enum
from typing import Dict, List

class PokemonType(str, Enum):
    """宝可梦属性枚举"""
    NORMAL = "normal"      # 普通
    FIRE = "fire"          # 火
    WATER = "water"        # 水
    GRASS = "grass"        # 草
    ELECTRIC = "electric"  # 电
    ICE = "ice"            # 冰
    FIGHTING = "fighting"  # 格斗
    POISON = "poison"      # 毒
    GROUND = "ground"      # 地面
    FLYING = "flying"      # 飞行
    PSYCHIC = "psychic"    # 超能力
    BUG = "bug"            # 虫
    ROCK = "rock"          # 岩石
    GHOST = "ghost"        # 幽灵
    DRAGON = "dragon"      # 龙
    DARK = "dark"          # 恶
    STEEL = "steel"        # 钢
    FAIRY = "fairy"        # 妖精


# 属性中文名称
TYPE_NAMES_CN: Dict[str, str] = {
    "normal": "普通",
    "fire": "火",
    "water": "水",
    "grass": "草",
    "electric": "电",
    "ice": "冰",
    "fighting": "格斗",
    "poison": "毒",
    "ground": "地面",
    "flying": "飞行",
    "psychic": "超能力",
    "bug": "虫",
    "rock": "岩石",
    "ghost": "幽灵",
    "dragon": "龙",
    "dark": "恶",
    "steel": "钢",
    "fairy": "妖精",
}

# 属性emoji图标
TYPE_ICONS: Dict[str, str] = {
    "normal": "⚪",
    "fire": "🔥",
    "water": "💧",
    "grass": "🌱",
    "electric": "⚡",
    "ice": "❄️",
    "fighting": "🥊",
    "poison": "☠️",
    "ground": "🏔️",
    "flying": "🦅",
    "psychic": "🔮",
    "bug": "🐛",
    "rock": "🪨",
    "ghost": "👻",
    "dragon": "🐉",
    "dark": "🌑",
    "steel": "⚙️",
    "fairy": "🧚",
}


# 属性克制关系表
# 格式: 进攻属性 -> {克制的属性列表(2x), 被抵抗的属性列表(0.5x), 无效的属性列表(0x)}
TYPE_EFFECTIVENESS: Dict[str, Dict[str, List[str]]] = {
    "normal": {
        "super": [],
        "weak": ["rock", "steel"],
        "immune": ["ghost"],
    },
    "fire": {
        "super": ["grass", "ice", "bug", "steel"],
        "weak": ["fire", "water", "rock", "dragon"],
        "immune": [],
    },
    "water": {
        "super": ["fire", "ground", "rock"],
        "weak": ["water", "grass", "dragon"],
        "immune": [],
    },
    "grass": {
        "super": ["water", "ground", "rock"],
        "weak": ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"],
        "immune": [],
    },
    "electric": {
        "super": ["water", "flying"],
        "weak": ["electric", "grass", "dragon"],
        "immune": ["ground"],
    },
    "ice": {
        "super": ["grass", "ground", "flying", "dragon"],
        "weak": ["fire", "water", "ice", "steel"],
        "immune": [],
    },
    "fighting": {
        "super": ["normal", "ice", "rock", "dark", "steel"],
        "weak": ["poison", "flying", "psychic", "bug", "fairy"],
        "immune": ["ghost"],
    },
    "poison": {
        "super": ["grass", "fairy"],
        "weak": ["poison", "ground", "rock", "ghost"],
        "immune": ["steel"],
    },
    "ground": {
        "super": ["fire", "electric", "poison", "rock", "steel"],
        "weak": ["grass", "bug"],
        "immune": ["flying"],
    },
    "flying": {
        "super": ["grass", "fighting", "bug"],
        "weak": ["electric", "rock", "steel"],
        "immune": [],
    },
    "psychic": {
        "super": ["fighting", "poison"],
        "weak": ["psychic", "steel"],
        "immune": ["dark"],
    },
    "bug": {
        "super": ["grass", "psychic", "dark"],
        "weak": ["fire", "fighting", "poison", "flying", "ghost", "steel", "fairy"],
        "immune": [],
    },
    "rock": {
        "super": ["fire", "ice", "flying", "bug"],
        "weak": ["fighting", "ground", "steel"],
        "immune": [],
    },
    "ghost": {
        "super": ["psychic", "ghost"],
        "weak": ["dark"],
        "immune": ["normal"],
    },
    "dragon": {
        "super": ["dragon"],
        "weak": ["steel"],
        "immune": ["fairy"],
    },
    "dark": {
        "super": ["psychic", "ghost"],
        "weak": ["fighting", "dark", "fairy"],
        "immune": [],
    },
    "steel": {
        "super": ["ice", "rock", "fairy"],
        "weak": ["fire", "water", "electric", "steel"],
        "immune": [],
    },
    "fairy": {
        "super": ["fighting", "dragon", "dark"],
        "weak": ["fire", "poison", "steel"],
        "immune": [],
    },
}


def get_effectiveness(attacker_type: str, defender_type: str) -> float:
    """
    计算属性克制倍率

    Args:
        attacker_type: 进攻方属性
        defender_type: 防守方属性

    Returns:
        float: 伤害倍率 (0.0, 0.5, 1.0, 2.0)
    """
    if attacker_type not in TYPE_EFFECTIVENESS:
        return 1.0

    effectiveness = TYPE_EFFECTIVENESS[attacker_type]

    # 无效 (0倍)
    if defender_type in effectiveness["immune"]:
        return 0.0

    # 效果拔群 (2倍)
    if defender_type in effectiveness["super"]:
        return 2.0

    # 效果不好 (0.5倍)
    if defender_type in effectiveness["weak"]:
        return 0.5

    # 普通效果 (1倍)
    return 1.0


def get_effectiveness_text(multiplier: float) -> str:
    """获取效果描述文本"""
    if multiplier == 0.0:
        return "完全无效！"
    elif multiplier == 0.5:
        return "效果不好..."
    elif multiplier == 2.0:
        return "效果拔群！"
    else:
        return ""


def get_type_advantages(attacker_type: str) -> Dict[str, List[str]]:
    """
    获取某属性的优劣势

    Returns:
        {"super": [...], "weak": [...], "immune": [...]}
    """
    return TYPE_EFFECTIVENESS.get(attacker_type, {
        "super": [],
        "weak": [],
        "immune": []
    })


# 项目中现有宠物的属性配置
PET_TYPES: Dict[str, str] = {
    "pikachu": "electric",      # 皮卡丘 - 电系
    "raichu": "electric",        # 雷丘 - 电系
    "eevee": "normal",           # 伊布 - 普通系
    "bulbasaur": "grass",        # 妙蛙种子 - 草系
    "ivysaur": "grass",          # 妙蛙草 - 草系
    "venusaur": "grass",         # 妙蛙花 - 草系
    "charmander": "fire",        # 小火龙 - 火系
    "charmeleon": "fire",        # 火恐龙 - 火系
    "charizard": "fire",         # 喷火龙 - 火系
    "squirtle": "water",         # 杰尼龟 - 水系
    "wartortle": "water",        # 卡咪龟 - 水系
    "blastoise": "water",        # 水箭龟 - 水系
}


def get_pet_type(species: str) -> str:
    """获取宠物的属性"""
    return PET_TYPES.get(species.lower(), "normal")
