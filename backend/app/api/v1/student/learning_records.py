"""
学习记录API - 记录学生的学习数据
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, or_, text as sa_text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, date, timedelta
from collections import defaultdict
import logging
from pydantic import BaseModel

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range, local_today_utc_range
from app.models.user import User, StudyCalendar
from app.models.word import Unit, Word, WordDefinition
from app.models.learning import (
    LearningRecord, WordMastery, StudySession, LearningProgress, GroupExamRecord
)
from app.schemas.learning_record import (
    LearningRecordBatchCreate, LearningRecordResponse,
    StudySessionCreate, StudySessionUpdate, StudySessionResponse,
    WordMasteryResponse, StudyCalendarUpdate,
    ReviewWordResponse, ReviewRecordBatchCreate
)
from app.api.v1.auth import get_current_student
from app.services.learning_quality import learning_quality_service

router = APIRouter()
logger = logging.getLogger(__name__)

# 艾宾浩斯间隔重复时间表（小时）
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


# 单次提交时长封顶(秒),防刷/防异常大值。正常一组学习几分钟,30 分钟足够宽松。
STUDY_CALENDAR_SESSION_CAP_SEC = 1800


async def update_study_calendar(
    db: AsyncSession,
    user_id: int,
    record_count: int,
    total_time_ms: int,
    session_seconds: Optional[int] = None,
):
    """更新学习日历（共用辅助函数）

    时长口径:优先用前端上报的「增量净活动秒数」session_seconds(已扣挂机),
    未提供时退回按逐题 time_spent 累加(兼容旧客户端)。单次封顶防刷。
    """
    today = local_today()  # 北京日历日,与全站口径一致

    if session_seconds is not None:
        add_sec = session_seconds
    else:
        add_sec = total_time_ms // 1000
    add_sec = max(0, min(add_sec, STUDY_CALENDAR_SESSION_CAP_SEC))

    # UPSERT 原子累加。之前是"先查后插",学生当天第一次提交时若两个请求并发
    # (听写错词实时上报 与 组结束存档几乎同时发),都查不到当日行 → 都走 INSERT,
    # 后到的撞 (user_id, study_date) 唯一约束 → 整批学习记录 500 回滚丢失。
    stmt = sqlite_insert(StudyCalendar).values(
        user_id=user_id,
        study_date=today,
        words_learned=record_count,
        duration=add_sec,
    ).on_conflict_do_update(
        index_elements=["user_id", "study_date"],
        set_={
            "words_learned": StudyCalendar.words_learned + record_count,
            "duration": StudyCalendar.duration + add_sec,
        },
    )
    await db.execute(stmt)


async def claim_client_batch(db: AsyncSession, batch_id: Optional[str], user_id: int) -> bool:
    """幂等键占位:前端重试补交时防止同一批数据重复入库。

    返回 True = 首次见到该批次,继续正常处理;
    返回 False = 已处理过(响应丢了前端重发),调用方应直接返回成功,不再写任何数据。
    占位行与业务数据在同一事务提交:中途崩溃则一起回滚,重试仍能完整入库。
    """
    if not batch_id:
        return True  # 旧客户端不带幂等键,保持原行为
    try:
        # SAVEPOINT 内执行:撞唯一约束只回滚这一条 INSERT,
        # 不污染外层事务、不过期调用方已读出的 ORM 对象
        async with db.begin_nested():
            await db.execute(
                sa_text("INSERT INTO client_submit_dedup (batch_id, user_id) VALUES (:b, :u)"),
                {"b": str(batch_id)[:80], "u": user_id},
            )
            # 顺手清理 7 天前的旧占位行(约 1/36 的提交触发一次,表常年保持很小)
            if str(batch_id).endswith("0"):
                await db.execute(
                    sa_text("DELETE FROM client_submit_dedup WHERE created_at < datetime('now', '-7 day')")
                )
        return True
    except IntegrityError:
        return False
    except Exception:
        # 表不存在等意外(如迁移未跑):宁可放弃去重也不能挡学习数据入库
        return True


# ========================================
# 学习记录 API
# ========================================

@router.post("/records", response_model=dict)
async def create_learning_records(
    data: LearningRecordBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    批量创建学习记录

    功能:
    1. 记录每个单词的答题情况
    2. 更新单词掌握度
    3. 更新学习日历
    """
    user_id = current_user.id

    # 0. 幂等去重:前端断网/502 后会带同一 client_batch_id 重发,已入库的直接返回成功
    if not await claim_client_batch(db, data.client_batch_id, user_id):
        return {
            "success": True,
            "message": "该批次已记录过(重试补交,自动忽略)",
            "total_records": len(data.records),
            "correct_count": sum(1 for r in data.records if r.is_correct),
            "wrong_count": sum(1 for r in data.records if not r.is_correct),
            "quality": {"score": 50, "level": "normal", "flags": [], "suspicious": False},
        }

    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == data.unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {data.unit_id} 不存在"
        )

    # 2. 创建学习记录并更新单词掌握度
    created_records = []
    total_correct = 0
    total_wrong = 0

    for record_data in data.records:
        # 创建学习记录
        learning_record = LearningRecord(
            user_id=user_id,
            word_id=record_data.word_id,
            learning_mode=record_data.learning_mode,
            is_correct=record_data.is_correct,
            time_spent=record_data.time_spent,
            user_answer=record_data.user_answer,  # 答错时的实际输入,拼写诊断用
        )
        db.add(learning_record)
        created_records.append(learning_record)

        if record_data.is_correct:
            total_correct += 1
        else:
            total_wrong += 1

        # 更新或创建单词掌握度记录
        await update_word_mastery(
            db, user_id, record_data.word_id,
            record_data.learning_mode, record_data.is_correct
        )

    # 3. 更新学习日历
    total_time_ms = sum(r.time_spent for r in data.records)
    await update_study_calendar(
        db, user_id, len(data.records), total_time_ms,
        session_seconds=data.session_seconds,
    )

    await db.commit()

    # 4. 计算学习质量分数
    records_for_analysis = [
        {
            "word_id": r.word_id,
            "is_correct": r.is_correct,
            "time_spent": r.time_spent,
        }
        for r in data.records
    ]
    quality_result = learning_quality_service.calculate_quality_score(records_for_analysis)

    # 如果检测到可疑行为，记录日志
    if quality_result.get("suspicious"):
        logger.warning(
            f"可疑学习行为: user_id={user_id}, unit_id={data.unit_id}, "
            f"flags={quality_result.get('flags')}, score={quality_result.get('score')}"
        )

    # 成就检查挂在提交记录的必经之路: 任何学习模式落库都会触发,
    # 不再依赖各模式前端记得跳"完成页"(此前只有填空练习会触发,分类/听写等主力模式成就永远不亮)。
    # 批次≥10条才参与"满分/正确率"类判定,防止一两个词全对就白拿"满分时刻"。
    new_achievements = await _check_achievements_safe(
        db, user_id, total_correct, len(created_records))

    return {
        "success": True,
        "message": f"成功记录 {len(created_records)} 条学习数据",
        "total_records": len(created_records),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        "new_achievements": new_achievements,
        "quality": {
            "score": quality_result.get("score", 50),
            "level": learning_quality_service.get_quality_level(quality_result.get("score", 50)),
            "flags": quality_result.get("flags", []),
            "suspicious": quality_result.get("suspicious", False)
        }
    }


async def _check_achievements_safe(db, user_id: int, correct: int, total: int) -> list:
    """检查并解锁成就,任何异常都不影响学习记录提交(成就是锦上添花)"""
    try:
        from app.api.v1.achievements import check_and_unlock_achievements, get_user_stats
        stats = await get_user_stats(db, user_id)
        # 小批次(实时错词上报等)不参与满分/正确率判定,只判词数/打卡类
        score, tot = (correct, total) if total >= 10 else (None, None)
        unlocked = await check_and_unlock_achievements(
            db=db, user_id=user_id, stats=stats, test_score=score, test_total=tot)
        return [u.model_dump() for u in unlocked]
    except Exception as e:
        logger.warning(f"成就检查失败(不影响提交): user_id={user_id}, {e}")
        return []


async def update_word_mastery(
    db: AsyncSession,
    user_id: int,
    word_id: int,
    learning_mode: str,
    is_correct: bool
):
    """更新单词掌握度"""
    # 先原子占位(ON CONFLICT DO NOTHING):并发首插同一 (user_id, word_id) 时
    # select-then-insert 会撞唯一约束整批500,或在无约束的库里插出重复行
    # (之后 scalar_one_or_none 抛 MultipleResultsFound → 该词提交永久500)
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    await db.execute(
        sqlite_insert(WordMastery.__table__).values(
            user_id=user_id, word_id=word_id,
            total_encounters=0, correct_count=0, wrong_count=0, mastery_level=0,
            flashcard_correct=0, flashcard_wrong=0, quiz_correct=0, quiz_wrong=0,
            spelling_correct=0, spelling_wrong=0, fillblank_correct=0, fillblank_wrong=0,
        ).on_conflict_do_nothing(index_elements=["user_id", "word_id"])
    )
    # 行已确保存在,读出来更新
    result = await db.execute(
        select(WordMastery).where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id == word_id
            )
        ).limit(1)  # 容忍历史重复行(迁移会清,双保险)
    )
    mastery = result.scalars().first()

    # 更新统计数据
    mastery.total_encounters += 1
    if is_correct:
        mastery.correct_count += 1
    else:
        mastery.wrong_count += 1

    # 更新各模式统计
    mode_mapping = {
        'flashcard': ('flashcard_correct', 'flashcard_wrong'),
        'quiz': ('quiz_correct', 'quiz_wrong'),
        'spelling': ('spelling_correct', 'spelling_wrong'),
        'fillblank': ('fillblank_correct', 'fillblank_wrong')
    }

    if learning_mode in mode_mapping:
        correct_field, wrong_field = mode_mapping[learning_mode]
        if is_correct:
            current_value = getattr(mastery, correct_field, 0) or 0
            setattr(mastery, correct_field, current_value + 1)
        else:
            current_value = getattr(mastery, wrong_field, 0) or 0
            setattr(mastery, wrong_field, current_value + 1)

    # 🆕 优化掌握度等级计算 (0-5级) - 基于艾宾浩斯遗忘曲线
    if mastery.total_encounters > 0:
        accuracy = mastery.correct_count / mastery.total_encounters

        # 等级5 - 完全掌握: 连续5次正确,准确率>=90%
        if mastery.correct_count >= 5 and accuracy >= 0.90:
            mastery.mastery_level = 5

        # 等级4 - 熟练掌握: 至少答对4次,准确率>=80%
        elif mastery.correct_count >= 4 and accuracy >= 0.80:
            mastery.mastery_level = 4

        # 等级3 - 基本掌握: 至少答对3次,准确率>=70%
        elif mastery.correct_count >= 3 and accuracy >= 0.70:
            mastery.mastery_level = 3

        # 等级2 - 初步认识: 至少答对2次,或答对1次且准确率>=60%
        elif mastery.correct_count >= 2 or (mastery.correct_count >= 1 and accuracy >= 0.60):
            mastery.mastery_level = 2

        # 等级1 - 刚接触: 答对过1次
        elif mastery.correct_count >= 1:
            mastery.mastery_level = 1

        # 等级0 - 未掌握: 从未答对
        else:
            mastery.mastery_level = 0

    # 更新时间戳
    mastery.last_practiced_at = datetime.utcnow()

    # 计算下次复习时间(艾宾浩斯间隔重复算法)
    graduated = False
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
        # 答错回退2个阶段（不完全重置，避免因一次失误惩罚过重）
        current_stage = mastery.review_stage or 0
        mastery.review_stage = max(0, current_stage - 2)
        interval_hours = SRS_INTERVALS[mastery.review_stage]

    if graduated:
        mastery.next_review_at = None
    else:
        mastery.next_review_at = datetime.utcnow() + timedelta(hours=interval_hours)


# ========================================
# 学习会话 API
# ========================================

@router.post("/sessions", response_model=StudySessionResponse)
async def create_study_session(
    data: StudySessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    开始学习会话

    当学生开始学习一个单元时调用此接口
    """
    user_id = current_user.id

    # 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == data.unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单元ID {data.unit_id} 不存在"
        )

    # 创建学习会话
    session = StudySession(
        user_id=user_id,
        book_id=unit.book_id,
        unit_id=data.unit_id,
        learning_mode=data.learning_mode,
        words_studied=0,
        correct_count=0,
        wrong_count=0,
        time_spent=0
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return session


@router.put("/sessions/{session_id}", response_model=StudySessionResponse)
async def update_study_session(
    session_id: int,
    data: StudySessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    更新学习会话

    当学生完成学习时调用此接口
    """
    user_id = current_user.id

    # 查询会话
    result = await db.execute(
        select(StudySession).where(
            and_(
                StudySession.id == session_id,
                StudySession.user_id == user_id
            )
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="学习会话不存在"
        )

    # 更新会话数据
    session.words_studied = data.words_studied
    session.correct_count = data.correct_count
    session.wrong_count = data.wrong_count
    session.time_spent = data.time_spent
    session.ended_at = datetime.utcnow()

    await db.commit()
    await db.refresh(session)

    return session


# ========================================
# 单词掌握度 API
# ========================================

@router.get("/mastery/{word_id}", response_model=WordMasteryResponse)
async def get_word_mastery(
    word_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取单个单词的掌握度"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery).where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.word_id == word_id
            )
        )
    )
    mastery = result.scalar_one_or_none()

    if not mastery:
        # 返回一个默认的掌握度对象,而不是404错误
        # 这样前端就不会看到404错误了
        from datetime import datetime
        return WordMasteryResponse(
            id=0,
            user_id=user_id,
            word_id=word_id,
            total_encounters=0,
            correct_count=0,
            wrong_count=0,
            mastery_level=0,
            flashcard_correct=0,
            flashcard_wrong=0,
            quiz_correct=0,
            quiz_wrong=0,
            spelling_correct=0,
            spelling_wrong=0,
            fillblank_correct=0,
            fillblank_wrong=0,
            last_practiced_at=None,
            next_review_at=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )

    return mastery


@router.get("/mastery", response_model=List[WordMasteryResponse])
async def get_all_mastery(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取所有单词的掌握度"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery)
        .where(WordMastery.user_id == user_id)
        .order_by(WordMastery.last_practiced_at.desc())
        .offset(skip)
        .limit(limit)
    )
    masteries = result.scalars().all()

    return masteries


@router.get("/weak-words", response_model=List[WordMasteryResponse])
async def get_weak_words(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取薄弱单词(掌握度低的单词)"""
    user_id = current_user.id

    result = await db.execute(
        select(WordMastery)
        .where(
            and_(
                WordMastery.user_id == user_id,
                WordMastery.mastery_level < 3
            )
        )
        .order_by(WordMastery.mastery_level.asc(), WordMastery.last_practiced_at.asc())
        .limit(limit)
    )
    weak_words = result.scalars().all()

    return weak_words


@router.get("/review-due", response_model=List[ReviewWordResponse])
async def get_review_due_words(
    limit: int = 20,
    randomize: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """
    获取需要复习的单词（含完整单词信息）。

    - randomize=False（默认）：按 next_review_at 升序取前 limit 条，确定性结果
    - randomize=True：取前 limit*5（或不足时全部）候选，Python 层随机打乱再截取 limit 条，
      用于"登录强制复习"避免每次都是同样 20 个词
    """
    import random as _random

    user_id = current_user.id
    now = datetime.utcnow()
    today_start, _ = local_today_utc_range()  # 北京"今天"起点(UTC),用于"今天已练过"判定

    fetch_count = limit * 5 if randomize else limit
    result = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, WordMastery.word_id == Word.id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(and_(
            WordMastery.user_id == user_id,
            WordMastery.next_review_at <= now,
            # 今天已练过的词当天不再回到待复习列表,避免刚背的词反复出现
            or_(
                WordMastery.last_practiced_at.is_(None),
                WordMastery.last_practiced_at < today_start,
            ),
        ))
        .order_by(WordMastery.next_review_at.asc())
        .limit(fetch_count)
    )
    rows = result.all()

    if randomize and rows:
        rows = list(rows)
        _random.shuffle(rows)
        rows = rows[:limit]

    review_words = []
    for mastery, word, definition in rows:
        review_words.append(ReviewWordResponse(
            mastery_id=mastery.id,
            word_id=word.id,
            mastery_level=mastery.mastery_level,
            review_stage=mastery.review_stage or 0,
            next_review_at=mastery.next_review_at,
            last_practiced_at=mastery.last_practiced_at,
            word=word.word,
            phonetic=word.phonetic,
            syllables=word.syllables,
            meaning=definition.meaning if definition else None,
            part_of_speech=definition.part_of_speech if definition else None,
            example_sentence=definition.example_sentence if definition else None,
            example_translation=definition.example_translation if definition else None,
            difficulty=word.difficulty or 1,
        ))

    return review_words


@router.get("/spelling-diagnosis")
async def get_spelling_diagnosis(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """拼写错误模式诊断: 聚类学生的真实错误输入,找出系统性混淆(如 ei/ie 不分)。

    数据来自 learning_records.user_answer(答错时前端携带的实际输入),
    比无差别刷错题精准——直接告诉孩子"你总栽在哪类字母组合"。
    """
    rows = (await db.execute(
        select(LearningRecord.user_answer, Word.word)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id == current_user.id,
            LearningRecord.is_correct.is_(False),
            LearningRecord.user_answer.isnot(None),
            LearningRecord.user_answer != "",
        ))
        .order_by(LearningRecord.created_at.desc())
        .limit(200)
    )).all()

    # 逐条对齐正确拼写与学生输入,提取"该写X写成了Y"的混淆对
    from collections import defaultdict as _dd
    stats: dict = _dd(lambda: {"count": 0, "examples": []})   # (expected, got) -> 计数+样例
    analyzed = 0
    for got_raw, expect_raw in rows:
        expect = (expect_raw or "").strip().lower()
        got = (got_raw or "").strip().lower()
        if not expect or not got or got == expect:
            continue
        analyzed += 1
        pair = _first_diff_chunk(expect, got)
        if pair:
            s = stats[pair]
            s["count"] += 1
            if expect not in s["examples"] and len(s["examples"]) < 3:
                s["examples"].append(expect)

    patterns = [
        {
            "expected": exp, "got": got, "count": s["count"],
            "examples": s["examples"],
            "tip": f"该写「{exp}」时写成了「{got}」,出现 {s['count']} 次",
        }
        for (exp, got), s in sorted(stats.items(), key=lambda kv: -kv[1]["count"])[:5]
        if s["count"] >= 2  # 出现≥2次才算"模式",孤例不提
    ]
    return {
        "analyzed_mistakes": analyzed,
        "patterns": patterns,
        "enough_data": analyzed >= 5,
    }


def _first_diff_chunk(expect: str, got: str) -> tuple | None:
    """找出第一处差异的字符块(前后各扩1个字符做上下文),如 believe/beleive → ('ie','ei')。
    简单双指针,不做完整编辑距离——诊断要的是'哪一小块写错',不是精确对齐。"""
    # 掐头
    i = 0
    while i < len(expect) and i < len(got) and expect[i] == got[i]:
        i += 1
    # 去尾
    j_e, j_g = len(expect), len(got)
    while j_e > i and j_g > i and expect[j_e - 1] == got[j_g - 1]:
        j_e -= 1
        j_g -= 1
    exp_chunk, got_chunk = expect[i:j_e], got[i:j_g]
    if not exp_chunk and not got_chunk:
        return None
    # 差异块太长说明整词写错(不是局部混淆),不计入模式
    if len(exp_chunk) > 4 or len(got_chunk) > 4:
        return None
    return (exp_chunk or "(漏写)", got_chunk or "(多写)")


@router.get("/memory-curve-stats")
async def get_memory_curve_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取记忆曲线统计数据"""
    user_id = current_user.id
    now = datetime.utcnow()

    # 查询该用户所有的单词掌握记录(连同拼写,用于按拼写去重)。
    # 单元隔离后同一拼写在不同单元各有独立 word 记录,统计若按 word_id 全算,
    # 会与记忆曲线复习列表(已按拼写去重)对不上。这里同样按拼写去重:
    # 同拼写只保留掌握度最低(最该补)的一条,与前端口径一致。
    result = await db.execute(
        select(WordMastery, func.lower(Word.word))
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id == user_id)
    )
    rows = result.all()
    by_spelling: dict[str, object] = {}
    for m, sp in rows:
        prev = by_spelling.get(sp)
        if prev is None or (m.mastery_level or 0) < (prev.mastery_level or 0):
            by_spelling[sp] = m
    all_mastery = list(by_spelling.values())

    if not all_mastery:
        return {
            "due_today": 0,
            "due_tomorrow": 0,
            "upcoming_7_days": [],
            "stage_distribution": [
                {"stage": i, "label": SRS_LABELS[i], "count": 0}
                for i in range(len(SRS_LABELS))
            ],
            "total_learned": 0,
            "total_mastered": 0,
            "retention_rate": 0,
        }

    # 预计算7天的日期边界(按北京日历日,各日转 UTC 区间与 next_review_at 比)
    today_local = local_today()
    day_boundaries = []
    for day_offset in range(7):
        d = today_local + timedelta(days=day_offset)
        day_start, day_end = local_day_utc_range(d)
        day_boundaries.append((day_start, day_end, day_offset))

    tomorrow = day_boundaries[1][0] if len(day_boundaries) > 1 else (now + timedelta(days=1))

    # 单次遍历统计所有指标
    today_start = day_boundaries[0][0]  # 北京"今天"起点(UTC),用于"今天已练过"判定
    due_today = 0
    due_tomorrow = 0
    day_counts = [0] * 7
    stage_counts = defaultdict(int)
    graduated_count = 0
    mastered_count = 0
    # 记忆保持率对比: 一周前学的词里,"隔天以上回头练过"(真复习) vs "再没碰过"
    # 各自现在还记住多少。口径说明: 分桶用【练习行为的时间间隔】而非 review_stage——
    # stage 每次答对就+1,同一节课连对两次也算 stage2,与掌握度同源会循环论证
    # (未复习桶结构性≈0%,图就成了摆设)。间隔≥1天才算"复习过",与结果指标解耦。
    week_ago = now - timedelta(days=7)
    one_day = timedelta(days=1)
    rt_reviewed = {"total": 0, "kept": 0}
    rt_unreviewed = {"total": 0, "kept": 0}

    for m in all_mastery:
        stage = m.review_stage or 0
        stage_counts[stage] += 1

        if stage >= len(SRS_INTERVALS):
            graduated_count += 1
        if m.mastery_level >= 3:
            mastered_count += 1

        if m.created_at and m.created_at <= week_ago:
            spaced_practice = (
                m.last_practiced_at is not None
                and m.last_practiced_at - m.created_at >= one_day
            )
            bucket = rt_reviewed if spaced_practice else rt_unreviewed
            bucket["total"] += 1
            if (m.mastery_level or 0) >= 3:
                bucket["kept"] += 1

        if m.next_review_at:
            # 今日待复习:到期 且 今天还没练过。刷过的词当天不再计入,
            # 否则短间隔(5分/30分)会让刚背的词当天反复回到待复习,数字只增不减。
            practiced_today = (
                m.last_practiced_at is not None and m.last_practiced_at >= today_start
            )
            if m.next_review_at <= now:
                if not practiced_today:
                    due_today += 1
            elif m.next_review_at <= tomorrow:
                due_tomorrow += 1

            for day_start, day_end, offset in day_boundaries:
                if offset == 0:
                    if m.next_review_at <= day_end:
                        day_counts[offset] += 1
                elif day_start < m.next_review_at <= day_end:
                    day_counts[offset] += 1

    # 构造7天预测(日期标签用北京日历日,不能用 day_start 这个 UTC 瞬间)
    WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    upcoming_7_days = []
    for day_start, _, offset in day_boundaries:
        local_d = today_local + timedelta(days=offset)
        upcoming_7_days.append({
            "date": local_d.strftime("%Y-%m-%d"),
            "weekday": WEEKDAYS[local_d.weekday()],
            "count": day_counts[offset],
            "is_today": offset == 0,
        })

    # SRS阶段分布
    stage_distribution = []
    for i in range(len(SRS_LABELS)):
        if i < len(SRS_INTERVALS):
            count = stage_counts.get(i, 0)
        else:
            # SRS 分布图最后一档 = 复习排期走完(毕业),用 graduated 计数
            count = graduated_count
        stage_distribution.append({
            "stage": i,
            "label": SRS_LABELS[i],
            "count": count,
        })

    total_learned = len(all_mastery)
    retention_rate = round(mastered_count / total_learned * 100, 1) if total_learned > 0 else 0

    return {
        "due_today": due_today,
        "due_tomorrow": due_tomorrow,
        "upcoming_7_days": upcoming_7_days,
        "stage_distribution": stage_distribution,
        "total_learned": total_learned,
        "total_mastered": mastered_count,
        "retention_rate": retention_rate,
        # 两组样本都≥5才有统计意义,阈值只在后端一处,不足返回 null 前端自然不渲染
        "retention_compare": {
            "reviewed": {"total": rt_reviewed["total"],
                         "rate": round(rt_reviewed["kept"] / rt_reviewed["total"] * 100)},
            "unreviewed": {"total": rt_unreviewed["total"],
                           "rate": round(rt_unreviewed["kept"] / rt_unreviewed["total"] * 100)},
        } if rt_reviewed["total"] >= 5 and rt_unreviewed["total"] >= 5 else None,
    }


@router.get("/review-due-count")
async def get_review_due_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """仅返回今日待复习数量（轻量级，用于仪表板）"""
    now = datetime.utcnow()
    today_start, _ = local_today_utc_range()  # 北京"今天"起点(UTC)
    result = await db.execute(
        select(func.count(WordMastery.id)).where(
            and_(
                WordMastery.user_id == current_user.id,
                WordMastery.next_review_at <= now,
                # 今天已练过的词不再计入,刷过即减、不自增
                or_(
                    WordMastery.last_practiced_at.is_(None),
                    WordMastery.last_practiced_at < today_start,
                ),
            )
        )
    )
    count = result.scalar() or 0
    return {"due_today": count}


async def compute_review_progress(db: AsyncSession, user_id: int) -> dict:
    """
    复习进度的统一口径（学生 / 家长 / 教师都用这个）
    - review_due_today  : 当前 next_review_at <= now 的单词数（剩多少没复习）
    - review_done_today : 今日 LearningRecord(learning_mode='review') 的去重 word_id 数
    - graduated_words   : review_stage 已到顶（>=len(SRS_INTERVALS)) 的单词数
    """
    now = datetime.utcnow()
    # 北京"今天"的 UTC 区间,与 UTC 存储的 last_practiced_at 比较
    today_start, tomorrow_start = local_today_utc_range()

    # 今日待复习：到期、且今天还没练过的词。排除"今天已练过"使其与 review_done_today
    # 不相交,这样进度条 done/(done+due) 是干净的 0%→100%(否则答错仍到期的词会被两边重复计)。
    # 按拼写去重(count distinct lower(word)):单元隔离后同拼写多条只算一个,
    # 与记忆曲线复习列表(已按拼写去重)口径一致。
    due_res = await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(WordMastery).join(Word, Word.id == WordMastery.word_id)
        .where(
            WordMastery.user_id == user_id,
            WordMastery.next_review_at.isnot(None),
            WordMastery.next_review_at <= now,
            or_(
                WordMastery.last_practiced_at.is_(None),
                WordMastery.last_practiced_at < today_start,
            ),
        )
    )
    review_due_today = int(due_res.scalar() or 0)

    # 今日已复习:今天练过、且这个词是"安排过复习的"(next_review_at 非空)。
    # 不再用 created_at < today_start 判定——fork/迁移会让老词的 mastery 行
    # created_at 变成今天,导致复习了却不计入 done、进度条不动。改用
    # "练过 + 有复习排期"作为复习信号,既覆盖各复习入口,又让 done 随复习增长。
    # 同样按拼写去重,与 due 口径一致。
    done_res = await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(WordMastery).join(Word, Word.id == WordMastery.word_id)
        .where(
            WordMastery.user_id == user_id,
            WordMastery.last_practiced_at.isnot(None),
            WordMastery.last_practiced_at >= today_start,
            WordMastery.last_practiced_at < tomorrow_start,
            WordMastery.next_review_at.isnot(None),
        )
    )
    review_done_today = int(done_res.scalar() or 0)

    graduated_res = await db.execute(
        select(func.count(func.distinct(func.lower(Word.word))))
        .select_from(WordMastery).join(Word, Word.id == WordMastery.word_id)
        .where(
            WordMastery.user_id == user_id,
            WordMastery.review_stage >= len(SRS_INTERVALS),
        )
    )
    graduated_words = int(graduated_res.scalar() or 0)

    return {
        "review_due_today": review_due_today,
        "review_done_today": review_done_today,
        "graduated_words": graduated_words,
    }


@router.get("/review-progress")
async def get_review_progress(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    复习进度统一接口：今日待复习 / 今日已复习 / 已毕业。
    今日清零标志：review_due_today == 0 && review_done_today > 0
    """
    return await compute_review_progress(db, current_user.id)


@router.post("/review-records")
async def submit_review_records(
    data: ReviewRecordBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """提交复习记录（不需要unit_id）"""
    user_id = current_user.id

    # 幂等去重(重试补交,自动忽略)
    if not await claim_client_batch(db, data.client_batch_id, user_id):
        return {
            "success": True,
            "message": "该批次已记录过(重试补交,自动忽略)",
            "total_records": len(data.records),
            "correct_count": sum(1 for r in data.records if r.is_correct),
            "wrong_count": sum(1 for r in data.records if not r.is_correct),
        }

    total_correct = 0
    total_wrong = 0

    for record_data in data.records:
        # 创建学习记录
        learning_record = LearningRecord(
            user_id=user_id,
            word_id=record_data.word_id,
            learning_mode="review",
            is_correct=record_data.is_correct,
            time_spent=record_data.time_spent,
            user_answer=record_data.user_answer,  # 复习/错题练习的错误输入同样进诊断
        )
        db.add(learning_record)

        if record_data.is_correct:
            total_correct += 1
        else:
            total_wrong += 1

        # 更新单词掌握度
        await update_word_mastery(
            db, user_id, record_data.word_id,
            record_data.learning_mode, record_data.is_correct
        )

    # 更新学习日历
    total_time_ms = sum(r.time_spent for r in data.records)
    await update_study_calendar(
        db, user_id, len(data.records), total_time_ms,
        session_seconds=data.session_seconds,
    )

    await db.commit()

    return {
        "success": True,
        "message": f"成功记录 {len(data.records)} 条复习数据",
        "total_records": len(data.records),
        "correct_count": total_correct,
        "wrong_count": total_wrong,
        # 复习模式同样触发成就检查(打卡天数类成就主要靠这里和普通学习)
        "new_achievements": await _check_achievements_safe(
            db, user_id, total_correct, len(data.records)),
    }


class GroupExamRecordCreate(BaseModel):
    unit_id: int | None = None
    group_index: int = 0
    correct_count: int = 0
    total_questions: int = 0
    score: int = 0
    time_spent: int = 0
    client_batch_id: Optional[str] = None  # 前端重试补交的幂等键


@router.post("/group-exam-record")
async def create_group_exam_record(
    data: GroupExamRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """记录一次小组过关检测成绩(正常学习流程,非复习/错题)。"""
    # 幂等去重(重试补交,自动忽略)
    if not await claim_client_batch(db, data.client_batch_id, current_user.id):
        return {"success": True, "id": 0}
    rec = GroupExamRecord(
        user_id=current_user.id,
        unit_id=data.unit_id,
        group_index=data.group_index,
        correct_count=data.correct_count,
        total_questions=data.total_questions,
        score=data.score,
        time_spent=data.time_spent,
    )
    db.add(rec)
    await db.commit()
    return {"success": True, "id": rec.id}
