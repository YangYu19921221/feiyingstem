"""跟学校进度 + 查缺补漏(2026-11-01 试点),规则见 services/catchup.py 文件头。锁住的规矩:
1. 没开的班和以前一模一样(老师布置了作业就不派、没有 10 个一档)
2. 开了: 老师布置了作业那天只补一小份漏洞,不算今天的任务、不进金币分母
3. 摸底: 从现在的单元往前测到前几册;会的单元记学会不再派,要补的单元进补漏;答案只在服务器
4. 补漏只派孩子能学的单元
5. 一天只够一组时,十天里三天先补漏
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.autopilot import (
    AutopilotClass, AutopilotClassSync, AutopilotGroup, AutopilotStudent, AutopilotTask, CatchupGap,
)
from app.models.learning import BookAssignment, LearningProgress
from app.models.user import Class, ClassStudent, DailyCheckin, User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import autopilot as ap
from app.services import catchup
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _book(db, name, grade, volume, n_units=3, per_unit=10, prefix="w"):
    b = WordBook(name=name, is_public=True, grade_level=grade, volume=volume, series="人教版")
    db.add(b)
    await db.flush()
    units = []
    for un in range(1, n_units + 1):
        u = Unit(book_id=b.id, unit_number=un, name=f"Unit {un}", order_index=un, group_size=10)
        db.add(u)
        await db.flush()
        for i in range(per_unit):
            w = Word(word=f"{prefix}{b.id}u{un}w{i}".replace("0", "o").replace("1", "l").replace("2", "z")
                     .replace("3", "e").replace("4", "a").replace("5", "s").replace("6", "g").replace("7", "t")
                     .replace("8", "b").replace("9", "q"))
            db.add(w)
            await db.flush()
            db.add(WordDefinition(word_id=w.id, meaning=f"义{b.id}-{un}-{i}", is_primary=True))
            db.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=i))
        units.append(u)
    return b, units


@pytest.fixture
async def env(db_session, monkeypatch):
    tenancy._org_cache.clear()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(1, '直营', 'HQ001', 'active', 'assigned')"))
    t = User(username="cu_t", email="cu_t@e.com", hashed_password="x", role="teacher", full_name="王老师",
             is_active=True, org_id=1)
    s = User(username="cu_s", email="cu_s@e.com", hashed_password="x", role="student", full_name="小明",
             is_active=True, org_id=1)
    db_session.add_all([t, s])
    await db_session.flush()
    c = Class(name="试点班", teacher_id=t.id, org_id=1)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=s.id, is_active=True))
    b3, u3 = await _book(db_session, "人教版三年级上册", "三年级", "上册", prefix="aa")
    b4, u4 = await _book(db_session, "人教版四年级上册", "四年级", "上册", prefix="bb")
    for b in (b3, b4):
        db_session.add(BookAssignment(student_id=s.id, book_id=b.id, scope_type="book", teacher_id=t.id))
    db_session.add(LearningProgress(user_id=s.id, book_id=b4.id, unit_id=u4[1].id, learning_mode="classify",
                                    current_word_index=0))
    db_session.add(AutopilotClass(class_id=c.id, org_id=1, mode="auto", default_location="classroom"))
    await db_session.commit()

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False
    monkeypatch.setattr(ap, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(ap, "INLINE", True)
    ap._groups_cache.clear()
    return {"t": t, "s": s, "c": c, "b3": b3, "u3": u3, "b4": b4, "u4": u4}


async def _sync(db, env, on=True):
    db.add(AutopilotClassSync(class_id=env["c"].id, org_id=1, enabled=on))
    await db.commit()


async def _teacher_hw(client, env, unit):
    r = await client.post("/api/v1/teacher/homework", json={
        "title": "老师的", "unit_id": unit.id, "learning_mode": "flashcard", "student_ids": [env["s"].id]},
        headers=_h(env["t"].id))
    assert r.status_code == 200, r.text


async def _tasks(db, sid):
    return list((await db.execute(select(AutopilotTask).where(AutopilotTask.student_id == sid))).scalars())


@pytest.mark.asyncio
async def test_off_class_unchanged(client, db_session, env):
    await _teacher_hw(client, env, env["u4"][2])
    r = await client.post("/api/v1/student/checkin", headers=_h(env["s"].id))
    assert r.json()["autopilot"] == "skipped_manual"
    assert await _tasks(db_session, env["s"].id) == []
    assert ap.tiers_for(False)[0] == 20 and ap.tiers_for(True)[0] == 10


@pytest.mark.asyncio
async def test_teacher_day_only_small_gap_batch_not_counted(client, db_session, env):
    await _sync(db_session, env)
    db_session.add(CatchupGap(student_id=env["s"].id, unit_id=env["u3"][0].id, book_id=env["b3"].id))
    await db_session.commit()
    await _teacher_hw(client, env, env["u4"][2])
    r = await client.post("/api/v1/student/checkin", headers=_h(env["s"].id))
    assert r.json()["autopilot"] == "gap_only"
    tasks = await _tasks(db_session, env["s"].id)
    assert tasks and all(t.batch == catchup.GAP_BATCH for t in tasks)
    assert sum(t.words for t in tasks) <= catchup.GAP_ON_TEACHER_DAY
    assert all(t.unit_id == env["u3"][0].id for t in tasks), "只补摸底测出来的漏洞"
    # 不进金币分母: 只剩老师那一份
    from app.services import coin_service
    prog = await coin_service.task_progress_on_day(db_session, [env["s"].id], local_today())
    assert prog[env["s"].id][0] == 1, prog
    v = (await client.get("/api/v1/student/autopilot/today", headers=_h(env["s"].id))).json()
    assert v["gap_only"] and len(v["gap_items"]) == 1 and v["items"] == []


@pytest.mark.asyncio
async def test_diagnosis_walks_back_and_records(client, db_session, env):
    await _sync(db_session, env)
    s = env["s"]
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/catchup",
                          json={"student_ids": [s.id]}, headers=_h(env["t"].id))
    assert r.json()["requested"] == 1
    q = (await client.get("/api/v1/student/catchup", headers=_h(s.id))).json()
    assert q["status"] == "doing" and q["question"]["type"] == "choice"
    assert "Unit 2" in q["question"]["unit"] and "四年级" in q["question"]["unit"], "从现在学的单元开始"
    assert "answer" not in q["question"] and "right" not in q["question"], "答案不下发"

    from app.models.word import WordDefinition as WD
    async def right_choice(qq):
        m = (await db_session.execute(select(WD.meaning).where(WD.word_id == qq["word_id"]))).scalar()
        return qq["options"].index(catchup._short_meaning(m))

    async def spell(qq):
        return (await db_session.execute(select(Word.word).where(Word.id == qq["word_id"]))).scalar()

    seen_units = []
    for _ in range(80):
        qq = q.get("question")
        if q["status"] == "done" or not qq:
            break
        seen_units.append(qq["unit"])
        # 四年级的都会;三年级 Unit 3 不会(全按不认识),其余会
        weak = "三年级" in qq["unit"] and "Unit 3" in qq["unit"]
        body = {"word_id": qq["word_id"], "dont_know": weak}
        if not weak:
            body.update({"choice": await right_choice(qq)} if qq["type"] == "choice" else {"text": await spell(qq)})
        q = (await client.post("/api/v1/student/catchup/answer", json=body, headers=_h(s.id))).json()
    assert q["status"] == "done", q
    res = q["result"]
    assert res["gap_units"] == 1 and res["gaps"][0]["unit_id"] == env["u3"][2].id
    assert any("三年级" in u for u in seen_units), "往前测到前一册"
    # 会的单元记成学会,不再派新词;要补的进 catchup_gaps
    grad = (await db_session.execute(select(AutopilotGroup).where(
        AutopilotGroup.student_id == s.id, AutopilotGroup.unit_id == env["u4"][0].id))).scalars().all()
    assert grad and all(g.graduated_at is not None for g in grad)
    assert res["progress"]["units"] == 1 and res["progress"]["fixed_groups"] == 0


@pytest.mark.asyncio
async def test_stale_answer_rejected_and_guess_needs_spelling(client, db_session, env):
    await _sync(db_session, env)
    s = env["s"]
    await client.post(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/catchup",
                      json={"student_ids": [s.id]}, headers=_h(env["t"].id))
    q = (await client.get("/api/v1/student/catchup", headers=_h(s.id))).json()
    r = (await client.post("/api/v1/student/catchup/answer",
                           json={"word_id": q["question"]["word_id"] + 999, "choice": 0}, headers=_h(s.id))).json()
    assert r.get("stale"), "只认当前这一题"
    # 对 2 错 1 → 要再拼写 2 个才定
    from app.models.word import WordDefinition as WD
    for k in range(3):
        qq = q["question"]
        m = (await db_session.execute(select(WD.meaning).where(WD.word_id == qq["word_id"]))).scalar()
        right = qq["options"].index(catchup._short_meaning(m))
        q = (await client.post("/api/v1/student/catchup/answer",
                               json={"word_id": qq["word_id"], "choice": right if k < 2 else (right + 1) % 4},
                               headers=_h(s.id))).json()
    assert q["question"]["type"] == "spell" and "Unit 2" in q["question"]["unit"]


@pytest.mark.asyncio
async def test_gap_units_only_if_allowed(client, db_session, env):
    """测出缺三年级,但三年级的书没开: 补漏不派它"""
    await _sync(db_session, env)
    s = env["s"]
    # 三年级只开了 Unit 2(按单元分配),书本身孩子学过 —— 能学的书里有它,但 Unit 1 不在白名单
    await db_session.execute(sql_text("DELETE FROM book_assignments WHERE book_id=:b"), {"b": env["b3"].id})
    db_session.add(BookAssignment(student_id=s.id, book_id=env["b3"].id, scope_type="unit", unit_id=env["u3"][1].id,
                                  teacher_id=env["t"].id))
    db_session.add(CatchupGap(student_id=s.id, unit_id=env["u3"][0].id, book_id=env["b3"].id))
    await db_session.commit()
    st = await ap.student_row(db_session, s.id, 1)
    plan = await ap.build_plan(db_session, st, local_today(), 40, sync=await catchup.class_sync(db_session, env["c"].id))
    assert plan.status == "ok" and all(i.unit_id != env["u3"][0].id for i in plan.items)
    assert "人教版三年级上册" in await catchup.blocked_gap_books(db_session, s.id)
    assert plan.items, "能学的照样派"


@pytest.mark.asyncio
async def test_one_group_days_mostly_school(client, db_session, env):
    await _sync(db_session, env)
    s = env["s"]
    db_session.add(CatchupGap(student_id=s.id, unit_id=env["u3"][0].id, book_id=env["b3"].id))
    await db_session.commit()
    st = await ap.student_row(db_session, s.id, 1)
    sync = await catchup.class_sync(db_session, env["c"].id)
    base = local_today()
    gap_days = 0
    for i in range(10):
        d = base + timedelta(days=i)
        plan = await ap.build_plan(db_session, st, d, 10, sync=sync)
        assert plan.words <= 10 and len(plan.items) == 1
        gap_days += 1 if plan.items[0].unit_id == env["u3"][0].id else 0
    assert gap_days == 3, "十天里三天补漏"


@pytest.mark.asyncio
async def test_turning_on_starts_diagnosis_for_whole_class(client, db_session, env):
    """第一次打开不用老师再点: 全班每人一次摸底;已经做过的不重建"""
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/sync", json={"enabled": True},
                         headers=_h(env["t"].id))
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["requested"] == 1
    q = (await client.get("/api/v1/student/catchup", headers=_h(env["s"].id))).json()
    assert q["status"] == "doing"
    await client.put(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/sync", json={"enabled": False},
                     headers=_h(env["t"].id))
    r = await client.put(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/sync", json={"enabled": True},
                         headers=_h(env["t"].id))
    assert r.json()["requested"] == 0, "关了再开不重复建"


# ---------------------------------------------------------------- 书没开(文件头第 6 条)

@pytest.mark.asyncio
async def test_no_book_kid_listed_and_opened(client, db_session, env):
    """一本书都没开(只能学作业里的单元): 列出来、勾了开在学的那本;小鹰老师自己不开"""
    await _sync(db_session, env)
    s, t, c = env["s"], env["t"], env["c"]
    await db_session.execute(sql_text("DELETE FROM book_assignments WHERE student_id=:s"), {"s": s.id})
    await db_session.commit()
    await _teacher_hw(client, env, env["u4"][2])
    g = (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}/book-gaps", headers=_h(t.id))).json()
    assert [x["book_id"] for x in g["no_book"]] == [env["b4"].id] and g["no_book"][0]["locked"] is None
    from app.services.scope_service import get_allowed_unit_ids
    assert await get_allowed_unit_ids(db_session, s.id, env["b4"].id) is not None, "小鹰老师没自己开书"
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/open-books",
                          json={"items": [{"student_id": s.id, "book_id": env["b4"].id}]}, headers=_h(t.id))
    assert r.json()["created"] == 1
    assert await get_allowed_unit_ids(db_session, s.id, env["b4"].id) is None
    g = (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}/book-gaps", headers=_h(t.id))).json()
    assert g["no_book"] == []
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/open-books",
                          json={"items": [{"student_id": s.id, "book_id": env["b4"].id}]}, headers=_h(t.id))
    assert r.json()["created"] == 0 and r.json()["already"] == 1, "开过的不重复开"


@pytest.mark.asyncio
async def test_gap_in_unopened_book_is_blocked_not_counted(client, db_session, env):
    await _sync(db_session, env)
    s, t, c = env["s"], env["t"], env["c"]
    await db_session.execute(sql_text("DELETE FROM book_assignments WHERE book_id=:b"), {"b": env["b3"].id})
    db_session.add(CatchupGap(student_id=s.id, unit_id=env["u3"][0].id, book_id=env["b3"].id))
    await db_session.commit()
    p = await catchup.gap_progress(db_session, s.id)
    assert p["units"] == 0 and p["blocked_units"] == 1, "等开书的不算进补漏进度"
    g = (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}/book-gaps", headers=_h(t.id))).json()
    assert g["gap_books"][0]["books"][0]["book_id"] == env["b3"].id
    await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/open-books",
                      json={"items": [{"student_id": s.id, "book_id": env["b3"].id}]}, headers=_h(t.id))
    p = await catchup.gap_progress(db_session, s.id)
    assert p["units"] == 1 and p["blocked_units"] == 0


@pytest.mark.asyncio
async def test_pack_org_book_cannot_be_opened(client, db_session, env):
    """卡包机构的平台课本要兑卡: 列出原因,开书跳过"""
    await _sync(db_session, env)
    s, t, c = env["s"], env["t"], env["c"]
    await db_session.execute(sql_text("UPDATE organizations SET card_plan='pack' WHERE id=1"))
    await db_session.execute(sql_text("UPDATE word_books SET pack_tier='basic', org_id=NULL WHERE id=:b"), {"b": env["b3"].id})
    await db_session.execute(sql_text("DELETE FROM book_assignments WHERE book_id=:b"), {"b": env["b3"].id})
    db_session.add(CatchupGap(student_id=s.id, unit_id=env["u3"][0].id, book_id=env["b3"].id))
    await db_session.commit()
    tenancy._org_cache.clear()
    g = (await client.get(f"/api/v1/teacher/autopilot/classes/{c.id}/book-gaps", headers=_h(t.id))).json()
    assert g["gap_books"][0]["books"][0]["locked"]
    r = (await client.post(f"/api/v1/teacher/autopilot/classes/{c.id}/open-books",
                           json={"items": [{"student_id": s.id, "book_id": env["b3"].id}]}, headers=_h(t.id))).json()
    assert r["created"] == 0 and r["locked"], "卡包的书不能绕过兑换码"


@pytest.mark.asyncio
async def test_open_books_only_my_class(client, db_session, env):
    other = User(username="cu_o", email="cu_o@e.com", hashed_password="x", role="student", is_active=True, org_id=1)
    db_session.add(other)
    await db_session.commit()
    r = await client.post(f"/api/v1/teacher/autopilot/classes/{env['c'].id}/open-books",
                          json={"items": [{"student_id": other.id, "book_id": env["b3"].id}]}, headers=_h(env["t"].id))
    assert r.status_code == 403
