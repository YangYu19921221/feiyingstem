import json

import pytest

from app.core.pet_formulas import calculate_max_hp
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle
from app.models.user import User
from app.models.word import Word
from app.schemas.pet_battle import QuestionData, RoundQuestionData
from app.services.pet_battle_service import (
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
