"""金币系统服务层 — 余额变动、系统发放(幂等)、每日结算

所有金币变动必须走 apply_delta(),它同时维护 StudentCoin.balance 与
CoinTransaction 流水,保证两者一致、且流水里的 balance_after 可对账。

系统发放(task/word_king)用 dedup_key 幂等:同一学生同一天同一来源只发一次,
靠 coin_transactions.dedup_key 唯一约束兜底,并发/重复结算都不会多发。
"""
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_, case, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range, local_today, LOCAL_TZ
from app.models.coin import StudentCoin, CoinTransaction
from app.models.organization import Organization
from app.models.user import User, ClassStudent
from app.models.learning import (
    HomeworkAssignment, HomeworkStudentAssignment, LearningProgress,
)

TASK_REWARD = 1        # 完成当天布置的全部任务 → 1 币(一天封顶 1)
WORD_KING_REWARD = 1   # 当日班级词量榜第一,额外叠加(2026-08-08 起从 2 改 1 且不再互斥)
DAILY_CAP = 2          # 一天封顶 2:任务币 1 + 单词王 1

# 「完成 >=2 个计分单元 → 1 币」这条老规则**保持关闭**:
# 2026-07-25 因「刷单元白拿币」下线全部自动发币,2026-08-08 恢复自动发币时用户
# 只指定了「完成当天全部任务 +1」与「单词王 +1」两条,自学单元不再自动给币
# (老师仍可手动加)。历史已发的 source='unit' 流水照常显示。
# 想恢复:把下面改 True 即可,settle_day 会重新结算单元币。
ENABLE_UNIT_COIN = False
UNIT_REWARD = 1        # 单元币金额(仅 ENABLE_UNIT_COIN=True 时生效)
UNIT_THRESHOLD = 2     # 完成几个单元发一个活动币
# 计分模式:真源在 services/weak_words.py,全站共用一份。
# 翻卡片/分类不算,防刷单元币。
from app.services.weak_words import SCORING_MODES, NON_LEARNED_MODES  # noqa: E402  (放在常量区便于阅读)
# 「学了多少词」的全站唯一口径,单词王评选/战况必须与它一致(见 daily_words 模块头注释)
from app.services.daily_words import words_by_student as daily_words_by_student  # noqa: E402


async def day_activity_map(db: AsyncSession, user_ids: list[int], d: date) -> dict:
    """一批学生在 d 这天的「完成任务数 + 学习单词数 + 完成单元数」,供金币流水附带展示。

    - 完成任务数/应完成数: 当天布置(assigned_at 落当天)且未被老师关闭的任务,
      分别是 status=completed 的份数与总份数 —— 与发币口径完全一致(关闭的不进分母)
    - 学习单词数: 当天 LearningRecord 里 distinct(lower(word)) —— 与单词王同口径
    - 完成单元数: 当天完成(completed_at 落当天)的计分模式单元 distinct(unit_id) —— 与发币同口径
    返回 {user_id: {"tasks_done": n, "tasks_total": t, "words": m, "units_done": k}}(缺省 0)。
    """
    if not user_ids:
        return {}
    day_start, day_end = local_day_utc_range(d)
    out: dict = {uid: {"tasks_done": 0, "tasks_total": 0, "words": 0, "units_done": 0}
                 for uid in user_ids}

    for uid, (total, done) in (await task_progress_on_day(db, list(user_ids), d)).items():
        out[uid]["tasks_total"] = total
        out[uid]["tasks_done"] = done

    for uid, cnt in (await daily_words_by_student(db, list(user_ids), day_start, day_end)).items():
        out[uid]["words"] = cnt

    unit_rows = (await db.execute(
        select(
            LearningProgress.user_id,
            func.count(func.distinct(LearningProgress.unit_id)),
        )
        .where(and_(
            LearningProgress.user_id.in_(user_ids),
            LearningProgress.is_completed.is_(True),
            LearningProgress.learning_mode.in_(SCORING_MODES),
            LearningProgress.completed_at >= day_start,
            LearningProgress.completed_at < day_end,
        ))
        .group_by(LearningProgress.user_id)
    )).all()
    for uid, cnt in unit_rows:
        out[uid]["units_done"] = cnt

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
    counts = await daily_words_by_student(db, members, day_start, day_end)
    best = max(counts.values(), default=0)
    if best <= 0:
        return set()
    return {uid for uid, v in counts.items() if v == best}


async def word_king_race(db: AsyncSession, student_id: int, d: date) -> dict:
    """学生视角的单词王争夺战况(当天实时,用于「可能被人超越」提示)。

    取该生所在班级里词量最高者与自己比。多班时取「自己名次最好」的那个班
    (通常只在一个班)。词量口径与评选/发币完全一致(distinct lower word)。

    返回:
      in_class     是否在班级里(没进班无法参评)
      my_words     我今天的词量
      top_words    班上最高词量
      is_leading   我是否暂列第一(并列也算)
      tied         暂列第一且有人与我并列
      chasers      距我 <=3 个词的追赶者人数(仅我领先时有意义)
      gap          我落后第一多少个词(领先时为 0)
      settled      这天是否已结算完毕(d < 今天 → 榜单已定)
    """
    class_ids = (await db.execute(
        select(ClassStudent.class_id).where(and_(
            ClassStudent.student_id == student_id, ClassStudent.is_active.is_(True)))
    )).scalars().all()
    settled = d < local_today()
    if not class_ids:
        return {"in_class": False, "my_words": 0, "top_words": 0, "is_leading": False,
                "tied": False, "chasers": 0, "gap": 0, "settled": settled}

    day_start, day_end = local_day_utc_range(d)
    best: dict = {"my_words": 0, "top_words": 0, "is_leading": False,
                  "tied": False, "chasers": 0, "gap": 0}
    for cid in class_ids:
        members = (await db.execute(
            select(ClassStudent.student_id).where(and_(
                ClassStudent.class_id == cid, ClassStudent.is_active.is_(True)))
        )).scalars().all()
        if not members:
            continue
        counts = await daily_words_by_student(db, members, day_start, day_end)
        mine = counts.get(student_id, 0)
        top = max(counts.values(), default=0)
        leading = mine > 0 and mine >= top
        tied = leading and sum(1 for v in counts.values() if v == top) > 1
        # 追赶者:除我之外,词量在 [mine-3, mine] 区间的人(咬得很紧)
        chasers = sum(
            1 for uid, v in counts.items()
            if uid != student_id and mine - 3 <= v <= mine
        ) if leading else 0
        cand = {"my_words": mine, "top_words": top, "is_leading": leading,
                "tied": tied, "chasers": chasers, "gap": max(0, top - mine)}
        # 多班取名次最好的:先看是否领先,再看差距小
        if cand["is_leading"] and not best["is_leading"]:
            best = cand
        elif cand["is_leading"] == best["is_leading"] and cand["gap"] < best["gap"]:
            best = cand
        elif best["my_words"] == 0 and cand["my_words"] > 0:
            best = cand
    return {"in_class": True, "settled": settled, **best}


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
    # 余额用**相对更新**(balance = balance + amount),不能读出来加完再整体写回:
    # 发币现在跑在多个独立会话里(交卷实时发 / 00:35 结算 / 老师手动加),两个
    # 事务读到同一个初始余额再各自写绝对值,后提交的会覆盖前一个 → 丢币。
    # dedup_key 拦不住这种情况:两笔的 key 本来就不同(task 与 word_king)。
    await db.execute(
        update(StudentCoin)
        .where(StudentCoin.user_id == user_id)
        .values(balance=StudentCoin.balance + amount)
    )
    # 回读权威余额给流水留档(balance_after 供对账)
    new_balance = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == user_id)
    )).scalar() or 0
    tx = CoinTransaction(
        user_id=user_id, org_id=org_id, amount=amount,
        balance_after=new_balance, source=source, reason=reason,
        dedup_key=dedup_key, operator_id=operator_id,
    )
    db.add(tx)
    await db.flush()
    # 让 ORM 里的余额对象与库里一致(调用方可能接着读 coin.balance)
    await db.refresh(coin)
    return tx


async def award_task_coins_isolated(pairs) -> int:
    """在**独立数据库会话**里给 [(student_id, 北京日期), ...] 补发任务币,返回新发人数。

    为什么另开会话:金币是附赠激励,发放失败绝不能影响主流程(交卷/关闭/删除任务)。
    如果复用请求的 session,失败后的 rollback 会让该 session 里所有 ORM 对象过期
    (包括 FastAPI 依赖注入的 current_user),之后任何属性访问都会在异步上下文里
    触发懒加载 → MissingGreenlet → 已经成功的操作反而返回 500。实测踩过。

    整个函数吞掉所有异常:调用方拿到 0 就当没发,不需要 try。
    """
    from app.core.database import AsyncSessionLocal
    granted = 0
    try:
        async with AsyncSessionLocal() as db2:
            for student_id, day in pairs:
                try:
                    if await try_award_task_coin(db2, student_id, day):
                        await db2.commit()
                        granted += 1
                except Exception:
                    await db2.rollback()  # 只影响这个临时会话
    except Exception:
        return granted
    return granted


async def _has_activity_coin(db: AsyncSession, sid: int, key_date: str) -> bool:
    """该生当天是否已发过活动币(作业或单元)。作业/单元共享一天 1 个名额,互斥。

    ⚠️ 这也是「老师当天追加布置任务不再多发币」的实现:活动币按
    dedup_key=task:{sid}:{日期} 一天一条,已发过就跳过,不管后来又布置了几份。
    """
    row = (await db.execute(
        select(CoinTransaction.id).where(CoinTransaction.dedup_key.in_(
            [f"task:{sid}:{key_date}", f"unit:{sid}:{key_date}"]
        )).limit(1)
    )).scalar_one_or_none()
    return row is not None


async def manual_coin_org_ids(db: AsyncSession) -> set[int]:
    """金币开关关成「教师手动加币」的机构 id 集合(这些机构跳过全部自动发放)。

    默认 auto,所以只需查出少数 manual 的机构;NULL/未知一律按 auto 处理。
    """
    rows = (await db.execute(
        select(Organization.id).where(Organization.coin_mode == "manual")
    )).scalars().all()
    return set(rows)


async def is_auto_coin_org(db: AsyncSession, org_id: Optional[int]) -> bool:
    """该机构是否为自动发币模式(默认是)。org_id 为空按默认机构 1 处理。"""
    mode = (await db.execute(
        select(Organization.coin_mode).where(Organization.id == (org_id or 1))
    )).scalar_one_or_none()
    return (mode or "auto") != "manual"


async def task_progress_on_day(
    db: AsyncSession, student_ids: list[int], d: date
) -> dict[int, tuple[int, int]]:
    """一批学生在 d 这天的作业进度 → {student_id: (应完成数, 已完成数)}。

    「应完成数」= assigned_at 落在当天、且作业未被老师关闭的份数。
    老师关闭(⏸)或删除(取消)的任务不进分母 —— 学生做不了的任务不能挡住金币,
    这正是「老师取消了部分任务,剩下的做完也给币」的实现。
    """
    if not student_ids:
        return {}
    day_start, day_end = local_day_utc_range(d)
    rows = (await db.execute(
        select(
            HomeworkStudentAssignment.student_id,
            func.count(HomeworkStudentAssignment.id).label("total"),
            func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0)).label("done"),
        )
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(and_(
            HomeworkStudentAssignment.student_id.in_(student_ids),
            HomeworkStudentAssignment.assigned_at >= day_start,
            HomeworkStudentAssignment.assigned_at < day_end,
            HomeworkAssignment.is_closed.is_(False),
        ))
        .group_by(HomeworkStudentAssignment.student_id)
    )).all()
    return {r.student_id: (int(r.total or 0), int(r.done or 0)) for r in rows}


async def try_award_task_coin(
    db: AsyncSession, student_id: int, d: date, *, org_id: Optional[int] = None
) -> bool:
    """实时尝试给某生发「当天完成全部任务」的 1 币。返回是否真的新发了。

    幂等:同一天同一学生只发一次(dedup_key)。调用方负责 commit。
    在两个时机调用:①学生交卷达标后 ②老师关闭/取消任务后(分母变小可能刚好凑齐)。
    """
    # 只发「今天」的币。否则学生把上周欠的任务一次补完,会按每个布置日各发一枚,
    # 一次领到一周的币,直接击穿「一天最多 DAILY_CAP 枚」(dedup_key 是按天的,
    # 拦不住跨天累加)。历史某天真的全做完了,由当晚 00:35 的 settle_day 兜底发。
    # 例外:刚跨午夜(北京 0 点那一小时)允许补发昨天——离线重试队列在 23:59
    # 交卷、0 点后才送达时,币不能丢(与交卷 30 分钟缓冲同源)。
    today = local_today()
    if d != today:
        just_past_midnight = (
            d == today - timedelta(days=1)
            and datetime.now(LOCAL_TZ).hour == 0
        )
        if not just_past_midnight:
            return False

    # org_id 必须是**该学生**的:开关是机构级的,拿错机构会按别人的设置发币
    # (曾因此让 manual 机构照样自动发,且烧掉 dedup_key 让老师无法再手动补这一天)
    if org_id is None:
        org_id = (await db.execute(
            select(User.org_id).where(User.id == student_id)
        )).scalar_one_or_none()
    if not await is_auto_coin_org(db, org_id):
        return False

    key_date = d.strftime("%Y%m%d")
    if await _has_activity_coin(db, student_id, key_date):
        return False
    progress = await task_progress_on_day(db, [student_id], d)
    total, done = progress.get(student_id, (0, 0))
    if total <= 0 or total != done:
        return False
    tx = await apply_delta(
        db, student_id, org_id or 1, TASK_REWARD, "task",
        reason=f"{d.isoformat()} 完成全部任务",
        dedup_key=f"task:{student_id}:{key_date}",
    )
    return tx is not None


async def _award_word_king(db: AsyncSession, d: date) -> tuple[int, set[int]]:
    """给 d 这天每个班的词量榜第一发 word_king 币(幂等)。
    返回 (本次实际发放人数, 本日全部单词王的 student_id 集合)。

    单词王口径与教师端每日榜一致:LearningRecord 里 distinct(lower(word)) 最多者。
    并列第一都发(不搞随机裁决)。0 词不算王。

    2026-08-08 起单词王 +1 且**与活动币叠加**:当了王又完成全部任务 = 2 币。
    (旧规则是 +2 且撤掉活动币,净 2;现在改成 1+1=2,总额一样但语义更清楚,
    学生看得懂"任务币 1 + 单词王 1"。)手动模式的机构整机构跳过。
    """
    day_start, day_end = local_day_utc_range(d)
    key_date = d.strftime("%Y%m%d")
    manual_orgs = await manual_coin_org_ids(db)

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

    # 当天每个学生的词量(走全站唯一口径,与展示/战况一致)
    word_count = await daily_words_by_student(db, all_student_ids, day_start, day_end)

    granted = 0
    king_ids: set[int] = set()
    for class_id, members in class_members.items():
        # 本班最高词量(>0)
        best = max((word_count.get(sid, 0) for sid, _ in members), default=0)
        if best <= 0:
            continue
        # 词量并列第一时,都算单词王、都发币(用户确认:词数一样可以并列)
        for sid, org_id in members:
            if word_count.get(sid, 0) == best:
                king_ids.add(sid)  # 是不是王与发不发币无关(手动机构也算王,只是不发币)
                if org_id in manual_orgs:
                    continue
                tx = await apply_delta(
                    db, sid, org_id, WORD_KING_REWARD, "word_king",
                    reason=f"{d.isoformat()} 单词王", dedup_key=f"word_king:{sid}:{key_date}",
                )
                if tx is not None:
                    granted += 1
    return granted, king_ids


async def settle_day(db: AsyncSession, d: date) -> dict:
    """幂等结算 d 这天的系统金币。规则:一天最多 2 币(活动币 1 + 单词王 1)。

    - 完成当天布置的全部任务 → 1 币
    - 单词王(当日班级词量榜第一)→ 额外 1 币,与任务币**叠加**(当王又做完任务=2)
    - 「完成 >=2 个单元 → 1 币」默认关闭(见 ENABLE_UNIT_COIN)

    「完成全部任务」= 当天布置给该生的任务(assigned_at 落当天)且**未被老师关闭**
    的全部 status='completed'。老师关闭/删除的任务不进分母 —— 学生做不了的不能
    挡住金币。当天一份任务都没布置则不发。老师当天追加布置任务也不会再多发:
    活动币按 dedup_key 一天一条,已发过就跳过。

    「完成单元」= 当天 completed_at 落当天、learning_mode 属计分模式、is_completed
    的 distinct(unit_id) >= 2。翻卡片/分类不算,防刷。

    单词王只在「d 这天已经结束」(d < 今天)才结算——当天榜单未定,过早发放会把
    币发给暂列第一者并写死 dedup_key,下午被反超也无法纠正。学生端因此显示
    「今日暂列第一,24 点结算」的提示。

    coin_mode='manual' 的机构整机构跳过(老师核实后手动加)。
    返回 {"word_king": n, "task": m, "unit": k} 本次新发放人数。
    """
    day_start, day_end = local_day_utc_range(d)
    key_date = d.strftime("%Y%m%d")
    manual_orgs = await manual_coin_org_ids(db)

    king_granted = 0
    if d < local_today():  # 那天已结束,榜单已定,才发单词王
        king_granted, _king_ids = await _award_word_king(db, d)

    # 完成全部任务:按学生聚合当天布置且未关闭的任务,total==completed 且 total>0
    done_expr = func.sum(case((HomeworkStudentAssignment.status == "completed", 1), else_=0))
    hw_rows = (await db.execute(
        select(
            HomeworkStudentAssignment.student_id,
            User.org_id,
            func.count(HomeworkStudentAssignment.id).label("total"),
            done_expr.label("done"),
        )
        .join(User, User.id == HomeworkStudentAssignment.student_id)
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(and_(
            HomeworkStudentAssignment.assigned_at >= day_start,
            HomeworkStudentAssignment.assigned_at < day_end,
            HomeworkAssignment.is_closed.is_(False),
        ))
        .group_by(HomeworkStudentAssignment.student_id, User.org_id)
    )).all()

    task_granted = 0
    for student_id, org_id, total, done in hw_rows:
        if (org_id or 1) in manual_orgs:
            continue
        if total > 0 and total == done:
            # 作业/单元互斥:该生当天若已拿单元币,不再发作业币
            if await _has_activity_coin(db, student_id, key_date):
                continue
            tx = await apply_delta(
                db, student_id, org_id or 1, TASK_REWARD, "task",
                reason=f"{d.isoformat()} 完成全部任务", dedup_key=f"task:{student_id}:{key_date}",
            )
            if tx is not None:
                task_granted += 1

    if not ENABLE_UNIT_COIN:
        return {"word_king": king_granted, "task": task_granted, "unit": 0}

    # 完成 >=2 个计分模式单元 → 活动币(与作业币互斥,谁先满足谁拿)
    unit_rows = (await db.execute(
        select(
            LearningProgress.user_id,
            User.org_id,
            func.count(func.distinct(LearningProgress.unit_id)).label("units"),
        )
        .join(User, User.id == LearningProgress.user_id)
        .where(and_(
            User.role == "student",
            LearningProgress.is_completed.is_(True),
            LearningProgress.learning_mode.in_(SCORING_MODES),
            LearningProgress.completed_at >= day_start,
            LearningProgress.completed_at < day_end,
        ))
        .group_by(LearningProgress.user_id, User.org_id)
    )).all()

    unit_granted = 0
    for student_id, org_id, units in unit_rows:
        if (org_id or 1) in manual_orgs:
            continue
        if units < UNIT_THRESHOLD:
            continue
        # 作业/单元互斥:该生当天若已拿作业币,不再发单元币
        if await _has_activity_coin(db, student_id, key_date):
            continue
        tx = await apply_delta(
            db, student_id, org_id or 1, UNIT_REWARD, "unit",
            reason=f"{d.isoformat()} 完成{units}个单元", dedup_key=f"unit:{student_id}:{key_date}",
        )
        if tx is not None:
            unit_granted += 1

    return {"word_king": king_granted, "task": task_granted, "unit": unit_granted}
