# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

这是一个专为中小学生设计的英语单词学习系统,采用前后端分离架构,集成AI能力。

- **后端**: Python FastAPI + SQLite + SQLAlchemy (异步)
- **前端**: React 18 + TypeScript + Tailwind CSS + Framer Motion
- **AI集成**: OpenAI GPT-4 / Claude Sonnet

## 常用命令

### 后端开发

```bash
cd backend

# 启动开发服务器
uvicorn app.main:app --reload

# 或使用启动脚本
./start.sh  # macOS/Linux
start.bat   # Windows

# 生成示例数据
python seed_data.py

# 测试API
python test_api.py

# 安装依赖
pip install -r requirements.txt
```

后端运行在 `http://localhost:8000`
API文档: `http://localhost:8000/docs`

### 前端开发

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 代码检查
npm run lint
```

前端运行在 `http://localhost:5173`

## 核心架构

### 后端架构 (backend/app/)

```
app/
├── main.py                      # 应用入口,路由注册,CORS配置
├── core/
│   ├── config.py                # 环境变量配置 (Pydantic Settings)
│   └── database.py              # 异步数据库连接,init_db()自动创建表
├── models/                      # SQLAlchemy ORM模型
│   ├── word.py                  # Word, WordDefinition, WordTag, WordBook, Unit
│   ├── learning.py              # 学习进度和记录模型
│   └── user.py                  # 用户模型
├── schemas/                     # Pydantic数据验证模型
│   ├── word.py                  # API请求/响应模型
│   └── user.py                  # 用户相关schema
├── services/
│   └── ai_service.py            # AI服务核心 - 生成例句、干扰项、试卷等
└── api/v1/                      # RESTful API路由
    ├── auth.py                  # 用户认证 (JWT)
    ├── words.py                 # 单词CRUD,批量导入
    ├── ai.py                    # AI功能端点
    ├── learning.py              # 学习记录
    ├── exams.py                 # 试卷系统
    ├── teacher/units.py         # 教师端单元管理
    └── student/progress.py      # 学生端学习进度
```

### 数据库设计关键点

- **异步初始化**: `init_db()` 在 `main.py` 的 lifespan 中调用,自动读取 `database_schema.sql` 创建表
- **一词多义**: `words` 表关联 `word_definitions` 表支持多个释义
- **单词本结构**: `word_books` -> `units` -> `unit_words` (单词本 -> 单元 -> 单词)
- **学习追踪**: `user_word_progress` 表记录每个单词的掌握度、复习次数、下次复习时间
- **AI缓存**: `ai_cache` 表缓存AI生成内容,减少API调用成本

### AI服务架构 (services/ai_service.py)

`AIService` 类提供核心AI能力:

- `generate_example_sentence()` - 生成适龄例句
- `generate_distractors()` - 生成选择题干扰项
- `explain_mistake()` - 解释拼写错误
- `recommend_words()` - 根据薄弱点推荐单词
- `generate_exam_questions()` - 生成试卷题目
- `analyze_weak_points()` - 分析学习薄弱点

**成本优化策略**:
- 内存缓存 + 数据库缓存双层缓存
- 自动选择 OpenAI 或 Claude (基于 `.env` 配置)
- AI功能是可选的,未配置API Key时仍可使用其他功能

### 前端架构 (frontend/src/)

```
src/
├── main.tsx                     # 应用入口
├── App.tsx                      # 路由配置
├── api/                         # API客户端
│   ├── client.ts                # Axios配置
│   ├── words.ts                 # 单词相关API
│   ├── progress.ts              # 学习进度API
│   └── teacher.ts               # 教师端API
├── components/
│   └── FlashCard.tsx            # 3D翻转卡片组件
└── pages/                       # 页面组件
    ├── Login.tsx
    ├── StudentDashboard.tsx     # 学生仪表板
    ├── TeacherDashboard.tsx     # 教师仪表板
    ├── UnitSelector.tsx         # 单元选择器
    └── FlashCardLearning.tsx    # 卡片学习模式
```

**技术栈**:
- **状态管理**: Zustand (轻量级)
- **数据请求**: React Query (缓存 + 自动重试)
- **动画**: Framer Motion (3D翻转、手势滑动)
- **路由**: React Router v7
- **样式**: Tailwind CSS (配色方案见下)

### UI设计要点

**色彩方案** (避免AI淡紫色):
- 主色: `#FF6B35` (活力橙)
- 辅色: `#FFD23F` (阳光黄)
- 强调: `#00D9FF` (天空蓝)
- 成功: `#5FD35F` (草绿)
- 背景: `#FFF8F0` (温暖米白)

**交互特色**:
- 大量使用 emoji 图标替代传统图标
- 卡片翻转支持3D transform和滑动手势
- 游戏化激励:成就徽章、连续打卡、进度可视化

## 配置文件

### 后端环境变量 (backend/.env)

复制 `.env.example` 创建 `.env`:

```bash
# 数据库 (SQLite异步)
DATABASE_URL=sqlite+aiosqlite:///./english_helper.db

# JWT认证
SECRET_KEY=your-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=10080

# AI配置 (至少配置一个)
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4-turbo-preview

ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-3-sonnet-20240229

# CORS (前端地址)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

## 开发注意事项

### 后端开发

1. **数据库操作**:
   - 所有数据库操作必须使用 `async/await`
   - 使用 `get_db()` 依赖注入获取会话
   - ORM模型在 `models/`,Pydantic模型在 `schemas/`

2. **添加新路由**:
   - 在 `api/v1/` 下创建新模块
   - 在 `main.py` 中注册路由: `app.include_router(your_router, prefix="/api/v1/xxx", tags=["标签"])`

3. **AI功能调用**:
   ```python
   from app.services.ai_service import ai_service

   result = await ai_service.generate_example_sentence(
       word="happy",
       meaning="快乐的",
       difficulty="primary-school"
   )
   ```

4. **错误处理**: 使用FastAPI的 `HTTPException`,不要抛出通用异常

### 前端开发

1. **API调用**:
   - 使用 `src/api/` 下的客户端,不要直接调用axios
   - 配合 React Query 的 `useQuery` 和 `useMutation` hooks

2. **动画性能**:
   - 使用 Framer Motion 的 `AnimatePresence` 处理列表动画
   - 避免频繁的重渲染,使用 `React.memo` 优化

3. **响应式设计**:
   - 移动优先,使用 Tailwind 的响应式类 (`sm:`, `md:`, `lg:`)

4. **音效**:
   - 计划使用 Howler.js (待实现)
   - 答对/答错需要不同的音效反馈

### 通用开发规范

- **Python代码**: 遵循 PEP 8
- **TypeScript代码**: 使用 ESLint配置,运行 `npm run lint`
- **Commit规范**: Conventional Commits (feat:, fix:, docs:, etc.)
- **中文注释**: 代码注释和文档使用中文
- **安全**:
  - 不要提交 `.env` 文件
  - 用户输入必须通过 Pydantic 验证
  - 密码使用 bcrypt 加密 (见 `auth_service.py`)

## 数据库Schema位置

完整的数据库设计见根目录: `database_schema.sql`

包含所有表结构、索引、外键约束和初始示例数据(成就系统)。

## 项目状态

**已完成**:
- ✅ 后端API框架和单词管理
- ✅ AI服务集成(OpenAI/Claude)
- ✅ 前端基础框架和部分页面
- ✅ 单元管理和学习进度追踪

**开发中**:
- 🚧 完整的学习模式(选择题、拼写、填空)
- 🚧 试卷系统前端界面
- 🚧 成就系统实现
- 🚧 数据可视化统计

## 故障排查

### 后端服务无法启动
```bash
# 检查端口占用
lsof -i :8000

# 检查数据库文件权限
ls -la backend/english_helper.db

# 手动初始化数据库
cd backend
sqlite3 english_helper.db < ../database_schema.sql
```

### AI功能报错
```bash
# 验证API Key配置
cd backend
python -c "from app.core.config import settings; print(settings.OPENAI_API_KEY)"

# 如果未配置AI,系统仍可正常运行其他功能
```

### 前端构建失败
```bash
# 清理缓存重新安装
cd frontend
rm -rf node_modules package-lock.json
npm install
```

## 相关文档

- **快速开始**: `docs/快速开始.md`
- **完整项目说明**: `docs/项目说明.md`
- **UI设计方案**: `docs/frontend_ui_design.md`
- **开发计划**: `docs/下一步开发计划.md`
- **后端验证**: `docs/验证后端.md`
