"""
宠物对战 · 每回合的玩法(2026-11-12): 出招三选一 / 大招要拼出来 / 学习增益

为什么要有: 对战以前每回合只有一件事 —— 四选一。孩子没什么可琢磨的,也只练了「认」。
这里加的三样都长在背单词上: 有把握才敢重击、放大招要把单词拼出来、今天把该做的做了对战里就更强。

规则(这里是唯一一份;学生端显示的数来自接口,前端不另写):

【出招】答题时带 stance: normal(默认,老页面不传就是它)/ heavy 重击 / guard 防守。放大招时不看出招。
  1. heavy: 答对,这一下的伤害 ×1.5;答错,自己掉 20(普通掉 10)。
  2. guard: 答对,这一下的伤害 ×0.6;**这一回合挨的打 ×0.6**(对手的普通 / 重击 / 大招都算);
     答错不掉血、连对不断(也不涨)。超时没答 = 普通答错,照旧掉 10、连对清零。
  3. AI 一律 normal。
  4. **乘法顺序(只在 pet_battle_service.finalize_round 一处算)**:
       打出去的伤害 = 基础伤害(等级 / 进化 / 连对 / 速度 / 稀有度都加完,或者大招的伤害)
                      × 出招(重击 1.5 / 防守 0.6 / 拼对咒语的大招 1.5)× 学习增益(1.1)
                      × 属性克制(2 / 0.5;闯关里你克制对手 1.3)× 对方防守(0.6),
     每乘一步往下取整,最后 > 0 时最少 1。回合表里存的 playerN_damage 在两边答完时是「基础伤害」,
     结算后改成最终那个数(和以前属性克制的做法一样)。答错自损(-10 / -20 / 0)不吃任何倍率。
  5. 出招存在回合表里(pet_battle_rounds.player1_stance / player2_stance: normal / heavy / guard / ultimate),
     结算、断线接着打都从库里读,不靠内存。

【大招要拼出来】手里有大招的那一回合,题目里多给这个孩子一个「咒语」: 一个中文意思 + 一把打乱的字母,
把对应的单词拼出来才放得出大招。
  6. 咒语词在**建对战时**就给每个真人玩家、每一回合各挑好一个,存在这场题目(questions_data)每道题的
     spells 里: {"<玩家 id>": {word_id, word, meaning}}。**这是答案,任何发给孩子的地方都不能带**
     (pet_battle_service.public_question 不认这个键;出题时只给 spell_public() 做出来的那一份)。
  7. 挑词: 只要单个单词(纯字母,3–9 个);不能是这一回合的题目词,也不能出现在这一回合的选项里;
     先挑他拼写类模式里拼错过的词,再挑别的薄弱词,再挑他学过的词,最后用这场的词池;
     一场里尽量不重复(词不够才重复);释义里写着这个单词的不要。一个都挑不出来 → 这一回合没有咒语。
  8. 出题时只有手里 ≥1 格大招的真人玩家拿到自己的咒语: {meaning, length, letters}。
     letters = 这个词的字母 + 2 个干扰字母,打乱;怎么打乱由 (对战 id, 回合, 玩家) 定死,重连看到的是同一副。
  9. 这一回合有人拿到了咒语 → 这一回合的时限 +10 秒(拼词要时间)。
 10. 放大招(use_ultimate)时:
       选择题答对 + 咒语拼对(不分大小写、去首尾空格)→ 放出大招,扣一格,**这一记伤害 ×1.5**;
       选择题答对 + 咒语拼错 / 没拼 → **只算一记普通攻击**,那一格不扣(下一回合换个词再试);
       选择题答错 → 和平时答错一样(掉 10),不扣格;
       这一回合本来就没有咒语(挑不出词)→ 照老办法直接放(不能让那一格永远用不掉)。
 11. 咒语拼错的词排进后面的今日复习(pet_battle_service.note_battle_miss 那条路),结算页的复习词里也列出来。
 12. AI 放大招照旧,不用拼。
     **还没刷新的老页面也不用拼**: 新页面交答案时都带 "v": 2,没带(或 < 2)= 老页面 —— 它不认识咒语,
     点大招照老规矩直接放、扣一格(没有下面第 13 条的 ×1.5)。不这样的话上线那一刻没刷新的孩子会看到
     「大招点了没放出来」。有人故意去掉 v 来绕过拼写: 他拿不到 ×1.5,比认真拼的吃亏,由他去。
     (CLIENT_V_SPELL = 2;判断只在 pet_battle_ws 的驱动循环里做一次,传给 process_round_answer 的 legacy_client)
 13. **拼对咒语放出来的大招伤害 ×1.5**(SPELL_ULT_MULT),所有模式都算。只给「真人、这一回合有咒语、拼对了」:
     AI 的大招、没咒语可拼直接放的、平台把「大招要拼」关掉后点一下就放的,都是原来的伤害。

【学习增益】建对战时(练习赛 / 闯关 / 真人对战)给每个真人玩家算一次,存 pet_battles.buffs_data,整场不变:
 14. homework: 今天的任务**全部做完**(今天至少有一份;和「今日学习报告」的 all_done 是同一个函数)
     → 这一场他打出去的伤害 +10%。
 15. review: 今日复习做完(和对战场数里「做完今日复习」同一个判据)→ 开局自带 1 格大招。
 16. words: 今天学满 30 个词(和对战场数里「今天学的词」同一个数)→ 这一场血量上限 +10%、开局多这么多血;
     打完存回宠物身上时不超过真实的上限。
 17. 闯关的对手(血比公式厚,见 services/pet_trial 第 5 条)不吃这一条 —— 增益只给真人玩家。

【开关】平台管理端「对战场数」那张卡片里多三项(battle_tickets.OPTIONS): stances / spell_ultimate / study_buffs,
默认都开。关了 = 那一样当没有(出招全当 normal / 不挑咒语、点一下就放 / 不算增益)。
开关在**建对战时**读一次、记在这一场里(buffs_data 的 "_play"): 打到一半平台改了开关,这一场不变。
它们和「对战要先挣场数」那个总开关没有关系(那个关了,这三样照常生效)。
"""
import hashlib
import json
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, local_today_utc_range
from app.models.learning import LearningRecord, WordMastery
from app.models.user import User
from app.models.word import Word, WordDefinition

# ---------------------------------------------------------------- 出招

STANCE_NORMAL = "normal"
STANCE_HEAVY = "heavy"
STANCE_GUARD = "guard"
STANCE_ULTIMATE = "ultimate"          # 只出现在记录里: 这一回合真的放出了大招
STANCES = (STANCE_NORMAL, STANCE_HEAVY, STANCE_GUARD)

HEAVY_DAMAGE = 1.5
HEAVY_MISS = -20
# 拼对咒语放出来的大招,伤害乘多少(乘在「出招」那一位: 大招本来不吃重击 / 防守,那一位正好空着)。
# 11-12 加的: 不加的话一记大招(6 级 60)还不如同一回合点一下重击(64–79),孩子拼对了反而吃亏
SPELL_ULT_MULT = 1.5
GUARD_DAMAGE = 0.6
GUARD_TAKEN = 0.6
NORMAL_MISS = -10


def clean_stance(value: Any, enabled: bool = True) -> str:
    """交上来的出招: 不认识的 / 开关关着 / 没传,一律当 normal"""
    if not enabled or not isinstance(value, str):
        return STANCE_NORMAL
    value = value.strip().lower()
    return value if value in STANCES else STANCE_NORMAL


def miss_damage(stance: str, answered: bool) -> int:
    """答错这一下自己掉多少(负数)。防守答错不掉;超时没答(answered=False)不管选了什么都按普通算"""
    if not answered:
        return NORMAL_MISS
    if stance == STANCE_HEAVY:
        return HEAVY_MISS
    if stance == STANCE_GUARD:
        return 0
    return NORMAL_MISS


def stance_multiplier(stance: Optional[str], spelled: bool = False) -> float:
    """这一下打出去的伤害按出招乘多少。普通是 1;大招一般也是 1,**拼对咒语放出来的**是 SPELL_ULT_MULT"""
    if stance == STANCE_HEAVY:
        return HEAVY_DAMAGE
    if stance == STANCE_GUARD:
        return GUARD_DAMAGE
    if stance == STANCE_ULTIMATE and spelled:
        return SPELL_ULT_MULT
    return 1.0


def _times(mult: float) -> str:
    """1.5 → 「×1.5」,1.0 → 「×1」"""
    return "×" + (f"{mult:.2f}".rstrip("0").rstrip("."))


def _cut(mult: float) -> str:
    """挨打乘 0.6 → 「减四成」;不是整成的写百分比"""
    pct = round((1 - mult) * 100)
    if pct % 10 == 0 and 0 < pct < 100:
        return "减" + "一二三四五六七八九"[pct // 10 - 1] + "成"
    return f"减 {pct}%"


def _miss(stance: str) -> str:
    lost = -miss_damage(stance, True)
    return f"错掉 {lost}" if lost else "错不掉血"


def stance_hints() -> Dict[str, str]:
    """三个出招按钮下面那行小字。**从上面的常量拼出来**(前端不写死数字): 调了倍率,按钮上的字跟着变。
    每句不超过 12 个汉字宽(手机上一个按钮只有 100px 左右)"""
    return {
        STANCE_HEAVY: f"对 {_times(HEAVY_DAMAGE)} · {_miss(STANCE_HEAVY)}",
        STANCE_NORMAL: f"对 {_times(1.0)} · {_miss(STANCE_NORMAL)}",
        STANCE_GUARD: f"挨打{_cut(GUARD_TAKEN)} · {_miss(STANCE_GUARD)}",
    }


def spell_bonus_text() -> str:
    """念咒语那一块上写的那句话(从常量拼,前端不写死数字)"""
    return f"拼对咒语 大招伤害 {_times(SPELL_ULT_MULT)}"


def final_damage(base: int, *, stance: Optional[str], buff: float, type_mult: float, target_guarding: bool,
                 spelled: bool = False) -> int:
    """规则第 4 条: 基础伤害 × 出招 × 学习增益 × 属性克制 × 对方防守,每步往下取整,最少 1。
    spelled = 这一下是拼对咒语放出来的大招(「出招」那一位乘 SPELL_ULT_MULT)"""
    if base <= 0:
        return base
    dmg = base
    for mult in (stance_multiplier(stance, spelled), buff, type_mult, GUARD_TAKEN if target_guarding else 1.0):
        if mult != 1.0:
            dmg = int(dmg * mult)
    return max(1, dmg)


# ---------------------------------------------------------------- 咒语

# 交答案时带的页面版本号(submit_answer 的 "v")到这个数,才认识「大招要拼咒语」。没带 / 更小 = 老页面
CLIENT_V_SPELL = 2
SPELL_MIN_LEN = 3
SPELL_MAX_LEN = 9
SPELL_DECOYS = 2
SPELL_EXTRA_SECONDS = 10
_SPELL_WORD = re.compile(r"^[A-Za-z]+$")
_SPELLING_MODES = ("spelling", "handwriting", "fillblank", "sentencefill")
_VOWELS = "aeiou"
_CONSONANTS = "bcdfghlmnprst"


def _key(word: str) -> str:
    return (word or "").strip().lower()


def is_legacy_client(v: Any) -> bool:
    """交上来的答案是不是老页面发的(不认识咒语): 没带 v、v 不是数、v < CLIENT_V_SPELL"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return True
    return v < CLIENT_V_SPELL


def spell_word_ok(word: str, meaning: str) -> bool:
    w = (word or "").strip()
    if not (SPELL_MIN_LEN <= len(w) <= SPELL_MAX_LEN) or not _SPELL_WORD.match(w):
        return False
    # 释义里直接写着这个单词的不要: 等于把咒语印在题目上
    return re.search(rf"(?<![a-z]){re.escape(w.lower())}(?![a-z])", (meaning or "").lower()) is None


def spell_matches(typed: Any, word: str) -> bool:
    return isinstance(typed, str) and bool(_key(typed)) and _key(typed) == _key(word)


def spell_letters(word: str, battle_id: int, round_number: int, player_id: int) -> List[str]:
    """这个词的字母 + 2 个干扰字母,打乱。打乱的顺序由 (对战, 回合, 玩家) 定死 —— 重连看到的是同一副"""
    letters = list(_key(word))
    seed = hashlib.md5(f"{battle_id}:{round_number}:{player_id}:{_key(word)}".encode("utf-8")).hexdigest()
    rnd = random.Random(seed)
    # 干扰字母: 一个元音一个辅音(都是词里没有的),不然一眼就看得出哪两个是多余的
    pools = [[c for c in _VOWELS if c not in letters], [c for c in _CONSONANTS if c not in letters]]
    for i in range(SPELL_DECOYS):
        pool = pools[i % 2] or [c for c in "abcdefghijklmnopqrstuvwxyz" if c not in letters] or list(_CONSONANTS)
        letters.append(rnd.choice(pool))
    rnd.shuffle(letters)
    return letters


def spell_public(spell: Optional[dict], battle_id: int, round_number: int, player_id: int) -> Optional[dict]:
    """出题时发给这个孩子的那一份咒语: 中文意思、几个字母、一把打乱的字母。**不带单词**"""
    if not isinstance(spell, dict) or not spell.get("word"):
        return None
    word = spell["word"]
    return {
        "meaning": spell.get("meaning") or "",
        "length": len(_key(word)),
        "letters": spell_letters(word, battle_id, round_number, player_id),
    }


def spell_of(question: dict, player_id: int) -> Optional[dict]:
    """这道题里给这个玩家备好的咒语(服务端自己用的完整版,带单词)"""
    spells = question.get("spells") if isinstance(question, dict) else None
    if not isinstance(spells, dict):
        return None
    spell = spells.get(str(player_id))
    return spell if isinstance(spell, dict) and spell.get("word") else None


async def _spell_candidates(db: AsyncSession, user_id: int, pool: List[Tuple[Word, str]]) -> List[dict]:
    """给这个孩子挑咒语用的词,按优先级排好(规则第 7 条): 拼错过的 → 别的薄弱词 → 学过的 → 这场的词池。
    每一档里面打乱。按拼写去重。"""
    from app.services.weak_words import MASTERY_LINE, real_error_subquery

    def _with_meaning(stmt, limit: int):
        return (
            stmt.join(WordDefinition, WordDefinition.word_id == Word.id)
            .add_columns(func.max(WordDefinition.meaning))
            .group_by(Word.id).order_by(func.random()).limit(limit)
        )

    async def _primary(rows) -> List[Tuple[int, str, str]]:
        # 上面取的是「某一条释义」,这里换成主释义(和出题用的同一条)
        ids = [r[0].id for r in rows]
        if not ids:
            return []
        defs = (await db.execute(
            select(WordDefinition.word_id, WordDefinition.meaning)
            .where(WordDefinition.word_id.in_(ids))
            .order_by(WordDefinition.word_id, WordDefinition.is_primary.desc(), WordDefinition.id)
        )).all()
        first: Dict[int, str] = {}
        for wid, meaning in defs:
            first.setdefault(wid, meaning)
        return [(r[0].id, r[0].word, first.get(r[0].id) or r[1]) for r in rows]

    tiers: List[List[Tuple[int, str, str]]] = []
    # 1. 拼写类模式里拼错过的
    misspelled = (await db.execute(_with_meaning(
        select(Word).join(LearningRecord, LearningRecord.word_id == Word.id).where(and_(
            LearningRecord.user_id == user_id,
            LearningRecord.learning_mode.in_(_SPELLING_MODES),
            LearningRecord.is_correct == False,  # noqa: E712
        )), 40))).all()
    tiers.append(await _primary(misspelled))
    # 2. 别的薄弱词(口径同 services/weak_words: 掌握度不到线、计分模式里真的答错过)
    err = real_error_subquery([user_id])
    weak = (await db.execute(_with_meaning(
        select(Word).join(err, err.c.wid == Word.id)
        .join(WordMastery, and_(WordMastery.user_id == err.c.uid, WordMastery.word_id == err.c.wid))
        .where(WordMastery.mastery_level < MASTERY_LINE), 40))).all()
    tiers.append(await _primary(weak))
    # 3. 学过的词
    learned = (await db.execute(_with_meaning(
        select(Word).join(LearningRecord, LearningRecord.word_id == Word.id)
        .where(LearningRecord.user_id == user_id), 60))).all()
    tiers.append(await _primary(learned))
    # 4. 这场的词池
    shuffled = list(pool)
    random.shuffle(shuffled)
    tiers.append([(w.id, w.word, m) for w, m in shuffled])

    out: List[dict] = []
    seen: set = set()
    for tier in tiers:
        for wid, word, meaning in tier:
            key = _key(word)
            if key in seen or not spell_word_ok(word, meaning):
                continue
            seen.add(key)
            out.append({"word_id": wid, "word": word.strip(), "meaning": meaning})
    return out


async def attach_spells(
    db: AsyncSession, questions: List[dict], player_ids: List[int], pool: List[Tuple[Word, str]],
) -> None:
    """给每道题、每个真人玩家各备一个咒语词(就地写进 questions[i]["spells"])。挑不出来的那一回合就没有"""
    for pid in [p for p in player_ids if p and p > 0]:
        cands = await _spell_candidates(db, pid, pool)
        if not cands:
            continue
        used: set = set()
        for q in questions:
            banned = {_key(q.get("word"))} | {_key(o[3:]) for o in (q.get("options") or [])}
            pick = next((c for c in cands if _key(c["word"]) not in banned and _key(c["word"]) not in used), None)
            if pick is None:      # 词不够了: 这一回合允许用前面用过的
                pick = next((c for c in cands if _key(c["word"]) not in banned), None)
            if pick is None:
                continue
            used.add(_key(pick["word"]))
            q.setdefault("spells", {})[str(pid)] = dict(pick)


# ---------------------------------------------------------------- 学习增益

BUFF_HOMEWORK = "homework"
BUFF_REVIEW = "review"
BUFF_WORDS = "words"
HOMEWORK_DAMAGE = 1.10
WORDS_HP = 1.10
WORDS_NEEDED = 30
REVIEW_CHARGES = 1

ROUTE_HOMEWORK = "/student/homework"
ROUTE_REVIEW = "/student/memory-curve"
ROUTE_BOOKS = "/student/dashboard"



def _plus(mult: float) -> str:
    return f"+{round((mult - 1) * 100)}%"


def buff_text(key: str) -> Tuple[str, str]:
    """增益的名字和效果(给孩子看的)。数字从上面的常量拼,不另写一份"""
    return {
        BUFF_HOMEWORK: ("作业做完了", f"攻击 {_plus(HOMEWORK_DAMAGE)}"),
        BUFF_REVIEW: ("今日复习做完了", f"开局自带 {REVIEW_CHARGES} 格大招"),
        BUFF_WORDS: (f"今天学满 {WORDS_NEEDED} 个词", f"体力 {_plus(WORDS_HP)}"),
    }[key]


async def buff_overview(db: AsyncSession, user: User, enabled: bool = True) -> dict:
    """现在开一场对战会带哪些增益、哪些还没拿到(对战大厅显示;建对战时也用它算)。
    三个判据都是现成的: 今日学习报告的 all_done、今日复习那一份做没做完、今天学了几个词。"""
    if not enabled:
        return {"enabled": False, "items": []}
    from app.services import daily_review, daily_words
    from app.services.today_report import build_today_report

    today = local_today()
    report = await build_today_report(db, user, today)
    total, done = int(report.get("today_total") or 0), int(report.get("today_done") or 0)
    if total == 0:
        hw_how, hw_route = "今天没有布置作业,这一项没有", None
    elif report.get("all_done"):
        hw_how, hw_route = "今天的作业都做完了", None
    else:
        hw_how, hw_route = f"做完今天的作业(还差 {total - done} 份)", ROUTE_HOMEWORK

    review = await daily_review.status(db, user.id, today, create=False)
    review_total = int(review.get("total") or 0)
    review_done = bool(review.get("completed")) and review_total > 0
    if review_done:
        rv_how, rv_route = "今天的复习做完了", None
    elif review_total == 0:
        rv_how = "今天还没排复习词,回首页看看" if not review.get("started") else "今天没有要复习的词,这一项没有"
        rv_route = None
    else:
        rv_how, rv_route = f"做完今日复习(做了 {int(review.get('done') or 0)} / {review_total} 个)", ROUTE_REVIEW

    start, end = local_today_utc_range()
    words = int((await daily_words.words_by_student(db, [user.id], start, end)).get(user.id, 0))
    if words >= WORDS_NEEDED:
        wd_how, wd_route = f"今天学了 {words} 个词", None
    else:
        wd_how, wd_route = f"今天学了 {words} 个词,再学 {WORDS_NEEDED - words} 个", ROUTE_BOOKS

    def item(key: str, got: bool, how: str, route: Optional[str]) -> dict:
        label, detail = buff_text(key)
        return {"key": key, "label": label, "detail": detail, "got": got, "how": how, "route": None if got else route}

    return {"enabled": True, "items": [
        item(BUFF_HOMEWORK, bool(report.get("all_done")), hw_how, hw_route),
        item(BUFF_REVIEW, review_done, rv_how, rv_route),
        item(BUFF_WORDS, words >= WORDS_NEEDED, wd_how, wd_route),
    ]}


async def buffs_for(db: AsyncSession, user: Optional[User], enabled: bool = True) -> List[dict]:
    """这个孩子现在开打带上的增益 → [{key, label, detail}]。AI / 开关关着是空的"""
    if not enabled or user is None or (user.id or 0) <= 0 or user.role != "student":
        return []
    view = await buff_overview(db, user, True)
    return [{"key": i["key"], "label": i["label"], "detail": i["detail"]} for i in view["items"] if i["got"]]


def dump_buffs(by_player: Dict[int, List[dict]], play: dict) -> str:
    """存进 pet_battles.buffs_data: {"<玩家 id>": [...], "_play": {stances, spell_ultimate}}"""
    data: Dict[str, Any] = {str(pid): items for pid, items in by_player.items()}
    data["_play"] = {"stances": bool(play.get("stances")), "spell_ultimate": bool(play.get("spell_ultimate"))}
    return json.dumps(data, ensure_ascii=False)


def _load(battle) -> dict:
    raw = getattr(battle, "buffs_data", None)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def battle_buffs(battle, player_id: int) -> List[dict]:
    """这一场里这个玩家带着的增益(老对战没有这一列 = 没有)"""
    items = _load(battle).get(str(player_id))
    return [i for i in items if isinstance(i, dict) and i.get("key")] if isinstance(items, list) else []


def has_buff(battle, player_id: int, key: str) -> bool:
    return any(i.get("key") == key for i in battle_buffs(battle, player_id))


def damage_buff(battle, player_id: int) -> float:
    return HOMEWORK_DAMAGE if has_buff(battle, player_id, BUFF_HOMEWORK) else 1.0


def battle_play(battle) -> dict:
    """这一场开没开 出招三选一 / 大招要拼咒语(建对战时定下的)。老对战(没有这一列)两样都没有 ——
    上线那一刻正在打的对战照老规矩打完"""
    play = _load(battle).get("_play")
    if not isinstance(play, dict):
        return {"stances": False, "spell_ultimate": False, "hints": None, "spell_bonus": None}
    stances = bool(play.get("stances"))
    spell = bool(play.get("spell_ultimate"))
    return {
        "stances": stances,
        "spell_ultimate": spell,
        # 出招按钮下面那行小字(关着就没有)
        "hints": stance_hints() if stances else None,
        # 念咒语那一块上写的「拼对了有什么好处」(关着就没有)
        "spell_bonus": spell_bonus_text() if spell else None,
    }
