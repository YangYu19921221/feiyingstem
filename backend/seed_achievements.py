"""初始化成就数据"""
import asyncio
from app.core.database import AsyncSessionLocal
from app.models.user import Achievement
from app.models import user, word, learning, competition  # 导入所有模型
from sqlalchemy import select

async def seed_achievements():
    """初始化预设成就"""
    async with AsyncSessionLocal() as db:
        # 检查是否已经有成就数据
        result = await db.execute(select(Achievement))
        existing = result.scalars().first()

        if existing:
            print("成就数据已存在,跳过初始化")
            return

        # 创建预设成就
        achievements = [
            # 单词学习类
            Achievement(
                name="初出茅庐",
                description="学会10个单词",
                icon="🌱",
                condition_type="total_words",
                condition_value=10,
                reward_points=10
            ),
            Achievement(
                name="勤学苦练",
                description="学会50个单词",
                icon="📚",
                condition_type="total_words",
                condition_value=50,
                reward_points=50
            ),
            Achievement(
                name="词汇大师",
                description="学会200个单词",
                icon="🎓",
                condition_type="total_words",
                condition_value=200,
                reward_points=100
            ),
            Achievement(
                name="单词达人",
                description="学会500个单词",
                icon="🏆",
                condition_type="total_words",
                condition_value=500,
                reward_points=200
            ),

            # 连续打卡类
            Achievement(
                name="坚持不懈",
                description="连续打卡3天",
                icon="🔥",
                condition_type="consecutive_days",
                condition_value=3,
                reward_points=20
            ),
            Achievement(
                name="持之以恒",
                description="连续打卡7天",
                icon="⭐",
                condition_type="consecutive_days",
                condition_value=7,
                reward_points=50
            ),
            Achievement(
                name="天道酬勤",
                description="连续打卡30天",
                icon="💎",
                condition_type="consecutive_days",
                condition_value=30,
                reward_points=200
            ),

            # 准确率类
            Achievement(
                name="百发百中",
                description="单次测试全对",
                icon="🎯",
                condition_type="perfect_score",
                condition_value=100,
                reward_points=30
            ),
            Achievement(
                name="精准射手",
                description="准确率达到90%",
                icon="🏹",
                condition_type="accuracy_rate",
                condition_value=90,
                reward_points=50
            ),
        ]

        for achievement in achievements:
            db.add(achievement)

        await db.commit()
        print(f"✅ 成功创建 {len(achievements)} 个预设成就")

if __name__ == "__main__":
    asyncio.run(seed_achievements())
