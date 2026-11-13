"""宠物对战 · 闯关(2026-11-12,规则真源 app/services/pet_trial.py)+ 每场 AI 对战用自己的一只 AI 宠物

起因: 线上近 30 天 571 场对战里 563 场是打 AI,每场都是随机对手,打完没有「下一步」。
这里锁住:
  1. 第 n 关的对手对所有孩子都一样、一个区域 5 关不重复、不出传说、属性对得上场地
  2. 区域 ↔ 属性、区域的名字和前端 components/battle/fx.ts 是同一张表
  3. 还没轮到的关不能打(403 trial_locked),拦下时不建对战
  4. 没有对战场数不能打(403 need_battle_ticket)
  5. 赢了记进度和星星;首次通过的额外奖励只给一次、并在这一场的奖励里;重打星星只升不降;同一场不记两次
  6. 输了 / 一回合没打的不算通过
  7. 闯关对手的血比公式厚(普通关 8 下、守关 10 下),血量上限 / 当前血量 / 各宠物血量 / 队伍列表四处是同一个数
  8. 每场 AI 对战的对手是自己的一行,后开的一场改不到先开的那场(以前所有孩子共用一行)
  9. 闯关里属性克制只帮不坑;练习赛照旧双向克制
 10. 分校的孩子(租户安全网开着)也能打 AI —— 以前取不到直营名下的 AI 账号,主键冲突 500
 11. 进度表的模型在 app/models/__init__.py 里导入(只在路由里导入的话,生产首次启动建不出表)
 12. 闯关赢了: 上过场的宠物体力回满、不受伤;闯关输了、练习赛赢了都不回
 13. 三种题型(看英文选中文 / 看中文选英文 / 听读音选中文): 配比、第 1 题、「看中文选英文」出题时不带单词、
     干扰单词不重复也不同义、结算页给的是中文意思、老格式的题目照样能打
 14. 不能向 AI 这类系统账号发挑战
"""
import json
import re
from pathlib import Path

from sqlalchemy import func, select

from app.core import tenancy
from app.core.pet_formulas import calculate_max_hp, evolution_stage_for_level
from app.core.pet_species import LEGENDARY_SPECIES, PET_SPECIES
from app.models.organization import Organization
from app.models.pet import PetEventLog, UserPet
from app.models.pet_battle import PetBattle, PetBattleRound
from app.models.pet_trial import PetTrialStage
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.schemas.pet_battle import QuestionData, RoundQuestionData, WSBattleEnd, WSNewRound
from app.services import battle_tickets, pet_trial
from app.services import pet_battle_service as svc
from tests.test_pet_multitab_exploits import _h, _student_with_pet

TRIAL = "/api/v1/student/battle/trial"
QUICK = "/api/v1/student/battle/quick-match"
FX_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "battle" / "fx.ts"


def _start(stage: int) -> str:
    return f"{TRIAL}/{stage}/start"


async def _words(db, n=6, prefix="tr"):
    for i in range(n):
        w = Word(word=f"{prefix}word{i}")
        db.add(w)
        await db.flush()
        db.add(WordDefinition(word_id=w.id, meaning=f"义{prefix}{i}", is_primary=True))
    await db.commit()


async def _no_ticket_limit(db):
    await battle_tickets.save_settings(db, {**await battle_tickets.get_settings(db), "enabled": False})
    await db.commit()


async def _battle_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(PetBattle))).scalar()


async def _play_out(db, battle_id: int, *, rounds: int, correct: int, winner_id, my_hp=None):
    """把一场开着的对战直接摆成「打了 rounds 回合、我答对 correct 题」再结算(不走 WS)"""
    bt = await db.get(PetBattle, battle_id)
    bt.current_round = rounds
    bt.player1_total_correct = correct
    if winner_id == bt.player1_id:
        bt.player2_hp = 0
        if my_hp is not None:
            bt.player1_hp = my_hp
    else:
        bt.player1_hp = 0
    await db.commit()
    return await svc.finish_battle(db, battle_id, winner_id)


async def _clear(db, user_id: int, upto: int):
    from datetime import datetime
    for n in range(1, upto + 1):
        db.add(PetTrialStage(user_id=user_id, stage=n, stars=1, attempts=1,
                             first_cleared_at=datetime.utcnow(), last_played_at=datetime.utcnow()))
    await db.commit()


# ---------- 1. 第 n 关是谁 ----------

def test_stage_opponent_is_fixed_for_everyone():
    assert pet_trial.LAP_STAGES == 40 and len(pet_trial.AREAS) == 8
    for n in (1, 7, 12, 40, 41, 83):
        assert pet_trial.species_for(n) == pet_trial.species_for(n), "同一关每次都得是同一只"
    for area_index, (arena, _name) in enumerate(pet_trial.AREAS):
        stages = [area_index * 5 + pos + 1 for pos in range(5)]
        species = [pet_trial.species_for(n) for n in stages]
        assert len(set(species)) == 5, f"{arena} 的 5 关不该重复: {species}"
        for sp in species:
            assert sp not in LEGENDARY_SPECIES, "闯关不出传说(平时见不到才稀罕)"
            assert pet_trial.ELEMENT_ARENA[PET_SPECIES[sp]["element"]] == arena
        assert [pet_trial.is_boss(n) for n in stages] == [False, False, False, False, True]
    # 40 关以后接着第二圈
    assert pet_trial.locate(40) == (0, 7, 4) and pet_trial.locate(41) == (1, 0, 0)
    assert pet_trial.plan(41, 5)["arena"] == "meadow" and pet_trial.plan(41, 5)["lap"] == 1
    # 候选多于 5 只的区域,第二圈换一批
    assert pet_trial.species_for(41) != pet_trial.species_for(1)


def test_opponent_level_and_skill_follow_the_rules():
    # 对手和孩子同级(每一关、每一圈): 拿等级差调难度的话,差一级正好跨过进化线的孩子会平白吃亏
    assert [pet_trial.plan(n, 10)["level"] for n in range(1, 6)] == [10] * 5
    assert pet_trial.plan(1, 1)["level"] == 1 and pet_trial.plan(41, 10)["level"] == 10
    assert pet_trial.plan(5, 4)["evolution_stage"] == evolution_stage_for_level(4) == 0
    # 第一圈: 第 1 关 0.28、第 4 关 0.51、守关 0.41(青草原)→ 云上神殿守关 0.529
    p = pet_trial.plan(1, 5)
    assert (p["accuracy"], p["speed_min_ms"], p["speed_max_ms"]) == (0.28, 3400, 6600)
    assert p["evolution_stage"] == evolution_stage_for_level(p["level"])
    assert pet_trial.plan(4, 5)["accuracy"] == 0.51 and pet_trial.plan(5, 5)["accuracy"] == 0.41
    boss = pet_trial.plan(40, 5)   # 0.28 + 0.017×7 + 0.13
    assert boss["boss"] and boss["accuracy"] == 0.529 and boss["speed_min_ms"] == 2500
    # 第二圈每关 +0.30;第三圈起顶到 0.92
    assert pet_trial.plan(45, 5)["accuracy"] == 0.71 and pet_trial.plan(80, 5)["accuracy"] == 0.829
    assert pet_trial.plan(85, 5)["accuracy"] == 0.92 and pet_trial.plan(200, 5)["accuracy"] == 0.92
    # 一个区域里越往后越难;守关答得没第 4 关准,靠的是血厚
    acc = [pet_trial.plan(n, 5)["accuracy"] for n in range(1, 6)]
    assert acc[0] < acc[1] < acc[2] < acc[4] < acc[3]
    # 对手的血量 = 几下 × (20 + 8 × 进化 + 5): 普通关 8 下、守关 10 下 —— 比公式厚得多,一场才打得够长
    assert (pet_trial.HP_HITS, pet_trial.HIT_FLAT) == ((8, 8, 8, 8, 10), 5)
    assert [pet_trial.plan(n, 5)["max_hp"] for n in range(1, 6)] == [264, 264, 264, 264, 330]     # 5 级: 进化 1 档
    assert (pet_trial.plan(1, 2)["max_hp"], pet_trial.plan(5, 2)["max_hp"]) == (200, 250)         # 2 级: 还没进化
    assert (pet_trial.plan(1, 17)["max_hp"], pet_trial.plan(5, 17)["max_hp"]) == (328, 410)       # 17 级: 进化 2 档
    assert pet_trial.plan(1, 5)["max_hp"] > calculate_max_hp(5, 1, p["species"]) * 1.5
    assert pet_trial.plan(41, 5)["max_hp"] == 264, "第二圈血量不变,难在 AI 答得准"
    # 「一下」里的 20 和 8 就是伤害公式里的基础伤害和进化加成(那边改了这里要跟着改)
    for evo in range(5):
        assert svc.calculate_damage(10, evo, 10, evo, True, 0, 9999) == pet_trial.HIT_BASE + pet_trial.HIT_PER_EVO * evo
    assert boss["pet_name"].startswith("守关 · ")
    assert "家族" not in p["pet_name"]
    assert pet_trial.AI_MISS_HURTS is False
    # 星星
    assert [pet_trial.stars_for(5, c) for c in (5, 4, 3, 0)] == [3, 2, 1, 1]


# ---------- 2. 和前端同一张表 ----------

def _ts_record(name: str) -> dict:
    src = FX_TS.read_text(encoding="utf-8")
    m = re.search(rf"{name}\s*:\s*Record<[^>]+>\s*=\s*\{{(.*?)\}};", src, re.S)
    assert m, f"前端 components/battle/fx.ts 里找不到 {name}"
    return dict(re.findall(r"(\w+)\s*:\s*'([^']+)'", m.group(1)))


def test_area_tables_match_frontend():
    assert _ts_record("ELEMENT_ARENA") == pet_trial.ELEMENT_ARENA
    assert _ts_record("ARENA_NAME") == dict(pet_trial.AREAS)
    # 每个属性都有去处(加了新属性忘了分场地,那个属性的种族就永远不出场)
    assert {d["element"] for d in PET_SPECIES.values()} <= set(pet_trial.ELEMENT_ARENA)


# ---------- 3. 还没轮到的关不能打 ----------

async def test_locked_stage_is_refused_and_no_battle_is_created(client, db_session):
    a, _ = await _student_with_pet(db_session, "tra")
    await _words(db_session)

    view = (await client.get(TRIAL, headers=_h(a.id))).json()
    assert (view["cleared"], view["next_stage"], view["total_stars"], view["lap"]) == (0, 1, 0, 0)
    assert [x["arena"] for x in view["areas"]] == [x[0] for x in pet_trial.AREAS]
    flat = [s for area in view["areas"] for s in area["stages"]]
    assert [s["stage"] for s in flat] == list(range(1, 41))
    assert [s["stage"] for s in flat if s["unlocked"]] == [1]
    assert flat[4]["boss"] and flat[4]["pet_name"].startswith("守关 · ")
    assert flat[0]["species"] == pet_trial.species_for(1)

    before = await _battle_count(db_session)
    r = await client.post(_start(3), headers=_h(a.id))
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "trial_locked" and "第 1 关" in r.json()["detail"]["message"]
    assert (await client.post(_start(0), headers=_h(a.id))).status_code == 404
    assert await _battle_count(db_session) == before, "被拦下时不该建对战"
    # 没被拦的那一关开得出来,带着这是第几关
    r = await client.post(_start(1), headers=_h(a.id))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "trial" and body["status"] == "active"
    assert body["trial"]["stage"] == 1 and body["trial"]["arena"] == "meadow" and body["trial"]["boss"] is False
    assert body["trial"]["title"] == "青草原 · 第 1 关"
    assert body["player2_pet"]["species"] == pet_trial.species_for(1)
    assert body["player2_pet"]["name"] == pet_trial.plan(1, 5)["pet_name"]


async def test_no_pet_and_injured_pet_get_a_reason(client, db_session):
    from tests.test_pet_multitab_exploits import _org
    org = await _org(db_session)
    u = User(username="trnopet", email="trnopet@e.com", hashed_password="x", role="student",
             full_name="没宠物", is_active=True, org_id=org.id)
    db_session.add(u)
    await db_session.commit()
    r = await client.post(_start(1), headers=_h(u.id))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "no_pet"

    b, pb = await _student_with_pet(db_session, "trhurt", current_hp=10)
    pb.is_injured = True
    await db_session.commit()
    r = await client.post(_start(1), headers=_h(b.id))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "pet_injured"


# ---------- 4. 闯关也吃对战场数 ----------

async def test_trial_needs_a_battle_ticket(client, db_session):
    a, _ = await _student_with_pet(db_session, "trb")
    await _words(db_session)
    r = await client.post(_start(1), headers=_h(a.id))
    assert r.status_code == 200, r.text
    bt = await db_session.get(PetBattle, r.json()["id"])
    bt.current_round, bt.status = 3, "finished"     # 今天送的那一场打掉了
    await db_session.commit()

    before = await _battle_count(db_session)
    r = await client.post(_start(1), headers=_h(a.id))
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "need_battle_ticket"
    assert await _battle_count(db_session) == before


# ---------- 5. 赢了: 进度、星星、首通奖励 ----------

async def test_win_records_progress_and_first_clear_bonus_only_once(client, db_session):
    a, pa = await _student_with_pet(db_session, "trc")
    await _words(db_session)
    await _no_ticket_limit(db_session)

    # 第一次: 5 回合错 1 个 → 2 星,首通奖励 粮 +20 / 经验 +30 并在这一场里
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    food0, xp0 = pa.food_balance, pa.experience or 0
    rewards = await _play_out(db_session, bid, rounds=5, correct=4, winner_id=a.id)
    t = rewards["_trial"]
    assert (t["won"], t["stars"], t["best_stars"], t["first_clear"], t["next_stage"]) == (True, 2, 2, True, 2)
    assert t["bonus"] == {"food": 20, "xp": 30} and t["cleared"] == 1
    assert rewards[a.id]["food"] == 15 + 4 * 2 + 20 and rewards[a.id]["xp"] == 50 + 30
    assert rewards[a.id]["trial_bonus"] == {"food": 20, "xp": 30}
    await db_session.refresh(pa)
    assert pa.food_balance == food0 + 43, "首通奖励要真的发到宠物身上"
    # 同一场再结算一次(WS 结束和逃跑判负撞上): 不多记、不多发,拿到的还是那份结果
    again = await svc.finish_battle(db_session, bid, a.id)
    assert again["_trial"]["stars"] == 2 and again["_trial"]["first_clear"] is True
    row = (await db_session.execute(select(PetTrialStage).where(PetTrialStage.user_id == a.id))).scalar_one()
    assert (row.stage, row.stars, row.attempts) == (1, 2, 1) and row.first_cleared_at is not None
    # 打完的这一场,刷新页面还读得到结果
    got = (await client.get(f"/api/v1/student/battle/{bid}", headers=_h(a.id))).json()
    assert got["trial"]["result"]["stars"] == 2 and got["trial"]["result"]["first_clear"] is True

    view = (await client.get(TRIAL, headers=_h(a.id))).json()
    flat = [s for area in view["areas"] for s in area["stages"]]
    assert (view["cleared"], view["next_stage"], view["total_stars"]) == (1, 2, 2)
    assert (flat[0]["cleared"], flat[0]["stars"]) == (True, 2)
    assert [s["stage"] for s in flat if s["unlocked"]] == [1, 2]

    # 重打第 1 关全对 → 3 星;不是第一次了,没有额外奖励
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    rewards = await _play_out(db_session, bid, rounds=4, correct=4, winner_id=a.id)
    t = rewards["_trial"]
    assert (t["stars"], t["best_stars"], t["first_clear"]) == (3, 3, False)
    assert t["bonus"] == {"food": 0, "xp": 0} and rewards[a.id]["food"] == 15 + 4 * 2
    assert "trial_bonus" not in rewards[a.id]

    # 再重打只拿 1 星 → 最好成绩还是 3 星
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    t = (await _play_out(db_session, bid, rounds=6, correct=3, winner_id=a.id))["_trial"]
    assert (t["stars"], t["best_stars"]) == (1, 3)
    await db_session.refresh(row)
    assert (row.stars, row.attempts) == (3, 3)


# ---------- 6. 输了 / 没打的不算 ----------

async def test_loss_and_unplayed_battle_do_not_clear_the_stage(client, db_session):
    a, pa = await _student_with_pet(db_session, "trd")
    await _words(db_session)
    await _no_ticket_limit(db_session)

    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    rewards = await _play_out(db_session, bid, rounds=4, correct=1, winner_id=svc.AI_USER_ID)
    t = rewards["_trial"]
    assert (t["won"], t["stars"], t["first_clear"], t["next_stage"]) == (False, 0, False, None)
    assert t["bonus"] == {"food": 0, "xp": 0} and "trial_bonus" not in rewards[a.id]
    row = (await db_session.execute(select(PetTrialStage).where(PetTrialStage.user_id == a.id))).scalar_one()
    assert (row.stars, row.attempts, row.first_cleared_at) == (0, 1, None)

    # 平局也不算通过
    await db_session.execute(PetTrialStage.__table__.delete())
    pa.is_injured, pa.current_hp = False, 145
    await db_session.commit()
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    bt.current_round, bt.player1_total_correct = 10, 10
    await db_session.commit()
    t = (await svc.finish_battle(db_session, bid, None))["_trial"]
    assert t["won"] is False and t["first_clear"] is False

    # 点进去一回合没打就逃跑: 不记进度(连次数都不记)
    await db_session.execute(PetTrialStage.__table__.delete())
    pa.is_injured, pa.current_hp = False, 145
    await db_session.commit()
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    r = await client.post(f"/api/v1/student/battle/{bid}/forfeit", headers=_h(a.id))
    assert r.status_code == 200 and r.json()["forfeited"] is True
    assert (await db_session.execute(select(func.count()).select_from(PetTrialStage))).scalar() == 0

    view = (await client.get(TRIAL, headers=_h(a.id))).json()
    assert view["cleared"] == 0 and view["next_stage"] == 1
    # 逃跑把出战宠物的血清零了(受伤);治好以后第 2 关仍然打不了 —— 第 1 关还没过
    await db_session.refresh(pa)
    pa.is_injured, pa.current_hp = False, 145
    await db_session.commit()
    r = await client.post(_start(2), headers=_h(a.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "trial_locked"


# ---------- 7. 守关的血量 ----------

async def test_boss_hp_is_the_same_number_everywhere(client, db_session):
    a, pa = await _student_with_pet(db_session, "tre")
    await _words(db_session)
    await _no_ticket_limit(db_session)
    await _clear(db_session, a.id, 4)

    r = await client.post(_start(5), headers=_h(a.id))
    assert r.status_code == 200, r.text
    body = r.json()
    p = pet_trial.plan(5, pa.level)
    normal = calculate_max_hp(p["level"], p["evolution_stage"], p["species"])
    want = p["max_hp"]
    assert want == 330 and want > normal * 2
    assert body["trial"]["boss"] is True and body["player2_pet"]["name"].startswith("守关 · ")
    assert (body["player2_pet"]["hp"], body["player2_pet"]["max_hp"]) == (want, want)
    assert [(x["hp"], x["max_hp"]) for x in body["player2_roster"]] == [(want, want)]
    bt = await db_session.get(PetBattle, body["id"])
    assert (bt.player2_initial_hp, bt.player2_hp) == (want, want)
    assert json.loads(bt.pet_hp_data)[str(bt.player2_pet_id)] == want
    cfg = json.loads(bt.ai_config)
    assert (cfg["accuracy"], cfg["speed_min_ms"], cfg["speed_max_ms"]) == (
        p["accuracy"], p["speed_min_ms"], p["speed_max_ms"])
    assert cfg["level"] == pa.level, "对手和孩子同级"

    # 普通关的血也比公式厚(8 下),同样四处是同一个数
    rewards = await _play_out(db_session, body["id"], rounds=5, correct=5, winner_id=a.id)
    assert rewards["_trial"]["bonus"] == {"food": 60, "xp": 100}, "守关首通给得多"
    pa.is_injured, pa.current_hp = False, calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    await db_session.commit()
    body = (await client.post(_start(4), headers=_h(a.id))).json()
    p4 = pet_trial.plan(4, pa.level)
    assert p4["max_hp"] == 264 and (body["player2_pet"]["hp"], body["player2_pet"]["max_hp"]) == (264, 264)
    assert [(x["hp"], x["max_hp"]) for x in body["player2_roster"]] == [(264, 264)]
    bt = await db_session.get(PetBattle, body["id"])
    assert (bt.player2_initial_hp, bt.player2_hp, json.loads(bt.pet_hp_data)[str(bt.player2_pet_id)]) == (264, 264, 264)
    # 练习赛的对手还是照公式(加厚只在闯关里)
    pa.is_injured, pa.current_hp = False, calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    await db_session.commit()
    body = (await client.post(QUICK, headers=_h(a.id))).json()
    foe = body["player2_pet"]
    assert foe["max_hp"] == calculate_max_hp(foe["level"], foe["evolution_stage"], foe["species"])


# ---------- 8. 每场 AI 对战的对手是自己的一行 ----------

async def test_each_ai_battle_gets_its_own_opponent_row(client, db_session):
    a, _ = await _student_with_pet(db_session, "trf")
    b, pb = await _student_with_pet(db_session, "trg")
    pb.level, pb.evolution_stage = 30, 3          # 两个孩子等级差得远,AI 对手也差得远
    # 线上那一行老的公用 AI 宠物: 留着不动(老的对战记录指着它)
    db_session.add(User(id=svc.AI_USER_ID, username="AI训练师", email="ai@system.local",
                        hashed_password="", role="student", is_active=True, org_id=1))
    legacy = UserPet(user_id=svc.AI_USER_ID, name="数码训练大师", species="lionknight", level=12,
                     evolution_stage=1, current_hp=160, is_active=True)
    db_session.add(legacy)
    await _words(db_session)
    await _no_ticket_limit(db_session)

    first = (await client.post(QUICK, headers=_h(a.id))).json()
    snap = dict(first["player2_pet"])
    second = (await client.post(QUICK, headers=_h(b.id))).json()
    third = (await client.post(_start(1), headers=_h(b.id))).json()   # b 的闯关会作废他自己那场练习赛,不碰 a 的

    ids = {first["player2_pet"]["pet_id"], second["player2_pet"]["pet_id"], third["player2_pet"]["pet_id"]}
    assert len(ids) == 3 and legacy.id not in ids, "每场都得是新的一行"
    assert abs(second["player2_pet"]["level"] - 30) <= 2 and abs(snap["level"] - 5) <= 2

    # 后面两场开打以后,第一场的对手一点没变
    again = (await client.get(f"/api/v1/student/battle/{first['id']}", headers=_h(a.id))).json()
    for key in ("pet_id", "name", "species", "level", "evolution_stage", "max_hp"):
        assert again["player2_pet"][key] == snap[key], f"第一场的对手 {key} 被后开的对战改了"
    await db_session.refresh(legacy)
    assert (legacy.name, legacy.species, legacy.level, legacy.is_active) == ("数码训练大师", "lionknight", 12, True)
    for pid in ids:
        row = await db_session.get(UserPet, pid)
        assert row.user_id == svc.AI_USER_ID and row.is_active is False

    # AI 一方只列场上这一只(AI 账号名下一大堆行不是它的队伍),也不算「能换宠物」(不然每回合干等 8 秒)
    assert [x["pet_id"] for x in again["player2_roster"]] == [snap["pet_id"]]
    assert again["player2_roster"][0]["can_switch"] is False
    bt = await db_session.get(PetBattle, first["id"])
    assert await svc.anyone_can_switch(db_session, bt) is False
    # 对战记录里各是各的对手名
    mine = (await client.get("/api/v1/student/battles/my", headers=_h(a.id))).json()
    assert mine[0]["opponent_pet_name"] == snap["name"]


# ---------- 9. 闯关里属性克制只帮不坑 ----------

async def _one_round(db, a, pa, ai_species: str, *, trial: bool, d1=40, d2=30, raw=False, legacy=False):
    await svc.ensure_ai_user(db)
    ai_pet = await svc.spawn_ai_pet(db, name="对手", species=ai_species, level=5)
    cfg = {"name": "对手", "level": 5, "species": ai_species, "accuracy": 0.5}
    if trial:
        cfg = pet_trial.ai_config_from({**pet_trial.plan(1, 5), "species": ai_species, "pet_name": "对手"})
        if legacy:      # 11-12 之前开的闯关: trial 里没有 type_mult 这个键
            cfg["trial"].pop("type_mult")
    bt = PetBattle(player1_id=a.id, player2_id=svc.AI_USER_ID, player1_pet_id=pa.id, player2_pet_id=ai_pet.id,
                   status="active", max_rounds=10, is_ai_battle=True, ai_config=json.dumps(cfg),
                   questions_data="[]", player1_initial_hp=300, player2_initial_hp=300,
                   player1_hp=300, player2_hp=300, pet_hp_data="{}")
    db.add(bt)
    await db.flush()
    db.add(PetBattleRound(battle_id=bt.id, round_number=1, question_word_id=1, question_text="?", options="[]",
                          correct_answer="A", player1_damage=d1, player2_damage=d2,
                          player1_correct=True, player2_correct=True))
    await db.commit()
    bt, rd = await svc.finalize_round(db, bt.id, 1)
    if raw:
        return rd, json.loads(bt.ai_config)
    return rd.player1_damage, rd.player2_damage, rd.player2_type_text


async def test_type_matchup_only_helps_the_child_in_trial(db_session):
    a, pa = await _student_with_pet(db_session, "trh")      # 蒲电猬: 电
    # 地面克电、电打地面减半 —— 练习赛照旧两头吃亏
    assert await _one_round(db_session, a, pa, "digmole", trial=False) == (20, 60, "属性克制，伤害翻倍！")
    # 闯关: 两头都按 1 倍,也不显示「被克制」
    assert await _one_round(db_session, a, pa, "digmole", trial=True) == (40, 30, None)
    # 闯关里我克制对手(电克水): ×1.3(不是翻倍 —— 翻倍会把一场打回 4 回合)
    d1, d2, _ = await _one_round(db_session, a, pa, "axolotl", trial=True)
    assert (d1, d2) == (52, 30)
    assert pet_trial.TYPE_ONLY_HELPS is True


async def test_trial_type_advantage_is_1_3_and_practice_stays_2(db_session, monkeypatch):
    a, pa = await _student_with_pet(db_session, "trh2")     # 蒲电猬: 电,克水
    # 闯关: ×1.3,倍率和文字都跟着(不写「伤害翻倍」);这一场的 trial 里记着这个数,前端的提示读它
    rd, cfg = await _one_round(db_session, a, pa, "axolotl", trial=True, raw=True)
    assert (rd.player1_damage, rd.player1_type_multiplier, rd.player1_type_text) == (52, 1.3, "属性克制")
    assert (rd.player2_damage, rd.player2_type_multiplier, rd.player2_type_text) == (30, 1.0, None)
    assert cfg["trial"]["type_mult"] == 1.3 == pet_trial.TYPE_HELP_MULT and cfg["trial"]["type_rule"] == "help_only"
    # 练习赛(真人对战同一支): 还是 ×2,文字照旧。(挑战影子 11-12 起和闯关同一套,见 tests/test_pet_shadow.py)
    rd, _ = await _one_round(db_session, a, pa, "axolotl", trial=False, raw=True)
    assert (rd.player1_damage, rd.player1_type_multiplier, rd.player1_type_text) == (80, 2.0, "属性克制，伤害翻倍！")
    # 这个数之前开的闯关(trial 里没有 type_mult): 照当时的规矩 ×2 打完
    rd, cfg = await _one_round(db_session, a, pa, "axolotl", trial=True, raw=True, legacy=True)
    assert "type_mult" not in cfg["trial"] and (rd.player1_damage, rd.player1_type_multiplier) == (80, 2.0)
    assert rd.player1_type_text == "属性克制"
    # 改常量: 新开的闯关 trial.type_mult 跟着变,打出来的也跟着变
    monkeypatch.setattr(pet_trial, "TYPE_HELP_MULT", 1.6)
    rd, cfg = await _one_round(db_session, a, pa, "axolotl", trial=True, raw=True)
    assert cfg["trial"]["type_mult"] == 1.6 and (rd.player1_damage, rd.player1_type_multiplier) == (64, 1.6)
    assert pet_trial.ai_config_from(pet_trial.plan(7, 5))["trial"]["type_mult"] == 1.6


# ---------- 10. 分校的孩子也能打 AI ----------

async def test_branch_student_can_fight_ai_with_tenant_filter_on(client, db_session):
    tenancy.register_tenant_models()      # conftest 走 create_all 不走 init_db: 把租户安全网挂上
    tenancy._org_cache.clear()
    try:
        db_session.add_all([
            Organization(id=1, name="直营", code="TRHQ", status="active"),
            Organization(id=9961, name="分校", code="TRBR", status="active"),
        ])
        await db_session.flush()
        # 线上的 AI 账号挂在直营名下
        db_session.add(User(id=svc.AI_USER_ID, username="AI训练师", email="ai@system.local", hashed_password="",
                            role="student", is_active=True, org_id=1))
        u = User(username="trbranch", email="trbranch@e.com", hashed_password="x", role="student",
                 full_name="分校娃", is_active=True, org_id=9961)
        db_session.add(u)
        await db_session.flush()
        db_session.add(UserPet(user_id=u.id, name="皮卡", species="sparkhog", level=5, evolution_stage=1,
                               current_hp=145, is_active=True))
        await _words(db_session, prefix="trbr")
        await _no_ticket_limit(db_session)
        db_session.expunge_all()          # 线上每个请求都是新会话,身份表里没有 AI 账号

        r = await client.post(QUICK, headers=_h(u.id))
        assert r.status_code == 200, r.text
        assert r.json()["player2_username"] == "AI训练师"
        r = await client.post(_start(1), headers=_h(u.id))
        assert r.status_code == 200, r.text
        mine = await client.get("/api/v1/student/battles/my", headers=_h(u.id))
        assert mine.status_code == 200 and len(mine.json()) == 2
        ai = (await db_session.execute(
            select(User).where(User.id == svc.AI_USER_ID).execution_options(skip_tenant_filter=True)
        )).scalar_one()
        assert ai.org_id == 1, "AI 账号不能被写成分校的"
    finally:
        tenancy.TENANT_MODELS.clear()
        tenancy._org_cache.clear()


# ---------- 11. 表建得出来、结束消息带得上 ----------

def test_progress_model_is_imported_by_models_package_and_ws_end_carries_trial():
    init_py = Path(__file__).resolve().parents[1] / "app" / "models" / "__init__.py"
    assert "from app.models.pet_trial import PetTrialStage" in init_py.read_text(encoding="utf-8")
    assert "trial" in WSBattleEnd.model_fields
    ws_py = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "student" / "pet_battle_ws.py"
    assert 'trial=rewards.get("_trial")' in ws_py.read_text(encoding="utf-8")


# ---------- 12. 闯关赢了体力回满 ----------

async def _injured_logs(db, pet_id) -> int:
    return (await db.execute(select(func.count()).select_from(PetEventLog).where(
        PetEventLog.pet_id == pet_id, PetEventLog.event_type == "injured"))).scalar()


async def test_trial_win_heals_but_loss_and_practice_do_not(client, db_session):
    a, pa = await _student_with_pet(db_session, "tri")
    await _words(db_session)
    await _no_ticket_limit(db_session)

    # 闯关赢了,打完只剩 20 点血 → 回满、不算受伤、不写受伤日志
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    rewards = await _play_out(db_session, bid, rounds=5, correct=5, winner_id=a.id, my_hp=20)
    assert rewards["_trial"]["healed"] is True
    await db_session.refresh(pa)
    assert pa.is_injured is False
    assert pa.current_hp == calculate_max_hp(pa.level, pa.evolution_stage, pa.species)   # 升级了就是新等级的满血
    assert await _injured_logs(db_session, pa.id) == 0
    got = (await client.get(f"/api/v1/student/battle/{bid}", headers=_h(a.id))).json()
    assert got["trial"]["result"]["healed"] is True

    # 练习赛赢了,同样只剩 20 点血 → 照旧: 血就是 20、受伤
    bid = (await client.post(QUICK, headers=_h(a.id))).json()["id"]
    rewards = await _play_out(db_session, bid, rounds=5, correct=5, winner_id=a.id, my_hp=20)
    assert rewards.get("_trial") is None
    await db_session.refresh(pa)
    assert (pa.current_hp, pa.is_injured) == (20, True)
    assert await _injured_logs(db_session, pa.id) == 1

    # 闯关输了 → 不回血
    pa.is_injured, pa.current_hp = False, calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    await db_session.commit()
    bid = (await client.post(_start(2), headers=_h(a.id))).json()["id"]
    rewards = await _play_out(db_session, bid, rounds=4, correct=1, winner_id=svc.AI_USER_ID)
    assert rewards["_trial"]["healed"] is False and rewards["_trial"]["won"] is False
    await db_session.refresh(pa)
    assert (pa.current_hp, pa.is_injured) == (0, True)


# ---------- 13. 三种题型 ----------

async def _learned(db, user, n, prefix):
    from app.models.learning import LearningRecord
    out = []
    for i in range(n):
        w = Word(word=f"{prefix}{i}")
        db.add(w)
        await db.flush()
        db.add(WordDefinition(word_id=w.id, meaning=f"{prefix}的意思{i}", is_primary=True))
        db.add(LearningRecord(user_id=user.id, word_id=w.id, learning_mode="spelling", is_correct=True))
        out.append(w)
    await db.commit()
    return out


def test_question_kind_mix():
    from collections import Counter
    for _ in range(30):
        kinds = svc.question_kinds(10)
        assert kinds[0] == "en2zh", "第 1 题固定是看英文选中文"
        assert Counter(kinds) == {"en2zh": 5, "zh2en": 3, "listen": 2}
    assert Counter(svc.question_kinds(20)) == {"en2zh": 10, "zh2en": 6, "listen": 4}
    for n in (1, 2, 3, 4, 5, 7):
        kinds = svc.question_kinds(n)
        assert len(kinds) == n and kinds[0] == "en2zh"
    assert svc.question_kinds(1) == ["en2zh"] and svc.question_kinds(0) == []


async def test_three_question_kinds_and_what_the_child_is_sent(db_session):
    from collections import Counter
    a, _ = await _student_with_pet(db_session, "trq")
    words = await _learned(db_session, a, 12, "kind")
    by_id = {w.id: w.word for w in words}

    for _ in range(12):
        qs = await svc.generate_battle_questions(db_session, None, count=10, player_ids=[a.id, -1])
        assert len(qs) == 10 and qs[0]["kind"] == "en2zh"
        assert Counter(q["kind"] for q in qs) == {"en2zh": 5, "zh2en": 3, "listen": 2}
        for q in qs:
            assert q["word"] == by_id[q["word_id"]] and [o[:3] for o in q["options"]] == ["A. ", "B. ", "C. ", "D. "]
            right = next(o[3:] for o in q["options"] if o[0] == q["correct_answer"])
            sent = WSNewRound(round_number=1, question=QuestionData(**svc.public_question(q)), time_limit=15)
            pub = json.loads(sent.model_dump_json())["question"]
            assert set(pub) == {"word_id", "word", "question_text", "options", "kind", "display", "spell"}, \
                "出题时不带答案和释义"
            assert pub["spell"] is None        # 咒语由调用方按人另外加(见 tests/test_battle_moves.py)
            if q["kind"] == "zh2en":
                # 单词就是答案: 出题的那一份里 word 是空的,大字显示的是中文;单词只出现在选项里
                assert pub["word"] == "" and pub["display"] == q["meaning"]
                assert q["meaning"] in pub["question_text"] and q["word"] not in pub["question_text"]
                assert right == q["word"]
                spellings = [o[3:].lower() for o in q["options"]]
                assert len(set(spellings)) == 4 and all(sp in {w.lower() for w in by_id.values()} for sp in spellings)
            elif q["kind"] == "listen":
                # 单词照给(前端要拿它去读),不显示
                assert pub["word"] == q["word"] and pub["display"] is None
                assert pub["question_text"] == svc.LISTEN_TEXT and right == q["meaning"]
            else:
                assert pub["word"] == pub["display"] == q["word"] and right == q["meaning"]
            # 结算时才给全
            res = RoundQuestionData(**svc.result_question(q))
            assert (res.word, res.meaning, res.correct_answer, res.kind) == (
                q["word"], q["meaning"], q["correct_answer"], q["kind"])


async def test_repeated_word_gets_a_different_kind(db_session):
    """词池只有 3 个词也凑满 10 题;同一个词再出现时换一种题型(头两次一定不一样)"""
    a, _ = await _student_with_pet(db_session, "trr")
    learned = await _learned(db_session, a, 3, "few")
    for i in range(6):                     # 库里别的词: 给「看中文选英文」当干扰项用
        w = Word(word=f"other{i}")
        db_session.add(w)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=w.id, meaning=f"别的意思{i}", is_primary=True))
    await db_session.commit()
    for _ in range(25):
        qs = await svc.generate_battle_questions(db_session, None, count=10, player_ids=[a.id])
        assert len(qs) == 10 and {q["word_id"] for q in qs} == {w.id for w in learned}
        seen: dict = {}
        for q in qs:
            seen.setdefault(q["word_id"], []).append(q["kind"])
        for kinds in seen.values():
            assert len(kinds) >= 3 and kinds[0] != kinds[1], f"同一个词头两次出现该换题型: {kinds}"


async def test_zh2en_distractors_skip_same_spelling_and_same_meaning(db_session):
    def add(word, meaning):
        w = Word(word=word)
        db_session.add(w)
        return w, meaning
    made = [add("big", "大的"), add("Big", "大型的"), add("large", "大的"),
            add("cat", "猫"), add("dog", "狗"), add("sun", "太阳")]
    await db_session.flush()
    for w, meaning in made:
        db_session.add(WordDefinition(word_id=w.id, meaning=meaning, is_primary=True))
    await db_session.commit()
    target = made[0][0]
    for _ in range(20):
        # 词池里: Big 和 big 拼写一样(不分大小写)、large 和它一个意思 —— 都不能当干扰项
        assert sorted(await svc._spelling_distractors(db_session, target, "大的", made)) == ["cat", "dog", "sun"]
        # 词池不够(只有它自己): 去全库里补,同样的规矩
        assert sorted(await svc._spelling_distractors(db_session, target, "大的", [made[0]])) == ["cat", "dog", "sun"]
    # 释义里直接写着单词的,不出「看中文选英文」(等于把答案印在题目上)
    assert svc._meaning_gives_away("(=center) 中心", "center") is True
    assert svc._meaning_gives_away("n. 中心;中央", "center") is False


async def test_tiny_word_bank_falls_back_to_english_to_chinese(db_session):
    """库里一共两个词: 凑不出 3 个干扰单词,「看中文选英文」退回看英文选中文,照样出满题"""
    a, _ = await _student_with_pet(db_session, "trt")
    await _learned(db_session, a, 2, "tiny")
    qs = await svc.generate_battle_questions(db_session, None, count=6, player_ids=[a.id])
    assert len(qs) == 6 and all(q["kind"] in ("en2zh", "listen") for q in qs)
    assert all(len(q["options"]) == 4 for q in qs)


async def test_review_gives_chinese_meaning_and_old_questions_still_play(db_session):
    a, pa = await _student_with_pet(db_session, "tru")
    b, pb = await _student_with_pet(db_session, "trv")
    w1, w2 = Word(word="review"), Word(word="apple")
    db_session.add_all([w1, w2])
    await db_session.flush()
    new_q = {"word_id": w1.id, "word": "review", "question_text": "哪个单词的意思是「复习」?",
             "options": ["A. preview", "B. review", "C. renew", "D. rest"], "correct_answer": "B",
             "kind": "zh2en", "display": "复习", "meaning": "复习"}
    # 上线那一刻正在打的对战: 题目是老格式,没有 kind / display / meaning
    old_q = {"word_id": w2.id, "word": "apple", "question_text": "单词 'apple' 的意思是?",
             "options": ["A. 苹果", "B. 香蕉", "C. 梨", "D. 桃"], "correct_answer": "A"}
    bt = PetBattle(player1_id=a.id, player2_id=b.id, player1_pet_id=pa.id, player2_pet_id=pb.id,
                   status="active", max_rounds=2, questions_data=json.dumps([new_q, old_q], ensure_ascii=False),
                   player1_initial_hp=300, player2_initial_hp=300, player1_hp=300, player2_hp=300, pet_hp_data="{}")
    db_session.add(bt)
    await db_session.commit()

    # 老格式的题: 按看英文选中文发,大字显示单词;结算时意思从正确选项里取
    pub = svc.public_question(old_q)
    assert (pub["kind"], pub["word"], pub["display"]) == ("en2zh", "apple", "apple")
    assert QuestionData(**old_q).kind == "en2zh"
    assert RoundQuestionData(**svc.result_question(old_q)).meaning == "苹果"

    await svc.process_round_answer(db_session, bt.id, a.id, 1, "B", 2000)
    await svc.process_round_answer(db_session, bt.id, b.id, 1, "A", 3000)
    bt, r1 = await svc.finalize_round(db_session, bt.id, 1)
    assert r1.player1_correct is True and r1.player2_correct is False
    await svc.process_round_answer(db_session, bt.id, a.id, 2, "A", 2000)
    await svc.process_round_answer(db_session, bt.id, b.id, 2, "X", 16000)
    bt, r2 = await svc.finalize_round(db_session, bt.id, 2)
    assert r2.player1_correct is True and bt.current_round == 2

    review = await svc.battle_review(db_session, bt.id)
    # 「看中文选英文」的正确选项是英文单词: 结算页要的是中文意思,不能把 review 当意思给出去
    assert (review[0]["word"], review[0]["meaning"]) == ("review", "复习")
    assert (review[1]["word"], review[1]["meaning"]) == ("apple", "苹果")
    assert review[0]["player1_correct"] is True and review[1]["player2_answered"] is False


# ---------- 14. 不能向系统账号发挑战 ----------

async def test_cannot_challenge_the_ai_account(client, db_session):
    a, _ = await _student_with_pet(db_session, "trw")
    db_session.add(User(id=svc.AI_USER_ID, username="AI训练师", email="ai@system.local",
                        hashed_password="", role="student", is_active=True, org_id=a.org_id))
    db_session.add(UserPet(user_id=svc.AI_USER_ID, name="数码训练大师", species="lionknight", level=12,
                           evolution_stage=1, current_hp=160, is_active=True))
    await _words(db_session)
    before = await _battle_count(db_session)
    r = await client.post("/api/v1/student/battle/create", json={"opponent_id": svc.AI_USER_ID},
                          headers={**_h(a.id), "X-EH-Battle": "2"})
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "bad_opponent"
    assert await _battle_count(db_session) == before, "以前这样能建出一场永远没人接的挑战"


# ---------- 15. 闯关打满 10 回合按剩余血量的比例判 ----------

async def test_trial_round_limit_is_judged_by_hp_ratio(client, db_session):
    a, pa = await _student_with_pet(db_session, "trx")
    await _words(db_session)
    await _no_ticket_limit(db_session)
    await _clear(db_session, a.id, 4)

    # 守关打满 10 回合: 我剩 60 / 145(41%),对手剩 100 / 330(30%)—— 比绝对值是它赢,比比例是我赢
    bid = (await client.post(_start(5), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    assert (bt.player1_initial_hp, bt.player2_initial_hp) == (145, 330)
    bt.current_round, bt.player1_hp, bt.player2_hp = 10, 60, 100
    await db_session.commit()
    assert await svc.check_battle_end(bt) == a.id, "闯关按比例判: 对手血厚,比绝对值永远是它赢"
    bt.player1_hp, bt.player2_hp = 30, 100          # 21% 对 30%: 这回是它赢
    assert await svc.check_battle_end(bt) == svc.AI_USER_ID
    bt.player1_hp, bt.player2_hp = 29, 66           # 都是 20%: 比答对的题数
    bt.player1_total_correct, bt.player2_total_correct = 6, 4
    assert await svc.check_battle_end(bt) == a.id
    bt.player1_total_correct = 4
    assert await svc.check_battle_end(bt) is None, "比例一样、答对一样多 = 平局(不算通过)"
    # 没打满 10 回合、谁也没倒: 还没结束
    bt.current_round, bt.player1_hp, bt.player2_hp = 9, 60, 100
    assert await svc.check_battle_end(bt) is None
    # 血打空的照旧: 不看比例
    bt.player2_hp = 0
    assert await svc.check_battle_end(bt) == a.id

    # 练习赛 / 真人对战照旧比绝对值
    pa.is_injured, pa.current_hp = False, 145
    await db_session.commit()
    bid = (await client.post(QUICK, headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    bt.player2_initial_hp = 330
    bt.current_round, bt.player1_hp, bt.player2_hp = 10, 60, 100
    assert await svc.check_battle_end(bt) == svc.AI_USER_ID


# ---------- 16. 闯关里 AI 答错不掉血;练习赛照旧掉 10 ----------

async def test_ai_miss_only_hurts_itself_outside_trial(client, db_session):
    a, pa = await _student_with_pet(db_session, "try")
    await _words(db_session)
    await _no_ticket_limit(db_session)

    async def ai_answers_wrong(path):
        pa.is_injured, pa.current_hp = False, 145
        await db_session.commit()
        bid = (await client.post(path, headers=_h(a.id))).json()["id"]
        bt = await db_session.get(PetBattle, bid)
        q = json.loads(bt.questions_data)[0]
        wrong = "B" if q["correct_answer"] == "A" else "A"
        hp_before = bt.player2_hp
        await svc.process_round_answer(db_session, bid, a.id, 1, "X", 16000)          # 我超时: 这一回合只看它
        await svc.process_round_answer(db_session, bid, svc.AI_USER_ID, 1, wrong, 4000)
        bt, rd = await svc.finalize_round(db_session, bid, 1)
        return rd.player2_damage, hp_before - bt.player2_hp, rd.player1_damage

    # 第三个数是孩子自己(超时没答)扣的: 闯关里孩子答错照样掉 10,不掉血的只有 AI
    assert await ai_answers_wrong(_start(1)) == (0, 0, -10), "闯关里 AI 答错不掉血(以前它七成回合在替孩子打)"
    assert await ai_answers_wrong(QUICK) == (-10, 10, -10), "练习赛照旧"


# ---------- 17. 防守还答对了 = 拿不准的词 ----------

async def test_guard_and_right_is_marked_unsure_in_review(client, db_session):
    a, pa = await _student_with_pet(db_session, "trz")
    await _words(db_session, n=8)
    await _no_ticket_limit(db_session)
    bid = (await client.post(_start(1), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    qs = json.loads(bt.questions_data)
    right = [q["correct_answer"] for q in qs]
    wrong = ["B" if r == "A" else "A" for r in right]
    # 第 1 回合 防守答对 / 第 2 回合 普通答对 / 第 3 回合 重击答对 / 第 4 回合 防守答错
    plays = [("guard", right[0]), (None, right[1]), ("heavy", right[2]), ("guard", wrong[3])]
    for n, (stance, answer) in enumerate(plays, start=1):
        await svc.process_round_answer(db_session, bid, a.id, n, answer, 6000, stance=stance)
        await svc.process_round_answer(db_session, bid, svc.AI_USER_ID, n, "X", 16000)
        bt, _ = await svc.finalize_round(db_session, bid, n)

    review = await svc.battle_review(db_session, bid)
    assert [(x["round"], x["player1_correct"], x["player1_unsure"], x["unsure"]) for x in review] == [
        (1, True, True, True),        # 防守还答对了: 对的,但拿不准
        (2, True, False, False),      # 普通答对: 不标
        (3, True, False, False),      # 重击答对: 不标
        (4, False, False, False),     # 防守答错: 就是错,不是「拿不准」
    ]
    assert all(x["player2_unsure"] is False for x in review)
    # 不算错: 星星照「答对几题」算(4 回合错 1 个 = 2 星),掌握度那边也没被记成答错
    bt.player2_hp = 0
    await db_session.commit()
    rewards = await svc.finish_battle(db_session, bid, a.id)
    assert rewards["_trial"]["stars"] == 2
