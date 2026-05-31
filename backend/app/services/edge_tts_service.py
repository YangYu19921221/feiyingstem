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
    key = hashlib.md5(f"{word.lower().strip()}:{VOICE}:v3".encode()).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


async def generate_pronunciation(word: str) -> bytes:
    """
    生成单词英式发音 MP3
    优先读缓存，没有则调用 Edge TTS 生成并缓存
    """
    cache = _cache_path(word)

    if cache.exists():
        # 防御坏缓存：历史上 communicate.save 中途失败可能留下 0 字节文件，
        # 命中后会返回空音频，导致该词永远没声音。发现空文件直接删除重新生成
        if cache.stat().st_size > 0:
            return cache.read_bytes()
        try:
            cache.unlink()
        except OSError:
            pass

    try:
        import edge_tts
        text = word.strip()
        # 补句末标点，触发自然的语调下降，避免尾音被吞
        if not text.endswith(('.', '!', '?')):
            text += '.'

        tmp = cache.with_suffix(".mp3.tmp")
        # 微软 Edge TTS 偶发网络抖动/空响应：服务端先重试，
        # 尽量不把瞬时失败传导到前端造成单个词静音
        max_attempts = 3
        last_err: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                communicate = edge_tts.Communicate(text, VOICE)
                # 先写临时文件，确认非空后再原子替换到正式缓存路径，
                # 避免半成品/空文件被后续请求当成有效缓存命中
                await communicate.save(str(tmp))
                if not tmp.exists() or tmp.stat().st_size == 0:
                    raise RuntimeError("Edge TTS 返回空音频")
                tmp.replace(cache)
                logger.info(f"Edge TTS 生成并缓存: {word} (第 {attempt} 次)")
                return cache.read_bytes()
            except Exception as e:
                last_err = e
                if tmp.exists():
                    try:
                        tmp.unlink()
                    except OSError:
                        pass
                if attempt < max_attempts:
                    await asyncio.sleep(0.4 * attempt)
        raise RuntimeError(f"Edge TTS 连续 {max_attempts} 次失败: {last_err}")
    except Exception as e:
        logger.error(f"Edge TTS 生成失败: {word} - {e}")
        # 清理可能残留的空文件，防止污染缓存
        for p in (cache, cache.with_suffix(".mp3.tmp")):
            try:
                if p.exists() and p.stat().st_size == 0:
                    p.unlink()
            except OSError:
                pass
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
