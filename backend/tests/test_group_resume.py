"""分组续学回归测试。

线上问题:一个单元 4 组,学生背完 2 组退出,回来又从第 1 组开始。
根因:start_learning 只看 is_completed(历史标记,一旦 True 永不回退)就把
current_word_index 归零,导致"学完过一遍"的单元永久失去断点续学。
"""
import pytest
from datetime import date, timedelta

from app.models.user import User, DailyCheckin
from app.models.word import Word, WordBook, BookWord, Unit, UnitWord
from app.models.learning import LearningProgress, BookAssignment
from app.models.organization import Organization
from app.core.timeutil import local_today
from app.core import tenancy
from tests.conftest import _make_token

GROUP_SIZE = 10          # 小学:每组 10 词
TOTAL_WORDS = 40         # 4 组


@pytest.fixture
async def student_with_unit(db_session):
    """已签到的小学生 + 40 词单元(4 组)。"""
    tenancy._org_cache.clear()  # 机构状态有进程内缓存,测试间必须清
    org = Organization(name="测试机构", code="TST01", status="active")
    db_session.add(org)
    await db_session.flush()

    user = User(
        username="stu_resume", email="stu_resume@example.com",
        hashed_password="x", role="student", full_name="续学同学", is_active=True,
        org_id=org.id,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(DailyCheckin(user_id=user.id, checkin_date=local_today()))

    book = WordBook(name="小学英语三年级上", is_public=True, grade_level="小学三年级")
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db_session.add(unit)
    await db_session.flush()
    for i in range(TOTAL_WORDS):
        w = Word(word=f"resume_w{i}", difficulty=1)
        db_session.add(w)
        await db_session.flush()
        db_session.add(BookWord(book_id=book.id, word_id=w.id, order_index=i))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))

    # 严格模式:必须有分配才能进单元(整本可学)
    db_session.add(BookAssignment(
        student_id=user.id, book_id=book.id, scope_type="book", teacher_id=user.id,
    ))
    await db_session.commit()
    return _make_token(user.id), user.id, unit


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _resume_group(current_word_index: int) -> int:
    """复刻前端 WordClassifyLearning 的起始组计算。"""
    return (current_word_index + 1) // GROUP_SIZE


async def test_resume_after_two_groups_on_fresh_unit(client, student_with_unit):
    """从未学完的单元:背完 2 组退出,回来应从第 3 组开始。"""
    token, _uid, unit = student_with_unit
    r = await client.post(
        f"/api/v1/student/units/{unit.id}/start",
        json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token),
    )
    assert r.status_code == 200, r.text

    # 背完第 1、2 组(前端每组结束提交 globalEndIndex - 1)
    for group_idx in (0, 1):
        end_index = (group_idx + 1) * GROUP_SIZE - 1
        r = await client.put(
            "/api/v1/student/progress",
            json={"unit_id": unit.id, "learning_mode": "classify",
                  "current_word_index": end_index, "is_completed": False},
            headers=_headers(token),
        )
        assert r.status_code == 200, r.text

    # 退出后重新进入
    r = await client.post(
        f"/api/v1/student/units/{unit.id}/start",
        json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token),
    )
    data = r.json()
    assert data["has_existing_progress"] is True
    assert data["current_word_index"] == 19
    assert _resume_group(data["current_word_index"]) == 2   # 第 3 组


async def test_resume_after_two_groups_on_completed_unit(client, db_session, student_with_unit):
    """曾学完过的单元(is_completed=1)再学:背完 2 组退出,仍须从第 3 组续上。

    这是线上 bug 的精确复现——修复前这里会回到第 1 组。
    """
    token, uid, unit = student_with_unit
    # 第一轮:整单元学完
    await client.post(f"/api/v1/student/units/{unit.id}/start",
                      json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token))
    r = await client.put(
        "/api/v1/student/progress",
        json={"unit_id": unit.id, "learning_mode": "classify",
              "current_word_index": TOTAL_WORDS - 1, "is_completed": True},
        headers=_headers(token),
    )
    assert r.json()["is_completed"] is True

    # 第二轮:学完过的单元重新进入 → 应从头(第 1 组)
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token))
    data = r.json()
    assert data["current_word_index"] == 0
    assert _resume_group(data["current_word_index"]) == 0

    # 第二轮背完 2 组后退出
    for group_idx in (0, 1):
        await client.put(
            "/api/v1/student/progress",
            json={"unit_id": unit.id, "learning_mode": "classify",
                  "current_word_index": (group_idx + 1) * GROUP_SIZE - 1, "is_completed": False},
            headers=_headers(token),
        )

    # 关键断言:回来必须接着第 3 组,而不是回到第 1 组
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token))
    data = r.json()
    assert data["current_word_index"] == 19, "学完过的单元丢了断点,又从第1组开始"
    assert _resume_group(data["current_word_index"]) == 2

    # 完成标记与已完成词数不能被复习轮打回
    prog = (await db_session.execute(
        LearningProgress.__table__.select().where(LearningProgress.user_id == uid)
    )).first()
    assert prog.is_completed == 1 or prog.is_completed is True
    assert prog.completed_words == TOTAL_WORDS, "复习轮把单元进度条从100%打回去了"


async def test_finished_round_restarts_from_first_group(client, student_with_unit):
    """本轮走到最后一个词(未点完成)后重进:开新一轮,从第 1 组。"""
    token, _uid, unit = student_with_unit
    await client.post(f"/api/v1/student/units/{unit.id}/start",
                      json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token))
    await client.put(
        "/api/v1/student/progress",
        json={"unit_id": unit.id, "learning_mode": "classify",
              "current_word_index": TOTAL_WORDS - 1, "is_completed": False},
        headers=_headers(token),
    )
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"unit_id": unit.id, "learning_mode": "classify"}, headers=_headers(token))
    assert r.json()["current_word_index"] == 0
