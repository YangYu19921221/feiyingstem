#!/usr/bin/env python3
"""测试AI音标生成"""
import asyncio
from app.services.ai_service import ai_service

async def test():
    print("测试 hello 的音标生成...")
    phonetic = await ai_service.generate_phonetic("hello")
    print(f"结果: {phonetic}")

if __name__ == "__main__":
    asyncio.run(test())
