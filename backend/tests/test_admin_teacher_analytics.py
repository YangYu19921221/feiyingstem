"""管理端教师维度教学数据: 单师下钻 / 全员横排 / 签到明细。

## 这组测试守的核心

1. **签到率是签到不是到课**: 三个端点都必须下发 checkin_note。机构会拿这些数
   考核老师,把「用 App 的活跃度」说成「到课率」是拿错数据做决定。
2. **口径一致**: 列表(teachers-overview)与详情(teacher/analytics)必须给出同一个
   数字 —— 否则会出现"列表 60%、点进去 55%"这种无法自证的结论。
3. **学生去重**: 一个学生在同一老师的两个班里,汇总只能算一个人;
   全机构合计也不能把各老师的数字相加。
4. **未签到的人要列出来**: 只列签到的人,看的人无法回答"今天谁没签"。
"""
from datetime import date, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import LearningRecord
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent, DailyCheckin
from app.models.word import Word
from app.services import auth_service
from tests.conftest import _make_token


@pytest.fixture
async def ta_fixture(db_session):
    tenancy.register_tenant_models()
    tenancy._org_cache.clear()
    org = Organization(id=71, name="数据机构", code="TA71", status="active",
                       student_quota=100)
    other = Organization(id=72, name="别家", code="TA72", status="active",
                         student_quota=100)
    db_session.add_all([org, other])
    await db_session.flush()

    def mk(u, role, org_id, name=None):
        return User(username=u, email=f"{u}@e.com",
                    hashed_password=auth_service.get_password_hash("P@ss1234"),
                    role=role, full_name=name or u, is_active=True, org_id=org_id)

    admin = mk("taadmin", "admin", None)
    t1 = mk("tat1", "teacher", org.id, "张老师")
    t2 = mk("tat2", "teacher", org.id, "李老师")
    t_other = mk("tatother", "teacher", other.id, "别家老师")
    # t1 名下 2 个班,s1 同时在两个班(验去重)
    s1, s2, s3 = (mk("tas1", "student", org.id, "学生一"),
                  mk("tas2", "student", org.id, "学生二"),
                  mk("tas3", "student", org.id, "学生三"))
    db_session.add_all([admin, t1, t2, t_other, s1, s2, s3])
    await db_session.flush()

    c1 = Class(name="一班", teacher_id=t1.id, org_id=org.id)
    c2 = Class(name="二班", teacher_id=t1.id, org_id=org.id)
    c3 = Class(name="三班", teacher_id=t2.id, org_id=org.id)
    db_session.add_all([c1, c2, c3])
    await db_session.flush()
    db_session.add_all([
        ClassStudent(class_id=c1.id, student_id=s1.id, is_active=True),
        ClassStudent(class_id=c2.id, student_id=s2.id, is_active=True),
        ClassStudent(class_id=c3.id, student_id=s3.id, is_active=True),
    ])

    today = local_today()
    # s1 签到 3 天、s2 签到 1 天、s3 不签
    for i in range(3):
        db_session.add(DailyCheckin(user_id=s1.id, checkin_date=today - timedelta(days=i),
                                    checkin_at=datetime.utcnow()))
    db_session.add(DailyCheckin(user_id=s2.id, checkin_date=today,
                                checkin_at=datetime.utcnow()))

    # s1 做过题(算活跃), s2/s3 没做
    w = Word(word="apple")
    db_session.add(w)
    await db_session.flush()
    db_session.add(LearningRecord(user_id=s1.id, word_id=w.id, learning_mode="spelling",
                                  is_correct=True, created_at=datetime.utcnow()))
    await db_session.commit()
    return {"org": org, "admin": admin, "t1": t1, "t2": t2, "t_other": t_other,
            "s1": s1, "s2": s2, "s3": s3, "c1": c1, "c2": c2, "c3": c3}


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


# ---------- 单个老师下钻 ----------

@pytest.mark.asyncio
async def test_teacher_analytics_basic(client: AsyncClient, ta_fixture):
    r = await client.get(f"/api/v1/admin/teachers/{ta_fixture['t1'].id}/analytics",
                         headers=_hdr(ta_fixture["admin"]), params={"days": 7})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["teacher"]["full_name"] == "张老师"
    assert b["summary"]["class_count"] == 2
    # s1 + s2,两个班各一人
    assert b["summary"]["student_count"] == 2, b["summary"]
    assert len(b["classes"]) == 2
    # 逐班明细
    by_name = {c["name"]: c for c in b["classes"]}
    assert by_name["一班"]["student_count"] == 1
    assert by_name["一班"]["checkin_days"] == 3
    # 签到率 = 3 人天 / (1 人 × 7 天)
    assert by_name["一班"]["checkin_rate"] == pytest.approx(42.9, abs=0.2)
    assert by_name["二班"]["checkin_days"] == 1


@pytest.mark.asyncio
async def test_checkin_note_always_present(client: AsyncClient, ta_fixture):
    """**最重要的一条**: 三个端点都要带「签到≠到课」的说明。

    没有它,机构会把签到率当到课率去考核老师 —— 那是拿错数据做决定。
    """
    hdr = _hdr(ta_fixture["admin"])
    for path in [f"/api/v1/admin/teachers/{ta_fixture['t1'].id}/analytics",
                 "/api/v1/admin/teachers-overview",
                 "/api/v1/admin/checkins"]:
        r = await client.get(path, headers=hdr)
        assert r.status_code == 200, f"{path}: {r.text}"
        note = r.json().get("checkin_note", "")
        assert "不等于线下到课率" in note, f"{path} 缺少签到口径说明: {note}"


@pytest.mark.asyncio
async def test_active_separate_from_checkin(client: AsyncClient, ta_fixture):
    """签了到但没做题 ≠ 活跃。两个数分开才看得出"只在打卡"。

    s1 签到 3 天且做过题 → 活跃;s2 签到 1 天但没做题 → 不活跃。
    """
    r = await client.get(f"/api/v1/admin/teachers/{ta_fixture['t1'].id}/analytics",
                         headers=_hdr(ta_fixture["admin"]))
    b = r.json()
    by_name = {c["name"]: c for c in b["classes"]}
    assert by_name["一班"]["active_students"] == 1, by_name["一班"]
    assert by_name["二班"]["checkin_days"] == 1 and by_name["二班"]["active_students"] == 0, \
        "签了到没做题不能算活跃"


@pytest.mark.asyncio
async def test_student_deduped_across_classes(client: AsyncClient, ta_fixture, db_session):
    """同一学生在同一老师的两个班里,汇总只算一个人(否则学生数虚高一倍)"""
    db_session.add(ClassStudent(class_id=ta_fixture["c2"].id,
                                student_id=ta_fixture["s1"].id, is_active=True))
    await db_session.commit()

    r = await client.get(f"/api/v1/admin/teachers/{ta_fixture['t1'].id}/analytics",
                         headers=_hdr(ta_fixture["admin"]))
    b = r.json()
    # 两个班各有 s1;s2 在二班 → 去重后 2 人
    assert b["summary"]["student_count"] == 2, b["summary"]
    # 但逐班仍各自计数(一班 1 人、二班 2 人)
    assert sum(c["student_count"] for c in b["classes"]) == 3


@pytest.mark.asyncio
async def test_teacher_with_no_class(client: AsyncClient, ta_fixture, db_session):
    """没带班的老师: 全 0 而不是报错(除零要兜住)"""
    t = User(username="tanoclass", email="tanoclass@e.com", hashed_password="x",
             role="teacher", full_name="新老师", is_active=True,
             org_id=ta_fixture["org"].id)
    db_session.add(t)
    await db_session.commit()
    r = await client.get(f"/api/v1/admin/teachers/{t.id}/analytics",
                         headers=_hdr(ta_fixture["admin"]))
    assert r.status_code == 200, r.text
    s = r.json()["summary"]
    assert (s["student_count"], s["checkin_rate"], s["active_rate"]) == (0, 0.0, 0.0)


@pytest.mark.asyncio
async def test_non_teacher_id_rejected(client: AsyncClient, ta_fixture):
    """传学生 id 要 404,不能算出一堆空指标让人以为系统坏了"""
    r = await client.get(f"/api/v1/admin/teachers/{ta_fixture['s1'].id}/analytics",
                         headers=_hdr(ta_fixture["admin"]))
    assert r.status_code == 404, r.text


# ---------- 全员横排 ----------

@pytest.mark.asyncio
async def test_teachers_overview(client: AsyncClient, ta_fixture):
    r = await client.get("/api/v1/admin/teachers-overview",
                         headers=_hdr(ta_fixture["admin"]), params={"days": 7})
    assert r.status_code == 200, r.text
    b = r.json()
    names = {t["full_name"]: t for t in b["teachers"]}
    assert "张老师" in names and "李老师" in names
    assert names["张老师"]["class_count"] == 2
    assert names["张老师"]["student_count"] == 2
    assert names["李老师"]["student_count"] == 1
    # 合计学生按全局去重
    assert b["totals"]["student_count"] == 3, b["totals"]


@pytest.mark.asyncio
async def test_overview_and_detail_agree(client: AsyncClient, ta_fixture):
    """**口径一致**: 列表与详情给同一个数,否则结论无法自证"""
    hdr = _hdr(ta_fixture["admin"])
    ov = (await client.get("/api/v1/admin/teachers-overview", headers=hdr)).json()
    row = next(t for t in ov["teachers"] if t["teacher_id"] == ta_fixture["t1"].id)
    det = (await client.get(f"/api/v1/admin/teachers/{ta_fixture['t1'].id}/analytics",
                            headers=hdr)).json()["summary"]
    for k in ("student_count", "checkin_rate", "active_students",
              "study_minutes", "vocab", "training"):
        assert row[k] == det[k], f"{k} 列表={row[k]} 详情={det[k]} 不一致"


# ---------- 签到明细 ----------

@pytest.mark.asyncio
async def test_checkins_lists_unchecked_too(client: AsyncClient, ta_fixture):
    """未签到的也要列出来 —— 查签到的主要目的就是回答"今天谁没签" """
    r = await client.get("/api/v1/admin/checkins", headers=_hdr(ta_fixture["admin"]))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["total"] == 3, b
    by_name = {s["name"]: s for s in b["students"]}
    assert by_name["学生一"]["checked"] is True
    assert by_name["学生一"]["checked_at"] is not None
    assert by_name["学生三"]["checked"] is False, "没签到的学生必须出现在列表里"
    assert by_name["学生三"]["checked_at"] is None
    # 带上班级与老师名,便于定位
    assert by_name["学生一"]["class_name"] == "一班"
    assert by_name["学生一"]["teacher_name"] == "张老师"


@pytest.mark.asyncio
async def test_checkins_filters(client: AsyncClient, ta_fixture):
    hdr = _hdr(ta_fixture["admin"])
    r = await client.get("/api/v1/admin/checkins", headers=hdr,
                         params={"teacher_id": ta_fixture["t2"].id})
    assert [s["name"] for s in r.json()["students"]] == ["学生三"]

    r = await client.get("/api/v1/admin/checkins", headers=hdr,
                         params={"class_id": ta_fixture["c1"].id})
    assert [s["name"] for s in r.json()["students"]] == ["学生一"]


@pytest.mark.asyncio
async def test_checkins_bad_date(client: AsyncClient, ta_fixture):
    r = await client.get("/api/v1/admin/checkins", headers=_hdr(ta_fixture["admin"]),
                         params={"day": "2026/09/12"})
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_checkins_past_day(client: AsyncClient, ta_fixture):
    """查历史某天: s1 前天签过、s2 只有今天签 → 前天只有 s1"""
    two_days_ago = (local_today() - timedelta(days=2)).isoformat()
    r = await client.get("/api/v1/admin/checkins", headers=_hdr(ta_fixture["admin"]),
                         params={"day": two_days_ago})
    b = r.json()
    checked = {s["name"] for s in b["students"] if s["checked"]}
    assert checked == {"学生一"}, b["students"]


# ---------- 导出(学生逐日 + 教师汇总 + 班级汇总) ----------

@pytest.mark.asyncio
async def test_export_shape(client: AsyncClient, ta_fixture):
    """三张表齐全,且带两条口径说明(表格会脱离页面单独流传)"""
    r = await client.get("/api/v1/admin/checkins/export",
                         headers=_hdr(ta_fixture["admin"]))
    assert r.status_code == 200, r.text
    b = r.json()
    assert set(b) >= {"window", "students", "teachers", "classes",
                      "checkin_note", "teacher_note"}
    assert b["window"]["days"] == 7
    assert len(b["window"]["day_keys"]) == 7
    assert "不等于线下到课率" in b["checkin_note"]
    # 老师那几列不是签到 —— 导出文件里也必须写明
    assert "老师没有签到记录" in b["teacher_note"], b["teacher_note"]


@pytest.mark.asyncio
async def test_export_student_daily_marks(client: AsyncClient, ta_fixture):
    """学生逐日: 每人一行每天一列,签到天数与签到率对得上"""
    r = await client.get("/api/v1/admin/checkins/export",
                         headers=_hdr(ta_fixture["admin"]))
    b = r.json()
    by_name = {s["name"]: s for s in b["students"]}
    # s1 签到 3 天(今天/昨天/前天)
    s1 = by_name["学生一"]
    assert s1["checked_days"] == 3, s1["marks"]
    assert s1["checkin_rate"] == pytest.approx(42.9, abs=0.2)
    assert sum(1 for v in s1["marks"].values() if v == "✓") == 3
    # 每天一列,列数 = 区间天数
    assert len(s1["marks"]) == 7
    # s3 一天没签
    assert by_name["学生三"]["checked_days"] == 0
    assert all(v == "" for v in by_name["学生三"]["marks"].values())


@pytest.mark.asyncio
async def test_export_teacher_work_traces(client: AsyncClient, ta_fixture):
    """教师表带**老师本人的工作痕迹**,而不是"老师签到率"。

    老师没有签到记录(生产 5980 行全是学生),所以这里给的是布作业/发币/开直播。
    """
    r = await client.get("/api/v1/admin/checkins/export",
                         headers=_hdr(ta_fixture["admin"]))
    b = r.json()
    t = next(x for x in b["teachers"] if x["name"] == "张老师")
    # 教学指标
    assert t["student_count"] == 2 and t["class_count"] == 2
    # 工作痕迹字段必须存在(值可以是 0)
    for k in ("homework_assigned", "coins_granted", "live_sessions",
              "last_homework_at", "last_login"):
        assert k in t, f"缺少工作痕迹字段 {k}"
    # 刻意不提供 teacher_checkin_rate —— 那个数不存在,给了就是编的
    assert "checkin_rate" in t          # 这是他名下**学生**的签到率
    assert "teacher_checkin_rate" not in t


@pytest.mark.asyncio
async def test_export_custom_range(client: AsyncClient, ta_fixture):
    today = local_today()
    r = await client.get("/api/v1/admin/checkins/export",
                         headers=_hdr(ta_fixture["admin"]),
                         params={"start": (today - timedelta(days=2)).isoformat(),
                                 "end": today.isoformat()})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["window"]["days"] == 3 and len(b["window"]["day_keys"]) == 3
    # 3 天窗口里 s1 签满 3 天 → 100%
    s1 = next(s for s in b["students"] if s["name"] == "学生一")
    assert s1["checked_days"] == 3 and s1["checkin_rate"] == 100.0


@pytest.mark.asyncio
async def test_export_range_guards(client: AsyncClient, ta_fixture):
    hdr = _hdr(ta_fixture["admin"])
    today = local_today()
    # 起始晚于结束
    r = await client.get("/api/v1/admin/checkins/export", headers=hdr,
                         params={"start": today.isoformat(),
                                 "end": (today - timedelta(days=3)).isoformat()})
    assert r.status_code == 400, r.text
    # 超过上限(92 天): 再长学生表会宽到几百列
    r = await client.get("/api/v1/admin/checkins/export", headers=hdr,
                         params={"start": (today - timedelta(days=200)).isoformat(),
                                 "end": today.isoformat()})
    assert r.status_code == 400 and "92" in r.json()["detail"], r.text
    # 格式错
    r = await client.get("/api/v1/admin/checkins/export", headers=hdr,
                         params={"start": "2026/09/01"})
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_export_agrees_with_page(client: AsyncClient, ta_fixture):
    """导出与页面同源: 教师汇总必须和 teachers-overview 给同一个数"""
    hdr = _hdr(ta_fixture["admin"])
    ov = (await client.get("/api/v1/admin/teachers-overview", headers=hdr)).json()
    ex = (await client.get("/api/v1/admin/checkins/export", headers=hdr)).json()
    ov_row = next(t for t in ov["teachers"] if t["teacher_id"] == ta_fixture["t1"].id)
    ex_row = next(t for t in ex["teachers"] if t["teacher_id"] == ta_fixture["t1"].id)
    for k in ("student_count", "checkin_rate", "active_students",
              "study_minutes", "vocab"):
        assert ov_row[k] == ex_row[k], f"{k} 页面={ov_row[k]} 导出={ex_row[k]}"


@pytest.mark.asyncio
async def test_export_class_rows(client: AsyncClient, ta_fixture):
    r = await client.get("/api/v1/admin/checkins/export",
                         headers=_hdr(ta_fixture["admin"]))
    b = r.json()
    by_name = {c["class_name"]: c for c in b["classes"]}
    assert set(by_name) == {"一班", "二班", "三班"}
    assert by_name["一班"]["teacher_name"] == "张老师"
    assert by_name["一班"]["student_count"] == 1
