"""开口背后台转写(2026-10-11)。

为什么后台: 生产 4 核但 uvicorn 单 worker 只用 1 核。实测 base 4 路并行 40 句要 24s、small 要 70s,
让孩子当场等结果不可行 → 孩子说完照常往下走,录音排队,由**独立进程池**吃掉空闲的核慢慢转。
主进程只做调度,PK / 交卷不受影响。

准确率优先(用户 10-11 要求「准确率高一点」):
- small 模型 + beam 5 + VAD 去静音
- **不给 initial_prompt 喂原句**: 喂了 Whisper 会照着原句「脑补」,背错的也转成对的 —— 那就判不出来了
- 逐词比对按顺序对齐(difflib),单词允许轻微拼写差(Whisper 把 apples 写成 apple 不该算漏)

结果只给老师参考,不进掌握度、不拦学生。音频转完即删(孩子的声音,不留档)。
"""
from __future__ import annotations

import asyncio
import difflib
import logging
import multiprocessing
import os
import re
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update

from app.core.config import settings

logger = logging.getLogger(__name__)

PASS_RATIO = 0.7          # 只给老师端展示用的参考线;过不过看 judge(): 实词一个不能漏
WORKERS = int(os.environ.get("SENTENCE_SPEECH_WORKERS", "2"))   # 留 2 核给主服务和系统
MODEL_SIZE = os.environ.get("SENTENCE_SPEECH_MODEL", "small")
POLL_SEC = 3.0

_NUM_WORDS = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
              "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "11": "eleven",
              "12": "twelve", "20": "twenty", "100": "hundred"}
_CONTRACT = {"it's": "it is", "i'm": "i am", "you're": "you are", "he's": "he is", "she's": "she is",
             "we're": "we are", "they're": "they are", "that's": "that is", "what's": "what is",
             "don't": "do not", "doesn't": "does not", "can't": "can not", "cannot": "can not",
             "isn't": "is not", "aren't": "are not", "let's": "let us", "i'll": "i will",
             "there's": "there is", "where's": "where is", "who's": "who is", "how's": "how is"}


# ---------- 比对(纯函数,测试直接调) ----------

def tokenize(text: str) -> list[str]:
    """小写、展开缩写、数字转单词、去标点。缩写两边都展开: 原句 It's 学生说 it is 不该算错"""
    t = re.sub(r"^\s*[—\-–]+\s*", "", text or "").lower().replace("’", "'")
    out: list[str] = []
    for w in re.findall(r"[a-z0-9]+(?:'[a-z]+)?", t):
        w = _CONTRACT.get(w, w)
        for p in w.split():
            out.append(_NUM_WORDS.get(p, p))
    return out


def _close(a: str, b: str) -> bool:
    if a == b:
        return True
    if min(len(a), len(b)) <= 2:          # 短词(a/is/in)必须完全一致,否则 is/it 互相放水
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def compare(target: str, transcript: str) -> tuple[float, list[str]]:
    """按顺序对齐,返回 (命中比例, 漏说/说错的原句词)。顺序对齐防「把原句的词乱序念一遍」也全中"""
    tw, hw = tokenize(target), tokenize(transcript)
    if not tw:
        return 1.0, []
    # 先用精确匹配找对齐骨架,再在没对上的片段里做模糊配对
    hit = [False] * len(tw)
    sm = difflib.SequenceMatcher(None, tw, hw, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for i in range(i1, i2):
                hit[i] = True
        elif tag == "replace":
            j = j1
            for i in range(i1, i2):
                for k in range(j, j2):
                    if _close(tw[i], hw[k]):
                        hit[i] = True
                        j = k + 1
                        break
    ratio = sum(hit) / len(tw)
    missed = [w for w, h in zip(tw, hit) if not h]
    return ratio, missed


def judge(target: str, transcript: str) -> tuple[float, list[str], bool]:
    """背出来 = **实词全中**,只许漏/错虚词(a/is/the…,这类 Whisper 本身也常吞)。
    不用比例阈值: 实测七成阈值会放过「My mother is a banana」(只换一个关键词还有 80%)"""
    from app.services.sentence_learning import _STOPWORDS
    ratio, missed = compare(target, transcript)
    content_missed = [w for w in missed if w not in _STOPWORDS and len(w) >= 3]
    return ratio, missed, not content_missed


# ---------- 子进程: 每个进程加载一次模型 ----------

_model = None


def _init_worker():
    global _model
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    from faster_whisper import WhisperModel
    # 每进程 1 线程: 实测多进程各 1 线程比 1 进程 4 线程吞吐高(CTranslate2 单句并行度有限)
    _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8", cpu_threads=1)


def _transcribe(path: str) -> str:
    segs, _ = _model.transcribe(path, language="en", beam_size=5, vad_filter=True,
                                condition_on_previous_text=False)
    return " ".join(s.text for s in segs).strip()


_pool: Optional[ProcessPoolExecutor] = None


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        # spawn: fork 一个跑着 asyncio + sqlite 连接的进程不安全
        _pool = ProcessPoolExecutor(max_workers=WORKERS, mp_context=multiprocessing.get_context("spawn"),
                                    initializer=_init_worker)
    return _pool


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def audio_path(name: str) -> str:
    return os.path.join(settings.SENTENCE_SPEECH_DIR, os.path.basename(name))


# ---------- 调度循环(主进程) ----------

async def _process_one(row_id: int, file_path: str, english: str) -> None:
    from app.core.database import AsyncSessionLocal
    from app.models.sentence_speech import SentenceSpeech
    path = audio_path(file_path)
    values: dict = {"processed_at": datetime.utcnow(), "file_path": None}
    try:
        text = await asyncio.get_running_loop().run_in_executor(_get_pool(), _transcribe, path)
        ratio, missed, ok = judge(english, text)
        values.update(status="done", transcript=text[:1000], hit_ratio=round(ratio, 3),
                      missed_words=",".join(missed)[:500], passed=ok)
    except Exception as e:   # 解码失败等: 记 failed,不重试(重试同一个坏文件只会卡住队列)
        logger.warning("开口背转写失败 id=%s: %s", row_id, e)
        values.update(status="failed")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    async with AsyncSessionLocal() as db:
        await db.execute(update(SentenceSpeech).where(SentenceSpeech.id == row_id).values(**values))
        await db.commit()


async def speech_loop() -> None:
    """每 POLL_SEC 取一批 pending,最多 WORKERS×2 条在飞(进程池自己排队)"""
    from app.core.database import AsyncSessionLocal
    from app.models.sentence import Sentence
    from app.models.sentence_speech import SentenceSpeech
    from app.services import read_aloud
    from app.services import tutor_history
    from app.services import tutor_relay_health
    from app.services import tutor_voice
    # 音标视频同步到腾讯云 COS(2026-10-25,见 services/cos_video): 后台线程,没配 COS 什么都不做。
    # 挂在这里而不是 main.py 的 lifespan: 生产 main.py 与仓库有 drift,少碰一次
    try:
        from app.services import cos_video
        cos_video.start_background_sync(settings.PHONETIC_VIDEO_DIR)
    except Exception as e:  # noqa: BLE001
        logger.warning("COS 视频同步没启动: %s", e)
    if not is_available():
        # 不转写也得按时删跟读录音: 14 天保留是答应过的,不能因为没装 whisper 就一直留着孩子的声音
        logger.warning("faster-whisper 未安装,开口背/跟读后台转写不启用(跟读录音照常 14 天后删)")
        while True:
            try:
                await read_aloud.purge_expired()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("跟读录音到期删除出错: %s", e)
            # 学习助手对话到期清理(services/tutor_history,出错只记日志)
            await tutor_history.purge_quietly()
            # 学习助手中转钱包 / Key 检查(services/tutor_relay_health,内部按 30 分钟节流)
            await tutor_relay_health.check_quietly(asyncio.get_running_loop().time())
            await asyncio.sleep(1800)
    # 开口背与例句跟读(2026-10-24)共用这一个进程池和调度循环;两张表的 id 各自独立,在飞集合按 (来源, id) 记
    inflight: set[tuple[str, int]] = set()
    last_purge = 0.0
    while True:
        try:
            room = WORKERS * 2 - len(inflight)
            if room > 0:
                async with AsyncSessionLocal() as db:
                    rows = (await db.execute(
                        select(SentenceSpeech.id, SentenceSpeech.file_path, Sentence.english)
                        .join(Sentence, Sentence.id == SentenceSpeech.sentence_id)
                        .where(SentenceSpeech.status == "pending", SentenceSpeech.file_path.isnot(None))
                        .order_by(SentenceSpeech.id).limit(room + len(inflight))
                        .execution_options(skip_tenant_filter=True)
                    )).all()
                    ra_rows = await read_aloud.pending_rows(db, room + len(inflight))
                    # 学习助手「按住说话」(services/tutor_voice): 孩子在等,排最前
                    tv_rows = await tutor_voice.pending_rows(db, room + len(inflight))
                jobs = [("tutor_voice", rid, fp, s, tutor_voice.process_one) for rid, fp, s in tv_rows] + \
                       [("speech", rid, fp, eng, _process_one) for rid, fp, eng in rows] + \
                       [("read_aloud", rid, fp, s, read_aloud.process_one) for rid, fp, s in ra_rows]
                for src, rid, fp, text, fn in jobs:
                    key = (src, rid)
                    if key in inflight or len(inflight) >= WORKERS * 2:
                        continue
                    inflight.add(key)
                    t = asyncio.create_task(fn(rid, fp, text))
                    t.add_done_callback(lambda _t, k=key: inflight.discard(k))
            # 跟读录音保留 14 天,到期删文件(一小时查一次)
            if asyncio.get_running_loop().time() - last_purge > 3600:
                last_purge = asyncio.get_running_loop().time()
                n = await read_aloud.purge_expired()
                if n:
                    logger.info("跟读录音到期删除 %s 条", n)
                await tutor_history.purge_quietly()
                try:
                    await tutor_voice.purge_expired()
                except Exception as e:  # noqa: BLE001
                    logger.error("学习助手语音到期删除出错: %s", e)
            await tutor_relay_health.check_quietly(asyncio.get_running_loop().time())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("开口背转写调度出错: %s", e)
        await asyncio.sleep(POLL_SEC)


def shutdown() -> None:
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
