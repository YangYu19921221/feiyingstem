# AI配置管理使用指南

## 📖 概述

管理员可以通过Web界面配置和管理AI服务,支持通义千问、OpenAI、Claude等多个AI提供商。

---

## 🚀 快速开始

### 1. 登录管理员账号

访问 `http://localhost:5174/login`

```
用户名: admin
密码: admin123
```

### 2. 进入AI配置页面

登录后,在管理员仪表板点击 **"🤖 AI配置"** 卡片,或直接访问:
```
http://localhost:5174/admin/ai-config
```

---

## ⚙️ 配置通义千问 (Qwen3-Max)

### 步骤1: 点击"添加AI服务"

在AI配置页面,点击右上角的 **"➕ 添加AI服务"** 按钮。

### 步骤2: 填写配置信息

| 字段 | 值 | 说明 |
|------|------|------|
| 服务商 | `qwen` | 选择"通义千问 (Qwen)" |
| 显示名称 | `通义千问 Qwen-Max` | 自定义显示名称 |
| API Key | `sk-b6190895f35442fa853a0839f4089ab7` | 你的阿里云API Key(示例) |
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问API地址 |
| 模型名称 | `qwen-max` | 推荐使用qwen-max(最强大) |

> **可用模型**: `qwen-max` (最强)、`qwen-plus` (平衡)、`qwen-turbo` (快速)

### 步骤3: 配置语音合成 (可选)

勾选 **"启用语音合成 (TTS)"**:

| 字段 | 值 |
|------|------|
| TTS模型 | `cosyvoice-v1` |
| 音色 | `longxiaochun` (英语女声) |

### 步骤4: 功能开关

- ✅ 勾选 **"启用此服务"**
- ✅ 勾选 **"设为默认服务"**

### 步骤5: 测试连接

点击 **"🧪 测试连接"** 按钮,验证配置是否正确。

成功后会显示:
```
✅ 连接成功! 响应时间: 1.5秒
回复: 我是通义千问,阿里云开发的AI助手...
```

### 步骤6: 保存配置

点击 **"💾 保存配置"** 按钮。

---

## 🔐 安全性说明

### API密钥加密

所有API密钥在存储到数据库前会自动加密:
- 使用 **Fernet对称加密**
- 加密密钥存储在 `.env` 文件的 `ENCRYPTION_KEY` 变量中
- 前端显示时自动脱敏,仅显示: `sk-b6190...9ab7`

### 权限控制

只有 **admin** 角色的用户才能:
- 查看AI配置列表
- 添加/编辑/删除配置
- 测试AI连接

---

## 📊 配置管理

### 查看所有配置

在AI配置页面会显示所有已配置的AI服务,包括:
- 服务商名称
- 模型信息
- 启用状态
- 是否为默认服务

### 编辑配置

点击配置卡片上的 **"✏️ 编辑"** 按钮:
- 可以修改所有配置项
- API Key留空表示不修改原密钥
- 修改后需要重新测试连接

### 删除配置

点击 **"🗑️"** 按钮删除配置(需要确认)。

### 设置默认服务

每次只能有一个服务被设为默认:
- 勾选"设为默认服务"后,其他服务会自动取消默认标记
- 系统优先使用默认服务的配置

---

## 🔄 配置生效机制

### 配置读取优先级

1. **数据库配置** (优先)
   - 读取 `ai_providers` 表中 `is_default=True` 且 `enabled=True` 的记录
   - 支持动态切换,无需重启服务

2. **环境变量配置** (降级)
   - 如果数据库中没有可用配置,使用 `.env` 文件中的配置
   - 变量: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` 等

### 即时生效

所有AI相关功能会自动使用最新配置:
- ✅ 生成英语例句
- ✅ 生成选择题干扰项
- ✅ 解释拼写错误
- ✅ 生成试卷题目
- ✅ 语音合成 (TTS)

---

## 🛠️ 故障排查

### 问题1: 测试连接失败

**可能原因:**
- API Key错误或已过期
- Base URL不正确
- 网络连接问题
- 模型名称拼写错误

**解决方法:**
1. 检查API Key是否正确
2. 访问阿里云控制台验证密钥状态
3. 确认Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
4. 模型名称应为: `qwen-max` (不是 `qwen3-max`)

### 问题2: AI功能无响应

**检查步骤:**
1. 确认配置已启用 (`enabled=True`)
2. 确认配置已设为默认 (`is_default=True`)
3. 查看后端日志,检查是否有错误信息
4. 尝试重新保存配置

### 问题3: API密钥解密失败

**可能原因:**
- `.env` 文件中的 `ENCRYPTION_KEY` 被修改或丢失

**解决方法:**
1. 检查 `backend/.env` 文件中是否有 `ENCRYPTION_KEY`
2. 如果密钥丢失,需要重新配置所有AI服务
3. 生产环境应妥善备份加密密钥

---

## 💡 最佳实践

### 1. 成本控制

- 优先使用 **qwen3-max**: 性价比高,约 ¥0.02/千tokens
- 对于简单场景,可配置 **qwen3-flash**: 更快更便宜
- 为不同功能配置不同的服务商

### 2. 性能优化

- 启用AI缓存功能 (已内置)
- 定期清理缓存数据
- 监控API调用次数和成本

### 3. 安全建议

- 定期轮换API密钥
- 限制API Key的权限范围
- 不要在日志中输出完整密钥
- 备份 `.env` 文件中的 `ENCRYPTION_KEY`

---

## 📝 技术细节

### 数据库表结构

```sql
CREATE TABLE ai_providers (
    id INTEGER PRIMARY KEY,
    provider_name VARCHAR(50),      -- qwen, openai, claude
    display_name VARCHAR(100),      -- 通义千问 Qwen3-Max
    api_key TEXT,                   -- 加密存储
    base_url VARCHAR(255),          -- API地址
    model_name VARCHAR(100),        -- qwen3-max
    tts_enabled BOOLEAN,            -- 是否启用TTS
    tts_model VARCHAR(100),         -- TTS模型
    tts_voice VARCHAR(50),          -- 音色
    enabled BOOLEAN,                -- 是否启用
    is_default BOOLEAN,             -- 是否默认
    extra_config TEXT,              -- JSON配置
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### API端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/ai/providers` | 获取所有配置 |
| POST | `/api/v1/admin/ai/providers` | 创建配置 |
| PUT | `/api/v1/admin/ai/providers/{id}` | 更新配置 |
| DELETE | `/api/v1/admin/ai/providers/{id}` | 删除配置 |
| POST | `/api/v1/admin/ai/providers/test` | 测试连接 |
| GET | `/api/v1/admin/ai/providers/default` | 获取默认配置 |

---

## 🎯 下一步

配置完成后,你可以:

1. **测试AI功能**
   - 进入学生端,学习单词
   - 查看AI生成的例句
   - 体验语音朗读功能

2. **查看成本**
   - 访问阿里云控制台
   - 监控API调用量和费用

3. **优化配置**
   - 根据实际使用情况调整模型
   - 尝试不同的TTS音色
   - 配置额外的AI提供商作为备份

---

## ❓ 常见问题

**Q: 可以同时配置多个AI服务吗?**
A: 可以!但同一时间只有一个服务会被设为默认。其他服务可以保持配置,方便快速切换。

**Q: 修改配置后需要重启服务吗?**
A: 不需要!配置会立即生效,系统会自动读取最新的默认配置。

**Q: API Key会被泄露吗?**
A: 不会!API Key在数据库中加密存储,前端显示时脱敏,日志中也不会输出完整密钥。

**Q: 如何更换AI服务商?**
A: 只需将另一个配置设为默认即可,无需删除原配置。

---

## 📞 技术支持

如遇问题,请检查:
1. 后端日志: 查看详细错误信息
2. 浏览器控制台: 检查网络请求
3. 阿里云控制台: 验证API Key状态

---

**最后更新时间**: 2025-11-22
**文档版本**: 1.0
