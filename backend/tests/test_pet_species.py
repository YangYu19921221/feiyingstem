from app.core.pet_species import (
    ALLOWED_PET_SPECIES,
    PET_SPECIES,
    get_pet_element,
    get_pet_stage_name,
)
from app.core.type_effectiveness import get_pet_type
from app.core.pet_formulas import (
    EVOLUTION_THRESHOLDS,
    apply_xp_and_level,
    evolution_stage_for_level,
    next_pet_slot_threshold,
    pet_recovery_goal,
    pet_slots_for_words,
)
from app.services.ai_opponent_service import AI_PET_SPECIES
from app.services.pet_battle_service import (
    PET_CAPTURE_CHANCE,
    calculate_ultimate_damage,
    capture_roll_succeeds,
)
from types import SimpleNamespace


def test_all_pet_families_have_complete_evolution_metadata():
    assert len(PET_SPECIES) == 40
    assert ALLOWED_PET_SPECIES == frozenset(PET_SPECIES)

    for species, definition in PET_SPECIES.items():
        assert definition["label"]
        assert len(definition["stages"]) == 5
        assert definition["stages"][0] == "伙伴蛋"
        assert definition["stages"][4].startswith("晶耀")
        assert get_pet_stage_name(species, 4) == definition["stages"][4]
        assert get_pet_type(species) == get_pet_element(species)


def test_new_families_are_available_to_ai_and_battle():
    new_families = {
        "chikorita", "cyndaquil", "totodile", "treecko", "torchic", "mudkip",
        "bagon", "beldum", "gible", "snivy", "tepig", "oshawott", "rowlet",
        "litten", "popplio",
    }

    assert new_families.issubset(AI_PET_SPECIES)
    assert all(calculate_ultimate_damage(species, 3) > 40 for species in new_families)


def test_level_45_unlocks_gem_evolution():
    assert EVOLUTION_THRESHOLDS[3] == 45
    assert evolution_stage_for_level(44) == 3
    assert evolution_stage_for_level(45) == 4

    pet = SimpleNamespace(level=45, experience=0, evolution_stage=3)
    leveled_up, evolved = apply_xp_and_level(pet)
    assert not leveled_up
    assert evolved
    assert pet.evolution_stage == 4


def test_pet_roster_unlocks_every_2000_words_and_caps_at_five():
    assert pet_slots_for_words(0) == 1
    assert pet_slots_for_words(1999) == 1
    assert pet_slots_for_words(2000) == 2
    assert pet_slots_for_words(6000) == 4
    assert pet_slots_for_words(8000) == 5
    assert pet_slots_for_words(10000) == 5
    assert next_pet_slot_threshold(1999) == 2000
    assert next_pet_slot_threshold(2000) == 4000
    assert next_pet_slot_threshold(10000) is None


def test_capture_roll_and_last_pet_recovery_threshold():
    assert PET_CAPTURE_CHANCE == 0.20
    assert capture_roll_succeeds(0)
    assert capture_roll_succeeds(0.199999)
    assert not capture_roll_succeeds(0.20)
    assert not capture_roll_succeeds(0.99)
    assert pet_recovery_goal(0) == 2000
    assert pet_recovery_goal(6400) == 8400
