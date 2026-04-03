"""
Whisper 本地语音识别 + 发音评分服务
使用 faster-whisper（CTranslate2）识别发音，基于文本相似度计算发音分数
"""
import asyncio
import logging
import tempfile
import os
import re
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

_model = None
_executor = ThreadPoolExecutor(max_workers=2)

# 发音通过阈值
PASS_SCORE = 60


def _get_model():
    """懒加载 Whisper small 模型（准确度优先）"""
    global _model
    if _model is None:
        try:
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


def _levenshtein(a: str, b: str) -> int:
    """编辑距离"""
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


def _similarity_ratio(a: str, b: str) -> float:
    """文本相似度 0.0~1.0"""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    dist = _levenshtein(a, b)
    max_len = max(len(a), len(b))
    return 1.0 - (dist / max_len)


def _compute_score(transcript: str, target: str) -> int:
    """
    计算发音分数 0-100
    综合考虑：完整词匹配、文本相似度、长度比例
    """
    if not transcript:
        return 0

    t_words = transcript.split()
    target_words = target.split()

    # 精确匹配 → 满分
    if transcript == target:
        return 100

    # 单词场景
    if len(target_words) == 1:
        tw = target_words[0]

        # 识别结果中有精确匹配的词 → 高分
        if tw in t_words:
            return 95

        # 找识别结果中和目标最接近的词
        best_sim = 0.0
        for w in t_words:
            sim = _similarity_ratio(w, tw)
            best_sim = max(best_sim, sim)

        # 也和整段识别文本比一下（Whisper 可能不分词）
        full_sim = _similarity_ratio(transcript, tw)
        best_sim = max(best_sim, full_sim)

        # 映射到分数：sim=1.0→100, sim=0.8→80, sim=0.5→40
        score = int(best_sim * 100)

        # 长度差异惩罚：识别文本比目标短太多扣分
        len_ratio = len(transcript) / max(len(tw), 1)
        if len_ratio < 0.5:
            score = min(score, 30)
        elif len_ratio < 0.7:
            score = int(score * 0.8)

        return min(score, 100)

    # 短语场景：按词逐一匹配
    matched = 0
    t_idx = 0
    for w in t_words:
        if t_idx < len(target_words):
            sim = _similarity_ratio(w, target_words[t_idx])
            if sim >= 0.7:
                matched += 1
                t_idx += 1

    match_ratio = matched / len(target_words)
    return min(int(match_ratio * 100), 100)


def _audio_too_small(audio_bytes: bytes) -> bool:
    """静音检测"""
    return len(audio_bytes) < 3000


def _sync_verify(audio_bytes: bytes, target_word: str) -> dict:
    """同步执行：音频转文字 + 评分"""
    model = _get_model()

    logger.debug(f"Whisper verify: target='{target_word}', audio_size={len(audio_bytes)} bytes")

    if _audio_too_small(audio_bytes):
        return {
            "matched": False,
            "score": 0,
            "transcript": "",
            "target": target_word,
            "confidence": 0,
            "error": "未检测到语音，请靠近麦克风重新朗读",
        }

    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    try:
        tmp.write(audio_bytes)
        tmp.flush()
        tmp.close()

        try:
            segments, info = model.transcribe(
                tmp.name,
                language="en",
                beam_size=3,
                word_timestamps=False,
                vad_filter=False,
                initial_prompt=f"The student is reading the English word: {target_word}",
            )
        except Exception as e:
            logger.warning(f"Whisper 音频解码失败: {e}")
            return {
                "matched": False,
                "score": 0,
                "transcript": "",
                "target": target_word,
                "confidence": 0,
                "error": "音频解码失败，请重新录音",
            }

        transcript = ""
        for segment in segments:
            transcript += segment.text

        transcript = transcript.strip()
        normalized_transcript = _normalize(transcript)
        normalized_target = _normalize(target_word)

        # 计算分数
        score = _compute_score(normalized_transcript, normalized_target)
        matched = score >= PASS_SCORE

        logger.debug(
            f"Whisper result: transcript='{transcript}' | target='{normalized_target}' "
            f"| score={score} | matched={matched}"
        )

        return {
            "matched": matched,
            "score": score,
            "transcript": transcript,
            "target": target_word,
            "confidence": info.language_probability if info else 0,
        }
    finally:
        os.unlink(tmp.name)


async def verify_word(audio_bytes: bytes, target_word: str) -> dict:
    """异步验证单词发音，返回含 score 的结果"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _sync_verify, audio_bytes, target_word)


def is_available() -> bool:
    """检查 Whisper 是否可用"""
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False
