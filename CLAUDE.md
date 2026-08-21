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
  - **SQLite 日期时间是字符串比较,禁止混用微秒格式**:SQLAlchemy 写入恒带 `.000000`,
    而 sqlite 的 `datetime()` / `CURRENT_TIMESTAMP` 输出不带微秒。两种格式在**整点边界**
    比较会翻车:`'... 16:00:00' >= '... 16:00:00.000000'` 为假 → 对齐北京 0 点的当日任务
    assigned_at 落不进自己那天的查询窗口、反而漏进前一天。实案(2026-08-12 排查):
    19 行旧格式当日任务让 4 个学生「完成全部任务」金币没发(数据已修+币已补,备份在
    生产机 /root/coin_fix_backup_20260812_hsa.sql)。手写 SQL 回填 datetime 列时
    必须补 `|| '.000000'`;普通行的 CURRENT_TIMESTAMP 落在日中,无碍
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
- ✅ 手动加币防双轨重复(2026-08-16): 排查关羽鹤金币超速,根因是自动结算上线后老师
  沿用手动补发习惯,「系统自动+老师手动」同一名目发两遍(8 天多发 ~11 枚,已兑掉)。
  修法: /coins/adjust 手动**加**币时若该生当天已有系统流水(task/unit/word_king 三种
  dedup_key,coin_service.system_coins_on_day),先拒 409(code=SYSTEM_ALREADY_GRANTED
  附已发明细),前端 TeacherCoins 弹红色后果确认框(列明细+勾选「我已核对」才能点
  「仍要发放」),确认后带 force=true 重发放行并记日志;扣减/兑换(负数)不拦。
  **只查「已发的流水行」拦不住事故**(08-16 复审发现):真实时序是老师**比系统先动手**
  ——08-08 08:57 补发「单词王8.7」时系统的 word_king key 要 12:58 才写;08-07 老师发了
  两次「完成任务」而当天系统一枚未发。所以 manual_grant_conflicts 同时判「已发 + 即将发」
  (待发=当天任务全完成未发币 / 词量暂列第一未结算),窗口取**今天+昨天**(单词王次日
  00:35 才结算,跨天补发是主要漏法),每项带 day 让老师看出在补哪天。**「即将发」只在
  auto 机构判**——manual 机构系统永不发、手动加币是唯一途径,在那报待发会天天误拦。
  判据按 amount>0 而非 src=='manual'(source='redeem' 配正数同样是发币,按 src 判留后门);
  force 放行的那笔 reason 前缀打 `[已确认重复]` 供事后 SQL 对账。
  同类缺陷一并修:apply_delta 的 dedup 预检查/\_has_activity_coin/task_coin_day_status
  也缺 skip_tenant_filter,其中**预检查被滤会让「补算昨天」整批 500**(预检查看不见→
  照样 INSERT→撞唯一约束→异常冒出 settle_day 循环→该生之后的人全发不到、重试必复现)。
  注意: submitAdjust(force) 的按钮 onClick 必须包箭头,直接传引用会把点击事件当
  force=true 绕过确认;dupWarn 状态在开/关加币弹窗处都要清,否则换学生会弹旧数据;
  弹窗文案 coinMode 为 null 时必须走中性说法(落进 auto 那支就是说错话)。
  测试 tests/test_coin_adjust_duplicate_guard.py(10 例)
- ✅ 分类学习 PC 大屏适配(2026-08-11): 分类之后各阶段(语音校验/听写/过关检测/组末小结/
  单元复习)加 md: 响应式层,移动端样式零改动;过关检测答题卡 max-w-2xl、选择题双列、
  顶栏/底部题号条与卡片同宽;**新增物理键盘作答**(选择题 1-4 或 A-D 直选,监听挂 window,
  输入框内按键不劫持,走 handleSelectRef 拿最新闭包);同日修的防误跳三件套
  (视口 resize 后 350ms 忽略推进点击 / 换题 350ms 防余点 / 回车查 isComposing)勿动,
  键盘作答与它共用 isAccidentalTap 口径
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
- ✅ 作业分组多选(2026-08-14): 创建作业时单元下的组可多选(此前只能单选),每组各建
  一份独立作业、标题自动带「· 第N组」,完成情况各自追踪;与「开始日期+按天依次排期」
  组合时逐组顺延一天(一次排一周,每天一组)。后端 group_indexes 与 unit_ids 同构
  (扁平 targets 列表逐份建);多单元时分组仍忽略(UI 也不给选);旧单选 group_index
  行为不变。ScopeSelector 加 multiGroup prop(仅作业页开启;分配页 API 只支持单组,
  别开)。入口: 作业管理→创建新作业→选单元后点组按钮多选。测试
  tests/test_homework_multi_group.py(4 例)
- ✅ 作业当日任务(2026-08): 创建作业选「开始日期」=当日任务(homework_assignments.
  available_from,北京日0点开放、当天24点截止,学生只能当天完成;交卷留30分钟缓冲防
  重试队列跨天被拒);开放前学生端不可见/不解锁单元/不计金币口径(assigned_at对齐开放时间);
  多选单元+「按天依次排期」每单元顺延一天,一次布置未来一周;未开放任务教师列表可「✖取消」;
  普通作业(不选日期)行为不变;入口: 作业管理→创建新作业;08-07已部署生产
  **08-08 改为「可见但不可做」**: 未开放任务在学生作业列表**显示**(带 is_locked +
  available_from,🔒灰按钮点了提示哪天开放),让孩子提前知道明天练什么;但 start/submit
  照旧拒、不解锁单元、不计金币分母。「可见」与「可做」是两套口径,改列表过滤时别顺手
  改 scope_service.py / student/progress.py 那两处(它们管单元解锁与书本归属,必须
  保持"未开放不算");另有三处消费 my-homework 的地方(首页红点/单元选择器今日任务/
  分类学习页交卷横幅)必须过滤 is_locked,否则"可见"会漏成"可做"
- ✅ 金币「为什么没发」自解释(2026-08-12): 目标是老师学生不再来问规则。三个触点:
  ①交卷达标没发币时返回 coin_hint{code,message}(coin_service.task_coin_hint,四码:
  late_makeup 补做/manual 手动机构/already 今日已发/pending 还差 N 份),两个交卷路径
  (usePracticeState/WordClassifyLearning)toast 显示;②学生金币卡:今天没布置任务写明
  「不是漏发」、昨日没做完显示「昨日 x/y 金币未发(补做不算)」(/student/coins/today 加
  yesterday 字段);③教师金币页余额列表每生「今/昨」小标签(绿✓已发/红没做完/灰无任务/
  琥珀全完成但手动模式),/teacher/coins/balances 加 today/yesterday(批量走
  task_coin_day_status,与发币口径同源)。测试 tests/test_coin_hint.py(6 例);
  规则弹窗同日已补「当天做完才发币」条款。排查起因见「SQLite 日期时间禁止混用微秒格式」
  (19 行旧格式数据害 4 生漏币,已修+补发)
- ✅ 金币规则(2026-08-08 重定义,以此为准): 完成当天布置的全部任务+1(当天追加任务不再多发;
  老师取消/关闭的任务不进分母——布置5份做不完、取消2份、剩3份做完照样+1,关闭和删除两条路径
  都会补发)、单词王额外+1 且与任务币**叠加**(旧规则是+2且互斥),一天封顶2;单词王24点后
  才结算(白天只是暂列第一),学生端有「有人紧追/还差N词」战况提示;
  开关 organizations.coin_mode(auto默认 / manual=教师手动加,仅admin/org_admin可切,
  切manual后不自动发但已发的不回收);「完成>=2单元+1」永久关闭(ENABLE_UNIT_COIN=False);
  每日00:35自动结算已恢复(main.py lifespan)+教师端「🔄补算昨天」兜底;
  发币日期取 assigned_at+8h 而非 local_today(连带完成/跨午夜补交会牵动别的日子,
  submit 用 affected_days 集合逐日结算)但**只发当天**(否则补做上周7天任务会各发一枚击穿封顶);
  发币走独立会话(共用请求session时失败rollback会让current_user过期→MissingGreenlet 500);
  扣币走数据库条件扣减(balance>=-amount)防并发扣成负数,不足抛InsufficientCoins→400;
  规则文案单一真源 components/CoinRulesModal.tsx;08-08已部署生产(构建msjwfss2)
- ✅ 可靠性: 提交队列幂等(claim_client_batch)、防划水/切屏监控、学习质量分
- ✅ 新功能公告(2026-08): data/whatsNew.ts + WhatsNewNudge 按角色弹一次说清"在哪儿用",
  见上文「新功能必须同步公告」——加功能必须同步加公告条目
- ✅ ai_quota.py 通用AI限流(记忆钩子已接入)
- ✅ 查学生开了哪些书(2026-08-08): 管理端「用户管理」搜用户名/姓名→学生行点「书本」
  (复用 StudentBooksDialog,可加书/取消授权);教师端学生详情页「已开通书本」只读区块。
  GET /teacher/students/{id}/assignments **不按 teacher_id 过滤** —— 学生可学范围是
  所有老师分配的并集,只看自己那份会漏(实际存在一个学生的书来自两个老师);权限只放行本班学生。
  班级详情里的老入口照旧;08-08已部署生产
- ✅ 兑换码搜索+删除(2026-08-08): /codes 加 search(码片段/批次备注模糊匹配,
  **LIKE 的 _ 和 % 必须转义**,见 feedback「LIKE 里的下划线是通配符」);
  DELETE /codes/{id} 彻底删行,但**已使用的码拒删**(是学生兑换凭证,出纠纷要有据),
  org_admin 跨机构按404;入口: 管理端兑换码管理→搜索框/行内「删除」;08-08已部署生产
- ✅ 过关庆祝页宠物登场(2026-08-10): 分组过关成绩页(VictoryScreen)改成「AI 出的空舞台背景
  + 学生自己宠物的立绘合成」。宠物取**最终进化形态**(getPetFinalStage,已到晶耀则给晶耀档),
  幼体也show长大后的样子——这是庆祝画面不是养成状态页。背景 3 档 × 3 套场景 ×
  **竖版(-m)/横版(-w)两套**,按视口方向实时切(横图铺手机会裁掉大半构图,必须两套);
  gpt-image-2 出图,**中转忽略 size 参数**,靠提示词决定朝向(竖 941x1672 / 横 1672x941)。
  两个坑: ①`background-position` 必须 `center bottom`——背景里画的舞台圆盘都在下缘,
  用 center 会让宠物看着飘在空中 ②宠物名牌必须绝对定位不占流,占流会把立绘顶离舞台。
  没养宠物时宠物层塌成弹性空白,空舞台照样成立。旧的 9 张无后缀图已删(被取代)
- ✅ 传说宝可梦 + 20 个新家族(2026-08-11): 种族 40→60。12 个普通家族专挑
  TYPE_CHART 里此前**一只都没有**的属性(冰/恶/地面/毒/飞行),属性克制这才转得起来;
  8 只传说分两档,门槛是**累计去重学词数**: 准传说(急冻鸟/闪电鸟/火焰鸟/水君)5000,
  顶级传说(梦幻/超梦/烈空坐/阿尔宙斯)8000。真源 core/pet_species(SEMI_LEGEND_WORDS/
  LEGEND_WORDS/TIER_*),前端 config/petSpecies 必须同名同值。
  **稀有度换真战力**(TIER_POWER_BONUS,一处定义两端共用): 准传说 伤害+4/大招+12/体力+30,
  顶级传说 +8/+25/+60。故意用**加法不用倍率**——倍率会随等级放大成一边倒,而加法保证
  答题连击(3连+15)仍然比种族差距更值钱,不然孩子会觉得"不如去刷传说"。三个接入点:
  calculate_damage(attacker_species)、calculate_ultimate_damage、calculate_max_hp(species)。
  **calculate_max_hp 多了 species 参数**,12 个调用点都要传(漏传只是拿不到加成、不报错,
  所以血量对不上时先查这个);前端别再手写 `100+lv*5+stage*20`,走 getPetMaxHp()。
  顺带补上 calculate_ultimate_damage 里缺的 6 个属性(冰/恶/地面/毒/飞行/钢),
  之前它们静默走 40 兜底。
  **传说走独立队伍格**(MAX_LEGEND_SLOTS=2,5000 开第1格、8000 开第2格),不占普通 5 格——
  否则普通格早被占满,孩子攒够 5000 词也领不了,解锁等于白给;`/pet/collection` 的
  used_slots/unlocked_slots **不含传说**,另有 legend_* 一组字段。
  三处必须同口径,漏一处就是后门: ①adopt_pet ②`_settle_pet_capture`(打赢一场就能把
  别人的梦幻抱走)③AI_PET_SPECIES **排除传说**(练习赛天天撞见超梦,稀有感当场归零)。
  传说的阶段名是「传说之卵→本体→觉醒→究极→神话XX」(不是进化链,不叫晶耀),
  所以领养日志/文案别硬写「伙伴蛋」,走 get_pet_stage_name(species, 0)。
  立绘 60 张走 scripts/gen_pet_newspecies.py(`-c N` 并发,默认 6,可重跑续补、已存在自动跳过);
  **提示词严禁写具体宝可梦名**(触发上游版权过滤直接 500),只描述外形特征。
  出图 500 有两种,别混为一谈: ①**间歇性**限流——并发越高越密(实测 -c 8 时大面积 500,
  -c 3 明显缓和),重跑就好,别改提示词 ②**稳定**被版权过滤卡住——同一张试近 20 次全 500
  而同族其它档正常,这是措辞问题(mewtwo 的 "feline-humanoid / 尾巴由管子连到后腰"
  就是踩了这个),换成中性外形描述立刻出图。判据: 看同 subject 的 awake/ultra 是否能出。
  入口: 学生端宠物页首屏紫色「传说宝可梦」横条 → 图鉴,传说单独成栏、未达标灰显并直接
  写「还差 N 词」。测试 tests/test_pet_legend_adoption.py(领养+收服+混装计数三条路径)
  **`collection.pets` 是混装的(普通+传说),画格子禁止按下标直取**: 传说排在领养顺序
  中间时,`pets[index]` 会把传说画进普通格、并顶掉最后一只普通宠物永不显示;两个格子区
  各自先 filter 出自己那一池(PetPage 的 normalPets / legendPets)。
  另两处「够门槛 ≠ 领得到」的坑: ①学 5000 词只开 1 格,第二只准传说够词但没格子,
  图鉴卡别写「可以收服」(要按 canAdoptLegend 分开写)②传说进度条/档位名要以
  **下一档阈值**为基准算(拿 learned_words 直除阈值,刚满 5000 时第 2 格会显示已走六成;
  用已开格数判断档位名会把「还差 3000 词开启顶级传说」写成「准传说」)
- ✅ 小智阵容 10 族 + 立绘修复(2026-08-11): 种族 60→70,补的是动画里跟过小智的伙伴
  (波波/大岩蛇/飞天螳螂/利欧路/小卡比兽/小磁怪/肯泰罗/嘟嘟/凯罗斯/热带龙),
  顺带把 fighting 从「一族都没有」补上。原作只有两阶的(onix/scyther/lucario 等)
  按本系统固定 5 档补了 `_mid`/`_prime` 过渡档,不补的话孩子进化后立绘不变。
  **修了 5 张截断的 PNG**(卡蒂狗/哈克龙/妙蛙草/隆隆石/鬼斯通): 文件在、大小 38-40KB
  看着正常、浏览器还能勉强渲染一部分,但 Pillow 一 load 就抛 truncated ——
  **判损坏只能真解码,看文件大小或 exists 都会漏**,这就是它们裂在线上没人发现的原因。
  另修 5 处「进化了立绘不变」(伊布三档共用一张图;胖丁/六尾/卡蒂狗/鲤鱼王的成长档
  与基础档共用),各出独立立绘;伊布做成幼体→蓬松成长→九尾环绕的羁绊形态
  (原作靠分支进化,本系统是固定单链,真做八种进化会变成八个种族)。
  新增 tests/test_pet_sprites.py 守四条: 引用的图存在、每张能真解码、
  用到的图都有 back/ 翻转图、同族不同形态不共用一张图。它直接正则解析
  petSpecies.ts 而不维护 Python 副本 —— 副本漂移了测试还会照旧全绿。
  出图走 scripts/gen_pet_ash_and_fixes.py(`--group fixes|midforms|ash`,`-c N` 并发);
  落盘改成**写 .tmp → 真解码验证 → os.replace 原子替换**(修损坏的脚本自己写坏图
  就白干了),注意 `img.save(tmp)` 必须显式 `format="PNG"`,Pillow 按扩展名猜格式,
  `.png.tmp` 会抛 unknown file extension 把整批废掉(第一次跑 41 张全废于此)。
  又一次印证两种 500 的判据: lucario 两档稳定 6 次全 500 而同族 riolu 正常 →
  版权过滤卡措辞("jackal-like"+胸口金属尖刺+爪背尖刺这组标志性组合),
  换成中性的「蓝色犬形武术家」立刻出图
- ✅ 宠物对战演出与血量修正(2026-08-08): 大招放慢做炫(cut-in 顿住让人看清宠物→蓄力
  光环→冲击波→暗场),多条特效按 EFFECT_STAGGER 依次播不再同时糊成一团。
  **EFFECT_STAGGER=1.3 是算出来的上限**: 最坏(4条、末条大招)总长 7.5s 必须 < 服务端
  回合间隔 8s(pet_battle_ws sleep(8)),否则最后一记被 new_round 清空;调时间轴常量
  要连带验这笔账。时长常量放 config/petSpecies(放 BattleScene3D 会把 three 拖进主包)。
  恢复伤势血量翻倍已修(后端 current_hp 已含本次回血,前端别再叠加增量)
- ✅ 兑换卡次卡/包月(2026-08-21): 原先兑换码只能发永久授权,现在管理端生成码时可选卡种——
  永久(默认,兼容旧调用)/包月(填有效天数,如 30/90)/次卡(填可用天数,学习当天才计次、
  没进不扣)。**判活闸门收在 scope_service.get_allowed_unit_ids** 一处,单元解锁/作业/
  任务分母全都跟着生效,不必逐端点改;次卡扣减挂在 student/progress 取单元词表的权限检查
  后(被拒不该扣),按北京日幂等(同天反复进/切模式/队列重放都不多扣)。次卡的最后一天
  判活口径是「有余量 **或** 今天已扣过」——只看 times_left>0 会让扣到 0 后当天立刻判死,
  学生学一半被踢(这是最容易漏的边界)。**同书重复兑换改成续期/充值**,包月从现有到期日
  往后接(未过期)或从现在算(已过期),次卡加天数;永久卡覆盖次卡/包月是升级(兑换码购买
  常规做法,两个月卡接不上很怪)。存量行 grant_type 为 NULL = 永久(旧行为零影响);
  老师直接分配的行也都是永久(没有卡种概念,字段全 NULL,判活恒 True)。
  模型字段: redemption_codes 加 grant_type/grant_days/grant_times,book_assignments 加
  grant_type/expires_at/times_left/last_consumed_date;迁移在 database.py 末尾 8 条 ALTER。
  服务层 subscription_service: is_assignment_active 判活、consume_times_if_needed 扣减、
  describe_grant 给前端的状态,redeem_code 里续期逻辑;API 层 admin/subscriptions 发码时
  传三新参、student/subscription/my-books 返回卡片状态。前端管理端生成码页面加卡种选择器
  (条件显示天数输入框),码列表加「卡种」列;学生端 my-books API 已接但前端未画独立页
  (学生首页书本列表走的是分配接口不是兑换接口,暂不改动,待需求明确再补)。
  测试见 tests/test_subscription_card_types.py (永久/包月/次卡判活、重复续期、消费幂等)

**待做**:
- 🚧 AI 限流覆盖全部 LLM 端点(错因讲解/组卷/周报接入 ai_quota)
- 🚧 organizations.ai_quota_json 按机构覆盖限额(P3 预留列)
- 🚧 多 worker 部署时限流/机构状态缓存换共享存储
- 🚧 金币「补算昨天」会追认迟做的任务(settle_day 只看 assigned_at 落当天且已完成,
  不看 completed_at)。自动路径无此问题(实时那条只认今天)。堵不堵取决于该按钮本意是
  "补救当晚漏发"还是"严格只有当天做完才有币",待产品定;测试见 test_coin_only_today.py

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
