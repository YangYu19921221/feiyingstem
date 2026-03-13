"""测试AI生成竞赛题目"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.services.ai_service import ai_service
from app.core.database import init_db, AsyncSessionLocal
from sqlalchemy import select
from app.models.word import Word, WordDefinition

async def test_ai_generation():
    """测试AI生成"""
    await init_db()

    async with AsyncSessionLocal() as db:
        # 获取一个单词
        query = select(Word).limit(1)
        result = await db.execute(query)
        word = result.scalar_one_or_none()

        if not word:
            print("❌ 数据库中没有单词")
            return

        print(f"✓ 找到单词: {word.word}")

        # 获取释义
        query = select(WordDefinition).where(WordDefinition.word_id == word.id).limit(1)
        result = await db.execute(query)
        definition = result.scalar_one_or_none()

        if not definition:
            print("❌ 单词没有释义")
            return

        print(f"✓ 释义: {definition.meaning}")

        # 测试生成选择题
        try:
            print("\n开始生成选择题...")
            question_data = await ai_service.generate_competition_question(
                word=word.word,
                meaning=definition.meaning,
                question_type="choice",
                difficulty="medium"
            )
            print(f"✅ 生成成功!")
            print(f"题目类型: {question_data['question_type']}")
            print(f"题目内容: {question_data['content']}")
            print(f"正确答案: {question_data['correct_answer']}")
            if question_data.get('options'):
                print(f"选项数量: {len(question_data['options'])}")
        except Exception as e:
            print(f"❌ 生成失败: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_ai_generation())
