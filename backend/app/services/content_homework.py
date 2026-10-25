"""句子 / 音标视频 / 每日复习作业: 做没做完、叫什么(唯一真源)

作业接口(api/v1/content_homework)、陪跑看板(services/coach)、今日学习报告(services/today_report)
都从这里判「做没做完」—— 三处各判一遍的话,同一个孩子作业页说做完了、看板还说没做完。
数据模型与为什么单开一张表见 models/content_homework。

完成**不由前端报**: 按真实学习数据现判,判到学完就写 completed_at(只写不清):
- 句子: 这个单元全部组过关(sentence_unit_progress.completed_at 非空),且**在作业开放之后**
  有过一次过关 —— 以前学过一遍的不能直接算这份作业完成(老师布置复习就是要孩子再练一遍)。
  completed_at 重学不清,开放后的过关看 updated_at: 每次组过关都会写 best_score → 刷新 updated_at。
  口径是「全部组都过过 + 开放后又过了至少一组」—— 学过的孩子复习时从第 1 组重来,过第 1 组就算;
  要求开放后把每一组重过一遍的话得给每组记时间,那张表没有,而且对复习作业来说过严了
- 视频: phonetic_video_views.completed(services/video_watch.is_completed 判的),看完就算,
  不要求开放后重看(视频看完一遍就是看过了,强制重看只会让孩子拖进度条)。
  完成时刻取 max(作业开放, 最后一次观看),不取「被判到的那一刻」—— 昨晚看完、今早才有人打开作业页,
  今日报告会把它写成「今天补做」。开放前就看完的,算开放那一刻完成
- 每日复习: 开放那天的那一份(services/daily_review)全做完,完成时刻取那一份做完的时刻。
  只认那一天 —— 「今天的 20 个」隔天就换了一批,补做不了,所以这类作业恒为当天截止
- 例句跟读: 作业开放后在这个单词单元读满一轮(services/read_aloud.completion_times),
  完成时刻取读满那一句的时刻。只判读没读、不判读得对不对(第一版识别没验证过)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_homework import (
    KIND_DAILY_REVIEW, KIND_PHONETIC_VIDEO, KIND_READ_ALOUD, KIND_SENTENCE, ContentHomework, ContentHomeworkStudent,
)
from app.models.phonetic import PhoneticVideo, PhoneticVideoView
from app.models.sentence import SentenceBook, SentenceUnit
from app.models.sentence_learning import SentenceUnitProgress
from app.models.word import Unit, WordBook
from app.services import daily_review, read_aloud

KIND_LABEL = {KIND_SENTENCE: "句子背诵", KIND_PHONETIC_VIDEO: "音标视频", KIND_DAILY_REVIEW: "每日复习",
              KIND_READ_ALOUD: "例句跟读"}
DAILY_REVIEW_NAME = f"今天的 {daily_review.DAILY_SIZE} 个复习词"

Link = tuple[ContentHomeworkStudent, ContentHomework]


def open_day(h: ContentHomework) -> date:
    """作业开放的北京日(available_from 存的是那天 0 点对应的 UTC)"""
    return (h.available_from + timedelta(hours=8)).date()


def status(s: ContentHomeworkStudent, h: ContentHomework, now: datetime) -> str:
    if s.completed_at is not None:
        return "completed"
    if now < h.available_from:
        return "locked"
    if h.deadline is not None and now > h.deadline:
        return "overdue"
    return "pending"


async def target_names(db: AsyncSession, rows: Iterable[ContentHomework]) -> dict[tuple[str, int], str]:
    """批量取目标名(不按行查)。目标被删了的不在结果里,调用方决定显示「(已删除)」还是跳过"""
    rows = list(rows)
    out: dict[tuple[str, int], str] = {}
    for h in rows:
        if h.kind == KIND_DAILY_REVIEW:
            out[(KIND_DAILY_REVIEW, h.target_id)] = DAILY_REVIEW_NAME
    sids = {h.target_id for h in rows if h.kind == KIND_SENTENCE}
    vids = {h.target_id for h in rows if h.kind == KIND_PHONETIC_VIDEO}
    uids = {h.target_id for h in rows if h.kind == KIND_READ_ALOUD}
    if uids:
        for u, b in (await db.execute(
            select(Unit, WordBook).join(WordBook, WordBook.id == Unit.book_id)
            .where(Unit.id.in_(uids)).execution_options(skip_tenant_filter=True)
        )).all():
            out[(KIND_READ_ALOUD, u.id)] = f"{b.name} · {u.name}"
    if sids:
        for u, b in (await db.execute(
            select(SentenceUnit, SentenceBook).join(SentenceBook, SentenceBook.id == SentenceUnit.book_id)
            .where(SentenceUnit.id.in_(sids)).execution_options(skip_tenant_filter=True)
        )).all():
            out[(KIND_SENTENCE, u.id)] = f"{b.name} · {u.name}"
    if vids:
        for v in (await db.execute(
            select(PhoneticVideo).where(PhoneticVideo.id.in_(vids)).execution_options(skip_tenant_filter=True)
        )).scalars():
            out[(KIND_PHONETIC_VIDEO, v.id)] = v.title
    return out


def short_label(h: ContentHomework, name: str) -> str:
    """看板/提醒家长那句话里用的短名: 「每日复习」「音标视频「元音 /æ/」」"""
    if h.kind == KIND_DAILY_REVIEW:
        return KIND_LABEL[h.kind]
    return f"{KIND_LABEL.get(h.kind, h.kind)}「{name[:16]}」"


async def refresh_completion(db: AsyncSession, links: Iterable[Link]) -> bool:
    """把「已经学完但还没记完成」的补记上(不 commit)。返回有没有写,调用方据此 commit。

    一批学生一起判: 每种内容一条查询(按 user_id IN × 目标 IN 取回再按 (学生, 目标) 精确对),
    看板一次给全班判时不按人逐个查。"""
    pending = [(s, h) for s, h in links if s.completed_at is None]
    if not pending:
        return False
    uids = {s.student_id for s, _ in pending}
    sids = {h.target_id for _, h in pending if h.kind == KIND_SENTENCE}
    vids = {h.target_id for _, h in pending if h.kind == KIND_PHONETIC_VIDEO}
    rdays = {open_day(h) for _, h in pending if h.kind == KIND_DAILY_REVIEW}
    ra_pairs = {(s.student_id, h.target_id, h.available_from) for s, h in pending if h.kind == KIND_READ_ALOUD}

    sent_done: dict[tuple[int, int], datetime] = {}
    if sids:
        for p in (await db.execute(select(SentenceUnitProgress).where(
            SentenceUnitProgress.user_id.in_(uids),
            SentenceUnitProgress.unit_id.in_(sids),
            SentenceUnitProgress.completed_at.is_not(None),
        ))).scalars():
            sent_done[(p.user_id, p.unit_id)] = max(p.completed_at, p.updated_at or p.completed_at)
    video_done: dict[tuple[int, int], datetime | None] = {}
    if vids:
        video_done = {(r[0], r[1]): r[2] for r in (await db.execute(
            select(PhoneticVideoView.user_id, PhoneticVideoView.video_id, PhoneticVideoView.last_viewed_at).where(
                PhoneticVideoView.user_id.in_(uids),
                PhoneticVideoView.video_id.in_(vids),
                PhoneticVideoView.completed.is_(True),
            ))).all()}
    review_done = await daily_review.completion_times(db, uids, rdays) if rdays else {}
    ra_done = await read_aloud.completion_times(db, ra_pairs) if ra_pairs else {}

    now = datetime.utcnow()
    wrote = False
    for s, h in pending:
        at = None
        if h.kind == KIND_SENTENCE:
            got = sent_done.get((s.student_id, h.target_id))
            if got is not None and got >= h.available_from:
                at = got
        elif h.kind == KIND_PHONETIC_VIDEO:
            key = (s.student_id, h.target_id)
            if key in video_done:
                seen = video_done[key] or now
                at = min(now, max(h.available_from, seen))
        elif h.kind == KIND_DAILY_REVIEW:
            at = review_done.get((s.student_id, open_day(h)))
        elif h.kind == KIND_READ_ALOUD:
            at = ra_done.get((s.student_id, h.target_id, h.available_from))
        if at is not None:
            s.completed_at = at
            wrote = True
    return wrote
