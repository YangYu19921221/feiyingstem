"""「今日学习报告」—— 孩子做完当天全部任务后发给家长的那张分享图的数据(唯一真源)

用户 2026-10-18:「你应该增加个他背完所有任务的分享」。分类学习结算页那张「学习报告」只管一个单元,
一天布置三份任务就得发三张;这张是一天一张,写今天完成了哪些任务、学了多少词、哪些词还要多练。

口径:
- 今天的任务 = 今天布置(assigned_at 落在北京今天)且没被老师关闭的作业,**含在家做的**。
  金币分母排除家里作业(那是「电教室才给币」的规则),但给家长看的是「老师布置了什么」,家里的也是任务。
  当日任务的 assigned_at 已对齐到开放时刻,所以「今天布置」= 今天开放的。
- 全部完成 = 今天的任务至少一份,且每份 status='completed'(达到目标分)。次数用完没达标的(failed)不算。
- 今天补做完成的旧任务也列出来(is_today=False,图上标「补做」),不参与「全部完成」的判定。
- 句子/音标视频/每日复习作业(content_homework)今天开放的也是今天的任务(kind 区分,没有分数);
  做没做完走 services/content_homework 那一份判定,与作业页、陪跑看板同一个结论。
- 学了多少词 / 学了多久 走全站唯一口径 daily_words / study_time,不在这里另算。
- 还要多练 = 今天在计分模式(weak_words.SCORING_MODES)里答错过的词,按拼写去重(同一拼写在不同单元有不同
  word_id);「写成什么」取当天第一次答错的输入,只认拼写类模式(选择题的 user_answer 是选项,不是拼写)。
"""
import re
from datetime import date, timedelta

from sqlalchemy import select, and_, or_
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range
from app.models.autopilot import extra_homework_ids
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.organization import Organization
from app.models.user import User
from app.models.word import Unit, WordBook, Word, WordDefinition
from app.services import content_homework as chw
from app.services.daily_words import words_on_day
from app.services.study_time import seconds_on_day
from app.services.weak_words import SCORING_MODES

# 这几种模式的 user_answer 是孩子拼出来的词,能写「写成了 xxx」
SPELLING_MODES = ("spelling", "handwriting", "fillblank", "sentencefill")
_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
MAX_WEAK = 200


def _wrote_of(mode: str | None, answer: str | None, word: str) -> str | None:
    if mode not in SPELLING_MODES:
        return None
    wrote = (answer or "").strip()
    if not wrote or wrote == word or _CJK.search(wrote):
        return None
    return wrote[:60]


async def _content_tasks(db: AsyncSession, user_id: int, day_start: datetime, day_end: datetime) -> list[dict]:
    """句子/音标视频/每日复习作业: 今天开放的 + 之前开放、今天做完的(补做)。
    先现判一遍完成(可能会写 completed_at,这里提交),再按今天的窗口筛"""
    links = list((await db.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomeworkStudent.student_id == user_id,
               ContentHomework.is_closed.is_(False),
               ContentHomework.available_from < day_end,
               ContentHomework.available_from >= day_start - timedelta(days=30),
               or_(ContentHomework.available_from >= day_start,
                   ContentHomeworkStudent.completed_at.is_(None),
                   ContentHomeworkStudent.completed_at >= day_start))
        .order_by(ContentHomework.available_from, ContentHomework.id)
    )).all())
    if await chw.refresh_completion(db, links):
        await db.commit()
    names = await chw.target_names(db, [h for _, h in links])
    out = []
    for s, h in links:
        name = names.get((h.kind, h.target_id))
        if name is None:
            continue    # 内容被删了: 学生端也不显示
        is_today = day_start <= h.available_from < day_end
        done_today = s.completed_at is not None and day_start <= s.completed_at < day_end
        if not is_today and not done_today:
            continue
        out.append({
            "id": s.id,
            "kind": h.kind,
            "title": h.title,
            "book_name": chw.KIND_LABEL.get(h.kind, h.kind),
            "unit_name": name,
            "group_index": None,
            "learning_mode": h.kind,
            "status": "completed" if s.completed_at is not None else "pending",
            "best_score": 0,
            "target_score": 0,
            # 没有电教室/家里之分(这类作业本来就不发金币),空串 = 图上不写「在家做」
            "location_type": "",
            "is_today": is_today,
            "completed_time": (s.completed_at + timedelta(hours=8)).strftime("%H:%M") if done_today else None,
        })
    return out


async def build_today_report(db: AsyncSession, user: User, d: date) -> dict:
    day_start, day_end = local_day_utc_range(d)

    rows = (await db.execute(
        select(HomeworkStudentAssignment, HomeworkAssignment, Unit, WordBook)
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .join(Unit, Unit.id == HomeworkAssignment.unit_id)
        .join(WordBook, WordBook.id == Unit.book_id)
        .where(and_(
            HomeworkStudentAssignment.student_id == user.id,
            HomeworkAssignment.is_closed.is_(False),
            HomeworkAssignment.id.not_in(extra_homework_ids()),   # 小鹰老师的加练不算今天的任务
            or_(
                and_(HomeworkStudentAssignment.assigned_at >= day_start,
                     HomeworkStudentAssignment.assigned_at < day_end),
                and_(HomeworkStudentAssignment.status == "completed",
                     HomeworkStudentAssignment.completed_at >= day_start,
                     HomeworkStudentAssignment.completed_at < day_end),
            ),
        ))
        .order_by(HomeworkStudentAssignment.assigned_at, HomeworkStudentAssignment.id)
    )).all()

    tasks = []
    for sa, hw, unit, book in rows:
        is_today = sa.assigned_at is not None and day_start <= sa.assigned_at < day_end
        tasks.append({
            "id": sa.id,
            "kind": "word",
            "title": hw.title,
            "book_name": book.name,
            "unit_name": unit.name,
            "group_index": hw.group_index,
            "learning_mode": hw.learning_mode,
            "status": sa.status,
            "best_score": int(sa.best_score or 0),
            "target_score": int(hw.target_score or 0),
            "location_type": hw.location_type or "classroom",
            "is_today": is_today,
            "completed_time": (
                (sa.completed_at + timedelta(hours=8)).strftime("%H:%M")
                if sa.status == "completed" and sa.completed_at else None
            ),
        })
    tasks += await _content_tasks(db, user.id, day_start, day_end)
    # 今天的排前面,补做的排后面
    tasks.sort(key=lambda t: not t["is_today"])
    today_tasks = [t for t in tasks if t["is_today"]]
    today_done = sum(1 for t in today_tasks if t["status"] == "completed")

    recs = (await db.execute(
        select(LearningRecord.word_id, LearningRecord.is_correct, LearningRecord.user_answer,
               LearningRecord.learning_mode, Word.word)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id == user.id,
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
            LearningRecord.learning_mode.in_(SCORING_MODES),
        ))
        .order_by(LearningRecord.created_at, LearningRecord.id)
    )).all()
    scored: set[str] = set()
    weak: dict[str, dict] = {}
    for r in recs:
        key = (r.word or "").strip().lower()
        if not key:
            continue
        scored.add(key)
        if not r.is_correct and key not in weak:
            weak[key] = {"word_id": r.word_id, "word": r.word,
                         "wrote": _wrote_of(r.learning_mode, r.user_answer, r.word)}
        elif not r.is_correct and weak[key]["wrote"] is None:
            # 第一次错在选择题(没有拼写),之后拼错的那次能告诉家长孩子写成了什么
            weak[key]["wrote"] = _wrote_of(r.learning_mode, r.user_answer, r.word)

    weak_list = list(weak.values())[:MAX_WEAK]
    ids = [w["word_id"] for w in weak_list]
    meanings: dict[int, str] = {}
    if ids:
        defs = (await db.execute(
            select(WordDefinition.word_id, WordDefinition.meaning)
            .where(WordDefinition.word_id.in_(ids))
            .order_by(WordDefinition.word_id, WordDefinition.is_primary.desc(), WordDefinition.id)
        )).all()
        for wid, meaning in defs:
            meanings.setdefault(wid, meaning)

    org = await db.get(Organization, user.org_id) if user.org_id else None

    return {
        "date": d.isoformat(),
        "org_name": org.name if org else None,
        "all_done": len(today_tasks) > 0 and today_done == len(today_tasks),
        "today_total": len(today_tasks),
        "today_done": today_done,
        "tasks": tasks,
        "words_learned": await words_on_day(db, user.id, d),
        "study_seconds": await seconds_on_day(db, user.id, d),
        "scored_words": len(scored),
        "never_wrong": len(scored) - len(weak),
        "weak_total": len(weak),
        "weak": [{"word": w["word"], "meaning": meanings.get(w["word_id"]), "wrote": w["wrote"]}
                 for w in weak_list],
    }
