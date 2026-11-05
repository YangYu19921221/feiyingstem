import pytest

from app.core.pet_species import (
    ALLOWED_PET_SPECIES,
    LEGENDARY_SPECIES,
    LEGEND_WORDS,
    PET_SPECIES,
    SEMI_LEGEND_WORDS,
    get_pet_element,
    get_pet_stage_name,
    is_legendary,
    tier_power_bonus,
    words_required_for,
)
from app.core.type_effectiveness import get_pet_type
from app.core.pet_formulas import (
    EVOLUTION_THRESHOLDS,
    MAX_LEGEND_SLOTS,
    apply_xp_and_level,
    calculate_max_hp,
    evolution_stage_for_level,
    legend_slots_for_words,
    next_legend_slot_threshold,
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
    assert len(PET_SPECIES) == 120   # 70 + 2026-11-05 第二批 42 普通 + 8 稀有
    assert ALLOWED_PET_SPECIES == frozenset(PET_SPECIES)

    for species, definition in PET_SPECIES.items():
        assert definition["label"]
        assert len(definition["stages"]) == 5
        # 传说的蛋叫「传说之卵」、第五档叫「神话XX」；普通种族仍是「伙伴蛋」+「晶耀XX」
        if is_legendary(species):
            assert definition["stages"][0] == "传说之卵"
            assert definition["stages"][4].startswith("神话")
        else:
            assert definition["stages"][0] == "伙伴蛋"
            assert definition["stages"][4].startswith("晶耀")
        assert get_pet_stage_name(species, 4) == definition["stages"][4]
        assert get_pet_type(species) == get_pet_element(species)


def test_legendary_tiers_and_word_requirements():
    assert {"baize", "thunderkui", "vermilion", "kun"} <= LEGENDARY_SPECIES
    assert {"jaderabbit", "ninecolordeer", "yinglong", "qilin"} <= LEGENDARY_SPECIES
    assert {"bifang", "xiezhi", "chongming", "zheng"} <= LEGENDARY_SPECIES
    assert {"whitetiger", "azuredragon", "blacktortoise", "ninetailfox"} <= LEGENDARY_SPECIES
    assert len(LEGENDARY_SPECIES) == 16

    assert words_required_for("baize") == SEMI_LEGEND_WORDS == 5000
    assert words_required_for("jaderabbit") == LEGEND_WORDS == 8000
    # 普通种族没有学词门槛，只受队伍格约束
    assert words_required_for("sparkhog") == 0
    assert not is_legendary("sparkhog")

    # 传说不进 AI 对手池：随手一场练习赛就撞见麒麟会让门槛失去意义
    assert not (LEGENDARY_SPECIES & set(AI_PET_SPECIES))
    assert len(AI_PET_SPECIES) == len(PET_SPECIES) - len(LEGENDARY_SPECIES)


def test_legend_slots_are_separate_from_normal_slots():
    assert legend_slots_for_words(0) == 0
    assert legend_slots_for_words(4999) == 0
    assert legend_slots_for_words(5000) == 1
    assert legend_slots_for_words(7999) == 1
    assert legend_slots_for_words(8000) == 2
    assert legend_slots_for_words(99999) == MAX_LEGEND_SLOTS == 2

    assert next_legend_slot_threshold(0) == 5000
    assert next_legend_slot_threshold(5000) == 8000
    assert next_legend_slot_threshold(8000) is None

    # 关键性质：普通 5 格开满时传说格照样独立可开，反之亦然（否则解锁等于白给）
    assert pet_slots_for_words(8000) == 5 and legend_slots_for_words(8000) == 2
    assert pet_slots_for_words(5000) == 3 and legend_slots_for_words(5000) == 1


def test_rarity_grants_real_combat_advantage():
    """稀有度必须换来真实战力,且严格递增:普通 < 准传说 < 顶级传说。

    孩子攢 5000/8000 词换来的传说如果和普通一样强,门槛就只是收集门票。
    """
    normal = tier_power_bonus("sparkhog")
    semi = tier_power_bonus("baize")
    legend = tier_power_bonus("jaderabbit")

    assert normal == {"damage": 0, "ultimate": 0, "hp": 0}
    for key in ("damage", "ultimate", "hp"):
        assert normal[key] < semi[key] < legend[key], key

    # 同等级同阶段下,传说的血量与大招都该高出来
    assert calculate_max_hp(10, 2, "jaderabbit") > calculate_max_hp(10, 2, "baize") > calculate_max_hp(10, 2, "sparkhog")
    assert calculate_ultimate_damage("jaderabbit", 2) > calculate_ultimate_damage("sparkhog", 2)

    # 但不能强到让答题失去意义:传说的平A加成要小于"三连击"带来的收益(3×5=15)
    assert legend["damage"] < 15

    # 不传 species 时保持原公式(既有调用点不会因为加参数而改变数值)
    assert calculate_max_hp(10, 2) == calculate_max_hp(10, 2, "sparkhog")


def test_every_element_has_its_own_ultimate_damage():
    """五个新属性此前不在大招表里,全走 40 兜底 —— 补齐后不该再有并列兜底。"""
    for element_species in ("snowleopard", "shadowcat", "digmole", "dartfrog", "swallow", "ironrhino"):
        # 兜底值是 40,补齐后这些属性都应有自己的值
        assert calculate_ultimate_damage(element_species, 0) != 40


def test_new_normal_families_cover_previously_empty_types():
    # 冰/恶/地面/毒/飞行 此前一只都没有，TYPE_CHART 里那几行等于摆设
    elements = {get_pet_element(species) for species in PET_SPECIES if not is_legendary(species)}
    assert {"ice", "dark", "ground", "poison", "flying"} <= elements


def test_new_families_are_available_to_ai_and_battle():
    new_families = {
        "lotuscalf", "flamepanda", "otterwave", "chameleaf", "sunrooster", "mudhippo",
        "cloudkite", "clockbot", "dunewhale", "bambooweasel", "lavaboar", "shellpenguin", "acornsquirrel",
        "firetanuki", "jellyfish",
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


# ---------------------------------------------------------------- 2026-11-04 换成原创伙伴

def test_legacy_species_map_covers_every_replaced_family_one_to_one():
    """旧 id 一格对一格换成新 id: 每个旧 id 都有去处、不重名、去的地方真存在,
    元素和稀有度一点不变(孩子的宠物换完对战强弱不能变)。"""
    import re
    from pathlib import Path

    from app.core.pet_species import LEGACY_SPECIES, PET_SPECIES, normalize_species
    assert len(LEGACY_SPECIES) == 67
    assert len(set(LEGACY_SPECIES.values())) == len(LEGACY_SPECIES)
    assert set(LEGACY_SPECIES.values()) <= set(PET_SPECIES)
    assert not set(LEGACY_SPECIES) & set(PET_SPECIES), "旧 id 不能还留在注册表里"
    assert normalize_species("pikachu") == "sparkhog"
    assert normalize_species("book_fox") == "book_fox"

    # 元素 / 稀有度沿用旧那一格: 用设计表 + git 里旧注册表对不上会直接失败太重,这里锁住几只有代表性的
    expect = {"pikachu": ("electric", "normal"), "mewtwo": ("psychic", "legend"),
              "articuno": ("ice", "semi_legend"), "deino": ("dark", "normal"), "arceus": ("normal", "legend")}
    for old, (element, tier) in expect.items():
        new = PET_SPECIES[LEGACY_SPECIES[old]]
        assert (new["element"], new["tier"]) == (element, tier), old

    # 前端那份对照表必须和后端一模一样(没刷新的旧页面靠它显示)
    ts = (Path(__file__).resolve().parents[2] / "frontend/src/config/petSpecies.ts").read_text(encoding="utf-8")
    block = ts[ts.index("export const LEGACY_SPECIES"):]
    block = block[: block.index("};")]
    assert dict(re.findall(r"^  (\w+): '(\w+)',?$", block, re.M)) == LEGACY_SPECIES
    assert "export const DEFAULT_SPECIES = 'sparkhog';" in ts


def test_no_pokemon_names_left_in_user_facing_registry():
    from app.core.pet_species import PET_SPECIES
    banned = ("皮卡丘", "伊布", "妙蛙", "小火龙", "杰尼龟", "胖丁", "耿鬼", "快龙", "超梦", "梦幻",
              "急冻鸟", "闪电鸟", "火焰鸟", "水君", "烈空坐", "阿尔宙斯", "卡比兽", "路卡利欧")
    text = repr(PET_SPECIES)
    assert not [b for b in banned if b in text]


@pytest.mark.asyncio
async def test_migrate_legacy_species_rewrites_rows_once(tmp_path):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.pet_species import migrate_legacy_species

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'm.db'}")
    async with engine.begin() as conn:
        await conn.execute(text("CREATE TABLE user_pets (id INTEGER PRIMARY KEY, species VARCHAR(32))"))
        await conn.execute(text(
            "INSERT INTO user_pets (species) VALUES ('pikachu'), ('mewtwo'), ('book_fox'), ('sparkhog')"))
    assert await migrate_legacy_species(engine) == 2
    assert await migrate_legacy_species(engine) == 0          # 幂等
    async with engine.connect() as conn:
        rows = [r[0] for r in (await conn.execute(text("SELECT species FROM user_pets ORDER BY id"))).all()]
    assert rows == ["sparkhog", "ninecolordeer", "book_fox", "sparkhog"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_migrate_legacy_species_without_table_is_noop(tmp_path):
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.pet_species import migrate_legacy_species
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}")
    assert await migrate_legacy_species(engine) == 0
    await engine.dispose()


def test_second_batch_matches_design_table_and_fills_thin_elements():
    """第二批(2026-11-05)注册表与设计表一致;第一批只有 1 个家族的属性至少补到 4 个。"""
    import collections
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from pet_original_designs import NEW_DESIGNS

    for d in NEW_DESIGNS:
        got = PET_SPECIES[d["id"]]
        assert got["element"] == d["element"], d["id"]
        assert got["tier"] == d.get("tier", "normal"), d["id"]
        assert got["stages"][1:4] == tuple(d["names"]), d["id"]
    normal = collections.Counter(v["element"] for v in PET_SPECIES.values() if v["tier"] == "normal")
    for element in ("ice", "dark", "ghost", "fairy"):
        assert normal[element] >= 4, element
