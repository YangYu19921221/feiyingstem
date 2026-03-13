"""手动初始化数据库 - 创建所有表"""
import asyncio
from app.core.database import engine, Base
from app.models import user, word, learning

async def main():
    print("开始初始化数据库...")
    async with engine.begin() as conn:
        def create_tables(sync_conn):
            Base.metadata.create_all(sync_conn)

        await conn.run_sync(create_tables)

    print("✅ 数据库初始化完成!")
    print("已创建所有表,包括word_mastery表")

if __name__ == "__main__":
    asyncio.run(main())
