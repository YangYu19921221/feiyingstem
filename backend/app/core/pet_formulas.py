"""宠物养成/对战/治疗 的共享数值公式与升级结算逻辑。

此前 calculate_max_hp / 升级公式 / 进化阈值 散落在 pet.py、pet_healing.py、
pet_battle_service.py 三处重复定义，改数值容易漏改。统一收敛到本模块作为唯一真源。
"""

# 每次喂食获得的经验（放慢升级速度：原为15，现为8）
FEED_XP = 8
WORDS_PER_PET_SLOT = 2000
MAX_PET_SLOTS = 5
PET_RECOVERY_WORDS = 2000

# 进化阈值: 蛋 → 基础 → 一阶 → 最终 → 晶耀形态
EVOLUTION_THRESHOLDS = {0: 5, 1: 15, 2: 30, 3: 45}
STAGE_NAMES = {0: "蛋", 1: "基础形态", 2: "一阶进化", 3: "最终进化", 4: "晶耀进化"}


def pet_slots_for_words(learned_words: int) -> int:
    """首只伙伴免费，此后每累计学习 2000 个不同单词解锁一格，最多 5 格。"""
    return min(MAX_PET_SLOTS, 1 + max(0, learned_words) // WORDS_PER_PET_SLOT)


def next_pet_slot_threshold(learned_words: int) -> int | None:
    slots = pet_slots_for_words(learned_words)
    if slots >= MAX_PET_SLOTS:
        return None
    return slots * WORDS_PER_PET_SLOT


def pet_recovery_goal(learned_words: int) -> int:
    """失去最后一只伙伴后，必须再学习 2000 个不同单词才能重新领养。"""
    return max(0, learned_words) + PET_RECOVERY_WORDS


def evolution_stage_for_level(level: int) -> int:
    """Return the highest automatically unlocked evolution stage for a level."""
    stage = 0
    while stage in EVOLUTION_THRESHOLDS and level >= EVOLUTION_THRESHOLDS[stage]:
        stage += 1
    return stage


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
