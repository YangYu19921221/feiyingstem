"""
全班打大怪(2026-11-12)

为什么要有: 对战、闯关都是一个人的事。大怪是全班一起的目标,没有输家;而且**伤害只来自把该做的做完**
(老师布置的任务、今日复习、学新词)—— 不来自打对战: 对战已经有场数管着,再让它加伤害就成了刷的入口。

规则(这里是唯一一份;页面上的数都来自 overview(),前端不另写):
  1. 一个班一周一只大怪。一周 = 北京时间周一 0 点到周日 24 点。
  2. 孩子在几个班: 算人数最多的那个班(并列取 id 小的)。没进班 → 没有大怪。
  3. 出不出大怪看**在班人数**: 不到 3 个人的班不出。
     大怪的血看**在学的人数**: 血 = max(3, 在学的人数) × 60。「在学的人」= 现在在班的学生里,
       到这一周周一为止的 14 天内学过的(study_calendar 那天有学习时长或者学了词 —— 和每日陪跑「学了」同一个判据),
       加上这一周里来学了的(这一周日历上有记录,或者这一周做完过作业 / 今日复习、学过新词)。
     久不来的不算(不然在学的孩子打满也打不死);他这一周回来了就算进来 —— 血多 60,他自己也能出力。
     ⚠️ 60 和 14 这两个数**没有拿线上数据校过**(11-12 定的时候查不了线上各班在学的比例)。
     上线后看各班一周实际打掉了几成血再调: HP_PER_STUDENT / ACTIVE_DAYS。
  4. 伤害全部从已有的记录现算,不另记流水。这一周里每个学生每天:
       每做完一份老师布置的任务 +10(单词作业完成、句子 / 音标 / 跟读作业完成 —— 和对战场数里「今天做完的作业」
         同一套口径: 在家做的也算,布置成作业的「每日复习」不在这里算);
       那天的今日复习做完 +10(和对战场数里「做完今日复习」同一个判据: 那天没有要复习的词就没有这一项);
       那天每学 20 个词 +5(和对战场数里「今天学的词」同一个数: 按拼写去重、只分类没练的不算);
     **每人每天最多 30 点** —— 一个孩子刷不满全班的,别人不来大怪就打不死。
     打对战、闯关、挑战影子都不加伤害。
  5. 打死 = 全班这一周的伤害加起来 ≥ 大怪的血。
  6. 奖励: 打死之后,这一周出过力(这一周的伤害 ≥ 10)的学生各领一次: 粮食 +40、经验 +60。
     经验加在他出战的那只宠物上(照常结算升级 / 进化);没有宠物的只给粮食(记在 users.pet_food_reserve,领养时带上)。
     **只能领一次**: class_boss_claims 一人一周一行,先插这一行、插成了才发;同一周换了班也只能领一次。
  7. 上一周打死了、还没领的: 这一周的前 3 天(周一到周三)还能领,周四起作废。
     上一周的血量同样按「在学的人」算: 现在在班的学生里,到**那一周**周一为止 14 天内学过的 + 那一周来学了的。
  8. 大怪长什么样: 从练习赛的对手池(不含传说)里按 (班, 周) 定死挑一只 —— 同一个班同一周永远是同一只,
     不同的班可以不同;显示它进化到第 3 档的样子(evolution_stage = 3),名字「本周大怪 · {种族名}」(去掉「家族」两个字)。
  9. 全班的数(每个人这一周打了多少、哪些人在学)缓存 60 秒(core/shared_store,键带班和周);**我自己的那一份每次现算**、
     盖在缓存上面 —— 做完作业回来马上看得到自己的涨了、大怪的血少了。同学的要等最多 60 秒。
     句子 / 音标 / 跟读作业的「完成」是打开作业页或者对战大厅时才判的(现成的规矩): 我自己的每次先判一遍;
     同学的等他自己打开过才记上。
     缓存过期的那一下,同一个进程里只让一个请求去算(别的等它算完读缓存): 电教室里一个班的孩子常常同时打开。
     算一次要多久(11-12 在本机库副本上量的。本机最大的班只有 12 个人: 12 毫秒。所以另造了两个班,
     每人一周 15 份作业、100 个复习词、300 个新词): 90 人的班约 0.1 秒,250 人约 0.3 秒;有缓存时整个接口 10–30 毫秒。
     最慢的是「今日复习做完没有」: 完成时刻还没记上的那几份要翻当天的学习记录(全班一周一份都没记上时
     90 人 0.5 秒、250 人 1.2 秒),翻出来做完了的顺手记上,下一次就不用再翻。
 10. 排行只列这一周出过力的前 3 个人(不列谁没出力)。「出过力的人数」同一个门槛(≥ 10)。
     接口里 students = 在学的人数(页面上「N / M 人出过力」的 M),enrolled = 在班人数(备查)。
 12. 「今天还能怎么再拿」那一句(mine.items 的 how): 今天已经拿满 30 → 三项都不说了(null)。
     作业那一项: 有现在能做、还没做完的 → 「今天还有 N 份没做完」(去作业页);一份都没有、今天也没做完过 →
     「今天没有布置作业」;今天做完了、没有别的可做 → null。
 11. 平台开关: battle_tickets 的 class_boss(默认开)。

全班一周的数怎么算: 每种来源一条按 (学生, 北京日) 分组的查询(单词作业、内容作业、学词各一条;今日复习按天一条),
不按人循环。
"""
import asyncio
import hashlib
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pet_formulas import apply_xp_and_level
from app.core.pet_species import get_pet_label, get_pet_stage_name
from app.core.shared_store import store
from app.core.timeutil import local_day_utc_range, local_today
from app.models.class_boss import ClassBossClaim
from app.models.content_homework import KIND_DAILY_REVIEW, ContentHomework, ContentHomeworkStudent
from app.models.daily_review import DailyReviewPlan
from app.models.learning import HomeworkStudentAssignment
from app.models.pet import PetEventLog, UserPet
from app.models.user import Class, ClassStudent, StudyCalendar, User
from app.services import battle_tickets, daily_review, daily_words
from app.services.ai_opponent_service import AI_PET_SPECIES
from app.services.pet_shadow import classmate_name

HP_PER_STUDENT = 60
MIN_STUDENTS = 3            # 在班不到这么多人的班不出大怪
HP_MIN_HEADS = 3            # 在学的人再少,血量也按这么多人算
ACTIVE_DAYS = 14            # 到那一周周一为止这么多天内学过的,算「在学」
TASK_POINTS = 10
REVIEW_POINTS = 10
WORDS_STEP = 20
WORDS_POINTS = 5
DAY_CAP = 30
JOIN_MIN = 10
REWARD_FOOD = 40
REWARD_XP = 60
LATE_CLAIM_DAYS = 3
CACHE_SECONDS = 60
TOP_N = 3
BOSS_STAGE = 3

ROUTE_HOMEWORK = "/student/homework"
ROUTE_REVIEW = "/student/memory-curve"
ROUTE_BOOKS = "/student/dashboard"


# ---------------------------------------------------------------- 哪一周、哪个班、哪只大怪

def week_of(d: date) -> tuple:
    """d 所在的那一周 → (周一, 周日)"""
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=6)


def boss_for(class_id: int, monday: date) -> dict:
    """规则第 8 条: 这个班这一周的大怪(按 (班, 周) 定死)"""
    pool = sorted(AI_PET_SPECIES)
    seed = int(hashlib.md5(f"{class_id}:{monday.isoformat()}".encode("utf-8")).hexdigest(), 16)
    species = pool[seed % len(pool)]
    label = get_pet_label(species)
    if label.endswith("家族") and len(label) > 2:
        label = label[:-2]
    return {"species": species, "evolution_stage": BOSS_STAGE, "name": f"本周大怪 · {label}"}


async def class_of(db: AsyncSession, user_id: int) -> Optional[dict]:
    """规则第 2 条: 这个孩子算哪个班 → {id, name, roster: 班里现在的学生 id}。没进班 → None"""
    mine = list((await db.execute(
        select(ClassStudent.class_id).where(ClassStudent.student_id == user_id, ClassStudent.is_active.is_(True))
    )).scalars())
    if not mine:
        return None
    rows = (await db.execute(
        select(ClassStudent.class_id, ClassStudent.student_id)
        .join(User, User.id == ClassStudent.student_id)
        .where(ClassStudent.class_id.in_(mine), ClassStudent.is_active.is_(True),
               User.role == "student", User.is_active.is_(True))
    )).all()
    rosters: Dict[int, set] = {}
    for class_id, student_id in rows:
        rosters.setdefault(class_id, set()).add(student_id)
    if not rosters:
        return None
    class_id = sorted(rosters, key=lambda c: (-len(rosters[c]), c))[0]
    cls = await db.get(Class, class_id)
    return {"id": class_id, "name": cls.name if cls else "", "roster": sorted(rosters[class_id])}


# ---------------------------------------------------------------- 伤害(从已有的记录现算)

def _empty_day() -> dict:
    return {"tasks": 0, "review": False, "words": 0}


def points_of(day: Optional[dict]) -> dict:
    """一个孩子一天三种来源各拿多少点(没封顶的)"""
    day = day or _empty_day()
    return {
        "task": int(day["tasks"]) * TASK_POINTS,
        "review": REVIEW_POINTS if day["review"] else 0,
        "words": (int(day["words"]) // WORDS_STEP) * WORDS_POINTS,
    }


def day_total(day: Optional[dict]) -> int:
    """一个孩子一天算多少点: 三种加起来,最多 DAY_CAP"""
    return min(DAY_CAP, sum(points_of(day).values()))


async def days_of(db: AsyncSession, user_ids: List[int], first: date, last: date) -> Dict[int, Dict[str, dict]]:
    """这些孩子从 first 到 last(北京日,两头都含)每人每天: 做完几份任务、今日复习做完没有、学了几个词。
    → {user_id: {"YYYY-MM-DD": {tasks, review, words}}}。每种来源一条按 (学生, 北京日) 分组的查询"""
    uids = [i for i in user_ids if i]
    out: Dict[int, Dict[str, dict]] = {}
    if not uids:
        return out
    start, _ = local_day_utc_range(first)
    _, end = local_day_utc_range(last)

    def cell(uid: int, day: str) -> dict:
        return out.setdefault(uid, {}).setdefault(day, _empty_day())

    # 1. 单词作业: 完成时刻落在哪一天算哪一天
    word_day = func.date(HomeworkStudentAssignment.completed_at, "+8 hours")
    for uid, day, n in (await db.execute(
        select(HomeworkStudentAssignment.student_id, word_day, func.count())
        .where(HomeworkStudentAssignment.student_id.in_(uids),
               HomeworkStudentAssignment.status == "completed",
               HomeworkStudentAssignment.completed_at >= start,
               HomeworkStudentAssignment.completed_at < end)
        .group_by(HomeworkStudentAssignment.student_id, word_day)
    )).all():
        cell(uid, str(day))["tasks"] += int(n)
    # 2. 句子 / 音标 / 跟读作业(布置成作业的「每日复习」不在这里算,它算在今日复习那 10 点里)
    content_day = func.date(ContentHomeworkStudent.completed_at, "+8 hours")
    for uid, day, n in (await db.execute(
        select(ContentHomeworkStudent.student_id, content_day, func.count())
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(ContentHomeworkStudent.student_id.in_(uids),
               ContentHomework.kind != KIND_DAILY_REVIEW,
               ContentHomeworkStudent.completed_at >= start,
               ContentHomeworkStudent.completed_at < end)
        .group_by(ContentHomeworkStudent.student_id, content_day)
    )).all():
        cell(uid, str(day))["tasks"] += int(n)
    # 3. 今日复习: 那一份有词、而且全做完了(只读,不替谁标完成)
    plans = list((await db.execute(
        select(DailyReviewPlan).where(DailyReviewPlan.user_id.in_(uids),
                                      DailyReviewPlan.plan_date >= first, DailyReviewPlan.plan_date <= last)
    )).scalars())
    # 已经记了完成时刻的(孩子做完以后打开过首页 / 复习页 / 对战大厅,绝大多数是这种)直接算;
    # 还没记上的才去翻那天的学习记录 —— 全班一周都翻一遍是这里最慢的一步(90 人的班约 0.4 秒)。
    # 翻出来做完了的顺手记上完成时刻(用 daily_review 自己的那个算法: 最后一个词当天第一次练到的时刻,
    # 谁来算都是同一个数),下一次就不用再翻
    progress = await daily_review._first_times(db, [p for p in plans if p.completed_at is None])
    newly_marked = False
    for plan in plans:
        if plan.completed_at is not None:
            done = bool(daily_review._words(plan))      # 那天没有要复习的词也会记完成时刻: 不算
        else:
            ids, times = progress.get(plan.id, ([], {}))
            done = bool(ids) and all(i in times for i in ids)
            if done:
                daily_review._settle_one(plan, (ids, times))
                newly_marked = True
        if done:
            day = plan.plan_date if isinstance(plan.plan_date, date) else date.fromisoformat(str(plan.plan_date))
            cell(plan.user_id, day.isoformat())["review"] = True
    if newly_marked:
        await db.commit()
    # 4. 学词
    for (uid, day), n in (await daily_words.words_by_student_day(db, uids, first, last)).items():
        cell(uid, day)["words"] = int(n)
    return out


def week_total(days: Optional[Dict[str, dict]]) -> int:
    return sum(day_total(d) for d in (days or {}).values())


_locks: Dict[tuple, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    """算全班的数时用的锁(一个缓存键一把,只管本进程)。按事件循环分开放: 锁不能跨事件循环用"""
    slot = (id(asyncio.get_running_loop()), key)
    lock = _locks.get(slot)
    if lock is None:
        if len(_locks) > 500:       # 一周一个班一把,攒多了(换了很多周 / 很多事件循环)就清掉没人拿着的
            for old in [k for k, v in _locks.items() if not v.locked()]:
                _locks.pop(old, None)
        lock = _locks[slot] = asyncio.Lock()
    return lock


def hp_for(active_count: int) -> int:
    """规则第 3 条: 大怪的血 = max(3, 在学的人数) × 60"""
    return max(HP_MIN_HEADS, int(active_count)) * HP_PER_STUDENT


async def studied_ids(db: AsyncSession, roster: List[int], monday: date) -> List[int]:
    """roster 里哪些人算「在学」(只看日历的那一半): 到 monday 为止 ACTIVE_DAYS 天内学过的,或者 monday 那一周里来学了的。
    「学了」= study_calendar 那天有学习时长或者学了词(和每日陪跑同一个判据;只有切屏 / 发呆记录的空行不算)"""
    uids = [i for i in roster if i]
    if not uids:
        return []
    learned = or_(func.coalesce(StudyCalendar.duration, 0) > 0, func.coalesce(StudyCalendar.words_learned, 0) > 0)
    return sorted(set((await db.execute(
        select(StudyCalendar.user_id).where(and_(
            StudyCalendar.user_id.in_(uids), learned,
            StudyCalendar.study_date >= monday - timedelta(days=ACTIVE_DAYS),
            StudyCalendar.study_date <= monday + timedelta(days=6),
        )).distinct()
    )).scalars()))


async def class_week(db: AsyncSession, class_id: int, roster: List[int], monday: date) -> dict:
    """全班 monday 那一周的数 → {"totals": {user_id: 点数}(只有打过的人), "active": [在学的人的 id]}。
    缓存 60 秒(规则第 9 条)"""
    key = f"class_boss:{class_id}:{monday.isoformat()}"

    async def read() -> Optional[dict]:
        cached = await store.get_json(key)
        if (isinstance(cached, dict) and isinstance(cached.get("totals"), dict)
                and isinstance(cached.get("active"), list)):
            return {"totals": {int(uid): int(n) for uid, n in cached["totals"].items()},
                    "active": [int(uid) for uid in cached["active"]]}
        return None

    got = await read()
    if got is not None:
        return got
    # 缓存刚过期的那一下,电教室里一个班几十个孩子可能同时打开: 同一个进程里只让一个去算,别的等它算完读缓存
    async with _lock_for(key):
        got = await read()
        if got is not None:
            return got
        days = await days_of(db, roster, monday, monday + timedelta(days=6))
        totals = {uid: week_total(d) for uid, d in days.items()}
        totals = {uid: n for uid, n in totals.items() if n > 0}
        # 在学的人 = 日历上算在学的 + 这一周做完过作业 / 今日复习 / 学过词的
        # (日历万一漏记,这一周来学了的人也一定算进血量 —— 出了力的人不会不在「在学的人」里)
        active = sorted(set(await studied_ids(db, roster, monday)) | set(days))
        await store.set_json(key, {"totals": {str(uid): n for uid, n in totals.items()}, "active": active},
                             CACHE_SECONDS)
        return {"totals": totals, "active": active}


async def _claimed(db: AsyncSession, user_id: int, monday: date) -> bool:
    return (await db.execute(
        select(ClassBossClaim.id).where(ClassBossClaim.user_id == user_id,
                                        ClassBossClaim.week_start == monday.isoformat()).limit(1)
    )).scalar() is not None


# ---------------------------------------------------------------- 页面上那一块

async def tasks_todo(db: AsyncSession, user_id: int, now: datetime) -> int:
    """现在能做、还没做完的任务有几份: 单词作业(和对战场数里「还有 N 份没做完」同一个数)
    + 句子 / 音标 / 跟读作业(已经开放、没关、没过截止、还没完成;布置成作业的「每日复习」不算,它算在今日复习那一项)"""
    word = await battle_tickets._tasks_todo(db, user_id, now)
    content = (await db.execute(
        select(func.count()).select_from(ContentHomeworkStudent)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(
            ContentHomeworkStudent.student_id == user_id,
            ContentHomeworkStudent.completed_at.is_(None),
            ContentHomework.is_closed.is_(False),
            ContentHomework.available_from <= now,
            or_(ContentHomework.deadline.is_(None), ContentHomework.deadline > now),
            ContentHomework.kind != KIND_DAILY_REVIEW,
        )
    )).scalar() or 0
    return int(word) + int(content)


async def _mine_items(db: AsyncSession, user: User, today: date, today_cell: dict, capped: bool) -> List[dict]:
    """今天三种来源各拿了多少、还能怎么再拿(今天拿满了就都不用再说)"""
    pts = points_of(today_cell)
    items = [
        {"key": "task", "label": f"做完一份作业 +{TASK_POINTS}", "points": pts["task"], "how": None, "route": None},
        {"key": "review", "label": f"做完今日复习 +{REVIEW_POINTS}", "points": pts["review"], "how": None, "route": None},
        {"key": "words", "label": f"每学 {WORDS_STEP} 个词 +{WORDS_POINTS}", "points": pts["words"], "how": None,
         "route": None},
    ]
    if capped:
        return items
    todo = await tasks_todo(db, user.id, datetime.utcnow())
    if todo > 0:
        items[0].update(how=f"今天还有 {todo} 份没做完", route=ROUTE_HOMEWORK)
    elif int(today_cell["tasks"]) == 0:
        # 没有能做的、今天也没做完过: 写明是没布置,不然孩子看到「+10 … 0」分不清是没布置还是没做
        items[0].update(how="今天没有布置作业", route=None)
    if not today_cell["review"]:
        review = await daily_review.status(db, user.id, today, create=False)
        total = int(review.get("total") or 0)
        if total > 0:
            items[1].update(how=f"今日复习做了 {int(review.get('done') or 0)} / {total} 个,做完 +{REVIEW_POINTS}",
                            route=ROUTE_REVIEW)
        elif not review.get("started"):
            items[1].update(how="今天还没排复习词,回首页看看", route=ROUTE_BOOKS)
    words = int(today_cell["words"])
    items[2].update(how=f"今天学了 {words} 个词,再学 {WORDS_STEP - words % WORDS_STEP} 个 +{WORDS_POINTS}",
                    route=ROUTE_BOOKS)
    return items


async def overview(db: AsyncSession, user: User, today: Optional[date] = None) -> dict:
    """对战大厅「全班打大怪」那一块"""
    settings = await battle_tickets.get_settings(db)
    if not settings.get("class_boss"):
        return {"enabled": False}
    today = today or local_today()
    cls = await class_of(db, user.id)
    if cls is None:
        return {"enabled": True, "has_class": False}
    monday, sunday = week_of(today)
    roster = cls["roster"]
    base = {
        "enabled": True, "has_class": True, "class_name": cls["name"],
        "week_start": monday.isoformat(), "week_end": sunday.isoformat(), "enrolled": len(roster),
    }
    if len(roster) < MIN_STUDENTS:
        # 没有大怪: boss 给 None、写明原因;别的字段照样给全(都是 0 / 空),页面照着读不会出错
        return {
            **base, "students": len(await studied_ids(db, roster, monday)),
            "boss": None, "reason": f"班里不到 {MIN_STUDENTS} 个同学,这一周没有大怪。",
            "hp_max": 0, "hp_left": 0, "defeated": False, "joined": 0,
            "mine": {"total": 0, "today": 0, "today_cap": DAY_CAP, "items": []},
            "top": [],
            "reward": {"food": REWARD_FOOD, "xp": REWARD_XP, "can_claim": False, "claimed": False},
            "last_week": None,
        }

    # 句子 / 音标 / 跟读作业的完成是现判的: 我自己的先判一遍,刚做完的才算得进去
    await battle_tickets._refresh_content_homework(db, user.id, datetime.utcnow())
    week = await class_week(db, cls["id"], roster, monday)
    totals, active = dict(week["totals"]), set(week["active"])
    mine_days = (await days_of(db, [user.id], monday, sunday)).get(user.id, {})
    my_total = week_total(mine_days)
    totals.pop(user.id, None)
    if my_total > 0:
        totals[user.id] = my_total          # 我自己的不走缓存(规则第 9 条)
    if mine_days:
        active.add(user.id)                 # 我这一周来学了: 马上算进在学的人(不等缓存)

    hp_max = hp_for(len(active))
    dealt = sum(totals.values())
    defeated = dealt >= hp_max
    today_cell = mine_days.get(today.isoformat()) or _empty_day()
    today_points = day_total(today_cell)

    joined = {uid: n for uid, n in totals.items() if n >= JOIN_MIN}
    top_ids = sorted(joined, key=lambda uid: (-joined[uid], uid))[:TOP_N]
    names = {}
    if top_ids:
        names = {u.id: classmate_name(u.full_name, u.username) for u in (await db.execute(
            select(User).where(User.id.in_(top_ids))
        )).scalars()}

    claimed = await _claimed(db, user.id, monday)
    last_week = None
    if today.weekday() < LATE_CLAIM_DAYS:
        last_monday = monday - timedelta(days=7)
        last = await class_week(db, cls["id"], roster, last_monday)
        last_totals = last["totals"]
        # 上一周的血量按上一周在学的人算(规则第 7 条),不是这一周的
        last_defeated = sum(last_totals.values()) >= hp_for(len(last["active"]))
        last_week = {
            "defeated": last_defeated,
            "can_claim": (last_defeated and last_totals.get(user.id, 0) >= JOIN_MIN
                          and not await _claimed(db, user.id, last_monday)),
        }

    return {
        **base,
        "students": len(active),
        "boss": boss_for(cls["id"], monday),
        "hp_max": hp_max,
        "hp_left": max(0, hp_max - dealt),
        "defeated": defeated,
        "joined": len(joined),
        "mine": {
            "total": my_total,
            "today": today_points,
            "today_cap": DAY_CAP,
            "items": await _mine_items(db, user, today, today_cell, today_points >= DAY_CAP),
        },
        "top": [{"name": names.get(uid, "同学"), "points": joined[uid]} for uid in top_ids],
        "reward": {
            "food": REWARD_FOOD, "xp": REWARD_XP,
            "can_claim": defeated and my_total >= JOIN_MIN and not claimed,
            "claimed": claimed,
        },
        "last_week": last_week,
    }


# ---------------------------------------------------------------- 领奖

def _deny(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": code, "message": message})


async def claim(db: AsyncSession, user: User, which: str = "this", today: Optional[date] = None) -> dict:
    """领这一周(which = this)或者上一周(last)的奖励(规则第 6、7 条)。领不了 → 409 {code, message}"""
    settings = await battle_tickets.get_settings(db)
    if not settings.get("class_boss"):
        raise _deny("boss_off", "「全班打大怪」现在没有开放。")
    today = today or local_today()
    cls = await class_of(db, user.id)
    if cls is None or len(cls["roster"]) < MIN_STUDENTS:
        raise _deny("boss_none", "现在没有大怪可以打。")
    monday, sunday = week_of(today)
    roster = cls["roster"]
    if which == "last":
        if today.weekday() >= LATE_CLAIM_DAYS:
            raise _deny("boss_expired", "上一周的奖励只能在周一到周三领,已经过期了。")
        monday, sunday = monday - timedelta(days=7), sunday - timedelta(days=7)
    elif which != "this":
        raise HTTPException(status_code=400, detail={"code": "boss_bad_week", "message": "只能领这一周或者上一周的。"})

    week = await class_week(db, cls["id"], roster, monday)
    totals, active = dict(week["totals"]), set(week["active"])
    if which == "this":
        await battle_tickets._refresh_content_homework(db, user.id, datetime.utcnow())
        mine_days = (await days_of(db, [user.id], monday, sunday)).get(user.id, {})
        totals[user.id] = week_total(mine_days)
        if mine_days:
            active.add(user.id)
    my_total = int(totals.get(user.id, 0))
    hp_max = hp_for(len(active))
    dealt = sum(totals.values())
    if dealt < hp_max:
        raise _deny("boss_alive", f"大怪还没打死(还剩 {hp_max - dealt} 点血),全班再加把劲。")
    if my_total < JOIN_MIN:
        raise _deny("boss_no_part", f"这一周你还没出过力(至少要打出 {JOIN_MIN} 点),这次的奖励领不了。")

    # 认领: 先插这一行(拿到写锁),插成了才发。两个页面同时点,后到的那个插不进去
    week = monday.isoformat()
    got = await db.execute(
        sqlite_insert(ClassBossClaim)
        .values(class_id=cls["id"], week_start=week, user_id=user.id, claimed_at=datetime.utcnow())
        .on_conflict_do_nothing(index_elements=[ClassBossClaim.class_id, ClassBossClaim.week_start,
                                                ClassBossClaim.user_id])
    )
    if (got.rowcount or 0) != 1:
        await db.commit()       # 什么都没插进去;提交一下把写锁放掉(不 rollback)
        raise _deny("boss_claimed", "这一周的奖励已经领过了。")
    # 同一周换了班: 在别的班领过的也算领过(唯一约束带着班,管不到这个)
    rows = (await db.execute(
        select(func.count()).select_from(ClassBossClaim)
        .where(ClassBossClaim.user_id == user.id, ClassBossClaim.week_start == week)
    )).scalar() or 0
    if rows > 1:
        await db.execute(delete(ClassBossClaim).where(
            ClassBossClaim.user_id == user.id, ClassBossClaim.week_start == week,
            ClassBossClaim.class_id == cls["id"],
        ))
        await db.commit()
        raise _deny("boss_claimed", "这一周的奖励已经领过了。")

    # 发奖(这时候已经拿着写锁): 粮食是这个孩子所有宠物共用的一个数,一条 SQL 原子加
    pets = list((await db.execute(
        select(UserPet).where(UserPet.user_id == user.id).order_by(UserPet.is_active.desc(), UserPet.id)
    )).scalars())
    pet = pets[0] if pets and pets[0].is_active else None      # 出战的那只(经验给它)
    leveled_up = False
    xp = 0
    if not pets:
        # 一只宠物都没有: 粮食先记在账号上,领养时带上(没记过的按领养送的 10 起算)
        await db.execute(
            update(User).where(User.id == user.id)
            .values(pet_food_reserve=func.coalesce(User.pet_food_reserve, 10) + REWARD_FOOD)
            .execution_options(synchronize_session=False)
        )
    else:
        await db.execute(
            update(UserPet).where(UserPet.user_id == user.id)
            .values(food_balance=func.coalesce(UserPet.food_balance, 0) + REWARD_FOOD)
            .execution_options(synchronize_session=False)
        )
        for one in pets:
            await db.refresh(one)
    if pet is not None:
        xp = REWARD_XP
        pet.experience = int(pet.experience or 0) + xp
        leveled_up, evolved = apply_xp_and_level(pet)
        if leveled_up:
            db.add(PetEventLog(pet_id=pet.id, event_type="level_up", detail=f"全班打败大怪,升级到 Lv{pet.level}!"))
        if evolved:
            db.add(PetEventLog(
                pet_id=pet.id, event_type="evolve",
                detail=f"进化为{get_pet_stage_name(pet.species, pet.evolution_stage)}!(Lv{pet.level})",
            ))
    await db.commit()
    return {"food": REWARD_FOOD, "xp": xp, "leveled_up": bool(leveled_up)}
