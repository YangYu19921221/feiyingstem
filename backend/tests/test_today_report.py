"""「今日学习报告」(孩子做完当天全部任务后发给家长的分享图)的数据口径

钉住的不变量(口径真源 services/today_report.py):
1. 全部完成 = 今天布置、没关闭的任务至少一份且每份 completed;差一份就不算
2. 在家做的任务也是任务(金币分母排除它,但家长看的是老师布置了什么)
3. 老师关闭的任务不算;别人的任务不算
4. 今天补做完成的旧任务列出来(is_today=False),但不影响「全部完成」
5. 还要多练按拼写去重;「写成什么」只取拼写类作答,选择题的选项不当拼写写上去
"""
from datetime import timedelta

import pytest

from app.core import tenancy
from app.core.timeutil import local_today, local_day_utc_range
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment, LearningRecord
from app.models.organization import Organization
from app.models.user import User
from app.models.word import Word, WordBook, WordDefinition, Unit
from tests.conftest import _make_token


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    org = Organization(name="今日报告机构", code="TDRP", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="tdrpteacher", email="tdrpt@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu = User(username="tdrpstu", email="tdrps@e.com", hashed_password="x",
               role="student", full_name="今日同学", is_active=True, org_id=org.id)
    other = User(username="tdrpother", email="tdrpo@e.com", hashed_password="x",
                 role="student", full_name="别的同学", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu, other])
    await db_session.flush()
    book = WordBook(name="人教版九年级上册", is_public=True)
    db_session.add(book)
    await db_session.flush()
    units = []
    for i in range(1, 5):
        u = Unit(book_id=book.id, unit_number=i, name=f"Unit {i}")
        db_session.add(u)
        units.append(u)
    await db_session.flush()
    day_start, _ = local_day_utc_range(local_today())
    return db_session, org, teacher, stu, other, units, day_start


async def _task(db, teacher, stu, unit, *, assigned_at, status="pending", completed_at=None,
                location_type="classroom", is_closed=False, best_score=0):
    hw = HomeworkAssignment(title=f"{unit.name} 任务", unit_id=unit.id, teacher_id=teacher.id,
                            learning_mode="flashcard", target_score=80, max_attempts=3,
                            is_closed=is_closed, location_type=location_type)
    db.add(hw)
    await db.flush()
    sa = HomeworkStudentAssignment(homework_id=hw.id, student_id=stu.id, assigned_at=assigned_at,
                                   status=status, completed_at=completed_at, best_score=best_score)
    db.add(sa)
    await db.flush()
    return sa


async def _report(client, uid):
    r = await client.get("/api/v1/student/today-report",
                         headers={"Authorization": f"Bearer {_make_token(uid)}"})
    assert r.status_code == 200, r.text
    return r.json()


async def test_all_done_counts_home_and_ignores_closed_and_others(client, env):
    db, org, teacher, stu, other, units, day_start = env
    await _task(db, teacher, stu, units[0], assigned_at=day_start + timedelta(hours=1),
                status="completed", completed_at=day_start + timedelta(hours=2), best_score=93)
    await _task(db, teacher, stu, units[1], assigned_at=day_start + timedelta(hours=1),
                status="completed", completed_at=day_start + timedelta(hours=3), best_score=88,
                location_type="home")
    # 关闭的没做 → 不算;别人的没做 → 不算
    await _task(db, teacher, stu, units[2], assigned_at=day_start + timedelta(hours=1), is_closed=True)
    await _task(db, teacher, other, units[3], assigned_at=day_start + timedelta(hours=1))
    await db.commit()

    data = await _report(client, stu.id)
    assert data["all_done"] is True
    assert (data["today_total"], data["today_done"]) == (2, 2)
    assert [t["unit_name"] for t in data["tasks"]] == ["Unit 1", "Unit 2"]
    assert data["tasks"][1]["location_type"] == "home"
    assert data["tasks"][0]["best_score"] == 93
    assert data["org_name"] == "今日报告机构"


async def test_one_pending_is_not_all_done(client, env):
    db, org, teacher, stu, other, units, day_start = env
    await _task(db, teacher, stu, units[0], assigned_at=day_start + timedelta(hours=1),
                status="completed", completed_at=day_start + timedelta(hours=2), best_score=90)
    await _task(db, teacher, stu, units[1], assigned_at=day_start + timedelta(hours=1), status="in_progress")
    await db.commit()

    data = await _report(client, stu.id)
    assert data["all_done"] is False
    assert (data["today_total"], data["today_done"]) == (2, 1)


async def test_failed_task_is_not_done(client, env):
    db, org, teacher, stu, other, units, day_start = env
    await _task(db, teacher, stu, units[0], assigned_at=day_start + timedelta(hours=1), status="failed")
    await db.commit()
    assert (await _report(client, stu.id))["all_done"] is False


async def test_makeup_task_listed_but_not_required(client, env):
    db, org, teacher, stu, other, units, day_start = env
    # 昨天布置、今天补做完成
    await _task(db, teacher, stu, units[0], assigned_at=day_start - timedelta(hours=10),
                status="completed", completed_at=day_start + timedelta(hours=2), best_score=85)
    # 昨天布置、今天没做 → 不出现
    await _task(db, teacher, stu, units[1], assigned_at=day_start - timedelta(hours=10))
    await db.commit()

    data = await _report(client, stu.id)
    assert data["today_total"] == 0
    assert data["all_done"] is False      # 今天没有任务就没有「全部完成」
    assert [(t["unit_name"], t["is_today"]) for t in data["tasks"]] == [("Unit 1", False)]


async def test_no_task_today(client, env):
    db, org, teacher, stu, other, units, day_start = env
    data = await _report(client, stu.id)
    assert (data["all_done"], data["today_total"], data["tasks"]) == (False, 0, [])


async def test_weak_words_dedup_by_spelling_and_wrote_only_from_spelling(client, env):
    db, org, teacher, stu, other, units, day_start = env
    # 同一拼写在两个单元各有一个 word_id(单元级隔离)
    retell_a = Word(word="retell", difficulty=1)
    retell_b = Word(word="retell", difficulty=1)
    opera = Word(word="opera", difficulty=1)
    happy = Word(word="happy", difficulty=1)
    db.add_all([retell_a, retell_b, opera, happy])
    await db.flush()
    db.add_all([
        WordDefinition(word_id=retell_a.id, meaning="v. 复述", is_primary=True),
        WordDefinition(word_id=opera.id, meaning="n. 歌剧", is_primary=True),
    ])
    t = day_start + timedelta(hours=2)
    db.add_all([
        LearningRecord(user_id=stu.id, word_id=retell_a.id, learning_mode="spelling", is_correct=False,
                       user_answer="retall", created_at=t),
        LearningRecord(user_id=stu.id, word_id=retell_b.id, learning_mode="spelling", is_correct=False,
                       user_answer="retel", created_at=t + timedelta(minutes=5)),
        # 选择题答错: user_answer 是选项文字,不能写成「写成了 歌剧院」
        LearningRecord(user_id=stu.id, word_id=opera.id, learning_mode="quiz", is_correct=False,
                       user_answer="歌剧院", created_at=t),
        LearningRecord(user_id=stu.id, word_id=happy.id, learning_mode="spelling", is_correct=True, created_at=t),
        # 分类自评不计分,不进报告
        LearningRecord(user_id=stu.id, word_id=happy.id, learning_mode="classify", is_correct=False, created_at=t),
        # 昨天的错不进今天
        LearningRecord(user_id=stu.id, word_id=happy.id, learning_mode="spelling", is_correct=False,
                       user_answer="hapy", created_at=day_start - timedelta(hours=1)),
        # 别人的错不进来
        LearningRecord(user_id=other.id, word_id=happy.id, learning_mode="spelling", is_correct=False,
                       user_answer="hepy", created_at=t),
    ])
    await db.commit()

    data = await _report(client, stu.id)
    weak = {w["word"]: w for w in data["weak"]}
    assert set(weak) == {"retell", "opera"}
    assert weak["retell"]["wrote"] == "retall"          # 当天第一次答错的输入
    assert weak["retell"]["meaning"] == "v. 复述"
    assert weak["opera"]["wrote"] is None
    assert (data["scored_words"], data["never_wrong"], data["weak_total"]) == (3, 1, 2)


async def test_teacher_forbidden(client, env):
    db, org, teacher, stu, other, units, day_start = env
    r = await client.get("/api/v1/student/today-report",
                         headers={"Authorization": f"Bearer {_make_token(teacher.id)}"})
    assert r.status_code == 403


async def test_sentencefill_wrong_answer_shows_in_report(client, env):
    """句子填空(2026-10-23 起记学习记录): 写错的词进今日学习报告的薄弱词,并带「写成了 xxx」
    (写成原形本身不显示「写成了」,与拼写同口径,见 _wrote_of)"""
    db, org, teacher, stu, other, units, day_start = env
    sing = Word(word="sing", difficulty=1)
    db.add(sing)
    await db.flush()
    db.add(WordDefinition(word_id=sing.id, meaning="v. 唱歌", is_primary=True))
    db.add(LearningRecord(user_id=stu.id, word_id=sing.id, learning_mode="sentencefill", is_correct=False,
                          user_answer="seng", created_at=day_start + timedelta(hours=2)))
    await db.commit()
    data = await _report(client, stu.id)
    weak = {w["word"]: w for w in data["weak"]}
    assert "sing" in weak and weak["sing"]["wrote"] == "seng"
    assert data["scored_words"] == 1
