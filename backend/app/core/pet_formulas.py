"""宠物养成/对战/治疗 的共享数值公式与升级结算逻辑。

此前 calculate_max_hp / 升级公式 / 进化阈值 散落在 pet.py、pet_healing.py、
pet_battle_service.py 三处重复定义，改数值容易漏改。统一收敛到本模块作为唯一真源。
"""

# 每次喂食获得的经验（放慢升级速度：原为15，现为8）
FEED_XP = 8

# 进化阈值: 蛋(Lv1) → 基础形态(Lv5) → 一阶进化(Lv15) → 最终进化(Lv30)
EVOLUTION_THRESHOLDS = {0: 5, 1: 15, 2: 30}
STAGE_NAMES = {0: "蛋", 1: "基础形态", 2: "一阶进化", 3: "最终进化"}


def calculate_max_hp(level: int, evolution_stage: int) -> int:
    """计算宠物最大HP = 100 + 等级×5 + 进化阶段×20"""
    return 100 + level * 5 + evolution_stage * 20


# 对战里叫「初始HP」，与最大HP同一公式，保留别名以兼容既有 import
calculate_initial_hp = calculate_max_hp


def calc_xp_to_next_level(level: int) -> int:
    """每级所需 XP = 80 + 等级×40，越高级越难升"""
    return 80 + level * 40


def apply_xp_and_level(pet) -> tuple[bool, bool]:
    """结算升级与进化。调用前请先 pet.experience += 本次获得经验。

    返回 (leveled_up, evolved)。支持一次加大量经验时连跳多级、跨多个进化阶段。
    只负责变更 pet 的 level/experience/evolution_stage 字段，事件日志由调用方按需写入。
    """
    leveled_up = False
    evolved = False

    xp_needed = calc_xp_to_next_level(pet.level)
    while pet.experience >= xp_needed:
        pet.experience -= xp_needed
        pet.level += 1
        leveled_up = True
        xp_needed = calc_xp_to_next_level(pet.level)

    # 可能一次跨多个进化阶段，用 while
    while (
        pet.evolution_stage in EVOLUTION_THRESHOLDS
        and pet.level >= EVOLUTION_THRESHOLDS[pet.evolution_stage]
    ):
        pet.evolution_stage += 1
        evolved = True

    return leveled_up, evolved
