"""学习助手看到的「学情档案」(2026-10-27,用户「这个 agent 还知道这个学生在我们系统的学习情况,你看看怎么设计好点」)

每次提问,小鹰老师都带着一份**这个孩子自己的**学情摘要回答: 在学哪本书哪几个单元、一共学过多少词掌握多少、
这周学了几天、正确率、复习欠了多少、**拼写上的固定毛病**(该写 ie 常写成 ei)、常错的词、老师最近的点评。
孩子问「我这周学得怎么样」「我进步了吗」时,再用工具 get_my_progress 查两周的明细。

## 口径: 一个数都不新算
每个数都读系统里已有的唯一真源,和老师端 / 家长端 / 陪跑看板看到的是同一个数 ——
学情时长那次五套算法差 250 倍的教训(见 services/study_time 文件头):
- 学过 / 掌握 / 要加强: weak_words.mastery_buckets(老师端学情、家长端同一份)
- 这周学了几天、最近一次学习: coach._last_days(陪跑看板同一份,看 study_calendar)
- 学词数: daily_words.words_total;时长: study_time.seconds_total
- 正确率: 只算计分模式(weak_words.SCORING_MODES),分类自评不算
- 复习欠账: learning_records.compute_review_progress(学生 / 家长 / 老师同一份)
- 拼写毛病: utils/spelling_diff.first_diff_chunk(错题诊断页同一份)

## 隐私
- 只查这个孩子自己的数据;不放姓名、学校、手机号
- 老师点评里常带孩子名字(陪跑草稿开头就是「小明,」),放进来前把名字换成「你」
- 老师在学生详情页「问小鹰老师」里能看到这份摘要原文(助手知道什么,老师就知道什么)

## 省钱
- 摘要控制在 600 字以内(每问都要带)
- 慢的那部分(累计、拼写毛病、点评)缓存 10 分钟;今天的任务每次现算(孩子刚做完就问「我做完了吗」)
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import local_day_utc_range, local_today
from app.models.learning import LearningProgress, LearningRecord
from app.models.user import User
from app.models.word import BookStage, Unit, Word, WordBook
from app.utils.spelling_diff import first_diff_chunk

logger = logging.getLogger(__name__)

CACHE_SEC = 600
MAX_LEN = 600
SPELL_MODES = ("spelling", "handwriting", "fillblank", "sentencefill")


def _cache_key(user_id: int) -> str:
    return f"tutor:profile:{user_id}"


def strip_names(text: str, user: User) -> str:
    """把孩子的姓名 / 用户名从文字里去掉(老师点评开头常写「小明,」)"""
    out = text or ""
    for n in {(user.full_name or "").strip(), (user.username or "").strip()}:
        if len(n) >= 2:
            out = out.replace(n + ",", "").replace(n + ",", "").replace(n, "你")
    return out.strip(" ,,")


async def _recent_units(db: AsyncSession, user_id: int) -> tuple[str, list[str]]:
    """(学段, 最近在学的几个单元「书名 单元名」)"""
    rows = (await db.execute(
        select(WordBook.name, Unit.name, BookStage.name)
        .select_from(LearningProgress)
        .join(WordBook, WordBook.id == LearningProgress.book_id)
        .outerjoin(Unit, Unit.id == LearningProgress.unit_id)
        .outerjoin(BookStage, BookStage.id == WordBook.stage_id)
        .where(LearningProgress.user_id == user_id)
        .order_by(LearningProgress.last_studied_at.desc().nullslast(), LearningProgress.id.desc())
        .limit(12)
    )).all()
    stage = next((r[2] for r in rows if r[2]), None) or "中小学"
    units: list[str] = []
    for book, unit, _ in rows:
        label = f"《{book}》{unit or ''}".strip()
        if label not in units:
            units.append(label)
        if len(units) >= 3:
            break
    return stage, units


async def scoring_accuracy(db: AsyncSession, user_id: int, start_day: date, end_day: date) -> tuple[int, int]:
    """(计分题数, 答对数),北京日 [start_day, end_day]"""
    start, _ = local_day_utc_range(start_day)
    _, end = local_day_utc_range(end_day)
    from app.services.weak_words import SCORING_MODES

    total, right = (await db.execute(
        select(func.count(LearningRecord.id),
               func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)))
        .where(LearningRecord.user_id == user_id, LearningRecord.learning_mode.in_(SCORING_MODES),
               LearningRecord.created_at >= start, LearningRecord.created_at < end)
    )).one()
    return int(total or 0), int(right or 0)


async def spelling_habits(db: AsyncSession, user_id: int, limit: int = 3) -> list[dict]:
    """拼写上的固定毛病: 最近 200 次拼错里,同一种「该写 X 写成 Y」出现 ≥2 次的,按次数排"""
    rows = (await db.execute(
        select(LearningRecord.user_answer, Word.word)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(LearningRecord.user_id == user_id, LearningRecord.is_correct.is_(False),
               LearningRecord.learning_mode.in_(SPELL_MODES),
               LearningRecord.user_answer.isnot(None), LearningRecord.user_answer != "")
        .order_by(LearningRecord.id.desc()).limit(200)
    )).all()
    stats: dict[tuple[str, str], dict] = defaultdict(lambda: {"count": 0, "examples": []})
    for got_raw, expect_raw in rows:
        expect, got = (expect_raw or "").strip().lower(), (got_raw or "").strip().lower()
        if not expect or not got or got == expect:
            continue
        pair = first_diff_chunk(expect, got)
        if pair:
            s = stats[pair]
            s["count"] += 1
            if expect not in s["examples"] and len(s["examples"]) < 2:
                s["examples"].append(expect)
    return [{"should": e, "wrote": g, "times": s["count"], "examples": s["examples"]}
            for (e, g), s in sorted(stats.items(), key=lambda kv: -kv[1]["count"])[:limit] if s["count"] >= 2]


async def _latest_coach_note(db: AsyncSession, user: User) -> Optional[tuple[date, str]]:
    from app.models.coach import CoachNote

    row = (await db.execute(
        select(CoachNote.note_date, CoachNote.content)
        .where(CoachNote.student_id == user.id, CoachNote.note_date >= local_today() - timedelta(days=7))
        .order_by(CoachNote.note_date.desc(), CoachNote.id.desc()).limit(1)
    )).first()
    if not row or not (row[1] or "").strip():
        return None
    d = row[0] if isinstance(row[0], date) else date.fromisoformat(str(row[0]))
    return d, strip_names(row[1], user)[:80]


def _ago(d: Optional[date], today: date) -> str:
    if d is None:
        return "还没开始学"
    n = (today - d).days
    return "今天" if n <= 0 else "昨天" if n == 1 else f"{n} 天前"


async def _slow_lines(db: AsyncSession, user: User) -> list[str]:
    """不常变的部分(缓存 10 分钟)"""
    from app.api.v1.student.learning_records import compute_review_progress
    from app.services import coach, daily_words, study_time
    from app.services.tutor import _recent_wrong_spellings
    from app.services.weak_words import mastery_buckets, top_wrong_words

    today = local_today()
    lines: list[str] = []
    stage, units = await _recent_units(db, user.id)
    lines.append(f"- 学段: {stage}" + (f";最近在学: {'、'.join(units)}" if units else ""))

    b = (await mastery_buckets(db, [user.id])).get(user.id)
    if b and b["words"]:
        lines.append(f"- 一共学过 {b['words']} 个词: 已经掌握 {b['mastered']} 个,"
                     f"要加强 {b['weak']} 个(错过还没练稳),刚学还没定 {b['pending']} 个")

    last, week = await coach._last_days(db, [user.id], today)
    w_start, _ = local_day_utc_range(today - timedelta(days=6))
    _, w_end = local_day_utc_range(today)
    words7 = await daily_words.words_total(db, [user.id], w_start, w_end)
    mins7 = round(await study_time.seconds_total(db, user.id, today - timedelta(days=6), today) / 60)
    lines.append(f"- 近 7 天学了 {week.get(user.id, 0)} 天、{words7} 个词、约 {mins7} 分钟;"
                 f"最近一次学习: {_ago(last.get(user.id), today)}")

    n14, r14 = await scoring_accuracy(db, user.id, today - timedelta(days=13), today)
    if n14 >= 10:
        lines.append(f"- 近 14 天做了 {n14} 道计分题,正确率 {round(r14 * 100 / n14)}%")

    try:
        rv = await compute_review_progress(db, user.id)
        due = int(rv.get("review_due_today") or 0)
        if due:
            lines.append(f"- 到期还没复习的词: {due} 个(首页「今日复习」每天一份 20 个)")
    except Exception:  # noqa: BLE001
        logger.exception("学情档案取复习进度失败 user=%s", user.id)

    habits = await spelling_habits(db, user.id)
    if habits:
        lines.append("- 拼写上的固定毛病: " + ";".join(
            f"该写「{h['should']}」常写成「{h['wrote']}」{h['times']} 次(如 {'、'.join(h['examples'])})" for h in habits))

    top = await top_wrong_words(db, user.id, limit=5)
    if top:
        wrote = await _recent_wrong_spellings(db, user.id, [t["word"] for t in top])
        lines.append("- 最近常错的词: " + ",".join(
            t["word"] + (f"(写成过 {'、'.join(wrote[t['word'].lower()])})" if wrote.get(t["word"].lower()) else "")
            for t in top))

    note = await _latest_coach_note(db, user)
    if note:
        lines.append(f"- 老师 {note[0].month}月{note[0].day}日的点评: {note[1]}")
    return lines


async def _today_lines(db: AsyncSession, user: User) -> list[str]:
    """今天的任务(每次现算)"""
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    from app.services import daily_review

    start, end = local_day_utc_range(local_today())
    total, done = (await db.execute(
        select(func.count(HomeworkStudentAssignment.id),
               func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0)))
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(HomeworkStudentAssignment.student_id == user.id, HomeworkAssignment.is_closed.is_(False),
               HomeworkStudentAssignment.assigned_at >= start, HomeworkStudentAssignment.assigned_at < end)
    )).one()
    lines = [f"- 今天老师布置的单词任务: {int(total or 0)} 份,做完 {int(done or 0)} 份(详细用 get_today_tasks 查)"]
    rv = await daily_review.status(db, user.id, create=False)
    if rv.get("started") and rv["total"]:
        lines.append(f"- 今天的每日复习: {rv['total']} 个,做了 {rv['done']} 个")
    # 小鹰老师自己的笔记(services/tutor_notes): 每次现算,孩子刚做完练习就问要是新的
    from app.services import tutor_notes
    note = await tutor_notes.profile_line(db, user.id)
    if note:
        lines.append(note)
    return lines


async def profile_lines(db: AsyncSession, user: User, *, use_cache: bool = True) -> list[str]:
    slow: Optional[list[str]] = None
    if use_cache:
        cached = await store.get(_cache_key(user.id))
        if cached:
            try:
                slow = json.loads(cached)
            except ValueError:
                slow = None
    if slow is None:
        try:
            slow = await _slow_lines(db, user)
        except Exception:  # noqa: BLE001
            logger.exception("学情档案失败 user=%s", user.id)
            slow = []
        if use_cache:
            await store.set(_cache_key(user.id), json.dumps(slow, ensure_ascii=False), CACHE_SEC)
    try:
        today = await _today_lines(db, user)
    except Exception:  # noqa: BLE001
        logger.exception("学情档案取今天任务失败 user=%s", user.id)
        today = []
    return slow + today


def render(lines: list[str]) -> str:
    """超长时从前面的慢变部分砍,**最后一行(小鹰老师的笔记 / 今天的任务)一定留着**"""
    body = "\n".join(lines)
    if len(body) <= MAX_LEN:
        return body
    keep = [ln for ln in lines if ln.startswith("- 小鹰老师的笔记") or ln.startswith("- 今天")]
    rest = [ln for ln in lines if ln not in keep]
    budget = MAX_LEN - len("\n".join(keep)) - 1
    head = "\n".join(rest)[:max(0, budget)].rsplit("\n", 1)[0] if budget > 0 else ""
    return "\n".join([x for x in (head, "\n".join(keep)) if x])


async def my_progress(db: AsyncSession, user: User) -> dict:
    """工具 get_my_progress: 两周明细 + 这周和上周比 + 在学单元的进度。孩子问「我学得怎么样 / 进步了吗」时用"""
    from app.services import daily_words, study_time

    today = local_today()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    words = await daily_words.words_by_day(db, user.id, days)
    secs = await study_time.seconds_by_day(db, user.id, days)

    async def week(ds: list[date]) -> dict:
        n, r = await scoring_accuracy(db, user.id, ds[0], ds[-1])
        return {"study_days": sum(1 for d in ds if (words.get(d) or 0) > 0 or (secs.get(d) or 0) > 0),
                "words": sum(words.get(d) or 0 for d in ds),
                "minutes": round(sum(secs.get(d) or 0 for d in ds) / 60),
                "scored_questions": n,
                # 题太少的正确率没意义(做 3 道错 1 道就成了 67%)
                "accuracy": round(r * 100 / n) if n >= 10 else None}

    last_w, this_w = await week(days[:7]), await week(days[7:])

    rows = (await db.execute(
        select(WordBook.name, Unit.name, LearningProgress.learning_mode,
               LearningProgress.completed_words, LearningProgress.total_words, LearningProgress.is_completed)
        .select_from(LearningProgress)
        .join(WordBook, WordBook.id == LearningProgress.book_id)
        .outerjoin(Unit, Unit.id == LearningProgress.unit_id)
        .where(LearningProgress.user_id == user.id)
        .order_by(LearningProgress.last_studied_at.desc().nullslast(), LearningProgress.id.desc()).limit(6)
    )).all()
    return {
        "this_week": this_w, "last_week": last_w,
        "daily": [{"date": f"{d.month}/{d.day}", "words": words.get(d) or 0,
                   "minutes": round((secs.get(d) or 0) / 60)} for d in days],
        "recent_units": [{"unit": f"《{b}》{u or ''}", "mode": m, "done": int(c or 0), "total": int(t or 0),
                          "finished": bool(f)} for b, u, m, c, t, f in rows],
        "spelling_habits": await spelling_habits(db, user.id),
        "note": "这周和上周比,有进步就具体地夸(多学了几天、多几个词、正确率高了几分);没进步不批评,给一个下周能做到的小目标",
    }


async def invalidate(user_id: int) -> None:
    await store.delete(_cache_key(user_id))


