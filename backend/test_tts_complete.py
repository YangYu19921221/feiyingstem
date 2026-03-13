#!/usr/bin/env python3
"""
完整测试DashScope TTS配置
按照官方文档的标准方法测试
"""
import sqlite3
import hashlib
import base64
from cryptography.fernet import Fernet

print("=" * 60)
print("第1步: 检查数据库配置")
print("=" * 60)

# 读取数据库配置
conn = sqlite3.connect('english_helper.db')
cursor = conn.cursor()
cursor.execute("""
    SELECT id, provider_name, tts_enabled, tts_model, tts_voice,
           substr(api_key, 1, 30) || '...' as api_key_preview,
           length(api_key) as api_key_length
    FROM ai_providers
    WHERE id = 1
""")
result = cursor.fetchone()
print(f"✅ 数据库记录:")
print(f"   ID: {result[0]}")
print(f"   Provider: {result[1]}")
print(f"   TTS Enabled: {result[2]}")
print(f"   TTS Model: {result[3]}")
print(f"   TTS Voice: {result[4]}")
print(f"   API Key Preview: {result[5]}")
print(f"   API Key Length: {result[6]}")

# 获取完整加密的API key
cursor.execute("SELECT api_key FROM ai_providers WHERE id = 1")
encrypted_key = cursor.fetchone()[0]
conn.close()

print("\n" + "=" * 60)
print("第2步: 解密API Key")
print("=" * 60)

def get_encryption_key():
    """获取加密密钥 - 必须与config.py一致"""
    secret = "your-secret-key-change-in-production"
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)

def decrypt_api_key(encrypted_key: str) -> str:
    """解密API密钥"""
    f = Fernet(get_encryption_key())
    return f.decrypt(encrypted_key.encode()).decode()

try:
    api_key = decrypt_api_key(encrypted_key)
    print(f"✅ 解密成功!")
    print(f"   API Key: {api_key[:20]}...")
    print(f"   API Key长度: {len(api_key)}")
except Exception as e:
    print(f"❌ 解密失败: {e}")
    exit(1)

print("\n" + "=" * 60)
print("第3步: 测试DashScope SDK (按官方文档示例)")
print("=" * 60)

try:
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer

    # 从数据库读取配置
    model = result[3]  # tts_model
    voice = result[4]  # tts_voice

    print(f"配置:")
    print(f"  model = {model}")
    print(f"  voice = {voice}")
    print(f"  api_key = {api_key[:20]}...")

    # 设置API Key (全局设置)
    dashscope.api_key = api_key

    # 创建合成器 (官方示例方式)
    print(f"\n创建SpeechSynthesizer...")
    synthesizer = SpeechSynthesizer(
        model=model,
        voice=voice
    )

    # 调用SDK生成语音 (官方示例方式)
    print(f"调用synthesizer.call('hello')...")
    audio = synthesizer.call("hello")

    # 检查返回值
    print(f"\n返回值检查:")
    print(f"  类型: {type(audio)}")
    print(f"  是bytes? {isinstance(audio, bytes)}")

    if isinstance(audio, bytes):
        print(f"  ✅ 音频数据大小: {len(audio)} bytes")

        # 保存到文件 (官方示例方式)
        output_file = "test_output.mp3"
        with open(output_file, 'wb') as f:
            f.write(audio)
        print(f"  ✅ 已保存到: {output_file}")

        print(f"\n🎉 测试成功! TTS配置完全正确!")
    else:
        print(f"  ❌ 返回值不是bytes类型")
        print(f"  返回值属性: {dir(audio)}")

        # 尝试其他可能的方法
        if hasattr(audio, 'get_audio_data'):
            audio_data = audio.get_audio_data()
            print(f"  尝试get_audio_data(): {type(audio_data)}, 大小: {len(audio_data) if audio_data else 0}")

except Exception as e:
    print(f"\n❌ 测试失败: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("\n" + "=" * 60)
print("✅ 所有测试完成")
print("=" * 60)
