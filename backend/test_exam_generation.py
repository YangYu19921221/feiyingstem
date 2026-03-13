"""
测试标准试卷生成功能
验证50题格式,包括完形填空和改进的阅读理解
"""
import asyncio
import sys
from app.services.ai_service import ai_service

async def test_exam_generation():
    """测试AI生成标准格式试卷"""
    print("=" * 60)
    print("测试标准试卷生成(v3.0)")
    print("=" * 60)

    # 模拟学生薄弱单词
    weak_words = [
        {"word": "happy", "meaning": "快乐的", "wrong_count": 5},
        {"word": "beautiful", "meaning": "美丽的", "wrong_count": 4},
        {"word": "friend", "meaning": "朋友", "wrong_count": 3},
        {"word": "study", "meaning": "学习", "wrong_count": 3},
        {"word": "play", "meaning": "玩耍", "wrong_count": 2},
        {"word": "school", "meaning": "学校", "wrong_count": 2},
        {"word": "teacher", "meaning": "老师", "wrong_count": 2},
        {"word": "book", "meaning": "书", "wrong_count": 1},
        {"word": "read", "meaning": "阅读", "wrong_count": 1},
        {"word": "write", "meaning": "写", "wrong_count": 1},
    ]

    # 题型分布(50题标准配置)
    distribution = {
        "choice": 15,        # 选择题
        "cloze_test": 10,    # 完形填空
        "fill_blank": 8,     # 填空题
        "spelling": 5,       # 拼写题
        "reading": 12        # 阅读理解(3篇文章x4题)
    }

    total_questions = sum(distribution.values())
    print(f"\n📋 题型配置:")
    print(f"   总题数: {total_questions}题")
    for qtype, count in distribution.items():
        type_names = {
            "choice": "选择题",
            "cloze_test": "完形填空",
            "fill_blank": "填空题",
            "spelling": "拼写题",
            "reading": "阅读理解"
        }
        print(f"   - {type_names[qtype]}: {count}题")

    print("\n🔄 开始生成试卷...")
    print("   (这可能需要20-30秒,请耐心等待)")

    try:
        exam_data = await ai_service.generate_personalized_exam(
            student_name="测试学生",
            weak_words=weak_words,
            question_distribution=distribution,
            difficulty="medium"
        )

        print("\n✅ 试卷生成成功!")
        print(f"\n📄 试卷信息:")
        print(f"   标题: {exam_data.get('title')}")
        print(f"   说明: {exam_data.get('description')}")
        print(f"   总分: {exam_data.get('total_score')}分")
        print(f"   题目数: {len(exam_data.get('questions', []))}题")

        # 统计题型分布
        questions = exam_data.get('questions', [])
        type_stats = {}
        for q in questions:
            qtype = q.get('question_type')
            type_stats[qtype] = type_stats.get(qtype, 0) + 1

        print(f"\n📊 实际生成的题型分布:")
        type_names = {
            "choice": "选择题",
            "cloze_test": "完形填空",
            "fill_blank": "填空题",
            "spelling": "拼写题",
            "reading": "阅读理解"
        }
        for qtype, count in type_stats.items():
            print(f"   - {type_names.get(qtype, qtype)}: {count}题")

        # 检查完形填空
        cloze_questions = [q for q in questions if q.get('question_type') == 'cloze_test']
        if cloze_questions:
            cloze = cloze_questions[0]
            print(f"\n📄 完形填空检查:")
            print(f"   ✓ 找到完形填空题")
            if 'passage' in cloze:
                passage_len = len(cloze['passage'])
                print(f"   ✓ 短文长度: {passage_len}字符")
                if passage_len < 100:
                    print(f"   ⚠️  警告: 短文太短(应该100-150词)")
            if 'blanks' in cloze:
                print(f"   ✓ 空题数量: {len(cloze['blanks'])}个")
                if len(cloze['blanks']) != 10:
                    print(f"   ⚠️  警告: 应该有10个空")
            else:
                print(f"   ❌ 缺少blanks字段")
        else:
            print(f"\n❌ 未找到完形填空题!")

        # 检查阅读理解
        reading_questions = [q for q in questions if q.get('question_type') == 'reading']
        if reading_questions:
            print(f"\n📖 阅读理解检查:")
            print(f"   ✓ 找到阅读理解题: {len(reading_questions)}题")

            # 按passage_id分组
            passage_groups = {}
            for q in reading_questions:
                pid = q.get('passage_id', 'default')
                if pid not in passage_groups:
                    passage_groups[pid] = []
                passage_groups[pid].append(q)

            print(f"   ✓ 文章数量: {len(passage_groups)}篇")
            for i, (pid, questions_in_passage) in enumerate(passage_groups.items(), 1):
                first_q = questions_in_passage[0]
                passage_len = len(first_q.get('passage', '')) if 'passage' in first_q else 0
                print(f"   - 文章{i} ({pid}): {len(questions_in_passage)}题, 长度{passage_len}字符")
                if passage_len < 100:
                    print(f"     ⚠️  警告: 文章太短(应该100-200词)")
                if len(questions_in_passage) < 4:
                    print(f"     ⚠️  警告: 问题太少(应该4题/篇)")
        else:
            print(f"\n❌ 未找到阅读理解题!")

        # 显示前3题示例
        print(f"\n📝 前3题示例:")
        for i, q in enumerate(questions[:3], 1):
            qtype = type_names.get(q.get('question_type'), q.get('question_type'))
            content = q.get('content', '').replace('\n', ' ')[:60]
            print(f"   {i}. [{qtype}] {content}...")

        print(f"\n{'='*60}")
        print("✅ 测试完成!")
        print(f"{'='*60}")

        return exam_data

    except Exception as e:
        print(f"\n❌ 生成失败:")
        print(f"   错误: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    # 检查AI配置
    from app.core.config import settings

    print("\n🔧 AI配置检查:")
    if settings.OPENAI_API_KEY:
        print(f"   ✓ OpenAI API Key已配置")
    elif settings.ANTHROPIC_API_KEY:
        print(f"   ✓ Claude API Key已配置")
    else:
        print(f"   ❌ 未配置AI API Key!")
        print(f"   请在.env文件中配置OPENAI_API_KEY或ANTHROPIC_API_KEY")
        sys.exit(1)

    # 运行测试
    result = asyncio.run(test_exam_generation())

    if result:
        print(f"\n提示: 可以在数据库中查看完整的试卷JSON数据")
    else:
        sys.exit(1)
