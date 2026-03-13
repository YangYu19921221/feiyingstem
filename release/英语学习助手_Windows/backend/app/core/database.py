from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings
import os

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True
)

# 创建会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def init_db():
    """初始化数据库"""
    from sqlalchemy import text
    # 导入所有模型以确保它们被注册到Base.metadata
    from app.models import user, word, learning

    # 使用SQLAlchemy的create_all创建所有表
    async with engine.begin() as conn:
        def create_tables(sync_conn):
            # 创建所有在Base.metadata中定义的表
            Base.metadata.create_all(sync_conn)

        await conn.run_sync(create_tables)
        print("✅ 数据库初始化完成")

async def get_db() -> AsyncSession:
    """获取数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
