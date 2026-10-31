"""小鹰老师自动布置作业(2026-10-29)

用户原话: 「我的目的就是需要解放老师 让 ai 全自动」「我们都是分类走三轮才算过」「有些孩子一天上百个单词」
「如果完不成肯定要进入第四轮 目前是 80 就能过 你需要根据能力不同提高通过率 如果孩子第一次通过 孩子自己还想再背这块你要考虑」
「第一次来的孩子应该怎么办 还有需要自动和手动功能都需要 如何区分家里和机构 自动点评就用小鹰助手 孩子签到在派
达不到四轮就算不完成 一直加 如果过了当天你就根据能力自动派发任务」
「怎么用 我们的逻辑是什么 你需要在教师端写清楚,什么时候需要人工 什么时候不需要」

规则(教师端「小鹰老师 · 自动布置」页顶上那段说明照这里写,改规则两处一起改):

1. 自动 / 手动按班级: 没设过 = 手动(小鹰老师只出建议,老师点「按建议布置」才发);
   自动 = 孩子签到那一刻派今天的任务。老师今天已经自己给这个孩子布置过单词作业 → 小鹰老师今天不派。
2. 每天派多少(档位 TIERS,含复习轮次 + 每日复习 + 新词):
   - 第一次: 最近两周学过 4 天以上 → 按他自己平均每天学的词数往下降一档起步;否则(新来的)每天 20 个
   - 刚用的前 3 天每天看一次: 做完且第一次过关平均 >= 85 → 升一档;没做完或 < 70 → 降一档
   - 之后最多三天调一次: 连续 3 天都做完且平均 >= 85 → 升;3 天里 2 天没做完或平均 < 70 → 降;
     3 天都做完、其中 2 天还自己要了加练 → 也升
   - 老师可以给全班定上限、给某个孩子固定每天几个词
3. 轮次: 每组第一次过关 = 第 1 轮,隔 1 天第 2 轮,再隔 3 天第 3 轮,之后每 3 天一轮。
   **三轮以上、且那一轮当天第一次过关检测就达到过关线,这组才算学会**;没达到就一直往后加轮(第 4、5 轮…),
   从第 4 轮还没学会起列进老师的「需要你处理」。同一天重复背、没到日子提前背 = 自己多背,不算轮次(记着,算能力)。
4. 每天派的顺序: 到期的第 3 轮及以后 → 到期的第 2 轮 → 每日复习(有到期的复习词才派)→ 新词
5. 过关线(过关检测要多少分): 头一周 80;之后每周看一次最近两周「当天第一次」过关检测(>= 10 次才看)的平均分:
   < 88 → 80、88–92 → 85、93–96 → 90、>= 97 → 95,一周最多动一档。老师可以给全班 / 某个孩子固定。
   失败的那次也记(group_exam_records 只记过了的,所以另记 autopilot_attempts)
6. 电教室 / 家里: 班级设「每周哪几天来电教室」,那几天派的是电教室作业(照常发金币),别的天是家里作业(不发金币);
   没设就按班级的默认;某一天可以临时改
7. 今天的任务做完了,孩子还想背: 「再来一份」按档位一半再派一批(加练),**不进金币、不进今天任务的完成数**
8. 第一次来的孩子: 没有书 → 老师「需要你处理」;有书 → 从第一个没学过的单元开始、每天 20 个、过关线 80;
   老师可以指定从哪本书哪个单元开始
9. 点评: 今天的任务做完那一刻,或者晚上 22:30 统一写,一个孩子一天一条,落款「小鹰老师」。
   本校开通了「问小鹰老师」的用学习助手写(不扣任何人的次数,只发学习数据,不发姓名);没开通 / 没调通按规则写。
   老师当天自己写过点评的不覆盖
10. 安全: 只派孩子自己能学的书(卡包、专属内容的规矩照旧);一个孩子一天只派一次(唯一约束);
    班级 / 孩子可以暂停;每份作业「布置人」写「小鹰老师(自动)」;老师点「按建议布置」的记操作记录
    (签到自动派的不记,一天几十条会淹掉追责日志);老师照样能在「作业管理」关掉 / 删掉,也能「撤回今天的」
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import LOCAL_TZ, local_day_utc_range, local_today, utc_now
from app.models.autopilot import (
    AutopilotAttempt, AutopilotClass, AutopilotDispatch, AutopilotGroup, AutopilotStudent, AutopilotTask,
)
from app.models.coach import CoachNote
from app.models.content_homework import KIND_DAILY_REVIEW, ContentHomework, ContentHomeworkStudent
from app.models.learning import (
    BookAssignment, HomeworkAssignment, HomeworkStudentAssignment, LearningProgress, LearningRecord,
)
from app.models.system_config import SystemConfig
from app.models.user import Class, ClassStudent, User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services.scope_service import DEFAULT_GROUP_SIZE, get_allowed_unit_ids, get_unit_groups

logger = logging.getLogger(__name__)

TIERS = (20, 40, 60, 80, 100, 150, 200)
NEW_KID_TIER = 20
PASS_LINES = (80, 85, 90, 95)
DEFAULT_PASS = 80
GRADUATE_ROUNDS = 3
HANDOFF_ROUND = 4               # 第 4 轮还没学会 → 老师「需要你处理」
NEW_KID_DAYS = 3                # 刚用的前几天每天调
TIER_HOLD_DAYS = 3              # 之后最多三天调一次
UP_SCORE, DOWN_SCORE = 85, 70
PASS_LINE_MIN_ATTEMPTS = 10
PASS_LINE_DAYS = 14
FIRST_WEEK_DAYS = 7
REVIEW_COST = 10                # 每日复习 20 个复习词按 10 个新词算(复习是认过的词,快)
MAX_EXTRA_BATCHES = 5
EXTRA_MIN = 10
HOMEWORK_ATTEMPTS = 9           # 自动派的作业能交几次(过不过看过关检测,不看这个)
CLAIM_STALE = timedelta(minutes=5)
EVENING = (22, 30)
AUTHOR = "小鹰老师"
AUTO_BY = "小鹰老师(自动)"
SETTINGS_KEY = "autopilot_settings"
DEFAULT_SETTINGS = {"enabled": True}
LOCATIONS = ("classroom", "home")
WEEKDAYS = "一二三四五六日"

session_factory = None          # 后台任务自己开会话;测试替换
INLINE = False                  # 测试里设 True: 后台的事当场做完(一个内存库会话不能两个任务同时用)
_bg: set = set()


async def run_later(fn, *args) -> None:
    """不让孩子等的事(写点评要调模型,几秒): 放后台跑,自己开会话"""
    if INLINE:
        await fn(*args)
        return
    t = asyncio.get_running_loop().create_task(fn(*args))
    _bg.add(t)
    t.add_done_callback(_bg.discard)


def _session():
    if session_factory is not None:
        return session_factory()
    from app.core.database import AsyncSessionLocal
    return AsyncSessionLocal()


def _ds(d: date) -> str:
    return d.isoformat()


def _pd(s: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def round_gap(rounds: int) -> int:
    """第 rounds 轮之后隔几天到下一轮"""
    return 1 if rounds <= 1 else 3


def tier_index(words: int) -> int:
    best = 0
    for i, t in enumerate(TIERS):
        if t <= words:
            best = i
    return best


def pass_line_target(avg: float) -> int:
    if avg >= 97:
        return 95
    if avg >= 93:
        return 90
    if avg >= 88:
        return 85
    return 80


# ---------------------------------------------------------------- 平台总开关

async def get_settings(db: AsyncSession) -> dict:
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    out = dict(DEFAULT_SETTINGS)
    if row and row.config_value:
        try:
            data = json.loads(row.config_value)
        except ValueError:
            data = {}
        if isinstance(data, dict) and isinstance(data.get("enabled"), bool):
            out["enabled"] = data["enabled"]
    return out


async def save_settings(db: AsyncSession, enabled: bool) -> dict:
    value = json.dumps({"enabled": bool(enabled)})
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        db.add(SystemConfig(config_key=SETTINGS_KEY, config_value=value, config_type="json",
                            description="小鹰老师自动布置作业: 平台总开关"))
    else:
        row.config_value = value
    await db.flush()
    return {"enabled": bool(enabled)}


# ---------------------------------------------------------------- 班级 / 孩子的设置

async def class_rows(db: AsyncSession, student_id: int) -> list[tuple[Class, Optional[AutopilotClass]]]:
    rows = (await db.execute(
        select(Class, AutopilotClass)
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .outerjoin(AutopilotClass, AutopilotClass.class_id == Class.id)
        .where(ClassStudent.student_id == student_id, ClassStudent.is_active.is_(True))
        .order_by(Class.id)
    )).all()
    return [(c, a) for c, a in rows]


async def class_of_student(db: AsyncSession, student_id: int) -> tuple[Optional[Class], Optional[AutopilotClass]]:
    """孩子在好几个班时: 开了自动的那个班优先,否则第一个班"""
    rows = await class_rows(db, student_id)
    for c, a in rows:
        if a is not None and a.mode == "auto":
            return c, a
    return (rows[0] if rows else (None, None))


def class_days_of(ac: Optional[AutopilotClass]) -> list[int]:
    if ac is None or not ac.class_days:
        return []
    out = []
    for x in ac.class_days.split(","):
        try:
            v = int(x)
        except ValueError:
            continue
        if 0 <= v <= 6 and v not in out:
            out.append(v)
    return sorted(out)


def overrides_of(ac: Optional[AutopilotClass]) -> dict[str, str]:
    if ac is None or not ac.day_overrides:
        return {}
    try:
        data = json.loads(ac.day_overrides)
    except ValueError:
        return {}
    return {k: v for k, v in data.items() if v in LOCATIONS} if isinstance(data, dict) else {}


def location_for(ac: Optional[AutopilotClass], d: date) -> tuple[str, str]:
    """(classroom / home, 为什么)"""
    ov = overrides_of(ac).get(_ds(d))
    if ov:
        return ov, "老师把今天临时改成了" + ("电教室" if ov == "classroom" else "在家")
    days = class_days_of(ac)
    if days:
        if d.weekday() in days:
            return "classroom", f"每周{'、'.join(WEEKDAYS[i] for i in days)}来电教室"
        return "home", f"今天周{WEEKDAYS[d.weekday()]},不是来电教室的日子"
    loc = (ac.default_location if ac is not None else None) or "classroom"
    return (loc if loc in LOCATIONS else "classroom"), "班级没设上课日,按默认"


async def student_row(db: AsyncSession, student_id: int, org_id: Optional[int]) -> AutopilotStudent:
    await db.execute(sqlite_insert(AutopilotStudent).values(student_id=student_id, org_id=org_id, pass_line=DEFAULT_PASS)
                     .on_conflict_do_nothing(index_elements=["student_id"]))
    return (await db.execute(select(AutopilotStudent).where(AutopilotStudent.student_id == student_id))).scalar_one()


async def pass_line_for(db: AsyncSession, student_id: int, st: Optional[AutopilotStudent] = None,
                        ac: Optional[AutopilotClass] = None, *, with_class: bool = True) -> tuple[int, str]:
    """这个孩子现在过关检测要多少分(学习页、判过没过、作业目标分都用这一个)。
    没被小鹰老师派过任务的孩子照旧 80"""
    if st is None:
        st = (await db.execute(select(AutopilotStudent).where(AutopilotStudent.student_id == student_id))).scalar_one_or_none()
    if st is not None and st.fixed_pass_line:
        return st.fixed_pass_line, "老师给你定的"
    if with_class and ac is None:
        _, ac = await class_of_student(db, student_id)
    if ac is not None and ac.pass_line:
        return ac.pass_line, "老师给全班定的"
    if st is None or st.enrolled_at is None:
        return DEFAULT_PASS, ""
    return (st.pass_line or DEFAULT_PASS), (st.pass_line_reason or "")


# ---------------------------------------------------------------- 书和组

@dataclass
class Grp:
    unit_id: int
    unit_name: str
    index: int
    word_ids: list[int]

    @property
    def count(self) -> int:
        return len(self.word_ids)


_groups_cache: dict[int, tuple[float, list[Grp]]] = {}
GROUPS_CACHE_SEC = 60


async def book_groups(db: AsyncSession, book_id: int) -> list[Grp]:
    """整本书按单元顺序切成组。切法和 scope_service.get_unit_groups 一样(单元 group_size,没设 10 个一组)。
    老师页面一次给全班排,同一本书缓存 60 秒"""
    import time
    hit = _groups_cache.get(book_id)
    if hit and time.monotonic() - hit[0] < GROUPS_CACHE_SEC:
        return hit[1]
    out = await _book_groups(db, book_id)
    _groups_cache[book_id] = (time.monotonic(), out)
    return out


async def _book_groups(db: AsyncSession, book_id: int) -> list[Grp]:
    units = (await db.execute(
        select(Unit.id, Unit.name, Unit.group_size).where(Unit.book_id == book_id)
        .order_by(Unit.order_index, Unit.unit_number, Unit.id)
    )).all()
    by_unit: dict[int, list[int]] = defaultdict(list)
    for uid, wid in (await db.execute(
        select(UnitWord.unit_id, UnitWord.word_id).join(Unit, Unit.id == UnitWord.unit_id)
        .where(Unit.book_id == book_id).order_by(UnitWord.unit_id, UnitWord.order_index, UnitWord.id)
    )).all():
        by_unit[uid].append(wid)
    out: list[Grp] = []
    for uid, name, gs in units:
        ws = by_unit.get(uid, [])
        size = gs or DEFAULT_GROUP_SIZE
        for i in range(0, len(ws), size):
            out.append(Grp(uid, name or "", i // size + 1, ws[i:i + size]))
    return out


async def live_books(db: AsyncSession, book_ids) -> set[int]:
    """还在的书。删书只删 word_books 那一行(生产外键关着),单元、组、学习记录都留着 ——
    不过滤的话小鹰老师会把已删书的单元派出去,孩子点开 /units/{id}/start 404(10-31 古雨菲 unit 150 踩到)"""
    ids = {b for b in book_ids if b is not None}
    if not ids:
        return set()
    return {b for (b,) in (await db.execute(select(WordBook.id).where(WordBook.id.in_(ids)))).all()}


async def dead_units(db: AsyncSession, unit_ids) -> set[int]:
    """书已经删了的单元(老师待办 / 统计里别再提它们: 孩子学不了,老师也处理不了)"""
    ids = {u for u in unit_ids if u is not None}
    if not ids:
        return set()
    rows = (await db.execute(select(Unit.id, Unit.book_id).where(Unit.id.in_(ids)))).all()
    alive = await live_books(db, [b for _, b in rows])
    return {u for u, b in rows if b not in alive} | (ids - {u for u, _ in rows})


async def accessible_books(db: AsyncSession, student_id: int) -> list[int]:
    """孩子能学的书: 分配给他的 + 学过的(全托机构没分配也能学),按最近学过的排前"""
    assigned = [b for (b,) in (await db.execute(
        select(BookAssignment.book_id).where(BookAssignment.student_id == student_id).distinct()
    )).all()]
    studied = [b for (b,) in (await db.execute(
        select(LearningProgress.book_id).where(LearningProgress.user_id == student_id)
        .group_by(LearningProgress.book_id).order_by(func.max(LearningProgress.last_studied_at).desc())
    )).all()]
    seen: list[int] = []
    alive = await live_books(db, studied + assigned)
    for b in studied + assigned:
        if b is not None and b in alive and b not in seen:
            seen.append(b)
    out = []
    for b in seen:
        allowed = await get_allowed_unit_ids(db, student_id, b)
        if allowed is None or allowed:
            out.append(b)
    return out


async def candidate_books(db: AsyncSession, student_id: int, st: AutopilotStudent) -> tuple[list[int], str]:
    """(按先后的书, 原因): ok / no_book 没有能学的书 / gated 老师指定的书要兑换学习卡"""
    if st.book_id and st.book_id in await live_books(db, [st.book_id]):   # 老师指定的书被删了: 按能学的书来
        allowed = await get_allowed_unit_ids(db, student_id, st.book_id)
        if allowed is None or allowed:
            return [st.book_id], "ok"
        return [], "gated"
    books = await accessible_books(db, student_id)
    return books, ("ok" if books else "no_book")


async def bootstrap(db: AsyncSession, st: AutopilotStudent, book_id: int, groups: list[Grp], today: date) -> int:
    """第一次碰这本书: 按上线前的学习记录补上每组走到第几轮(某天练到这组六成以上的词 = 那天学过一遍)。
    补的时候也按「隔 1 天、再隔 3 天」算,连着三天各背一遍只算两轮;今天的不补(今天的过关检测自己会记)。
    只补一次(bootstrapped_books 记着)。不 commit,返回补了几组"""
    done = set((st.bootstrapped_books or "").split(",")) - {""}
    if str(book_id) in done:
        return 0
    owner: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for g in groups:
        for w in g.word_ids:
            owner[w].append((g.unit_id, g.index))
    start_today, _ = local_day_utc_range(today)
    day_expr = func.date(LearningRecord.created_at, "+8 hours")
    seen: dict[tuple[int, int], dict[str, set[int]]] = defaultdict(lambda: defaultdict(set))
    wids = list(owner)
    for i in range(0, len(wids), 500):
        for d, wid in (await db.execute(
            select(day_expr, LearningRecord.word_id)
            .where(LearningRecord.user_id == st.student_id, LearningRecord.word_id.in_(wids[i:i + 500]),
                   LearningRecord.created_at < start_today)
            .distinct()
        )).all():
            for key in owner.get(wid, []):
                seen[key][str(d)].add(wid)
    n = 0
    now = utc_now()
    for g in groups:
        days = sorted(d for d, ws in seen.get((g.unit_id, g.index), {}).items() if len(ws) * 10 >= g.count * 6)
        rounds, last, due = 0, None, None
        for d in days:
            if rounds >= GRADUATE_ROUNDS:
                break
            if rounds == 0 or d >= due:
                rounds += 1
                last = d
                due = _ds(_pd(d) + timedelta(days=round_gap(rounds)))
        if rounds == 0:
            continue
        grad = rounds >= GRADUATE_ROUNDS
        await db.execute(sqlite_insert(AutopilotGroup).values(
            student_id=st.student_id, unit_id=g.unit_id, group_index=g.index, book_id=book_id, word_count=g.count,
            rounds=rounds, last_day=last, legacy=True, next_due=None if grad else due,
            graduated_at=now if grad else None, extra_count=0,
        ).on_conflict_do_nothing(index_elements=["student_id", "unit_id", "group_index"]))
        n += 1
    done.add(str(book_id))
    st.bootstrapped_books = ",".join(sorted(done, key=int))
    return n


# ---------------------------------------------------------------- 档位(每天派多少)和过关线

async def _dispatch_days(db: AsyncSession, student_id: int, before: str, limit: int) -> list[AutopilotDispatch]:
    return list((await db.execute(
        select(AutopilotDispatch).where(AutopilotDispatch.student_id == student_id,
                                        AutopilotDispatch.status == "dispatched",
                                        AutopilotDispatch.day < before)
        .order_by(AutopilotDispatch.day.desc()).limit(limit)
    )).scalars())


async def day_done(db: AsyncSession, dispatch_ids: list[int]) -> dict[int, bool]:
    """这几天派的「当天任务」(不含加练)是不是全做完了"""
    if not dispatch_ids:
        return {}
    tasks = list((await db.execute(
        select(AutopilotTask).where(AutopilotTask.dispatch_id.in_(dispatch_ids), AutopilotTask.batch == 0)
    )).scalars())
    word_ids = [t.homework_id for t in tasks if not t.is_content]
    status = dict((await db.execute(
        select(HomeworkStudentAssignment.homework_id, HomeworkStudentAssignment.status)
        .where(HomeworkStudentAssignment.homework_id.in_(word_ids))
    )).all()) if word_ids else {}
    content_ids = [t.homework_id for t in tasks if t.is_content]
    content_done: dict[int, bool] = {}
    if content_ids:
        from app.services import content_homework as chw
        links = list((await db.execute(
            select(ContentHomeworkStudent, ContentHomework)
            .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
            .where(ContentHomework.id.in_(content_ids))
        )).all())
        await chw.refresh_completion(db, links)
        content_done = {h.id: s.completed_at is not None for s, h in links}
    out: dict[int, bool] = {i: True for i in dispatch_ids}
    for t in tasks:
        ok = content_done.get(t.homework_id, False) if t.is_content else status.get(t.homework_id) == "completed"
        if not ok:
            out[t.dispatch_id] = False
    return out


async def _first_try_avg(db: AsyncSession, student_id: int, days: Iterable[str]) -> dict[str, Optional[float]]:
    days = list(days)
    if not days:
        return {}
    rows = (await db.execute(
        select(AutopilotAttempt.day, func.avg(AutopilotAttempt.score))
        .where(AutopilotAttempt.student_id == student_id, AutopilotAttempt.first_today.is_(True),
               AutopilotAttempt.day.in_(days))
        .group_by(AutopilotAttempt.day)
    )).all()
    got = {d: float(a) for d, a in rows if a is not None}
    return {d: got.get(d) for d in days}


async def _extra_days(db: AsyncSession, student_id: int, days: Iterable[str]) -> set[str]:
    """这几天里自己多背过(重复背 / 加练)的日子"""
    days = list(days)
    if not days:
        return set()
    rows = (await db.execute(
        select(AutopilotAttempt.day).where(
            AutopilotAttempt.student_id == student_id, AutopilotAttempt.day.in_(days),
            AutopilotAttempt.passed.is_(True), AutopilotAttempt.counted_round.is_(None))
        .distinct()
    )).all()
    return {d for (d,) in rows}


async def initial_tier(db: AsyncSession, student_id: int, today: date) -> tuple[int, str]:
    from app.services import daily_words
    days = [today - timedelta(days=i) for i in range(1, 15)]
    per = await daily_words.words_by_day(db, student_id, days)
    learned = [n for n in per.values() if n > 0]
    if len(learned) >= 4:
        avg = sum(learned) / len(learned)
        idx = max(0, tier_index(int(avg)) - 1)
        return TIERS[idx], f"最近两周学了 {len(learned)} 天、平均每天 {round(avg)} 个词,先从每天 {TIERS[idx]} 个开始"
    return NEW_KID_TIER, f"刚开始用,先每天 {NEW_KID_TIER} 个词,做得好每天往上加"


async def update_tier(db: AsyncSession, st: AutopilotStudent, today: date) -> None:
    """一天最多看一次: 第一次定档、按最近几天做得怎么样升降一档"""
    ts = _ds(today)
    if st.tier_checked_day == ts:
        return
    st.tier_checked_day = ts
    if st.tier is None:
        st.tier, st.tier_reason = await initial_tier(db, st.student_id, today)
        st.tier_day = ts
        return
    history = await _dispatch_days(db, st.student_id, ts, 3)
    if not history:
        return
    total_days = (await db.execute(select(func.count()).select_from(AutopilotDispatch).where(
        AutopilotDispatch.student_id == st.student_id, AutopilotDispatch.status == "dispatched",
        AutopilotDispatch.day < ts))).scalar() or 0
    new_kid = total_days <= NEW_KID_DAYS
    if not new_kid and st.tier_day and (today - _pd(st.tier_day)).days < TIER_HOLD_DAYS:
        return
    look = history[:1] if new_kid else history
    done = await day_done(db, [d.id for d in look])
    avgs = await _first_try_avg(db, st.student_id, [d.day for d in look])
    scored = [v for v in avgs.values() if v is not None]
    avg = sum(scored) / len(scored) if scored else None
    n_done = sum(1 for d in look if done.get(d.id))
    idx = tier_index(st.tier)
    move, why = 0, ""
    if new_kid:
        if n_done == 1 and avg is not None and avg >= UP_SCORE:
            move, why = 1, f"昨天的任务做完了,过关检测第一次平均 {round(avg)} 分"
        elif n_done == 0 or (avg is not None and avg < DOWN_SCORE):
            move, why = -1, "昨天没做完" if n_done == 0 else f"昨天过关检测第一次平均 {round(avg)} 分"
    elif len(look) == 3:
        extra = await _extra_days(db, st.student_id, [d.day for d in look])
        if n_done == 3 and avg is not None and avg >= UP_SCORE:
            move, why = 1, f"连续 3 天都做完了,过关检测第一次平均 {round(avg)} 分"
        elif 3 - n_done >= 2 or (avg is not None and avg < DOWN_SCORE):
            move, why = -1, (f"最近 3 天有 {3 - n_done} 天没做完" if 3 - n_done >= 2
                             else f"最近 3 天过关检测第一次平均 {round(avg)} 分")
        elif n_done == 3 and len(extra) >= 2:
            move, why = 1, "连续 3 天都做完了,还有 2 天自己多背"
    new_idx = min(len(TIERS) - 1, max(0, idx + move))
    if new_idx != idx:
        st.tier = TIERS[new_idx]
        st.tier_reason = f"{why},{'加到' if move > 0 else '减到'}每天 {st.tier} 个"
        st.tier_day = ts


async def update_pass_line(db: AsyncSession, st: AutopilotStudent, today: date) -> None:
    """一周看一次,一次最多动一档"""
    if st.enrolled_at is None:
        return
    ts = _ds(today)
    enrolled_day = (st.enrolled_at + timedelta(hours=8)).date()
    if (today - enrolled_day).days < FIRST_WEEK_DAYS:
        if not st.pass_line_reason:
            st.pass_line, st.pass_line_reason = DEFAULT_PASS, "第一周先按 80 分"
        return
    if st.pass_line_day and (today - _pd(st.pass_line_day)).days < FIRST_WEEK_DAYS:
        return
    st.pass_line_day = ts
    since = _ds(today - timedelta(days=PASS_LINE_DAYS))
    n, avg = (await db.execute(
        select(func.count(), func.avg(AutopilotAttempt.score)).where(
            AutopilotAttempt.student_id == st.student_id, AutopilotAttempt.first_today.is_(True),
            AutopilotAttempt.day >= since, AutopilotAttempt.day < ts)
    )).one()
    if (n or 0) < PASS_LINE_MIN_ATTEMPTS or avg is None:
        st.pass_line_reason = st.pass_line_reason or "过关检测做得还不多,先按 80 分"
        return
    cur = st.pass_line if st.pass_line in PASS_LINES else DEFAULT_PASS
    target = pass_line_target(float(avg))
    i, j = PASS_LINES.index(cur), PASS_LINES.index(target)
    nxt = PASS_LINES[i + (1 if j > i else -1 if j < i else 0)]
    if nxt != cur:
        st.pass_line = nxt
    st.pass_line_reason = (f"最近两周过关检测第一次平均 {round(float(avg))} 分,"
                           + (f"过关线{'提到' if nxt > cur else '降到'} {nxt}" if nxt != cur else f"保持 {nxt}"))


def effective_tier(st: AutopilotStudent, ac: Optional[AutopilotClass]) -> tuple[int, str]:
    if st.fixed_words:
        return st.fixed_words, "老师给他定的量"
    tier = st.tier or NEW_KID_TIER
    reason = st.tier_reason or ""
    if ac is not None and ac.max_words and tier > ac.max_words:
        return ac.max_words, f"{reason}(全班每天最多 {ac.max_words} 个)"
    return tier, reason


# ---------------------------------------------------------------- 排今天的任务

@dataclass
class Item:
    kind: str                   # round / new / review
    unit_id: int = 0
    unit_name: str = ""
    book_id: Optional[int] = None
    groups: list[int] = field(default_factory=list)
    round_no: int = 0
    words: int = 0

    batch: int = 0

    def title(self) -> str:
        if self.kind == "review":
            return f"{AUTHOR} · 今天的复习词"
        head = f"{AUTHOR} · 加练" if self.batch else AUTHOR
        g = (f"第{self.groups[0]}组" if len(self.groups) == 1
             else f"第{self.groups[0]}–{self.groups[-1]}组")
        tail = "新词" if self.kind == "new" else f"第{self.round_no}轮"
        return f"{head} · {self.unit_name} {g} · {tail}"

    def out(self) -> dict:
        return {"kind": self.kind, "unit_id": self.unit_id, "unit_name": self.unit_name, "book_id": self.book_id,
                "groups": self.groups, "round": self.round_no, "words": self.words, "title": self.title()}


@dataclass
class Plan:
    status: str                 # ok / no_book / gated / finished
    reason: str = ""
    book_id: Optional[int] = None
    book_name: str = ""
    items: list[Item] = field(default_factory=list)
    budget: int = 0

    @property
    def words(self) -> int:
        return sum(i.words for i in self.items if i.kind != "review")


def _merge(picked: list[tuple[str, Grp, int, Optional[int]]]) -> list[Item]:
    """相邻的组(同一单元、同一种、同一轮)并成一份作业"""
    out: list[Item] = []
    for kind, g, rnd, book in picked:
        last = out[-1] if out else None
        if (last is not None and last.kind == kind and last.unit_id == g.unit_id and last.round_no == rnd
                and last.groups and last.groups[-1] + 1 == g.index):
            last.groups.append(g.index)
            last.words += g.count
        else:
            out.append(Item(kind=kind, unit_id=g.unit_id, unit_name=g.unit_name, book_id=book,
                            groups=[g.index], round_no=rnd, words=g.count))
    return out


async def _unit_names(db: AsyncSession, unit_ids: Iterable[int]) -> dict[int, tuple[str, int]]:
    ids = list(set(unit_ids))
    if not ids:
        return {}
    return {u: (n or "", b) for u, n, b in (await db.execute(
        select(Unit.id, Unit.name, Unit.book_id).where(Unit.id.in_(ids)))).all()}


async def build_plan(db: AsyncSession, st: AutopilotStudent, today: date, budget: int, *,
                     with_review: bool = True, skip_units: Optional[set] = None) -> Plan:
    """按顺序填满 budget 个词: 到期的高轮次 → 到期的第 2 轮 → 每日复习 → 新词。不写作业,只排(会补历史轮次,不 commit)。
    新词从最近在学的那本书接着往下;那本学完了换下一本能学的书(老师指定了书就只用那本)"""
    sid = st.student_id
    ts = _ds(today)
    skip_units = skip_units or set()
    books, why = await candidate_books(db, sid, st)
    allowed_cache: dict[int, Optional[set]] = {}

    async def allowed_of(b: int) -> Optional[set]:
        if b not in allowed_cache:
            allowed_cache[b] = await get_allowed_unit_ids(db, sid, b)
        return allowed_cache[b]

    # 新词: 第一本还有没学过的组的书
    new_book, new_groups = None, []
    for b in books:
        groups = await book_groups(db, b)
        await bootstrap(db, st, b, groups, today)
        await db.flush()
        known = {(u, g) for u, g in (await db.execute(select(AutopilotGroup.unit_id, AutopilotGroup.group_index)
                                                       .where(AutopilotGroup.student_id == sid))).all()}
        allowed = await allowed_of(b)
        start_seen = not (b == st.book_id and st.start_unit_id and any(g.unit_id == st.start_unit_id for g in groups))
        cand = []
        for g in groups:
            if not start_seen:
                if g.unit_id != st.start_unit_id:
                    continue
                start_seen = True
            if (g.unit_id, g.index) in known or (g.unit_id, g.index) in skip_units or g.count == 0:
                continue
            if allowed is not None and g.unit_id not in allowed:
                continue
            cand.append(g)
        if cand:
            new_book, new_groups = b, cand
            break

    # 到期的轮次: 跨书也算(换了书,旧书上没学会的照样要回头),但只派他现在还能学的单元
    rows = list((await db.execute(select(AutopilotGroup).where(
        AutopilotGroup.student_id == sid, AutopilotGroup.graduated_at.is_(None), AutopilotGroup.rounds >= 1,
        AutopilotGroup.next_due.is_not(None), AutopilotGroup.next_due <= ts))).scalars())
    due = sorted(rows, key=lambda r: (-r.rounds, r.next_due, r.unit_id, r.group_index))
    names = await _unit_names(db, [r.unit_id for r in due])
    alive = await live_books(db, [b for _, b in names.values()])
    picked: list[tuple[str, Grp, int, Optional[int]]] = []
    left = budget
    for r in due:
        if left <= 0:
            break
        name, b = names.get(r.unit_id, ("", None))
        if b is None or b not in alive or (r.unit_id, r.group_index) in skip_units:
            continue
        a = await allowed_of(b)
        if a is not None and r.unit_id not in a:
            continue
        g = Grp(r.unit_id, name, r.group_index, [0] * (r.word_count or 0))
        picked.append(("round", g, r.rounds + 1, b))
        left -= max(1, g.count)
    items = _merge(picked)

    if with_review and left >= REVIEW_COST:
        from app.services import daily_review
        ids, _backlog = await daily_review.pick(db, sid, today)
        if ids:
            items.append(Item(kind="review", words=len(ids)))
            left -= REVIEW_COST

    new_picked: list[tuple[str, Grp, int, Optional[int]]] = []
    for g in new_groups:
        # 剩的额度不到半组就不再加新组(一组 10 个,剩 3 个也塞一组 = 多派 7 个);一份都没有时至少给一组
        if left * 2 >= g.count or (not items and not new_picked):
            new_picked.append(("new", g, 1, new_book))
            left -= g.count
        else:
            break
    items += _merge(new_picked)

    book_id = new_book or (books[0] if books else None)
    book_name = ((await db.execute(select(WordBook.name).where(WordBook.id == book_id))).scalar_one_or_none() or ""
                 ) if book_id else ""
    if not items:
        if not books:
            return Plan(status=why, reason={"no_book": "还没有能学的书",
                                            "gated": "老师指定的书要先兑换学习卡"}.get(why, ""), budget=budget)
        return Plan(status="finished", reason=f"《{book_name}》能学的都学完了", book_id=book_id,
                    book_name=book_name, budget=budget)
    return Plan(status="ok", book_id=book_id, book_name=book_name, items=items, budget=budget)


async def preview(db: AsyncSession, student: User, cls: Class, ac: Optional[AutopilotClass]) -> dict:
    """老师页面上「小鹰老师建议今天派什么」(手动班点了才发)。会补历史轮次、定档位(一天一次),不派作业"""
    today = local_today()
    st, tier, tier_reason, line, line_reason = await prepare(db, student, today, ac)
    plan = await build_plan(db, st, today, tier)
    location, loc_reason = location_for(ac, today)
    return {"status": plan.status, "reason": plan.reason, "book_name": plan.book_name,
            "items": [i.out() for i in plan.items], "words": plan.words, "tier": tier, "tier_reason": tier_reason,
            "pass_line": line, "pass_line_reason": line_reason, "location": location, "location_reason": loc_reason}


# ---------------------------------------------------------------- 派

async def manual_homework_today(db: AsyncSession, student_id: int, today: date) -> bool:
    """老师今天自己给这个孩子布置过单词作业(不是小鹰老师派的、没关掉)"""
    start, end = local_day_utc_range(today)
    from app.models.autopilot import auto_homework_ids
    n = (await db.execute(
        select(func.count()).select_from(HomeworkStudentAssignment)
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(HomeworkStudentAssignment.student_id == student_id,
               HomeworkStudentAssignment.assigned_at >= start, HomeworkStudentAssignment.assigned_at < end,
               HomeworkAssignment.is_closed.is_(False),
               HomeworkAssignment.id.not_in(auto_homework_ids()))
    )).scalar() or 0
    return n > 0


async def _claim(db: AsyncSession, student_id: int, ts: str, **vals) -> Optional[AutopilotDispatch]:
    """占住今天这一行(派到一半挂了 5 分钟后能重来);已经派过 / 别人正在派 → None"""
    now = utc_now()
    await db.execute(sqlite_insert(AutopilotDispatch).values(
        student_id=student_id, day=ts, status="claiming", claimed_at=now, **vals,
    ).on_conflict_do_nothing(index_elements=["student_id", "day"]))
    row = (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id == student_id, AutopilotDispatch.day == ts))).scalar_one()
    if row.status == "claiming" and row.claimed_at == now:
        return row
    r = await db.execute(
        update(AutopilotDispatch)
        .where(AutopilotDispatch.id == row.id, AutopilotDispatch.status != "dispatched",
               or_(AutopilotDispatch.status != "claiming", AutopilotDispatch.claimed_at < now - CLAIM_STALE))
        .values(status="claiming", claimed_at=now, **vals)
        .execution_options(synchronize_session=False))
    if r.rowcount != 1:
        return None
    await db.refresh(row)
    return row


async def _write_homework(db: AsyncSession, student: User, cls: Class, dispatch: AutopilotDispatch, items: list[Item],
                          today: date, pass_line: int, location: str, actor_name: str, actor_id: Optional[int],
                          batch: int) -> list[AutopilotTask]:
    open_at, day_end = local_day_utc_range(today)
    tasks = []
    for it in items:
        it.batch = batch
        if it.kind == "review":
            hw = ContentHomework(kind=KIND_DAILY_REVIEW, target_id=0, title=it.title(), teacher_id=cls.teacher_id,
                                 org_id=student.org_id, assigned_by=actor_id, assigned_by_name=actor_name,
                                 available_from=open_at, deadline=day_end)
            db.add(hw)
            await db.flush()
            db.add(ContentHomeworkStudent(homework_id=hw.id, student_id=student.id))
            t = AutopilotTask(dispatch_id=dispatch.id, student_id=student.id, day=dispatch.day, kind="review",
                              homework_id=hw.id, is_content=True, words=it.words, batch=batch)
        else:
            hw = HomeworkAssignment(
                title=it.title()[:200], description=None, teacher_id=cls.teacher_id,
                assigned_by=actor_id, assigned_by_name=actor_name, unit_id=it.unit_id, learning_mode="flashcard",
                target_score=pass_line, max_attempts=HOMEWORK_ATTEMPTS, group_index=it.groups[0],
                available_from=open_at, location_type=location, entry_mode="open", is_contest=False,
            )
            db.add(hw)
            await db.flush()
            db.add(HomeworkStudentAssignment(homework_id=hw.id, student_id=student.id, status="pending",
                                             assigned_at=open_at))
            t = AutopilotTask(dispatch_id=dispatch.id, student_id=student.id, day=dispatch.day, kind=it.kind,
                              homework_id=hw.id, is_content=False, unit_id=it.unit_id, group_index=it.groups[0],
                              groups=",".join(str(g) for g in it.groups), round_no=it.round_no, words=it.words,
                              batch=batch)
        db.add(t)
        tasks.append(t)
    return tasks


async def prepare(db: AsyncSession, student: User, today: date, ac: Optional[AutopilotClass],
                  st: Optional[AutopilotStudent] = None) -> tuple[AutopilotStudent, int, str, int, str]:
    """(孩子那一行, 档位, 档位原因, 过关线, 过关线原因)。会更新档位 / 过关线(一天一次)"""
    st = st or await student_row(db, student.id, student.org_id)
    await update_tier(db, st, today)
    await update_pass_line(db, st, today)
    tier, tier_reason = effective_tier(st, ac)
    line, line_reason = await pass_line_for(db, student.id, st, ac, with_class=False)
    return st, tier, tier_reason, line, line_reason


async def ensure_dispatch(db: AsyncSession, student: User, *, source: str = "auto",
                          actor: Optional[User] = None, cls: Optional[Class] = None,
                          request=None) -> dict:
    """派今天的任务。source=auto: 签到 / 打开首页时调,只在自动班、没暂停、老师今天没自己布置时派;
    source=teacher: 老师点「按建议布置」,手动班也派、老师自己布置过也派。一天一次。commit 由这里做"""
    settings = await get_settings(db)
    if not settings["enabled"]:
        return {"status": "off"}
    today = local_today()
    ts = _ds(today)
    sid = student.id
    if cls is None:
        cls, ac = await class_of_student(db, sid)
    else:
        ac = (await db.execute(select(AutopilotClass).where(AutopilotClass.class_id == cls.id))).scalar_one_or_none()
    if cls is None:
        return {"status": "no_class"}
    if source == "auto" and (ac is None or ac.mode != "auto"):
        return {"status": "manual"}
    existing = (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id == sid, AutopilotDispatch.day == ts))).scalar_one_or_none()
    if existing is not None and existing.status == "dispatched":
        return {"status": "dispatched", "already": True, "dispatch_id": existing.id}
    st = await student_row(db, sid, student.org_id)
    pause = (ac is not None and ac.paused) or st.paused
    manual_today = await manual_homework_today(db, sid, today)
    if source == "auto" and (pause or manual_today):
        status = "paused" if pause else "skipped_manual"
        reason = ("老师暂停了小鹰老师" if pause else "老师今天自己布置了作业,小鹰老师今天不派")
        if existing is None or existing.status != status:
            await db.execute(sqlite_insert(AutopilotDispatch).values(
                student_id=sid, day=ts, status=status, reason=reason, class_id=cls.id, org_id=student.org_id,
                teacher_id=cls.teacher_id).on_conflict_do_update(
                index_elements=["student_id", "day"], set_={"status": status, "reason": reason},
                where=AutopilotDispatch.status != "dispatched"))
            await db.commit()
        return {"status": status, "reason": reason}

    row = await _claim(db, sid, ts, class_id=cls.id, org_id=student.org_id, teacher_id=cls.teacher_id)
    if row is None:
        # 另一个请求正在派(首页几个接口同时到): 等它派完,别回一个空的
        await db.rollback()
        for _ in range(20):
            await asyncio.sleep(0.25)
            cur = (await db.execute(select(AutopilotDispatch.status, AutopilotDispatch.id).where(
                AutopilotDispatch.student_id == sid, AutopilotDispatch.day == ts))).first()
            await db.rollback()
            if cur is not None and cur.status != "claiming":
                return {"status": cur.status, "dispatch_id": cur.id, "already": True}
        return {"status": "busy"}
    try:
        st, tier, tier_reason, line, line_reason = await prepare(db, student, today, ac, st)
        plan = await build_plan(db, st, today, tier)
        location, loc_reason = location_for(ac, today)
        actor_name = AUTO_BY if source == "auto" else f"{AUTHOR}({(actor.full_name or actor.username) if actor else '老师'}点的)"
        row.source, row.actor_name, row.tier, row.pass_line, row.location = source, actor_name[:100], tier, line, location
        row.words = plan.words
        if plan.status != "ok":
            row.status, row.reason = plan.status, plan.reason
            row.plan = json.dumps({"book_id": plan.book_id, "items": []}, ensure_ascii=False)
            await db.commit()
            return {"status": plan.status, "reason": plan.reason}
        if st.enrolled_at is None:
            st.enrolled_at = utc_now()
        await _write_homework(db, student, cls, row, plan.items, today, line, location, actor_name[:100],
                              actor.id if (actor and source != "auto") else None, 0)
        row.status = "dispatched"
        row.reason = f"{tier_reason};{loc_reason}"[:300]
        row.plan = json.dumps({"book_id": plan.book_id, "book_name": plan.book_name,
                               "items": [i.out() for i in plan.items]}, ensure_ascii=False)
        # 老师点的记操作记录(追责);签到自动派的不记: 一个班一天几十条会把追责日志淹掉(陪跑点评同理),
        # 派了什么、为什么都在 autopilot_dispatches 里,「自动布置」页上看得到
        if actor is not None and source != "auto":
            from app.services import audit_log
            audit_log.record(
                db, request, actor, "autopilot.dispatch",
                f"按{AUTHOR}的建议给「{student.full_name or student.username}」布置今天的任务 {len(plan.items)} 份"
                f"({'电教室' if location == 'classroom' else '在家'})",
                target_type="student", target_id=sid,
                detail={"items": [i.out() for i in plan.items], "tier": tier, "pass_line": line})
        await db.commit()
        return {"status": "dispatched", "dispatch_id": row.id, "items": [i.out() for i in plan.items],
                "tier": tier, "pass_line": line}
    except Exception:
        # 占位那一行和这一次写的作业一起回滚,下次打开首页 / 签到会重来
        await db.rollback()
        raise


async def dispatch_quietly(student_id: int) -> None:
    """签到后调: 自己开会话,出错只记日志(签到不能因为这个失败)"""
    try:
        async with _session() as db:
            student = await db.get(User, student_id)
            if student is not None and student.role == "student":
                await ensure_dispatch(db, student)
    except Exception:  # noqa: BLE001
        logger.exception("小鹰老师签到派任务出错 student=%s", student_id)


async def sync_today_target(db: AsyncSession, student_ids: Iterable[int]) -> int:
    """老师改了过关线: 今天派的、还没做完的单词作业目标分跟着改(学习页横幅写的是作业目标分,
    不改的话横幅写 80、考完却说「过关要 90」)。做完了的不动。不 commit"""
    ids = list(student_ids)
    if not ids:
        return 0
    ts = _ds(local_today())
    rows = (await db.execute(
        select(AutopilotTask.homework_id, AutopilotTask.student_id)
        .where(AutopilotTask.student_id.in_(ids), AutopilotTask.day == ts, AutopilotTask.is_content.is_(False))
    )).all()
    n = 0
    for hid, sid in rows:
        line, _ = await pass_line_for(db, sid)
        done = (await db.execute(select(HomeworkStudentAssignment.status).where(
            HomeworkStudentAssignment.homework_id == hid, HomeworkStudentAssignment.student_id == sid))).scalar()
        if done == "completed":
            continue
        r = await db.execute(update(HomeworkAssignment).where(
            HomeworkAssignment.id == hid, HomeworkAssignment.target_score != line)
            .values(target_score=line).execution_options(synchronize_session=False))
        n += r.rowcount or 0
    return n


async def undo_today(db: AsyncSession, student_id: int) -> int:
    """老师撤回今天派的(孩子还没开始做的那几份);全撤了就把今天这一行删掉,可以重派。不 commit"""
    ts = _ds(local_today())
    row = (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id == student_id, AutopilotDispatch.day == ts))).scalar_one_or_none()
    if row is None:
        return 0
    tasks = list((await db.execute(select(AutopilotTask).where(AutopilotTask.dispatch_id == row.id))).scalars())
    removed = 0
    kept = 0
    for t in tasks:
        if t.is_content:
            s = (await db.execute(select(ContentHomeworkStudent).where(
                ContentHomeworkStudent.homework_id == t.homework_id))).scalars().first()
            if s is not None and s.completed_at is not None:
                kept += 1
                continue
            await db.execute(delete(ContentHomeworkStudent).where(ContentHomeworkStudent.homework_id == t.homework_id))
            await db.execute(delete(ContentHomework).where(ContentHomework.id == t.homework_id))
        else:
            s = (await db.execute(select(HomeworkStudentAssignment).where(
                HomeworkStudentAssignment.homework_id == t.homework_id))).scalars().first()
            if s is not None and (s.status != "pending" or (s.attempts_count or 0) > 0):
                kept += 1
                continue
            await db.execute(delete(HomeworkStudentAssignment).where(
                HomeworkStudentAssignment.homework_id == t.homework_id))
            await db.execute(delete(HomeworkAssignment).where(HomeworkAssignment.id == t.homework_id))
        await db.execute(delete(AutopilotTask).where(AutopilotTask.id == t.id))
        removed += 1
    if kept == 0:
        await db.execute(delete(AutopilotDispatch).where(AutopilotDispatch.id == row.id))
    return removed


# ---------------------------------------------------------------- 加练(今天的做完了还想背)

@dataclass
class TaskState:
    task: AutopilotTask
    done: bool
    assignment_id: Optional[int] = None     # 单词作业: homework_student_assignments.id(学生点「去做」用)


async def today_tasks(db: AsyncSession, student_id: int, ts: str) -> list[TaskState]:
    """这一天派给他的每一份 + 做完没有(老师在「作业管理」删掉的那份不算)"""
    rows = list((await db.execute(select(AutopilotTask).where(
        AutopilotTask.student_id == student_id, AutopilotTask.day == ts).order_by(AutopilotTask.id))).scalars())
    word_ids = [t.homework_id for t in rows if not t.is_content]
    status = {hid: (st, aid) for hid, st, aid in (await db.execute(
        select(HomeworkStudentAssignment.homework_id, HomeworkStudentAssignment.status, HomeworkStudentAssignment.id)
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(HomeworkStudentAssignment.homework_id.in_(word_ids), HomeworkStudentAssignment.student_id == student_id,
               HomeworkAssignment.is_closed.is_(False))
    )).all()} if word_ids else {}
    content_ids = [t.homework_id for t in rows if t.is_content]
    done_content: dict[int, bool] = {}
    if content_ids:
        from app.services import content_homework as chw
        links = list((await db.execute(
            select(ContentHomeworkStudent, ContentHomework)
            .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
            .where(ContentHomework.id.in_(content_ids), ContentHomeworkStudent.student_id == student_id,
                   ContentHomework.is_closed.is_(False))
        )).all())
        if await chw.refresh_completion(db, links):
            await db.commit()
        done_content = {h.id: s.completed_at is not None for s, h in links}
    out = []
    for t in rows:
        if t.is_content:
            if t.homework_id in done_content:
                out.append(TaskState(t, done_content[t.homework_id]))
        elif t.homework_id in status:
            st, aid = status[t.homework_id]
            out.append(TaskState(t, st == "completed", aid))
    return out


async def dispatch_extra(db: AsyncSession, student: User) -> dict:
    today = local_today()
    ts = _ds(today)
    row = (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id == student.id, AutopilotDispatch.day == ts))).scalar_one_or_none()
    if row is None or row.status != "dispatched":
        return {"ok": False, "message": "今天还没有小鹰老师派的任务"}
    tasks = await today_tasks(db, student.id, ts)
    if any(not x.done for x in tasks):
        return {"ok": False, "message": "先把今天的任务做完,再来一份"}
    if (row.extra_batches or 0) >= MAX_EXTRA_BATCHES:
        return {"ok": False, "message": f"今天已经加练 {MAX_EXTRA_BATCHES} 份了,休息一下,明天接着来"}
    r = await db.execute(update(AutopilotDispatch).where(
        AutopilotDispatch.id == row.id, AutopilotDispatch.extra_batches == (row.extra_batches or 0))
        .values(extra_batches=AutopilotDispatch.extra_batches + 1).execution_options(synchronize_session=False))
    if r.rowcount != 1:
        await db.rollback()
        return {"ok": False, "message": "正在派,稍等一下"}
    batch = (row.extra_batches or 0) + 1
    cls, ac = await class_of_student(db, student.id)
    if cls is None:
        await db.rollback()
        return {"ok": False, "message": "你还没有进班"}
    st = await student_row(db, student.id, student.org_id)
    tier, _ = effective_tier(st, ac)
    skip = {(x.task.unit_id, g) for x in tasks if x.task.unit_id for g in _task_groups(x.task)}
    plan = await build_plan(db, st, today, max(EXTRA_MIN, tier // 2), with_review=False, skip_units=skip)
    if plan.status != "ok" or not plan.items:
        await db.rollback()
        return {"ok": False, "message": "这本书能学的都派完了,明天小鹰老师再安排"}
    line, _ = await pass_line_for(db, student.id, st, ac, with_class=False)
    location, _ = location_for(ac, today)
    await _write_homework(db, student, cls, row, plan.items, today, line, location, AUTO_BY, None, batch)
    await db.commit()
    return {"ok": True, "batch": batch, "items": [i.out() for i in plan.items]}


def _task_groups(t: AutopilotTask) -> list[int]:
    out = []
    for x in (t.groups or "").split(","):
        try:
            out.append(int(x))
        except ValueError:
            pass
    return out or ([t.group_index] if t.group_index else [])


async def assignment_groups(db: AsyncSession, assignment_id: Optional[int], student_id: int) -> Optional[list[int]]:
    """从小鹰老师派的作业进来: 这份作业覆盖哪几组(学习页取词要整段给,不只第一组)。不是 → None"""
    if not assignment_id:
        return None
    hid = (await db.execute(select(HomeworkStudentAssignment.homework_id).where(
        HomeworkStudentAssignment.id == assignment_id,
        HomeworkStudentAssignment.student_id == student_id))).scalar_one_or_none()
    if hid is None:
        return None
    t = (await db.execute(select(AutopilotTask).where(AutopilotTask.homework_id == hid,
                                                      AutopilotTask.is_content.is_(False)))).scalars().first()
    gs = _task_groups(t) if t is not None else []
    return sorted(gs) if len(gs) > 1 else None


async def _passed_groups_today(db: AsyncSession, student_id: int, unit_id: int, ts: str) -> set[int]:
    got: set[int] = set()
    for (gs,) in (await db.execute(select(AutopilotAttempt.groups).where(
            AutopilotAttempt.student_id == student_id, AutopilotAttempt.unit_id == unit_id,
            AutopilotAttempt.day == ts, AutopilotAttempt.passed.is_(True)))).all():
        for x in (gs or "").split(","):
            if x.isdigit():
                got.add(int(x))
    return got


async def task_passed(db: AsyncSession, homework_id: int, student_id: int) -> Optional[bool]:
    """小鹰老师派的作业算不算完成: 这份里每一组今天都过了过关检测(服务器记的为准,不看前端报的听写分)。
    不是小鹰老师派的 → None(照旧按分数)"""
    t = (await db.execute(select(AutopilotTask).where(AutopilotTask.homework_id == homework_id,
                                                      AutopilotTask.is_content.is_(False)))).scalars().first()
    if t is None:
        return None
    return set(_task_groups(t)) <= await _passed_groups_today(db, student_id, t.unit_id, t.day)


async def complete_tasks(db: AsyncSession, student_id: int, unit_id: int, score: int) -> list[int]:
    """过关检测记完以后: 今天派的、这个单元的作业里,组都过了的标完成(不等前端交卷 —— 断网补交、
    从书本里直接学都算)。返回标完成的作业 id。不 commit"""
    ts = _ds(local_today())
    tasks = list((await db.execute(select(AutopilotTask).where(
        AutopilotTask.student_id == student_id, AutopilotTask.unit_id == unit_id, AutopilotTask.day == ts,
        AutopilotTask.is_content.is_(False)))).scalars())
    if not tasks:
        return []
    await db.flush()
    passed = await _passed_groups_today(db, student_id, unit_id, ts)
    now = utc_now()
    out = []
    for t in tasks:
        if not set(_task_groups(t)) <= passed:
            continue
        r = await db.execute(update(HomeworkStudentAssignment).where(
            HomeworkStudentAssignment.homework_id == t.homework_id,
            HomeworkStudentAssignment.student_id == student_id,
            HomeworkStudentAssignment.status.in_(("pending", "in_progress", "overdue", "failed")))
            .values(status="completed", completed_at=now,
                    best_score=func.max(func.coalesce(HomeworkStudentAssignment.best_score, 0), score))
            .execution_options(synchronize_session=False))
        if r.rowcount:
            out.append(t.homework_id)
    return out


# ---------------------------------------------------------------- 过关检测(每一次都记)

async def record_attempt(db: AsyncSession, student: User, unit_id: int, word_ids: list[int], score: int) -> dict:
    """记一次过关检测,按服务器的过关线判过没过,推进每组的轮次。不 commit"""
    today = local_today()
    ts = _ds(today)
    sid = student.id
    try:
        groups = await get_unit_groups(db, unit_id)
    except ValueError:
        groups = []
    book_id = (await db.execute(select(Unit.book_id).where(Unit.id == unit_id))).scalar_one_or_none()
    wset = set(word_ids)
    covered = [g for g in groups if g["word_ids"] and
               sum(1 for w in g["word_ids"] if w in wset) * 2 >= len(g["word_ids"])]
    st = (await db.execute(select(AutopilotStudent).where(AutopilotStudent.student_id == sid))).scalar_one_or_none()
    line, _ = await pass_line_for(db, sid, st)
    passed = score >= line
    idxs = [g["index"] for g in covered]
    rows = {r.group_index: r for r in (await db.execute(select(AutopilotGroup).where(
        AutopilotGroup.student_id == sid, AutopilotGroup.unit_id == unit_id,
        AutopilotGroup.group_index.in_(idxs)))).scalars()} if idxs else {}
    first_today = all(rows.get(i) is None or rows[i].try_day != ts for i in idxs)
    counted: Optional[int] = None
    graduated = False
    extra = False
    for g in covered:
        r = rows.get(g["index"])
        if r is None:
            await db.execute(sqlite_insert(AutopilotGroup).values(
                student_id=sid, unit_id=unit_id, group_index=g["index"], book_id=book_id,
                word_count=len(g["word_ids"]), rounds=0, extra_count=0, legacy=False,
            ).on_conflict_do_nothing(index_elements=["student_id", "unit_id", "group_index"]))
            r = (await db.execute(select(AutopilotGroup).where(
                AutopilotGroup.student_id == sid, AutopilotGroup.unit_id == unit_id,
                AutopilotGroup.group_index == g["index"]))).scalar_one()
        r.word_count = len(g["word_ids"])
        if r.try_day != ts:
            r.try_day, r.first_score = ts, score
        if not passed:
            continue
        if r.graduated_at is None and r.last_day != ts and (r.rounds == 0 or (r.next_due and ts >= r.next_due)):
            r.rounds += 1
            r.last_day = ts
            counted = max(counted or 0, r.rounds)
            if r.rounds >= GRADUATE_ROUNDS and (r.first_score or 0) >= line:
                r.graduated_at = utc_now()
                r.next_due = None
                graduated = True
            else:
                r.next_due = _ds(today + timedelta(days=round_gap(r.rounds)))
        else:
            extra = True
            if r.extra_day == ts:
                r.extra_count = (r.extra_count or 0) + 1
            else:
                r.extra_day, r.extra_count = ts, 1
    db.add(AutopilotAttempt(student_id=sid, org_id=student.org_id, unit_id=unit_id,
                            groups=",".join(str(i) for i in idxs) or None, word_count=len(wset), score=score,
                            required=line, passed=passed, first_today=first_today, counted_round=counted, day=ts))
    return {"required": line, "passed": passed, "round": counted, "graduated": graduated, "extra": extra,
            "groups": idxs}


# ---------------------------------------------------------------- 学生首页

async def today_view(db: AsyncSession, student: User) -> dict:
    """孩子首页那张卡: 签了到、自动班就顺手派;做完了顺手写点评"""
    from app.api.v1.checkin import has_checked_in_today
    settings = await get_settings(db)
    today = local_today()
    ts = _ds(today)
    checked_in = await has_checked_in_today(db, student.id)
    if settings["enabled"] and checked_in:
        try:
            await ensure_dispatch(db, student)
        except Exception:  # noqa: BLE001
            logger.exception("小鹰老师首页派任务出错 student=%s", student.id)
    row = (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id == student.id, AutopilotDispatch.day == ts))).scalar_one_or_none()
    st = (await db.execute(select(AutopilotStudent).where(AutopilotStudent.student_id == student.id))).scalar_one_or_none()
    line, line_reason = await pass_line_for(db, student.id, st)
    if row is None or row.status != "dispatched":
        # 没签到: 签到那一刻才派(ensure_dispatch 的条件照抄一遍),首页要告诉孩子「签到后小鹰老师就给你排」
        waiting = False
        if settings["enabled"] and not checked_in:
            _, ac = await class_of_student(db, student.id)
            waiting = (ac is not None and ac.mode == "auto" and not ac.paused
                       and not (st is not None and st.paused)
                       and not await manual_homework_today(db, student.id, today))
        return {"active": False, "pass_line": line, "pass_line_reason": line_reason,
                "checked_in": checked_in, "waiting_checkin": waiting}
    tasks = await today_tasks(db, student.id, ts)
    base = [x for x in tasks if x.task.batch == 0]
    extra_tasks = [x for x in tasks if x.task.batch > 0]
    all_done = bool(base) and all(x.done for x in base)
    repeats = int((await db.execute(select(func.coalesce(func.sum(AutopilotGroup.extra_count), 0)).where(
        AutopilotGroup.student_id == student.id, AutopilotGroup.extra_day == ts))).scalar() or 0)
    names = await _unit_names(db, [x.task.unit_id for x in tasks if x.task.unit_id])

    def item(x: TaskState) -> dict:
        t = x.task
        return {"kind": t.kind, "round": t.round_no, "words": t.words, "done": x.done, "batch": t.batch,
                "groups": _task_groups(t), "unit_name": names.get(t.unit_id, ("", None))[0] if t.unit_id else "",
                "assignment_id": x.assignment_id, "is_content": t.is_content}

    return {
        "active": True, "pass_line": line, "pass_line_reason": line_reason,
        "checked_in": checked_in,
        "tier": row.tier, "location": row.location,
        "items": [item(x) for x in base],
        "extra_items": [item(x) for x in extra_tasks],
        "all_done": all_done,
        "extra_left": max(0, MAX_EXTRA_BATCHES - (row.extra_batches or 0)),
        "extra_open": all_done and all(x.done for x in extra_tasks),
        "repeats_today": repeats,
        "dispatch_id": row.id,
        "comment_pending": all_done and row.comment_at is None,
    }


# ---------------------------------------------------------------- 点评(小鹰老师写)

COMMENT_RULES = """你是「小鹰老师」,飞鹰AI英语里的 AI 学习助手。现在要给一个中小学生写今天背单词的一句点评,孩子和家长都会看到。
要求:
1. 直接对孩子说话(用「你」),口语、温暖、具体,60 到 100 个字;不写名字、不写学校,不用 markdown,不用表情符号
2. 先说一件今天做得好的具体事(用给你的数字),再说明天要注意的一件事;没做完就温和地说清还差什么
3. 不承诺分数和排名,不批评,不说「笨」「差」
4. 只用给你的数据,不编
只输出一个 JSON 对象,别的什么都不要写:
{"comment": "点评", "focus": ["明天要多练的英文单词,最多 3 个,只能从数据里「今天写错的词」里挑"], "flag": "ok 或 struggling(今天明显学得吃力: 正确率很低、反复过不了关)"}"""


async def comment_facts(db: AsyncSession, row: AutopilotDispatch) -> dict:
    sid = row.student_id
    d = _pd(row.day)
    from app.services import daily_words, study_time
    from app.services.weak_words import SCORING_MODES
    tasks = await today_tasks(db, sid, row.day)
    base = [x for x in tasks if x.task.batch == 0]
    start, end = local_day_utc_range(d)
    wrong = [w for (w,) in (await db.execute(
        select(Word.word).join(LearningRecord, LearningRecord.word_id == Word.id)
        .where(LearningRecord.user_id == sid, LearningRecord.created_at >= start, LearningRecord.created_at < end,
               LearningRecord.is_correct.is_(False), LearningRecord.learning_mode.in_(SCORING_MODES))
        .group_by(func.lower(Word.word)).order_by(func.count().desc()).limit(8)
    )).all()]
    attempts = list((await db.execute(select(AutopilotAttempt).where(
        AutopilotAttempt.student_id == sid, AutopilotAttempt.day == row.day))).scalars())
    first = [a.score for a in attempts if a.first_today]
    graduated = (await db.execute(select(func.count()).select_from(AutopilotGroup).where(
        AutopilotGroup.student_id == sid, AutopilotGroup.graduated_at >= start, AutopilotGroup.graduated_at < end,
        AutopilotGroup.legacy.is_(False)))).scalar() or 0
    first_day = (await db.execute(select(func.count()).select_from(AutopilotDispatch).where(
        AutopilotDispatch.student_id == sid, AutopilotDispatch.status == "dispatched",
        AutopilotDispatch.day < row.day))).scalar() == 0
    return {
        "first_day": bool(first_day),
        "tasks_total": len(base), "tasks_done": sum(1 for x in base if x.done),
        "rounds_done": sum(1 for x in base if x.done and x.task.kind == "round"),
        "extra_batches_done": len({x.task.batch for x in tasks if x.task.batch > 0 and x.done}),
        "words_learned": await daily_words.words_on_day(db, sid, d),
        "minutes": round((await study_time.seconds_on_day(db, sid, d)) / 60),
        "first_try_avg": round(sum(first) / len(first)) if first else None,
        "exams": len(attempts), "exams_failed": sum(1 for a in attempts if not a.passed),
        "pass_line": row.pass_line, "groups_mastered_today": int(graduated),
        "repeats_by_self": sum(1 for a in attempts if a.passed and a.counted_round is None),
        "wrong_words": wrong,
    }


def rule_comment(f: dict) -> tuple[str, list[str], str]:
    """模型没开 / 没调通时用。只夸做到的、说清还差什么,低分不点出来(孩子和家长都看得到)"""
    focus = f["wrong_words"][:3]
    head = "第一天和小鹰老师一起背单词,欢迎你!" if f["first_day"] else ""
    parts = []
    if f["tasks_total"] and f["tasks_done"] == f["tasks_total"]:
        parts.append(f"今天的 {f['tasks_total']} 份任务都做完了,学了 {f['words_learned']} 个词")
    elif f["tasks_total"]:
        parts.append(f"今天的任务做了 {f['tasks_done']}/{f['tasks_total']} 份,明天先把剩下的补上")
    avg = f["first_try_avg"]
    if avg is not None and avg >= UP_SCORE:
        parts.append(f"过关检测第一次就平均 {avg} 分")
    elif f["exams_failed"] and f["tasks_total"] and f["tasks_done"] == f["tasks_total"]:
        parts.append("没过的组你又练了一遍,最后都过关了")
    if f["groups_mastered_today"]:
        parts.append(f"又学会了 {f['groups_mastered_today']} 组")
    text = head + ",".join(parts) + ("。" if parts else "")
    if focus:
        text += f"明天先把 {'、'.join(focus)} 再写两遍。"
    elif not f["tasks_total"] or f["tasks_done"] == f["tasks_total"]:
        text += "明天接着来!"     # 没做完的那句已经说了明天补,别再说一遍
    flag = "struggling" if (avg is not None and avg < DOWN_SCORE) else "ok"
    return text, focus, flag


_PHONE = re.compile(r"\d{7,}")


def check_ai_comment(raw: str, f: dict) -> Optional[tuple[str, list[str], str]]:
    """模型的回答: 必须是 JSON、点评 10–150 字、不带网址和长串数字;focus 只认今天写错的词"""
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    from app.services.tutor import plain
    text = plain(str(data.get("comment") or "")).strip()
    if not 10 <= len(text) <= 150 or "http" in text.lower() or _PHONE.search(text):
        return None
    allowed = {w.lower(): w for w in f["wrong_words"]}
    focus = []
    for w in data.get("focus") or []:
        k = str(w).strip().lower()
        if k in allowed and allowed[k] not in focus:
            focus.append(allowed[k])
    flag = data.get("flag") if data.get("flag") in ("ok", "struggling") else "ok"
    return text, focus[:3], flag


async def ai_comment(db: AsyncSession, row: AutopilotDispatch, f: dict) -> Optional[tuple[tuple[str, list[str], str], int]]:
    """本校开通了学习助手才用(不扣次数);中转没配 / 没调通 → None,按规则写"""
    from app.services import tutor as tt
    settings = await tt.get_settings(db)
    if await tt.org_open_reason(db, settings["scope"], row.org_id) is None:
        return None
    conf = await tt.relay_conf(db)
    if conf is None:
        return None
    facts = {k: v for k, v in f.items()}
    msg = "今天的数据(JSON):\n" + json.dumps(facts, ensure_ascii=False)
    models = [m for m in [conf.fallback, conf.model] if m]
    async with tt.new_client() as cli:
        for m in models:
            if await tt._is_down(m):
                continue
            body = {"model": m, "max_tokens": 400, "system": COMMENT_RULES,
                    "messages": [{"role": "user", "content": msg}]}
            body.update(tt.fast_thinking(m))
            try:
                r = await cli.post(f"{conf.base_url}/v1/messages", headers=tt._headers(conf), json=body)
            except Exception:  # noqa: BLE001
                continue
            if r.status_code != 200:
                continue
            data = r.json()
            text = "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")
            if tt.RELAY_EMPTY_MARK in text:
                continue
            got = check_ai_comment(text, f)
            if got:
                u = data.get("usage") or {}
                return got, int((u.get("input_tokens") or 0) + (u.get("output_tokens") or 0))
    return None


async def write_comment(db: AsyncSession, dispatch_id: int) -> Optional[str]:
    """认领这一天的点评(一天一条)→ 写进「老师今天对你说」。老师当天自己写过的不覆盖。commit 由这里做"""
    now = utc_now()
    r = await db.execute(update(AutopilotDispatch).where(
        AutopilotDispatch.id == dispatch_id, AutopilotDispatch.comment_at.is_(None),
        AutopilotDispatch.status == "dispatched").values(comment_at=now).execution_options(synchronize_session=False))
    await db.commit()
    if r.rowcount != 1:
        return None
    row = await db.get(AutopilotDispatch, dispatch_id)
    await db.refresh(row)
    d = _pd(row.day)
    note = (await db.execute(select(CoachNote).where(CoachNote.student_id == row.student_id,
                                                     CoachNote.note_date == d))).scalar_one_or_none()
    if note is not None and note.author_id is not None:
        row.comment_source = "skip"
        await db.commit()
        return None
    f = await comment_facts(db, row)
    got = None
    try:
        got = await ai_comment(db, row, f)
    except Exception:  # noqa: BLE001
        logger.exception("小鹰老师写点评没调通 dispatch=%s", dispatch_id)
    if got:
        (text, focus, flag), tokens = got
        row.comment_source, row.comment_tokens = "ai", tokens
    else:
        text, focus, flag = rule_comment(f)
        row.comment_source = "rule"
    row.comment_flag = flag
    if note is None:
        db.add(CoachNote(student_id=row.student_id, teacher_id=row.teacher_id or 0, org_id=row.org_id,
                         note_date=d, content=text, author_id=None, author_name=AUTHOR))
    else:
        note.content = text
        note.author_name = AUTHOR
        note.read_by_student_at = None
        note.read_by_parent_at = None
    await db.commit()
    return text


async def comment_quietly(dispatch_id: int) -> None:
    try:
        async with _session() as db:
            await write_comment(db, dispatch_id)
    except Exception:  # noqa: BLE001
        logger.exception("小鹰老师点评出错 dispatch=%s", dispatch_id)


async def after_submit(student_id: int) -> None:
    """孩子交了一份作业: 今天的都做完了就写点评(自己开会话)"""
    try:
        async with _session() as db:
            ts = _ds(local_today())
            row = (await db.execute(select(AutopilotDispatch).where(
                AutopilotDispatch.student_id == student_id, AutopilotDispatch.day == ts))).scalar_one_or_none()
            if row is None or row.status != "dispatched" or row.comment_at is not None:
                return
            base = [x.done for x in await today_tasks(db, student_id, ts) if x.task.batch == 0]
            if base and all(base):
                await write_comment(db, row.id)
    except Exception:  # noqa: BLE001
        logger.exception("小鹰老师交卷后点评出错 student=%s", student_id)


_evening_day: Optional[str] = None


async def evening_quietly() -> None:
    """后台循环调: 北京 22:30 以后,今天派过任务、还没写点评的孩子统一写一条(一天一遍)"""
    global _evening_day
    now = datetime.now(LOCAL_TZ)
    ts = now.date().isoformat()
    if _evening_day == ts or (now.hour, now.minute) < EVENING:
        return
    _evening_day = ts
    try:
        async with _session() as db:
            ids = [i for (i,) in (await db.execute(select(AutopilotDispatch.id).where(
                AutopilotDispatch.day == ts, AutopilotDispatch.status == "dispatched",
                AutopilotDispatch.comment_at.is_(None)))).all()]
            for i in ids:
                try:
                    await write_comment(db, i)
                except Exception:  # noqa: BLE001
                    await db.rollback()
                    logger.exception("小鹰老师晚上点评出错 dispatch=%s", i)
            if ids:
                logger.info("小鹰老师晚上写了 %s 条点评", len(ids))
    except Exception:  # noqa: BLE001
        logger.exception("小鹰老师晚上点评出错")


# ---------------------------------------------------------------- 老师页面: 全班一览、需要你处理

TODO_KINDS = {
    "alert": "需要关心",
    "handoff": "要请你当面讲",
    "stuck": "走了 3 轮还没学会",
    "struggling": "今天学得吃力",
    "absent": "连着几天没来",
    "no_book": "还没有书",
    "gated": "书要兑换学习卡",
    "finished": "书学完了",
}


def _name(u_full: Optional[str], u_name: Optional[str]) -> str:
    return (u_full or "").strip() or (u_name or "").strip() or "学生"


async def class_students(db: AsyncSession, class_id: int) -> list[User]:
    return list((await db.execute(
        select(User).join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True),
               User.role == "student", User.is_active.is_(True))
        .order_by(User.full_name, User.username)
    )).scalars())


async def group_stats(db: AsyncSession, student_ids: list[int], ts: str) -> dict[int, dict]:
    out = {sid: {"learning": 0, "graduated": 0, "stuck": 0, "due": 0} for sid in student_ids}
    if not student_ids:
        return out
    rows = list((await db.execute(select(AutopilotGroup).where(AutopilotGroup.student_id.in_(student_ids)))).scalars())
    dead = await dead_units(db, [r.unit_id for r in rows])
    for r in rows:
        if r.unit_id in dead:
            continue
        o = out[r.student_id]
        if r.graduated_at is not None:
            o["graduated"] += 1
            continue
        o["learning"] += 1
        if r.rounds >= GRADUATE_ROUNDS:
            o["stuck"] += 1
        if r.next_due and r.next_due <= ts:
            o["due"] += 1
    return out


async def class_board(db: AsyncSession, cls: Class, ac: Optional[AutopilotClass]) -> list[dict]:
    from app.services import coach
    today = local_today()
    ts = _ds(today)
    students = await class_students(db, cls.id)
    sids = [s.id for s in students]
    if not sids:
        return []
    disp = {d.student_id: d for d in (await db.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.student_id.in_(sids), AutopilotDispatch.day == ts))).scalars()}
    srows = {r.student_id: r for r in (await db.execute(select(AutopilotStudent).where(
        AutopilotStudent.student_id.in_(sids)))).scalars()}
    stats = await group_stats(db, sids, ts)
    last_day, _week = await coach._last_days(db, sids, today)
    book_ids = [r.book_id for r in srows.values() if r.book_id]
    books = dict((await db.execute(select(WordBook.id, WordBook.name).where(WordBook.id.in_(book_ids)))).all()) \
        if book_ids else dict()
    out = []
    for s in students:
        st = srows.get(s.id)
        d = disp.get(s.id)
        line, line_reason = await pass_line_for(db, s.id, st, ac, with_class=False)
        tier, tier_reason = effective_tier(st, ac) if st is not None and (st.tier or st.fixed_words) else (None, "")
        today_out = None
        if d is not None:
            items = []
            if d.status == "dispatched":
                tasks = await today_tasks(db, s.id, ts)
                names = await _unit_names(db, [x.task.unit_id for x in tasks if x.task.unit_id])
                for x in tasks:
                    t = x.task
                    items.append({"kind": t.kind, "round": t.round_no, "words": t.words, "done": x.done,
                                  "batch": t.batch, "groups": _task_groups(t),
                                  "unit_name": names.get(t.unit_id, ("", None))[0] if t.unit_id else ""})
            base = [i for i in items if i["batch"] == 0]
            today_out = {"status": d.status, "reason": d.reason or "", "source": d.source,
                         "actor_name": d.actor_name or "", "location": d.location, "items": items,
                         "done": sum(1 for i in base if i["done"]), "total": len(base),
                         "extra_batches": d.extra_batches or 0, "comment_source": d.comment_source,
                         "comment_flag": d.comment_flag}
        ld = last_day.get(s.id)
        out.append({
            "id": s.id, "name": _name(s.full_name, s.username),
            "tier": tier, "tier_reason": tier_reason, "fixed_words": st.fixed_words if st else None,
            "pass_line": line, "pass_line_reason": line_reason, "fixed_pass_line": st.fixed_pass_line if st else None,
            "paused": bool(st.paused) if st else False,
            "book_id": st.book_id if st else None, "book_name": books.get(st.book_id, "") if st and st.book_id else "",
            "start_unit_id": st.start_unit_id if st else None,
            "enrolled": bool(st and st.enrolled_at), "today": today_out, "groups": stats[s.id],
            "last_day": ld.isoformat() if ld else None,
        })
    return out


async def todo(db: AsyncSession, teacher_id: int) -> list[dict]:
    """「需要你处理」: 小鹰老师自己解决不了、要老师出面的事。按要紧排: 需要关心 → 要当面讲 → 3 轮没学会 →
    今天吃力 → 几天没来 → 没书 / 书要卡 / 书学完了"""
    from app.models.tutor import TutorAlert
    from app.services import coach, tutor_notes
    today = local_today()
    ts = _ds(today)
    rows = (await db.execute(
        select(User.id, User.full_name, User.username, Class.name)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher_id, ClassStudent.is_active.is_(True), User.role == "student",
               User.is_active.is_(True))
        .order_by(Class.id)
    )).all()
    who: dict[int, tuple[str, str]] = {}
    for uid, fname, uname, cname in rows:
        who.setdefault(uid, (_name(fname, uname), cname or ""))
    sids = list(who)
    if not sids:
        return []
    out: list[dict] = []

    def add(kind: str, sid: int, text: str, **extra):
        name, cname = who.get(sid, ("学生", ""))
        out.append({"kind": kind, "label": TODO_KINDS[kind], "student_id": sid, "student_name": name,
                    "class_name": cname, "text": text, **extra})

    for a in (await db.execute(select(TutorAlert).where(TutorAlert.user_id.in_(sids),
                                                        TutorAlert.handled_at.is_(None))
                               .order_by(TutorAlert.created_at.desc()))).scalars():
        add("alert", a.user_id, "孩子跟小鹰老师说的话里有让人担心的内容,去「小鹰老师 · 本班情况」看原话并处理",
            level=a.level)
    for h in await tutor_notes.handoffs(db, sids):
        add("handoff", h["student_id"], f"「{h['topic']}」练习里错了 {h['times_wrong']} 次,请当面讲一下",
            note_id=h["note_id"])
    stuck: dict[tuple[int, int], list[AutopilotGroup]] = defaultdict(list)
    for g in (await db.execute(select(AutopilotGroup).where(
            AutopilotGroup.student_id.in_(sids), AutopilotGroup.graduated_at.is_(None),
            AutopilotGroup.rounds >= GRADUATE_ROUNDS))).scalars():
        stuck[(g.student_id, g.unit_id)].append(g)
    dead = await dead_units(db, [u for _, u in stuck])
    stuck = {k: v for k, v in stuck.items() if k[1] not in dead}
    names = await _unit_names(db, [u for _, u in stuck])
    for (sid, uid), gs in stuck.items():
        gs.sort(key=lambda g: g.group_index)
        groups = "、".join(f"第{g.group_index}组" for g in gs[:4]) + ("等" if len(gs) > 4 else "")
        add("stuck", sid, f"{names.get(uid, ('', None))[0]} {groups}已经背了 {max(g.rounds for g in gs)} 轮,"
                          f"当天第一次过关检测还是没到过关线。小鹰老师会接着派,最好当面看看是哪几个词",
            unit_id=uid)
    since = _ds(today - timedelta(days=2))
    for d in (await db.execute(select(AutopilotDispatch).where(
            AutopilotDispatch.student_id.in_(sids), AutopilotDispatch.day >= since,
            AutopilotDispatch.comment_flag == "struggling").order_by(AutopilotDispatch.day.desc()))).scalars():
        if not any(o["kind"] == "struggling" and o["student_id"] == d.student_id for o in out):
            add("struggling", d.student_id, f"{d.day[5:]} 小鹰老师看他学得吃力(过关检测第一次分数低、反复过不了)。"
                                            f"可以把他每天的量调小一点,或者当面问问")
    last_day, _ = await coach._last_days(db, sids, today)
    for sid in sids:
        ld = last_day.get(sid)
        if ld is not None and 3 <= (today - ld).days <= 14:
            add("absent", sid, f"已经 {(today - ld).days} 天没来学了(最后一次 {ld.month}月{ld.day}日)。"
                               f"小鹰老师只在孩子签到后派任务,没来就派不了")
    for d in (await db.execute(select(AutopilotDispatch).where(
            AutopilotDispatch.student_id.in_(sids), AutopilotDispatch.day == ts,
            AutopilotDispatch.status.in_(("no_book", "gated", "finished"))))).scalars():
        text = {"no_book": "还没有能学的书。先给他分配一本(「分配单词本」),小鹰老师就从第一个单元开始派",
                "gated": "老师指定的书要先兑换学习卡,给他发卡或换一本",
                "finished": f"{d.reason or '这本书学完了'}。给他分配下一本书,或者在这里指定"}[d.status]
        add(d.status, d.student_id, text)
    return out
