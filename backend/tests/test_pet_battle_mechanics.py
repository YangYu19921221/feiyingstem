import json

import pytest

from app.core.pet_formulas import calculate_max_hp
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle
from app.models.user import User
from app.models.word import Word
from app.schemas.pet_battle import QuestionData, RoundQuestionData
from app.services.pet_battle_service import (
    finalize_round,
    get_battle_pet_hp_data,
    next_combo_state,
    process_round_answer,
    switch_battle_pet,
)


def test_three_correct_answers_award_one_skill_charge():
    combo, charges = 0, 0
    combo, charges = next_combo_state(combo, charges, True)
    assert (combo, charges) == (1, 0)
    combo, charges = next_combo_state(combo, charges, True)
    assert (combo, charges) == (2, 0)
    combo, charges = next_combo_state(combo, charges, True)
    assert (combo, charges) == (3, 1)
    assert next_combo_state(combo, charges, False) == (0, 1)


def test_correct_answer_is_only_exposed_in_round_result():
    payload = {
        "word_id": 1,
        "word": "brilliant",
        "question_text": "请选择正确答案",
        "options": ["A. 正确", "B. 错误"],
        "correct_answer": "A",
    }
    assert "correct_answer" not in QuestionData(**payload).model_dump()
    assert RoundQuestionData(**payload).model_dump()["correct_answer"] == "A"


async def _battle_fixture(db_session):
    player1 = User(
        username="battle_switch_1",
        email="battle_switch_1@example.com",
        hashed_password="x",
        role="student",
        is_active=True,
    )
    player2 = User(
        username="battle_switch_2",
        email="battle_switch_2@example.com",
        hashed_password="x",
        role="student",
        is_active=True,
    )
    db_session.add_all([player1, player2])
    await db_session.flush()

    pet1 = UserPet(
        user_id=player1.id,
        name="先锋",
        species="pikachu",
        level=5,
        evolution_stage=1,
        current_hp=120,
        is_active=True,
    )
    reserve = UserPet(
        user_id=player1.id,
        name="后援",
        species="charmander",
        level=10,
        evolution_stage=2,
        current_hp=160,
    )
    pet2 = UserPet(
        user_id=player2.id,
        name="对手",
        species="squirtle",
        level=5,
        evolution_stage=1,
        current_hp=120,
        is_active=True,
    )
    db_session.add_all([pet1, reserve, pet2])
    await db_session.flush()

    word = Word(word="battle_mechanic_word", difficulty=2)
    db_session.add(word)
    await db_session.flush()
    questions = [
        {
            "word_id": word.id,
            "word": word.word,
            "question_text": "请选择正确答案",
            "options": ["A. 正确", "B. 错误", "C. 其他", "D. 其他"],
            "correct_answer": "A",
        },
        {
            "word_id": word.id,
            "word": word.word,
            "question_text": "请选择正确答案",
            "options": ["A. 正确", "B. 错误", "C. 其他", "D. 其他"],
            "correct_answer": "A",
        },
    ]
    max1 = calculate_max_hp(pet1.level, pet1.evolution_stage)
    max2 = calculate_max_hp(pet2.level, pet2.evolution_stage)
    battle = PetBattle(
        player1_id=player1.id,
        player2_id=player2.id,
        player1_pet_id=pet1.id,
        player2_pet_id=pet2.id,
        status="active",
        max_rounds=2,
        questions_data=json.dumps(questions, ensure_ascii=False),
        player1_initial_hp=max1,
        player2_initial_hp=max2,
        player1_hp=max1 // 2,
        player2_hp=max2,
        player1_combo=3,
        player1_ultimate_charges=1,
    )
    db_session.add(battle)
    await db_session.commit()
    await db_session.refresh(battle)
    return player1, player2, pet1, reserve, pet2, battle


@pytest.mark.asyncio
async def test_each_switched_pet_keeps_its_own_battle_hp(db_session):
    player1, _, lead_pet, reserve, _, battle = await _battle_fixture(db_session)
    old_hp = battle.player1_hp
    reserve_start_hp = reserve.current_hp

    switched = await switch_battle_pet(db_session, battle.id, player1.id, reserve.id)

    assert switched.player1_pet_id == reserve.id
    assert switched.player1_hp == reserve_start_hp
    assert switched.player1_combo == 3
    assert switched.player1_ultimate_charges == 1

    switched.player1_hp -= 17
    await db_session.commit()
    switched_back = await switch_battle_pet(
        db_session, battle.id, player1.id, lead_pet.id
    )
    assert switched_back.player1_hp == old_hp

    switched_again = await switch_battle_pet(
        db_session, battle.id, player1.id, reserve.id
    )
    assert switched_again.player1_hp == reserve_start_hp - 17
    hp_data = get_battle_pet_hp_data(switched_again)
    assert hp_data[str(lead_pet.id)] == old_hp
    assert hp_data[str(reserve.id)] == reserve_start_hp - 17


@pytest.mark.asyncio
async def test_wrong_answer_does_not_fire_or_consume_skill(db_session):
    player1, _, _, _, _, battle = await _battle_fixture(db_session)

    battle, first_round = await process_round_answer(
        db_session,
        battle.id,
        player1.id,
        round_number=1,
        answer="B",
        time_ms=1200,
        use_ultimate=True,
    )
    assert first_round.player1_damage == -10
    assert first_round.player1_used_ultimate is False
    assert battle.player1_ultimate_charges == 1
    assert battle.player1_combo == 0

    battle, second_round = await process_round_answer(
        db_session,
        battle.id,
        player1.id,
        round_number=2,
        answer="A",
        time_ms=1200,
        use_ultimate=True,
    )
    assert second_round.player1_damage > 0
    assert second_round.player1_used_ultimate is True
    assert battle.player1_ultimate_charges == 0


@pytest.mark.asyncio
async def test_finalize_round_applies_type_multiplier(db_session):
    """皮卡丘(电)打杰尼龟(水)效果拔群×2;水打电普通×1。"""
    player1, player2, _, _, _, battle = await _battle_fixture(db_session)
    p1_hp_before = battle.player1_hp
    p2_hp_before = battle.player2_hp

    await process_round_answer(
        db_session, battle.id, player1.id, round_number=1, answer="A", time_ms=6000
    )
    battle, round_obj = await process_round_answer(
        db_session, battle.id, player2.id, round_number=1, answer="A", time_ms=6000
    )
    base_p1 = round_obj.player1_damage
    base_p2 = round_obj.player2_damage
    assert base_p1 > 0 and base_p2 > 0

    battle, round_obj = await finalize_round(db_session, battle.id, 1)

    assert round_obj.player1_type_multiplier == 2.0
    assert round_obj.player1_type_text == "效果拔群！"
    assert round_obj.player1_damage == base_p1 * 2
    assert battle.player2_hp == max(0, p2_hp_before - base_p1 * 2)

    assert round_obj.player2_type_multiplier == 1.0
    assert round_obj.player2_type_text is None
    assert round_obj.player2_damage == base_p2
    assert battle.player1_hp == max(0, p1_hp_before - base_p2)


@pytest.mark.asyncio
async def test_finalize_round_rejects_non_active_battle(db_session):
    """已结束的对战禁止再结算——僵尸回合循环不能在血量归零后继续扣血。"""
    player1, _, _, _, _, battle = await _battle_fixture(db_session)
    await process_round_answer(
        db_session, battle.id, player1.id, round_number=1, answer="A", time_ms=6000
    )
    battle.status = "finished"
    await db_session.commit()

    with pytest.raises(ValueError):
        await finalize_round(db_session, battle.id, 1)


@pytest.mark.asyncio
async def test_battle_questions_come_from_learned_words(db_session):
    """出题必须落在参战学生背过的词里;词池不够时重复补足到指定题数。"""
    from app.models.learning import LearningRecord
    from app.models.word import WordDefinition
    from app.services.pet_battle_service import generate_battle_questions

    user = User(
        username="battle_words_stu",
        email="battle_words_stu@example.com",
        hashed_password="x",
        role="student",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    learned_ids = set()
    for i in range(3):
        word = Word(word=f"learned_{i}", difficulty=1)
        db_session.add(word)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=word.id, meaning=f"释义{i}", part_of_speech="n.", is_primary=True))
        db_session.add(LearningRecord(user_id=user.id, word_id=word.id, learning_mode="spelling", is_correct=True))
        learned_ids.add(word.id)
    # 没背过的词:不该被抽中
    for i in range(5):
        word = Word(word=f"unlearned_{i}", difficulty=1)
        db_session.add(word)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=word.id, meaning=f"陌生释义{i}", part_of_speech="n.", is_primary=True))
    await db_session.commit()

    questions = await generate_battle_questions(
        db_session, None, count=10, player_ids=[user.id, -1]
    )

    assert len(questions) == 10  # 只背过3个词也能凑满10题(重复补足)
    assert {q["word_id"] for q in questions} <= learned_ids


@pytest.mark.asyncio
async def test_forfeit_battle_zeroes_quitter(db_session):
    """逃跑判负:对手判胜,逃跑方奖励归零、出战宠物血量清零。"""
    from app.services.pet_battle_service import forfeit_battle

    player1, player2, pet1, _, _, battle = await _battle_fixture(db_session)

    result = await forfeit_battle(db_session, battle.id, player1.id)

    assert result is not None
    assert result["winner_id"] == player2.id
    await db_session.refresh(battle)
    assert battle.status == "finished"
    assert battle.winner_id == player2.id
    assert battle.player1_hp == 0
    await db_session.refresh(pet1)
    assert pet1.current_hp == 0
