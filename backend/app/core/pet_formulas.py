"""宠物养成/对战/治疗 的共享数值公式与升级结算逻辑。

此前 calculate_max_hp / 升级公式 / 进化阈值 散落在 pet.py、pet_healing.py、
pet_battle_service.py 三处重复定义，改数值容易漏改。统一收敛到本模块作为唯一真源。
"""

# 每次喂食获得的经验（放慢升级速度：原为15，现为8）
FEED_XP = 8
WORDS_PER_PET_SLOT = 2000
MAX_PET_SLOTS = 5
PET_RECOVERY_WORDS = 2000

# 传说伙伴的独立队伍格:与普通 5 格完全分开计数。
# 为什么分开:普通格早被占满,若共用池子,孩子攒够 5000 词也领不了传说 —— 解锁等于白给。
# 达到准传说门槛(5000)开第 1 格,达到顶级门槛(8000)开第 2 格,最多 2 只传说。
MAX_LEGEND_SLOTS = 2

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


def legend_slots_for_words(learned_words: int) -> int:
    """传说专属格数量:达到准传说门槛开 1 格,达到顶级门槛再开 1 格。

    门槛真源在 core/pet_species(SEMI_LEGEND_WORDS / LEGEND_WORDS),这里只做换算,
    免得两处数字漂移。
    """
    from app.core.pet_species import SEMI_LEGEND_WORDS, LEGEND_WORDS

    words = max(0, learned_words)
    slots = 0
    if words >= SEMI_LEGEND_WORDS:
        slots += 1
    if words >= LEGEND_WORDS:
        slots += 1
    return min(MAX_LEGEND_SLOTS, slots)


def next_legend_slot_threshold(learned_words: int) -> int | None:
    """下一个传说格所需的累计学词数;已开满返回 None。"""
    from app.core.pet_species import SEMI_LEGEND_WORDS, LEGEND_WORDS

    words = max(0, learned_words)
    if words < SEMI_LEGEND_WORDS:
        return SEMI_LEGEND_WORDS
    if words < LEGEND_WORDS:
        return LEGEND_WORDS
    return None


def evolution_stage_for_level(level: int) -> int:
    """Return the highest automatically unlocked evolution stage for a level."""
    stage = 0
    while stage in EVOLUTION_THRESHOLDS and level >= EVOLUTION_THRESHOLDS[stage]:
        stage += 1
    return stage


def calculate_max_hp(level: int, evolution_stage: int, species: str | None = None) -> int:
    """计算宠物最大HP = 100 + 等级×5 + 进化阶段×20 + 稀有度加成。

    species 可选:传了才吃稀有度加成(准传说 +30 / 传说 +60)。
    做成可选是为了让 10 处既有调用点不传也不出错,但**血量必须处处同口径** ——
    算最大值时给了加成、别处没给,就会出现"治疗治不满"或"血条超过 100%"。
    新增调用点请一律传 species。
    """
    bonus = 0
    if species:
        from app.core.pet_species import tier_power_bonus
        bonus = tier_power_bonus(species)["hp"]
    return 100 + level * 5 + evolution_stage * 20 + bonus


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


# ========== 对战演出时间(秒) ==========
# 与前端 frontend/src/config/petSpecies.ts 的 EFFECT_STEP_NORMAL / EFFECT_STEP_ULTIMATE / FX_TAIL /
# ROUND_READ_SECONDS **同名同值**(tests/test_pet_battle_pacing.py 解析那个文件比对)。
# 一回合里的招式一记接一记演: 普通攻击起手后 1.3 秒下一记起手,大招起手后 3.3 秒下一记起手,
# 最后一记再多演 0.3 秒收尾(所以一记普通攻击共 1.6 秒、一记大招共 3.6 秒)。
BATTLE_FX_STEP_NORMAL = 1.3
BATTLE_FX_STEP_ULTIMATE = 3.3
BATTLE_FX_TAIL = 0.3
BATTLE_READ_SECONDS = 1.6    # 演完后留给孩子看正确答案的时间
BATTLE_SWITCH_SECONDS = 8.0  # 有人能换宠物时,回合之间至少留这么久


def round_fx_counts(d1: int, d2: int, u1: bool, u2: bool) -> tuple[int, int]:
    """这一回合要演几记 → (普通攻击几记, 大招几记)。

    d1 / d2 是两位玩家结算后的 damage(>0 打到对方多少,<0 自己答错扣多少),u1 / u2 是否放了大招。
    和前端 components/battle/fx.ts 的 buildRoundFx **同一套合并规则**: 每一方一回合最多挨一记 ——
    对手打过来的伤害和自己答错扣的血合成一记演(以前分成两记,一回合最多演四记,孩子看不清)。
    """
    hit_p2 = d1 > 0 or d2 < 0
    hit_p1 = d2 > 0 or d1 < 0
    ult = int(bool(u1) and d1 > 0) + int(bool(u2) and d2 > 0)
    return int(hit_p1) + int(hit_p2) - ult, ult


def round_gap_seconds(n_normal: int, n_ultimate: int, can_switch: bool) -> float:
    """这一回合结算后隔多久发下一题 = 招式演完 + 看答案的时间。

    以前固定等 8 秒(留给换宠物),但 464 个有宠物的学生里 440 个只有 1 只,换不了也要干等。
    现在有人能换宠物才保证 8 秒。两记普通攻击 4.5 秒、一记大招一记普通 6.5 秒、两记大招 8.5 秒。
    """
    n_normal, n_ultimate = max(0, int(n_normal)), max(0, int(n_ultimate))
    gap = BATTLE_READ_SECONDS
    if n_normal or n_ultimate:
        gap += n_normal * BATTLE_FX_STEP_NORMAL + n_ultimate * BATTLE_FX_STEP_ULTIMATE + BATTLE_FX_TAIL
    if can_switch:
        gap = max(gap, BATTLE_SWITCH_SECONDS)
    return round(gap, 2)
