#!/usr/bin/env python3
"""测试通义千问API连接"""
import asyncio
from openai import AsyncOpenAI

async def test_qwen():
    api_key = "sk-b6190895f35442fa853a0839f4089ab7"
    base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    print(f"测试配置:")
    print(f"  API Key: {api_key[:15]}...{api_key[-8:]}")
    print(f"  Base URL: {base_url}")
    print(f"  模型: qwen-max")
    print()

    try:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )

        print("发送测试请求...")
        response = await client.chat.completions.create(
            model="qwen-max",  # 先试试 qwen-max
            messages=[
                {"role": "user", "content": "你好,请用一句话介绍你自己"}
            ],
            max_tokens=100
        )

        print("\n✅ 连接成功!")
        print(f"回复: {response.choices[0].message.content}")

    except Exception as e:
        print(f"\n❌ 连接失败: {e}")
        print("\n尝试其他模型名称...")

        # 尝试 qwen-turbo
        try:
            response = await client.chat.completions.create(
                model="qwen-turbo",
                messages=[
                    {"role": "user", "content": "你好"}
                ],
                max_tokens=50
            )
            print(f"\n✅ qwen-turbo 可用!")
            print(f"回复: {response.choices[0].message.content}")
        except Exception as e2:
            print(f"❌ qwen-turbo 也失败: {e2}")

if __name__ == "__main__":
    asyncio.run(test_qwen())
