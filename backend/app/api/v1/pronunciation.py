"""语音评测 & TTS API端点"""
import re
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.services import iflytek_ise_service
from app.services.iflytek_tts_service import generate_speech
from app.services import whisper_service
from app.services import edge_tts_service
from app.services import cambridge_service

router = APIRouter()


def _expand_for_tts(word: str) -> str:
    """把要送 TTS 的拼写展开成更可读的发音文本。
    缩写读法有歧义(Ms 可读 miz 也可读字母 M-S),机器无法只靠拼写判断,
    一律交由录入时的 tts_text 字段决定;这里不再猜缩写,只展开 sb/sth 占位,
    其余保持原样(没填 tts_text 就按拼写发音,宁可读字母也不猜错)。
    """
    t = re.sub(r'\bsb\.?\b', 'somebody', word, flags=re.IGNORECASE)
    t = re.sub(r'\bsth\.?\b', 'something', t, flags=re.IGNORECASE)
    return t


async def _synthesize(text: str) -> Response:
    """把一段文本原样交给 Edge TTS 合成(给 raw 试听用)。

    ⚠️ **刻意不走剑桥词典兜底**,而正常路径是走的。理由:兜底是**按拼写**取真人录音,
    与这段文本无关。如果 Edge TTS 挂了而这里退到剑桥,老师会听到那个词**正确的**
    真人发音 → 以为自己的改写生效了,其实一个字都没生效 —— 试听的全部价值就是
    "听到的就是将来学生听到的",宁可明确报错也不能给一个听起来对的假象。
    no-store: 试听文本每敲一个字就变一版,缓存任意字符串没意义还占地方。
    """
    if not edge_tts_service.is_available():
        raise HTTPException(503, "试听需要 Edge TTS,当前不可用")
    try:
        audio_bytes = await edge_tts_service.generate_pronunciation(text)
    except RuntimeError:
        raise HTTPException(500, "试听合成失败,请重试")
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Source": "edge-tts-raw"},
    )


MAX_AUDIO_SIZE = 5 * 1024 * 1024  # 5MB


@router.post("/evaluate")
async def evaluate_pronunciation(
    audio: UploadFile = File(...),
    text: str = Form(...),
    category: str = Form("read_word"),
    current_user: User = Depends(get_current_user),
):
    """接收录音并返回发音评分"""
    if category not in ("read_word", "read_sentence"):
        raise HTTPException(400, "category必须为read_word或read_sentence")

    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(400, "音频文件不能超过5MB")

    try:
        scores = await iflytek_ise_service.evaluate(
            audio_data, text, category
        )
        return {"success": True, **scores}
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/tts")
async def text_to_speech(
    text: str = Query(..., max_length=200),
    voice: str = Query("xiaoyan"),
):
    """讯飞TTS：文本转语音，返回MP3音频"""
    try:
        audio_bytes = await generate_speech(text, voice)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/config-status")
async def pronunciation_config_status():
    """检查讯飞ISE是否已配置"""
    config = await iflytek_ise_service.get_config()
    configured = (
        config is not None
        and bool(config.get("app_id"))
        and bool(config.get("api_key"))
        and bool(config.get("api_secret"))
    )
    return {"configured": configured}


@router.post("/verify-word")
async def verify_word_pronunciation(
    audio: UploadFile = File(...),
    word: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    """
    Whisper 本地单词发音校验
    录音转文字，对比目标单词，返回是否匹配
    """
    if not whisper_service.is_available():
        raise HTTPException(501, "Whisper 未安装，本地语音识别不可用")

    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(400, "音频文件不能超过5MB")
    if not word.strip():
        raise HTTPException(400, "word 不能为空")

    try:
        result = await whisper_service.verify_word(audio_data, word.strip())
        return result
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/whisper-status")
async def whisper_status():
    """检查 Whisper 是否可用"""
    return {"available": whisper_service.is_available()}


@router.get("/edge-tts")
async def best_pronunciation(
    word: str = Query(None, max_length=500),
    word_id: int = Query(None),
    raw: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """
    最佳英式发音接口（女声）
    优先级：剑桥词典真人女声录音 → Edge TTS en-GB-SoniaNeural 英式女声
    支持通过 word 或 word_id 查询

    raw=1: **把 word 当成最终 TTS 文本逐字合成**，不查库、不套 tts_text、
    不做缩写展开。这是给后台「填 tts_text 时当场试听」用的 ——
    不加这个参数，老师在输入框改了字但还没保存，试听会拿输入内容去
    按拼写查库：
      · 查不到 → 效果凑巧是对的（多数改写拼法都查不到）
      · **查到了就骗人** → 播的是那条词已存的旧 tts_text，不是刚敲的字。
        例:把 record 的 tts_text 改成 "record" 想听原音，`?word=record`
        会命中 record 那行、套上旧值 "rekord" → 听到的仍是旧发音，
        老师会以为「改了没用」
    有了 raw 才有这条硬保证: raw 试听字符串 S == 保存 tts_text=S 后学生听到的。
    (安全面没变大: word 参数本来就接受任意 500 字文本合成，raw 只是少查一次库)
    """
    from app.models.word import Word

    # raw: 逐字合成,直接跳过所有「查库取 tts_text / 展开缩写」的逻辑
    if raw:
        if not word or not word.strip():
            raise HTTPException(400, "raw 模式需要提供 word 文本")
        return await _synthesize(word.strip())

    db_word = None
    # word_id 优先:精确定位到具体那条(区分一词多音),即使同时传了 word 文本。
    # 若 word_id 查不到(已被删/客户端持有过期 id),但带了 word 文本则回退按拼写发音,
    # 不直接 404——避免改词/迁移后旧页面发音整个失败。
    if word_id:
        result = await db.execute(select(Word).where(Word.id == word_id))
        db_word = result.scalar_one_or_none()
        if db_word:
            word = db_word.word
        elif not word:
            raise HTTPException(404, "单词不存在")

    if not word:
        raise HTTPException(400, "请提供 word 或 word_id 参数")

    # TTS 文本：优先用数据库的 tts_text 字段，没有则自动展开缩写
    tts_text = None
    if not db_word:
        result = await db.execute(select(Word).where(Word.word == word).limit(1))
        db_word = result.scalars().first()
    if db_word and db_word.tts_text:
        tts_text = db_word.tts_text

    if not tts_text:
        tts_text = _expand_for_tts(word)

    # 1. 优先使用 Edge TTS 英式女声
    if edge_tts_service.is_available():
        try:
            audio_bytes = await edge_tts_service.generate_pronunciation(tts_text)
            return Response(
                content=audio_bytes,
                media_type="audio/mpeg",
                headers={"Cache-Control": "public, max-age=86400", "X-Source": "edge-tts"},
            )
        except RuntimeError:
            pass

    # 2. Fallback: 剑桥词典真人录音（仅单词）
    cambridge_audio = await cambridge_service.get_pronunciation(word)
    if cambridge_audio:
        return Response(
            content=cambridge_audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=604800", "X-Source": "cambridge"},
        )

    raise HTTPException(500, "发音生成失败")
