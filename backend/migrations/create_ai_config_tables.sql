-- AI配置相关表
-- 创建时间: 2025-11-22

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    config_type VARCHAR(50) DEFAULT 'string',
    description TEXT,
    is_encrypted BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_configs_key ON system_configs(config_key);

-- AI提供商配置表
CREATE TABLE IF NOT EXISTS ai_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name VARCHAR(50) NOT NULL,
    display_name VARCHAR(100),
    api_key TEXT,
    base_url VARCHAR(255),
    model_name VARCHAR(100),

    -- TTS配置
    tts_enabled BOOLEAN DEFAULT 0,
    tts_model VARCHAR(100),
    tts_voice VARCHAR(50),

    -- 功能开关
    enabled BOOLEAN DEFAULT 1,
    is_default BOOLEAN DEFAULT 0,

    -- 额外配置
    extra_config TEXT,  -- JSON格式

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_name ON ai_providers(provider_name);
CREATE INDEX IF NOT EXISTS idx_ai_providers_default ON ai_providers(is_default);

-- 插入默认的通义千问配置(需要管理员后续填入API Key)
INSERT OR IGNORE INTO ai_providers (
    provider_name,
    display_name,
    api_key,
    base_url,
    model_name,
    tts_enabled,
    tts_model,
    tts_voice,
    enabled,
    is_default,
    extra_config
) VALUES (
    'qwen',
    '通义千问 Qwen3-Max',
    '',  -- 需要管理员配置
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'qwen3-max',
    1,
    'qwen3-tts-flash',
    'longxiaochun',
    0,  -- 默认禁用,配置后启用
    1,
    '{"temperature": 0.7, "max_tokens": 2000}'
);

-- 插入OpenAI配置模板
INSERT OR IGNORE INTO ai_providers (
    provider_name,
    display_name,
    api_key,
    base_url,
    model_name,
    tts_enabled,
    tts_model,
    tts_voice,
    enabled,
    is_default,
    extra_config
) VALUES (
    'openai',
    'OpenAI GPT-4',
    '',
    'https://api.openai.com/v1',
    'gpt-4',
    0,
    NULL,
    NULL,
    0,
    0,
    '{"temperature": 0.7, "max_tokens": 2000}'
);
