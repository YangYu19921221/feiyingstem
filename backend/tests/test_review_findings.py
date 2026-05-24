"""审查发现的三处 critical 行为的 failing tests。

#1 list_words: SQL 层应按 lower(word) dedup,SQL 层做分页 → page size 等于 limit、不重复、不漏。
#4 update_word_in_unit: 空字符串字段视为「未提交」,不抹掉原值。
#2 fork 触发: ref count 应按引用该 word 的 *book* 数,而非 unit 数。
"""
import pytest
from sqlalchemy import select, func

from app.models.word import Word, WordDefinition, WordTag, WordBook, Unit, UnitWord
from app.models.user import User


async def _make_teacher(db_session) -> User:
    u = User(
        username="t-rev",
        email="t-rev@example.com",
        hashed_password="x",
        role="teacher",
        full_name="T",
        is_active=True,
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


async def _login_as(client, db_session, teacher: User) -> str:
    from app.services.auth_service import create_access_token
    return create_access_token({"sub": str(teacher.id)})


# ---------- #1: list_words 分页 ----------

async def test_list_words_pagination_with_duplicate_spellings(client, db_session):
    """
    20 个不同拼写,其中 5 个拼写各有一个 fork 副本(共 25 行)。
    前端按 limit=10 翻页,应该:
      - 三页累计返回 20 条不同拼写
      - 同拼写最多出现一次
      - 不漏拼写、不重复
    """
    spellings = [f"word{i:02d}" for i in range(20)]
    for s in spellings:
        db_session.add(Word(word=s, phonetic=f"/{s}/"))
    for s in spellings[:5]:
        db_session.add(Word(word=s, phonetic=f"/{s}/fork"))
    await db_session.commit()

    seen = []
    for skip in (0, 10, 20):
        res = await client.get(f"/api/v1/words/?skip={skip}&limit=10")
        assert res.status_code == 200, res.text
        page = res.json()
        seen.extend(w["word"] for w in page)

    assert len(seen) == len(set(seen)), f"翻页出现重复: {seen}"
    assert set(seen) == set(spellings), (
        f"漏了拼写:期望 {sorted(spellings)},实际 {sorted(seen)}"
    )


# ---------- #4: 空字符串不应抹掉原值 ----------

async def test_edit_word_empty_string_field_does_not_overwrite(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    book = WordBook(name="B", grade_level="一年级")
    db_session.add(book)
    await db_session.flush()

    word = Word(word="hello", phonetic="/həˈloʊ/")
    db_session.add(word)
    await db_session.flush()
    db_session.add(WordDefinition(
        word_id=word.id, part_of_speech="int.",
        meaning="你好", is_primary=True,
    ))
    unit = Unit(book_id=book.id, unit_number=1, name="U1")
    db_session.add(unit)
    await db_session.flush()
    db_session.add(UnitWord(unit_id=unit.id, word_id=word.id, order_index=0))
    await db_session.commit()

    res = await client.put(
        f"/api/v1/teacher/units/{unit.id}/words/{word.id}",
        json={"phonetic": "", "meaning": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text

    await db_session.refresh(word)
    assert word.phonetic == "/həˈloʊ/", "空字符串不应覆盖原音标"

    d = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == word.id)
    )).scalar_one()
    assert d.meaning == "你好", "空字符串不应覆盖原释义"


# ---------- #2: fork 触发应按 *book* 计数,而非 unit ----------

async def test_no_fork_when_only_one_book_uses_word_even_if_two_units(client, db_session):
    """同书内多个 unit 共享 word,编辑应 in-place,不 fork。"""
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)

    book = WordBook(name="B", grade_level="一年级")
    db_session.add(book)
    await db_session.flush()
    word = Word(word="apple", phonetic="/ˈæpl/")
    db_session.add(word)
    await db_session.flush()
    db_session.add(WordDefinition(
        word_id=word.id, part_of_speech="n.",
        meaning="苹果", is_primary=True,
    ))
    unit_a = Unit(book_id=book.id, unit_number=1, name="U1")
    unit_b = Unit(book_id=book.id, unit_number=2, name="U2")
    db_session.add_all([unit_a, unit_b])
    await db_session.flush()
    db_session.add(UnitWord(unit_id=unit_a.id, word_id=word.id, order_index=0))
    db_session.add(UnitWord(unit_id=unit_b.id, word_id=word.id, order_index=0))
    await db_session.commit()

    res = await client.put(
        f"/api/v1/teacher/units/{unit_a.id}/words/{word.id}",
        json={"phonetic": "/ˈæpl/changed"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["forked"] is False, "同 book 共享时应 in-place,不 fork"
    assert body["word_id"] == word.id

    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "apple")
    )).scalar()
    assert n == 1

    uw_b = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_b.id)
    )).scalar_one()
    assert uw_b.word_id == word.id

    await db_session.refresh(word)
    assert word.phonetic == "/ˈæpl/changed"


async def test_fork_when_two_books_share_word(client, db_session):
    """跨 book 共享 word,编辑应 fork 出新副本只给当前 book。"""
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)

    book_a = WordBook(name="A", grade_level="一年级")
    book_b = WordBook(name="B", grade_level="二年级")
    db_session.add_all([book_a, book_b])
    await db_session.flush()
    word = Word(word="banana", phonetic="/bəˈnænə/")
    db_session.add(word)
    await db_session.flush()
    db_session.add(WordDefinition(
        word_id=word.id, part_of_speech="n.",
        meaning="香蕉", is_primary=True,
    ))
    unit_a = Unit(book_id=book_a.id, unit_number=1, name="A-U1")
    unit_b = Unit(book_id=book_b.id, unit_number=1, name="B-U1")
    db_session.add_all([unit_a, unit_b])
    await db_session.flush()
    db_session.add(UnitWord(unit_id=unit_a.id, word_id=word.id, order_index=0))
    db_session.add(UnitWord(unit_id=unit_b.id, word_id=word.id, order_index=0))
    await db_session.commit()

    res = await client.put(
        f"/api/v1/teacher/units/{unit_a.id}/words/{word.id}",
        json={"phonetic": "/bəˈnænə/A"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["forked"] is True, "跨 book 应 fork"
    new_id = body["word_id"]
    assert new_id != word.id

    uw_b = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_b.id)
    )).scalar_one()
    assert uw_b.word_id == word.id, "另一 book 应仍指原 word"
    await db_session.refresh(word)
    assert word.phonetic == "/bəˈnænə/", "另一 book 看到的原 word 不应被改"
