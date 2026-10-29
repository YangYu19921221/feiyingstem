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

## 缺前置知识(2026-10-29,用户「如果用户欠缺知识点如何帮助学生解决问题」)
同一个点换了讲法还错,多半是下面一层没会(三单加 s 学不会,常是分不清主语是不是第三人称)。
小鹰老师先问一个前置小问题,前置不会就先补前置: save_note(stuck, missing=缺的前置) →
原来那条记「缺前置: …」,前置本身另记一条 stuck(明天一起回头考)。

## 交给老师(同日)
笔记里同一个点**练习里错满 HANDOFF_WRONG 次、还没学会** = 要请真人老师当面讲(AI 讲不通的,老师当面两分钟最有效)。
「要请老师讲」不另存,每次按笔记现算;老师在「小鹰老师 · 本班情况」点「我讲过了」写一行 tutor_handoffs,
记下那一刻错了几次。之后孩子又错了(times_wrong 变大)就重新出现 —— 讲过一次不等于会了;学会了(mastered)就不再出现。
只数练习里判出来的错(event=wrong),小鹰老师自己记的 stuck 不算(同一段对话里会记好几遍)。

## 首页「考考你」(同日)
到期该回头考的点,不再只等孩子打开聊天才提: 学生首页小鹰老师卡片上直接写「昨天的 xx,10 秒考考你」,
点了进聊天自动出 1–2 道题。这一问不扣次数,一天 REVIEW_DAILY 次(services/tutor 的 COST_REVIEW)。
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import local_today, utc_now
from app.models.tutor import TutorHandoff, TutorNote

INTERVALS = (1, 3, 7)        # 停在 stage 0 / 1 / 2 时隔几天再考(刚讲完明天考);stage 到 3 = 学会
EVENTS = ("taught", "stuck", "right", "wrong")
TOPIC_MAX = 40
DETAIL_MAX = 120
HANDOFF_WRONG = 3            # 练习里同一个点错满几次、还没学会,就请老师当面讲
HANDOFF_NOTE_MAX = 200
REVIEW_DAILY = 1             # 首页「考考你」一天几次不扣次数


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
    handoff = list((await db.execute(
        select(TutorNote.topic).where(TutorNote.user_id == user_id, TutorNote.mastered.is_(False),
                                      TutorNote.times_wrong >= HANDOFF_WRONG)
        .order_by(TutorNote.times_wrong.desc(), TutorNote.updated_at.desc()).limit(3))).scalars().all())
    if not due and not learning and not mastered and not handoff:
        return None
    parts = []
    if handoff:
        parts.append("这几个点练习里错了好几次,系统已经请他的老师当面讲: " + "、".join(handoff)
                     + "(讲到时可以告诉他老师会再给他讲一次,换个角度讲,别一直在这一个点上磨)")
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
    topic = str(inp.get("topic") or "")
    detail = str(inp.get("detail") or "")
    missing = re.sub(r"\s+", " ", str(inp.get("missing") or "")).strip()[:TOPIC_MAX]
    if missing and topic_key(missing) == topic_key(topic):
        missing = ""
    if missing and event == "stuck":
        # 卡住是因为缺了前置: 原来那条写明缺什么,前置另记一条(明天一起回头考),见文件头「缺前置知识」
        detail = (f"缺前置: {missing}" + (f";{detail}" if detail else ""))[:DETAIL_MAX]
    n = await record(db, user_id, topic, event, kind=str(inp.get("kind") or "point"), detail=detail)
    if n is None:
        return {"ok": False, "reason": "topic 不能为空"}
    pre = None
    if missing and event == "stuck":
        pre = await record(db, user_id, missing, "stuck", kind="point", detail=f"学「{n.topic}」时发现还没会")
    await db.commit()
    when = "已经学会了" if n.mastered else (f"{n.due_date} 回头考" if n.due_date else "")
    out = {"ok": True, "topic": n.topic, "next": when,
           "note": "记好了。不用告诉孩子你记了笔记,接着讲就行"}
    if pre is not None:
        out["missing"] = pre.topic
        out["note"] = "记好了。先把前置讲会、出一道题确认,再回来讲原来那个点。不用告诉孩子你记了笔记"
    return out


async def mark_reviewed_today(db: AsyncSession, user_id: int, topics: list[str]) -> None:
    """(预留)批量把几条推迟到明天。现在没有调用方"""
    keys = [topic_key(t) for t in topics if topic_key(t)]
    if keys:
        await db.execute(update(TutorNote).where(TutorNote.user_id == user_id, TutorNote.topic_key.in_(keys))
                         .values(due_date=_day(local_today() + timedelta(days=1))))


# ---------------------------------------------------------------- 交给老师(见文件头)

def _pending(n: TutorNote, h: Optional[TutorHandoff]) -> bool:
    return h is None or h.handled_at is None or (h.wrong_at_handle or 0) < (n.times_wrong or 0)


async def handoffs(db: AsyncSession, student_ids: list[int], *, include_handled: bool = False) -> list[dict]:
    """这些学生里要请老师当面讲的点(还没学会、练习里错满 HANDOFF_WRONG 次)。
    include_handled=False 只列还没讲过 / 讲过以后又错了的"""
    if not student_ids:
        return []
    rows = (await db.execute(
        select(TutorNote, TutorHandoff)
        .outerjoin(TutorHandoff, TutorHandoff.note_id == TutorNote.id)
        .where(TutorNote.user_id.in_(student_ids), TutorNote.mastered.is_(False),
               TutorNote.times_wrong >= HANDOFF_WRONG)
        .order_by(TutorNote.times_wrong.desc(), TutorNote.updated_at.desc())
    )).all()
    out = []
    for n, h in rows:
        pending = _pending(n, h)
        if not pending and not include_handled:
            continue
        out.append({
            "note_id": n.id, "student_id": n.user_id, "topic": n.topic, "kind": n.kind, "detail": n.detail,
            "times_wrong": n.times_wrong or 0, "times_right": n.times_right or 0, "pending": pending,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
            # 讲过以后又错了: 老师上次讲的时候写了什么
            "handled": None if h is None or h.handled_at is None else {
                "at": h.handled_at.isoformat(), "by": h.handled_by_name or "", "note": h.handled_note or "",
                "wrong_then": h.wrong_at_handle or 0},
        })
    return out


async def handoff_count(db: AsyncSession, student_ids: list[int]) -> int:
    return len(await handoffs(db, student_ids))


async def handle_handoff(db: AsyncSession, note: TutorNote, actor_id: int, actor_name: str,
                         text: Optional[str]) -> None:
    """老师讲过了: 记下这一刻错了几次。不 commit"""
    await db.execute(sqlite_insert(TutorHandoff).values(
        note_id=note.id, user_id=note.user_id, wrong_at_handle=note.times_wrong or 0, handled_at=utc_now(),
        handled_by=actor_id, handled_by_name=(actor_name or "")[:60],
        handled_note=(text or "").strip()[:HANDOFF_NOTE_MAX] or None,
    ).on_conflict_do_update(index_elements=[TutorHandoff.note_id], set_={
        "wrong_at_handle": note.times_wrong or 0, "handled_at": utc_now(), "handled_by": actor_id,
        "handled_by_name": (actor_name or "")[:60],
        "handled_note": (text or "").strip()[:HANDOFF_NOTE_MAX] or None,
    }))
    # 讲过了: 明天让小鹰老师回头考一下,看当面讲的有没有讲会
    note.due_date = _day(local_today() + timedelta(days=1))
    note.stage = 0


# ---------------------------------------------------------------- 首页「考考你」(见文件头)

def _review_key(user_id: int, today: date) -> str:
    return f"tutor:review:{user_id}:{today.isoformat()}"


async def review_question(db: AsyncSession, user_id: int, today: Optional[date] = None) -> Optional[dict]:
    """首页卡片上那一题: 今天到期、还没学会的第一条;今天的免费次数用过了就不给"""
    today = today or local_today()
    if int(await store.get(_review_key(user_id, today)) or 0) >= REVIEW_DAILY:
        return None
    due = await due_notes(db, user_id, 1, today)
    if not due:
        return None
    n = due[0]
    # 库里存 UTC naive,按北京日算是不是昨天记的
    made = (n.updated_at + timedelta(hours=8)).date() if n.updated_at else None
    return {"note_id": n.id, "topic": n.topic, "kind": n.kind,
            "since": "昨天" if made is not None and (today - made).days == 1 else "上次"}


async def review_note(db: AsyncSession, user_id: int, note_id: int, today: Optional[date] = None) -> Optional[TutorNote]:
    """点了「考考你」的那条: 是他的、今天到期、还没学会才算数(只判断,不扣今天的免费次数)"""
    today = today or local_today()
    n = await db.get(TutorNote, note_id)
    if n is None or n.user_id != user_id or n.mastered or not n.due_date or n.due_date > _day(today):
        return None
    return n


async def claim_review(user_id: int, today: Optional[date] = None) -> bool:
    """占掉今天的免费「考考你」(一天 REVIEW_DAILY 次)。限速检查过了才调,被限速的那一下不该占"""
    return await store.incr_if_below(_review_key(user_id, today or local_today()), REVIEW_DAILY, 26 * 3600)


async def release_review(user_id: int, today: Optional[date] = None) -> None:
    """这次没调通: 把今天的免费「考考你」还回去"""
    await store.incr(_review_key(user_id, today or local_today()), -1, 26 * 3600)


def review_prompt(n: TutorNote) -> str:
    """发给小鹰老师的那段(孩子看到的只是「考考我: 一般现在时」)"""
    why = f"(上次卡在: {n.detail})" if n.detail else ""
    if n.kind == "word":
        how = f"用 make_practice 出这个词(words 就写 {n.topic},mode 用 meaning)"
    else:
        how = f"用 make_quiz 出 1–2 道题,topic 一字不改写「{n.topic}」(系统按它记他会没会)"
    return (f"[系统] 孩子从首页点了「考考你」,回头考他以前学过的「{n.topic}」{why}。"
            f"一句话开场(比如「来,10 秒考考你」),然后{how}。先别讲解,回答里不要写出答案。")
