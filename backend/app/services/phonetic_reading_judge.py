"""音标跟读判定 —— 判「这个音标读对了没」

## 为什么不用 whisper_service.verify_word
实测它在这个场景会放过念错的音:拿 bad 的音频去验 bed,判 66 分通过 ——
而 æ/e 这组对立正是本教材 1—1 要教的。两个根因:
  1. `initial_prompt` 把目标词喂给模型,静音时模型背出提示词判 95 分(孩子不说话也过);
  2. 判分用**拼写**编辑距离,bad/bed 差一个字母算 66 分,超过 60 的通过线。

## 为什么按音标比而不按拼写比
第一版我用拼写规则近似发音(折哑 e、叠辅音),结果 `fee` 读对了被判错:
whisper 听成 "See",拼写规则把 fee→fe 对不上 See→se。
**用拼写近似发音本身就不可靠。** 而库里有 9984 条真实音标,直接查表比音标:
  see/sea 都是 /siː/  → 同音,等价
  fee /fiː/ vs see /siː/ → 辅音不同,判错
  bad /bæd/ vs bed /bed/ → 元音不同,判错(这正是要抓的)

## 判定的用途与边界
只决定「要不要变绿」,不打分、不拦路、不进金币分母。
判不准一律回 uncertain 让孩子再读一次,**绝不假通过**(放过念错的音等于没教),
但文案是「没听清」而不是「你读错了」—— 判错的代价是孩子不敢开口,代价不对称。
"""
import asyncio
import logging
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)

_model = None
# 单请求约吃 1.7 个核,并发放大只会互相拖慢,刻意压到 2
_executor = ThreadPoolExecutor(max_workers=2)

# 太短一律当没说话。webm/opus 约 20KB/秒,3000 字节连半秒都不到
_MIN_AUDIO_BYTES = 3000


def _get_model():
    global _model
    if _model is None:
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        from faster_whisper import WhisperModel
        logger.info("加载 Whisper small(音标跟读判定)")
        _model = WhisperModel("small", device="cpu", compute_type="int8")
    return _model


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def normalize_ipa(raw: str) -> str:
    """把音标折成可比对的形式。

    折掉的都是**不影响是不是同一个音**的写法差异:长音符两种写法、g 的两种字形、
    重音符、音节点、括号。刻意**不碰元音字母** —— 元音正是要判的东西。
    """
    s = (raw or '').strip()
    s = re.sub(r'^[/\[]|[/\]]$', '', s)
    s = s.replace(':', 'ː').replace('g', 'ɡ')
    s = s.replace('ɹ', 'r').replace('ɫ', 'l')
    s = re.sub(r'[ˈˌ.\s()]', '', s)
    s = s.replace('ʧ', 'tʃ').replace('ʤ', 'dʒ')
    s = s.replace('ɛ', 'e').replace('ɑ', 'ɑ')
    # 词尾的 r 在英式里常不发音(car /kɑː(r)/),两种写法都认
    s = re.sub(r'\(r\)$|r$', '', s) if s.endswith(('(r)',)) else s
    return s


def _cons_skeleton(ipa: str) -> str:
    """辅音骨架:去掉所有元音。用来判「只有元音不同」的最小对立对"""
    vowels = 'iɪeæɑʌɒɔʊuɜəyː'
    return ''.join(c for c in ipa if c not in vowels)


def _vowels_only(ipa: str) -> str:
    vowels = 'iɪeæɑʌɒɔʊuɜə'
    return ''.join(c for c in ipa if c in vowels)


class IpaLookup:
    """词 → 音标。数据来自项目现有词库(9984 条),不额外引依赖"""

    def __init__(self, mapping: dict[str, str]):
        self._m = {k.lower(): normalize_ipa(v) for k, v in mapping.items() if v}

    def get(self, word: str) -> Optional[str]:
        return self._m.get(re.sub(r'[^a-z\'\- ]', '', (word or '').lower().strip()))


def _sync_judge(audio: bytes, target_word: str, target_ipa: str,
                sibling_ipas: dict, lookup: IpaLookup) -> dict:
    """返回 {verdict, heard, heard_ipa, reason}

    verdict: pass / near_miss(念成本节近音词) / mismatch / silent / uncertain
    """
    if len(audio) < _MIN_AUDIO_BYTES:
        return {"verdict": "silent", "heard": "", "reason": "没听到声音"}

    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    try:
        tmp.write(audio)
        tmp.close()
        try:
            # ⚠️ 不传 initial_prompt:传了目标词,静音时模型会背提示词然后判满分
            segments, _ = _get_model().transcribe(
                tmp.name, language="en", beam_size=5,
                vad_filter=True,                  # 纯静音直接出空,不硬凑文本
                condition_on_previous_text=False,
            )
        except Exception as e:
            logger.warning("跟读音频解码失败: %s", e)
            return {"verdict": "uncertain", "heard": "", "reason": "音频没解开"}

        heard_raw = ''.join(s.text for s in segments).strip()
        if not re.search(r'[A-Za-z]', heard_raw):
            return {"verdict": "silent", "heard": "", "reason": "没听到声音"}

        tgt = normalize_ipa(target_ipa)
        words = [w for w in re.findall(r"[A-Za-z']+", heard_raw)]

        # 逐个候选词查音标比对。识别可能带冠词(「the bad」),任一命中即算过
        heard_ipas = []
        for w in words:
            ipa = lookup.get(w)
            if ipa:
                heard_ipas.append((w, ipa))
                if ipa == tgt:
                    return {"verdict": "pass", "heard": heard_raw,
                            "heard_ipa": ipa, "reason": ""}

        # 拼写恰好等于目标词:即使库里查不到音标也算过
        if any(w.lower() == target_word.lower() for w in words):
            return {"verdict": "pass", "heard": heard_raw, "reason": ""}

        # 念成了本节的最小对立词 → 必须纠,绝不放过
        for w, ipa in heard_ipas:
            if ipa in sibling_ipas and sibling_ipas[ipa].lower() != target_word.lower():
                return {"verdict": "near_miss", "heard": heard_raw, "heard_ipa": ipa,
                        "reason": f"听起来像本节的 {sibling_ipas[ipa]}"}

        # 辅音骨架相同但元音不同 = 元音念偏了,这是拼读要教的核心
        for w, ipa in heard_ipas:
            if (_cons_skeleton(ipa) == _cons_skeleton(tgt)
                    and _vowels_only(ipa) != _vowels_only(tgt)):
                return {"verdict": "near_miss", "heard": heard_raw, "heard_ipa": ipa,
                        "reason": "中间的元音念偏了"}

        if not heard_ipas:
            # 一个词都查不到音标 —— 判不准,不能当错处理
            return {"verdict": "uncertain", "heard": heard_raw,
                    "reason": "没听清"}

        return {"verdict": "mismatch", "heard": heard_raw,
                "heard_ipa": heard_ipas[0][1], "reason": "和目标不一样"}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


async def judge_reading(audio: bytes, target_word: str, target_ipa: str,
                        sibling_ipas: dict, lookup: IpaLookup) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor, _sync_judge, audio, target_word, target_ipa, sibling_ipas, lookup)
