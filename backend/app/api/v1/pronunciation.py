"""语音评测 & TTS API端点"""
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, HTTPException
from fastapi.responses import Response
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.services import iflytek_ise_service
from app.services.iflytek_tts_service import generate_speech

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
