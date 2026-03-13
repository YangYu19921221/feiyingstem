"""
API测试脚本
快速测试主要功能
"""
import httpx
import asyncio
import json

BASE_URL = "http://localhost:8000"

async def test_create_word():
    """测试创建单词"""
    print("📝 测试创建单词...")

    word_data = {
        "word": "happy",
        "phonetic": "/ˈhæpi/",
        "difficulty": 2,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "adj.",
                "meaning": "快乐的;幸福的",
                "example_sentence": "I am very happy today.",
                "example_translation": "我今天很开心。",
                "is_primary": True
            }
        ],
        "tags": ["情感", "日常用语"]
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{BASE_URL}/api/v1/words/",
                json=word_data,
                timeout=10.0
            )
            if response.status_code == 201:
                print("✅ 单词创建成功!")
                print(json.dumps(response.json(), indent=2, ensure_ascii=False))
                return response.json()["id"]
            else:
                print(f"❌ 创建失败: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"❌ 请求失败: {e}")
    return None


async def test_get_words():
    """测试获取单词列表"""
    print("\n📚 测试获取单词列表...")

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{BASE_URL}/api/v1/words/?limit=10",
                timeout=10.0
            )
            if response.status_code == 200:
                words = response.json()
                print(f"✅ 获取成功,共 {len(words)} 个单词")
                for word in words[:3]:  # 只显示前3个
                    print(f"  - {word['word']}: {word.get('primary_meaning', 'N/A')}")
            else:
                print(f"❌ 获取失败: {response.status_code}")
        except Exception as e:
            print(f"❌ 请求失败: {e}")


async def test_generate_example():
    """测试AI生成例句"""
    print("\n🤖 测试AI生成例句...")

    data = {
        "word": "adventure",
        "meaning": "冒险",
        "difficulty": "middle-school",
        "context": "daily life"
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{BASE_URL}/api/v1/ai/generate-example",
                json=data,
                timeout=30.0  # AI调用可能较慢
            )
            if response.status_code == 200:
                result = response.json()
                print("✅ 例句生成成功!")
                print(f"  英文: {result['sentence']}")
                print(f"  中文: {result['translation']}")
            else:
                print(f"❌ 生成失败: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"❌ 请求失败: {e}")


async def test_generate_distractors():
    """测试生成干扰项"""
    print("\n🎯 测试生成选择题干扰项...")

    data = {
        "word": "happy",
        "correct_meaning": "快乐的",
        "count": 3
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{BASE_URL}/api/v1/ai/generate-distractors",
                json=data,
                timeout=30.0
            )
            if response.status_code == 200:
                distractors = response.json()
                print("✅ 干扰项生成成功!")
                for i, distractor in enumerate(distractors, 1):
                    print(f"  {i}. {distractor}")
            else:
                print(f"❌ 生成失败: {response.status_code}")
        except Exception as e:
            print(f"❌ 请求失败: {e}")


async def test_create_word_book():
    """测试创建单词本"""
    print("\n📖 测试创建单词本...")

    book_data = {
        "name": "小学三年级上册",
        "description": "适合小学三年级学生的单词",
        "grade_level": "小学三年级",
        "is_public": True,
        "cover_color": "#FF6B35",
        "word_ids": []
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{BASE_URL}/api/v1/words/books",
                json=book_data,
                timeout=10.0
            )
            if response.status_code == 201:
                print("✅ 单词本创建成功!")
                print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            else:
                print(f"❌ 创建失败: {response.status_code}")
        except Exception as e:
            print(f"❌ 请求失败: {e}")


async def test_batch_import():
    """测试批量导入"""
    print("\n📦 测试批量导入单词...")

    import_data = {
        "words": [
            {
                "word": "cat",
                "phonetic": "/kæt/",
                "difficulty": 1,
                "grade_level": "小学",
                "definitions": [
                    {
                        "part_of_speech": "n.",
                        "meaning": "猫",
                        "example_sentence": "I have a cat.",
                        "example_translation": "我有一只猫。",
                        "is_primary": True
                    }
                ],
                "tags": ["动物"]
            },
            {
                "word": "dog",
                "phonetic": "/dɒɡ/",
                "difficulty": 1,
                "grade_level": "小学",
                "definitions": [
                    {
                        "part_of_speech": "n.",
                        "meaning": "狗",
                        "example_sentence": "The dog is running.",
                        "example_translation": "狗在跑。",
                        "is_primary": True
                    }
                ],
                "tags": ["动物"]
            }
        ]
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{BASE_URL}/api/v1/words/batch-import",
                json=import_data,
                timeout=30.0
            )
            if response.status_code == 200:
                result = response.json()
                print("✅ 批量导入完成!")
                print(f"  成功: {result['success_count']} 个")
                print(f"  失败: {result['failed_count']} 个")
                if result['failed_words']:
                    print("  失败列表:", result['failed_words'])
            else:
                print(f"❌ 导入失败: {response.status_code}")
        except Exception as e:
            print(f"❌ 请求失败: {e}")


async def main():
    print("=" * 50)
    print("🚀 英语学习助手 API 测试")
    print("=" * 50)

    # 检查服务是否运行
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL}/health", timeout=5.0)
            if response.status_code == 200:
                print("✅ 服务运行正常\n")
            else:
                print("⚠️  服务状态异常\n")
    except Exception as e:
        print(f"❌ 无法连接到服务器: {e}")
        print(f"请确保后端已启动: uvicorn app.main:app --reload")
        return

    # 运行测试
    await test_create_word()
    await test_get_words()
    await test_create_word_book()
    await test_batch_import()

    print("\n" + "=" * 50)
    print("🤖 AI功能测试 (需要配置API Key)")
    print("=" * 50)

    await test_generate_example()
    await test_generate_distractors()

    print("\n" + "=" * 50)
    print("✅ 测试完成!")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
