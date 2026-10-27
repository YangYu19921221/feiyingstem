"""小鹰老师的笔记: 跨对话记住给这个孩子讲过什么、哪些会了、哪些还卡着,隔几天回头考(2026-10-27,用户「按你建议来」)

以前助手只带最近 8 条对话 + 学情档案,换一段对话就不知道上周讲过一般现在时、孩子还没会。
现在每个孩子一张笔记表(tutor_notes),一条 = 一个知识点或一个单词:

## 怎么记
- 小鹰老师讲完一个点 / 孩子卡住 / 孩子讲会了: 调工具 save_note(taught / stuck / got_it)
- 孩子在聊天里做完练习卡: 服务器判分后自动记(services/tutor_quiz) —— 单词卡按单词记,
  语法题按出题时给的 topic 记
- 只记学习内容(知识点名、卡在哪),不记姓名学校

## 什么时候回头考(和单词的记忆曲线同一个思路,但简化成三级)
- stage 0 = 刚讲 / 刚错: 明天该考;答对一次升一级,间隔 1 → 3 → 7 天,第 3 次答对算学会
- **只有「到期那天或以后」答对才升级**: 刚讲完马上做对不算(那是短时记忆),
  否则一节课连对三次就「学会」了
- 答错 / 卡住: 回到 stage 0、明天再考
- 学情档案里列「今天该回头考」的几条,小鹰老师答完孩子的问题后问一句要不要花 10 秒考一下

## 日期
due_date 存北京日的字符串 YYYY-MM-DD,比较是字符串比较(不碰 datetime 微秒格式混用的坑)
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.models.tutor import TutorNote

INTERVALS = (1, 3, 7)        # 停在 stage 0 / 1 / 2 时隔几天再考(刚讲完明天考);stage 到 3 = 学会
EVENTS = ("taught", "stuck", "right", "wrong")
TOPIC_MAX = 40
DETAIL_MAX = 120


def topic_key(topic: str) -> str:
    """去空白和标点、小写: 「一般现在时 第三人称加s」和「一般现在时,第三人称加 s」算同一条"""
    t = re.sub(r"[\s\W_]+", "", (topic or "").lower(), flags=re.UNICODE)
    return t[:80]


def _day(d: date) -> str:
    return d.isoformat()


async def record(db: AsyncSession, user_id: int, topic: str, event: str, *, kind: str = "point",
                 detail: Optional[str] = None, today: Optional[date] = None) -> Optional[TutorNote]:
    """记一笔。event: taught 讲了 / stuck 卡住了 / right 答对了 / wrong 答错了。不 commit。
    right 碰到没有记过的 topic 什么都不做(只跟踪讲过的和卡住的,不给每个答对的词都建一条)"""
    if event not in EVENTS:
        return None
    topic = re.sub(r"\s+", " ", (topic or "").strip())[:TOPIC_MAX]
    key = topic_key(topic)
    if not key:
        return None
    kind = kind if kind in ("point", "word") else "point"
    today = today or local_today()
    tomorrow = _day(today + timedelta(days=1))
    detail = (detail or "").strip()[:DETAIL_MAX] or None
    now = utc_now()

    if event != "right":
        # 讲了 / 卡住 / 答错: 没有就建一条(并发两个请求同时建靠唯一索引兜住)
        await db.execute(sqlite_insert(TutorNote).values(
            user_id=user_id, topic_key=key, topic=topic, kind=kind, detail=detail, stage=0, mastered=False,
            due_date=tomorrow, times_right=0, times_wrong=0, created_at=now, updated_at=now,
        ).on_conflict_do_nothing(index_elements=[TutorNote.user_id, TutorNote.topic_key]))
    n = (await db.execute(
        select(TutorNote).where(TutorNote.user_id == user_id, TutorNote.topic_key == key)
        .execution_options(populate_existing=True))).scalar_one_or_none()
    if n is None:
        return None

    if event in ("stuck", "wrong"):
        n.stage, n.mastered, n.due_date = 0, False, tomorrow
        n.times_wrong = (n.times_wrong or 0) + (1 if event == "wrong" else 0)
        if detail:
            n.detail = detail
    elif event == "taught":
        if detail:
            n.detail = detail
        if n.mastered:
            # 学会了的又讲了一遍(多半是忘了): 重新排进复习
            n.mastered, n.stage, n.due_date = False, 0, tomorrow
    else:   # right
        n.times_right = (n.times_right or 0) + 1
        if not n.mastered and n.due_date and n.due_date <= _day(today):
            n.stage = (n.stage or 0) + 1
            if n.stage >= len(INTERVALS):
                n.mastered, n.due_date = True, None
            else:
                n.due_date = _day(today + timedelta(days=INTERVALS[n.stage]))
    n.updated_at = now
    return n


async def due_notes(db: AsyncSession, user_id: int, limit: int = 3, today: Optional[date] = None) -> list[TutorNote]:
    today = today or local_today()
    return list((await db.execute(
        select(TutorNote).where(TutorNote.user_id == user_id, TutorNote.mastered.is_(False),
                                TutorNote.due_date.isnot(None), TutorNote.due_date <= _day(today))
        .order_by(TutorNote.due_date, TutorNote.updated_at).limit(limit))).scalars().all())


async def profile_line(db: AsyncSession, user_id: int, today: Optional[date] = None) -> Optional[str]:
    """学情档案里的一行(每次现算: 孩子刚做完练习就问,要是新的)"""
    today = today or local_today()
    due = await due_notes(db, user_id, 3, today)
    learning = list((await db.execute(
        select(TutorNote.topic).where(TutorNote.user_id == user_id, TutorNote.mastered.is_(False),
                                      TutorNote.due_date > _day(today))
        .order_by(TutorNote.updated_at.desc()).limit(3))).scalars().all())
    mastered = int((await db.execute(
        select(func.count(TutorNote.id)).where(TutorNote.user_id == user_id, TutorNote.mastered.is_(True))
    )).scalar() or 0)
    if not due and not learning and not mastered:
        return None
    parts = []
    if due:
        parts.append("今天该回头考: " + "、".join(
            n.topic + (f"(上次卡在: {n.detail})" if n.detail else "") for n in due))
    if learning:
        parts.append("还在学: " + "、".join(learning))
    if mastered:
        parts.append(f"已经学会 {mastered} 个")
    return "- 小鹰老师的笔记: " + ";".join(parts)


async def tool_save_note(db: AsyncSession, user_id: int, inp: dict) -> dict:
    status = str(inp.get("status") or "")
    event = {"taught": "taught", "stuck": "stuck", "got_it": "right"}.get(status)
    if event is None:
        return {"ok": False, "reason": "status 只能是 taught / stuck / got_it"}
    n = await record(db, user_id, str(inp.get("topic") or ""), event,
                     kind=str(inp.get("kind") or "point"), detail=str(inp.get("detail") or ""))
    if n is None:
        return {"ok": False, "reason": "topic 不能为空"}
    await db.commit()
    when = "已经学会了" if n.mastered else (f"{n.due_date} 回头考" if n.due_date else "")
    return {"ok": True, "topic": n.topic, "next": when,
            "note": "记好了。不用告诉孩子你记了笔记,接着讲就行"}


async def mark_reviewed_today(db: AsyncSession, user_id: int, topics: list[str]) -> None:
    """(预留)批量把几条推迟到明天。现在没有调用方"""
    keys = [topic_key(t) for t in topics if topic_key(t)]
    if keys:
        await db.execute(update(TutorNote).where(TutorNote.user_id == user_id, TutorNote.topic_key.in_(keys))
                         .values(due_date=_day(local_today() + timedelta(days=1))))
