"""老师"上传单词到某本书"时的隔离行为 (fork-on-upload)。

设计:
- 上传时如果带 book_id, 走"book 范围"语义:
    * 本书内已有同拼写 → 覆盖那条
    * 本书内没有同拼写, 但别的书引用了 → 新建 Word, 不污染他书
    * 本书内没有同拼写, 也没人引用 → 新建 Word
    * 本书内有同拼写, 但同时被别的书引用 → fork 一个新 Word, 把本书指过去
- 不带 book_id (走老的"词库直传"入口) → 维持全局去重 + 覆盖, 不退化
"""
from sqlalchemy import select, func
from app.models.word import Word, WordDefinition, WordTag, WordBook, BookWord
from app.models.user import User


async def _make_teacher(db_session) -> User:
    u = User(
        username="t1", email="t1@example.com", hashed_password="x",
        role="teacher", full_name="T1", is_active=True,
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


async def _make_book(db_session, name: str) -> WordBook:
    b = WordBook(name=name, grade_level="一年级")
    db_session.add(b)
    await db_session.commit()
    await db_session.refresh(b)
    return b


async def _login(client, db_session, teacher: User) -> str:
    from app.services.auth_service import create_access_token
    return create_access_token({"sub": str(teacher.id)})


def _word_payload(spelling, meaning, *, phonetic="/x/", example=""):
    return {
        "word": spelling,
        "phonetic": phonetic,
        "difficulty": 1,
        "definitions": [{
            "part_of_speech": "n.",
            "meaning": meaning,
            "example_sentence": example,
            "example_translation": "",
            "is_primary": True,
        }],
        "tags": [],
    }


async def _ids_in_book(db_session, book_id, spelling):
    rows = (await db_session.execute(
        select(Word.id).join(BookWord, BookWord.word_id == Word.id)
        .where(BookWord.book_id == book_id)
        .where(func.lower(Word.word) == spelling.lower())
    )).all()
    return [r[0] for r in rows]


async def _meaning_of(db_session, word_id):
    return (await db_session.execute(
        select(WordDefinition.meaning)
        .where(WordDefinition.word_id == word_id)
        .where(WordDefinition.is_primary.is_(True))
    )).scalar_one()


async def test_upload_same_spelling_to_two_books_keeps_them_isolated(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(client, db_session, teacher)
    book_a = await _make_book(db_session, "BookA")
    book_b = await _make_book(db_session, "BookB")
    headers = {"Authorization": f"Bearer {token}"}

    r1 = await client.post(
        f"/api/v1/words/?book_id={book_a.id}",
        json=_word_payload("apple", "苹果A"), headers=headers,
    )
    assert r1.status_code in (200, 201), r1.text
    wa = r1.json()["id"]

    r2 = await client.post(
        f"/api/v1/words/?book_id={book_b.id}",
        json=_word_payload("apple", "果实B"), headers=headers,
    )
    assert r2.status_code in (200, 201), r2.text
    wb = r2.json()["id"]

    assert wa != wb
    assert await _ids_in_book(db_session, book_a.id, "apple") == [wa]
    assert await _ids_in_book(db_session, book_b.id, "apple") == [wb]
    assert await _meaning_of(db_session, wa) == "苹果A"
    assert await _meaning_of(db_session, wb) == "果实B"


async def test_delete_in_book_a_then_reupload_does_not_touch_book_b(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(client, db_session, teacher)
    book_a = await _make_book(db_session, "BookA")
    book_b = await _make_book(db_session, "BookB")
    headers = {"Authorization": f"Bearer {token}"}

    wa1 = (await client.post(
        f"/api/v1/words/?book_id={book_a.id}",
        json=_word_payload("dog", "狗A1"), headers=headers,
    )).json()["id"]
    wb = (await client.post(
        f"/api/v1/words/?book_id={book_b.id}",
        json=_word_payload("dog", "狗B"), headers=headers,
    )).json()["id"]
    assert wa1 != wb

    await db_session.execute(
        BookWord.__table__.delete().where(BookWord.book_id == book_a.id, BookWord.word_id == wa1)
    )
    await db_session.commit()

    wa2 = (await client.post(
        f"/api/v1/words/?book_id={book_a.id}",
        json=_word_payload("dog", "狗A2新"), headers=headers,
    )).json()["id"]

    assert wa2 != wb
    assert await _meaning_of(db_session, wb) == "狗B"
    assert await _meaning_of(db_session, wa2) == "狗A2新"


async def test_legacy_shared_word_gets_forked_when_uploaded_to_one_book(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(client, db_session, teacher)
    book_a = await _make_book(db_session, "BookA")
    book_b = await _make_book(db_session, "BookB")
    shared = Word(word="cat", phonetic="/old/")
    db_session.add(shared)
    await db_session.flush()
    db_session.add(WordDefinition(
        word_id=shared.id, part_of_speech="n.",
        meaning="老共享-猫", is_primary=True,
    ))
    db_session.add(BookWord(book_id=book_a.id, word_id=shared.id, order_index=0))
    db_session.add(BookWord(book_id=book_b.id, word_id=shared.id, order_index=0))
    await db_session.commit()
    shared_id = shared.id

    r = await client.post(
        f"/api/v1/words/?book_id={book_a.id}",
        json=_word_payload("cat", "猫A新"), headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (200, 201), r.text
    wa_new = r.json()["id"]

    assert wa_new != shared_id
    assert await _ids_in_book(db_session, book_a.id, "cat") == [wa_new]
    assert await _ids_in_book(db_session, book_b.id, "cat") == [shared_id]
    assert await _meaning_of(db_session, shared_id) == "老共享-猫"
    assert await _meaning_of(db_session, wa_new) == "猫A新"


async def test_upload_same_spelling_within_same_book_overwrites(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(client, db_session, teacher)
    book = await _make_book(db_session, "BookA")
    headers = {"Authorization": f"Bearer {token}"}

    w1 = (await client.post(
        f"/api/v1/words/?book_id={book.id}",
        json=_word_payload("fox", "狐旧", example="Old fox."), headers=headers,
    )).json()["id"]
    w2 = (await client.post(
        f"/api/v1/words/?book_id={book.id}",
        json=_word_payload("fox", "狐新"), headers=headers,
    )).json()["id"]

    assert w1 == w2
    defs = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == w1)
    )).scalars().all()
    assert len(defs) == 1
    assert defs[0].meaning == "狐新"
    assert (defs[0].example_sentence or "") == ""


async def test_upload_without_book_id_keeps_global_overwrite(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(client, db_session, teacher)
    headers = {"Authorization": f"Bearer {token}"}
    old = Word(word="run", phonetic="/old/")
    db_session.add(old)
    await db_session.flush()
    db_session.add(WordDefinition(
        word_id=old.id, part_of_speech="v.", meaning="跑旧", is_primary=True,
    ))
    await db_session.commit()
    old_id = old.id

    r = await client.post(
        "/api/v1/words/",
        json=_word_payload("run", "跑新", phonetic="/run/"), headers=headers,
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["id"] == old_id
    assert await _meaning_of(db_session, old_id) == "跑新"
