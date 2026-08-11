"""宠物立绘的资产体检:文件在、能解码、每个形态有自己的图。

为什么要有这条测试:2026-08-11 发现线上 5 张立绘(卡蒂狗/哈克龙/妙蛙草/隆隆石/鬼斯通)
是**截断的 PNG** —— 文件在、能 ls、大小 38-40KB 看着正常,浏览器还能勉强渲染一部分,
但 Pillow 一 load 就抛 "image file is truncated"。没人守着,它们就一直裂在图鉴里。

同批还发现 5 处「进化了立绘却没变」:伊布三档共用一张图,胖丁/六尾/卡蒂狗/鲤鱼王的
「成长XX」档与基础档共用。孩子练到进化最想看的就是长大的样子,复用等于把奖励拿掉。

判损坏必须真解码(Image.load()),看文件大小或 os.path.exists 都会漏 —— 这是这次
漏到线上的直接原因。
"""
import json
import os
import re

import pytest

PETS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "public", "pets",
)
SPECIES_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "src", "config", "petSpecies.ts",
)


def _declared_forms() -> list[tuple[str, str]]:
    """从前端注册表里抠出 (形态名, 图片路径)。

    直接解析 TS 而不是维护一份 Python 副本:副本会漂移,而漂移了测试还照旧全绿。
    """
    with open(SPECIES_TS, encoding="utf-8") as fh:
        source = fh.read()
    return re.findall(r"\['([^']+)', '(/pets/[a-z0-9_]+\.png)'\]", source)


def test_every_declared_sprite_file_exists():
    missing = [
        (name, path) for name, path in _declared_forms()
        if not os.path.exists(os.path.join(PETS_DIR, os.path.basename(path)))
    ]
    assert not missing, f"注册表引用了不存在的立绘: {missing}"


def test_no_sprite_is_a_truncated_png():
    """每张图都要真能解码。截断的 PNG 只有 load() 抓得到。"""
    Image = pytest.importorskip("PIL.Image", reason="需要 Pillow 才能验图")
    broken = []
    for name in sorted(os.listdir(PETS_DIR)):
        if not name.endswith(".png"):
            continue
        path = os.path.join(PETS_DIR, name)
        try:
            with Image.open(path) as im:
                im.load()
        except Exception as exc:  # noqa: BLE001 - 任何解码失败都算坏图
            broken.append(f"{name}({type(exc).__name__})")
    assert not broken, f"这些立绘是坏的,需要重出: {broken}"


def test_back_sprite_exists_for_every_front_sprite():
    """对战里玩家侧用 back/ 翻转图,缺一张就是背对镜头的空白。

    只查注册表真正引用的图:pets/ 下有历史遗留的孤儿文件(pikachu_adult/pikachu_baby,
    全仓库零引用),为它们要求 back/ 图只会制造假警报。
    """
    back_dir = os.path.join(PETS_DIR, "back")
    used = {os.path.basename(path) for _, path in _declared_forms()}
    backs = {n for n in os.listdir(back_dir) if n.endswith(".png")}
    assert not (used - backs), f"缺少 back/ 翻转图: {sorted(used - backs)}"


def test_no_two_forms_of_the_same_family_share_one_sprite():
    """同一族的不同形态不能共用一张图 —— 进化了立绘不变会让养成失去意义。

    只禁「同族内」复用:第五档(晶耀/神话)复用最终形态的图是设计如此(靠光环特效区分),
    而基础档与成长档共用则是漏洞。所以这里比对的是注册表里出现的形态名,
    晶耀/神话档在 TS 里由 gemStage/mythicStage 生成、不走 ['名', '路径'] 字面量,
    天然不在本测试范围内。
    """
    by_image: dict[str, list[str]] = {}
    for name, path in _declared_forms():
        by_image.setdefault(path, []).append(name)
    shared = {img: names for img, names in by_image.items() if len(names) > 1}
    assert not shared, f"多个形态共用同一张立绘,进化后看不出变化: {shared}"
