"""
单词掌握度写入(全站唯一真源)

背景(2026-07-25 修):原来只有 student/learning_records.py 的 update_word_mastery
走完整阶梯,而单元考试(unit_exam.py)和错题闯关(mistake_book.py)各自手写
"wrong_count += 1 / mastery_level -= 1",漏掉 total_encounters。后果:
- 本地库 1975 行 correct_count + wrong_count > total_encounters
- 730 行 correct_count > total_encounters,而等级算的是 correct/total_encounters
  → accuracy 能算出 >1,掌握度被系统性抬高
- 3238 行 total_encounters 少于 learning_records 实际条数

现在三条路径统一调 apply_answer(),计数器与阶梯只有一份实现。
learning_records 里的 SRS_INTERVALS/SRS_LABELS 仍是那边的公开常量,从这里导出复用。
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, and_
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import WordMastery

logger = logging.getLogger(__name__)

# 艾宾浩斯间隔重复时间表(小时)
SRS_INTERVALS = [
    0.083,   # Stage 0→1: 5分钟
    0.5,     # Stage 1→2: 30分钟
    12,      # Stage 2→3: 12小时
    24,      # Stage 3→4: 1天
    48,      # Stage 4→5: 2天
    96,      # Stage 5→6: 4天
    168,     # Stage 6→7: 7天
    360,     # Stage 7→8: 15天
    720,     # Stage 8→毕业: 30天
]

SRS_LABELS = ["5分钟", "30分钟", "12小时", "1天", "2天", "4天", "7天", "15天", "30天", "已毕业"]

# 计入分模式计数器的模式(word_mastery 上只有这四组 *_correct/*_wrong 列)。
# 公开给回填迁移复用 —— 那里的列序还决定 executemany 的参数顺序,必须同源。
MODE_COLUMNS = {
    'flashcard': ('flashcard_correct', 'flashcard_wrong'),
    'quiz': ('quiz_correct', 'quiz_wrong'),
    'spelling': ('spelling_correct', 'spelling_wrong'),
    'fillblank': ('fillblank_correct', 'fillblank_wrong'),
}


def level_for(correct_count: int, total_encounters: int) -> int:
    """
    掌握度阶梯 0-5(基于艾宾浩斯遗忘曲线)。

    唯一实现:回填脚本与运行时都调这里,免得两边阶梯漂移。
    """
    if total_encounters <= 0:
        return 0
    accuracy = correct_count / total_encounters

    if correct_count >= 5 and accuracy >= 0.90:
        return 5   # 完全掌握
    if correct_count >= 4 and accuracy >= 0.80:
        return 4   # 熟练掌握
    if correct_count >= 3 and accuracy >= 0.70:
        return 3   # 基本掌握
    if correct_count >= 2 or (correct_count >= 1 and accuracy >= 0.60):
        return 2   # 初步认识
    if correct_count >= 1:
        return 1   # 刚接触
    return 0       # 未掌握


async def get_or_create(db: AsyncSession, user_id: int, word_id: int) -> WordMastery:
    """
    取(必要时创建)掌握度行。

    先原子占位(ON CONFLICT DO NOTHING):并发首插同一 (user_id, word_id) 时
    select-then-insert 会撞唯一约束整批500,或在无约束的库里插出重复行
    (之后 scalar_one_or_none 抛 MultipleResultsFound → 该词提交永久500)。
    """
    await db.execute(
        sqlite_insert(WordMastery.__table__).values(
            user_id=user_id, word_id=word_id,
            total_encounters=0, correct_count=0, wrong_count=0, mastery_level=0,
            flashcard_correct=0, flashcard_wrong=0, quiz_correct=0, quiz_wrong=0,
            spelling_correct=0, spelling_wrong=0, fillblank_correct=0, fillblank_wrong=0,
        ).on_conflict_do_nothing(index_elements=["user_id", "word_id"])
    )
    result = await db.execute(
        select(WordMastery)
        .where(and_(WordMastery.user_id == user_id, WordMastery.word_id == word_id))
        .limit(1)  # 容忍历史重复行(迁移会清,双保险)
    )
    return result.scalars().first()


async def apply_answer(
    db: AsyncSession,
    user_id: int,
    word_id: int,
    learning_mode: str,
    is_correct: bool,
    *,
    advance_srs: bool = True,
) -> WordMastery:
    """
    记一次答题:计数器 + 掌握度阶梯 + SRS 排期,一次全做对。

    任何写掌握度的地方都必须走这里 —— 别再手写 `wrong_count += 1`,
    漏掉 total_encounters 会让等级算出 accuracy > 1(见模块 docstring)。

    advance_srs=False 时只记计数与等级,不动 review_stage/next_review_at
    (用于"考试错题顺带扣一下"这类不该重排复习节奏的场景)。
    """
    mastery = await get_or_create(db, user_id, word_id)

    # 总数与对错:三者恒等 total_encounters == correct_count + wrong_count
    mastery.total_encounters = (mastery.total_encounters or 0) + 1
    if is_correct:
        mastery.correct_count = (mastery.correct_count or 0) + 1
    else:
        mastery.wrong_count = (mastery.wrong_count or 0) + 1

    # 分模式计数(只有这四种有列;exam/classify 等不落分模式列)
    if learning_mode in MODE_COLUMNS:
        correct_field, wrong_field = MODE_COLUMNS[learning_mode]
        field = correct_field if is_correct else wrong_field
        setattr(mastery, field, (getattr(mastery, field, 0) or 0) + 1)

    mastery.mastery_level = level_for(mastery.correct_count, mastery.total_encounters)
    mastery.last_practiced_at = datetime.utcnow()

    if advance_srs:
        _advance_srs(mastery, is_correct)

    return mastery


def _advance_srs(mastery: WordMastery, is_correct: bool) -> None:
    """艾宾浩斯间隔重复:答对进一阶,答错退两阶。"""
    graduated = False
    interval_hours = SRS_INTERVALS[0]

    if is_correct:
        current_stage = mastery.review_stage or 0
        if current_stage < len(SRS_INTERVALS):
            interval_hours = SRS_INTERVALS[current_stage]
            mastery.review_stage = current_stage + 1
        else:
            # 已走完所有 SRS 阶段、再次答对 → 永久毕业:不再排下次复习,
            # next_review_at=None 使复习查询(next_review_at<=now)永远查不到它。
            # 若以后别的模块重新学这个词(走普通学习路径)会重写 next_review_at 复活。
            mastery.review_stage = len(SRS_INTERVALS)
            graduated = True
    else:
        # 答错回退2个阶段(不完全重置,避免因一次失误惩罚过重)
        current_stage = mastery.review_stage or 0
        mastery.review_stage = max(0, current_stage - 2)
        interval_hours = SRS_INTERVALS[mastery.review_stage]

    mastery.next_review_at = (
        None if graduated else datetime.utcnow() + timedelta(hours=interval_hours)
    )
