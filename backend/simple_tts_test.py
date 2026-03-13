#!/usr/bin/env python3
"""简单TTS测试 - 测试不同音色"""
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer

# 从数据库获取的API Key (已解密)
api_key = "sk-b6190895f35442fa853a0839f4089ab7"

dashscope.api_key = api_key

# 测试音色列表
test_voices = [
    # 中文女声
    "longxiaochun",
    "longxiaoxia",
    "longwan",
    # 可能的英语女声
    "longxiaobai",
    "longyue",
    "longlaotie",
]

print("测试 CosyVoice-v1 支持的音色...")
print("=" * 60)

for voice in test_voices:
    try:
        print(f"\n测试: {voice}")
        synthesizer = SpeechSynthesizer(
            model="cosyvoice-v1",
            voice=voice
        )
        audio = synthesizer.call("hello world")
        if audio and len(audio) > 0:
            print(f"  ✅ 成功! 音频大小: {len(audio)} bytes")
            # 保存音频文件
            filename = f"test_{voice}.mp3"
            with open(filename, "wb") as f:
                f.write(audio)
            print(f"  📁 已保存到: {filename}")
        else:
            print(f"  ❌ 失败 - 返回空数据")
    except Exception as e:
        error_msg = str(e)
        if "418" in error_msg:
            print(f"  ❌ 不支持此音色 (错误码418)")
        else:
            print(f"  ❌ 错误: {error_msg[:100]}")

print("\n" + "=" * 60)
print("测试完成!")
