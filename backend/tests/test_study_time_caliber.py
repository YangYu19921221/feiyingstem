"""学习时长口径(services/study_time):全站唯一真源的行为钉子。

2026-08-29 起时长只有一种算法:**逐日 max(会话和封顶2h, min(日历,12h)) 再相加**。
在此之前同一个学生在五个界面能看到五个数字,最大差 250 倍
(生产 uid 89: 学生端 11962h / 家长端 13.9h / 教师端 47h)。

本测试钉住四件容易再次漂掉的事:
1. 两个数据源逐日取较大值(任一侧缺数都不能让时长塌成 0)
2. 两层封顶各自生效,且**逐日封顶**而非整段封顶(07-09 前的旧脏数据靠它挡住)
3. 各 API(单日/区间/累计/多学生/排行/班级)对同一份数据必须给同一个数
4. 班级合计是「先逐生封顶再相加」,不是「先相加再封顶」
"""
from datetime import date, datetime, timedelta

import pytest

from app.models.learning import StudySession
from app.models.user import StudyCalendar, User
from app.models.word import WordBook
from app.services import study_time


async def _mk_student(db, username="st_time") -> User:
    stu = User(username=username, email=f"{username}@e.com", hashed_password="x",
               role="student", full_name="时长测试学生", is_active=True)
    db.add(stu)
    await db.flush()
    return stu


async def _mk_book(db) -> WordBook:
    book = WordBook(name="时长测试书", is_public=True)
    db.add(book)
    await db.flush()
    return book


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    """北京日 d 的 hour 点对应的 UTC naive 时刻(库里存的就是这个)。"""
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


async def _add_session(db, user_id, book_id, d: date, seconds: int, hour: int = 10):
    started = _utc_for_beijing_day(d, hour)
    db.add(StudySession(
        user_id=user_id, book_id=book_id, learning_mode="classify",
        words_studied=10, time_spent=seconds,
        started_at=started, ended_at=started + timedelta(seconds=seconds),
    ))
    await db.flush()


async def _add_calendar(db, user_id, d: date, seconds: int):
    db.add(StudyCalendar(user_id=user_id, study_date=d, words_learned=10, duration=seconds))
    await db.flush()


@pytest.mark.asyncio
async def test_takes_larger_of_two_sources_per_day(db_session):
    """逐日取较大值:会话多的那天用会话,日历多的那天用日历。

    这是本口径存在的理由 —— 会话侧在复习/中途退出时低报,日历侧覆盖全但有旧脏数据,
    任何"只用一个源"的写法都会系统性偏一边。
    """
    stu = await _mk_student(db_session)
    book = await _mk_book(db_session)
    d1, d2 = date(2026, 8, 20), date(2026, 8, 21)

    # d1: 会话 1200s > 日历 600s → 取 1200
    await _add_session(db_session, stu.id, book.id, d1, 1200)
    await _add_calendar(db_session, stu.id, d1, 600)
    # d2: 日历 1500s > 会话 300s → 取 1500
    await _add_session(db_session, stu.id, book.id, d2, 300)
    await _add_calendar(db_session, stu.id, d2, 1500)

    assert await study_time.seconds_on_day(db_session, stu.id, d1) == 1200
    assert await study_time.seconds_on_day(db_session, stu.id, d2) == 1500
    # 累计 = 各日之和,不是"两个源各自求和再比较"(那样会得 1800 或 2100)
    assert await study_time.seconds_total(db_session, stu.id) == 2700


@pytest.mark.asyncio
async def test_only_one_source_present(db_session):
    """只有一个数据源时不能塌成 0(取较大值的实现容易漏掉缺失侧)。"""
    stu = await _mk_student(db_session)
    book = await _mk_book(db_session)
    d_sess, d_cal = date(2026, 8, 22), date(2026, 8, 23)

    await _add_session(db_session, stu.id, book.id, d_sess, 900)   # 只有会话
    await _add_calendar(db_session, stu.id, d_cal, 800)            # 只有日历

    assert await study_time.seconds_on_day(db_session, stu.id, d_sess) == 900
    assert await study_time.seconds_on_day(db_session, stu.id, d_cal) == 800


@pytest.mark.asyncio
async def test_day_cap_blocks_legacy_dirty_rows(db_session):
    """单日封顶 12h:显式查旧区间时,挡住 2026-07-09 前逐题累加的脏数据。

    生产最脏一行是 33538983 秒(9316 小时),裸求和会让学生端显示 717738 分钟。
    用户 2026-08-29 拍板不改历史数据,靠读取侧封顶挡住。

    ⚠️ 2026-09-12 起「累计」口径另有一道 TRUSTED_SINCE 起始日(见下一条测试),
    所以这里必须**显式传区间**才能验到封顶 —— 不传的话那一天已被起始日整个排除。
    封顶仍然是必需的: 调用方显式查 4 月数据时,它是唯一防线。
    """
    stu = await _mk_student(db_session)
    d = date(2026, 6, 4)
    await _add_calendar(db_session, stu.id, d, 33538983)

    assert await study_time.seconds_on_day(db_session, stu.id, d) == study_time.DAY_CAP_SEC
    # 显式区间: 封顶生效
    assert await study_time.seconds_total(db_session, stu.id, d, d) == 12 * 3600


@pytest.mark.asyncio
async def test_cumulative_excludes_pre_trusted_days(db_session):
    """累计口径从 TRUSTED_SINCE(2026-07-09)起算,不含之前的脏数据。

    为什么单靠 12h 封顶不够(生产实测 uid 23 王彬铜):
      07-09 前 66 天日均 102.9 分钟、单日最高 10.95 小时 —— **每天都不超顶**,
      封顶一点没削,但那 113 小时是逐题累加的产物(这些天在 study_sessions 里
      查不到对应会话);07-09 后 51 天日均 80.2 分钟、两个源能对上。
      封顶后累计仍 183 小时,其中 113 小时是脏的。

    显示一个虚高 1.6 倍的累计时长比不显示更糟 —— 它会被拿去发家长群。
    """
    stu = await _mk_student(db_session)
    before = date(2026, 6, 4)      # 起始日之前: 不该计入累计
    on_cut = date(2026, 7, 9)      # 起始日当天: 含首日,该计入
    after = date(2026, 8, 20)
    await _add_calendar(db_session, stu.id, before, 3600)
    await _add_calendar(db_session, stu.id, on_cut, 1800)
    await _add_calendar(db_session, stu.id, after, 600)

    # 累计 = 起始日当天 + 之后,不含之前
    assert await study_time.seconds_total(db_session, stu.id) == 1800 + 600

    # 但显式传区间时按调用方给的窗口原样查(不被悄悄改写) ——
    # 有人真要查 6 月就该拿到 6 月的值,由他判断可信度
    assert await study_time.seconds_total(db_session, stu.id, before, before) == 3600


@pytest.mark.asyncio
async def test_trusted_since_applies_to_all_entry_points(db_session):
    """起始日必须对**所有**对外函数生效(它们都经过 _per_day_seconds)。

    逐个函数各加一次判断必然漏掉某个,而漏掉的那个就是下一次"两个页面数字打架"。
    """
    stu = await _mk_student(db_session)
    await _add_calendar(db_session, stu.id, date(2026, 6, 4), 7200)   # 脏,应被排除
    await _add_calendar(db_session, stu.id, date(2026, 8, 20), 600)   # 干净

    assert await study_time.seconds_total(db_session, stu.id) == 600
    assert (await study_time.seconds_by_student(db_session, [stu.id])).get(stu.id) == 600
    rows = await study_time.seconds_rows(db_session, [stu.id])
    assert dict(rows).get(stu.id) == 600


@pytest.mark.asyncio
async def test_session_cap_is_per_session_not_per_day(db_session):
    """单会话封顶 2h,但同一天多个会话可以累加超过 2h。

    封错层级的话:按天封 → 一天最多 2h(真学 3 小时被砍);
    不封 → 一条挂机会话就能刷爆。
    """
    stu = await _mk_student(db_session)
    book = await _mk_book(db_session)
    d = date(2026, 8, 24)

    # 一条 3 小时的挂机会话 → 压到 2 小时
    await _add_session(db_session, stu.id, book.id, d, 3 * 3600, hour=9)
    assert await study_time.seconds_on_day(db_session, stu.id, d) == study_time.SESSION_CAP_SEC

    # 再加两条各 1 小时 → 2h + 1h + 1h = 4h(未被日封顶砍,因为 < 12h)
    await _add_session(db_session, stu.id, book.id, d, 3600, hour=14)
    await _add_session(db_session, stu.id, book.id, d, 3600, hour=16)
    assert await study_time.seconds_on_day(db_session, stu.id, d) == 4 * 3600


@pytest.mark.asyncio
async def test_day_cap_applies_per_day_not_to_the_range(db_session):
    """封顶是逐日的:连续 3 天各封 12h,区间合计 36h(不是整段封 12h)。"""
    stu = await _mk_student(db_session)
    days = [date(2026, 6, 4), date(2026, 6, 5), date(2026, 6, 6)]
    for d in days:
        await _add_calendar(db_session, stu.id, d, 20 * 3600)  # 每天都超顶

    total = await study_time.seconds_total(db_session, stu.id, days[0], days[-1])
    assert total == 3 * study_time.DAY_CAP_SEC


@pytest.mark.asyncio
async def test_all_apis_agree_on_same_data(db_session):
    """六个 API 对同一份数据必须给同一个数。

    历史教训:名次按一套口径算、数值按另一套显示,家长会看到
    "我 60 分钟排第 5,第 6 名却写着 80 分钟"。
    """
    stu = await _mk_student(db_session)
    book = await _mk_book(db_session)
    d = date(2026, 8, 25)
    await _add_session(db_session, stu.id, book.id, d, 1000)
    await _add_calendar(db_session, stu.id, d, 2500)  # 日历大 → 期望 2500

    vals = {
        "on_day": await study_time.seconds_on_day(db_session, stu.id, d),
        "total": await study_time.seconds_total(db_session, stu.id, d, d),
        "by_day": (await study_time.seconds_by_day(db_session, stu.id, [d]))[d],
        "by_student": (await study_time.seconds_by_student(db_session, [stu.id], d, d))[stu.id],
        "rows": dict(await study_time.seconds_rows(db_session, [stu.id], d, d))[stu.id],
        "group": (await study_time.group_seconds_by_day(db_session, [stu.id], [d]))[d],
    }
    assert set(vals.values()) == {2500}, vals


@pytest.mark.asyncio
async def test_range_boundaries_are_inclusive(db_session):
    """区间首尾两天都要含在内(闭区间),区间外的不能漏进来。"""
    stu = await _mk_student(db_session)
    for d, secs in [
        (date(2026, 8, 17), 100),  # 区间前一天
        (date(2026, 8, 18), 200),  # 首日
        (date(2026, 8, 20), 400),  # 末日
        (date(2026, 8, 21), 800),  # 区间后一天
    ]:
        await _add_calendar(db_session, stu.id, d, secs)

    got = await study_time.seconds_total(db_session, stu.id, date(2026, 8, 18), date(2026, 8, 20))
    assert got == 600  # 只含 200 + 400


@pytest.mark.asyncio
async def test_group_total_caps_per_student_before_summing(db_session):
    """班级合计:先逐生封顶再相加,不能先相加再封顶。

    顺序反了 → 全班共享一个 12h 上限,一个学生的旧脏数据顶满整条曲线,
    其他人的真实时长全被吞掉。
    """
    a = await _mk_student(db_session, "st_a")
    b = await _mk_student(db_session, "st_b")
    d = date(2026, 6, 4)
    await _add_calendar(db_session, a.id, d, 100 * 3600)  # 脏数据,封到 12h
    await _add_calendar(db_session, b.id, d, 3600)        # 正常 1h

    got = await study_time.group_seconds_by_day(db_session, [a.id, b.id], [d])
    # 先逐生封顶:12h + 1h = 13h;若先相加再封顶会得 12h(b 的 1 小时被吞)
    assert got[d] == study_time.DAY_CAP_SEC + 3600


@pytest.mark.asyncio
async def test_rows_sorted_desc_and_scoped_to_allowed(db_session):
    """排行榜行按时长降序;allowed=None 表示不限学生(全站榜)。"""
    a = await _mk_student(db_session, "st_x")
    b = await _mk_student(db_session, "st_y")
    c = await _mk_student(db_session, "st_z")
    d = date(2026, 8, 26)
    await _add_calendar(db_session, a.id, d, 600)
    await _add_calendar(db_session, b.id, d, 1800)
    await _add_calendar(db_session, c.id, d, 1200)

    rows = await study_time.seconds_rows(db_session, None, d, d)
    assert [uid for uid, _ in rows] == [b.id, c.id, a.id]
    assert [secs for _, secs in rows] == [1800, 1200, 600]

    # 限定学生集合时,集合外的人不能出现
    scoped = await study_time.seconds_rows(db_session, [a.id, c.id], d, d)
    assert [uid for uid, _ in scoped] == [c.id, a.id]


@pytest.mark.asyncio
async def test_beijing_day_attribution_at_utc_midnight(db_session):
    """会话按北京日归属:UTC 前一天 16:00 之后的会话算"北京第二天"。

    库里存 UTC naive,北京日 = UTC + 8 小时。搞错时区会让晚上 8 点后学的
    时长落到前一天,与 study_date(本就是北京日)对不上。
    """
    stu = await _mk_student(db_session)
    book = await _mk_book(db_session)
    d = date(2026, 8, 27)

    # 北京 d 日 00:30 → UTC 是 d-1 日 16:30
    await _add_session(db_session, stu.id, book.id, d, 700, hour=0)
    # 北京 d 日 23:30 → UTC 仍是 d 日 15:30
    await _add_session(db_session, stu.id, book.id, d, 800, hour=23)

    assert await study_time.seconds_on_day(db_session, stu.id, d) == 1500
    assert await study_time.seconds_on_day(db_session, stu.id, d - timedelta(days=1)) == 0
    assert await study_time.seconds_on_day(db_session, stu.id, d + timedelta(days=1)) == 0


@pytest.mark.asyncio
async def test_empty_inputs_dont_crash(db_session):
    """空学生集合/空日期列表:返回空而不是抛异常或全表扫描。"""
    stu = await _mk_student(db_session)
    d = date(2026, 8, 28)
    assert await study_time.seconds_by_student(db_session, []) == {}
    assert await study_time.seconds_by_day(db_session, stu.id, []) == {}
    assert await study_time.group_seconds_by_day(db_session, [], [d]) == {d: 0}
    # 没有任何数据的学生
    assert await study_time.seconds_total(db_session, stu.id) == 0
    assert await study_time.seconds_on_day(db_session, stu.id, d) == 0
