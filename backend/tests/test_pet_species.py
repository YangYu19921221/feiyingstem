from app.core.pet_species import (
    ALLOWED_PET_SPECIES,
    PET_SPECIES,
    get_pet_element,
    get_pet_stage_name,
)
from app.core.type_effectiveness import get_pet_type
from app.services.ai_opponent_service import AI_PET_SPECIES
from app.services.pet_battle_service import calculate_ultimate_damage


def test_all_pet_families_have_complete_evolution_metadata():
    assert len(PET_SPECIES) == 25
    assert ALLOWED_PET_SPECIES == frozenset(PET_SPECIES)

    for species, definition in PET_SPECIES.items():
        assert definition["label"]
        assert len(definition["stages"]) == 4
        assert definition["stages"][0] == "伙伴蛋"
        assert get_pet_stage_name(species, 3) == definition["stages"][3]
        assert get_pet_type(species) == get_pet_element(species)


def test_new_families_are_available_to_ai_and_battle():
    new_families = {"caterpie", "weedle", "bellsprout", "horsea", "larvitar", "ralts"}

    assert new_families.issubset(AI_PET_SPECIES)
    assert all(calculate_ultimate_damage(species, 3) > 40 for species in new_families)

