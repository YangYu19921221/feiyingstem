"""陪跑看板 —— 每个孩子今天什么状态、该不该提醒、点评怎么写(唯一真源)

用户 2026-10-21「先把陪跑做起来」。先查的生产实情(近 28 天): 学过的 143 个孩子里 78 个只学了 1–2 天,
在家做的作业完成率 55%(电教室 68%),在学的孩子人均攒着 817 个到期没复习的词;而孩子回来练的时候,
隔 3 天以上再拼的词 92.9% 还拼得对。所以陪跑盯的是「回不回来、做没做完」,不是讲课。

状态(互斥,看板按这个顺序排,越靠前越该先管):
- absent      好几天没来: 最近一次学习在 ABSENT_DAYS ~ GONE_DAYS-1 天前 —— 最该拉回来的一批
- not_started 今天还没学: 最近来过,但今天一条学习记录都没有
- in_progress 今天学了但任务没做完
- done        今天的任务都做完了(今天没布置任务、但今天学过的也算这一档)
- gone        很久没来: GONE_DAYS 天以上没学或从没学过。生产主账号 206 个学生里 115 个是这一档
              (多是往期集训营、「未交费」班),跟 absent 混在一起会把能拉回来的 75 个埋掉,所以单列、排最后
另有一个不互斥的标记 struggling: 今天计分模式做了 ≥ STRUGGLE_MIN 题、正确率 < STRUGGLE_RATE。

口径都借现成的: 学词数 daily_words、学习时长 study_time、今日任务与 today_report 同口径
(今天布置、没关闭、含在家做的单词作业 + 今天开放的句子/音标视频/每日复习作业,
后者做没做完走 services/content_homework 那一份判定)、「最近一次学习」看 study_calendar
(每天学过就有一行,生产 14 天里每个有学习记录的日子都在日历里,反查 0 缺,且覆盖句子/音标)。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range
from app.models.autopilot import extra_homework_ids
from app.models.coach import CoachNote
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord, WordMastery
from app.models.user import ParentStudentLink, StudyCalendar, User
from app.models.word import Word
from app.services import content_homework as chw
from app.services import daily_review, daily_words, study_time
from app.services.weak_words import SCORING_MODES

ABSENT_DAYS = 2          # 隔了 2 天及以上没学 = 好几天没来
GONE_DAYS = 15           # 15 天以上没学 = 很久没来(多半已不在读)
STRUGGLE_MIN = 10        # 今天至少做了这么多计分题,正确率才有参考意义
STRUGGLE_RATE = 0.7
NOTE_MAX_LEN = 300
STATUS_ORDER = {"absent": 0, "not_started": 1, "in_progress": 2, "done": 3, "gone": 4}


def child_name(full_name: Optional[str], username: Optional[str]) -> str:
    """与前端 reportChildName 同口径: 姓名优先,用户名带数字(常是手机号)不用"""
    n = (full_name or "").strip()
    if n:
        return n
    u = (username or "").strip()
    return u if u and not any(ch.isdigit() for ch in u) else "孩子"


async def _last_days(db: AsyncSession, uids: list[int], today: date) -> tuple[dict[int, date], dict[int, int]]:
    """(最近一次学习的北京日, 近 7 天学了几天)"""
    learned = or_(func.coalesce(StudyCalendar.duration, 0) > 0, func.coalesce(StudyCalendar.words_learned, 0) > 0)
    last = {r.user_id: r.d for r in (await db.execute(
        select(StudyCalendar.user_id, func.max(StudyCalendar.study_date).label("d"))
        .where(StudyCalendar.user_id.in_(uids), learned)
        .group_by(StudyCalendar.user_id)
    )).all()}
    week = {r.user_id: int(r.n) for r in (await db.execute(
        select(StudyCalendar.user_id, func.count().label("n"))
        .where(StudyCalendar.user_id.in_(uids), learned,
               StudyCalendar.study_date > today - timedelta(days=7),
               StudyCalendar.study_date <= today)
        .group_by(StudyCalendar.user_id)
    )).all()}
    # SQLite 有时把 Date 列读回字符串
    return ({k: (date.fromisoformat(v) if isinstance(v, str) else v) for k, v in last.items()}, week)


def classify(last_day: Optional[date], today: date, tasks_total: int, tasks_done: int, studied_today: bool) -> str:
    if last_day is None or (today - last_day).days >= GONE_DAYS:
        return "gone"
    if (today - last_day).days >= ABSENT_DAYS:
        return "absent"
    if not studied_today and last_day < today:
        return "not_started"
    if tasks_total > 0 and tasks_done < tasks_total:
        return "in_progress"
    return "done"


async def board(db: AsyncSession, students: Iterable[User], class_of: dict[int, str], today: date) -> list[dict]:
    students = list(students)
    uids = [s.id for s in students]
    if not uids:
        return []
    start, end = local_day_utc_range(today)
    now = datetime.utcnow()

    last_day, week_days = await _last_days(db, uids, today)
    words = await daily_words.words_by_student(db, uids, start, end)
    secs = await study_time.seconds_by_student(db, uids, today, today)

    tasks = {r.student_id: (int(r.total), int(r.done or 0)) for r in (await db.execute(
        select(HomeworkStudentAssignment.student_id,
               func.count().label("total"),
               func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0)).label("done"))
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(HomeworkStudentAssignment.student_id.in_(uids),
               HomeworkAssignment.is_closed.is_(False),
               HomeworkAssignment.id.not_in(extra_homework_ids()),   # 小鹰老师的加练不算今天的任务
               HomeworkStudentAssignment.assigned_at >= start,
               HomeworkStudentAssignment.assigned_at < end)
        .group_by(HomeworkStudentAssignment.student_id)
    )).all()}

    # 句子/音标视频/每日复习作业: 今天开放、没关闭的也是今天的任务(不发金币,但老师布置了就是任务)
    links = list((await db.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomeworkStudent.student_id.in_(uids),
               ContentHomework.is_closed.is_(False),
               ContentHomework.available_from >= start,
               ContentHomework.available_from < end)
        .order_by(ContentHomework.id)
    )).all())
    if await chw.refresh_completion(db, links):
        await db.commit()
    names = await chw.target_names(db, [h for _, h in links])
    other_tasks: dict[int, list[dict]] = {}
    for link, hw in links:
        name = names.get((hw.kind, hw.target_id))
        if name is None:
            continue    # 内容被删了: 学生端也不显示这份,不算任务
        other_tasks.setdefault(link.student_id, []).append(
            {"kind": hw.kind, "label": chw.short_label(hw, name), "done": link.completed_at is not None})

    acc = {r.user_id: (int(r.n), int(r.ok or 0)) for r in (await db.execute(
        select(LearningRecord.user_id, func.count().label("n"),
               func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)).label("ok"))
        .where(LearningRecord.user_id.in_(uids),
               LearningRecord.created_at >= start, LearningRecord.created_at < end,
               LearningRecord.learning_mode.in_(SCORING_MODES))
        .group_by(LearningRecord.user_id)
    )).all()}
    studied = set((await db.execute(
        select(LearningRecord.user_id).where(
            LearningRecord.user_id.in_(uids),
            LearningRecord.created_at >= start, LearningRecord.created_at < end,
        ).distinct()
    )).scalars())

    review_due = {r.user_id: int(r.n) for r in (await db.execute(
        select(WordMastery.user_id, func.count().label("n"))
        .where(WordMastery.user_id.in_(uids), WordMastery.next_review_at.is_not(None),
               WordMastery.next_review_at <= now)
        .group_by(WordMastery.user_id)
    )).all()}

    notes = {n.student_id: n for n in (await db.execute(
        select(CoachNote).where(CoachNote.student_id.in_(uids), CoachNote.note_date == today)
    )).scalars()}

    # 今天计分模式里错过的词(起草点评用),按拼写去重、按第一次错的先后
    weak: dict[int, list[str]] = {}
    for uid, w in (await db.execute(
        select(LearningRecord.user_id, Word.word)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(LearningRecord.user_id.in_(uids),
               LearningRecord.created_at >= start, LearningRecord.created_at < end,
               LearningRecord.learning_mode.in_(SCORING_MODES),
               LearningRecord.is_correct.is_(False))
        .order_by(LearningRecord.created_at, LearningRecord.id)
    )).all():
        lst = weak.setdefault(uid, [])
        if w and w not in lst and len(lst) < 5:
            lst.append(w)

    review = await daily_review.status_for_students(db, uids, today)

    bound = set((await db.execute(
        select(ParentStudentLink.student_id).where(ParentStudentLink.student_id.in_(uids)).distinct()
    )).scalars())

    out = []
    for s in students:
        word_total, word_done = tasks.get(s.id, (0, 0))
        others = other_tasks.get(s.id, [])
        total = word_total + len(others)
        done = word_done + sum(1 for t in others if t["done"])
        ld = last_day.get(s.id)
        n_scored, n_ok = acc.get(s.id, (0, 0))
        rate = (n_ok / n_scored) if n_scored else None
        status = classify(ld, today, total, done, s.id in studied)
        note = notes.get(s.id)
        row = {
            "id": s.id,
            "name": child_name(s.full_name, s.username),
            "full_name": s.full_name or "",
            "username": s.username,
            "class_name": class_of.get(s.id, ""),
            "status": status,
            "struggling": bool(n_scored >= STRUGGLE_MIN and rate is not None and rate < STRUGGLE_RATE),
            "last_study_day": ld.isoformat() if ld else None,
            "days_since": (today - ld).days if ld else None,
            "week_days": week_days.get(s.id, 0),
            "tasks_total": total,
            "tasks_done": done,
            # 其中句子/音标视频/每日复习作业那几份(单词作业不在这里列)
            "other_tasks": others,
            "words_today": words.get(s.id, 0),
            "minutes_today": secs.get(s.id, 0) // 60,
            "scored_today": n_scored,
            "accuracy_today": round(rate * 100) if rate is not None else None,
            "review_due": review_due.get(s.id, 0),
            # 今天那一份每日复习: None = 今天还没打开过复习
            "daily_review": review.get(s.id),
            "weak_today": weak.get(s.id, []),
            "parent_bound": s.id in bound,
            "note": None if note is None else {
                "content": note.content,
                "author_name": note.author_name or "",
                "read_by_student": note.read_by_student_at is not None,
                "read_by_parent": note.read_by_parent_at is not None,
            },
        }
        row["draft"] = draft_note(row, row["weak_today"])
        row["remind"] = remind_text(row)
        out.append(row)
    out.sort(key=_sort_key)
    return out


def _sort_key(x: dict):
    """越该先管的越靠前。「好几天没来」里刚断两三天的排前面 —— 最拉得回来;
    「很久没来」里从没学过的排最后(多半是还没正式开始上课的号)"""
    if x["status"] in ("absent", "gone"):
        gap = x["days_since"] if x["days_since"] is not None else 10 ** 6
    else:
        gap = 0
    return (STATUS_ORDER[x["status"]], gap, not x["struggling"], x["class_name"], x["name"])


def draft_note(row: dict, weak_words: list[str]) -> str:
    """按看板那一行 + 今天错过的词起草一句点评。只写看得见的事实和明天能做的一件事,不评价孩子聪不聪明。"""
    name = row["name"] if row["name"] != "孩子" else ""
    hi = f"{name}," if name else ""
    parts: list[str] = []
    st = row["status"]
    total, done = row["tasks_total"], row["tasks_done"]
    if st in ("absent", "gone"):
        if row["days_since"] is None:
            parts.append(f"{hi}还没开始背单词,今天先学 15 分钟试试")
        else:
            parts.append(f"{hi}已经 {row['days_since']} 天没来背单词了,今天抽 15 分钟回来练一下")
    elif st == "not_started":
        parts.append(f"{hi}今天的 {total} 份任务还没开始,记得完成" if total else f"{hi}今天还没开始学,记得来练一会儿")
    elif st == "in_progress":
        left = list(dict.fromkeys(t["label"] for t in row.get("other_tasks", []) if not t["done"]))
        which = f"({'、'.join(left[:2])}还没做)" if left else ""
        if done:
            parts.append(f"{hi}今天完成了 {done}/{total} 份任务,还差 {total - done} 份{which},加油")
        else:
            parts.append(f"{hi}今天学了 {row['words_today']} 个词,{total} 份任务还没做完{which},加油")
    else:
        if total:
            parts.append(f"{hi}今天 {total} 份任务全部完成,学了 {row['words_today']} 个词")
        else:
            parts.append(f"{hi}今天学了 {row['words_today']} 个词、{row['minutes_today']} 分钟")
        if row["accuracy_today"] is not None and row["scored_today"] >= STRUGGLE_MIN and row["accuracy_today"] >= 90:
            parts.append(f"拼写正确率 {row['accuracy_today']}%,很稳")
    if weak_words:
        parts.append(f"{'、'.join(weak_words[:3])} 拼错了,明天再写两遍")
    dr = row.get("daily_review")
    if dr and dr["total"] and dr["completed"] and st not in ("absent", "gone"):
        parts.append(f"今天的 {dr['total']} 个复习词也做完了")
    elif (row["review_due"] > 0 and st not in ("absent", "gone")
          and not any(t["kind"] == "daily_review" and not t["done"] for t in row.get("other_tasks", []))):
        # 今天就有一份没做完的每日复习作业时,上面已经点名了,这里不再说一遍
        parts.append("明天先把「今日复习」的 20 个词做完")
    return "。".join(parts)[:NOTE_MAX_LEN] + "。"


def remind_text(row: dict) -> str:
    """复制给家长的微信提醒(生产没配短信也没接服务号,只能老师自己发)"""
    name = row["name"] if row["name"] != "孩子" else "孩子"
    if row["status"] in ("absent", "gone"):
        if row["days_since"] is None:
            body = f"{name}还没有开始在「飞鹰AI英语」背单词"
        else:
            body = f"{name}已经 {row['days_since']} 天没有背单词了"
        ask = "麻烦您提醒孩子今天抽 15 分钟学一下,隔天复习一次比一次学很多更记得住。"
    elif row["status"] == "not_started":
        body = f"{name}今天的 {row['tasks_total']} 份学习任务还没开始" if row["tasks_total"] else f"{name}今天还没有学习"
        ask = "麻烦您提醒孩子今天完成,谢谢。"
    elif row["status"] == "in_progress":
        body = f"{name}今天完成了 {row['tasks_done']}/{row['tasks_total']} 份学习任务"
        left = list(dict.fromkeys(t["label"] for t in row.get("other_tasks", []) if not t["done"]))
        which = f"(其中有{'、'.join(left[:3])})" if left else ""
        ask = f"还差 {row['tasks_total'] - row['tasks_done']} 份{which},麻烦您提醒孩子做完,谢谢。"
    else:
        body = f"{name}今天的任务都完成了"
        ask = "辛苦您多鼓励孩子。"
    return f"{name}家长您好,{body}。{ask}"
