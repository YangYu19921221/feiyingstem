"""学习助手的对话记录: 分组、搜索、改名、收藏、删除、到期自动清理(2026-10-27,用户「对话历史记录是不是要分
3天7天一个月 可以删除标题可以修改 可以搜索 多久自动删除部分历史记录 你设计下」)

## 分组(按北京日,和全站「今天」同一个口径)
收藏(放最上面)/ 今天 / 3 天内(昨天、前天)/ 7 天内 / 一个月内 / 更早

## 保留多久(数字只在这里,前端和老师页都读接口给的 keep_days / deleted_keep_days)
- 最后一次提问在 KEEP_DAYS(180)天前、又没收藏的对话: 自动删。和学习卡的半年同一个口径;
  孩子的提问是未成年人的数据,不该无限期留着
- 孩子自己删的: 孩子那边马上看不到,老师那边 DELETED_KEEP_DAYS(30)天内还看得到(标「孩子删了」),
  之后真删。合同里写了「助手可能出错,老师看得到孩子问了什么」—— 孩子一删老师就看不到,出了问题没处查
- 收藏的不自动删;收藏了又删掉的,照样 30 天后删
- 真删的是对话、里面的消息和对话里出的练习(tutor_quizzes);小鹰老师的笔记(tutor_notes)按人记,不动
- **删消息之前先把这个孩子的次数行建好**(tutor._ensure_allowance): 10-26 第一版的提问没有次数行,
  已用次数是按消息条数现算的,先删消息等于把用过的次数退回去

到期清理每小时在主进程跑一次(挂在 sentence_speech.speech_loop,和跟读录音到期删除一起)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import LOCAL_TZ, local_today, utc_now
from app.models.tutor import TutorConversation, TutorMessage, TutorQuiz

logger = logging.getLogger(__name__)

KEEP_DAYS = 180
DELETED_KEEP_DAYS = 30
TITLE_MAX = 30
QUERY_MAX = 40
SNIPPET_LEN = 40
PURGE_CHUNK = 400   # SQLite 一条语句的参数个数有上限,ids 分批删

GROUPS = ("starred", "today", "3d", "7d", "30d", "older")


def clean_title(raw: Optional[str]) -> str:
    """去首尾空白、连续空白并成一个、截到 TITLE_MAX 字;空串 = 不合法(调用方报 400)"""
    return " ".join((raw or "").split())[:TITLE_MAX].strip()


def clean_query(raw: Optional[str]) -> str:
    return " ".join((raw or "").split())[:QUERY_MAX]


def escape_like(s: str) -> str:
    # LIKE 里 _ 和 % 是通配符(误删学生账号那次的教训),必须转义
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def local_day(dt: Optional[datetime]) -> Optional[date]:
    """库里存的是 UTC naive,换成北京日"""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ).date()


def group_of(c: TutorConversation, today: date) -> str:
    if c.starred:
        return "starred"
    d = local_day(c.updated_at)
    if d is None:
        return "older"
    days = (today - d).days
    if days <= 0:
        return "today"
    if days < 3:
        return "3d"
    if days < 7:
        return "7d"
    if days < 30:
        return "30d"
    return "older"


def snippet_around(text: str, q: str) -> Optional[str]:
    """搜到的那句话截一小段给孩子看(命中的词前面留几个字)"""
    t = " ".join((text or "").split())
    i = t.casefold().find(q.casefold())
    if i < 0:
        return None
    start = max(0, i - 12)
    end = min(len(t), start + SNIPPET_LEN)
    return ("…" if start > 0 else "") + t[start:end] + ("…" if end < len(t) else "")


def item_out(c: TutorConversation, today: Optional[date] = None, questions: int = 0,
             snippet: Optional[str] = None) -> dict:
    return {"id": c.id, "title": c.title or "新对话", "message_count": c.message_count,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "starred": bool(c.starred), "group": group_of(c, today or local_today()),
            "questions": questions, "snippet": snippet}


async def list_page(db: AsyncSession, user_id: int, q: Optional[str], offset: int, limit: int) -> dict:
    """孩子自己的对话(删掉的不列): 收藏的在前,其余按最后一次提问倒序。
    q 搜标题和对话内容(孩子问的、小鹰老师答的都算),搜到内容的给一小段原话"""
    q = clean_query(q)
    stmt = select(TutorConversation).where(TutorConversation.user_id == user_id,
                                           TutorConversation.deleted_at.is_(None))
    pat = f"%{escape_like(q)}%"
    if q:
        in_text = select(TutorMessage.id).where(TutorMessage.conversation_id == TutorConversation.id,
                                                TutorMessage.text.like(pat, escape="\\")).exists()
        stmt = stmt.where(or_(TutorConversation.title.like(pat, escape="\\"), in_text))
    rows = (await db.execute(
        stmt.order_by(TutorConversation.starred.desc(), TutorConversation.updated_at.desc(),
                      TutorConversation.id.desc())
        .offset(offset).limit(limit + 1)
    )).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    ids = [c.id for c in rows]
    questions: dict[int, int] = {}
    snippets: dict[int, str] = {}
    if ids:
        questions = {cid: n for cid, n in (await db.execute(
            select(TutorMessage.conversation_id, func.count(TutorMessage.id))
            .where(TutorMessage.conversation_id.in_(ids), TutorMessage.role == "user")
            .group_by(TutorMessage.conversation_id))).all()}
        if q:
            first_hits = select(func.min(TutorMessage.id)).where(
                TutorMessage.conversation_id.in_(ids), TutorMessage.text.like(pat, escape="\\")
            ).group_by(TutorMessage.conversation_id)
            for cid, text in (await db.execute(
                select(TutorMessage.conversation_id, TutorMessage.text).where(TutorMessage.id.in_(first_hits))
            )).all():
                s = snippet_around(text, q)
                if s:
                    snippets[cid] = s
    today = local_today()
    return {"items": [item_out(c, today, questions.get(c.id, 0), snippets.get(c.id)) for c in rows],
            "has_more": has_more, "keep_days": KEEP_DAYS, "deleted_keep_days": DELETED_KEEP_DAYS}


async def purge_expired(db: Optional[AsyncSession] = None, now: Optional[datetime] = None) -> int:
    """真删到期的对话(规则见文件头)。返回删了几段"""
    from app.core.database import AsyncSessionLocal
    from app.services import tutor as tt

    now = now or utc_now()
    old = now - timedelta(days=KEEP_DAYS)
    gone = now - timedelta(days=DELETED_KEEP_DAYS)

    async def _run(s: AsyncSession) -> int:
        rows = (await s.execute(
            select(TutorConversation.id, TutorConversation.user_id).where(or_(
                and_(TutorConversation.deleted_at.isnot(None), TutorConversation.deleted_at < gone),
                and_(TutorConversation.deleted_at.is_(None), TutorConversation.starred == False,  # noqa: E712  (SQLite 存 0/1)
                     TutorConversation.updated_at < old),
            ))
        )).all()
        if not rows:
            return 0
        # 先建次数行再删消息,见文件头
        for uid in sorted({u for _, u in rows}):
            await tt._ensure_allowance(s, uid)
        ids = [cid for cid, _ in rows]
        for i in range(0, len(ids), PURGE_CHUNK):
            part = ids[i:i + PURGE_CHUNK]
            # 生产库外键是关的(PRAGMA foreign_keys=0),ondelete=CASCADE 不起作用,子表要自己删
            await s.execute(delete(TutorQuiz).where(TutorQuiz.conversation_id.in_(part)))
            await s.execute(delete(TutorMessage).where(TutorMessage.conversation_id.in_(part)))
            await s.execute(delete(TutorConversation).where(TutorConversation.id.in_(part)))
        await s.commit()
        return len(ids)

    if db is not None:
        return await _run(db)
    async with AsyncSessionLocal() as s:
        return await _run(s)


async def purge_quietly() -> int:
    """后台循环里调: 出错只记日志,不影响同一个循环里的别的活"""
    try:
        n = await purge_expired()
        if n:
            logger.info("学习助手对话到期清理 %s 段", n)
        return n
    except Exception as e:  # noqa: BLE001
        logger.error("学习助手对话到期清理出错: %s", e)
        return 0
