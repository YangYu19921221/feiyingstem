"""
宠物对战 · 挑战同学的影子(2026-11-12)

为什么要有: 真人对战要两个人同时在线,近 30 天只打了 8 场。影子 = 同学的宠物 + 他平时答题的水平,
由电脑替他打,不用他在线;他之后能看到「你的影子守住了 / 被打败了」。孩子想让自己的影子厉害,
就得平时答得又准又快。

规则(这里是唯一一份;对战大厅显示的东西都来自这里的接口,前端不另写):
  1. 能挑战谁: 和我同班(有任意一个共同的班,两边现在都还在班里)、同一个机构的学生,有出战的宠物,不是我自己。
     不同班 / 别的机构 / 没这个人 / 他没有宠物 → 一律 404(不让人拿这个接口试出有没有这个人);挑战自己 → 400。
  2. 影子的水平 = 他最近 50 个**自己答的**对战回合(闯关 / 练习赛 / 挑战影子 / 真人对战里他那一侧;
     别人挑战他的影子那些场是电脑替他答的,不算;超时没答算错):
       正确率夹在 [0.40, 0.88];
       答题用时 = 他答对的那些回合用时的 25 分位 / 75 分位,夹在 1800–9000 毫秒,两头至少隔 1500 毫秒。
     不足 10 个回合 → 正确率 0.60、3500–7500 毫秒。
  3. 影子的宠物: 种族、名字照他现在出战的那只;**等级 = 他的等级夹在 [我的等级 − 1, 我的等级 + 3] 里**
     (太高打不过就不想打;太低两下就打死 —— 11-12 真打过: 我 5 级、同学 1 级,2 回合结束),
     进化阶段按调整后的等级重新算。每场新建一行 AI 宠物。
     **血量和闯关的普通关是同一档**: pet_trial.hits_hp(8 下 × (20 + 8 × 进化 + 5)),不是正常的血量公式 ——
     照公式给血一场只有两三个回合,走不到念咒语那一步。
     对手显示的名字 =「{他的名字}的{宠物名}」。给同学看的名字走 classmate_name: 姓名优先;没填姓名用用户名,
     用户名里连着 4 位以上的数字(多半是手机号)去掉;什么都不剩就叫「同学」。
  4. 开打的闸门(按这个顺序判): 平台关了 → 没宠物 → 宠物受伤 → 这个人不能挑战 → 今天已经挑战过他 → 今天没有对战场数。
     吃一场对战场数;一人同时只打一场。
  5. 同一个同学的影子一天只能挑战一次(北京日)。「挑战过」= 今天开打、至少打完一回合的 —— 点进去一回合没打的不算
     (和对战场数「打了几场」同一个口径)。
  6. **一场的节奏和闯关同一套**(11-12 改的;判断都在 pet_battle_service.paced_rules 那一处,和闯关走同一段代码):
       影子答错不掉血(pet_trial.AI_MISS_HURTS 那个开关);
       属性克制只帮不坑: 我克制它 ×1.3(pet_trial.TYPE_HELP_MULT),它克制我、我被它克制都按 ×1;
       打满 10 回合按**剩余血量的比例**判(它的血比我厚,比绝对值永远是它赢)。
     这一场的克制规矩记在 ai_config.shadow 里(type_rule = "help_only"、type_mult = 开打时的那个数),前端的提示读它。
     别的照练习赛: 出招 / 咒语 / 学习增益照常,不收服,我输了宠物会受伤(不像闯关赢了回满),奖励照练习赛。
     **影子主人的真宠物不掉血、不受伤**(场上那只是这一场新建的 AI 宠物)。
     模拟出来的节奏(11-12;和闯关同一个模拟器,普通孩子 = 三种题型答对 85% / 78% / 76%、「会就重击、不会就防守、
     有大招就拼」,同级、不相克、不带增益,按线上的等级分布加权,每个等级 1500 场):
       影子的水平                 胜率    赢的场中位   4 回合内打完   放过大招
       0.40 / 5–9 秒              96%     6 回合       9%            91%
       0.60 / 3.5–7.5 秒(默认)  78%     6 回合       10%           93%
       0.75 / 3–6 秒              52%     5 回合       12%           94%
       0.88 / 1.8–3.3 秒          21%     5 回合       18%           96%
     答得好的孩子打 0.60 的影子: 89%,中位 4 回合。带三项学习增益的普通孩子: 91%,中位 5 回合。
     改之前(公式血量、影子答错掉 10): 打 0.60 的影子 95%、中位 4 回合(39% 三回合就结束)、只有 18% 放过大招。
     ⚠️ 影子比闯关的对手准得多(闯关第一圈 0.28–0.53),血又和闯关一样厚。所以 11-12 定了两条:
     (a)**正确率封顶 0.78**(ACC_MAX;原来 0.88 —— 那时普通孩子打最强的影子五场只赢一场,还要搭上一场对战场数)。
        封顶以后最强的影子大约五五开(上表 0.75 那一行)。列表里显示的「平时答对」也是封过顶的数,和实际打的一致。
     (b)**打赢影子,出战的宠物体力回满、不受伤**(和闯关同一条,pet_battle_service.finish_battle;结束消息里 healed = true)。
        一场打长以后,打赢也常常只剩不到一半血(模拟: 三场里两场),不回满的话赢了反而要先去做恢复训练才能挑战下一位同学。
        输了 / 平了 / 逃跑照旧(受伤 → 恢复训练 → 再来)。
  7. 战报: 打完(至少打了一回合)给影子的主人记一条(pet_shadow_logs,一场一条): 谁来挑战、影子守住了没有。
     守住 = 挑战的人没赢(他输了 / 平了 / 中途逃跑)。和发奖同一个事务(pet_battle_service.finish_battle 认领成功之后)。
     被作废的那一场(开了新对战把它顶掉)不记。
  8. 列表最多 30 个同学: 今天还没挑战过的排前面,再按等级和我接近的排前面。只显示守住 / 被打败的次数,不排名。
  9. 平台开关: battle_tickets 的 shadows(默认开)。关了: 列表给空、开打 403。

这一场是挑战谁的影子记在 pet_battles.ai_config 的 "shadow" 里({owner_id, owner_name, pet_name}),mode = "shadow"。
"""
import json
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, select, union_all, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pet_formulas import evolution_stage_for_level
from app.services import pet_trial
from app.core.timeutil import local_day_utc_range, local_today
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle, PetBattleRound
from app.models.pet_shadow import PetShadowLog
from app.models.user import ClassStudent, User

MODE = "shadow"
SKILL_ROUNDS = 50
SKILL_MIN_ROUNDS = 10
ACC_MIN, ACC_MAX = 0.40, 0.78
SPEED_MIN_MS, SPEED_MAX_MS = 1800, 9000
SPEED_GAP_MS = 1500
DEFAULT_ACC = 0.60
DEFAULT_SPEED = (3500, 7500)
LEVEL_LEAD = 3              # 影子最多比我高几级
LEVEL_BEHIND = 1            # 影子最多比我低几级
TYPE_RULE = "help_only"     # 属性克制只帮不坑(和闯关 trial.type_rule 同一个词)
LIST_MAX = 30
LOG_MAX = 20
NO_CLASS = "还没有加入班级"


# ---------------------------------------------------------------- 名字

def classmate_name(full_name: Optional[str], username: Optional[str]) -> str:
    """给同学看的名字(规则第 3 条): 姓名优先;用户名里连着 4 位以上的数字去掉(多半是手机号);不剩什么就叫「同学」"""
    name = (full_name or "").strip()
    if name:
        return name[:20]
    rest = re.sub(r"\d{4,}", "", (username or "").strip()).strip("_-. ")
    return rest[:20] if rest else "同学"


# ---------------------------------------------------------------- 影子的水平

def _percentile(sorted_values: List[int], q: float) -> float:
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = q * (len(sorted_values) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def skill_from(rounds: List[Tuple[bool, Optional[int]]]) -> dict:
    """规则第 2 条。rounds = 他自己答的回合,最近的在前: [(答对没有, 用时毫秒)]"""
    rounds = rounds[:SKILL_ROUNDS]
    n = len(rounds)
    if n < SKILL_MIN_ROUNDS:
        return {"accuracy": DEFAULT_ACC, "speed_min_ms": DEFAULT_SPEED[0], "speed_max_ms": DEFAULT_SPEED[1], "rounds": n}
    accuracy = max(ACC_MIN, min(ACC_MAX, sum(1 for ok, _ in rounds if ok) / n))
    times = sorted(int(ms) for ok, ms in rounds if ok and ms and ms > 0)
    if times:
        lo, hi = _percentile(times, 0.25), _percentile(times, 0.75)
    else:
        lo, hi = DEFAULT_SPEED
    lo = max(SPEED_MIN_MS, min(SPEED_MAX_MS, int(lo)))
    hi = max(SPEED_MIN_MS, min(SPEED_MAX_MS, int(hi)))
    if hi - lo < SPEED_GAP_MS:
        hi = min(SPEED_MAX_MS, lo + SPEED_GAP_MS)
    if hi - lo < SPEED_GAP_MS:
        lo = hi - SPEED_GAP_MS
    return {"accuracy": round(accuracy, 3), "speed_min_ms": lo, "speed_max_ms": hi, "rounds": n}


async def skills_of(db: AsyncSession, user_ids: List[int]) -> Dict[int, dict]:
    """这些同学各自的影子水平。两条分支(他当玩家 1 / 玩家 2)合起来、每人取最近 50 回合 —— 一条 SQL,不按人循环。
    他的影子替他打的那些场里他不是玩家(玩家 2 是 AI),自然不在里面"""
    ids = [i for i in user_ids if i and i > 0]
    if not ids:
        return {}
    side1 = (
        select(PetBattle.player1_id.label("uid"), PetBattleRound.id.label("rid"),
               PetBattleRound.player1_correct.label("ok"), PetBattleRound.player1_time_ms.label("ms"))
        .join(PetBattle, PetBattle.id == PetBattleRound.battle_id)
        .where(PetBattle.player1_id.in_(ids), PetBattleRound.player1_answer.is_not(None))
    )
    side2 = (
        select(PetBattle.player2_id.label("uid"), PetBattleRound.id.label("rid"),
               PetBattleRound.player2_correct.label("ok"), PetBattleRound.player2_time_ms.label("ms"))
        .join(PetBattle, PetBattle.id == PetBattleRound.battle_id)
        .where(PetBattle.player2_id.in_(ids), PetBattleRound.player2_answer.is_not(None))
    )
    both = union_all(side1, side2).subquery()
    ranked = select(
        both.c.uid, both.c.rid, both.c.ok, both.c.ms,
        func.row_number().over(partition_by=both.c.uid, order_by=both.c.rid.desc()).label("rn"),
    ).subquery()
    rows = (await db.execute(
        select(ranked.c.uid, ranked.c.ok, ranked.c.ms)
        .where(ranked.c.rn <= SKILL_ROUNDS)
        .order_by(ranked.c.uid, ranked.c.rid.desc())
    )).all()
    by_user: Dict[int, List[Tuple[bool, Optional[int]]]] = {}
    for uid, ok, ms in rows:
        by_user.setdefault(uid, []).append((bool(ok), ms))
    return {uid: skill_from(by_user.get(uid, [])) for uid in ids}


# ---------------------------------------------------------------- 能挑战谁

async def _my_class_ids(db: AsyncSession, user_id: int) -> List[int]:
    return list((await db.execute(
        select(ClassStudent.class_id).where(ClassStudent.student_id == user_id, ClassStudent.is_active.is_(True))
    )).scalars())


async def classmates(db: AsyncSession, me: User, only_id: Optional[int] = None) -> Optional[List[Tuple[User, UserPet]]]:
    """和我同班、有出战宠物的同学 → [(同学, 他出战的那只)]。我没进班 → None。
    users 是租户表(安全网已经按机构罩住),这里再显式写一条 org_id: 这个接口会把同学的名字给出去"""
    class_ids = await _my_class_ids(db, me.id)
    if not class_ids:
        return None
    in_my_classes = select(ClassStudent.student_id).where(
        ClassStudent.class_id.in_(class_ids), ClassStudent.is_active.is_(True),
    )
    stmt = (
        select(User, UserPet)
        .join(UserPet, UserPet.user_id == User.id)
        .where(
            User.id.in_(in_my_classes), User.id != me.id, User.id > 0,
            User.role == "student", User.is_active.is_(True), User.org_id == me.org_id,
            UserPet.is_active.is_(True),
        )
        .order_by(User.id)
    )
    if only_id is not None:
        stmt = stmt.where(User.id == only_id)
    return [(u, p) for u, p in (await db.execute(stmt)).all()]


async def check_target(db: AsyncSession, me: User, target_id: int) -> Tuple[User, UserPet]:
    """规则第 1 条: 这个人我能不能挑战。能 → (他, 他出战的那只)"""
    if target_id == me.id:
        raise HTTPException(status_code=400, detail={"code": "shadow_self", "message": "不能挑战自己的影子。"})
    found = await classmates(db, me, only_id=target_id)
    if not found:
        raise HTTPException(status_code=404, detail={
            "code": "shadow_not_found", "message": "找不到这位同学,或者他还没有伙伴。只能挑战同班同学的影子。",
        })
    return found[0]


async def challenged_today(db: AsyncSession, user_id: int, today: Optional[date] = None) -> set:
    """我今天已经挑战过哪些同学的影子(规则第 5 条: 今天开打、至少打完一回合的)"""
    start, end = local_day_utc_range(today or local_today())
    raws = (await db.execute(
        select(PetBattle.ai_config).where(
            PetBattle.player1_id == user_id, PetBattle.mode == MODE,
            PetBattle.started_at >= start, PetBattle.started_at < end,
            PetBattle.current_round >= 1,
        )
    )).scalars()
    out = set()
    for raw in raws:
        owner = (_shadow_in(raw) or {}).get("owner_id")
        if isinstance(owner, int):
            out.add(owner)
    return out


async def check_not_done_today(db: AsyncSession, me: User, owner: User, today: Optional[date] = None) -> None:
    if owner.id in await challenged_today(db, me.id, today):
        raise HTTPException(status_code=409, detail={
            "code": "shadow_done_today",
            "message": f"今天已经挑战过{classmate_name(owner.full_name, owner.username)}的影子了,明天再来。",
        })


# ---------------------------------------------------------------- 这一场的设定

def shadow_level(owner_level: Optional[int], my_level: Optional[int]) -> int:
    """规则第 3 条: 影子的等级 = 他的等级夹在 [我的等级 − 1, 我的等级 + 3] 里(最低 1 级)"""
    mine = int(my_level or 1)
    return max(1, mine - LEVEL_BEHIND, min(int(owner_level or 1), mine + LEVEL_LEAD))


def shadow_max_hp(level: int) -> int:
    """规则第 3 条: 影子的血量 = 闯关普通关那一档(同一个函数)"""
    return pet_trial.hits_hp(evolution_stage_for_level(level), pet_trial.NORMAL_POS)


def plan(owner: User, owner_pet: UserPet, my_level: int, skill: dict) -> dict:
    """这一场存进 pet_battles.ai_config 的那段: AI 出招照旧读 accuracy / speed_*,多一段 shadow"""
    owner_name = classmate_name(owner.full_name, owner.username)
    pet_name = (owner_pet.name or "伙伴").strip()[:20] or "伙伴"
    return {
        "name": f"{owner_name}的{pet_name}"[:50],
        "level": shadow_level(owner_pet.level, my_level),
        "species": owner_pet.species,
        "accuracy": skill["accuracy"],
        "speed_min_ms": skill["speed_min_ms"],
        "speed_max_ms": skill["speed_max_ms"],
        "shadow": {
            "owner_id": owner.id, "owner_name": owner_name, "pet_name": pet_name,
            # 这一场的克制规矩(开打时定下来,整场不变;之后改常量不影响正在打的)
            "type_rule": TYPE_RULE, "type_mult": pet_trial.TYPE_HELP_MULT,
        },
    }


def _shadow_in(ai_config_raw: Optional[str]) -> Optional[dict]:
    if not ai_config_raw:
        return None
    try:
        cfg: Any = json.loads(ai_config_raw)
    except (TypeError, ValueError):
        return None
    shadow = cfg.get("shadow") if isinstance(cfg, dict) else None
    return shadow if isinstance(shadow, dict) and isinstance(shadow.get("owner_id"), int) else None


def shadow_of(battle) -> Optional[dict]:
    """这场对战是挑战影子的话,给出 ai_config 里那段 shadow;不是给 None"""
    return _shadow_in(getattr(battle, "ai_config", None))


def paced_like_trial(shadow: Optional[dict]) -> bool:
    """这一场影子是不是按闯关的节奏打(规则第 6 条)。改节奏之前开的影子(没有 type_rule)照当时的规矩打完"""
    return bool(shadow) and shadow.get("type_rule") == TYPE_RULE


def shadow_public(battle) -> Optional[dict]:
    """BattleResponse.shadow: 名字 + 这一场的克制规矩;不给主人的 id。老的影子对战 type_rule / type_mult 是 None"""
    shadow = shadow_of(battle)
    if not shadow:
        return None
    return {
        "owner_name": shadow.get("owner_name") or "同学", "pet_name": shadow.get("pet_name") or "伙伴",
        "type_rule": shadow.get("type_rule"), "type_mult": shadow.get("type_mult"),
    }


# ---------------------------------------------------------------- 战报

async def settle(db: AsyncSession, battle, winner_id: Optional[int], forfeiter_id: Optional[int] = None) -> Optional[dict]:
    """挑战影子的这一场打完了: 给影子的主人记一条战报(规则第 7 条)。

    只由 finish_battle 在「认领成功」之后调,和发奖同一个事务;不 commit、不 rollback。
    一回合没打的不记;一场只记一条(battle_id 唯一,重复来的那次什么都不做)。不是挑战影子的对战返回 None。
    """
    shadow = shadow_of(battle)
    if not shadow or int(battle.current_round or 0) < 1:
        return None
    challenger = await db.get(User, battle.player1_id)
    owner_won = winner_id != battle.player1_id or forfeiter_id == battle.player1_id
    await db.execute(
        sqlite_insert(PetShadowLog).values(
            battle_id=battle.id, owner_id=shadow["owner_id"], challenger_id=battle.player1_id,
            challenger_name=classmate_name(getattr(challenger, "full_name", None), getattr(challenger, "username", None)),
            pet_name=(shadow.get("pet_name") or None), owner_won=owner_won, created_at=datetime.utcnow(),
        ).on_conflict_do_nothing(index_elements=[PetShadowLog.battle_id])
    )
    return {"owner_id": shadow["owner_id"], "owner_won": owner_won}


async def my_record(db: AsyncSession, user_id: int) -> dict:
    """我的影子累计守住几次、被打败几次、有几条战报还没看"""
    rows = (await db.execute(
        select(PetShadowLog.owner_won, func.count(), func.sum(PetShadowLog.seen_at.is_(None)))
        .where(PetShadowLog.owner_id == user_id)
        .group_by(PetShadowLog.owner_won)
    )).all()
    defended = sum(int(n) for won, n, _ in rows if won)
    lost = sum(int(n) for won, n, _ in rows if not won)
    unseen = sum(int(u or 0) for _, _, u in rows)
    return {"defended": defended, "lost": lost, "unseen": unseen}


async def logs_view(db: AsyncSession, user_id: int, mark: bool = False) -> dict:
    """我的影子最近 20 条战报;mark = 把没看过的标成看过(这一次返回的 new 仍然照标之前的算)"""
    rows = (await db.execute(
        select(PetShadowLog).where(PetShadowLog.owner_id == user_id)
        .order_by(PetShadowLog.id.desc()).limit(LOG_MAX)
        # 下面那条「标成看过」是整批 UPDATE,不同步会话里的对象;同一个会话再读要以库里的为准
        .execution_options(populate_existing=True)
    )).scalars().all()
    items = [{
        "challenger_name": r.challenger_name,
        "owner_won": bool(r.owner_won),
        "at": r.created_at.isoformat(timespec="seconds") + "Z",      # 库里存的是 UTC,不带时区;补上 Z
        "pet_name": r.pet_name or "",
        "new": r.seen_at is None,
    } for r in rows]
    if mark:
        await db.execute(
            update(PetShadowLog)
            .where(PetShadowLog.owner_id == user_id, PetShadowLog.seen_at.is_(None))
            .values(seen_at=datetime.utcnow())
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    return {"items": items}


# ---------------------------------------------------------------- 列表

async def list_view(db: AsyncSession, me: User, today: Optional[date] = None) -> dict:
    """对战大厅「同学的影子」那一栏(规则第 8 条)"""
    record = await my_record(db, me.id)
    out: dict = {
        "enabled": True, "items": [],
        "my_record": {"defended": record["defended"], "lost": record["lost"]},
        "unseen": record["unseen"],
    }
    mates = await classmates(db, me)
    if mates is None:
        out["reason"] = NO_CLASS
        return out
    my_pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == me.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    my_level = int(my_pet.level or 1) if my_pet else 1
    done = await challenged_today(db, me.id, today)
    # 今天还没挑战过的排前面,再按等级和我接近的排前面
    mates.sort(key=lambda up: (up[0].id in done, abs(int(up[1].level or 1) - my_level), up[0].id))
    mates = mates[:LIST_MAX]
    skills = await skills_of(db, [u.id for u, _ in mates])
    for owner, pet in mates:
        level = shadow_level(pet.level, my_level)
        skill = skills.get(owner.id) or skill_from([])
        out["items"].append({
            "user_id": owner.id,
            "name": classmate_name(owner.full_name, owner.username),
            "pet_name": pet.name,
            "species": pet.species,
            "evolution_stage": evolution_stage_for_level(level),
            "level": level,
            # 正确率给个大概(取整到 5): 是让孩子挑对手用的,不是成绩单
            "accuracy": int(round(skill["accuracy"] * 100 / 5.0)) * 5,
            "challenged_today": owner.id in done,
        })
    return out
