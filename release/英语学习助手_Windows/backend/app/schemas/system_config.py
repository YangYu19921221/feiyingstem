from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime


class AIProviderBase(BaseModel):
    """AI提供商基础Schema"""
    provider_name: str = Field(..., description="提供商标识: qwen, openai, claude")
    display_name: str = Field(..., description="显示名称")
    api_key: str = Field(..., description="API密钥")
    base_url: Optional[str] = Field(None, description="API基础URL")
    model_name: str = Field(..., description="模型名称")

    # TTS配置
    tts_enabled: bool = Field(False, description="是否启用语音合成")
    tts_model: Optional[str] = Field(None, description="TTS模型名称")
    tts_voice: Optional[str] = Field(None, description="语音音色")

    # 功能开关
    enabled: bool = Field(True, description="是否启用")
    is_default: bool = Field(False, description="是否为默认提供商")

    # 额外配置
    extra_config: Optional[Dict[str, Any]] = Field(None, description="额外配置")


class AIProviderCreate(AIProviderBase):
    """创建AI提供商"""
    pass


class AIProviderUpdate(BaseModel):
    """更新AI提供商"""
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    tts_enabled: Optional[bool] = None
    tts_model: Optional[str] = None
    tts_voice: Optional[str] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None
    extra_config: Optional[Dict[str, Any]] = None


class AIProviderResponse(AIProviderBase):
    """AI提供商响应"""
    id: int
    api_key: str = Field(..., description="API密钥(脱敏)")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AIProviderTestRequest(BaseModel):
    """测试AI提供商连接"""
    provider_name: str
    api_key: str
    base_url: Optional[str] = None
    model_name: str


class AIProviderTestResponse(BaseModel):
    """测试响应"""
    success: bool
    message: str
    response_time: Optional[float] = None
    test_output: Optional[str] = None
