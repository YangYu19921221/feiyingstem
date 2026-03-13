#!/usr/bin/env python3
"""测试TTS功能"""
import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.services.ai_service import ai_service

async def test_tts():
    """测试TTS功能"""
    # 初始化数据库连接
    engine = create_async_engine("sqlite+aiosqlite:///./english_helper.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    ai_service.db = async_session

    try:
        # 测试英文单词
        print("测试TTS功能: 'hello'")
        audio_data = await ai_service.generate_speech("hello")

        if audio_data:
            print(f"✅ TTS成功! 音频数据大小: {len(audio_data)} bytes")

            # 保存音频文件
            with open("test_hello.mp3", "wb") as f:
                f.write(audio_data)
            print("✅ 音频已保存到 test_hello.mp3")
        else:
            print("❌ TTS返回空数据")

    except Exception as e:
        print(f"❌ TTS失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(test_tts())
