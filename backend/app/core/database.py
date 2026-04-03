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

        # 迁移: 为 word_mastery 表添加 review_stage 字段
        try:
            await conn.execute(text(
                "ALTER TABLE word_mastery ADD COLUMN review_stage INTEGER NOT NULL DEFAULT 0"
            ))
        except Exception:
            pass
        # 回填已有的 NULL 值
        try:
            await conn.execute(text(
                "UPDATE word_mastery SET review_stage = 0 WHERE review_stage IS NULL"
            ))
        except Exception:
            pass
        # 添加索引加速复习查询
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_word_mastery_user_review ON word_mastery(user_id, next_review_at)"
            ))
        except Exception:
            pass

        # 迁移: 重建 exam_questions 表去掉 question_type 的 CHECK 约束（支持新题型）
        try:
            # 检查是否需要迁移（如果旧约束存在）
            check_result = await conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE name='exam_questions'"
            ))
            row = check_result.fetchone()
            if row and 'CHECK' in (row[0] or ''):
                await conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS exam_questions_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "paper_id INTEGER NOT NULL,"
                    "question_type VARCHAR(20),"
                    "word_id INTEGER,"
                    "question_text TEXT NOT NULL,"
                    "options TEXT,"
                    "correct_answer TEXT NOT NULL,"
                    "score INTEGER DEFAULT 5,"
                    "order_index INTEGER DEFAULT 0,"
                    "FOREIGN KEY (paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE,"
                    "FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL)"
                ))
                await conn.execute(text(
                    "INSERT OR IGNORE INTO exam_questions_new SELECT * FROM exam_questions"
                ))
                await conn.execute(text("DROP TABLE exam_questions"))
                await conn.execute(text("ALTER TABLE exam_questions_new RENAME TO exam_questions"))
        except Exception:
            pass

        # 迁移: 为 users 表添加 phone 字段
        try:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE"
            ))
        except Exception:
            pass

        # 迁移: 为 units 表添加 group_size 字段
        try:
            await conn.execute(text(
                "ALTER TABLE units ADD COLUMN group_size INTEGER DEFAULT 0"
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
