from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
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
    from app.models import user, word, learning, pet
    try:
        from app.models import competition
    except Exception:
        pass

    # 使用SQLAlchemy的create_all创建所有表
    async with engine.begin() as conn:
        def create_tables(sync_conn):
            # 创建所有在Base.metadata中定义的表
            Base.metadata.create_all(sync_conn)

        await conn.run_sync(create_tables)

        # 迁移: 为 user_scores 表添加段位字段
        try:
            await conn.execute(text(
                "ALTER TABLE user_scores ADD COLUMN rank_tier VARCHAR(20) DEFAULT 'bronze'"
            ))
        except Exception:
            pass
        try:
            await conn.execute(text(
                "ALTER TABLE user_scores ADD COLUMN rank_points INTEGER DEFAULT 0"
            ))
        except Exception:
            pass

        # 迁移: 为 user_pets 表添加 food_balance 字段
        try:
            await conn.execute(text(
                "ALTER TABLE user_pets ADD COLUMN food_balance INTEGER DEFAULT 10"
            ))
        except Exception:
            pass

        # 迁移: 为 users 表添加 phone 字段
        try:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE"
            ))
        except Exception:
            pass

        print("✅ 数据库初始化完成")

async def get_db() -> AsyncSession:
    """获取数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
