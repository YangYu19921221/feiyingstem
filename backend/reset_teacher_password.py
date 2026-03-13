#!/usr/bin/env python3
"""重置教师密码为123456"""
import asyncio
from sqlalchemy import select, update
from app.core.database import get_db, init_db
from app.models.user import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def reset_password():
    await init_db()

    async for db in get_db():
        # 查找教师账号
        result = await db.execute(
            select(User).where(User.username == "teacher")
        )
        teacher = result.scalar_one_or_none()

        if not teacher:
            print("❌ 未找到教师账号")
            return

        # 生成新密码的哈希值
        new_password = "123456"
        hashed_password = pwd_context.hash(new_password)

        # 更新密码
        await db.execute(
            update(User)
            .where(User.username == "teacher")
            .values(hashed_password=hashed_password)
        )
        await db.commit()

        print(f"✅ 教师账号密码已重置!")
        print(f"用户名: teacher")
        print(f"新密码: {new_password}")
        print(f"邮箱: {teacher.email}")
        print(f"角色: {teacher.role}")
        break

if __name__ == "__main__":
    asyncio.run(reset_password())
