"""Pet species metadata shared by adoption, evolution and battle services."""

PET_SPECIES = {
    "pikachu": {"label": "皮卡丘家族", "element": "electric", "stages": ("伙伴蛋", "皮丘", "皮卡丘", "雷丘")},
    "eevee": {"label": "伊布", "element": "normal", "stages": ("伙伴蛋", "伊布", "成长伊布", "羁绊伊布")},
    "bulbasaur": {"label": "妙蛙种子家族", "element": "grass", "stages": ("伙伴蛋", "妙蛙种子", "妙蛙草", "妙蛙花")},
    "charmander": {"label": "小火龙家族", "element": "fire", "stages": ("伙伴蛋", "小火龙", "火恐龙", "喷火龙")},
    "squirtle": {"label": "杰尼龟家族", "element": "water", "stages": ("伙伴蛋", "杰尼龟", "卡咪龟", "水箭龟")},
    "jigglypuff": {"label": "胖丁家族", "element": "fairy", "stages": ("伙伴蛋", "胖丁", "成长胖丁", "胖可丁")},
    "gastly": {"label": "鬼斯家族", "element": "ghost", "stages": ("伙伴蛋", "鬼斯", "鬼斯通", "耿鬼")},
    "dratini": {"label": "迷你龙家族", "element": "dragon", "stages": ("伙伴蛋", "迷你龙", "哈克龙", "快龙")},
    "machop": {"label": "腕力家族", "element": "fighting", "stages": ("伙伴蛋", "腕力", "豪力", "怪力")},
    "abra": {"label": "凯西家族", "element": "psychic", "stages": ("伙伴蛋", "凯西", "勇基拉", "胡地")},
    "geodude": {"label": "小拳石家族", "element": "rock", "stages": ("伙伴蛋", "小拳石", "隆隆石", "隆隆岩")},
    "vulpix": {"label": "六尾家族", "element": "fire", "stages": ("伙伴蛋", "六尾", "成长六尾", "九尾")},
    "growlithe": {"label": "卡蒂狗家族", "element": "fire", "stages": ("伙伴蛋", "卡蒂狗", "成长卡蒂狗", "风速狗")},
    "magikarp": {"label": "鲤鱼王家族", "element": "water", "stages": ("伙伴蛋", "鲤鱼王", "跃动鲤鱼王", "暴鲤龙")},
    "oddish": {"label": "走路草家族", "element": "grass", "stages": ("伙伴蛋", "走路草", "臭臭花", "霸王花")},
    "poliwag": {"label": "蚊香蝌蚪家族", "element": "water", "stages": ("伙伴蛋", "蚊香蝌蚪", "蚊香君", "蚊香泳士")},
    "caterpie": {"label": "绿毛虫家族", "element": "bug", "stages": ("伙伴蛋", "绿毛虫", "铁甲蛹", "巴大蝶")},
    "weedle": {"label": "独角虫家族", "element": "bug", "stages": ("伙伴蛋", "独角虫", "铁壳蛹", "大针蜂")},
    "bellsprout": {"label": "喇叭芽家族", "element": "grass", "stages": ("伙伴蛋", "喇叭芽", "口呆花", "大食花")},
    "horsea": {"label": "墨海马家族", "element": "water", "stages": ("伙伴蛋", "墨海马", "海刺龙", "刺龙王")},
    "larvitar": {"label": "幼基拉斯家族", "element": "rock", "stages": ("伙伴蛋", "幼基拉斯", "沙基拉斯", "班基拉斯")},
    "ralts": {"label": "拉鲁拉丝家族", "element": "psychic", "stages": ("伙伴蛋", "拉鲁拉丝", "奇鲁莉安", "沙奈朵")},
    "book_fox": {"label": "书狐", "element": "normal", "stages": ("伙伴蛋", "书页幼狐", "博闻书狐", "贤者书狐")},
    "paper_owl": {"label": "文鸮", "element": "psychic", "stages": ("伙伴蛋", "折纸雏鸮", "学者文鸮", "博士文鸮")},
    "word_turtle": {"label": "词龟", "element": "water", "stages": ("伙伴蛋", "字芽小龟", "词纹灵龟", "典藏圣龟")},
}

ALLOWED_PET_SPECIES = frozenset(PET_SPECIES)


def get_pet_stage_name(species: str, evolution_stage: int) -> str:
    definition = PET_SPECIES.get(species, PET_SPECIES["pikachu"])
    stages = definition["stages"]
    return stages[max(0, min(evolution_stage, len(stages) - 1))]


def get_pet_label(species: str) -> str:
    return PET_SPECIES.get(species, PET_SPECIES["pikachu"])["label"]


def get_pet_element(species: str) -> str:
    return PET_SPECIES.get(species, PET_SPECIES["pikachu"])["element"]

