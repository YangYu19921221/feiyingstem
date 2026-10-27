"""学习助手的效果数据 + 老师端全班汇总(2026-10-27,用户「按你的建议全做了」)

## 效果: 问过小鹰老师的词,后来拼对没有
「词」= 小鹰老师笔记里的单词(tutor_notes kind=word: 聊天里讲过、练过、卡住过的),起点 = 笔记第一次记下的时间。
看系统里**正式练习**的计分记录(learning_records,SCORING_MODES,不含聊天里的练习卡 —— 那个不进学习记录):
- 之前: 起点前 30 天内这个孩子这个词的计分题,对了几成
- 之后: 起点之后的计分题,对了几成
只算之前、之后都至少有 1 题的词(否则没法比)。词按拼写小写对(同一个词在不同书里 word_id 不同)。
**这不是因果**: 之后正确率高也可能是本来就会复习到;样本少时(< MIN_WORDS 个词)前端写「数据还不够」,不下结论。

## 全班汇总(老师)
近 N 天: 每个孩子问了几次、最近一次、还卡着的点几个、没处理的提醒;全班卡得最多的知识点和单词;全班的效果数据。
只看本班(和 /teacher/tutor/students 同一份本班名单)。
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.learning import LearningRecord
from app.models.tutor import TutorAlert, TutorMessage, TutorNote
from app.models.word import Word

BEFORE_DAYS = 30
MIN_WORDS = 5


async def effect(db: AsyncSession, user_ids: Optional[list[int]] = None, org_id: Optional[int] = None) -> dict:
    """user_ids: 只算这些孩子(老师本班);org_id: 只算这个机构(机构管理员);都不给 = 全平台"""
    from app.models.user import User
    from app.services.weak_words import SCORING_MODES

    q = select(TutorNote.user_id, TutorNote.topic_key, TutorNote.created_at).where(TutorNote.kind == "word")
    if user_ids is not None:
        if not user_ids:
            return _empty()
        q = q.where(TutorNote.user_id.in_(user_ids))
    elif org_id is not None:
        q = q.join(User, User.id == TutorNote.user_id).where(User.org_id == org_id)
    notes = (await db.execute(q)).all()
    if not notes:
        return _empty()
    by_user: dict[int, dict[str, object]] = defaultdict(dict)
    for uid, key, created in notes:
        if created is not None:
            by_user[uid][key] = created
    words = total_before = right_before = total_after = right_after = 0
    for uid, topics in by_user.items():
        earliest = min(topics.values()) - timedelta(days=BEFORE_DAYS)
        rows = (await db.execute(
            select(func.lower(Word.word), LearningRecord.created_at, LearningRecord.is_correct)
            .join(Word, Word.id == LearningRecord.word_id)
            .where(LearningRecord.user_id == uid, LearningRecord.learning_mode.in_(SCORING_MODES),
                   LearningRecord.created_at >= earliest, func.lower(Word.word).in_(list(topics.keys())))
        )).all()
        per: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0])   # 之前题 / 之前对 / 之后题 / 之后对
        for w, at, ok in rows:
            start = topics.get(w)
            if start is None or at is None:
                continue
            c = per[w]
            if at < start:
                if at >= start - timedelta(days=BEFORE_DAYS):
                    c[0] += 1
                    c[1] += 1 if ok else 0
            else:
                c[2] += 1
                c[3] += 1 if ok else 0
        for c in per.values():
            if c[0] and c[2]:
                words += 1
                total_before += c[0]
                right_before += c[1]
                total_after += c[2]
                right_after += c[3]
    out = _empty()
    out.update(words=words, noted_words=sum(len(t) for t in by_user.values()),
               before=round(right_before / total_before, 3) if total_before else None,
               after=round(right_after / total_after, 3) if total_after else None,
               enough=words >= MIN_WORDS)
    return out


def _empty() -> dict:
    return {"words": 0, "noted_words": 0, "before": None, "after": None, "enough": False, "min_words": MIN_WORDS,
            "before_days": BEFORE_DAYS}


async def class_summary(db: AsyncSession, students: list[tuple[int, str, str, str]], days: int = 7) -> dict:
    """students: (id, 用户名, 姓名, 班级名),来自 api 的本班名单"""
    ids = [s[0] for s in students]
    since = utc_now() - timedelta(days=days)
    if not ids:
        return {"days": days, "items": [], "stuck_points": [], "stuck_words": [], "effect": _empty(),
                "asked_students": 0, "questions": 0}
    asked = {uid: (int(n), last) for uid, n, last in (await db.execute(
        select(TutorMessage.user_id, func.count(TutorMessage.id), func.max(TutorMessage.created_at))
        .where(TutorMessage.user_id.in_(ids), TutorMessage.role == "user", TutorMessage.created_at >= since)
        .group_by(TutorMessage.user_id))).all()}
    stuck = {uid: int(n) for uid, n in (await db.execute(
        select(TutorNote.user_id, func.count(TutorNote.id))
        .where(TutorNote.user_id.in_(ids), TutorNote.mastered.is_(False), TutorNote.times_wrong > 0)
        .group_by(TutorNote.user_id))).all()}
    alerts = {uid: (int(n), int(u or 0)) for uid, n, u in (await db.execute(
        select(TutorAlert.user_id, func.count(TutorAlert.id),
               func.sum(case((TutorAlert.level == "urgent", 1), else_=0)))
        .where(TutorAlert.user_id.in_(ids), TutorAlert.handled_at.is_(None))
        .group_by(TutorAlert.user_id))).all()}
    items = []
    for uid, uname, fname, cname in students:
        n, last = asked.get(uid, (0, None))
        a = alerts.get(uid, (0, 0))
        items.append({"id": uid, "name": fname or uname, "class_name": cname, "questions": n,
                      "last_at": last.isoformat() if last else None, "stuck": stuck.get(uid, 0),
                      "alerts": a[0], "urgent": a[1]})
    # 有提醒的在前,其次卡得多的,其次问得多的
    items.sort(key=lambda x: (-x["urgent"], -x["alerts"], -x["stuck"], -x["questions"], x["class_name"]))

    async def top(kind: str) -> list[dict]:
        rows = (await db.execute(
            select(TutorNote.topic_key, func.max(TutorNote.topic), func.count(func.distinct(TutorNote.user_id)),
                   func.sum(TutorNote.times_wrong))
            .where(TutorNote.user_id.in_(ids), TutorNote.kind == kind, TutorNote.mastered.is_(False),
                   TutorNote.times_wrong > 0, TutorNote.updated_at >= since)
            .group_by(TutorNote.topic_key)
            .order_by(func.count(func.distinct(TutorNote.user_id)).desc(), func.sum(TutorNote.times_wrong).desc())
            .limit(8))).all()
        return [{"topic": t, "students": int(n), "wrong": int(w or 0)} for _, t, n, w in rows]

    return {"days": days, "items": items, "stuck_points": await top("point"), "stuck_words": await top("word"),
            "effect": await effect(db, user_ids=ids), "asked_students": sum(1 for x in items if x["questions"]),
            "questions": sum(x["questions"] for x in items)}
