"""宠物对战 · 每回合的玩法(2026-11-12,规则真源 app/services/battle_moves.py)

  A. 出招三选一: 重击(对 ×1.5、错掉 20)/ 普通 / 防守(对 ×0.6、挨打 ×0.6、错不掉血、连对不断)
  B. 大招要拼出来: 出题时不带单词、只有手里有大招的人拿到、拼对放大招扣一格、拼错只算普通不扣格、
     没给他备词时直接放、要拼的回合多 10 秒
  C. 学习增益: 作业全做完攻击 +10%、今日复习做完开局 1 格大招、学满 30 个词体力 +10%
  D. 守关专考他自己错过的词
  开关: 三样各能关;老对战(没有 buffs_data)全按老规矩;老页面不带 stance / spell 照样能打
"""
import asyncio
import json
from datetime import datetime, timedelta

import httpx
import websockets
from sqlalchemy import func, select

from app.api.v1.student import pet_battle_ws as ws_mod
from app.core.pet_formulas import calculate_max_hp
from app.core.timeutil import local_today
from app.models.daily_review import DailyReviewPlan
from app.models.learning import LearningRecord, WordMastery
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle, PetBattleRound
from app.models.pet_trial import PetTrialStage
from app.models.word import Word, WordDefinition
from app.schemas.pet_battle import QuestionData, WSNewRound
from app.services import battle_moves as bm
from app.services import battle_tickets, pet_trial
from app.services import mastery as mastery_svc
from app.services import pet_battle_service as svc
from tests.conftest import _make_token
from tests.test_battle_tickets import _task, _teacher_unit, _today
from tests.test_pet_battle_ws_flow import _answers_of, _auth, _open_battle, live  # noqa: F401  (live 是 fixture)
from tests.test_pet_multitab_exploits import _h, _student_with_pet

QUICK = "/api/v1/student/battle/quick-match"
BUFFS = "/api/v1/student/battles/buffs"
SETTINGS = "/api/v1/student/battles/ticket-settings"
SLOW = 6000        # 6 秒才答: 没有速度加成,同级、连对 0 时基础伤害 = 20 + 8(进化 1 档) = 28
BASE = 28
NAMES = ["apple", "bridge", "candle", "dragon", "forest", "garden", "island", "jungle",
         "kitten", "lemon", "monkey", "orange", "pencil", "rabbit"]
# 释义里不能带着英文单词本身(带着的不能当咒语,也出不了「看中文选英文」—— 等于把答案印在题目上)
MEANING = {n: f"词义{i}" for i, n in enumerate(NAMES)}


async def _word(db, text, meaning=None):
    w = Word(word=text)
    db.add(w)
    await db.flush()
    db.add(WordDefinition(word_id=w.id, meaning=meaning or f"{text}的意思", is_primary=True))
    return w


def _q(word, spells=None):
    q = {"word_id": word.id, "word": word.word, "question_text": f"单词 '{word.word}' 的意思是?",
         "options": ["A. 对的意思", "B. 错一", "C. 错二", "D. 错三"], "correct_answer": "A",
         "kind": "en2zh", "display": word.word, "meaning": "对的意思"}
    if spells:
        q["spells"] = spells
    return q


async def _pvp(db, tag, *, questions=None, play=True, buffs=None, charges=(0, 0), combo=(0, 0), legacy=False):
    """两个真人、同级(5 级、进化 1 档)。对手换成普通属性: 电打电是减半,会把数字搅乱"""
    a, pa = await _student_with_pet(db, f"{tag}a")
    b, pb = await _student_with_pet(db, f"{tag}b")
    pb.species = "alpaca"
    if questions is None:
        w = await _word(db, f"{tag}word")
        questions = [_q(w)] * 3
    bt = PetBattle(
        player1_id=a.id, player2_id=b.id, player1_pet_id=pa.id, player2_pet_id=pb.id, status="active",
        max_rounds=len(questions), questions_data=json.dumps(questions, ensure_ascii=False),
        player1_initial_hp=300, player2_initial_hp=300, player1_hp=300, player2_hp=300, pet_hp_data="{}",
        player1_ultimate_charges=charges[0], player2_ultimate_charges=charges[1],
        player1_combo=combo[0], player2_combo=combo[1],
        # legacy = 上线之前开的对战: 没有 buffs_data 这一列的值
        buffs_data=None if legacy else bm.dump_buffs(buffs or {}, {"stances": play, "spell_ultimate": play}),
    )
    db.add(bt)
    await db.commit()
    return a, b, bt


async def _round(db, bt, n, a_kw, b_kw):
    """打一回合: 两边各答一次再结算。a_kw / b_kw: dict(answer, time_ms, use_ultimate, stance, spell)"""
    for pid, kw in ((bt.player1_id, a_kw), (bt.player2_id, b_kw)):
        kw = {"answer": "A", "time_ms": SLOW, **kw}
        await svc.process_round_answer(db, bt.id, pid, n, **kw)
    return await svc.finalize_round(db, bt.id, n)


# ================================================================ A. 出招

async def test_heavy_normal_guard_damage_and_self_hit(db_session):
    a, b, bt = await _pvp(db_session, "mva")

    # 第 1 回合: 我重击答对、对手普通答对
    bt, r = await _round(db_session, bt, 1, {"stance": "heavy"}, {})
    assert (r.player1_damage, r.player2_damage) == (int(BASE * 1.5), BASE) == (42, 28)
    assert (r.player1_stance, r.player2_stance) == ("heavy", "normal")
    assert (bt.player1_hp, bt.player2_hp) == (300 - 28, 300 - 42)
    moves = svc.round_moves(r)
    assert (moves["player1_stance"], moves["player1_guarded"], moves["player2_guarded"]) == ("heavy", False, False)

    # 第 2 回合: 我重击答错(自己掉 20)、对手普通答错(掉 10)
    bt, r = await _round(db_session, bt, 2, {"stance": "heavy", "answer": "B"}, {"answer": "C"})
    assert (r.player1_damage, r.player2_damage) == (-20, -10)
    assert (bt.player1_hp, bt.player2_hp) == (272 - 20, 258 - 10)

    # 第 3 回合: 我防守答对(伤害 ×0.6),对手重击答对 —— 打在我身上的再 ×0.6
    bt, r = await _round(db_session, bt, 3, {"stance": "guard"}, {"stance": "heavy"})
    assert r.player1_damage == int(BASE * 0.6) == 16
    assert r.player2_damage == int(int(BASE * 1.5) * 0.6) == 25, "重击打在防守的人身上: 先 ×1.5 再 ×0.6"
    moves = svc.round_moves(r)
    assert (moves["player1_stance"], moves["player1_guarded"], moves["player2_guarded"]) == ("guard", True, False)


async def test_guard_wrong_keeps_combo_and_hp_but_timeout_does_not(db_session):
    a, b, bt = await _pvp(db_session, "mvb", combo=(2, 2))

    # 防守答错(真选了、选错了): 不掉血、连对不断也不涨;对手打过来的照样 ×0.6
    bt, r = await _round(db_session, bt, 1, {"stance": "guard", "answer": "B"}, {})
    assert r.player1_damage == 0 and bt.player1_combo == 2 and bt.player1_ultimate_charges == 0
    assert r.player2_damage == int((BASE + 2 * 5) * 0.6) == 22      # 对手连对 2: 28 + 10 = 38
    assert bt.player1_hp == 300 - 22 and bt.player2_combo == 3 and bt.player2_ultimate_charges == 1

    # 防守答对: 连对照涨(2 → 3,攒出一格大招)
    bt, r = await _round(db_session, bt, 2, {"stance": "guard"}, {"answer": "B"})
    assert bt.player1_combo == 3 and bt.player1_ultimate_charges == 1

    # 选了防守但超时没答: 按普通答错算 —— 掉 10、连对清零
    bt, r = await _round(db_session, bt, 3, {"stance": "guard", "answer": "X"}, {"answer": "B"})
    assert r.player1_damage == -10 and r.player1_stance == "normal" and bt.player1_combo == 0


async def test_guard_cuts_an_ultimate_and_ai_is_always_normal(db_session):
    a, b, bt = await _pvp(db_session, "mvc", charges=(1, 0))
    # 我放大招(这一回合没给我备咒语词 → 直接放),对手防守: 60 ×0.6 = 36
    bt, r = await _round(db_session, bt, 1, {"use_ultimate": True, "stance": "heavy"}, {"stance": "guard"})
    assert r.player1_used_ultimate is True and r.player1_stance == "ultimate", "放大招时不看出招"
    assert r.player1_damage == int(60 * 0.6) == 36 and bt.player1_ultimate_charges == 0
    assert svc.round_moves(r)["player2_guarded"] is True

    # AI 那一方传什么出招都当普通
    await svc.ensure_ai_user(db_session)
    ai_pet = await svc.spawn_ai_pet(db_session, name="对手", species="alpaca", level=5)
    w = await _word(db_session, "mvcai")
    kid, pk = await _student_with_pet(db_session, "mvckid")
    ai_bt = PetBattle(player1_id=kid.id, player2_id=svc.AI_USER_ID, player1_pet_id=pk.id, player2_pet_id=ai_pet.id,
                      status="active", max_rounds=1, is_ai_battle=True, questions_data=json.dumps([_q(w)]),
                      player1_initial_hp=300, player2_initial_hp=300, player1_hp=300, player2_hp=300,
                      pet_hp_data="{}", buffs_data=bm.dump_buffs({}, {"stances": True, "spell_ultimate": True}))
    db_session.add(ai_bt)
    await db_session.commit()
    ai_bt, r = await _round(db_session, ai_bt, 1, {}, {"stance": "heavy"})
    assert r.player2_stance == "normal" and r.player2_damage == BASE


async def test_ai_ultimate_gets_no_spell_bonus(db_session):
    """AI 的大招不用拼,也不 ×1.5(哪怕这一回合的题目里给孩子备了咒语词、AI 那边还带了个 spell 上来)"""
    await svc.ensure_ai_user(db_session)
    ai_pet = await svc.spawn_ai_pet(db_session, name="对手", species="alpaca", level=5)
    w = await _word(db_session, "aiult")
    banana = await _word(db_session, "banana", "香蕉")
    kid, pk = await _student_with_pet(db_session, "aiultkid")
    q = _q(w, {str(kid.id): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"},
               str(svc.AI_USER_ID): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"}})
    bt = PetBattle(player1_id=kid.id, player2_id=svc.AI_USER_ID, player1_pet_id=pk.id, player2_pet_id=ai_pet.id,
                   status="active", max_rounds=1, is_ai_battle=True, questions_data=json.dumps([q], ensure_ascii=False),
                   player1_initial_hp=300, player2_initial_hp=300, player1_hp=300, player2_hp=300,
                   pet_hp_data="{}", player2_ultimate_charges=1,
                   buffs_data=bm.dump_buffs({}, {"stances": True, "spell_ultimate": True}))
    db_session.add(bt)
    await db_session.commit()
    bt, r = await _round(db_session, bt, 1, {"answer": "B"}, {"use_ultimate": True, "spell": "banana"})
    assert r.player2_used_ultimate is True and r.player2_damage == 52, "普通属性的大招 42 + 进化 1 档 10,不 ×1.5"
    assert svc.round_moves(r)["player2_spell"] is None


async def test_stances_off_and_legacy_battles_ignore_stance(db_session):
    # 平台把「出招三选一」关了的那一场
    a, b, bt = await _pvp(db_session, "mvd", play=False)
    bt, r = await _round(db_session, bt, 1, {"stance": "heavy"}, {"stance": "guard", "answer": "B"})
    assert (r.player1_damage, r.player1_stance) == (BASE, "normal"), "关着: 重击不 ×1.5"
    assert (r.player2_damage, r.player2_stance) == (-10, "normal"), "关着: 防守答错照样掉 10"
    assert svc.round_moves(r)["player2_guarded"] is False
    # 上线之前开的对战(没有 buffs_data): 照老规矩打完
    a, b, old = await _pvp(db_session, "mve", legacy=True, charges=(1, 0))
    assert bm.battle_play(old) == {"stances": False, "spell_ultimate": False, "hints": None, "spell_bonus": None}
    old, r = await _round(db_session, old, 1, {"stance": "heavy", "use_ultimate": True}, {"stance": "guard"})
    assert r.player1_used_ultimate is True and r.player1_damage == 60 and r.player2_damage == BASE
    # 认不出的出招按普通
    assert bm.clean_stance("HEAVY ") == "heavy" and bm.clean_stance("fly") == "normal" and bm.clean_stance(None) == "normal"
    assert bm.clean_stance("heavy", enabled=False) == "normal"


def test_hints_follow_the_constants(monkeypatch):
    assert bm.stance_hints() == {"heavy": "对 ×1.5 · 错掉 20", "normal": "对 ×1 · 错掉 10", "guard": "挨打减四成 · 错不掉血"}

    def width(text):      # 汉字算 1,其余算半个
        return sum(1 if ord(c) > 0x2E80 else 0.5 for c in text)
    assert all(width(v) <= 12 for v in bm.stance_hints().values()), "手机上一个按钮只有 100px 左右"

    # 调了倍率,按钮上的字跟着变(不是另写的一份字面量)
    monkeypatch.setattr(bm, "HEAVY_DAMAGE", 2.0)
    monkeypatch.setattr(bm, "HEAVY_MISS", -30)
    monkeypatch.setattr(bm, "GUARD_TAKEN", 0.5)
    monkeypatch.setattr(bm, "NORMAL_MISS", -12)
    hints = bm.stance_hints()
    assert hints == {"heavy": "对 ×2 · 错掉 30", "normal": "对 ×1 · 错掉 12", "guard": "挨打减五成 · 错不掉血"}
    monkeypatch.setattr(bm, "GUARD_TAKEN", 0.65)
    assert bm.stance_hints()["guard"] == "挨打减 35% · 错不掉血"
    # 念咒语那一块上的那句话也是从常量拼的
    assert bm.spell_bonus_text() == "拼对咒语 大招伤害 ×1.5"
    monkeypatch.setattr(bm, "SPELL_ULT_MULT", 2.0)
    assert bm.spell_bonus_text() == "拼对咒语 大招伤害 ×2"
    assert bm.final_damage(60, stance="ultimate", buff=1.0, type_mult=1.0, target_guarding=False, spelled=True) == 120
    # 增益的文案也是从常量拼的
    monkeypatch.setattr(bm, "HOMEWORK_DAMAGE", 1.2)
    monkeypatch.setattr(bm, "WORDS_NEEDED", 40)
    assert bm.buff_text("homework") == ("作业做完了", "攻击 +20%")
    assert bm.buff_text("words")[0] == "今天学满 40 个词"


def test_damage_order_is_stance_buff_type_guard():
    # 40 → ×1.5 = 60 → ×1.1 = 66 → ×2 = 132 → ×0.6 = 79(每步往下取整)
    assert bm.final_damage(40, stance="heavy", buff=1.1, type_mult=2.0, target_guarding=True) == 79
    assert bm.final_damage(40, stance=None, buff=1.0, type_mult=1.0, target_guarding=False) == 40
    assert bm.final_damage(1, stance="guard", buff=1.0, type_mult=0.5, target_guarding=True) == 1, "打中了最少 1"
    assert bm.final_damage(-20, stance="heavy", buff=1.1, type_mult=2.0, target_guarding=True) == -20, "自损不吃倍率"
    # 拼对咒语放出来的大招: 「出招」那一位乘 1.5 —— 60 → 90 → ×1.1 = 99 → ×1.3 = 128 → ×0.6 = 76
    assert bm.final_damage(60, stance="ultimate", buff=1.1, type_mult=1.3, target_guarding=True, spelled=True) == 76
    assert bm.final_damage(60, stance="ultimate", buff=1.0, type_mult=1.0, target_guarding=False) == 60
    # spelled 只对大招有用: 重击 / 普通不会因为它多乘一次
    assert bm.final_damage(40, stance="heavy", buff=1.0, type_mult=1.0, target_guarding=False, spelled=True) == 60
    assert bm.final_damage(40, stance="normal", buff=1.0, type_mult=1.0, target_guarding=False, spelled=True) == 40


# ================================================================ B. 大招要拼出来

async def test_spell_goes_only_to_the_player_with_a_charge_and_never_carries_the_word(db_session):
    w = await _word(db_session, "question")
    banana = await _word(db_session, "banana", "香蕉")
    cherry = await _word(db_session, "cherry", "樱桃")
    a, b, bt = await _pvp(db_session, "spa", charges=(1, 0))
    q = _q(w, {str(a.id): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"},
               str(b.id): {"word_id": cherry.id, "word": "cherry", "meaning": "樱桃"}})
    bt.questions_data = json.dumps([q] * 3, ensure_ascii=False)
    await db_session.commit()

    assert "spells" not in svc.public_question(q) and "banana" not in json.dumps(svc.public_question(q))

    mine = svc.new_round_question(bt, q, 1, a.id)
    sent = WSNewRound(round_number=1, question=QuestionData(**mine), time_limit=25).model_dump_json()
    assert "banana" not in sent and "cherry" not in sent and "樱桃" not in sent, "出题时不带单词,也不带对手的咒语"
    spell = json.loads(sent)["question"]["spell"]
    assert spell["meaning"] == "香蕉" and spell["length"] == 6 and len(spell["letters"]) == 6 + 2
    left = list(spell["letters"])
    for ch in "banana":
        left.remove(ch)                 # 单词的字母都在里面
    assert len(left) == 2 and not set(left) & set("banana"), "多出来的两个是词里没有的干扰字母"
    assert spell["letters"] != list("banana") + left, "要打乱"
    # 重连再发一次是同一副;换一回合 / 换一个人就不一样了
    assert svc.new_round_question(bt, q, 1, a.id)["spell"] == spell
    assert bm.spell_letters("banana", bt.id, 2, a.id) != spell["letters"] or \
        bm.spell_letters("banana", bt.id, 3, a.id) != spell["letters"]

    # 对手手里没有大招: 他拿不到咒语(哪怕给他备了词),我的更不会发给他
    his = json.dumps(svc.new_round_question(bt, q, 1, b.id), ensure_ascii=False)
    assert json.loads(his)["spell"] is None and "香蕉" not in his and "banana" not in his
    assert svc.new_round_question(bt, q, 1, None)["spell"] is None

    # 有人要拼咒语的回合多 10 秒;没人要拼就是原来的
    assert svc.round_time_limit(bt, q, 1) == 15 + 10
    bt.player1_ultimate_charges = 0
    assert svc.round_time_limit(bt, q, 1) == 15 and svc.new_round_question(bt, q, 1, a.id)["spell"] is None


async def test_spell_right_fires_and_wrong_is_a_normal_attack_that_keeps_the_charge(db_session):
    w = await _word(db_session, "question")
    banana = await _word(db_session, "banana", "香蕉")
    a, b, bt = await _pvp(db_session, "spb", charges=(1, 0))
    q = _q(w, {str(a.id): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"}})
    bt.questions_data = json.dumps([q] * 4, ensure_ascii=False)
    # 这个词他学过、排到 4 天后才复习: 拼错了要把复习往前排
    m = await mastery_svc.get_or_create(db_session, a.id, banana.id)
    m.total_encounters, m.correct_count, m.review_stage = 4, 4, 4
    m.next_review_at = datetime.utcnow() + timedelta(days=4)
    await db_session.commit()

    # 第 1 回合: 答对了,咒语拼错 → 只算一记普通攻击,那一格不扣
    bt, r = await _round(db_session, bt, 1, {"use_ultimate": True, "spell": "bananna", "stance": "heavy"}, {"answer": "B"})
    assert r.player1_used_ultimate is False and r.player1_damage == BASE and r.player1_stance == "normal"
    assert bt.player1_ultimate_charges == 1, "拼错不扣格,下一回合再试"
    moves = svc.round_moves(r)
    assert moves["player1_spell"] == {"ok": False, "word": "banana", "meaning": "香蕉", "typed": "bananna"}
    assert moves["player2_spell"] is None
    await db_session.refresh(m)
    assert m.wrong_count == 1 and m.next_review_at < datetime.utcnow() + timedelta(days=1), "拼错的词排进复习"

    # 第 2 回合: 没拼(老页面不带 spell)→ 一样只算普通攻击、不扣格
    bt, r = await _round(db_session, bt, 2, {"use_ultimate": True}, {"answer": "B"})
    assert r.player1_used_ultimate is False and bt.player1_ultimate_charges == 1
    assert svc.round_moves(r)["player1_spell"]["typed"] == ""

    # 第 3 回合: 选择题答错 → 和平时答错一样掉 10,不扣格,也不算试过咒语
    bt, r = await _round(db_session, bt, 3, {"use_ultimate": True, "spell": "banana", "answer": "B"}, {"answer": "B"})
    assert r.player1_damage == -10 and bt.player1_ultimate_charges == 1 and svc.round_moves(r)["player1_spell"] is None

    # 第 4 回合: 拼对(不分大小写、去首尾空格)→ 放出大招,扣一格;拼对咒语放出来的大招伤害 ×1.5
    bt, r = await _round(db_session, bt, 4, {"use_ultimate": True, "spell": "  Banana "}, {"answer": "B"})
    assert r.player1_used_ultimate is True and r.player1_damage == int(60 * 1.5) == 90
    assert bt.player1_ultimate_charges == 0
    assert svc.round_moves(r)["player1_stance"] == "ultimate"
    assert svc.round_moves(r)["player1_spell"] == {"ok": True, "word": "banana", "meaning": "香蕉", "typed": "Banana"}

    # 结算页的复习词: 拼错的咒语词也列出来(两次拼错各一条),标着 spell
    spells = [x for x in await svc.battle_review(db_session, bt.id) if x.get("spell")]
    assert [(x["round"], x["word"], x["meaning"], x["typed"]) for x in spells] == [
        (1, "banana", "香蕉", "bananna"), (2, "banana", "香蕉", "")]
    assert all(x["player1_correct"] is False and x["player1_answered"] is True for x in spells)
    assert len([x for x in await svc.battle_review(db_session, bt.id) if not x.get("spell")]) == 4


async def test_no_spell_word_or_switch_off_fires_directly(db_session):
    # 这一回合没给他备词(挑不出来): 照老办法直接放 —— 不能让那一格永远用不掉
    a, b, bt = await _pvp(db_session, "spc", charges=(1, 0))
    bt, r = await _round(db_session, bt, 1, {"use_ultimate": True}, {"answer": "B"})
    assert r.player1_used_ultimate is True and bt.player1_ultimate_charges == 0
    assert svc.round_moves(r)["player1_spell"] is None
    assert r.player1_damage == 60, "没咒语可拼直接放的: 原来的伤害,不 ×1.5"

    # 平台把「大招要拼」关了的那一场: 题目里就算有词也不用拼、不下发
    w = await _word(db_session, "question")
    banana = await _word(db_session, "banana", "香蕉")
    a, b, bt = await _pvp(db_session, "spd", play=False, charges=(1, 0))
    q = _q(w, {str(a.id): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"}})
    bt.questions_data = json.dumps([q], ensure_ascii=False)
    await db_session.commit()
    assert svc.new_round_question(bt, q, 1, a.id)["spell"] is None and svc.round_time_limit(bt, q, 1) == 15
    # 就算页面把正确的咒语词带上来了: 开关关着就是点一下就放,不 ×1.5
    bt, r = await _round(db_session, bt, 1, {"use_ultimate": True, "spell": "banana"}, {"answer": "B"})
    assert r.player1_used_ultimate is True and r.player1_damage == 60
    assert bm.battle_play(bt)["spell_bonus"] is None


async def test_spell_words_are_picked_per_player_and_avoid_the_question(db_session):
    kid, _ = await _student_with_pet(db_session, "spe")
    names = NAMES
    words = {}
    for n in names:
        words[n] = await _word(db_session, n, MEANING[n])
        db_session.add(LearningRecord(user_id=kid.id, word_id=words[n].id, learning_mode="quiz", is_correct=True))
    # 不合格的词: 短语、太长、带符号、太短、释义里写着答案 —— 都不能当咒语
    for bad, meaning in (("ice cream", "冰淇淋"), ("extraordinarily", "格外地"), ("T-shirt", "T恤"),
                         ("ox", "牛"), ("center", "(=center) 中心")):
        w = await _word(db_session, bad, meaning)
        db_session.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=False))
    # 他拼错过的 3 个词: 先挑它们
    for n in ("jungle", "pencil", "rabbit"):
        db_session.add(LearningRecord(user_id=kid.id, word_id=words[n].id, learning_mode="spelling",
                                      is_correct=False, user_answer="x"))
    await db_session.commit()

    for _ in range(6):
        qs = await svc.generate_battle_questions(db_session, None, count=10, player_ids=[kid.id, -1], spells=True)
        picked = []
        for q in qs:
            assert set(q.get("spells", {})) <= {str(kid.id)}, "只给真人备词,AI 不用拼"
            sp = q["spells"][str(kid.id)]
            picked.append(sp["word"])
            assert sp["word"] in names and sp["meaning"] == MEANING[sp["word"]] and sp["word_id"] == words[sp["word"]].id
            assert sp["word"].lower() != q["word"].lower(), "不能是这一回合的题目词"
            assert sp["word"].lower() not in [o[3:].lower() for o in q["options"]], "不能出现在这一回合的选项里"
            assert "spells" not in svc.public_question(q)
        assert len(set(picked)) == 10, "14 个词够用,一场里不重复"
        assert {"jungle", "pencil", "rabbit"} <= set(picked), "拼错过的词先挑"
    # 不要咒语时题目里没有这个键
    qs = await svc.generate_battle_questions(db_session, None, count=10, player_ids=[kid.id, -1])
    assert all("spells" not in q for q in qs)
    assert bm.spell_word_ok("apple", "苹果") and not bm.spell_word_ok("ice cream", "冰淇淋")
    assert not bm.spell_word_ok("ox", "牛") and not bm.spell_word_ok("center", "(=center) 中心")
    assert bm.spell_matches(" APPLE ", "apple") and not bm.spell_matches("", "apple") and not bm.spell_matches(None, "apple")


# ================================================================ C. 学习增益

async def _study(db, kid, *, homework=False, review=False, words=0, tag="bf"):
    if homework:
        t, unit = await _teacher_unit(db, tag)
        await _task(db, t, unit, kid, done_at=_today())
    if review:
        w = await _word(db, f"{tag}review")
        db.add(DailyReviewPlan(user_id=kid.id, plan_date=local_today(), word_ids=json.dumps([w.id]), backlog=1))
        db.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="review", is_correct=True,
                              created_at=_today()))
    for i in range(words):
        w = await _word(db, f"{tag}learn{i}")
        db.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=True,
                              created_at=_today()))
    await db.commit()


async def _free_play(db, **switches):
    await battle_tickets.save_settings(db, {**await battle_tickets.get_settings(db), "enabled": False, **switches})
    await db.commit()


async def test_study_buffs_each_take_effect(client, db_session):
    kid, pet = await _student_with_pet(db_session, "bfa")
    pet.current_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)        # 145,满血
    await _study(db_session, kid, homework=True, review=True, words=30, tag="bfa")
    await _free_play(db_session)

    view = (await client.get(BUFFS, headers=_h(kid.id))).json()
    assert view["enabled"] is True and [(i["key"], i["got"]) for i in view["items"]] == [
        ("homework", True), ("review", True), ("words", True)]
    assert all(i["route"] is None for i in view["items"])
    assert [i["detail"] for i in view["items"]] == ["攻击 +10%", "开局自带 1 格大招", "体力 +10%"]

    body = (await client.post(QUICK, headers=_h(kid.id))).json()
    assert [x["key"] for x in body["buffs"]["player1"]] == ["homework", "review", "words"]
    assert body["buffs"]["player2"] == [], "AI 没有增益"
    assert body["play"] == {"stances": True, "spell_ultimate": True, "hints": bm.stance_hints(),
                            "spell_bonus": "拼对咒语 大招伤害 ×1.5"}
    # 今日复习做完: 开局自带 1 格大招
    assert body["player1_pet"]["ultimate_charges"] == 1
    # 学满 30 个词: 体力上限 +10%,开局也多这么多血
    assert (body["player1_pet"]["hp"], body["player1_pet"]["max_hp"]) == (145 + 14, 145 + 14)
    bt = await db_session.get(PetBattle, body["id"])
    assert json.loads(bt.pet_hp_data)[str(pet.id)] == 159
    # 作业全做完: 打出去的伤害 +10%(对手换成普通属性、同级,免得属性克制和等级差把数字搅乱)
    ai_pet = await db_session.get(UserPet, bt.player2_pet_id)
    ai_pet.species, ai_pet.level, ai_pet.evolution_stage = "alpaca", 5, 1
    bt.player2_hp = bt.player2_initial_hp = 300
    await db_session.commit()
    right = json.loads(bt.questions_data)[0]["correct_answer"]
    await svc.process_round_answer(db_session, bt.id, kid.id, 1, right, SLOW, stance="heavy")
    await svc.process_round_answer(db_session, bt.id, svc.AI_USER_ID, 1, "X", 16000)
    bt, r = await svc.finalize_round(db_session, bt.id, 1)
    assert r.player1_damage == int(int(BASE * 1.5) * 1.1) == 46, "重击 ×1.5 再 ×1.1"

    # 打完存回宠物身上: 不超过真实的上限(加出来的那 14 点不带走)
    bt.current_round, bt.player2_hp = 5, 0
    await db_session.commit()
    await svc.finish_battle(db_session, bt.id, kid.id)
    await db_session.refresh(pet)
    assert pet.current_hp <= calculate_max_hp(pet.level, pet.evolution_stage, pet.species)


async def test_buffs_need_the_work_done_and_can_be_switched_off(client, db_session):
    # 什么都没做: 一项都没有,每一项写着怎么拿
    kid, pet = await _student_with_pet(db_session, "bfb")
    pet.current_hp = 145
    for i in range(6):
        await _word(db_session, f"bfbword{i}")
    await db_session.commit()
    await _free_play(db_session)
    view = (await client.get(BUFFS, headers=_h(kid.id))).json()
    assert [(i["key"], i["got"]) for i in view["items"]] == [("homework", False), ("review", False), ("words", False)]
    assert view["items"][0]["how"] == "今天没有布置作业,这一项没有" and view["items"][0]["route"] is None
    assert view["items"][2]["how"] == "今天学了 0 个词,再学 30 个" and view["items"][2]["route"] == "/student/dashboard"
    body = (await client.post(QUICK, headers=_h(kid.id))).json()
    assert body["buffs"] == {"player1": [], "player2": []}
    assert body["player1_pet"]["ultimate_charges"] == 0 and body["player1_pet"]["max_hp"] == 145

    # 布置了两份只做完一份: 不算「全部做完」;学了 29 个词: 差一个也不算
    kid2, pet2 = await _student_with_pet(db_session, "bfc")
    pet2.current_hp = 145
    t, unit = await _teacher_unit(db_session, "bfc")
    await _task(db_session, t, unit, kid2, done_at=_today())
    await _task(db_session, t, unit, kid2)
    await _study(db_session, kid2, words=29, tag="bfc")
    view = (await client.get(BUFFS, headers=_h(kid2.id))).json()
    assert [(i["key"], i["got"]) for i in view["items"]] == [("homework", False), ("review", False), ("words", False)]
    assert view["items"][0]["how"] == "做完今天的作业(还差 1 份)" and view["items"][0]["route"] == "/student/homework"
    assert view["items"][2]["how"] == "今天学了 29 个词,再学 1 个"
    assert (await client.post(QUICK, headers=_h(kid2.id))).json()["buffs"]["player1"] == []

    # 都做了,但平台把「学习增益」关了: 不算、不给
    kid3, pet3 = await _student_with_pet(db_session, "bfd")
    pet3.current_hp = 145
    await _study(db_session, kid3, homework=True, review=True, words=30, tag="bfd")
    await _free_play(db_session, study_buffs=False)
    assert (await client.get(BUFFS, headers=_h(kid3.id))).json() == {"enabled": False, "items": []}
    body = (await client.post(QUICK, headers=_h(kid3.id))).json()
    assert body["buffs"] == {"player1": [], "player2": []}
    assert body["player1_pet"]["ultimate_charges"] == 0 and body["player1_pet"]["max_hp"] == 145
    bt = await db_session.get(PetBattle, body["id"])
    assert bm.damage_buff(bt, kid3.id) == 1.0


async def test_switches_are_fixed_per_battle_and_do_not_touch_tickets(client, db_session):
    kid, pet = await _student_with_pet(db_session, "bfe")
    pet.current_hp = 145
    for i in range(6):
        await _word(db_session, f"bfeword{i}")
    await db_session.commit()

    # 三个新开关不是场数的一部分: 默认都开,场数照旧
    s = await battle_tickets.get_settings(db_session)
    assert (s["stances"], s["spell_ultimate"], s["study_buffs"], s["enabled"]) == (True, True, True, True)
    st = await battle_tickets.status(db_session, kid.id)
    assert (st["enabled"], st["earned"], st["left"], st["cap"]) == (True, 1, 1, 6)
    assert len(st["lines"]) == 6, "规则说明还是那几句,没被新开关带进去"
    for key in ("stances", "spell_ultimate", "study_buffs"):
        opt = next(o for o in battle_tickets.OPTIONS if o["key"] == key)
        assert opt["default"] is True and opt["effect"] and opt["risk"] and len(opt["choices"]) == 2
    # 设置只认 True / False(1 == True 的坑)
    for bad in (1, "on", None):
        try:
            battle_tickets.check_options({"stances": bad})
            raise AssertionError("该拒的没拒")
        except ValueError:
            pass

    # 场数总开关关着,三样照常生效
    await _free_play(db_session)
    first = (await client.post(QUICK, headers=_h(kid.id))).json()
    assert first["play"]["stances"] is True and first["play"]["spell_ultimate"] is True

    # 关掉两样: 之后新开的对战没有;正在打的那一场不变(开关是建对战时定下的)
    await _free_play(db_session, stances=False, spell_ultimate=False)
    bt1 = await db_session.get(PetBattle, first["id"])
    await db_session.refresh(bt1)
    assert bm.battle_play(bt1)["stances"] is True and bm.battle_play(bt1)["hints"] == bm.stance_hints()
    second = (await client.post(QUICK, headers=_h(kid.id))).json()
    assert second["play"] == {"stances": False, "spell_ultimate": False, "hints": None, "spell_bonus": None}
    bt2 = await db_session.get(PetBattle, second["id"])
    assert all("spells" not in q for q in json.loads(bt2.questions_data)), "关着就不挑咒语词"


# ================================================================ D. 守关专考错词

async def test_boss_stage_asks_the_childs_own_weak_words(client, db_session, monkeypatch):
    kid, pet = await _student_with_pet(db_session, "bsa")
    pet.current_hp = 145
    weak_ids = set()
    for i in range(12):                    # 12 个薄弱词: 计分模式里答错过、掌握度不到线
        w = await _word(db_session, f"weak{i}")
        db_session.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=False))
        db_session.add(WordMastery(user_id=kid.id, word_id=w.id, mastery_level=1))
        weak_ids.add(w.id)
    for i in range(30):                    # 30 个学得好的词
        w = await _word(db_session, f"fine{i}")
        db_session.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=True))
    for n in range(1, 5):
        db_session.add(PetTrialStage(user_id=kid.id, stage=n, stars=1, attempts=1,
                                     first_cleared_at=datetime.utcnow(), last_played_at=datetime.utcnow()))
    await db_session.commit()
    await _free_play(db_session)

    # 记下每次挑词时「先挑薄弱词」那一步给的比例(普通关补位是随机的,补到的也可能碰巧是薄弱词,
    # 所以普通关不拿「这一场有几个薄弱词」当判据 —— 那样的断言时过时不过)
    shares = []
    real_pick = svc._pick_battle_words

    async def spy(*args, **kwargs):
        shares.append(kwargs.get("weak_share"))
        return await real_pick(*args, **kwargs)

    monkeypatch.setattr(svc, "_pick_battle_words", spy)

    # 守关: 10 题全是他的薄弱词(12 个够用)
    body = (await client.post("/api/v1/student/battle/trial/5/start", headers=_h(kid.id))).json()
    assert body["trial"]["boss"] is True and body["trial"]["weak_words"] == 10
    bt = await db_session.get(PetBattle, body["id"])
    assert {q["word_id"] for q in json.loads(bt.questions_data)} <= weak_ids
    assert json.loads(bt.ai_config)["trial"]["weak_words"] == 10

    # 普通关: 先挑薄弱词那一步最多六成;报的数 = 这一场真的有几道薄弱词(补位补到的也算)
    pet.is_injured, pet.current_hp = False, 145
    await db_session.commit()
    body = (await client.post("/api/v1/student/battle/trial/4/start", headers=_h(kid.id))).json()
    bt = await db_session.get(PetBattle, body["id"])
    n_weak = sum(1 for q in json.loads(bt.questions_data) if q["word_id"] in weak_ids)
    assert n_weak >= 6 and body["trial"]["weak_words"] == n_weak
    assert shares == [1.0, 0.6] and pet_trial.BOSS_WEAK_SHARE == 1.0


async def test_boss_stage_tops_up_when_weak_words_run_short(client, db_session):
    kid, pet = await _student_with_pet(db_session, "bsb")
    pet.current_hp = 145
    weak_ids = set()
    for i in range(3):
        w = await _word(db_session, f"fewweak{i}")
        db_session.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=False))
        db_session.add(WordMastery(user_id=kid.id, word_id=w.id, mastery_level=1))
        weak_ids.add(w.id)
    for i in range(20):
        w = await _word(db_session, f"okword{i}")
        db_session.add(LearningRecord(user_id=kid.id, word_id=w.id, learning_mode="spelling", is_correct=True))
    for n in range(1, 5):
        db_session.add(PetTrialStage(user_id=kid.id, stage=n, stars=1, attempts=1,
                                     first_cleared_at=datetime.utcnow(), last_played_at=datetime.utcnow()))
    await db_session.commit()
    await _free_play(db_session)
    body = (await client.post("/api/v1/student/battle/trial/5/start", headers=_h(kid.id))).json()
    bt = await db_session.get(PetBattle, body["id"])
    ids = [q["word_id"] for q in json.loads(bt.questions_data)]
    assert len(ids) == 10 and weak_ids <= set(ids), "3 个薄弱词都要考到,剩下的照旧用学过的词补"
    assert body["trial"]["weak_words"] == 3


# ================================================================ 真走 WebSocket: 出招 + 拼咒语

async def test_stance_and_spell_over_real_websocket(live, monkeypatch):  # noqa: F811
    host, Session, uid = live          # AI 每回合答错(自己掉 10): live 这个 fixture 定死的
    async with Session() as db:
        for n in NAMES:                      # 孩子学过的 14 个词(咒语只能用纯字母的词)
            w = Word(word=n)
            db.add(w)
            await db.flush()
            db.add(WordDefinition(word_id=w.id, meaning=MEANING[n], is_primary=True))
            db.add(LearningRecord(user_id=uid, word_id=w.id, learning_mode="spelling", is_correct=True))
        for n in range(1, 5):                # 直接打守关(血厚,够打好几回合)
            db.add(PetTrialStage(user_id=uid, stage=n, stars=1, attempts=1,
                                 first_cleared_at=datetime.utcnow(), last_played_at=datetime.utcnow()))
        await db.commit()

    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/5/start")
    assert b["play"]["stances"] is True and b["play"]["hints"]["heavy"] == "对 ×1.5 · 错掉 20"
    qs = await _answers_of(Session, b["id"])
    token = _make_token(uid)
    rounds, results, end = {}, {}, None
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}/answer?token={token}") as ans:
        while end is None:
            raw = await asyncio.wait_for(main.recv(), timeout=30)
            msg = json.loads(raw)
            if msg.get("type") == "new_round":
                n = msg["round_number"]
                rounds[n] = (msg, raw)
                send = {"type": "submit_answer", "round_number": n, "answer": qs[n - 1]["correct_answer"],
                        "time_ms": 900, "v": 2}          # 新页面交答案都带 v: 2
                spell = msg["question"].get("spell")
                if spell:
                    word = qs[n - 1]["spells"][str(uid)]["word"]
                    # 第一次拿到咒语故意拼错,第二次拼对
                    first_time = not any(m[0]["question"].get("spell") for k, m in rounds.items() if k < n)
                    send.update(use_ultimate=True, spell="zzz" if first_time else word.upper())
                else:
                    send["stance"] = "guard"          # 没大招的回合一律防守
                await ans.send(json.dumps(send))
            elif msg.get("type") == "round_result":
                results[msg["result"]["round_number"]] = msg["result"]
            elif msg.get("type") == "battle_end":
                end = msg
            elif msg.get("type") == "error":
                raise AssertionError(msg)

    spell_rounds = [n for n, (m, _) in sorted(rounds.items()) if m["question"].get("spell")]
    assert spell_rounds[:2] == [4, 5], "连对 3 题攒出一格: 第 4 回合起才有咒语"
    for n, (m, raw) in rounds.items():
        if n in spell_rounds:
            word = qs[n - 1]["spells"][str(uid)]["word"]
            assert word not in raw and word.upper() not in raw, "出题的那条消息里找不到咒语词的拼写"
            sp = m["question"]["spell"]
            assert sp["meaning"] == MEANING[word] and sp["length"] == len(word) and len(sp["letters"]) == len(word) + 2
            assert m["time_limit"] == 15 + 10, "要拼咒语的回合多 10 秒"
        else:
            assert m["time_limit"] == 15
        assert "spells" not in m["question"]
    # 前 3 回合防守答对: 伤害 ×0.6
    assert [results[n]["player1_stance"] for n in (1, 2, 3)] == ["guard"] * 3
    assert results[1]["player1_damage"] == int((20 + 8 + 10) * 0.6)       # 同级、进化 1 档、3 秒内答对 +10
    # 第 4 回合拼错: 只算普通攻击,大招那一格还在
    r4 = results[4]
    assert r4["player1_used_ultimate"] is False and r4["player1_stance"] == "normal"
    assert r4["player1_spell"]["ok"] is False and r4["player1_spell"]["typed"] == "zzz"
    assert r4["player1_spell"]["word"] == qs[3]["spells"][str(uid)]["word"], "结算时才给答案"
    assert r4["player1_ultimate_charges"] >= 1
    # 第 5 回合拼对(大写也算): 放出大招
    r5 = results[5]
    assert r5["player1_used_ultimate"] is True and r5["player1_stance"] == "ultimate" and r5["player1_spell"]["ok"] is True
    assert r5["player1_damage"] == int(60 * 1.5) == 90, "拼对咒语放出来的大招 ×1.5"
    # 结算页的复习词里有拼错的那个咒语词
    assert [x["word"] for x in end["review"] if x.get("spell")] == [qs[3]["spells"][str(uid)]["word"]]
    assert end["winner_id"] == uid and end["trial"]["won"] is True
    async with Session() as db:
        got = (await db.execute(select(PetBattleRound).where(PetBattleRound.battle_id == b["id"])
                                .order_by(PetBattleRound.round_number))).scalars().all()
        assert [r.player1_stance for r in got[:5]] == ["guard", "guard", "guard", "normal", "ultimate"]
        assert (await db.get(PetBattle, b["id"])).status == "finished"


async def test_old_page_fires_the_ultimate_the_old_way(live):  # noqa: F811
    """还没刷新的老页面(交答案不带 v): 不带 stance、不带 spell、不认识题目里多出来的键 —— 照样打完;
    有咒语的回合点大招照老规矩**直接放出来、扣一格**,但没有拼对咒语的 ×1.5。
    (不这样的话上线那一刻没刷新的孩子看到的是「大招点了没放出来」)"""
    host, Session, uid = live          # AI 每回合答错: live 这个 fixture 定死的
    async with Session() as db:
        for n in NAMES:                # 孩子学过的 14 个词: 这样每一回合都给他备得出咒语词
            w = Word(word=n)
            db.add(w)
            await db.flush()
            db.add(WordDefinition(word_id=w.id, meaning=MEANING[n], is_primary=True))
            db.add(LearningRecord(user_id=uid, word_id=w.id, learning_mode="spelling", is_correct=True))
        for n in range(1, 5):          # 直接打守关(血厚,够打到攒出大招)
            db.add(PetTrialStage(user_id=uid, stage=n, stars=1, attempts=1,
                                 first_cleared_at=datetime.utcnow(), last_played_at=datetime.utcnow()))
        await db.commit()
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/5/start")
    qs = await _answers_of(Session, b["id"])
    assert all(str(uid) in q.get("spells", {}) for q in qs), "每一回合都给他备了咒语词"
    token = _make_token(uid)
    end, results, had_spell = None, {}, {}
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}/answer?token={token}") as ans:
        while end is None:
            msg = json.loads(await asyncio.wait_for(main.recv(), timeout=30))
            if msg.get("type") == "new_round":
                n = msg["round_number"]
                had_spell[n] = bool(msg["question"].get("spell"))
                # 老页面: 没有 v、没有 stance、没有 spell;手里有大招就点(它只看得到那个按钮)
                await ans.send(json.dumps({"type": "submit_answer", "round_number": n,
                                           "answer": qs[n - 1]["correct_answer"], "time_ms": 900,
                                           "use_ultimate": had_spell[n]}))
            elif msg.get("type") == "round_result":
                results[msg["result"]["round_number"]] = msg["result"]
            elif msg.get("type") == "battle_end":
                end = msg
            elif msg.get("type") == "error":
                raise AssertionError(msg)
    assert end["winner_id"] == uid
    assert all(r["player1_spell"] is None for r in results.values()), "老页面没试过咒语"
    first = min(n for n, has in had_spell.items() if has)
    assert first == 4, "连对 3 题攒出一格: 第 4 回合手里有大招(服务端照样把咒语发下来了,老页面不认)"
    r = results[first]
    assert r["player1_used_ultimate"] is True and r["player1_stance"] == "ultimate", "老页面点大招: 直接放出来"
    assert r["player1_damage"] == 60, "直接放的没有拼对咒语的 ×1.5"
    assert r["player1_ultimate_charges"] == 0, "那一格扣掉了"
    assert all(results[n]["player1_stance"] == "normal" for n in (1, 2, 3))
    assert not [x for x in end["review"] if x.get("spell")], "没试过咒语,复习词里没有咒语词"
    async with httpx.AsyncClient(base_url=f"http://{host}", headers=_auth(uid), timeout=20) as c:
        assert (await c.get(f"/api/v1/student/battle/{b['id']}")).json()["status"] == "finished"


async def test_legacy_client_flag_only_skips_the_spell(db_session):
    """同一回合、同样点大招不带 spell: 老页面直接放、扣格、伤害 ×1;新页面(v ≥ 2)只算普通攻击、不扣格"""
    w = await _word(db_session, "question")
    banana = await _word(db_session, "banana", "香蕉")

    async def fire(tag, **kw):
        a, b, bt = await _pvp(db_session, tag, charges=(1, 0))
        q = _q(w, {str(a.id): {"word_id": banana.id, "word": "banana", "meaning": "香蕉"}})
        bt.questions_data = json.dumps([q], ensure_ascii=False)
        await db_session.commit()
        bt, r = await _round(db_session, bt, 1, {"use_ultimate": True, **kw}, {"answer": "B"})
        return r.player1_used_ultimate, r.player1_damage, bt.player1_ultimate_charges, svc.round_moves(r)["player1_spell"]

    assert await fire("lga", legacy_client=True) == (True, 60, 0, None)
    # 老页面就算带了个 spell 上来也不认(它本来就不该有): 还是直接放、没有 ×1.5
    assert await fire("lgb", legacy_client=True, spell="banana") == (True, 60, 0, None)
    used, dmg, charges, spell = await fire("lgc")            # 新页面没拼
    assert (used, dmg, charges) == (False, BASE, 1) and spell["ok"] is False
    used, dmg, charges, spell = await fire("lgd", spell="banana")   # 新页面拼对
    assert (used, dmg, charges) == (True, 90, 0) and spell["ok"] is True
    # 哪些算老页面: 没带 v / 不是数 / 比 2 小
    assert [bm.is_legacy_client(v) for v in (None, "2", True, 0, 1, 1.9, 2, 3)] == [
        True, True, True, True, True, True, False, False]
    assert bm.CLIENT_V_SPELL == 2
