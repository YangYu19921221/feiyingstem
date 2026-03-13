"""创建教师用户"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.core.database import init_db, AsyncSessionLocal
from app.models.user import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def create_teacher():
    """创建教师用户"""
    await init_db()

    async with AsyncSessionLocal() as db:
        # 创建教师用户
        hashed_password = pwd_context.hash("teacher123")
        teacher = User(
            username="ai_teacher",
            email="ai_teacher@test.com",
            hashed_password=hashed_password,
            full_name="AI Test Teacher",
            role="teacher",
            is_active=True
        )

        db.add(teacher)
        await db.commit()

        print(f"✅ 创建教师用户成功: username=ai_teacher, password=teacher123")

if __name__ == "__main__":
    asyncio.run(create_teacher())
