"""
Whisper 本地语音识别服务
使用 faster-whisper（CTranslate2）在本地识别单词发音
无需 GPU，base 模型 CPU 推理 <1秒
"""
import asyncio
import logging
import tempfile
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)

_model = None
_executor = ThreadPoolExecutor(max_workers=2)


def _get_model():
    """懒加载 Whisper base 模型"""
    global _model
    if _model is None:
        try:
            import os
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
            from faster_whisper import WhisperModel
            logger.info("正在加载 Whisper small 模型...")
            _model = WhisperModel("small", device="cpu", compute_type="int8")
            logger.info("Whisper 模型加载完成")
        except ImportError:
            logger.warning("faster-whisper 未安装，本地语音识别不可用")
            raise RuntimeError("faster-whisper 未安装")
        except Exception as e:
            logger.error(f"Whisper 模型加载失败: {e}")
            raise
    return _model


def _normalize(text: str) -> str:
    """标准化文本：小写、去标点、去多余空格"""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text


def _words_match(transcript: str, target: str) -> bool:
    """
    判断用户是否正确朗读了目标单词/短语
    - 精确匹配
    - 目标词包含在识别结果中（Whisper 可能在前后添加少量填充词）
    """
    if not transcript:
        return False
    if transcript == target:
        return True
    if target in transcript:
        return True

    # 单词级别：目标词出现在识别结果的词列表中
    target_words = target.split()
    transcript_words = transcript.split()

    if len(target_words) == 1:
        # 单词：识别结果中包含该词即通过
        return target_words[0] in transcript_words

    # 短语：所有目标词按顺序出现在识别结果中
    t_idx = 0
    for tw in transcript_words:
        if t_idx < len(target_words) and tw == target_words[t_idx]:
            t_idx += 1
    return t_idx == len(target_words)


def _sync_verify(audio_bytes: bytes, target_word: str) -> dict:
    """同步执行：音频转文字 + 对比目标单词"""
    model = _get_model()

    logger.debug(f"Whisper verify: target='{target_word}', audio_size={len(audio_bytes)} bytes")

    # 保存音频到临时文件
    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    try:
        tmp.write(audio_bytes)
        tmp.flush()
        tmp.close()

        # Whisper 识别（关闭 VAD，短单词容易被误判为静音）
        segments, info = model.transcribe(
            tmp.name,
            language="en",
            beam_size=5,
            word_timestamps=False,
            vad_filter=False,
            initial_prompt=f"The student is reading the English word: {target_word}",
        )

        # 拼接识别结果
        transcript = ""
        for segment in segments:
            transcript += segment.text

        transcript = transcript.strip()
        normalized_transcript = _normalize(transcript)
        normalized_target = _normalize(target_word)

        # 对比：使用模糊匹配
        matched = _words_match(normalized_transcript, normalized_target)

        logger.debug(f"Whisper result: transcript='{transcript}' | target='{normalized_target}' | matched={matched}")

        return {
            "matched": matched,
            "transcript": transcript,
            "target": target_word,
            "confidence": info.language_probability if info else 0,
        }
    finally:
        os.unlink(tmp.name)


async def verify_word(audio_bytes: bytes, target_word: str) -> dict:
    """
    异步验证单词发音
    :param audio_bytes: WebM 音频数据
    :param target_word: 目标单词
    :return: {"matched": bool, "transcript": str, "target": str, "confidence": float}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _sync_verify, audio_bytes, target_word)


def is_available() -> bool:
    """检查 Whisper 是否可用"""
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False
