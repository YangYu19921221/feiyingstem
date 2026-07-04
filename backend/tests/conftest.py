"""pytest 共用 fixture:为每个测试函数提供独立的内存数据库 + AsyncClient。"""
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app import models  # noqa: F401  确保所有 SQLAlchemy 模型注册到 Base.metadata


@pytest_asyncio.fixture
async def db_session():
    """每个测试一个全新的内存数据库。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with SessionLocal() as session:
            yield session
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session):
    """覆盖 get_db 依赖,提供已就绪的 AsyncClient。"""
    async def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


# ---------------- PK 测试专用 fixtures ----------------
from datetime import datetime, timedelta
from jose import jwt
from app.core.config import settings
from app.models.user import User
from app.models.word import Word, WordBook, BookWord, Unit, UnitWord


def _make_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


@pytest_asyncio.fixture
async def auth_student_token(db_session):
    user = User(
        username="stu_pk_1",
        email="stu_pk_1@example.com",
        hashed_password="x",
        role="student",
        full_name="Student PK",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return _make_token(user.id), user.id


@pytest_asyncio.fixture
async def sample_unit_with_words(db_session):
    book = WordBook(name="PK Test Book", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1: Animals")
    db_session.add(unit)
    await db_session.flush()
    word_ids = []
    for i, text in enumerate(["apple", "banana", "cat", "dog"]):
        w = Word(word=f"{text}_pk_{i}", difficulty=2)
        db_session.add(w)
        await db_session.flush()
        db_session.add(BookWord(book_id=book.id, word_id=w.id, order_index=i))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
        word_ids.append(w.id)
    await db_session.commit()
    return unit, word_ids


@pytest_asyncio.fixture
async def senior_unit_with_words(db_session):
    """高中(高一)单词本的单元,用于学段分值测试。"""
    book = WordBook(name="高中必修一", is_public=True, grade_level="高一")
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db_session.add(unit)
    await db_session.flush()
    word_ids = []
    for i, text in enumerate(["ambition", "biology", "campus", "dilemma"]):
        w = Word(word=f"{text}_sr_{i}", difficulty=2)
        db_session.add(w)
        await db_session.flush()
        db_session.add(BookWord(book_id=book.id, word_id=w.id, order_index=i))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
        word_ids.append(w.id)
    await db_session.commit()
    return unit, word_ids


@pytest_asyncio.fixture
async def two_student_tokens(db_session):
    user1 = User(
        username="stu_pk_1",
        email="stu_pk_1_e2e@example.com",
        hashed_password="x",
        role="student",
        full_name="Student 1",
        is_active=True,
    )
    user2 = User(
        username="stu_pk_2",
        email="stu_pk_2_e2e@example.com",
        hashed_password="x",
        role="student",
        full_name="Student 2",
        is_active=True,
    )
    db_session.add_all([user1, user2])
    await db_session.commit()
    await db_session.refresh(user1)
    await db_session.refresh(user2)
    return _make_token(user1.id), _make_token(user2.id), user1.id, user2.id


@pytest_asyncio.fixture
async def empty_unit(db_session):
    book = WordBook(name="Empty Book", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Empty")
    db_session.add(unit)
    await db_session.commit()
    return unit
