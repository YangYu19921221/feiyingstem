"""小鹰老师按孩子的年级和接受程度调整讲法(2026-10-27,用户「学生问问题是不是要知道孩子是几年级的
小学是不是要讲的更简单举例之类的…孩子智商不一样理解能力也不一样你都要考虑怎么设计比较好」)

## 年级(决定基本讲法)
先看设置(老师或孩子自己设的,后设的为准),没设就按孩子最近在学的、标了年级的书推断(生产 10-27:
近 90 天学过的 479 人里 436 人最近那本书有年级)。推不出来按小学高年级讲 —— 宁可讲浅不讲深。
分四档: 一到三年级 / 四到六年级 / 初中 / 高中,每档的讲法写在 BAND_STYLE。

## 接受程度(在年级的基础上再调一档)
**不给孩子贴「聪明 / 笨」的标签**,只有一个「讲解方式」: 讲简单一点 / 正常 / 讲深一点,默认「自动」:
- 最近 30 天的提问里说过「听不懂 / 讲简单点 / 还是不会」几次、说过「太简单 / 我会了」几次
- 小鹰老师最近出的练习(tutor_quizzes,最多 10 份,至少 6 道题才算)第一次交的对了几成
两个信号加起来,在 -1 / 0 / +1 里取,所以最多比年级的基本讲法简单一档或深一档。
孩子自己选了、或老师替他选了,就按选的,不再自动调。
**同一段对话里**小鹰老师自己看反应随时调(提示词 RULES 第 12 条),这里管的是换一段对话以后还记得。

## 只发学习相关的东西
进提示词的只有年级、讲法要求和调整的原因,没有姓名学校。
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.learning import LearningProgress
from app.models.tutor import TutorMessage, TutorPref, TutorQuiz
from app.models.user import User
from app.models.word import BookStage, WordBook

GRADE_OPTIONS = ("一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
                 "初一", "初二", "初三", "高一", "高二", "高三")
_GRADE_ALIASES = {"七年级": "初一", "八年级": "初二", "九年级": "初三"}

BANDS = ("p_low", "p_high", "junior", "senior")
BAND_LABELS = {"p_low": "一到三年级", "p_high": "四到六年级", "junior": "初中", "senior": "高中"}
BAND_STYLE = {
    "p_low": ("一到三年级的孩子: 每句话尽量短,15 个字以内;不用语法术语,用大白话说(不说「第三人称单数」,"
              "说「说他、她、它做事的时候」);每个英文单词、例句后面都带中文;例子用小动物、玩具、吃的、家里的事;"
              "一次只讲一件事,讲完马上让他试;出题只出 1–2 道最简单的。"),
    "p_high": ("四到六年级的孩子: 话短、口语;尽量不用语法术语,要用就马上用大白话再说一遍;例句短,带中文;"
               "例子用学校、家里、朋友的事;一次讲一个点;出题 2–3 道,由易到难。"),
    "junior": ("初中生: 可以用主语、谓语、宾语、时态、第三人称单数这些常用术语,第一次出现时顺带一句解释;"
               "例子贴近初中课本和中考题型;可以把两个有关系的点放在一起比较;出题可以有一道稍难的。"),
    "senior": ("高中生: 可以直接用语法术语,讲得精炼,多讲为什么、和容易混的点比较;"
               "例句可以长一点,贴近高考题型;出题可以有综合一点的。"),
}

# 讲解方式: -1 讲简单一点 / 0 正常 / +1 讲深一点。前端和接口用字符串
PACES = {"simple": -1, "normal": 0, "deep": 1}
PACE_KEYS = {v: k for k, v in PACES.items()}
PACE_LABELS = {-1: "讲简单一点", 0: "正常", 1: "讲深一点"}
PACE_TEXT = {
    -1: ("这个孩子现在需要讲得更简单: 比上面再慢一步,一句话只说一件事,多用他熟悉的例子,"
         "每讲一步问一句懂了没有,他答对了就具体地夸。"),
    1: "这个孩子接受得快: 少铺垫,讲清要点就让他练,做对了可以加一点拓展或稍难一点的题。",
}

# 自动判断用的话(孩子在聊天里说的)。快捷回复「还是不会,讲给我听」「讲简单一点」也算
CONFUSED = re.compile(r"听不懂|没听懂|没懂|不明白|看不懂|不理解|太难|讲简单|简单点|简单一点|讲慢|慢一点|还是不会")
EASY = re.compile(r"太简单|我会了|我知道了|早就会|讲快|快一点|讲深|深一点|说重点|太啰嗦")
SIGNAL_DAYS = 30
SIGNAL_MESSAGES = 40
SIGNAL_MIN = 3          # 至少说过几次才算数
QUIZ_RECENT = 10
QUIZ_MIN_ITEMS = 6
QUIZ_LOW = 0.5
QUIZ_HIGH = 0.85


def normalize_grade(raw: Optional[str]) -> Optional[str]:
    """书上的年级名 / 孩子选的年级 → GRADE_OPTIONS 里的一项;认不出(含「小学」这种只有学段的)返回 None"""
    g = (raw or "").strip()
    g = _GRADE_ALIASES.get(g, g)
    return g if g in GRADE_OPTIONS else None


def band_of_grade(grade: Optional[str]) -> Optional[str]:
    if grade is None:
        return None
    i = GRADE_OPTIONS.index(grade)
    return "p_low" if i < 3 else "p_high" if i < 6 else "junior" if i < 9 else "senior"


def band_of_stage(text: Optional[str]) -> Optional[str]:
    """只知道学段(书上写的「初中」或书的学段名)时用"""
    t = (text or "").strip()
    if "初中" in t:
        return "junior"
    if "高中" in t:
        return "senior"
    if "小学" in t:
        return "p_high"
    return None


async def _book_guess(db: AsyncSession, user_id: int) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(年级, 推断它的那本书, 只有学段时的档) —— 按最近学的书,第一本能认出年级的为准"""
    rows = (await db.execute(
        select(WordBook.name, WordBook.grade_level, BookStage.name)
        .select_from(LearningProgress)
        .join(WordBook, WordBook.id == LearningProgress.book_id)
        .outerjoin(BookStage, BookStage.id == WordBook.stage_id)
        .where(LearningProgress.user_id == user_id)
        .order_by(LearningProgress.last_studied_at.desc().nullslast(), LearningProgress.id.desc())
        .limit(12)
    )).all()
    band_only: Optional[str] = None
    for name, grade_level, stage in rows:
        g = normalize_grade(grade_level)
        if g:
            return g, name, None
        band_only = band_only or band_of_stage(grade_level) or band_of_stage(stage)
    return None, None, band_only


async def auto_pace(db: AsyncSession, user_id: int) -> tuple[int, list[str]]:
    """按最近的表现算讲解方式(-1 / 0 / +1)和原因(给老师看)"""
    since = utc_now() - timedelta(days=SIGNAL_DAYS)
    texts = (await db.execute(
        select(TutorMessage.text)
        .where(TutorMessage.user_id == user_id, TutorMessage.role == "user", TutorMessage.created_at >= since)
        .order_by(TutorMessage.id.desc()).limit(SIGNAL_MESSAGES)
    )).scalars().all()
    confused = sum(1 for t in texts if t and CONFUSED.search(t))
    easy = sum(1 for t in texts if t and EASY.search(t))
    quizzes = (await db.execute(
        select(TutorQuiz.score, TutorQuiz.total)
        .where(TutorQuiz.user_id == user_id, TutorQuiz.submitted_at.isnot(None))
        .order_by(TutorQuiz.id.desc()).limit(QUIZ_RECENT)
    )).all()
    q_total = sum(int(t or 0) for _, t in quizzes)
    q_right = sum(int(s or 0) for s, _ in quizzes)

    score = 0
    reasons: list[str] = []
    if q_total >= QUIZ_MIN_ITEMS:
        rate = q_right / q_total
        if rate < QUIZ_LOW:
            score -= 1
            reasons.append(f"最近小鹰老师出的练习对了 {q_right}/{q_total}")
        elif rate >= QUIZ_HIGH:
            score += 1
            reasons.append(f"最近小鹰老师出的练习对了 {q_right}/{q_total}")
    if confused >= SIGNAL_MIN and confused >= 2 * easy:
        score -= 1
        reasons.append(f"近 {SIGNAL_DAYS} 天说过 {confused} 次听不懂 / 讲简单点")
    elif easy >= SIGNAL_MIN and easy >= 2 * confused:
        score += 1
        reasons.append(f"近 {SIGNAL_DAYS} 天说过 {easy} 次太简单 / 我会了")
    return max(-1, min(1, score)), reasons


async def level_info(db: AsyncSession, user: User) -> dict:
    """这个孩子现在按什么讲。学生页、老师页、提示词都读这一份"""
    pref = await db.get(TutorPref, user.id)
    grade = normalize_grade(pref.grade) if pref and pref.grade else None
    grade_source = (pref.grade_by or "student") if grade else None
    book = None
    band = band_of_grade(grade)
    if grade is None:
        guess, book, band_only = await _book_guess(db, user.id)
        if guess:
            grade, grade_source, band = guess, "book", band_of_grade(guess)
        else:
            band = band_only
    if band is None:
        band, grade_source = "p_high", grade_source or "none"
    auto, reasons = await auto_pace(db, user.id)
    chosen = pref.pace if pref is not None and pref.pace in PACE_LABELS else None
    pace = auto if chosen is None else chosen
    return {
        "grade": grade, "grade_source": grade_source or "none", "book": book,
        "band": band, "band_label": BAND_LABELS[band],
        "pace": PACE_KEYS[pace], "pace_label": PACE_LABELS[pace],
        "pace_mode": "auto" if chosen is None else (pref.pace_by or "student"),
        "auto_pace": PACE_KEYS[auto], "auto_label": PACE_LABELS[auto], "auto_reasons": reasons,
        "grade_options": list(GRADE_OPTIONS),
    }


def context_lines(info: dict) -> list[str]:
    """进系统提示的「讲解方式」那一段"""
    if info["grade"]:
        g = info["grade"] + ("(按他在学的书推断,可能不准)" if info["grade_source"] == "book" else "")
    else:
        g = f"不知道,先按{info['band_label']}讲"
    lines = ["讲解方式(照这个调整说法和出题难度,不要跟他说你在按年级或水平调整):",
             f"- 年级: {g}",
             f"- {BAND_STYLE[info['band']]}"]
    pace = PACES[info["pace"]]
    if pace:
        why = "他自己选的" if info["pace_mode"] == "student" else "老师替他选的" if info["pace_mode"] == "teacher" \
            else "按他最近的表现"
        lines.append(f"- {PACE_TEXT[pace]}({why})")
    return lines


async def save_prefs(db: AsyncSession, user_id: int, fields: dict, by: str) -> None:
    """只改传了的字段: grade 传 None / 空串 = 清掉(改回按书推断);pace 传 'auto' = 改回自动"""
    row = await db.get(TutorPref, user_id)
    if row is None:
        await db.execute(sqlite_insert(TutorPref).values(user_id=user_id, updated_at=utc_now())
                         .on_conflict_do_nothing(index_elements=[TutorPref.user_id]))
        row = await db.get(TutorPref, user_id)
    if "grade" in fields:
        g = normalize_grade(fields["grade"]) if fields["grade"] else None
        if fields["grade"] and g is None:
            raise ValueError("年级不对")
        row.grade, row.grade_by = g, (by if g else None)
    if "pace" in fields:
        p = fields["pace"] or "auto"
        if p != "auto" and p not in PACES:
            raise ValueError("讲解方式不对")
        row.pace, row.pace_by = (None, None) if p == "auto" else (PACES[p], by)
    row.updated_at = utc_now()
    await db.commit()
