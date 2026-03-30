"""
Edge TTS 英式发音服务
使用微软免费神经网络语音，en-GB-SoniaNeural 英式女声
生成的音频缓存到本地文件，避免重复请求
"""
import asyncio
import hashlib
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# 英式发音声音
VOICE = "en-GB-SoniaNeural"

# 缓存目录
CACHE_DIR = Path(__file__).parent.parent.parent / "tts_cache"
CACHE_DIR.mkdir(exist_ok=True)


def _cache_path(word: str) -> Path:
    """根据单词生成缓存文件路径"""
    key = hashlib.md5(f"{word.lower().strip()}:{VOICE}".encode()).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


async def generate_pronunciation(word: str) -> bytes:
    """
    生成单词英式发音 MP3
    优先读缓存，没有则调用 Edge TTS 生成并缓存
    """
    cache = _cache_path(word)

    # 命中缓存
    if cache.exists():
        return cache.read_bytes()

    # 调用 Edge TTS
    try:
        import edge_tts
        communicate = edge_tts.Communicate(word.strip(), VOICE)
        await communicate.save(str(cache))
        logger.info(f"Edge TTS 生成并缓存: {word}")
        return cache.read_bytes()
    except Exception as e:
        logger.error(f"Edge TTS 生成失败: {word} - {e}")
        # 清理可能的空文件
        if cache.exists() and cache.stat().st_size == 0:
            cache.unlink()
        raise RuntimeError(f"发音生成失败: {e}")


async def batch_generate(words: list[str]) -> dict[str, bool]:
    """批量预生成发音缓存"""
    results = {}
    for word in words:
        try:
            await generate_pronunciation(word)
            results[word] = True
        except Exception:
            results[word] = False
    return results


def is_available() -> bool:
    """检查 edge-tts 是否可用"""
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False
