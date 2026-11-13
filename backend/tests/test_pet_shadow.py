"""宠物对战 · 挑战同学的影子(2026-11-12,规则真源 app/services/pet_shadow.py)

起因: 真人对战要两个人同时在线,近 30 天只打了 8 场。影子 = 同学的宠物 + 他平时答题的水平,电脑替他打。
这里锁住:
  1. 只能挑战同班、同机构、有出战宠物的同学: 别班 / 别的机构 / 离开班的 / 没宠物的 / 没这个人 → 404,自己 → 400;
     拦下时不建对战;没进班的列表是空的并写明原因
  2. 影子的水平按他自己答的回合算(别人挑战他影子的那些场不算、没答完的回合不算、超时算错、只看最近 50 个),
     两头夹住;不足 10 个回合用默认值;开打时用的就是这组数
  3. 影子的等级夹在 [我的等级 − 1, 我的等级 + 3] 里、进化阶段跟着等级、血量和闯关普通关同一档(同一个函数);
     对手是这一场新建的一行,不是同学的真宠物;名字不露手机号;
     BattleResponse.shadow 只给名字和这一场的克制规矩,不给主人的 id
  4. 同一个同学一天一次;一回合没打的不算;昨天的不算;挑战别的同学不受影响;列表里挑战过的排后面
  5. 闸门顺序: 没宠物 → 受伤 → 这个人不能挑战 → 今天已经挑战过 → 没场数;吃一场对战场数
  6. 战报: 打完记一条且只记一条;输赢对(平局 / 逃跑算守住);主人看得到、别人看不到;看过以后 unseen 归零;
     一回合没打的、被新对战顶掉的不记
  7. 影子主人的真宠物不掉血、不受伤、不涨经验;我输了照练习赛受伤
  8. 一场的节奏和闯关同一套: 影子答错不掉血、属性克制只帮不坑(我克制它 ×1.3)、打满 10 回合按剩余血量的比例判;
     改节奏之前开的影子(没有 type_rule)照当时的规矩打完;练习赛不受影响
  9. 平台开关: 关了列表给空、开打 403、不建对战
 10. 战报表的模型在 app/models/__init__.py 里导入;三个接口排在 /battle/{battle_id} 前面
 11. 真走 WebSocket 打一整场影子(赢一场、输一场): 每回合有结果、最后有 battle_end、战报记对、
     对战信息里带着是谁的影子、影子主人的真宠物没动(战报是在对战主连接那个长会话里写的)
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from sqlalchemy import func, select

from app.core.pet_formulas import calculate_max_hp, evolution_stage_for_level
from app.models.organization import Organization
from app.models.pet import PetEventLog, UserPet
from app.models.pet_battle import PetBattle, PetBattleRound
from app.models.pet_shadow import PetShadowLog
from app.models.user import Class, ClassStudent, User
from app.models.word import Word, WordDefinition
from app.services import battle_tickets, pet_shadow, pet_trial
from app.services import pet_battle_service as svc
from tests.test_pet_multitab_exploits import _h, _org, _student_with_pet
from tests.test_pet_battle_ws_flow import AI_RIGHT, _answers_of, _heal, _open_battle, _play, live  # noqa: F401

LIST = "/api/v1/student/battle/shadows"
LOGS = "/api/v1/student/battle/shadow-logs"
QUICK = "/api/v1/student/battle/quick-match"


def _start(user_id: int) -> str:
    return f"/api/v1/student/battle/shadow/{user_id}/start"


async def _words(db, n=6, prefix="sh"):
    for i in range(n):
        w = Word(word=f"{prefix}word{i}")
        db.add(w)
        await db.flush()
        db.add(WordDefinition(word_id=w.id, meaning=f"义{prefix}{i}", is_primary=True))
    await db.commit()


async def _set(db, **values):
    await battle_tickets.save_settings(db, {**await battle_tickets.get_settings(db), **values})
    await db.commit()


async def _class(db, name, students, org_id=None):
    org = await _org(db)
    t = User(username=f"{name}_t", email=f"{name}_t@e.com", hashed_password="x", role="teacher",
             full_name="王老师", is_active=True, org_id=org_id or org.id)
    db.add(t)
    await db.flush()
    c = Class(name=name, teacher_id=t.id, org_id=org_id or org.id)
    db.add(c)
    await db.flush()
    for s in students:
        db.add(ClassStudent(class_id=c.id, student_id=s.id, is_active=True))
    await db.commit()
    return c


async def _battle_count(db) -> int:
    return (await db.execute(select(func.count()).select_from(PetBattle))).scalar()


async def _rounds(db, user, pet, answers, *, as_player2=False):
    """给 user 造一场他自己打过的对战: answers = [(答对没有, 用时毫秒, 交的答案)],按顺序一回合一行"""
    other, other_pet = await _student_with_pet(db, f"opp{user.id}_{len(answers)}_{int(as_player2)}")
    p1, pet1, p2, pet2 = (other, other_pet, user, pet) if as_player2 else (user, pet, other, other_pet)
    bt = PetBattle(player1_id=p1.id, player2_id=p2.id, player1_pet_id=pet1.id, player2_pet_id=pet2.id,
                   status="finished", max_rounds=len(answers), questions_data="[]", pet_hp_data="{}",
                   player1_initial_hp=100, player2_initial_hp=100, player1_hp=100, player2_hp=100)
    db.add(bt)
    await db.flush()
    for i, (ok, ms, ans) in enumerate(answers, start=1):
        mine = {"answer": ans, "correct": ok, "time_ms": ms}
        kw = {f"player{2 if as_player2 else 1}_{k}": v for k, v in mine.items()}
        db.add(PetBattleRound(battle_id=bt.id, round_number=i, question_word_id=1, question_text="?",
                              options="[]", correct_answer="A", **kw))
    await db.commit()
    return bt


async def _finish(db, battle_id, *, rounds, winner_id, my_hp=None):
    bt = await db.get(PetBattle, battle_id)
    bt.current_round = rounds
    if winner_id == bt.player1_id:
        bt.player2_hp = 0
        if my_hp is not None:
            bt.player1_hp = my_hp
    elif winner_id is not None:
        bt.player1_hp = 0
    await db.commit()
    return await svc.finish_battle(db, battle_id, winner_id)


async def _ready(db, pet):
    """上一场打完宠物可能伤了: 治好再打下一场"""
    pet.is_injured, pet.current_hp = False, 145
    await db.commit()


# ---------- 1. 能挑战谁 ----------

async def test_only_classmates_with_a_pet_can_be_challenged(client, db_session):
    a, _ = await _student_with_pet(db_session, "sha")
    b, _ = await _student_with_pet(db_session, "shb")
    other_class, _ = await _student_with_pet(db_session, "shc")
    left, _ = await _student_with_pet(db_session, "shd")
    org = await _org(db_session)
    no_pet = User(username="she", email="she@e.com", hashed_password="x", role="student",
                  full_name="没宠物", is_active=True, org_id=org.id)
    db_session.add(Organization(id=9971, name="别的机构", code="SHOTHER", status="active"))
    # 脏数据: 别的机构的学生被挂进了我的班 —— 也不能挑战(名字会给出去)
    stray = User(username="shf", email="shf@e.com", hashed_password="x", role="student",
                 full_name="别的机构", is_active=True, org_id=9971)
    db_session.add_all([no_pet, stray])
    await db_session.flush()
    db_session.add(UserPet(user_id=stray.id, name="外来", species="sparkhog", level=5, evolution_stage=1,
                           current_hp=100, is_active=True))
    cls = await _class(db_session, "一班", [a, b, no_pet, stray])
    await _class(db_session, "二班", [other_class])
    db_session.add(ClassStudent(class_id=cls.id, student_id=left.id, is_active=False))     # 已经离开这个班
    await _words(db_session)
    await _set(db_session, enabled=False)

    r = (await client.get(LIST, headers=_h(a.id))).json()
    assert r["enabled"] is True and [i["user_id"] for i in r["items"]] == [b.id]
    assert set(r["items"][0]) == {"user_id", "name", "pet_name", "species", "evolution_stage", "level",
                                  "accuracy", "challenged_today"}
    assert "reason" not in r

    before = await _battle_count(db_session)
    for target in (other_class.id, left.id, no_pet.id, stray.id, 987654):
        r = await client.post(_start(target), headers=_h(a.id))
        assert r.status_code == 404 and r.json()["detail"]["code"] == "shadow_not_found", (target, r.text)
    r = await client.post(_start(a.id), headers=_h(a.id))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "shadow_self"
    assert await _battle_count(db_session) == before, "被拦下时不该建对战"

    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 200, r.text

    # 没进班的孩子: 列表是空的,写明原因;谁也挑战不了
    r = (await client.get(LIST, headers=_h(other_class.id))).json()
    assert [i["user_id"] for i in r["items"]] == []          # 二班只有他一个人
    loner, _ = await _student_with_pet(db_session, "shg")
    await db_session.commit()
    r = (await client.get(LIST, headers=_h(loner.id))).json()
    assert r["items"] == [] and r["reason"] == "还没有加入班级" == pet_shadow.NO_CLASS
    assert (await client.post(_start(b.id), headers=_h(loner.id))).status_code == 404


# ---------- 2. 影子的水平 ----------

def test_skill_is_clamped_and_falls_back_when_he_has_played_little():
    # 不足 10 个回合: 默认值
    assert pet_shadow.skill_from([(True, 1000)] * 9) == {
        "accuracy": 0.60, "speed_min_ms": 3500, "speed_max_ms": 7500, "rounds": 9}
    # 全对又飞快: 正确率封顶 0.78(11-12 从 0.88 调下来: 最强的影子要打得过);用时最快按 1800,两头至少隔 1500
    s = pet_shadow.skill_from([(True, 600)] * 20)
    assert (s["accuracy"], s["speed_min_ms"], s["speed_max_ms"]) == (0.78, 1800, 3300)
    # 全错: 正确率托底 0.40;没有答对的回合可以量用时,用默认的
    s = pet_shadow.skill_from([(False, 9000)] * 12)
    assert (s["accuracy"], s["speed_min_ms"], s["speed_max_ms"]) == (0.40, 3500, 7500)
    # 又慢又稳: 用时封顶 9000,还是隔开 1500
    s = pet_shadow.skill_from([(True, 14000)] * 10)
    assert (s["speed_min_ms"], s["speed_max_ms"]) == (7500, 9000)
    # 正常的(落在封顶以下,验的是算得对): 12 个回合 8 个对,答对的用时 2000…9000 → 25 / 75 分位
    rounds = [(True, ms) for ms in (2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000)] + [(False, 500), (False, None)] * 2
    s = pet_shadow.skill_from(rounds)
    assert (s["accuracy"], s["speed_min_ms"], s["speed_max_ms"], s["rounds"]) == (0.667, 3750, 7250, 12)
    # 只看最近 50 个(最近的在前)
    # (要是把 80 个都算上是 50 / 80 = 0.625,到不了封顶)
    assert pet_shadow.skill_from([(True, 3000)] * 50 + [(False, 3000)] * 30)["accuracy"] == 0.78
    assert (pet_shadow.ACC_MIN, pet_shadow.ACC_MAX, pet_shadow.SKILL_ROUNDS, pet_shadow.SKILL_MIN_ROUNDS) == (0.40, 0.78, 50, 10)


async def test_skill_comes_from_rounds_he_answered_himself(client, db_session):
    a, pa = await _student_with_pet(db_session, "shsa")
    b, pb = await _student_with_pet(db_session, "shsb")
    await _class(db_session, "水平班", [a, b])
    await _words(db_session)
    await _set(db_session, enabled=False)

    # 很早以前的 10 个回合全错(排在 50 个以外,不该算)
    await _rounds(db_session, b, pb, [(False, 4000, "B")] * 10)
    # 最近的 50 个: 他当玩家 1 的 30 个(24 对 + 4 错 + 2 个超时没答)、当玩家 2 的 20 个(14 对 + 6 错)
    await _rounds(db_session, b, pb, [(True, 4000, "A")] * 24 + [(False, 3000, "B")] * 4 + [(False, 16000, "X")] * 2)
    await _rounds(db_session, b, pb, [(True, 6000, "A")] * 14 + [(False, 5000, "B")] * 6, as_player2=True)
    # 还没答的回合(答案是空的)不算
    await _rounds(db_session, b, pb, [(False, None, None)] * 5)
    # 别人挑战他的影子: 那是电脑替他答的(全错),他不是这场的玩家,不算
    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 200, r.text
    shadow_battle = r.json()["id"]
    for i in range(1, 9):
        db_session.add(PetBattleRound(battle_id=shadow_battle, round_number=i, question_word_id=1,
                                      question_text="?", options="[]", correct_answer="A",
                                      player1_answer="A", player1_correct=True, player1_time_ms=2000,
                                      player2_answer="B", player2_correct=False, player2_time_ms=2000))
    await db_session.commit()

    skill = (await pet_shadow.skills_of(db_session, [b.id, a.id]))
    # 38 / 50 = 0.76(在封顶 0.78 以下,验的是算得对);答对的用时 24 个 4000 + 14 个 6000 → 25 分位 4000、75 分位 6000
    assert skill[b.id] == {"accuracy": 0.76, "speed_min_ms": 4000, "speed_max_ms": 6000, "rounds": 50}
    # a 自己: 只有刚才那 8 个回合(当挑战的人,算他自己答的)→ 不足 10 个,用默认值
    assert skill[a.id]["rounds"] == 8 and skill[a.id]["accuracy"] == 0.60

    # 开打时用的就是这组数
    await _finish(db_session, shadow_battle, rounds=0, winner_id=None)      # 一回合没打就结束: 今天还能再挑战
    await _ready(db_session, pa)
    c, pc = await _student_with_pet(db_session, "shsc")
    await _class(db_session, "水平班二", [a, c])
    await _rounds(db_session, c, pc, [(True, 2500, "A")] * 6 + [(False, 2500, "B")] * 6)
    bid = (await client.post(_start(c.id), headers=_h(a.id))).json()["id"]
    cfg = json.loads((await db_session.get(PetBattle, bid)).ai_config)
    assert (cfg["accuracy"], cfg["speed_min_ms"], cfg["speed_max_ms"]) == (0.5, 2500, 4000)
    # 列表里的正确率给个大概(取整到 5)
    items = {i["user_id"]: i for i in (await client.get(LIST, headers=_h(a.id))).json()["items"]}
    # 列表里显示的是取整到 5 的百分数: 0.5 → 50,0.76 → 75
    assert items[c.id]["accuracy"] == 50 and items[b.id]["accuracy"] == 75


# ---------- 3. 影子的宠物 ----------

def test_names_shown_to_classmates_hide_phone_numbers():
    assert pet_shadow.classmate_name("李小明", "13812345678") == "李小明"
    assert pet_shadow.classmate_name(None, "13812345678") == "同学"
    assert pet_shadow.classmate_name("  ", "li13812345678") == "li"
    assert pet_shadow.classmate_name(None, "小明2023") == "小明"
    assert pet_shadow.classmate_name(None, "小明12") == "小明12"          # 三位以内的数字不像手机号,留着
    assert pet_shadow.classmate_name(None, None) == "同学"


async def test_shadow_level_is_capped_and_it_is_a_fresh_pet(client, db_session):
    a, pa = await _student_with_pet(db_session, "shla")                 # 5 级
    b, pb = await _student_with_pet(db_session, "shlb")
    weak, pw = await _student_with_pet(db_session, "shlc")
    b.full_name, b.username = None, "shlb13800001111"
    pb.name, pb.species, pb.level, pb.evolution_stage, pb.current_hp, pb.experience = "闪电", "digmole", 20, 2, 77, 5
    pw.level, pw.evolution_stage = 2, 0
    await _class(db_session, "等级班", [a, b, weak])
    await _words(db_session)
    await _set(db_session, enabled=False)

    # 等级: 他的等级夹在 [我的 − 1, 我的 + 3] 里
    assert (pet_shadow.LEVEL_BEHIND, pet_shadow.LEVEL_LEAD) == (1, 3)
    assert pet_shadow.shadow_level(20, 5) == 8 and pet_shadow.shadow_level(8, 5) == 8 and pet_shadow.shadow_level(9, 5) == 8
    assert pet_shadow.shadow_level(1, 5) == 4 and pet_shadow.shadow_level(2, 5) == 4, "太低的拉到我的等级 − 1"
    assert pet_shadow.shadow_level(4, 5) == 4 and pet_shadow.shadow_level(6, 5) == 6, "在范围里的照他自己的"
    assert pet_shadow.shadow_level(1, 1) == 1 and pet_shadow.shadow_level(None, None) == 1 and pet_shadow.shadow_level(3, 1) == 3
    # 血量: 闯关普通关那一档(同一个函数算出来的同一个数)
    for lv in (1, 4, 8, 17):
        e = evolution_stage_for_level(lv)
        assert pet_shadow.shadow_max_hp(lv) == pet_trial.hits_hp(e, pet_trial.NORMAL_POS) == pet_trial.plan(1, lv)["max_hp"]
    assert pet_trial.hits_hp(1) == 264 and pet_trial.hits_hp(1, 4) == 330 == pet_trial.plan(5, 5)["max_hp"]

    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 200, r.text
    body = r.json()
    opp = body["player2_pet"]
    evo = evolution_stage_for_level(8)
    assert body["mode"] == "shadow" == pet_shadow.MODE
    assert (opp["level"], opp["species"], opp["evolution_stage"]) == (8, "digmole", evo)
    assert opp["name"] == "shlb的闪电", "用户名里的手机号不能露给同学"
    assert opp["max_hp"] == opp["hp"] == pet_trial.hits_hp(evo) == pet_trial.plan(1, 8)["max_hp"], \
        "血量和闯关普通关同一档"
    assert opp["max_hp"] > calculate_max_hp(8, evo, "digmole") * 1.4, "比公式厚(照公式一场只有两三个回合)"
    assert body["player2_roster"][0]["max_hp"] == opp["max_hp"]
    assert opp["pet_id"] != pb.id, "场上那只是这一场新建的,不是同学的真宠物"
    assert body["shadow"] == {"owner_name": "shlb", "pet_name": "闪电", "type_rule": "help_only",
                              "type_mult": 1.3}, "只给名字和克制规矩,不给主人的 id"
    assert body["shadow"]["type_mult"] == pet_trial.TYPE_HELP_MULT
    assert body["trial"] is None and body["play"]["stances"] is True
    bt = await db_session.get(PetBattle, body["id"])
    cfg = json.loads(bt.ai_config)
    assert cfg["shadow"] == {"owner_id": b.id, "owner_name": "shlb", "pet_name": "闪电",
                             "type_rule": "help_only", "type_mult": 1.3}
    assert (bt.player2_initial_hp, bt.player2_hp) == (opp["max_hp"], opp["max_hp"])
    assert bt.is_ai_battle and bt.player2_id == svc.AI_USER_ID and bt.status == "active"
    ai_pet = await db_session.get(UserPet, bt.player2_pet_id)
    assert ai_pet.user_id == svc.AI_USER_ID

    # 比我弱很多的同学(2 级,我 5 级): 拉到我的等级 − 1 = 4 级 —— 不然两下就打死了
    await _finish(db_session, body["id"], rounds=0, winner_id=None)
    await _ready(db_session, pa)
    opp = (await client.post(_start(weak.id), headers=_h(a.id))).json()["player2_pet"]
    weak_evo = evolution_stage_for_level(4)
    assert (opp["level"], opp["evolution_stage"], opp["max_hp"]) == (4, weak_evo, pet_trial.hits_hp(weak_evo))
    await db_session.refresh(pw)
    assert (pw.level, pw.evolution_stage) == (2, 0), "他的真宠物还是 2 级"
    # 列表里显示的也是调整后的等级
    items = {i["user_id"]: i for i in (await client.get(LIST, headers=_h(a.id))).json()["items"]}
    assert (items[b.id]["level"], items[b.id]["evolution_stage"], items[b.id]["name"]) == (8, evo, "shlb")
    assert (items[weak.id]["level"], items[weak.id]["evolution_stage"]) == (4, weak_evo)
    # 别的对战没有 shadow
    await _finish(db_session, (await db_session.execute(select(func.max(PetBattle.id)))).scalar(), rounds=0, winner_id=None)
    await _ready(db_session, pa)
    assert (await client.post(QUICK, headers=_h(a.id))).json()["shadow"] is None


# ---------- 4. 一天一次 ----------

async def test_once_a_day_per_classmate_and_unplayed_does_not_count(client, db_session):
    a, pa = await _student_with_pet(db_session, "shoa")
    b, _ = await _student_with_pet(db_session, "shob")
    c, pc = await _student_with_pet(db_session, "shoc")
    pc.level = 9            # 等级离我远一点: 平时排在 b 后面
    await _class(db_session, "一次班", [a, b, c])
    await _words(db_session)
    await _set(db_session, enabled=False)

    first = (await client.post(_start(b.id), headers=_h(a.id))).json()["id"]
    # 点进去一回合没打: 不算挑战过,还能再来(再开一场会把上一场顶掉)
    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 200, r.text
    second = r.json()["id"]
    old = await db_session.get(PetBattle, first)
    await db_session.refresh(old)
    assert old.status == "cancelled", "一人同时只打一场"
    items = (await client.get(LIST, headers=_h(a.id))).json()["items"]
    assert [(i["user_id"], i["challenged_today"]) for i in items] == [(b.id, False), (c.id, False)]

    await _finish(db_session, second, rounds=2, winner_id=a.id, my_hp=140)
    await _ready(db_session, pa)
    before = await _battle_count(db_session)
    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "shadow_done_today", r.text
    assert "明天再来" in r.json()["detail"]["message"]
    assert await _battle_count(db_session) == before
    # 挑战过的排到后面去;别的同学不受影响
    items = (await client.get(LIST, headers=_h(a.id))).json()["items"]
    assert [(i["user_id"], i["challenged_today"]) for i in items] == [(c.id, False), (b.id, True)]
    r = await client.post(_start(c.id), headers=_h(a.id))
    assert r.status_code == 200, r.text
    await _finish(db_session, r.json()["id"], rounds=0, winner_id=None)
    await _ready(db_session, pa)

    # 过了半夜(那一场挪到昨天): 又能挑战了
    bt = await db_session.get(PetBattle, second)
    bt.started_at = bt.started_at - timedelta(days=1)
    await db_session.commit()
    assert (await client.post(_start(b.id), headers=_h(a.id))).status_code == 200


# ---------- 5. 闸门顺序、吃场数 ----------

async def test_gate_order_and_it_costs_a_ticket(client, db_session):
    a, pa = await _student_with_pet(db_session, "shga")
    b, _ = await _student_with_pet(db_session, "shgb")
    c, _ = await _student_with_pet(db_session, "shgc")
    org = await _org(db_session)
    petless = User(username="shgd", email="shgd@e.com", hashed_password="x", role="student",
                   full_name="没宠物", is_active=True, org_id=org.id)
    db_session.add(petless)
    await db_session.flush()
    await _class(db_session, "闸门班", [a, b, c, petless])
    await _words(db_session)

    # 没宠物 → 受伤 → 这个人不能挑战
    r = await client.post(_start(b.id), headers=_h(petless.id))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "no_pet"
    pa.is_injured, pa.current_hp = True, 10
    pa.updated_at = datetime.utcnow()
    await db_session.commit()
    r = await client.post(_start(987654), headers=_h(a.id))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "pet_injured", "先说宠物受伤,再说这个人不能挑战"
    await _ready(db_session, pa)

    # 每天送的 1 场: 挑战影子吃掉它
    tickets = "/api/v1/student/battles/tickets"
    assert (await client.get(tickets, headers=_h(a.id))).json()["left"] == 1
    bid = (await client.post(_start(b.id), headers=_h(a.id))).json()["id"]
    await _finish(db_session, bid, rounds=3, winner_id=a.id, my_hp=140)
    await _ready(db_session, pa)
    assert (await client.get(tickets, headers=_h(a.id))).json()["left"] == 0

    before = await _battle_count(db_session)
    # 今天已经挑战过他(排在没场数前面: 这句原因更具体)
    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "shadow_done_today"
    # 没挑战过的同学: 没场数
    r = await client.post(_start(c.id), headers=_h(a.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "need_battle_ticket", r.text
    # 不能挑战的人排在没场数前面
    r = await client.post(_start(987654), headers=_h(a.id))
    assert r.status_code == 404
    assert await _battle_count(db_session) == before, "被拦下时不该建对战"


# ---------- 6. 战报 ----------

async def test_report_is_written_once_and_only_the_owner_sees_it(client, db_session):
    a, pa = await _student_with_pet(db_session, "shra")
    b, _ = await _student_with_pet(db_session, "shrb")
    c, _ = await _student_with_pet(db_session, "shrc")
    d, _ = await _student_with_pet(db_session, "shrd")
    e, _ = await _student_with_pet(db_session, "shre")
    a.full_name = "阿明"
    await _class(db_session, "战报班", [a, b, c, d, e])
    await _words(db_session)
    await _set(db_session, enabled=False)

    async def logs_of(owner_id):
        return list((await db_session.execute(
            select(PetShadowLog).where(PetShadowLog.owner_id == owner_id).order_by(PetShadowLog.id)
        )).scalars())

    # 打赢 b 的影子
    bid = (await client.post(_start(b.id), headers=_h(a.id))).json()["id"]
    await _finish(db_session, bid, rounds=4, winner_id=a.id, my_hp=140)
    rows = await logs_of(b.id)
    assert len(rows) == 1
    assert (rows[0].battle_id, rows[0].challenger_id, rows[0].challenger_name, rows[0].owner_won, rows[0].pet_name) == (
        bid, a.id, "阿明", False, "皮卡")
    assert rows[0].seen_at is None
    # 同一场再结算一次(两条连接都来结算): 还是一条
    await svc.finish_battle(db_session, bid, a.id)
    assert len(await logs_of(b.id)) == 1

    # 输给 c 的影子: 守住了
    await _ready(db_session, pa)
    bid = (await client.post(_start(c.id), headers=_h(a.id))).json()["id"]
    await _finish(db_session, bid, rounds=5, winner_id=svc.AI_USER_ID)
    assert [r.owner_won for r in await logs_of(c.id)] == [True]

    # 打了一回合就逃跑: 也算守住
    await _ready(db_session, pa)
    bid = (await client.post(_start(d.id), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    bt.current_round = 1
    await db_session.commit()
    r = await client.post(f"/api/v1/student/battle/{bid}/forfeit", headers=_h(a.id))
    assert r.status_code == 200 and r.json()["forfeited"] is True
    assert [r.owner_won for r in await logs_of(d.id)] == [True]

    # 一回合没打就退出: 不记;被新对战顶掉的那一场: 不记
    await _ready(db_session, pa)
    bid = (await client.post(_start(e.id), headers=_h(a.id))).json()["id"]
    r = await client.post(f"/api/v1/student/battle/{bid}/forfeit", headers=_h(a.id))
    assert r.status_code == 200
    await _ready(db_session, pa)
    bid = (await client.post(_start(e.id), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    bt.current_round = 2
    await db_session.commit()
    assert (await client.post(QUICK, headers=_h(a.id))).status_code == 200          # 另开一场,把它顶掉
    assert (await svc.finish_battle(db_session, bid, a.id)) == {"_superseded": True}
    assert await logs_of(e.id) == []
    # 平局(打满回合血量一样): 算守住 —— 挑战的人没赢
    assert (await pet_shadow.settle(db_session, _Fake(9001, a.id, {"owner_id": e.id, "pet_name": "皮卡"}, 10), None))[
        "owner_won"] is True
    await db_session.commit()
    assert [r.owner_won for r in await logs_of(e.id)] == [True]

    # b 看得到: 影子被打败 1 次、有 1 条没看过
    r = (await client.get(LIST, headers=_h(b.id))).json()
    assert r["my_record"] == {"defended": 0, "lost": 1} and r["unseen"] == 1
    assert (await client.get(LIST, headers=_h(c.id))).json()["my_record"] == {"defended": 1, "lost": 0}
    logs = (await client.get(LOGS, headers=_h(b.id))).json()["items"]
    assert len(logs) == 1 and logs[0]["challenger_name"] == "阿明" and logs[0]["owner_won"] is False
    assert logs[0]["pet_name"] == "皮卡" and logs[0]["at"].endswith("Z") and logs[0]["new"] is True
    assert (await client.get(LIST, headers=_h(b.id))).json()["unseen"] == 1, "只是看列表不算看过"
    # mark=1: 标成看过
    logs = (await client.get(f"{LOGS}?mark=1", headers=_h(b.id))).json()["items"]
    assert logs[0]["new"] is True, "这一次返回的还是标之前的样子"
    assert (await client.get(LIST, headers=_h(b.id))).json()["unseen"] == 0
    assert (await client.get(LOGS, headers=_h(b.id))).json()["items"][0]["new"] is False
    assert (await client.get(LIST, headers=_h(c.id))).json()["unseen"] == 1, "别人的战报不受影响"
    # 挑战的人自己没有战报(那是给影子主人看的)
    assert (await client.get(LOGS, headers=_h(a.id))).json()["items"] == []


class _Fake:
    """只给 pet_shadow.settle 用的假对战(看平局怎么记)"""
    def __init__(self, battle_id, challenger_id, shadow, rounds):
        self.id, self.player1_id, self.current_round = battle_id, challenger_id, rounds
        self.ai_config = json.dumps({"shadow": {"owner_name": "同学", **shadow}})


# ---------- 7. 影子主人的真宠物不动;我输了照练习赛 ----------

async def test_owner_real_pet_is_untouched_and_my_loss_hurts_like_practice(client, db_session):
    a, pa = await _student_with_pet(db_session, "shua")
    b, pb = await _student_with_pet(db_session, "shub")
    pb.current_hp, pb.experience, pb.food_balance = 88, 7, 33
    await _class(db_session, "不动班", [a, b])
    await _words(db_session)
    await _set(db_session, enabled=False)

    bid = (await client.post(_start(b.id), headers=_h(a.id))).json()["id"]
    rewards = await _finish(db_session, bid, rounds=6, winner_id=svc.AI_USER_ID)
    await db_session.refresh(pb)
    await db_session.refresh(pa)
    assert (pb.current_hp, pb.is_injured, pb.experience, pb.food_balance, pb.level) == (88, False, 7, 33, 5)
    assert pa.is_injured is True and pa.current_hp == 0, "我输了: 照练习赛,宠物受伤"
    assert rewards[a.id]["food"] == 8 and rewards["_capture"] is None and rewards["_trial"] is None
    bt = await db_session.get(PetBattle, bid)
    assert bt.capture_data is None, "影子不收服"


# ---------- 7b. 打赢影子,出战的宠物体力回满(和闯关同一条) ----------

async def test_winning_a_shadow_heals_my_pet_but_losing_or_drawing_does_not(client, db_session):
    a, pa = await _student_with_pet(db_session, "shha")
    mates = []
    for tag in ("shhb", "shhc", "shhd"):
        mates.append((await _student_with_pet(db_session, tag))[0])
    await _class(db_session, "回血班", [a, *mates])
    await _words(db_session)
    await _set(db_session, enabled=False)
    full = calculate_max_hp(pa.level, pa.evolution_stage, pa.species)

    # 赢了、只剩 12 点血: 回满、不受伤、不写受伤日志;结果里 healed 为真
    bid = (await client.post(_start(mates[0].id), headers=_h(a.id))).json()["id"]
    rewards = await _finish(db_session, bid, rounds=7, winner_id=a.id, my_hp=12)
    await db_session.refresh(pa)
    assert rewards["_healed"] is True
    assert (pa.current_hp, pa.is_injured) == (full, False), "打赢影子: 体力回满"
    hurt_logs = (await db_session.execute(
        select(PetEventLog).where(PetEventLog.pet_id == pa.id, PetEventLog.event_type == "injured"))).scalars().all()
    assert hurt_logs == [], "回满了就不该记受伤"

    # 平了(打满回合两边血量比例一样、答对一样多): 不回血
    bid = (await client.post(_start(mates[1].id), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    bt.current_round, bt.player1_hp = 10, 20
    await db_session.commit()
    rewards = await svc.finish_battle(db_session, bid, None)
    await db_session.refresh(pa)
    assert rewards["_healed"] is False and pa.current_hp == 20 and pa.is_injured is True, "平局不回血,照练习赛受伤"

    # 输了: 不回血
    await _ready(db_session, pa)
    bid = (await client.post(_start(mates[2].id), headers=_h(a.id))).json()["id"]
    rewards = await _finish(db_session, bid, rounds=5, winner_id=svc.AI_USER_ID)
    await db_session.refresh(pa)
    assert rewards["_healed"] is False and (pa.current_hp, pa.is_injured) == (0, True)


async def test_practice_win_still_does_not_heal(client, db_session):
    # 练习赛不是闯关的节奏: 打赢了血量照实落、不到一半照样受伤(回满只给闯关和影子)
    a, pa = await _student_with_pet(db_session, "shpa")
    await _words(db_session)
    await _set(db_session, enabled=False)
    r = await client.post("/api/v1/student/battle/quick-match", headers=_h(a.id))
    assert r.status_code == 200, r.text
    rewards = await _finish(db_session, r.json()["id"], rounds=6, winner_id=a.id, my_hp=12)
    await db_session.refresh(pa)
    assert rewards["_healed"] is False and (pa.current_hp, pa.is_injured) == (12, True)


# ---------- 8. 一场的节奏和闯关同一套 ----------

async def _round(db, bid, n, *, mine: str, ai: str):
    """打一回合: mine / ai = "right" / "wrong" / "timeout"。返回 (对战, 这一回合)"""
    bt = await db.get(PetBattle, bid)
    q = json.loads(bt.questions_data)[n - 1]
    wrong = "B" if q["correct_answer"] == "A" else "A"
    pick = {"right": q["correct_answer"], "wrong": wrong, "timeout": "X"}
    await svc.process_round_answer(db, bid, bt.player1_id, n, pick[mine], 16000 if mine == "timeout" else 9000)
    await svc.process_round_answer(db, bid, svc.AI_USER_ID, n, pick[ai], 9000)
    return await svc.finalize_round(db, bid, n)


async def test_shadow_battle_is_paced_like_trial(client, db_session):
    a, pa = await _student_with_pet(db_session, "shta")      # 蒲电猬: 电
    ground, pg = await _student_with_pet(db_session, "shtb")
    water, pw = await _student_with_pet(db_session, "shtc")
    pg.species = "digmole"                                   # 地面: 克电,电打它减半
    pw.species = "axolotl"                                   # 水: 电克它
    await _class(db_session, "克制班", [a, ground, water])
    await _words(db_session, 12)
    await _set(db_session, enabled=False, stances=False)

    # 它克制我、我被它克制: 影子里都按 1 倍(只帮不坑),也不显示「被克制」
    bid = (await client.post(_start(ground.id), headers=_h(a.id))).json()["id"]
    assert svc.paced_rules(await db_session.get(PetBattle, bid))["type_mult"] == 1.3
    bt, rd = await _round(db_session, bid, 1, mine="right", ai="right")
    assert (rd.player1_type_multiplier, rd.player2_type_multiplier) == (1.0, 1.0)
    assert (rd.player1_type_text, rd.player2_type_text) == (None, None)
    # 影子答错不掉血;我答错(这里是超时)照样掉 10
    hp2, hp1 = bt.player2_hp, bt.player1_hp
    bt, rd = await _round(db_session, bid, 2, mine="timeout", ai="wrong")
    assert (rd.player2_damage, bt.player2_hp) == (0, hp2), "影子答错不掉血(和闯关同一个开关)"
    assert (rd.player1_damage, hp1 - bt.player1_hp) == (-10, 10)
    # 打满 10 回合: 我剩 60 / 145(41%),影子剩 100 / 264(38%)—— 比绝对值是它赢,比比例是我赢
    assert (bt.player1_initial_hp, bt.player2_initial_hp) == (145, 264)
    bt.current_round, bt.player1_hp, bt.player2_hp = 10, 60, 100
    assert await svc.check_battle_end(bt) == a.id, "影子按比例判: 它血厚,比绝对值永远是它赢"
    bt.player1_hp = 50                                       # 34% 对 38%: 这回是它赢
    assert await svc.check_battle_end(bt) == svc.AI_USER_ID
    await _finish(db_session, bid, rounds=2, winner_id=svc.AI_USER_ID)

    # 我克制它(电克水): ×1.3,文字写「属性克制」不写「伤害翻倍」
    await _ready(db_session, pa)
    bid = (await client.post(_start(water.id), headers=_h(a.id))).json()["id"]
    bt, rd = await _round(db_session, bid, 1, mine="right", ai="right")
    assert (rd.player1_type_multiplier, rd.player1_type_text) == (1.3, "属性克制")
    assert (rd.player2_type_multiplier, rd.player2_type_text) == (1.0, None)
    base = svc.calculate_damage(5, 1, 5, 1, True, 0, 9000, "sparkhog")       # 同学也是 5 级: 影子照他自己的等级
    assert rd.player1_damage == int(base * 1.3) and rd.player1_damage > base
    await _finish(db_session, bid, rounds=1, winner_id=svc.AI_USER_ID)

    # 改节奏之前开的影子(shadow 里没有 type_rule): 照当时的规矩打完 —— 双向 ×2、影子答错掉 10、比绝对值
    await _ready(db_session, pa)
    ground2, pg2 = await _student_with_pet(db_session, "shtd")
    pg2.species = "digmole"
    await _class(db_session, "克制班二", [a, ground2])
    bid = (await client.post(_start(ground2.id), headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    cfg = json.loads(bt.ai_config)
    cfg["shadow"] = {k: v for k, v in cfg["shadow"].items() if k not in ("type_rule", "type_mult")}
    bt.ai_config = json.dumps(cfg, ensure_ascii=False)
    await db_session.commit()
    assert svc.paced_rules(bt) is None
    body = (await client.get(f"/api/v1/student/battle/{bid}", headers=_h(a.id))).json()
    assert body["shadow"] == {"owner_name": "shtd", "pet_name": "皮卡", "type_rule": None, "type_mult": None}
    bt, rd = await _round(db_session, bid, 1, mine="right", ai="right")
    assert (rd.player1_type_multiplier, rd.player2_type_multiplier) == (0.5, 2.0)
    hp2 = bt.player2_hp
    bt, rd = await _round(db_session, bid, 2, mine="timeout", ai="wrong")
    assert rd.player2_damage == -10 and hp2 - bt.player2_hp == 10
    bt.current_round, bt.player1_hp, bt.player2_hp = 10, 60, 100
    assert await svc.check_battle_end(bt) == svc.AI_USER_ID
    await _finish(db_session, bid, rounds=2, winner_id=svc.AI_USER_ID)

    # 练习赛不受影响: 双向 ×2、AI 答错掉 10
    await _ready(db_session, pa)
    bid = (await client.post(QUICK, headers=_h(a.id))).json()["id"]
    bt = await db_session.get(PetBattle, bid)
    assert svc.paced_rules(bt) is None
    hp2 = bt.player2_hp
    bt, rd = await _round(db_session, bid, 1, mine="timeout", ai="wrong")
    assert rd.player2_damage == -10 and hp2 - bt.player2_hp == 10


async def test_shadow_type_mult_follows_the_trial_constant(client, db_session, monkeypatch):
    """影子的克制倍率就是闯关那个常量: 改了 pet_trial.TYPE_HELP_MULT,新开的影子跟着变;开打时记下来,整场不变"""
    a, pa = await _student_with_pet(db_session, "shva")      # 电
    b, pb = await _student_with_pet(db_session, "shvb")
    pb.species = "axolotl"                                   # 水: 电克它
    await _class(db_session, "常量班", [a, b])
    await _words(db_session, 12)
    await _set(db_session, enabled=False, stances=False)
    monkeypatch.setattr(pet_trial, "TYPE_HELP_MULT", 1.6)
    body = (await client.post(_start(b.id), headers=_h(a.id))).json()
    assert body["shadow"]["type_mult"] == 1.6 and body["shadow"]["type_rule"] == "help_only"
    monkeypatch.setattr(pet_trial, "TYPE_HELP_MULT", 1.3)    # 打到一半常量又改了: 这一场还是开打时的 1.6
    _bt, rd = await _round(db_session, body["id"], 1, mine="right", ai="wrong")
    base = svc.calculate_damage(5, 1, 5, 1, True, 0, 9000, "sparkhog")
    assert (rd.player1_type_multiplier, rd.player1_damage) == (1.6, int(base * 1.6))


def test_trial_and_shadow_share_one_pacing_switch():
    """闯关和影子的三条节奏规矩在 pet_battle_service 里各只有一处判断,都问 paced_rules —— 不会一边改了另一边忘了"""
    src = (Path(__file__).resolve().parents[1] / "app" / "services" / "pet_battle_service.py").read_text(encoding="utf-8")
    uses = src.count("paced_rules(battle)") - src.count("def paced_rules(battle)")
    assert uses == 3, "AI 答错掉不掉血 / 属性克制 / 打满回合怎么判,各一处"
    body = src.split("def paced_rules(battle)")[1].split("\nasync def ")[0]
    assert "pet_trial.trial_of(battle)" in body and "pet_shadow.paced_like_trial" in body
    shadow_src = (Path(__file__).resolve().parents[1] / "app" / "services" / "pet_shadow.py").read_text(encoding="utf-8")
    assert "pet_trial.hits_hp(" in shadow_src and "HP_HITS" not in shadow_src.split('"""', 2)[2], "血量调闯关的函数,不抄一份"
    assert "pet_trial.TYPE_HELP_MULT" in shadow_src


# ---------- 9. 平台开关 ----------

async def test_switch_off_hides_the_list_and_refuses_to_start(client, db_session):
    a, _ = await _student_with_pet(db_session, "shxa")
    b, _ = await _student_with_pet(db_session, "shxb")
    await _class(db_session, "开关班", [a, b])
    await _words(db_session)
    assert battle_tickets.OPTION_DEFAULTS["shadows"] is True
    await _set(db_session, enabled=False, shadows=False)

    assert (await client.get(LIST, headers=_h(a.id))).json() == {"enabled": False, "items": []}
    before = await _battle_count(db_session)
    r = await client.post(_start(b.id), headers=_h(a.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "shadow_off"
    assert await _battle_count(db_session) == before

    await _set(db_session, shadows=True)
    assert (await client.post(_start(b.id), headers=_h(a.id))).status_code == 200


# ---------- 10. 表建得出来、路由排在前面 ----------

def test_model_is_imported_and_routes_sit_before_battle_id():
    init_py = Path(__file__).resolve().parents[1] / "app" / "models" / "__init__.py"
    assert "from app.models.pet_shadow import PetShadowLog" in init_py.read_text(encoding="utf-8")
    from app.api.v1.student.pet_battle import router
    paths = [r.path for r in router.routes]
    for p in ("/battle/shadows", "/battle/shadow-logs", "/battle/shadow/{user_id}/start"):
        assert paths.index(p) < paths.index("/battle/{battle_id}"), f"{p} 要排在 /battle/{{battle_id}} 前面"


# ---------- 11. 真走 WebSocket 打一整场 ----------

async def test_shadow_battle_over_real_websocket(live):  # noqa: F811
    host, Session, uid = live
    async with Session() as db:
        mate = User(username="wsmate", email="wsmate@e.com", hashed_password="x", role="student",
                    full_name="同桌", is_active=True, org_id=1)
        mate2 = User(username="wsmate2", email="wsmate2@e.com", hashed_password="x", role="student",
                     full_name="后桌", is_active=True, org_id=1)
        teacher = User(username="wsteacher", email="wsteacher@e.com", hashed_password="x", role="teacher",
                       full_name="王老师", is_active=True, org_id=1)
        db.add_all([mate, mate2, teacher])
        await db.flush()
        for owner, name in ((mate, "小云"), (mate2, "小石")):
            db.add(UserPet(user_id=owner.id, name=name, species="cloudpaca", level=5, evolution_stage=1,
                           current_hp=66, is_active=True))
        cls = Class(name="WS 班", teacher_id=teacher.id, org_id=1)
        db.add(cls)
        await db.flush()
        for sid in (uid, mate.id, mate2.id):
            db.add(ClassStudent(class_id=cls.id, student_id=sid, is_active=True))
        await db.commit()
        mate_id, mate2_id = mate.id, mate2.id

    # 赢一场: 影子每题答错、我每题答对
    body = await _open_battle(host, uid, _start(mate_id))
    assert body["mode"] == "shadow" and body["shadow"] == {"owner_name": "同桌", "pet_name": "小云",
                                                           "type_rule": "help_only", "type_mult": 1.3}
    assert body["player2_pet"]["max_hp"] == pet_trial.hits_hp(1) == 264
    assert body["player2_pet"]["name"] == "同桌的小云"
    questions = await _answers_of(Session, body["id"])
    results, end, rounds, others = await _play(host, uid, body["id"], questions, right=True)
    assert results and end["winner_id"] == uid, (end, others)
    assert end["healed"] is True, "打赢影子: 结束消息里告诉页面体力回满了"
    assert [r["result"]["round_number"] for r in results] == list(range(1, len(results) + 1))
    assert len(results) >= 4, "影子的血和闯关一样厚: 全对也要打四五个回合(以前两三个回合就结束)"
    assert all(r["result"]["player2_damage"] == 0 for r in results), "影子每题答错,一点血不掉自己的"
    assert not [m for m in others if m.get("type") in ("error", "driver_crashed")], others
    async with Session() as db:
        bt = await db.get(PetBattle, body["id"])
        assert bt.status == "finished" and bt.winner_id == uid
        logs = list((await db.execute(select(PetShadowLog))).scalars())
        assert [(r.battle_id, r.owner_id, r.challenger_id, r.challenger_name, r.owner_won, r.pet_name) for r in logs] == [
            (body["id"], mate_id, uid, "小飞", False, "小云")]
        real = (await db.execute(select(UserPet).where(UserPet.user_id == mate_id))).scalar_one()
        assert (real.current_hp, real.is_injured, real.experience or 0) == (66, False, 0), "同桌的真宠物没动"

    # 同一个人今天不能再挑战;换一个人输一场: 影子每题答对、我每题答错
    async with httpx.AsyncClient(base_url=f"http://{host}", headers=_h(uid), timeout=20) as c:
        r = await c.post(_start(mate_id))
        assert r.status_code == 409 and r.json()["detail"]["code"] == "shadow_done_today"
    await _heal(Session, uid)
    AI_RIGHT["v"] = True
    body = await _open_battle(host, uid, _start(mate2_id))
    questions = await _answers_of(Session, body["id"])
    results, end, _rounds_sent, others = await _play(host, uid, body["id"], questions, right=False)
    assert results and end["winner_id"] == svc.AI_USER_ID, (end, others)
    assert end["healed"] is False, "输给影子不回血"
    async with Session() as db:
        logs = list((await db.execute(select(PetShadowLog).order_by(PetShadowLog.id))).scalars())
        assert [(r.owner_id, r.owner_won) for r in logs] == [(mate_id, False), (mate2_id, True)]
    async with httpx.AsyncClient(base_url=f"http://{host}", headers=_h(mate2_id), timeout=20) as c:
        view = (await c.get(LIST)).json()
        assert view["my_record"] == {"defended": 1, "lost": 0} and view["unseen"] == 1
        items = (await c.get(f"{LOGS}?mark=1")).json()["items"]
        assert [(i["challenger_name"], i["owner_won"]) for i in items] == [("小飞", True)]
        assert (await c.get(LIST)).json()["unseen"] == 0
