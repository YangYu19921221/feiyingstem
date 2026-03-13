#!/usr/bin/env python3
"""查询CosyVoice支持的音色列表"""
import asyncio
import httpx
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models.system_config import AIProvider
from app.api.v1.admin.ai_config import decrypt_api_key

async def query_voices():
    """查询音色列表"""
    # 初始化数据库连接
    engine = create_async_engine("sqlite+aiosqlite:///./english_helper.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as session:
            # 获取API Key
            result = await session.execute(
                select(AIProvider).where(AIProvider.provider_name == "qwen")
            )
            provider = result.scalar_one_or_none()

            if not provider:
                print("❌ 未找到qwen配置")
                return

            # 解密API Key
            api_key = decrypt_api_key(provider.api_key)

            print(f"✅ API Key: {api_key[:20]}...")

            # 查询音色列表
            print("\n尝试查询音色列表...")

            # 方法1: 尝试dashscope SDK
            try:
                import dashscope
                from dashscope.audio.tts_v2 import SpeechSynthesizer

                dashscope.api_key = api_key

                # 测试几个可能的英语女声
                test_voices = [
                    "longwan",  # 可能的英语女声
                    "longxiaobai",  # 可能的英语女声
                    "longyue",  # 可能的英语女声
                    "longxiaoxia",  # 中文女声
                ]

                print("\n测试音色...")
                for voice in test_voices:
                    try:
                        synthesizer = SpeechSynthesizer(
                            model="cosyvoice-v1",
                            voice=voice
                        )
                        audio = synthesizer.call("hello")
                        if audio:
                            print(f"✅ {voice}: 支持 (音频大小: {len(audio)} bytes)")
                        else:
                            print(f"❌ {voice}: 失败")
                    except Exception as e:
                        print(f"❌ {voice}: {str(e)[:50]}")

            except Exception as e:
                print(f"SDK查询失败: {e}")

    except Exception as e:
        print(f"❌ 查询失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(query_voices())
