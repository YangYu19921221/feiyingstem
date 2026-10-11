"""句子背诵学习流程的服务端口径(2026-10-11)。

前端只负责走流程和判对错;下面三件事放服务端,是因为以后作业 / 复习也要用同一份:
1. 分组(split_groups): 对话一问一答不拆开、按句长决定一组几句
2. 关键词(key_word): 过关检测「关键词填空」挖哪个词
3. 记一次作答(apply_answer): 计数 + 掌握度 + 记忆曲线,阶梯与间隔复用 services/mastery
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sentence import Sentence, SentenceBook, SentenceUnit
from app.models.sentence_learning import SentenceMastery
from app.models.user import User
from app.services.mastery import _advance_srs, level_for

# ---------- 分组 ----------
# 一组的「词数预算」与句数上限: 生产 288 句平均 4.8 词,七成 <= 5 词。
# 预算 28 词 ≈ 短句 6 句 / 中句 4 句 / 长句 3 句,每组用时差不多
GROUP_WORD_BUDGET = 28
GROUP_MAX_SENTENCES = 6
GROUP_MIN_SENTENCES = 2       # 最后一组少于这个数就并进上一组(只剩 1 句单独成组没意义)

_DIALOGUE_RE = re.compile(r"^\s*[—\-–]+\s*")


def is_dialogue_line(english: str) -> bool:
    """以破折号开头 = 对话里的一行(生产 288 句里 86 句)"""
    return bool(_DIALOGUE_RE.match(english or ""))


def word_count(english: str) -> int:
    return len([w for w in re.split(r"\s+", _DIALOGUE_RE.sub("", english or "").strip()) if w])


def _blocks(sentences: list[Sentence]) -> list[list[Sentence]]:
    """连续的对话行并成一块(一问一答一起练),其余一句一块"""
    blocks: list[list[Sentence]] = []
    for s in sentences:
        if is_dialogue_line(s.english) and blocks and is_dialogue_line(blocks[-1][-1].english) \
                and len(blocks[-1]) < 4:
            blocks[-1].append(s)
        else:
            blocks.append([s])
    return blocks


def split_groups(sentences: list[Sentence]) -> list[list[Sentence]]:
    groups: list[list[Sentence]] = []
    cur: list[Sentence] = []
    cur_words = 0
    for block in _blocks(sentences):
        bw = sum(word_count(s.english) for s in block)
        if cur and (cur_words + bw > GROUP_WORD_BUDGET or len(cur) + len(block) > GROUP_MAX_SENTENCES):
            groups.append(cur)
            cur, cur_words = [], 0
        cur.extend(block)
        cur_words += bw
    if cur:
        groups.append(cur)
    if len(groups) >= 2 and len(groups[-1]) < GROUP_MIN_SENTENCES:
        groups[-2].extend(groups.pop())
    return groups


# ---------- 关键词 ----------
# 挖空时不挖这些(挖了 is / the 等于没考);缩写整体也不挖(It's 挖掉孩子不知道填 it's 还是 it is)
_STOPWORDS = set("""
a an the is am are was were be been being do does did i you he she it we they me him her us them
my your his its our their this that these those there here and or but so to of in on at for with
from by up as not no yes oh ok okay what who whom whose which when where why how can could will
would shall should may might must have has had let lets mr mrs ms miss
""".split())
_TOKEN_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")


# 招呼语/感叹词: 生产三上第 1 单元首句挖出 Hello、Thanks,考了等于白考
_STOPWORDS |= set("hello hi hey thanks thank bye goodbye sorry please oops wow".split())
# 句首以外的大写词 = 人名/地名(生产实测挖出过 Binbin、Sarah、Chen),不挖
_SENT_START_RE = re.compile(r"(^|[.!?]\s*[\"“”']?\s*)$")


def key_word(english: str) -> Optional[str]:
    """句子里最值得考的那个词: 去掉功能词、缩写、人名后取最长的(并列取靠前的)。没有就 None"""
    text = _DIALOGUE_RE.sub("", english or "")
    best: Optional[str] = None
    for m in _TOKEN_RE.finditer(text):
        tok = m.group(0)
        if "'" in tok or tok.lower() in _STOPWORDS or len(tok) < 3:
            continue
        if tok[0].isupper() and not _SENT_START_RE.search(text[:m.start()]):
            continue
        if best is None or len(tok) > len(best):
            best = tok
    return best


# ---------- 可见性 ----------

async def visible_unit(db: AsyncSession, unit_id: int, user: User) -> tuple[SentenceUnit, SentenceBook]:
    """学生只能学本机构或平台共享、且公开的句子集。显式写过滤,别押在隐式租户过滤器上
    (conftest 不注册它;后台任务/脚本也是裸查询)"""
    row = (await db.execute(
        select(SentenceUnit, SentenceBook)
        .join(SentenceBook, SentenceBook.id == SentenceUnit.book_id)
        .where(SentenceUnit.id == unit_id)
        .execution_options(skip_tenant_filter=True)
    )).first()
    if row is None:
        raise HTTPException(404, "单元不存在")
    unit, book = row
    if user.role != "admin":
        if book.org_id is not None and book.org_id != user.org_id:
            raise HTTPException(404, "单元不存在")
        if user.role == "student" and not book.is_public:
            raise HTTPException(404, "单元不存在")
    return unit, book


def book_visible_clause(user: User):
    """列表查询用的同口径条件"""
    if user.role == "admin":
        return None
    return or_(SentenceBook.org_id.is_(None), SentenceBook.org_id == user.org_id)


# ---------- 记一次作答 ----------
# 计入掌握度的阶段。开口背不判对错(不用语音识别),不进这里
SCORED_STAGES = ("arrange", "dictation", "exam")


async def apply_answer(
    db: AsyncSession, user_id: int, sentence_id: int, stage: str, is_correct: bool,
    answer: Optional[str] = None,
) -> SentenceMastery:
    """一句的首答。**只有过关检测推进记忆曲线**: 一次学习里连词/默写/检测各答一遍,
    三遍都推进的话一节课就把复习间隔顶到 12 小时,第二天的复习排不上"""
    await db.execute(
        sqlite_insert(SentenceMastery.__table__).values(
            user_id=user_id, sentence_id=sentence_id, total_encounters=0, correct_count=0,
            wrong_count=0, mastery_level=0, review_stage=0,
        ).on_conflict_do_nothing(index_elements=["user_id", "sentence_id"])
    )
    m = (await db.execute(select(SentenceMastery).where(and_(
        SentenceMastery.user_id == user_id, SentenceMastery.sentence_id == sentence_id,
    )))).scalars().first()
    m.total_encounters = (m.total_encounters or 0) + 1
    if is_correct:
        m.correct_count = (m.correct_count or 0) + 1
    else:
        m.wrong_count = (m.wrong_count or 0) + 1
        if answer:
            m.last_wrong_answer = answer[:500]
    m.mastery_level = level_for(m.correct_count, m.total_encounters)
    m.last_practiced_at = datetime.utcnow()
    if stage == "exam":
        _advance_srs(m, is_correct)
    return m
