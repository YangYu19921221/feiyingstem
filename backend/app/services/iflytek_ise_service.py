"""
科大讯飞语音评测(ISE)服务
通过WebSocket与讯飞ISE API通信，实现英语发音评测
"""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)
from datetime import datetime
from time import mktime
from urllib.parse import urlencode, urlparse
from wsgiref.handlers import format_date_time

import websockets
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models.system_config import AIProvider


ISE_WS_URL = "wss://ise-api.xfyun.cn/v2/open-ise"
FRAME_SIZE = 1280  # 每帧音频字节数


def _get_encryption_key() -> bytes:
    secret = settings.SECRET_KEY
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def _decrypt_api_key(encrypted_key: str) -> str:
    try:
        f = Fernet(_get_encryption_key())
        return f.decrypt(encrypted_key.encode()).decode()
    except Exception:
        # 解密失败，可能是明文存储的key，直接返回
        return encrypted_key if encrypted_key and len(encrypted_key) < 100 else ""


async def get_config() -> dict | None:
    """从ai_providers表读取讯飞ISE配置"""
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
        return {
            "app_id": extra.get("app_id", ""),
            "api_key": _decrypt_api_key(provider.api_key) if provider.api_key else "",
            "api_secret": extra.get("api_secret", ""),
        }


def _build_auth_url(api_key: str, api_secret: str) -> str:
    """HMAC-SHA256签名生成讯飞鉴权URL"""
    parsed = urlparse(ISE_WS_URL)
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
    return f"{ISE_WS_URL}?{urlencode(params)}"


async def convert_webm_to_pcm(webm_data: bytes) -> bytes:
    """调用ffmpeg将webm音频转为PCM s16le 16kHz mono"""
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f_in:
        f_in.write(webm_data)
        in_path = f_in.name

    out_path = in_path.replace(".webm", ".pcm")

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", in_path,
        "-f", "s16le", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1",
        out_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    await proc.wait()

    try:
        with open(out_path, "rb") as f_out:
            pcm_data = f_out.read()
    finally:
        os.unlink(in_path)
        if os.path.exists(out_path):
            os.unlink(out_path)

    if not pcm_data:
        raise RuntimeError("ffmpeg转换音频失败")
    return pcm_data


def _build_ssb_frame(app_id: str, text: str, category: str) -> str:
    """构建首帧(ssb)：只传参数，不传音频"""
    return json.dumps({
        "common": {"app_id": app_id},
        "business": {
            "sub": "ise",
            "ent": "en_vip",
            "category": category,
            "auf": "audio/L16;rate=16000",
            "aue": "raw",
            "text": text,
            "cmd": "ssb",
            "tte": "utf-8",
            "rstcd": "utf8",
            "ttp_skip": True,
        },
        "data": {
            "status": 0,
        },
    })


def _build_auw_frame(audio_chunk: bytes, aus: int, is_last: bool) -> str:
    """构建音频帧(auw)"""
    return json.dumps({
        "business": {
            "cmd": "auw",
            "aus": aus,
        },
        "data": {
            "status": 2 if is_last else 1,
            "data": base64.b64encode(audio_chunk).decode(),
        },
    })


def _parse_result(xml_text: str, category: str = "read_word") -> dict:
    """解析讯飞返回的XML评测结果，提取分数

    read_word 类别返回 0-5 分，需要 ×20 归一化到 0-100
    read_sentence / read_chapter 类别返回 0-100 分，无需缩放
    """
    result = {
        "total_score": 0.0,
        "accuracy": 0.0,
        "fluency": 0.0,
        "integrity": 0.0,
    }
    try:
        root = ET.fromstring(xml_text)
        # 讯飞ISE XML结构: <xml_result><read_word><rec_paper><read_word total_score=...>>
        # 分数在 rec_paper 下的 read_word/read_sentence 节点上
        for tag in ["read_word", "read_sentence", "read_chapter"]:
            # 优先找 rec_paper 下的节点（带分数的）
            node = root.find(f".//rec_paper/{tag}")
            if node is None:
                node = root.find(f".//{tag}")
            if node is not None and node.get("total_score"):
                result["total_score"] = float(node.get("total_score", 0))
                result["accuracy"] = float(node.get("accuracy_score", 0))
                result["fluency"] = float(node.get("fluency_score", 0))
                result["integrity"] = float(node.get("integrity_score", 0))
                break
    except ET.ParseError:
        pass

    # read_word 分数范围 0-5，缩放到 0-100
    if category == "read_word":
        scale = 20.0
        result["total_score"] = min(round(result["total_score"] * scale, 1), 100.0)
        result["accuracy"] = min(round(result["accuracy"] * scale, 1), 100.0)
        result["fluency"] = min(round(result["fluency"] * scale, 1), 100.0)
        result["integrity"] = min(round(result["integrity"] * scale, 1), 100.0)

    return result


async def _ws_evaluate(config: dict, pcm_data: bytes,
                       text: str, category: str) -> dict:
    """WebSocket通信：分帧发送音频，接收评测结果"""
    url = _build_auth_url(config["api_key"], config["api_secret"])
    app_id = config["app_id"]

    # 讯飞ISE text需要UTF-8 BOM头，英文需要特定标签
    if category == "read_word":
        formatted_text = "\uFEFF" + f"[word]\n{text}\n[/word]"
    elif category == "read_sentence":
        formatted_text = "\uFEFF" + f"[content]\n{text}\n[/content]"
    else:
        formatted_text = "\uFEFF" + text

    result_data = b""
    logger.info(f"ISE评测开始: text={text}, category={category}, pcm_size={len(pcm_data)}")

    # 清除代理环境变量，避免SOCKS代理拦截WebSocket连接
    proxy_vars = ['ALL_PROXY', 'all_proxy', 'HTTPS_PROXY', 'https_proxy',
                  'HTTP_PROXY', 'http_proxy']
    saved = {k: os.environ.pop(k) for k in proxy_vars if k in os.environ}
    try:
        async with websockets.connect(url) as ws:
            # 阶段1: 发送ssb帧（参数上传，不含音频）
            ssb = _build_ssb_frame(app_id, formatted_text, category)
            await ws.send(ssb)

            # 阶段2: 发送音频帧(auw)
            total = len(pcm_data)
            offset = 0
            is_first_audio = True

            while offset < total:
                chunk = pcm_data[offset: offset + FRAME_SIZE]
                is_last = (offset + FRAME_SIZE) >= total

                if is_first_audio:
                    aus = 1  # 第一帧音频
                    is_first_audio = False
                elif is_last:
                    aus = 4  # 最后一帧音频
                else:
                    aus = 2  # 中间帧音频

                frame = _build_auw_frame(chunk, aus, is_last)
                await ws.send(frame)
                offset += FRAME_SIZE

                # 控制发送速率
                if not is_last:
                    await asyncio.sleep(0.04)

            # 接收结果
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                except asyncio.TimeoutError:
                    raise RuntimeError("讯飞ISE评测超时")

                resp = json.loads(msg)
                code = resp.get("code", -1)
                if code != 0:
                    raise RuntimeError(
                        f"讯飞ISE返回错误: code={code}, "
                        f"message={resp.get('message', '')}"
                    )

                data = resp.get("data", {})
                if data.get("data"):
                    result_data += base64.b64decode(data["data"])

                # status==2表示最后一帧结果
                if data.get("status") == 2:
                    break
    finally:
        os.environ.update(saved)

    xml_text = result_data.decode("utf-8")
    print(f"[ISE] 返回XML: {xml_text[:1000]}")
    scores = _parse_result(xml_text, category)
    print(f"[ISE] 解析分数: {scores}")
    return scores


async def evaluate(audio_data: bytes, text: str,
                   category: str = "read_word") -> dict:
    """
    主入口：评测发音
    :param audio_data: webm格式音频数据
    :param text: 评测文本（单词或句子）
    :param category: read_word 或 read_sentence
    :return: 评分字典 {total_score, accuracy, fluency, integrity}
    """
    config = await get_config()
    if not config:
        raise RuntimeError("讯飞语音评测未配置，请在管理后台添加配置")

    if not all([config["app_id"], config["api_key"], config["api_secret"]]):
        raise RuntimeError("讯飞语音评测配置不完整，请检查APPID/APIKey/APISecret")

    # webm -> PCM 16kHz
    pcm_data = await convert_webm_to_pcm(audio_data)

    return await _ws_evaluate(config, pcm_data, text, category)
