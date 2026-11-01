"""查缺补漏(2026-11-01,试点「单词班40次班」)

用户: 学生浮躁、学校作业多、基础差,要快速查缺补漏 →「所有学生都可能有这个问题」→ 先在一个班试。
班级开关(autopilot_class_sync,没有行 = 关 = 和以前一模一样)打开以后:

1. **每天的量多一档 10 个词**(只开了的班有;做不完的孩子按原来的规矩往下降,能降到 10)
2. **7 成跟学校、3 成补漏**: 「学校」= 班级设的学校单元(和孩子在学的书是同一本才用),没设 = 孩子最近在学的那本书接着往下;
   「补漏」= 摸底测出来的单元 + 别的书到期的轮次 + 每日复习。一边排不满,剩的给另一边
3. **老师今天自己布置了作业**: 以前小鹰老师就不派;现在只补一小份漏洞(≤ GAP_ON_TEACHER_DAY 个词),
   batch = GAP_BATCH(-1):**不算今天的任务、不进金币分母**(extra_homework_ids 认 batch != 0),
   老师的作业做完照样有金币
4. **摸底**(班级打开的那一刻全班每人自动一次;之后新来的孩子打开首页自动一次;老师可以再点「让全班再摸一次底」):
   只测小鹰老师还没排过的单元,所以不会动已经在走的轮次。从孩子现在学的单元往前测 —— 这本书前面的单元,再到同一套课本的前几册
   (人教版四上 → 三下 → 三上;初中往前到小学)。一个单元先考 3 个词「看英文选中文」(有「不认识」按钮,猜的少),
   3 个都对 = 会;对 1 个以下 = 要补;对 2 个再考 2 个「看中文写英文」,都写对才算会。
   连着 3 个单元都会就不再往前(下面是牢的);最多 MAX_QUESTIONS 题;孩子可以随时「先测到这」。
   已经在小鹰老师里学过 / 学着的单元不测(autopilot_groups 有这个单元)。
   结果: 会的单元每组记成学会(autopilot_groups graduated,legacy),以后不再派新词;要补的单元记进 catchup_gaps,
   补漏那 3 成从这里出(还是走三轮才算学会)。**补上了 = 这个单元的组都学会了**
5. 补漏只派孩子能学的单元(get_allowed_unit_ids,分配即权限不变);测出缺的书他没开,老师待办里写出来
6. **书没开的三种情况**(book_gaps,老师页「开书」那一块一次看全、勾了一键开;小鹰老师**不自己开书**,分配即权限照旧):
   ①在学的那本没开整本(常见: 一本都没分配,只能学老师作业里的单元)→ 开那本(最近学的 / 最近作业的书)
   ②摸底测出前几册有漏洞、那本没开 → 开那几本(只开测出漏洞的,不按年级一口气全开)
   ③卡包机构的平台书要兑换学习卡 / 专属内容没开通 → 不能直接开,列出来告诉老师去发卡
   不知道在学哪本(没学过、也没作业)→ 列出来,让老师去「分配单词本」
   孩子那边: 摸底结果里「要老师开书才能补」的单元单独写,补漏进度不算它们
7. **每一条都能由老师自己选**(OPTIONS,存 autopilot_sync_options,没有行 = 全按默认)。每一项的「会怎样 / 风险」
   写在 OPTIONS 里,老师页原样显示 —— 改规则先改这里,老师看到的就跟着变,不要在前端另写一份
"""
import hashlib
import random
import re
from collections import defaultdict
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.autopilot import (
    AutopilotClassSync, AutopilotGroup, CatchupAnswer, CatchupDiagnosis, CatchupGap,
)
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningProgress
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition

GAP_SHARE = 0.3
GAP_ON_TEACHER_DAY = 10
GAP_BATCH = -1
SYNC_TIER = 10
CHOICE_PER_UNIT = 3
SPELL_PER_UNIT = 2
KNOWN_STREAK_STOP = 3
MAX_QUESTIONS = 60
SECONDS_PER_Q = 6

# ---------------------------------------------------------------- 老师可以自己选的(默认值 + 会怎样 + 风险)

OPTIONS: list[dict] = [
    {"key": "auto_diagnose_on_enable", "label": "打开时全班自动摸底", "default": True,
     "choices": [{"value": True, "label": "自动(默认)"}, {"value": False, "label": "不自动,我自己点"}],
     "effect": "打开这个班的那一刻,每个孩子首页出现「先摸摸底」(约 5 分钟)",
     "risk": "选「不自动」: 没摸底的孩子没有漏洞清单,那 3 成只补别的书到期的复习,补漏几乎不起作用;要记得自己点「让全班摸底」"},
    {"key": "auto_diagnose_new", "label": "新来的孩子自动摸底", "default": True,
     "choices": [{"value": True, "label": "自动(默认)"}, {"value": False, "label": "不自动"}],
     "effect": "小鹰老师从没给他排过任务的孩子,打开首页就自动建一次摸底",
     "risk": "选「不自动」: 新孩子会从书的第一个没学过的单元开始,前几册的漏洞查不出来"},
    {"key": "gap_share", "label": "每天补漏占几成", "default": 30,
     "choices": [{"value": 0, "label": "不补漏"}, {"value": 20, "label": "2 成"}, {"value": 30, "label": "3 成(默认)"},
                 {"value": 40, "label": "4 成"}, {"value": 50, "label": "5 成"}],
     "effect": "补漏 = 摸底测出要补的单元 + 别的书到期的复习 + 今天的复习词;剩下的跟学校在讲的单元。一天只够一组(10 个词)时,十天里有这么多成的天数先补漏",
     "risk": "补得多: 学校正在讲的单元跟得慢,孩子第二天课上可能听不懂;补得少: 前面的漏洞一直在,越往后越吃力;选「不补漏」: 别的书到期的复习也不派了,只跟学校"},
    {"key": "teacher_day", "label": "你自己布置了单词作业的那天", "default": "gap",
     "choices": [{"value": "gap", "label": "小鹰老师补一小份漏洞(默认)"}, {"value": "none", "label": "小鹰老师不派"}],
     "effect": "补的那一份不算今天的任务、不影响金币;你的作业做完照样发金币",
     "risk": "选「补一小份」: 孩子那天多做几个词,作业已经很多的孩子可能做不完(做不完不扣什么);选「不派」: 你天天布置的话,漏洞就一直补不上"},
    {"key": "teacher_day_words", "label": "那天补多少个词", "default": 10,
     "choices": [{"value": 5, "label": "5 个"}, {"value": 10, "label": "10 个(默认)"}, {"value": 20, "label": "20 个"}],
     "effect": "按组派,一组放不下时会多一点(一组最多十几个词)",
     "risk": "多了: 加重作业日的负担;少了: 补得慢"},
    {"key": "small_tier", "label": "每天最少几个词", "default": True,
     "choices": [{"value": True, "label": "最少 10 个(默认)"}, {"value": False, "label": "最少 20 个(和其它班一样)"}],
     "effect": "做不完的孩子自动往下降,最低降到这里;做得好自动往上加",
     "risk": "最少 10 个: 基础差、作业多的孩子做得完,但学得慢;最少 20 个: 学得快,做不完的孩子会天天没做完"},
    {"key": "mark_known", "label": "摸底「会」的单元", "default": True,
     "choices": [{"value": True, "label": "记成学会,不再派新词(默认)"}, {"value": False, "label": "照样派"}],
     "effect": "一个单元抽 3 个词都选对(或对 2 个、再写对 2 个)就算会",
     "risk": "记成学会: 只抽了几个词,个别没抽到的词可能其实不会,不会再派(到期的复习词和错题还会出现);照样派: 孩子会重复背已经会的,浪费时间"},
    {"key": "max_questions", "label": "摸底最多几题", "default": 60,
     "choices": [{"value": 30, "label": "30 题(约 3 分钟)"}, {"value": 60, "label": "60 题(约 6 分钟,默认)"},
                 {"value": 90, "label": "90 题(约 9 分钟)"}],
     "effect": "连着 3 个单元都会就提前停,不一定答满",
     "risk": "少: 测不到前几册,下面的漏洞查不出来;多: 坐不住的孩子容易中途不做"},
    {"key": "allow_finish_early", "label": "孩子能不能「先测到这」", "default": True,
     "choices": [{"value": True, "label": "能(默认)"}, {"value": False, "label": "不能,必须测完"}],
     "effect": "测过的单元照样算,没测的以后再说",
     "risk": "能: 有的孩子测两题就不测了,漏洞查不全;不能: 测不下去的孩子会一直卡在这一步"},
]
OPTION_DEFAULTS = {o["key"]: o["default"] for o in OPTIONS}
_OPTION_VALUES = {o["key"]: [c["value"] for c in o["choices"]] for o in OPTIONS}


def check_options(data: dict) -> dict:
    """老师交上来的选择: 不认的键 / 值一律拒(ValueError 带中文原因)"""
    out: dict = {}
    for k, v in (data or {}).items():
        if k not in _OPTION_VALUES:
            raise ValueError(f"没有「{k}」这一项")
        if v not in _OPTION_VALUES[k] or type(v) is not type(OPTION_DEFAULTS[k]):
            raise ValueError(f"「{next(o['label'] for o in OPTIONS if o['key'] == k)}」只能选给的几个")
        out[k] = v
    return out


async def class_options(db: AsyncSession, class_id: Optional[int]) -> dict:
    import json
    from app.models.autopilot import AutopilotSyncOptions
    out = dict(OPTION_DEFAULTS)
    if not class_id:
        return out
    row = await db.get(AutopilotSyncOptions, class_id)
    if row and row.options:
        try:
            saved = json.loads(row.options)
        except ValueError:
            saved = {}
        if isinstance(saved, dict):
            try:
                out.update(check_options({k: v for k, v in saved.items() if k in OPTION_DEFAULTS}))
            except ValueError:
                pass   # 存的值坏了: 按默认
    return out


async def student_options(db: AsyncSession, student_id: int) -> dict:
    from app.services.autopilot import class_of_student
    cls, _ = await class_of_student(db, student_id)
    return await class_options(db, cls.id if cls else None)


def gap_day(day_ordinal: int, share: int) -> bool:
    """一天只够一组时,十天里哪几天先补漏: share 成就挑 share/10 天,尽量隔开(3 成 = 第 1、4、7 天)"""
    k = max(0, min(10, round(share / 10)))
    return (day_ordinal % 10) in {int(i * 10 / k) + 1 for i in range(k)} if k else False


_CN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


# ---------------------------------------------------------------- 班级开关

async def class_sync(db: AsyncSession, class_id: Optional[int]) -> Optional[AutopilotClassSync]:
    """开着才返回"""
    if not class_id:
        return None
    row = await db.get(AutopilotClassSync, class_id)
    return row if row is not None and row.enabled else None


async def student_sync(db: AsyncSession, student_id: int) -> Optional[AutopilotClassSync]:
    from app.services.autopilot import class_of_student
    cls, _ = await class_of_student(db, student_id)
    return await class_sync(db, cls.id if cls else None)


# ---------------------------------------------------------------- 课本先后

def book_rank(name: str, grade: Optional[str], volume: Optional[str]) -> Optional[int]:
    """「人教版四年级上册」→ 8;认不出(课外书、总复习)→ None"""
    m = re.search(r"([一二三四五六七八九])年级", grade or "") or re.search(r"([一二三四五六七八九])年级", name or "")
    if not m:
        return None
    v = volume or ("下册" if "下册" in (name or "") else "上册" if "上册" in (name or "") else "")
    if v not in ("上册", "下册"):
        return None
    return _CN[m.group(1)] * 2 + (1 if v == "下册" else 0)


async def earlier_books(db: AsyncSession, book_id: int) -> list[int]:
    """同一套课本里这本之前的几册,近的在前(四上 → 三下 → 三上)。只认整册课本(书名「X年级Y册」,不是短语本)"""
    b = await db.get(WordBook, book_id)
    if b is None:
        return []
    r = book_rank(b.name, b.grade_level, b.volume)
    if r is None or not b.series:
        return []
    rows = (await db.execute(select(WordBook.id, WordBook.name, WordBook.grade_level, WordBook.volume).where(
        WordBook.series == b.series, (WordBook.org_id.is_(None)) | (WordBook.org_id == b.org_id)))).all()
    out = []
    for i, n, g, v in rows:
        if i == book_id or "短语" in (n or "") or not re.search(r"年级[上下]册$", n or ""):
            continue
        rk = book_rank(n, g, v)
        if rk is not None and rk < r:
            out.append((rk, i))
    # 同一册有好几本(平台 + 机构自建)只取一本: 平台书优先(id 小的)
    seen, res = set(), []
    for rk, i in sorted(out, key=lambda x: (-x[0], x[1])):
        if rk not in seen:
            seen.add(rk)
            res.append(i)
    return res


async def current_point(db: AsyncSession, student_id: int, sync: Optional[AutopilotClassSync]) -> tuple[Optional[int], Optional[int]]:
    """(书, 单元): 孩子现在学到哪。班级设了学校单元、且孩子在学的就是那本书 → 用学校单元"""
    row = (await db.execute(
        select(Unit.book_id, Unit.id).join(LearningProgress, LearningProgress.unit_id == Unit.id)
        .join(WordBook, WordBook.id == Unit.book_id)
        .where(LearningProgress.user_id == student_id)
        .order_by(LearningProgress.last_studied_at.desc()).limit(1))).first()
    if row is None:
        row = (await db.execute(
            select(Unit.book_id, Unit.id).join(HomeworkAssignment, HomeworkAssignment.unit_id == Unit.id)
            .join(HomeworkStudentAssignment, HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
            .join(WordBook, WordBook.id == Unit.book_id)
            .where(HomeworkStudentAssignment.student_id == student_id)
            .order_by(HomeworkAssignment.id.desc()).limit(1))).first()
    book_id, unit_id = (row[0], row[1]) if row else (None, None)
    if sync and sync.school_unit_id and sync.school_book_id and sync.school_book_id == book_id:
        unit_id = sync.school_unit_id
    return book_id, unit_id


async def _units_of(db: AsyncSession, book_id: int) -> list[int]:
    return [u for (u,) in (await db.execute(select(Unit.id).where(Unit.book_id == book_id)
                                            .order_by(Unit.order_index, Unit.unit_number, Unit.id))).all()]


async def test_order(db: AsyncSession, student_id: int, book_id: int, unit_id: Optional[int]) -> list[int]:
    """从现在的单元往前: 这本书现在的单元和它前面的(近的在前),再前几册(每册从后往前)。小鹰老师学过的单元不测"""
    units = await _units_of(db, book_id)
    cut = units.index(unit_id) + 1 if unit_id in units else len(units)
    order = list(reversed(units[:cut]))
    for b in await earlier_books(db, book_id):
        order += list(reversed(await _units_of(db, b)))
    seen = {u for (u,) in (await db.execute(select(AutopilotGroup.unit_id).where(
        AutopilotGroup.student_id == student_id).distinct())).all()}
    return [u for u in order if u not in seen]


# ---------------------------------------------------------------- 出题

async def _unit_words(db: AsyncSession, unit_id: int) -> list[tuple[int, str, str]]:
    """(词 id, 拼写, 主释义);短语、没释义的不考"""
    rows = (await db.execute(
        select(Word.id, Word.word, WordDefinition.meaning, WordDefinition.is_primary)
        .join(UnitWord, UnitWord.word_id == Word.id)
        .join(WordDefinition, WordDefinition.word_id == Word.id)
        .where(UnitWord.unit_id == unit_id)
        .order_by(UnitWord.order_index, UnitWord.id, WordDefinition.is_primary.desc(), WordDefinition.id))).all()
    out, seen = [], set()
    for wid, w, m, _p in rows:
        if wid in seen:
            continue
        seen.add(wid)
        w = (w or "").strip()
        m = (m or "").strip()
        if not w or not m or " " in w or not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", w):
            continue
        out.append((wid, w, m))
    return out


def _seed(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12], 16)


def _sample(words: list, n: int, seed: int) -> list:
    """均匀地挑(洗一遍再取,同一次摸底每次挑的一样)"""
    rnd = random.Random(seed)
    pool = list(words)
    rnd.shuffle(pool)
    return pool[:n]


def _short_meaning(m: str) -> str:
    """「n. 苹果;苹果树」→「苹果」: 选项短一点,也不靠词性猜"""
    m = re.sub(r"^\s*(?:[a-z]+\.\s*)+", "", m)
    m = re.split(r"[;；,，、]", m)[0]
    m = re.sub(r"[（(][^)）]*[)）]", "", m)
    return m.strip()[:16] or m.strip()[:16]


async def _options(db: AsyncSession, diag_id: int, unit_id: int, word_id: int, meaning: str) -> list[str]:
    """4 个中文选项(1 对 3 错),错的从同一本书别的词里挑;同一题每次算出来一样,所以不用存"""
    right = _short_meaning(meaning)
    book_id = (await db.execute(select(Unit.book_id).where(Unit.id == unit_id))).scalar()
    pool = (await db.execute(
        select(WordDefinition.meaning).join(UnitWord, UnitWord.word_id == WordDefinition.word_id)
        .join(Unit, Unit.id == UnitWord.unit_id)
        .where(Unit.book_id == book_id, WordDefinition.word_id != word_id, WordDefinition.is_primary.is_(True))
        .limit(400))).scalars().all()
    cands = sorted({_short_meaning(m) for m in pool if m} - {right, ""})
    rnd = random.Random(_seed(diag_id, word_id, "opt"))
    wrong = rnd.sample(cands, min(3, len(cands)))
    opts = wrong + [right]
    rnd.shuffle(opts)
    return opts


# ---------------------------------------------------------------- 状态

def _verdict(choice: list[CatchupAnswer], spell: list[CatchupAnswer], n_words: int) -> Optional[str]:
    """known / gap / None(还没测完这个单元)"""
    need_c = min(CHOICE_PER_UNIT, n_words)
    if need_c == 0:
        return "skip"
    if len(choice) < need_c:
        return None
    ok = sum(1 for a in choice if a.correct)
    if ok == need_c:
        return "known"
    if ok <= need_c - 2 or need_c < CHOICE_PER_UNIT:
        return "gap"
    need_s = min(SPELL_PER_UNIT, n_words - need_c)
    if need_s == 0:
        return "gap"
    if len(spell) < need_s:
        return None
    return "known" if all(a.correct for a in spell) else "gap"


class State:
    def __init__(self):
        self.verdicts: dict[int, str] = {}
        self.current_unit: Optional[int] = None
        self.next: Optional[tuple[str, tuple[int, str, str]]] = None
        self.answered = 0
        self.stop_reason: Optional[str] = None


async def compute(db: AsyncSession, d: CatchupDiagnosis) -> State:
    s = State()
    max_q = (await student_options(db, d.student_id))["max_questions"]
    order = [int(x) for x in (d.units or "").split(",") if x]
    answers = list((await db.execute(select(CatchupAnswer).where(CatchupAnswer.diagnosis_id == d.id)
                                     .order_by(CatchupAnswer.id))).scalars())
    s.answered = len(answers)
    by_unit: dict[int, list[CatchupAnswer]] = defaultdict(list)
    for a in answers:
        by_unit[a.unit_id].append(a)
    streak = 0
    for u in order:
        words = await _unit_words(db, u)
        mine = by_unit.get(u, [])
        choice = [a for a in mine if a.qtype == "choice"]
        spell = [a for a in mine if a.qtype == "spell"]
        v = _verdict(choice, spell, len(words))
        if v == "skip":
            continue
        if v is None:
            if s.answered >= max_q:
                s.stop_reason = "max"
                return s
            asked = {a.word_id for a in mine}
            picks = _sample(words, CHOICE_PER_UNIT + SPELL_PER_UNIT, _seed(d.id, u))
            need_c = min(CHOICE_PER_UNIT, len(words))
            if len(choice) < need_c:
                w = next(x for x in picks[:need_c] if x[0] not in asked)
                s.next = ("choice", w)
            else:
                w = next(x for x in picks[need_c:] if x[0] not in asked)
                s.next = ("spell", w)
            s.current_unit = u
            return s
        s.verdicts[u] = v
        streak = streak + 1 if v == "known" else 0
        if streak >= KNOWN_STREAK_STOP:
            s.stop_reason = "solid"
            return s
    s.stop_reason = "end"
    return s


# ---------------------------------------------------------------- 开始 / 答题 / 结束

async def latest(db: AsyncSession, student_id: int) -> Optional[CatchupDiagnosis]:
    return (await db.execute(select(CatchupDiagnosis).where(CatchupDiagnosis.student_id == student_id)
                             .order_by(CatchupDiagnosis.id.desc()).limit(1))).scalar_one_or_none()


async def request(db: AsyncSession, student_id: int, org_id: Optional[int], actor_id: Optional[int],
                  actor_name: str) -> CatchupDiagnosis:
    """老师让他做一次摸底(已经有没做完的就用那一份)。不 commit"""
    cur = await latest(db, student_id)
    if cur is not None and cur.status in ("pending", "doing"):
        return cur
    d = CatchupDiagnosis(student_id=student_id, org_id=org_id, status="pending", requested_by=actor_id,
                         requested_by_name=(actor_name or "")[:100])
    db.add(d)
    await db.flush()
    return d


async def begin(db: AsyncSession, d: CatchupDiagnosis) -> None:
    """第一次打开: 排好测试顺序。没有能测的 → skipped。不 commit"""
    if d.units is not None:
        return
    sync = await student_sync(db, d.student_id)
    book_id, unit_id = await current_point(db, d.student_id, sync)
    order = await test_order(db, d.student_id, book_id, unit_id) if book_id else []
    d.start_book_id, d.start_unit_id = book_id, unit_id
    d.units = ",".join(map(str, order))
    d.started_at = utc_now()
    if not order:
        d.status, d.finished_at = "skipped", utc_now()
        d.note = "还没有在学的课本,或者前面的单元都学过了,没什么要摸底的"
    else:
        d.status = "doing"


def est_left(s: State, d: CatchupDiagnosis, max_q: int = MAX_QUESTIONS) -> int:
    """大约还要几题(给孩子看进度用,不用很准)"""
    order = [x for x in (d.units or "").split(",") if x]
    left_units = max(0, len(order) - len(s.verdicts))
    return max(0, min(max_q - s.answered, left_units * CHOICE_PER_UNIT, 30))


async def question_out(db: AsyncSession, d: CatchupDiagnosis, s: State) -> Optional[dict]:
    if s.next is None:
        return None
    qtype, (wid, w, m) = s.next
    unit_name = (await db.execute(select(Unit.name).where(Unit.id == s.current_unit))).scalar() or ""
    book_name = (await db.execute(select(WordBook.name).join(Unit, Unit.book_id == WordBook.id)
                                  .where(Unit.id == s.current_unit))).scalar() or ""
    out = {"word_id": wid, "type": qtype, "unit": f"{book_name} · {unit_name}"}
    if qtype == "choice":
        out.update(word=w, options=await _options(db, d.id, s.current_unit, wid, m))
    else:
        out.update(meaning=_short_meaning(m), letters=len(w), first=w[0])
    return out


def _norm(t: str) -> str:
    return re.sub(r"[\s’'`-]", "", (t or "").strip().lower())


async def answer(db: AsyncSession, d: CatchupDiagnosis, word_id: int, choice: Optional[int],
                 text: Optional[str], dont_know: bool) -> dict:
    """交一题。只认当前这一题(防止乱交别的词);交过的同一题不重复记。不 commit"""
    s = await compute(db, d)
    if s.next is None or s.next[1][0] != word_id:
        return {"stale": True}
    qtype, (wid, w, m) = s.next
    right = w if qtype == "spell" else _short_meaning(m)
    if dont_know:
        correct, ans = False, None
    elif qtype == "choice":
        opts = await _options(db, d.id, s.current_unit, wid, m)
        picked = opts[choice] if choice is not None and 0 <= choice < len(opts) else None
        correct, ans = picked == right, picked
    else:
        correct, ans = _norm(text) == _norm(w), (text or "")[:100]
    await db.execute(sqlite_insert(CatchupAnswer).values(
        diagnosis_id=d.id, unit_id=s.current_unit, word_id=wid, qtype=qtype, correct=correct,
        dont_know=dont_know, answer=ans).on_conflict_do_nothing())
    if d.status == "pending":
        d.status = "doing"
    return {"correct": correct, "right": right, "word": w}


async def finish(db: AsyncSession, d: CatchupDiagnosis, *, early: bool = False) -> dict:
    """结束: 会的单元记成学会,要补的进 catchup_gaps。没测完的那个单元不算。不 commit"""
    if d.status == "done":
        return await summary(db, d)
    s = await compute(db, d)
    from app.services.autopilot import book_groups, live_books
    known = [u for u, v in s.verdicts.items() if v == "known"]
    gaps = [u for u, v in s.verdicts.items() if v == "gap"]
    unit_book = dict((await db.execute(select(Unit.id, Unit.book_id).where(Unit.id.in_(known + gaps)))).all())
    now = utc_now()
    mark_known = (await student_options(db, d.student_id))["mark_known"]
    for b in (await live_books(db, set(unit_book.values())) if mark_known else []):
        for g in await book_groups(db, b):
            if g.unit_id in known and g.count:
                # 已经有这一组(小鹰老师学着的)不动
                await db.execute(sqlite_insert(AutopilotGroup).values(
                    student_id=d.student_id, unit_id=g.unit_id, group_index=g.index, book_id=b,
                    word_count=g.count, rounds=0, graduated_at=now, legacy=True).on_conflict_do_nothing())
    for u in gaps:
        await db.execute(sqlite_insert(CatchupGap).values(
            student_id=d.student_id, unit_id=u, book_id=unit_book.get(u), diagnosis_id=d.id).on_conflict_do_nothing())
    d.status, d.finished_at = "done", now
    d.known_units, d.gap_units, d.questions = len(known), len(gaps), s.answered
    d.note = ("孩子自己先测到这" if early else
              {"solid": "往前连着几个单元都会,下面是牢的", "max": f"测满 {s.answered} 题",
               "end": "测到最前面的单元了"}.get(s.stop_reason or "", ""))
    return await summary(db, d)


# ---------------------------------------------------------------- 结果 / 补上了多少

async def gap_progress(db: AsyncSession, student_id: int) -> dict:
    """要补的单元: 一共几组几个词、学会了几组(补上了)"""
    from app.services.autopilot import book_groups, dead_units
    gaps = list((await db.execute(select(CatchupGap).where(CatchupGap.student_id == student_id)
                                  .order_by(CatchupGap.id))).scalars())
    dead = await dead_units(db, [g.unit_id for g in gaps])
    gaps = [g for g in gaps if g.unit_id not in dead]
    blocked = await _blocked_units(db, student_id, [(g.book_id, g.unit_id) for g in gaps])
    gaps = [g for g in gaps if g.unit_id not in blocked]
    if not gaps:
        return {"units": 0, "groups": 0, "words": 0, "fixed_groups": 0, "fixed_words": 0, "fixed_units": 0,
                "blocked_units": len(blocked)}
    grads = {(u, i) for u, i in (await db.execute(select(AutopilotGroup.unit_id, AutopilotGroup.group_index).where(
        AutopilotGroup.student_id == student_id, AutopilotGroup.graduated_at.is_not(None),
        AutopilotGroup.unit_id.in_([g.unit_id for g in gaps])))).all()}
    total = fixed = words = fixed_words = fixed_units = 0
    by_book: dict[int, list[int]] = defaultdict(list)
    for g in gaps:
        by_book[g.book_id].append(g.unit_id)
    for b, us in by_book.items():
        groups = [x for x in await book_groups(db, b) if x.unit_id in us and x.count]
        for u in us:
            ug = [x for x in groups if x.unit_id == u]
            done = [x for x in ug if (x.unit_id, x.index) in grads]
            total += len(ug)
            fixed += len(done)
            words += sum(x.count for x in ug)
            fixed_words += sum(x.count for x in done)
            fixed_units += 1 if ug and len(done) == len(ug) else 0
    return {"units": len(gaps), "groups": total, "words": words, "fixed_groups": fixed,
            "fixed_words": fixed_words, "fixed_units": fixed_units, "blocked_units": len(blocked)}


async def open_gap_units(db: AsyncSession, student_id: int) -> list[int]:
    """还没补完的单元,摸底时离现在近的在前"""
    rows = (await db.execute(select(CatchupGap.unit_id).where(CatchupGap.student_id == student_id)
                             .order_by(CatchupGap.id))).scalars().all()
    return list(rows)


async def summary(db: AsyncSession, d: CatchupDiagnosis) -> dict:
    gaps = (await db.execute(select(CatchupGap.unit_id, Unit.name, WordBook.name, WordBook.id)
                             .join(Unit, Unit.id == CatchupGap.unit_id).join(WordBook, WordBook.id == Unit.book_id)
                             .where(CatchupGap.diagnosis_id == d.id).order_by(CatchupGap.id))).all()
    blocked = await _blocked_units(db, d.student_id, [(b, u) for u, _n, _bn, b in gaps])
    return {"id": d.id, "status": d.status, "known_units": d.known_units, "gap_units": d.gap_units,
            "questions": d.questions, "note": d.note or "",
            "gaps": [{"unit_id": u, "unit": n, "book": b, "blocked": u in blocked} for u, n, b, _bid in gaps],
            "progress": await gap_progress(db, d.student_id),
            "finished_at": d.finished_at.isoformat() + "Z" if d.finished_at else None,
            "requested_by_name": d.requested_by_name or ""}


async def _blocked_units(db: AsyncSession, student_id: int, rows) -> set[int]:
    from app.services.scope_service import get_allowed_unit_ids
    cache, out = {}, set()
    for b, u in rows:
        if b not in cache:
            cache[b] = await get_allowed_unit_ids(db, student_id, b)
        a = cache[b]
        if a is not None and u not in a:
            out.add(u)
    return out


async def _fully_open(db: AsyncSession, student_id: int, book_id: int) -> bool:
    """这本书他整本能学(get_allowed_unit_ids 回 None)= 不用再开"""
    from app.services.scope_service import get_allowed_unit_ids
    return (await get_allowed_unit_ids(db, student_id, book_id)) is None


async def book_gaps(db: AsyncSession, students: list) -> dict:
    """老师页「开书」: 哪些孩子缺书、缺哪本、能不能直接开(规则见文件头第 6 条)"""
    from app.services import card_pack
    lock_cache: dict[tuple, Optional[str]] = {}

    async def lock(org_id, book_id):
        k = (org_id, book_id)
        if k not in lock_cache:
            lock_cache[k] = await card_pack.lock_reason(db, org_id, book_id)
        return lock_cache[k]

    names = {}
    no_book, gap_books, unknown = [], [], []
    for u in students:
        nm = (u.full_name or "").strip() or u.username
        book_id, _unit = await current_point(db, u.id, None)
        if book_id is None:
            if not await _has_any_book(db, u.id):
                unknown.append({"student_id": u.id, "name": nm})
        elif not await _fully_open(db, u.id, book_id):
            names.setdefault(book_id, (await db.execute(select(WordBook.name).where(WordBook.id == book_id))).scalar() or "")
            r = await lock(u.org_id, book_id)
            no_book.append({"student_id": u.id, "name": nm, "book_id": book_id, "book_name": names[book_id],
                            "locked": r or None})
        rows = (await db.execute(select(CatchupGap.book_id, CatchupGap.unit_id).where(
            CatchupGap.student_id == u.id))).all()
        need = []
        for b in dict.fromkeys(b for b, _ in rows if b is not None):
            if b == book_id and not await _fully_open(db, u.id, b):
                continue   # 已经在①里
            if await _fully_open(db, u.id, b):
                continue
            names.setdefault(b, (await db.execute(select(WordBook.name).where(WordBook.id == b))).scalar() or "")
            if not names[b]:
                continue   # 书删了
            need.append({"book_id": b, "book_name": names[b], "locked": (await lock(u.org_id, b)) or None})
        if need:
            gap_books.append({"student_id": u.id, "name": nm, "books": need})
    return {"no_book": no_book, "gap_books": gap_books, "unknown": unknown}


async def _has_any_book(db: AsyncSession, student_id: int) -> bool:
    from app.models.learning import BookAssignment
    return (await db.execute(select(BookAssignment.id).where(BookAssignment.student_id == student_id).limit(1))
            ).first() is not None


async def blocked_gap_books(db: AsyncSession, student_id: int) -> list[str]:
    """测出要补、但孩子没开这本书(补不了)的书名 —— 老师待办里写"""
    from app.services.scope_service import get_allowed_unit_ids
    rows = (await db.execute(select(CatchupGap.book_id, CatchupGap.unit_id).where(
        CatchupGap.student_id == student_id))).all()
    names, cache = [], {}
    for b, u in rows:
        if b not in cache:
            cache[b] = await get_allowed_unit_ids(db, student_id, b)
        a = cache[b]
        if a is not None and u not in a:
            n = (await db.execute(select(WordBook.name).where(WordBook.id == b))).scalar()
            if n and n not in names:
                names.append(n)
    return names


async def count_by_status(db: AsyncSession, student_ids: list[int]) -> dict[int, dict]:
    """老师页: 每个孩子最近一次摸底"""
    if not student_ids:
        return {}
    sub = (select(CatchupDiagnosis.student_id, func.max(CatchupDiagnosis.id).label("mid"))
           .where(CatchupDiagnosis.student_id.in_(student_ids)).group_by(CatchupDiagnosis.student_id).subquery())
    rows = (await db.execute(select(CatchupDiagnosis).join(sub, sub.c.mid == CatchupDiagnosis.id))).scalars()
    return {d.student_id: {"status": d.status, "known_units": d.known_units, "gap_units": d.gap_units,
                           "questions": d.questions} for d in rows}
