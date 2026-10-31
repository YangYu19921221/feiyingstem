"""小鹰老师自动布置作业(2026-10-29),规则见 services/autopilot.py 文件头。锁住的规矩:
1. 手动班签到不派,老师点「按建议布置」才派;自动班签到就派;一天只派一次;老师今天自己布置过就不派
2. 新来的孩子每天 20 个、过关线 80;没书 → 「需要你处理」
3. 轮次: 第一次过关 = 第 1 轮,隔 1 天第 2 轮,再隔 3 天第 3 轮;同一天重复背 / 没到日子不算轮次;
   三轮且当天第一次过关检测达到过关线才算学会,没达到一直加轮,进「需要你处理」
4. 派的顺序: 到期的轮次在新词前面
5. 过关线: 第一周 80;之后按两周第一次过关平均分,一周最多动一档;老师可以固定
6. 电教室 / 家里按班级上课日
7. 加练: 今天的做完了才能要,不进金币分母
8. 过关检测记下来就把今天派的作业标完成(不等前端交卷);没过不标
9. 点评: 学习助手开着用模型写(不发姓名),没开 / 没调通按规则写;老师写过的不覆盖
10. 只看本班;助教不能切自动;平台总开关关了不派
"""
import json
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import func, select, text as sql_text, update

from app.core import tenancy
from app.core.timeutil import local_today, utc_now
from app.models.autopilot import (
    AutopilotAttempt, AutopilotClass, AutopilotDispatch, AutopilotGroup, AutopilotStudent, AutopilotTask,
)
from app.models.coach import CoachNote
from app.models.learning import BookAssignment, HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.system_config import AIProvider
from app.models.user import Class, ClassStudent, DailyCheckin, User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import autopilot as ap
from app.services import coin_service
from app.services import tutor as tt
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


class Clock:
    def __init__(self):
        self.today = local_today()

    def __call__(self):
        return self.today


@pytest.fixture
def clock(monkeypatch):
    c = Clock()
    monkeypatch.setattr(ap, "local_today", c)
    return c


@pytest.fixture
async def env(db_session, monkeypatch):
    """直营机构 + 老师 + 班级 + 两个学生(一个有书一个没书)+ 一本书 2 个单元、每单元 3 组 × 10 词"""
    tenancy._org_cache.clear()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(1, '直营', 'HQ001', 'active', 'assigned')"))
    t = User(username="apt", email="apt@e.com", hashed_password="x", role="teacher", full_name="王老师",
             is_active=True, org_id=1)
    ot = User(username="apot", email="apot@e.com", hashed_password="x", role="teacher", full_name="李老师",
              is_active=True, org_id=1)
    s = User(username="aps", email="aps@e.com", hashed_password="x", role="student", full_name="张小明",
             is_active=True, org_id=1)
    nb = User(username="apnb", email="apnb@e.com", hashed_password="x", role="student", full_name="没书的",
              is_active=True, org_id=1)
    db_session.add_all([t, ot, s, nb])
    await db_session.flush()
    c = Class(name="三年级1班", teacher_id=t.id, org_id=1)
    db_session.add(c)
    await db_session.flush()
    db_session.add_all([ClassStudent(class_id=c.id, student_id=s.id, is_active=True),
                        ClassStudent(class_id=c.id, student_id=nb.id, is_active=True)])
    book = WordBook(name="人教版三上", is_public=True, grade_level="小学三年级")
    db_session.add(book)
    await db_session.flush()
    units, words = [], {}
    for un in (1, 2):
        u = Unit(book_id=book.id, unit_number=un, name=f"Unit {un}", order_index=un, group_size=10)
        db_session.add(u)
        await db_session.flush()
        units.append(u)
        words[u.id] = []
        for i in range(30):
            w = Word(word=f"apw{un}x{i}")
            db_session.add(w)
            await db_session.flush()
            db_session.add(WordDefinition(word_id=w.id, meaning=f"义{un}-{i}", is_primary=True))
            db_session.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=i))
            words[u.id].append(w.id)
    db_session.add(BookAssignment(student_id=s.id, book_id=book.id, scope_type="book", teacher_id=t.id))
    await db_session.commit()

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(ap, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(ap, "INLINE", True)
    ap._groups_cache.clear()
    return {"t": t, "ot": ot, "s": s, "nb": nb, "c": c, "book": book, "u1": units[0], "u2": units[1],
            "words": words}


def _group_words(env, unit, *groups):
    ws = env["words"][unit.id]
    return [w for g in groups for w in ws[(g - 1) * 10:g * 10]]


async def _set_class(db, cls, **kw):
    ac = (await db.execute(select(AutopilotClass).where(AutopilotClass.class_id == cls.id))).scalar_one_or_none()
    if ac is None:
        ac = AutopilotClass(class_id=cls.id, org_id=cls.org_id, mode="manual", default_location="classroom")
        db.add(ac)
    for k, v in kw.items():
        setattr(ac, k, v)
    await db.commit()
    return ac


async def _tasks(db, sid, day=None):
    q = select(AutopilotTask).where(AutopilotTask.student_id == sid)
    if day:
        q = q.where(AutopilotTask.day == day)
    return list((await db.execute(q.order_by(AutopilotTask.id))).scalars())


async def _hw(db, hid):
    return (await db.execute(select(HomeworkAssignment).where(HomeworkAssignment.id == hid))).scalar_one()


async def _hsa(db, hid):
    return (await db.execute(select(HomeworkStudentAssignment).where(
        HomeworkStudentAssignment.homework_id == hid))).scalar_one()


async def _attempt(db, env, unit, groups, score):
    out = await ap.record_attempt(db, env["s"], unit.id, _group_words(env, unit, *groups), score)
    done = await ap.complete_tasks(db, env["s"].id, unit.id, score) if out["passed"] else []
    await db.commit()
    return out, done


# ---------------------------------------------------------------- 1. 手动 / 自动、一天一次、老师自己布置了就不派

@pytest.mark.asyncio
async def test_manual_class_checkin_does_not_dispatch_teacher_button_does(client, db_session, env):
    s, t, c = env["s"], env["t"], env["c"]
    r = await client.post("/api/v1/student/checkin", headers=_h(s.id))
    assert r.json()["autopilot"] == "manual"
    assert await _tasks(db_session, s.id) == []
    # 建议: 看得到派什么,但不写作业
    sug = (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}/suggestions", headers=_h(t.id))).json()
    p = sug["suggestions"][str(s.id)]
    assert p["status"] == "ok" and p["words"] == 20 and p["tier"] == 20 and p["pass_line"] == 80
    assert [i["groups"] for i in p["items"]] == [[1, 2]]
    assert await _tasks(db_session, s.id) == []
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/dispatch",
                          json={"student_ids": [s.id]}, headers=_h(t.id))
    assert r.json()["dispatched"] == 1
    tasks = await _tasks(db_session, s.id)
    assert len(tasks) == 1 and tasks[0].groups == "1,2" and tasks[0].words == 20
    hw = await _hw(db_session, tasks[0].homework_id)
    assert hw.group_index == 1 and hw.teacher_id == t.id and hw.target_score == 80
    assert hw.assigned_by_name.startswith("小鹰老师(王老师")
    # 再点一次: 一天只派一次
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/dispatch",
                          json={"student_ids": [s.id]}, headers=_h(t.id))
    assert r.json()["dispatched"] == 0 and len(await _tasks(db_session, s.id)) == 1


@pytest.mark.asyncio
async def test_auto_class_dispatches_on_checkin_once_and_respects_teacher_homework(client, db_session, env):
    s, nb, c, t = env["s"], env["nb"], env["c"], env["t"]
    await _set_class(db_session, c, mode="auto")
    r = await client.post("/api/v1/student/checkin", headers=_h(s.id))
    assert r.json()["autopilot"] == "dispatched"
    assert len(await _tasks(db_session, s.id)) == 1
    hw = await _hw(db_session, (await _tasks(db_session, s.id))[0].homework_id)
    assert hw.assigned_by_name == ap.AUTO_BY and hw.assigned_by is None
    # 首页再打开: 不重复派
    v = (await client.get("/api/v1/student/autopilot/today", headers=_h(s.id))).json()
    assert v["active"] and len(v["items"]) == 1 and len(await _tasks(db_session, s.id)) == 1
    assert v["items"][0]["assignment_id"]
    # 没书的孩子: 不派,进老师的「需要你处理」
    r = await client.post("/api/v1/student/checkin", headers=_h(nb.id))
    assert r.json()["autopilot"] == "no_book"
    todo = (await client.get("/api/v1/teacher/autopilot/todo", headers=_h(t.id))).json()["items"]
    assert any(i["kind"] == "no_book" and i["student_id"] == nb.id for i in todo)


@pytest.mark.asyncio
async def test_teacher_assigned_today_skips_auto(client, db_session, env):
    s, c, t = env["s"], env["c"], env["t"]
    await _set_class(db_session, c, mode="auto")
    r = await client.post("/api/v1/teacher/homework", json={
        "title": "老师自己的", "unit_id": env["u2"].id, "learning_mode": "flashcard", "student_ids": [s.id]},
        headers=_h(t.id))
    assert r.status_code == 200, r.text
    r = await client.post("/api/v1/student/checkin", headers=_h(s.id))
    assert r.json()["autopilot"] == "skipped_manual"
    assert await _tasks(db_session, s.id) == []


@pytest.mark.asyncio
async def test_platform_switch_and_pause(client, db_session, env):
    s, c = env["s"], env["c"]
    await _set_class(db_session, c, mode="auto", paused=True)
    r = await client.post("/api/v1/student/checkin", headers=_h(s.id))
    assert r.json()["autopilot"] == "paused" and await _tasks(db_session, s.id) == []
    await _set_class(db_session, c, paused=False)
    await ap.save_settings(db_session, False)
    await db_session.commit()
    assert (await ap.ensure_dispatch(db_session, s))["status"] == "off"
    await ap.save_settings(db_session, True)
    await db_session.commit()
    assert (await ap.ensure_dispatch(db_session, s))["status"] == "dispatched"


# ---------------------------------------------------------------- 2./3./4. 轮次、学会、顺序

@pytest.mark.asyncio
async def test_rounds_spacing_repeat_and_graduation(db_session, env, clock):
    s, u1 = env["s"], env["u1"]
    await _set_class(db_session, env["c"], mode="auto")
    d0 = clock.today
    assert (await ap.ensure_dispatch(db_session, s))["status"] == "dispatched"
    out, done = await _attempt(db_session, env, u1, [1, 2], 90)
    assert out["passed"] and out["round"] == 1 and len(done) == 1
    assert (await _hsa(db_session, done[0])).status == "completed"
    # 同一天再背一遍: 自己多背,不算轮次
    out, _ = await _attempt(db_session, env, u1, [1, 2], 100)
    assert out["round"] is None and out["extra"]
    g1 = (await db_session.execute(select(AutopilotGroup).where(
        AutopilotGroup.student_id == s.id, AutopilotGroup.group_index == 1))).scalar_one()
    assert g1.rounds == 1 and g1.next_due == (d0 + timedelta(days=1)).isoformat() and g1.extra_count == 1
    assert g1.first_score == 90   # 学会没有只看当天第一次

    # 第二天: 到期的第 2 轮排在新词前面;昨天做完 + 90 分 → 新来的孩子升一档到 40
    clock.today = d0 + timedelta(days=1)
    r = await ap.ensure_dispatch(db_session, s)
    assert r["tier"] == 40
    kinds = [(i["kind"], i["round"], i["groups"]) for i in r["items"]]
    assert kinds[0] == ("round", 2, [1, 2])
    assert kinds[1][0] == "new"
    out, _ = await _attempt(db_session, env, u1, [1, 2], 85)
    assert out["round"] == 2
    await db_session.refresh(g1)
    assert g1.next_due == (d0 + timedelta(days=4)).isoformat()   # 再隔 3 天

    # 第 3 天提前背: 不算轮次
    clock.today = d0 + timedelta(days=2)
    out, _ = await _attempt(db_session, env, u1, [1, 2], 95)
    assert out["round"] is None

    # 第 5 天第 3 轮,但当天第一次只有 75(没过 80)→ 不算轮次;同一天再考 90 算第 3 轮但不算学会
    clock.today = d0 + timedelta(days=4)
    out, _ = await _attempt(db_session, env, u1, [1, 2], 75)
    assert not out["passed"] and out["round"] is None
    out, _ = await _attempt(db_session, env, u1, [1, 2], 90)
    assert out["round"] == 3 and not out["graduated"]
    await db_session.refresh(g1)
    assert g1.graduated_at is None and g1.next_due == (d0 + timedelta(days=7)).isoformat()
    # 三轮没学会: 老师「需要你处理」
    todo = await ap.todo(db_session, env["t"].id)
    assert any(i["kind"] == "stuck" and i["student_id"] == s.id for i in todo)
    # 第 8 天第 4 轮,第一次就 92 → 学会
    clock.today = d0 + timedelta(days=7)
    out, _ = await _attempt(db_session, env, u1, [1, 2], 92)
    assert out["round"] == 4 and out["graduated"]
    await db_session.refresh(g1)
    assert g1.graduated_at is not None and g1.next_due is None
    fails = (await db_session.execute(select(func.count()).select_from(AutopilotAttempt).where(
        AutopilotAttempt.student_id == s.id, AutopilotAttempt.passed.is_(False)))).scalar()
    assert fails == 1   # 没过的那次也记了


@pytest.mark.asyncio
async def test_failed_exam_does_not_complete_homework(db_session, env, clock):
    s, u1 = env["s"], env["u1"]
    await _set_class(db_session, env["c"], mode="auto")
    await ap.ensure_dispatch(db_session, s)
    out, done = await _attempt(db_session, env, u1, [1, 2], 70)
    assert not out["passed"] and done == []
    t = (await _tasks(db_session, s.id))[0]
    assert (await _hsa(db_session, t.homework_id)).status == "pending"
    # 只过了第 1 组: 这份(1–2 组)还不算完成
    out, done = await _attempt(db_session, env, u1, [1], 90)
    assert done == []
    out, done = await _attempt(db_session, env, u1, [2], 90)
    assert done == [t.homework_id]


@pytest.mark.asyncio
async def test_history_bootstrap_counts_spaced_days_only(db_session, env, clock):
    """上线前学过的: 某天练到一组六成以上算那天学过,连着三天只算两轮"""
    s, u1 = env["s"], env["u1"]
    d0 = clock.today
    for back in (3, 2, 1):
        day = d0 - timedelta(days=back)
        for w in _group_words(env, u1, 1):
            db_session.add(LearningRecord(user_id=s.id, word_id=w, learning_mode="classify", is_correct=True,
                                          created_at=ap.local_day_utc_range(day)[0] + timedelta(hours=3)))
    await db_session.commit()
    plan = await ap.preview(db_session, s, env["c"], None)
    g1 = (await db_session.execute(select(AutopilotGroup).where(
        AutopilotGroup.student_id == s.id, AutopilotGroup.group_index == 1))).scalar_one()
    # d-3 第 1 轮 → 第二天 d-2 第 2 轮 → 再隔 3 天才是第 3 轮,d-1 不算(连着三天只算两轮)
    assert g1.legacy and g1.rounds == 2 and g1.last_day == (d0 - timedelta(days=2)).isoformat()
    assert g1.next_due == (d0 + timedelta(days=1)).isoformat()
    # 新词从第 2 组开始(第 1 组学过了)
    assert plan["items"][0]["kind"] == "new" and plan["items"][0]["groups"][0] == 2


# ---------------------------------------------------------------- 5. 过关线

@pytest.mark.asyncio
async def test_pass_line_first_week_then_one_step_a_week(db_session, env, clock):
    s = env["s"]
    st = await ap.student_row(db_session, s.id, 1)
    st.enrolled_at = utc_now() - timedelta(days=3)
    await db_session.commit()
    for i in range(12):
        db_session.add(AutopilotAttempt(student_id=s.id, unit_id=env["u1"].id, groups="1", score=99, required=80,
                                        passed=True, first_today=True,
                                        day=(clock.today - timedelta(days=1 + i % 10)).isoformat()))
    await db_session.commit()
    await ap.update_pass_line(db_session, st, clock.today)
    assert st.pass_line == 80   # 第一周不动
    st.enrolled_at = utc_now() - timedelta(days=20)
    await ap.update_pass_line(db_session, st, clock.today)
    assert st.pass_line == 85   # 平均 99,目标 95,一周只动一档
    await ap.update_pass_line(db_session, st, clock.today + timedelta(days=3))
    assert st.pass_line == 85   # 一周内不再动
    # 一周后: 最近两周要有 >= 10 次「当天第一次」才看(只剩 9 次时不动)
    await ap.update_pass_line(db_session, st, clock.today + timedelta(days=7))
    assert st.pass_line == 85
    for i in range(5):
        db_session.add(AutopilotAttempt(student_id=s.id, unit_id=env["u1"].id, groups="2", score=98, required=85,
                                        passed=True, first_today=True,
                                        day=(clock.today + timedelta(days=1 + i)).isoformat()))
    await db_session.commit()
    st.pass_line_day = None
    await ap.update_pass_line(db_session, st, clock.today + timedelta(days=7))
    assert st.pass_line == 90
    # 老师固定: 优先
    st.fixed_pass_line = 80
    await db_session.commit()
    assert (await ap.pass_line_for(db_session, s.id))[0] == 80
    # 学习页拿到的就是这个数
    out = await ap.record_attempt(db_session, s, env["u1"].id, _group_words(env, env["u1"], 1), 82)
    assert out["required"] == 80 and out["passed"]


@pytest.mark.asyncio
async def test_pass_line_reaches_learning_page(client, db_session, env):
    s = env["s"]
    db_session.add(DailyCheckin(user_id=s.id, checkin_date=local_today()))
    st = await ap.student_row(db_session, s.id, 1)
    st.enrolled_at, st.pass_line = utc_now(), 90
    await db_session.commit()
    r = await client.post(f"/api/v1/student/units/{env['u1'].id}/start", json={"learning_mode": "classify"},
                          headers=_h(s.id))
    assert r.json()["pass_line"] == 90
    # 没被小鹰老师派过的孩子照旧 80
    st.enrolled_at = None
    await db_session.commit()
    r = await client.post(f"/api/v1/student/units/{env['u1'].id}/start", json={"learning_mode": "classify"},
                          headers=_h(s.id))
    assert r.json()["pass_line"] == 80


@pytest.mark.asyncio
async def test_learning_page_gets_all_groups_of_the_task(client, db_session, env):
    s = env["s"]
    await _set_class(db_session, env["c"], mode="auto")
    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    t = (await _tasks(db_session, s.id))[0]
    aid = (await _hsa(db_session, t.homework_id)).id
    r = await client.post(f"/api/v1/student/homework/{aid}/start", headers=_h(s.id))
    assert r.json()["group_index"] == 1
    r = await client.post(f"/api/v1/student/units/{env['u1'].id}/start",
                          json={"learning_mode": "classify", "group_index": 1, "assignment_id": aid}, headers=_h(s.id))
    assert r.json()["total_words"] == 20   # 第 1–2 组,不是只有第 1 组


async def _target(db, hid):
    # 直接读列: 接口在同一个会话里用条件 UPDATE 改的,会话里的对象不会跟着变
    return (await db.execute(select(HomeworkAssignment.target_score).where(HomeworkAssignment.id == hid))).scalar_one()


@pytest.mark.asyncio
async def test_teacher_changes_pass_line_updates_today_homework_target(client, db_session, env):
    # 派完以后老师改过关线: 学习页横幅(作业目标分)和考完的判分要说同一个数
    s, t, c = env["s"], env["t"], env["c"]
    await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/dispatch", json={"student_ids": [s.id]},
                      headers=_h(t.id))
    hid = (await _tasks(db_session, s.id))[0].homework_id
    assert await _target(db_session, hid) == 80
    r = await client.put(f"/api/v1/teacher/autopilot/students/{s.id}", json={"fixed_pass_line": 90}, headers=_h(t.id))
    assert r.status_code == 200
    assert await _target(db_session, hid) == 90
    # 全班定 85,但这个孩子单独定了 90 → 还是 90;取消他的再按全班
    await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"pass_line": 85}, headers=_h(t.id))
    assert await _target(db_session, hid) == 90
    await client.put(f"/api/v1/teacher/autopilot/students/{s.id}", json={"fixed_pass_line": None}, headers=_h(t.id))
    assert await _target(db_session, hid) == 85
    # 做完了的不再动
    await db_session.execute(update(HomeworkStudentAssignment).where(
        HomeworkStudentAssignment.homework_id == hid).values(status="completed"))
    await db_session.commit()
    await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"pass_line": 95}, headers=_h(t.id))
    assert await _target(db_session, hid) == 85


# ---------------------------------------------------------------- 6. 电教室 / 家里

@pytest.mark.asyncio
async def test_location_by_class_days(db_session, env, clock):
    ac = await _set_class(db_session, env["c"], mode="auto", class_days=str(clock.today.weekday()))
    assert ap.location_for(ac, clock.today)[0] == "classroom"
    assert ap.location_for(ac, clock.today + timedelta(days=1))[0] == "home"
    ac.day_overrides = json.dumps({clock.today.isoformat(): "home"})
    assert ap.location_for(ac, clock.today)[0] == "home"
    await db_session.commit()
    await ap.ensure_dispatch(db_session, env["s"])
    hw = await _hw(db_session, (await _tasks(db_session, env["s"].id))[0].homework_id)
    assert hw.location_type == "home"


# ---------------------------------------------------------------- 7. 加练

@pytest.mark.asyncio
async def test_extra_batch_only_after_done_and_not_in_coin_denominator(client, db_session, env):
    s = env["s"]
    await _set_class(db_session, env["c"], mode="auto")
    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    r = await client.post("/api/v1/student/autopilot/extra", headers=_h(s.id))
    assert r.status_code == 409   # 还没做完
    r = await client.post("/api/v1/student/autopilot/attempt", json={
        "unit_id": env["u1"].id, "word_ids": _group_words(env, env["u1"], 1, 2), "score": 95}, headers=_h(s.id))
    assert r.json()["passed"] and r.json()["completed_homework"]
    r = await client.post("/api/v1/student/autopilot/extra", headers=_h(s.id))
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["groups"] == [3]   # 半档 = 10 个,接着第 3 组
    tasks = await _tasks(db_session, s.id)
    assert [t.batch for t in tasks] == [0, 1]
    hw = await _hw(db_session, tasks[1].homework_id)
    assert hw.title.startswith("小鹰老师 · 加练")
    # 金币分母: 只有当天那一份,加练没做也算「全做完」
    prog = await coin_service.task_progress_on_day(db_session, [s.id], local_today())
    assert prog[s.id] == (1, 1)
    v = (await client.get("/api/v1/student/autopilot/today", headers=_h(s.id))).json()
    assert v["all_done"] and len(v["extra_items"]) == 1 and not v["extra_open"]


# ---------------------------------------------------------------- 8./9. 点评

def _relay(monkeypatch, reply: str, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"content": [{"type": "text", "text": reply}],
                                         "usage": {"input_tokens": 300, "output_tokens": 60}})
    monkeypatch.setattr(tt, "new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def _with_relay(db):
    from app.api.v1.admin.ai_config import encrypt_api_key
    db.add(AIProvider(provider_name=tt.PROVIDER_NAME, display_name="学习助手专用",
                      api_key=encrypt_api_key("sk-relay"), base_url="https://relay.example",
                      model_name="claude-sonnet-5-5", enabled=True, is_default=False,
                      extra_config={"fallback_model": "claude-sonnet-4-6"}))
    await db.commit()


@pytest.mark.asyncio
async def test_ai_comment_when_done_no_name_and_validated(client, db_session, env, monkeypatch):
    s = env["s"]
    await _with_relay(db_session)
    seen: list = []
    _relay(monkeypatch, json.dumps({"comment": "今天两组都过关了,第一次就拿了 95 分,真棒。明天把 apw1x3 再写两遍。",
                                    "focus": ["apw1x3", "notmyword"], "flag": "ok"}, ensure_ascii=False), seen)
    await _set_class(db_session, env["c"], mode="auto")
    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    db_session.add(LearningRecord(user_id=s.id, word_id=_group_words(env, env["u1"], 1)[3], learning_mode="spelling",
                                  is_correct=False))
    await db_session.commit()
    await client.post("/api/v1/student/autopilot/attempt", json={
        "unit_id": env["u1"].id, "word_ids": _group_words(env, env["u1"], 1, 2), "score": 95}, headers=_h(s.id))
    note = (await db_session.execute(select(CoachNote).where(CoachNote.student_id == s.id))).scalar_one()
    assert note.author_name == "小鹰老师" and "95" in note.content
    d = (await db_session.execute(select(AutopilotDispatch).where(AutopilotDispatch.student_id == s.id))).scalar_one()
    assert d.comment_source == "ai" and d.comment_tokens == 360
    body = json.dumps(seen[0], ensure_ascii=False)
    assert "张小明" not in body and "aps" not in body.replace("apw", "")
    assert seen[0]["model"] == "claude-sonnet-4-6"
    # 一天一条: 再触发不再调
    await ap.after_submit(s.id)
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_rule_comment_when_relay_bad_and_teacher_note_kept(db_session, env, monkeypatch):
    s = env["s"]
    await _with_relay(db_session)
    seen: list = []
    _relay(monkeypatch, "不是 JSON 的回答 http://x.com", seen)
    await _set_class(db_session, env["c"], mode="auto")
    r = await ap.ensure_dispatch(db_session, s)
    out = await ap.write_comment(db_session, r["dispatch_id"])
    assert out and "任务做了 0/1 份" in out
    d = await db_session.get(AutopilotDispatch, r["dispatch_id"])
    assert d.comment_source == "rule"
    # 老师当天自己写过的: 不覆盖
    s2 = env["nb"]
    db_session.add(BookAssignment(student_id=s2.id, book_id=env["book"].id, scope_type="book", teacher_id=env["t"].id))
    db_session.add(CoachNote(student_id=s2.id, teacher_id=env["t"].id, org_id=1, note_date=local_today(),
                             content="老师写的", author_id=env["t"].id, author_name="王老师"))
    await db_session.commit()
    r2 = await ap.ensure_dispatch(db_session, s2)
    assert await ap.write_comment(db_session, r2["dispatch_id"]) is None
    note = (await db_session.execute(select(CoachNote).where(CoachNote.student_id == s2.id))).scalar_one()
    assert note.content == "老师写的"


def test_check_ai_comment_rejects_bad_output():
    f = {"wrong_words": ["apple"]}
    assert ap.check_ai_comment("没有 json", f) is None
    assert ap.check_ai_comment(json.dumps({"comment": "太短"}), f) is None
    assert ap.check_ai_comment(json.dumps({"comment": "打这个电话 13812345678 问问老师吧,今天很好"}), f) is None
    got = ap.check_ai_comment(json.dumps({"comment": "今天的任务都做完了,继续保持哦!", "focus": ["APPLE", "x"],
                                          "flag": "weird"}), f)
    assert got == ("今天的任务都做完了,继续保持哦!", ["apple"], "ok")


# ---------------------------------------------------------------- 10. 权限

@pytest.mark.asyncio
async def test_only_my_class_and_assistant_cannot_switch(client, db_session, env):
    c, ot, s, t = env["c"], env["ot"], env["s"], env["t"]
    assert (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}", headers=_h(ot.id))).status_code == 404
    assert (await client.put(f"/api/v1/teacher/autopilot/students/{s.id}", json={"fixed_words": 40},
                             headers=_h(ot.id))).status_code == 403
    assert (await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/dispatch", json={"student_ids": [s.id]},
                              headers=_h(ot.id))).status_code == 404
    asst = User(username="apasst", email="apasst@e.com", hashed_password="x", role="teacher", full_name="小助教",
                is_active=True, org_id=1, owner_teacher_id=t.id)
    db_session.add(asst)
    await db_session.commit()
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"mode": "auto"}, headers=_h(asst.id))
    assert r.status_code == 403
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"mode": "auto", "class_days": [0, 2, 4]},
                         headers=_h(t.id))
    assert r.json()["mode"] == "auto" and r.json()["class_days"] == [0, 2, 4]
    # 「键在才改」: 只改上限不会把模式 / 上课日抹掉
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"max_words": 40}, headers=_h(t.id))
    assert r.json()["mode"] == "auto" and r.json()["class_days"] == [0, 2, 4] and r.json()["max_words"] == 40
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{c.id}", json={"pass_line": 87}, headers=_h(t.id))
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_fixed_words_and_class_cap(db_session, env):
    s = env["s"]
    ac = await _set_class(db_session, env["c"], mode="auto", max_words=10)
    st = await ap.student_row(db_session, s.id, 1)
    st.tier = 60
    assert ap.effective_tier(st, ac)[0] == 10
    st.fixed_words = 30
    assert ap.effective_tier(st, ac)[0] == 30   # 老师给这个孩子定的优先


@pytest.mark.asyncio
async def test_undo_today_keeps_started_ones(client, db_session, env):
    s, t = env["s"], env["t"]
    await _set_class(db_session, env["c"], mode="auto")
    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    r = await client.post(f"/api/v1/teacher/autopilot/students/{s.id}/undo", headers=_h(t.id))
    assert r.json()["removed"] == 1
    assert await _tasks(db_session, s.id) == []
    assert (await db_session.execute(select(func.count()).select_from(AutopilotDispatch))).scalar() == 0
    # 撤回之后老师可以按建议重派
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/dispatch",
                          json={"student_ids": [s.id]}, headers=_h(t.id))
    assert r.json()["dispatched"] == 1


@pytest.mark.asyncio
async def test_comment_written_once_even_if_called_twice(db_session, env, monkeypatch):
    s = env["s"]
    await _with_relay(db_session)
    seen: list = []
    _relay(monkeypatch, json.dumps({"comment": "今天的任务还没做完,明天先把第一份补上,加油!", "focus": [],
                                    "flag": "ok"}, ensure_ascii=False), seen)
    await _set_class(db_session, env["c"], mode="auto")
    r = await ap.ensure_dispatch(db_session, s)
    assert await ap.write_comment(db_session, r["dispatch_id"])
    assert await ap.write_comment(db_session, r["dispatch_id"]) is None   # 晚上那一遍和做完那一刻撞上
    assert len(seen) == 1
    n = (await db_session.execute(select(func.count()).select_from(CoachNote)
                                  .where(CoachNote.student_id == s.id))).scalar()
    assert n == 1


@pytest.mark.asyncio
async def test_undo_keeps_started_task_and_day_row(client, db_session, env, clock):
    s, t = env["s"], env["t"]
    await _set_class(db_session, env["c"], mode="auto")
    # 第二天有到期轮次 + 新词两份: 孩子开始做了第一份,撤回只撤没动过的
    await ap.ensure_dispatch(db_session, s)
    await _attempt(db_session, env, env["u1"], [1, 2], 90)
    clock.today = clock.today + timedelta(days=1)
    r = await ap.ensure_dispatch(db_session, s)
    tasks = await _tasks(db_session, s.id, clock.today.isoformat())
    assert len(tasks) >= 2 and tasks[0].kind == "round"
    sa = await _hsa(db_session, tasks[0].homework_id)
    sa.status = "in_progress"
    await db_session.commit()
    n = await ap.undo_today(db_session, s.id)
    await db_session.commit()
    assert n == len(tasks) - 1
    left = await _tasks(db_session, s.id, clock.today.isoformat())
    assert [x.homework_id for x in left] == [tasks[0].homework_id]
    assert (await db_session.execute(select(AutopilotDispatch).where(
        AutopilotDispatch.id == r["dispatch_id"]))).scalar_one_or_none() is not None


# ---------------------------------------------------------------- 11. 签到才能做(2026-10-31)

@pytest.mark.asyncio
async def test_must_check_in_before_homework_and_extra(client, db_session, env):
    """老师点「按建议布置」时孩子还没签到: 首页列得出来,但开始做 / 再来一份都要先签到;
    被拦的那次不算尝试次数"""
    s, t, c = env["s"], env["t"], env["c"]
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/dispatch",
                          json={"student_ids": [s.id]}, headers=_h(t.id))
    assert r.json()["dispatched"] == 1
    v = (await client.get("/api/v1/student/autopilot/today", headers=_h(s.id))).json()
    assert v["active"] and v["checked_in"] is False
    aid = v["items"][0]["assignment_id"]
    r = await client.post(f"/api/v1/student/homework/{aid}/start", headers=_h(s.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "need_checkin"
    hsa = (await db_session.execute(select(HomeworkStudentAssignment).where(
        HomeworkStudentAssignment.id == aid))).scalar_one()
    await db_session.refresh(hsa)
    assert hsa.status != "in_progress" and (hsa.attempts_count or 0) == 0
    r = await client.post("/api/v1/student/autopilot/extra", headers=_h(s.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "need_checkin"

    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    v = (await client.get("/api/v1/student/autopilot/today", headers=_h(s.id))).json()
    assert v["checked_in"] is True
    r = await client.post(f"/api/v1/student/homework/{aid}/start", headers=_h(s.id))
    assert r.status_code == 200, r.text
    r = await client.post("/api/v1/student/autopilot/extra", headers=_h(s.id))
    assert r.status_code == 409, "签了到才轮到「今天的还没做完」那道判断"


@pytest.mark.asyncio
async def test_waiting_checkin_only_for_auto_class_that_will_dispatch(client, db_session, env):
    """首页「签到后小鹰老师就给你排」只在签到真的会派的时候说"""
    s, c = env["s"], env["c"]

    async def view():
        return (await client.get("/api/v1/student/autopilot/today", headers=_h(s.id))).json()

    v = await view()
    assert v["active"] is False and v["waiting_checkin"] is False, "手动班签到也不派"
    await _set_class(db_session, c, mode="auto")
    v = await view()
    assert v["active"] is False and v["waiting_checkin"] is True and v["checked_in"] is False
    await _set_class(db_session, c, paused=True)
    assert (await view())["waiting_checkin"] is False, "暂停了"
    await _set_class(db_session, c, paused=False)
    await client.post("/api/v1/student/checkin", headers=_h(s.id))
    v = await view()
    assert v["active"] is True and v["checked_in"] is True
