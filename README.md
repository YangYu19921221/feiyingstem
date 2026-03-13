# 🎓 英语学习助手 - 中小学生背单词系统

一个专为中小学生设计的趣味英语学习系统,支持多种学习模式,集成AI智能功能。

[![GitHub](https://img.shields.io/badge/GitHub-feiyingstem-blue)](https://github.com/YangYu19921221/feiyingstem)
[![Python](https://img.shields.io/badge/Python-3.9+-green.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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

- **Python 3.9+** - [下载地址](https://www.python.org/downloads/)
- **Node.js 18+** - [下载地址](https://nodejs.org/)
- **npm 或 pnpm** - Node.js自带npm
- **Git** - [下载地址](https://git-scm.com/downloads)

### 安装步骤

#### 1. 克隆项目

**方式一：使用SSH（推荐，需要配置SSH密钥）**
```bash
git clone git@github.com:YangYu19921221/feiyingstem.git
cd feiyingstem
```

**方式二：使用HTTPS（无需配置，直接克隆）**
```bash
git clone https://github.com/YangYu19921221/feiyingstem.git
cd feiyingstem
```

**方式三：下载ZIP压缩包**
1. 访问 https://github.com/YangYu19921221/feiyingstem
2. 点击绿色的 "Code" 按钮
3. 选择 "Download ZIP"
4. 解压到本地目录
5. 在终端中进入解压后的目录

#### 2. 启动后端

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

# 初始化数据库
python init_db_manual.py

# 创建测试用户
python create_test_user.py

# 启动服务
uvicorn app.main:app --reload
# 或使用启动脚本
./start.sh  # macOS/Linux
start.bat   # Windows
```

**后端服务地址:**
- API: http://localhost:8000
- API文档: http://localhost:8000/docs
- 交互式文档: http://localhost:8000/redoc

#### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

**前端服务地址:**
- 应用: http://localhost:5173

#### 4. 登录系统

**测试账号:**
- 学生账号: `student` / 密码: `123456`
- 教师账号: `teacher` / 密码: `123456`
- 管理员账号: `admin` / 密码: `admin123`

### 一键启动 (推荐)

```bash
# 在项目根目录执行
./start-dev.sh  # macOS/Linux

# 停止服务
./stop-dev.sh
```

## 🎯 核心功能

### 学生端功能
- 🃏 **卡片翻转记忆** - 3D动画效果,支持滑动手势
- ✅ **选择题测试** - AI生成干扰项,智能出题
- ✏️ **拼写练习** - 实时纠错,智能提示
- 📝 **例句填空** - 真实语境学习,加深理解
- 🏆 **成就系统** - 游戏化激励,徽章收集
- 📊 **学习报告** - 可视化进度,薄弱点分析
- 🎮 **实时竞赛** - 多人在线PK,排行榜系统
- 📖 **错题本** - 自动收集错题,针对性复习
- 🐾 **虚拟宠物** - 学习养成,趣味互动
- 📚 **阅读理解** - 文章阅读,题目练习

### 教师端功能
- 📚 **单词管理** - 批量录入,一词多义支持
- 📖 **单词本创建** - 按主题/年级/单元分类
- 🎯 **智能出题** - AI根据薄弱点生成试卷
- 📈 **学生监控** - 实时查看学习数据和进度
- 📝 **作业布置** - 在线布置和批改作业
- 🏁 **竞赛管理** - 创建和管理实时竞赛
- 📊 **数据分析** - 班级整体学习情况分析
- 👥 **学生管理** - 学生信息和权限管理

### 管理员功能
- 👤 **用户管理** - 用户增删改查,权限控制
- 🤖 **AI配置** - 多AI服务配置和切换
- 📊 **系统统计** - 全局数据统计和分析
- 💳 **订阅管理** - 会员订阅和激活码管理

## 🤖 AI功能

系统集成多种AI服务，提供智能化学习体验：

### AI能力
- 🎯 **智能例句生成** - 根据单词和年级自动生成适龄例句
- 🔀 **干扰项生成** - 为选择题智能生成相似干扰选项
- 📝 **试卷自动生成** - 根据学习进度和薄弱点智能出题
- 💡 **错误解释** - 分析拼写错误，给出纠正建议
- 📊 **薄弱点分析** - 智能分析学习数据，推荐复习内容
- 🎓 **个性化推荐** - 根据学生水平推荐合适的学习内容

### 支持的AI服务
- ✅ **OpenAI GPT-4** - 强大的语言理解和生成能力
- ✅ **Claude (Anthropic)** - 高质量的对话和内容生成
- ✅ **通义千问 (DashScope)** - 阿里云AI服务
- ✅ **讯飞星火** - 语音评测和TTS服务

### AI配置说明

在 `backend/.env` 文件中配置AI服务：

```bash
# OpenAI配置
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_BASE_URL=https://api.openai.com/v1  # 可选，支持代理

# Claude配置
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-3-sonnet-20240229

# 通义千问配置
DASHSCOPE_API_KEY=sk-xxx

# 讯飞配置（语音评测和TTS）
IFLYTEK_APP_ID=xxx
IFLYTEK_API_KEY=xxx
IFLYTEK_API_SECRET=xxx
```

**注意：** AI功能是可选的，未配置API Key时系统仍可正常使用其他功能。

## 🎨 UI设计特色

- **活力橙黄 + 天空蓝** 配色(避免AI淡紫色)
- **大号emoji图标** 直观易懂
- **游戏化激励** 连续打卡、成就徽章
- **流畅动画** 60fps交互体验
- **响应式设计** 移动优先

## 📖 使用指南

### 学生使用流程

1. **登录系统**
   - 使用教师提供的账号密码登录
   - 首次登录可选择虚拟宠物

2. **选择学习内容**
   - 在仪表板查看已分配的单词本
   - 选择要学习的单元

3. **开始学习**
   - **卡片模式**: 翻转卡片记忆单词，支持滑动切换
   - **选择题**: 选择正确的单词释义
   - **拼写练习**: 根据释义拼写单词
   - **填空练习**: 在例句中填入正确单词

4. **参加竞赛**
   - 进入竞赛大厅，加入教师创建的竞赛
   - 实时答题，查看排行榜

5. **查看进度**
   - 学习报告：查看学习时长、正确率等数据
   - 错题本：复习做错的题目
   - 成就系统：收集学习徽章

### 教师使用流程

1. **创建单词本**
   - 进入"单词管理"
   - 创建新单词本，设置年级和主题
   - 添加单元，录入单词

2. **录入单词**
   - **手动录入**: 逐个添加单词和释义
   - **批量导入**: 使用CSV模板批量导入
   - **AI生成**: 使用AI自动生成例句

3. **布置作业**
   - 选择单词本和单元
   - 分配给指定学生或班级
   - 设置截止时间

4. **创建竞赛**
   - 进入"竞赛管理"
   - 创建新竞赛，选择题目
   - 设置竞赛时间和规则
   - 开始竞赛，实时监控

5. **查看数据**
   - 学生进度：查看每个学生的学习情况
   - 数据分析：班级整体数据统计
   - 导出报告：生成学习报告

### 管理员使用流程

1. **用户管理**
   - 创建教师和学生账号
   - 分配权限和角色
   - 重置密码

2. **AI配置**
   - 配置多个AI服务
   - 设置默认AI服务
   - 监控API使用量

3. **系统维护**
   - 查看系统统计数据
   - 管理订阅和激活码
   - 系统配置优化

## 📖 文档导航

- **[快速开始](./docs/快速开始.md)** - 10分钟上手指南
- **[项目说明](./docs/项目说明.md)** - 完整技术文档
- **[UI设计方案](./docs/frontend_ui_design.md)** - 前端设计详解
- **[开发计划](./docs/下一步开发计划.md)** - 开发路线图
- **[后端验证](./docs/验证后端.md)** - 后端测试步骤
- **[竞赛系统使用指南](./docs/实时竞赛系统使用指南.md)** - 竞赛功能详解
- **[AI试卷生成说明](./docs/AI试卷生成使用说明.md)** - AI出题功能
- **[单词导入模板](./docs/单词导入模板说明.md)** - 批量导入指南

## 🔧 常见问题

### 后端相关

**Q: 后端启动失败，提示端口被占用？**
```bash
# 查看占用8000端口的进程
lsof -i :8000
# 杀死进程
kill -9 <PID>
```

**Q: 数据库初始化失败？**
```bash
# 删除旧数据库
rm backend/english_helper.db
# 重新初始化
cd backend
python init_db_manual.py
```

**Q: AI功能报错？**
- 检查 `.env` 文件中的API Key是否正确
- 确认API Key有足够的额度
- 查看 `logs/` 目录下的日志文件

### 前端相关

**Q: 前端启动失败？**
```bash
# 清理缓存重新安装
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Q: 无法连接后端API？**
- 确认后端服务已启动（http://localhost:8000）
- 检查 `frontend/src/config/env.ts` 中的API地址配置
- 查看浏览器控制台的网络请求

**Q: 页面显示异常？**
- 清除浏览器缓存
- 使用Chrome或Edge浏览器
- 检查是否有浏览器插件干扰

### 功能相关

**Q: 如何批量导入单词？**
1. 下载模板：`批量上传单词模板.csv`
2. 按格式填写单词数据
3. 在教师端"单词管理"中选择"批量导入"

**Q: 如何创建竞赛？**
1. 教师端进入"竞赛管理"
2. 点击"创建竞赛"
3. 选择题目和设置规则
4. 开始竞赛，学生可加入

**Q: 学生忘记密码怎么办？**
```bash
# 教师或管理员可重置密码
cd backend
python reset_student_password.py
```

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
- [x] 数据库设计和初始化
- [x] 后端API框架搭建
- [x] 单词管理完整功能
- [x] AI服务集成（OpenAI/Claude/通义千问）
- [x] 用户认证系统（JWT）
- [x] 学习进度追踪
- [x] 试卷系统API
- [x] 实时竞赛系统
- [x] 前端基础框架
- [x] 学生端主要页面
- [x] 教师端管理界面
- [x] 响应式UI设计

### 🚧 开发中
- [ ] 虚拟宠物系统
- [ ] 成就系统完善
- [ ] 语音评测功能
- [ ] 数据可视化图表
- [ ] 移动端优化
- [ ] 性能优化

### 📝 待开发
- [ ] 阅读理解模块
- [ ] 家长端功能
- [ ] 微信小程序
- [ ] 部署文档
- [ ] 单元测试
- [ ] 国际化支持

## 🚀 部署指南

### 开发环境部署

参考上面的"快速开始"章节。

### 生产环境部署

#### 使用Docker部署（推荐）

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

#### 手动部署

**后端部署:**
```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 配置生产环境变量
cp .env.example .env.production
# 编辑 .env.production

# 使用gunicorn启动
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

**前端部署:**
```bash
cd frontend

# 构建生产版本
npm run build

# 使用nginx或其他静态服务器部署dist目录
```

**Nginx配置示例:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发流程

1. **Fork项目**
   ```bash
   # Fork后克隆到本地
   git clone git@github.com:your-username/feiyingstem.git
   cd feiyingstem
   ```

2. **创建功能分支**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **开发和测试**
   - 遵循代码规范
   - 添加必要的测试
   - 确保所有测试通过

4. **提交更改**
   ```bash
   git add .
   git commit -m "feat: 添加新功能描述"
   ```

5. **推送分支**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **发起Pull Request**
   - 在GitHub上创建PR
   - 描述你的更改
   - 等待代码审查

### 代码规范

**Python代码:**
- 遵循 PEP 8 规范
- 使用类型注解
- 添加docstring文档
- 运行 `black` 格式化代码

**TypeScript代码:**
- 使用ESLint配置
- 运行 `npm run lint` 检查
- 使用Prettier格式化
- 遵循React最佳实践

**Commit规范:**
使用 Conventional Commits 格式：
- `feat:` 新功能
- `fix:` 修复bug
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建/工具相关

### 报告问题

发现bug或有功能建议？请在 [Issues](https://github.com/YangYu19921221/feiyingstem/issues) 中提交。

**Bug报告应包含:**
- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 环境信息（操作系统、浏览器等）
- 截图或日志（如有）

**功能建议应包含:**
- 功能描述
- 使用场景
- 预期效果
- 可选的实现思路

## 📄 开源协议

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 👥 作者

- **YangYu** - [GitHub](https://github.com/YangYu19921221)

## 🙏 致谢

- [FastAPI](https://fastapi.tiangolo.com/) - 现代化的Python Web框架
- [React](https://reactjs.org/) - 用户界面库
- [Tailwind CSS](https://tailwindcss.com/) - CSS框架
- [Framer Motion](https://www.framer.com/motion/) - 动画库
- [OpenAI](https://openai.com/) - AI能力支持
- [Anthropic](https://www.anthropic.com/) - Claude AI支持

## 📞 联系方式

- 项目地址: https://github.com/YangYu19921221/feiyingstem
- 问题反馈: https://github.com/YangYu19921221/feiyingstem/issues

## 📸 项目截图

### 学生端界面
- 🎨 登录页面 - 简洁友好的登录界面
- 📊 学习仪表板 - 一目了然的学习数据
- 🃏 卡片学习模式 - 3D翻转效果，滑动切换
- ✅ 选择题练习 - AI智能出题
- 📈 学习报告 - 可视化进度分析

### 教师端界面
- 📚 单词管理 - 批量导入，一词多义
- 📖 单词本创建 - 灵活的分类管理
- 👀 学生进度监控 - 实时数据追踪
- 🏁 竞赛管理 - 创建和管理实时竞赛
- 📊 数据分析 - 班级整体情况统计

### 管理员界面
- 👤 用户管理 - 完整的权限控制
- 🤖 AI配置 - 多服务灵活切换
- 📊 系统统计 - 全局数据分析

---

⭐ 如果这个项目对你有帮助，请给个Star支持一下！
- 技术文档: [./docs/]

---

**开始你的英语学习之旅吧! 🚀**

Built with ❤️ for students
