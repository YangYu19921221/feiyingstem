"""
创建管理员账号脚本
Usage: python create_admin.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

from app.core.config import settings
from app.models.user import User, UserRole

# 密码加密
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


async def create_admin():
    """创建管理员账号"""
    # 创建异步引擎
    engine = create_async_engine(settings.DATABASE_URL, echo=True)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with async_session() as session:
        # 检查是否已存在admin
        from sqlalchemy import select
        result = await session.execute(
            select(User).where(User.username == "admin")
        )
        existing_admin = result.scalar_one_or_none()

        if existing_admin:
            print("❌ 管理员账号已存在!")
            print(f"   用户名: {existing_admin.username}")
            print(f"   邮箱: {existing_admin.email}")
            return

        # 创建管理员
        hashed_password = pwd_context.hash("admin123")  # 默认密码

        admin = User(
            username="admin",
            email="admin@example.com",
            hashed_password=hashed_password,
            full_name="系统管理员",
            role=UserRole.ADMIN,
            is_active=True
        )

        session.add(admin)
        await session.commit()
        await session.refresh(admin)

        print("✅ 管理员账号创建成功!")
        print(f"   用户名: {admin.username}")
        print(f"   邮箱: {admin.email}")
        print(f"   默认密码: admin123")
        print(f"   角色: {admin.role}")
        print("\n⚠️  请登录后立即修改密码!")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(create_admin())
