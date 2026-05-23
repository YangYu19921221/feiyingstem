# 教师编辑单元单词的隔离 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让教师在「单元管理」里编辑一个单词时,只影响本单元,不传染到引用同一拼写的其他单元。

**Architecture:** Fork-on-edit。去掉 `words.word` 的全局 UNIQUE 约束;编辑端点先看该 word_id 被几个单元引用,只被 1 个就直接改,被多个就复制一份新 `Word + WordDefinition + WordTag` 给当前单元独占,然后把编辑写到新副本。读取路径全部按 `word_id` 走,不需要改。

**Tech Stack:** FastAPI + SQLAlchemy(async) + SQLite + pytest + httpx + React + TypeScript

**Spec:** `docs/superpowers/specs/2026-05-23-unit-word-edit-isolation-design.md`

---

## 文件清单

### 后端
- **创建** `backend/migrations/011_drop_word_unique.sql` — SQLite 重建 `words` 表去掉 UNIQUE
- **创建** `backend/run_migration_011.py` — 一次性迁移执行脚本(参考 `run_migration.py` 模式)
- **修改** `backend/app/models/word.py:9` — `word` 字段 `unique=True` → `index=True`
- **修改** `backend/app/api/v1/teacher/units.py:396-453` — 重写 `update_word_in_unit`,加 fork 逻辑
- **修改** `backend/app/api/v1/pronunciation.py:130` — `scalar_one_or_none` → `scalars().first()`
- **修改** `backend/app/api/v1/words.py:288` — 创建单词查重改用 `first()`
- **修改** `backend/app/api/v1/words.py:370-376` — 搜索结果按 `word` 字符串去重
- **修改** `backend/app/api/v1/words.py:533` — 批量导入查重改用 `first()`
- **修改** `backend/app/api/v1/teacher/exam_generator.py:286-289` — 按字符串找 word_id 改用 `first()`
- **创建** `backend/tests/__init__.py` — 空文件
- **创建** `backend/tests/conftest.py` — pytest 共用 fixture(临时 DB + 异步 client)
- **创建** `backend/tests/test_unit_word_edit_isolation.py` — 完整测试套件

### 前端
- **修改** `frontend/src/api/teacher.ts:155-171` — `updateWordInUnit` 返回类型补 `{forked, word_id}`,并返回 response 对象
- **修改** `frontend/src/pages/TeacherUnitManagement.tsx:244-262` — 保存后读 `forked`,fork 时显示特殊 toast

---

## Task 1: 建立后端 pytest 基础设施

我们没有现成的 pytest 配置,而后续测试需要异步数据库 fixture。先把基础打好。

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/pytest.ini`

- [ ] **Step 1: 创建空的 `__init__.py`**

Run: `touch backend/tests/__init__.py`

- [ ] **Step 2: 创建 `backend/pytest.ini`**

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 3: 创建 `backend/tests/conftest.py`**

```python
"""pytest 共用 fixture:为每个测试函数提供独立的内存数据库 + AsyncClient。"""
import asyncio
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app.models import user as _user_models  # noqa: F401 触发表元数据加载
from app.models import word as _word_models  # noqa: F401
from app.models import learning as _learning_models  # noqa: F401


@pytest_asyncio.fixture
async def db_session():
    """每个测试一个全新的内存数据库。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with SessionLocal() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session):
    """覆盖 get_db 依赖,提供已就绪的 AsyncClient。"""
    async def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 4: 安装可能缺失的测试依赖**

Run: `cd backend && source venv/bin/activate && pip install pytest pytest-asyncio httpx aiosqlite`
Expected: 安装成功或显示"already satisfied"

- [ ] **Step 5: 写一个 sanity test 确认基础工作**

Create: `backend/tests/test_sanity.py`

```python
"""验证 pytest 异步 fixture 工作。"""
import pytest
from sqlalchemy import select
from app.models.word import Word


async def test_db_session_works(db_session):
    db_session.add(Word(word="hello"))
    await db_session.commit()
    result = await db_session.execute(select(Word).where(Word.word == "hello"))
    assert result.scalar_one().word == "hello"


async def test_client_works(client):
    response = await client.get("/")
    assert response.status_code in (200, 404)  # 看 main.py 是否暴露根路径
```

- [ ] **Step 6: 跑 sanity test**

Run: `cd backend && source venv/bin/activate && pytest tests/test_sanity.py -v`
Expected: 2 个测试 PASS

- [ ] **Step 7: 提交**

```bash
git add backend/tests/__init__.py backend/tests/conftest.py backend/tests/test_sanity.py backend/pytest.ini
git commit -m "chore(test): add pytest async infrastructure"
```

---

## Task 2: 写迁移文件 011 — 去掉 `words.word` 的 UNIQUE 约束

**Files:**
- Create: `backend/migrations/011_drop_word_unique.sql`
- Create: `backend/run_migration_011.py`

- [ ] **Step 1: 创建迁移 SQL**

Create: `backend/migrations/011_drop_word_unique.sql`

```sql
-- Migration: 011
-- Date: 2026-05-23
-- Description: 去掉 words.word 的 UNIQUE 约束(改为普通索引),
--              为「教师在单元里编辑单词时 fork 出独立副本」铺路。
-- 回滚提示:回滚到 010 前需要先去重 (DELETE 重复 word) 否则恢复 UNIQUE 会失败。

BEGIN TRANSACTION;

CREATE TABLE words_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word VARCHAR(100) NOT NULL,
    phonetic VARCHAR(100),
    syllables VARCHAR(200),
    tts_text VARCHAR(200),
    difficulty INTEGER DEFAULT 3,
    grade_level VARCHAR(20),
    audio_url VARCHAR(255),
    image_url VARCHAR(255),
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO words_new (id, word, phonetic, syllables, tts_text, difficulty, grade_level, audio_url, image_url, created_by, created_at, updated_at)
SELECT id, word, phonetic, syllables, tts_text, difficulty, grade_level, audio_url, image_url, created_by, created_at, updated_at FROM words;

DROP TABLE words;
ALTER TABLE words_new RENAME TO words;

CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);

COMMIT;
```

- [ ] **Step 2: 创建迁移执行脚本**

Create: `backend/run_migration_011.py`

```python
"""执行 011 迁移:去掉 words.word UNIQUE 约束。
运行方式: python run_migration_011.py
"""
import sqlite3
from pathlib import Path


def run():
    db_path = Path(__file__).parent / "english_helper.db"
    sql_path = Path(__file__).parent / "migrations" / "011_drop_word_unique.sql"

    if not db_path.exists():
        print(f"❌ 数据库不存在: {db_path}")
        return False
    if not sql_path.exists():
        print(f"❌ 迁移文件不存在: {sql_path}")
        return False

    sql = sql_path.read_text(encoding="utf-8")

    conn = sqlite3.connect(db_path)
    try:
        # 整段一次性执行,因为是单事务
        conn.executescript(sql)
        conn.commit()
        print("✅ 011 迁移执行成功")

        # 校验
        cur = conn.cursor()
        cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='words'")
        table_sql = cur.fetchone()[0]
        if "UNIQUE" in table_sql.upper().split("(", 1)[0] or "word VARCHAR(100) UNIQUE" in table_sql:
            print(f"⚠️  仍能在表 DDL 中看到 UNIQUE:\n{table_sql}")
            return False
        print(f"📋 当前 words 表 DDL:\n{table_sql}")
        return True
    except sqlite3.Error as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    print("🚀 开始执行 011 迁移...")
    ok = run()
    print("✨ 成功" if ok else "💥 失败")
```

- [ ] **Step 3: 备份后执行**

```bash
cd backend
cp english_helper.db english_helper.db.bak_pre_011
source venv/bin/activate
python run_migration_011.py
```
Expected:
- 输出 "✅ 011 迁移执行成功"
- 输出的 `words` 表 DDL 中,`word` 列后面没有 `UNIQUE` 关键字
- 没有 "⚠️" 警告

- [ ] **Step 4: 用 sqlite3 二次校验**

```bash
cd backend
sqlite3 english_helper.db ".schema words"
```
Expected: 看到 `word VARCHAR(100) NOT NULL,`(没有 UNIQUE),并且文件末尾有 `CREATE INDEX idx_words_word ON words(word);`

- [ ] **Step 5: 测试可以插入同名单词**

```bash
cd backend
sqlite3 english_helper.db "INSERT INTO words (word) VALUES ('__test_dup__'); INSERT INTO words (word) VALUES ('__test_dup__'); SELECT COUNT(*) FROM words WHERE word='__test_dup__'; DELETE FROM words WHERE word='__test_dup__';"
```
Expected: 输出 `2`(成功插入两行同名)。

- [ ] **Step 6: 提交**

```bash
git add backend/migrations/011_drop_word_unique.sql backend/run_migration_011.py
git commit -m "feat(db): migration 011 drop words.word UNIQUE constraint"
```

---

## Task 3: 同步 SQLAlchemy 模型:`unique=True` → `index=True`

**Files:**
- Modify: `backend/app/models/word.py:9`

- [ ] **Step 1: 修改模型**

Edit `backend/app/models/word.py:9`,把:
```python
    word = Column(String(100), unique=True, nullable=False)
```
改成:
```python
    word = Column(String(100), nullable=False, index=True)
```

- [ ] **Step 2: 跑 sanity test 验证没把基础打坏**

Run: `cd backend && source venv/bin/activate && pytest tests/test_sanity.py -v`
Expected: 2 个测试 PASS

- [ ] **Step 3: 写一个针对模型本身的回归测试**

Append to `backend/tests/test_sanity.py`:
```python
async def test_word_no_longer_unique(db_session):
    """模型层允许同一拼写多行。"""
    db_session.add(Word(word="who"))
    db_session.add(Word(word="who"))
    await db_session.commit()
    from sqlalchemy import select, func
    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "who")
    )).scalar()
    assert n == 2
```

- [ ] **Step 4: 跑测试**

Run: `cd backend && source venv/bin/activate && pytest tests/test_sanity.py::test_word_no_longer_unique -v`
Expected: PASS(因为 conftest 用 `Base.metadata.create_all` 重建表,会使用新模型定义,无 UNIQUE)

- [ ] **Step 5: 提交**

```bash
git add backend/app/models/word.py backend/tests/test_sanity.py
git commit -m "feat(model): drop unique on Word.word, keep as index"
```

---

## Task 4: 写 fork-on-edit 的核心测试(TDD,失败用例)

我们先把测试写完,后面 Task 5 让它们通过。这样代码意图通过测试固化下来。

**Files:**
- Create: `backend/tests/test_unit_word_edit_isolation.py`

- [ ] **Step 1: 创建测试文件 + 共用 helper**

Create: `backend/tests/test_unit_word_edit_isolation.py`

```python
"""教师在单元里编辑单词时的隔离行为(fork-on-edit)测试。

测试矩阵:
1. 只被 1 个单元引用 → in-place 修改,不 fork
2. 被多个单元引用 → fork 出新 Word + Definition + Tag,只有当前单元改变
3. fork 后,响应里 forked=True 且 word_id 是新 id
4. fork 后,原 Word 行的释义/音标保持不动
"""
import pytest
from sqlalchemy import select, func
from app.models.word import Word, WordDefinition, WordTag, WordBook, Unit, UnitWord
from app.models.user import User


async def _make_teacher(db_session) -> User:
    """创建一个 teacher 用户并返回。"""
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

    db_session.add(WordDefinition(word_id=word.id, part_of_speech="pron.",
                                   meaning=meaning, is_primary=True))
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
    """绕过登录:直接生成 JWT。利用 auth_service 中的 create_access_token。"""
    from app.services.auth_service import create_access_token
    token = create_access_token({"sub": str(teacher.id), "role": "teacher"})
    return token


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

    # 单元仍指向原 word_id
    uw = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit.id)
    )).scalar_one()
    assert uw.word_id == word.id

    # 原 Word 行被改了
    await db_session.refresh(word)
    assert word.phonetic == "/huː/changed"

    # 库里 word 仍然只有一行
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

    # A 单元指向新 id;B 单元仍指向旧 id
    uw_a = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_a.id)
    )).scalar_one()
    uw_b = (await db_session.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_b.id)
    )).scalar_one()
    assert uw_a.word_id == new_id
    assert uw_b.word_id == word.id

    # 库里 "who" 应该有 2 行(原 + 新)
    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "who")
    )).scalar()
    assert n == 2

    # 新 Word 行带新音标
    new_word = (await db_session.execute(
        select(Word).where(Word.id == new_id)
    )).scalar_one()
    assert new_word.phonetic == "/huː-A/"

    # 原 Word 行没动
    await db_session.refresh(word)
    assert word.phonetic == "/huː/"

    # 新 Word 有自己的 primary WordDefinition,内容是新释义
    new_defs = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == new_id)
    )).scalars().all()
    assert len(new_defs) == 1
    assert new_defs[0].meaning == "A 单元的释义"
    assert new_defs[0].is_primary is True

    # 原 Word 的 definition 没动
    old_defs = (await db_session.execute(
        select(WordDefinition).where(WordDefinition.word_id == word.id)
    )).scalars().all()
    assert len(old_defs) == 1
    assert old_defs[0].meaning == "谁"

    # 新 Word 应该继承了 tags
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

    # 查 B 单元的展示数据(走 SQL 模拟读取路径)
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
    # 给 word 多写几个字段,验证 fork 时全字段复制
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
    # 编辑 payload 里没改 phonetic,新副本应继承原 phonetic
    assert new_word.phonetic == "/huː/"
```

- [ ] **Step 2: 跑测试,确认全部 FAIL**

Run: `cd backend && source venv/bin/activate && pytest tests/test_unit_word_edit_isolation.py -v`
Expected: 4 个测试全部 FAIL — 错误信息可能是「响应里没有 forked 字段」或「没有 fork 行为」或「JWT 失败」。这是预期。

- [ ] **Step 3: 提交(失败用例先入库,后续 task 让它们通过)**

```bash
git add backend/tests/test_unit_word_edit_isolation.py
git commit -m "test(units): failing tests for unit-word edit isolation"
```

---

## Task 5: 重写 `update_word_in_unit` 加入 fork 逻辑

**Files:**
- Modify: `backend/app/api/v1/teacher/units.py:396-453`

- [ ] **Step 1: 读现有实现,定位行号**

Run: `sed -n '390,460p' backend/app/api/v1/teacher/units.py`
Expected: 看到现有 `update_word_in_unit` 函数。

- [ ] **Step 2: 重写函数**

替换 `backend/app/api/v1/teacher/units.py:396-453` 的整段函数(从 `@router.put("/units/{unit_id}/words/{word_id}")` 到 `return {"message": "更新成功"}`):

```python
@router.put("/units/{unit_id}/words/{word_id}")
async def update_word_in_unit(
    unit_id: int,
    word_id: int,
    word_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """编辑单元中某个单词的信息。

    隔离策略(fork-on-edit):
    - 如果该 word_id 只被当前单元引用 → 直接 in-place 修改
    - 如果被多个单元引用 → 复制一份新的 Word + WordDefinition + WordTag,
      把当前单元的 unit_words 指向新副本,再把编辑应用到新副本。
      其他单元仍引用原 word_id,不受影响。

    返回 {"message", "forked", "word_id"}。
    """
    # 1. 验证 (unit_id, word_id) 关联存在
    uw_row = (await db.execute(
        select(UnitWord).where(
            and_(UnitWord.unit_id == unit_id, UnitWord.word_id == word_id)
        )
    )).scalar_one_or_none()
    if not uw_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"单词ID {word_id} 不在单元ID {unit_id} 中"
        )

    # 2. 看 word_id 被几个单元引用
    ref_count = (await db.execute(
        select(func.count()).select_from(UnitWord).where(UnitWord.word_id == word_id)
    )).scalar()

    forked = False
    target_word_id = word_id

    if ref_count > 1:
        # 3a. fork:复制 Word
        original = (await db.execute(
            select(Word).where(Word.id == word_id)
        )).scalar_one()
        new_word = Word(
            word=original.word,
            phonetic=original.phonetic,
            syllables=original.syllables,
            tts_text=original.tts_text,
            difficulty=original.difficulty,
            grade_level=original.grade_level,
            audio_url=original.audio_url,
            image_url=original.image_url,
            created_by=original.created_by,
        )
        db.add(new_word)
        await db.flush()  # 拿到 new_word.id

        # 3b. 复制 definitions
        orig_defs = (await db.execute(
            select(WordDefinition).where(WordDefinition.word_id == word_id)
        )).scalars().all()
        for d in orig_defs:
            db.add(WordDefinition(
                word_id=new_word.id,
                part_of_speech=d.part_of_speech,
                meaning=d.meaning,
                example_sentence=d.example_sentence,
                example_translation=d.example_translation,
                is_primary=d.is_primary,
            ))

        # 3c. 复制 tags
        from app.models.word import WordTag
        orig_tags = (await db.execute(
            select(WordTag).where(WordTag.word_id == word_id)
        )).scalars().all()
        for t in orig_tags:
            db.add(WordTag(word_id=new_word.id, tag=t.tag))

        # 3d. 把当前单元的 unit_words 改指向新 word_id
        uw_row.word_id = new_word.id

        await db.flush()

        target_word_id = new_word.id
        forked = True

    # 4. 把编辑应用到 target_word_id(同时支持新副本和 in-place)
    target_word = (await db.execute(
        select(Word).where(Word.id == target_word_id)
    )).scalar_one()
    for field in ['word', 'phonetic', 'syllables', 'difficulty']:
        if field in word_data and word_data[field] is not None:
            setattr(target_word, field, word_data[field])

    if any(k in word_data for k in ['meaning', 'part_of_speech', 'example_sentence', 'example_translation']):
        primary_def = (await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == target_word_id)
            .order_by(WordDefinition.is_primary.desc(), WordDefinition.id)
        )).scalars().first()

        if primary_def:
            for field in ['meaning', 'part_of_speech', 'example_sentence', 'example_translation']:
                if field in word_data:
                    setattr(primary_def, field, word_data[field])
        elif word_data.get('meaning'):
            db.add(WordDefinition(
                word_id=target_word_id,
                meaning=word_data.get('meaning', ''),
                part_of_speech=word_data.get('part_of_speech', 'n.'),
                example_sentence=word_data.get('example_sentence'),
                example_translation=word_data.get('example_translation'),
                is_primary=True,
            ))

    await db.commit()
    return {"message": "更新成功", "forked": forked, "word_id": target_word_id}
```

注意:函数顶部的 import 部分确保 `WordTag` 已经被引入(行 6 已包含 `WordDefinition`,`WordTag` 当前未引)。在 `app/api/v1/teacher/units.py:6` 把:

```python
from app.models.word import Word, WordBook, Unit, UnitWord, WordDefinition
```

改成:

```python
from app.models.word import Word, WordBook, Unit, UnitWord, WordDefinition, WordTag
```

并删掉 fork 块中那行重复的 `from app.models.word import WordTag`(避免 lint 警告)。

- [ ] **Step 3: 跑隔离测试,期望全部 PASS**

Run: `cd backend && source venv/bin/activate && pytest tests/test_unit_word_edit_isolation.py -v`
Expected: 4 个测试全部 PASS。

- [ ] **Step 4: 如果有 FAIL,看具体报错调整。常见情况:**
  - JWT 校验失败 → 检查 `auth_service.create_access_token` 的签名,以及 `get_current_teacher` 是否真从 token 拿用户。如果它会再查 DB,可能需要 conftest 里把 User 已 commit(我们已经做了)。
  - `User` 模型字段名不对 → 看 `app/models/user.py` 真实字段(可能是 `hashed_password` 而不是 `password_hash`),按真实改 `_make_teacher`。

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/v1/teacher/units.py
git commit -m "feat(teacher): fork-on-edit isolation for unit word edits"
```

---

## Task 6: 修字符串查 Word 的 5 个调用点

`words.word` 不再唯一,这 5 处必须从「最多一行」改成「取第一个」。

**Files:**
- Modify: `backend/app/api/v1/pronunciation.py:130`
- Modify: `backend/app/api/v1/words.py:288`
- Modify: `backend/app/api/v1/words.py:362-385`(搜索去重)
- Modify: `backend/app/api/v1/words.py:533`
- Modify: `backend/app/api/v1/teacher/exam_generator.py:286-289`

- [ ] **Step 1: 改 `pronunciation.py:130`**

Edit `backend/app/api/v1/pronunciation.py:130`,把:
```python
        result = await db.execute(select(Word).where(Word.word == word))
        db_word = result.scalar_one_or_none()
```
改成:
```python
        result = await db.execute(select(Word).where(Word.word == word).limit(1))
        db_word = result.scalars().first()
```

- [ ] **Step 2: 改 `words.py:288`**

Edit `backend/app/api/v1/words.py:288`,把:
```python
    result = await db.execute(select(Word).where(func.lower(Word.word) == word_data.word.strip().lower()))
    existing_word = result.scalar_one_or_none()
```
改成:
```python
    result = await db.execute(
        select(Word).where(func.lower(Word.word) == word_data.word.strip().lower()).limit(1)
    )
    existing_word = result.scalars().first()
```

- [ ] **Step 3: 改 `words.py:533`**

Edit `backend/app/api/v1/words.py:533`,把:
```python
            result = await db.execute(
                select(Word).where(func.lower(Word.word) == word_data.word.lower())
            )
            dup = result.scalar_one_or_none()
```
改成:
```python
            result = await db.execute(
                select(Word).where(func.lower(Word.word) == word_data.word.lower()).limit(1)
            )
            dup = result.scalars().first()
```

- [ ] **Step 4: 改 `words.py` 搜索去重**

定位 `backend/app/api/v1/words.py` 中 `list_words` 函数(行 ~340-413)。在 `result = await db.execute(query)` 和 `words = result.scalars().all()` 之后,加按 `word` 字符串去重(保留 id 最小那一行,代表"原始"那条):

定位 `words = result.scalars().all()`(约第 385 行),在它之后加:
```python
    # 同拼写多副本时只显示最早一条(id 最小)
    seen_lower = set()
    deduped = []
    for w in sorted(words, key=lambda x: x.id):
        key = (w.word or "").lower()
        if key in seen_lower:
            continue
        seen_lower.add(key)
        deduped.append(w)
    words = deduped
```

- [ ] **Step 5: 改 `exam_generator.py:286-289`**

Edit `backend/app/api/v1/teacher/exam_generator.py:286-289`,把:
```python
            word_result = await db.execute(
                select(Word.id).where(Word.word == question["word"])
            )
            word_obj = word_result.scalar_one_or_none()
            if word_obj:
                word_id = word_obj
```
改成:
```python
            word_result = await db.execute(
                select(Word.id).where(Word.word == question["word"]).limit(1)
            )
            word_obj = word_result.scalars().first()
            if word_obj:
                word_id = word_obj
```

- [ ] **Step 6: 写测试覆盖去重和查重路径**

Append to `backend/tests/test_unit_word_edit_isolation.py`:
```python
# ---------- 用例 5: 搜索结果按 word 去重 ----------

async def test_word_list_deduplicates_after_fork(client, db_session):
    """fork 之后,GET /words 搜索同名拼写只返回一行。"""
    # 直接造两行同名 word,模拟 fork 后的状态
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
    # 注:目前 POST /api/v1/words 不需要 teacher 权限,见 words.py 路由
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
    # 库里应该只有一行(因为查重命中,返回了已存在的)
    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "dog")
    )).scalar()
    assert n == 1
```

- [ ] **Step 7: 跑全部测试**

Run: `cd backend && source venv/bin/activate && pytest tests/ -v`
Expected: 全部 PASS(8 个用例)。

- [ ] **Step 8: 提交**

```bash
git add backend/app/api/v1/pronunciation.py backend/app/api/v1/words.py backend/app/api/v1/teacher/exam_generator.py backend/tests/test_unit_word_edit_isolation.py
git commit -m "fix(words): handle multi-row same-spelling after dropping UNIQUE"
```

---

## Task 7: 前端展示 fork 提示

**Files:**
- Modify: `frontend/src/api/teacher.ts:155-171`
- Modify: `frontend/src/pages/TeacherUnitManagement.tsx:244-262`

- [ ] **Step 1: 改 `frontend/src/api/teacher.ts:155-171`**

把:
```typescript
export const updateWordInUnit = async (
  unitId: number,
  wordId: number,
  wordData: {
    word?: string;
    phonetic?: string;
    syllables?: string;
    difficulty?: number;
    meaning?: string;
    part_of_speech?: string;
    example_sentence?: string;
    example_translation?: string;
  }
): Promise<void> => {
  await axios.put(`${API_BASE_URL}/teacher/units/${unitId}/words/${wordId}`, wordData);
};
```
改成:
```typescript
export interface UpdateWordInUnitResponse {
  message: string;
  forked: boolean;
  word_id: number;
}

export const updateWordInUnit = async (
  unitId: number,
  wordId: number,
  wordData: {
    word?: string;
    phonetic?: string;
    syllables?: string;
    difficulty?: number;
    meaning?: string;
    part_of_speech?: string;
    example_sentence?: string;
    example_translation?: string;
  }
): Promise<UpdateWordInUnitResponse> => {
  const res = await axios.put<UpdateWordInUnitResponse>(
    `${API_BASE_URL}/teacher/units/${unitId}/words/${wordId}`,
    wordData
  );
  return res.data;
};
```

- [ ] **Step 2: 改 `TeacherUnitManagement.tsx` 的 `handleSaveEdit`**

定位 `frontend/src/pages/TeacherUnitManagement.tsx:244-262`,把:
```typescript
  const handleSaveEdit = async () => {
    if (!editFormData.word.trim()) {
      toast.warning('单词不能为空');
      return;
    }
    setSavingEdit(true);
    try {
      await updateWordInUnit(selectedUnit!.id, editingWordId!, editFormData);
      setEditingWordId(null);
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);
    } catch (error: any) {
      console.error('保存失败:', error);
      toast.error(getErrorMessage(error, '保存失败,请重试'));
    } finally {
      setSavingEdit(false);
    }
  };
```
改成:
```typescript
  const handleSaveEdit = async () => {
    if (!editFormData.word.trim()) {
      toast.warning('单词不能为空');
      return;
    }
    setSavingEdit(true);
    try {
      const result = await updateWordInUnit(selectedUnit!.id, editingWordId!, editFormData);
      setEditingWordId(null);
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);
      if (result.forked) {
        toast.success('保存成功(已为本单元生成独立副本,不会影响其他单元)');
      } else {
        toast.success('保存成功');
      }
    } catch (error: any) {
      console.error('保存失败:', error);
      toast.error(getErrorMessage(error, '保存失败,请重试'));
    } finally {
      setSavingEdit(false);
    }
  };
```

- [ ] **Step 3: 前端类型检查**

Run: `cd frontend && npm run lint`
Expected: 没有新增 lint 错误。

- [ ] **Step 4: 启动前后端做一次手测**

启动后端:
```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload
```

启动前端(另一个终端):
```bash
cd frontend && npm run dev
```

手测脚本:
1. 教师登录
2. 选一本被多个单元共用单词的书
3. 进入 1 单元,找一个出现在多个单元的词(比如 "the" / "is" / "I"),改它的释义,保存
4. 期望:toast 显示「已为本单元生成独立副本」;1 单元页面看到新释义
5. 切到 2 单元找同一个词:期望释义仍是原来的

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api/teacher.ts frontend/src/pages/TeacherUnitManagement.tsx
git commit -m "feat(teacher-ui): show fork notice when unit-word edit isolates"
```

---

## Task 8: 端到端回归 & 收尾

**Files:** 无

- [ ] **Step 1: 全后端测试**

Run: `cd backend && source venv/bin/activate && pytest tests/ -v`
Expected: 全 PASS。

- [ ] **Step 2: 前端 lint + 构建**

Run: `cd frontend && npm run lint && npm run build`
Expected: 无 lint 错误,build 成功。

- [ ] **Step 3: 现存功能抽查**

启动后端 + 前端,验证 spec 中「回归点」清单中关键项:
- 学生在 fork 后的单元做题进入错题本,错题本展示该单元的新释义/新例句(不是原 Word 的)
- 学生在该单元进度从零开始
- 该单元的「试卷生成」能正常生成
- 单词本视图仍然能看到原 word
- 批量导入(`/api/v1/words/batch-import`)用已存在的拼写时仍然按"已存在"处理

如有任一项不通过,定位到对应文件 + 行号修复,然后回 Step 1。

- [ ] **Step 4: 留个回滚备忘**

确认这两份文件在仓库根目录可见,作为本期回滚抓手:
- `backend/english_helper.db.bak_pre_011`(Task 2 Step 3 备份的)
- `docs/superpowers/specs/2026-05-23-unit-word-edit-isolation-design.md` 末尾「失败模式与回滚」段

- [ ] **Step 5: 最终汇总提交**

如果上面所有提交都没遗漏,跳过这步。否则把零散补丁汇总成一个 commit:

```bash
git status
git add -p  # 选择性 stage 剩余修改
git commit -m "chore(unit-word-isolation): finalize regression fixes"
```
