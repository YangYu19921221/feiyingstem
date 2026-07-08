"""AI 学情周报 — 家长端与教师端共享的聚合 + 缓存逻辑。

设计:
- 按 (学生, 本周一) 缓存到 weekly_reports 表,同一周家长/老师反复查看只调一次 LLM
- force=True 时强制重新生成并覆盖
- 数据全部读现有表 (LearningRecord / StudySession / WordMastery),不新增写入
- 时间口径复用 app.core.timeutil,与家长看板一致 (北京时间自然周)
"""
import json
from datetime import datetime, timedelta
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import select, func, and_, case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, local_day_utc_range
from app.models.user import User
from app.models.learning import LearningRecord, StudySession, WordMastery, WeeklyReport
from app.models.word import Word, WordDefinition
from app.services.ai_service import ai_service


# ================== 响应模型 (家长端 / 教师端共用) ==================

class WeeklyReportResponse(BaseModel):
    student_id: int
    week_start: str                 # 本周一 (YYYY-MM-DD)
    summary: str
    highlights: list[str]
    focus_areas: list[str]
    suggestions: list[str]
    stats_snapshot: dict            # 生成时的原始数字,前端可展示
    generated_at: Optional[str]     # 生成时间


def _to_response(report: WeeklyReport) -> WeeklyReportResponse:
    """ORM -> 响应模型 (Text JSON 字段反序列化)。"""
    def _load(raw, default):
        if not raw:
            return default
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return default

    return WeeklyReportResponse(
        student_id=report.user_id,
        week_start=report.week_start.isoformat(),
        summary=report.summary,
        highlights=_load(report.highlights, []),
        focus_areas=_load(report.focus_areas, []),
        suggestions=_load(report.suggestions, []),
        stats_snapshot=_load(report.stats_snapshot, {}),
        generated_at=report.created_at.isoformat() if report.created_at else None,
    )


# ================== 周期数据聚合 ==================

async def _period_stats(db: AsyncSession, student_id: int, start: datetime, end: datetime) -> dict:
    """某个 UTC 区间 [start, end) 内的时长/新词/正确率/学习天数/答题数。

    口径与 parent.py 的 period_stats 保持一致:
    - words: 答对且去重的 word_id 数 (新学单词)
    - accuracy: 正确题数 / 总题数
    """
    # 学习时长 (秒 -> 分)
    r = await db.execute(
        select(func.coalesce(func.sum(StudySession.time_spent), 0))
        .where(and_(StudySession.user_id == student_id,
                    StudySession.started_at >= start, StudySession.started_at < end))
    )
    minutes = int((r.scalar() or 0) / 60)

    # 新学单词 (答对去重)
    r = await db.execute(
        select(func.count(func.distinct(LearningRecord.word_id)))
        .where(and_(LearningRecord.user_id == student_id,
                    LearningRecord.created_at >= start, LearningRecord.created_at < end,
                    LearningRecord.is_correct.is_(True)))
    )
    words = int(r.scalar() or 0)

    # 正确率 + 答题总数
    r = await db.execute(
        select(func.count(LearningRecord.id),
               func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)))
        .where(and_(LearningRecord.user_id == student_id,
                    LearningRecord.created_at >= start, LearningRecord.created_at < end))
    )
    row = r.first()
    answered = row[0] or 0
    accuracy = int((row[1] or 0) * 100 / answered) if answered else 0

    # 学习天数 (有 StudySession 的自然日数,按北京时间日期分组)
    r = await db.execute(
        select(func.count(func.distinct(func.date(StudySession.started_at))))
        .where(and_(StudySession.user_id == student_id,
                    StudySession.started_at >= start, StudySession.started_at < end))
    )
    study_days = int(r.scalar() or 0)

    return {"minutes": minutes, "words": words, "accuracy": accuracy,
            "answered": answered, "study_days": study_days}


async def _mode_accuracy(db: AsyncSession, student_id: int, start: datetime, end: datetime) -> list[dict]:
    """本周各学习模式的正确率。"""
    r = await db.execute(
        select(LearningRecord.learning_mode,
               func.count(LearningRecord.id),
               func.sum(case((LearningRecord.is_correct.is_(True), 1), else_=0)))
        .where(and_(LearningRecord.user_id == student_id,
                    LearningRecord.created_at >= start, LearningRecord.created_at < end))
        .group_by(LearningRecord.learning_mode)
    )
    out = []
    for mode, total, correct in r.all():
        total = total or 0
        if total == 0:
            continue
        out.append({
            "mode": mode or "unknown",
            "answered": total,
            "accuracy": int((correct or 0) * 100 / total),
        })
    return out


async def _weak_words(db: AsyncSession, student_id: int, limit: int = 10) -> list[dict]:
    """错得最多的单词 TOP N (英文 + 中文释义 + 错误次数)。"""
    r = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, Word.id == WordMastery.word_id)
        .outerjoin(WordDefinition, and_(WordDefinition.word_id == Word.id,
                                        WordDefinition.is_primary.is_(True)))
        .where(and_(WordMastery.user_id == student_id, WordMastery.wrong_count > 0))
        .order_by(WordMastery.wrong_count.desc(), WordMastery.mastery_level.asc())
        .limit(limit)
    )
    return [
        {"word": w.word, "meaning": d.meaning if d else None, "wrong_count": m.wrong_count or 0}
        for m, w, d in r.all()
    ]


async def _new_mastered_this_week(db: AsyncSession, student_id: int, start: datetime, end: datetime) -> int:
    """本周新掌握单词数 (mastery_level>=3 且 updated_at 落在本周,近似口径)。"""
    r = await db.execute(
        select(func.count(WordMastery.id))
        .where(and_(WordMastery.user_id == student_id,
                    WordMastery.mastery_level >= 3,
                    WordMastery.updated_at >= start, WordMastery.updated_at < end))
    )
    return int(r.scalar() or 0)


# ================== 生成 + 缓存主流程 ==================

async def build_and_cache_weekly_report(
    db: AsyncSession,
    student_id: int,
    force: bool = False,
) -> WeeklyReportResponse:
    """获取或生成某学生本周的 AI 学情周报。

    force=False: 命中本周缓存则直接返回 (不打 LLM)
    force=True : 强制重新聚合 + 调 LLM + 覆盖缓存
    """
    today = local_today()
    monday = today - timedelta(days=today.weekday())

    # 1. 查缓存
    existing_res = await db.execute(
        select(WeeklyReport).where(and_(
            WeeklyReport.user_id == student_id,
            WeeklyReport.week_start == monday,
        ))
    )
    existing = existing_res.scalar_one_or_none()
    if existing and not force:
        return _to_response(existing)

    # 2. 学生姓名
    name_res = await db.execute(select(User).where(User.id == student_id))
    student = name_res.scalar_one_or_none()
    student_name = (student.full_name or student.username) if student else "孩子"

    # 3. 聚合本周 / 上周数据
    week_start, week_end = local_day_utc_range(monday)[0], local_day_utc_range(monday + timedelta(days=7))[0]
    last_week_start = local_day_utc_range(monday - timedelta(days=7))[0]

    this_week = await _period_stats(db, student_id, week_start, week_end)
    last_week = await _period_stats(db, student_id, last_week_start, week_start)
    mode_acc = await _mode_accuracy(db, student_id, week_start, week_end)
    weak = await _weak_words(db, student_id)
    new_mastered = await _new_mastered_this_week(db, student_id, week_start, week_end)

    report_data = {
        "student_name": student_name,
        "this_week": this_week,
        "last_week": last_week,
        "mode_accuracy": mode_acc,
        "weak_words": weak,
        "new_mastered": new_mastered,
    }

    # 4. 调 AI (失败时 ai_service 内部走规则兜底)
    ai_result = await ai_service.generate_weekly_report(report_data)

    stats_snapshot = {
        "this_week": this_week,
        "last_week": last_week,
        "mode_accuracy": mode_acc,
        "weak_words": weak,
        "new_mastered": new_mastered,
    }

    # 5. upsert 缓存
    if existing:
        existing.summary = ai_result["summary"]
        existing.highlights = json.dumps(ai_result["highlights"], ensure_ascii=False)
        existing.focus_areas = json.dumps(ai_result["focus_areas"], ensure_ascii=False)
        existing.suggestions = json.dumps(ai_result["suggestions"], ensure_ascii=False)
        existing.stats_snapshot = json.dumps(stats_snapshot, ensure_ascii=False)
        existing.created_at = datetime.utcnow()
        report = existing
    else:
        report = WeeklyReport(
            user_id=student_id,
            week_start=monday,
            summary=ai_result["summary"],
            highlights=json.dumps(ai_result["highlights"], ensure_ascii=False),
            focus_areas=json.dumps(ai_result["focus_areas"], ensure_ascii=False),
            suggestions=json.dumps(ai_result["suggestions"], ensure_ascii=False),
            stats_snapshot=json.dumps(stats_snapshot, ensure_ascii=False),
        )
        db.add(report)

    try:
        await db.commit()
    except IntegrityError:
        # 并发场景:家长和老师同时首次打开,两个请求都走到 INSERT,
        # 后提交的一个会撞 uq_weekly_report_user_week 唯一约束。
        # 回滚后回读已存在的那一行返回,避免 500。
        await db.rollback()
        again = await db.execute(
            select(WeeklyReport).where(and_(
                WeeklyReport.user_id == student_id,
                WeeklyReport.week_start == monday,
            ))
        )
        report = again.scalar_one()
        return _to_response(report)

    await db.refresh(report)
    return _to_response(report)
