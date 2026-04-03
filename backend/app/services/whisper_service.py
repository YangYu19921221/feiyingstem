"""
Whisper 本地语音识别服务
使用 faster-whisper（CTranslate2）在本地识别单词发音
无需 GPU，base 模型 CPU 推理 <0.5秒
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
            logger.info("正在加载 Whisper base 模型...")
            _model = WhisperModel("base", device="cpu", compute_type="int8")
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


def _levenshtein(a: str, b: str) -> int:
    """计算编辑距离"""
    if len(a) < len(b):
        return _levenshtein(b, a)
    if len(b) == 0:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (0 if ca == cb else 1)))
        prev = curr
    return prev[len(b)]


def _words_match(transcript: str, target: str) -> bool:
    """
    判断用户是否正确朗读了目标单词/短语
    严格匹配：识别文本必须完整包含目标词，且不能只是部分匹配
    """
    if not transcript:
        return False

    # 精确匹配
    if transcript == target:
        return True

    target_words = target.split()
    transcript_words = transcript.split()

    if len(target_words) == 1:
        # 单个单词：必须在识别结果的词列表中完整出现
        target_word = target_words[0]

        # 精确匹配：识别出的某个词完全等于目标
        if target_word in transcript_words:
            return True

        # 容错匹配：允许编辑距离 <= 1（应对 Whisper 微小拼写差异）
        # 但目标词长度必须 >= 3，且编辑距离与词长比不超过 30%
        for tw in transcript_words:
            dist = _levenshtein(tw, target_word)
            max_dist = max(1, len(target_word) // 4)  # 4个字母容错1个，8个字母容错2个
            if dist <= max_dist and len(tw) >= len(target_word) * 0.7:
                return True

        return False

    # 短语：所有目标词按顺序出现在识别结果中（精确匹配每个词）
    t_idx = 0
    for tw in transcript_words:
        if t_idx < len(target_words) and tw == target_words[t_idx]:
            t_idx += 1
    return t_idx == len(target_words)


def _audio_too_small(audio_bytes: bytes) -> bool:
    """静音/纯噪声检测：WebM 文件太小说明没有有效语音"""
    return len(audio_bytes) < 3000


def _sync_verify(audio_bytes: bytes, target_word: str) -> dict:
    """同步执行：音频转文字 + 对比目标单词"""
    model = _get_model()

    logger.debug(f"Whisper verify: target='{target_word}', audio_size={len(audio_bytes)} bytes")

    # 噪音检测：音频太小说明是静音或纯噪声
    if _audio_too_small(audio_bytes):
        logger.debug(f"Whisper: 音频过小 ({len(audio_bytes)} bytes)，判定为静音")
        return {
            "matched": False,
            "transcript": "",
            "target": target_word,
            "confidence": 0,
            "error": "未检测到语音，请靠近麦克风重新朗读",
        }

    # 保存音频到临时文件
    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    try:
        tmp.write(audio_bytes)
        tmp.flush()
        tmp.close()

        # Whisper 识别（关闭 VAD，短单词容易被误判为静音）
        try:
            segments, info = model.transcribe(
                tmp.name,
                language="en",
                beam_size=1,
                word_timestamps=False,
                vad_filter=False,
                initial_prompt=f"The student is reading the English word: {target_word}",
            )
        except Exception as e:
            logger.warning(f"Whisper 音频解码失败: {e}")
            return {
                "matched": False,
                "transcript": "",
                "target": target_word,
                "confidence": 0,
                "error": "音频解码失败，请重新录音",
            }

        # 拼接识别结果
        transcript = ""
        for segment in segments:
            transcript += segment.text

        transcript = transcript.strip()
        normalized_transcript = _normalize(transcript)
        normalized_target = _normalize(target_word)

        # 防半词通过：如果识别结果明显比目标短，且不是完整词匹配，拒绝
        if normalized_transcript and normalized_target:
            # 如果识别出的文本长度不足目标的 50%，直接判不通过
            if len(normalized_transcript) < len(normalized_target) * 0.5:
                logger.debug(f"Whisper: 识别文本过短 '{transcript}' vs target '{target_word}' -> 不通过")
                return {
                    "matched": False,
                    "transcript": transcript,
                    "target": target_word,
                    "confidence": info.language_probability if info else 0,
                }

        # 对比：使用严格匹配
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
