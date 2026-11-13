"""宠物对战系统 - 核心业务逻辑"""
import json
import random
import re
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
    MAX_PET_SLOTS, MAX_LEGEND_SLOTS, calculate_initial_hp, calculate_max_hp, apply_xp_and_level,
    pet_recovery_goal, pet_slots_for_words, next_pet_slot_threshold,
    legend_slots_for_words, next_legend_slot_threshold,
)
from app.core.pet_species import (
    get_pet_element,
    get_pet_stage_name,
    get_type_multiplier,
    get_type_text,
    is_legendary,
    tier_power_bonus,
    words_required_for,
)
from app.core.pet_formulas import evolution_stage_for_level
from app.services import battle_moves, pet_shadow, pet_trial


PET_CAPTURE_CHANCE = 0.20

# AI 对手用的系统账号(负数 id,不是真人: 不发经验、不记统计、不参与「一人同时只打一场」)
AI_USER_ID = -1


async def load_player(db: AsyncSession, user_id: int) -> Optional[User]:
    """取对战里的一位玩家。AI 账号要绕开租户过滤:

    它挂在直营(org 1)名下,而 users 是租户锚点表 —— 分校的孩子按 id 取它会被过滤成「不存在」。
    11-12 之前快速对战就这么坏着: 取不到 → 当成第一次去新建 → 主键冲突 500,分校的孩子一场 AI 对战都开不了。
    真人照常走过滤(对手只能是本机构的)。
    """
    if user_id is None:
        return None
    if user_id > 0:
        return await db.get(User, user_id)
    return (await db.execute(
        select(User).where(User.id == user_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()


async def ensure_ai_user(db: AsyncSession) -> User:
    """AI 账号没有就建一个(整个库只建这一次)。org_id 写死直营,别让租户打戳写成当前孩子的机构"""
    ai_user = await load_player(db, AI_USER_ID)
    if ai_user is None:
        ai_user = User(
            id=AI_USER_ID,
            username="AI训练师",
            email="ai@system.local",
            hashed_password="",  # AI 不登录
            role="student",
            is_active=True,
            org_id=1,
        )
        db.add(ai_user)
        await db.flush()
    return ai_user


async def spawn_ai_pet(
    db: AsyncSession, *, name: str, species: str, level: int, max_hp: Optional[int] = None,
) -> UserPet:
    """给**这一场** AI 对战新建一只 AI 宠物(一场一行,is_active=False),只 flush 不 commit。

    11-12 之前所有孩子共用 AI 账号名下的同一行,每次开打就把它的名字 / 种族 / 等级改掉 ——
    周六十几个孩子同时打,A 打到一半,对手被 B 的那一场改成了另一只(等级、属性、伤害全变)。
    现在这一场的 player2_pet_id 指着自己的这一行,谁也改不到。旧的那一行(is_active=1)留着没删:
    老的对战记录还指着它。行会越攒越多(一场一行,线上一个月五六百行),不碍事,别去清 ——
    对战记录列表要按它取对手的名字。
    """
    evo = evolution_stage_for_level(level)
    pet = UserPet(
        user_id=AI_USER_ID,
        name=name,
        species=species,
        level=level,
        experience=0,
        evolution_stage=evo,
        happiness=100,
        hunger=100,
        current_hp=max_hp or calculate_initial_hp(level, evo, species),
        is_active=False,
    )
    db.add(pet)
    await db.flush()
    return pet


def capture_roll_succeeds(roll: float) -> bool:
    """收服判定，单独保留为纯函数便于验证边界。"""
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
    max_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
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

    # 收服是领养之外的第二条入队路径,门槛必须与 adopt_pet 同口径。
    # 否则只学了 300 词的孩子打赢一场就能把别人的梦幻抱走 —— 学词门槛等于形同虚设。
    if is_legendary(loser_pet.species):
        required = words_required_for(loser_pet.species)
        legend_used = sum(1 for pet in winner_pets if is_legendary(pet.species))
        if learned_words < required:
            result["reason"] = "legend_words_locked"
            result["required_words"] = required
            return result
        if legend_used >= MAX_LEGEND_SLOTS:
            result["reason"] = "legend_roster_full"
            return result
        if legend_used >= legend_slots_for_words(learned_words):
            result["reason"] = "legend_slot_locked"
            result["required_words"] = next_legend_slot_threshold(learned_words)
            return result
    else:
        normal_used = sum(1 for pet in winner_pets if not is_legendary(pet.species))
        if normal_used >= MAX_PET_SLOTS:
            result["reason"] = "roster_full"
            return result
        if normal_used >= unlocked_slots:
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
        detail="在真人对战落败后被收服，培养等级与进化阶段已保留",
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
    attacker_species: str | None = None,
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

    # 稀有度加成:准传说 +4 / 传说 +8。刻意做小 ——
    # 单次伤害 20~50 区间里 +8 约等于多一层连击,能感觉到强但不至于让答题失去意义。
    tier_bonus = tier_power_bonus(attacker_species)["damage"] if attacker_species else 0

    total_damage = base_damage + level_bonus + stage_bonus + combo_bonus + speed_bonus + tier_bonus

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
        # 新增家族的五个属性此前不在表里,全部走 40 兜底 —— 冰/恶/地面/毒/飞行/钢
        # 六个属性的大招伤害完全一样,补齐才有区分度
        "ice": 43,
        "dark": 45,
        "ground": 44,
        "poison": 41,
        "flying": 43,
        "steel": 46,
    }
    damage = base_ultimate_by_element.get(get_pet_element(pet_species), 40)
    stage_bonus = pet_stage * 10
    # 稀有度加成:大招是"高光时刻",这里给得比平A明显(准传说 +12 / 传说 +25),
    # 孩子放大招时能直观看到"我的传说就是不一样"
    tier_bonus = tier_power_bonus(pet_species)["ultimate"]
    return damage + stage_bonus + tier_bonus


# ========== 题目生成 ==========

async def _pick_battle_words(
    db: AsyncSession,
    wordbook_id: Optional[int],
    count: int,
    player_ids: Optional[List[int]] = None,
    weak_share: float = 0.6,
    stats: Optional[dict] = None,
) -> List[Word]:
    """
    选取对战词池,优先级:
    1. 指定单词本 → 该书的词(走 units→unit_words;book_words 是空表,别用)
    2. 参战学生的薄弱词优先(最多占6成),不足从背过的词补齐——
       对战顺带消化弱项,又不至于整场全是难词打击积极性
    3. 兜底:全库随机(仅当学生一条学习记录都没有时)
    只选带释义的词,避免出题时被跳过导致题数缩水。

    weak_share: 「先挑薄弱词」这一步最多挑几成。闯关的守关传 1.0 —— 这一场专考他自己错过的词,不够再照旧补。
        (后面从背过的词里补位是随机的,补到的也可能碰巧是薄弱词,所以一场里的薄弱词可能比这个比例多)
    stats: 传一个 dict 进来,会写上 weak_ids = 挑出来的词里哪些是他的薄弱词(不管是哪一步挑中的) ——
        守关要告诉孩子「这一关有几个是你错过的词」,这个数得是准的
    """
    from app.models.word import Unit, UnitWord
    from app.models.learning import WordMastery
    from app.services.weak_words import real_error_subquery, MASTERY_LINE

    def _with_definition(stmt, limit: int):
        return (
            stmt.join(WordDefinition, WordDefinition.word_id == Word.id)
            .group_by(Word.id)
            .order_by(func.random())
            .limit(limit)
        )

    if wordbook_id:
        stmt = _with_definition(
            select(Word)
            .join(UnitWord, UnitWord.word_id == Word.id)
            .join(Unit, Unit.id == UnitWord.unit_id)
            .where(Unit.book_id == wordbook_id),
            count,
        )
        words = list((await db.execute(stmt)).scalars().all())
        if words:
            return words

    real_player_ids = [pid for pid in (player_ids or []) if pid and pid > 0]
    if real_player_ids:
        picked: List[Word] = []
        picked_ids: set = set()

        # 薄弱词:口径同 services/weak_words.py 三档——掌握度<3 且计分模式真实答错过。
        # 别直接用 mastery_level<3(会把练得少的全对词打成薄弱)。
        err = real_error_subquery(real_player_ids)
        weak_stmt = _with_definition(
            select(Word)
            .join(err, err.c.wid == Word.id)
            .join(
                WordMastery,
                and_(
                    WordMastery.user_id == err.c.uid,
                    WordMastery.word_id == err.c.wid,
                ),
            )
            .where(WordMastery.mastery_level < MASTERY_LINE),
            max(1, min(count, int(count * weak_share))),
        )
        for word in (await db.execute(weak_stmt)).scalars().all():
            picked.append(word)
            picked_ids.add(word.id)

        remaining = count - len(picked)
        if remaining > 0:
            learned_stmt = (
                select(Word)
                .join(LearningRecord, LearningRecord.word_id == Word.id)
                .where(LearningRecord.user_id.in_(real_player_ids))
            )
            if picked_ids:
                learned_stmt = learned_stmt.where(Word.id.notin_(picked_ids))
            for word in (
                await db.execute(_with_definition(learned_stmt, remaining))
            ).scalars().all():
                picked.append(word)

        if picked:
            if stats is not None:
                # 挑出来的词里哪些是薄弱词: 按挑完的整份名单再查一遍(补位那一步也可能补到薄弱词)
                weak_rows = await db.execute(
                    select(err.c.wid)
                    .join(WordMastery, and_(WordMastery.user_id == err.c.uid, WordMastery.word_id == err.c.wid))
                    .where(WordMastery.mastery_level < MASTERY_LINE, err.c.wid.in_([w.id for w in picked]))
                )
                stats["weak_ids"] = {row[0] for row in weak_rows.all()}
            return picked

    stmt = _with_definition(select(Word), count)
    return list((await db.execute(stmt)).scalars().all())


# 三种题型(2026-11-12)。以前全是「看英文选中文」,线上正确率 84.7%,太容易,也只练了「认」:
#   en2zh  看英文选中文(原来那种)
#   zh2en  看中文选英文 —— 题目里不给单词(那就是答案),选项是 4 个英文单词
#   listen 听读音选中文 —— 单词照常给前端(要拿它去读),但页面上不显示
# 一场 10 题: 5 道 en2zh、3 道 zh2en、2 道 listen。第 1 题固定 en2zh(开场先来一道熟的),其余打乱。
KIND_EN2ZH = "en2zh"
KIND_ZH2EN = "zh2en"
KIND_LISTEN = "listen"
ZH2EN_SHARE = 0.3
LISTEN_SHARE = 0.2
LISTEN_TEXT = "听读音,选出它的意思"


def question_kinds(count: int) -> List[str]:
    """count 道题各是什么题型。按比例取整(四舍五入),至少一道 en2zh 而且排在第 1 题"""
    count = max(0, int(count))
    if count == 0:
        return []
    zh = int(count * ZH2EN_SHARE + 0.5)
    listen = int(count * LISTEN_SHARE + 0.5)
    while zh + listen > count - 1 and (zh or listen):
        if listen >= zh:
            listen -= 1
        else:
            zh -= 1
    rest = [KIND_EN2ZH] * (count - 1 - zh - listen) + [KIND_ZH2EN] * zh + [KIND_LISTEN] * listen
    random.shuffle(rest)
    return [KIND_EN2ZH] + rest


def _spelling(word: str) -> str:
    return (word or "").strip().lower()


def _meaning_gives_away(meaning: str, word: str) -> bool:
    """释义里直接写着这个单词(比如「(=center) 中心」): 拿它出「看中文选英文」等于把答案印在题目上"""
    sp = _spelling(word)
    if not sp:
        return True
    return re.search(rf"(?<![a-z]){re.escape(sp)}(?![a-z])", (meaning or "").lower()) is not None


def public_question(q: Dict) -> Dict:
    """答题结束之前发给孩子的那一份题目(new_round)。

    **zh2en 的 word 必须是空串** —— 它就是答案。老对战 / 老数据的题目没有 kind、display 这两个键,
    按 en2zh、display = 单词 兜着(上线那一刻正在打的对战不能崩)。不认识的题型也按 en2zh。
    **题目里的 spells(每个玩家放大招要拼的词)也是答案,这里不带**: 下面是一个键一个键挑出来的,
    往题目里加新东西不会自己漏出去。咒语发给孩子的那一份由调用方另外加(见 spell_for_player)。
    """
    kind = q.get("kind") or KIND_EN2ZH
    word = q.get("word") or ""
    if kind == KIND_ZH2EN:
        shown, display = "", (q.get("display") or q.get("meaning") or "")
    elif kind == KIND_LISTEN:
        shown, display = word, None
    else:
        kind, shown, display = KIND_EN2ZH, word, (q.get("display") or word)
    return {
        "word_id": q["word_id"], "word": shown, "question_text": q.get("question_text") or "",
        "options": q.get("options") or [], "kind": kind, "display": display,
    }


def result_question(q: Dict) -> Dict:
    """回合结算时给的那一份(round_result): 完整的单词、正确答案、中文意思都给"""
    out = public_question(q)
    out["word"] = q.get("word") or ""
    out["correct_answer"] = q.get("correct_answer")
    out["meaning"] = question_meaning(q)
    return out


def question_meaning(q: Dict) -> str:
    """这道题的单词是什么中文意思。新题目直接存着;老题目(都是看英文选中文)从正确选项里取"""
    if q.get("meaning"):
        return q["meaning"]
    if (q.get("kind") or KIND_EN2ZH) == KIND_ZH2EN:
        return q.get("display") or ""          # 选项是英文单词,不能拿正确选项当中文意思
    correct = q.get("correct_answer")
    return next((o[3:] for o in (q.get("options") or []) if o[:1] == correct and len(o) > 3), "")


def _lettered(options: List[str], correct: str) -> Tuple[List[str], str]:
    random.shuffle(options)
    return [f"{chr(65 + i)}. {opt}" for i, opt in enumerate(options)], chr(65 + options.index(correct))


async def _meaning_distractors(db: AsyncSession, word_id: int, correct_meaning: str) -> List[str]:
    """3 个别的词的中文意思(彼此不重复)"""
    rows = await db.execute(
        select(WordDefinition.meaning)
        .where(and_(WordDefinition.word_id != word_id, WordDefinition.meaning != correct_meaning))
        .group_by(WordDefinition.meaning)
        .order_by(func.random())
        .limit(3)
    )
    distractors = [row[0] for row in rows.all() if row[0]]
    if len(distractors) < 3:
        # 如果干扰项不足,补充通用选项
        fallback = ["高兴的", "悲伤的", "愤怒的", "害怕的", "惊讶的"]
        distractors.extend([f for f in fallback if f not in distractors and f != correct_meaning])
        distractors = distractors[:3]
    return distractors


async def _spelling_distractors(
    db: AsyncSession, word: Word, meaning: str, pool: List[Tuple[Word, str]],
) -> List[str]:
    """「看中文选英文」的 3 个干扰单词。先从这一场的词池里挑(都是孩子背过的词,最像样),不够再全库随机。
    不能和正确的词拼写一样(不分大小写),主释义和正确的词一模一样的也不要(不然两个选项都对)。"""
    target = _spelling(word.word)
    seen = {target}
    picked: List[str] = []
    others = [(w, m) for w, m in pool if w.id != word.id]
    random.shuffle(others)
    for other, other_meaning in others:
        sp = _spelling(other.word)
        if not sp or sp in seen or other_meaning == meaning:
            continue
        seen.add(sp)
        picked.append(other.word.strip())
        if len(picked) == 3:
            return picked
    same_meaning = select(WordDefinition.word_id).where(WordDefinition.meaning == meaning)
    rows = await db.execute(
        select(Word.word)
        .join(WordDefinition, WordDefinition.word_id == Word.id)
        .where(Word.id != word.id, Word.id.notin_(same_meaning))
        .group_by(Word.id)
        .order_by(func.random())
        .limit(12)
    )
    for (text,) in rows.all():
        sp = _spelling(text)
        if not sp or sp in seen:
            continue
        seen.add(sp)
        picked.append(text.strip())
        if len(picked) == 3:
            break
    return picked


async def generate_battle_questions(
    db: AsyncSession,
    wordbook_id: Optional[int],
    count: int = 10,
    player_ids: Optional[List[int]] = None,
    weak_share: float = 0.6,
    spells: bool = False,
    stats: Optional[dict] = None,
) -> List[Dict]:
    """
    生成对战题目

    Args:
        db: 数据库会话
        wordbook_id: 单词本ID(为空则从学生背过的词里抽)
        count: 题目数量
        player_ids: 参战玩家ID(AI 等负数ID自动忽略)

    Returns:
        题目列表。每道题: word_id / word / question_text / options / correct_answer,
        外加 kind(题型)、display(题目里大字显示什么)、meaning(这个词的中文意思,结算和复习用)。
        spells=True 时每道题还带 spells: {"<玩家 id>": {word_id, word, meaning}}(放大招要拼的那个词,
        规则见 services/battle_moves)。
        **这是存在库里的完整版**(zh2en 带着单词、spells 带着答案): 发给孩子之前一律过 public_question。
    stats: 传一个 dict 进来,会写上 weak_words = 这些题里有几道考的是他的薄弱词
    """
    pick_stats: dict = {}
    words = await _pick_battle_words(db, wordbook_id, count, player_ids, weak_share=weak_share, stats=pick_stats)

    # 每个词的主要释义;没有释义的词出不了题
    pool: List[Tuple[Word, str]] = []
    for word in words:
        definition_result = await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == word.id)
            .order_by(WordDefinition.is_primary.desc())
            .limit(1)
        )
        main_def = definition_result.scalar_one_or_none()
        if main_def and main_def.meaning:
            pool.append((word, main_def.meaning))

    if not pool:
        raise ValueError("没有可用的单词出题,先去学几个单词再来对战吧")

    # 词池不够时重复补足(同 PK 的 fill_with_repeats 策略),
    # 保证题目数 == 回合数,否则回合数越界会让整场对战中途崩掉。一轮一轮地补,重复得匀一点
    sequence = list(pool)
    while len(sequence) < count:
        again = list(pool)
        random.shuffle(again)
        sequence.extend(again[: count - len(sequence)])
    sequence = sequence[:count]

    kinds_left = question_kinds(len(sequence))
    used_kinds: Dict[int, set] = {}
    questions: List[Dict] = []
    for i, (word, meaning) in enumerate(sequence):
        used = used_kinds.setdefault(word.id, set())
        # 第 1 题固定是 en2zh;后面的照排好的顺序取,但同一个词再出现时尽量换个题型
        pick = 0 if i == 0 else next((j for j, k in enumerate(kinds_left) if k not in used), 0)
        kind = kinds_left.pop(pick)

        options: List[str] = []
        if kind == KIND_ZH2EN:
            wrong = [] if _meaning_gives_away(meaning, word.word) else await _spelling_distractors(db, word, meaning, pool)
            if len(wrong) == 3:
                options, correct_answer = _lettered([word.word.strip()] + wrong, word.word.strip())
                question_text, display = f"哪个单词的意思是「{meaning}」?", meaning
            else:
                kind = KIND_EN2ZH      # 凑不出 3 个像样的干扰单词(词库太小 / 释义里带着答案): 退回看英文选中文
        if kind != KIND_ZH2EN:
            options, correct_answer = _lettered(
                [meaning] + await _meaning_distractors(db, word.id, meaning), meaning,
            )
            if kind == KIND_LISTEN:
                question_text, display = LISTEN_TEXT, None
            else:
                question_text, display = f"单词 '{word.word}' 的意思是?", word.word
        used.add(kind)

        questions.append({
            "word_id": word.id,
            "word": word.word,
            "question_text": question_text,
            "options": options,
            "correct_answer": correct_answer,
            "kind": kind,
            "display": display,
            "meaning": meaning,
        })

    if spells:
        await battle_moves.attach_spells(db, questions, player_ids or [], pool)
    if stats is not None:
        weak_ids = pick_stats.get("weak_ids") or set()
        stats["weak_words"] = sum(1 for q in questions if q["word_id"] in weak_ids)

    return questions


# ========== 对战逻辑 ==========

async def create_battle(
    db: AsyncSession,
    player1_id: int,
    player2_id: int,
    wordbook_id: Optional[int] = None,
    mode: str = "casual",
    max_rounds: int = 10,
    pet2: Optional[UserPet] = None,
    pet2_max_hp: Optional[int] = None,
    weak_share: float = 0.6,
    stats: Optional[dict] = None,
) -> PetBattle:
    """创建对战。

    pet2: AI 对战传这一场自己的那只 AI 宠物(spawn_ai_pet),不传就按「对方现在出战的那只」找(真人对战)。
    pet2_max_hp: 闯关的守关血量比公式多,传了就按它当对手的血量上限和开场血量(三处同一个数)。
    weak_share: 这一场的题目里薄弱词最多占几成(守关 1.0)。stats: 见 generate_battle_questions。

    这里顺手把这一场的玩法定下来(规则见 services/battle_moves),之后整场不变:
    开没开「出招三选一 / 大招要拼咒语」、两位真人各带着哪些学习增益。
    """
    # 检查双方宠物
    pet1_result = await db.execute(select(UserPet).where(
        UserPet.user_id == player1_id,
        UserPet.is_active.is_(True),
    ))
    pet1 = pet1_result.scalar_one_or_none()

    if pet2 is None:
        pet2_result = await db.execute(select(UserPet).where(
            UserPet.user_id == player2_id,
            UserPet.is_active.is_(True),
        ))
        pet2 = pet2_result.scalar_one_or_none()

    if not pet1 or not pet2:
        raise ValueError("双方必须都有宠物才能对战")

    # 每只宠物从自己的当前 HP 进入本场战斗。
    max_hp1 = calculate_initial_hp(pet1.level, pet1.evolution_stage, pet1.species)
    hp1 = get_pet_current_hp(pet1)
    if pet2_max_hp:
        max_hp2 = hp2 = int(pet2_max_hp)
    else:
        max_hp2 = calculate_initial_hp(pet2.level, pet2.evolution_stage, pet2.species)
        hp2 = get_pet_current_hp(pet2)
    if hp1 <= 0 or hp2 <= 0:
        raise ValueError("双方宠物都需要有剩余生命值才能对战")

    # 这一场的玩法: 平台的三个开关在这里读一次、记在这一场里(打到一半平台改了开关,这一场不变)
    from app.services import battle_tickets
    settings = await battle_tickets.get_settings(db)
    play = {"stances": bool(settings.get("stances")), "spell_ultimate": bool(settings.get("spell_ultimate"))}

    # 生成题目(从参战学生背过的词里抽)
    questions = await generate_battle_questions(
        db, wordbook_id, max_rounds, player_ids=[player1_id, player2_id],
        weak_share=weak_share, spells=play["spell_ultimate"], stats=stats,
    )

    # 学习增益(只给真人): 攻击 +10% / 开局 1 格大招 / 体力 +10%
    buffs: Dict[int, List[Dict]] = {}
    charges = {player1_id: 0, player2_id: 0}
    for pid in (player1_id, player2_id):
        if pid <= 0:
            continue
        buffs[pid] = await battle_moves.buffs_for(db, await db.get(User, pid), bool(settings.get("study_buffs")))
        keys = {b["key"] for b in buffs[pid]}
        if battle_moves.BUFF_REVIEW in keys:
            charges[pid] = battle_moves.REVIEW_CHARGES
        if battle_moves.BUFF_WORDS in keys:
            # 血量上限 +10%,开局也多这么多血(不超过加过的上限);打完存回宠物时按真实上限封顶
            if pid == player1_id:
                extra = int(max_hp1 * battle_moves.WORDS_HP) - max_hp1
                max_hp1, hp1 = max_hp1 + extra, hp1 + extra
            else:
                extra = int(max_hp2 * battle_moves.WORDS_HP) - max_hp2
                max_hp2, hp2 = max_hp2 + extra, hp2 + extra

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
        buffs_data=battle_moves.dump_buffs(buffs, play),
        player1_ultimate_charges=charges[player1_id],
        player2_ultimate_charges=charges[player2_id],
        expires_at=datetime.utcnow() + timedelta(seconds=60),  # 60秒后过期
    )

    db.add(battle)
    await db.commit()
    await db.refresh(battle)

    return battle


async def claim_exclusive_battle(db: AsyncSession, battle: PetBattle) -> bool:
    """一人同时只能打一场(2026-10-06,多开浏览器刷经验)。返回这场是否保留。

    生产实测: 同一学生 14 天里 1182 场对战与自己的另一场时间重叠(单日最多 471 场),
    每个标签页各开一场 AI 对战、各自结算经验和粮食;另一场结束时还会用开局血量
    覆盖掉前一场打出的伤 → 受伤不用治疗。

    规则「**最新开打的那场为准**」(按 id): 调用时这场必须已是 active 且已提交。
      1. 作废双方 id 更小的进行中/待开始对战(cancelled,结算时拿不到奖励 ——
         finish_battle 的条件认领只认 active)
      2. 若双方还有 id 更大的进行中对战,说明有更新的一场 → 作废自己
    两个标签同时开: 不论两边语句怎么交错,id 大的那场一定留下、小的一定被作废,
    不会出现「互相作废、两场都没了」。只靠 SQLite 写串行,不依赖进程内状态。
    AI 训练师(负数 ID)不参与。
    """
    players = [pid for pid in (battle.player1_id, battle.player2_id) if pid and pid > 0]
    if not players:
        return True
    involves = or_(PetBattle.player1_id.in_(players), PetBattle.player2_id.in_(players))
    now = datetime.utcnow()
    await db.execute(
        update(PetBattle)
        .where(and_(PetBattle.id < battle.id,
                    PetBattle.status.in_(("active", "pending")), involves))
        .values(status="cancelled", finished_at=now)
        .execution_options(synchronize_session=False)
    )
    newer = (await db.execute(
        select(PetBattle.id).where(and_(
            PetBattle.id > battle.id, PetBattle.status == "active", involves,
        )).limit(1)
    )).first()
    if newer is not None:
        await db.execute(
            update(PetBattle)
            .where(PetBattle.id == battle.id, PetBattle.status == "active")
            .values(status="cancelled", finished_at=now)
            .execution_options(synchronize_session=False)
        )
    await db.commit()
    return newer is None


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
    if not await claim_exclusive_battle(db, battle):
        raise ValueError("你正在进行另一场对战,先打完那一场吧")
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
    stance: Optional[str] = None,
    spell: Optional[str] = None,
    legacy_client: bool = False,
) -> Tuple[PetBattle, PetBattleRound]:
    """
    处理回合答题

    stance: 出招(normal / heavy / guard);spell: 放大招时孩子拼的那个单词。规则见 services/battle_moves。
    legacy_client: 这份答案是还没刷新的老页面交的(不认识咒语)—— 点大招照老规矩直接放,不看咒语。

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

    # 获取或创建回合记录。populate_existing: AI 是在它自己的会话里答题的(见 pet_battle_ws.schedule_ai_answer),
    # 这个会话里要是缓存着这一行的旧样子,下面「已经答过题了」就会判错 —— 一律按库里现在的为准
    round_result = await db.execute(
        select(PetBattleRound).where(
            and_(
                PetBattleRound.battle_id == battle_id,
                PetBattleRound.round_number == round_number,
            )
        ).execution_options(populate_existing=True)
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
    answered = answer.upper() in ("A", "B", "C", "D")      # 超时没答存的是 X
    play = battle_moves.battle_play(battle)
    # AI 一律普通出招;开关关着 / 老对战全当 normal
    stance = battle_moves.clean_stance(stance, play["stances"] and player_id > 0)

    # 大招要拼出来(规则见 services/battle_moves 第 10 条): 只有真人、这一场开着、这一回合给他备了咒语词才要拼。
    # 老页面(legacy_client)不认识咒语: 当成这一回合没有咒语,照老规矩直接放(第 12 条)
    needs_spell = play["spell_ultimate"] and player_id > 0 and not legacy_client
    spell_word = battle_moves.spell_of(question, player_id) if needs_spell else None
    wants_ultimate = bool(use_ultimate) and is_correct and available_charges > 0
    spell_note = None
    if wants_ultimate and spell_word:
        ok = battle_moves.spell_matches(spell, spell_word["word"])
        spell_note = {"ok": ok, "word": spell_word["word"], "meaning": spell_word.get("meaning") or "",
                      "word_id": spell_word.get("word_id"), "typed": (spell or "").strip()[:40]}
        if not ok:
            # 拼错 / 没拼: 只算一记普通攻击,那一格不扣(下一回合换个词再试);拼错的词排进后面的复习
            wants_ultimate = False
            if spell_word.get("word_id"):
                await note_battle_miss(db, player_id, spell_word["word_id"])
    actual_used_ultimate = wants_ultimate

    # 技能只在答案正确且已有充能时释放；答错仍按普通答错结算且不消耗技能。
    if actual_used_ultimate:
        damage = calculate_ultimate_damage(attacker_pet.species, attacker_pet.evolution_stage)
        stance = battle_moves.STANCE_ULTIMATE

        # 消耗充能
        if is_player1:
            battle.player1_ultimate_charges -= 1
        else:
            battle.player2_ultimate_charges -= 1
    elif is_correct:
        # 普通攻击(这里存的是「基础伤害」: 出招 / 增益 / 属性克制 / 对方防守的倍率都在 finalize_round 里乘)
        if use_ultimate:
            stance = battle_moves.STANCE_NORMAL      # 想放大招没放出来: 按普通攻击算,不吃重击 / 防守
        damage = calculate_damage(
            attacker_pet.level,
            attacker_pet.evolution_stage,
            defender_pet.level,
            defender_pet.evolution_stage,
            True,
            combo,
            time_ms,
            attacker_pet.species,
        )
    else:
        # 答错: 普通掉 10、重击掉 20、防守不掉;超时没答不管选了什么都按普通算
        if use_ultimate or not answered:
            stance = battle_moves.STANCE_NORMAL
        damage = battle_moves.miss_damage(stance, answered)
        if player_id <= 0 and not pet_trial.AI_MISS_HURTS and paced_rules(battle):
            damage = 0      # 闯关 / 影子里 AI 答错不掉血(规则见 services/pet_trial 第 6 条)

    # 对战里真答错的词(不是超时): 把它的复习往前排(见 note_battle_miss)
    if not is_correct and player_id > 0 and answered:
        await note_battle_miss(db, player_id, question["word_id"])

    # 记录答题
    if is_player1:
        round_obj.player1_answer = answer
        round_obj.player1_correct = is_correct
        round_obj.player1_submit_time = datetime.utcnow()
        round_obj.player1_time_ms = time_ms
        round_obj.player1_damage = damage
        round_obj.player1_used_ultimate = actual_used_ultimate
        round_obj.player1_stance = stance
    else:
        round_obj.player2_answer = answer
        round_obj.player2_correct = is_correct
        round_obj.player2_submit_time = datetime.utcnow()
        round_obj.player2_time_ms = time_ms
        round_obj.player2_damage = damage
        round_obj.player2_used_ultimate = actual_used_ultimate
        round_obj.player2_stance = stance
    # 防守还答对了 = 「拿不准」的词: 孩子选防守说明没把握,多半是蒙对的。记下来,结算页标「拿不准」。
    # 不算错(不走 note_battle_miss、不影响星星),只是个提醒
    unsure = is_correct and player_id > 0 and stance == battle_moves.STANCE_GUARD
    if spell_note or unsure:
        extra = round_extra(round_obj)
        mine = extra.setdefault("p1" if is_player1 else "p2", {})
        if spell_note:
            mine["spell"] = spell_note
        if unsure:
            mine["unsure"] = True
        round_obj.extra_data = json.dumps(extra, ensure_ascii=False)

    # 更新连击。防守答错(真选了、选错了): 连对不断也不涨 —— 这是防守换来的
    keep_combo = (not is_correct) and answered and stance == battle_moves.STANCE_GUARD
    if keep_combo:
        pass
    elif is_player1:
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


def _spelled(round_obj, extra: Dict, key: str) -> bool:
    """这一方这一回合的大招是不是「拼对了咒语」放出来的(是的话伤害 ×1.5,规则见 services/battle_moves 第 13 条)。
    只认回合小账里记下的 spell.ok: AI 的大招、没咒语可拼直接放的、平台关了咒语点一下就放的,小账里都没有这一项"""
    used = round_obj.player1_used_ultimate if key == "p1" else round_obj.player2_used_ultimate
    mine = extra.get(key) if isinstance(extra.get(key), dict) else {}
    spell = mine.get("spell") if isinstance(mine.get("spell"), dict) else None
    return bool(used) and bool(spell and spell.get("ok"))


def round_extra(round_obj) -> Dict:
    """这一回合的小账(pet_battle_rounds.extra_data): 谁挨的打被防守减过、谁试了咒语。老记录是空的"""
    raw = getattr(round_obj, "extra_data", None)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def round_moves(round_obj) -> Dict:
    """回合结果里给前端的那几项: 两边的出招、挨的打有没有被防守减过、咒语试得怎么样(结算时才给答案)"""
    extra = round_extra(round_obj)

    def side(key: str, stance, used_ultimate) -> Tuple[str, bool, Optional[Dict]]:
        mine = extra.get(key) if isinstance(extra.get(key), dict) else {}
        spell = mine.get("spell") if isinstance(mine.get("spell"), dict) else None
        if spell:
            spell = {"ok": bool(spell.get("ok")), "word": spell.get("word") or "",
                     "meaning": spell.get("meaning") or "", "typed": spell.get("typed") or ""}
        shown = battle_moves.STANCE_ULTIMATE if used_ultimate else (stance or battle_moves.STANCE_NORMAL)
        return shown, bool(mine.get("guarded")), spell

    s1, g1, sp1 = side("p1", round_obj.player1_stance, round_obj.player1_used_ultimate)
    s2, g2, sp2 = side("p2", round_obj.player2_stance, round_obj.player2_used_ultimate)
    return {
        "player1_stance": s1, "player2_stance": s2,
        "player1_guarded": g1, "player2_guarded": g2,
        "player1_spell": sp1, "player2_spell": sp2,
    }


def spell_for_player(battle, question: Dict, round_number: int, player_id: int) -> Optional[Dict]:
    """出题时发给这个玩家的咒语(不带单词);这一回合他没有大招 / 没给他备词 / 这一场没开 → None。
    规则见 services/battle_moves 第 8 条"""
    if not player_id or player_id <= 0 or not battle_moves.battle_play(battle)["spell_ultimate"]:
        return None
    charges = battle.player1_ultimate_charges if player_id == battle.player1_id else battle.player2_ultimate_charges
    if (charges or 0) < 1:
        return None
    return battle_moves.spell_public(battle_moves.spell_of(question, player_id), battle.id, round_number, player_id)


# 答题用时不能全信前端(2026-11-12): 3 秒内答对 +10、5 秒内 +5 用的是页面报上来的 time_ms,
# 改一行 JS 永远报 500 毫秒就永远吃满加成。服务端自己也掐一份(发题 → 收到答案),减掉网络来回的宽限,
# 和页面报的取大的那个。正常的孩子页面报的本来就不比服务端掐的短,不受影响。
TIME_GRACE_MS = 1500


def fair_time_ms(client_ms: int, server_ms: Optional[float], limit_ms: int) -> int:
    """孩子这一题算多少毫秒: max(页面报的, 服务端掐的 − 1.5 秒宽限),夹在 [0, 时限]。
    server_ms 给 None = 服务端这一题没掐到(不该发生),只好信页面的"""
    t = int(client_ms or 0)
    if server_ms is not None:
        t = max(t, int(server_ms) - TIME_GRACE_MS)
    return max(0, min(int(limit_ms), t))


def new_round_question(battle, question: Dict, round_number: int, player_id: Optional[int]) -> Dict:
    """出题时发给某个玩家的那一份题目: public_question + 他自己的咒语(有的话)。
    player_id 给 None = 不带任何人的咒语(发给不该看到的人 / 旁观)"""
    out = public_question(question)
    out["spell"] = spell_for_player(battle, question, round_number, player_id) if player_id else None
    return out


def round_time_limit(battle, question: Dict, round_number: int) -> int:
    """这一回合的时限(秒): 有真人这一回合要拼咒语就 +10 秒(规则见 services/battle_moves 第 9 条)"""
    base = int(battle.time_per_question or 15)
    for pid in (battle.player1_id, battle.player2_id):
        if spell_for_player(battle, question, round_number, pid):
            return base + battle_moves.SPELL_EXTRA_SECONDS
    return base


async def recorded_answers(db: AsyncSession, battle_id: int, round_number: int) -> Dict[int, bool]:
    """这一回合库里已经记下了谁的答案 → {玩家 id: True}。

    正常打的时候回合刚开始一定是空的。驱动循环断过、重新接上再走到这一回合时才会有:
    已经记下的那一方不用再答(AI 不再出一次招,孩子的答案不作废),也不会被处理第二遍。
    """
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        return {}
    row = (await db.execute(
        select(PetBattleRound).where(
            and_(PetBattleRound.battle_id == battle_id, PetBattleRound.round_number == round_number)
        ).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if row is None:
        return {}
    out: Dict[int, bool] = {}
    if row.player1_answer:
        out[battle.player1_id] = True
    if row.player2_answer:
        out[battle.player2_id] = True
    return out


async def note_battle_miss(db: AsyncSession, user_id: int, word_id: int) -> None:
    """对战里答错的词,把它的复习往前排(2026-11-11)。

    近 30 天对战答了 2,391 题,以前答完就没了。现在答错的词走 mastery.apply_answer 记一次答错:
    复习阶梯退两级、下次复习时间提前 —— 之后的「今日复习」会挑到它。四条边界:
      1. **只动他已经学过的词**(已有掌握度那一行)。没学过的词(选了书对战、词池兜底)不建行 ——
         否则一个从没学过的词凭一次对战就进了复习队列
      2. **不写学习记录**(learning_records): 每天学了几个词、对战场数「每学 20 个词加一场」都按学习记录数,
         写了就成了「打对战给自己挣场数」
      3. 超时没答的不算(调用方只在真选了 A–D 时调): 没看清题不等于不会
      4. 答对的不记: 四选一有 25% 是蒙的,不能凭它把词往「掌握」推
    不 commit,跟着这一回合的答题一起提交。
    """
    from app.models.learning import WordMastery
    from app.services import mastery as mastery_svc

    has_row = (await db.execute(
        select(WordMastery.id)
        .where(WordMastery.user_id == user_id, WordMastery.word_id == word_id)
        .limit(1)
    )).scalar()
    if not has_row:
        return
    await mastery_svc.apply_answer(db, user_id, word_id, "pet_battle", False)


async def battle_review(db: AsyncSession, battle_id: int) -> List[Dict]:
    """这一场每一题的单词、正确的中文、两边答对没有(结算页用)。
    answered = 真选了 A–D(超时那条存的是 X): 没看清题和答错分开说。

    单词和中文意思从这一场的题目(questions_data)里取: 「看中文选英文」的正确选项是英文单词,
    「听读音」的题干里没有单词 —— 只看回合记录的话,会把英文当成中文意思给出去、单词一栏是空的。
    题目里对不上的(很老的对战)才按老办法从题干和选项里拆。"""
    rows = (await db.execute(
        select(PetBattleRound).where(PetBattleRound.battle_id == battle_id)
        .order_by(PetBattleRound.round_number)
    )).scalars().all()
    battle = await db.get(PetBattle, battle_id)
    try:
        questions = json.loads(battle.questions_data or "[]") if battle else []
    except (TypeError, ValueError):
        questions = []
    if not isinstance(questions, list):
        questions = []
    out: List[Dict] = []
    for r in rows:
        q = questions[r.round_number - 1] if 0 < r.round_number <= len(questions) else None
        if not isinstance(q, dict) or q.get("word_id") != r.question_word_id:
            q = None
        if q:
            word, meaning = q.get("word") or "", question_meaning(q)
        else:
            try:
                options = json.loads(r.options or "[]")
            except ValueError:
                options = []
            meaning = next((o[3:] for o in options if o[:1] == r.correct_answer and len(o) > 3), "")
            # question_text 的格式是 单词 'xxx' 的意思是? ;取不到就留空,前端按 word_id 兜底
            word = (r.question_text or "").split("'")[1] if (r.question_text or "").count("'") >= 2 else ""
        extra = round_extra(r)

        def _unsure(key: str) -> bool:
            return bool(extra.get(key, {}).get("unsure")) if isinstance(extra.get(key), dict) else False

        out.append({
            "round": r.round_number,
            "word_id": r.question_word_id,
            "word": word,
            "meaning": meaning,
            "player1_correct": bool(r.player1_correct),
            "player2_correct": bool(r.player2_correct),
            "player1_answered": (r.player1_answer or "").upper() in ("A", "B", "C", "D"),
            "player2_answered": (r.player2_answer or "").upper() in ("A", "B", "C", "D"),
            # 防守还答对了 = 对的,但拿不准(多半是蒙的)。按人分开;unsure = 有一方拿不准
            "player1_unsure": _unsure("p1"),
            "player2_unsure": _unsure("p2"),
            "unsure": _unsure("p1") or _unsure("p2"),
        })
        # 放大招时拼错的咒语词也列出来(结算页「这几个词再看一眼」): spell = True,谁拼错的那一方算「答了、没对」
        for key in ("p1", "p2"):
            sp = extra.get(key, {}).get("spell") if isinstance(extra.get(key), dict) else None
            if not isinstance(sp, dict) or sp.get("ok") or not sp.get("word"):
                continue
            out.append({
                "round": r.round_number,
                "word_id": sp.get("word_id") or 0,
                "word": sp["word"],
                "meaning": sp.get("meaning") or "",
                "player1_correct": key != "p1", "player2_correct": key != "p2",
                "player1_answered": key == "p1", "player2_answered": key == "p2",
                "spell": True,
                "typed": sp.get("typed") or "",
            })
    return out


async def anyone_can_switch(db: AsyncSession, battle: PetBattle) -> bool:
    """有没有哪位真人现在能换宠物(与 build_battle_response 里 can_switch 同一套条件):
    自己场上这只还活着,且队伍里另有一只没受伤、还有血的。都换不了就不用留 8 秒的换宠时间。"""
    hp_data = get_battle_pet_hp_data(battle)
    sides = (
        (battle.player1_id, battle.player1_pet_id, battle.player1_hp),
        (battle.player2_id, battle.player2_pet_id, battle.player2_hp),
    )
    for player_id, current_pet_id, hp in sides:
        if not player_id or player_id <= 0 or hp <= 0:
            continue
        pets = (await db.execute(select(UserPet).where(UserPet.user_id == player_id))).scalars().all()
        for pet in pets:
            if pet.id == current_pet_id or pet.is_injured:
                continue
            if hp_data.get(str(pet.id), get_pet_current_hp(pet)) > 0:
                return True
    return False


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
    if player_id <= 0:
        # AI 账号名下是每场一只的一堆行,不是一支队伍
        raise ValueError("AI 对手不换宠物")

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
    new_max_hp = calculate_max_hp(target_pet.level, target_pet.evolution_stage, target_pet.species)
    if battle_moves.has_buff(battle, player_id, battle_moves.BUFF_WORDS):
        # 「今天学满 30 个词」是这个孩子这一场的增益,换上来的宠物上限同样多一成(血量还是它自己剩的)
        new_max_hp = int(new_max_hp * battle_moves.WORDS_HP)
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
            calculate_max_hp(current_pet.level, current_pet.evolution_stage, current_pet.species),
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
        ).execution_options(populate_existing=True)
    )
    round_obj = round_result.scalar_one()
    # 同一回合不结算两次: 这一回合已经算进血量了(驱动循环断过、重新接上时可能再走到这里),
    # 原样返回,不再扣一遍血
    if round_number <= (battle.current_round or 0):
        return battle, round_obj

    # 属性克制倍率(与前端克制表一致),只作用于攻击伤害,答错的自损不受影响
    pet1 = await db.get(UserPet, battle.player1_pet_id)
    pet2 = await db.get(UserPet, battle.player2_pet_id)
    # 闯关 / 影子里属性克制只帮孩子、不坑孩子(规则见 services/pet_trial 第 7 条);练习赛 / 真人对战照旧
    trial = paced_rules(battle)
    is_trial = trial is not None
    help_mult = pet_trial.help_mult_of(trial) if is_trial else None

    # 应用伤害。**乘法顺序只在这里**(规则见 services/battle_moves 第 4 条):
    # 基础伤害 × 出招 × 学习增益 × 属性克制 × 对方防守,每步往下取整,最少 1。
    # 防守的那一方这一回合挨的打都减(对手的普通 / 重击 / 大招);答错自损不吃任何倍率
    guard1 = round_obj.player1_stance == battle_moves.STANCE_GUARD
    guard2 = round_obj.player2_stance == battle_moves.STANCE_GUARD
    extra = round_extra(round_obj)
    if round_obj.player1_damage > 0:
        # 玩家1攻击玩家2
        mult = get_type_multiplier(pet1.species, pet2.species) if pet1 and pet2 else 1.0
        if is_trial:
            mult = pet_trial.soften_multiplier(mult, attacker_is_ai=battle.player1_id <= 0, help_mult=help_mult)
        dealt = battle_moves.final_damage(
            round_obj.player1_damage, stance=round_obj.player1_stance,
            buff=battle_moves.damage_buff(battle, battle.player1_id), type_mult=mult, target_guarding=guard2,
            spelled=_spelled(round_obj, extra, "p1"),
        )
        if guard2:
            extra.setdefault("p2", {})["guarded"] = True
        round_obj.player1_damage = dealt
        round_obj.player1_type_multiplier = mult
        round_obj.player1_type_text = (pet_trial.type_text(mult) if is_trial else get_type_text(mult)) or None
        battle.player2_hp = max(0, battle.player2_hp - dealt)
        battle.player1_total_damage += dealt
    elif round_obj.player1_damage < 0:
        # 玩家1答错,扣自己血
        battle.player1_hp = max(0, battle.player1_hp + round_obj.player1_damage)

    if round_obj.player2_damage > 0:
        mult = get_type_multiplier(pet2.species, pet1.species) if pet1 and pet2 else 1.0
        if is_trial:
            mult = pet_trial.soften_multiplier(mult, attacker_is_ai=battle.player2_id <= 0, help_mult=help_mult)
        dealt = battle_moves.final_damage(
            round_obj.player2_damage, stance=round_obj.player2_stance,
            buff=battle_moves.damage_buff(battle, battle.player2_id), type_mult=mult, target_guarding=guard1,
            spelled=_spelled(round_obj, extra, "p2"),
        )
        if guard1:
            extra.setdefault("p1", {})["guarded"] = True
        round_obj.player2_damage = dealt
        round_obj.player2_type_multiplier = mult
        round_obj.player2_type_text = (pet_trial.type_text(mult) if is_trial else get_type_text(mult)) or None
        battle.player1_hp = max(0, battle.player1_hp - dealt)
        battle.player2_total_damage += dealt
    elif round_obj.player2_damage < 0:
        battle.player2_hp = max(0, battle.player2_hp + round_obj.player2_damage)

    # 更新统计
    if round_obj.player1_correct:
        battle.player1_total_correct += 1
    if round_obj.player2_correct:
        battle.player2_total_correct += 1

    if extra:
        round_obj.extra_data = json.dumps(extra, ensure_ascii=False)

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


def paced_rules(battle) -> Optional[dict]:
    """这一场是不是按**闯关的节奏**打: 对手的血按「几下」给、AI 答错不掉血、属性克制只帮不坑、打满回合按血量比例判。
    是 → 给出记着这一场克制倍率(type_mult)的那一段设定;不是 → None。
    闯关是;挑战影子(11-12 改了节奏之后开的)也是。这三条规矩在本文件里各只有一处判断,都问这个函数 ——
    闯关和影子永远是同一套,不会一边改了另一边忘了。"""
    trial = pet_trial.trial_of(battle)
    if trial is not None:
        return trial
    shadow = pet_shadow.shadow_of(battle)
    return shadow if pet_shadow.paced_like_trial(shadow) else None


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
        mine, theirs = battle.player1_hp, battle.player2_hp
        if paced_rules(battle):
            # 闯关 / 影子按**剩余血量的比例**比(规则见 services/pet_trial 第 5 条): 对手的血比孩子厚得多,
            # 比绝对值的话打满 10 回合永远是它赢。交叉相乘,不用小数
            mine = battle.player1_hp * max(1, battle.player2_initial_hp or 1)
            theirs = battle.player2_hp * max(1, battle.player1_initial_hp or 1)
        if mine > theirs:
            return battle.player1_id
        elif theirs > mine:
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
    # 结算认领必须是**一条条件 UPDATE**(只认 active): 旧写法「读 status → 判 → 最后 commit 才写
    # finished」中间隔着好几个 await,WS 正常结束与 HTTP 逃跑判负同时到就会发两遍奖励;
    # 被新对战作废(cancelled)的那场也靠这里拿不到奖励。认领失败不 rollback ——
    # 长连接会话里 rollback 会让 battle 对象过期,下一次属性访问 MissingGreenlet
    now = datetime.utcnow()
    claimed = await db.execute(
        update(PetBattle)
        .where(PetBattle.id == battle_id, PetBattle.status == "active")
        .values(status="finished", winner_id=winner_id, finished_at=now)
        .execution_options(synchronize_session=False)
    )
    battle = await db.get(PetBattle, battle_id)
    await db.refresh(battle)
    if (claimed.rowcount or 0) == 0:
        await db.commit()
        if battle.status == "finished":
            capture = json.loads(battle.capture_data) if battle.capture_data else None
            # 闯关的结算结果第一次结算时已经写进 ai_config,晚到的这一方原样拿
            return {"_capture": capture, "_trial": (pet_trial.trial_of(battle) or {}).get("result")}
        return {"_superseded": True}

    # 闯关: 记进度、算星星、看是不是第一次通过(规则见 services/pet_trial)。
    # 放在认领成功之后、发奖励之前: 首通的额外奖励要并进下面这一场的粮食和经验里一起发
    trial_result = await pet_trial.settle(db, battle, winner_id, forfeiter_id)
    if trial_result:
        battle.ai_config = pet_trial.with_result(battle.ai_config, trial_result)
    # 打赢之后出战的宠物体力回满、不受伤: 闯关(pet_trial 第 12 条)和按闯关节奏打的影子(pet_shadow 第 6 条)都是。
    # 影子: 挑战的人是 player1,真赢了(不是对方逃跑那种 —— 影子不会逃)、至少打了一回合才算
    shadow_cfg = pet_shadow.shadow_of(battle)
    shadow_healed = bool(
        shadow_cfg and pet_shadow.paced_like_trial(shadow_cfg)
        and winner_id is not None and winner_id == battle.player1_id and forfeiter_id != battle.player1_id
        and (battle.current_round or 0) >= 1
    )
    win_healed = bool(trial_result and trial_result.get("healed")) or shadow_healed

    # 挑战影子: 给影子的主人记一条战报(规则见 services/pet_shadow 第 7 条)。
    # 同样在认领成功之后 —— 被作废的那一场、晚到的第二次结算都走不到这里
    await pet_shadow.settle(db, battle, winner_id, forfeiter_id)

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
        if trial_result and is_player1 and player_id > 0 and trial_result["first_clear"]:
            # 闯关第一次通过: 额外奖励加在这一场里(下面一起发,不另开一条路)
            food += trial_result["bonus"]["food"]
            xp += trial_result["bonus"]["xp"]
            rewards[player_id].update(food=food, xp=xp, trial_bonus=trial_result["bonus"])

        # AI 训练师(负数ID)不发经验、不升级、不记统计,避免共享AI宠物越打越强
        if player_id <= 0:
            continue

        # 更新宠物(refresh:WS 长连接会话里的对象可能是开局时读的,对战期间喂过食会被旧值覆盖)
        pet = await db.get(UserPet, battle.player1_pet_id if is_player1 else battle.player2_pet_id)
        await db.refresh(pet)

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
            max_hp = calculate_max_hp(fought_pet.level, fought_pet.evolution_stage, fought_pet.species)
            if win_healed and fought_pet.user_id == battle.player1_id:
                # 闯关 / 影子赢了: 这一场上过场的宠物体力回满、不算受伤(规则见 services/pet_trial 第 12 条)。
                # 不这样的话全对打赢也常常只剩两成血 —— 「下一关」不是被「宠物受伤了」挡住,就是带着残血进去一下就输。
                # 输了 / 平了 / 练习赛 / 真人对战走下面的老规矩(受伤 → 做恢复训练那几道单词题 → 再来)
                fought_pet.current_hp = max_hp
                fought_pet.is_injured = False
                continue
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
    rewards["_trial"] = trial_result
    rewards["_healed"] = win_healed

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
