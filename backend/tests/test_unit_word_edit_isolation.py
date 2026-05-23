"""教师在单元里编辑单词时的隔离行为(fork-on-edit)测试。

测试矩阵:
1. 只被 1 个单元引用 → in-place 修改,不 fork
2. 被多个单元引用 → fork 出新 Word + Definition + Tag,只有当前单元改变
3. fork 后,响应里 forked=True 且 word_id 是新 id
4. fork 后,新 Word 行复制了原始字段(对编辑 payload 中没改的字段保持继承)
5. 单词列表去重(同名只显示一行)
6. 创建已存在拼写返回已有那条
"""
from sqlalchemy import select, func
from app.models.word import Word, WordDefinition, WordTag, WordBook, Unit, UnitWord
from app.models.user import User


async def _make_teacher(db_session) -> User:
    u = User(
        username="t1",
        email="t1@example.com",
        hashed_password="x",
        role="teacher",
        full_name="T1",
        is_active=True,
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


async def _make_book_units_word(
    db_session,
    *,
    word_text="who",
    phonetic="/huː/",
    meaning="谁",
    unit_count=2,
):
    """造一本书 + N 个单元,所有单元都引用同一个 Word。返回 (book, units, word)。"""
    book = WordBook(name="B", grade_level="一年级")
    db_session.add(book)
    await db_session.flush()

    word = Word(word=word_text, phonetic=phonetic)
    db_session.add(word)
    await db_session.flush()

    db_session.add(WordDefinition(
        word_id=word.id, part_of_speech="pron.",
        meaning=meaning, is_primary=True,
    ))
    db_session.add(WordTag(word_id=word.id, tag="代词"))

    units = []
    for i in range(unit_count):
        u = Unit(book_id=book.id, unit_number=i + 1, name=f"Unit {i+1}")
        db_session.add(u)
        await db_session.flush()
        db_session.add(UnitWord(unit_id=u.id, word_id=word.id, order_index=0))
        units.append(u)

    await db_session.commit()
    return book, units, word


async def _login_as(client, db_session, teacher: User) -> str:
    """绕过登录:直接生成 JWT。"""
    from app.services.auth_service import create_access_token
    return create_access_token({"sub": str(teacher.id)})


# ---------- 用例 1: 只被 1 个单元引用,不 fork ----------

async def test_edit_when_only_one_unit_references_word_does_not_fork(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    book, units, word = await _make_book_units_word(db_session, unit_count=1)
    unit = units[0]

    res = await client.put(
        f"/api/v1/teacher/units/{unit.id}/words/{word.id}",
        json={"phonetic": "/huː/changed", "meaning": "改后的释义"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["forked"] is False
    assert body["word_id"] == word.id

    uw = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit.id)
    )).scalar_one()
    assert uw.word_id == word.id

    await db_session.refresh(word)
    assert word.phonetic == "/huː/changed"

    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "who")
    )).scalar()
    assert n == 1


# ---------- 用例 2: 被多个单元引用,fork ----------

async def test_edit_when_multiple_units_reference_word_forks(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    book, units, word = await _make_book_units_word(db_session, unit_count=2)
    unit_a, unit_b = units

    res = await client.put(
        f"/api/v1/teacher/units/{unit_a.id}/words/{word.id}",
        json={"phonetic": "/huː-A/", "meaning": "A 单元的释义"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["forked"] is True
    new_id = body["word_id"]
    assert new_id != word.id

    uw_a = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_a.id)
    )).scalar_one()
    uw_b = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_b.id)
    )).scalar_one()
    assert uw_a.word_id == new_id
    assert uw_b.word_id == word.id

    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "who")
    )).scalar()
    assert n == 2

    new_word = (await db_session.execute(
        select(Word).where(Word.id == new_id)
    )).scalar_one()
    assert new_word.phonetic == "/huː-A/"

    await db_session.refresh(word)
    assert word.phonetic == "/huː/"

    new_defs = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == new_id)
    )).scalars().all()
    assert len(new_defs) == 1
    assert new_defs[0].meaning == "A 单元的释义"
    assert new_defs[0].is_primary is True

    old_defs = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == word.id)
    )).scalars().all()
    assert len(old_defs) == 1
    assert old_defs[0].meaning == "谁"

    new_tags = (await db_session.execute(
        select(WordTag).where(WordTag.word_id == new_id)
    )).scalars().all()
    assert {t.tag for t in new_tags} == {"代词"}


# ---------- 用例 3: B 单元不受 A 单元编辑影响 ----------

async def test_other_unit_unaffected_after_fork(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    book, units, word = await _make_book_units_word(db_session, unit_count=2)
    unit_a, unit_b = units
    original_phonetic = word.phonetic

    await client.put(
        f"/api/v1/teacher/units/{unit_a.id}/words/{word.id}",
        json={"phonetic": "/huː-A/"},
        headers={"Authorization": f"Bearer {token}"},
    )

    uw_b = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_b.id)
    )).scalar_one()
    word_b = (await db_session.execute(
        select(Word).where(Word.id == uw_b.word_id)
    )).scalar_one()
    assert word_b.phonetic == original_phonetic


# ---------- 用例 4: fork 后,新 Word 拷贝了原始字段 ----------

async def test_fork_copies_all_word_fields(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    book, units, word = await _make_book_units_word(db_session, unit_count=2)
    word.tts_text = "who pronounced"
    word.syllables = "who"
    word.difficulty = 2
    word.grade_level = "小学"
    await db_session.commit()
    unit_a, _ = units

    res = await client.put(
        f"/api/v1/teacher/units/{unit_a.id}/words/{word.id}",
        json={"meaning": "改后的释义"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    new_id = res.json()["word_id"]
    new_word = (await db_session.execute(
        select(Word).where(Word.id == new_id)
    )).scalar_one()
    assert new_word.tts_text == "who pronounced"
    assert new_word.syllables == "who"
    assert new_word.difficulty == 2
    assert new_word.grade_level == "小学"
    assert new_word.phonetic == "/huː/"


# ---------- 用例 5: 搜索结果按 word 去重 ----------

async def test_word_list_deduplicates_after_fork(client, db_session):
    """fork 之后,GET /words 搜索同名拼写只返回一行。"""
    w1 = Word(word="apple", phonetic="/ˈæpl/")
    w2 = Word(word="apple", phonetic="/ˈæpl/B")
    db_session.add_all([w1, w2])
    await db_session.commit()

    res = await client.get("/api/v1/words/?search=apple&limit=100")
    assert res.status_code == 200
    body = res.json()
    apples = [w for w in body if (w["word"] or "").lower() == "apple"]
    assert len(apples) == 1


# ---------- 用例 6: 创建已存在拼写不会报错 ----------

async def test_create_word_with_existing_spelling_returns_existing(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login_as(client, db_session, teacher)
    db_session.add(Word(word="dog", phonetic="/dɔɡ/"))
    await db_session.commit()
    res = await client.post(
        "/api/v1/words/",
        json={
            "word": "dog",
            "phonetic": "/dɔɡ/",
            "difficulty": 1,
            "definitions": [{"part_of_speech": "n.", "meaning": "狗", "is_primary": True}],
            "tags": []
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code in (200, 201), res.text
    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "dog")
    )).scalar()
    assert n == 1
