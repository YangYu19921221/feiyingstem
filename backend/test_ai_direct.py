"""直接测试AI服务"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.services.ai_service import ai_service
from app.core.database import init_db

async def test():
    await init_db()

    print("测试AI生成竞赛题目...")
    try:
        result = await ai_service.generate_competition_question(
            word="hello",
            meaning="你好",
            question_type="choice",
            difficulty="medium"
        )
        print(f"✅ 成功! 结果:")
        print(result)
    except Exception as e:
        print(f"❌ 失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
