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
  - **API 路径禁止以 `/admins` 结尾**:实测 Safari 内容拦截器按 URL 关键词掐掉此类 XHR(请求不出浏览器),已有先例改名 `/managers`(见 admin/organizations.py)
  - **UPLOAD_DIR 整体经 `/api/v1/files` 公开无鉴权**:只准写公开图片(Logo/封面),导出报表/试卷/录音等敏感文件禁止落入此目录
  - **多租户防提权**:对 org_admin 放行的写端点必须调用 `admin/users.py` 的 `guard_org_admin()`,不要手写角色判断
  - **「留空=不修改」的字段判空必须走显式分支**:`if "x" in data and data["x"]` 这种写法,
    空串会让整个 if 不成立 → 跳过处理 → 空值原样落库。AI 配置的 api_key 就这么被清空过
    (改一次模型名就抹掉密钥,全部 LLM 调用 401)。写完自问:空串会走到哪一支?

### 新功能必须同步公告(硬性要求)

**上线一个用户能感知的新功能,就必须让用户知道它存在、知道在哪儿用。** 功能上线却没人发现,
等于没做——纸笔听写就吃过这个亏:入口埋在单元详情展开后的第三组,用户自己都没找到。

每加一个新功能,除了写代码,还要做完这三件:

1. **加公告**:在 `frontend/src/data/whatsNew.ts` 的 `WHATS_NEW` 顶部加一条。
   `where` 字段必填且要具体到"点哪里"(最容易漏的恰恰是这句);`roles` 按受众投放,
   学生功能别弹给管理员;`id` 一旦上线永不修改(它是已读记录的键)。
2. **给显眼入口**:至少一个一眼能看到的入口(学生端首页 `quickTools` 卡片 /
   教师端工具列表 / 管理端菜单),不能只藏在二级页面的展开区里。
3. **写进本文件的项目状态**,并在交付说明里告诉用户入口路径。

公告机制:`components/WhatsNewNudge.tsx` 按角色弹一次,已读存 localStorage 永不重弹;
学习中的全屏页面(答题/对战/考试)不打断,回首页再弹;老用户首次只看近 30 天的条目。
它与 `UpdateNudge` 分工不同——后者只说"代码更新了,刷新一下",刷新完用户仍不知道新功能在哪。

## 数据库Schema位置

完整的数据库设计见根目录: `database_schema.sql`

包含所有表结构、索引、外键约束和初始示例数据(成就系统)。

## 项目状态

**已完成(截至 2026-07)**:
- ✅ 全部学习模式(分类/听写/拼写/填空/选择/例句/句子背诵/单元考试)+ 阅读理解
- ✅ 纸笔听写(2026-08): App报词→纸上手写→拍照→视觉模型盲转写+服务端比对判分
  (student/handwriting.py, mode='handwriting'计入SCORING_MODES);打印默写纸(四线三格,
  听写版/自默版);OCR模型走 ai_providers.extra_config.ocr_model(管理端可配,
  qwen默认qwen3.5-ocr);照片只过内存不落盘
- ✅ 多租户 SaaS(加盟): organizations 表 + org_id 隔离(core/tenancy.py 读写双安全网)、
  三层管理(admin→org_admin→teacher)、学生配额、服务有效期(到期自动停)、
  机构兑换码(上限=配额)、机构码招生链接、机构自定义名称/Logo
- ✅ 加盟资料中心(2026-08): /admin/franchise-kit(仅平台admin)两份A4文档——合作协议
  (定价口径: 1.2万/年含100生、超额100元/生/年、全托书本全开放)+ 功能详解与提分方案;
  空栏 contentEditable 页面内填写,可「下载PDF」或打印,不经服务器不落盘;
  入口在管理端首页运营工具箱「加盟资料」
- ✅ 网页导出PDF通用能力(2026-08): utils/downloadPdf.ts(默写纸/加盟资料共用),
  html2pdf.js 动态import不进首屏;三个坑已处理:①截图对象是屏幕外固定794px宽的
  DOM克隆(只给原元素设宽会被窄屏父容器切边,且不闪屏)②oklch/lab等新色彩函数
  html2canvas解析不了会直接抛错,截图前降级成rgb ③pagebreak只用css模式,
  avoid-all会让页底留成片空白。**两列布局别用CSS grid**:html2pdf插入的分页占位
  元素会占掉一个格子导致题号错行(实测第13题起串位),改「一行一flex装两题」
- ✅ 学习效率引擎: 今日智能任务(/student/daily-plan)、记忆曲线SRS、AI记忆钩子
  (words.memory_hook 全平台缓存)、拼写错误诊断(learning_records.user_answer)、
  连错消化卡、保持率对比
- ✅ 游戏化: 宠物养成/对战、实时PK竞技场、全自动晋级赛、段位、成就(挂在提交记录必经之路)、机构内排行榜
- ✅ 教学闭环: 实时课堂监控、大屏、作业、AI组卷、竞赛题库、家长端、AI测评招生漏斗
- ✅ 作业当日任务(2026-08): 创建作业选「开始日期」=当日任务(homework_assignments.
  available_from,北京日0点开放、当天24点截止,学生只能当天完成;交卷留30分钟缓冲防
  重试队列跨天被拒);开放前学生端不可见/不解锁单元/不计金币口径(assigned_at对齐开放时间);
  多选单元+「按天依次排期」每单元顺延一天,一次布置未来一周;未开放任务教师列表可「✖取消」;
  普通作业(不选日期)行为不变;入口: 作业管理→创建新作业;08-07已部署生产
- ✅ 金币规则(2026-08-08 重定义,以此为准): 完成当天布置的全部任务+1(当天追加任务不再多发;
  老师取消/关闭的任务不进分母——布置5份做不完、取消2份、剩3份做完照样+1,关闭和删除两条路径
  都会补发)、单词王额外+1 且与任务币**叠加**(旧规则是+2且互斥),一天封顶2;单词王24点后
  才结算(白天只是暂列第一),学生端有「有人紧追/还差N词」战况提示;
  开关 organizations.coin_mode(auto默认 / manual=教师手动加,仅admin/org_admin可切,
  切manual后不自动发但已发的不回收);「完成>=2单元+1」永久关闭(ENABLE_UNIT_COIN=False);
  每日00:35自动结算已恢复(main.py lifespan)+教师端「🔄补算昨天」兜底;
  发币日期取 assigned_at+8h 而非 local_today(连带完成/跨午夜补交会牵动别的日子,
  submit 用 affected_days 集合逐日结算);规则文案单一真源 components/CoinRulesModal.tsx
- ✅ 可靠性: 提交队列幂等(claim_client_batch)、防划水/切屏监控、学习质量分
- ✅ 新功能公告(2026-08): data/whatsNew.ts + WhatsNewNudge 按角色弹一次说清"在哪儿用",
  见上文「新功能必须同步公告」——加功能必须同步加公告条目
- ✅ ai_quota.py 通用AI限流(记忆钩子已接入)

**待做**:
- 🚧 AI 限流覆盖全部 LLM 端点(错因讲解/组卷/周报接入 ai_quota)
- 🚧 organizations.ai_quota_json 按机构覆盖限额(P3 预留列)
- 🚧 多 worker 部署时限流/机构状态缓存换共享存储

## 多租户开发须知

- 9 张锚点表带 org_id(users/classes/pk_rooms/assessment_leads/leaderboard_snapshots
  为 NOT NULL;word_books/sentence_books/reading_passages/competition_question_sets
  可空,NULL=平台共享)。其余表经 user_id/创建链推导,靠 tenancy 过滤器自动隔离
- **聚合/统计查询若不经锚点模型(如直查 StudySession/AnswerRecord),过滤器罩不住,
  必须手动 join User**——已有两次此类泄漏教训
- 对 org_admin 放行的 admin 端点写操作必须调 guard_org_admin();内容管理对机构只读
  (路由级按 HTTP 方法裁决,新端点默认安全)
- 跨机构读取(归属判定等)用 .execution_options(skip_tenant_filter=True),仅限 service 层

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
