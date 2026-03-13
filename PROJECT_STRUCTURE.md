# 📁 项目结构说明

## 整体结构

```
english-learning-app/
├── backend/                    # 后端 (Python FastAPI)
├── frontend/                   # 前端 (React + TypeScript) - 即将创建
├── docs/                       # 文档目录
├── logs/                       # 运行日志
├── database_schema.sql         # 数据库设计文件
├── README.md                   # 项目主README
├── .gitignore                  # Git忽略文件
├── start-dev.sh                # 开发环境启动脚本
└── stop-dev.sh                 # 开发环境停止脚本
```

## 📦 backend/ - 后端目录

```
backend/
├── app/                        # 应用代码
│   ├── __init__.py
│   ├── main.py                 # FastAPI应用入口
│   ├── api/v1/                 # API路由
│   │   ├── auth.py             # 认证API
│   │   ├── words.py            # 单词管理API ✅
│   │   ├── ai.py               # AI功能API ✅
│   │   ├── learning.py         # 学习模块API
│   │   └── exams.py            # 试卷系统API
│   ├── core/                   # 核心模块
│   │   ├── config.py           # 配置管理
│   │   └── database.py         # 数据库连接
│   ├── models/                 # SQLAlchemy模型
│   │   ├── word.py             # 单词相关模型
│   │   └── learning.py         # 学习记录模型
│   ├── schemas/                # Pydantic Schema
│   │   └── word.py             # 单词Schema
│   └── services/               # 业务服务
│       └── ai_service.py       # AI服务 ✅
│
├── venv/                       # Python虚拟环境
├── .env                        # 环境变量配置
├── .env.example                # 环境变量模板
├── requirements.txt            # Python依赖
├── start.sh                    # 后端启动脚本 (Linux/Mac)
├── start.bat                   # 后端启动脚本 (Windows)
├── test_api.py                 # API测试脚本
├── seed_data.py                # 示例数据生成器
├── init_db_manual.py           # 手动数据库初始化脚本
└── english_helper.db           # SQLite数据库文件
```

## 🎨 frontend/ - 前端目录 (即将创建)

```
frontend/
├── src/                        # 源代码
│   ├── main.tsx                # 应用入口
│   ├── App.tsx                 # 根组件
│   ├── api/                    # API请求封装
│   │   ├── client.ts           # Axios配置
│   │   ├── words.ts            # 单词API
│   │   └── learning.ts         # 学习API
│   ├── components/             # 可复用组件
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── FlashCard.tsx       # 翻转卡片组件 ⭐
│   │   ├── ProgressBar.tsx
│   │   └── Layout/
│   ├── pages/                  # 页面组件
│   │   ├── Home.tsx            # 首页
│   │   ├── Learn.tsx           # 学习页面
│   │   ├── Test.tsx            # 测试页面
│   │   └── Profile.tsx         # 个人中心
│   ├── stores/                 # Zustand状态管理
│   │   ├── auth.ts             # 用户状态
│   │   └── learning.ts         # 学习状态
│   ├── hooks/                  # 自定义Hooks
│   ├── utils/                  # 工具函数
│   └── styles/                 # 样式文件
│
├── public/                     # 静态资源
├── index.html                  # HTML模板
├── package.json                # 依赖配置
├── tsconfig.json               # TypeScript配置
├── vite.config.ts              # Vite配置
└── tailwind.config.js          # Tailwind配置
```

## 📚 docs/ - 文档目录

```
docs/
├── 快速开始.md                 # 10分钟上手指南
├── 项目说明.md                 # 完整技术文档
├── frontend_ui_design.md       # 前端UI设计方案
├── 下一步开发计划.md           # 开发路线图
└── 验证后端.md                 # 后端测试步骤
```

## 🗄️ 数据库结构

SQLite数据库文件: `backend/english_helper.db`

完整设计见: `database_schema.sql`

**核心表:**
- users - 用户表
- words - 单词表
- word_definitions - 单词释义
- word_tags - 单词标签
- word_books - 单词本
- user_word_progress - 学习进度
- learning_records - 学习记录
- exam_papers - 试卷
- achievements - 成就系统

## 🚀 快速启动

### 方式1: 使用一键启动脚本 (推荐)

```bash
# 启动开发环境 (后端 + 前端)
./start-dev.sh

# 停止所有服务
./stop-dev.sh
```

### 方式2: 分别启动

**启动后端:**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

**启动前端:**
```bash
cd frontend
npm run dev
```

## 📝 环境变量配置

复制 `backend/.env.example` 到 `backend/.env`,配置以下变量:

```env
# 数据库
DATABASE_URL=sqlite+aiosqlite:///./english_helper.db

# JWT认证
SECRET_KEY=your-secret-key-here

# AI服务 (选填,不影响基础功能)
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
```

## 🔧 常用命令

### 后端

```bash
# 安装依赖
pip install -r requirements.txt

# 初始化数据库
python init_db_manual.py

# 导入示例数据
python seed_data.py

# 运行测试
python test_api.py

# 启动服务
uvicorn app.main:app --reload
```

### 前端 (即将创建)

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 📊 开发状态

### ✅ 已完成
- 项目结构规范化
- 后端API框架
- 单词管理功能
- AI功能集成
- 完整文档

### 🚧 开发中
- 前端React应用
- 学习模块
- 用户认证

### 📝 待开发
- 试卷系统
- 成就系统
- 数据可视化

## 🤝 开发规范

### Git提交规范

使用 Conventional Commits:

```
feat: 新功能
fix: 修复bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试相关
chore: 构建/工具相关
```

### 代码规范

- **Python**: PEP 8
- **TypeScript**: ESLint + Prettier
- **CSS**: Tailwind CSS utility classes

### 分支管理

- `main` - 主分支,稳定版本
- `dev` - 开发分支
- `feature/*` - 功能分支
- `fix/*` - 修复分支

## 📞 获取帮助

- 查看文档: `docs/`
- API文档: http://localhost:8000/docs
- 问题反馈: GitHub Issues
