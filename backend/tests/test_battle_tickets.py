"""宠物对战场数(2026-11-11,规则真源 app/services/battle_tickets.py)

起因: 对战是孩子唯一主动玩的功能,但有作业的日子里约 290 场是作业没做完时打的,一个孩子一天最多 54 场。
这里锁住:
  1. 每天送的场数打完就拦,拦下时不建对战
  2. 今天做完的作业加场数;昨天做完的不算
  3. 今日复习做完加场数;布置成作业的「每日复习」不重复算
  4. 今天学的词按词数加场数
  5. 一天有上限
  6. 「打了几场」只数今天开打且至少打完一回合的
  7. 三个开打入口(打 AI / 发起 / 接受)都拦
  8. 总开关关掉 = 不限
  9. 设置只认给的选项,类型不对也拒(1 == True 的坑);只有平台管理员能改,改了进操作记录
"""
import json
from datetime import datetime, timedelta

from sqlalchemy import func, select

from app.core.timeutil import local_today, local_today_utc_range
from app.models.audit import OperationLog
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.daily_review import DailyReviewPlan
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.pet_battle import PetBattle
from app.models.system_config import SystemConfig
from app.models.user import User
from app.models.word import Unit, Word, WordBook, WordDefinition
from app.services import battle_tickets
from tests.test_pet_multitab_exploits import _battle, _h, _org, _student_with_pet

TICKETS = "/api/v1/student/battles/tickets"
SETTINGS = "/api/v1/student/battles/ticket-settings"
QUICK = "/api/v1/student/battle/quick-match"


def _new(uid):
    """新页面发的请求: 带 X-EH-Battle 头,报错给 {code, message};不带的是没刷新的老页面,只给一句话"""
    return {**_h(uid), "X-EH-Battle": "2"}


async def _words(db, n=6, prefix="tk"):
    out = []
    for i in range(n):
        w = Word(word=f"{prefix}word{i}")
        db.add(w)
        await db.flush()
        db.add(WordDefinition(word_id=w.id, meaning=f"义{prefix}{i}", is_primary=True))
        out.append(w)
    await db.commit()
    return out


async def _teacher_unit(db, tag):
    org = await _org(db)
    t = User(username=f"{tag}_t", email=f"{tag}_t@e.com", hashed_password="x", role="teacher",
             full_name="王老师", is_active=True, org_id=org.id)
    book = WordBook(name=f"{tag} 书", is_public=True)
    db.add_all([t, book])
    await db.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db.add(unit)
    await db.flush()
    return t, unit


async def _task(db, teacher, unit, stu, *, done_at=None):
    hw = HomeworkAssignment(title="任务", unit_id=unit.id, teacher_id=teacher.id, learning_mode="classify",
                            target_score=80, max_attempts=3, is_closed=False)
    db.add(hw)
    await db.flush()
    db.add(HomeworkStudentAssignment(
        homework_id=hw.id, student_id=stu.id, status="completed" if done_at else "pending",
        assigned_at=(done_at or datetime.utcnow()) - timedelta(minutes=30), completed_at=done_at,
    ))
    await db.commit()
    return hw


async def _played(db, a, pa, b, pb, *, started_at, rounds=1):
    bt = _battle(a, pa, b, pb, status="finished", started_at=started_at, current_round=rounds)
    db.add(bt)
    await db.commit()
    return bt


async def _set(db, **values):
    await battle_tickets.save_settings(db, {**await battle_tickets.get_settings(db), **values})
    await db.commit()


def _today():
    start, end = local_today_utc_range()
    return start + (end - start) / 2


# ---------- 1. 送的场数打完就拦 ----------

async def test_free_ticket_then_blocked_and_no_battle_created(client, db_session):
    a, pa = await _student_with_pet(db_session, "tka")
    await _words(db_session)

    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert (st["enabled"], st["earned"], st["used"], st["left"], st["cap"]) == (True, 1, 0, 1, 6)
    assert st["lines"] and any("一天最多打 6 场" in x for x in st["lines"])

    r = await client.post(QUICK, headers=_h(a.id))
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    # 进去了但一回合没打: 不算一场
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["left"] == 1
    bt = await db_session.get(PetBattle, bid)
    bt.current_round, bt.status = 3, "finished"
    await db_session.commit()
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["left"] == 0

    before = (await db_session.execute(select(func.count()).select_from(PetBattle))).scalar()
    r = await client.post(QUICK, headers=_new(a.id))
    assert r.status_code == 403, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "need_battle_ticket"
    assert "场数用完了" in detail["message"] and "每学 20 个词" in detail["message"]
    assert detail["tickets"]["left"] == 0
    after = (await db_session.execute(select(func.count()).select_from(PetBattle))).scalar()
    assert after == before, "被拦下时不该建对战"


# ---------- 2. 今天做完作业加场数,昨天的不算 ----------

async def test_task_done_today_adds_and_yesterday_does_not(client, db_session):
    a, _ = await _student_with_pet(db_session, "tkb")
    t, unit = await _teacher_unit(db_session, "tkb")
    start, _end = local_today_utc_range()
    await _task(db_session, t, unit, a, done_at=start - timedelta(hours=3))   # 昨天做完
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["earned"] == 1

    await _task(db_session, t, unit, a, done_at=_today())                     # 今天做完
    await _task(db_session, t, unit, a)                                       # 还没做
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert st["earned"] == 1 + 2
    task = next(s for s in st["sources"] if s["key"] == "task")
    assert task["got"] == 2 and task["more"] is True and task["route"] == "/student/homework"
    assert "还有 1 份没做完" in task["detail"]


# ---------- 3. 今日复习;布置成作业的每日复习不重复算 ----------

async def test_daily_review_adds_once_even_when_assigned_as_homework(client, db_session):
    a, _ = await _student_with_pet(db_session, "tkc")
    t, _unit = await _teacher_unit(db_session, "tkc")
    ws = await _words(db_session, 2, "rv")
    db_session.add(DailyReviewPlan(user_id=a.id, plan_date=local_today(),
                                   word_ids=json.dumps([w.id for w in ws]), backlog=2))
    db_session.add(LearningRecord(user_id=a.id, word_id=ws[0].id, learning_mode="review",
                                  is_correct=True, created_at=_today()))
    await db_session.commit()
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    review = next(s for s in st["sources"] if s["key"] == "review")
    assert st["earned"] == 1 and review["got"] == 0 and review["more"] is True
    assert review["detail"] == "做了 1 / 2 个" and review["route"] == "/student/memory-curve"

    db_session.add(LearningRecord(user_id=a.id, word_id=ws[1].id, learning_mode="review",
                                  is_correct=True, created_at=_today()))
    # 老师还把「每日复习」布置成了作业,并且已经记了完成
    hw = ContentHomework(kind="daily_review", target_id=0, title="每日复习", teacher_id=t.id,
                         available_from=local_today_utc_range()[0])
    db_session.add(hw)
    await db_session.flush()
    db_session.add(ContentHomeworkStudent(homework_id=hw.id, student_id=a.id, completed_at=_today()))
    await db_session.commit()

    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert st["earned"] == 1 + 2, "今日复习只给一次,不能再当成一份作业再给 2 场"
    assert next(s for s in st["sources"] if s["key"] == "task")["got"] == 0


async def test_no_review_words_today_gives_nothing(client, db_session):
    a, _ = await _student_with_pet(db_session, "tkd")
    db_session.add(DailyReviewPlan(user_id=a.id, plan_date=local_today(), word_ids="[]", backlog=0,
                                   completed_at=datetime.utcnow()))
    await db_session.commit()
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    review = next(s for s in st["sources"] if s["key"] == "review")
    assert st["earned"] == 1 and review["got"] == 0 and review["more"] is False


async def test_tickets_do_not_create_review_plan(client, db_session):
    a, _ = await _student_with_pet(db_session, "tke")
    await client.get(TICKETS, headers=_h(a.id))
    n = (await db_session.execute(select(func.count()).select_from(DailyReviewPlan))).scalar()
    assert n == 0, "查场数不该替孩子把今天的复习词定下来"


# ---------- 4. 今天学的词 ----------

async def test_words_learned_today_add_tickets(client, db_session):
    a, _ = await _student_with_pet(db_session, "tkf")
    ws = await _words(db_session, 45, "lw")
    start, _end = local_today_utc_range()
    for w in ws[:41]:
        db_session.add(LearningRecord(user_id=a.id, word_id=w.id, learning_mode="spelling",
                                      is_correct=True, created_at=_today()))
    for w in ws[41:]:   # 昨天学的不算
        db_session.add(LearningRecord(user_id=a.id, word_id=w.id, learning_mode="spelling",
                                      is_correct=True, created_at=start - timedelta(hours=2)))
    await db_session.commit()
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    words = next(s for s in st["sources"] if s["key"] == "words")
    assert words["got"] == 2 and st["earned"] == 1 + 2
    assert words["detail"] == "今天学了 41 个词,再学 19 个加 1 场"

    await _set(db_session, words_step=0)
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert st["earned"] == 1 and not any(s["key"] == "words" for s in st["sources"])


# ---------- 5. 一天有上限 ----------

async def test_daily_cap(client, db_session):
    a, pa = await _student_with_pet(db_session, "tkg")
    b, pb = await _student_with_pet(db_session, "tkh")
    t, unit = await _teacher_unit(db_session, "tkg")
    for _ in range(4):
        await _task(db_session, t, unit, a, done_at=_today())
    await _task(db_session, t, unit, a)   # 还有一份没做: 到了上限就不该再引导去做
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert st["earned"] == 6 and st["capped"] is True, "1 + 4×2 = 9,封顶 6"
    assert all(s["more"] is False and s["route"] is None for s in st["sources"])

    for _ in range(6):
        await _played(db_session, a, pa, b, pb, started_at=_today())
    await _words(db_session)
    r = await client.post(QUICK, headers=_new(a.id))
    assert r.status_code == 403
    assert r.json()["detail"]["message"] == "今天的 6 场对战都打完了,明天再来。"
    # 没刷新的老页面(不带 X-EH-Battle 头)把 detail 直接当一句话显示: 给它的必须是字符串,不能是对象
    r = await client.post(QUICK, headers=_h(a.id))
    assert r.status_code == 403 and r.json()["detail"] == "今天的 6 场对战都打完了,明天再来。", r.text


# ---------- 6. 打了几场: 只数今天开打、至少打完一回合的 ----------

async def test_used_counts_only_today_and_played(client, db_session):
    a, pa = await _student_with_pet(db_session, "tki")
    b, pb = await _student_with_pet(db_session, "tkj")
    start, _end = local_today_utc_range()
    await _played(db_session, a, pa, b, pb, started_at=start - timedelta(hours=1))      # 昨天打的
    await _played(db_session, a, pa, b, pb, started_at=_today(), rounds=0)             # 今天进去没打
    db_session.add(_battle(a, pa, b, pb, status="pending", current_round=0))            # 没接受的邀请
    await db_session.commit()
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["used"] == 0

    await _played(db_session, b, pb, a, pa, started_at=_today())                        # 今天当玩家 2 打了一场
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["used"] == 1
    assert (await client.get(TICKETS, headers=_h(b.id))).json()["used"] == 1


# ---------- 7. 三个入口都拦 ----------

async def test_create_and_accept_are_gated(client, db_session):
    a, pa = await _student_with_pet(db_session, "tkk")
    b, pb = await _student_with_pet(db_session, "tkl")
    c, pc = await _student_with_pet(db_session, "tkm")
    await _words(db_session)
    # a、b 今天各用掉了送的那一场
    await _played(db_session, a, pa, b, pb, started_at=_today())

    before = (await db_session.execute(select(func.count()).select_from(PetBattle))).scalar()
    r = await client.post("/api/v1/student/battle/create", headers=_new(a.id),
                          json={"opponent_id": c.id, "mode": "normal", "max_rounds": 5})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "need_battle_ticket", r.text
    # 老页面发起挑战: 同一句话,是字符串
    r = await client.post("/api/v1/student/battle/create", headers=_h(a.id),
                          json={"opponent_id": c.id, "mode": "normal", "max_rounds": 5})
    assert r.status_code == 403 and isinstance(r.json()["detail"], str) and "场" in r.json()["detail"], r.text
    assert (await db_session.execute(select(func.count()).select_from(PetBattle))).scalar() == before

    # c 还有场数,发给 b;b 没场数,接不了,邀请还在
    r = await client.post("/api/v1/student/battle/create", headers=_h(c.id),
                          json={"opponent_id": b.id, "mode": "normal", "max_rounds": 5})
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    r = await client.post(f"/api/v1/student/battle/{bid}/accept", headers=_new(b.id))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "need_battle_ticket", r.text
    # 老页面接受挑战: 字符串
    r = await client.post(f"/api/v1/student/battle/{bid}/accept", headers=_h(b.id))
    assert r.status_code == 403 and isinstance(r.json()["detail"], str), r.text
    bt = await db_session.get(PetBattle, bid)
    await db_session.refresh(bt)
    assert bt.status == "pending" and bt.started_at is None


# ---------- 8. 总开关 ----------

async def test_disabled_means_unlimited(client, db_session):
    a, pa = await _student_with_pet(db_session, "tkn")
    b, pb = await _student_with_pet(db_session, "tko")
    await _words(db_session)
    for _ in range(9):
        await _played(db_session, a, pa, b, pb, started_at=_today())
    assert (await client.post(QUICK, headers=_h(a.id))).status_code == 403

    await _set(db_session, enabled=False)
    st = (await client.get(TICKETS, headers=_h(a.id))).json()
    assert st["enabled"] is False and st["left"] is None and st["lines"] == ["现在对战不限场数。"]
    assert (await client.post(QUICK, headers=_h(a.id))).status_code == 200


# ---------- 9. 设置 ----------

def test_check_options_rejects_unknown_wrong_value_and_wrong_type():
    ok = battle_tickets.check_options({"enabled": False, "daily_cap": 8, "free_per_day": 0})
    assert ok == {"enabled": False, "daily_cap": 8, "free_per_day": 0}
    for bad in ({"nope": 1}, {"daily_cap": 7}, {"daily_cap": "6"},
                {"free_per_day": True},     # True == 1,不判类型会被当成 1 场
                {"enabled": 1},             # 1 == True,不判类型会被当成开
                {"per_review": False}):     # False == 0
        try:
            battle_tickets.check_options(bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad} 应该被拒")


async def test_saved_garbage_falls_back_to_defaults(db_session):
    db_session.add(SystemConfig(config_key=battle_tickets.SETTINGS_KEY, config_type="json",
                                config_value=json.dumps({"daily_cap": 99, "enabled": 1, "per_task": 3, "x": 1})))
    await db_session.commit()
    s = await battle_tickets.get_settings(db_session)
    assert s == {**battle_tickets.OPTION_DEFAULTS, "per_task": 3}


async def test_only_admin_changes_settings_and_it_is_logged(client, db_session):
    a, _ = await _student_with_pet(db_session, "tkp")
    t, _unit = await _teacher_unit(db_session, "tkp")
    admin = User(username="tkadmin", email="tkadmin@e.com", hashed_password="x", role="admin", is_active=True)
    db_session.add(admin)
    await db_session.commit()

    for who in (a, t):
        assert (await client.get(SETTINGS, headers=_h(who.id))).status_code == 403
        assert (await client.put(SETTINGS, headers=_h(who.id), json={"daily_cap": 10})).status_code == 403

    view = (await client.get(SETTINGS, headers=_h(admin.id))).json()
    assert [o["key"] for o in view["options"]] == list(battle_tickets.OPTION_DEFAULTS)
    assert all(o["effect"] and o["risk"] for o in view["options"]), "每一条都要写清会怎样和风险"
    assert view["values"] == battle_tickets.OPTION_DEFAULTS

    r = await client.put(SETTINGS, headers=_h(admin.id), json={"daily_cap": 7})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_option"
    r = await client.put(SETTINGS, headers=_h(admin.id), json={"free_per_day": True})
    assert r.status_code == 400

    r = await client.put(SETTINGS, headers=_h(admin.id), json={"daily_cap": 10, "per_task": 3})
    assert r.status_code == 200, r.text
    assert r.json()["values"]["daily_cap"] == 10 and r.json()["values"]["free_per_day"] == 1
    row = (await db_session.execute(
        select(SystemConfig).where(SystemConfig.config_key == battle_tickets.SETTINGS_KEY))).scalar_one()
    await db_session.refresh(row)
    assert json.loads(row.config_value) == {"daily_cap": 10, "per_task": 3}, "只存和默认不一样的"
    log = (await db_session.execute(
        select(OperationLog).where(OperationLog.action == "pet.battle_tickets"))).scalars().all()
    assert len(log) == 1 and "一天最多打几场 6 → 10" in log[0].summary

    # 只改一项,别的不动;恢复默认
    r = await client.put(SETTINGS, headers=_h(admin.id), json={"per_review": 0})
    assert r.json()["values"]["daily_cap"] == 10 and r.json()["values"]["per_review"] == 0
    r = await client.put(SETTINGS, headers=_h(admin.id), json={"reset": True})
    assert r.json()["values"] == battle_tickets.OPTION_DEFAULTS
    assert (await client.get(TICKETS, headers=_h(a.id))).json()["cap"] == 6
