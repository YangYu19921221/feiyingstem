"""pytest 共用 fixture:为每个测试函数提供独立的内存数据库 + AsyncClient。"""
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

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
