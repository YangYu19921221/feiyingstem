#!/usr/bin/env python3
"""
快速添加竞赛测试题目
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.models.competition import CompetitionQuestion, CompetitionQuestionOption
import json


async def add_test_questions():
    """添加测试题目"""
    async with AsyncSessionLocal() as db:
        # 检查是否已有题目
        from sqlalchemy import select, func
        result = await db.execute(select(func.count(CompetitionQuestion.id)))
        count = result.scalar()

        if count > 0:
            print(f"✅ 数据库中已有 {count} 道题目")
            user_input = input("是否继续添加测试题目? (y/n): ")
            if user_input.lower() != 'y':
                print("❌ 取消操作")
                return

        print("📝 开始添加测试题目...")

        # 获取第一个教师用户ID
        from app.models.user import User
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.role == 'teacher').limit(1))
        teacher = result.scalar_one_or_none()
        if not teacher:
            # 如果没有教师,尝试获取任意用户
            result = await db.execute(select(User).limit(1))
            teacher = result.scalar_one_or_none()

        if not teacher:
            print("❌ 错误: 数据库中没有用户,请先创建用户")
            return

        created_by = teacher.id
        print(f"📝 使用用户 {teacher.username} (ID: {created_by}) 创建题目")

        # 测试题目数据
        questions_data = [
            {
                "question_type": "choice",
                "title": "选择正确的单词",
                "content": "The cat is very ___.",
                "difficulty": "easy",
                "correct_answer": json.dumps({"answer": "A"}),
                "answer_explanation": "cute 的意思是可爱的,符合句意。",
                "source": "manual",
                "tags": "adjective,animals",
                "created_by": created_by,
                "options": [
                    {"option_key": "A", "option_text": "cute", "is_correct": True, "display_order": 1},
                    {"option_key": "B", "option_text": "ugly", "is_correct": False, "display_order": 2},
                    {"option_key": "C", "option_text": "big", "is_correct": False, "display_order": 3},
                    {"option_key": "D", "option_text": "small", "is_correct": False, "display_order": 4},
                ]
            },
            {
                "question_type": "choice",
                "title": "选择正确的翻译",
                "content": "What does 'apple' mean in Chinese?",
                "difficulty": "easy",
                "correct_answer": json.dumps({"answer": "B"}),
                "answer_explanation": "apple 的中文意思是苹果。",
                "source": "manual",
                "tags": "fruit,vocabulary",
                "created_by": created_by,
                "options": [
                    {"option_key": "A", "option_text": "香蕉", "is_correct": False, "display_order": 1},
                    {"option_key": "B", "option_text": "苹果", "is_correct": True, "display_order": 2},
                    {"option_key": "C", "option_text": "橙子", "is_correct": False, "display_order": 3},
                    {"option_key": "D", "option_text": "葡萄", "is_correct": False, "display_order": 4},
                ]
            },
            {
                "question_type": "choice",
                "title": "选择正确的动词形式",
                "content": "She ___ to school every day.",
                "difficulty": "medium",
                "correct_answer": json.dumps({"answer": "C"}),
                "answer_explanation": "主语是第三人称单数,动词需要加s。",
                "source": "manual",
                "tags": "grammar,verb",
                "created_by": created_by,
                "options": [
                    {"option_key": "A", "option_text": "go", "is_correct": False, "display_order": 1},
                    {"option_key": "B", "option_text": "going", "is_correct": False, "display_order": 2},
                    {"option_key": "C", "option_text": "goes", "is_correct": True, "display_order": 3},
                    {"option_key": "D", "option_text": "went", "is_correct": False, "display_order": 4},
                ]
            },
            {
                "question_type": "choice",
                "title": "选择正确的介词",
                "content": "The book is ___ the table.",
                "difficulty": "easy",
                "correct_answer": json.dumps({"answer": "A"}),
                "answer_explanation": "on 表示在...上面,符合句意。",
                "source": "manual",
                "tags": "preposition",
                "created_by": created_by,
                "options": [
                    {"option_key": "A", "option_text": "on", "is_correct": True, "display_order": 1},
                    {"option_key": "B", "option_text": "in", "is_correct": False, "display_order": 2},
                    {"option_key": "C", "option_text": "under", "is_correct": False, "display_order": 3},
                    {"option_key": "D", "option_text": "behind", "is_correct": False, "display_order": 4},
                ]
            },
            {
                "question_type": "choice",
                "title": "选择正确的时态",
                "content": "I ___ my homework yesterday.",
                "difficulty": "medium",
                "correct_answer": json.dumps({"answer": "B"}),
                "answer_explanation": "yesterday 表示昨天,需要使用过去式。",
                "source": "manual",
                "tags": "grammar,tense",
                "created_by": created_by,
                "options": [
                    {"option_key": "A", "option_text": "do", "is_correct": False, "display_order": 1},
                    {"option_key": "B", "option_text": "did", "is_correct": True, "display_order": 2},
                    {"option_key": "C", "option_text": "doing", "is_correct": False, "display_order": 3},
                    {"option_key": "D", "option_text": "does", "is_correct": False, "display_order": 4},
                ]
            },
            {
                "question_type": "fill_blank",
                "title": "填空题",
                "content": "Hello, ___ name is Tom.",
                "difficulty": "easy",
                "correct_answer": "my",
                "answer_explanation": "my 表示我的,符合句意。",
                "source": "manual",
                "tags": "pronoun",
                "created_by": created_by,
                "options": []
            },
            {
                "question_type": "spelling",
                "title": "拼写题",
                "content": "书 (请用英文拼写)",
                "difficulty": "easy",
                "correct_answer": "book",
                "answer_explanation": "book 的意思是书。",
                "source": "manual",
                "tags": "vocabulary",
                "created_by": created_by,
                "options": []
            },
        ]

        # 添加题目
        for q_data in questions_data:
            # 创建题目
            options_data = q_data.pop("options", [])
            question = CompetitionQuestion(**q_data)
            db.add(question)
            await db.flush()  # 获取question.id

            # 添加选项
            for opt_data in options_data:
                option = CompetitionQuestionOption(
                    question_id=question.id,
                    **opt_data
                )
                db.add(option)

            print(f"✅ 添加题目: {question.content}")

        await db.commit()

        # 统计
        result = await db.execute(select(func.count(CompetitionQuestion.id)))
        total = result.scalar()
        print(f"\n🎉 成功! 数据库中现在共有 {total} 道题目")


if __name__ == "__main__":
    asyncio.run(add_test_questions())
