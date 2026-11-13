"""
宠物对战 · 闯关(2026-11-12)

为什么要有: 对战是孩子唯一主动去玩的功能,但线上近 30 天打了至少一回合的 571 场里 563 场是打 AI ——
每场都是随机冒出来的一个对手,打完就完了,没有「下一步」。闯关给一个一直往前走的目标(下一关、
这一关的三颗星、区域尽头的守关);每一回合仍然是一道单词题,场数仍然由 services/battle_tickets
管着(先做作业 / 复习 / 学新词才有场数),所以它不抢老师布置的任务,只是把「想再打一场」接到「先去学」上。

规则(这里是唯一一份。学生端对战大厅显示的东西都来自 overview(),前端不另写一套):
  1. 8 个区域按顺序走: 青草原 → 浅滩 → 红岩峡谷 → 极光雪原 → 雷暴高地 → 熔岩地 → 月光林地 → 云上神殿。
     每个区域 5 关,第 5 关是「守关」。一圈 40 关;40 关以后接着第二圈(第 41 关回到青草原),不封顶,
     圈数 lap = (n - 1) // 40,越往后对手越强。
  2. 区域 ↔ 属性和前端 components/battle/fx.ts 的 ELEMENT_ARENA 是同一张表(测试解析那个文件比对):
     每个区域里出场的都是那片场地的属性,场地图也就对得上。
  3. 第 n 关的对手**对所有孩子都一样**(孩子之间能聊「第 12 关那只好难」): 该区域属性的、不是传说的种族
     (和练习赛同一个池子 ai_opponent_service.AI_PET_SPECIES),排成一个固定的顺序按下标取,不掷骰子。
     固定顺序 = 按「区域:种族」的 md5 排(不按字母排: 不然每个区域永远是 a 开头的那几只)。
     一圈里同一区域的 5 关不重复;候选多于 5 只的区域,下一圈换一批。
     ⚠️ 以后加了新种族,同一关的对手可能换一只;孩子已经通过的关、拿到的星不受影响。
  4. 对手的等级 = **孩子自己出战宠物的等级**(同级,每一关、每一圈都是;打得过才会想打下一关)。进化阶段按等级算。
     不拿等级差调难度,原因见下面 LEVEL_OFFSET 那段注释(差一级正好跨过进化线的孩子会平白吃亏)。
  5. **对手的血比公式厚,为的是一场打得够长**(11-12 第四轮): 对手血量 = 几下 × (20 + 8 × 进化阶段 + 5),
     普通关 8 下、守关 10 下(5 级的孩子: 普通关 264、守关 330;公式血量只有 145)。每一关都是这么算,
     这一场的血量上限、当前血量、各宠物血量三处是同一个数。
     以前照公式给血: 普通关中位 4 回合就打完(线上以前平均也只有 4.2 回合),连对 3 题才攒一格大招 ——
     孩子在前面的关卡永远走不到拼咒语那一步,一场对战场数只练了 3–4 个词。
     **闯关打满 10 回合按剩余血量的比例判胜负**(pet_battle_service.check_battle_end): 对手血厚,
     比绝对值的话打满 10 回合永远是它赢。练习赛 / 真人对战照旧比绝对值。
     **挑战同学的影子和闯关是同一套节奏**(11-12): 影子的血用普通关那一档(hits_hp)、影子答错不掉血、
     属性克制只帮不坑 ×1.3、打满按比例判 —— 第 5、6、7 条这三处判断在 pet_battle_service 里都问 paced_rules(),
     闯关和影子走同一段代码。改这几条规矩 = 两边一起改。
  6. AI 的答题水平按关数涨(数都在下面的常量里,改那里):
     正确率 = min(0.92, 0.28 + 0.017 × 区域序号(0–7) + [0, 0.01, 0.02, 0.23, 0.13][第几关] + 0.30 × 圈数);
     最快答题 = max(2000, 3400 - 100 × 区域序号 - [0, 0, 100, 200, 200][第几关]) 毫秒,最慢 = 最快 + 3200。
     第 4 关答得准;守关血厚、答得没那么准。
     **闯关里 AI 答错不掉血**(AI_MISS_HURTS): 它前面几关七成的回合在答错,以前每次自己掉 10 —— 等于替孩子打。
  7. **闯关里属性克制只帮你、不坑你**(TYPE_ONLY_HELPS): 你克制对手伤害 ×1.3(TYPE_HELP_MULT;
     练习赛 / 真人对战是 ×2 —— 闯关里 ×2 会把一场打回 4 回合,见下面的表;影子和闯关一样 ×1.3);对手克制你、你被对手克制
     都按 1 倍算。原因: 每个区域清一色是那几种属性,而 464 个有宠物的孩子里 440 个只有一只 ——
     被克制的那个区域他一关都过不去,闯关就永远停在那儿。11-12 拿线上的伤害公式和孩子真实的答题分布模拟过:
     蒲电猬(最常见的那只)在红岩峡谷碰上地面系,原样算 第 3 关胜率 18%、守关 1%;只帮不坑 76% / 46%
     (和不相克时一样)。练习赛、真人对战不受影响,照旧双向克制。
  8. 能打哪一关: n ≤ 已通过的最大关 + 1。打过的关可以重打(为了把星星刷满)。还没轮到的关 → 403 trial_locked。
  9. 开打的闸门和练习赛一样(接口里按这个顺序判): 没宠物 → 宠物受伤 → 这一关还没解锁 → 今天没有对战场数。
     闯关也吃一场对战场数;一人同时只能打一场。
 10. 星星只有赢了才有: 这一场错了几题 = 打了几回合 - 我答对几题(超时没答算错)。
     0 错 3 星,错 1 个 2 星,赢了就有 1 星。每关记最好的一次,只升不降。
 11. 第一次通过有额外奖励(并进这一场的粮食和经验里一起发,不另开一条发奖的路):
     普通关 粮 +20 / 经验 +30,守关 粮 +60 / 经验 +100。重打不再给。输了、平了、逃跑都没有进度也没有奖励。
 12. **赢了,这一场上过场的宠物体力回满、不算受伤**(结果里 healed = true),和发奖同一个事务。
     别的对战是带着剩下的血进下一场、不到一半就算受伤 —— 闯关全对打赢也常常只剩两成血,
     「下一关」不是被「宠物受伤了」挡住就是进去一下就输。闯关要的是「赢了 → 下一关」。
     输了 / 平了 / 逃跑照旧(受伤 → 去做恢复训练那几道单词题 → 再来,那本身也是在学)。
 13. 进度一人一关一行(pet_trial_stages)。只在对战结算认领成功之后、同一个事务里写(settle),
     所以同一场不会记两次。一回合都没打的不记。
 14. **守关专考他自己错过的词**: 守关这一场的题目先从这个孩子的薄弱词里出,能占满 10 题(平时最多六成),
     不够再照旧用他学过的词补。trial.weak_words = 这一场有几道题考的是他的薄弱词。
 15. 这一场是第几关记在 pet_battles.ai_config 那段 JSON 的 "trial" 里(没给 pet_battles 加列);
     结算完把结果也写进去("trial.result"),孩子刷新结算页还看得到这一场几星。

模拟出来的难度(11-12 第五轮重跑。**出招三选一、大招要拼咒语(拼对的大招 ×1.5)、三种题型都算进去了**;
用线上的伤害 / 连对 / 大招 / 出招倍率函数,满血进场,每格 6 个等级 × 500 场,
等级按线上近 30 天打过对战的孩子的出战宠物分布加权: 1–2 级 13 人、3–4 级 10、5–7 级 12、8–10 级 8、11–14 级 7、15–20 级 8)。
怎么打: 「会就重击、不会就防守,手里有大招就拼咒语」。
「普通孩子」= 看英文选中文答对 85%(线上近 30 天的数)、看中文选英文 78%、听音 76%(这两种更难,往下折的,没有线上数据),
            六成在 5 秒内答完,咒语拼对七成;
「答得好的孩子」= 三种题型 96% / 93% / 92%,七成在 3 秒内答完,咒语拼对八成五。
下面两张表是**不相克**的(孩子的属性不克这一片场地)。箭头是 青草原 → 云上神殿:
  第一圈  普通孩子   第 1–3 关 98% → 92%   第 4 关 87% → 71%   守关 91% → 77%
          答得好的   第 1–3 关 99% → 96%   第 4 关 93% → 83%   守关 95% → 89%
  第二圈  普通孩子   第 1–3 关 80% → 56%   第 4 关 41% → 17%   守关 49% → 25%
          答得好的   第 1–3 关 89% → 72%   第 4 关 61% → 34%   守关 70% → 45%
  第三圈起正确率顶到 0.92,基本只有答得又快又准的孩子打得动。
  三项学习增益都带着(普通孩子,第一圈): 第 1–3 关 99% → 96%   第 4 关 95% → 83%   守关 96% → 87%。
  (拼对咒语的大招 ×1.5 让这些数比第四轮高了 2–5 个点。想拉回去: 守关的正确率偏移 0.13 → 0.16。)
一场打几回合(赢的场,第一圈,不相克):
  普通孩子  普通关 中位 6 回合(4 回合 9%、5 回合 29%、6 回合 28%、7 回合 17%、8–10 回合 17%);
            守关 中位 7 回合(5 回合 14%、6 回合 25%、7 回合 25%、8 回合 19%、9–10 回合 17%)。
  答得好的  普通关 中位 4–5 回合(4 回合 49%、5 回合 37%、6 回合 11%);守关 中位 5 回合(5 回合 64%)。
  带着三项增益: 普通孩子普通关 32% 在 4 回合打完(中位 5);答得好的孩子 77% 在 4 回合内打完(开局自带一格大招)。
  赢的场里放出过大招的: 普通关 91–93%,守关 97–98%(照公式给血的时候只有 11%)。
  打满 10 回合还没分出胜负的(含输的): 普通关 1%,守关 1–3%。
属性克制(只帮不坑,规则第 7 条)会把一场打短 —— 所以闯关里定成 ×1.3(TYPE_HELP_MULT),不是 ×2:
  孩子克制这一片场地时   普通关(普通孩子)                         守关(普通孩子)
    ×2(练习赛的倍率)   中位 4 回合、78% 在 4 回合内、8% 放过大招     中位 4 回合、35% 放过大招
    ×1.3(闯关)         中位 5 回合、35% 在 4 回合内、72% 放过大招    中位 6 回合、91% 放过大招
    不相克                中位 6 回合、 8% 在 4 回合内、91% 放过大招    中位 7 回合、98% 放过大招
  线上最常见的蒲电猬(电)克水和飞行: 浅滩、云上神殿对它是中间那一行。
出招是不是「永远选重击」: 不是。普通孩子「无脑全程重击」比「会就重击、不会就防守」胜率低 7–18 个点
  (云上神殿守关 59% 对 77%),星星也少;答得好的孩子两种打法差不多(本来就很少遇到不会的词)。
大招值不值得拼: 拼对 ×1.5 之后「有大招就拼」不比「从不放大招」差(普通孩子云上神殿守关 77% / 1.58 星 对 75% / 1.54 星);
  ×1 的时候是反过来的 —— 一记大招(6 级 60)还不如同一回合点一下重击(64–79)。
各等级的孩子差多少: 回合数差不多(这就是按「几下」定血量的目的);胜率低等级的吃亏一点 ——
  云上神殿守关 2 级 75%、17 级 80%(低等级的宠物血薄: 公式是 100 + 5×等级 + 20×进化,挨不了几下)。
⚠️ 「普通孩子的守关再难一点」和「答得好的孩子守关 ≥ 85%」是顶着的(答得好的孩子 85% 的地方,
   普通孩子最低也有七成)。11-12 定的是「学得好就是打得赢」优先。
要调松紧,改 ACC_* / SPEED_* / HP_HITS / TYPE_HELP_MULT 这几个数(大招的 ×1.5 在 battle_moves.SPELL_ULT_MULT),
改完重跑模拟(脚本没进仓库: 照 pet_battle_service 的 calculate_damage / calculate_ultimate_damage /
next_combo_state / question_kinds 和 battle_moves 的 final_damage / miss_damage 写一个回合循环就是)。
"""
import hashlib
import json
from datetime import datetime
from functools import lru_cache
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pet_formulas import evolution_stage_for_level
from app.core.pet_species import PET_SPECIES, get_pet_element, get_pet_label
from app.models.pet_trial import PetTrialStage
from app.services.ai_opponent_service import AI_PET_SPECIES

# (场地 id, 给孩子看的名字)。id 与前端 fx.ts 的 ArenaId 同名,名字与 ARENA_NAME 同字
AREAS: list[tuple[str, str]] = [
    ("meadow", "青草原"),
    ("beach", "浅滩"),
    ("canyon", "红岩峡谷"),
    ("snow", "极光雪原"),
    ("storm", "雷暴高地"),
    ("volcano", "熔岩地"),
    ("moon", "月光林地"),
    ("sky", "云上神殿"),
]

# 属性 → 场地。与前端 components/battle/fx.ts 的 ELEMENT_ARENA 同一张表
ELEMENT_ARENA: dict[str, str] = {
    "normal": "meadow", "grass": "meadow", "bug": "meadow", "fairy": "meadow",
    "fire": "volcano", "dragon": "volcano",
    "ice": "snow",
    "water": "beach",
    "ghost": "moon", "dark": "moon", "psychic": "moon", "poison": "moon",
    "electric": "storm", "steel": "storm",
    "ground": "canyon", "rock": "canyon", "fighting": "canyon",
    "flying": "sky",
}

STAGES_PER_AREA = 5
LAP_STAGES = STAGES_PER_AREA * len(AREAS)   # 40

# 对手和孩子同级(五关都是 0,每圈也不加)。**别拿等级差调难度**: 进化是按等级卡线的(5 / 15 / 30 / 45 级),
# 差一级正好跨线,对手就多一个形态 —— 每下多打 8 点、多 20 点血。11-12 模拟: 第二圈对手 +1 级时,
# 4 级的孩子打守关胜率 17%,别的等级 40% 上下 —— 卡在线下面那一级的孩子平白吃亏。难度全靠下面的正确率调。
LEVEL_OFFSET = (0, 0, 0, 0, 0)
LEVEL_PER_LAP = 0
# AI 的正确率 = ACC_BASE + ACC_PER_AREA × 区域序号 + ACC_OFFSET[第几关] + ACC_PER_LAP × 圈数,封顶 ACC_MAX。
# 第 4 关是「答得准、血不厚」,守关是「血厚、答得没那么准」: 血厚的那一场更看孩子自己打出多少伤害,
# 答得又快又准的孩子赢面拉得开(见文件头的难度表)
ACC_BASE = 0.28
ACC_PER_AREA = 0.017
ACC_OFFSET = (0.0, 0.01, 0.02, 0.23, 0.13)
ACC_PER_LAP = 0.30
ACC_MAX = 0.92
# AI 几秒答题: 3.4–6.6 秒(越往后越快)。一回合要等两边都答完才结算,AI 拖到 8 秒的话
# 3 秒就答完的孩子每回合干等 5 秒(11-12 之前是 4–8.5 秒)。5 秒内答对伤害 +5,这个已经算在难度表里
SPEED_BASE_MS = 3400
SPEED_PER_AREA_MS = 100
SPEED_OFFSET_MS = (0, 0, 100, 200, 200)
SPEED_FLOOR_MS = 2000
SPEED_SPAN_MS = 3200
# 对手的血量 = 几下 × 一下(规则第 5 条)。「一下」= 孩子这一级的基础伤害(20 + 进化每档 8,和
# pet_battle_service.calculate_damage 里是同一组数,测试比对)+ 5(连对、速度加成折一点)。
# 为什么不用「公式血量 × 倍数」: 血量公式随等级涨得比伤害快,同一个倍数下 2 级的孩子 7 回合打完、
# 17 级的要 9–10 回合(近三成打满 10 回合)。按「几下」定,各等级的孩子打得一样长。
HIT_BASE = 20
HIT_PER_EVO = 8
HIT_FLAT = 5
HP_HITS = (8, 8, 8, 8, 10)
# 闯关里 AI 答错不掉血(规则第 6 条)。练习赛 / 真人对战照旧掉 10
AI_MISS_HURTS = False
# 守关这一场的题目里,孩子自己的薄弱词最多占几成(平时是六成): 守关专考他错过的词
BOSS_WEAK_SHARE = 1.0
BOSS_PREFIX = "守关 · "

# 第一次通过的额外奖励(规则第 11 条)
FIRST_CLEAR_BONUS = {False: {"food": 20, "xp": 30}, True: {"food": 60, "xp": 100}}

# 规则第 7 条: 闯关里属性克制只帮不坑
TYPE_ONLY_HELPS = True
# 闯关里「你克制对手」时伤害乘多少(练习赛 / 真人对战 / 影子是 ×2)。11-12 从 ×2 降到 ×1.3:
# ×2 时克制的那几片场地普通关又回到中位 4 回合打完、赢的场里只有 8% 放得出大招(见文件头的表)。
# 这个数建对战时记进这一场的 trial.type_mult,前端顶上那条克制提示读它
TYPE_HELP_MULT = 1.3
# 记进 trial 之前开的闯关(没有 type_mult 这个键): 照当时的规矩 ×2 打完
LEGACY_TYPE_HELP_MULT = 2.0


# ---------------------------------------------------------------- 第 n 关是什么

def locate(stage: int) -> tuple[int, int, int]:
    """第 n 关 → (第几圈 0 起, 区域序号 0–7, 区域里第几关 0–4)"""
    n = max(1, int(stage)) - 1
    lap, rest = divmod(n, LAP_STAGES)
    area_index, pos = divmod(rest, STAGES_PER_AREA)
    return lap, area_index, pos


def is_boss(stage: int) -> bool:
    return locate(stage)[2] == STAGES_PER_AREA - 1


@lru_cache(maxsize=None)
def candidates(arena: str) -> tuple[str, ...]:
    """这片场地出场的种族,固定顺序(规则第 3 条)。不含传说"""
    pool = [s for s in AI_PET_SPECIES if ELEMENT_ARENA.get(PET_SPECIES[s]["element"]) == arena]
    if not pool:
        # 现在每片场地至少 5 只。万一以后改属性表改到某片场地一只都没有,宁可出别的属性,也别让整张闯关地图报错
        pool = list(AI_PET_SPECIES)
    pool.sort(key=lambda s: hashlib.md5(f"{arena}:{s}".encode("utf-8")).hexdigest())
    return tuple(pool)


def species_for(stage: int) -> str:
    lap, area_index, pos = locate(stage)
    pool = candidates(AREAS[area_index][0])
    return pool[(lap * STAGES_PER_AREA + pos) % len(pool)]


def pet_name_for(species: str, boss: bool) -> str:
    """给孩子看的名字: 种族的中文名(去掉「家族」两个字),守关的前面加「守关 · 」"""
    label = get_pet_label(species) if species in PET_SPECIES else species
    if label.endswith("家族") and len(label) > 2:
        label = label[:-2]
    return f"{BOSS_PREFIX}{label}" if boss else label


NORMAL_POS = 0      # 普通关(一个区域的第 1–4 关)在 HP_HITS 里用哪一格;第 5 格是守关


def hits_hp(evolution_stage: int, pos: int = NORMAL_POS) -> int:
    """对手的血量按「几下」算(规则第 5 条): HP_HITS[第几关] × (20 + 8 × 进化 + 5)。pos 从 0 数。
    挑战影子(services/pet_shadow)用的也是这个函数、普通关那一档 —— 两边的一场要一样长,别各抄一份"""
    return int(round(HP_HITS[pos] * (HIT_BASE + HIT_PER_EVO * int(evolution_stage or 0) + HIT_FLAT)))


def plan(stage: int, my_level: int) -> dict:
    """第 n 关这一场的全部设定(孩子的出战宠物是 my_level 级时)"""
    stage = max(1, int(stage))
    lap, area_index, pos = locate(stage)
    arena, area_name = AREAS[area_index]
    boss = pos == STAGES_PER_AREA - 1
    species = species_for(stage)
    level = max(1, int(my_level or 1) + LEVEL_OFFSET[pos] + LEVEL_PER_LAP * lap)
    evo = evolution_stage_for_level(level)
    max_hp = hits_hp(evo, pos)
    accuracy = min(ACC_MAX, ACC_BASE + ACC_PER_AREA * area_index + ACC_OFFSET[pos] + ACC_PER_LAP * lap)
    speed_min = max(SPEED_FLOOR_MS, SPEED_BASE_MS - SPEED_PER_AREA_MS * area_index - SPEED_OFFSET_MS[pos])
    title = f"{area_name} · " + ("守关" if boss else f"第 {pos + 1} 关")
    if lap:
        title += f"(第 {lap + 1} 圈)"
    return {
        "stage": stage, "lap": lap, "area_index": area_index, "pos": pos + 1, "boss": boss,
        "arena": arena, "area_name": area_name, "title": title,
        "species": species, "element": get_pet_element(species), "pet_name": pet_name_for(species, boss),
        "level": level, "evolution_stage": evo, "max_hp": max_hp,
        "accuracy": round(accuracy, 3), "speed_min_ms": speed_min, "speed_max_ms": speed_min + SPEED_SPAN_MS,
    }


def ai_config_from(p: dict) -> dict:
    """这一场存进 pet_battles.ai_config 的那段: AI 出招照旧读 accuracy / speed_*,多一段 trial"""
    return {
        "name": p["pet_name"], "level": p["level"], "species": p["species"],
        "accuracy": p["accuracy"], "speed_min_ms": p["speed_min_ms"], "speed_max_ms": p["speed_max_ms"],
        "trial": {
            "stage": p["stage"], "boss": p["boss"], "arena": p["arena"], "area_name": p["area_name"],
            "title": p["title"], "lap": p["lap"], "area_index": p["area_index"], "pos": p["pos"],
            # 前端顶上那条「属性克制」提示按这个写: help_only = 只有「你克制对手」算数
            "type_rule": "help_only" if TYPE_ONLY_HELPS else "normal",
            # 「你克制对手」时伤害乘多少(闯关 ×1.3;提示里的数字读它,别写死「翻倍」)
            "type_mult": TYPE_HELP_MULT if TYPE_ONLY_HELPS else 2.0,
        },
    }


# ---------------------------------------------------------------- 这一场是不是闯关

def trial_of(battle) -> Optional[dict]:
    """这场对战是闯关的话,给出 ai_config 里那段 trial;不是(练习赛 / 真人对战 / 存坏了)给 None"""
    raw = getattr(battle, "ai_config", None)
    if not raw:
        return None
    try:
        cfg = json.loads(raw)
    except (TypeError, ValueError):
        return None
    trial = cfg.get("trial") if isinstance(cfg, dict) else None
    if not isinstance(trial, dict) or type(trial.get("stage")) is not int or trial["stage"] < 1:
        return None
    return trial


def help_mult_of(trial: Optional[dict]) -> float:
    """这一场闯关里「你克制对手」乘多少: 建对战时记在 trial.type_mult 里;老的闯关没有这个键 = ×2"""
    value = (trial or {}).get("type_mult")
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 1:
        return float(value)
    return LEGACY_TYPE_HELP_MULT


def soften_multiplier(mult: float, attacker_is_ai: bool, help_mult: Optional[float] = None) -> float:
    """规则第 7 条: AI 打孩子最多 1 倍(克制孩子的不算);孩子打 AI 最少 1 倍,克制对手时乘 help_mult(×1.3)"""
    if not TYPE_ONLY_HELPS:
        return mult
    if attacker_is_ai:
        return min(1.0, mult)
    if mult > 1.0:
        return TYPE_HELP_MULT if help_mult is None else help_mult
    return 1.0


def type_text(mult: float) -> str:
    """闯关里伤害数字下面那行小字。不写「伤害翻倍」—— 闯关里克制是 ×1.3,不是翻倍"""
    return "属性克制" if mult > 1.0 else ""


def stars_for(rounds_played: int, correct: int) -> int:
    """赢了的这一场几颗星(规则第 10 条)"""
    wrong = max(0, int(rounds_played or 0) - int(correct or 0))
    return 3 if wrong == 0 else 2 if wrong == 1 else 1


# ---------------------------------------------------------------- 进度

async def cleared_max(db: AsyncSession, user_id: int) -> int:
    """已经通过的最大关(一关没过是 0)。关是一关一关解锁的,所以通过的关是连着的"""
    return int((await db.execute(
        select(func.max(PetTrialStage.stage)).where(
            PetTrialStage.user_id == user_id, PetTrialStage.first_cleared_at.is_not(None),
        )
    )).scalar() or 0)


async def check_unlocked(db: AsyncSession, user_id: int, stage: int) -> None:
    """规则第 8 条。没这一关 404,还没轮到 403"""
    if stage < 1:
        raise HTTPException(status_code=404, detail={"code": "trial_no_such_stage", "message": "没有这一关。"})
    cleared = await cleared_max(db, user_id)
    if stage > cleared + 1:
        nxt = plan(cleared + 1, 1)
        raise HTTPException(status_code=403, detail={
            "code": "trial_locked",
            "message": f"这一关还没解锁。先通过第 {cleared + 1} 关({nxt['title']}),才能往后打。",
            "next_stage": cleared + 1,
        })


async def overview(db: AsyncSession, user_id: int, my_level: int) -> dict:
    """对战大厅的闯关地图: 现在这一圈的 8 个区域 40 关,每关的对手、几星、通过没有、能不能打"""
    rows = (await db.execute(
        select(PetTrialStage.stage, PetTrialStage.stars, PetTrialStage.attempts, PetTrialStage.first_cleared_at)
        .where(PetTrialStage.user_id == user_id)
    )).all()
    mine = {r.stage: r for r in rows}
    cleared = max((r.stage for r in rows if r.first_cleared_at is not None), default=0)
    next_stage = cleared + 1
    lap = (next_stage - 1) // LAP_STAGES
    areas = []
    for area_index, (arena, name) in enumerate(AREAS):
        stages = []
        for pos in range(STAGES_PER_AREA):
            n = lap * LAP_STAGES + area_index * STAGES_PER_AREA + pos + 1
            p = plan(n, my_level)
            row = mine.get(n)
            done = bool(row and row.first_cleared_at is not None)
            stages.append({
                "stage": n, "boss": p["boss"], "species": p["species"], "pet_name": p["pet_name"],
                "stars": int(row.stars) if done else 0, "cleared": done, "unlocked": n <= next_stage,
                # 下面几项是给画面用的: 对手什么属性、几级、用哪个形态的图、试过几次、这一关叫什么
                "element": p["element"], "level": p["level"], "evolution_stage": p["evolution_stage"],
                "attempts": int(row.attempts) if row else 0, "title": p["title"],
            })
        areas.append({
            "index": area_index, "arena": arena, "name": name, "stages": stages,
            "cleared": sum(1 for s in stages if s["cleared"]), "stars": sum(s["stars"] for s in stages),
        })
    return {
        "cleared": cleared,
        "next_stage": next_stage,
        "next_title": plan(next_stage, my_level)["title"],
        "total_stars": sum(int(r.stars) for r in rows if r.first_cleared_at is not None),
        "lap": lap,
        "stages_per_lap": LAP_STAGES,
        "areas": areas,
    }


async def settle(db: AsyncSession, battle, winner_id: Optional[int], forfeiter_id: Optional[int] = None) -> Optional[dict]:
    """闯关的这一场打完了: 记进度、算星星、看是不是第一次通过、要不要回满体力(规则 10–13)。

    只由 finish_battle 在「认领成功」之后调,和发奖励同一个事务;不 commit、不 rollback
    (对战的长连接会话里 rollback 会让手里的对象过期)。不是闯关的对战返回 None。
    进度那一行用一条 upsert 写(星星取大的,次数 +1);「第一次通过」用一条带条件的 UPDATE 认领,
    两条都不是先读再改。
    """
    trial = trial_of(battle)
    if not trial:
        return None
    user_id = battle.player1_id          # 闯关永远是 孩子(player1) 打 AI(player2)
    if not user_id or user_id <= 0:
        return None
    stage = int(trial["stage"])
    boss = bool(trial.get("boss"))
    rounds = int(battle.current_round or 0)
    won = winner_id == user_id and forfeiter_id != user_id and rounds >= 1
    stars = stars_for(rounds, battle.player1_total_correct) if won else 0
    first_clear = False
    best = 0
    if rounds >= 1:
        now = datetime.utcnow()
        ins = sqlite_insert(PetTrialStage).values(
            user_id=user_id, stage=stage, stars=stars, attempts=1, last_played_at=now,
        )
        await db.execute(ins.on_conflict_do_update(
            index_elements=[PetTrialStage.user_id, PetTrialStage.stage],
            set_={
                "stars": func.max(PetTrialStage.stars, ins.excluded.stars),
                "attempts": PetTrialStage.attempts + 1,
                "last_played_at": ins.excluded.last_played_at,
            },
        ))
        if won:
            claimed = await db.execute(
                update(PetTrialStage)
                .where(PetTrialStage.user_id == user_id, PetTrialStage.stage == stage,
                       PetTrialStage.first_cleared_at.is_(None))
                .values(first_cleared_at=now)
                .execution_options(synchronize_session=False)
            )
            first_clear = (claimed.rowcount or 0) == 1
        best = int((await db.execute(
            select(PetTrialStage.stars).where(PetTrialStage.user_id == user_id, PetTrialStage.stage == stage)
        )).scalar() or 0)
    bonus = dict(FIRST_CLEAR_BONUS[boss]) if first_clear else {"food": 0, "xp": 0}
    return {
        "stage": stage, "boss": boss, "title": trial.get("title"), "won": won,
        "stars": stars, "best_stars": best, "first_clear": first_clear,
        # 赢了体力回满(规则第 12 条)。真正回血在 finish_battle 结算各宠物血量的地方,它认这个标记
        "healed": won,
        # 赢了才有下一关(关不封顶,所以赢了一定有)
        "next_stage": stage + 1 if won else None,
        "bonus": bonus,
        "cleared": await cleared_max(db, user_id),
    }


def with_weak_words(ai_config_raw: Optional[str], count: int) -> Optional[str]:
    """把「这一场有几道题考的是他的薄弱词」写进 ai_config 的 trial 里(trial.weak_words)"""
    try:
        cfg: Any = json.loads(ai_config_raw or "")
    except (TypeError, ValueError):
        return ai_config_raw
    if not isinstance(cfg, dict) or not isinstance(cfg.get("trial"), dict):
        return ai_config_raw
    cfg["trial"]["weak_words"] = int(count)
    return json.dumps(cfg, ensure_ascii=False)


def with_result(ai_config_raw: Optional[str], result: dict) -> Optional[str]:
    """把结算结果写回 ai_config 那段 JSON(trial.result),刷新结算页时还读得到"""
    try:
        cfg: Any = json.loads(ai_config_raw or "")
    except (TypeError, ValueError):
        return ai_config_raw
    if not isinstance(cfg, dict) or not isinstance(cfg.get("trial"), dict):
        return ai_config_raw
    cfg["trial"]["result"] = result
    return json.dumps(cfg, ensure_ascii=False)
