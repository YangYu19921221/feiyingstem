"""管理端 / 教师端「词汇总量」「单元数」删了书 / 单元 / 单元里的词要跟着少(services/word_stats)。

以前数的是 words / units 整张表: 删书只删书那一行(生产外键关着,单元和词条都留着),数字只涨不跌。
测试库也是 create_all 建的、外键没开,和生产一样: 删书以后它的单元行还在。
"""
import pytest
from sqlalchemy import func, select, text as sql_text

from app.core import tenancy
from app.models.user import User
from app.models.word import BookWord, Unit, UnitWord, Word, WordBook
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _env(db):
    tenancy._org_cache.clear()
    await db.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(1, '直营', 'HQ001', 'active', 'assigned')"))
    admin = User(username="wsadmin", email="wsadmin@e.com", hashed_password="x", role="admin", is_active=True, org_id=1)
    teacher = User(username="wsteacher", email="wst@e.com", hashed_password="x", role="teacher", is_active=True, org_id=1)
    db.add_all([admin, teacher])
    await db.flush()
    words = {}
    for key, spell in [("w1", "apple"), ("w2", "banana"), ("w3", "cat"), ("w4", "Apple"), ("w5", "dog")]:
        w = Word(word=spell)
        db.add(w)
        await db.flush()
        words[key] = w
    a = WordBook(name="A", is_public=True)
    b = WordBook(name="B", is_public=True)
    db.add_all([a, b])
    await db.flush()
    u1 = Unit(book_id=a.id, unit_number=1, name="U1")
    u2 = Unit(book_id=a.id, unit_number=2, name="U2")
    u3 = Unit(book_id=b.id, unit_number=1, name="U3")
    db.add_all([u1, u2, u3])
    await db.flush()
    db.add_all([
        UnitWord(unit_id=u1.id, word_id=words["w1"].id),
        UnitWord(unit_id=u1.id, word_id=words["w2"].id),
        UnitWord(unit_id=u2.id, word_id=words["w3"].id),
        UnitWord(unit_id=u3.id, word_id=words["w4"].id),
        # 书上直接挂的词(不在任何单元里)也算
        BookWord(book_id=b.id, word_id=words["w5"].id),
        # 同一个词条既在单元里又挂在书上: 只算一次
        BookWord(book_id=a.id, word_id=words["w1"].id),
    ])
    ids = {"admin": admin.id, "teacher": teacher.id, "a": a.id, "b": b.id, "u1": u1.id, "u2": u2.id, "u3": u3.id,
           "words": {k: w.id for k, w in words.items()}}
    await db.commit()
    # 只留 id: 接口提交以后会话里的对象会过期,再读 .id 会去查库(异步会话里报 MissingGreenlet)
    return ids


async def _counts(client, e):
    s = (await client.get("/api/v1/admin/stats", headers=_h(e["admin"]))).json()
    c = (await client.get("/api/v1/admin/content/stats", headers=_h(e["admin"]))).json()
    t = (await client.get("/api/v1/teacher/dashboard/stats", headers=_h(e["teacher"]))).json()
    # 三处必须同一个数
    assert s["total_words"] == c["words"] == t["total_words"]
    assert s["total_units"] == c["units"] and s["distinct_words"] == c["distinct_words"]
    return s["total_words"], s["distinct_words"], s["total_units"]


@pytest.mark.asyncio
async def test_word_and_unit_totals_drop_after_deletes(client, db_session):
    e = await _env(db_session)
    # 5 个词条(apple 和 Apple 是两本书各自的词条),4 个不同单词,3 个单元
    assert await _counts(client, e) == (5, 4, 3)

    # 删一个单元: 它里面的 cat 不再算
    r = await client.delete(f"/api/v1/teacher/units/{e['u2']}", headers=_h(e["teacher"]))
    assert r.status_code == 204
    assert await _counts(client, e) == (4, 3, 2)

    # 从单元里移走一个词
    r = await client.delete(f"/api/v1/teacher/units/{e['u1']}/words/{e['words']['w2']}",
                            headers=_h(e["teacher"]))
    assert r.status_code == 204
    assert await _counts(client, e) == (3, 2, 2)

    # 删一本书: 它的单元行还留在库里(外键关着),但它的词和单元都不再算
    r = await client.delete(f"/api/v1/admin/content/word-books/{e['b']}", headers=_h(e["admin"]))
    assert r.status_code == 200
    db_session.expire_all()
    assert (await db_session.execute(select(func.count()).select_from(Unit)
                                     .where(Unit.book_id == e["b"]))).scalar() == 1
    assert await _counts(client, e) == (1, 1, 1)

    # 词条行本身没删(学生的学习记录还指着它们)
    assert (await db_session.execute(select(func.count()).select_from(Word))).scalar() == 5
