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
- ✅ 音标视频配套课件(2026-09-09): 音标视频此前**只能传视频本身**,老师讲课那份 PPT
  学生课后看不到,想复习只能重看视频找那一页。现补齐: 每个视频可挂多份讲义
  (PDF/PPT/PPTX),服务端逐页渲染成 PNG,**学生只拿到图、拿不到原文件**。
  表 phonetic_materials(services/phonetic_material_service.py 渲染,api/v1/teacher/phonetics.py
  管理端,api/v1/phonetics.py 学生端只读)。
  **不复用直播那套 StudentMaterialViewer**: 直播课件是付费防泄露的(按人烧水印、
  @media print 遮黑、no-store 禁缓存),音标讲义是教学辅助**不烧水印** → 图可以给浏览器
  缓存,`cache-control: private, max-age=86400`(private 让代理不缓存、max-age 让来回
  翻页不重复走网络)。烧水印那套照搬过来只会让每次翻页都重新渲染。
  ⚠️ **多租户过滤必须显式写,别押在 tenancy 的隐式过滤器上**(这次踩到):
  conftest 建库走 `create_all` **不走 `init_db()`** → 注册监听器那步没执行 →
  测试里所有"自动过滤"的模型都是**裸查询**。我第一版依赖隐式过滤,跨机构测试直接 200
  拿到别家课件;它在生产能过只是因为认证时设了 ContextVar。**任何没走认证的调用
  (后台任务/脚本/测试)都是无过滤的**,所以照 phonetic_practice.py 的 `_visible_book`
  显式加 `or_(org_id==我的, org_id.is_(None))`。课件的归属**按父视频判**,
  它自己的 org_id 只是冗余列。
  **PPT 转换依赖服务器装 LibreOffice**(services/office_convert.py 调 soffice,
  生产 Ubuntu 24.04 + LibreOffice 24.2.7 实测可用): **换机器/重装忘了装它,PPT 上传
  会静默退化**成「服务器暂不支持 PPT,请另存为 PDF」的 400(不是 500,守卫有兜住),
  部署脚本里没有这一项,装机时记得 `apt install libreoffice-impress`。PDF 不依赖它(pymupdf)。
  四个界面上的坑: ①**渲染失败必须显眼**(红框+写明原因),失败的课件学生端根本看不到,
  老师若只看到静静一行会以为传成功了、学生那边一直是空的 ②上传进度条走到 100% 只是
  文件传完,后面还有转换+逐页渲染(几十页十几秒),不单独提示看着像卡死
  ③**讲义与视频必须同屏,且是「一大一小」不是「并排各半」**(两版都被用户当场指出):
  第一版全屏弹层盖住视频+暂停 = 把两样做成互斥;第二版左右各占一半 → 两个都是 16:9,
  1366 宽的屏上讲义只剩 467px,按 1920 设计的幻灯片缩到 1/4,24 号正文落到屏幕上 ~6px,
  而高度只用掉 1/3。现在(components/phonetics/LessonStage.tsx):讲义铺满舞台
  (1366 屏实测 1318px 宽,正文 ~16px),视频缩成 34% 宽的小窗浮在角上、可拖到四角吸附、
  可再缩一档(180px)、可一键对调;面板 `w-[min(98vw,1600px)]` 别卡 max-w-6xl 浪费 200px;
  加 requestFullscreen 拿走地址栏(iOS Safari 非 video 元素不支持,按钮按 fullscreenEnabled 隐藏)。
  竖屏手机维持上下堆叠 + 「横屏更清楚」提示(讲义已占满宽度,小窗没意义)。
  **`<video>` 必须在所有布局下留在树里同一位置只换 className** —— 大小两块都 absolute
  铺在同一 relative 舞台上,DOM 顺序永远不变;小窗抓手条用 `{cond && chrome(...)}` 占位,
  false 也占一个子节点位,video 下标不漂。**抓手条写成普通函数不要写成组件**:定义在
  组件体内的组件每次渲染都是新类型,React 卸了重挂。**拖动松手归位要用 `x.jump(0)` 不是
  `set`**:framer 在回调 onDragEnd 之前已经启动了"回弹到约束内"的惯性动画,set 停不掉它,
  下一帧被改回拖动末尾的值 —— 实测小窗飞到舞台外 800 多像素。只允许抓 grip 条拖
  (`dragListener={false}` + dragControls),抓视频本体会和播放控件打架。
  弹层 z 要 [70]:学生端底部导航 z-60、宠物浮标 z-50 都会压住竖屏时的翻页条。
  键盘箭头翻页要判焦点在 <video> 上时不接管(那时箭头是快退/快进);Esc 先收讲义再关
  播放器。数据层抽在 useMaterialPages(缓存上限 40 张淘汰最早、卸载全 revoke)。
  ④**两块变成对等浮窗:各自拖放、各自改大小、互不重叠(2026-09-09,用户第三次提)**:
  演进别走回头路 —— ①全屏弹层盖住视频+暂停(做成互斥,错)②左右并排各半(1366 屏讲义
  只剩 467px,正文 ~6px 看不清)③讲义铺满+视频吸四角(清楚了但**重叠**,小窗压住翻页条)
  ④现在:两块都能拖到任意位置悬停、各自改大小、谁也不压谁。
  **几何全在 components/phonetics/stageLayout.ts(纯函数,不碰 DOM)** —— 这样能用
  esbuild 剥类型后在 node 里穷举验算,碰撞逻辑靠浏览器点是点不全的。实测 5 万次随机
  拖放零重叠零出界;第一版就是靠这个抓到 2846 次没解开(只推被拖的那块,另一块钉在
  中间时左右都塞不下,四个方向全被夹回舞台内仍压着)。
  **语义:被拖的那块说话算数,另一块让位** —— 推开 → 推不动就缩小到旁边最大空档 →
  连最小宽都放不下才拒绝这次拖放(settle 返回 null,调用方保持原布局)。由此得到硬
  保证:settle 要么给不重叠的布局,要么给 null,绝不返回重叠。
  三个坑:
  (a)**模型高度必须等于实际渲染高度**,且两块公式不同 —— 讲义多了顶栏 56 + 翻页条 48
  (实测值,改 padding/字号要回浏览器重量:取块内所有非 absolute 子节点,把画面区之外
  的高度加起来)。不算它就是模型比实际矮 108,碰撞按模型判 → 模型说不重叠、屏幕上却
  压住,底边还捅出舞台 50px。所以**两块都写死 height**(不是只给 width),让实际去等模型
  (b)**位置尺寸的真源是「比例」,每次舞台变化都从比例重新推导**,不要拿上一帧结果去
  refit —— 首帧舞台还没撑开(高度小)会把尺寸夹小,而 refit 只夹不涨,舞台长大后再也
  回不去。这个坑我踩了两次:一次「讲义 544/视频 200、舞台空着 600px」,一次「刷新后
  320 变 200」。存档要带版本号,高度公式改了旧数据直接忽略(否则旧比例还原也会被夹小)
  (c)舞台装不下两块不重叠的窗(canHostFloating 为假,按**讲义**那块的最小高度算)就
  退回上下堆叠 —— 硬摆只能靠重叠,而用户要的正是不重叠。实测 iPhone SE 横屏(552×240)
  就摆不下,走堆叠
  **代价要认**:不重叠 = 讲义拿不到整个舞台(1366 屏 1318 → 906px)。仍是 ② 的近两倍,
  想更大就把视频拖窄或点「重排」。「对调」「缩一档」两个按钮随之取消(直接拖即可),
  改为一个「重排」回默认铺位。
  ⚠️ 报告前用与代码**相同的公式**核算:我曾拿 `+104`(漏了 CHROME_H 30)算模型高度,
  据此误报了一处"未修完的不一致",实际两块都精确吻合
  ⑤**防爬防泄露(2026-09-09,用户提「防止别人下载资料爬取抓包」)**: 先说实话,HTTPS 抓包
  在用户自己设备上**防不住**,能守的是「抓到的东西用处小、时限短、追得到人、爬不快」。
  修了三个真洞: (a)视频 URL 里此前放的是**整站 7 天会话 token**(`?token=`),抄走地址栏
  = 拿走账号能调所有 API。改成 `/videos/{id}/ticket` 换**独立密钥**(SECRET_KEY 派生的
  HMAC)签的两小时票据 `?t=`,绑定 vid+sub+session_ver: 当 Bearer 用签名过不去、只能播
  这一个视频、顶号即作废;`?token=` 已不再接受。前端 LessonStage 在票据到期导致 video
  error 时自动换票并从原进度续播(onError 判 exp 才重试,别的错不重试免死循环)
  (b)讲义页此前不烧水印+允许缓存,改成**每张现烧取图人姓名+ID**(复用直播那套
  watermark_service,抽了按路径的 stamp_image 原语),响应 no-store —— 前端 useMaterialPages
  自己内存缓存 blob,服务端缓存本来用不上 (c)翻页/换票加 services/rate_limit.py 滑动窗口
  限速(90/min、30/min,429 带 Retry-After):学生手翻一秒一两页,爬虫一秒几十页当场露馅。
  顺带补了 `_user_from_query_token` 漏掉的 sv 顶号校验(phonetic_reading 回放也复用它)。
  前端禁右键/禁拖出/禁长按只是零成本挡顺手另存,别当成防线。
  **仍有的同类洞**: phonetic_reading.py 的录音回放 `?token=` 仍是整站 token(孩子自己的
  声音,面小,未改);直播回放 flv/hls 走 SRS 侧防盗链不在此范围。
  测试 tests/test_phonetic_media_guard.py(10 例:票据/水印/限速/顶号)
  ④横版幻灯片 + 竖屏手机: 按**宽度**铺满,塞进屏高会让 16:9 的页字小到看不清
  (点一下放大 2 倍可拖动)。
  **blob URL 用完必须 revoke** —— 翻几十页不释放吃掉几百 MB(内存泄漏,不是优化)。
  教师端列表要下发 `is_preset`/`can_edit`/`material_count`: 平台预置视频对机构只读,
  不下发的话按钮点了才吃 403;`material_count` 让老师看出哪个视频还缺讲义
  (一次 group_by 聚合,别按行 N 次查)。文件落 **private_media/**,
  严禁进 UPLOAD_DIR(那整个目录经 /api/v1/files 公开无鉴权)。
  入口: 教师端「更多 → 音标视频」→ 视频行「课件」;学生端首页「音标」→ 点开视频 →
  视频下方「老师的讲义」。测试 tests/test_phonetic_material.py(18 例)
- ✅ 机构区域保护 + 合作卡改半年(2026-09-09): 协议第四条承诺「三公里内不发展第二家合作点」
  此前**全靠人记**,机构多了开新点时想不起隔壁那家在哪。现补齐: organizations 加
  address/lat/lng/protect_radius_km(全可空,坐标 NULL=未登记 → 既不参与判定**也不受保护**,
  存量零影响),开通/改地址时按直线距离查冲突,撞了返 409 带明细,前端弹确认框
  (列明细 + 勾「我已核对」)才能带 force=true 放行 —— 照金币防重复那套口径。
  **判据故意用直线距离不用导航距离**: 直线恒 <= 导航,所以「直线 3km 内不开」比协议
  更严格、永不违约,代价只是偶尔误拦绕路超 3km 的点(force 放行)。协议文案已同步改成
  「直线距离三公里」并加一款「按地图坐标核验」——**口径不一致的自动判定比没有判定更糟**,
  它给出的结论无法自证。零外部依赖(不调地图 API),几十家机构全表 Haversine 是微秒级,
  涨到几千家再上 bbox 粗筛(±0.03°≈±3.3km),判定函数签名不用变。
  真源 services/geo_service.py,预检端点 `GET /organizations/territory-check` 与写端点
  共用同一份判定(否则会出现「预检说行、开通被拦」)。六个判定坑:
  ①**体验机构必须排除**(plan=trial,演示环境天天开,拿它拦真实签约会误报到没人看)
  ②保护是**相互**的 —— 阈值取 `max(本方半径, 对方半径)`,对方签 5km 独家时我在 4km 外
  开点违的是对方那份协议,只按本方 3km 判会漏
  ③**停用机构照样拦**(停用常只是欠费停服,协议未必终止),但明细里带 status 供决断
  ④**只填一半坐标必须 400** —— 半条数据既判不出冲突、又让机构看着「已登记」实则不受保护,
  比不填更危险 ⑤改地址(搬迁)要 `exclude_org_id` 排除自己,否则永远和自己相距 0 公里;
  **只改半径不动坐标也要重判**(放宽半径会把原本合规的位置变成冲突),PATCH 取
  「传了用新的、没传用库里的」有效值 ⑥**经纬度范围校验不能挂在 Pydantic Field 的 ge/le 上**:
  lat=120 是「填反了」的典型值,却会先被拦成 422 英文串,盖掉更有用的那句话;
  范围与填反两件事统一由 `geo_service.coord_error()` 判(填反优先)。
  预检的「零冲突」必须连 `unmapped_orgs`(没坐标判不了的机构数)一起给,
  否则会被误读成「这一带没人」,而实际可能是隔壁那家根本没录坐标;列表里也标
  「未登记坐标 · 不受区域保护」。坐标系要**前后一致**(高德 GCJ02 vs GPS WGS84 国内
  偏移可达 500 米,混录会让 3km 边界判定偏一截),前端不做「粘贴一串自动拆」——
  各家地图复制顺序不同(高德是「经度,纬度」),猜错顺序算出的距离无意义却不报错,
  改成两个带示例的输入框 + 「对调」按钮。
  同日改合作协议**学习卡 90 天 → 半年(180 天)**,10 处口径(授权条/费用条/两张费用表/
  数字牌/投入产出);数字牌「约 1.3 元/天」连带改 0.7(120 元摊 180 天),不改就自相矛盾。
  入口: 管理端 → 机构管理 → 开通新机构的「区域保护」区(可先点「查周边」),
  已有机构那一行点「经营场所」补登/搬迁。测试 tests/test_org_territory_guard.py(20 例)
- ✅ 音标「卡片写音标」(2026-09-04): 写音标此前**只有整页版**(20 词铺开一次交卷),
  手机上要来回滑、填到第 15 个还不知道前面对不对。新增卡片版**与整页版并存不替换**:
  整页版 = 纸书那一页(同韵词相邻让规律浮出来,当作业/考核),卡片版 = 一次一个词当场判。
  路由 /student/phonetics/textbook/:lessonId/cards(pages/PhoneticFlashCards.tsx)。
  **判分复用后端 `POST /check` 单题端点** —— 它此前有实现但前端零消费,卡片版正好用上,
  与整页版 check-page 共用 `_grade_one` 一份口径,两遍机制(第一遍全空 / 第二遍只挖元音、
  辅音服务端回填)完全照搬,不是第二套规则。
  **答案下发的闸门是「这张卡已结束」**(CheckOut.answer_tokens): 做对了(哪遍都算)或
  第二遍判完才给;**第一遍做错不给** —— 否则学生随手填三格按一下就白拿答案,
  第二遍那步的教学意义归零。做对时也必须由服务端给答案,不能拿学生填的格子画背面:
  重音符判分是宽松的(没点 ˈ 也算对),用作答画背面会漏掉重音符、跟纸书对不上。
  「不会,看答案」= 直接按 pass 2 交,**记一次做错的作答**(放弃不该在学情里显示成没做过)。
  三个布局坑: ①卡片高度用 `clamp(14rem,29vh,19rem)` 不能写死 —— 固定 19rem 时
  1366×768 笔记本上「看看对不对」被挤到折叠线以下(卡 304+键盘 366 超一屏),孩子看不见交卷键
  ②主操作固定在底栏(三个阶段共用一个位置),手机上键盘比一屏高,按钮跟在键盘后面要滑一下
  ③背面在 DOM 里一直存在(只被 backface-visibility 藏住),`flipped` 为假时**不渲染内容**
  + aria-hidden,否则屏幕阅读器在学生还在写时就念出「正确答案是…」。
  进度条量的是 outcomes.length(判完几张)不是 idx,用 idx 最后一张判完还停在 19/20。
  **防误跳必须照 classify 那套(isAccidentalTap,350ms)**: 卡片版比分类更容易踩 ——
  「看看对不对」和「下一张」**是底栏同一个屏幕位置**,判完一翻,孩子习惯性的第二下
  正落在「下一张」上,答案一闪而过就跳走,而"当场看见答案"是这个模式的全部价值。
  四个推进点都要挡: submit / retry / next / startRound(小结页三个按钮也在「看结果」原处)。
  物理键盘同理: 回车必须判 `e.repeat`(按住不放会一路 交卷→背面→下一张 连翻好几张),
  且监听**走 ref 拿最新闭包**(把 phase/remaining 列进依赖会每渲染重挂,不列又读到旧
  phase 再交一遍)。三条都在浏览器里验过: 同坐标连点两下停在原卡且答案在屏、
  按住回车不动、resize 后 80ms 的点击被吃掉而过窗口后照常推进。
  顺手修:**音标教材三种练法都没进 FloatingPetWidget 的 isFocusedSurface**,宠物浮标压在
  底部主按钮右边(卡片版尤其明显),已加 /student/phonetics/textbook/ 前缀(目录页不算)。
  **彩色音标三处**(2026-09-04): ①卡片背面揭示答案走 ColoredPhonetic(一音节一底色、
  元音大而深、重音标左上),它是 bg-*-50+text-*-600 的浅底浅字,**必须垫白底板**
  才能放在饱和渐变上;新加 `delimiter` prop 传 bracket,显示 [bæd] 跟纸书一致
  ②答题格填进去的元音标橙色加粗(第二遍只挖元音,颜色让这件事第一遍就看得见)
  ③**音标视频卡左上角标**(PhoneticsHub,原来整块单色 text-primary)。
  角标不用 ColoredPhonetic —— 它按音节铺气泡,而角标常只有一两个音素,壳子比音标还大;
  改走新增的 `segmentIpa()`(utils/ipaPhonemes): **按位置切段、不归一、不丢字符**,
  与 tokenizeIpa 分工不同(后者先归一再切且丢位置,那是判分用的)。
  但**判类可以归一**: 老师打键盘上的拉丁 g(表里是 IPA ɡ U+0261)、半角冒号
  不归一就会灰掉,而这两个恰恰最常被打出来 —— 只拿单字符归一(多字符会改长度 ə:→ɜː)。
  ⚠️ **白底板塌成一条缝的坑**: `overflow-x-auto` 会让该 flex 项的自动最小尺寸算成 0
  (CSS 规定 min-height:auto 只在 overflow 为 visible 时生效),背面内容一超高它就是
  唯一被压扁的(实测 16px 裹 54px 内容)。修法 `shrink-0` + 省出空间给音标。
  别按「inline-flex 基线对齐」去查,我第一次就判错在这。
  **目录页不加分页**(2026-09-04 量过): 48 节全量 9.5KB/22ms、DOM 988 节点,分页省不下
  有意义的东西,反而多一次点击和「上次在第几页」的状态。真问题是**找不到学到哪** ——
  改成 /books 下发 highlight + mastered_count + last_practiced_at(一次 group_by 聚合,
  别按节 N 次查),卡片显示彩色音素与进度,顶部「继续上次」直达最近练的一节
  (手机 11.8 屏 → 0 屏)。三个判据: ①写对数按 item_id **去重**(反复练一个词就能刷满
  进度条 = 骗人)②「练过没有」看 last_practiced_at **不看写对数**(练完一整节全点
  「看答案」的写对数是 0,按写对数判会让它跟从没练过的卡长得一样,而这种节最该回去练)
  ③highlight 值不值得占那 2 屏高度: 实测 48 节里 42 个不同集合,值得(别只看 1—1/1—2
  就下结论,那俩恰好是 6 对重复之一)。教材涨到 5 本以上(~240 张卡)再考虑分页。
  入口: 学生端首页「音标」→ 教材目录 → 每节「卡片写音标」(第二排小字仍是「整页版」)。
  测试 tests/test_phonetic_practice.py 加 2 例(答案闸门 / 重音符由服务端给)
- ✅ 音标教材教师端上传(2026-09-03): 此前音标教材**只能命令行导入**(scripts/
  import_phonetic_book.py,要 ssh),老师加不了新教材也改不了题 —— 而单词早就能网页导入。
  现补齐: /teacher/phonetic-books 传 Excel(每 sheet 一节,需「单词」「音标」两列,
  「释义」可选),前端 SheetJS 解析后传 JSON(与 TeacherBooks 单词导入同套路,后端不收文件)。
  **音标切分逻辑抽到 services/phonetic_tokenize.py 作唯一真源**,脚本与 API 共用;
  在两处各写一份归一规则 = 学生做不对的死题(切出软键盘上没有的音素那格永远填不对)。
  三道校验对应三种死题: 键盘上没有的符号 / 切不出音素 / 切不出元音(第二遍无法挖空)。
  **校验先行 + 整本原子性**: 先调 /validate 返回错误清单(指名道姓到哪节哪词),
  /import 有任何一行不合格就整本拒(400),不留残缺教材在库里。同名教材要 replace=true
  才覆盖(否则 409);覆盖只删节和题,**学生答题记录保留**(那是学情)。
  平台预置教材(org_id=NULL)对机构只读,机构要改就自己传一本。
  **模板下载**(utils/phoneticTemplate.ts,浏览器里用 SheetJS 生成不走后端): 两张示例小节
  + 一张填写说明,说明里附**48 个可用音标总表**(从 ipaPhonemes 的 PHONEME_GROUPS 生成,
  与学生软键盘同源)。不给模板老师只能猜格式,而填了键盘上没有的符号就是做不对的死题。
  说明表故意不带「单词/音标」两列 → 导入时自动跳过,不会被当成一节。
  模板本身走过回环验证(生成 → 用前端同一套解析逻辑读回 → 打 /validate = 2节/8题零错误),
  改模板后要重跑这个回环,别让发给老师的模板自己校验不过。
  入口: 教师端首页「内容管理」区「音标教材」卡片 / 顶部「更多 → 音标教材」,
  上传区第一排就是「下载模板」。
  测试 tests/test_phonetic_book_import.py(12 例);新增 conftest 的 teacher_token fixture
  (⚠️ 教师必须挂 active 机构,org_id=None 会让 check_org_active 查不到行 → 全站 402)
- ✅ 音标跟读改成「指出错在哪」(2026-09-03): 判定不再说「听起来像 daff」(孩子没想读
  daff,这话没法照着改),改说**具体错误类型**。目前只有一种但极常见:
  **词尾多带一个音** —— 普通话没有词尾塞音,中文母语者读 /bæd/ 会读成「bei-de」两音节。
  提示语:「词尾的 /d/ 后面多带了一个音,像在读两个字。收住舌头别往后拖」。
  判据(services/phoneme_error_pattern.py): **目标词以辅音结尾而识别结果以元音结尾**。
  元音集**必须含中文韵母字符**(ə1/ɑ5/a)—— 多加的音常被识别成中文韵母,只认英语元音漏一半。
  实测: 真人 11/11 检出、Edge TTS 标准音 0/12 假阳性、19 条真实录音 14 条给出提示;
  交叉验证 Edge TTS 合成两音节「bay duh」→ beːda 而正常「bad」→ bæd(信号来自音节结构)。
  **一次推理出两样东西**: ClosedSetScorer.rank_and_hear() 在同一份 logits 上既算闭集分
  又做贪心解码 —— 分开调会推理两遍(CPU 上各 0.65s)。
  **有提示时前端停 3.2 秒**(markDone 的 holdMs),700ms 只够一闪等于没给;
  判 pass 但仍有提示时文案要加「读对了。」前缀,否则绿灯配错误提示孩子搞不清对没对。
  仍然**只提示不拦人**(样本只有一个说话人,真实学生假阳性率待收);
  别往 phoneme_error_pattern 里凭想象加错误类型 —— 没有假阳性对照数据的"错误类型"
  就是冤枉孩子的噪音。测试 tests/test_phoneme_error_pattern.py(12 例,含标准音全表零假阳性)
- ⚠️ 音标跟读的**闭集打分**对中国学生判不准(2026-09-03 实测,不用它拦人):
  /root/wav2vec2-phoneme 是 espeak **多语言**版(392 音素词表含 **85 个中文声调音素**),
  它把中国孩子读英语的音归到**中文音素**那侧 —— 真人读 bad 解出 `pei5tə1pei5tə1`
  (拼音 bei-de + 声调),而 Edge TTS 标准音干净解出 `bæd`。候选集是纯英语 IPA,
  两边音素表不重叠 → CTC 必然极低分。真人通过率约 50% 且**与读得准不准无关**
  (cab/fee/cede/bead 能过,bad/ace 稳定不过),这种随机性比不判更糟。
  **想让闭集打分本身变准的五种补救全部无效,别重试**: ①削首尾静音 ②词表限死英语音素
  ③按能量切段单独判 ④双份音频不是主因(同词接两遍照样 pass)⑤换 faster_whisper 锁
  language=en 更差(短音频编整句「We'll see you next time」)。
  ⚠️ 但**别据此以为整件事无解** —— 我一开始就是这么判的,错了:那些「中文音素」输出
  是模型在**如实转写孩子多加的尾音**,换个问法(问"错在哪"而不是"更像哪个词")立刻有用,
  见上一条。闭集打分判不准 ≠ 这个模型没价值。
  现状: `confused` **不拦人**只显示「机器听着更像 X(仅供参考)」,只有 silent/not_speech 拦;
  SCORE_FLOOR 已停用(-99),标定证明做不到 —— 真人最低逐帧分 -1.019 vs 非语音最高 -0.354
  **两簇完全重叠**,任何门槛要么漏噪音要么拦真人(scripts/calibrate_score_floor.py)。
  **绝对门槛必须用逐帧分**(rank() 第 3 个值)不能用排序分: 排序分在所有帧上累加却只除
  音素数,随录音长度漂移(同一个 bad,0.98s 的 TTS 得 -0.78,4.58s 真人得 -15.19,
  量的是长度不是质量);我拿 TTS 标定出 -5.0,上线后 11 条真人录音 100% 被误拦。
  **别拿 Edge TTS 的准确率当结论**(TTS 测 95%/90%,真人 ~50%),标定验收都要用真人录音
  (生产 private_media/phonetic_audio/ 有存档)。
  换商业引擎仍是选项(讯飞 ISE 凭证已在 ai_providers id=2 / Azure 发音评估),但
  **优先级已降低**: 它们给的是分数,而「指出错在哪」那条给的是可照着改的动作,
  教学价值更高且零成本。用户 09-03 说讯飞贵,未定
- ✅ getUserMedia 必须显式开回声消除(2026-09-03): `{audio:true}` **不默认开**,
  跟读时扬声器放的标准音被麦克风收回去 —— 19 条真实录音**全部是双份**的
  (whisper 听成 "beta beta",能量包络每条 2-3 段人声)。戴耳机的孩子不受影响,
  所以缺陷一直没暴露。已加 echoCancellation/noiseSuppression/autoGainControl,
  并在 doRecord 开录前 pause 正在播的标准音(两道防线都要)。
  排查录音质量先看**能量包络分段数**(100ms 窗、e>peak*0.25 算人声),一个词应只有 1 段
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
