"""金币系统服务层 — 余额变动、系统发放(幂等)、每日结算

所有金币变动必须走 apply_delta(),它同时维护 StudentCoin.balance 与
CoinTransaction 流水,保证两者一致、且流水里的 balance_after 可对账。

系统发放(task/word_king)用 dedup_key 幂等:同一学生同一天同一来源只发一次,
靠 coin_transactions.dedup_key 唯一约束兜底,并发/重复结算都不会多发。
"""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range, local_today
from app.models.coin import StudentCoin, CoinTransaction
from app.models.user import User, StudyCalendar, ClassStudent
from app.models.word import Word
from app.models.learning import (
    LearningRecord, HomeworkAssignment, HomeworkStudentAssignment,
)

TASK_REWARD = 1        # 完成当日全部作业
WORD_KING_REWARD = 2   # 当日班级词量榜第一


async def day_activity_map(db: AsyncSession, user_ids: list[int], d: date) -> dict:
    """一批学生在 d 这天的「完成任务数 + 学习单词数」,供金币流水附带展示。

    - 完成任务数: 当天布置(assigned_at 落当天)且已完成(status=completed)的作业份数
    - 学习单词数: 当天 LearningRecord 里 distinct(lower(word)) —— 与单词王同口径
    返回 {user_id: {"tasks_done": n, "words": m}}(缺省 0)。
    """
    if not user_ids:
        return {}
    day_start, day_end = local_day_utc_range(d)
    out: dict = {uid: {"tasks_done": 0, "words": 0} for uid in user_ids}

    task_rows = (await db.execute(
        select(
            HomeworkStudentAssignment.student_id,
            func.count(HomeworkStudentAssignment.id),
        )
        .where(and_(
            HomeworkStudentAssignment.student_id.in_(user_ids),
            HomeworkStudentAssignment.status == "completed",
            HomeworkStudentAssignment.assigned_at >= day_start,
            HomeworkStudentAssignment.assigned_at < day_end,
        ))
        .group_by(HomeworkStudentAssignment.student_id)
    )).all()
    for uid, cnt in task_rows:
        out[uid]["tasks_done"] = cnt

    word_rows = (await db.execute(
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id.in_(user_ids),
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
        ))
        .group_by(LearningRecord.user_id)
    )).all()
    for uid, cnt in word_rows:
        out[uid]["words"] = cnt

    return out


def reason_date(reason: str | None) -> date | None:
    """从流水 reason 解析所属北京日历日(如"2026-07-18 单词王"→date(2026,7,18))。
    系统发放的 task/word_king reason 都带日期;附带的"当天完成/学词数"应按此日算,
    而非 created_at(结算时刻,单词王次日结算会差一天)。"""
    import re
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", reason or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def word_king_label(reason: str | None) -> str:
    """单词王徽章文案(按北京时间,后端算好前端只显示,避免用户设备时区出错)。
    reason 形如 "2026-07-18 单词王";所属日=今天→"今日单词王"、昨天→"昨日单词王",
    更早→"单词王"(方案A:最多显示到昨天,不细分更早日期)。解析不出→"单词王"。
    """
    import re
    m = re.search(r"\d{4}-\d{2}-\d{2}", reason or "")
    if not m:
        return "单词王"
    d = m.group(0)
    today = local_today()
    if d == today.isoformat():
        return "今日单词王"
    if d == (today - timedelta(days=1)).isoformat():
        return "昨日单词王"
    return "单词王"


async def word_kings_for_class(db: AsyncSession, class_id: int, d: date) -> set[int]:
    """某班在 d 这天的单词王 student_id 集合(词量最高;并列都算)。

    与发币口径完全一致(distinct(lower(word)))。今天=实时最高(榜未定,仅展示用),
    历史日=当天最终结果。0 词的班不产生王。供 👑 标识跨页面复用。
    """
    day_start, day_end = local_day_utc_range(d)
    members = (await db.execute(
        select(ClassStudent.student_id).where(and_(
            ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
    )).scalars().all()
    if not members:
        return set()
    rows = (await db.execute(
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))).label("v"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id.in_(members),
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
        ))
        .group_by(LearningRecord.user_id)
    )).all()
    if not rows:
        return set()
    best = max(v for _, v in rows)
    if best <= 0:
        return set()
    return {uid for uid, v in rows if v == best}


async def _get_or_create_coin(db: AsyncSession, user_id: int, org_id: int) -> StudentCoin:
    row = (await db.execute(
        select(StudentCoin).where(StudentCoin.user_id == user_id)
    )).scalar_one_or_none()
    if row is None:
        row = StudentCoin(user_id=user_id, org_id=org_id, balance=0)
        db.add(row)
        await db.flush()
    return row


async def apply_delta(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    amount: int,
    source: str,
    reason: Optional[str] = None,
    dedup_key: Optional[str] = None,
    operator_id: Optional[int] = None,
) -> Optional[CoinTransaction]:
    """给学生金币加/减 amount,写余额+流水。调用方负责 commit。

    dedup_key 非空时若已存在(重复发放)→ 回滚这条 INSERT、返回 None,余额不动。
    返回创建的流水行(去重命中返回 None)。
    """
    # 幂等:系统发放先查 dedup_key 是否已存在(命中即跳过,不重复发)。
    # 唯一约束仍在,作为并发竞态的最终兜底。
    if dedup_key is not None:
        exists = (await db.execute(
            select(CoinTransaction.id).where(CoinTransaction.dedup_key == dedup_key).limit(1)
        )).scalar_one_or_none()
        if exists is not None:
            return None

    coin = await _get_or_create_coin(db, user_id, org_id)
    new_balance = (coin.balance or 0) + amount
    tx = CoinTransaction(
        user_id=user_id, org_id=org_id, amount=amount,
        balance_after=new_balance, source=source, reason=reason,
        dedup_key=dedup_key, operator_id=operator_id,
    )
    db.add(tx)
    coin.balance = new_balance
    await db.flush()
    return tx


async def _refund_task_coin(db: AsyncSession, sid: int, key_date: str) -> None:
    """撤销某生某天已发的作业币(单词王不与作业币叠加,一天封顶 2)。

    作业币是当天实时发的;次日结算单词王时,若该生已拿作业 1 币,先删掉并回滚
    余额,再发单词王 2 币,最终恰好 2 而非 3。
    """
    tx = (await db.execute(
        select(CoinTransaction).where(CoinTransaction.dedup_key == f"task:{sid}:{key_date}")
    )).scalar_one_or_none()
    if tx is None:
        return
    coin = (await db.execute(
        select(StudentCoin).where(StudentCoin.user_id == sid)
    )).scalar_one_or_none()
    if coin:
        coin.balance = max(0, coin.balance - tx.amount)
    await db.delete(tx)
    await db.flush()


async def _award_word_king(db: AsyncSession, d: date) -> tuple[int, set[int]]:
    """给 d 这天每个班的词量榜第一发 word_king 币(幂等)。
    返回 (本次实际发放人数, 本日全部单词王的 student_id 集合)。

    单词王口径与教师端每日榜一致:LearningRecord 里 distinct(lower(word)) 最多者。
    并列第一都发(不搞随机裁决)。0 词不算王。发王前先撤掉该生当天的作业币,
    保证「单词王只给 2、不与作业币叠加」。
    """
    day_start, day_end = local_day_utc_range(d)
    key_date = d.strftime("%Y%m%d")

    # 拉所有活跃班级及其学生(带 org_id,发放要落到正确机构)
    rows = (await db.execute(
        select(ClassStudent.class_id, ClassStudent.student_id, User.org_id)
        .join(User, User.id == ClassStudent.student_id)
        .where(and_(ClassStudent.is_active.is_(True), User.role == "student"))
    )).all()
    if not rows:
        return 0, set()

    class_members: dict[int, list[tuple[int, int]]] = {}  # class_id -> [(student_id, org_id)]
    all_student_ids: set[int] = set()
    for class_id, student_id, org_id in rows:
        class_members.setdefault(class_id, []).append((student_id, org_id or 1))
        all_student_ids.add(student_id)

    # 当天每个学生的词量(distinct lower word)
    word_rows = (await db.execute(
        select(
            LearningRecord.user_id,
            func.count(func.distinct(func.lower(Word.word))).label("v"),
        )
        .join(Word, Word.id == LearningRecord.word_id)
        .where(and_(
            LearningRecord.user_id.in_(all_student_ids),
            LearningRecord.created_at >= day_start,
            LearningRecord.created_at < day_end,
        ))
        .group_by(LearningRecord.user_id)
    )).all()
    word_count = {uid: v for uid, v in word_rows}

    granted = 0
    king_ids: set[int] = set()
    for class_id, members in class_members.items():
        # 本班最高词量(>0)
        best = max((word_count.get(sid, 0) for sid, _ in members), default=0)
        if best <= 0:
            continue
        # 词量并列第一时,都算单词王、都发 2 币(用户确认:词数一样可以并列)
        for sid, org_id in members:
            if word_count.get(sid, 0) == best:
                king_ids.add(sid)
                # 不叠加:先撤当天作业币(若有),再发单词王 2 币,最终=2
                await _refund_task_coin(db, sid, key_date)
                tx = await apply_delta(
                    db, sid, org_id, WORD_KING_REWARD, "word_king",
                    reason=f"{d.isoformat()} 单词王", dedup_key=f"word_king:{sid}:{key_date}",
                )
                if tx is not None:
                    granted += 1
    return granted, king_ids


async def settle_day(db: AsyncSession, d: date) -> dict:
    """幂等结算 d 这天的系统金币。规则:一天最多 2 币,不叠加。
    - 单词王(当日班级词量榜第一)→ 2 币;
    - 非单词王但完成当天全部作业 → 1 币。
    单词王与作业币二选一:当了单词王就只给 2,不再另给作业的 1。

    「完成全部作业」= 当天有布置给该生的作业(assigned_at 落在当天),且这些作业
    全部 status='completed'(达到老师设的目标分才算 completed)。当天无作业不发。

    单词王只在「d 这天已经结束」(d < 今天)才结算——当天榜单未定,过早发放会把
    2 币发给暂列第一者并写死 dedup_key,下午被反超也无法纠正。故当天先发 task,
    单词王留到次日结算补发(补发时会撤掉当天已发的作业币,净为 2)。
    返回 {"word_king": n, "task": m} 本次新发放人数。
    """
    day_start, day_end = local_day_utc_range(d)
    key_date = d.strftime("%Y%m%d")

    king_granted = 0
    king_ids: set[int] = set()
    if d < local_today():  # 那天已结束,榜单已定,才发单词王
        king_granted, king_ids = await _award_word_king(db, d)

    # 完成全部作业:按学生聚合当天布置的作业,total==completed 且 total>0
    done_expr = func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0))
    hw_rows = (await db.execute(
        select(
            HomeworkStudentAssignment.student_id,
            User.org_id,
            func.count(HomeworkStudentAssignment.id).label("total"),
            done_expr.label("done"),
        )
        .join(User, User.id == HomeworkStudentAssignment.student_id)
        .where(and_(
            HomeworkStudentAssignment.assigned_at >= day_start,
            HomeworkStudentAssignment.assigned_at < day_end,
        ))
        .group_by(HomeworkStudentAssignment.student_id, User.org_id)
    )).all()

    task_granted = 0
    for student_id, org_id, total, done in hw_rows:
        if student_id in king_ids:
            continue  # 单词王不叠加作业币(已给 2)
        if total > 0 and total == done:
            tx = await apply_delta(
                db, student_id, org_id or 1, TASK_REWARD, "task",
                reason=f"{d.isoformat()} 完成全部作业", dedup_key=f"task:{student_id}:{key_date}",
            )
            if tx is not None:
                task_granted += 1

    return {"word_king": king_granted, "task": task_granted}
