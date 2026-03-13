#!/usr/bin/env python3
"""
更新AI Provider的API Key(加密存储)
"""
import sqlite3
import hashlib
import base64
from cryptography.fernet import Fernet

# API Key (从环境变量获取的值)
api_key = "sk-b6190895f35442fa853a0839f4089ab7"

# 加密函数 (复制自ai_config.py)
def get_encryption_key():
    """获取加密密钥 - 使用SECRET_KEY生成"""
    # 使用默认的SECRET_KEY (与backend/app/core/config.py中的默认值一致)
    secret = "your-secret-key-change-in-production"  # 这应该与.env中的SECRET_KEY一致
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)

def encrypt_api_key(api_key: str) -> str:
    """加密API密钥"""
    f = Fernet(get_encryption_key())
    return f.encrypt(api_key.encode()).decode()

# 加密
encrypted_key = encrypt_api_key(api_key)
print(f"加密后的Key (前30字符): {encrypted_key[:30]}...")

# 更新数据库
conn = sqlite3.connect('english_helper.db')
cursor = conn.cursor()

cursor.execute("""
    UPDATE ai_providers
    SET api_key = ?
    WHERE id = 1
""", (encrypted_key,))

conn.commit()

# 验证
cursor.execute("SELECT id, provider_name, substr(api_key, 1, 30) || '...' as api_key, tts_voice FROM ai_providers WHERE id = 1")
result = cursor.fetchone()
print(f"✅ 已更新: ID={result[0]}, Provider={result[1]}, API Key={result[2]}, TTS Voice={result[3]}")

conn.close()
