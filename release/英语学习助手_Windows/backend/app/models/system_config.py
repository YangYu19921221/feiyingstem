from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.core.database import Base


class SystemConfig(Base):
    """系统配置表 - 用于存储AI配置等系统级设置"""
    __tablename__ = "system_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_key = Column(String(100), unique=True, nullable=False, index=True)
    config_value = Column(Text)  # 存储加密后的值
    config_type = Column(String(50), default="string")  # string, json, boolean
    description = Column(Text)
    is_encrypted = Column(Boolean, default=False)  # 是否加密存储
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AIProvider(Base):
    """AI服务提供商配置"""
    __tablename__ = "ai_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider_name = Column(String(50), nullable=False)  # qwen, openai, claude
    display_name = Column(String(100))  # 通义千问, OpenAI, Claude
    api_key = Column(Text)  # 加密存储
    base_url = Column(String(255))
    model_name = Column(String(100))  # qwen3-max, gpt-4, claude-3-sonnet

    # TTS配置
    tts_enabled = Column(Boolean, default=False)
    tts_model = Column(String(100))  # qwen3-tts-flash
    tts_voice = Column(String(50))  # longxiaochun

    # 功能开关
    enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)  # 是否为默认提供商

    # 额外配置
    extra_config = Column(JSON)  # 存储其他配置项 {"temperature": 0.7, "max_tokens": 2000}

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
