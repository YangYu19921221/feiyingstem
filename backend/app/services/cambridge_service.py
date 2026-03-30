"""
剑桥词典真人发音服务
从 Cambridge Dictionary 提取 UK RP 发音 MP3
首次请求从网页抓取音频URL并下载缓存，后续直接读缓存
"""
import hashlib
import logging
import os
import re
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent.parent / "tts_cache" / "cambridge"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://dictionary.cambridge.org"
DICT_URL = f"{BASE_URL}/dictionary/english/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}

# 匹配 UK 发音 MP3 路径
UK_PRON_RE = re.compile(r'/media/english/uk_pron/[^"\']+\.mp3')


def _cache_path(word: str) -> Path:
    key = hashlib.md5(word.lower().strip().encode()).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


def _miss_marker(word: str) -> Path:
    """标记剑桥词典没有该词的发音，避免重复抓取"""
    key = hashlib.md5(word.lower().strip().encode()).hexdigest()
    return CACHE_DIR / f"{key}.miss"


async def get_pronunciation(word: str) -> bytes | None:
    """
    获取剑桥词典英式真人发音
    返回 MP3 bytes，词典没有该词则返回 None
    短语/句子（含空格）直接返回 None，由 Edge TTS 处理
    """
    word = word.lower().strip()

    # 短语/句子不查剑桥词典
    if ' ' in word:
        return None

    cache = _cache_path(word)
    miss = _miss_marker(word)

    # 命中缓存
    if cache.exists():
        return cache.read_bytes()

    # 已知词典没有该词
    if miss.exists():
        return None

    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            # 1. 请求词典页面
            resp = await client.get(f"{DICT_URL}{word}", headers=HEADERS)
            if resp.status_code != 200:
                miss.touch()
                return None

            # 2. 提取 UK 发音 MP3 URL（取第一个，即目标词的发音）
            urls = UK_PRON_RE.findall(resp.text)
            if not urls:
                miss.touch()
                return None

            audio_url = BASE_URL + urls[0]

            # 3. 下载音频
            audio_resp = await client.get(audio_url, headers=HEADERS)
            if audio_resp.status_code != 200 or len(audio_resp.content) < 100:
                miss.touch()
                return None

            # 4. 缓存
            cache.write_bytes(audio_resp.content)
            logger.info(f"剑桥词典缓存: {word} ({len(audio_resp.content)} bytes)")
            return audio_resp.content

    except Exception as e:
        logger.warning(f"剑桥词典获取失败: {word} - {e}")
        return None
