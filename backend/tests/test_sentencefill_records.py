"""句子填空的作答进学习记录(2026-10-23)

以前填句一条记录都不写: 错的词不进错题本/记忆曲线,老师和报告都看不到。
守的是: POST /student/records 带 learning_mode=sentencefill 能落库、写错进掌握度错误数和记忆曲线,
且 sentencefill 在计分模式里(正确率/薄弱词/陪跑/今日报告都按 SCORING_MODES 取数)。
"""
import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.learning import LearningRecord, WordMastery
from app.models.organization import Organization
from app.models.user import User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import rate_limit
from app.services.weak_words import SCORING_MODES
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def env(db_session):
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    # 生产库 study_calendar 有 UNIQUE(user_id, study_date),测试库的 create_all 没建,提交记录时 upsert 要用
    from sqlalchemy import text as sql_text
    await db_session.execute(sql_text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_test ON study_calendar(user_id, study_date)"))
    org = Organization(name="填句机构", code="SFREC", status="active")
    db_session.add(org)
    await db_session.flush()
    stu = User(username="sfstu", email="sfstu@e.com", hashed_password="x", role="student",
               full_name="填句", is_active=True, org_id=org.id)
    book = WordBook(name="填句书")
    db_session.add_all([stu, book])
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="U1")
    word = Word(word="sing", difficulty=1)
    db_session.add_all([unit, word])
    await db_session.flush()
    db_session.add_all([
        UnitWord(unit_id=unit.id, word_id=word.id, order_index=0),
        WordDefinition(word_id=word.id, meaning="v. 唱歌", is_primary=True,
                       example_sentence="She sings a song every morning."),
    ])
    await db_session.commit()
    # 只交出 id: 测试里 expire_all 之后再碰 ORM 对象会触发懒加载(MissingGreenlet)
    yield {"stu": stu.id, "unit": unit.id, "word": word.id}
    tenancy.invalidate_org_cache()


async def test_sentencefill_is_a_scoring_mode():
    assert "sentencefill" in SCORING_MODES


async def test_wrong_first_answer_is_recorded(client, db_session, env):
    tok = _make_token(env["stu"])
    r = await client.post("/api/v1/student/records", headers={"Authorization": f"Bearer {tok}"}, json={
        "unit_id": env["unit"], "learning_mode": "sentencefill", "session_seconds": 12,
        "records": [{"word_id": env["word"], "is_correct": False, "time_spent": 12000,
                     "learning_mode": "sentencefill", "user_answer": "sing"}],
    })
    assert r.status_code == 200, r.text
    db_session.expire_all()
    rec = (await db_session.execute(select(LearningRecord).where(
        LearningRecord.user_id == env["stu"]))).scalar_one()
    assert (rec.learning_mode, rec.is_correct, rec.user_answer) == ("sentencefill", False, "sing")
    m = (await db_session.execute(select(WordMastery).where(
        WordMastery.user_id == env["stu"], WordMastery.word_id == env["word"]))).scalar_one()
    assert m.wrong_count == 1 and m.total_encounters == 1 and m.next_review_at is not None
