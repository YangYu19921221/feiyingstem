"""Pet species metadata shared by adoption, evolution and battle services.

种族分三档(tier),决定领养门槛与占用哪种队伍格:
- normal      普通家族。免费领第一只,之后每累计学 2000 个不同单词开一格,最多 5 格。
- semi_legend 准传说(三神鸟/三圣兽)。需累计 5000 个不同单词。
- legend      顶级传说(梦幻/超梦/烈空坐/创世神)。需累计 5000 个不同单词。

⚠️ 传说**不占普通 5 格**,走独立的传说格(见 pet_formulas.legend_slots_for_words)。
   原因:普通格早被占满,若共用池子则「攒够词也领不了」,解锁等于白给。

传说在原作不进化,但本系统固定 5 形态,所以给三档「气场升级」形态
(本体 → 觉醒 → 究极),拿到之后仍有养成动力 —— 三档复用同一张图是个已知的
体验坑(见 scripts/gen_pet_midforms.py 的由来),新增种族不要再犯。
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
    "pikachu": _species("皮卡丘家族", "electric", "皮丘", "皮卡丘", "雷丘"),
    "eevee": _species("伊布", "normal", "伊布", "成长伊布", "羁绊伊布"),
    "bulbasaur": _species("妙蛙种子家族", "grass", "妙蛙种子", "妙蛙草", "妙蛙花"),
    "charmander": _species("小火龙家族", "fire", "小火龙", "火恐龙", "喷火龙"),
    "squirtle": _species("杰尼龟家族", "water", "杰尼龟", "卡咪龟", "水箭龟"),
    "jigglypuff": _species("胖丁家族", "fairy", "胖丁", "成长胖丁", "胖可丁"),
    "gastly": _species("鬼斯家族", "ghost", "鬼斯", "鬼斯通", "耿鬼"),
    "dratini": _species("迷你龙家族", "dragon", "迷你龙", "哈克龙", "快龙"),
    "machop": _species("腕力家族", "fighting", "腕力", "豪力", "怪力"),
    "abra": _species("凯西家族", "psychic", "凯西", "勇基拉", "胡地"),
    "geodude": _species("小拳石家族", "rock", "小拳石", "隆隆石", "隆隆岩"),
    "vulpix": _species("六尾家族", "fire", "六尾", "成长六尾", "九尾"),
    "growlithe": _species("卡蒂狗家族", "fire", "卡蒂狗", "成长卡蒂狗", "风速狗"),
    "magikarp": _species("鲤鱼王家族", "water", "鲤鱼王", "跃动鲤鱼王", "暴鲤龙"),
    "oddish": _species("走路草家族", "grass", "走路草", "臭臭花", "霸王花"),
    "poliwag": _species("蚊香蝌蚪家族", "water", "蚊香蝌蚪", "蚊香君", "蚊香泳士"),
    "caterpie": _species("绿毛虫家族", "bug", "绿毛虫", "铁甲蛹", "巴大蝶"),
    "weedle": _species("独角虫家族", "bug", "独角虫", "铁壳蛹", "大针蜂"),
    "bellsprout": _species("喇叭芽家族", "grass", "喇叭芽", "口呆花", "大食花"),
    "horsea": _species("墨海马家族", "water", "墨海马", "海刺龙", "刺龙王"),
    "larvitar": _species("幼基拉斯家族", "rock", "幼基拉斯", "沙基拉斯", "班基拉斯"),
    "ralts": _species("拉鲁拉丝家族", "psychic", "拉鲁拉丝", "奇鲁莉安", "沙奈朵"),
    "chikorita": _species("菊草叶家族", "grass", "菊草叶", "月桂叶", "大竺葵"),
    "cyndaquil": _species("火球鼠家族", "fire", "火球鼠", "火岩鼠", "火暴兽"),
    "totodile": _species("小锯鳄家族", "water", "小锯鳄", "蓝鳄", "大力鳄"),
    "treecko": _species("木守宫家族", "grass", "木守宫", "森林蜥蜴", "蜥蜴王"),
    "torchic": _species("火稚鸡家族", "fire", "火稚鸡", "力壮鸡", "火焰鸡"),
    "mudkip": _species("水跃鱼家族", "water", "水跃鱼", "沼跃鱼", "巨沼怪"),
    "bagon": _species("宝贝龙家族", "dragon", "宝贝龙", "甲壳龙", "暴飞龙"),
    "beldum": _species("铁哑铃家族", "steel", "铁哑铃", "金属怪", "巨金怪"),
    "gible": _species("圆陆鲨家族", "dragon", "圆陆鲨", "尖牙陆鲨", "烈咬陆鲨"),
    "snivy": _species("藤藤蛇家族", "grass", "藤藤蛇", "青藤蛇", "君主蛇"),
    "tepig": _species("暖暖猪家族", "fire", "暖暖猪", "炒炒猪", "炎武王"),
    "oshawott": _species("水水獭家族", "water", "水水獭", "双刃丸", "大剑鬼"),
    "rowlet": _species("木木枭家族", "grass", "木木枭", "投羽枭", "狙射树枭"),
    "litten": _species("火斑喵家族", "fire", "火斑喵", "炎热喵", "炽焰咆哮虎"),
    "popplio": _species("球球海狮家族", "water", "球球海狮", "花漾海狮", "西狮海壬"),
    "book_fox": _species("书狐", "normal", "书页幼狐", "博闻书狐", "贤者书狐"),
    "paper_owl": _species("文鸮", "psychic", "折纸雏鸮", "学者文鸮", "博士文鸮"),
    "word_turtle": _species("词龟", "water", "字芽小龟", "词纹灵龟", "典藏圣龟"),
    # ===== 2026-08-11 新增 12 个普通家族 =====
    # 选种优先补齐克制表里的空属性:原有 40 族里 ice/dark/ground/poison/flying 一只都没有,
    # TYPE_CHART 那几行等于摆设(打不出也吃不到克制)。
    "mareep": _species("咩利羊家族", "electric", "咩利羊", "茸茸羊", "电龙"),
    "swinub": _species("小山猪家族", "ice", "小山猪", "长毛猪", "象牙猪"),
    "deino": _species("单首龙家族", "dark", "单首龙", "双首暴龙", "三首恶龙"),
    "nidoran": _species("尼多朗家族", "poison", "尼多朗", "尼多利诺", "尼多王"),
    "trapinch": _species("大颚蚁家族", "ground", "大颚蚁", "超音波幼虫", "沙漠蜻蜓"),
    "sandile": _species("黑眼鳄家族", "ground", "黑眼鳄", "混混鳄", "流氓鳄"),
    "zubat": _species("超音蝠家族", "flying", "超音蝠", "大嘴蝠", "叉字蝠"),
    "starly": _species("姆克儿家族", "flying", "姆克儿", "姆克鸟", "姆克鹰"),
    "rookidee": _species("稚山雀家族", "steel", "稚山雀", "蓝鸦", "钢铠鸦"),
    "froakie": _species("呱呱泡蛙家族", "water", "呱呱泡蛙", "呱头蛙", "甲贺忍蛙"),
    "fennekin": _species("火狐狸家族", "fire", "火狐狸", "长尾火狐", "妖火红狐"),
    "chespin": _species("哈力栗家族", "grass", "哈力栗", "胖胖哈力", "布里卡隆"),
    # ===== 2026-08-11 小智主力阵容(动画里跟过他的伙伴) =====
    # 图鉴此前已覆盖他大半阵容(皮卡丘/妙蛙/小火龙/杰尼龟/卡蒂狗/甲贺忍蛙/沙奈朵…),
    # 这 10 族是缺口。三形态里带 _mid/_prime 后缀的是本系统补的过渡/强化档 ——
    # 原作 onix/scyther 只有两阶,而本系统固定 5 档,缺档会让孩子进化后立绘不变。
    "pidgey": _species("波波家族", "flying", "波波", "比比鸟", "大比鸟"),
    "onix": _species("大岩蛇家族", "rock", "大岩蛇", "钢岩蛇", "大钢蛇"),
    "scyther": _species("飞天螳螂家族", "bug", "飞天螳螂", "钢化螳螂", "巨钳螳螂"),
    "riolu": _species("利欧路家族", "fighting", "利欧路", "波导利欧", "路卡利欧"),
    "munchlax": _species("小卡比兽家族", "normal", "小卡比兽", "贪吃卡比", "卡比兽"),
    "magnemite": _species("小磁怪家族", "steel", "小磁怪", "三合一磁怪", "自爆磁怪"),
    "tauros": _species("肯泰罗家族", "normal", "肯泰罗", "冲锋肯泰罗", "狂怒肯泰罗"),
    "doduo": _species("嘟嘟家族", "flying", "嘟嘟", "嘟嘟利", "王者嘟嘟利"),
    "pinsir": _species("凯罗斯家族", "bug", "凯罗斯", "重钳凯罗斯", "霸钳凯罗斯"),
    "tropius": _species("热带龙家族", "grass", "幼热带龙", "热带龙", "丰实热带龙"),
    # ===== 传说宝可梦(靠累计学词解锁,独立专属格) =====
    # 准传说 5000 词
    "articuno": _legend("急冻鸟", "ice", "急冻鸟", "觉醒急冻鸟", "究极急冻鸟", TIER_SEMI_LEGEND),
    "zapdos": _legend("闪电鸟", "electric", "闪电鸟", "觉醒闪电鸟", "究极闪电鸟", TIER_SEMI_LEGEND),
    "moltres": _legend("火焰鸟", "fire", "火焰鸟", "觉醒火焰鸟", "究极火焰鸟", TIER_SEMI_LEGEND),
    "suicune": _legend("水君", "water", "水君", "觉醒水君", "究极水君", TIER_SEMI_LEGEND),
    # 顶级传说 5000 词
    "mew": _legend("梦幻", "psychic", "梦幻", "觉醒梦幻", "究极梦幻", TIER_LEGEND),
    "mewtwo": _legend("超梦", "psychic", "超梦", "觉醒超梦", "究极超梦", TIER_LEGEND),
    "rayquaza": _legend("烈空坐", "dragon", "烈空坐", "觉醒烈空坐", "究极烈空坐", TIER_LEGEND),
    "arceus": _legend("阿尔宙斯", "normal", "阿尔宙斯", "觉醒阿尔宙斯", "究极阿尔宙斯", TIER_LEGEND),
}

ALLOWED_PET_SPECIES = frozenset(PET_SPECIES)


def get_pet_stage_name(species: str, evolution_stage: int) -> str:
    definition = PET_SPECIES.get(species, PET_SPECIES["pikachu"])
    stages = definition["stages"]
    return stages[max(0, min(evolution_stage, len(stages) - 1))]


def get_pet_label(species: str) -> str:
    return PET_SPECIES.get(species, PET_SPECIES["pikachu"])["label"]


def get_pet_element(species: str) -> str:
    return PET_SPECIES.get(species, PET_SPECIES["pikachu"])["element"]


def get_pet_tier(species: str) -> str:
    """种族档位。未知种族按普通处理(与其它 getter 的兜底策略一致)。"""
    return PET_SPECIES.get(species, PET_SPECIES["pikachu"]).get("tier", TIER_NORMAL)


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
# 免疫(宝可梦原版×0)统一按×0.5 结算:答对题却打出 0 伤害对孩子太挫败,
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
        return "效果拔群！"
    if multiplier <= 0.5:
        return "效果不好..."
    return ""

