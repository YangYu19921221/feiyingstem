"""每日复习 —— 每天固定一小份,先挑最该复习的(唯一真源)

用户 2026-10-21「先把陪跑做起来」后接着做的第二项。生产实情: 近两周在学的 93 个孩子人均攒着 817 个
到期没复习的词,其中 51252 个已经过期 30 天以上;首页写着「先复习 20 个」,但那 20 个是按到期时间
最早取的 —— 全是几个月前的旧词,88 个有「最近两周刚学、今天到期」词的孩子里 55 个,这些词排在
前 100 名之外,永远轮不到。复习记录只占全部练习的 9%,大多数孩子 28 天里只复习过 1 天。

规则:
- 一天一份 DAILY_SIZE 个词,第一次打开时挑好存下(models/daily_review.py),当天不变 ——
  现算的话做完 10 个回来又冒出 20 个新的,永远做不完
- 候选 = 到期(next_review_at <= 现在)且今天还没练过的词,按拼写去重(同拼写取掌握度最低那条,
  与记忆曲线页同口径)
- 先挑「两周内练过」的(正在记忆曲线上、按时复习最划算的),按到期早晚;最多占 FRESH_SLOTS 个,
  其余留给旧积压(错过的优先、上次练习离现在近的优先),旧积压一天消化一点,不会把新词挤掉
- 做了几个 = 这份里**当天有学习记录**的词数(learning_records,复习页、单元学习里练到都算)。
  不看 word_mastery.last_practiced_at: 它会被第二天的练习覆盖,事后算前一天的份就对不上了
- 全做完写 completed_at(只写不清),作业判完成读它;今天没有到期的词 → 空的一份、直接算完成
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range, local_today
from app.models.daily_review import DailyReviewPlan
from app.models.learning import LearningRecord, WordMastery
from app.models.word import Word

DAILY_SIZE = 20
FRESH_SLOTS = 15          # 「两周内练过」的最多占几个,其余留给旧积压
FRESH_DAYS = 14
_EPOCH = datetime(2000, 1, 1)


def _words(plan: DailyReviewPlan) -> list[int]:
    try:
        return [int(x) for x in json.loads(plan.word_ids or "[]")]
    except (ValueError, TypeError):
        return []


async def pick(db: AsyncSession, user_id: int, d: date, now: Optional[datetime] = None) -> tuple[list[int], int]:
    """挑当天那一份 → (word_ids 按优先级, 到期总数(按拼写去重))"""
    now = now or datetime.utcnow()
    day_start, _ = local_day_utc_range(d)
    rows = (await db.execute(
        select(WordMastery.word_id, WordMastery.mastery_level, WordMastery.next_review_at,
               WordMastery.last_practiced_at, WordMastery.wrong_count, Word.word)
        .join(Word, Word.id == WordMastery.word_id)
        .where(and_(
            WordMastery.user_id == user_id,
            WordMastery.next_review_at.is_not(None),
            WordMastery.next_review_at <= now,
            or_(WordMastery.last_practiced_at.is_(None), WordMastery.last_practiced_at < day_start),
        ))
    )).all()
    best: dict[str, tuple] = {}
    for r in rows:
        key = (r.word or "").strip().lower()
        if not key:
            continue
        prev = best.get(key)
        if prev is None or (r.mastery_level or 0, r.next_review_at) < (prev.mastery_level or 0, prev.next_review_at):
            best[key] = r
    cands = list(best.values())
    fresh_since = now - timedelta(days=FRESH_DAYS)

    def is_fresh(r) -> bool:
        return r.last_practiced_at is not None and r.last_practiced_at >= fresh_since

    # 两周内练过的: 按到期早晚(越早到期越该先复习)
    fresh = sorted((r for r in cands if is_fresh(r)), key=lambda r: r.next_review_at)

    # 旧积压: 错过的优先,再按上次练习离现在近的优先(近的还剩点印象,最拉得回来);从没练过的排最后
    def old_key(r):
        last = r.last_practiced_at
        return ((r.wrong_count or 0) == 0, last is None, -(last - _EPOCH).total_seconds() if last else 0)

    old = sorted((r for r in cands if not is_fresh(r)), key=old_key)
    # 新词最多占 FRESH_SLOTS;旧积压不够填满时新词补上
    take_fresh = min(len(fresh), max(FRESH_SLOTS, DAILY_SIZE - len(old)))
    chosen = fresh[:take_fresh]
    chosen += old[:DAILY_SIZE - len(chosen)]
    return [r.word_id for r in chosen], len(cands)


async def get_plan(db: AsyncSession, user_id: int, d: date, *, create: bool = True) -> Optional[DailyReviewPlan]:
    """取当天那一份;没有就挑一份存下(create=False 时只读)。
    两个请求同时建: INSERT ... ON CONFLICT DO NOTHING 再读,不 rollback(会让调用方的 ORM 对象过期)"""
    q = select(DailyReviewPlan).where(DailyReviewPlan.user_id == user_id, DailyReviewPlan.plan_date == d)
    plan = (await db.execute(q)).scalar_one_or_none()
    if plan is not None or not create:
        return plan
    ids, backlog = await pick(db, user_id, d)
    await db.execute(sqlite_insert(DailyReviewPlan).values(
        user_id=user_id, plan_date=d, word_ids=json.dumps(ids), backlog=backlog,
        completed_at=datetime.utcnow() if not ids else None,
    ).on_conflict_do_nothing(index_elements=["user_id", "plan_date"]))
    await db.commit()
    return (await db.execute(q)).scalar_one()


async def _progress(db: AsyncSession, user_id: int, ids: list[int], d: date) -> tuple[list[int], set[int]]:
    """(还在的词 按原顺序, 其中当天有学习记录的)。词被删了的不算进份子 —— 否则永远凑不满"""
    if not ids:
        return [], set()
    day_start, day_end = local_day_utc_range(d)
    alive = set((await db.execute(select(Word.id).where(Word.id.in_(ids)))).scalars())
    done = set((await db.execute(
        select(LearningRecord.word_id).where(
            LearningRecord.user_id == user_id, LearningRecord.word_id.in_(ids),
            LearningRecord.created_at >= day_start, LearningRecord.created_at < day_end,
        ).distinct()
    )).scalars())
    return [i for i in ids if i in alive], done


async def _settle(db: AsyncSession, plan: DailyReviewPlan) -> tuple[list[int], set[int]]:
    """算进度,做完了就标 completed_at(不 commit,调用方提交)"""
    ids, done = await _progress(db, plan.user_id, _words(plan), plan.plan_date)
    if plan.completed_at is None and all(i in done for i in ids):
        plan.completed_at = datetime.utcnow()
    return ids, done


async def status(db: AsyncSession, user_id: int, d: Optional[date] = None, *, create: bool = True) -> dict:
    """{date, total, done, remaining_ids, backlog, completed, started}"""
    d = d or local_today()
    plan = await get_plan(db, user_id, d, create=create)
    if plan is None:
        return {"date": d.isoformat(), "total": 0, "done": 0, "remaining_ids": [], "backlog": 0,
                "completed": False, "started": False}
    was_done = plan.completed_at is not None
    ids, done = await _settle(db, plan)
    if not was_done and plan.completed_at is not None:
        await db.commit()
    return {
        "date": d.isoformat(),
        "total": len(ids),
        "done": sum(1 for i in ids if i in done),
        "remaining_ids": [i for i in ids if i not in done],
        "backlog": int(plan.backlog or 0),
        "completed": plan.completed_at is not None,
        "started": True,
    }


async def completed_days(db: AsyncSession, user_id: int, days: Iterable[date]) -> set[date]:
    """这几天里哪几天那一份做完了(作业判完成用)。顺手把算出来做完的标上 completed_at,调用方 commit。
    当天没打开过复习(没有那一份)= 没做"""
    days = set(days)
    if not days:
        return set()
    out: set[date] = set()
    for plan in (await db.execute(
        select(DailyReviewPlan).where(DailyReviewPlan.user_id == user_id, DailyReviewPlan.plan_date.in_(days))
    )).scalars():
        if plan.completed_at is None:
            await _settle(db, plan)
        if plan.completed_at is not None:
            out.add(plan.plan_date)
    return out


async def status_for_students(db: AsyncSession, user_ids: list[int], d: date) -> dict[int, dict]:
    """老师看板用: 只读已有的那份(不替孩子建),{uid: {done, total, completed}}。
    两条查询: 当天的份 + 这些孩子当天的学习记录(按 user_id IN,不把几千个词 id 塞进 IN)"""
    if not user_ids:
        return {}
    plans = list((await db.execute(
        select(DailyReviewPlan).where(DailyReviewPlan.user_id.in_(user_ids), DailyReviewPlan.plan_date == d)
    )).scalars())
    if not plans:
        return {}
    day_start, day_end = local_day_utc_range(d)
    practiced: dict[int, set[int]] = {}
    for uid, wid in (await db.execute(
        select(LearningRecord.user_id, LearningRecord.word_id).where(
            LearningRecord.user_id.in_([p.user_id for p in plans]),
            LearningRecord.created_at >= day_start, LearningRecord.created_at < day_end,
        ).distinct()
    )).all():
        practiced.setdefault(uid, set()).add(wid)
    out = {}
    for p in plans:
        ids = _words(p)
        n = sum(1 for i in ids if i in practiced.get(p.user_id, ()))
        out[p.user_id] = {"done": n, "total": len(ids),
                          "completed": p.completed_at is not None or n >= len(ids)}
    return out
