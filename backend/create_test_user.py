"""
创建测试用户并生成token
"""
import asyncio
from app.core.database import get_db, init_db
from app.models.user import User
from sqlalchemy import select
from app.services.auth_service import auth_service

async def create_test_user():
    await init_db()

    async for db in get_db():
        # 查找student用户
        result = await db.execute(select(User).where(User.username == "student"))
        user = result.scalar_one_or_none()

        if user:
            print(f"✅ 找到用户: {user.username} (ID: {user.id})")

            # 生成token
            token = auth_service.create_access_token(
                data={"sub": str(user.id), "username": user.username}
            )
            print(f"\n📝 Token:")
            print(token)
            print(f"\n✅ WebSocket URL:")
            print(f"ws://localhost:8000/api/v1/competition/ws/competition?token={token}&season_id=1")
        else:
            print("❌ 未找到student用户")

        break

if __name__ == "__main__":
    asyncio.run(create_test_user())
