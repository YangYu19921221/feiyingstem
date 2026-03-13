from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List
import time
from cryptography.fernet import Fernet
import base64
import os

from app.core.database import get_db
from app.models.system_config import AIProvider
from app.schemas.system_config import (
    AIProviderCreate,
    AIProviderUpdate,
    AIProviderResponse,
    AIProviderTestRequest,
    AIProviderTestResponse
)
from app.api.v1.auth import get_current_user
from app.models.user import User, UserRole

router = APIRouter()


# 简单加密工具(生产环境建议使用更安全的方案)
def get_encryption_key():
    """获取加密密钥 - 使用SECRET_KEY生成"""
    import hashlib
    from app.core.config import settings

    # 使用SECRET_KEY生成32字节的Fernet密钥
    secret = settings.SECRET_KEY
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def encrypt_api_key(api_key: str) -> str:
    """加密API密钥"""
    f = Fernet(get_encryption_key())
    return f.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """解密API密钥"""
    try:
        f = Fernet(get_encryption_key())
        return f.decrypt(encrypted_key.encode()).decode()
    except Exception as e:
        # 解密失败,返回占位符(可能是使用了不同的加密密钥)
        print(f"解密API密钥失败: {e}")
        return "DECRYPTION_FAILED"


def mask_api_key(api_key: str) -> str:
    """脱敏显示API密钥"""
    if api_key == "DECRYPTION_FAILED":
        return "解密失败 (请重新配置)"
    if len(api_key) <= 8:
        return "sk-****"
    return f"{api_key[:8]}...{api_key[-4:]}"


async def require_admin(current_user: User = Depends(get_current_user)):
    """验证管理员权限"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限"
        )
    return current_user


@router.get("/providers", response_model=List[AIProviderResponse])
async def get_ai_providers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """获取所有AI提供商配置"""
    result = await db.execute(select(AIProvider))
    providers = result.scalars().all()

    # 脱敏处理
    response_data = []
    for provider in providers:
        # 处理可能为None的API密钥
        try:
            decrypted_key = decrypt_api_key(provider.api_key) if provider.api_key else ""
            masked_key = mask_api_key(decrypted_key)
        except Exception:
            masked_key = "sk-****"

        provider_dict = {
            "id": provider.id,
            "provider_name": provider.provider_name,
            "display_name": provider.display_name,
            "api_key": masked_key,
            "base_url": provider.base_url or "",
            "model_name": provider.model_name or "",
            "tts_enabled": provider.tts_enabled if provider.tts_enabled is not None else False,
            "tts_model": provider.tts_model,
            "tts_voice": provider.tts_voice,
            "enabled": provider.enabled if provider.enabled is not None else True,
            "is_default": provider.is_default if provider.is_default is not None else False,
            "extra_config": provider.extra_config,
            "created_at": provider.created_at,
            "updated_at": provider.updated_at
        }
        response_data.append(AIProviderResponse(**provider_dict))

    return response_data


@router.post("/providers", response_model=AIProviderResponse)
async def create_ai_provider(
    provider_data: AIProviderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """创建AI提供商配置"""
    # 检查是否已存在
    result = await db.execute(
        select(AIProvider).where(AIProvider.provider_name == provider_data.provider_name)
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"提供商 {provider_data.provider_name} 已存在"
        )

    # 如果设置为默认,取消其他默认配置
    if provider_data.is_default:
        await db.execute(
            update(AIProvider).values(is_default=False)
        )

    # 加密API密钥
    encrypted_key = encrypt_api_key(provider_data.api_key)

    # 创建配置
    new_provider = AIProvider(
        provider_name=provider_data.provider_name,
        display_name=provider_data.display_name,
        api_key=encrypted_key,
        base_url=provider_data.base_url,
        model_name=provider_data.model_name,
        tts_enabled=provider_data.tts_enabled,
        tts_model=provider_data.tts_model,
        tts_voice=provider_data.tts_voice,
        enabled=provider_data.enabled,
        is_default=provider_data.is_default,
        extra_config=provider_data.extra_config
    )

    db.add(new_provider)
    await db.commit()
    await db.refresh(new_provider)

    # 返回时脱敏
    response_dict = {
        **new_provider.__dict__,
        "api_key": mask_api_key(provider_data.api_key)
    }
    return AIProviderResponse(**response_dict)


@router.put("/providers/{provider_id}", response_model=AIProviderResponse)
async def update_ai_provider(
    provider_id: int,
    provider_data: AIProviderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """更新AI提供商配置"""
    result = await db.execute(
        select(AIProvider).where(AIProvider.id == provider_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提供商配置不存在"
        )

    # 更新字段
    update_data = provider_data.model_dump(exclude_unset=True)

    # 如果更新API密钥,需要加密
    # 注意:如果api_key包含***或...,说明是脱敏后的值,不应该更新
    if "api_key" in update_data and update_data["api_key"]:
        api_key = update_data["api_key"]
        # 检查是否为脱敏值(包含***或...)
        if "***" in api_key or "..." in api_key or api_key == "sk-****":
            # 不更新API key,移除这个字段
            del update_data["api_key"]
        else:
            # 真实的新API key,需要加密
            update_data["api_key"] = encrypt_api_key(api_key)

    # 如果设置为默认,取消其他默认配置
    if update_data.get("is_default"):
        await db.execute(
            update(AIProvider).where(AIProvider.id != provider_id).values(is_default=False)
        )

    for key, value in update_data.items():
        setattr(provider, key, value)

    await db.commit()
    await db.refresh(provider)

    # 返回时脱敏
    response_dict = {
        **provider.__dict__,
        "api_key": mask_api_key(decrypt_api_key(provider.api_key))
    }
    return AIProviderResponse(**response_dict)


@router.delete("/providers/{provider_id}")
async def delete_ai_provider(
    provider_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """删除AI提供商配置"""
    result = await db.execute(
        select(AIProvider).where(AIProvider.id == provider_id)
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="提供商配置不存在"
        )

    await db.delete(provider)
    await db.commit()

    return {"message": "删除成功"}


@router.post("/providers/test", response_model=AIProviderTestResponse)
async def test_ai_provider(
    test_data: AIProviderTestRequest,
    current_user: User = Depends(require_admin)
):
    """测试AI提供商连接"""
    try:
        from openai import OpenAI

        start_time = time.time()

        # 创建客户端
        client = OpenAI(
            api_key=test_data.api_key,
            base_url=test_data.base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )

        # 发送测试请求
        response = client.chat.completions.create(
            model=test_data.model_name,
            messages=[
                {"role": "user", "content": "请用一句话介绍你自己"}
            ],
            max_tokens=100
        )

        response_time = time.time() - start_time
        test_output = response.choices[0].message.content

        return AIProviderTestResponse(
            success=True,
            message="连接成功",
            response_time=round(response_time, 2),
            test_output=test_output
        )

    except Exception as e:
        return AIProviderTestResponse(
            success=False,
            message=f"连接失败: {str(e)}"
        )


@router.get("/providers/default")
async def get_default_provider(
    db: AsyncSession = Depends(get_db)
):
    """获取默认AI提供商(供前端调用)"""
    result = await db.execute(
        select(AIProvider).where(
            AIProvider.is_default == True,
            AIProvider.enabled == True
        )
    )
    provider = result.scalar_one_or_none()

    if not provider:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未配置默认AI提供商"
        )

    # 返回解密后的配置(仅内部使用)
    return {
        "provider_name": provider.provider_name,
        "api_key": decrypt_api_key(provider.api_key),
        "base_url": provider.base_url,
        "model_name": provider.model_name,
        "tts_enabled": provider.tts_enabled,
        "tts_model": provider.tts_model,
        "tts_voice": provider.tts_voice,
        "extra_config": provider.extra_config
    }
