"""Pet species metadata shared by adoption, evolution and battle services."""


def _species(label: str, element: str, base: str, middle: str, final: str):
    return {
        "label": label,
        "element": element,
        "stages": ("伙伴蛋", base, middle, final, f"晶耀{final}"),
    }


PET_SPECIES = {
    "pikachu": _species("皮卡丘家族", "electric", "皮丘", "皮卡丘", "雷丘"),
    "eevee": _species("伊布", "normal", "伊布", "成长伊布", "羁绊伊布"),
    "bulbasaur": _species("妙蛙种子家族", "grass", "妙蛙种子", "妙蛙草", "妙蛙花"),
    "charmander": _species("小火龙家族", "fire", "小火龙", "火恐龙", "喷火龙"),
    "squirtle": _species("杰尼龟家族", "water", "杰尼龟", "卡咪龟", "水箭龟"),
    "jigglypuff": _species("胖丁家族", "fairy", "胖丁", "成长胖丁", "胖可丁"),
    "gastly": _species("鬼斯家族", "ghost", "鬼斯", "鬼斯通", "耿鬼"),
    "dratini": _species("迷你龙家族", "dragon", "迷你龙", "哈克龙", "快龙"),
    "machop": _species("腕力家族", "fighting", "腕力", "豪力", "怪力"),
    "abra": _species("凯西家族", "psychic", "凯西", "勇基拉", "胡地"),
    "geodude": _species("小拳石家族", "rock", "小拳石", "隆隆石", "隆隆岩"),
    "vulpix": _species("六尾家族", "fire", "六尾", "成长六尾", "九尾"),
    "growlithe": _species("卡蒂狗家族", "fire", "卡蒂狗", "成长卡蒂狗", "风速狗"),
    "magikarp": _species("鲤鱼王家族", "water", "鲤鱼王", "跃动鲤鱼王", "暴鲤龙"),
    "oddish": _species("走路草家族", "grass", "走路草", "臭臭花", "霸王花"),
    "poliwag": _species("蚊香蝌蚪家族", "water", "蚊香蝌蚪", "蚊香君", "蚊香泳士"),
    "caterpie": _species("绿毛虫家族", "bug", "绿毛虫", "铁甲蛹", "巴大蝶"),
    "weedle": _species("独角虫家族", "bug", "独角虫", "铁壳蛹", "大针蜂"),
    "bellsprout": _species("喇叭芽家族", "grass", "喇叭芽", "口呆花", "大食花"),
    "horsea": _species("墨海马家族", "water", "墨海马", "海刺龙", "刺龙王"),
    "larvitar": _species("幼基拉斯家族", "rock", "幼基拉斯", "沙基拉斯", "班基拉斯"),
    "ralts": _species("拉鲁拉丝家族", "psychic", "拉鲁拉丝", "奇鲁莉安", "沙奈朵"),
    "chikorita": _species("菊草叶家族", "grass", "菊草叶", "月桂叶", "大竺葵"),
    "cyndaquil": _species("火球鼠家族", "fire", "火球鼠", "火岩鼠", "火暴兽"),
    "totodile": _species("小锯鳄家族", "water", "小锯鳄", "蓝鳄", "大力鳄"),
    "treecko": _species("木守宫家族", "grass", "木守宫", "森林蜥蜴", "蜥蜴王"),
    "torchic": _species("火稚鸡家族", "fire", "火稚鸡", "力壮鸡", "火焰鸡"),
    "mudkip": _species("水跃鱼家族", "water", "水跃鱼", "沼跃鱼", "巨沼怪"),
    "bagon": _species("宝贝龙家族", "dragon", "宝贝龙", "甲壳龙", "暴飞龙"),
    "beldum": _species("铁哑铃家族", "steel", "铁哑铃", "金属怪", "巨金怪"),
    "gible": _species("圆陆鲨家族", "dragon", "圆陆鲨", "尖牙陆鲨", "烈咬陆鲨"),
    "snivy": _species("藤藤蛇家族", "grass", "藤藤蛇", "青藤蛇", "君主蛇"),
    "tepig": _species("暖暖猪家族", "fire", "暖暖猪", "炒炒猪", "炎武王"),
    "oshawott": _species("水水獭家族", "water", "水水獭", "双刃丸", "大剑鬼"),
    "rowlet": _species("木木枭家族", "grass", "木木枭", "投羽枭", "狙射树枭"),
    "litten": _species("火斑喵家族", "fire", "火斑喵", "炎热喵", "炽焰咆哮虎"),
    "popplio": _species("球球海狮家族", "water", "球球海狮", "花漾海狮", "西狮海壬"),
    "book_fox": _species("书狐", "normal", "书页幼狐", "博闻书狐", "贤者书狐"),
    "paper_owl": _species("文鸮", "psychic", "折纸雏鸮", "学者文鸮", "博士文鸮"),
    "word_turtle": _species("词龟", "water", "字芽小龟", "词纹灵龟", "典藏圣龟"),
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

