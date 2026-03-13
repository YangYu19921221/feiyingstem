import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.auth_service import get_password_hash
from sqlalchemy import select


async def reset_password():
    """重置student用户密码"""
    async with AsyncSessionLocal() as db:
        # 查找student用户
        result = await db.execute(select(User).where(User.username == "student"))
        user = result.scalar_one_or_none()

        if user:
            # 重置密码为student123
            new_password = "student123"
            user.hashed_password = get_password_hash(new_password)
            await db.commit()
            print(f"✅ 成功重置用户 {user.username} 的密码为: {new_password}")
            print(f"   用户ID: {user.id}, 角色: {user.role}")
        else:
            print("❌ 未找到student用户")


if __name__ == "__main__":
    asyncio.run(reset_password())
