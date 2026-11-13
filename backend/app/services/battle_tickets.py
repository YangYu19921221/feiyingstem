"""
宠物对战场数(2026-11-11)

为什么要有: 宠物对战是孩子唯一主动去玩的功能(近 30 天 59 人打了 675 场),但它在抢作业的时间 ——
有作业的日子里打的 498 场,粗算约 290 场开打时当天作业还没做完;一个孩子一天最多打了 54 场;
而每日复习的做完率只有 25%。所以把「想打对战」变成「先把今天该做的做了」。

规则(这里是唯一一份,学生端对战大厅和管理端卡片原样显示,不在前端另写):
  1. 今天能打几场 = 每天送的 + 今天做完的作业 × 每份几场 + 今日复习做完给的 + 今天学的词 ÷ 每多少词一场,
     再和「一天最多几场」取小。按北京日算,过了半夜重新算,不结转。
  2. 「今天做完的作业」: 单词作业 status=completed 且完成时刻在今天;句子 / 音标 / 跟读作业完成时刻在今天。
     布置成作业的「每日复习」不在这里算(它算在第 3 条里,不重复给)。在家做的作业也算(做了就是做了)。
  3. 「今日复习」: 今天那一份(services/daily_review)全做完才给;今天没有要复习的词 = 不给也不欠。
     只读已有的那一份,不替孩子建(建的那一下会把词定下来,该由孩子自己打开首页时定)。
  4. 「今天学的词」: 和班级每日数据同一个数(services/daily_words,按拼写去重、只分类没练的不算)。
     对战里答的题不写学习记录,所以打对战不会给自己挣场数。
  5. 「已经打了几场」: 今天开打(started_at 在今天)且至少打完一回合的。一回合没打的不算 ——
     真人对战对手没连上、点进去马上退出来,都不该吃掉一场。
  6. 三个开打的入口都要过闸门: 打 AI(quick-match)、发起挑战、接受挑战。没场数 403,
     detail = {code: need_battle_ticket, message: 原因 + 怎么再拿到, tickets: 当前状态}。
     闸门放在「没宠物 / 宠物受伤」之后(那两句原因更具体)。
  7. 平台一个总开关 + 五个数,存 system_configs.battle_ticket_settings,只存和默认不一样的;
     关掉 = 不限场数(和 2026-11-11 之前一样)。只有平台管理员能改,改了进操作记录。

改规则先改 OPTIONS: 每一条的「会怎样」「风险」管理端原样显示。
"""
import json
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, local_today_utc_range
from app.models.content_homework import KIND_DAILY_REVIEW, ContentHomework, ContentHomeworkStudent
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.pet_battle import PetBattle
from app.models.system_config import SystemConfig

SETTINGS_KEY = "battle_ticket_settings"

OPTIONS: list[dict] = [
    {"key": "enabled", "label": "对战要先挣场数", "default": True,
     "choices": [{"value": True, "label": "要(默认)"}, {"value": False, "label": "不要,随便打"}],
     "effect": "孩子每天先做作业、做今日复习、学新词才有对战场数,打完就得再去学",
     "risk": "选「随便打」: 回到以前 —— 作业没做完也能一直打,一个孩子一天打过 54 场"},
    {"key": "free_per_day", "label": "每天白送几场", "default": 1,
     "choices": [{"value": 0, "label": "不送"}, {"value": 1, "label": "1 场(默认)"}, {"value": 2, "label": "2 场"}],
     "effect": "什么都没做也能打这么多场,让孩子每天来了先有点甜头",
     "risk": "送得多: 不做作业也够玩一阵;不送: 今天老师没布置作业、也没有要复习的词的孩子,得先学满一些新词才能打"},
    {"key": "per_task", "label": "做完一份作业加几场", "default": 2,
     "choices": [{"value": 1, "label": "1 场"}, {"value": 2, "label": "2 场(默认)"}, {"value": 3, "label": "3 场"}],
     "effect": "今天每做完一份老师(或小鹰老师)布置的任务就加这么多场;在家做的也算",
     "risk": "给得多: 做一份就够玩很久,后面几份没动力;给得少: 孩子觉得不值得"},
    {"key": "per_review", "label": "做完今日复习加几场", "default": 2,
     "choices": [{"value": 0, "label": "不加"}, {"value": 1, "label": "1 场"}, {"value": 2, "label": "2 场(默认)"},
                 {"value": 3, "label": "3 场"}],
     "effect": "今天那 20 个复习词全做完加这么多场(今天没有要复习的词就没有这一项)",
     "risk": "选「不加」: 今日复习又没人做了(加场数之前做完率只有 25%)"},
    {"key": "words_step", "label": "每学多少个词加 1 场", "default": 20,
     "choices": [{"value": 0, "label": "不按词数加"}, {"value": 10, "label": "10 个词"},
                 {"value": 20, "label": "20 个词(默认)"}, {"value": 30, "label": "30 个词"}],
     "effect": "今天自己在书里学的词也算数,没有作业的日子也能靠学新词挣场数",
     "risk": "词数定得少: 随便学几个就能打;选「不按词数加」: 没作业的日子只剩白送的和今日复习那几场"},
    {"key": "daily_cap", "label": "一天最多打几场", "default": 6,
     "choices": [{"value": 3, "label": "3 场"}, {"value": 4, "label": "4 场"}, {"value": 6, "label": "6 场(默认)"},
                 {"value": 8, "label": "8 场"}, {"value": 10, "label": "10 场"}],
     "effect": "挣得再多,一天也只能打这么多场(一场大约 2 分钟)",
     "risk": "定得高: 学得多的孩子能打很久,挤掉后面的学习时间;定得低: 最用功的孩子最先碰到上限,会觉得多学没用"},
    # 下面三项是对战里的玩法(规则见 services/battle_moves),和上面「要不要先挣场数」没有关系:
    # 总开关关着它们照常生效。改了只管之后新开的对战,正在打的那一场不变
    {"key": "stances", "label": "出招三选一(重击 / 普通 / 防守)", "default": True,
     "choices": [{"value": True, "label": "开(默认)"}, {"value": False, "label": "关"}],
     "effect": "每回合答题前选怎么出招: 重击答对伤害 ×1.5、答错自己掉 20;防守答对伤害 ×0.6、这一回合挨的打 ×0.6、答错不掉血",
     "risk": "关掉: 每回合只剩选答案这一件事,和以前一样;开着: 没把握的词孩子可以一直选防守(伤害低,赢得慢)"},
    {"key": "spell_ultimate", "label": "放大招要把单词拼出来", "default": True,
     "choices": [{"value": True, "label": "要(默认)"}, {"value": False, "label": "不要,点一下就放"}],
     "effect": "手里有大招的那一回合多给一个中文意思和一把字母,拼对那个单词才放得出大招;拼错只算一记普通攻击,大招留着下回合再试。拼错的词排进之后的复习",
     "risk": "选「不要」: 回到点一下就放,对战里只练「认」不练「拼」;开着: 拼写弱的孩子大招放不出来会着急(拼错不扣那一格)"},
    {"key": "study_buffs", "label": "今天学了,对战里更强", "default": True,
     "choices": [{"value": True, "label": "开(默认)"}, {"value": False, "label": "关"}],
     "effect": "今天的作业全做完: 这一场攻击 +10%;今日复习做完: 开局自带 1 格大招;今天学满 30 个词: 体力 +10%",
     "risk": "关掉: 做没做作业,对战里一个样;开着: 真人对战时做完作业的孩子占一点便宜(本来就是想要的)"},
    # 下面两项是对战大厅里另外两块(规则见 services/pet_shadow、services/class_boss),同样不受总开关管
    {"key": "shadows", "label": "挑战同学的影子", "default": True,
     "choices": [{"value": True, "label": "开(默认)"}, {"value": False, "label": "关"}],
     "effect": "孩子能挑战同班同学的「影子」(同学的宠物 + 他平时答题的水平,电脑替他打,不用他在线);同一个同学一天只能挑战一次,吃一场对战场数;同学之后看得到谁来挑战过、影子守住了没有",
     "risk": "关掉: 对战大厅没有这一栏,只剩闯关、练习赛和真人对战;开着: 同班同学互相看得到名字和宠物(只有同班的),被打败的孩子会看到「影子被打败了」"},
    {"key": "class_boss", "label": "全班打大怪", "default": True,
     "choices": [{"value": True, "label": "开(默认)"}, {"value": False, "label": "关"}],
     "effect": "每个班每周一只大怪。孩子做完作业、做完今日复习、学新词就给大怪掉血(每人每天最多 30 点);全班打死之后,这一周出过力的孩子各领粮食 +40、经验 +60。打对战不加伤害",
     "risk": "关掉: 对战大厅没有这一块;开着: 班里只有少数人学的时候大怪打不死、谁都没有奖励(血量按全班人数算,久不来的孩子也算一个人)"},
]
OPTION_DEFAULTS: dict[str, Any] = {o["key"]: o["default"] for o in OPTIONS}
_OPTION_VALUES: dict[str, list] = {o["key"]: [c["value"] for c in o["choices"]] for o in OPTIONS}
_OPTION_LABEL: dict[str, str] = {o["key"]: o["label"] for o in OPTIONS}

ROUTE_HOMEWORK = "/student/homework"
ROUTE_REVIEW = "/student/memory-curve"
ROUTE_BOOKS = "/student/dashboard"


def check_options(data: Optional[dict]) -> dict:
    """交上来的设置: 不认的键 / 不在选项里的值 / 类型不对,一律拒(ValueError 带中文原因)。
    类型要单独判: Python 里 1 == True,不判的话 free_per_day=True 会被当成 1、enabled=1 会被当成 True。"""
    out: dict = {}
    for k, v in (data or {}).items():
        if k not in _OPTION_VALUES:
            raise ValueError(f"没有「{k}」这一项")
        if type(v) is not type(OPTION_DEFAULTS[k]) or v not in _OPTION_VALUES[k]:
            raise ValueError(f"「{_OPTION_LABEL[k]}」只能选给的几个")
        out[k] = v
    return out


async def _row(db: AsyncSession) -> Optional[SystemConfig]:
    return (await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY)
    )).scalar_one_or_none()


async def get_settings(db: AsyncSession) -> dict:
    """当前生效的设置 = 默认值 + 库里存的(存坏了 / 选项后来删了的那几项按默认)"""
    out = dict(OPTION_DEFAULTS)
    row = await _row(db)
    if row and row.config_value:
        try:
            saved = json.loads(row.config_value)
        except ValueError:
            saved = {}
        if isinstance(saved, dict):
            for k, v in saved.items():
                try:
                    out.update(check_options({k: v}))
                except ValueError:
                    continue
    return out


async def save_settings(db: AsyncSession, values: dict) -> dict:
    """存一组完整的设置(只落和默认不一样的那几项)。不 commit,调用方连同操作记录一起提交。"""
    merged = dict(OPTION_DEFAULTS)
    merged.update(check_options(values))
    diff = {k: v for k, v in merged.items() if v != OPTION_DEFAULTS[k]}
    value = json.dumps(diff, ensure_ascii=False)
    row = await _row(db)
    if row is None:
        db.add(SystemConfig(config_key=SETTINGS_KEY, config_value=value, config_type="json",
                            description="宠物对战场数: 做完作业 / 今日复习 / 学新词才能打,一天有上限"))
    else:
        row.config_value = value
    await db.flush()
    return merged


# ---------------------------------------------------------------- 今天挣了几场、打了几场

async def _tasks_done_today(db: AsyncSession, user_id: int, start: datetime, end: datetime) -> int:
    word = (await db.execute(
        select(func.count()).select_from(HomeworkStudentAssignment).where(
            HomeworkStudentAssignment.student_id == user_id,
            HomeworkStudentAssignment.status == "completed",
            HomeworkStudentAssignment.completed_at >= start,
            HomeworkStudentAssignment.completed_at < end,
        )
    )).scalar() or 0
    content = (await db.execute(
        select(func.count()).select_from(ContentHomeworkStudent)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(
            ContentHomeworkStudent.student_id == user_id,
            ContentHomework.kind != KIND_DAILY_REVIEW,
            ContentHomeworkStudent.completed_at >= start,
            ContentHomeworkStudent.completed_at < end,
        )
    )).scalar() or 0
    return int(word) + int(content)


async def _refresh_content_homework(db: AsyncSession, user_id: int, now: datetime) -> None:
    """句子 / 音标 / 跟读作业的「完成」是列作业时现判的。孩子学完直接来对战大厅、没回作业页的话,
    完成时刻还没记上,这里先判一遍(只判他自己已经开放、没关、还没完成的那几份)。"""
    from app.services import content_homework as chw
    links = list((await db.execute(
        select(ContentHomeworkStudent, ContentHomework)
        .join(ContentHomework, ContentHomework.id == ContentHomeworkStudent.homework_id)
        .where(
            ContentHomeworkStudent.student_id == user_id,
            ContentHomeworkStudent.completed_at.is_(None),
            ContentHomework.is_closed.is_(False),
            ContentHomework.available_from <= now,
            ContentHomework.kind != KIND_DAILY_REVIEW,
        )
    )).all())
    if links and await chw.refresh_completion(db, [(s, h) for s, h in links]):
        await db.commit()


async def _tasks_todo(db: AsyncSession, user_id: int, now: datetime) -> int:
    """现在能做、还没做完的单词作业有几份(只为告诉孩子「还有 N 份,做完再加几场」)"""
    return int((await db.execute(
        select(func.count()).select_from(HomeworkStudentAssignment)
        .join(HomeworkAssignment, HomeworkAssignment.id == HomeworkStudentAssignment.homework_id)
        .where(
            HomeworkStudentAssignment.student_id == user_id,
            HomeworkStudentAssignment.status != "completed",
            HomeworkAssignment.is_closed.is_(False),
            or_(HomeworkAssignment.available_from.is_(None),
                and_(HomeworkAssignment.available_from <= now,
                     HomeworkAssignment.available_from > now - timedelta(days=1))),
            or_(HomeworkAssignment.deadline.is_(None), HomeworkAssignment.deadline > now),
        )
    )).scalar() or 0)


async def battles_played_today(db: AsyncSession, user_id: int, start: datetime, end: datetime) -> int:
    """今天开打、至少打完一回合的场数(规则第 5 条)"""
    return int((await db.execute(
        select(func.count()).select_from(PetBattle).where(
            or_(PetBattle.player1_id == user_id, PetBattle.player2_id == user_id),
            PetBattle.started_at >= start,
            PetBattle.started_at < end,
            PetBattle.current_round >= 1,
        )
    )).scalar() or 0)


def rule_lines(s: dict) -> list[str]:
    """规则说明,一行一句,学生端原样显示"""
    if not s["enabled"]:
        return ["现在对战不限场数。"]
    lines: list[str] = []
    if s["free_per_day"]:
        lines.append(f"每天送 {s['free_per_day']} 场。")
    lines.append(f"今天每做完一份作业,加 {s['per_task']} 场。")
    if s["per_review"]:
        lines.append(f"今天的复习词全做完,加 {s['per_review']} 场。")
    if s["words_step"]:
        lines.append(f"今天每学 {s['words_step']} 个词,加 1 场。")
    lines.append(f"一天最多打 {s['daily_cap']} 场,过了半夜重新算。")
    lines.append("点进去一回合没打的不算一场。")
    return lines


async def status(db: AsyncSession, user_id: int) -> dict:
    """今天的场数: 挣了几场、打了几场、还剩几场、每一项怎么来的"""
    s = await get_settings(db)
    if not s["enabled"]:
        return {"enabled": False, "cap": None, "earned": None, "used": None, "left": None,
                "capped": False, "sources": [], "lines": rule_lines(s)}

    now = datetime.utcnow()
    start, end = local_today_utc_range()
    await _refresh_content_homework(db, user_id, now)
    tasks_done = await _tasks_done_today(db, user_id, start, end)
    tasks_todo = await _tasks_todo(db, user_id, now)

    from app.services import daily_review
    review = await daily_review.status(db, user_id, local_today(), create=False)
    review_total = int(review.get("total") or 0)
    review_done = bool(review.get("completed")) and review_total > 0

    words = 0
    if s["words_step"]:
        from app.services import daily_words
        words = int((await daily_words.words_by_student(db, [user_id], start, end)).get(user_id, 0))

    used = await battles_played_today(db, user_id, start, end)

    sources: list[dict] = []
    if s["free_per_day"]:
        sources.append({"key": "free", "label": "每天送的", "got": s["free_per_day"], "more": False,
                        "detail": "来了就有", "route": None})
    task_got = s["per_task"] * tasks_done
    sources.append({
        "key": "task", "label": f"做完一份作业 +{s['per_task']} 场", "got": task_got,
        "more": tasks_todo > 0,
        "detail": (f"今天做完 {tasks_done} 份" + (f",还有 {tasks_todo} 份没做完" if tasks_todo else "")) if (tasks_done or tasks_todo)
                  else "现在没有要做的作业",
        "route": ROUTE_HOMEWORK if tasks_todo else None,
    })
    review_got = 0
    if s["per_review"]:
        review_got = s["per_review"] if review_done else 0
        if review_total == 0:
            detail, more = ("今天还没排复习词,回首页看看" if not review.get("started") else "今天没有要复习的词"), False
        elif review_done:
            detail, more = "今天的做完了", False
        else:
            detail, more = f"做了 {int(review.get('done') or 0)} / {review_total} 个", True
        sources.append({"key": "review", "label": f"做完今日复习 +{s['per_review']} 场", "got": review_got,
                        "more": more, "detail": detail, "route": ROUTE_REVIEW if more else None})
    words_got = 0
    if s["words_step"]:
        words_got = words // s["words_step"]
        to_next = s["words_step"] - words % s["words_step"]
        sources.append({"key": "words", "label": f"每学 {s['words_step']} 个词 +1 场", "got": words_got, "more": True,
                        "detail": f"今天学了 {words} 个词,再学 {to_next} 个加 1 场", "route": ROUTE_BOOKS})

    earned = s["free_per_day"] + task_got + review_got + words_got
    usable = min(earned, s["daily_cap"])
    capped = earned >= s["daily_cap"]
    if capped:  # 已经到一天的上限,再做什么今天也不加了
        for src in sources:
            src["more"], src["route"] = False, None
    return {
        "enabled": True,
        "cap": s["daily_cap"],
        "earned": usable,
        "used": used,
        "left": max(0, usable - used),
        "capped": capped,
        "sources": sources,
        "lines": rule_lines(s),
    }


def deny_message(st: dict) -> str:
    if st.get("capped"):
        return f"今天的 {st['cap']} 场对战都打完了,明天再来。"
    ways = [src["label"].replace(" +", ",加 ") for src in st.get("sources", []) if src.get("more")]
    if ways:
        return "今天的对战场数用完了。想再打: " + ";".join(ways) + "。"
    return "今天的对战场数用完了,明天再来。"


async def require_ticket(db: AsyncSession, user) -> None:
    """开打前的闸门(规则第 6 条)。只管学生;总开关关着直接放行。"""
    if getattr(user, "role", None) != "student" or (getattr(user, "id", 0) or 0) <= 0:
        return
    st = await status(db, user.id)
    if not st["enabled"] or st["left"] > 0:
        return
    raise HTTPException(status_code=403, detail={
        "code": "need_battle_ticket", "message": deny_message(st), "tickets": st,
    })
