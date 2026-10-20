"""宠物三处修复(2026-10-20)

1. 真人对战: 发起方的挑战被接受后,对战大厅能问到「这场在等你」→ 自动进场
   (根因: 发起方不知道对方接了,接受方在对战页等 30 秒被踢出;生产 104 场被接受的 56 场一回合没打)
2. 受伤随时间自己好(每小时 5%,到 80% 解除);不来不再「挨饿受伤」
   (生产 444 只在用宠物里 237 只受伤,181 只的主人 30 天以上没来过)
3. 练习赚粮按服务端答题记录算正确率,不信前端报的 score/total
"""
from datetime import datetime, timedelta

from sqlalchemy import select

from app.models.learning import LearningRecord
from app.models.pet import UserPet, PetEventLog
from app.models.pet_battle import PetBattle
from app.models.word import Word
from tests.test_pet_multitab_exploits import _student_with_pet, _battle, _h


# ---------- 1. 挑战被接受 → 发起方能问到 ----------

async def test_ready_battle_tells_challenger_to_join(client, db_session):
    a, pa = await _student_with_pet(db_session, "rdya")
    b, pb = await _student_with_pet(db_session, "rdyb")
    bt = _battle(a, pa, b, pb, status="pending", current_round=0,
                 expires_at=datetime.utcnow() + timedelta(seconds=60))
    db_session.add(bt)
    await db_session.commit()

    # 还没接受: 发起方问不到
    assert (await client.get("/api/v1/student/battles/ready", headers=_h(a.id))).json()["battle_id"] is None
    r = await client.post(f"/api/v1/student/battle/{bt.id}/accept", headers=_h(b.id))
    assert r.status_code == 200, r.text
    # 接受了: 发起方问得到,接受方问不到(那不是他发的)
    got = (await client.get("/api/v1/student/battles/ready", headers=_h(a.id))).json()
    assert got["battle_id"] == bt.id and got["opponent_name"] == "rdyb"
    assert (await client.get("/api/v1/student/battles/ready", headers=_h(b.id))).json()["battle_id"] is None


async def test_ready_battle_ignores_stale_or_started(client, db_session):
    a, pa = await _student_with_pet(db_session, "rdyc")
    b, pb = await _student_with_pet(db_session, "rdyd")
    stale = _battle(a, pa, b, pb, started_at=datetime.utcnow() - timedelta(minutes=2), current_round=0)
    played = _battle(a, pa, b, pb, started_at=datetime.utcnow(), current_round=3)
    db_session.add_all([stale, played])
    await db_session.commit()
    assert (await client.get("/api/v1/student/battles/ready", headers=_h(a.id))).json()["battle_id"] is None


async def test_expired_invites_not_listed(client, db_session):
    a, pa = await _student_with_pet(db_session, "rdye")
    b, pb = await _student_with_pet(db_session, "rdyf")
    db_session.add_all([
        _battle(a, pa, b, pb, status="pending", expires_at=datetime.utcnow() - timedelta(seconds=5)),
        _battle(a, pa, b, pb, status="pending", expires_at=datetime.utcnow() + timedelta(seconds=50)),
    ])
    await db_session.commit()
    r = await client.get("/api/v1/student/battles/invites", headers=_h(b.id))
    assert r.status_code == 200 and len(r.json()) == 1


# ---------- 2. 受伤自己好 / 不来不再挨饿受伤 ----------

async def _injure(db, pet, *, hours_ago, hp_text):
    pet.is_injured = True
    pet.current_hp = int(hp_text.split("/")[0])
    db.add(PetEventLog(pet_id=pet.id, event_type="injured", detail=f"对战后受伤，当前HP: {hp_text}",
                       created_at=datetime.utcnow() - timedelta(hours=hours_ago)))
    await db.commit()


async def test_injured_pet_heals_over_time(client, db_session):
    from app.core.pet_formulas import calculate_max_hp
    a, pa = await _student_with_pet(db_session, "healt")
    mx = calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    # 0 血受伤 5 小时: 25%,还没好
    await _injure(db_session, pa, hours_ago=5, hp_text=f"0/{mx}")
    r = (await client.get("/api/v1/student/pet", headers=_h(a.id))).json()
    assert r["is_injured"] is True and r["current_hp"] == int(mx * 0.05 * 5)
    # 同一时刻再查一次不会多回(按时间算,不按调用次数)
    r2 = (await client.get("/api/v1/student/pet", headers=_h(a.id))).json()
    assert r2["current_hp"] == r["current_hp"]
    # 受伤 17 小时: 85% → 解除受伤,能直接出战(不用先答题)
    await db_session.execute(PetEventLog.__table__.update()
                             .where(PetEventLog.pet_id == pa.id)
                             .values(created_at=datetime.utcnow() - timedelta(hours=17)))
    await db_session.commit()
    r3 = (await client.get("/api/v1/student/pet", headers=_h(a.id))).json()
    assert r3["is_injured"] is False and r3["current_hp"] >= mx * 0.8
    healed = (await db_session.execute(select(PetEventLog.detail).where(
        PetEventLog.pet_id == pa.id, PetEventLog.event_type == "healed"))).scalars().all()
    assert len(healed) == 1 and "自己恢复" in healed[0]


async def test_heal_starts_from_hp_at_injury(client, db_session):
    """45% 受伤的不用和 0 血的等一样久: 起点读日志里的「当前HP」"""
    from app.core.pet_formulas import calculate_max_hp
    a, pa = await _student_with_pet(db_session, "healu")
    mx = calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    start = int(mx * 0.45)
    await _injure(db_session, pa, hours_ago=8, hp_text=f"{start}/{mx}")
    r = (await client.get("/api/v1/student/pet", headers=_h(a.id))).json()
    assert r["is_injured"] is False      # 45% + 8h×5% = 85%


async def test_battle_entry_applies_natural_heal(client, db_session):
    """休息够了的,发起对战时不能还被「宠物受伤了」挡住(入口先按时间回血)"""
    from app.core.pet_formulas import calculate_max_hp
    a, pa = await _student_with_pet(db_session, "healv")
    b, _ = await _student_with_pet(db_session, "healw")
    mx = calculate_max_hp(pa.level, pa.evolution_stage, pa.species)
    await _injure(db_session, pa, hours_ago=20, hp_text=f"0/{mx}")
    r = await client.post("/api/v1/student/battle/create", headers=_h(a.id),
                          json={"opponent_id": b.id, "mode": "casual", "max_rounds": 5})
    assert "受伤" not in r.text, r.text


async def test_long_absence_no_longer_injures(client, db_session):
    a, pa = await _student_with_pet(db_session, "hungr", hunger=12,
                                    last_interaction_at=datetime.utcnow() - timedelta(days=40))
    await db_session.commit()
    r = (await client.get("/api/v1/student/pet", headers=_h(a.id))).json()
    assert r["is_injured"] is False
    n = (await db_session.execute(select(PetEventLog.id).where(
        PetEventLog.pet_id == pa.id, PetEventLog.event_type == "injured"))).all()
    assert n == []


# ---------- 3. 赚粮按服务端记录 ----------

async def _records(db, uid, correct, wrong, *, minutes_ago=1):
    w = Word(word=f"food{uid}{correct}{wrong}{minutes_ago}")
    db.add(w)
    await db.flush()
    at = datetime.utcnow() - timedelta(minutes=minutes_ago)
    for i in range(correct + wrong):
        db.add(LearningRecord(user_id=uid, word_id=w.id, learning_mode="classify",
                              is_correct=i < correct, created_at=at))
    await db.commit()


async def _earn(client, uid, score, total, mode="classify"):
    r = await client.post("/api/v1/student/pet/earn-food", headers=_h(uid),
                          json={"score": score, "total": total, "mode": mode})
    assert r.status_code == 200, r.text
    return r.json()


async def test_earn_food_uses_server_records_not_client_score(client, db_session):
    a, pa = await _student_with_pet(db_session, "fooda", food_balance=0)
    # 没练: 前端说 100/100 也是 0 粮,且不占掉今天的首练加成
    assert (await _earn(client, a.id, 100, 100))["food_earned"] == 0
    # 真练了 10 题错 5 题: 前端谎报 10/10 也按 50% 算 → 基础2+正确率3+模式2+首练3 = 10
    await _records(db_session, a.id, correct=5, wrong=5)
    got = await _earn(client, a.id, 10, 10)
    assert got["food_earned"] == 10 and got["breakdown"]["accuracy_bonus"] == 3 and got["is_first_today"]
    # 同一批记录不能领第二次
    assert (await _earn(client, a.id, 10, 10))["food_earned"] == 0
    await db_session.refresh(pa)
    assert pa.food_balance == 10


async def test_earn_food_sentence_practice_counts(client, db_session):
    """句子练习不写 learning_records: 练过(sentence_mastery 有新记录)就给基础粮,正确率档按 0"""
    from app.models.sentence import SentenceBook, SentenceUnit, Sentence
    from app.models.sentence_learning import SentenceMastery
    a, _ = await _student_with_pet(db_session, "foodb", food_balance=0)
    book = SentenceBook(name="b")
    db_session.add(book)
    await db_session.flush()
    unit = SentenceUnit(book_id=book.id, unit_number=1, name="u")
    db_session.add(unit)
    await db_session.flush()
    s = Sentence(unit_id=unit.id, english="Hi.", chinese="嗨", order_index=0)
    db_session.add(s)
    await db_session.flush()
    db_session.add(SentenceMastery(user_id=a.id, sentence_id=s.id, total_encounters=1,
                                   correct_count=1, last_practiced_at=datetime.utcnow()))
    await db_session.commit()
    got = await _earn(client, a.id, 5, 5, mode="spelling")
    assert got["food_earned"] == 2 + 0 + 2 + 3
