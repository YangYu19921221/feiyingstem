"""全班打大怪(2026-11-12,规则真源 app/services/class_boss.py)

起因: 对战、闯关都是一个人的事;大怪是全班一起的目标,而且伤害只来自把该做的做完 —— 不来自打对战。
这里锁住:
  1. 三种来源各算各的(做完一份任务 10、今日复习做完 10、每学 20 个词 5);布置成作业的「每日复习」不当任务再算一遍;
     每人每天最多 30 点
  2. 这一周以外的不算(上周日 / 下周一);打对战不加伤害
  3. 不到 3 个人的班不出大怪(离开班的不算人数);没进班的孩子没有大怪
  4. 孩子在几个班: 算人数最多的那个(并列取 id 小的);大怪按 (班, 周) 定死、不出传说、显示最终形态
  5. 打死才能领;没出过力不能领;只能领一次(连着领两次第二次 409);没宠物只给粮食
  6. 两个页面同时点领奖: 只有一次成功、只发一份
  7. 上一周的奖励这一周前 3 天能领,第 4 天起不能
  8. 别的班的进度看不到;排行只列出过力的、最多 3 个
  9. 全班的数缓存 60 秒,我自己的那一份每次现算
 10. 平台开关;接口字段;路由排在 /battle/{battle_id} 前面;领奖表的模型在 models/__init__ 导入
 11. 「还能怎么再拿」那一句: 没做完的作业 / 复习做到第几个 / 再学几个词;今天拿满了就不说了;
     作业那一项今天没布置写「今天没有布置作业」、有没做完的写「今天还有 N 份没做完」、做完了没别的可做给 null
 12. 大怪的血按「在学的人」算: 久不来的(14 天以上没学)不进血量;这一周回来的进;在班 ≥ 3 但在学 < 3 时按 3 人算;
     只有切屏 / 发呆记录的空日历不算学过;出了力的人一定算在学;上一周的血量按上一周在学的人算;
     students = 在学的人数、enrolled = 在班人数
"""
import asyncio
import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.pet_species import LEGENDARY_SPECIES
from app.core.shared_store import reset_memory, store
from app.core.timeutil import local_day_utc_range, local_today
from app.models.class_boss import ClassBossClaim
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.daily_review import DailyReviewPlan
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.pet import UserPet
from app.models.user import Class, ClassStudent, StudyCalendar, User
from app.models.word import Unit, Word, WordBook, WordDefinition
from app.services import battle_tickets, class_boss
from app.services.ai_opponent_service import AI_PET_SPECIES
from tests.test_pet_multitab_exploits import _battle, _h, _org, _student_with_pet, file_db  # noqa: F401

BOSS = "/api/v1/student/battle/class-boss"
CLAIM = "/api/v1/student/battle/class-boss/claim"

MON, SUN = class_boss.week_of(date(2026, 11, 11))
TUE, WED, THU = MON + timedelta(days=1), MON + timedelta(days=2), MON + timedelta(days=3)


def _at(d: date, hour: float = 12) -> datetime:
    """北京日 d 的第 hour 个小时(库里存的 UTC)"""
    return local_day_utc_range(d)[0] + timedelta(hours=hour)


async def _studied(db, stu, day, *, empty=False):
    """day 那天的学习日历上有他(empty = 只有切屏 / 发呆记录的空行: 不算学过)"""
    db.add(StudyCalendar(user_id=stu.id, study_date=day, words_learned=0 if empty else 5,
                         duration=0 if empty else 300, switch_count=1 if empty else 0))
    await db.commit()


async def _kit(db, tag, students, *, studied=True):
    """一个老师、一个班(把 students 放进去)、一个单词单元。
    studied: 班里每个人上周五都学过(= 都算「在学」,血量就是 人数 × 60);要测久不来的孩子传 False 自己摆"""
    org = await _org(db)
    t = User(username=f"{tag}_t", email=f"{tag}_t@e.com", hashed_password="x", role="teacher",
             full_name="王老师", is_active=True, org_id=org.id)
    book = WordBook(name=f"{tag} 书", is_public=True)
    db.add_all([t, book])
    await db.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    cls = Class(name=f"{tag} 班", teacher_id=t.id, org_id=org.id)
    db.add_all([unit, cls])
    await db.flush()
    for s in students:
        db.add(ClassStudent(class_id=cls.id, student_id=s.id, is_active=True))
        if studied:
            for monday in (MON, class_boss.week_of(local_today())[0]):      # 有的用例看的是真的今天那一周
                day = monday - timedelta(days=3)
                seen = (await db.execute(select(StudyCalendar.id).where(
                    StudyCalendar.user_id == s.id, StudyCalendar.study_date == day))).scalar()
                if seen is None:
                    db.add(StudyCalendar(user_id=s.id, study_date=day, words_learned=5, duration=300))
                    await db.flush()
    await db.commit()
    return t, unit, cls


async def _students(db, tag, n):
    out = []
    for i in range(n):
        u, p = await _student_with_pet(db, f"{tag}{i}")
        out.append((u, p))
    await db.commit()
    return out


async def _tasks(db, teacher, unit, stu, day, n=1, *, done=True):
    """day 那天做完 n 份单词作业(done=False: 布置了还没做)"""
    for _ in range(n):
        hw = HomeworkAssignment(title="任务", unit_id=unit.id, teacher_id=teacher.id, learning_mode="classify",
                                target_score=80, max_attempts=3, is_closed=False)
        db.add(hw)
        await db.flush()
        db.add(HomeworkStudentAssignment(
            homework_id=hw.id, student_id=stu.id, status="completed" if done else "pending",
            assigned_at=_at(day, 8), completed_at=_at(day) if done else None,
        ))
    await db.commit()


_WORD_SEQ = {"n": 0}


async def _new_words(db, n):
    out = []
    for _ in range(n):
        _WORD_SEQ["n"] += 1
        w = Word(word=f"bossword{_WORD_SEQ['n']}")
        db.add(w)
        await db.flush()
        db.add(WordDefinition(word_id=w.id, meaning=f"义{_WORD_SEQ['n']}", is_primary=True))
        out.append(w)
    return out


async def _learn(db, stu, day, n):
    """day 那天学了 n 个不同的词"""
    for w in await _new_words(db, n):
        db.add(LearningRecord(user_id=stu.id, word_id=w.id, learning_mode="spelling", is_correct=True,
                              created_at=_at(day)))
    await db.commit()


async def _review(db, stu, day, *, total=2, done=None):
    """day 那天的今日复习: 一共 total 个词,做了 done 个(默认全做完)"""
    ws = await _new_words(db, total)
    db.add(DailyReviewPlan(user_id=stu.id, plan_date=day, word_ids=json.dumps([w.id for w in ws]), backlog=total))
    for w in ws[:total if done is None else done]:
        db.add(LearningRecord(user_id=stu.id, word_id=w.id, learning_mode="review", is_correct=True,
                              created_at=_at(day, 13)))
    await db.commit()


async def _content_done(db, teacher, stu, day, kind="sentence"):
    hw = ContentHomework(kind=kind, target_id=0, title="内容作业", teacher_id=teacher.id,
                         available_from=local_day_utc_range(day)[0])
    db.add(hw)
    await db.flush()
    db.add(ContentHomeworkStudent(homework_id=hw.id, student_id=stu.id, completed_at=_at(day, 15)))
    await db.commit()


async def _full_days(db, teacher, unit, stu, days):
    """这几天每天打满 30 点(3 份作业)"""
    for d in days:
        await _tasks(db, teacher, unit, stu, d, 3)


async def _view(db, user, today=WED):
    reset_memory()          # 这些用例看的是算得对不对,不是缓存(缓存另有一个用例)
    return await class_boss.overview(db, user, today)


# ---------- 0. 数字 ----------

def test_numbers_are_what_the_rules_say():
    assert (class_boss.HP_PER_STUDENT, class_boss.MIN_STUDENTS) == (60, 3)
    assert (class_boss.HP_MIN_HEADS, class_boss.ACTIVE_DAYS) == (3, 14)
    assert [class_boss.hp_for(n) for n in (0, 1, 3, 4, 86)] == [180, 180, 180, 240, 5160]
    assert (class_boss.TASK_POINTS, class_boss.REVIEW_POINTS, class_boss.WORDS_STEP, class_boss.WORDS_POINTS) == (10, 10, 20, 5)
    assert (class_boss.DAY_CAP, class_boss.JOIN_MIN, class_boss.REWARD_FOOD, class_boss.REWARD_XP) == (30, 10, 40, 60)
    assert (class_boss.LATE_CLAIM_DAYS, class_boss.CACHE_SECONDS, class_boss.TOP_N, class_boss.BOSS_STAGE) == (3, 60, 3, 3)
    assert MON.weekday() == 0 and SUN == MON + timedelta(days=6)
    assert class_boss.week_of(SUN) == (MON, SUN) and class_boss.week_of(SUN + timedelta(days=1))[0] == MON + timedelta(days=7)
    # 一天的点数: 三种加起来,最多 30
    assert class_boss.day_total({"tasks": 1, "review": True, "words": 45}) == 30
    assert class_boss.day_total({"tasks": 0, "review": False, "words": 39}) == 5
    assert class_boss.day_total({"tasks": 9, "review": True, "words": 400}) == 30
    assert class_boss.day_total(None) == 0


# ---------- 1. 三种来源、每天封顶 ----------

async def test_three_sources_each_count_and_a_day_is_capped(db_session):
    (a, _), (b, _), (c, _) = await _students(db_session, "cba", 3)
    t, unit, _cls = await _kit(db_session, "cba", [a, b, c])

    # 周一: 做完一份单词作业 → 10
    await _tasks(db_session, t, unit, a, MON, 1)
    # 周二: 一份句子作业 10 + 今日复习做完 10 + 学了 45 个词(2 × 5 = 10)→ 30
    await _content_done(db_session, t, a, TUE)
    await _review(db_session, a, TUE)
    await _learn(db_session, a, TUE, 43)        # 加上复习的 2 个词 = 45
    # 周三(今天): 两份作业 20 + 今日复习 10 + 学了 20 个词 5 = 35 → 封顶 30
    await _tasks(db_session, t, unit, a, WED, 2)
    await _review(db_session, a, WED)
    await _learn(db_session, a, WED, 18)
    # 布置成作业的「每日复习」记了完成: 不当成一份任务再算 10 点
    await _content_done(db_session, t, a, MON, kind="daily_review")

    v = await _view(db_session, a)
    assert (v["enabled"], v["has_class"], v["class_name"], v["students"], v["enrolled"]) == (True, True, "cba 班", 3, 3)
    assert (v["week_start"], v["week_end"]) == (MON.isoformat(), SUN.isoformat())
    assert v["mine"]["total"] == 10 + 30 + 30
    assert (v["mine"]["today"], v["mine"]["today_cap"]) == (30, 30)
    items = {i["key"]: i for i in v["mine"]["items"]}
    assert [i["key"] for i in v["mine"]["items"]] == ["task", "review", "words"]
    assert (items["task"]["points"], items["review"]["points"], items["words"]["points"]) == (20, 10, 5)
    assert (items["task"]["label"], items["review"]["label"], items["words"]["label"]) == (
        "做完一份作业 +10", "做完今日复习 +10", "每学 20 个词 +5")
    assert all(i["how"] is None and i["route"] is None for i in v["mine"]["items"]), "今天拿满了,不用再说怎么拿"
    assert (v["hp_max"], v["hp_left"], v["defeated"], v["joined"]) == (180, 110, False, 1)
    assert v["top"] == [{"name": "cba0", "points": 70}]
    assert v["reward"] == {"food": 40, "xp": 60, "can_claim": False, "claimed": False}

    # 一天一天看
    days = (await class_boss.days_of(db_session, [a.id], MON, SUN))[a.id]
    assert days[MON.isoformat()] == {"tasks": 1, "review": False, "words": 0}
    assert days[TUE.isoformat()] == {"tasks": 1, "review": True, "words": 45}
    assert days[WED.isoformat()] == {"tasks": 2, "review": True, "words": 20}

    # 今日复习只做了一半 / 那天没有要复习的词: 都没有那 10 点
    await _review(db_session, b, WED, total=4, done=3)
    db_session.add(DailyReviewPlan(user_id=c.id, plan_date=WED, word_ids="[]", backlog=0, completed_at=_at(WED)))
    await db_session.commit()
    assert (await _view(db_session, b))["mine"]["total"] == 0
    assert (await _view(db_session, c))["mine"]["total"] == 0


# ---------- 2. 这一周以外的不算;打对战不加 ----------

async def test_other_weeks_do_not_count_and_battles_add_nothing(db_session):
    (a, pa), (b, pb), (c, _) = await _students(db_session, "cbb", 3)
    t, unit, _cls = await _kit(db_session, "cbb", [a, b, c])

    await _tasks(db_session, t, unit, a, MON - timedelta(days=1), 2)      # 上周日
    await _tasks(db_session, t, unit, a, SUN + timedelta(days=1), 2)      # 下周一
    await _learn(db_session, a, MON - timedelta(days=1), 40)
    assert (await _view(db_session, a))["mine"]["total"] == 0

    # 周界按北京时间: 周一 0:30 算这一周,上周日 23:30 不算
    for when in (local_day_utc_range(MON)[0] + timedelta(minutes=30), local_day_utc_range(MON)[0] - timedelta(minutes=30)):
        hw = HomeworkAssignment(title="任务", unit_id=unit.id, teacher_id=t.id, learning_mode="classify",
                                target_score=80, max_attempts=3, is_closed=False)
        db_session.add(hw)
        await db_session.flush()
        db_session.add(HomeworkStudentAssignment(homework_id=hw.id, student_id=a.id, status="completed",
                                                 assigned_at=when, completed_at=when))
    await db_session.commit()
    v = await _view(db_session, a)
    assert v["mine"]["total"] == 10 and v["mine"]["today"] == 0

    # 没达标结束的作业(failed),就算带着完成时刻也不算做完 —— 和对战场数「今天做完的作业」同一个判据
    hw = HomeworkAssignment(title="任务", unit_id=unit.id, teacher_id=t.id, learning_mode="classify",
                            target_score=80, max_attempts=3, is_closed=False)
    db_session.add(hw)
    await db_session.flush()
    db_session.add(HomeworkStudentAssignment(homework_id=hw.id, student_id=a.id, status="failed",
                                             assigned_at=_at(TUE, 8), completed_at=_at(TUE)))
    await db_session.commit()
    assert (await _view(db_session, a))["mine"]["total"] == 10
    start, end = local_day_utc_range(TUE)
    assert await battle_tickets._tasks_done_today(db_session, a.id, start, end) == 0

    # 今天打了一场对战(打满 5 回合、赢了): 大怪一点血不掉
    bt = _battle(a, pa, b, pb, status="finished", started_at=_at(WED), current_round=5)
    bt.player1_total_correct, bt.winner_id = 5, a.id
    db_session.add(bt)
    await db_session.commit()
    v = await _view(db_session, a)
    assert (v["mine"]["total"], v["hp_left"]) == (10, 170)


# ---------- 3. 不到 3 个人 / 没进班 ----------

async def test_small_class_has_no_boss_and_a_child_without_class_has_none(client, db_session):
    (a, _), (b, _), (gone, _), (loner, _) = await _students(db_session, "cbc", 4)
    t, unit, cls = await _kit(db_session, "cbc", [a, b])
    db_session.add(ClassStudent(class_id=cls.id, student_id=gone.id, is_active=False))     # 离开班的不算人数
    await db_session.commit()
    await _tasks(db_session, t, unit, a, WED, 3)

    v = await _view(db_session, a)
    assert v["has_class"] is True and v["boss"] is None and (v["students"], v["enrolled"]) == (2, 2)
    assert "不到 3 个同学" in v["reason"]
    assert (v["hp_max"], v["hp_left"], v["defeated"], v["joined"], v["top"], v["last_week"]) == (0, 0, False, 0, [], None)
    assert v["reward"]["can_claim"] is False and v["mine"] == {"total": 0, "today": 0, "today_cap": 30, "items": []}
    with pytest.raises(HTTPException) as e:
        await class_boss.claim(db_session, a, "this", WED)
    assert e.value.status_code == 409 and e.value.detail["code"] == "boss_none"

    assert await _view(db_session, loner) == {"enabled": True, "has_class": False}
    assert await _view(db_session, gone) == {"enabled": True, "has_class": False}
    r = await client.get(BOSS, headers=_h(loner.id))
    assert r.status_code == 200 and r.json() == {"enabled": True, "has_class": False}


# ---------- 4. 算哪个班、大怪长什么样 ----------

async def test_biggest_class_counts_and_the_boss_is_fixed_per_class_and_week(db_session):
    studs = [u for u, _ in await _students(db_session, "cbd", 6)]
    a = studs[0]
    _t1, _u1, small = await _kit(db_session, "cbd小", studs[:3])
    _t2, _u2, big = await _kit(db_session, "cbd大", [a] + studs[2:6])
    assert (await _view(db_session, a))["class_name"] == "cbd大 班"
    assert (await _view(db_session, studs[1]))["class_name"] == "cbd小 班"
    # 人数一样多: 取 id 小的那个班
    _t3, _u3, tie = await _kit(db_session, "cbd并列", [a] + studs[1:5])
    assert big.id < tie.id and (await _view(db_session, a))["class_name"] == "cbd大 班"

    boss = (await _view(db_session, a))["boss"]
    assert boss == class_boss.boss_for(big.id, MON) == class_boss.boss_for(big.id, MON)
    assert boss["species"] in AI_PET_SPECIES and boss["species"] not in LEGENDARY_SPECIES
    assert boss["evolution_stage"] == 3 and boss["name"].startswith("本周大怪 · ") and "家族" not in boss["name"]
    # 换一个班 / 换一周会换(不是所有班永远同一只)
    seen = {class_boss.boss_for(cid, MON + timedelta(days=7 * w))["species"] for cid in range(1, 8) for w in range(8)}
    assert len(seen) > 5


# ---------- 5. 领奖 ----------

async def test_claim_needs_a_dead_boss_and_my_part_and_pays_once(client, db_session):
    (a, pa), (b, _), (c, _) = await _students(db_session, "cbe", 3)
    org = await _org(db_session)
    petless = User(username="cbe_petless", email="cbe_petless@e.com", hashed_password="x", role="student",
                   full_name="没宠物", is_active=True, org_id=org.id)
    db_session.add(petless)
    await db_session.flush()
    second = UserPet(user_id=a.id, name="二号", species="sparkhog", level=3, evolution_stage=0, current_hp=100,
                     is_active=False, food_balance=10)
    db_session.add(second)
    t, unit, cls = await _kit(db_session, "cbe", [a, b, c, petless])          # 4 个人: 240 点血
    pa.food_balance, pa.experience = 10, 0
    await db_session.commit()

    await _full_days(db_session, t, unit, a, [MON, TUE, WED])                  # 90
    await _full_days(db_session, t, unit, b, [MON, TUE])                       # 60
    await _full_days(db_session, t, unit, petless, [MON, TUE])                 # 60 → 一共 210,还差 30

    async def claim(user, which="this", today=WED):
        reset_memory()
        try:
            return await class_boss.claim(db_session, user, which, today)
        except HTTPException as e:
            return e.status_code, e.detail["code"]

    assert (await _view(db_session, a))["reward"]["can_claim"] is False
    assert await claim(a) == (409, "boss_alive")
    assert (await db_session.execute(select(func.count()).select_from(ClassBossClaim))).scalar() == 0

    await _full_days(db_session, t, unit, b, [WED])                            # 240: 打死了
    v = await _view(db_session, a)
    assert (v["hp_left"], v["defeated"], v["joined"]) == (0, True, 3)
    assert v["reward"] == {"food": 40, "xp": 60, "can_claim": True, "claimed": False}
    # 没出过力的: 大怪死了也领不了
    assert (await _view(db_session, c))["reward"]["can_claim"] is False
    assert await claim(c) == (409, "boss_no_part")

    got = await claim(a)
    assert got == {"food": 40, "xp": 60, "leveled_up": got["leveled_up"]} and isinstance(got["leveled_up"], bool)
    await db_session.refresh(pa)
    await db_session.refresh(second)
    assert pa.food_balance == 50 and second.food_balance == 50, "粮食是他所有宠物共用的一个数"
    assert (pa.level, pa.experience) != (5, 0), "经验加在出战的那只上"
    assert second.experience in (0, None) and second.level == 3
    level, exp = pa.level, pa.experience
    # 再领: 409,什么都不再加
    assert await claim(a) == (409, "boss_claimed")
    await db_session.refresh(pa)
    assert (pa.food_balance, pa.level, pa.experience) == (50, level, exp)
    v = await _view(db_session, a)
    assert v["reward"]["claimed"] is True and v["reward"]["can_claim"] is False
    rows = (await db_session.execute(select(ClassBossClaim))).scalars().all()
    assert [(r.class_id, r.week_start, r.user_id) for r in rows] == [(cls.id, MON.isoformat(), a.id)]

    # 没宠物的: 只给粮食,记在账号上(领养时带上)
    assert await claim(petless) == {"food": 40, "xp": 0, "leveled_up": False}
    await db_session.refresh(petless)
    assert petless.pet_food_reserve == 10 + 40
    assert await claim(petless) == (409, "boss_claimed")

    # 同一周换了班(在别的班领过): 也算领过
    (d, _), (e, _) = await _students(db_session, "cbe2", 2)
    t2, unit2, other = await _kit(db_session, "cbe另", [b, d, e])
    for row in (await db_session.execute(select(ClassStudent).where(ClassStudent.student_id == b.id,
                                                                    ClassStudent.class_id == cls.id))).scalars():
        row.is_active = False
    await db_session.commit()
    assert (await _view(db_session, b))["class_name"] == "cbe另 班"
    db_session.add(ClassBossClaim(class_id=cls.id, week_start=MON.isoformat(), user_id=b.id, claimed_at=_at(WED)))
    await db_session.commit()
    await _full_days(db_session, t2, unit2, d, [MON, TUE, WED])
    assert (await _view(db_session, b))["defeated"] is True                   # b 90 + d 90 = 180
    assert (await _view(db_session, b))["reward"] == {"food": 40, "xp": 60, "can_claim": False, "claimed": True}
    assert await claim(b) == (409, "boss_claimed")
    assert (await db_session.execute(select(func.count()).select_from(ClassBossClaim).where(
        ClassBossClaim.user_id == b.id))).scalar() == 1

    # HTTP: 领不了给 409 {code, message};week 只认 this / last
    r = await client.post(CLAIM, headers=_h(c.id))
    assert r.status_code == 409 and set(r.json()["detail"]) == {"code", "message"}
    assert (await client.post(f"{CLAIM}?week=next", headers=_h(c.id))).status_code == 422


# ---------- 6. 两个页面同时点领奖 ----------

async def test_two_claims_at_once_pay_once(file_db):  # noqa: F811
    Session = file_db
    async with Session() as db:
        (a, pa), (b, _), (c, _) = await _students(db, "cbf", 3)
        t, unit, cls = await _kit(db, "cbf", [a, b, c])
        pa.food_balance = 10
        await db.commit()
        await _full_days(db, t, unit, a, [MON, TUE, WED])
        await _full_days(db, t, unit, b, [MON, TUE, WED])
        a_id, pet_id = a.id, pa.id

    async def one():
        async with Session() as db:
            user = await db.get(User, a_id)
            try:
                return await class_boss.claim(db, user, "this", WED)
            except HTTPException as e:
                return e.detail["code"]

    results = await asyncio.gather(one(), one(), one())
    paid = [r for r in results if isinstance(r, dict)]
    assert len(paid) == 1 and sorted(r for r in results if isinstance(r, str)) == ["boss_claimed", "boss_claimed"], results
    async with Session() as db:
        pet = await db.get(UserPet, pet_id)
        assert pet.food_balance == 50, "只发一份"
        assert (await db.execute(select(func.count()).select_from(ClassBossClaim))).scalar() == 1


# ---------- 7. 上一周的奖励 ----------

async def test_last_week_reward_can_be_claimed_for_three_days(db_session):
    (a, pa), (b, _), (c, _) = await _students(db_session, "cbg", 3)
    t, unit, cls = await _kit(db_session, "cbg", [a, b, c])
    pa.food_balance = 10
    await db_session.commit()
    last = [MON - timedelta(days=7), MON - timedelta(days=6), MON - timedelta(days=5)]
    await _full_days(db_session, t, unit, a, last)
    await _full_days(db_session, t, unit, b, last)          # 上周 180: 打死了;这一周还没人动

    v = await _view(db_session, a, today=WED)
    assert (v["defeated"], v["hp_left"], v["mine"]["total"]) == (False, 180, 0), "上一周的伤害不算进这一周"
    assert v["last_week"] == {"defeated": True, "can_claim": True}
    assert (await _view(db_session, c, today=WED))["last_week"] == {"defeated": True, "can_claim": False}, "上周没出力"
    # 第 4 天(周四)起: 不显示、也领不了
    assert (await _view(db_session, a, today=THU))["last_week"] is None
    reset_memory()
    with pytest.raises(HTTPException) as e:
        await class_boss.claim(db_session, a, "last", THU)
    assert e.value.detail["code"] == "boss_expired"

    reset_memory()
    assert (await class_boss.claim(db_session, a, "last", WED))["food"] == 40
    await db_session.refresh(pa)
    assert pa.food_balance == 50
    assert (await _view(db_session, a, today=WED))["last_week"] == {"defeated": True, "can_claim": False}
    reset_memory()
    with pytest.raises(HTTPException) as e:
        await class_boss.claim(db_session, a, "last", WED)
    assert e.value.detail["code"] == "boss_claimed"
    row = (await db_session.execute(select(ClassBossClaim))).scalar_one()
    assert row.week_start == (MON - timedelta(days=7)).isoformat(), "记的是上一周"
    # 这一周的是另一份: 这一周还没打死,领不了
    reset_memory()
    with pytest.raises(HTTPException) as e:
        await class_boss.claim(db_session, a, "this", WED)
    assert e.value.detail["code"] == "boss_alive"
    # 周一、周二也在那 3 天里
    assert (await _view(db_session, b, today=MON))["last_week"]["can_claim"] is True
    assert (await _view(db_session, b, today=TUE))["last_week"]["can_claim"] is True


# ---------- 8. 别的班看不到;排行只列出过力的 ----------

async def test_other_class_is_invisible_and_top_lists_only_those_who_helped(db_session):
    mine = await _students(db_session, "cbh", 5)
    others = await _students(db_session, "cbo", 3)
    a, b, c, d, e = [u for u, _ in mine]
    t, unit, _cls = await _kit(db_session, "cbh", [a, b, c, d, e])
    t2, unit2, _cls2 = await _kit(db_session, "cbo", [u for u, _ in others])

    await _tasks(db_session, t, unit, a, MON, 2)            # 20
    await _full_days(db_session, t, unit, b, [MON, TUE])    # 60
    await _tasks(db_session, t, unit, c, TUE, 1)            # 10
    await _full_days(db_session, t, unit, d, [WED])         # 30
    await _learn(db_session, e, WED, 25)                    # 5: 算伤害,但不算「出过力」
    b.full_name, b.username = None, "cbh13900002222"        # 名字不露手机号
    await db_session.commit()

    v = await _view(db_session, a)
    assert v["hp_max"] == 300 and v["hp_left"] == 300 - (20 + 60 + 10 + 30 + 5)
    assert v["joined"] == 4, "不到 10 点的不算出过力"
    assert v["top"] == [{"name": "cbh", "points": 60}, {"name": "cbh3", "points": 30}, {"name": "cbh0", "points": 20}]
    assert all(set(row) == {"name", "points"} for row in v["top"]), "排行里不给 id"

    # 别的班: 自己的大怪满血,排行是空的
    o = await _view(db_session, others[0][0])
    assert (o["class_name"], o["hp_max"], o["hp_left"], o["joined"], o["top"]) == ("cbo 班", 180, 180, 0, [])
    await _full_days(db_session, t2, unit2, others[1][0], [MON])
    assert (await _view(db_session, a))["hp_left"] == 175, "别的班打的不算到我们班头上"
    assert (await _view(db_session, others[0][0]))["hp_left"] == 150


# ---------- 9. 全班的数缓存 60 秒,我自己的现算 ----------

async def test_class_totals_are_cached_but_mine_is_fresh(db_session):
    (a, _), (b, _), (c, _) = await _students(db_session, "cbi", 3)
    t, unit, cls = await _kit(db_session, "cbi", [a, b, c])
    reset_memory()
    assert (await class_boss.overview(db_session, a, WED))["hp_left"] == 180
    cached = await store.get_json(f"class_boss:{cls.id}:{MON.isoformat()}")
    assert cached == {"totals": {}, "active": sorted([a.id, b.id, c.id])}, "键带着班和周"

    await _tasks(db_session, t, unit, b, WED, 1)            # 同学刚做完: 我这边最多等 60 秒才看得到
    await _tasks(db_session, t, unit, a, WED, 2)            # 我自己刚做完: 马上看得到
    v = await class_boss.overview(db_session, a, WED)
    assert (v["mine"]["total"], v["hp_left"], v["joined"]) == (20, 160, 1)
    reset_memory()                                          # 缓存过期以后
    v = await class_boss.overview(db_session, a, WED)
    assert (v["mine"]["total"], v["hp_left"], v["joined"]) == (20, 150, 2)
    # 我自己的那一份不会被算两遍(缓存里有我、现算的又盖一次)
    assert (await class_boss.overview(db_session, a, WED))["hp_left"] == 150


async def test_expired_cache_is_recomputed_once_for_a_whole_class(monkeypatch):
    """缓存刚过期,一个班的孩子同时打开: 只算一次,别的等它算完读缓存"""
    calls = []

    async def slow_days_of(db, roster, first, last):
        calls.append(len(roster))
        await asyncio.sleep(0.05)
        return {7: {MON.isoformat(): {"tasks": 2, "review": False, "words": 0}}}

    async def studied(db, roster, monday):
        return [8]

    monkeypatch.setattr(class_boss, "days_of", slow_days_of)
    monkeypatch.setattr(class_boss, "studied_ids", studied)
    reset_memory()
    got = await asyncio.gather(*[class_boss.class_week(None, 31, [7, 8, 9], MON) for _ in range(6)])
    assert got == [{"totals": {7: 20}, "active": [7, 8]}] * 6 and calls == [3], "六个人同时来,只算了一次"
    # 别的班、别的周各算各的
    await class_boss.class_week(None, 32, [7, 8, 9], MON)
    await class_boss.class_week(None, 31, [7, 8, 9], MON + timedelta(days=7))
    assert len(calls) == 3
    # 老格式的缓存(没有 active): 当成没有,重新算
    await store.set_json(f"class_boss:33:{MON.isoformat()}", {"totals": {"7": 99}}, 60)
    assert (await class_boss.class_week(None, 33, [7, 8, 9], MON)) == {"totals": {7: 20}, "active": [7, 8]}


async def test_review_done_is_read_from_the_plan_and_marked_when_found(db_session):
    """今日复习做完没有: 记了完成时刻的直接算;没记上的翻学习记录,翻出来做完了的顺手记上(和 daily_review 同一个时刻)"""
    (a, _), (b, _), (c, _) = await _students(db_session, "cbm", 3)
    await _kit(db_session, "cbm", [a, b, c])
    await _review(db_session, a, TUE, total=3)                  # 做完了,完成时刻还没记上
    await _review(db_session, b, TUE, total=3, done=2)          # 没做完
    ws = await _new_words(db_session, 2)                        # c: 以前就记了完成(那天的学习记录已经不在了也算)
    db_session.add(DailyReviewPlan(user_id=c.id, plan_date=TUE, word_ids=json.dumps([w.id for w in ws]), backlog=2,
                                   completed_at=_at(TUE, 9)))
    # 没记完成、那一份里又一个词都不剩的(空的 / 词后来都删了): 不算做完,也不记完成
    db_session.add(DailyReviewPlan(user_id=b.id, plan_date=WED, word_ids="[]", backlog=0))
    db_session.add(DailyReviewPlan(user_id=c.id, plan_date=WED, word_ids="[999991, 999992]", backlog=2))
    await db_session.commit()

    days = await class_boss.days_of(db_session, [a.id, b.id, c.id], MON, SUN)
    assert days[a.id][TUE.isoformat()]["review"] is True
    assert days[b.id][TUE.isoformat()]["review"] is False
    assert days[c.id][TUE.isoformat()]["review"] is True
    assert WED.isoformat() not in days[b.id] and WED.isoformat() not in days[c.id]
    assert all(p.completed_at is None for p in (await db_session.execute(
        select(DailyReviewPlan).where(DailyReviewPlan.plan_date == WED))).scalars())
    plans = {p.user_id: p for p in (await db_session.execute(
        select(DailyReviewPlan).where(DailyReviewPlan.plan_date == TUE))).scalars()}
    assert plans[a.id].completed_at == _at(TUE, 13), "记的是最后一个词当天第一次练到的时刻,不是现在"
    assert plans[b.id].completed_at is None and plans[c.id].completed_at == _at(TUE, 9)
    # 记上以后和 daily_review 自己判的是同一个结果
    from app.services import daily_review
    st = await daily_review.status(db_session, a.id, TUE, create=False)
    assert st["completed"] is True and st["total"] == 3


# ---------- 10. 开关、接口、表 ----------

async def test_switch_endpoints_and_model(client, db_session):
    (a, _), (b, _), (c, _) = await _students(db_session, "cbj", 3)
    t, unit, _cls = await _kit(db_session, "cbj", [a, b, c])
    today = local_today()
    await _tasks(db_session, t, unit, a, today, 1)

    r = await client.get(BOSS, headers=_h(a.id))
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"enabled", "has_class", "class_name", "week_start", "week_end", "students", "enrolled",
                         "boss", "hp_max", "hp_left", "defeated", "joined", "mine", "top", "reward", "last_week"}
    assert set(body["boss"]) == {"species", "evolution_stage", "name"}
    assert set(body["mine"]) == {"total", "today", "today_cap", "items"}
    assert set(body["mine"]["items"][0]) == {"key", "label", "points", "how", "route"}
    assert set(body["reward"]) == {"food", "xp", "can_claim", "claimed"}
    assert (body["mine"]["total"], body["mine"]["today"], body["hp_left"]) == (10, 10, 170)
    assert body["week_start"] == class_boss.week_of(today)[0].isoformat()
    r = await client.post(CLAIM, headers=_h(a.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "boss_alive"

    assert battle_tickets.OPTION_DEFAULTS["class_boss"] is True
    await battle_tickets.save_settings(db_session, {**await battle_tickets.get_settings(db_session), "class_boss": False})
    await db_session.commit()
    assert (await client.get(BOSS, headers=_h(a.id))).json() == {"enabled": False}
    r = await client.post(CLAIM, headers=_h(a.id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "boss_off"

    init_py = Path(__file__).resolve().parents[1] / "app" / "models" / "__init__.py"
    assert "from app.models.class_boss import ClassBossClaim" in init_py.read_text(encoding="utf-8")
    from app.api.v1.student.pet_battle import router
    paths = [r.path for r in router.routes]
    for p in ("/battle/class-boss", "/battle/class-boss/claim"):
        assert paths.index(p) < paths.index("/battle/{battle_id}")


# ---------- 11. 还能怎么再拿 ----------

async def test_hints_say_how_to_get_more_today(db_session):
    (a, _), (b, _), (c, _) = await _students(db_session, "cbk", 3)
    t, unit, _cls = await _kit(db_session, "cbk", [a, b, c])
    today = local_today()
    await _tasks(db_session, t, unit, a, today, 1)
    await _tasks(db_session, t, unit, a, today, 2, done=False)
    await _review(db_session, a, today, total=4, done=1)
    await _learn(db_session, a, today, 4)                   # 加上复习做的 1 个 = 5 个词

    v = await _view(db_session, a, today=today)
    items = {i["key"]: i for i in v["mine"]["items"]}
    assert v["mine"]["today"] == 10
    assert (items["task"]["points"], items["task"]["how"], items["task"]["route"]) == (
        10, "今天还有 2 份没做完", "/student/homework")
    assert (items["review"]["points"], items["review"]["how"], items["review"]["route"]) == (
        0, "今日复习做了 1 / 4 个,做完 +10", "/student/memory-curve")
    assert (items["words"]["points"], items["words"]["how"], items["words"]["route"]) == (
        0, "今天学了 5 个词,再学 15 个 +5", "/student/dashboard")
    # 今天没布置作业: 写明是没布置(不然孩子看到「+10 … 0」分不清是没布置还是没做)
    v = await _view(db_session, b, today=today)
    items = {i["key"]: i for i in v["mine"]["items"]}
    assert (items["task"]["points"], items["task"]["how"], items["task"]["route"]) == (0, "今天没有布置作业", None)
    assert items["review"]["how"] == "今天还没排复习词,回首页看看"
    db_session.add(DailyReviewPlan(user_id=b.id, plan_date=today, word_ids="[]", backlog=0, completed_at=datetime.utcnow()))
    await db_session.commit()
    v = await _view(db_session, b, today=today)
    assert {i["key"]: i for i in v["mine"]["items"]}["review"]["how"] is None


async def test_task_hint_tells_no_homework_from_not_done(db_session):
    """作业那一项的 how: 没布置 / 还有 N 份没做完 / 做完了没别的可做 / 今天拿满了"""
    (a, _), (b, _), (c, _), (d, _) = await _students(db_session, "cbn", 4)
    t, unit, _cls = await _kit(db_session, "cbn", [a, b, c, d])
    today = local_today()

    async def task_item(user):
        v = await _view(db_session, user, today=today)
        return next(i for i in v["mine"]["items"] if i["key"] == "task"), v

    # a: 今天什么都没布置
    item, _v = await task_item(a)
    assert (item["points"], item["how"], item["route"]) == (0, "今天没有布置作业", None)
    # b: 布置了 1 份单词作业 + 1 份句子作业,都没做 → 还有 2 份(句子 / 音标作业也算一份任务)
    await _tasks(db_session, t, unit, b, today, 1, done=False)
    hw = ContentHomework(kind="sentence", target_id=0, title="句子作业", teacher_id=t.id,
                         available_from=local_day_utc_range(today)[0])
    review_hw = ContentHomework(kind="daily_review", target_id=0, title="每日复习", teacher_id=t.id,
                                available_from=local_day_utc_range(today)[0])
    closed = ContentHomework(kind="sentence", target_id=0, title="关掉的", teacher_id=t.id, is_closed=True,
                             available_from=local_day_utc_range(today)[0])
    later = ContentHomework(kind="sentence", target_id=0, title="明天才开放", teacher_id=t.id,
                            available_from=local_day_utc_range(today + timedelta(days=1))[0])
    db_session.add_all([hw, review_hw, closed, later])
    await db_session.flush()
    for one in (hw, review_hw, closed, later):      # 布置成作业的每日复习、关掉的、还没开放的都不算
        db_session.add(ContentHomeworkStudent(homework_id=one.id, student_id=b.id))
    await db_session.commit()
    item, _v = await task_item(b)
    assert (item["points"], item["how"], item["route"]) == (0, "今天还有 2 份没做完", "/student/homework")
    assert await class_boss.tasks_todo(db_session, b.id, datetime.utcnow()) == 2
    # c: 今天做完了 1 份,没有别的可做 → 没有可拿的了,null(不是「没有布置」)
    await _tasks(db_session, t, unit, c, today, 1)
    item, _v = await task_item(c)
    assert (item["points"], item["how"], item["route"]) == (10, None, None)
    # d: 今天已经拿满 30,还有一份没做 → 三项都不说了
    await _tasks(db_session, t, unit, d, today, 3)
    await _tasks(db_session, t, unit, d, today, 1, done=False)
    item, v = await task_item(d)
    assert v["mine"]["today"] == 30 and (item["points"], item["how"], item["route"]) == (30, None, None)


# ---------- 12. 大怪的血按「在学的人」算 ----------

async def test_boss_hp_counts_only_children_who_are_studying(db_session):
    kids = [u for u, _ in await _students(db_session, "cbp", 6)]
    a, b, c, gone, edge, idle = kids
    t, unit, cls = await _kit(db_session, "cbp", kids, studied=False)
    await _studied(db_session, a, MON - timedelta(days=1))          # 上周日学过
    await _studied(db_session, b, MON - timedelta(days=10))
    await _studied(db_session, edge, MON - timedelta(days=14))      # 正好第 14 天: 算
    await _studied(db_session, gone, MON - timedelta(days=15))      # 15 天前: 久不来,不算
    await _studied(db_session, idle, MON - timedelta(days=2), empty=True)   # 只有切屏记录的空行: 不算学过
    # c 没有任何日历记录

    v = await _view(db_session, a)
    assert (v["enrolled"], v["students"], v["hp_max"], v["hp_left"]) == (6, 3, 180, 180), "久不来的不进血量"
    assert sorted(await class_boss.studied_ids(db_session, [k.id for k in kids], MON)) == sorted([a.id, b.id, edge.id])

    # 久不来的这一周回来了(周二日历上有他): 算进来,血多 60
    await _studied(db_session, gone, TUE)
    v = await _view(db_session, a)
    assert (v["students"], v["hp_max"]) == (4, 240)
    # 日历没记上、但这一周给大怪掉过血的(c 做完了一份作业): 出了力的人一定算在学
    await _tasks(db_session, t, unit, c, TUE, 1)
    v = await _view(db_session, a)
    assert (v["students"], v["hp_max"], v["hp_left"], v["joined"]) == (5, 300, 290, 1)
    assert v["joined"] <= v["students"]
    # 下一周的日历不算到这一周头上
    await _studied(db_session, idle, SUN + timedelta(days=1))
    assert (await _view(db_session, a))["students"] == 5
    # 我自己这一周刚来学(缓存里还没有我): 马上算进去,不用等缓存
    reset_memory()
    assert (await class_boss.overview(db_session, idle, WED))["students"] == 5
    await _learn(db_session, idle, WED, 3)                          # 学了 3 个词: 没有点数,但是来学了
    v = await class_boss.overview(db_session, idle, WED)
    assert (v["students"], v["hp_max"], v["mine"]["total"]) == (6, 360, 0)
    assert (await class_boss.overview(db_session, a, WED))["students"] == 5, "别人那边等缓存过期"
    assert (await _view(db_session, a))["students"] == 6, "缓存过期以后大家看到的是同一个数"


async def test_few_studying_children_still_face_a_three_person_boss(db_session):
    kids = [u for u, _ in await _students(db_session, "cbq", 4)]
    a, b, c, d = kids
    t, unit, _cls = await _kit(db_session, "cbq", kids, studied=False)
    await _studied(db_session, a, MON - timedelta(days=2))
    # 在班 4 人、在学只有 1 人: 照样出大怪,血量按 3 人算
    v = await _view(db_session, a)
    assert v["boss"] is not None and (v["enrolled"], v["students"], v["hp_max"]) == (4, 1, 180)
    # 一个人每天最多 30: 一周 7 天 210 ≥ 180,一个人学满一周打得死
    await _full_days(db_session, t, unit, a, [MON, TUE, WED])
    v = await _view(db_session, a, today=WED)
    assert (v["hp_left"], v["defeated"], v["joined"], v["students"]) == (90, False, 1, 1)
    # 一个在学的都没有: 也是 3 人的血
    assert (await _view(db_session, b))["hp_max"] == 180 and (await _view(db_session, b))["students"] == 1
    kids2 = [u for u, _ in await _students(db_session, "cbq2", 3)]
    await _kit(db_session, "cbq2", kids2, studied=False)
    v = await _view(db_session, kids2[0])
    assert (v["enrolled"], v["students"], v["hp_max"], v["joined"]) == (3, 0, 180, 0)


async def test_last_week_hp_uses_last_weeks_studying_children(db_session):
    kids = [u for u, _ in await _students(db_session, "cbr", 5)]
    a, b, c, back1, back2 = kids
    t, unit, _cls = await _kit(db_session, "cbr", kids, studied=False)
    last_mon = MON - timedelta(days=7)
    for k in (a, b, c):
        await _studied(db_session, k, last_mon - timedelta(days=3))
    # 上一周: a、b 各打满 3 天 = 180,上一周在学的是 3 个人 → 180 点血,打死了
    await _full_days(db_session, t, unit, a, [last_mon, last_mon + timedelta(days=1), last_mon + timedelta(days=2)])
    await _full_days(db_session, t, unit, b, [last_mon, last_mon + timedelta(days=1), last_mon + timedelta(days=2)])
    # 这一周又回来两个人: 这一周的血是 5 个人的(a、b、c 上上周五学过,还在 14 天里),上一周的不受影响
    await _studied(db_session, back1, MON)
    await _studied(db_session, back2, TUE)
    v = await _view(db_session, a, today=WED)
    assert (v["students"], v["hp_max"]) == (5, 300)
    assert v["last_week"] == {"defeated": True, "can_claim": True}, "上一周的血量按上一周在学的人算"
    reset_memory()
    assert (await class_boss.claim(db_session, a, "last", WED))["food"] == 40
