"""图片生成服务 — gpt-image-2（OpenAI 兼容代理）

用途：创建单词本时生成封面图，成就徽章、阅读理解插图等可复用。
策略：
- 同步调用，带超时，失败时返回 None（上游调用方降级到 cover_color）
- 返回上游给的 URL，不做本地转存（由调用方决定是否保存）
"""
import logging
from typing import Literal, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

ImageSize = Literal["1024x1024", "1024x1536", "1536x1024", "2048x2048"]
ImageQuality = Literal["low", "medium", "high"]

DEFAULT_TIMEOUT = 30.0  # gpt-image-2 典型 10-20s


async def generate_image(
    prompt: str,
    *,
    size: ImageSize = "1024x1024",
    quality: ImageQuality = "high",
    timeout: float = DEFAULT_TIMEOUT,
) -> Optional[str]:
    """调 gpt-image-2 返回图片 URL；任何异常返回 None，不抛给调用方"""
    if not settings.IMAGE_API_KEY:
        logger.warning("IMAGE_API_KEY 未配置，跳过图片生成")
        return None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                settings.IMAGE_API_URL,
                headers={
                    "Authorization": f"Bearer {settings.IMAGE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.IMAGE_MODEL,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality,
                    "n": 1,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            url = (data.get("data") or [{}])[0].get("url")
            if not url:
                logger.warning("图片生成响应无 url 字段: %s", data)
            return url
    except httpx.TimeoutException:
        logger.warning("图片生成超时（prompt=%s...）", prompt[:50])
        return None
    except Exception as e:
        logger.exception("图片生成失败: %s", e)
        return None


def _grade_visual_hint(grade_level: Optional[str]) -> str:
    """根据年级给出画风提示，让小学的更活泼、中学的更克制"""
    if not grade_level:
        return "warm editorial illustration"
    if "小学" in grade_level or any(k in grade_level for k in ("一年级", "二年级", "三年级", "四年级", "五年级", "六年级")):
        return "playful children's book illustration, bright warm colors"
    if "初中" in grade_level or any(k in grade_level for k in ("七年级", "八年级", "九年级")):
        return "clean modern editorial illustration, sophisticated palette"
    if "高中" in grade_level or any(k in grade_level for k in ("高一", "高二", "高三")):
        return "minimalist academic illustration, muted scholarly palette"
    return "warm editorial illustration"


async def generate_book_cover(
    name: str,
    grade_level: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[str]:
    """为单词本生成封面图

    输入单词本元数据，返回图片 URL 或 None（失败时调用方降级到 cover_color）。
    """
    style = _grade_visual_hint(grade_level)
    subject_hint = description.strip() if description else name
    prompt = (
        f"Book cover illustration for an English vocabulary learning book titled '{name}'. "
        f"Theme: {subject_hint}. Style: {style}. "
        f"Centered composition suitable as a square thumbnail. "
        f"No text, no letters, no words on the image. "
        f"Warm inviting atmosphere, soft natural lighting."
    )
    return await generate_image(prompt, size="1024x1024", quality="high")


async def generate_image_with_fallback(prompt: str, quality: str = "medium") -> Optional[str]:
    """三阶降级: 2048 -> 1536x1024 -> 1024x1024。任一成功即返回远端 URL。"""
    for size in ("2048x2048", "1536x1024", "1024x1024"):
        try:
            url = await generate_image(prompt=prompt, size=size, quality=quality)
            if url:
                return url
        except Exception as e:
            logger.warning(f"image2 size={size} 失败: {e}")
    return None


async def download_image_to_uploads(url: str, subdir: str, base_name: str) -> Optional[str]:
    """下载远端图片到 UPLOAD_DIR/<subdir>/<base>-<rand>.png, 返回 /uploads/... 路径。"""
    import uuid as _uuid
    import os as _os
    import httpx as _httpx
    from app.core.config import settings as _settings
    try:
        async with _httpx.AsyncClient(timeout=60) as cli:
            r = await cli.get(url)
            r.raise_for_status()
            content = r.content
        if len(content) < 64:
            return None
        fname = f"{base_name}-{_uuid.uuid4().hex[:8]}.png"
        target_dir = _os.path.join(_settings.UPLOAD_DIR, subdir)
        _os.makedirs(target_dir, exist_ok=True)
        with open(_os.path.join(target_dir, fname), "wb") as f:
            f.write(content)
        return f"/uploads/{subdir}/{fname}"
    except Exception as e:
        logger.warning(f"下载远端图片失败: {e}")
        return None
