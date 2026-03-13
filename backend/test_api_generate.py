"""测试AI生成API"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

async def test():
    from app.core.database import init_db, AsyncSessionLocal, get_db
    from app.models.user import User
    from app.api.v1.teacher.competition_questions import ai_generate_questions
    from app.schemas.competition_question import AIGenerateQuestionRequest
    from sqlalchemy import select

    await init_db()

    async with AsyncSessionLocal() as db:
        # 获取teacher用户
        result = await db.execute(select(User).where(User.username == "test_teacher"))
        user = result.scalar_one_or_none()

        if not user:
            print("❌ 用户test_teacher不存在")
            return

        print(f"✓ 找到用户: {user.username}, role={user.role}")

        # 创建请求
        request = AIGenerateQuestionRequest(
            word_ids=[],
            unit_id=None,
            question_types=["choice"],
            difficulty="medium",
            count=1
        )

        print(f"✓ 请求数据: {request}")

        try:
            # 调用API函数
            print("\\n开始调用AI生成API...")
            result = await ai_generate_questions(request, user, db)
            print(f"✅ 成功! 结果:")
            print(result)
        except Exception as e:
            print(f"❌ 失败: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
