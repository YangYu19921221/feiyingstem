"""
科大讯飞TTS语音合成服务
复用讯飞ISE的凭证(app_id / api_key / api_secret)，通过WebSocket合成MP3音频
"""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime
from time import mktime
from urllib.parse import urlencode, urlparse
from wsgiref.handlers import format_date_time

import websockets
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.system_config import AIProvider

logger = logging.getLogger(__name__)

TTS_WS_URL = "wss://tts-api.xfyun.cn/v2/tts"


def _get_encryption_key() -> bytes:
    secret = settings.SECRET_KEY
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def _decrypt_api_key(encrypted_key: str) -> str:
    try:
        f = Fernet(_get_encryption_key())
        return f.decrypt(encrypted_key.encode()).decode()
    except Exception:
        return ""


async def get_config() -> dict | None:
    """从ai_providers表读取讯飞ISE配置（TTS复用同一套凭证）"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AIProvider).where(
                AIProvider.provider_name == "iflytek_ise",
                AIProvider.enabled == True,
            )
        )
        provider = result.scalar_one_or_none()
        if not provider:
            return None

        extra = provider.extra_config or {}
        config = {
            "app_id": extra.get("app_id", ""),
            "api_key": _decrypt_api_key(provider.api_key) if provider.api_key else "",
            "api_secret": extra.get("api_secret", ""),
        }
        if not all([config["app_id"], config["api_key"], config["api_secret"]]):
            return None
        return config


def _build_auth_url(api_key: str, api_secret: str) -> str:
    """HMAC-SHA256签名生成讯飞TTS鉴权URL"""
    parsed = urlparse(TTS_WS_URL)
    now = datetime.now()
    date = format_date_time(mktime(now.timetuple()))

    signature_origin = (
        f"host: {parsed.netloc}\n"
        f"date: {date}\n"
        f"GET {parsed.path} HTTP/1.1"
    )

    signature_sha = hmac.new(
        api_secret.encode("utf-8"),
        signature_origin.encode("utf-8"),
        digestmod=hashlib.sha256,
    ).digest()
    signature = base64.b64encode(signature_sha).decode()

    authorization_origin = (
        f'api_key="{api_key}", '
        f'algorithm="hmac-sha256", '
        f'headers="host date request-line", '
        f'signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()

    params = {
        "authorization": authorization,
        "date": date,
        "host": parsed.netloc,
    }
    return f"{TTS_WS_URL}?{urlencode(params)}"


async def _ws_synthesize(config: dict, text: str, voice: str) -> bytes:
    """WebSocket通信：发送文本，收集MP3音频块"""
    url = _build_auth_url(config["api_key"], config["api_secret"])

    request_payload = json.dumps({
        "common": {"app_id": config["app_id"]},
        "business": {
            "aue": "lame",
            "auf": "audio/L16;rate=16000",
            "vcn": voice,
            "tte": "UTF8",
        },
        "data": {
            "status": 2,
            "text": base64.b64encode(text.encode("utf-8")).decode(),
        },
    })

    audio_chunks = []

    # 清除代理环境变量，避免SOCKS代理拦截WebSocket连接
    proxy_vars = [
        "ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy",
        "HTTP_PROXY", "http_proxy",
    ]
    saved = {k: os.environ.pop(k) for k in proxy_vars if k in os.environ}
    try:
        async with websockets.connect(url) as ws:
            await ws.send(request_payload)

            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                except asyncio.TimeoutError:
                    raise RuntimeError("讯飞TTS合成超时")

                resp = json.loads(msg)
                code = resp.get("code", -1)
                if code != 0:
                    raise RuntimeError(
                        f"讯飞TTS返回错误: code={code}, "
                        f"message={resp.get('message', '')}"
                    )

                data = resp.get("data", {})
                audio_b64 = data.get("audio")
                if audio_b64:
                    audio_chunks.append(base64.b64decode(audio_b64))

                # status==2 表示末帧
                if data.get("status") == 2:
                    break
    finally:
        os.environ.update(saved)

    if not audio_chunks:
        raise RuntimeError("讯飞TTS未返回音频数据")
    return b"".join(audio_chunks)


async def generate_speech(text: str, voice: str = "xiaoyan") -> bytes:
    """
    主入口：合成语音
    :param text: 要合成的文本
    :param voice: 发音人，默认xiaoyan（英语女声）
    :return: MP3格式音频bytes
    """
    config = await get_config()
    if not config:
        raise RuntimeError("讯飞TTS未配置")

    logger.info(f"讯飞TTS合成: text={text}, voice={voice}")
    return await _ws_synthesize(config, text, voice)
