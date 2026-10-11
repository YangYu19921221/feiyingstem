"""句子背诵分组学习(2026-10-11)。

守的几件事:
- 分组: 对话一问一答不拆开;短句一组多放、长句少放;最后一组只剩 1 句并进上一组
- 关键词: 不挖功能词和缩写
- 可见性: 别家机构 / 不公开的句子集学生拿不到(此前单元列表、句子列表只要登录)
- 记作答: 只认本单元的句子;只有过关检测推进记忆曲线;幂等
- 过关: 80 分线;断点只进不退;最后一组过关记完成
"""
import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.organization import Organization
from app.models.sentence import Sentence, SentenceBook, SentenceUnit
from app.models.sentence_learning import SentenceMastery, SentenceUnitProgress
from app.models.user import User
from app.services import sentence_learning as sl
from tests.conftest import _make_token


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


def _s(english, i=0):
    return Sentence(id=i or None, unit_id=1, english=english, chinese="中", order_index=i)


# ---------- 纯函数 ----------

def test_dialogue_lines_stay_together():
    ss = [_s("Hello!", 1), _s("—What colour is it?", 2), _s("—It's red.", 3),
          _s("—Nice to meet you.", 4), _s("I like apples.", 5)]
    groups = sl.split_groups(ss)
    flat = [[s.english for s in g] for g in groups]
    # 问句和答句必须在同一组
    for g in flat:
        if "—What colour is it?" in g:
            assert "—It's red." in g


def test_group_size_follows_sentence_length():
    short = [_s("Dogs are friendly.", i) for i in range(1, 13)]           # 3 词 × 12
    long_ = [_s("I go to school by bus with my best friend every morning.", i) for i in range(1, 13)]  # 12 词 × 12
    assert max(len(g) for g in sl.split_groups(short)) == sl.GROUP_MAX_SENTENCES
    assert max(len(g) for g in sl.split_groups(long_)) <= 3
    # 每句都在且只在一组里
    for ss in (short, long_):
        assert sum(len(g) for g in sl.split_groups(ss)) == 12


def test_last_single_sentence_merges():
    ss = [_s("Dogs are friendly.", i) for i in range(1, 8)]   # 6 + 1
    groups = sl.split_groups(ss)
    assert len(groups) == 1 and len(groups[0]) == 7


def test_key_word_skips_function_words_and_contractions():
    assert sl.key_word("What colour is it?") == "colour"
    assert sl.key_word("He's tall and strong.") == "strong"
    assert sl.key_word("—Nice to meet you.") == "Nice"
    assert sl.key_word("Is it a cat?") == "cat"
    assert sl.key_word("I am.") is None
    # 人名、招呼语不挖(生产三上第 1 单元实测)
    assert sl.key_word("Hi! My name is Wu Binbin.") == "name"
    assert sl.key_word("Thanks, Sarah.") is None
    assert sl.key_word("Hello! I'm Mike Black.") is None
    assert sl.key_word("Am I a good friend? Yes, I am!") == "friend"
    assert sl.key_word("Nice to meet you.") == "Nice"   # 句首大写照常可挖


# ---------- 接口 ----------

@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    # 生产库 study_calendar 有 UNIQUE(user_id, study_date)(database_schema.sql),
    # 测试库按模型 create_all 建,模型上没声明 → 补上,否则学习日历 upsert 报 ON CONFLICT 不匹配
    from sqlalchemy import text
    await db_session.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_test ON study_calendar(user_id, study_date)"))
    # 幂等去重表同理: 生产由 database_schema.sql 建,模型里没有;表不存在时去重静默放行(防挡数据)
    await db_session.execute(text(
        "CREATE TABLE IF NOT EXISTS client_submit_dedup (batch_id VARCHAR(80) PRIMARY KEY, "
        "user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"))
    db_session.add(Organization(name="直营", code="HQ01", status="active", student_quota=999999))
    await db_session.flush()
    a = Organization(name="A机构", code="AA01", status="active", student_quota=100)
    b = Organization(name="B机构", code="BB01", status="active", student_quota=100)
    db_session.add_all([a, b])
    await db_session.flush()
    stu = User(username="sstu", email="s@e.com", hashed_password="x", role="student",
               is_active=True, org_id=a.id)
    db_session.add(stu)
    pub = SentenceBook(name="三上句子", is_public=True, org_id=None)
    other = SentenceBook(name="B家句子", is_public=True, org_id=b.id)
    hidden = SentenceBook(name="未公开", is_public=False, org_id=None)
    db_session.add_all([pub, other, hidden])
    await db_session.flush()
    units = {}
    for key, book in (("pub", pub), ("other", other), ("hidden", hidden)):
        u = SentenceUnit(book_id=book.id, unit_number=1, name="U1")
        db_session.add(u)
        await db_session.flush()
        units[key] = u
    texts = ["Dogs are friendly.", "I like apples.", "He's tall and strong.",
             "Would you like some rice?", "These can all help plants grow.",
             "My mother is a teacher.", "We play football after school.",
             "The bird is in the tree.", "Can you swim?", "Look at the moon."]
    for i, t in enumerate(texts):
        db_session.add(Sentence(unit_id=units["pub"].id, english=t, chinese=f"中{i}", order_index=i))
    db_session.add(Sentence(unit_id=units["other"].id, english="B secret.", chinese="B", order_index=0))
    db_session.add(Sentence(unit_id=units["hidden"].id, english="Hidden.", chinese="H", order_index=0))
    await db_session.commit()
    return {"stu": stu, "units": units, "books": {"pub": pub, "other": other, "hidden": hidden}}


async def test_learn_returns_groups_and_hides_other_org(client, env):
    h = _hdr(env["stu"])
    r = await client.get(f"/api/v1/student/sentences/units/{env['units']['pub'].id}/learn", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert sum(len(g) for g in body["groups"]) == 10 and len(body["groups"]) >= 2
    assert body["groups_passed"] == 0 and body["completed"] is False
    assert all("key_word" in s for g in body["groups"] for s in g)
    for key in ("other", "hidden"):
        uid = env["units"][key].id
        assert (await client.get(f"/api/v1/student/sentences/units/{uid}/learn", headers=h)).status_code == 404
        # 老接口也补了同一道闸门
        assert (await client.get(f"/api/v1/sentences/units/{uid}/sentences", headers=h)).status_code == 404
        bid = env["books"][key].id
        assert (await client.get(f"/api/v1/sentences/books/{bid}/units", headers=h)).status_code == 404


async def test_records_only_exam_advances_review(client, env, db_session):
    h = _hdr(env["stu"])
    uid = env["units"]["pub"].id
    sids = list((await db_session.execute(
        select(Sentence.id).where(Sentence.unit_id == uid).order_by(Sentence.id))).scalars())
    body = {"unit_id": uid, "session_seconds": 60, "client_batch_id": "b1", "answers": [
        {"sentence_id": sids[0], "stage": "arrange", "is_correct": True},
        {"sentence_id": sids[0], "stage": "dictation", "is_correct": False, "answer": "dog are friend"},
        {"sentence_id": sids[1], "stage": "exam", "is_correct": True},
    ]}
    r = await client.post("/api/v1/student/sentences/records", json=body, headers=h)
    assert r.status_code == 200, r.text
    rows = {m.sentence_id: m for m in (await db_session.execute(select(SentenceMastery))).scalars()}
    assert rows[sids[0]].total_encounters == 2 and rows[sids[0]].wrong_count == 1
    assert rows[sids[0]].last_wrong_answer == "dog are friend"
    assert rows[sids[0]].next_review_at is None          # 连词/默写不排复习
    assert rows[sids[1]].next_review_at is not None      # 过关检测排复习
    # 重发同一批不重复记
    await client.post("/api/v1/student/sentences/records", json=body, headers=h)
    await db_session.refresh(rows[sids[0]])
    assert rows[sids[0]].total_encounters == 2
    # 别的单元的句子不收
    other_sid = (await db_session.execute(
        select(Sentence.id).where(Sentence.unit_id == env["units"]["other"].id))).scalar_one()
    bad = {"unit_id": uid, "answers": [{"sentence_id": other_sid, "stage": "exam", "is_correct": True}]}
    assert (await client.post("/api/v1/student/sentences/records", json=bad, headers=h)).status_code == 400


async def test_group_pass_progress(client, env, db_session):
    h = _hdr(env["stu"])
    uid = env["units"]["pub"].id
    url = f"/api/v1/student/sentences/units/{uid}/group-pass"
    total = len((await client.get(f"/api/v1/student/sentences/units/{uid}/learn", headers=h)).json()["groups"])
    assert (await client.post(url, json={"group_index": 0, "score": 70}, headers=h)).status_code == 400
    r = await client.post(url, json={"group_index": 0, "score": 90}, headers=h)
    assert r.json()["groups_passed"] == 1 and not r.json()["unit_completed"]
    # 回头重学第 1 组不倒退断点
    for gi in range(1, total):
        await client.post(url, json={"group_index": gi, "score": 100}, headers=h)
    r = await client.post(url, json={"group_index": 0, "score": 85}, headers=h)
    assert r.json()["groups_passed"] == total and r.json()["unit_completed"]
    body = (await client.get(f"/api/v1/student/sentences/units/{uid}/learn", headers=h)).json()
    assert body["groups_passed"] == total and body["completed"] is True
    assert (await client.post(url, json={"group_index": total, "score": 100}, headers=h)).status_code == 400
