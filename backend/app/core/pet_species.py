"""Pet species metadata shared by adoption, evolution and battle services.

种族分三档(tier),决定领养门槛与占用哪种队伍格:
- normal      普通家族。免费领第一只,之后每累计学 2000 个不同单词开一格,最多 5 格。
- semi_legend 准传说(白泽/雷鼓夔/朱雀/北冥鲲)。需累计 5000 个不同单词。
- legend      顶级传说(玉兔/九色鹿/应龙/麒麟)。需累计 8000 个不同单词。

⚠️ 传说**不占普通 5 格**,走独立的传说格(见 pet_formulas.legend_slots_for_words)。
   原因:普通格早被占满,若共用池子则「攒够词也领不了」,解锁等于白给。

传说不走进化链,但本系统固定 5 形态,所以给三档「气场升级」形态
(本体 → 觉醒 → 究极),拿到之后仍有养成动力 —— 三档复用同一张图是个已知的
体验坑,新增种族不要再犯(出图走 scripts/gen_pet_originals.py,一家三张)。
"""

# 传说门槛(累计学习的不同单词数)。真源在此,前端 petSpecies.ts 与文案都引用这两个数。
SEMI_LEGEND_WORDS = 5000
LEGEND_WORDS = 8000

TIER_NORMAL = "normal"
TIER_SEMI_LEGEND = "semi_legend"
TIER_LEGEND = "legend"

TIER_WORD_REQUIREMENT = {
    TIER_NORMAL: 0,
    TIER_SEMI_LEGEND: SEMI_LEGEND_WORDS,
    TIER_LEGEND: LEGEND_WORDS,
}

TIER_LABELS = {
    TIER_NORMAL: "普通",
    TIER_SEMI_LEGEND: "准传说",
    TIER_LEGEND: "传说",
}


def _species(label: str, element: str, base: str, middle: str, final: str, tier: str = TIER_NORMAL):
    return {
        "label": label,
        "element": element,
        "tier": tier,
        "stages": ("伙伴蛋", base, middle, final, f"晶耀{final}"),
    }


def _legend(label: str, element: str, base: str, awake: str, ultra: str, tier: str):
    """传说种族:三档是同一只的气场升级,不是进化链,所以最终档不加「晶耀」前缀。"""
    return {
        "label": label,
        "element": element,
        "tier": tier,
        "stages": ("传说之卵", base, awake, ultra, f"神话{base}"),
    }


PET_SPECIES = {
    "sparkhog": _species("蒲电猬家族", "electric", "蒲蒲猬", "闪蒲猬", "雷冠猬"),
    "alpaca": _species("云絮羊驼家族", "normal", "绒绒驼", "云絮羊驼", "星光羊驼"),
    "leafkoala": _species("叶耳熊家族", "grass", "叶团团", "藤叶熊", "森冠熊"),
    "emberham": _species("火芯鼠家族", "fire", "火芯仔", "焰团鼠", "炎披鼠王"),
    "narwhee": _species("螺角鲸家族", "water", "小螺鲸", "涡角鲸", "潮冠角鲸"),
    "melopuff": _species("音团绒家族", "fairy", "音团团", "乐符绒", "交响绒王"),
    "umbrellaspirit": _species("伞灵家族", "ghost", "伞宝灵", "油纸伞灵", "千伞幽灵"),
    "candydrake": _species("糖画龙家族", "dragon", "糖糖龙", "糖画龙", "金糖龙王"),
    "boxaroo": _species("拳袋鼠家族", "fighting", "拳仔袋", "擂台袋鼠", "袋鼠拳王"),
    "mindslug": _species("念力海蛞蝓家族", "psychic", "念念蝓", "星念蝓", "灵光蝓仙"),
    "pebbadillo": _species("卵石犰狳家族", "rock", "石豆犰", "岩甲犰", "山岳犰王"),
    "blazekat": _species("焰尾獴家族", "fire", "火獴仔", "焰尾獴", "日冕獴王"),
    "liondog": _species("醒狮家族", "fire", "醒狮仔", "焰鬃狮", "瑞火狮王"),
    "surfduck": _species("浪羽鸭家族", "water", "灰绒鸭", "浪羽鸭", "潮光天鹅"),
    "potsprout": _species("盆栽精家族", "grass", "盆芽芽", "花盆灵", "百花盆王"),
    "bubbleoct": _species("泡泡章家族", "water", "泡泡章", "涡泡章", "深海章王"),
    "silkmoth": _species("蚕蛾家族", "bug", "蚕宝宝", "银茧蚕", "月光蚕蛾"),
    "honeybee": _species("蜜囊蜂家族", "bug", "蜜豆蜂", "巢卫蜂", "蜂巢骑士"),
    "pitcherplant": _species("瓶子草家族", "grass", "小瓶草", "露瓶草", "瓶草女王"),
    "axolotl": _species("六角螈家族", "water", "萌螈宝", "珊鳃螈", "珊瑚螈王"),
    "geocub": _species("晶洞兽家族", "rock", "晶豆兽", "晶洞兽", "紫晶山君"),
    "lanternfairy": _species("灯笼仙家族", "psychic", "灯芯灵", "灯笼仙", "千灯仙子"),
    "lotuscalf": _species("莲叶鹿家族", "grass", "荷芽鹿", "莲叶鹿", "千荷鹿神"),
    "flamepanda": _species("焰熊猫家族", "fire", "火团团", "焰纹熊猫", "火竹熊猫王"),
    "otterwave": _species("浪花獭家族", "water", "浪花獭", "冲浪獭", "海潮獭王"),
    "chameleaf": _species("变色龙家族", "grass", "叶纹蜥", "藤卷变色龙", "森影变色龙"),
    "sunrooster": _species("朝阳鸡家族", "fire", "朝阳雏", "啼晓鸡", "金乌鸡神"),
    "mudhippo": _species("泥潭河马家族", "water", "泥豆马", "泥潭河马", "沼泽河马王"),
    "cloudkite": _species("风筝龙家族", "dragon", "纸鸢龙", "风筝龙", "云霄龙王"),
    "clockbot": _species("发条机兽家族", "steel", "发条仔", "齿轮兽", "钟塔机神"),
    "dunewhale": _species("沙海鲸家族", "dragon", "沙鲸仔", "沙鳍龙", "沙海龙鲸"),
    "bambooweasel": _species("竹叶貂家族", "grass", "竹芽貂", "竹叶貂", "青竹貂君"),
    "lavaboar": _species("熔岩野猪家族", "fire", "火炭猪", "熔岩猪", "火山猪王"),
    "shellpenguin": _species("贝甲企鹅家族", "water", "贝贝鹅", "贝刃企鹅", "海螺企鹅帝"),
    "acornsquirrel": _species("橡果松鼠家族", "grass", "橡果鼠", "松果射手", "森林神射手"),
    "firetanuki": _species("火狸家族", "fire", "火狸仔", "鼓焰狸", "烈鼓狸王"),
    "jellyfish": _species("彩纱水母家族", "water", "泡泡母", "彩纱水母", "极光水母后"),
    "book_fox": _species("书狐", "normal", "书页幼狐", "博闻书狐", "贤者书狐"),
    "paper_owl": _species("文鸮", "psychic", "折纸雏鸮", "学者文鸮", "博士文鸮"),
    "word_turtle": _species("词龟", "water", "字芽小龟", "词纹灵龟", "典藏圣龟"),
    # ===== 2026-08-11 新增 12 个普通家族 =====
    # 选种优先补齐克制表里的空属性:原有 40 族里 ice/dark/ground/poison/flying 一只都没有,
    # TYPE_CHART 那几行等于摆设(打不出也吃不到克制)。
    "voltaeel": _species("霓虹电鳗家族", "electric", "电鳗宝", "霓虹鳗", "雷霆鳗龙"),
    "snowleopard": _species("雪豹家族", "ice", "雪团豹", "霜纹豹", "冰川豹王"),
    "shadowcat": _species("夜影猫家族", "dark", "影喵", "夜影猫", "月蚀猫王"),
    "dartfrog": _species("彩毒蛙家族", "poison", "彩毒蛙", "毒雾蛙", "剧彩蛙王"),
    "digmole": _species("掘地鼹家族", "ground", "土豆鼹", "矿灯鼹", "大地鼹王"),
    "dunecamel": _species("沙丘骆驼家族", "ground", "沙驼仔", "沙丘骆驼", "沙漠驼王"),
    "swallow": _species("剪尾燕家族", "flying", "春燕仔", "剪尾燕", "疾风燕王"),
    "hummingbird": _species("翠羽蜂鸟家族", "flying", "蜂鸟仔", "翠羽蜂鸟", "虹光蜂鸟"),
    "ironrhino": _species("钢甲犀家族", "steel", "铁角犀", "钢甲犀", "钢铁犀王"),
    "seahorse": _species("潮剑海马家族", "water", "小海马", "潮剑海马", "海马骑士"),
    "flamingo": _species("焰舞烈鸟家族", "fire", "粉焰雏", "焰羽烈鸟", "焰舞烈鸟"),
    "cactus": _species("仙人掌家族", "grass", "仙人球", "掌刺拳手", "沙漠掌王"),
    # ===== 第三批 10 个家族(2026-08-11 上线) =====
    "flyingsquirrel": _species("滑翔鼯鼠家族", "flying", "飞鼠仔", "滑翔鼯鼠", "风翼鼯鼠王"),
    "terracotta": _species("陶俑家族", "rock", "陶俑仔", "陶甲俑", "石甲将军"),
    "dragonfly": _species("翠翼蜻蜓家族", "bug", "小蜻蜓", "翠翼蜻蜓", "疾翼蜻蜓王"),
    "goldmonkey": _species("金丝猴家族", "fighting", "金丝猴仔", "拳法金猴", "齐云拳圣"),
    "sloth": _species("树懒家族", "normal", "懒懒宝", "抱树懒", "树懒长老"),
    "magnetcrab": _species("磁钳蟹家族", "steel", "磁钳蟹", "磁甲蟹", "磁暴蟹王"),
    "yak": _species("牦牛家族", "normal", "小牦牛", "冲锋牦牛", "雪原牦牛王"),
    "peacock": _species("孔雀家族", "flying", "孔雀雏", "开屏孔雀", "百羽孔雀王"),
    "ladybug": _species("七星瓢虫家族", "bug", "瓢虫宝", "七星瓢虫", "七星甲士"),
    "mosssnail": _species("苔壳蜗牛家族", "grass", "苔壳蜗", "花园蜗牛", "森林蜗牛王"),
    # ===== 传说伙伴(取材中国神话,靠累计学词解锁,独立专属格) =====
    # 准传说 5000 词
    "baize": _legend("白泽", "ice", "白泽", "觉醒白泽", "究极白泽", TIER_SEMI_LEGEND),
    "thunderkui": _legend("雷鼓夔", "electric", "雷鼓夔", "觉醒雷鼓夔", "究极雷鼓夔", TIER_SEMI_LEGEND),
    "vermilion": _legend("朱雀", "fire", "朱雀", "觉醒朱雀", "究极朱雀", TIER_SEMI_LEGEND),
    "kun": _legend("北冥鲲", "water", "北冥鲲", "觉醒北冥鲲", "究极北冥鲲", TIER_SEMI_LEGEND),
    # 顶级传说 8000 词
    "jaderabbit": _legend("玉兔", "psychic", "玉兔", "觉醒玉兔", "究极玉兔", TIER_LEGEND),
    "ninecolordeer": _legend("九色鹿", "psychic", "九色鹿", "觉醒九色鹿", "究极九色鹿", TIER_LEGEND),
    "yinglong": _legend("应龙", "dragon", "应龙", "觉醒应龙", "究极应龙", TIER_LEGEND),
    "qilin": _legend("麒麟", "normal", "麒麟", "觉醒麒麟", "究极麒麟", TIER_LEGEND),
}

ALLOWED_PET_SPECIES = frozenset(PET_SPECIES)

# 没养宠物 / 认不出的 id 一律按它显示。前端 config/petSpecies.ts 的 DEFAULT_SPECIES 必须同值。
DEFAULT_SPECIES = "sparkhog"

# 2026-11-04 原来 67 个种族的名字、立绘、招式名都是宝可梦的(版权在任天堂 / 宝可梦公司),
# 全部换成原创伙伴(设计表 scripts/pet_original_designs.py)。一格对一格换: 元素、稀有度、
# 技能骨架都沿用,孩子的等级、进化、血量不受影响。
# 库里 user_pets.species 启动时由 migrate_legacy_species 整体换掉;接口收到旧 id(没刷新的旧页面)
# 也按这张表换。**这张表只增不删**,删了老数据就对不上了。
LEGACY_SPECIES = {
    "pikachu": "sparkhog",
    "eevee": "alpaca",
    "bulbasaur": "leafkoala",
    "charmander": "emberham",
    "squirtle": "narwhee",
    "jigglypuff": "melopuff",
    "gastly": "umbrellaspirit",
    "dratini": "candydrake",
    "machop": "boxaroo",
    "abra": "mindslug",
    "geodude": "pebbadillo",
    "vulpix": "blazekat",
    "growlithe": "liondog",
    "magikarp": "surfduck",
    "oddish": "potsprout",
    "poliwag": "bubbleoct",
    "caterpie": "silkmoth",
    "weedle": "honeybee",
    "bellsprout": "pitcherplant",
    "horsea": "axolotl",
    "larvitar": "geocub",
    "ralts": "lanternfairy",
    "chikorita": "lotuscalf",
    "cyndaquil": "flamepanda",
    "totodile": "otterwave",
    "treecko": "chameleaf",
    "torchic": "sunrooster",
    "mudkip": "mudhippo",
    "bagon": "cloudkite",
    "beldum": "clockbot",
    "gible": "dunewhale",
    "snivy": "bambooweasel",
    "tepig": "lavaboar",
    "oshawott": "shellpenguin",
    "rowlet": "acornsquirrel",
    "litten": "firetanuki",
    "popplio": "jellyfish",
    "mareep": "voltaeel",
    "swinub": "snowleopard",
    "deino": "shadowcat",
    "nidoran": "dartfrog",
    "trapinch": "digmole",
    "sandile": "dunecamel",
    "zubat": "swallow",
    "starly": "hummingbird",
    "rookidee": "ironrhino",
    "froakie": "seahorse",
    "fennekin": "flamingo",
    "chespin": "cactus",
    "pidgey": "flyingsquirrel",
    "onix": "terracotta",
    "scyther": "dragonfly",
    "riolu": "goldmonkey",
    "munchlax": "sloth",
    "magnemite": "magnetcrab",
    "tauros": "yak",
    "doduo": "peacock",
    "pinsir": "ladybug",
    "tropius": "mosssnail",
    "articuno": "baize",
    "zapdos": "thunderkui",
    "moltres": "vermilion",
    "suicune": "kun",
    "mew": "jaderabbit",
    "mewtwo": "ninecolordeer",
    "rayquaza": "yinglong",
    "arceus": "qilin",
}


def normalize_species(species: str | None) -> str | None:
    """旧 id 换成新 id;本来就是新的或认不出的原样返回(调用方自己判合不合法)。"""
    if species is None:
        return None
    return LEGACY_SPECIES.get(species, species)


def _definition(species: str) -> dict:
    return PET_SPECIES.get(normalize_species(species)) or PET_SPECIES[DEFAULT_SPECIES]


async def migrate_legacy_species(engine) -> int:
    """把库里的旧种族 id 一一换成新的。幂等: 换过的行不会再命中。返回改了几行。

    只动 user_pets.species。对战记录里的收服结果(capture_result JSON)不改 —— 那是历史快照,
    前端按 LEGACY_SPECIES 兜着显示。
    """
    from sqlalchemy import text

    changed = 0
    async with engine.begin() as conn:
        exists = (await conn.execute(text(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_pets'"
        ))).first()
        if not exists:
            return 0
        for old, new in LEGACY_SPECIES.items():
            result = await conn.execute(
                text("UPDATE user_pets SET species = :new WHERE species = :old"), {"new": new, "old": old}
            )
            changed += result.rowcount or 0
    return changed


def get_pet_stage_name(species: str, evolution_stage: int) -> str:
    definition = _definition(species)
    stages = definition["stages"]
    return stages[max(0, min(evolution_stage, len(stages) - 1))]


def get_pet_label(species: str) -> str:
    return _definition(species)["label"]


def get_pet_element(species: str) -> str:
    return _definition(species)["element"]


def get_pet_tier(species: str) -> str:
    """种族档位。未知种族按普通处理(与其它 getter 的兜底策略一致)。"""
    return _definition(species).get("tier", TIER_NORMAL)


def is_legendary(species: str) -> bool:
    """是否传说(含准传说)。传说走独立队伍格、有学词门槛。"""
    return get_pet_tier(species) != TIER_NORMAL


def words_required_for(species: str) -> int:
    """领养该种族所需的累计学词数;普通种族返回 0(只受队伍格约束)。"""
    return TIER_WORD_REQUIREMENT.get(get_pet_tier(species), 0)


# ============ 稀有度战力加成 ============
# 攢 5000/8000 词换来的传说,战力必须真的比普通强,否则孩子会觉得"白攢那么久"。
# 但也不能强到一边倒:对战胜负的主导权要留给答题(答对/连击/速度),
# 传说只是让同等付出下更占优。所以加成走**固定加值**而非乘算 ——
# 乘算会随等级放大成压倒性差距,固定值在高等级会被答题表现稀释,正是想要的手感。
TIER_POWER_BONUS = {
    TIER_NORMAL: {"damage": 0, "ultimate": 0, "hp": 0},
    TIER_SEMI_LEGEND: {"damage": 4, "ultimate": 12, "hp": 30},
    TIER_LEGEND: {"damage": 8, "ultimate": 25, "hp": 60},
}


def tier_power_bonus(species: str) -> dict:
    """该种族的稀有度加成(普通全 0)。"""
    return TIER_POWER_BONUS.get(get_pet_tier(species), TIER_POWER_BONUS[TIER_NORMAL])


LEGENDARY_SPECIES = frozenset(
    species for species in PET_SPECIES if is_legendary(species)
)


# 属性克制表,须与前端 utils/typeEffectiveness.ts 保持一致。
# 没有「免疫×0」,统一按×0.5 结算:答对题却打出 0 伤害对孩子太挫败,
# 且 normal↔ghost 互免会造成谁也打不倒谁的死局(前端同步调整)。
TYPE_CHART = {
    "normal": {"super": (), "weak": ("rock", "steel", "ghost")},
    "fire": {"super": ("grass", "ice", "bug", "steel"), "weak": ("fire", "water", "rock", "dragon")},
    "water": {"super": ("fire", "ground", "rock"), "weak": ("water", "grass", "dragon")},
    "grass": {"super": ("water", "ground", "rock"), "weak": ("fire", "grass", "poison", "flying", "bug", "dragon", "steel")},
    "electric": {"super": ("water", "flying"), "weak": ("electric", "grass", "dragon", "ground")},
    "ice": {"super": ("grass", "ground", "flying", "dragon"), "weak": ("fire", "water", "ice", "steel")},
    "fighting": {"super": ("normal", "ice", "rock", "dark", "steel"), "weak": ("poison", "flying", "psychic", "bug", "fairy", "ghost")},
    "poison": {"super": ("grass", "fairy"), "weak": ("poison", "ground", "rock", "ghost", "steel")},
    "ground": {"super": ("fire", "electric", "poison", "rock", "steel"), "weak": ("grass", "bug", "flying")},
    "flying": {"super": ("grass", "fighting", "bug"), "weak": ("electric", "rock", "steel")},
    "psychic": {"super": ("fighting", "poison"), "weak": ("psychic", "steel", "dark")},
    "bug": {"super": ("grass", "psychic", "dark"), "weak": ("fire", "fighting", "poison", "flying", "ghost", "steel", "fairy")},
    "rock": {"super": ("fire", "ice", "flying", "bug"), "weak": ("fighting", "ground", "steel")},
    "ghost": {"super": ("psychic", "ghost"), "weak": ("dark", "normal")},
    "dragon": {"super": ("dragon",), "weak": ("steel", "fairy")},
    "dark": {"super": ("psychic", "ghost"), "weak": ("fighting", "dark", "fairy")},
    "steel": {"super": ("ice", "rock", "fairy"), "weak": ("fire", "water", "electric", "steel")},
    "fairy": {"super": ("fighting", "dragon", "dark"), "weak": ("fire", "poison", "steel")},
}


def get_type_multiplier(attacker_species: str, defender_species: str) -> float:
    """按双方种族元素计算克制倍率:2.0 / 1.0 / 0.5。"""
    chart = TYPE_CHART.get(get_pet_element(attacker_species))
    if not chart:
        return 1.0
    defender_element = get_pet_element(defender_species)
    if defender_element in chart["super"]:
        return 2.0
    if defender_element in chart["weak"]:
        return 0.5
    return 1.0


def get_type_text(multiplier: float) -> str:
    if multiplier >= 2.0:
        return "属性克制，伤害翻倍！"
    if multiplier <= 0.5:
        return "被克制了，伤害减半…"
    return ""

