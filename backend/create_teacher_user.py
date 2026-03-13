"""创建测试教师账号"""
import asyncio
from passlib.context import CryptContext
from sqlalchemy import select

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def create_teacher():
    from app.core.database import init_db, AsyncSessionLocal
    from app.models.user import User

    await init_db()

    async with AsyncSessionLocal() as db:
        # 检查是否存在teacher账号
        result = await db.execute(select(User).where(User.username == "teacher"))
        existing_user = result.scalar_one_or_none()

        if existing_user:
            # 更新密码
            existing_user.hashed_password = pwd_context.hash("teacher123")
            existing_user.role = "teacher"
            print(f"✓ 更新用户 teacher, password=teacher123")
        else:
            # 创建新用户
            new_user = User(
                username="teacher",
                email="teacher@test.com",
                hashed_password=pwd_context.hash("teacher123"),
                full_name="测试教师",
                role="teacher",
                is_active=True
            )
            db.add(new_user)
            print(f"✓ 创建新用户 teacher, password=teacher123")

        await db.commit()
        print("✅ 教师账号设置完成")
        print("Username: teacher")
        print("Password: teacher123")

if __name__ == "__main__":
    asyncio.run(create_teacher())
