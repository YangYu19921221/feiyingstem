"""初始化成就数据（带飞鹰徽章图）

- 使用 /badges/*.jpeg 作为 icon（前端会检测路径型 icon，否则回退到 emoji）
- 幂等：同名已存在则跳过
"""
import asyncio
from app.core.database import AsyncSessionLocal
from app.models.user import Achievement
from app.models import user, word, learning, competition  # noqa: F401  (register ORM)
from sqlalchemy import select


ACHIEVEMENTS = [
    # 单词累计
    dict(name="初次启程", description="学完第一个单词，旅程开始",
         icon="/badges/badge-1.jpeg",
         condition_type="total_words", condition_value=1, reward_points=10),
    dict(name="百词路上", description="累计学习 100 个单词",
         icon="/badges/badge-2.jpeg",
         condition_type="total_words", condition_value=100, reward_points=30),
    dict(name="千词大师", description="累计学习 1000 个单词",
         icon="/badges/badge-3.jpeg",
         condition_type="total_words", condition_value=1000, reward_points=100),

    # 连续打卡
    dict(name="第一次坚持", description="连续学习 3 天",
         icon="/badges/badge-4.jpeg",
         condition_type="consecutive_days", condition_value=3, reward_points=20),
    dict(name="一周好学者", description="连续学习 7 天",
         icon="/badges/badge-5.jpeg",
         condition_type="consecutive_days", condition_value=7, reward_points=50),
    dict(name="月之恒心", description="连续学习 30 天",
         icon="/badges/badge-6.jpeg",
         condition_type="consecutive_days", condition_value=30, reward_points=200),

    # 准确率 / 满分
    dict(name="满分时刻", description="第一次完整单元满分",
         icon="/badges/badge-7.jpeg",
         condition_type="perfect_score", condition_value=100, reward_points=30),
    dict(name="神射手", description="单元正确率达到 90%",
         icon="/badges/badge-8.jpeg",
         condition_type="accuracy_rate", condition_value=90, reward_points=50),
]


async def seed_achievements():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Achievement))
        existing = {a.name: a for a in result.scalars().all()}

        created, updated = 0, 0
        for data in ACHIEVEMENTS:
            if data["name"] in existing:
                # 已存在：只更新 icon / description / reward_points，不动条件
                row = existing[data["name"]]
                changed = False
                for field in ("icon", "description", "reward_points"):
                    if getattr(row, field) != data[field]:
                        setattr(row, field, data[field])
                        changed = True
                if changed:
                    updated += 1
            else:
                db.add(Achievement(**data))
                created += 1

        await db.commit()
        print(f"✅ 成就 seed 完成：新增 {created} 个，更新 {updated} 个，共 {len(ACHIEVEMENTS)} 个预设成就")


if __name__ == "__main__":
    asyncio.run(seed_achievements())
