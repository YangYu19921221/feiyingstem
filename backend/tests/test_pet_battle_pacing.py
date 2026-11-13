"""宠物对战: 回合节奏 + 答错的词排进复习(2026-11-11)

1. 回合之间不再固定干等 8 秒: 按这一回合的招式要演多久算;有人能换宠物才留满 8 秒
2. 演出时间常量前后端同一组数(前端 config/petSpecies.ts,这里解析那个文件比对)——
   服务端按它算「几秒后发下一题」,前端按它排动画,对不上就是最后一记被下一题掐断
3. 对战里答错的词: 学过的把复习往前排;没学过的不建掌握度;超时不算;一律不写学习记录
"""
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select

from app.core import pet_formulas as pf
from app.models.learning import LearningRecord, WordMastery
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle
from app.models.word import Word, WordDefinition
from app.services import mastery as mastery_svc
from app.services import pet_battle_service as svc
from tests.test_pet_multitab_exploits import _battle, _student_with_pet

FRONT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "config" / "petSpecies.ts"


def _ts_const(name: str) -> float:
    m = re.search(rf"export const {name}\s*=\s*([0-9.]+)\s*;", FRONT.read_text(encoding="utf-8"))
    assert m, f"前端 config/petSpecies.ts 里找不到 {name}"
    return float(m.group(1))


def test_timing_constants_match_frontend():
    assert _ts_const("EFFECT_STEP_NORMAL") == pf.BATTLE_FX_STEP_NORMAL
    assert _ts_const("EFFECT_STEP_ULTIMATE") == pf.BATTLE_FX_STEP_ULTIMATE
    assert _ts_const("FX_TAIL") == pf.BATTLE_FX_TAIL
    assert _ts_const("ROUND_READ_SECONDS") == pf.BATTLE_READ_SECONDS


def test_round_gap_follows_the_moves():
    assert pf.round_gap_seconds(2, 0, False) == 4.5      # 两记普通攻击
    assert pf.round_gap_seconds(1, 1, False) == 6.5      # 一记大招 + 一记普通
    assert pf.round_gap_seconds(0, 2, False) == 8.5      # 两记大招
    assert pf.round_gap_seconds(0, 0, False) == 1.6      # 没有招式也留看答案的时间
    # 有人能换宠物: 至少 8 秒;本来就超过 8 秒的不缩短
    assert pf.round_gap_seconds(2, 0, True) == 8.0
    assert pf.round_gap_seconds(0, 2, True) == 8.5
    # 每一种组合都要比「全部招式演完」长,否则最后一记会被下一题掐断
    for n, u in [(1, 0), (2, 0), (0, 1), (1, 1), (0, 2)]:
        played = n * pf.BATTLE_FX_STEP_NORMAL + u * pf.BATTLE_FX_STEP_ULTIMATE + pf.BATTLE_FX_TAIL
        assert pf.round_gap_seconds(n, u, False) >= played + 1.0


def test_round_fx_counts_merge_one_hit_per_side():
    # 两边都答对: 各打一记
    assert pf.round_fx_counts(30, 25, False, False) == (2, 0)
    # 我答对、对手答错: 对手挨的「我的攻击 + 他自己扣的 10」合成一记
    assert pf.round_fx_counts(30, -10, False, False) == (1, 0)
    assert pf.round_fx_counts(-10, 25, False, False) == (1, 0)
    # 两边都答错: 各挨一记
    assert pf.round_fx_counts(-10, -10, False, False) == (2, 0)
    # 大招
    assert pf.round_fx_counts(60, 25, True, False) == (1, 1)
    assert pf.round_fx_counts(60, -10, True, False) == (0, 1)
    assert pf.round_fx_counts(60, 70, True, True) == (0, 2)
    # 点了大招但答错: 没放出来,不算大招
    assert pf.round_fx_counts(-10, 25, True, False) == (1, 0)


async def test_anyone_can_switch(db_session):
    a, pa = await _student_with_pet(db_session, "pca")
    b, pb = await _student_with_pet(db_session, "pcb")
    bt = _battle(a, pa, b, pb)
    bt.player2_hp = 60
    db_session.add(bt)
    await db_session.commit()
    assert await svc.anyone_can_switch(db_session, bt) is False, "两边都只有一只,换不了"

    spare = UserPet(user_id=a.id, name="备用", species="alpaca", level=3, evolution_stage=1,
                    current_hp=50, is_active=False, is_injured=True)
    db_session.add(spare)
    await db_session.commit()
    assert await svc.anyone_can_switch(db_session, bt) is False, "备用那只受伤了,不能上"
    spare.is_injured = False
    await db_session.commit()
    assert await svc.anyone_can_switch(db_session, bt) is True

    bt.pet_hp_data = json.dumps({str(spare.id): 0})      # 这一场里备用那只已经被打空了
    await db_session.commit()
    assert await svc.anyone_can_switch(db_session, bt) is False
    bt.pet_hp_data = json.dumps({})
    bt.player1_hp = 0                                     # 场上这只已经倒了: 这一场结束了,不是换宠
    await db_session.commit()
    assert await svc.anyone_can_switch(db_session, bt) is False


async def _word(db, text):
    w = Word(word=text)
    db.add(w)
    await db.flush()
    db.add(WordDefinition(word_id=w.id, meaning=f"{text}的意思", is_primary=True))
    return w


async def _battle_with_question(db, a, pa, b, pb, word):
    q = [{"word_id": word.id, "word": word.word, "question_text": "?", "options": ["A. 对", "B. 错"],
          "correct_answer": "A"}]
    bt = PetBattle(player1_id=a.id, player2_id=b.id, player1_pet_id=pa.id, player2_pet_id=pb.id,
                   status="active", max_rounds=1, questions_data=json.dumps(q),
                   player1_initial_hp=100, player2_initial_hp=100, player1_hp=100, player2_hp=100,
                   pet_hp_data=json.dumps({}))
    db.add(bt)
    await db.commit()
    return bt


async def test_wrong_answer_on_a_learned_word_pulls_review_forward(db_session):
    a, pa = await _student_with_pet(db_session, "pcc")
    b, pb = await _student_with_pet(db_session, "pcd")
    w = await _word(db_session, "pcword")
    # 学过、排到了 4 天后才复习
    m = await mastery_svc.get_or_create(db_session, a.id, w.id)
    m.total_encounters, m.correct_count, m.review_stage = 4, 4, 4
    m.next_review_at = datetime.utcnow() + timedelta(days=4)
    await db_session.commit()
    bt = await _battle_with_question(db_session, a, pa, b, pb, w)

    await svc.process_round_answer(db_session, bt.id, a.id, 1, "B", 2000)
    await db_session.refresh(m)
    assert (m.wrong_count, m.total_encounters, m.review_stage) == (1, 5, 2)
    assert m.next_review_at < datetime.utcnow() + timedelta(days=1), "复习要往前排"
    n = (await db_session.execute(
        select(func.count()).select_from(LearningRecord).where(LearningRecord.user_id == a.id))).scalar()
    assert n == 0, "对战不写学习记录(否则打对战就能给自己挣场数)"


async def test_unlearned_word_timeout_and_correct_do_not_touch_mastery(db_session):
    a, pa = await _student_with_pet(db_session, "pce")
    b, pb = await _student_with_pet(db_session, "pcf")
    w = await _word(db_session, "pcnew")
    bt = await _battle_with_question(db_session, a, pa, b, pb, w)

    # a: 没学过这个词,答错 → 不建掌握度;b: 学过,超时(答案 X)→ 不算答错
    mb = await mastery_svc.get_or_create(db_session, b.id, w.id)
    mb.total_encounters, mb.correct_count, mb.review_stage = 2, 2, 2
    await db_session.commit()
    await svc.process_round_answer(db_session, bt.id, a.id, 1, "B", 2000)
    await svc.process_round_answer(db_session, bt.id, b.id, 1, "X", 16000)
    rows = (await db_session.execute(
        select(WordMastery).where(WordMastery.word_id == w.id))).scalars().all()
    assert [r.user_id for r in rows] == [b.id], "没学过的词不该凭一次对战进复习队列"
    await db_session.refresh(mb)
    assert (mb.wrong_count or 0, mb.total_encounters, mb.review_stage) == (0, 2, 2), "超时没答不算不会"

    # 答对也不记: 四选一有四分之一是蒙的
    w2 = await _word(db_session, "pcright")
    m2 = await mastery_svc.get_or_create(db_session, a.id, w2.id)
    m2.total_encounters, m2.correct_count = 1, 1
    await db_session.commit()
    bt2 = await _battle_with_question(db_session, a, pa, b, pb, w2)
    await svc.process_round_answer(db_session, bt2.id, a.id, 1, "A", 2000)
    await db_session.refresh(m2)
    assert (m2.total_encounters, m2.correct_count) == (1, 1)


async def test_battle_review_lists_each_round(db_session):
    a, pa = await _student_with_pet(db_session, "pcg")
    b, pb = await _student_with_pet(db_session, "pch")
    w = await _word(db_session, "review")
    q = [{"word_id": w.id, "word": "review", "question_text": "单词 'review' 的意思是?",
          "options": ["A. 复习", "B. 预习", "C. 练习", "D. 学习"], "correct_answer": "A"}]
    bt = PetBattle(player1_id=a.id, player2_id=b.id, player1_pet_id=pa.id, player2_pet_id=pb.id,
                   status="active", max_rounds=1, questions_data=json.dumps(q, ensure_ascii=False),
                   player1_initial_hp=100, player2_initial_hp=100, player1_hp=100, player2_hp=100,
                   pet_hp_data=json.dumps({}))
    db_session.add(bt)
    await db_session.commit()
    await svc.process_round_answer(db_session, bt.id, a.id, 1, "C", 2000)    # 答错
    await svc.process_round_answer(db_session, bt.id, b.id, 1, "X", 16000)   # 超时
    got = await svc.battle_review(db_session, bt.id)
    assert got == [{
        "round": 1, "word_id": w.id, "word": "review", "meaning": "复习",
        "player1_correct": False, "player2_correct": False,
        "player1_answered": True, "player2_answered": False,
        # 2026-11-12 起每行多三个键: 防守还答对了 = 拿不准(这一回合两边都没答对,都是 False)
        "player1_unsure": False, "player2_unsure": False, "unsure": False,
    }]
