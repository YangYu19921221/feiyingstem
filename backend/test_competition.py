"""测试竞赛API"""
import asyncio
from app.core.database import get_db
from app.services.competition_service import competition_service

async def test():
    async for db in get_db():
        try:
            result = await competition_service.submit_answer(
                db=db,
                user_id=1,
                word_id=1,
                is_correct=True,
                time_spent_ms=3000,
                question_type='choice',
                season_id=1
            )
            print('✅ 成功:', result)
        except Exception as e:
            print(f'❌ 错误: {type(e).__name__}: {e}')
            import traceback
            traceback.print_exc()
        break

if __name__ == "__main__":
    asyncio.run(test())
