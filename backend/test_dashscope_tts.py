#!/usr/bin/env python3
"""
测试DashScope TTS SDK
"""
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer

# 设置API Key
dashscope.api_key = "sk-b6190895f35442fa853a0839f4089ab7"

print("Testing DashScope TTS SDK...")
print(f"API Key: {dashscope.api_key[:20]}...")

# 尝试不同的voice名称
voices_to_test = [
    "longxiaochun_v2",  # 从文档看到的示例
    "english_female",
    "longhua_v2",
    "english-female",
]

for voice in voices_to_test:
    print(f"\n{'='*50}")
    print(f"Testing voice: {voice}")
    print('='*50)

    try:
        # 创建合成器
        synthesizer = SpeechSynthesizer(
            model="cosyvoice-v2",
            voice=voice
        )

        # 生成语音
        print(f"Calling synthesizer.call('hello') with voice={voice}...")
        result = synthesizer.call("hello")

        print(f"✅ SUCCESS! Result type: {type(result)}")
        print(f"Result: {result}")

        if result:
            print(f"Result attributes: {dir(result)}")

            # 尝试不同的方法获取音频数据
            if hasattr(result, 'get_audio_data'):
                audio_data = result.get_audio_data()
                print(f"Audio data from get_audio_data(): {len(audio_data) if audio_data else 'None'} bytes")
                if audio_data:
                    print(f"🎉 Successfully got {len(audio_data)} bytes of audio data!")
                    break  # 找到有效的voice,退出循环

            if hasattr(result, 'audio'):
                print(f"Has 'audio' attribute: {type(result.audio)}")

            if hasattr(result, 'output'):
                print(f"Has 'output' attribute: {result.output}")

    except Exception as e:
        print(f"❌ Error with voice '{voice}': {e}")
        # 不打印完整traceback,继续测试下一个voice
        continue
