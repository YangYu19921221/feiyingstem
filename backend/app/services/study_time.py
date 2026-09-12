"""「学了多久」的全站唯一口径。

背景(2026-08-29 修):同一个学生的累计时长,在五个界面里能看到**五个数字**,
最大差 250 倍(uid 89 曹子轩: 学生端 11962 小时 / 家长端 13.9 小时 /
教师端班级表 47 小时)。因为代码里存在五种"学了多久"的定义:

1. 逐日 max(会话和封顶2h, min(日历,12h)) 再相加  ← 唯一正确的口径(本模块)
2. `sum(StudyCalendar.duration)` 裸和,不封顶       ← 学生端学情页/首页、教师端学生详情
3. `sum(StudySession.time_spent)` 裸和              ← 家长端、光荣榜勤奋王
4. `max(日历和, 会话和)`                            ← 学生端首页
5. `homework_attempt_records.time_spent`            ← 作业自成一套,从不汇入

## 为什么必须两个数据源取较大值

时长有两条独立的记录链路,各有各的系统性偏差,**谁都不能单独用**:

- `study_calendar.duration`: 前端上报的净活动增量(已扣挂机),单次封顶 30 分钟。
  覆盖面全(复习/错题/背句子都有),但 **2026-07-09 之前是逐题 time_spent 累加**,
  分类模式一个词多条记录 × 平摊时长 = 乘以词数,虚高到离谱(见下"为什么要封顶")。
- `study_sessions.time_spent`: 每组结束回写的本次坐下净时长。数值干净,
  但**复习模式和中途退出时系统性低报**(生产实测有学生排行榜 18 分钟、
  按日历逐日加总 13 小时)。

所以逐日取两者较大值:会话缺数时日历补上,日历是旧脏数据时封顶挡住。

## 为什么要封顶(两层)

- **单会话 2 小时**(SESSION_CAP_SEC): 兜极端挂机。一次坐下超过 2 小时本身可疑。
- **单日 12 小时**(DAY_CAP_SEC): 挡 07-09 前的旧脏数据。那批数据里有一天
  9316 小时(3353 万秒)的行,裸求和会让学生端显示 717738 分钟。
  用户 2026-08-29 拍板**不改历史数据**,靠这里的读取侧封顶挡住。

## 为什么逐日算完再相加,不能整段一次算

日历与会话的偏差方向逐日不同(今天会话缺、明天日历脏),必须逐日各取较大值再累加。
整段先求和再比较会把"某天日历脏"的虚高带进整段结果。

⚠️ 任何"学了多久"的展示都必须调这里,不要再手写聚合 —— 手写副本的形状一定会漂,
这个模块存在的原因就是它已经漂成了五份。
"""
from datetime import date, datetime
from typing import Iterable, Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import StudySession
from app.models.user import StudyCalendar

# 单次会话封顶 2 小时:兜极端挂机(一次坐下超 2 小时本身可疑)
SESSION_CAP_SEC = 7200
# 单日封顶 12 小时:挡 2026-07-09 前逐题累加的旧脏数据(最脏一行 9316 小时)
DAY_CAP_SEC = 12 * 3600

# ===== 数据可信起始日(2026-09-12 加) =====
#
# `study_calendar.duration` 的写入口径在 **2026-07-09** 那天才治本
# (改成前端上报净活动增量 session_seconds + 单次封顶 30 分钟)。
# 之前是「逐题 time_spent 累加」,而分类模式一个词产生多条记录、每条都带
# 「整组耗时(含挂机)平摊值」,于是 时长 ≈ 真实值 × 词数。
#
# 单日 12 小时封顶只挡住了**极端**行(曹子轩 9316 小时/天 → 压到 12),
# 但挡不住「每天都不超顶、累计却虚高」的那类:
#   实测 uid 23 王彬铜 —— 07-09 前 66 天日均 102.9 分钟(单日最高 10.95 小时,
#   且这些天在 study_sessions 里**查不到对应会话**,证明是逐题累加的产物);
#   07-09 后 51 天日均 80.2 分钟、两个数据源能对上(5.39h vs 5.26h)。
#   封顶后累计仍是 183 小时,而其中 113 小时来自脏的那半段。
#
# 所以「累计」口径一律从这一天起算。代价说清楚: 2026-07-09 之前的学习时长
# 不再计入任何累计展示 —— 那段数据本就无法回溯出真值(用户 2026-08-29 拍板
# 不修改历史数据),显示一个虚高 1.6 倍的数字比不显示更糟,它会被拿去发家长群。
#
# ⚠️ 只对**累计**(start_day=None)生效。显式传了 start_day 的区间查询不受影响 ——
# 那是调用方明确要的窗口,若有人真要查 4 月的数据,应该拿到 4 月的原始值,
# 由他自己判断可信度,而不是被这里悄悄改成 0。
TRUSTED_SINCE = date(2026, 7, 9)


def _local_day_expr(col):
    """SQLite 没有时区函数,「UTC 时间 + 8 小时」取日期即北京日历日,
    与 timeutil.local_day_utc_range 互为逆运算。"""
    return func.date(col, "+8 hours")


async def _per_day_seconds(
    db: AsyncSession,
    allowed,
    start_day: Optional[date],
    end_day: Optional[date],
) -> dict[tuple[int, str], int]:
    """逐(学生, 北京日)算出该日时长秒数 → {(uid, 'YYYY-MM-DD'): 秒}。

    两个数据源各查一次(共 2 条 SQL,不按学生×天循环),同一天取较大值。
    allowed 支持三种形态:None=不限学生、id 集合/列表、SQL 子查询
    (子查询形态给"全机构/全站榜"用,避免把上千个 id 物化到 Python 再 IN 回去
    撞 SQLite 绑定参数上限)。

    start_day 为 None = 累计口径,此时**自动从 TRUSTED_SINCE 起算**
    (2026-07-09 之前 duration 是逐题累加的脏数据,详见模块顶部常量注释)。
    显式传了 start_day 的区间查询按调用方给的窗口原样查,不被悄悄改写。
    """
    # 累计口径下压上数据可信起始日。放在这里是因为**所有**对外函数
    # (seconds_total / seconds_by_student / seconds_rows / ...)都经过这里,
    # 逐个函数各加一次必然漏掉某个,而漏掉的那个就是下一次"两个页面数字打架"
    if start_day is None:
        start_day = TRUSTED_SINCE
    # ── 会话侧:单会话封顶后按天求和 ──
    sess_day = _local_day_expr(StudySession.started_at)
    sess_conds = []
    if allowed is not None:
        sess_conds.append(StudySession.user_id.in_(allowed))
    if start_day is not None:
        sess_conds.append(sess_day >= start_day.isoformat())
    if end_day is not None:
        sess_conds.append(sess_day <= end_day.isoformat())
    sess_stmt = select(
        StudySession.user_id,
        sess_day.label("d"),
        func.sum(func.min(StudySession.time_spent, SESSION_CAP_SEC)).label("dur"),
    ).group_by(StudySession.user_id, sess_day)
    if sess_conds:
        sess_stmt = sess_stmt.where(and_(*sess_conds))
    sess_rows = (await db.execute(sess_stmt)).all()
    per_day: dict[tuple[int, str], int] = {
        (r.user_id, str(r.d)): int(r.dur or 0) for r in sess_rows
    }

    # ── 日历侧:单日封顶后与会话侧取较大值 ──
    cal_conds = []
    if allowed is not None:
        cal_conds.append(StudyCalendar.user_id.in_(allowed))
    if start_day is not None:
        cal_conds.append(StudyCalendar.study_date >= start_day)
    if end_day is not None:
        cal_conds.append(StudyCalendar.study_date <= end_day)
    cal_stmt = select(
        StudyCalendar.user_id, StudyCalendar.study_date, StudyCalendar.duration,
    )
    if cal_conds:
        cal_stmt = cal_stmt.where(and_(*cal_conds))
    cal_rows = (await db.execute(cal_stmt)).all()
    for r in cal_rows:
        key = (r.user_id, r.study_date.isoformat())
        cal_dur = min(int(r.duration or 0), DAY_CAP_SEC)
        if cal_dur > per_day.get(key, 0):
            per_day[key] = cal_dur

    return per_day


async def seconds_rows(
    db: AsyncSession,
    allowed,
    start_day: Optional[date] = None,
    end_day: Optional[date] = None,
) -> list[tuple[int, int]]:
    """区间内每个学生的学习秒数,按秒数降序 → [(user_id, 秒)]。

    给排行榜用(勤奋王、家长端排名)。allowed 三形态同 _per_day_seconds。
    ⚠️ 排行榜的「我的数值」必须与这里同源 —— 名次按一套口径算、数值按另一套显示,
    会出现"我 60 分钟排第 5,第 6 名却写着 80 分钟"。
    """
    per_day = await _per_day_seconds(db, allowed, start_day, end_day)
    totals: dict[int, int] = {}
    for (uid, _day), secs in per_day.items():
        totals[uid] = totals.get(uid, 0) + secs
    return sorted(totals.items(), key=lambda kv: kv[1], reverse=True)


async def seconds_by_student(
    db: AsyncSession,
    user_ids: Iterable[int],
    start_day: Optional[date] = None,
    end_day: Optional[date] = None,
) -> dict[int, int]:
    """区间内每个学生的学习秒数 → {user_id: 秒}。含首尾两天。

    start_day/end_day 省略 = 累计(全部历史)。查不到的学生不在返回里,
    调用方用 .get(uid, 0) 兜底。
    """
    uids = list(user_ids)
    if not uids:
        return {}
    per_day = await _per_day_seconds(db, uids, start_day, end_day)
    out: dict[int, int] = {}
    for (uid, _day), secs in per_day.items():
        out[uid] = out.get(uid, 0) + secs
    return out


async def seconds_total(
    db: AsyncSession,
    user_id: int,
    start_day: Optional[date] = None,
    end_day: Optional[date] = None,
) -> int:
    """某学生区间内(省略=累计)的学习秒数。"""
    return (await seconds_by_student(db, [user_id], start_day, end_day)).get(user_id, 0)


async def seconds_on_day(db: AsyncSession, user_id: int, d: date) -> int:
    """某学生某个北京日历日的学习秒数。"""
    return await seconds_total(db, user_id, d, d)


async def seconds_by_day(
    db: AsyncSession,
    user_id: int,
    days: Iterable[date],
) -> dict[date, int]:
    """某学生在若干天里每天的学习秒数 → {date: 秒}。用于趋势图/热力图。

    一次查完按天分组,不要在调用方按天循环(30 天热力图那样会发 60 条 SQL)。
    """
    day_list = sorted(set(days))
    if not day_list:
        return {}
    per_day = await _per_day_seconds(db, [user_id], day_list[0], day_list[-1])
    got = {day: secs for (uid, day), secs in per_day.items() if uid == user_id}
    return {d: got.get(d.isoformat(), 0) for d in day_list}


async def group_seconds_by_day(
    db: AsyncSession,
    user_ids: Iterable[int],
    days: Iterable[date],
) -> dict[date, int]:
    """一组学生每天的学习秒数合计 → {date: 秒}。用于班级/机构趋势曲线。

    先逐生逐日封顶,再把同一天各人相加 —— 顺序不能反:先按天把全班的
    duration 求和再封顶,等于给全班一个 12 小时的公共上限,一个学生的旧脏数据
    就能顶满整条曲线。
    """
    day_list = sorted(set(days))
    uids = list(user_ids)
    if not day_list or not uids:
        return {d: 0 for d in day_list}
    per_day = await _per_day_seconds(db, uids, day_list[0], day_list[-1])
    out: dict[date, int] = {d: 0 for d in day_list}
    for (_uid, day_str), secs in per_day.items():
        d_key = date.fromisoformat(day_str)
        if d_key in out:
            out[d_key] += secs
    return out


async def study_days_count(db: AsyncSession, user_id: int) -> int:
    """累计学习天数。日历有行即算一天(与打卡语义一致)。

    ⚠️ 这个函数**不套 TRUSTED_SINCE**,与上面那些时长函数口径不同,是刻意的:
    "学过多少天"只看有没有学过,不依赖 duration 那一列的数值 ——
    07-09 之前的行虽然时长脏,但"这天确实学了"是真的,砍掉会凭空少算天数
    (打卡/坚持天数那类展示会突然缩水)。
    要做"可信区间内学了几天"就显式传区间另写一个,别改这里的语义。

    (2026-09-12 清点: 本函数当前全站无调用方,保留待用。)
    """
    return int((await db.execute(
        select(func.count(StudyCalendar.id)).where(StudyCalendar.user_id == user_id)
    )).scalar() or 0)
