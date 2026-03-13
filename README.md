# 🎓 英语学习助手 - 中小学生背单词系统

一个专为中小学生设计的趣味英语学习系统,支持多种学习模式,集成AI智能功能。

## 📁 项目结构

```
english-learning-app/
├── backend/              # 后端 (Python FastAPI)
│   ├── app/              # 应用代码
│   ├── venv/             # Python虚拟环境
│   ├── requirements.txt  # Python依赖
│   └── .env             # 环境变量配置
│
├── frontend/             # 前端 (React + TypeScript)
│   ├── src/              # 源代码
│   ├── public/           # 静态资源
│   └── package.json      # Node依赖
│
├── docs/                 # 文档
│   ├── 快速开始.md
│   ├── 项目说明.md
│   ├── frontend_ui_design.md
│   └── 下一步开发计划.md
│
├── database_schema.sql   # 数据库设计
└── README.md            # 本文件
```

## 🚀 快速开始

### 前置要求

- **Python 3.9+**
- **Node.js 18+**
- **npm 或 pnpm**

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件,填入必要的配置

# 启动服务
uvicorn app.main:app --reload
```

后端将运行在: http://localhost:8000

API文档: http://localhost:8000/docs

### 2. 启动前端 (即将开发)

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端将运行在: http://localhost:5173

## 🎯 核心功能

### 学生端
- 🃏 **卡片翻转记忆** - 3D动画,滑动手势
- ✅ **选择题测试** - AI生成干扰项
- ✏️ **拼写练习** - 智能纠错
- 📝 **例句填空** - 真实语境学习
- 🏆 **成就系统** - 游戏化激励
- 📊 **学习报告** - 可视化进度

### 老师端
- 📚 **单词管理** - 批量录入,一词多义
- 📖 **单词本创建** - 按主题/年级分类
- 🎯 **智能出题** - AI根据薄弱点生成试卷
- 📈 **学生监控** - 查看学习数据

## 🤖 AI功能

- 自动生成适龄例句
- 智能生成选择题干扰项
- 根据薄弱点推荐单词
- 生成个性化试卷
- 拼写错误解释

**支持的AI服务:**
- OpenAI (GPT-4)
- Claude (Anthropic)
- 通义千问 (待集成)
- 文心一言 (待集成)

## 🎨 UI设计特色

- **活力橙黄 + 天空蓝** 配色(避免AI淡紫色)
- **大号emoji图标** 直观易懂
- **游戏化激励** 连续打卡、成就徽章
- **流畅动画** 60fps交互体验
- **响应式设计** 移动优先

## 📖 文档导航

- **[快速开始](./docs/快速开始.md)** - 10分钟上手指南
- **[项目说明](./docs/项目说明.md)** - 完整技术文档
- **[UI设计方案](./docs/frontend_ui_design.md)** - 前端设计详解
- **[开发计划](./docs/下一步开发计划.md)** - 开发路线图
- **[后端验证](./docs/验证后端.md)** - 后端测试步骤

## 🛠️ 技术栈

### 后端
- FastAPI - 高性能异步Web框架
- SQLite - 轻量级数据库
- SQLAlchemy - ORM
- Pydantic - 数据验证
- OpenAI/Claude SDK - AI集成

### 前端
- React 18 - UI框架
- TypeScript - 类型安全
- Tailwind CSS - 样式框架
- Framer Motion - 动画库
- React Query - 数据管理
- Zustand - 状态管理

## 📊 数据库设计

完整的数据库schema见: [database_schema.sql](./database_schema.sql)

核心表:
- `users` - 用户(学生/老师)
- `words` - 单词库
- `word_definitions` - 单词释义
- `word_books` - 单词本
- `user_word_progress` - 学习进度
- `learning_records` - 学习记录
- `exam_papers` - 试卷
- `achievements` - 成就系统

## 🔄 开发状态

### ✅ 已完成
- [x] 数据库设计
- [x] 后端API框架
- [x] 单词管理API
- [x] AI功能集成
- [x] 前端UI设计方案
- [x] 项目文档

### 🚧 开发中
- [ ] 前端React应用
- [ ] 学习模块API
- [ ] 用户认证系统
- [ ] 试卷系统

### 📝 待开发
- [ ] 成就系统实现
- [ ] 数据可视化
- [ ] 移动端适配
- [ ] 部署上线

## 🤝 贡献指南

欢迎提交Issue和Pull Request!

**开发流程:**
1. Fork项目
2. 创建功能分支
3. 提交更改
4. 发起Pull Request

**代码规范:**
- Python: PEP 8
- TypeScript: ESLint + Prettier
- Commit: Conventional Commits

## 📄 开源协议

MIT License

## 📞 联系方式

- 项目地址: [GitHub仓库地址]
- 问题反馈: [Issues]
- 技术文档: [./docs/]

---

**开始你的英语学习之旅吧! 🚀**

Built with ❤️ for students
