"""单词王参评资格(2026-08-20 定的两道门)。

起因是生产事故:陈沐华1(id 635)08-18 被加进测试班 ce1(class 50),那个班另两名
成员是 0 词的演示账号和加进来 23 秒就被移出的学生。他在班里独自学了 94 词、
次日 106 词,连着两天自动当上单词王各拿 1 枚币;而他在真实班「暑假晚上班」的
词量排名并不靠前。老师看到的现象是"这孩子没进班却天天单词王"。

两道门(用户拍板,单词王不是保底奖励,哪天没人满足就哪天没有王):
  A 有对手 —— 班里当天有资格参评的人 >= MIN_KING_CONTENDERS,否则整班不出王
  B 完成作业 —— 当天布置了任务且全部完成才参评;没布置任务的日子不产生王

⚠️ 词量口径没动(仍是 daily_words 的 distinct(lower(word)) 排除 classify)。
资格只决定"谁进候选",不决定"数字是多少" —— 教师端日报/大屏/学生端看到的词数不变。
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.coin import StudentCoin
from app.models.learning import (
    HomeworkAssignment, HomeworkStudentAssignment, LearningRecord,
)
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, Word
from app.services.coin_service import (
    word_kings_for_class, word_king_race, settle_day, MIN_KING_CONTENDERS,
)


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    """北京日 d 的 hour 点 → UTC naive。"""
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


class _Ctx:
    """一个班 + 若干学生的场景骨架,按需给学生"学词"和"布置/完成任务"。"""

    def __init__(self, db, org, cls, unit, words, day):
        self.db, self.org, self.cls, self.unit = db, org, cls, unit
        self.words, self.day = words, day

    async def add_student(self, username: str) -> User:
        stu = User(username=username, email=f"{username}@e.com", hashed_password="x",
                   role="student", full_name=username, is_active=True, org_id=self.org.id)
        self.db.add(stu)
        await self.db.flush()
        self.db.add(ClassStudent(class_id=self.cls.id, student_id=stu.id, is_active=True))
        await self.db.flush()
        return stu

    async def learn(self, stu: User, n: int, day: date | None = None):
        """让 stu 在 day 学 n 个不同的词(spelling 模式,计入词量口径)。"""
        for w in self.words[:n]:
            self.db.add(LearningRecord(
                user_id=stu.id, word_id=w.id, learning_mode="spelling",
                is_correct=True, time_spent=5,
                created_at=_utc_for_beijing_day(day or self.day, hour=12),
            ))
        await self.db.flush()

    async def assign(self, stu: User, *, completed: bool, day: date | None = None):
        d = day or self.day
        hw = HomeworkAssignment(
            title=f"{d} 任务", unit_id=self.unit.id, teacher_id=self.cls.teacher_id,
            learning_mode="spelling", target_score=80, max_attempts=3, is_closed=False,
        )
        self.db.add(hw)
        await self.db.flush()
        self.db.add(HomeworkStudentAssignment(
            homework_id=hw.id, student_id=stu.id,
            status="completed" if completed else "in_progress",
            attempts_count=1, best_score=100 if completed else 0, total_time_spent=60,
            assigned_at=_utc_for_beijing_day(d),
            completed_at=_utc_for_beijing_day(d, hour=20) if completed else None,
        ))
        await self.db.flush()


@pytest.fixture
async def ctx(db_session):
    """自动发币机构 + 一个班 + 20 个可学的词。日期用**昨天**:单词王只在那天
    结束后才结算(settle_day 的 d < today 分支),用今天测不到发币。"""
    tenancy._org_cache.clear()
    org = Organization(name="测试机构", code="KING1", status="active", coin_mode="auto")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="king_t", email="king_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    db_session.add(teacher)
    await db_session.flush()

    cls = Class(name="测试班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db_session.add(unit)
    await db_session.flush()
    words = [Word(word=f"w{i:03d}", difficulty=1) for i in range(20)]
    db_session.add_all(words)
    await db_session.flush()

    c = _Ctx(db_session, org, cls, unit, words, local_today() - timedelta(days=1))
    yield c


async def _balance(db, user_id: int) -> int:
    return (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == user_id)
    )).scalar() or 0


@pytest.mark.asyncio
async def test_alone_in_class_is_not_king(ctx):
    """门 A(事故复现):班里只有他一个人学过词 → 不是王、不发币。

    这就是 class 50 的形状:另一名成员 0 词。他学得再多也没有对手。
    """
    solo = await ctx.add_student("独自一人")
    idle = await ctx.add_student("零词同学")  # 在班里但当天没学
    await ctx.learn(solo, 15)
    await ctx.assign(solo, completed=True)   # 作业也做完了,仍不该当王
    await ctx.db.commit()

    assert await word_kings_for_class(ctx.db, ctx.cls.id, ctx.day) == set()
    await settle_day(ctx.db, ctx.day)
    await ctx.db.commit()
    assert await _balance(ctx.db, solo.id) == 1, "任务币照发,只是没有单词王币"
    assert await _balance(ctx.db, idle.id) == 0


@pytest.mark.asyncio
async def test_two_contenders_produce_a_king(ctx):
    """有对手时正常出王:词多的那个当王,拿任务币 + 单词王币共 2 枚。"""
    top = await ctx.add_student("词多的")
    rival = await ctx.add_student("词少的")
    await ctx.learn(top, 15)
    await ctx.learn(rival, 8)
    await ctx.assign(top, completed=True)
    await ctx.assign(rival, completed=True)
    await ctx.db.commit()

    assert await word_kings_for_class(ctx.db, ctx.cls.id, ctx.day) == {top.id}
    await settle_day(ctx.db, ctx.day)
    await ctx.db.commit()
    assert await _balance(ctx.db, top.id) == 2, "任务币 1 + 单词王 1"
    assert await _balance(ctx.db, rival.id) == 1


@pytest.mark.asyncio
async def test_unfinished_homework_disqualifies_top_word_count(ctx):
    """门 B:词量第一但作业没做完 → 不参评,王让给做完作业的第二名。

    这是「作业不做、光刷词量当王」的堵口。
    """
    slacker = await ctx.add_student("刷词没做作业")
    diligent = await ctx.add_student("做完作业的")
    other = await ctx.add_student("凑数的")
    await ctx.learn(slacker, 18)     # 词最多
    await ctx.learn(diligent, 10)
    await ctx.learn(other, 5)
    await ctx.assign(slacker, completed=False)
    await ctx.assign(diligent, completed=True)
    await ctx.assign(other, completed=True)
    await ctx.db.commit()

    assert await word_kings_for_class(ctx.db, ctx.cls.id, ctx.day) == {diligent.id}
    await settle_day(ctx.db, ctx.day)
    await ctx.db.commit()
    assert await _balance(ctx.db, slacker.id) == 0, "作业没做完,两种币都没有"
    assert await _balance(ctx.db, diligent.id) == 2


@pytest.mark.asyncio
async def test_no_homework_assigned_means_no_king(ctx):
    """门 B 的另一半:当天谁都没被布置任务 → 那天不产生王(用户已确认接受)。"""
    a = await ctx.add_student("自学甲")
    b = await ctx.add_student("自学乙")
    await ctx.learn(a, 15)
    await ctx.learn(b, 12)
    await ctx.db.commit()

    assert await word_kings_for_class(ctx.db, ctx.cls.id, ctx.day) == set()
    await settle_day(ctx.db, ctx.day)
    await ctx.db.commit()
    assert await _balance(ctx.db, a.id) == 0
    assert await _balance(ctx.db, b.id) == 0


@pytest.mark.asyncio
async def test_ties_still_share_the_crown(ctx):
    """并列第一仍然都算王、都发币(这条老规则没改)。"""
    a = await ctx.add_student("并列甲")
    b = await ctx.add_student("并列乙")
    await ctx.learn(a, 12)
    await ctx.learn(b, 12)
    await ctx.assign(a, completed=True)
    await ctx.assign(b, completed=True)
    await ctx.db.commit()

    assert await word_kings_for_class(ctx.db, ctx.cls.id, ctx.day) == {a.id, b.id}
    await settle_day(ctx.db, ctx.day)
    await ctx.db.commit()
    assert await _balance(ctx.db, a.id) == 2
    assert await _balance(ctx.db, b.id) == 2


@pytest.mark.asyncio
async def test_race_reports_real_word_count_but_not_leading(ctx):
    """战况提示:词数必须是真实词量,不能被资格筛成 0。

    孩子学了一上午却看到"我今天 0 词"是不可接受的;资格只影响 is_leading。
    """
    solo = await ctx.add_student("独自一人")
    await ctx.add_student("零词同学")
    await ctx.learn(solo, 15)
    await ctx.assign(solo, completed=True)
    await ctx.db.commit()

    race = await word_king_race(ctx.db, solo.id, ctx.day)
    assert race["my_words"] == 15, "展示的词量不受资格影响"
    assert race["is_leading"] is False, "没有对手,不算领先"
    assert race["no_contest"] is True


@pytest.mark.asyncio
async def test_race_distinguishes_no_task_from_task_pending(ctx):
    """no_task 与 task_pending 必须分开报 —— 文案一个是"今天没有王"、
    一个是"去把作业做完还有机会",混成一句会让孩子白刷一晚上词。"""
    pending = await ctx.add_student("作业没做完")
    rival = await ctx.add_student("对手")
    await ctx.learn(pending, 10)
    await ctx.learn(rival, 6)
    await ctx.assign(pending, completed=False)
    await ctx.assign(rival, completed=True)
    await ctx.db.commit()

    r = await word_king_race(ctx.db, pending.id, ctx.day)
    assert r["task_pending"] is True
    assert r["no_task"] is False
    assert r["is_leading"] is False

    # 换一个班:谁都没布置任务 → no_task 为真、task_pending 为假
    lone = await ctx.add_student("没任务的")
    await ctx.learn(lone, 9)
    await ctx.db.commit()
    r2 = await word_king_race(ctx.db, lone.id, ctx.day)
    assert r2["no_task"] is True
    assert r2["task_pending"] is False


@pytest.mark.asyncio
async def test_min_contenders_constant_is_at_least_two(ctx):
    """常量别被改成 1 —— 那等于把门 A 整个关掉,事故会原样复现。"""
    assert MIN_KING_CONTENDERS >= 2
