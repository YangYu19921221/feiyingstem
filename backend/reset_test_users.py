"""
重置测试用户密码
所有测试账号的密码设置为: 123456
"""
import asyncio
from sqlalchemy import select, update
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.auth_service import get_password_hash

async def reset_passwords():
    """重置所有测试用户的密码为123456"""
    async with AsyncSessionLocal() as db:
        # 获取所有用户
        stmt = select(User)
        result = await db.execute(stmt)
        users = result.scalars().all()

        if not users:
            print("❌ 数据库中没有用户")
            return

        # 生成新密码哈希
        new_password_hash = get_password_hash("123456")

        print(f"📝 找到 {len(users)} 个用户,准备重置密码...\n")

        for user in users:
            user.hashed_password = new_password_hash
            print(f"✅ {user.username} ({user.role}) - 密码已重置为: 123456")

        await db.commit()
        print(f"\n🎉 所有用户密码已重置完成!")
        print("\n测试账号信息:")
        print("=" * 50)

        # 重新查询显示所有用户
        stmt = select(User)
        result = await db.execute(stmt)
        users = result.scalars().all()

        for user in users:
            print(f"用户名: {user.username:15} | 角色: {user.role:10} | 密码: 123456")

        print("=" * 50)

if __name__ == "__main__":
    asyncio.run(reset_passwords())
