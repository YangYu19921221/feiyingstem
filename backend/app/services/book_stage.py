"""单词本「学段」归类 —— 发码/选书场景的唯一真源。

## 为什么需要这个模块

学段(小学/初中/高中)在本项目里**从来没有被存储过**,它是从 `word_books.grade_level`
推导出来的,而那一列存的是**年级名**(三年级/七年级/高一),不是学段。
2026-08-29 清点生产数据时确认,推导规则在代码里有三份且互不一致:

- `services/pk/score.py:grade_level_to_tier` —— 计分用,未知值兜底成 primary
- `frontend/.../TeacherBooks.tsx:stageOf` —— 列表分组显示用,未知值自成一组
- `services/image_service.py:_style_for_grade` —— 选 AI 封面画风用,第三套子串判断

本模块只服务「按学段发兑换码 / 按学段选书」这一件事,**不去动那三处**:
pk 那份已退出计分链路且 fallback 语义有其道理,image 那份只影响画风,
前端那份做的是显示分组(语义确实不同)。硬把它们合并会牵动 PK 和出图,
收益不抵风险。要合并也应另起一次改动、单独验证。

## 与 pk/score.py 的关键差异:未知值归 other 而不是 primary

发码场景下把未知值当小学是**错的**:生产库里 27 本书无法归入三段
(飞鹰校本教材 7 本——它已发 534 张码是主力、大学 7 本、grade_level 为空 13 本)。
若兜底成 primary,运营发一张「小学卡」会连带把大学教材开出去。
所以这里多一档 `other`,并且**它是可以正常发码的**(运营需要给飞鹰教材发卡)。

⚠️ 判断顺序有讲究:必须先判初中/高中再落小学。"高一"含"一"、
"七年级"含"年级",按小学的宽松规则先匹配会误判。
"""
from typing import Iterable, Optional

STAGE_PRIMARY = "primary"
STAGE_JUNIOR = "junior"
STAGE_SENIOR = "senior"
STAGE_OTHER = "other"

# 发码表单里的档位顺序(小学→初中→高中→其他)
STAGE_ORDER: tuple[str, ...] = (STAGE_PRIMARY, STAGE_JUNIOR, STAGE_SENIOR, STAGE_OTHER)

STAGE_LABELS: dict[str, str] = {
    STAGE_PRIMARY: "小学",
    STAGE_JUNIOR: "初中",
    STAGE_SENIOR: "高中",
    STAGE_OTHER: "其他",
}

# 小学:一~六年级。用集合而非"含'年级'"的宽松判断,
# 否则"七年级"也会命中(实测生产有三~六与七~九并存)
_PRIMARY_GRADES = frozenset({
    "一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
})
_JUNIOR_GRADES = frozenset({"七年级", "八年级", "九年级", "初一", "初二", "初三"})
_SENIOR_GRADES = frozenset({"高一", "高二", "高三"})


def stage_of(grade_level: Optional[str]) -> str:
    """`word_books.grade_level` → 学段。无法归类(含空值)一律 other,不兜底成小学。"""
    if not grade_level:
        return STAGE_OTHER
    g = grade_level.strip()
    if not g:
        return STAGE_OTHER
    # 先精确匹配年级名
    if g in _JUNIOR_GRADES:
        return STAGE_JUNIOR
    if g in _SENIOR_GRADES:
        return STAGE_SENIOR
    if g in _PRIMARY_GRADES:
        return STAGE_PRIMARY
    # 再匹配直接写学段名的(生产有 6 本这样写:"小学"/"初中"/"高中")
    # 顺序:初中/高中在前,避免"高中"被别的规则抢走
    if "初中" in g:
        return STAGE_JUNIOR
    if "高中" in g:
        return STAGE_SENIOR
    if "小学" in g:
        return STAGE_PRIMARY
    # 飞鹰(校本教材)、大学、以及任何将来出现的自定义值
    return STAGE_OTHER


def stage_label(stage: str) -> str:
    return STAGE_LABELS.get(stage, STAGE_LABELS[STAGE_OTHER])


async def resolve_stage_id(db, grade_level: Optional[str]) -> Optional[int]:
    """年级 → 平台预置学段的 id。认不出返回 None(= 未分类)。

    ## 为什么需要它(2026-09-11)

    学段改成真字段后,**新建/导入单词本时若只填年级、不选学段,书会落进「未分类」**。
    这是个真的行为回退: 改造前填「三年级」就自动出现在小学分组里,改造后要多点一次
    学段才行 —— 老师十有八九不会点,几个月后「未分类」堆成第一大组。
    (这个回退是 tests/test_redemption_multi_book_http.py 抓出来的: 它建了带
     grade_level 却没 stage_id 的书,期望在 primary 档下,结果 StopIteration。)

    所以建书/导入时用这个函数补默认值: **年级能推出学段就自动填上**,
    老师仍可随时改成别的学段或清空。只在 stage_id 没显式传时兜底,
    显式选了(包括显式选「未分类」)一律尊重用户的选择。

    只映射到**平台预置**的三档(org_id IS NULL 且 code 匹配) —— 机构自建的
    「大学」「成人」没有年级可推,本来就该手动选。
    """
    from sqlalchemy import select
    from app.models.word import BookStage

    code = stage_of(grade_level)
    if code == STAGE_OTHER:
        return None
    # 显式限定平台预置档: 机构若自建了同 code 的档(理论上不该发生,create 时 code 强制留空),
    # 也不能让它抢掉预置档的位置
    return (await db.execute(
        select(BookStage.id).where(
            BookStage.code == code, BookStage.org_id.is_(None)
        ).limit(1)
    )).scalar_one_or_none()


def group_books_by_stage(books: Iterable) -> dict[str, list]:
    """把书按学段分桶 → {stage: [book, ...]}。

    入参是任何带 `grade_level` 属性的对象(ORM 行或轻量壳),
    返回只含**非空**的档,顺序按 STAGE_ORDER。
    """
    buckets: dict[str, list] = {}
    for b in books:
        buckets.setdefault(stage_of(getattr(b, "grade_level", None)), []).append(b)
    return {s: buckets[s] for s in STAGE_ORDER if s in buckets}
