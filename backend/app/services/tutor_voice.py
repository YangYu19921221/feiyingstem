"""学习助手「按住说话」(2026-10-27,用户「按你的建议全做了」)

孩子按住麦克风说一句 → 录音上传 → 服务器转成文字 → **填进输入框,孩子看一眼、能改,再自己点发送**(不自动发)。
不自动发是因为中文里夹的英文常听错(10-27 本机实测 Whisper small: 「What about you 是什么意思」「Wednesday 怎么拼」对,
「There is」听成「Diarris」、「go」听成「勾」),让孩子能改一下。

## 怎么转
Whisper 模型只在主进程(进程池,core/process_role 说的那份),所以不新开要分流到主进程的接口(那要改 nginx):
上传接口在哪个进程都行,录音落 private_media/tutor_voice、表 tutor_voice_clips 记一行 pending;
主进程的转写循环(sentence_speech.speech_loop,和开口背 / 跟读同一个进程池)取走转写,language=zh;
前端每秒问一次结果。一般 5–10 秒(轮询 3 秒 + 转写约 6 秒)。

## 一律转成简体
Whisper 听中文常写成繁体(10-27 生产第一条就是「你在幹什麼?聽得到嗎?」,用户「麦克风怎么是这个不是中文简体」)。
转完用 zhconv(纯 Python,自带字表)按 zh-hans 转简体: 只换字形不换说法(不把「软件」换成别的词),英文不动。
转换出错就原样返回并记日志 —— 宁可是繁体也别把孩子说的话弄丢。

## 不留孩子的声音
转完(成功失败都)马上删音频;行里只留文字,1 天后连行删掉。录音只能本人取结果。
不扣「问小鹰老师」次数(只是把话转成字),但限速: 每人每分钟 10 段、每小时 60 段;一段最长 MAX_SECONDS 秒、MAX_BYTES。
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timeutil import utc_now
from app.models.tutor import TutorVoiceClip

logger = logging.getLogger(__name__)

AUDIO_DIR = os.path.join(os.path.dirname(os.path.normpath(settings.SENTENCE_SPEECH_DIR)), "tutor_voice")
MAX_BYTES = 2 * 1024 * 1024
MAX_SECONDS = 30
KEEP_HOURS = 24
MAX_TEXT = 200
EXTS = {"audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/wav": ".wav",
        "audio/x-m4a": ".m4a", "video/webm": ".webm"}


def ext_for(content_type: Optional[str]) -> Optional[str]:
    return EXTS.get((content_type or "").split(";")[0].strip().lower())


def audio_path(name: str) -> str:
    return os.path.join(AUDIO_DIR, os.path.basename(name))


async def save(db: AsyncSession, user_id: int, raw: bytes, ext: str) -> TutorVoiceClip:
    os.makedirs(AUDIO_DIR, exist_ok=True)
    name = f"{user_id}_{uuid.uuid4().hex}{ext}"
    with open(audio_path(name), "wb") as f:
        f.write(raw)
    clip = TutorVoiceClip(user_id=user_id, file_path=name, status="pending", created_at=utc_now())
    db.add(clip)
    await db.commit()
    return clip


async def pending_rows(db: AsyncSession, limit: int) -> list[tuple[int, str, str]]:
    """给转写循环: (id, 文件名, "")—— 和开口背 / 跟读同一个形状"""
    return [(r[0], r[1], "") for r in (await db.execute(
        select(TutorVoiceClip.id, TutorVoiceClip.file_path)
        .where(TutorVoiceClip.status == "pending", TutorVoiceClip.file_path.isnot(None))
        .order_by(TutorVoiceClip.id).limit(limit)
    )).all()]


def _transcribe_zh(path: str) -> str:
    """在转写进程池里跑(和开口背共用模型)。中文为主,英文照原样"""
    from app.services import sentence_speech as ss
    segs, _ = ss._model.transcribe(path, language="zh", beam_size=5, vad_filter=True,
                                   condition_on_previous_text=False)
    return "".join(s.text for s in segs).strip()


def to_simplified(text: str) -> str:
    try:
        from zhconv import convert
        return convert(text, "zh-hans")
    except Exception as e:  # noqa: BLE001
        logger.warning("学习助手语音转简体失败,原样返回: %s", e)
        return text


async def transcribe(path: str) -> str:
    """交给主进程的转写进程池(和开口背 / 跟读共用)"""
    from app.services import sentence_speech as ss
    return await asyncio.get_running_loop().run_in_executor(ss._get_pool(), _transcribe_zh, path)


async def process_one(row_id: int, file_path: str, _unused: str = "") -> None:
    from app.core.database import AsyncSessionLocal

    path = audio_path(file_path)
    values: dict = {"processed_at": utc_now(), "file_path": None}
    try:
        text = to_simplified(await transcribe(path) or "")
        values.update(status="done", text=text[:MAX_TEXT])
    except Exception as e:  # noqa: BLE001  坏文件: 记 failed,不重试
        logger.warning("学习助手语音转写失败 id=%s: %s", row_id, e)
        values.update(status="failed")
    finally:
        try:
            os.remove(path)          # 转完就删,不留孩子的声音
        except OSError:
            pass
    async with AsyncSessionLocal() as db:
        await db.execute(update(TutorVoiceClip).where(TutorVoiceClip.id == row_id).values(**values))
        await db.commit()


async def purge_expired(db: Optional[AsyncSession] = None) -> int:
    """1 天前的行删掉;万一留下的音频文件也删"""
    from app.core.database import AsyncSessionLocal

    cut = utc_now() - timedelta(hours=KEEP_HOURS)

    async def _run(s: AsyncSession) -> int:
        rows = (await s.execute(select(TutorVoiceClip.id, TutorVoiceClip.file_path)
                                .where(TutorVoiceClip.created_at < cut))).all()
        for _, fp in rows:
            if fp:
                try:
                    os.remove(audio_path(fp))
                except OSError:
                    pass
        if rows:
            await s.execute(delete(TutorVoiceClip).where(TutorVoiceClip.id.in_([r[0] for r in rows])))
            await s.commit()
        return len(rows)

    if db is not None:
        return await _run(db)
    async with AsyncSessionLocal() as s:
        return await _run(s)
