"""
薄弱单词口径(全站唯一真源)

背景(2026-07-25 修):教师端原来用 mastery_level < 3 当"薄弱",而掌握度 3 档的
门槛是"答对 ≥3 次"——练习次数不够的词哪怕全对也一律被算成薄弱。实测某学生
已学 575 词里 571 个"薄弱",其中 99% 从没答错过,薄弱榜里因此出现
"❌ 错误 0 次 … 正确率 100%" 的自相矛盾行。

统一口径(三档互斥,之和 = 已学词数,按 lower(word) 去重):
- 已掌握 mastered : 掌握度 >= 3
- 薄弱   weak     : 掌握度 < 3 且 在计分模式里真的答错过
- 待巩固 pending  : 掌握度 < 3 但没有真实错误(练习次数不够 / 分类自评"不认识")

classify(分类自评)与 review 会写 is_correct=0 的记录,那是"我不认识"而不是答错,
一律不计入错误(本地库 7742 条 classify 里 7672 条 is_correct=0,若计入会凭空
造出 1637 个"薄弱词")。计分模式列表与 analytics.py / coin_service.py 保持一致。
"""
from typing import Iterable

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import LearningRecord, WordMastery
from app.models.word import Word, WordDefinition

# 有对错判定的模式;classify/review 不算
SCORING_MODES = ('exam', 'quiz', 'spelling', 'fillblank')

# 掌握线(与学生端 /analytics/overview 一致)
MASTERY_LINE = 3

# 「学过一个词」不认分类识别:分类只是学生自评熟/生,没有真的作答。
# 只被分类碰过的词不该计入已学词数(本地实测 360 个词属于这种,
# 其中 319 个等级为 0 —— 全被算进"待巩固",老师看到的是虚高的学习量)。
NON_LEARNED_MODES = ('classify',)


def classify_only_subquery(user_ids: Iterable[int]):
    """(user_id, word_id) 维度的「只在分类识别里碰过」集合,用来从已学词数里剔除。

    ⚠️ 判定方式必须是「有 classify 记录、且没有任何其它模式记录」,
    不能反过来写成「INNER JOIN 真学过的记录」—— 拆分词(migrate_split_words_by_unit)
    把 word_mastery 复制到了新 word_id,而 learning_records 刻意留在原 word_id,
    所以生产上有上万行掌握度**完全没有**对应记录(本地只有 10 行,看不出来)。
    用 INNER JOIN 会把这些词一并判成"没学过",凭空抹掉学生进度。
    没有任何记录的词一律保留,只剔除明确证据表明"仅分类识别"的。
    """
    uids = list(user_ids)
    other = case((LearningRecord.learning_mode.notin_(NON_LEARNED_MODES), 1), else_=0)
    return (
        select(
            LearningRecord.user_id.label("uid"),
            LearningRecord.word_id.label("wid"),
        )
        .where(LearningRecord.user_id.in_(uids))
        .group_by(LearningRecord.user_id, LearningRecord.word_id)
        .having(func.sum(other) == 0)
        .subquery()
    )


def real_error_subquery(user_ids: Iterable[int]):
    """(user_id, word_id) 维度的"真的答错过"集合,供聚合查询 LEFT JOIN 用。"""
    uids = list(user_ids)
    return (
        select(
            LearningRecord.user_id.label("uid"),
            LearningRecord.word_id.label("wid"),
        )
        .where(
            and_(
                LearningRecord.user_id.in_(uids),
                LearningRecord.learning_mode.in_(SCORING_MODES),
                LearningRecord.is_correct == False,  # noqa: E712  SQLite 存 0/1
            )
        )
        .group_by(LearningRecord.user_id, LearningRecord.word_id)
        .subquery()
    )


async def mastery_buckets(
    db: AsyncSession, user_ids: Iterable[int]
) -> dict[int, dict[str, int]]:
    """
    按学生返回 {words, mastered, weak, pending, avg_mastery}。

    words = mastered + weak + pending(按 lower(word) 去重,同拼写取最高档),
    任何页面显示这几个数都必须走这里,否则各端口径又要漂。

    只在分类识别里标记过熟/生的词不计入(见 classify_only_subquery)——
    那不是真的学过一个词。
    """
    uids = list(user_ids)
    if not uids:
        return {}

    err = real_error_subquery(uids)
    cls_only = classify_only_subquery(uids)

    # 内层:按 (学生, 拼写) 收敛——取最高掌握度 + 该拼写下是否有真实错误
    per_word = (
        select(
            WordMastery.user_id.label("uid"),
            func.lower(Word.word).label("sp"),
            func.max(WordMastery.mastery_level).label("lvl"),
            func.max(case((err.c.wid != None, 1), else_=0)).label("has_err"),  # noqa: E711
        )
        .select_from(WordMastery)
        .join(Word, Word.id == WordMastery.word_id)
        .outerjoin(
            err,
            and_(err.c.uid == WordMastery.user_id, err.c.wid == WordMastery.word_id),
        )
        .outerjoin(
            cls_only,
            and_(
                cls_only.c.uid == WordMastery.user_id,
                cls_only.c.wid == WordMastery.word_id,
            ),
        )
        # 只被分类识别碰过的词剔除:LEFT JOIN 没命中(IS NULL)才算真学过
        .where(and_(WordMastery.user_id.in_(uids), cls_only.c.wid == None))  # noqa: E711
        .group_by(WordMastery.user_id, func.lower(Word.word))
        .subquery()
    )

    result = await db.execute(
        select(
            per_word.c.uid,
            func.count().label("words"),
            func.sum(case((per_word.c.lvl >= MASTERY_LINE, 1), else_=0)).label("mastered"),
            func.sum(
                case(
                    (and_(per_word.c.lvl < MASTERY_LINE, per_word.c.has_err == 1), 1),
                    else_=0,
                )
            ).label("weak"),
            func.sum(
                case(
                    (and_(per_word.c.lvl < MASTERY_LINE, per_word.c.has_err == 0), 1),
                    else_=0,
                )
            ).label("pending"),
            func.avg(per_word.c.lvl).label("avg_mastery"),
        ).group_by(per_word.c.uid)
    )

    return {
        row.uid: {
            "words": row.words or 0,
            "mastered": row.mastered or 0,
            "weak": row.weak or 0,
            "pending": row.pending or 0,
            "avg_mastery": float(row.avg_mastery or 0.0),
        }
        for row in result.all()
    }


async def per_word_scoring_stats(
    db: AsyncSession, student_id: int
) -> dict[int, dict[str, int]]:
    """
    {word_id: {attempts, correct, wrong, <mode>_correct, <mode>_wrong}}——
    只统计计分模式的真实答题。

    给 AI 错题分析 / 组卷用:word_mastery 上的 wrong_count 与 *_wrong 计数器
    掺了分类自评,且 exam/错题闯关路径只加对错不加 total_encounters
    (本地库 1975 行 correct+wrong > total_encounters,730 行算出正确率 >100%),
    直接拿去喂 AI 会让"薄弱词"里塞满学生从没错过的词。
    """
    result = await db.execute(
        select(
            LearningRecord.word_id,
            LearningRecord.learning_mode,
            func.count(LearningRecord.id).label("n"),
            func.sum(case((LearningRecord.is_correct == True, 1), else_=0)).label("ok"),  # noqa: E712
        )
        .where(
            and_(
                LearningRecord.user_id == student_id,
                LearningRecord.learning_mode.in_(SCORING_MODES),
            )
        )
        .group_by(LearningRecord.word_id, LearningRecord.learning_mode)
    )

    out: dict[int, dict[str, int]] = {}
    for wid, mode, n, ok in result.all():
        n = int(n or 0)
        ok = int(ok or 0)
        st = out.setdefault(
            wid,
            {
                "attempts": 0, "correct": 0, "wrong": 0,
                "quiz_correct": 0, "quiz_wrong": 0,
                "spelling_correct": 0, "spelling_wrong": 0,
                "fillblank_correct": 0, "fillblank_wrong": 0,
                "exam_correct": 0, "exam_wrong": 0,
            },
        )
        st["attempts"] += n
        st["correct"] += ok
        st["wrong"] += n - ok
        if f"{mode}_correct" in st:
            st[f"{mode}_correct"] += ok
            st[f"{mode}_wrong"] += n - ok
    return out


async def top_wrong_words(
    db: AsyncSession, student_id: int, limit: int = 10
) -> list[dict]:
    """
    错得最多的单词 TOP N(按拼写去重,只算计分模式的真实错误)。

    家长端 / AI 周报共用,和教师端薄弱榜同源,三处不会再各报一个数。
    """
    result = await db.execute(
        select(
            func.lower(Word.word).label("sp"),
            func.min(Word.id).label("wid"),
            func.count(LearningRecord.id).label("attempts"),
            func.sum(case((LearningRecord.is_correct == False, 1), else_=0)).label("wrong"),  # noqa: E712
        )
        .select_from(LearningRecord)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(
            and_(
                LearningRecord.user_id == student_id,
                LearningRecord.learning_mode.in_(SCORING_MODES),
            )
        )
        .group_by(func.lower(Word.word))
        .having(func.sum(case((LearningRecord.is_correct == False, 1), else_=0)) > 0)  # noqa: E712
        .order_by(
            func.sum(case((LearningRecord.is_correct == False, 1), else_=0)).desc(),  # noqa: E712
            func.count(LearningRecord.id).asc(),
        )
        .limit(limit)
    )
    rows = result.all()
    if not rows:
        return []

    # 释义:一次查完,别在循环里打 N 次库
    wids = [r.wid for r in rows]
    def_result = await db.execute(
        select(WordDefinition.word_id, WordDefinition.meaning, Word.word)
        .select_from(Word)
        .outerjoin(
            WordDefinition,
            and_(WordDefinition.word_id == Word.id, WordDefinition.is_primary == True),  # noqa: E712
        )
        .where(Word.id.in_(wids))
    )
    meaning_map: dict[int, str | None] = {}
    word_map: dict[int, str] = {}
    for wid, meaning, word_text in def_result.all():
        if wid is not None:
            meaning_map[wid] = meaning
    # word 原文(保留原大小写)单独取,outerjoin 里 word_id 可能为空
    text_result = await db.execute(select(Word.id, Word.word).where(Word.id.in_(wids)))
    for wid, word_text in text_result.all():
        word_map[wid] = word_text

    return [
        {
            "word": word_map.get(r.wid, r.sp),
            "meaning": meaning_map.get(r.wid),
            "wrong_count": int(r.wrong or 0),
            "attempts": int(r.attempts or 0),
        }
        for r in rows
    ]
