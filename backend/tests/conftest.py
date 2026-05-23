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
