"""例句跟读(2026-10-24,唯一真源)

用户 10-24 定: 口语先做「看英文跟读」,放进单词单元里(单独的句子背诵模块生产 0 个真实学生用过)。
孩子看例句 → 听原声 → 跟读 → 听自己的和原声对比 → 下一句。一轮 ROUND_SIZE 句。

- 当场只判「真的开口、说够时长」(前端 VAD,与开口背同口径),孩子看不到对错
- 录音后台转写 + 逐词比对(services/sentence_speech 的进程池和 judge),结果只给本班老师看
- **录音保留 14 天**(用户 10-24 定),老师能回放、标「读对了 / 没读对」,用来核对机器判断准不准;
  到期由转写循环删文件(purge_expired)。录音落 private_media(不进公开的 UPLOAD_DIR)
- 不发金币、不进掌握度和单词数(用户 10-24 定: 第一版判不准,孩子随便出声就算读过)

能跟读的句子: 单元里每个词取一条例句(优先主释义),**3–15 个词**(太长的孩子读不下来),按拼写去重。
作业(content_homework kind=read_aloud): 作业开放后在这个单元读满 ROUND_SIZE 句不同的例句
(单元里不够就读完全部)就算完成,见 completion_times。
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.read_aloud import ReadAloudRecording
from app.models.word import UnitWord, Word, WordDefinition

logger = logging.getLogger(__name__)

ROUND_SIZE = 8
MIN_WORDS, MAX_WORDS = 3, 15
KEEP_DAYS = 14
# 和开口背录音放在同一个私有目录的兄弟目录(不改 config.py: 生产那个文件和仓库有注释 drift)
AUDIO_DIR = os.path.join(os.path.dirname(os.path.normpath(settings.SENTENCE_SPEECH_DIR)), "read_aloud")
_TOKEN = re.compile(r"[A-Za-z']+")


def word_count(sentence: str) -> int:
    return len(_TOKEN.findall(sentence or ""))


def audio_path(name: str) -> str:
    return os.path.join(AUDIO_DIR, os.path.basename(name))


async def eligible_sentences(db: AsyncSession, unit_ids: Iterable[int]) -> dict[int, list[dict]]:
    """{unit_id: [{word_id, definition_id, word, sentence, translation, tts_text}]},按单元内顺序。
    一个词一条(主释义优先,其次最早录入的那条),3–15 个词,同一单元内同一句只留一次"""
    ids = list({int(u) for u in unit_ids})
    if not ids:
        return {}
    rows = (await db.execute(
        select(UnitWord.unit_id, UnitWord.order_index, Word.id, Word.word,
               WordDefinition.id, WordDefinition.is_primary,
               WordDefinition.example_sentence, WordDefinition.example_translation)
        .join(Word, Word.id == UnitWord.word_id)
        .join(WordDefinition, WordDefinition.word_id == Word.id)
        .where(UnitWord.unit_id.in_(ids),
               WordDefinition.example_sentence.is_not(None),
               WordDefinition.example_sentence != "")
        .order_by(UnitWord.unit_id, UnitWord.order_index, Word.id,
                  WordDefinition.is_primary.desc(), WordDefinition.id)
        .execution_options(skip_tenant_filter=True)
    )).all()
    out: dict[int, list[dict]] = {u: [] for u in ids}
    seen_word: set[tuple[int, int]] = set()
    seen_text: set[tuple[int, str]] = set()
    for unit_id, _order, wid, word, did, _primary, sentence, translation in rows:
        if (unit_id, wid) in seen_word:
            continue
        s = " ".join((sentence or "").split())
        if not (MIN_WORDS <= word_count(s) <= MAX_WORDS):
            continue
        key = (unit_id, s.lower())
        if key in seen_text:
            continue
        seen_word.add((unit_id, wid))
        seen_text.add(key)
        out[unit_id].append({"word_id": wid, "definition_id": did, "word": word, "sentence": s,
                             "translation": (translation or "").strip()})
    return out


async def pick_round(db: AsyncSession, user_id: int, unit_id: int) -> list[dict]:
    """这一轮读哪几句: 没读过的先读(按单元顺序),都读过就挑最久没读的"""
    pool = (await eligible_sentences(db, [unit_id]))[unit_id]
    if not pool:
        return []
    last: dict[int, datetime] = {}
    for wid, at in (await db.execute(
        select(ReadAloudRecording.word_id, ReadAloudRecording.created_at)
        .where(ReadAloudRecording.user_id == user_id, ReadAloudRecording.unit_id == unit_id)
    )).all():
        if wid not in last or at > last[wid]:
            last[wid] = at
    unread = [s for s in pool if s["word_id"] not in last]
    read = sorted((s for s in pool if s["word_id"] in last), key=lambda s: last[s["word_id"]])
    return (unread + read)[:ROUND_SIZE]


async def completion_times(db: AsyncSession, pairs: Iterable[tuple[int, int, datetime]]) -> dict[tuple[int, int, datetime], datetime]:
    """作业完成时刻: {(学生, 单元, 开放时刻): 读满那一句的时刻}。
    开放后在这个单元读过的**不同例句**数 >= min(ROUND_SIZE, 单元能读的句数) 才算;单元一句能读的都没有永不完成"""
    pairs = list(set(pairs))
    if not pairs:
        return {}
    uids = {p[0] for p in pairs}
    units = {p[1] for p in pairs}
    earliest = min(p[2] for p in pairs)
    need = {u: min(ROUND_SIZE, len(v)) for u, v in (await eligible_sentences(db, units)).items()}
    reads: dict[tuple[int, int], list[tuple[datetime, int]]] = {}
    for uid, unit, wid, at in (await db.execute(
        select(ReadAloudRecording.user_id, ReadAloudRecording.unit_id,
               ReadAloudRecording.word_id, ReadAloudRecording.created_at)
        .where(ReadAloudRecording.user_id.in_(uids), ReadAloudRecording.unit_id.in_(units),
               ReadAloudRecording.created_at >= earliest)
        .order_by(ReadAloudRecording.created_at)
    )).all():
        reads.setdefault((uid, unit), []).append((at, wid))
    out = {}
    for uid, unit, opened in pairs:
        n = need.get(unit, 0)
        if n <= 0:
            continue
        distinct: set[int] = set()
        for at, wid in reads.get((uid, unit), []):
            if at < opened or wid in distinct:
                continue
            distinct.add(wid)
            if len(distinct) >= n:
                out[(uid, unit, opened)] = at
                break
    return out


# ---------- 后台: 转写 + 到期删音频(由 sentence_speech.speech_loop 调度) ----------

async def pending_rows(db: AsyncSession, limit: int) -> list[tuple[int, str, str]]:
    return [tuple(r) for r in (await db.execute(
        select(ReadAloudRecording.id, ReadAloudRecording.file_path, ReadAloudRecording.sentence)
        .where(ReadAloudRecording.status == "pending", ReadAloudRecording.file_path.is_not(None))
        .order_by(ReadAloudRecording.id).limit(limit)
        .execution_options(skip_tenant_filter=True)
    )).all()]


async def process_one(row_id: int, file_path: str, sentence: str) -> None:
    """转写一条并写结果。**不删音频**(老师 14 天内要能回放),删除由 purge_expired 管"""
    from app.core.database import AsyncSessionLocal
    from app.services import sentence_speech as ss
    values: dict = {"processed_at": datetime.utcnow()}
    try:
        text = await asyncio.get_running_loop().run_in_executor(ss._get_pool(), ss._transcribe, audio_path(file_path))
        ratio, missed, ok = ss.judge(sentence, text)
        values.update(status="done", transcript=text[:1000], hit_ratio=round(ratio, 3),
                      missed_words=",".join(missed)[:500], passed=ok)
    except Exception as e:  # noqa: BLE001  坏文件等: 记 failed 不重试,音频照留给老师听
        logger.warning("跟读转写失败 id=%s: %s", row_id, e)
        values.update(status="failed")
    async with AsyncSessionLocal() as db:
        await db.execute(update(ReadAloudRecording).where(ReadAloudRecording.id == row_id).values(**values))
        await db.commit()


async def purge_expired(db: Optional[AsyncSession] = None, now: Optional[datetime] = None) -> int:
    """删掉超过 KEEP_DAYS 天的录音文件,行留着(转写结果和老师的标记还要看)。返回删了几个"""
    from app.core.database import AsyncSessionLocal
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=KEEP_DAYS)

    async def _run(s: AsyncSession) -> int:
        rows = (await s.execute(
            select(ReadAloudRecording.id, ReadAloudRecording.file_path)
            .where(ReadAloudRecording.file_path.is_not(None), ReadAloudRecording.created_at < cutoff)
            .execution_options(skip_tenant_filter=True)
        )).all()
        for rid, fp in rows:
            try:
                os.remove(audio_path(fp))
            except OSError:
                pass
            await s.execute(update(ReadAloudRecording).where(ReadAloudRecording.id == rid)
                            .values(file_path=None, audio_deleted_at=now))
        if rows:
            await s.commit()
        return len(rows)

    if db is not None:
        return await _run(db)
    async with AsyncSessionLocal() as s:
        return await _run(s)
