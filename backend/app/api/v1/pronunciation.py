"""语音评测 & TTS API端点"""
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
    word: str = Query(None, max_length=100),
    word_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    最佳英式发音接口（女声）
    优先级：剑桥词典真人女声录音 → Edge TTS en-GB-SoniaNeural 英式女声
    支持通过 word 或 word_id 查询
    """
    if not word and word_id:
        from app.models.word import Word
        result = await db.execute(select(Word).where(Word.id == word_id))
        db_word = result.scalar_one_or_none()
        if not db_word:
            raise HTTPException(404, "单词不存在")
        word = db_word.word

    if not word:
        raise HTTPException(400, "请提供 word 或 word_id 参数")

    # 1. 优先使用 Edge TTS 英式女声（保证一致的女声体验）
    if edge_tts_service.is_available():
        try:
            audio_bytes = await edge_tts_service.generate_pronunciation(word)
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
