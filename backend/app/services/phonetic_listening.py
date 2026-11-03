"""音标听力: 判分、可见性、完成判定(唯一真源)

规则(数据模型和用户原话见 models/phonetic_listening):
1. **一题两部分**: 写单词 + 写音标,**两个都对才算这题对**(用户 11-03 选的「单词和音标都写」)
2. 单词判法: 大小写、首尾空格、弯撇号不算错;别的一个字母不对就是错
3. 音标判法: 和音标教材同一个 _grade_one(重音符不算、第二遍只挖元音)
4. **两遍**: 第一遍错了不给答案,只告诉孩子单词对没对、音标哪几格错;第二遍单词照填(没对的话),
   音标只填元音格(辅音服务端回填)。第二遍判完 / 做对 / 点「看答案」= 这题结束,才下发正确答案
5. 题目列表**不下发**单词、音标、释义 —— 听力就是听出来写;只给提示(老师写的)和格子数
6. **一套听力归建它的老师所在机构**(set.org_id;平台 admin 建的是 NULL = 所有机构都能用)。
   挂在哪本音标教材下只是分组 —— 生产只有一本平台预置教材(org_id NULL),老师必须能往里加自己的听力。
   可见 = 教材可见(本机构的 + 平台预置的)**且** 这套是本机构的或平台的;改 / 删 / 录音只有本机构(平台 admin 全能改)
7. 作业完成: 作业开放后这一套每题都**结束过**(做对或判完第二遍或看答案)就算完成。
   只看做没做完,不看对几个 —— 和例句跟读同一个口径,对错留给老师在学情里看
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Iterable, List, Optional, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phonetic_listening import ListeningAttempt, ListeningItem, ListeningSet
from app.models.phonetic_practice import PhoneticBook

HINT_MAX = 40
ITEMS_MAX = 50
AUDIO_MAX = 2 * 1024 * 1024          # 一个词的录音 2MB 足够(手机录 5 秒 webm 约 50KB)
AUDIO_MIME = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav",
              "audio/x-wav", "audio/aac", "audio/x-m4a", "audio/m4a"}


def loads(raw: Optional[str], default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def norm_word(s: Optional[str]) -> str:
    """单词比对归一: 小写、去首尾空格、连续空白并成一个、弯撇号换直撇号、去掉句末标点"""
    t = (s or "").replace("’", "'").replace("‘", "'")
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t.strip(".,!?;:")


def clean_hint(raw: Optional[str]) -> Optional[str]:
    t = re.sub(r"\s+", " ", (raw or "")).strip()
    return t[:HINT_MAX] or None


def visible_books(q, org_id: Optional[int]):
    """教材可见: 上架的 + (本机构的 或 平台预置的)。org_id None = 平台 admin,不限"""
    q = q.where(PhoneticBook.is_active.is_(True))
    if org_id is not None:
        q = q.where(or_(PhoneticBook.org_id == org_id, PhoneticBook.org_id.is_(None)))
    return q


def visible_sets(q, org_id: Optional[int]):
    """听力套可见: 教材可见 + 套没删 + (本机构建的 或 平台建的)。q 里要已经 join 了 ListeningSet 和 PhoneticBook"""
    q = visible_books(q, org_id).where(ListeningSet.is_active.is_(True))
    if org_id is not None:
        q = q.where(or_(ListeningSet.org_id == org_id, ListeningSet.org_id.is_(None)))
    return q


def can_edit_set(set_org_id: Optional[int], role: str, org_id: Optional[int]) -> bool:
    """改得动吗: 平台 admin 全能改;机构只能改自己机构建的(平台建的只读)"""
    return role == "admin" or (set_org_id is not None and set_org_id == org_id)


def grade(item: ListeningItem, word: Optional[str], phonetic: Sequence[Optional[str]], pass_number: int):
    """判一题 → dict(word_ok, phonetic per_slot / wrong / next_blanks, all_correct)

    第二遍时单词第一遍已经对了的,前端不再让填,传 None 也算对(word_locked)"""
    from app.api.v1.phonetic_practice import _grade_one   # 和音标教材同一份判分
    answer: List[str] = loads(item.answer_json, [])
    core: List[int] = loads(item.core_indexes_json, [])
    word_ok = norm_word(word) == norm_word(item.word)
    per_slot, wrong, next_blanks = _grade_one(answer, core, list(phonetic), pass_number)
    return {
        "word_ok": word_ok,
        "per_slot": per_slot,
        "wrong_indexes": wrong,
        "next_blanks": next_blanks,
        "phonetic_ok": not wrong,
        "all_correct": word_ok and not wrong,
        "answer": answer,
    }


async def completion_times(db: AsyncSession, pairs: Iterable[tuple[int, int, datetime]]
                           ) -> dict[tuple[int, int, datetime], datetime]:
    """(学生, 听力套, 作业开放时刻) → 做完这一套的时刻(开放后每题都结束过,取最后结束那一题的时刻)

    「结束」= 那一题有一条 is_correct / pass_number>=2 / gave_up 的记录。一次查完一批(看板一次判全班)"""
    pairs = list(pairs)
    if not pairs:
        return {}
    uids = {u for u, _, _ in pairs}
    sids = {s for _, s, _ in pairs}
    earliest = min(t for _, _, t in pairs)
    totals = dict((await db.execute(
        select(ListeningItem.set_id, func.count(ListeningItem.id))
        .where(ListeningItem.set_id.in_(sids)).group_by(ListeningItem.set_id)
    )).all())
    rows = (await db.execute(
        select(ListeningAttempt.user_id, ListeningAttempt.set_id, ListeningAttempt.item_id,
               ListeningAttempt.created_at)
        .where(ListeningAttempt.user_id.in_(uids), ListeningAttempt.set_id.in_(sids),
               ListeningAttempt.created_at >= earliest,
               or_(ListeningAttempt.is_correct.is_(True), ListeningAttempt.pass_number >= 2,
                   ListeningAttempt.gave_up.is_(True)))
    )).all()
    out = {}
    for u, s, opened in pairs:
        n = totals.get(s, 0)
        if not n:
            continue
        first_done: dict[int, datetime] = {}
        for ru, rs, item_id, at in rows:
            if ru == u and rs == s and at >= opened:
                if item_id not in first_done or at < first_done[item_id]:
                    first_done[item_id] = at
        if len(first_done) >= n:
            out[(u, s, opened)] = max(first_done.values())
    return out
