"""
示例数据生成脚本
快速填充测试数据
"""
import asyncio
import httpx

BASE_URL = "http://localhost:8000"

# 示例单词数据
SAMPLE_WORDS = [
    {
        "word": "apple",
        "phonetic": "/ˈæpl/",
        "difficulty": 1,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "苹果",
                "example_sentence": "I like to eat apples.",
                "example_translation": "我喜欢吃苹果。",
                "is_primary": True
            }
        ],
        "tags": ["食物", "水果"]
    },
    {
        "word": "book",
        "phonetic": "/bʊk/",
        "difficulty": 1,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "书;书籍",
                "example_sentence": "This is my favorite book.",
                "example_translation": "这是我最喜欢的书。",
                "is_primary": True
            }
        ],
        "tags": ["学习", "日常用品"]
    },
    {
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
                "example_sentence": "I have a big dog.",
                "example_translation": "我有一只大狗。",
                "is_primary": True
            }
        ],
        "tags": ["动物", "宠物"]
    },
    {
        "word": "cat",
        "phonetic": "/kæt/",
        "difficulty": 1,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "猫",
                "example_sentence": "The cat is sleeping.",
                "example_translation": "猫在睡觉。",
                "is_primary": True
            }
        ],
        "tags": ["动物", "宠物"]
    },
    {
        "word": "school",
        "phonetic": "/skuːl/",
        "difficulty": 1,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "学校",
                "example_sentence": "I go to school every day.",
                "example_translation": "我每天去上学。",
                "is_primary": True
            }
        ],
        "tags": ["学习", "地点"]
    },
    {
        "word": "friend",
        "phonetic": "/frend/",
        "difficulty": 2,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "朋友",
                "example_sentence": "She is my best friend.",
                "example_translation": "她是我最好的朋友。",
                "is_primary": True
            }
        ],
        "tags": ["人物", "日常用语"]
    },
    {
        "word": "family",
        "phonetic": "/ˈfæməli/",
        "difficulty": 2,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "n.",
                "meaning": "家庭;家人",
                "example_sentence": "I love my family.",
                "example_translation": "我爱我的家人。",
                "is_primary": True
            }
        ],
        "tags": ["人物", "家庭"]
    },
    {
        "word": "beautiful",
        "phonetic": "/ˈbjuːtɪfl/",
        "difficulty": 3,
        "grade_level": "小学",
        "definitions": [
            {
                "part_of_speech": "adj.",
                "meaning": "美丽的;漂亮的",
                "example_sentence": "What a beautiful day!",
                "example_translation": "多么美好的一天!",
                "is_primary": True
            }
        ],
        "tags": ["描述", "日常用语"]
    },
    {
        "word": "important",
        "phonetic": "/ɪmˈpɔːtnt/",
        "difficulty": 3,
        "grade_level": "初中",
        "definitions": [
            {
                "part_of_speech": "adj.",
                "meaning": "重要的",
                "example_sentence": "This is very important.",
                "example_translation": "这非常重要。",
                "is_primary": True
            }
        ],
        "tags": ["描述", "日常用语"]
    }
]

async def seed_words():
    """导入示例单词"""
    print("📚 开始导入示例单词...\n")

    async with httpx.AsyncClient() as client:
        success = 0
        failed = 0

        for word_data in SAMPLE_WORDS:
            try:
                response = await client.post(
                    f"{BASE_URL}/api/v1/words/",
                    json=word_data,
                    timeout=10.0
                )

                if response.status_code == 201:
                    print(f"✅ {word_data['word']} - 导入成功")
                    success += 1
                else:
                    print(f"❌ {word_data['word']} - 导入失败 ({response.status_code})")
                    failed += 1

            except Exception as e:
                print(f"❌ {word_data['word']} - 错误: {e}")
                failed += 1

        print(f"\n📊 导入完成: 成功 {success} 个, 失败 {failed} 个")


async def create_sample_books():
    """创建示例单词本"""
    print("\n📖 开始创建示例单词本...\n")

    # 先获取所有单词ID
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/api/v1/words/?limit=100")
        if response.status_code != 200:
            print("❌ 无法获取单词列表")
            return

        words = response.json()
        word_ids = [w["id"] for w in words]

    # 创建单词本
    books = [
        {
            "name": "小学基础词汇",
            "description": "适合小学1-3年级的基础单词",
            "grade_level": "小学",
            "cover_color": "#FF6B35",
            "word_ids": word_ids[:5] if len(word_ids) >= 5 else word_ids
        },
        {
            "name": "动物主题",
            "description": "学习常见动物的英文单词",
            "grade_level": "小学",
            "cover_color": "#4ECDC4",
            "word_ids": [w["id"] for w in words if "动物" in w.get("word", "")][:5]
        }
    ]

    async with httpx.AsyncClient() as client:
        for book_data in books:
            try:
                response = await client.post(
                    f"{BASE_URL}/api/v1/words/books",
                    json=book_data,
                    timeout=10.0
                )

                if response.status_code == 201:
                    print(f"✅ {book_data['name']} - 创建成功")
                else:
                    print(f"❌ {book_data['name']} - 创建失败")

            except Exception as e:
                print(f"❌ {book_data['name']} - 错误: {e}")


async def main():
    print("=" * 60)
    print("🌱 英语学习助手 - 示例数据生成器")
    print("=" * 60)

    # 检查服务
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL}/health", timeout=5.0)
            if response.status_code != 200:
                print("❌ 服务未正常运行")
                return
    except Exception as e:
        print(f"❌ 无法连接到服务器: {e}")
        print("请先启动后端服务: ./start.sh")
        return

    await seed_words()
    await create_sample_books()

    print("\n" + "=" * 60)
    print("✅ 示例数据生成完成!")
    print("=" * 60)
    print("\n💡 你现在可以:")
    print("  1. 访问 http://localhost:8000/docs 查看API")
    print("  2. 运行 python test_api.py 测试功能")
    print("  3. 开始开发前端界面")


if __name__ == "__main__":
    asyncio.run(main())
