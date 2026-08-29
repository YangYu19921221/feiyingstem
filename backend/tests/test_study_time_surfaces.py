"""五个界面的时长必须一致(端到端)。

2026-08-29 之前:同一个学生同一天,学生端学情页/学生端首页/家长端/教师端每日表/
教师端学生详情 会给出不同的数字(生产 uid 89 累计 11962h vs 13.9h vs 47h)。
这个测试从 HTTP 层拉五个接口比对,只测服务层不够 —— 漂移历来发生在
「某个端点自己手写了一套聚合」,服务层再对也管不住。
"""
from datetime import date, datetime, timedelta

import pytest

from app.api.v1.auth import get_current_parent
from app.core import tenancy
from app.main import app
from app.models.learning import StudySession
from app.models.organization import Organization
from app.models.user import (
    Class, ClassStudent, ParentStudentLink, StudyCalendar, User,
)
from app.models.word import WordBook
from app.core.timeutil import local_today
from tests.conftest import _make_token


def _utc_for_beijing_day(d: date, hour: int = 10) -> datetime:
    return datetime(d.year, d.month, d.day, hour) - timedelta(hours=8)


@pytest.mark.asyncio
async def test_all_five_surfaces_report_same_duration(client, db_session):
    """学生端(学情/首页)、家长端、教师端(每日表/学生详情)时长一致。

    数据设计成两个源逐日互有大小,且掺一条 07-09 前的旧脏行 ——
    任何"只读日历裸和"的端点都会被这条脏行放大到 12 小时以上而露出来。
    """
    today = local_today()

    # 机构必须存在且 active:否则 get_current_* 一律 402(org_id=None 查不到行)
    tenancy._org_cache.clear()
    org = Organization(name="时长测试机构", code="DUR01", status="active")
    db_session.add(org)
    await db_session.flush()

    teacher = User(username="t_dur", email="t_dur@e.com", hashed_password="x",
                   role="teacher", full_name="老师", is_active=True, org_id=org.id)
    stu = User(username="s_dur", email="s_dur@e.com", hashed_password="x",
               role="student", full_name="时长学生", is_active=True, org_id=org.id)
    parent = User(username="p_dur", email="p_dur@e.com", phone="13900000001",
                  hashed_password="x", role="parent", full_name="家长",
                  is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu, parent])
    await db_session.flush()

    klass = Class(name="时长班", teacher_id=teacher.id)
    db_session.add(klass)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=klass.id, student_id=stu.id))
    db_session.add(ParentStudentLink(parent_id=parent.id, student_id=stu.id))

    book = WordBook(name="时长书", is_public=True)
    db_session.add(book)
    await db_session.flush()

    # 今天:会话 1800s > 日历 900s → 今日应为 1800s(30 分钟)
    started = _utc_for_beijing_day(today, 10)
    db_session.add(StudySession(
        user_id=stu.id, book_id=book.id, learning_mode="classify",
        words_studied=10, time_spent=1800,
        started_at=started, ended_at=started + timedelta(seconds=1800),
    ))
    db_session.add(StudyCalendar(user_id=stu.id, study_date=today,
                                 words_learned=10, duration=900))
    # 一条 07-09 前的旧脏行(9316 小时):累计里最多只能贡献 12 小时
    db_session.add(StudyCalendar(user_id=stu.id, study_date=date(2026, 6, 4),
                                 words_learned=1520, duration=33538983))
    await db_session.commit()

    EXPECT_TODAY = 1800                      # 秒
    EXPECT_TOTAL = 1800 + 12 * 3600          # 今天 + 脏行封顶后的 12h

    stu_headers = {"Authorization": f"Bearer {_make_token(stu.id)}"}
    t_headers = {"Authorization": f"Bearer {_make_token(teacher.id)}"}

    # ① 学生端学情页 /analytics/overview
    r = await client.get("/api/v1/analytics/overview", headers=stu_headers)
    assert r.status_code == 200, r.text
    ov = r.json()
    assert ov["today_duration"] == EXPECT_TODAY, ov
    assert ov["total_duration"] == EXPECT_TOTAL, ov

    # ② 学生端首页 /student/stats(分钟)
    r = await client.get("/api/v1/student/stats", headers=stu_headers)
    assert r.status_code == 200, r.text
    assert r.json()["total_minutes"] == EXPECT_TOTAL // 60, r.json()

    # ③ 教师端班级每日表
    r = await client.get(f"/api/v1/teacher/classes/{klass.id}/daily-stats",
                         headers=t_headers)
    assert r.status_code == 200, r.text
    row = next(s for s in r.json()["students"] if s["user_id"] == stu.id)
    assert row["study_duration"] == EXPECT_TODAY, row

    # ④ 教师端学生详情
    r = await client.get(
        f"/api/v1/teacher/classes/{klass.id}/student/{stu.id}/detail",
        headers=t_headers)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["today_duration"] == EXPECT_TODAY, detail
    assert detail["total_study_time"] == EXPECT_TOTAL, detail

    # ⑤ 家长端(依赖注入直接放行家长身份)
    app.dependency_overrides[get_current_parent] = lambda: parent
    try:
        r = await client.get(f"/api/v1/parent/children/{stu.id}/dashboard")
        assert r.status_code == 200, r.text
        pd = r.json()
        assert pd["today_minutes"] == EXPECT_TODAY // 60, pd
        assert pd["total_minutes"] == EXPECT_TOTAL // 60, pd
    finally:
        app.dependency_overrides.pop(get_current_parent, None)
