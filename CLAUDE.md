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
API文档: `http://localhost:8000/_internal/docs`(2026-10-28 起不对公网开,线上只能在服务器上 curl 127.0.0.1:8000/_internal/openapi.json)

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
- ✅ 音标教材每个词可以改发音(2026-10-30 21:05 **已部署生产**,提交 af81c18;6 个后端文件生产==HEAD~1 整推,database.py 走 anchor patch 只加 1 条 ALTER(先在生产库副本上跑过);两个服务都重启;前端干净 worktree 构建 mvuz6qbh 整推;备份 /root/eh_db_before_phtts_20261030_2054.db、/root/eh_code_before_phtts_20261030_2054.tgz、frontend/dist_bak_20261030_2054。生产冒烟(临时机构管理员 + 学生 + 教材,跑完删净): 填音标被拒、填 seed 保存、机构管理员改平台预置书 403、题目列表不带发音、做错不给、做对给 seed、跟读页给 seed、raw 合成 200。**上线时生产没有任何词填了发音**(938 题全是 NULL = 和以前一样),用户「有的长音或者短音发音的后台传的时候可以增加个重发音按我给的单词发音吗」):
  标准音是 Edge TTS 按拼写读的,cede / faff 这类生僻词常读错长短音。phonetic_items 加列 tts_text(database.py 1 条 ALTER,NULL = 按单词读),
  填了学生端就**逐字合成**这段文字(rawTtsUrl,和老师「试听」同一个接口,一字不差)。只收英文字母 / 空格 / 撇号 / 连字符、≤60
  (真源 services/phonetic_tokenize.check_tts_text,前端 PhoneticTtsEditor 同口径只做当场提示)—— 填音标符号 TTS 读不出来。
  两个入口: ①新教材在上传的 Excel 里加「发音」列(网页上传和命令行脚本 import_phonetic_book.py 都认,模板里有 cede → seed 示例)
  ②已经在用的教材在「音标教材」页每本书右边「改发音」弹层(components/phonetics/PhoneticTtsEditor): 每个词「听默认 / 发音 / 试听」,
  按节看、搜整本、只看填了的;`POST /teacher/phonetic-books/books/{id}/tts` **按题目 id 只写 tts_text**,
  **不走整本替换**(替换会删题重建,id 全换,学生「写对 N 个」和跟读录音都对不上)。有一个不合格或混进别的书的题就一个都不改。
  平台预置教材老师能打开听(按钮写「听发音」,只读),改要平台管理员(_own_book 403);别的机构的书 404。
  学生端三处: 读音标页「听标准音」、写音标卡片翻到背面自动读、「再听一遍」。**写音标卡片的发音和答案同一个闸门**:
  /check 只在卡片结束(做对 / 第二遍判完)时随 answer_tokens 一起给 tts_text —— 「读起来像 seed」是很强的提示,作答前不能下发;
  读音标页本来就下发 word_reveal,所以 tts_text 跟着题目一起给。useAudio.playAudio 加第 4 个参数 raw(缓存键 raw: 前缀,和按单词读的分开)。
  测试 tests/test_phonetic_tts.py(6 例);卡片没结束就给发音 / 改一半 / 混进别的书 / 不判归属 / 放行音标符号 五处各让对应用例失败(回归锁验证过)。
  本机浏览器(库副本,1366 / 390)验过: 老师看预置书只读、管理员填音标当场拦、试听请求 raw=1&word=seed、保存后题目 id 不变、
  列表显示改了几个、学生读音标页 cede 按 seed 读而 bad 照旧、卡片正面不请求发音文字、看答案后背面和「再听一遍」都按指定发音;
  无横向溢出、控制台 0 报错。入口: 教师工作台「内容准备 → 音标教材」/ 顶部「更多 → 音标教材」→ 每本书「改发音」;公告一条(老师 / 机构 / 平台)
- ✅ 音标跟读乱读不能过(2026-10-30 19:40 **已部署生产**,提交 7822d61;4 个后端文件生产==HEAD~1 整推,database.py 生产有 drift 走 anchor patch 只加 3 条 ALTER(先在生产库副本上跑过);english-helper / english-helper-workers / phoneme-judge 三个服务都重启;前端干净 worktree 构建 mvuwesua 整推;备份 /root/eh_db_before_gate_20261030_1934.db、/root/eh_code_before_gate_20261030_1934.tgz、frontend/dist_bak_20261030_1934。生产冒烟(临时学生,跑完删净): 公网传一条「说一句话」录音 → not_close 2.1 秒,传一条孩子认真读 babe → pass 0.6 秒;两条判定都存了、self-pass 200。生产 39 条存量录音经线上判定服务重判: 10-03 那批真孩子 9 条全过,10-30 乱读的全拦,用户「现在我乱读都能过」→「没有更好的方案了对吧 乱读不要过 还是要有一定的正确率」):
  以前闭集判定只看「本节 20 个词里更像哪个」,乱读也总有个最像的词,前端又只拦没声音 → 整页都绿。
  讯飞 ISE 实测最准(乱读直接 is_rejected),用户嫌按次收费,所以用免费方案: **还是现在的 wav2vec2,先过两道门**
  (真源 services/phoneme_closed_set.judge): ①贴合分 GOP = (强制读成目标词的维特比总分 − 每帧取最像的总分) ÷ 音素数 ≥ GOP_FLOOR(-5.5)
  ②目标词排序分 − 本节最像的别的词 ≥ GATE_MARGIN(-3.25)。没过 → not_close(读得不像)/ wrong_word(别的词明显更像且本身也贴合,
  告诉孩子读成了哪个、摆出那个词的音标);过了才走原来的排序判定(confused 仍放过只当提示)。
  贴合分能当门槛、排序分不能: 静音帧两边一起扣,长短抵掉了(排序分随录音长度漂移,09-03 踩过)。
  标定在生产机跑(/tmp/pron_eval 已删,本机 /tmp/pron_eval_local 留着脚本): 20 词 × 7 个声音(含 2 个中国口音 TTS)+ 15 段乱读 / 中文 / 噪音
  + 生产 52 条真实录音;条件是 10-03 认真读的真孩子 9 条全过、10-30 乱读 / 说中文 / 说一句话的 5 条全拦,在此前提下挑放过乱读最少的:
  读对的过 133/140(中国口音 35/40)、乱读放过 5.3%、念成本节别的词放过 23.6%。另外两种免费方案都更差
  (和标准录音逐帧 DTW;换 L2-ARCTIC 中国学生英语模型 —— 真孩子录音被拦掉一半)。**门槛只该往宽调**,收紧先用新攒的录音重标。
  前端 PhoneticReading: not_close / wrong_word / not_speech(旧值)拦,「我读对了」**被拦 3 次才出现**(录不了音的设备一直有,
  以前一直摆着 = 乱读后门),点了 `POST /phonetic-practice/readings/{id}/self-pass` 记到最后那条录音。
  phonetic_readings 加 verdict / judge_detail / self_passed 三列(database.py 3 条 ALTER),pron_score = GOP×100 —— **分数不下发学生**,
  只为重新标定: self_passed 多了 = 门槛太严。测试 tests/test_phoneme_gate.py(用 tests/data/phoneme_gate_real.json:
  14 条真实录音**只存分数**不存音频)+ test_phonetic_practice 加 2 例;去掉贴合分门 / 去掉相对分门 / 收紧门槛 / 贴合分不减自由解码
  四处各让对应用例失败(回归锁验证过);torch 与 numpy 两种 logits 在生产判定 venv 上算出同一组分。
  本机浏览器(库副本 + 假判定服务 + 假麦克风,1366 / 390)验过: 乱读 → 琥珀「听着不太像」、读成别的词 → 摆出那个词的音标、
  第 3 次才出「我读对了」、点了记到录音上、读对直接绿;无横向溢出、控制台 0 报错。**真孩子在线上的通过率要看上线后的 self_passed**。
  入口: 学生首页「音标」→ 教材目录 → 任意一节「读音标」;公告学生 / 老师各一条
- ✅ 音标视频移动水印(2026-10-30,用户「先做水印？防录屏之类的」): 浏览器禁不了录屏也测不到录屏,能做的是录下来的每一段都带着是谁的号。
  components/phonetics/MovingWatermark.tsx(纯函数在 watermarkGeometry.ts): ①「飞鹰教育 · 名字 · ID · 月-日 时:分」每 6–10 秒**跳**到另一格
  (3×3 去掉正中间 —— 那里是老师口型;直接跳不滑,一直动的字更抢眼),以前固定右上角录屏裁一角就没了 ②字号按框宽 2%(12–20px)
  ③**每 2 秒查一次**被删 / display none / 透明 / -webkit-text-fill-color 透明 / filter / clip-path / 挪出画面 / 缩成点 → 暂停视频 + 放回来 + 提示;
  框太小(播放器正在收起)只查在不在,字比框还高不判位置 ④**水印那行字用 createElement 自己管,不交给 React**: 被开发者工具删掉后
  React 重建会 removeChild 一个不在的节点直接抛错把播放器打进错误页 ⑤`width: max-content`: 不写的话跳到最右边(left≈100%)被挤成一个字宽的竖条,
  还会被检查当成「缩小了」误停(浏览器实测踩到,加了回归检查)⑥用户名 7 位以上连续数字中间打码(11 位留 3+4,短的留 2+2)⑦iPhone Safari
  不认 controlsList,原生全屏进系统播放器画不上水印 → webkitbeginfullscreen 马上退出 + 提示;disableRemotePlayback + x-webkit-airplay=deny。
  懂技术的人改脚本仍能去掉,这一道挡的是顺手录屏 / 顺手删水印。讲义页水印是服务器烧进图里的(watermark_service),没动。
  浏览器验过(1366 / 390,2 分钟测试片): 32 秒换 5 个位置、每次在框里、不去正中间、不误停;删掉 / 框透明 / 字填充透明 / 挪出画面都停;
  恢复后接着放;关播放器无残留;控制台 0 报错。公告一条(老师 / 机构 / 平台,学生不弹)
- ✅ 音标视频「只能在电教室看」(2026-10-30,用户「音标视频可以通过 ip 判断在机构中使用家里不能使用」→「这是最好的方案吗 如果是就按这个来」):
  先查的生产实情: 直营学校出网 IP 几天一换(10 月 182.245.66.228 → .245 → .142 → .180 → .249),同一天还从 116.249.228.x 出去
  (多半第二条线路);10 月音标访问 359 次学生观看里 197 次不在学校网段(96 次晚上/周末),17 个学生 12 个在外面看过。
  所以**不让老师填 IP、不放行整段**。规则真源 services/classroom_net.py 文件头(老师页 pages/ClassroomNet.tsx 底部说明同步):
  ①在电教室电脑上点「这台电脑在电教室」→ localStorage 存设备码 eh_classroom_device(库里只存 sha256),之后每个请求带
  X-EH-Classroom 头(api/client.ts + _axiosBootstrap 两个拦截器),components/ClassroomPing 开页面 + 每 5 分钟 ping 一次
  (**没登录也报**),服务器记下它的 IP ②电教室 IP = 没移除的电脑**最近 7 天**报过的 IP(不是换了就作废: 两条线路来回跳)
  + 「今天先把这个网络算作电教室」(classroom_temp_nets,当天北京日,不登记设备,IP 刚换电脑没开机时用)③学生带本机构设备码直接放行
  ④老师给本班孩子开「允许在家看」(classroom_home_allows,可设到期日;机构管理员全机构)⑤**IP 只认 nginx 写的 X-Real-IP,不读 X-Forwarded-For**
  (客户端能填;生产 8000/8001 外网不通)⑥开关 classroom_net_settings.phonetic_mode any(默认,**没有行 = any,上线零变化**)/ classroom,
  只给 org_admin / admin,**没认出电教室 IP 时 409 不让开**;打开前列出最近 14 天在外面看过的孩子(GET /impact,学校旧 IP 靠「≥3 位老师登录过」认)。
  闸门挂在 api/v1/phonetics._enforce_gate(换票 / Bearer 串流 / 讲义列表 / 讲义页四处,request 改成**位置参数**,漏传就是在家也能看),
  **兑换码那道先判、地点再判、两道都过才扣次卡**(在家被拦不扣);?t= 票据串流**每个片段**再判一次(出了学校本机串流就停);
  列表 / 详情给 place_locked(整表一致,不记打开次数);403 detail.code=classroom_only。老师 / 助教 / 管理员不受限。
  判定缓存进程内 15 秒(CACHE_TTL);同一台电脑同一 IP 5 分钟只写一次库(shared_store 节流,键用设备码散列不用 id —— id 会被回收)。
  **挡不住**: 走 COS 的那一节签名地址 3 小时内出了学校还能取(绑不了 IP);在学校用手机流量算不在电教室;设备码被抄回家 → 设备列表里冒出标「新」的 IP,老师移除那台。
  五张新表 models/classroom_net.py(create_all 建,不进 tenancy 锚点,查询显式写 org_id);路由 api/v1/classroom_net.py 挂在 phonetics.router 的
  /classroom-net 下(**main.py 没动**)。操作记录 classroom.*。测试 tests/test_classroom_net.py(20 例),13 处守卫逐一破坏各自对应用例失败(回归锁验证过)。
  本机浏览器(库副本,X-Real-IP 模拟三个网络)验过: 登记 → 打开 → 在家角标 + 说明不进播放器 → 电教室能播 → 换 IP 后没登录的电教室电脑报到、新 IP 学生能看
  → 老师开允许在家看 → 在家能看;1366 / 390 无横向溢出。入口: 教师工作台「内容准备 → 电教室网络」/ 顶部「更多」/ 音标视频管理页顶上;
  机构管理首页「管理 → 电教室网络」;平台「运营工具箱 → 内容与服务 → 电教室网络」;学生端卡片「🏫 到电教室看」。公告老师 / 机构+平台各一条
- ✅ 管理端「词汇总量」删了书 / 单元不减(2026-10-30 修,用户「管理端的单词总量删除的没有从新计算」): 以前数的是 words / units 整张表,
  删书只删 word_books 那一行(生产外键关着,单元、关联、词条都留着),删单元只删单元和关联,词条行永远不删 → 数字只涨不跌。
  10-30 生产: words 表 144,970 行,还在某本书里的只有 91,420 条(不同拼写 24,806);units 表 2,483 行,850 个属于已删除的书。
  现在三处(管理端首页 / 数据统计 `GET /admin/stats`、内容管理 `GET /admin/content/stats`、教师工作台 `GET /teacher/dashboard/stats`)
  都走 services/word_stats.py: 只数**还在的书**的单元里的词 + 书上直接挂的词(book_words),按词条 id 去重;单元只数书还在的。
  **词条行不删**: 学生的学习记录、掌握度还指着它们(10-30 生产 3,206 个书已删的词还被 word_mastery 用着)。
  WordBook 是租户锚点,机构管理员 / 老师只数平台书 + 本机构的书(副本上验过)。⚠️ 同一个 apple 在 5 本书里是 5 条词条(导入时每本书各建一份),
  所以「词汇总量」比不同单词多得多。测试 tests/test_word_stats.py(删单元 / 移词 / 删书三步各自减少,三个接口同一个数;
  改回数整表或单元不过滤已删书各让它失败)
- ✅ 作业批改(2026-10-30 12:50 **已部署生产**,提交 44b607a;3 个改动的后端文件生产==HEAD~1 整推(git archive 导出)+ 新文件 services/homework_check.py、api/v1/homework_check.py;新表 homework_checks 由 create_all 建(先在生产库副本跑过 init_db);两个服务都重启;前端干净 worktree 构建 mvuhmxsb 整推;备份 /root/eh_db_before_hwcheck_20261030_1241.db、/root/eh_code_before_hwcheck_20261030_1241.tgz、frontend/dist_bak_20261030_1241。生产冒烟(临时老师 + 学生 + 班,跑完删净): 合成的 9 题手写页 12 秒批完,5 对 3 错 1 没写全对,错题和没写的题都没下发答案和讲解,结果里没有孩子姓名,改错一次只给提示,次数 20→19,老师看得到正确答案;sonnet-5-5 3549 入 / 1068 出 token。用户「学生端单独需要个作业批改 摄像头也可以拍照」): 学生拍一页**自己做完的**英语作业,小鹰老师逐题批改、学生在网页上订正。
  规则真源 services/homework_check.py 文件头(1–7 条)。和「问小鹰老师」拍一道题问思路分开: 这里是整页判对错。
  ①**先做后批,不做拍照搜题**(合同第三条第 10 款): 错题先给提示让孩子自己改,**改对了**才看讲解,**改了 2 次(REVEAL_AFTER)还不对**才给答案;
  **没写的题永远不给答案**(最多试 5 次,之后提示去问小鹰老师或老师);作文 / 开放题(checkable=false)只给修改建议,不在网页上订正、讲解不给孩子(可能是范文)。
  正确答案只在服务器(homework_checks.items),下发的那份按 public_item 去掉;提示里写出了答案的(「选A就对了」、整个答案出现在提示里)换成带知识点的通用提示(_leaks,
  注意不能用 \b —— 汉字也算单词字符)
  ②**照片不存**: 浏览器先压成长边 2000 的 JPEG(HEIC 也转),服务器再压一次只在后台任务内存里给模型看,库里只存读出来的文字;孩子带汉字的姓名 / 用户名换成 **
  ③**次数**: 批一页扣 1 次「问小鹰老师」次数(同一份 tutor_allowances);看不清 / 不是英语 / 一题没读出来 / 模型都没调通 / 写满 max_tokens / 5 分钟没批完 → 标 failed 退回
  (条件 UPDATE 从 pending 改过去的那一下才退,迟到的结果不覆盖);同一个孩子同时只能批一页(409);限速 3/分钟 30/小时
  ④**模型**: 小鹰老师那个专用 Key、快速档那组(conf.chain("fast"): 主 sonnet-5-5 / 备 sonnet-4-6),**非流式、和学习助手一样走 raw httpx**(tt.new_client,测试 MockTransport 替换)。
  5.x: adaptive 思考 + effort medium + strict 工具 + tool_choice auto(5.5 强制调工具 400)+ `fallbacks: "default"`(beta server-side-fallback-2026-07-01;中转 400 提到 fallbacks 就去掉重发);
  4.6: 不开思考 + 强制 tool_choice=tool、不带 strict。被拒(refusal)/ 写满 / 没号换下一个。**output_config.format 中转不认**(回 ```json 文本),所以用工具交结果;
  4.6 有时把 items 写成 JSON 字符串,两种都认。10-30 经中转实测(合成的 9 题手写页): sonnet-5-5 11–16 秒 9 题全判对,约 3–4k 入 / 1.1–1.3k 出 token;
  sonnet-4-6 15 秒判错 1 题(Its 当 It's);opus-5-5 也全对但贵一倍,没用
  ⑤错题的知识点记进小鹰老师笔记(stuck,不算「请老师当面讲」的判错次数),一页同一个点只记一次、最多 5 个 ⑥「批错了?」只做记号给老师看,不改对错数
  ⑦订正判分: 大小写 / 标点 / 弯撇号不算错,don't = do not,选择题认字母((A) / A. It's 都算 A);订正并发按 version 条件 UPDATE
  表 homework_checks(models/tutor.py,create_all 建);路由挂在 api/v1/tutor.py 已有的 student_router / teacher_router 上(**main.py 没动**);半年前的孩子打开页面时顺手删。
  前端: 页面 /student/homework-check(pages/StudentHomeworkCheck.tsx): 手机「拍照」走系统相机(input capture),电脑 / 平板「打开摄像头」在网页里拍
  (components/homework/CameraCapture,getUserMedia 要 https;权限被拒、没有摄像头、被占用各给一句怎么办;portal 到 body),都能「选一张照片」;
  拍完先预览再交;批改中每 3 秒问一次、走秒,关了页面再进来接着等;批过的列在下面。老师: 学生详情页「作业批改」(components/teacher/HomeworkCheckPanel,只读、带正确答案、
  孩子标了「批错了?」的高亮)。管理端「AI 学习助手」卡片多一行近 7 天批了几页 / token。卡片图 public/tools/homework_check.jpg(gen_student_tool_art.py 新加一张,
  **本机中转 Key 出不了图(404)**,在生产机用 image_tutor 那行的 Key 出的)。合同第三条第 10 款、招商手册、家长手册加了「每页计 1 次 / 没写的不给答案」。
  测试 tests/test_homework_check.py(15 例);18 处守卫逐一破坏各自对应用例失败(回归锁验证过)。本机浏览器(库副本 + 真中转,1366 / 390)走过:
  首页两个入口 + 公告 → 选照片预览 → 交 → 批完 9 题 5 对 3 错 1 没写 → 错题改错一次只给提示、改错两次给答案 → 选择题改对看讲解、改对数 +1 →
  老师详情页看到答案和改了几次;390 宽无横向溢出、控制台 0 报错。**电脑摄像头只在代码里写了,自动化浏览器没有摄像头,没实测**。
  入口: 学生首页「学习工具」第一张「作业批改」(本校开了小鹰老师才有)/ 首页「问小鹰老师」卡片里「作业做完了?拍一页」;老师学生详情页往下。公告学生 / 老师各一条(gate tutor)
- ✅ 小鹰老师自动布置作业(2026-10-30 04:10 **已部署生产**,提交 d5b0b98;11 个改动的后端文件生产==HEAD~1 整推(git archive 导出)+ 新文件 services/autopilot.py、models/autopilot.py、api/v1/autopilot.py;六张新表 create_all 建(先在生产库副本跑过 init_db);两个服务都重启;前端干净 worktree 构建 mvtyxld2 整推(补了 3 张 .gitignore 挡住的 eagle-original-cutout*.png);备份 /root/eh_db_before_autopilot_20261030_0403.db、/root/eh_code_before_autopilot_20261030_0403.tgz、frontend/dist_bak_20261030_0403。上线后所有班都是「给建议」,没有班签到就派 = 孩子那边零变化,直到老师自己点「按建议布置」或改成签到就派。生产库副本量过: 70 人的班全班建议 3.9 秒(单人最慢 0.47 秒)。生产冒烟(临时老师 + 学生 + 班,跑完删净): 建议 25 个词 → 按建议布置 → 撤回 → 改签到就派 → 签到当场派 2 份 → 学习页 15 个词过关线 80 → 考 70 没过不标完成 → 考 95 第 1 份完成 → 第 2 份过关全部完成、金币 +1 → 6 秒后 AI 点评写好(1045 token,署名小鹰老师)→ 再来一份出加练;用户「我的目的就是需要解放老师 让ai全自动」→ 一路定规则 →「开始 怎么用我们的逻辑是什么你需要在教师端写清楚，什么时候需要人工什么时候不需要」):
  规则真源 services/autopilot.py 文件头(1–10 条),**老师页的说明(pages/TeacherAutopilot.tsx Guide)要和它同步**。
  ①**按班两种**: 给建议(默认,老师看建议点「按建议布置」才写作业)/ 签到就派(checkin.py 签到成功顺手 ensure_dispatch);
  老师今天自己给这个孩子布置了单词作业 → 不派;一天只派一次(autopilot_dispatches UNIQUE student+day,claiming 5 分钟算卡住);
  平台总开关 system_configs.autopilot_settings(默认开,管理端首页卡片);班级 / 孩子都能暂停;助教不能切模式
  ②**每天的量** 20/40/60/80/100/150/200(含轮次 + 复习 + 新词,复习按 10 算): 起点 = 自己两周日均降一档(≥4 天学过)否则 20;
  头 3 天每天调,之后最少隔 3 天: 都做完且第一次平均 ≥85 升、3 天里 2 天没做完或 <70 降、做完还自己加练 2 天升;老师可定全班上限、单个孩子固定
  ③**三轮才算学会**(autopilot_groups 一人一组一行): 第 1 轮新学,隔 1 天第 2 轮,隔 3 天第 3 轮,之后每 3 天一轮;
  rounds ≥3 **且**那天第一次过关检测 ≥ 过关线 → 学会;没到就一直加轮。同一天重复 / 提前学 = 自己加练,不算轮。
  以前学过的书第一次派时按学习记录补轮次(bootstrap,只认间隔够的日子,每本书只补一次)
  ④**每天的顺序**: 到期的高轮 → 到期的第 2 轮 → 每日复习(有到期词)→ 新词(接着最近在学的书,学完换下一本能学的书)
  ⑤**过关线** 80/85/90/95: 第一周 80;之后每周按 14 天第一次过关平均(≥10 次)<88→80、88–92→85、93–96→90、≥97→95,一周最多动一档;
  老师可固定全班 / 单个孩子(固定的优先)。学习页 StartLearningResponse.pass_line、过关成绩页「过关要 N 分,还差 M 分」、作业目标分都用 pass_line_for 一个数;
  **老师改了过关线,今天派的还没做完的作业目标分跟着改**(sync_today_target,否则横幅写 80、考完说要 90)
  ⑥**过关检测每一次都记**(POST /student/autopilot/attempt,走 submitReliably,过了没过都记,第一次分数单独存);
  作业完成**服务器判**: 这份作业的组今天都过关了才标 completed(complete_tasks),学生交卷那条也改成按它判(task_passed)
  ⑦**加练**: 今天的都做完了首页「还想学,再来一份」(半档、最少 10、一天最多 5 份),batch>0,**不算今天的任务、不发金币**:
  coin_service 三处分母、coach / today_report / tutor_profile 今天任务数都排除 extra_homework_ids()
  ⑧**新孩子**: 没书 → 老师待办;有书从第一个没学过的单元 20 个、过关线 80;老师可指定书和开始单元
  ⑨**电教室 / 家里**: 班级设每周哪几天来电教室,那几天派的算电教室(发金币)其余算家里;没设按默认地点;单日可临时改
  ⑩**小鹰老师点评**(署名小鹰老师,CoachNote author_id=None): 今天的做完了或 22:30 统一写(挂 sentence_speech.speech_loop),
  一人一天一条;本校开了小鹰老师就走 claude_tutor 中转写(**不扣次数,不发名字**,先用备用模型 sonnet-4-6,max_tokens 400,
  check_ai_comment 校验 JSON / 10–150 字 / 无网址长数字 / focus 只能是今天写错的词),没开或没调通按规则写(rule_comment,**低分不点出来**);
  老师当天自己写过的不覆盖
  ⑪**老师待办**(GET /teacher/autopilot/todo): 需要关心 / 要请你当面讲 / 走了 3 轮还没学会 / 今天学得吃力 / 连着几天没来 / 没书 / 书要卡 / 书学完了
  安全: 只派他能学的书(get_allowed_unit_ids + 卡包规则);布置人「小鹰老师(自动)」/「小鹰老师(张老师点的)」;
  老师点的派发、改设置、撤回进操作记录(autopilot.*),自动派的不记(太多);「撤回今天的」只撤还没开始做的。
  六张新表(models/autopilot.py)create_all 建;路由挂在 api/v1/tutor.py 已有的 router 上(**main.py 没动**)。
  前端: 老师页 /teacher/autopilot(说明「怎么用 / 不需要你的 / 需要你的」+ 每条规则、待办、班级设置、每个孩子今天派了什么 / 建议、单个孩子设置);
  学生首页 components/autopilot/AutopilotTodayCard(今天每一份 + 过关线 + 再来一份;这几份不再在「老师布置的任务」里重复列);
  管理端首页 components/admin/AutopilotAdminCard(总开关 + 今天派了多少 + AI 点评 token)。
  测试 tests/test_autopilot.py(21 例),31 处守卫逐一破坏 30 处对应用例失败(「没过不标完成」那处是冗余守卫,complete_tasks 本身就判)。
  本机浏览器(本地库副本,1366 / 390)验过: 老师页说明、建议 → 按建议布置、学生首页卡片 → 去做进对的那一组、过关线改 90 后横幅和成绩页都是 90、
  没过不标完成、过了标完成发金币、再来一份出第 2 组、管理端卡片;无横向溢出、控制台 0 报错。
  入口: 教师工作台「课堂推进 → 小鹰老师 · 自动布置」/ 顶部「更多」;学生首页「小鹰老师今天给你排的」;管理端首页「小鹰老师 · 自动布置」。公告老师 / 平台各一条
- ✅ 体验卡正面印校区地址(2026-10-29 20:45 **已部署生产**,提交 956e741;promo 三个后端文件生产==HEAD~1 整推,database.py 生产有 drift 走 anchor patch 只加 1 条 ALTER;两个服务都重启;前端 dist 构建号 mvtj8pd6;备份 /root/eh_db_before_cardaddr_20261029_2043.db、/root/eh_code_before_cardaddr_20261029_2043.tgz、frontend/dist_bak_20261029_2043。**生产还没填地址**(等用户自己在设置里填),没填 = 卡面和以前一样,用户「地推卡还需要加上公司地址: 昆明市五华区霖雨路飞鹰教育3楼,需要动态填写…换地址了后台也可以换」):
  **按机构填,不按卡填**: promo_org_settings 加列 card_address(VARCHAR 60,NULL = 不印;database.py 1 条 ALTER),
  「设置」里一个输入框,全机构每版卡都印同一个;搬了家改设置、到「卡码」重新下载印刷文件就是新地址,**已印出去的卡改不了**(设置页、印刷说明都写明)。
  最多 22 个字(services/promo.CARD_ADDRESS_MAX,前端 AdminPromo 同值),换行和连续空格并成一个空格;
  「键在才改」走显式分支,只改体验价的请求不会抹掉地址,空串 = 清掉(测试两处各破坏一次都失败,回归锁验证过)。
  印在**正面**名字电话下面一行(前面画一个定位小图标,不用 emoji —— 印刷厂字体里不一定有),**背面不印**: 背面二维码框最窄那套二维码只有 18mm,再塞一行会缩到 16mm。
  正面那条从一行变两行高了一截,OCR 逐套量过: 50 套里 10 套居中会压到模板底部的「扫码进群 预约体验」,
  promoTemplates.ts 加 strip2(印了地址时放哪边);两行条最宽 460 + 留白(第 50 套左边只放得下 504),
  名字电话特别长缩到最小字号还放不下就横向压(fillText maxWidth),白条不变宽。只印地址不印名字电话时也走这套宽度(否则压第 37 套)。
  核对办法(以后换模板 / 改条的尺寸要重跑): 浏览器里调 utils/promoPrint.frontStripLayout 取 50 套的实际矩形,与 OCR 文字框和 price 框求交,
  短地址 / 22 字 + 超长名字电话 / 只有地址三种情况都 0 处压字、不出安全区。家长扫码页最下面也显示「机构名 · 地址」。
  本机浏览器(库副本)1366 / 390 宽验过: 设置页填地址实时出卡面预览、印刷弹窗、扫码页,无横向溢出,控制台 0 报错。
  测试 test_promo.py::test_card_address_setting。入口: 「地推体验卡 → 设置 → 卡上印的地址」;公告一条(admin + org_admin)
- ✅ 小鹰老师补知识点 + 教师端小鹰老师(2026-10-29 17:25 **已部署生产**,提交 8b8aa91;10 个后端文件生产==1bd34fe 整推(git archive 导出)
  + 新文件 services/teacher_tutor.py;两张新表 tutor_handoffs / teacher_tutor_usage 由 create_all 建(先在生产库副本上跑过 init_db);
  两个服务都重启;前端干净 worktree 构建 mvtc16l6 整推(补了 35 张被 .gitignore 挡住的 public 图);备份 /root/eh_db_before_tutorteacher_20261029_1714.db、
  /root/eh_code_before_tutorteacher_20261029_1714.tgz、frontend/dist_bak_20261029_1714。生产冒烟(真模型,临时老师 + 学生跑完删净):
  老师「给他出 3 道题」首字 11.7s、出卷 3 题带答案、本月 1000→999、库里存原话;学生首页「考考你」首字 5.1s、出 2 题、used 仍 0;用户「小鹰助手如果用户欠缺知识点如何帮助学生解决问题,教师端也需要一个月 1000 的额度,需要同样的功能」→
  「直营免费,加盟和我们购买 300 / 1000 次,别的按你建议」):
  ①**缺前置**: RULES 第 4 条加第五步「换了讲法还错 → 先问一个前置小问题,前置不会先补前置」;save_note 多一个 missing 参数,
  原来那条 detail 写「缺前置: …」、前置另记一条 stuck(services/tutor_notes)
  ②**交给真人老师**: 笔记里同一个点**练习里判错**满 HANDOFF_WRONG(3)次、没学会 = 要请老师当面讲(stuck 不算,一段对话会记好几遍)。
  「要请老师讲」按笔记现算不另存;老师点「我讲过了」写一行 tutor_handoffs(note_id 主键,记那一刻 times_wrong),
  之后又错了(times_wrong 变大)重新出现;学会了(mastered)不再出现;讲过的明天回头考。只本班(assert_student_in_my_class)。
  学情档案多一行「系统已经请他的老师当面讲」。入口: 「小鹰老师 · 本班情况」顶上「要请你当面讲的点」,工作台黄条 + 入口角标
  ③**首页「考考你」**: status 带 review(今天到期的第一条笔记),首页卡片和聊天欢迎卡都有「10 秒考考你」,点了自动发 review_note_id;
  考哪个点服务器从笔记拼(review_prompt),不信前端的字;一天 REVIEW_DAILY(1)次不扣(cost = COST_REVIEW -4,不当追问起点也不占追问),
  超了照扣;没调通还回去。⚠️ 顺修: **提问前先 _ensure_allowance** —— 没有次数行时「用了几次」按收到过几次回答现算,
  第一问是免费的(考考你 / 说心里话)会被算成用了 1 次(测试抓到的)
  ④**教师端小鹰老师**(services/teacher_tutor.py,页面 /teacher/tutor): 同一个专用 Key、同一条 answer 流水线(RelayConf 加
  tools / runner / max_tokens / tool_status 四个钩子,学生端不传 = 原样)、同一张对话表(user_id = 真实操作人,助教问的记助教名下)。
  规则 TEACHER_RULES: 老师要答案直接给、不走三步提示、没有安全提醒 / 记忆图 / 笔记 / 免费追问。工具: get_class_overview /
  find_students / get_student / get_class_weak_words / lookup_word / make_worksheet(出卷,最多 20 题,复用 tutor_quiz.build_items 校验,
  答案给老师,前端 WorksheetCard 下载学生版 / 教师版 PDF)。**工具只查本班**(roster 和本班情况同一份名单)。
  **次数**: 每位老师每月 monthly 次(默认 1000,system_configs.teacher_tutor_settings,管理端「AI 学习助手 → 教师端小鹰老师」改),
  表 teacher_tutor_usage(user_id+北京月 YYYY-MM 主键,换月自然从 0);深度思考按学生端同一个 deep_cost;助教用主老师那份。
  **直营免费**;加盟机构每问一次再从机构次数池扣(同一个池、¥0.3/次,合同第三条第 10 款已加一句),池子扣不动把老师那月退回 → 429;
  没调通两边都退(退回扣的那个月)。管理端用量 / 各机构「问过的人数」改成只数学生。机构首页、发次数弹窗写明池子里老师自己用掉几次。
  **学生名字不发给模型**: 工具结果只有代号 S+id;老师写的本班学生姓名(带汉字、≥2 字)发前换代号(pseudonymize,英文用户名不换,
  会和单词撞);库里存原话;页面取 /teacher/tutor/me/roster 把代号换回名字(姓名没填用用户名,和本班情况同口径 ——
  coach.child_name 会把带数字的用户名藏成「孩子」,那是给家长群图用的,老师页面别用)。
  路由全挂在已有的 teacher_router(**main.py 没动**)。手机上 /teacher/tutor 隐藏底部导航(StaffMobileNav immersive,否则盖住输入条)。
  测试 tests/test_tutor_gaps_teacher.py(10 例);池子扣 / 池子不够退月 / 退回池 / 月上限 / 代号 / 本班两处 / 对话只给本人 / 开关 /
  只数学生 / 考考你免费 / 服务器拼题 / 本人到期 / 失败还回 / 先建次数行 / 讲过又错重现 / 本班才能处理 / 学会隐藏 / 缺前置 / 卷子只留本班代号
  二十处逐一破坏各自对应用例失败(回归锁验证过)。本机浏览器(库副本 + 本地假中转,390 / 1366)验过: 工作台黄条和入口、
  「我讲过了」写一句后消失、老师出卷代号换成名字、教师版 PDF 内容对、本月剩 999 次、学生首页「上次的…10 秒考考你」点进去自动出题、
  管理端教师端设置和本月用量;控制台只有登录前一个 401。公告: 老师两条(gate tutor)、学生一条(gate tutor)
- ✅ 体验卡: 体验期变真日期 + 老带新延期(2026-10-29 17:25 **已部署生产**,与上一条同一提交 8b8aa91 同批上线;三张新表 create_all 建;
  本机浏览器(库副本,390 宽)走过一遍: 扫卡留电话 → 关联学生号 → 开通 2 本到 11-04 → 朋友经 ?f= 留电话、列表显示「朋友推荐 139****1111」→
  标已付 ¥99 后推荐人两本书都延到 11-11 → 进度页「1 家付了体验费,体验到 11 月 11 日」→ 标已退款缩回 11-04;成功页 / 进度页没有奖励字样;用户「家长分享一个用户报名了就增加 7 天,2 个 14 天以此增加,并且分享的用户报名付费了才有效」→「别的按你建议」): 以前「已开通」只是线索状态,书是老师手动分配的永久授权,7 天到期全靠人记。现在线索抽屉「开通 7 天体验」按包月卡口径开 `book_assignments.grant_type='period'`,到期自动锁(scope_service 原样判活)。到期时间只在 `services/promo.trial_expiry` 一处算: 开通那天(北京日)起 7 天到北京 0 点 + 每计入一家 7 天(最多 `promo_referral_settings.max_count`,默认 4)+ `gap_days`,再和 `floor_until` 取大。三张新表 `promo_trials` / `promo_lead_links` / `promo_referral_settings`,create_all 建,不进 tenancy 锚点。规矩: ①学生本来就有的书不碰;被兑换码续期 / 升永久 / 老师改过的(到期日对不上)不再管,从 book_ids 去掉 ②卡包机构凭卡才能开的书不能开体验(card_pack.gated_book_ids) ③邀请链接 = 卡上地址 `/c/{卡码}?f={share_code}`,只认同机构的码;朋友归推荐人那家的销售;同号已登记不算推荐;老客户不计入 ④朋友线索走到过「已付」**且实收 > 0** 才计入(`credited_at` 只写一次),上限按付费先后动态套,退一家超限的那家补上 ⑤「已退款」新状态,`revoked_at` 只写不清;到期日缩到今天之前、孩子今天在学 → 保底今天 24 点,只在那一刻写 `floor_until`,之后不按当前时间推 ⑥体验过期后才有朋友付费 → 从今天起再给 7 天 ⑦分享码和看进度码分开(进度页有别的朋友的手机尾号和孩子体验日期,不能让朋友打开);已登记的号再扫一次只给邀请链接不给进度链接 ⑧删线索显式删 links / trials;删推荐人 → 朋友的 referred_by_lead_id 置空(SQLite 会回收 id),显示「(推荐人已删除)」;删算过数的朋友 → 推荐人重算 ⑨落地页 / 进度页不写奖励(微信诱导分享封域名),规则只写在销售抽屉和设置页。看板 / 各校区汇总加「推荐来的 / 推荐后付费」。入口: 「地推体验卡 → 线索」点开一条 →「体验期」「邀请朋友」;「设置 → 老带新」;家长登记成功页「邀请朋友一起体验」;进度页 `/c/share/{码}`。测试 tests/test_promo_referral.py(12 例),19 处守卫逐一破坏各自对应用例失败(回归锁验证过)。公告一条(admin+org_admin;whatsNew roles 没有 sales,销售看不到公告)
- ✅ 登录防爆破 + 改密码踢掉旧登录 + 接口文档下线(2026-10-28,用户「你看看管理端会不会爆破风险」→「好的」):
  先查的实情: 登录不限次数、nginx 没有 limit_req,唯一平台管理员用户名 feiying(品牌名、没绑手机);bcrypt 一次约 0.3 秒
  且在事件循环里算;改密码不让旧 token 失效(正式机构 / 管理员 token 不带 sv);/docs、/openapi.json 公网能开(日志里境外 IP 抓过 49 次)。
  nginx 日志 2 月以来登录 401 共 5,639 次,失败最多的 IP 是学校机房出口(和管理员自己登录的网段同一段),单 IP 10 分钟最多失败 257 次。
  ①**services/login_guard**: 先记一次再校验(并发时只记失败会全放过去),三道: 账号×IP 15 分钟 教职工 5 次 / 学生家长 10 次;
  账号×全部 IP 1 小时 30 / 60 次,**最近 7 天在这个 IP 登录成功过的不受这道拦**(否则别人随手试就能把真管理员锁在外面);
  IP×全部账号 10 分钟 500 次(机房)。**刻意没有全站总闸门**(等于一键锁全校)。账号按用户 id 计(用户名 / 手机号 / 邮箱同一号),
  不存在的号按输入散列计。登录成功清掉账号×IP 计数。被拦 429 detail.code=login_locked + Retry-After。家长登录、家长注册里的「已有家长号试密码」同一套。
  登录后的确认密码(改密码 / 改用户名 / 机构改密码)和金币 PIN 走 confirm_secret: 只数输错的,15 分钟错 8 次 429(PIN 常是 4 位)
  ②**bcrypt 挪到线程**(verify_password_async / get_password_hash_async,bcrypt 算时放 GIL)
  ③**所有角色的 token 都带 sv**(auth_service.session_token_for),校验统一 session_ok(没 sv 的旧 token 按 0;上线时生产非学生 session_ver 全是 0,没人被登出)。
  改密码(/auth/change-password、/org/my-password)、找回密码、管理员 / 机构 / 销售 / 家长重置密码都 bump_session → 其它设备下线;
  改密码响应带新 access_token,前端两个弹窗换上,当前设备不掉线。正式机构老师 / 管理员登录本身仍不 bump(照样双开)。
  WS 三处(PK / 直播弹幕 / 竞赛)自建鉴权也加了 session_ok。**平台管理员 token 1 天**(ADMIN_TOKEN_TTL),其它照旧 7 天 / 家长 30 天
  ④接口文档挪到 /_internal/docs、/_internal/openapi.json(nginx 不转发这个前缀),公网 /docs、/openapi.json 404。
  ⚠️ 副作用: 同一个机房里的人故意输错 10 次,能把同学锁 15 分钟(只锁这个号在这个 IP 上)。
  **没做(要用户定)**: 「账号不存在 / 密码不正确」合并成一句(建议只对教职工合并);管理员登录记录展示;管理员动态验证码;nginx 层 limit_req。
  测试 tests/test_login_guard.py(17 例)+ 改 test_org_admin_teacher_crud 1 例(改密码现在会让旧 token 失效)/ test_parent_binding 1 例;
  conftest 加 autouse 清共享存储(登录计数按用户 id,内存库 id 每个用例从 1 开始会串)。
  账号×IP / 成功清零 / 常用 IP 豁免 / 学生宽一些 / 不存在的号计数 / 旧 token 放行 / bcrypt 回事件循环 / 确认密码不计数 / 管理员 7 天 / 文档放回公网
  十处逐一破坏各自对应用例失败(回归锁验证过)。WS 那三处没有用例锁(它们自己开 AsyncSessionLocal,测试库够不着)。公告一条(teacher/org_admin/admin)
- ✅ 音标键盘会教 + 提问区看得清(2026-10-28,用户「音标视频下方的评论字体和文本框看不清楚」「音标键盘学生不知道怎么打」):
  ①**提问区白底白字**的根因: 全站 `body.student-interface textarea` 铺白底,优先级压过 bg-white/10,而这里写的是白字。
  改成白底深字输入框(16px,iOS 小于 16px 聚焦会放大整页)+ 写的时候实时显示「老师会看到你问的是视频 3:20 这里」+
  标题 16px、时间/状态 13px、老师回答 16px,深色面板上对比度都 ≥ 4.5:1;按钮「问老师」改「发给老师」
  ②**键盘每个键下面印例词**(c**a**t,发这个音的字母加粗上色),真源 utils/ipaPhonemes.PHONEME_EXAMPLES,
  49 个键全有、最长 5 个字母(320 宽一个键 35px),例词逐个用词库音标核对过(测试 test_keyboard_examples_cover_every_key_and_hold_the_sound
  正则解析前端文件、本机库里查得到就核对音素);点键读这个词(同一个 Edge TTS,可关,按账号记)。辅音白键、元音橙键,图例写在键盘顶上
  ③**第一次打开自动放「怎么打」**(components/phonetics/IpaHowTo,用真键真格子演示打 bed 五步,按账号记已看,键盘上「怎么打?」随时再看;
  portal 到 body,捕获阶段截住回车/退格不漏给卡片页)④**重音符不用打了**: 生产 177 道题第 0 格是 ˈ,判分本来恒判对,
  孩子却把第一个音填进去整排错位(带重音的题一遍正确率 77.4% vs 87.8%)。lessons 接口每题多给 stress_at(只说第几格,不带音素),
  前端 initialSlots 印好、不可编辑、键盘去掉 ˈ 键。旧前端没这字段照旧能用。生产用过写音标的只有 3 个学生(1075 次作答)。
  公告学生一条
  **同日补: 提问框能打音标**(用户「视频下面的提问区怎么输入音标」→「UI 键盘显示不全」): 输入框下面「/æ/ 打音标」展开
  components/phonetics/IpaInsertPad(同一个 IpaKey,compact 档 36/40px 高),点了插到光标处成 /æ/,紧接着再点拼进同一对斜杠
  (/bæd/),退格整个删一个音、删空连斜杠一起删(utils/ipaPhonemes.insertIpaAt / backspaceIpaAt,纯函数)。不读例词(视频在放)。
  手机上收起系统键盘、展开后把输入卡片滚进屏幕、输入框收成两行;768 以上辅音元音左右并排只占 4 行。
  **播放器遮罩原来 items-center 且不能滚**,面板比屏高时上下各被裁一半 → 改 overflow-y-auto + 面板 my-auto。
  320 / 360 / 375(SE 可见 553)/ 390 / 1280×577 / 1366×625 / 820 七种尺寸实测: 输入框 + 整块键盘 + 发送键同屏、例词不截断。
  ⚠️ 卡片写音标页在 iPhone SE 上键盘下半截要在卡片区里往上滑(交卷键固定在底部不受影响),没改
- ✅ 管理员自己改用户名 / 密码 + 「最近部署」格子修复(2026-10-28,用户「管理端增加修改自己的用户名和密码功能」
  「最近部署 10/28 11:52 线上前端版本 这里 UI 显示不全」): 后端早有 `PUT /auth/change-username`(要当前密码)/
  `PUT /auth/change-password`(都走 get_real_user),纯前端接入。StaffWorkspaceHeader 只对 role='admin' 把右上角名字
  变成按钮 → 菜单(名字 + 登录用户名 + 修改用户名 / 修改密码),复用 ChangeUsernameModal / ChangePasswordModal;
  768–960 宽名字胶囊原本整个藏掉,管理端改成只留人像图标;手机账号菜单多两项。**弹窗 createPortal 到 body**
  (顶栏有 backdrop-filter,fixed 遮罩放在顶栏里只盖住顶栏那一条)。教师端自己页面里已有这两个按钮、机构端走
  /org/my-password,所以 canEditAccount 只开 admin。JWT sub 是用户 id,改用户名不掉线。
  「最近部署」: 半宽格子塞不下「10/28 11:52」被 truncate 截断 → 大字只放时分,今天 / 昨天 / 日期放标题右侧,
  底行改成前端构建号(/admin/system/version 的 build)。顺手: 音标视频线路卡 RouteNow 在返回没有 cos 字段时
  读 undefined 会把整个管理首页打进错误页,加了 `state && cos` 判断。浏览器验过 1366 / 820 / 390 / 320(假接口)。
  公告一条(admin)
- ✅ AI 学习助手「小鹰老师」(2026-10-26 16:33 **已部署生产**,提交 02328ff;main.py 走 anchor patch 只加 tutor 路由 6 行,
  其余 5 个文件生产==HEAD~1 整推 + 新文件 api/v1/tutor.py、services/tutor.py、models/tutor.py;两张新表 create_all 建;
  两个服务都重启;备份 /root/eh_db_before_tutor_20261026_1627.db、/root/eh_code_before_tutor_20261026_1627.tgz、
  frontend/dist_bak_20261026_1627,构建号 mvozvcsm): 用户给了 Claude 中转 Key(hk.hueling.cc)要「做个学习的 agent」,
  **并明确「这个 key 只用在解题学习 agent 上面,周报这些别用,贵,要节约」**。
  ①**Key 隔离**: 存 ai_providers 一行 provider_name='claude_tutor'(Fernet 加密),**不能设默认**(admin/ai_config 创建/更新
  两处 400);ai_service 的默认通道 / OCR / TTS 三处查询都 `provider_name != "claude_tutor"` —— 就算库里被手改成 is_default=1
  周报也拿不到它(测试锁住)。学习助手只读这一行(services/tutor.relay_conf)
  ②**模型**: 主 claude-haiku-5-5、备 claude-sonnet-4-6(extra_config.fallback_model)。**haiku-5-5 在这个 Key 的分组一直 503
  「No available accounts」**(10-26 多次实测,上线时也是),所以实际全走 sonnet-4-6;主模型 503/404/429/5xx 记 5 分钟
  「主模型不可用」(shared_store tutor:primary_down)直接用备用,最后一个模型多试一次。
  **中转在上游回空时自己编一段「⚠️ 上游模型未返回任何内容…」当正文**(实测),以 ⚠ 开头的回答先攒着、命中就丢掉重试(RELAY_EMPTY_MARK)
  ③**省钱**: 每人每天 20 次(管理端可改,ai_quota feature=tutor,彻底失败 refund)+ 限速 6/分钟 60/小时;max_tokens 600;
  只带最近 8 条历史;工具最多 3 轮(最后一轮 tool_choice=none 保证出字);规则段 cache_control(实测缓存命中 4k–20k token);
  照片前端压 1280 + 后端压 1100px JPEG(去 EXIF)。实测一问约 200–1700 输入 + 100–200 输出 token
  ④**工具**(全部按当前学生 id 查): get_today_tasks(today_report + daily_review)、get_weak_words(top_wrong_words + 写成过什么)、
  lookup_word(课本释义/音标/例句/记忆钩子)、get_task_words(今天没做完的作业单元/组的词)、make_practice(练习卡,
  **看中文写单词时释义里的英文提示要去掉** _hide_spelling,如「(=center) 中心」)、show_link(复习/作业/错题本按钮)。
  练习卡前端当场判,**不计分不进学习记录**(聊天里随手练,算进掌握度会变成刷分入口)
  ⑤**规则**(提示词): 只聊英语学习、口语化 ≤120 字、不用 markdown(模型仍偶尔带 **,存库前 tutor.plain 去掉,前端 clean 同步)、
  **作业考试题只给提示**(真模型实测: 「直接告诉我答案」仍只给提示)、拍题第一行写「我看到的题目: …」、讲词先 lookup_word、
  出了练习卡不在回答里写出卡上的词(第一版写了 = 送答案)、调工具前不说「我查一下」、不问不复述姓名学校。只发学习数据
  ⑥**流式**: SSE(X-Accel-Buffering: no + no-store),回答在 asyncio 后台任务里跑、**自己开 AsyncSessionLocal**(孩子关页面也写完库);
  经 nginx 实测首字约 6s、逐段到达(不是攒着一起发)。走工作进程,不用进主进程
  ⑦**开放范围** system_configs.tutor_settings: off / hq(只直营 org 1,**默认**)/ all。首页卡片、错题本按钮、学生/老师公告
  都按 status 决定显不显示(whatsNew 新增 `gate` 字段,没开放的不弹也不记已读,开放后再弹)
  ⑧老师: 学生详情页「问小鹰老师」只读(assert_student_in_my_class),照片不存只记 has_image
  入口: 学生首页工具第二个「问小鹰老师」/ 错题本每个词「问小鹰老师怎么记」(带问题进来只填不自动发,省次数);
  老师学生详情页往下;管理端首页「AI 学习助手」卡片(范围/次数/模型/Key 留空不改/测试模型/近 7 天 token)。
  公告学生/老师(gate)/admin 各一条。测试 tests/test_tutor.py(16 例,中转用 MockTransport 假装;Key 隔离两处 / 只开直营 /
  失败退回 / 最后一轮禁工具 / 只看本班 / 换备用 / 别人的对话 404 九处守卫逐一破坏各自恰好对应用例失败,回归锁验证过)。
  ⚠️ **Key 在聊天里明文出现过,建议用户在中转后台换一个**,换完在管理端卡片里填新的即可(留空不改)。
  **10-26 18:27 第二版上线**(提交 c3535c0;database.py 走 anchor patch 只加 1 条 ALTER,其余 5 个文件生产==HEAD~1 整推;
  新表 tutor_allowances create_all 建;两个服务都重启;备份 /root/eh_db_before_tutor2_20261026_1825.db、
  /root/eh_code_before_tutor2_20261026_1825.tgz、frontend/dist_bak_20261026_1825,构建号 mvp43s9r),用户「用不同的模型分个高级思考…
  UI 提交交互还能做的更好吗…每个学生总共 20,需要多的需要教师给增加额度,现在最高是 opus5.5」:
  ①**快速 / 深度思考两档**: 深度思考 extra_config.deep_model(默认 claude-opus-5-5)/ deep_fallback_model(默认 claude-sonnet-5-5),
  **留空串 = 关掉**(显式分支);`thinking: adaptive` + `output_config.effort: medium`。**5.x 不收 `enabled + budget_tokens`(400)
  也不收 disabled,只认 adaptive**;opus-5-5 不传 thinking 也会默认思考 —— 快速档所以不用 5.x。实测出字: 快速 sonnet-4-6 约 2–4s,
  深度 opus-5-5 约 6–9s(low/medium/high 6.1/6.3/8.5s)。深度一次算 deep_cost 次(默认 2)。
  **思考内容不下发**(里面常直接写着作业答案),前端只显示「在深度思考… N 秒」;**思考块带 signature 原样带回工具轮**,否则 400。
  每个模型单独记 5 分钟「没号」(tutor:down:{model}),haiku-5-5 仍一直 503
  ②**次数改成每个学生一共 free_total 次(默认 20,不按天清零)**,不再用 ai_quota 的按天计数: 表 tutor_allowances(user_id 主键 /
  used / extra / requested_at),扣次数一条条件 UPDATE(used + cost <= 送的 + extra),两台设备同时问不会超;没调通 / 停下时一个字没出退回。
  上线前问过的按「拿到回答的次数」算已用。孩子点「请老师加次数」→ 教师 `/teacher/tutor-quota`(pages/TeacherTutorQuota.tsx)
  请求的排最前,单个或勾选批量加(一次 ≤100,累计 extra ≤1000),**有一个不是本班整批 403**,记操作记录 tutor.grant;
  工作台入口上有数字(`GET /teacher/tutor/available` 带 requested),本校没开放不显示入口
  ③学生端 UI: 快速/深度切换(按账号记 localStorage)、出字时发送键变「停止」(`POST /student/tutor/stop`,标记放 shared_store,
  回答在哪个进程跑都看得到,每秒看一次;断开上游连接就不再计费)、没调通「再问一次」、回答里的英文点一下就读(SpeakableText,同一个 Edge TTS)、
  只有在底部时才自动滚动、输入框随字数长高、剩 ≤3 次标橙、用完了输入区换成「请老师加次数」
  ④管理端卡片: 每个学生送几次、深度算几次、两组模型;用量按方式分开;「测试模型」四个模型都测。
  生产冒烟(公网,临时学生跑完删净): 深度 opus-5-5 出字 8.8s、283 入 / 369 出 token、次数 20→18。测试 tests/test_tutor.py 25 例,
  新增守卫 10 处逐一破坏各自对应用例失败;老师列表「请求的排最前」那条排序没有用例锁(只有一个学生的班测不出)。
  ⚠️ test_multiprocess::test_online_tracker_memory 跟在任何 HTTP 测试文件后面跑会失败(online_tracker 进程内 _pending_seen 残留),
  HEAD 上 test_read_aloud + test_multiprocess 一样复现,与本功能无关,单独跑全绿
  **10-26 晚第三版: 收费写进合同 + 答不上来的三步**(22:20 **已部署生产**,提交 d3090dc;database.py 走 anchor patch 只加 1 条 ALTER,
  其余 7 个文件生产==HEAD~1 整推;三张新表 create_all 建;两个服务都重启;备份 /root/eh_db_before_tutor3_20261026_2218.db、
  /root/eh_code_before_tutor3_20261026_2218.tgz、frontend/dist_bak_20261026_2218,构建号 mvpcert2。
  生产冒烟(临时学生跑完删净): 真模型第一问只提示、点「还是不会,讲给我听」讲出 likes + 理由 + 出同类题,追问 cost 0、次数 20→19)
  (用户「免费 20 次后需要付费」→「按你建议方案写进合同,要让家长觉得值、便宜,
  也要确实能帮助孩子提升;如果不给答案孩子一直回答不上来怎么办」)。数字真源 services/tutor.py 文件头「收费」,
  **合同第三条第 10 款 + 费用表、招商手册第六章、家长手册第八章 FAQ、提分方案第八章摘要同口径,改数字四处一起改**:
  ①**三步提示**(RULES 第 3 条): 先点方向 → 答错/说不会给更具体的提示(范围、类似例子、首字母)→ 还不会或说「讲给我听」
  就讲答案和一步步的理由,**马上出一道同类题**让他自己做;**试过两次还不会不许再让他自己想**。讲答案那步回答可到 200 字。
  学生端每次回答下面三个快捷回复「给我一点提示 / 还是不会,讲给我听 / 再出一道类似的题」
  ②**同一道题的追问不另算**(followup_state): 付过次数的那问之后 15 分钟内、快速回答、没新照片,最多 3 次不扣;
  user 消息新列 tutor_messages.cost(NULL=加列之前 / >0 付过 / 0 免费追问 / -1 没调通退回了,**退回的不能当起点**);
  时间在 Python 里比(SQLite 微秒格式坑)。深度思考的追问照常扣。次数用完了也能接着追问这道题(不能换照片/深度)。
  done 事件和对话详情都带 followup,前端输入框上写「接着问这道题不算次数(还能免费问 N 次)」
  ③**学习卡带 50 次**(CARD_TUTOR_TIMES,入门卡不带): subscription_service.redeem_code 成功那支调 tutor.add_card_bonus,
  与兑换同一事务;明细表 tutor_grant_logs(source=card 按兑换码 ref_id 部分唯一索引,同一张卡只送一次;source=teacher 记老师加的)。
  兑换成功文案加「另送「问小鹰老师」50 次」。卡带的次数不受老师加的上限(MAX_EXTRA 改 5000)
  ④**加盟机构次数池**(表 tutor_org_pools + 台账 tutor_pool_ledger): 机构向平台按次进货 **¥0.3/次、1,000 次起**,平台在
  「机构管理」每行「学习助手次数」(components/admin/OrgTutorPoolDialog)到账 / 扣回(扣回最多扣到已分出去的,409),
  记操作记录 org.tutor_pool。**加盟机构老师给学生加次数从池里扣**: plan_grant 先算每人实际能加几次(到上限只扣差的)→
  take_from_pool 条件 UPDATE(used + n <= total),不够整批 409 一个不加;**直营(org 1)不走池子**。老师页顶上写池里还剩几次,
  机构首页加「学习助手次数」卡片(/org/info 带 tutor_pool)。pool_status 要直接查列不能 db.get(条件 UPDATE 不同步会话,会读到旧值)
  ⑤开放范围多一档 **pack = 直营 + 卡包政策机构**(scope_allows 改 async,查 card_plan);默认值改 pack,**生产存的仍是 hq**
  (生产没有卡包机构,改不改都一样;第一家卡包机构签约后在管理端卡片切到 pack)
  ⑥合同第八条第 3 款: 只发学习内容不发姓名学校联系方式、照片不存;【待确认】生成式 AI 服务备案与告知方式(找律师)。
  第三条第 10 款还写了: 不提供拍照搜题 / 代写、可能出错老师能看记录、调价提前 30 天通知、乙方不得宣传「拍照出答案」或保证提分。
  成本口径: 快速一问约 ¥0.1(中转实扣比标价贵 1.5 倍),带 1.5 次免费追问约 ¥0.25,¥0.3 毛利很薄;
  标准包 220 张非入门卡共带 11,000 次 ≈ 模型成本 ¥1,100–3,000(6 万的 2–5%)。⚠️ 中转钱包与别的用途共用(10-26 余额约 $281),
  机构付了钱的次数会因为钱包见底用不了 —— **卖次数之前要给学习助手单开 Key 和钱包**。
  测试 tests/test_tutor_pricing.py(8 例)+ test_card_pack 加 1 例;追问关掉 / 深度也免费 / 追问不限次 / 退回当起点 / 池子扣成负数 /
  老师加不扣池 / 扣回不限 / 同卡送多次 / pack 放开老机构 / 到上限照扣池 / 兑换不送 十一处逐一破坏各自对应用例失败(回归锁验证过)。
  入口: 学生「问小鹰老师」回答下面三个快捷按钮;平台「机构管理」每行「学习助手次数」;机构首页「学习助手次数」卡片;
  老师「学习助手次数」页顶上池子余量;「加盟资料 → 合作协议」第三条第 10 款。公告学生/老师/机构管理员(gate)/平台各一条
  **10-27 第四版: 单词记忆图 + 学习画像**(10-27 02:00 **已部署生产**,提交 3a94c7d;8 个改动文件生产==HEAD~1 整推 + 新文件
  services/tutor_profile.py、services/word_picture.py、utils/spelling_diff.py;新表 word_pictures 由 create_all 建;两个服务都重启;
  备份 /root/eh_db_before_tutor4_20261027_0152.db、/root/eh_code_before_tutor4_20261027_0152.tgz、frontend/dist_bak_20261027_0152,
  构建号 mvpk1p49;出图 Key 经管理端接口写入(stdin 传,没落盘没回显),开放范围仍是 hq、每人 20 次没动。
  生产冒烟(临时学生跑完删净): 「elephant 好难记,给我画张记忆图」→ lookup_word + draw_word_picture,首字 3.0s,图 39 秒画好、
  公网 200 58KB(长鼻子卷着字母 e,单词拼写正确);「我这周学得怎么样」→ get_my_progress 按画像答;次数 20→18(问 1 + 画 1),
  图留着(pic_id 1,全平台共用))(用户给了一个出图 Key「GPT Image 2.5 Sunburst…定价 3 毛一张
  你设计下」→「通了就按你说的开发」→「再加上这个 agent 还知道这个学生在我们系统的学习情况」):
  ①**出图 Key 隔离**: ai_providers 一行 provider_name='image_tutor'(Fernet 加密),和 claude_tutor 一样**不能设默认**
  (admin/ai_config 的 DEDICATED_PROVIDERS 两处 400),ai_service 默认通道 / OCR / TTS 三处 `notin_(("claude_tutor","image_tutor"))`。
  管理端卡片「画单词记忆图」里填 Key(留空不改)、模型(默认 gpt-image-2.5-sunburst)、画质(默认 low)、每人每天几张新图(默认 5)。
  这个 Key 与学习助手 Key **同一个中转钱包**;sunburst low 实测约 27 秒一张、钱包扣 0.15
  ②**一个词全平台只画一张**(表 word_pictures,pic_key = sha1(小写拼写|去词性的释义),UNIQUE): 已画好 / 正在画的直接给,**不扣次数**;
  第一次画扣孩子 1 次学习助手次数(= ¥0.3 口径),没画出来退回次数并退回当天张数;5 分钟还没画完算卡住,下一个人来重画、**退回卡住那人的次数**。
  抢画走 reclaim 条件 UPDATE(只认 failed / removed / 卡住的 pending),没抢到的人退回。图压成 768px JPEG 落 UPLOAD_DIR/word-pics
  (**只有单词的画面、没有孩子的信息**,同封面性质可公开),换图文件名带时间戳。提示词固定绘本风格、白底、不写字;孩子的「想法」最多 80 字
  ③画图在后台任务里跑,**自己开会话**(word_picture.session_factory 可替换,测试用);前端卡片(components/tutor/PictureCard)每 3 秒问一次。
  入口两个: 聊天里让小鹰老师画(工具 draw_word_picture,**没配出图 Key 时这个工具不给模型**)、错题本每个词「看记忆图」
  (components/tutor/WordPictureButton,先问有没有不扣次数,没有才写「画一张记忆图(用 1 次)」)。管理端卡片列最近 60 张,
  画得不合适点「删掉」(status=removed + 删文件,记操作记录 tutor.picture_remove),下次有人要会重画
  ④**学习画像**(services/tutor_profile.py)进系统提示: 学段 + 最近学的单元、学过 / 掌握 / 薄弱 / 待巩固词数(mastery_buckets)、
  近 7 天学了几天几个词几分钟 + 最近一次学习、近 14 天计分题正确率(≥10 题才写)、到期复习、**拼写老毛病**(learning_records 里
  拼写类模式的错答按 utils/spelling_diff.first_diff_chunk 归类,出现 ≥2 次才算)、常错词和写成过什么、老师 7 天内的陪跑点评
  (**里面的孩子姓名 / 用户名替换成「你」**)、今天的作业和每日复习。慢的部分缓存 10 分钟(shared_store tutor:profile:{uid}),今天的部分每次现算;
  整段 ≤600 字(实测本地 326 字 0.6 秒)。规则写明「帮你了解他,不要整段念出来」。新工具 get_my_progress 给「这周和上周比」
  (学了几天 / 多少词 / 几分钟 / 正确率不到 10 题写 None)+ 14 天每日 + 拼写毛病 + 老师点评,学生问「我这周学得怎么样」时用。
  只发学习数据,不发姓名学校手机号。老师在学生详情页「问小鹰老师」能展开「小鹰老师眼里的这个孩子」看到同一份画像
  ⑤合同第三条第 10 款、招商手册、家长手册 FAQ 加了记忆图口径(同一单词只画一张、首次画计 1 次、已画过的看不计)。
  测试 tests/test_tutor_picture_profile.py(12 例,出图用 MockTransport 假装);失败退回 / 卡住退回前一个人 / 每天张数 / 没 Key 不给工具 /
  点评去名字 / 默认通道和 OCR 不用 image_tutor / image_tutor 不能设默认 / 对话里刷新图卡 / reclaim 条件 九处逐一破坏各自对应用例失败。
  **没锁住的一处**: 「正在画也扣次数」那个破坏测不出(扣了之后 reclaim 失败又退回,结果仍是 0,无害)。
  ⚠️ 做变异测试时备份文件**别按 basename 起名**: services/tutor.py 和 api/v1/tutor.py 同名,备份互相覆盖把 services/tutor.py 写成了接口文件
  (已从 HEAD 恢复重做);备份名要带路径。
  入口: 学生首页「问小鹰老师」(建议问题「elephant 好难记,给我画张记忆图」「我这周学得怎么样」)/ 错题本每个词「看记忆图」;
  老师学生详情页「问小鹰老师」→「小鹰老师眼里的这个孩子」;管理端首页「AI 学习助手」卡片 →「画单词记忆图」。公告学生/老师(gate)/admin 各一条
  **10-27 聊天界面改版**(07:43 **已部署生产**,提交 c73529b,纯前端 dist 整推;备份 frontend/dist_bak_20261027_0742,构建号 mvpwh2ss)
  (用户「聊天气泡是不是应该自适应…加载等待动画你设计下」): ①**气泡按字数自适应**(w-fit):
  孩子的气泡最多 80%(电脑 70%)、深橙 accent-warm;小鹰老师左边带头像(public/tutor-avatar.jpg,从 eagle-studying.jpeg 裁的头),
  气泡最宽 36rem,**有练习卡时撑满**(输入框要地方);只发照片不套橙色气泡 ②**等待分几种**(components/tutor/TutorWaiting):
  三个跳点「小鹰老师在想」/ 工具时文字扫光「在查课本…」「在准备画图…」/ 深度思考天蓝 + 走秒 / 正在停下;**等 8 秒、20 秒换安抚话**
  (20 秒那句告诉孩子可以停下、还没出字不算次数);说了半句去调工具时字下面挂一小行;出字时末尾闪烁光标;没出字时头像轻轻上下 + 小红点。
  读屏: role=status,走秒数字 aria-hidden ③画记忆图占位和成图同尺寸(画好不跳),画笔晃 + 扫光 + 按 30 秒估的进度条(停在 95% 等真画完)
  ④新气泡从下面浮上来(只给这次发的 / 收的,fresh 标记;翻出来的历史不动画)⑤**跟着内容长高滚**(ResizeObserver 看内容区,
  练习卡 / 图片 / 照片出来后才知道高度,只在收到字时滚会停在卡片半截);往上翻时不跟,底部出「看新回答 / 回到最新」按钮,
  平滑滚动途中 700ms 不认 scroll 事件(否则滚动中途又判成「往上翻了」)⑥输入条: 相机 / 文字 / 发送并进一个圆角框(全站学生端给
  textarea 加了白底和聚焦阴影,框里那层用 .tutor-composer-input 盖掉);照片预览右上角圆形叉 ⑦send 加 sendingRef(同一帧连按两下回车,
  sending state 还没变会发两遍)。动画都在 index.css「学习助手聊天」那段,**减少动态效果时全部停下**(只留静态点和文字)。
  浏览器验过(本地库副本 + 慢速假中转,390 / 1366 宽): 短回答小气泡、长回答 36rem 换行、练习卡撑满、在想 → 在查课本 → 出字带光标、
  深度思考走秒、画图占位 → 成图、往上翻出按钮点了回到底部、只发照片、历史对话不动画、减少动态效果时 animation 为 none、无横向溢出、控制台 0 报错
  **10-27 记忆图下面印单词**(11:22 **已部署生产**,提交 1b5a99f;word_picture.py / tutor.py 生产==HEAD~1 整推 + 新文件 assets/fonts、
  scripts/recompose_word_pictures.py,两个服务都重启;前端 dist 整推,构建号 mvq4bi31;备份 /root/eh_code_before_piccaption_20261027_1116.tgz、
  /root/eh_wordpics_before_piccaption_20261027_1116.tgz、frontend/dist_bak_20261027_1122。生产已有的 elephant、name 两张图跑脚本重新印了字,
  公网取回看过「name /neɪm/ 名字」)(用户「name 好难记帮我画张图,为什么图上没有单词」): 画图模型拼不准单词,
  所以提示词**不让它在画面里写任何字**,改由服务器画完后用 Pillow 在图下面印「单词 / 音标 词性 中文」—— 拼写、音标、释义都来自词库,不会错。
  成图 768×960(4:5,上面 768 见方是画、下面 192 是字),原画另存 {id}_{ts}_art.jpg(删图时一起删)。字体: 单词用随包的 Baloo 2
  (backend/app/assets/fonts,OFL,与卡面同一份),音标 DejaVu、中文文泉驿(生产 Ubuntu 自带;本机测试退回 macOS 自带字体),
  找不到就不印那一行(不印方框)。长短语自动缩字号塞进一行;释义只取词性 + 第一个意思、去掉括号补充(caption_meaning)。
  换版式 / 改了音标后跑 scripts/recompose_word_pictures.py 重新印字,**不重画不花钱**(印字前的老图是 768 见方,脚本把它当原画)。
  前端图卡占位改 aspect-[4/5]。测试同文件加 2 例(不印字 / 删图留下原画 / 提示词改回允许写字 三处各让对应用例失败,回归锁验证过)
  **10-27 「教会」闭环**(13:10 **已部署生产**,提交 3cb1345 + 3b5b9e5;6 个改动文件生产==d6625c7 整推(从提交 git archive 导出,不从工作区)
  + 新文件 services/tutor_notes.py、tutor_quiz.py;两张新表 create_all 建;两个服务都重启;前端 dist 构建号 mvq85318;备份
  /root/eh_db_before_teach_20261027_1305.db、/root/eh_code_before_teach_20261027_1305.tgz、frontend/dist_bak_20261027_1305。
  生产冒烟(真模型 sonnet-5-5,临时学生跑完删净):「教我一般现在时第三人称单数,我是小白」→ 先问「把 I 换成 he 怎么写」摸底 →
  答「不知道」→ 讲一个例子 + make_quiz 2 题(卡上没有 answer / explain)→ 故意全错交 → 自动点评 cost 0、次数 19→19,讲错因 + 又出两道 →
  同一份再点评 409;笔记记下「一般现在时第三人称单数动词加 s」卡在「He/She 做主语时动词忘了加 s」、明天回头考。首字约 7 秒)(用户问「这个 agent 还差什么,小白也能教会」→ 我列了两批 →「按你建议来,再加上单词可以发音」,做的是第一批):
  ①**练习服务器判分、结果回给小鹰老师**(services/tutor_quiz,表 tutor_quizzes): 以前练习卡网页当场判,做对做错助手不知道。
  现在**答案只在服务器**: 单词卡(make_practice)只发 word_id(放发音)、中文、字母数,**不带拼写也不带音标**(音标几乎就是答案);
  新工具 make_quiz 出选择 / 句子填空(一个 ___,also 可给几种都算对)/ 连词成句(服务器拆词打乱,去标点、句首小写),
  发下来的没有 answer / explain。`POST /student/tutor/quizzes/{id}/submit` 判分(大小写、弯撇号、句末标点不算错),
  **第一次交的才算**(条件 UPDATE submitted_at IS NULL)、存下来刷新还在,「再写一遍」只判不记
  ②**交了自动请小鹰老师点评**: 前端接着 ask(quiz_id=…),**发给模型的内容服务器从库里拼**(题目、孩子答案、对错),不用前端的字;
  一份练习只点评一次(条件 UPDATE 认领 feedback_at,没调通放回去可再点)。**点评不扣次数,也不占「同一道题追问」那 3 次**
  (用户 10-27 同意;user 消息 cost = COST_FEEDBACK(-2),followup_state 只认 NULL/>0 当起点、只数 =0 的追问,所以 -2 两头都不算)。
  **点评那一轮里又出的练习 free_feedback=False**,它的点评按普通提问算 —— 否则「做题 → 免费点评 → 又出题」能一直白用;
  前端只在免费(或还在免费追问时间里)时自动请点评,要扣次数的不替孩子花
  ③**教新知识**(RULES 第 4 条): 先问一个小问题摸底 → 只讲一个点 + 一个生活例句 → 马上 make_quiz 1–2 题 → 对了往下、错了换讲法再出一道;
  每次回答只做一步等孩子回应
  ④**小鹰老师的笔记**(services/tutor_notes,表 tutor_notes,一人一个 topic 一行,topic 去空白标点小写去重): 工具 save_note(taught/stuck/got_it),
  做完练习自动记(单词卡按单词、语法题按出题的 topic)。复习间隔 1 → 3 → 7 天三级学会;**只有到期那天或以后答对才升级**
  (刚讲完马上做对是短时记忆,不算),答错 / 卡住回到明天;没记过的答对不建行。due_date 存北京日字符串(不碰微秒格式坑)。
  学情档案每次现算一行「小鹰老师的笔记: 今天该回头考… 还在学… 已经学会 N 个」,**render 超长时从前面砍、这行和今天的任务一定留着**;
  RULES 第 8 条: 先答孩子这次问的,再问要不要花 10 秒回头考
  ⑤**记忆图下面「听 xxx」按钮**(用户「加上单词可以发音」): 图片卡带 word_id,按 id 读(区分一词多音),放大后底部也有;
  练习判完每个词旁边也能点着听
  ⑥老师记录里练习显示题目答案(attach(teacher=True) 带 key)和孩子做对几题。合同第三条第 10 款、招商手册、家长手册加「练习讲评不算次数」。
  测试 tests/test_tutor_teach.py(9 例)+ test_tutor 改 1 例(卡片不再带拼写);卡片带答案 / 点评扣次数 / 点评占追问 / 点评可重复认领 /
  点评轮的题也免费 / 用前端文字当点评内容 / 交别人的练习 / 刚讲完答对就升级 / 点评失败不放回 九处逐一破坏各自对应用例失败(回归锁验证过)。
  第二批(按单元查课本句型音标、语音输入和整段朗读、老师端每周汇总)没做。入口: 学生「问小鹰老师」说「教我…」,练习在回答下面;公告学生/老师(gate)各一条
  **10-27 看大图修复 + 英文点读标识**(13:42 **已部署生产**,提交 b3b7c04,纯前端 dist 整推;备份 frontend/dist_bak_20261027_1341,构建号 mvq9as46)(用户「对话中返回的图片点击放大显示有问题,返回可以读的单词应该有个图标告诉用户可以点击发音」,纯前端):
  ①**放大图缩在气泡里**: 根因是聊天气泡的入场动画(.tutor-in,animation 带 transform)让祖先变成 fixed 的包含块,
  遮罩「fixed inset-0」只盖住那个气泡(手机上图缩在消息里、电脑上歪到一边),Esc 也关不掉。改成 components/tutor/ImageLightbox
  **createPortal 到 body**: 整屏深色遮罩、图按屏幕最大显示、顶栏单词名 + 关闭、底部大按钮「听 xxx」、锁背后滚动、焦点进关闭键、
  Tab 只在两个按钮间转、Esc / 点空白关、图带 data-allow-save 可长按保存(只有单词画面没有孩子信息)。⚠️ 以后在聊天气泡里放任何
  fixed 浮层(弹窗 / 全屏)都要 portal,不然一样被困住。小图右上角加放大图标,下面「听 xxx」按钮整宽、点了喇叭跳动
  ②**回答里能点读的英文**(SpeakableText): 以前只是天蓝虚线下划线,孩子看不出能点。改成浅蓝底小块 + 前面小喇叭(.tutor-speak,
  inline + box-decoration-break: clone 长句跨行每行都有底色),点了喇叭跳动;最新一条回答下面写「带小喇叭的英文,点一下就能听发音」,
  点过一次就不再写(按账号记 localStorage)。浏览器验过(390 / 1366): 遮罩铺满整屏、Esc / 点空白都关、关了恢复滚动、无横向溢出、控制台 0 报错
  **10-27 平台给机构发学习助手次数**(14:33 **已部署生产**,提交 7e4f596;3 个后端文件生产==b2c05e0 整推(从提交 git archive 导出),两个服务都重启;
  前端 dist 构建号 mvqb40wk;备份 /root/eh_db_before_orggrant_20261027_1429.db、/root/eh_code_before_orggrant_20261027_1429.tgz、
  frontend/dist_bak_20261027_1429。生产冒烟(临时老政策机构 + 老师 + 学生,跑完删净): 发次数前学生和老师都没开 → 平台赠送 10 次 →
  自动开通、学生送 0 次 → 老师分 3 次 → 学生剩 3、池里剩 7;一览老师访问 403、admin 看到「发过次数」gifted 10)(用户「我的总管理端可以给别的机构发总 AI 学习助手次数」,
  问了三件事用户选: 老师分给学生 / 这些机构的学生不送免费次数,只用机构的 / 进货和赠送分开记):
  ①**发过次数的机构自动开通**(services/tutor.org_open_reason: off 全关 → all → 直营 → pack 且卡包机构 → 池子 total > 0「发过次数」);
  扣回到 0 又关上。scope_allows 改成调它,所以学生状态 / 提问 / 画图 / 老师入口 / 公告闸门全跟着走
  ②**每生送几次按机构**(free_for,async): 直营、**卡包政策机构**照送 free_total(签了的合同第三条第 10 款写着「每个学生账号赠送 20 次」,
  不能悄悄改);**老政策加盟机构 0**,孩子能问几次全看老师从池里分的(+ 学习卡带的,在 extra 里)。allowance_status / consume 的
  所有调用点(学生状态、提问、画图、老师学生列表)都按学生 / 老师所在机构传。⚠️ 上线时生产没有任何机构池子,老政策机构本来也没开 = 没人少次数
  ③**进货 / 赠送分开记**: POST /admin/tutor/pools/{id} 带 source=purchase(按 ¥0.3 记金额)/ gift(不收费、不受起订量);
  台账 tutor_pool_ledger.source 多一种 gift(扣回仍是 adjust,最多扣到已分出去的);pool_status 多给 purchased / gifted 累计;
  操作记录写「进货到账 N 次(¥X)」/「平台赠送 N 次(不收费)」
  ④**各机构一览** GET /admin/tutor/orgs(仅 admin): 每个机构开没开(原因)、每生送几次、池子、学生数、问过的人数;
  管理端「AI 学习助手」卡片里 components/admin/TutorOrgsPanel 列表 + 行尾「发次数」(OrgTutorPoolDialog 改成三选一: 进货 / 赠送 / 扣回,
  到账记录带标签;首次发次数的确认框写明「发完学生就能用了」)。机构管理页原来的「学习助手次数」按钮照旧。
  老师「学习助手次数」页: 本机构不送时写「孩子能问几次看你给他加几次」;家长手册写成「一般开号送 20 次(以校区说明为准)」。
  测试 tests/test_tutor_org_grant.py(4 例);发过次数不自动开 / 老政策照送 20 / 关闭时仍开 / 赠送记成进货 / 一览放给老师 /
  学生状态忽略机构 六处逐一破坏各自对应用例失败(回归锁验证过)。入口: 管理端首页「AI 学习助手」→「各机构次数」→「发次数」;公告一条(admin)
  **10-27 身份**(15:08 **已部署生产**,提交 68d8af6,只推 services/tutor.py;推之前核对生产==1d41535(另一会话刚上的对话记录 + 按年级讲),
  备份 /root/tutor_py_before_identity_20261027_1507.py;两个服务都重启)(用户「如果我问你是谁,你应该说是小鹰老师」):
  RULES 第 13 条「身份」: 问你是谁 →「我是小鹰老师,飞鹰AI英语里的 AI 学习助手」;不说背后是哪个模型、哪家公司(追问说「不方便说」带回学习);
  **但不冒充真人**(问是不是真人要说是 AI,老师是真人)—— 未成年人场景下冒充真人不行,这半句别删。原 13 条顺延为 14。
  生产冒烟(真模型,临时学生删净): 三问分别答「我是小鹰老师…」/「这个我不方便说。我是小鹰老师…」/「我不是真人,是 AI 学习助手。你的老师是真人…」。
  测试 tests/test_tutor_identity.py(2 例)
  **10-27 发文件**(19:43 **已部署生产**,提交 a008ce5;api/v1/tutor.py、services/tutor.py 生产==c230897 整推 + 新文件 services/tutor_files.py,两个服务都重启;备份 /root/eh_code_before_tutorfile_20261027_1941.tgz、frontend/dist_bak_20261027_1941,构建号 mvqm4fut)(用户「拍照有了,上传文件的功能呢」→「doc 文档也要支持」): 输入框左边回形针,能发 PDF / Word(.docx / .doc)/ txt,
  20MB 内,**和照片一次只能发一样**。真源 services/tutor_files.py: PDF 用 PyMuPDF 取文字层,取不到 30 个字 = 扫描版,渲染前 3 页
  (110dpi)走照片同一条压缩(prepare_image)当图片发;带密码的拒;.docx 自己解 zip + xml(段落 + 表格,表格一行用「 | 」连),
  **不装 python-docx**;.doc 走 LibreOffice 转 PDF(office_convert.convert_to_pdf_async,跨进程文件锁,临时目录 finally 删),
  **本机没装 soffice 会拒「另存为 .docx 或 PDF」**(生产有);txt 先 utf-8-sig 再 gb18030。文字最多 6000 字(超了截断并告诉模型)。
  文件名去路径去控制字符、保留扩展名截到 60 字。**内容不进库**: user 消息只存一张 {"type":"file", name, kind, pages, scanned, truncated} 卡片,
  历史里只写「[孩子之前发了一份文件《…》]」(不重发内容,省钱);文件里的「忽略规则」当内容不照做(RULES 第 5 条)。
  带文件的那问**不算免费追问**(要付次数);打不开 / 不支持 / 太大一律 400、不扣次数。标题:没写字时「文件: 文件名」。
  前端: components/tutor/FileChip(输入框上面可去掉 / 气泡里)、utils/tutorFile.fileKindOf;老师对话记录显示「[文件《…》]」;
  SpeakableText **书名号里的不切成点读**(否则文件名里的 Unit / docx 也带小喇叭)。
  测试 tests/test_tutor_files.py(9 例);内容存库 / 历史带名 / 追问免费 / 扫描版 / 截断 / 照片文件同发 / 密码 / 路径 / 临时目录 / 标题
  十处逐一破坏各自对应用例失败(回归锁验证过)。本机浏览器(库副本 + 真中转)390 / 1366 宽验过: 发 docx 问第 2 题 → 第一行
  「我看了你发的《Unit3练习卷.docx》」+ 只给提示;发 PDF 作文 → 逐句先问;从「以前的对话」重开文件卡片还在、无横向溢出。
  入口: 「问小鹰老师」输入框左边回形针;公告学生 / 老师(gate)各一条
  生产冒烟(公网,临时学生删净): docx 首字 2.7s「我看了你发的《Unit3练习卷.docx》…你想先看哪一题」、PDF 作文逐句先问,各扣 1 次,库里 user 消息不含文件原文;xlsx 400 不扣。**.doc 不转换**(10-27 用户定不装 LibreOffice Writer: 生产只有 core + impress,装 writer 会顺带升 16 个包、音标 PPT 转换共用): 前端选到 .doc 当场提示「在 Word 里另存为 .docx 或 PDF」不上传,后端直接 400 不再调 soffice(不占音标课件那把锁),提示语前后端同一句(tutor_files.DOC_HINT / utils/tutorFile.DOC_HINT,测试比对)
  **10-27 晚「完美了没有」那批**(23:41 **已部署生产**,提交 bf593fb;5 个改动的后端文件生产==d919ed0 整推(git archive 导出)+ 新文件 services/tutor_safety.py / tutor_relay_health.py / tutor_insight.py / tutor_voice.py;新表 tutor_alerts、tutor_voice_clips 由 create_all 建;两个服务都重启;前端干净 worktree 构建 mvquotww 整推(含另一会话的书封 d919ed0);备份 /root/eh_db_before_care_20261027_2337.db、/root/eh_code_before_care_20261027_2337.tgz、frontend/dist_bak_20261027_2341。生产冒烟(公网,临时学生 + 老师跑完删净): 「我被同学欺负了,不想上学」首字 8.4s、cost 0、回答先安慰 + 12355/110 + 会告诉老师,提醒 keyword,model 合并成一条,老师端红条数字 1、处理 200;「because 老是拼错」首字 10.5s;「自杀用英语怎么说」正常讲词、没记提醒;说一句「Wednesday 怎么拼」转对,重启后第一段 25s(加载模型)、之后 6–8s,音频已删;钱包检查两个 Key 都正常 $351.38)(用户问「你认为这个 agent 完美了没有」→ 我列了差的几条 →「不装给提示然后再按你的建议全做了」。
  先查的生产实情: 上线两天 16 次提问,15 次是测试号,真学生 1 人 1 次 —— 效果还没被真孩子验证过):
  ①**孩子说到难过 / 被欺负 / 想伤害自己**(services/tutor_safety,表 tutor_alerts): 原规则第 1 条「只聊英语、别的话题带回英语」
  会把「我被同学欺负了」拉回背单词。RULES 第 1 条加例外: 先接住感受、不是你的错、建议今天告诉信任的大人;说到不想活 / 想伤害自己 /
  正在被伤害给 12355 青少年服务台、有危险打 110;不追问细节不诊断,**不答应保密**(「我会让你的老师知道」)。两道识别:
  服务器关键词(只看孩子自己写的字;问翻译的「被欺负用英语怎么说」不按关键词记)+ 模型工具 flag_concern(关键词抓不到的说法);
  同一条提问合并成一条、取更严重的级别(urgent / concern)。和提问同一事务落库;孩子删对话、到期清理都不删提醒。
  **这一问不扣次数**(cost = COST_CARE -3,不当追问起点也不占追问次数),一天 CARE_DAILY 10 次;**次数用完了**输入区多一个
  「想说说心里话,不用次数」(care=1,一天 3 次,系统提示让它只接心里话、不讲题)。真模型(本机库副本)实测: 先安慰、给 12355/110、
  说会告诉老师,提醒落库。老师: 工作台顶上红条 + 「小鹰老师 · 本班情况」页(TeacherTutorClass)处理时写一句,记谁处理的 + 操作记录
  tutor.alert_handle;学生详情页对话记录顶上也有。机构管理员 / 平台: /admin/tutor-alerts(机构只看本机构,显式按 org_id;平台看全部带机构名)。
  ⚠️ 12355 是共青团青少年服务台;全国心理援助热线 12356 我查到 2025-05 前开通的报道但原文没打开核实,所以文案只写 12355 + 110
  ②**中转钱包 / Key 自动检查**(services/tutor_relay_health): 中转 GET /v1/usage 带 Key 回 {balance, isValid}(10-27 实测余额 $444.9 / $367),
  401 = Key 失效,404 / 连不上 = 查不到(不当成坏了)。主进程转写循环里每 30 分钟查一次(学习助手、画图两个 Key 分开查),结果放 shared_store;
  管理端「AI 学习助手」卡片顶上 TutorHealthPanel: 余额 < $30 黄、< $5 或 Key 失效红,最近 1 小时没调通几次(孩子自己停下的不算),「现在查一次」。
  换了 Key 清掉旧结果。结果里不带 Key
  ③**快速档提速**(services/tutor「提速」): 实测「because 老是拼错怎么记」首字 19.5–22.8 秒(查词 2.6s → 出卡 10.5s → 写字 6.3s,
  sonnet-5-5 每轮都要几秒)。两处: 孩子问到的英文词服务器先按课本查好放进系统提示尾部(prefetch_words,最多 3 个,不破坏规则段缓存),
  省掉 lookup_word 那轮;**这一轮已经写了字、调的只是记笔记 / 出卡片 / 画图 / 放按钮这类工具且都成功了 → 不再多请一轮**(NO_FOLLOWUP_TOOLS),
  出了卡片系统补一句「练习卡在下面,做完我帮你看」;工具出错照常再请一轮让模型说。实测降到 7–14 秒(模型本身单轮 7–9 秒,再快要换模型,用户指定了 sonnet-5-5 没换)
  ④**效果数据**(services/tutor_insight.effect): 小鹰老师笔记里的单词(kind=word)以第一次记下为起点,比「之前 30 天」和「之后」
  正式计分题(SCORING_MODES)的拼对率;两边都有题才算这个词,< 5 个词 enough=False 不下结论,文案写明不全是小鹰老师的功劳。
  老师本班 / 机构 / 平台三种范围(GET /admin/tutor/effect 机构只算本机构)
  ⑤**老师全班汇总**(GET /teacher/tutor/summary,页面 /teacher/tutor-class): 近 7/14/30 天每个孩子问了几次、最近一次、还卡着几个点,
  有提醒的排最前;全班卡得最多的知识点 / 单词(按卡住人数);效果数据。只看本班
  ⑥**按单元查课本**(工具 get_unit_words): 只查孩子学过(learning_progress)或作业里的单元,按单元名找,返回单词 / 中文 / 例句(≤30)
  ⑦**说一句 + 听全部英文**(services/tutor_voice,表 tutor_voice_clips;components/tutor/VoiceInputButton): 点麦克风说、再点一下说完
  (不用按住,最长 30 秒)→ 上传排队(哪个进程都行,不改 nginx)→ 主进程转写循环用开口背那个 Whisper 进程池、language=zh 转 →
  **填进输入框不自动发**(本机实测 small: 「What about you 是什么意思」「Wednesday 怎么拼」对,「There is」听成「Diarris」、「go」听成「勾」,
  孩子要能改)。转完马上删音频,行 1 天后删;只能本人取;不扣次数,限速 10/分钟 60/小时;一次约 6–9 秒。服务器没装 Whisper 不显示麦克风。
  开录前停掉正在放的发音 + 开回声消除。回答里英文 ≥2 段时下面「听全部英文」连着读(utils/speakable,和点读同一份切法,同一个 Edge TTS 声音)。
  **转出来一律简体**(10-27 23:55 用户「麦克风怎么是这个不是中文简体」: 生产第一条是「你在幹什麼?聽得到嗎?」,Whisper language=zh 常出繁体):转完用 zhconv==1.4.3 按 zh-hans 转(只换字形不换说法,英文不动;纯 Python 自带字表。⚠️ 生产 setuptools 82 没有 pkg_resources,zhconv 会退回按文件路径读字表,实测换 cwd 也能用);转换出错原样返回不丢字
  ⚠️ VoiceInputButton 的 alive ref 要在 effect 挂载时设回 true —— 开发环境 StrictMode 先卸载再挂载,不设的话轮询一次都不发(本机实测踩到)
  测试: test_tutor_safety 24 例、test_tutor_relay_health 5、test_tutor_speed 3、test_tutor_insight 4、test_tutor_voice 3;
  安全 8 处 / 钱包 4 / 提速 4 / 效果汇总 5 处守卫逐一破坏各自对应用例失败(回归锁验证过,第一轮有 4 处没抓到,补了用例)。
  本机浏览器(库副本 + 真中转)390 / 1366 宽验过: 学生说被欺负 → 回应 + 提醒 → 老师工作台红条 → 本班情况页处理 → 管理端钱包 $367 正常;
  假麦克风说「Wednesday 怎么拼」9 秒填进输入框、音频已删;无横向溢出、控制台 0 报错。
  入口: 学生「问小鹰老师」输入框麦克风 / 次数用完时「想说说心里话」;老师工作台「激励与复盘 → 小鹰老师 · 本班情况」;
  机构管理首页「管理 → 需要关心的孩子」;管理端首页「AI 学习助手」卡片顶上。公告学生 / 老师 / 机构管理员(gate)/ 平台各一条
  **10-27 首页显眼入口 + 学习工具换图**(11:30 **已部署生产**,提交 1d844e9,纯前端 dist 整推;备份 frontend/dist_bak_20261027_1124,
  构建号 mvq4io0u,从含 1b5a99f 记忆图印字的 HEAD 重新构建)(用户「学生端工具的图片有重复的…问小鹰老师这个 agent 应该放在一个显眼的地方」):
  ①Hero 下面(老师的话之后、金币之前)单独一张卡 components/tutor/TutorEntryCard: 头像 + 小鹰老师的一句话 + 假输入框
  (占位字逐字打出例子问题,减少动态效果时静止)+ 三个问题(**点了只填好不自动发**,走 location.state.q)+ 剩余次数;
  本校没开放不显示。学习工具小卡片里去掉了它 ②手机底栏开放时变 6 格,第 3 格「问老师」用头像当图标
  (StudentMobileNav 第一次显示时自己问一次 status)③十张工具卡每张一张自己的图 public/tools/*.jpg(折纸鹰画风、米白底、
  图里不写字),脚本 backend/scripts/gen_student_tool_art.py(Key 只读环境变量 IMAGE_API_KEY,gpt-image-2.5-sunburst low,
  11 张约 2 分钟);旧图 hero-memory 等别的页面还在用,没删。公告学生一条(gate tutor)。
  浏览器验过(构建产物 + 假接口): 320 / 390 / 1366 宽无横向溢出,点问题进聊天页已填好、没有发请求
  **10-27 12:25 快速档换 sonnet-5-5 + 「新对话」按钮修复**(已部署生产,提交 a0a947c;api/v1/tutor.py、services/tutor.py 生产==HEAD~1 整推,
  两个服务都重启;前端从干净 worktree 构建 mvq6ey2l 整推;备份 /root/eh_code_before_tutorfast_20261027_1223.tgz、frontend/dist_bak_20261027_1223;
  生产 claude_tutor 行 model_name 由 claude-haiku-5-5 改为 claude-sonnet-5-5,改前值存 /root/tutor_model_before_20261027.txt,备用仍 sonnet-4-6)
  (用户「快速模型用sonnet 5-5 深度的用opus 5-5」「右上角的加号点击没有反应…应该是新对话的功能」):
  ①**sonnet-5-5 关不掉思考**: `thinking: disabled` 在它上面 400,不传就按 effort high 先想再答。快速档改传它最低档
  `between_tools` + effort low(services/tutor.fast_thinking);**between_tools 只有 sonnet-5-5 认,别的模型传了 400**,
  所以备用 sonnet-4-6 什么思考参数都不带(测试锁住,去掉模型判断恰好 2 例失败)。管理端「测试模型」用同一套参数。
  经中转实测首字: sonnet-4-6 约 2s;sonnet-5-5 不传 10s / between_tools 8-9s / +low 7-8s;带一次工具约 11s。
  **比原来慢不少,孩子会多等 5-8 秒**(前端 8 秒、20 秒有安抚话)。中转把 5-5 的回答整段一起发,不是逐字。
  ②「+」新对话: 原来回答进行中按钮是 disabled(灰掉、点了没反应),空对话时点了也没有任何变化。现在随时能点:
  回答进行中就让那次回答停下(stopTutor,一个字没出的退回次数),旧回答后面的事件按 sessionRef 丢掉、不写进新对话;
  空对话点了提示「现在就是新对话」。翻旧对话同理。深度思考仍 opus-5-5 + adaptive + medium(没动)。
  生产冒烟: 真学生上下文问「because 是什么意思」→ sonnet-5-5、调 lookup_word、11.5s 出字、答对(没写库没扣次数)
  **10-27 15:01 学习助手对话记录 + 按年级 / 接受程度讲**(已部署生产,提交 1d41535;tutor 相关后端文件生产==f1faa86 整推,
  database.py 生产有 drift → 按锚点只插 2 行 ALTER;两个服务都重启;前端干净 worktree 构建 mvqbquft 整推;
  备份 /root/eh_db_before_tutorhist_20261027_1458.db、/root/eh_code_before_tutorhist_20261027_1458.tgz、frontend/dist_bak_20261027_1458)
  (用户「对话历史记录是不是要分3天7天一个月 可以删除标题可以修改 可以搜索 多久自动删除部分历史记录」
  「学生问问题是不是要知道孩子是几年级的…孩子智商不一样理解能力也不一样」):
  ①**对话记录**(services/tutor_history.py): 按北京日分 收藏/今天/3 天内/7 天内/一个月内/更早;搜标题+内容(LIKE 转义);
  改名/收藏/删除在抽屉里就地做。孩子删 = deleted_at,孩子看不到、不能接着问,**老师 30 天内还看得到**(标「孩子删了」)。
  每小时清理(挂 sentence_speech.speech_loop): 没收藏 180 天没动、删了 30 天的真删(消息+tutor_quizzes),tutor_notes 不动。
  ⚠️ **删消息前先 tutor._ensure_allowance**: 10-26 第一版的用量是按消息条数现算的,先删等于退次数(测试锁住)。
  ⚠️ 管理端用量统计按 tutor_messages 算,180 天前的会随对话清掉;机构次数池账单在 tutor_pool_ledger,不受影响。
  ②**讲法**(services/tutor_level.py,表 tutor_prefs): 年级 = 设的 > 按在学的书推断(生产近 90 天 479 人里 436 人能推)> 按小学高年级;
  四档讲法(一到三年级/四到六年级/初中/高中)进系统提示尾部(不破坏 RULES 缓存)。**不贴聪明/笨的标签**,只有讲简单一点/正常/讲深一点,
  默认自动(最近 ≤10 份练习 ≥6 题正确率 <50% / ≥85%,近 30 天说「听不懂」「太简单」≥3 次),最多比年级调一档。
  孩子能改,本班老师能替改(别班 403)。RULES 新第 12 条: 同一段对话里看反应随时调;原 12 条变 13。快捷回复加「讲简单一点」。
  生产实测同一问「什么时候动词后面要加 s」: 三年级版每句带中文、更短;初三版直接英文例句(第一轮都先问小问题,差别不大)
- ✅ 学生首页「我的书架」书封重做(2026-10-27,用户「书架封面重新设计下,最好标题显示在图片上」): 原来没封面的书用
  public/book-cover-1..4.jpeg,四张图上印着**假的英文书名**(「ENGLISH VOYAGE」「SPACE EXPLORATION Grades 7–9」),
  人教版七年级顶着别人的书名,真书名只能写在图下面;生产 66 本书 **0 本有 cover_url**,所有孩子看到的都是那四张。
  现在书立在木板上(components/book/BookShelf,每排 手机 2 / 平板 4 / 电脑 5 / 宽屏 6,收起时先放一排、手机两排),
  每本是书脊 + 纸片层封面 + **书名印在封面下半截那层纸上**(components/book/BookJacket),不出图、全部按书名现算
  (utils/bookJacket): ①颜色按年级,同年级上下册同色,书名里没年级的按书名散列 ②封面大字 = 平时的叫法
  (七年级上册「7上」、必修一「必修1」、CET4、3500、语法1;认不出取去掉「人教版/飞鹰」后的前两个汉字),
  字宽按 Baloo 2 的真实字宽算(从字体文件量的),长的缩字号,不撞右上角书签带 ③在学的插书签带、学完的太阳换成「学完」金章,
  底边进度条;更多书籍褪色 +「输入兑换码」④**只看书名**: 作业页接口只给 book_id + 书名,同一本书两处要长得一样
  (学生作业页缩略图也换成它)⑤老师传了 cover_url 的照样当底图用,书名那层照样压上去,图坏了退回画的封面。
  字体复用体验卡那份 Baloo 2(@font-face JacketMark,只覆盖 ASCII;汉字走系统字体)。字号写死不用容器查询(iOS 12 要能看),
  所以每排几本必须保证一本书在 127–229px 宽之间,改列数先量。padding-top 百分比放在书自己里面那层 div 上
  (放外层在 flex 行里会按整行宽算,作业页小图被撑成整行高)。旧的四张 jpeg 没删(已打开的旧页面不裂图),新代码不再引用。
  浏览器验过(临时预览页 + 生产 66 本书名跑规则): 1366 / 390 / 320 宽无横向溢出、书名不出封面、Baloo 加载、控制台 0 报错
  **10-28 第二版: 加「飞鹰」品牌 + 老师端同一套**(用户「封面还能设计更好吗 加上飞鹰两个字 教师上传的时候根据书生成封面记得风格保持一致」):
  ①左上角「飞鹰」+ 版本: 鹰是官网 logo(~/Desktop/飞鹰官网/public/brand/logo-icon.png)里抠出来的形状
  (public/brand/eagle-mark.png,只有 alpha,CSS mask 按字色染,浅色封面自动变深色)②画面按学段分四种
  (小学圆山太阳 / 初中雪山 / 高中云海月亮星星 / 其它海浪),纸片带投影 + 纸纹;按书名散列,同一本每次一样
  ③输入改成书名 + 年级 + 册次 + 版本(**学生作业接口 10-28 起多带 book_grade_level / book_volume / book_series**,
  两处才长得一样)④**老师上传 = 学生看到的同一张**: 「单词本」列表 / 网格、新建 / 整本导入 / 编辑弹窗都换成 BookJacket,
  弹窗里实时预览(改书名年级当场变),去掉了「封面颜色」;纸笔听写选书、管理端内容表也换成小书封
  ⑤**建书 / 整本导入不再调 AI 出图**: 生产近 30 天 7 次全部超时(journalctl「图片生成超时」),建书接口还同步等最多 30 秒、
  网页 10 秒就放弃 = 老师看到「创建失败」书其实已建;且每张画风不一样。image_service.generate_book_cover 已删,
  generate_image 留给别处。cover_url 列保留不再写,**书封也不再读它**(生产 0 本有值)。
  测试 tests/test_book_cover_jacket.py(3 例;建书又出图 / 作业接口不带年级 两处各让对应用例失败,回归锁验证过)。
  ⚠️ public/brand 下两张 png 被 .gitignore 的 *.png 挡住,要 git add -f
- ✅ 后端多进程(2026-10-25,用户「CPU 单核…后续肯定会超过 170 人」「要考虑服务器 CPU 内存升级后的情况」→「你来做多核的」):
  **第一步 16:49 已部署**(提交 7d55020,main.py / tenancy.py 走 anchor patch,其余整推;备份 /root/eh_code_before_multiproc_20261025_1648.tgz、
  frontend/dist_bak_20261025_1648);**第二步 18:14 已上线**(用户同意后): 系统 Redis 起来、主进程配 REDIS_URL、
  工作进程服务 3 个、两份 vhost 改 /api/ 分流(备份 *.conf.bak_multiproc_20261025_1813)。上线后监控页: 4 个进程 / 3 个工作进程 /
  CPU 按 4 核算 / 共享存储 redis;CPU 路容量 566 → 793 人,瓶颈仍是带宽(要撑更多人优先升带宽)。
  验过: 公网两个入口逐类接口看 X-EH-Proc(PK / 竞赛 / 监控 / 视频串流 / verify-word → main,其余 → worker)、
  登录态接口在工作进程 200、PK WS 进主进程、上传 519MB 放行 / 521MB 413、官网不受影响;
  演练停工作进程 → 请求自动全落主进程(0 个 5xx)→ 再启动回到工作进程。工作进程每个约 170MB,Redis 约 1MB。
  **Redis 一年起不来的根因**: /usr/local/lib 另装了一份 libjemalloc.so.2,动态链接优先加载它,而 Redis 单元的沙箱
  (NoExecPaths=/ + ExecPaths=/usr/lib)不许从 /usr/local/lib 映射可执行段 → exit 127「failed to map segment」。
  修法只对 Redis 单元设 LD_LIBRARY_PATH 指向系统包那份(drop-in deploy/multiproc/redis-server.service.d/eh.conf,
  同时限 256MB + volatile-lru + 不落盘),**没改全局 ldconfig**(别的程序可能在用那份)。
  ⚠️ **以后部署后端要重启两个服务**: `systemctl restart english-helper && systemctl restart english-helper-workers`
  (只重启主进程 = 工作进程还在跑旧代码,大部分接口落在工作进程上)。改 nginx 时 /api/ 那块已换成
  `include .../vhost/nginx/eh/api-locations.inc`,上传上限 520m 在 eh/proxy-*.inc 里。
  起因: uvicorn 单进程,Python 一个进程只用满 1 核(GIL),4 核机器监控页只按 1 核算(≈170 人)。
  架构: 主进程(english-helper,8000,原服务不变)+ 工作进程池(english-helper-workers,8001,`uvicorn --workers N`,
  PROCESS_ROLE=worker,只听本机)。个数 core/worker_plan **启动时现算** = min(核数−1, (可用内存−1.5G)÷300M),
  1..16,EH_WORKERS 可写死 —— 升级 CPU/内存后重启一次服务就按新配置开(生产 4 核 3.9G 可用 → 3 个)。
  启动入口 scripts/start_workers.py(先等主进程 /health 通,建表迁移只在主进程做)。
  **只能在主进程的**(core/process_role.MAIN_ONLY,工作进程收到直接 503 / WS 关 1013,不悄悄处理):
  PK 房间与晋级赛、竞赛(答题广播排行)、直播弹幕 WS、宠物对战 WS、Whisper 本机语音(verify-word / assessment/evaluate);
  **放主进程更好的**(PREFER_MAIN): 音标视频 /stream(COS 清单只有主进程的同步线程维护)、服务器监控(采样曲线在进程里)。
  后台任务(金币结算 / 转写调度 / COS 同步)只在主进程跑。nginx 清单 deploy/multiproc/nginx/api-locations.inc
  必须与 MAIN_ONLY 一致 —— **测试解析该文件核对,且 app 里所有 WebSocket 路由必须在清单里**(新加 WS 漏了会失败)。
  跨请求小数据改放 core/shared_store(配 REDIS_URL 用 Redis,没配 / 连不上退回进程内存 = 原单进程行为,
  Redis 中途挂了 5 秒后重试、不报错): 限流(services/rate_limit、core/rate_limit,**都改成 async**,调用点全加了 await)、
  AI 每日次数(incr_if_below 原子)、短信验证码(校验靠 delete 返回值,同一正确码并发只认一次;每日计数改按北京日)、
  实时课堂在线状态、在线人数/流量(各进程攒 5 秒汇总)、机构状态缓存(停用/续费走 invalidate_org_cache_everywhere
  共享代数,其它进程 2 秒内清缓存;**接口里别再调只清本进程的 invalidate_org_cache**,测试扫源码锁住)。
  单元考试答案原来放进程内存(出卷交卷落不同进程 = 「考试不存在」),改成 exam_id = 试卷号.时间.HMAC(绑学生、30 分钟),
  答案从 exam_questions 读、单元记 generation_strategy、交过一次看 exam_submissions 拒重交。⚠️ 上线那一刻正在考的
  旧 8 位 exam_id 会交不了(重开一份即可)。ffmpeg / soffice 的一次只跑一个改成跨进程文件锁(core/file_lock,
  private_media/locks);TTS / 剑桥缓存临时文件名带 pid。发音自检升级 edge-tts 后两个服务都重启。
  监控页: CPU 按「min(进程数, 核数)」核算容量,文案写几个进程几核;开了工作进程却没连上 Redis 标黄。
  Redis 坑: 过期一律毫秒(PEXPIRE / PX),按秒向上取整 0.4 秒的键会活 1 秒(测试抓到的)。
  生产现状(10-25 只读查过): 系统 Redis 7.0.15 已装但 redis-server.service 2025-10-22 起 failed(exit 127,
  日志已轮转查不到原因);宝塔另有一个 Redis 6.2(端口 6378,带密码,没在跑,官网 PHP 用)—— 第二步用系统那个 6379,不碰宝塔的。
  第二步材料在 deploy/multiproc/(工作进程 systemd 单元 + 主进程 REDIS_URL drop-in + nginx upstream/include,
  eh_workers 带 `127.0.0.1:8000 backup`: 工作进程停了 nginx 自动全走主进程;回滚 = disable 工作进程服务)。
  本机验过: 主进程 + 2 工作进程 + Redis,工作进程拒 PK(503)、三个进程报到、同一 IP 限流主/工作进程交替打 200 次后两边都 429。
  测试 tests/test_multiprocess.py(63 例,Redis 用例要本机 `redis-server --port 6391`,连不上自动跳过;
  每个 Redis 用例结束检查「没有退回内存」,否则会在内存上假装通过);13 处守卫逐一破坏各自对应用例失败(回归锁验证过)。
  公告一条(admin,服务器监控)。入口: 管理端首页「检查服务状态」/「服务器监控」→ 容量卡片「CPU 4 核」
- ✅ 音标视频走腾讯云 COS(2026-10-25 13:06 **已部署生产**,提交 31edd28;4 个文件生产==HEAD~1 整推 + 新文件 services/cos_video.py,
  venv 装 cos-python-sdk-v5==1.9.44;备份 /root/eh_code_before_cos_20261025_1254.tgz(含 .env)、/root/env_before_cos.bak):
  用户问「加 COS 后几百人看不卡吗」→ 买 COS。服务器在**腾讯云广州**(不是阿里云),桶 `eh-media-1250000000-1358494268`
  (名字里的 1250000000 是建桶时把示例数字也填进去了,改不了,照用),私有读写,子账号 eh-cos 关联 QcloudCOSDataFullControl
  (**用户在聊天里发过明文 SecretKey,待用户给 eh-cos 新建密钥、删旧密钥后更新 .env**;权限也可再收窄到只这一个桶)。
  机制(services/cos_video.py): ①**播放器一行没改**: /stream 验票、过闸门、扣次卡之后,文件在 COS 且与本机一致就 302 跳 COS 签名地址
  (3 小时),浏览器自己带 Range 去 COS 取片段;302 带 no-store(生产 nginx http 级开着 proxy_cache,不能把签名跳转缓存给别人)
  ②「一致」= 本机文件大小 + mtime 与上传时记在 COS 元数据(x-cos-meta-mtime)里的相同 —— faststart/重压换过文件就对不上、照旧本机串流,
  等后台补传 ③同步: 后台线程(挂在 sentence_speech.speech_loop 里启动,**没挂 main.py**: 生产 main.py 有 drift),启动 list 一次桶建清单,
  每 10 分钟把本机 *.mp4(原片+流畅版)补传,不传 .tmp/.lite.skip;服务器→COS 走同地域内网(169.254.0.47)不收流量费
  ④开关 COS_REDIRECT(.env): 不设 = 只同步不跳 / =id,id = 只跳这几节 / =all 全部跳 —— **出问题改回空再重启就回到原样**
  ⑤删视频(单条/批量)连带删 COS 上的原片和流畅版 ⑥没配 COS / 没装 SDK / 签名出错一律本机兜底。
  COS 配置不进 Settings(config.py 生产有注释 drift),cos_video 自己读环境变量和 backend/.env。
  上线顺序: 只同步(84 个文件 5.2GB 约 3 分钟传完,逐个核对一致)→ COS_REDIRECT=48 单节 → Chrome/Safari 经线上地址实测
  能播、跳到 60 秒接着播,nginx 日志里该节只剩 0 字节的 302 → =all,42 节逐个过票 + 跟跳转都 206。
  用量参考: 10 月视频下行 13.2GB ≈ 6.6 元(外网下行 0.5 元/GB),存储 5.2GB ≈ 0.6 元/月;CDN 没上(要备案域名 + 证书,量大了再加)。
  ⚠️ 腾讯云按量扣余额,**余额用完 COS 停服、视频播不了**(会退回?不会 —— 跳转照发,COS 那边 403),要提醒用户设余额告警。
  测试 tests/test_cos_video.py(8 例;一致性校验 / 只传 mp4 / no-store / 删 COS 四处各恰好 1 例失败,回归锁验证过)
  **10-25 下午加 CDN 开关**(用户「管理端加个开关,打开走 CDN、关闭走原来的 COS」): CDN 域名 media.feiyingsteam.com
  (源站 = 这个私有桶,CDN 控制台开了「私有存储桶访问」;TypeA 鉴权,参数 sign、有效期 10800 秒,主 Key 在生产 .env 的
  CDN_AUTH_KEY,域名 CDN_DOMAIN)。开 = /stream 302 跳 CDN 签名地址,关 = 跳 COS 签名地址(原样)。三个要点:
  ①**开关存文件** private_media/cos_video/cdn_switch.json(后端在改多进程,放内存别的进程看不到),
  读不了/坏了/"true" 字符串一律按关;每次播放多一次 stat ②**打开前服务器先实测一次**(probe_cdn: 签地址取开头 1KB,
  必须 206 且与本机一致),测不过 409 不让开;403 按 Server 头区分「CDN 鉴权没过(Lego Server)」与「回源被 COS 拒
  (tencent-cos,= 私有存储桶访问没开)」—— 10-25 排查卡在后者一个多小时;关闭不测 ③地址带 `v=本机 mtime`:
  实测 CDN 缓存键含普通参数、不含 sign,换文件(faststart/重压)v 变就不会拿旧缓存。
  COS_REDIRECT 没开时开关不起作用(卡片上写明)。改开关记操作记录 system.video_cdn。
  入口: 管理端首页「音标视频加速(CDN)」(开关 +「测试 CDN」);公告一条(admin)。测试同文件加 6 例
  (开关被无视 / 字符串当开 / 去掉 v / 打开不实测 / 403 不分来源 五处各让对应用例失败,回归锁验证过)
  **10-26 加自检自动关**(提交 6fb6c7d,12:02 上线): 10-26 上午 CDN 域名整体 418(Lego Server, Return Directly)、
  HTTPS 回默认证书 *.cdn.myqcloud.com,开关开着视频全播不了,10:40 才被另一会话手动关掉(原因待用户在 CDN 控制台查:
  域名被停 / 欠费 / 用量封顶)。现在主进程线程 cdn-guard(和 COS 同步线程一起起)在开关开着时每 5 分钟 probe_cdn 一次,
  **连续 2 次**不通写 off + reason,updated_by="系统自动关闭";测的过程中管理员动过开关(updated_at 变了)不覆盖。
  卡片红框显示几点关的和原因。测试 1 例(一次就关 / 覆盖管理员 / 没开也测 三处各让它失败,回归锁验证过)
  **10-27 16:15 腾讯云欠费,视频全播不了**(用户「音标视频怎么又看不了了」): 我们的 /stream 照常 302,跳到 COS 后 COS 回
  **451 UnavailableForLegalReasons「account is arrears, unavailable until you recharge」**(CDN 10-26 起已关,全走 COS)。
  10-26 上午 CDN 域名 418 多半也是同一个欠费。处理: 生产 .env 的 COS_REDIRECT 改成空(备份 /root/env_before_cosoff_20261027_1615.bak),
  两个服务重启 → 视频改回本机串流;公网实测 3 节 206、真实学生请求 206。⚠️ **现在视频走服务器 12M 带宽**,人多会卡;
  用户充值后把 COS_REDIRECT 改回 all 再重启两个服务。排查顺序: 先看 nginx 里 /stream 是 302 还是 206,302 就是跳出去的那边坏了,
  从服务器 refresh_index() 后签一个地址带 Range 取一下看状态码(没有 refresh_index 时 signed_url 恒为 None,别误判)。
  **10-27 晚已做 COS 开关 + 欠费自动切换**(见下一段)
  **10-27 COS 线路开关 + 欠费自动切换**(17:00 **已部署生产**,提交 82e033f;3 个后端文件生产==c361d23 整推(git archive 导出),两个服务都重启;前端 dist 构建号 mvqgeq57;
  备份 /root/eh_code_before_cossw_20261027_1652.tgz、frontend/dist_bak_20261027_1652。上线时在生产写了开关文件
  「16:15 系统自动因欠费改回本机」(auto=True),所以**充值后 cos-guard 连续 2 次取到就自动切回 COS,不用改 .env**;
  .env 的 COS_REDIRECT 现在是空的,开关文件在就不看它。16:58 首次自动检查: 仍欠费,保持本机,视频 206 正常)(用户「是不是要做个开关切换 COS,有钱了之后」→「切回 COS 了需要有个切换 COS 的文字显示」):
  ①开关存文件 private_media/cos_video/cos_switch.json(多进程都看得到),**文件在就以文件为准**,没有文件照旧看 .env 的 COS_REDIRECT,
  文件坏了按关(本机串流永远能播)。redirect_enabled / redirect_mode 都先看它
  ②主进程线程 cos-guard 每 5 分钟 probe_cos: 签 COS 地址(不走 CDN)取开头 1KB,必须 206 且和本机一致;原因分开写
  (451 / 正文含 arrears =「腾讯云账号欠费」、403、404、连不上)。**开着连续 2 次不通 → 自动改回本机**(auto=True,写原因);
  **只有系统自动关的**,连续 2 次通了才自动切回 COS(清单空就先 refresh_index),管理员手动改回本机的不测不自动开;
  测的过程中管理员动过开关不覆盖。没有开关文件(还在用 .env)不测。每次检查结果另存 cos_check.json(不和开关同一个文件)
  ③每次切换记一条 events(最近 20 条);管理端「音标视频播放线路」卡片(components/admin/VideoCdnSwitch,原「音标视频加速」改名并入)
  上面一块大字「现在: 走腾讯云 COS / 从服务器本机播放」+ 为什么 + 几点切的 + 最近一次自动检查 + 最近 5 次切换(「10/28 09:10 系统自动切回腾讯云 COS」),
  按钮「测试 COS」「切回 COS」(先实测,欠费 409)/「改回本机播放」(确认框写明走 12M 带宽);下面一块 CDN,没走 COS 时写明不起作用。
  接口 PUT /admin/system/video-cos、POST /admin/system/video-cos/test,GET /admin/system/video-cdn 多给 cos;操作记录 system.video_cos。
  测试 tests/test_cos_video.py 加 5 例(20 例);开关文件不生效 / 坏文件按开 / 欠费不识别 / 一次不通就关 / 恢复后不自动开 / 手动关也自动开 /
  覆盖管理员改动 / 切回不实测 八处逐一破坏各自恰好 1 例失败(回归锁验证过)。浏览器验过(1366 / 390): 欠费自动改回、自动切回、手动改回三种文案
  **10-27 忙的时候才走 COS**(17:33 **已部署生产**,提交 7b3158c;2 个后端文件生产==3315b4f 整推,两个服务都重启;前端 dist 构建号 mvqhkvbq;
  备份 /root/eh_code_before_cossmart_20261027_1728.tgz、/root/cos_switch_before_smart_20261027_1728.json、frontend/dist_bak_20261027_1728。
  **17:13 用户已充值**: cos-guard 连续两次取到 COS,自动切回(切换记录写着「腾讯云 COS 恢复正常,系统已自动切回 COS」)。
  上线后: 开关开着、线路 smart(老开关文件没有 route 字段 = 默认 smart)、阈值 6 Mbps;当时出网 0.08 Mbps → 学生看视频从本机放(公网实测 206 本机)。
  net-load 采样和手工读 eth0 对得上)(用户「不卡的时候就不用 COS,卡的时候如果 COS 有余额就切到 COS,没余额就不切」):
  开关文件多两个字段 route(smart 默认 / always)+ busy_mbps(默认 6 = 12M 的一半);切开关不改它们,改线路不动开关和切换记录。
  smart 时 redirect_enabled = 开关开着 **且** 服务器忙 **且** 最近一次 COS 自动检查没失败(刚欠费、还没连续两次自动关时也不切)。
  「忙」= 公网网卡(eth*/ens*,不算 docker 的 br-/veth)出网 30 秒平均 ≥ busy_mbps,**看整台机器**(背单词 / PK 人多也算忙,
  把视频挪走别的才不卡);进忙立刻进,出忙要满 10 分钟且连续 3 分钟低于六成(next_load_state 纯函数);主进程线程 net-load
  每 5 秒读 /proc/net/dev 写 private_media/cos_video/net_load.json,超过 60 秒没更新 = 测不到 → 按忙算(宁可多花几毛钱不让孩子卡)。
  接口 PUT /admin/system/video-cos/route;GET video-cdn 的 cos 多给 route / busy_mbps / calm_mbps / load / now_route。
  卡片「什么时候走 COS」: 两个选项、阈值可改、「服务器现在出网 X Mbps · 忙,学生看视频走 COS」、最近几次忙闲切换。
  测试加 5 例(25 例);smart 一直跳 / 欠费也切 / 测不到按不忙 / 出忙不等 10 分钟 / 中途冒高不清零 / 切开关丢线路 / 忽略上次检查 七处各让对应用例失败
  **10-28 卡片最上面写清「学生现在走哪条线」**(用户「要显示目前是走的本机播放还是 COS,CDN 开没有开」): 纯前端,
  components/admin/VideoCdnSwitch 顶部加一块: 大字「学生现在看视频: 从服务器本机播放 / 走腾讯云 COS / 走 CDN 加速(经腾讯云 COS)」
  + 一句为什么(不忙出网 X Mbps 到 6 才走 / 忙了 / 一直走 / 欠费自动关 / 手动关 / 忙了但最近一次检查 COS 没通过)
  + 三站「服务器本机 → 腾讯云 COS → CDN 加速」各写开没开,学生正在走的那站高亮。判断和 /stream 同口径:
  cos.now_route(= redirect_enabled)决定本机还是 COS,走 COS 时 CDN 开关开着且配了域名 Key 才算 CDN。
  卡片开着时每 30 秒刷新一次(页面在后台不刷,切回来马上刷),右上角写是几点的状态、可手动刷新。
  下面原来的 COS 块标题改成只说 COS 开没开(「腾讯云 COS 可以用(服务器忙时才走)」),不再和顶部抢「现在」。
  已上传到 COS 之外的单节视频照旧本机放(顶部按全局线路写,不逐节判)
- ✅ 例句跟读(2026-10-25 09:45 **已部署生产**,提交 a49b661;main.py 走 anchor patch 只加 3 行 router,其余 5 个文件生产==HEAD~1 整推,
  新文件 api/v1/read_aloud.py、services/read_aloud.py、models/read_aloud.py;新表 read_aloud_recordings 由 create_all 建(先在生产库副本跑过 init_db);
  备份 /root/eh_db_before_readaloud_20261025_0943.db、/root/eh_code_before_readaloud_20261025_0943.tgz、frontend/dist_bak_20261025_0943,构建号 mvn5x1jw):
  用户「口语练习…中英文翻译准吗」→「按你建议」(先做看英文跟读)→ 录音「保留 14 天、不发金币」。**放进单词单元而不是单独模块**:
  句子背诵/开口背 10-11 上线后生产真实学生 0 条记录,单独模块没人点。规则真源 services/read_aloud.py:
  ①能跟读的句 = 单元里每词一条例句(主释义优先)、3–15 个词、同句去重;一轮 8 句,没读过的先读,都读过挑最久没读的
  ②当场只判 VAD「开口说够时长」,孩子看不到对错;录音进开口背**同一个进程池和调度循环**(sentence_speech.speech_loop,
  在飞集合按 (来源, id) 记),逐词比对复用 judge;**结果只给本班老师**
  ③**录音保留 14 天**: 落 private_media/read_aloud(AUDIO_DIR 由 SENTENCE_SPEECH_DIR 推出,没改 config.py —— 它在生产有注释 drift),
  转写**不删**音频,purge_expired 每小时删超 14 天的文件、行保留;没装 whisper 时调度循环也照常跑删除(答应过的保留期不能因为缺包失效)
  ④老师在学生详情页「例句跟读」回放(blob 取,no-store)、标「读对了 / 没读对」,summary 给 marked/agree = 机器和老师一致几句
  —— **这是决定以后给不给孩子看对错的依据**,先攒数据 ⑤作业 content_homework kind=read_aloud(target=单词单元):开放后读满
  min(8, 单元句数) 句不同例句自动完成;布置了跟读作业的单元即使书没分配也放行跟读(卡包书/专属内容照旧不放)
  ⑥不发金币、不进掌握度和单词数 ⑦minSpeechMs 280→160ms/词(开口背共用): Edge TTS 标准音实测 VAD 有声 238–260ms/词,
  原阈值正常语速读完整句也判「没听清」。生产冒烟(临时机构+账号,跑完删净): 没布置时 403 → 布置后 8 句 → 上传 → 作业自动完成 →
  生产进程池转写 8/8 → 老师回放 200 + 标记 200。浏览器验过手机/桌面两种宽度。⚠️ 浏览器自动测试用的是假麦克风(固定一段合成音),
  **真人录音的识别准确率仍未验证**。入口: 单元页「基础巩固 → 跟读」;教师「作业管理 → 布置句子 / 音标 / 复习 / 跟读作业 → 例句跟读」;
  学生详情页「例句跟读」。公告学生/老师各一条。测试 tests/test_read_aloud.py(8 例;14 天保留 / 长度过滤 / 作业放行 / 只看本班 /
  开放前不算 各自对应用例失败,回归锁验证过 —— 开放前那条要 SQL 和 Python 两处都去掉才失败,单去一处有另一处兜着)
- ✅ 体验卡各校区汇总(2026-10-24 晚,用户问「子管理端也做了没,别的校区」→「加一个汇总页」):
  各校区机构管理员本来就有整套「地推体验卡」(数据按 org_id 各管各的);缺的是**平台管理员看不到别的校区** ——
  `/admin/promo` 对 admin 只管自己账号所在的直营。新页 `/admin/promo-summary`(pages/AdminPromoSummary.tsx,只给 admin,
  路由 + 后端 `require_role("admin")` 两道)。真源 services/promo.org_summary: 每个机构一行(体验价 / 在用销售数 / 卡在用/全部 /
  扫开 / 留电话 → 加微信 → 付体验费 → 开通 → 学满 5 天 → 报正价 / 实收 / 该跟进 / 最近留电话),与机构看板 board()
  **同一套判据**(按留电话日期切一批线索、studied_days 读 study_calendar、扫开累计);**没开始做的机构也列**(灰色「还没开始」,
  只列有数据的会把它们藏掉)。点开一个校区走 `GET /promo/summary/orgs/{id}/board` = 直接调那家的 board(),
  测试锁住与那家机构管理员自己看到的 total 完全一致。只读,不给 admin 跨机构改卡码 / 销售。
  入口: 管理端首页「组织与人员 → 体验卡各校区汇总」+「地推体验卡」页右上角「各校区汇总」(只对 admin 显示)。公告一条(admin)。
  顺手: `/admin/promo` 和新页主体原先用 `teacher-workspace-main`,那个类的边距只对教师端 body 生效 → 管理端 / 机构端电脑上
  内容贴着屏幕左边,改成和机构管理页一样的 `max-w-[1440px] px-4 sm:px-6 lg:px-10`。
  测试 test_platform_summary_lists_every_org_and_is_admin_only(机构管理员也能看 / 没开始的机构不列 / 线索不按机构归组
  三处各让它失败,回归锁验证过)。浏览器验过(临时库三个校区,1366 宽 + 390 宽,无横向溢出)。
- ✅ 体验卡卡面价格跟着「设置」走(2026-10-24 晚,用户「设置里改了体验价,卡上还是 99」):
  以前 50 套正面底图把 ¥99 整张画死,落地页读 promo_org_settings.trial_price、卡面不读,改了价就对不上。
  现在 **每套正面 / 缩略图换成去掉价格的底图** public/promo-card/tpl/{id}_front_blank.jpg、_thumb_blank.jpg。做法: macOS Vision
  OCR 定位每套的「¥99」→ 图片编辑接口(gpt-image-2.5-sunburst /edits,用户给的作图 key)去字 → **只把徽章那一块合回原图**
  (与原图差得多且连到价格框的像素,其余像素一律用原图,标题和花纹不会被顺手改)→ OCR 复查 50 张都没有残留价格、标题都在。
  先试过纯本地抹字(拟合底色 + 插值),纹理 / 发光 / 渐变徽章会留痕,放弃了。价格按 data/promoTemplates.ts 每套的 `price` 框(原图 1536×1024 坐标:中心 x/y、最宽 w、
  原字高 h、字色 fill、描边 stroke)现画: 印刷文件 utils/promoPrint.ts canvas 画,缩略图 components/promo/PromoCardThumb.tsx
  用 SVG 叠字(不用 canvas,列表一屏几十张不卡)。位数多了自动缩字号塞进 w,¥ 比数字小一号。字体 public/promo-card/fonts/
  baloo-2-latin-800.woff2(OFL,随包发,印刷前 document.fonts.load 等它到位,不靠系统字体)。价格格式 utils/promoPrice.ts
  (formatPrice: 最多两位小数、末尾 0 不写,99 / 9.9 / 19.99;字宽表含小数点)。
  **10-24 晚补: 体验价和实收可以带小数**(用户「没法输入 9.9」——设置页 `<input type=number>` 默认 step=1,浏览器直接拦下 9.9,
  后端也只收 int)。后端 trial_price / paid_amount 模型列 Integer → Float,**不用 ALTER**: 生产表是 INTEGER 亲和列,
  SQLite 照样把 9.9 存成 REAL、99.0 存成整数 99;出口统一走 services/promo.money()(两位小数,整数给 int,
  看板实收按浮点加完再规整,9.9×3 不会显示 29.700000000000003),入口 parse_money()(0~10 万、第三位四舍五入、NaN/无穷拒)。
  前端设置页和线索实收输入框 step=0.01 + inputMode=decimal;标「已付」弹框默认填机构体验价(原来写死 99)。
  测试 test_trial_price_and_paid_amount_accept_decimals(去掉看板规整 / 改回只收整数 / 整数不给 int 三处各让它失败,回归锁验证过)。
  ⚠️ 用户 10-24 19:06 在生产把直营体验价存成了 **9**(输不进 9.9 退而求其次),上线后要提醒用户重新填 9.9。**旧的 {id}_front.jpg / _thumb.jpg(印着 ¥99)没删**,只为已经打开的旧页面不裂图,新代码不再引用。
  调用方: 卡码列表缩略图、选模板小图、印刷预览、下载正面(文件名带「_199元_」)、销售工作台「我的卡」都传机构体验价;
  印刷说明写明「正面印的价格是 ¥X,改了要重新下载重新印」;设置页保存提示同样写明,并在价格框下面现画一张卡面预览。
  后端没改(PUT /promo/settings 早就有)。测试 test_template_ids_match_frontend 改成检查每套 _blank 两张 + 背面在、
  每套都有 price 框且在图内、字体文件在;去掉一套 price 框 / 删一张 _blank 各恰好让它失败(回归锁验证过)。
  浏览器验过(临时库,手机 390 宽 + 电脑 1366 宽): 设置改 199 保存 → 卡码缩略图、50 套选模板小图、印刷预览、下载的正面 PNG、
  销售工作台都是 ¥199。顺手修了销售工作台「我的卡」手机上卡名被挤成一字一行(flex-1 basis 0,两个按钮还塞得下同一行;
  给文字列 min-w-[12rem],放不下按钮就换行,这个毛病改之前就有)。公告一条(admin+org_admin)。
- ✅ 体验卡: 线索 / 卡码 / 看板上的销售都能删(2026-10-24 晚,用户「看榜线索卡码都需要支持删除」):
  **看板没有自己的数据**(从线索和卡码现算),所以「删看板」= 看板每行能直接删那个销售(复用销售页的删除弹窗,
  名下有卡或线索要选接手人,同 409 TRANSFER_REQUIRED);停用了且名下没有卡也没有线索的销售不再上看板;管理员自己那行不给删。
  真源 services/promo.py: ①`delete_leads` **只删本机构的**(混进别家 id 忽略),跟进记录显式一起删(生产 FK 关闭),
  删了这个手机号能重新扫码登记 ②`delete_channel` **线索留着**、归属不变,只把 channel_id 置空(列表卡名显示「(卡已删除)」),
  卡面设计一起删;印出去的卡扫了 404「这张卡已经停用」,看板上那版卡的扫开次数跟着没了 ③**只有机构管理员能删**,
  销售删不了线索(不想跟的标「无效」,删了等于抹掉自己转化差的痕迹)。删前快照进操作记录(promo.lead_delete /
  promo.channel_delete),summary 里手机号打码、detail 存全文。端点 `DELETE /promo/leads/{id}`、`POST /promo/leads/batch-delete`
  (≤200 条)、`DELETE /promo/channels/{id}`。前端: 线索列表管理端每行勾选框 +「全选本页」「删除 N 条」(勾选只在本页,
  翻页/筛选/删完重拉就清空)、抽屉最底部「删除这条线索」;卡码每行「删除」(弹窗写明留几条线索,勾「我知道印出去的卡扫了就打不开」才能删);
  删空一页退回上一页。测试 tests/test_promo.py 加 3 例(16 例;去掉机构过滤 / 不删跟进 / 不断开卡码 / 不藏停用空销售 四处各恰好 1 例失败,
  回归锁验证过)。浏览器验过(临时库,手机 390 宽 + 电脑 1366 宽): 看板删销售转交、批量删 2 条、抽屉删 1 条、删卡码后线索还在。
  入口: 「地推体验卡 → 线索 / 卡码 / 看板」;公告一条(admin+org_admin)
- ✅ 体验卡模板补齐 50 套 + 卡上印网址(2026-10-24 下午,用户「继续」/「es.feiyingsteam.com 是不是也要弄上去让用户知道用这个网址」):
  出图中转 13:47 恢复(中午是 402 上游余额不足 / 503 没号),t37–t50 补齐,TEMPLATE_IDS 改成 1–50。
  ①**背面二维码下面印网址 `es.feiyingsteam.com/c/{卡号}`**(替换原来的「NO. 卡号」): 扫不了码的家长照着输入也能进登记页,
  线索照样归这张卡的销售;不印 https://(太长;http 已 301 到 https,实测)②**落地页登记成功后写明「孩子学习的网址 es.feiyingsteam.com」**,
  建议家长收藏 ③名字条又挪了两套(t37、t45 → 右下),现在 t03/t32/t37/t45 四套不居中 ④registry.py 的旧坐标正则要兼容
  新格式(no/group/strip 字段),第一次跑 0 行 —— 已兼容,且核对过原 36 套坐标一条没变。50 套逐个现画背面二维码都能解出,
  50 张正面 OCR 价格全是 ¥99。**已下载过的印刷文件是旧版**(印卡号不印网址),公告里写了要重新下载。
- ✅ 发音组件每晚自检 + 自动升级(2026-10-24,用户「发音组件版本能自动更新吗」→「要你做」): 起因是 edge-tts 7.2.8
  10-17 起被微软按版本号 403 拒,已缓存的词照常响、没缓存过的文本全无声,一周没人发现(补完例句后「朗读句子」才暴露),
  10-24 手动升 7.3.1 恢复。**不做无条件自动升级**(新版也可能坏、升级要重启、白天重启会断 PK 房间/实时课堂)。
  真源 services/tts_guard.py,systemd 定时器 eh-tts-guard.timer 每晚 03:37 跑 scripts/tts_guard.py(单元文件在 deploy/tts-guard/):
  ①合成一句带随机编号的新话(缓存不可能命中)→ 正常只记一条 ②失败且在 23–7 点 → 临时 venv 装最新版试,**能出声才**升线上 →
  再试 → 重启 → 经 127.0.0.1 接口验证;装上仍不行就退回原版本、不重启 ③最新版也不行 / 同版本在临时环境能出声 = 不是版本问题,
  不动线上 ④白天只记录(--any-time 强制)。结果写 private_media/tts_guard/status.json(最近 30 条),
  管理端首页「发音检查(每晚自动)」卡片读 `GET /admin/system/tts-status`(仅 admin),异常标红、7 天内自动升级过标黄。
  **自动升级后 requirements.txt 不会跟着改**(卡片文案会提醒),下次部署前手动改版本号。
  生产实测: 首次运行「发音正常(7.3.1)」;用临时 7.2.8 环境演练升级路径 → 7.2.8 被拒 → 临时环境 7.3.1 能出声 → 升到 7.3.1(重启换成打印)。
  测试 tests/test_tts_guard.py(9 例;去掉白天拦截 / 同版本判断 / 升级失败退回 / 新版不行不动 四处各恰好 1 例失败,回归锁验证过)
- ✅ 体验卡模板加到 36 套 + 按风格筛(2026-10-24,用户「再加 30 个模版」): 出图中转 hk.hueling.cc 10-24 11:40 起所有图片模型
  一律 503「No available compatible accounts」(中转那边没号了,不是请求问题),30 套只出完 16 套(t21–t36)就断了,**先上线 36 套**;
  t37–t50 的提示词在本机 /tmp/tplgen2/gen.py(已出的自动跳过),中转恢复后补齐,再把 services/promo.TEMPLATE_IDS 的 37 改成 51、
  跑 /tmp/tplgen2 那套 OCR + 扫框 + registry.py 重写 data/promoTemplates.ts。
  新做的: ①注册表加 no(编号)/ group(经典/清新/学习/冒险/四季/节日国风/深色)/ strip,选模板弹窗按风格筛、默认停在当前模板那一组
  ②**正面名字条位置按模板定**: OCR 文字框与名字条求交,居中会压到模板自己底部文字的(t03 压「扫码进群 预约体验」、t32 压右下角)
  用 strip: 'r' / 'l' 挪到一边 ③**白框扫描放宽阈值**: 有的背面白框带纸纹(t32/t33 在 240 阈值下只扫出半个框),按 240→232→225 逐级放宽,
  同时要求框内按 promoPrint 口径无暗点 ④**t03 卡面一直印着 ¥9.9**(10-23 用 images/edits 改价没改成功,当时只核对了文字没核对价格),
  OCR 全量复查时发现,本地把徽章里的字抹掉重写 ¥99(逐行插值补底色,不重新出图)。上线时生产唯一一版卡用的是 t01,没人印过 t03。
  36 套逐个现画背面 BarcodeDetector 全部解出正确地址。桌面「地推99体验卡/卡面模板」有原图 + 36 套预览图。
- ✅ 地推体验卡第二批: 销售增删改查 + 分页 + 20 套卡面模板(2026-10-23,用户「增加删除销售…增删改查都需要 分页也是…
  卡片多出几版,老师可以在上面自定义加自己的号码和选不同的模版,这样就不会拿错卡片,弄 20 个模版」):
  ①**删销售必须选接手人**: 名下有卡或线索时不带 transfer_to 回 409 TRANSFER_REQUIRED(附张数),带了就把卡码和线索一起
  改给接手人、每条线索记一笔「转交」再删行(生产外键是关的,引用全在 services/promo.delete_sales 里显式改);前端还要输入姓名确认。
  **通用「用户管理」删 sales 账号 409**,引导到体验卡页删(那里才会转线索)。只是暂停的用「停用」
  ②销售可改姓名/用户名/手机号(手机号空串 = 清掉,显式分支);销售列表、卡码列表、线索列表都分页(20/页)+ 搜索
  (LIKE 的 _ % 转义);下拉框用 `?all=true` 拿在用的全部销售 ③**卡面 = 新表 promo_card_designs**(channel_id 主键,
  不往 promo_channels 加列 —— 那张表已上线,create_all 不补列): template_id + 卡上印的名字/电话。没自定义 = 跟销售账号走,
  display_phone 空串 = 不印(和 NULL 区分)。新卡自动分「本机构在用卡里还没用过」的模板,不同销售默认就不撞;
  销售能改自己卡的卡面(PUT /promo/channels/{id}/design),管理员改全机构 ④**20 套模板**: public/promo-card/tpl/{id}_front/back/thumb.jpg,
  前端注册表 data/promoTemplates.ts(id + 名字 + 背面白框坐标),后端 TEMPLATE_IDS 同一组(测试正则解析 .ts 锁一致 + 检查 60 张图都在)。
  t01–t03 是之前三款(t02/t03 用 images/edits 改成 ¥99 + 预约体验),t04–t20 gpt-image-2.5-sunburst 新出,整张含中文;
  每张都用 macOS Vision 做过 OCR 核对文字(无错字;t11 背面第一版白框与白底连成一片,重画成米色底)。
  **白框坐标是逐像素扫的(最大白色连通块,填充率 ≥0.99),换图必须重扫**;promoPrint 画之前抽样检查框里是白的,不是就报错不出图。
  名字电话印两处: 正面底部白色胶囊 + 背面二维码下面(字号按宽度自动缩)。20 套逐个现画背面后 BarcodeDetector 都能解出正确地址。
  **下载印刷文件前先自动保存卡面**(印出去的和系统记的必须同一套)。转交卡码不会自动改卡上印的名字,弹窗提醒改了再补印。
  测试 tests/test_promo.py 13 例(删销售不要接手人 / 清空手机号被 if 吞掉 / 新卡不分不同模板 三处各恰好 1 例失败,回归锁验证过)。
  桌面「地推99体验卡/20套模板」有 40 张原图 + 一张「20套模板预览(含名字电话示例)」。
  **10-28 开销售撞名说清原因**(用户「地推的用户名和学生老师重复不影响吧」→「报错提示要告诉用户是什么原因」):
  用户名**全站唯一不分角色**(同一个登录页,不能放开);撞了回 409 detail{code USERNAME_TAKEN / PHONE_TAKEN, field, message, suggestion},
  message 写明「学生老师家长销售同一个登录页、用户名全站只能有一个」,suggestion 先试 xs_ 前缀再试末尾加数字(一条查询判完);
  **不说被谁占了**(常是别家机构学生)。前端钉在输入框下面(不用 3 秒 toast),「改用 xxx」一键填上,用户名框下常驻建议加 xs_ 前缀。
  手机号撞了写明手机号选填、可先空着。测试 test_sales_username_conflict_explains_and_suggests
- ✅ 地推体验卡 + 销售跟单(2026-10-23,用户「地推扫码进群送 9.9 卡片…需要是谁发出去的卡…需要销售跟单」→
  「我有多个销售」→「7 天卡价格改成 99」): **一版卡 = 一个卡码挂一个销售**。卡背面印的是固定地址 `/c/{卡码}`(活码),
  不是群二维码 —— 个人微信群码 7 天过期、满 200 人扫不进;扫码后显示什么由销售自己在工作台换图,卡不用重印。
  新角色 **role='sales'**: 只放行 /promo/* 一组接口,其余接口全是角色白名单所以进不去(测试逐个锁了老师/学生/推荐/管理接口 403);
  登录落 `/sales`(Login.tsx + DashboardRedirect),计入机构停用拦截和教职工登录日志。真源 services/promo.py,五条规矩:
  ①**先留电话才给二维码**(GET 落地页不下发码,否则线索归不到人)②**同机构同手机号只认第一张卡**(UNIQUE(org_id,parent_phone)),
  后扫别的销售的卡回第一个销售的码、不新建线索 —— 销售不抢单 ③**归属按留电话那一刻**: 卡码转交后旧线索不跟着走;
  改归属只有机构管理员(记跟进+操作记录)④**阶段时间只写不清**(contacted/paid/opened/won_at),标无效、改回去都不清,
  直接标「已付」补上加微信时间 —— 漏斗按「走到过哪一步」算 ⑤**学满 5 天看 study_calendar**(与陪跑同一个「学了」判据,
  开通当天起 7 天窗口),要先在线索上关联学生号。看板按「留电话日期」切一批线索看后来走到哪(不按各阶段发生时间,否则跨月失真)。
  五张新表(promo_sales_profiles / promo_channels / promo_leads / promo_follow_ups / promo_org_settings,create_all 建,
  **不进 tenancy 锚点**,查询显式写 org_id)。销售二维码是公开图,落 UPLOAD_DIR/promo-qr(换图带 ?v= 时间戳);
  群码 6 天没换后台标黄。体验价默认 99(promo_org_settings 可改,落地页读它;卡面当时印死 ¥99,10-24 晚起也跟着它现画)。
  平台 admin 按自己账号的机构(直营)管 —— 直营没有机构管理员账号。跟进记录只加不改不删。
  卡面: 方案 C(鹰戴耳麦)AI 整张出图含中文(gpt-image-2.5-sunburst,¥99 是 images/edits 改的),
  底图 public/promo-card/{front.jpg,back.png};印刷文件前端 canvas 现画(utils/promoPrint.ts): 成品 90×60mm(不是名片 90×54)
  + 四边 2mm 出血 = 94×64mm/300dpi,二维码画进底图白框(**坐标是对 back.png 逐像素扫的 BACK_BOX,换底图要重扫**,
  尺寸不对直接报错不出图),二维码地址生产固定用 es.feiyingsteam.com(cardUrl,别用当前地址栏 —— 管理员常走 IP:3000)。
  同一版卡每张一样,不用可变数据印刷。入口: 机构管理首页「管理 → 地推体验卡」/ 平台管理端「组织与人员 → 地推体验卡」
  (`/admin/promo`: 看板/线索/销售/卡码/设置);销售登录即「销售工作台」`/sales`;家长扫卡 `/c/{卡码}`。公告投 org_admin/admin。
  测试 tests/test_promo.py(9 例;去掉同号去重 / 销售按人过滤 / 阶段时间补齐 三处各恰好 1 例失败,回归锁验证过)。
  浏览器验过(本地库副本): 管理员开两版卡 → 下载的背面图用 BarcodeDetector 解出 /c/{卡码} → 王老师传微信码 →
  家长手机宽度扫卡留电话看到王老师的码 → 同号扫李老师的卡仍显示王老师 → 跟单加微信/已付 99/关联学生/开通/写跟进 →
  李老师看不到 → 看板王老师 1 留电话 1 付费 ¥99。**抖音直播方案文档里体验营默认价仍是 9.9,没跟着改**
- ✅ 直播卡顿修复(2026-10-26 12:02 上线,提交 831d382 + 734df3a;用户「直播不流畅是什么问题」→「好的」):
  先查的实情: 直播机 CPU 0.5%、出口约 115M、观众个位数,**不是服务器瓶颈**。修了四处:
  ①**学生端每 4 分半黑一下**: 播放票据 5 分钟过期,续签时 setCred 触发播放器 effect 整个销毁重建。现在续签只换
  credRef(下次重连用),播放器只在 playKey 变时(进来 / 重连)重建 —— 已经连上的 FLV 长连接不受票据过期影响
  ②**缓冲全关 + 落后就跳帧**(enableStashBuffer:false + liveBufferLatencyChasing)→ 留缓冲、liveSync 1.1 倍速追
  (目标 2 秒、超 4 秒才追),延迟多 1–2 秒 ③**断了不会自己恢复**: 学生端 mpegts ERROR / LOADING_COMPLETE(源站关流)/
  画面 10 秒不动 → 自动重连 1→2→4→8→15 秒,动起来清零;重连中不发观看心跳;没开播每 5 秒自动再试;
  join 409 带「下课」两字 → 停在结束页(后端 detail 区分 ended)。续签失败(非下课)不动正在放的画面。
  老师端 connectionState failed 立刻 / disconnected 5 秒没回来 → **不重新采集**,重调 /start(拿新地址 + 后端踢残留推流)
  再建 WHIP;4xx 停下照实报;连的过程中点了下课要关掉刚建好的连接。开播后显示丢包 / 延迟(remote-inbound-rtp),
  丢包 ≥3% / 延迟 ≥300ms / 码率 <250k 提醒插网线 ④直播页不弹新功能公告(WhatsNewNudge QUIET_PATTERNS 加
  /student/live/、/teacher/livestream —— 公告会盖住学生画面、挡住老师开播按钮)。
  831d382 是昨晚的 500: 学生重进同一节课 INSERT 撞 UNIQUE → rollback → student 过期 → MissingGreenlet;
  join 和心跳都改成单条 ON CONFLICT。**直播课 3 从 8-26 起一直没下课**,老学生每次重进都 500。
  本地实测(临时库 + ffmpeg 往生产 SRS 推测试流): 80 秒 7 次续签播放器 0 次重建;掐断推流 → 学生端提示重连 →
  恢复推流后自动接上;下课后停在结束页;老师端从源站踢掉推流 → 页面自动重推、源站出现新推流者。
  ⚠️ **iPad/iPhone 的 HLS 放长还没生效**: deploy/srs/srs.conf 与生产 /opt/srs/conf/srs.conf 都已改 hls_fragment 2 /
  hls_window 10(生产备份 srs.conf.bak_20261026_1200),配置检查通过,但 **SRS 5.0.225 的 SIGHUP reload 不改 HLS 参数**
  (实测新推的流仍是 win=5000ms frag=1000ms),要 `docker restart srs` 才生效 —— 会断正在推的流。
  **10-26 13:15 已生效**: 等那路推流自己停了(流 0、客户端 0)才重启容器,测试流实测 win=10000ms frag=2000ms、
  列表 6 段共 12 秒。公告老师一条
- ✅ 直播共享屏幕套娃修复(2026-10-22,用户「直播用屏幕共享会出现一层层嵌套」): 从源站拉了一帧实拍 —— 老师共享的是
  **开播页所在的浏览器窗口**,页面里的实时预览被共享进去再显示出来,一层套一层。旧逻辑按 displaySurface 判:
  整屏/标签页藏预览、'window' 放行,**而浏览器窗口本身就是 'window'**(Mac 上最常见)。现在共享屏幕时**一律不放实时预览**,
  改「看一眼学生画面」截一张静态图(用不挂进页面的 <video> 取帧;共享错窗口也只多一层,一眼看出选错了);
  提示语按 displaySurface 写(整屏 = 把 PPT 放最前面;其余 = 选 PPT 所在窗口)。getDisplayMedia 加
  selfBrowserSurface:'exclude' + displaySurface:'window'(Chrome/Edge 选择框去掉本标签页、默认停「窗口」页签;
  Safari 用系统选择框会忽略),不认这几项抛 TypeError 时退回基本参数。真浏览器验过: 假屏幕流报 window → 无可见预览、
  截图 960×540、切回摄像头预览恢复。公告投老师/机构管理员。
- ✅ 直播源站迁到 171.80.3.205(2026-10-22): 旧机 171.80.0.70 10-17 前后被重装/回收(443 拒握手、80 变 nginx 默认页、
  SSH 主机密钥变了),老师开播报「服务器不接受证书 / access control checks」。新机 CentOS 7(`ssh feiying-live`),
  SRS 5 docker + nginx 1.26 + Let's Encrypt(acme.sh 自动续),DNS 17:02 已切。细节与坑见 deploy/srs/srs.conf 注释
  (生产 candidate 填公网 IP + api_as_candidates off)。SRS 管理 API 经 nginx 只放行主应用 42.193.250.250。
- ✅ 没做完老师布置的任务就没有「学习报告」(2026-10-22,用户原话): 分类学习结算页(每组小结 + 整单元结算)的
  「📸 生成学习报告,发给家长」改成**今天的任务全部达标才出现**。判据不另写一套,读 `GET /student/today-report`
  (与「今日学习报告」同一份: 今天开放的单词作业含在家做的 + 句子/音标视频/每日复习作业;failed 算没做完;
  **今天没布置任务 = 照常给**;之前几天没做完的旧作业不算 —— 跟今日报告同口径,两边才不会一个说做完一个说没做完)。
  函数 utils/todayReport.learningReportGate。进结算页查一次、作业交卷后(finally)再查一次 —— 这份可能就是最后一份;
  交卷中 / 重查中显示「正在…」,别拿交卷前那份数据说「还差 1 份」;连发请求只认最后一次(seq)。
  没做完时按钮的位置换成一句「老师今天布置的任务还有 N 份没做完」+「再查一次」(只藏按钮孩子会以为功能坏了);
  查询失败也不放行(写明查不到 + 重试);接口 403(老师备课进来)不拦。报告图是前端 canvas 现画的,本来就没有后端端点,
  所以闸门只在前端。公告只投老师(学生在结算页就地看到原因)。
- ✅ 全站补例句 + 挖空规则加强(2026-10-23,用户「所有的都需要生成不只小学的」,接上一条空单元):
  例句用用户提供的第三方中转(hk.hueling.cc,Claude 模型)在**本地**生成,key 只放本机临时文件、用完删,不进服务器配置/git。
  阿里云百炼(qwen3.8-max)10-11 起欠费 Arrearage,线上 AI 例句一直降级为模板句「I like to use X.」(选词填空等),**仍待用户充值**。
  流程: 生产只读导出缺例句的释义行 → 按(拼写, 去词性的释义)去重成组 → 生成(小学单条请求;其余每请求 12 词、按学段给要求)
  → 用前端真实挖空代码 node 跑一遍筛(挖不出/超长/答案重复出现/模板句)→ 坏的带提示重生 → 生产 dry-run → .backup 整库
  → 只往 example_sentence 仍为空的行写(先导原值 CSV)。**小学 14 本已写入**: 4353 条释义(1636 组),
  备份 /root/eh_db_before_examples_20261023_1957.db + /root/example_fill_backup_20261023_1957.csv。
  **其余学段 10-23 21:35 已写入**: 47,862 组生成 → 检查长度按学段卡(小学 15/初中 18/高中 22/大学 24 词,统一卡 15 会误杀 5 千句)
  → 挖不出/答案重复的 410 组带「上次错在哪」提示重生两轮 → 合格 47,540 组 = 81,389 条释义;备份
  /root/eh_db_before_examples_all_20261023_2135.db + /root/example_fill_backup_20261023_2135.csv。
  写完全站 1633 个单元**每个都有带例句的词**(之前 1499 个一道填句都出不了)。仍缺例句的 322 组是词条本身挖不出空
  (depend on/upon、a.m.、tyre, tire、A as well as B 这类斜杠/括号/逗号/A B 占位),照旧不出题。跳过: 带 sb/sth/one's/... 的短语(挖不出空)、
  unit_words 指向已删除书的 5.1 万行(39 个书 id 已不存在,学生进不去)。
  挖空规则(前端 utils/blankSentence.ts 与后端 app/utils/blank_sentence.py **同一份**,测试解析前端文件核对不规则表一致):
  连字符词算一个词(T-shirt/hard-working)、be 动词各形式(be good at → is good at)、更多不规则动词/名词复数、
  -ing/-ed 双写辅音还原(getting→get)。小学批次挖不出空从 26 降到 2。
  顺修: generate-unit-quiz / generate-quiz-from-words 的 fillblank 与单元考试例句填空原来用 str.replace,
  遇到变形就把答案原样留在题面、还会把 great 里的 eat 挖掉 → 改走 blank_out,挖不出就跳过该词;
  单元考试例句填空的正确答案改为空里的形式(moved to)、判分不区分大小写(句首 Happy)。
  测试 tests/test_blank_sentence.py(14 例)
- ✅ 句子填空空单元(2026-10-23,用户「为什么有的句子填空啥也没有,有些书里」→「按你建议」):
  不是 bug,是**词库没有例句**: 全站 66 本书 1633 个单元里 1499 个一道填句都出不了(47 本书几乎全无例句,
  含人教版三~六年级单词/短语、7天背完小学1000词、小学3-6年级总复习、初中3500词、托福/四六级/考研等大词表)。
  以前空单元一打开就「完成 0%」并**记已完成**(completed_words 顶满 → 书级进度被抬高)。改:
  /student/books/{id}/progress 每个单元加 has_examples(单元里有没有带例句的词),单元页「填句」置灰 + 「暂无例句」;
  SentenceFillPractice 一道题都没出时**不调 updateProgress**,显示「这个单元还没有例句,先去练听写或测试」。
  **存量已清(10-24 14:22,用户「按你建议」)**: 补例句前落在无例句单元的 186 条 sentencefill 进度里,删掉 184 条(59 个孩子,
  178 条是假「已完成」);另 2 条孩子补例句后真做过,没动。这些单元上 sentencefill 学习记录为 0,只删进度不碰别的。
  备份 /root/eh_db_before_sfprog_clear_20261024_1422.db + /root/sentencefill_progress_cleared_20261024_1422.csv(整行)。
  补例句(第 2 步)10-23 已做完,全站单元都有例句了,见上一条「全站补例句」。
  测试 tests/test_sentencefill_records.py 加 has_examples 一例
- ✅ 句子填空改版(2026-10-23,用户「基础巩固的填句应该怎么设计,填错没有提示正确答案也没有」→「按你建议」):
  查到五个问题: ①判完再按一下回车就跳下一题(按住连跳),答案一闪而过 —— 用户说的「没有正确答案」多半是这个
  ②判原形不判句中形式: 生产填句 850 个单词里 120 个(14%)例句里是变形(help → "He always helps others."),
  写 helps 判错、写 help 判对;另 27 个只差大小写(句首)③错了只给一个词 ④错题下一轮原样再考 ⑤**一条学习记录都不写**
  (88 个孩子做过 260 个单元)。改: 判分真源 frontend/src/utils/sentenceFill.ts(挖空和判分同一个 findBlankRange 区间,
  大小写不算错,写原形单独标 baseForm);SentenceFillPhase 重写: 第一次错只给提示(首字母+字母数 / 「要变个样子」)再写一次,
  第二次错或点「不会,看答案」→ 正确词绿色填回句子 + 逐字母对比 + 自动朗读句子 + **照着写对一遍才能下一个**;
  防误跳(出答案 1s / 判对 0.4s / 换题 0.35s 内回车点击不算、按住不连跳、输入法组字回车不算)。
  记录: 每个词**第一轮第一次作答**记 learning_mode='sentencefill'(写原形记为错、放弃也记错),重试/后续轮次/
  结束页「错的再练一遍」都不记;后端 SCORING_MODES 加 sentencefill(正确率/薄弱词/陪跑/今日报告都按它取数),
  today_report.SPELLING_MODES 也加了(能显示「写成了 xxx」)。结束页错词回顾显示整句+当时写的。
  **单元完成发币不受影响**(ENABLE_UNIT_COIN=False)。测试 tests/test_sentencefill_records.py + test_today_report 加 1 例;
  浏览器走通: 原形提示 → 二次错出答案 → 连按回车不跳 → 订正写错不放行 → 第二轮 → 结束页;「错的再练一遍」0 条记录。
  **10-23 晚界面放大**(用户「填句的 UI 设计大点好看点」): 卡片 max-w-2xl、例句 22/30px;句子里的空按字母画成格子,
  **边打边填进格子**(不用在句子和输入框之间来回看),一个词一组不断行、长短语可在词间换行;输入框改大圆角 h-16/72px;
  判对出绿色对勾卡,出答案卡里正确词放大到 4xl/5xl。只改渲染,判分/防误跳/记录逻辑未动。390 与 1366 宽都看过,无横向溢出
- ✅ 管理端「一键更新」停用(2026-10-23,用户贴控制台 409「检测到本地未提交改动,已阻止版本更新」→「按你建议」):
  根因: 9-13 之后线上一直是「本地 → rsync 同步文件 → systemd 重启」,**不经服务器 git**,服务器 git 记录停在 2b5ad4a(09-13),
  `git status` 有 64 个已改文件 + 10 万多个未跟踪(dist_bak_* 备份目录、venv_judge),防覆盖闸门拦下是对的 ——
  否则 `git reset --hard origin/main` 会用仓库覆盖线上(main.py / database.py 生产本就和 HEAD 有差异)还在服务器上编译前端。
  「有新版本」也恒为误报。改: system_update.py 默认停用(环境变量 SYSTEM_UPDATE_ENABLED=1 才开):
  /check-update 恒无更新、**不碰 git**(以前每次打开管理端首页都带着凭据 git fetch);/update 返回 410;
  /version 改报线上真实的前端构建号 + 部署时间(frontend/dist/version.json 的内容和修改时间)+ 后端最近重启时间。
  前端: 管理首页去掉「有新版本」按钮和「当前版本 v1.6.x」卡,换成「最近部署」;系统设置的「系统更新」面板换成只读「版本信息」。
  ⚠️ **服务器 git remote 的 URL 里明文写着 Gitee 账号和密码**(能登录服务器的人都看得到),已提醒用户改密码、改用只读部署密钥,未动。
  要重新启用一键更新得先把服务器 git 对齐线上(reset 到线上实际内容、.gitignore 掉备份目录、处理 main.py/database.py 的 drift)。
  测试 tests/test_system_update_protection.py 加 3 例(停用时不跑任何 git 命令 / 更新 410 / 版本接口报真实部署时间)
- ✅ 学生自注册机构码必填(2026-10-23,用户问「雪域飞鹰才 200 多用户,总共 800 多哪来的」→「机构码需要必填,登录时告诉管理员机构码在哪看」):
  查到直营 794 个学生里 207 个在班、52 个离过班、**535 个从没进过任何班**(519 个有手机号,4–8 月自注册,7 月 228 个;
  近 90 天还有 262 个学过、近 30 天 9 个)—— 注册不填机构码默认归直营。机构列表「活跃学生」数的是在班的,所以只显示 200 多。
  改: `POST /auth/register` 不填 → 400 org_code_required;填错 → org_code_invalid;机构停用 → org_inactive,都不建号;
  大小写/首尾空格不敏感。**不改 resolve_org_code**(测评/线索那几处还要「无效码兜底回直营」),注册这里单独查。
  直营学生填直营机构码 HQ001。注册页机构码框改成一直显示且必填(以前只有链接带 ?org= 才显示),链接打开自动填。
  告诉管理员: 公告两条(org_admin「机构码在首页第一张卡」/ admin「各机构码在机构管理列表」),机构首页机构码卡写明「学生自己注册必须填机构码」。
  **存量 535 个没动**(没进班、算在直营,要不要分班/停用待用户定)。家长注册、老师/机构建号不受影响(它们不走这个端点)。
  测试 tests/test_register_org_code.py(5 例;改回「无码兜底直营」恰好 4 例失败,回归锁验证过)
- ✅ 音标兑换码: 码不过期 + 生成即占额度、删除不退(2026-10-22,用户查「曲靖会泽是不是生成音标码了」→
  「生成后兑换了才开始记时间,删除后额度不能返回,你修改下」): 查到会泽管理员 16:37 生成 10 张、一分钟内逐张删掉,
  旧规则删了就退额度,机构可以反复生成、删除。改了三处: ①**码本身不过期**: batch_generate_phonetic_codes 的
  code_valid_days 默认 None → code_expires_at=NULL,卡的天数本来就从兑换那天算;生产存量未用码的 code_expires_at
  一并清空(改前值备份在 /root/phonetic_code_expiry_backup_20261022.csv)②**额度 = 生成过的张数**
  (org_service.count_issued_phonetic_codes 与机构列表 GROUP BY 同口径),**禁用也不退**(用户只说了删除;禁用若退,
  改点禁用就绕过去了)③**删除改软删** status=deleted: 行和开哪几节的明细都留着(id 不回收、数得到额度、留生成记录),
  列表默认不显示、状态筛选「已删除」看得到,学生兑换提示「已作废」,已删除的不能再禁用。机构生成前多一道确认
  「生成后禁用或删除都不退回」。**只改了音标码**,单词本兑换码/学习卡额度仍是删除退回(用户没提)。
  上线时生产机构码只有罗平 2 张未用、没有禁用/删除过的机构码 = 现有额度数字零变化;会泽当天删掉的 10 张是旧规则硬删的,
  已经退回,仍剩 100。测试 tests/test_phonetic_code_quota.py 加 3 例 + test_phonetic_single_video_code 改 1 例
  (改回「禁用不算」/ 硬删 / 码 180 天过期 / 列表显示已删除 四处守卫逐一破坏各自对应用例失败,回归锁验证过)
- ✅ 招商手册 / 合作协议「一次付清」版(2026-10-22,用户「之前不是有个 6w 分期的吗,我还需要一份去掉分期的方案给特殊能力强的加盟商」):
  加盟资料多两个标签「招商手册(一次付清)」「合作协议(一次付清)」,**同一个组件传 fullPay**(FranchiseRecruitDoc / ContractDoc),
  只有付款相关处不同: 协议副标题、第三条第 2 款(签约付 ¥60,000、当日开全部 300 张 + 赠 5本卡 10 张、方法课 12 套一次交付)、
  第 3 款补货前提、第 5 款方法课交付、第 7 款付款方式、费用表两行,去掉「逾期宽限」那条待确认;招商手册第六章换付款表和要点。
  价格、卡种、张数、赠送与分期版完全一致,**赠送 10 张 = card_pack.BONUS_FULL_PAY**,开通时平台「卡包到账 → 一次结清剩余 3 期」
  系统会自动开 300 张 + 10 张,不用改后端。改赠送先改 card_pack.py,再改两份文档。只给平台 admin(partner=false)
- ✅ 加盟资料新增「抖音直播招生方案」(2026-10-22,用户「陪跑做抖音直播引流话术怎么说定价怎么定…培训员工和主播」→
  「9.9 是不是太便宜…高级老师 8000 每月」→「生成个文档放在管理端和招商加盟那里」): pages/FranchiseDouyinDoc.tsx,
  加盟资料第六个标签「抖音直播招生」,**只给平台 admin**(DOC_TABS.partner=false: 第四章有用人成本和利润测算;
  要给加盟商,先让对方把参数换成自己的)。入口: 管理端首页「运营工具箱 → 组织与人员 → 抖音直播招生」/ 加盟资料顶部标签。
  卖「看得见的督学」不卖「提分」: 产品全是系统里已有、能当场演示的(每日任务+每日复习 20 词、每日陪跑点评、没来当天提醒、今日学习报告)。
  十一章: 红线 / 卖给谁卖什么 / 产品价格 / **成本与定价测算** / 直播间流程 / 逐段话术与禁用词 / 短视频 / 体验营 7 天交付 /
  岗位绩效 / 漏斗复盘 / 上线前确认。三个要点: ①**价格与成本只在 DEFAULT_PARAMS 一处**,第四章 <input> 可改(存 localStorage
  fk_douyin_params_v1),全文价格/利润/保本单量/话术数字跟着变;input 的值会进 PDF(cloneNode 带当前值),「恢复默认值」按钮
  data-html2canvas-ignore 不进 PDF ②默认价: 体验 9.9 / 30 天 780 / **90 天 1,680 主推**(学满 5 天立减 100)/ 180 天 2,980 /
  一对一 3,980 / 续 90 天 1,480 —— 上一版口头给的 90 天 980 按 8,000 高级老师成本算不赚钱,已改。**「每个孩子每天 1.5 分钟」是估的**
  (上线时生产 coach_notes 0 行),投流费/转化率没数据按 乐观/中等/保守 三档算,另有「实测」两格填了多算一列
  ③红线依据广告法第 24 条 + 湖南省市场监管局 2026-09-23 合规提示(不承诺效果/不用受益者证明/不渲染焦虑/优惠写明期限数量);
  双减定位「背单词软件 + 督学服务、直播不讲课」,**抖音类目资质与是否需审批没核实**,第十一章留待确认栏不替用户定。
  PDF 坑: html2pdf 的 css 分页对 <table> 上的 break-inside 不生效(实测表格被拦腰切),要包一层 div 把 breakInside 挂在 div 上
- ✅ 句子/音标/复习作业算进「今天的任务」(2026-10-22,用户「按你建议」): 此前陪跑看板和今日学习报告只数单词作业,
  老师布置了音标视频/每日复习,孩子没做看板照样显示「做完了」、报告照样「全部完成」。
  判定抽成唯一真源 services/content_homework.py(refresh_completion / status / target_names / open_day),
  作业接口、看板、今日报告三处读同一份 —— 各判一遍会出现作业页说做完、看板说没做完。
  ①**一批学生一起判**: 每种内容一条查询(user_id IN × 目标 IN),按 (学生, 目标) 精确对;只按目标对的话
  A 看完了 B 也算完成(测试锁住)②**每日复习作业的完成时刻 = 那一份最后一个词当天第一次练到的时刻**
  (daily_review._first_times / completion_times),不再是「被谁打开作业页看到的那一刻」—— 今日报告的
  「几点完成」读它 ③看板 tasks_total/tasks_done 含这类作业,每行另给 other_tasks(名字 + 做没做完),
  前端显示小标签;提醒家长改写「学习任务」并点名没做的那几份;草稿写「音标视频「…」还没做」
  ④今日报告: 今天开放的算 today_total,没做完不能 all_done;之前开放、今天做完的列为补做;
  这类作业**没有分数**(kind≠word),图上写「✓ 完成」、不拿 0 分拉低档位 ⑤昨天开放的、已关闭的、内容被删的都不算今天的任务。
  测试 tests/test_content_tasks_everywhere.py(6 例;按学生配对 / 看板计数 / 报告计入 / 复习完成时刻 / 视频完成时刻取最后观看 五处守卫逐一破坏各自对应用例失败)。视频作业完成时刻 = max(开放, 最后一次观看),昨晚看完不会被写成「今天补做」
- ✅ 每日复习一天一小份 + 可布置成作业(2026-10-22,用户「继续」,陪跑之后的第二项): 先查的生产实情: 近两周在学的
  93 个孩子人均攒 817 个到期没复习的词(51252 个已过期 30 天以上);首页「先复习 20 个」按到期时间最早取 →
  全是几个月前的旧词,88 个有「两周内刚学、今天到期」词的孩子里 55 个,这些词排在前 100 名之外永远轮不到。
  规则真源 services/daily_review.py: ①**一天一份 20 个,第一次打开时挑好存下当天不变**(表 daily_review_plans,
  UNIQUE user_id+plan_date,并发建走 ON CONFLICT DO NOTHING 不 rollback)—— 现算的话做完 10 个回来又冒出 20 个,
  永远做不完 ②候选 = 到期且今天没练过,按拼写去重(取掌握度最低那条)③「两周内练过」的先挑、最多 15 个,
  其余留给旧积压(错过的优先、上次练习近的优先)—— 生产副本实测平均词龄 63 天 → 12 天
  ④**做了几个看 learning_records 当天有没有记录**(复习页、单元学习练到都算),不看 word_mastery.last_practiced_at
  (第二天的练习会覆盖它,事后算不对前一天的份)⑤全做完写 completed_at 只写不清;今天没有到期的词 = 空的一份直接算完成;
  词被删了不算进份子。`GET /student/daily-review?words=true`(app/api/v1/daily_review.py,main.py 挂一行,生产 drift 走 anchor patch)。
  作业: 复用句子/音标那套 content_homework,新 kind=`daily_review`,target_id=0,「连续几天」1–31 天一天一份
  (标题「每日复习 · M月D日」,截止当天 24 点),完成 = 那天的份做完(`completed_days`);**不碰单词作业表**(不发金币、不进单词数)。
  陪跑看板每行带 daily_review(只读已有的份,不替孩子建),草稿写「今天的 20 个复习词也做完了」/「明天先把今日复习的 20 个词做完」。
  前端: 首页 Hero「今天,先复习 N 个」与「开始复习」都走这一份(utils/startReview 与复习页共用);复习页顶部「今天这一份」卡,
  有份时原来的三档分组降为「做完还想多复习」;教师作业页按钮改「布置句子 / 音标 / 复习作业」。
  生产库副本实测: 每人挑一份 16.8ms;API 回环验过 复习 12 个 → 剩 8 个顺序不变 → 做完 → 当天作业完成、其余天锁着 → 看板 20/20。
  入口: 学生首页「今天,先复习」/ 底部「复习」→ 顶部「今天这一份」;老师「作业管理」→「布置句子 / 音标 / 复习作业」→ 选「每日复习」。
  公告学生/老师各一条。测试 tests/test_daily_review.py(5 例;改回按到期最早取 / 每次重挑 / 认别的日子的份 各自对应用例失败,回归锁验证过)
- ✅ 每日陪跑(2026-10-21,用户「一对多/一对一陪跑怎么设计」→「主要能让学生学习效果提高」→「先把陪跑做起来」):
  先查的生产实情: 直播 8-26 上线当天 3 场之后再没开过;近 28 天学过的 143 个孩子 78 个只学了 1–2 天,
  在家作业完成率 55%(电教室 68%),在学的孩子人均攒 817 个到期没复习的词;而隔 3 天以上再拼的词 92.9% 还对 ——
  缺的是「回来」不是「讲课」,所以陪跑做成异步督学,**没做直播/视频**(直播只建议留作每周讲评,用现有模块)。
  默认口径(用户没回答,按建议定): 陪跑 = 各机构自己的老师/助教,暂不单独收费。
  口径真源 services/coach.py,状态互斥按「越该先管越靠前」排: absent(2–14 天没学,刚断两三天的排最前 —— 最拉得回来)
  → not_started(今天还没学)→ in_progress(任务没做完)→ done → gone(15 天以上/从没学过,排最后)。
  **gone 单列是实测出来的**: 生产主账号 206 个学生里 115 个是往期集训营/「未交费」班的久不来号,跟 absent 混在一起
  会把能拉回来的 75 个埋掉。另有不互斥的 struggling(今天计分题 ≥10 且正确率 <70%)。
  「最近一次学习」看 study_calendar(生产 14 天里每个有学习记录的日子都在日历里,反查 0 缺,且覆盖句子/音标);
  词数/时长走 daily_words / study_time,今日任务与 today_report 同口径: 单词作业 + 今天开放的句子/音标视频/每日复习作业
  (10-22 补上,见下方「句子/音标/复习作业算进今日任务」)。
  点评表 coach_notes(models/coach.py,新表 create_all 建): **一个孩子一天一条**(UNIQUE student_id+note_date,
  再写是改不是追加),改了内容清掉孩子/家长已读;teacher_id 存主老师、author 存真实账号(助教写的落款是助教)。
  草稿是规则生成的(不调 AI): 几份任务、几个词、哪几个词拼错、明天做一轮「今日复习」;**一份没做完时不写「完成了 0/1」**。
  「复制提醒」= 给家长的微信话术(生产没短信没服务号,只能老师自己发);**不做「复制全班没做完名单」**(发群里等于点名)。
  点评不进操作记录(一天几十条会淹掉追责日志)。API app/api/v1/coach.py(main.py 挂三个 router,生产有 drift 走 anchor patch):
  老师 `GET /teacher/coach/board`、`PUT/DELETE /teacher/coach/notes/{sid}`、`POST /teacher/coach/notes/batch`(有一个不是本班整批 403);
  学生 `GET /student/coach-note`(最近 3 天最新一条,看了记已读);家长 `GET /parent/children/{id}/coach-notes`(两周)。
  生产库副本实测: 206 人看板 75ms(首次 0.7s)。浏览器验过: 老师发草稿 → 学生首页「老师今天对你说」、家长端「老师的点评」
  → 老师看板「孩子已看/家长已看」→ 改了重发已读清掉;手机宽度三端都看过。
  入口: 教师工作台「课堂推进 → 每日陪跑」/ 顶部「更多 → 每日陪跑」;学生首页 Hero 下方;家长端周报上方。公告老师/学生各一条。
  测试 tests/test_coach.py(5 例;去掉本班校验 / 改内容不清已读 / 断得最久排前 各恰好 1 例失败,回归锁验证过)。
  **未做(三期)**: 每周直播讲评;一对一个性化计划;陪跑卡收费
  (每日复习、句子/音标作业进今日任务 10-22 已做)
- ✅ 家长绑定修复 + 老师发链接(2026-10-21): 用户「让家长参与进来」。**先查清生产 0 个家长的根因**: 一年 363 个绑定码、
  31 次打开注册页、5 次提交**全部失败**(10-18 有位家长 5 分钟内试了 3 次,400 响应 82 字节 = 正好是
  「该手机号已被其它角色注册」)—— **孩子的学生号注册时填的就是家长手机**(生产 793 个学生 768 个有手机号),
  家长注册原先跟所有角色查重。修法: ①手机号**只和家长号查重**(学生/老师之间仍查重,
  auth_service.get_user_by_phone 现在排除 parent);模型去掉 phone 的 unique(生产库这列本来就没唯一索引,
  家长之间靠 username=parent_{手机号} 唯一兜底,并发撞上回 400)②**同号两账号时主登录页不能 500**:
  authenticate_user_strict 原先 scalar_one_or_none,现在逐个试密码(用户名精确匹配优先、学生老师优先于家长);
  家长在主登录页登录 → 进 /parent/dashboard(Login.tsx + DashboardRedirect 都加了 parent 分支)
  ③已有家长号拿二孩的码再注册: 密码对直接绑上,密码错**不吞码** ④学生码 5 分钟 → **24 小时**,
  随之 6 位 → **8 位数字**(6 位 24 小时按 50 个同时有效码算一天能猜中 0.7 个),并加**全站输错闸门**
  (10 分钟错 100 次整体 429,换 IP 绕不过)+ 单 IP 30 次/10 分钟 ⑤家长 token 30 天(原 7 天,家长一周才看一两次)。
  **老师端新页 /teacher/parent-binding**(pages/TeacherParentBinding.tsx,后端在 parent.py 末尾):
  本班学生按「未绑定在前」列出;「复制链接」= 8 位码(首字符必是字母,与学生的纯数字码区分)7 天有效、
  **已有没用掉的再点还是同一条**(老师可能已经发出去了),「换新」才作废旧码(作废=让它过期,used_at 只给真被用);
  「打印绑定条」批量出二维码条让孩子带回家;家长忘密码老师可重置(**只在这个家长绑的每个孩子都在本班时放行**,
  否则等于进得去别班孩子的家长号)、可解绑(家长号不删)。三个动作都进操作记录(parent.*,手机号脱敏)。
  链接**一人一条私发**,页面和公告都写了别发家长群(谁点开都能绑上这个孩子)。
  入口: 教师工作台「激励与复盘 → 家长绑定」/ 顶部「更多 → 家长绑定」;学生端光荣榜原入口文案改成 24 小时;
  公告老师/学生各一条。测试 tests/test_parent_binding.py(9 例;只和家长查重 / 登录挑账号 / 全站闸门 /
  重置密码的跨班判断四处守卫逐一破坏各自对应用例失败,回归锁验证过)。浏览器验过(库副本,学生号设成
  家长手机): 老师复制链接 → 手机宽度打开码已填 → 同手机号注册成功进家长端 → 老师页显示已绑定、重置密码后
  家长端/主登录页都能登、学生原密码仍登学生号;打印绑定条 26 张二维码
- ✅ 句子 / 音标视频作业(2026-10-21,用户「系统再加什么好」→「按你最好的建议」): 查的生产实情:
  近 30 天 1045 份作业**全是单词分类**;句子背诵从来没有真实学生练过(sentence_mastery 0 行;9 次上报是测试号和误点,
  不是数据丢了);两周学过的 96 人里音标视频 11 人。原因: 作业只能选单词单元,老师布置不了。
  **单开两张表** content_homework / content_homework_students(models/content_homework.py),不碰 homework_assignments:
  那张表 unit_id NOT NULL 外键到单词单元,金币分母、每日单词数、比赛模式、单元解锁、今日报告十几处都按它 join,
  塞进去要么重建表要么造假单元。API 在 app/api/v1/content_homework.py(老师 /teacher/content-homework*,
  学生 /student/content-homework),main.py 挂路由(**main.py 生产与 HEAD 有 15 行漂移(live 相关 import 位置),
  只能补丁式改**;表靠 import 模型后 create_all 建,没动 database.py —— 它也漂移)。
  **完成不由前端报**: 列作业时按真实数据现判、写 completed_at 只写不清 —— 句子 = 全部组过过 + 作业开放后
  sentence_unit_progress.updated_at 刷新过(复习从第 1 组重来过一组就算);视频 = phonetic_video_views.completed。
  不发金币、不进单词数;只能布置给本机构学生、本机构或平台共享的内容(测试锁住)。
  前端: 教师作业页顶部 components/teacher/ContentHomeworkPanel(单独弹窗,不塞进单词作业那个大弹窗),
  学生「我的作业」顶部 components/student/ContentHomeworkList;视频「去完成」用 navigate state openVideoId 直接开那一节。
  浏览器验过: 老师布置句子单元+音标视频 → 学生看到两条 → 去完成分别进单元学习页 / 打开那节播放器 → 学完两边都显示已完成。
  测试 tests/test_content_homework.py(5 例)
- ✅ 宠物三处修复(2026-10-20,用户「宠物还有什么建议」→「按你建议」): 先查的生产实情: 444 只在用宠物,
  ①**真人对战打不起来、收服从没成功过**: 9 月以来 2953 场对战收服 0 次;真人对战被接受的 104 场里 56 场一回合没打。
  根因: 接受方点「接受」直接跳进对战页、在 WS 端等 30 秒「对手未连接」后被踢,**发起方毫不知情**
  (大厅只轮询「别人发给我的邀请」)。修: 新增 `GET /student/battles/ready`(我发的、30 秒内刚被接受、还没打回合的那场),
  大厅在有等待中的挑战/刚发出 70 秒内每 3 秒问一次,有就自动进场;邀请列表不再列已过期的。
  双浏览器验过: 接受后 1 秒内发起方自动进场,两边都开打。
  ⚠️ 收服还有第二道坎没动(要用户定): 46 场有胜者的真人对战里,胜者**没有一个**有空队伍格 —— 第 2 格要学满 2000 词,
  443 个有宠物的学生只有 51 个过 2000 词。所以对战修好了,收服在多数孩子身上仍不会触发
  ②**受伤自己好**: 每小时恢复最大 HP 5%,到 80% 解除(0 血约 16 小时);起点读最近一条 injured 日志里的「当前HP: x/y」,
  和现有血量取大、按时间算(幂等)。在 GET /pet、治疗状态、发起/接受/快速对战入口都先算一次(否则休息好的仍被「受伤」挡住)。
  治疗页加「不答也没关系,休息约 N 小时它会自己好」。**去掉了「≥2 天不来且饱食度 ≤15 → 挨饿受伤」**:
  受伤的 237 只里 181 只主人 30 天以上没来,这条在把回来的孩子往外推。受伤现在只来自对战
  ③**赚粮按服务端记录**: earn-food 不再信前端 score/total,按上次领粮后(最多回看 2 小时)本人 learning_records 的
  条数和正确率算;没有新记录 0 粮且不记日志(不占首练加成);句子练习不写 learning_records,改看 sentence_mastery.last_practiced_at,
  练过给基础粮、正确率档按 0。生产 10 月以来 1063 次领粮只有 8 次对不上记录,口径吻合。
  测试 tests/test_pet_fixes_1020.py(9 例)。**未做**: 7 月刷出来的数据(Lv107 / 84.7 万粮那位、AI 训练师 920 万粮)等用户定怎么处理
- ✅ 音标视频「流畅」画质(2026-10-20 14:44 **已部署生产**,phonetics.py / teacher/phonetics.py / video_faststart.py
  生产==HEAD~1 整推 + 新文件 video_lite.py、scripts/gen_phonetic_lite.py,systemd 重启;dist 整推;备份
  /root/eh_code_before_lite_20261020_1440.tgz、frontend/dist_bak_20261020_1444,构建号 mvgba116。
  **存量 42 节的流畅版定在 10-21 03:47 跑**(eh-phonetic-lite.timer,在 03:17 faststart 之后;日志 /root/eh_lite_20261021.log),
  跑完前播放器只有高清(没有流畅版的视频不显示画质按钮);白天有人看时服务会一节节慢慢补(1 线程)。音标播放器第二步): 每节另压一份 480p 低码率副本放在原片旁边
  (`{原片名}.lite.mp4`,不进库,有没有看文件在不在;列表下发 has_lite)。参数在服务器实测过:
  libx264 veryfast crf30 maxrate 300k,1080p 2002→196 kbps、720p 721→201 kbps,白板字和音标符号截帧看过清楚;
  **声音原样拷贝不重压**(音标课听发音是正事)。压完 ≥ 原片 70% 就不留、写 `.lite.skip` 不再压。
  串流 `?t=票&q=lite`(票只绑视频不绑画质,切画质不换票);没有流畅版 404,前端退回高清并接着原处放。
  何时压: 上传后(先 faststart 再压)、学生换票时发现没有就排一个(白天 1 线程、夜里 2 线程,nice 19,一次一个,
  失败过的本进程不再试);存量走 scripts/gen_phonetic_lite.py(只在 23–7 点跑,--any-time 强制)。
  删视频两条路径都连带删流畅版。前端: 左上倍速旁「高清/流畅」按钮,选择按用户记住;
  **默认高清,2 分钟内卡顿 2 次自动换流畅并提示「换回高清」,自动换的不记成偏好**;孩子手动选过就不再自动换;
  缓冲提示里直接给「换流畅」。预加载下一节按当前画质取开头(换了画质已预加载的那节会换成另一档)。
  测试 tests/test_video_lite.py(5 例)。浏览器验过: 720p→480p 切换接着原处放、两次卡顿自动换、预加载与切换都走流畅版
- ✅ 音标播放器: 倍速 + 选集 + 预加载下一节 + 索引挪到文件头(2026-10-20 13:52 **已部署生产**,phonetics.py / teacher/phonetics.py
  生产==HEAD~1 整推 + 新文件 video_faststart.py、scripts/faststart_phonetic_videos.py,systemd 重启;dist 整推;
  备份 /root/eh_code_before_player_20261020_1348.tgz、frontend/dist_bak_20261020_1351,构建号 mvg9fnnp。
  **存量 42 节的 faststart 定在 10-21 03:17 自动跑**(systemd-run 一次性定时器 eh-phonetic-faststart.timer,
  日志 /root/eh_faststart_20261021.log,原文件硬链接到 private_media/phonetics_bak_20261021;
  **10-25 已删**(42 节全部 faststart 成功、10-21 起每天正常 206 播放,用户同意删,释放 3.6GB)): 用户「要不要加倍速画质选集」「是不是还要预缓存」。
  先查的实情: 约七成播放在 Windows Chrome(原生倍速藏在 ⋮ 里),42 节都是 720p 为主、码率中位 0.67 Mbps,
  服务器出口 12M ≈ 18 人同时看就满 —— 卡是带宽不是清晰度;**42 节 mp4 的 moov(索引)全在文件末尾**,
  点开要先跳到文件尾取索引。这一批做了四件,画质「流畅」档(另转 480p)留作第二步未做:
  ①倍速 0.5/0.75/1/1.25/1.5(不给 2x,音标要看口型),按用户分键记在本地,换 src 后在 loadedmetadata 补回;
  controlsList 加 noplaybackrate 关掉 Chrome 自带那个。「看完」按内容秒数判,观看时长记内容时长不是墙上时间
  ②选集: 顶栏 上一节/n/m/下一节 + 右侧(手机底部)列表,**只列同一位老师**(选了老师按选的,没选按正在看的这节),
  顺序 = 分类 → 后端 sort_order(老师「调整顺序」排的);看完倒数 5 秒自动下一节(讲义开着/下一节锁着不自动),
  切换走 openVideo 同一条路(判锁/续播/讲义),连点只认最后一次(openSeq)
  ③预加载: 剩 60 秒且过半时用 `GET /ticket?prefetch=1` 给下一节换票 + 隐藏 `<video preload=metadata>` 取开头;
  **prefetch 绝不扣次卡**(今天要扣的 409 不签,点开时照常扣),预取的票跨天作废、剩不到 10 分钟作废;
  ⚠️ **串流不许带 Cache-Control**(10-20 线上事故,15:23 已修,提交 2fc803e): 一开始给串流加了 `private, max-age`
  想让浏览器复用预加载的开头(本地 CDP 验过 fromDiskCache),上线后 **Mac Safari 连开几节都播不出来**。
  根因: 生产 nginx 在 http 级开着 proxy_cache(宝塔默认 proxy.conf),它把浏览器的 Range 删掉、拿整文件回包
  自己切片,且**只对可缓存的回包切片** —— 带 private 就不切,每个 Range 请求都回 200 整文件:
  Safari 要求 206 直接失败,Chrome 遇到索引在尾的大视频要下完整个文件才开播。本地没有 nginx 复现不了,
  回归锁 test_stream_has_no_cache_control_but_strong_etag。只留强 ETag + Last-Modified。
  代价: 预加载的开头能不能被复用要看浏览器的启发式缓存,不再保证;提前换票那部分照常省一次往返。
  **不做整节预下载**(电教室共用带宽会更卡)也不做离线缓存(一节 87MB + 等于给出可拷走的原文件)。
  坑: 切节那一下元素还停在上一节结尾,它的 timeupdate 会配上新的「下一节」把下下节提前预加载 → onTimeUpdate 只认 currentSrc 是当前这节的
  ④faststart: services/video_faststart.py(-c copy -movflags +faststart,不重新压缩;时长/音视频流/大小三项校验,
  不对就保留原文件;同目录 os.replace 原子替换;一次只跑一个 + nice 19)。新上传落盘后后台跑;存量走
  scripts/faststart_phonetic_videos.py(--dry-run / --backup-dir 硬链接备份,跳过 10 分钟内有人看的那几节)。
  ⚠️ **存量要夜里没人上课时跑**: 正在播的文件被换掉,播放器按旧索引取数据会出错。生产实测 242MB 那节 13 秒。
  测试: test_video_faststart.py(3 例,ffmpeg 现做小视频)、prefetch 不扣次卡 2 例、串流缓存头 1 例。
  浏览器验过(临时库 + ffmpeg 造的视频): 倍速记住并跨节沿用、选集 1/3→自动下一节 2/3、切换后开头命中缓存、手机底部列表
- ✅ 音标视频排序按讲师分开排(2026-10-18 17:16 **已部署生产**,teacher/phonetics.py 生产==HEAD~1 整推 + systemd 重启;
  dist 整推(第一次 rsync 中途断线,--delay-updates 没换上半成品,重传后校验 0 差异);备份
  /root/teacher_phonetics_before_lecsort_20261018_1715.py、frontend/dist_bak_20261018_1715,构建号 mvdlyhxx): 用户「调整顺序有两个老师是不是得分开,现在混在一起不好弄」。
  生产直营入门总览 42 节 = Ella老师 21 + 佳佳老师 21,两人的课交错着排。排序弹层分类下加一排讲师标签
  (分类里有 ≥2 位讲师时出现,默认停在第一位;列表页正筛着某位讲师就停在她),每位只排自己的课,另有「全部混排」。
  后端 `GET /videos/order?lecturer=`、`POST /videos/reorder` 带 lecturer: ids 要恰好是这位讲师在该分类的全部视频
  (少了/混进别的讲师 → 409),**这位讲师的课按新顺序填回她原来占的那几个位置,别人的原地不动**,再整个分类重写
  10/20/30…(只给这几条写 10/20/30 会和另一位撞成并列)。讲师匹配与学生端同口径: 空/空白 = 未指定(NO_LECTURER)。
  不传 lecturer = 旧行为。测试 tests/test_phonetic_video_reorder.py 加 3 例(9 例);浏览器验过: 置顶 Ella 一节 →
  佳佳老师 4 节顺序、位置都不变,学生端列表同步
- ✅ 今日学习报告(2026-10-18 14:52 **已部署生产**,homework.py 生产==HEAD~1 整推 + 新文件 today_report.py,systemd 重启;
  dist 整推;备份 /root/homework_before_todayreport_20261018_1446.py、frontend/dist_bak_20261018_1452,构建号 mvdgnk6a): 用户「你应该增加个他背完所有任务的分享」。分类学习那张「学习报告」只管一个单元,
  一天三份任务要发三张;这张一天一张。`GET /student/today-report`,口径真源 services/today_report.py:
  ①今天的任务 = 今天布置、没关闭的作业,**含在家做的**(金币分母排除家里作业,但家长看的是老师布置了什么)
  ②全部完成 = 至少一份且每份 completed,failed 不算 ③今天补做完成的旧任务列出来标「补做」,不参与判定
  ④词数/时长走 daily_words / study_time 唯一口径 ⑤还要多练 = 今天计分模式答错过的词,按拼写去重;
  「写成什么」只取拼写类模式(选择题的 user_answer 是选项不是拼写)。配色档位按今天任务平均分(按「一次都没错」
  比例会出现「2/2 全部完成」配蓝色的怪图)。前端: 画法抽到 components/report/canvasKit(两张图共用)、
  弹层/保存/分享/复制抽到 components/report/ShareImageDialog,LearningReportDialog 改用它们(画面不变,验过)。
  入口: 学生端首页当天全部完成后出现绿色卡片「今天的任务全部完成,生成今日学习报告」;分类学习最后一份任务
  交卷达标后结算页也有。公告学生/老师各一条。测试 tests/test_today_report.py(7 例)
- ✅ 分类学习刷新后丢前几组(2026-10-18 13:32 **已部署生产**,纯前端 dist 整推;备份 frontend/dist_bak_20261018_1331,构建号 mvddwt7c): 用户「李思延背九上 Unit 4,学习报告只显示最后一组的 1 个词」。
  根因: 已学完的组只存在内存 allGroupResults 里,组内断点 classify_progress_* 每组过关就清,
  **刷新/重进页面后结算页、学习报告、整单元作业交卷都只算最后一次进页面之后那几组**。
  她 61 词分 4 组(20/20/20/1),上午整页加载了 14 次,第 4 组前刷新 → 报告 1 词、作业按 1/1 记 100 分
  (实际首答 57/61)。生产 10-04 起 488 份整单元分类作业里 222 份只按部分组判分(约 171 份当天其实学完了整单元),
  **历史成绩未回改**。修法 utils/classifyDoneGroups.ts: 每组听写交卷落一条 classify_done_{uid}_{unit}
  (组号/词 id/首答/分类/用时/本地日期),进页面只接**今天、词表对得上、紧挨当前组往前连续**的那段
  (换设备有缺口就不跨过去拼);过关检测/单元复习里刷新时当前组用时也接上;整单元结算后清掉,
  非今天的存档进页面时扫掉。复习/错题(unit 0)不存。用时改走 unitSeconds()(前几组 + 本次 netSeconds)。
  浏览器验过(临时库副本): 种 3 组存档进第 4 组 → 在过关检测、单元复习各刷新一次 → 结算 61 词 93%、
  报告「4 组全部学完 · 57/61 · 4 个要多练」、作业交卷 total_words=61 score=93、结算后存档已清
- ✅ 分类学习「学习报告」分享图(2026-10-17 20:20 **已部署生产**,progress.py 生产==旧版无 drift 整推、dist 整推;备份 /root/eh_code_before_report_20261017_2019.tgz、frontend/dist_bak_20261017_2019,构建号 mvccwqvx): 用户「家长不知道背了哪些…家长可以保存图片发在群里,
  知道这个孩子学了啥差啥还有什么建议」。结算页(整单元结算 + 每组小结都有)「📸 生成学习报告,发给家长」→
  弹层出一张长图: 机构名 / 孩子姓名 / 书名单元 / 分数与档位 / 词数·一次拼对·分钟 /「还要多练」(正确拼写 + 中文 +
  孩子当时拼成什么,划掉)/「给家长的建议」/「第一次就拼对」词表 / 落款机构名。长按保存、「保存图片」「分享图片」
  (navigator.share,微信内置浏览器没有就不显示)、「复制文字版」(剪贴板不给权限退回 prompt)。
  **AI 只出三张不带字的吉祥物插画**(public/report-card/{excellent,good,keep}.jpg,脚本 backend/scripts/gen_report_card_art.py,
  走 IMAGE_API_* 中转、白底放进白色圆徽章不抠图),字和词全部 canvas 现画 —— 生图模型画不准中文和单词表,且每张 15–60 秒按张计费。
  口径真源 utils/learningReport.ts: ①分数与结算页 overallRate **同一公式**(听写首答拼对率);组小结页点开算的是
  **本次会话已学几组合计**,图上写「第 1–2 组(共 4 组)」②只写「一次就拼对 / 还要多练」**不写「已掌握」**(当天拼对≠记住)
  ③建议是规则生成的家长动作(念中文让孩子默写 + 按拼错类型 漏字母/多字母/顺序/元音/大小写 挑最多的一类给一条),不承诺分数
  ④名字取 reportChildName(utils/learningReport.ts): full_name 优先,没填退回 username,**username 带数字不用**
  (常是手机号,图要发群里)。10-18 改的: 原先只认 full_name,而生产在读 793 人里 780 人没填姓名(763 人用户名就是中文真名),
  图上几乎都没名字 ⑤低分不用红色(当众难堪),用蓝色。
  画图在 components/classify/LearningReportDialog.tsx: 先排版算总高再建画布(改尺寸会清空);1.5 倍出 1125 宽,
  超 1200 万像素自动降倍率(iOS Safari 约 1678 万像素以上 toDataURL 出空图);多练封顶 20 行、拼对词封顶 40 个。
  **长按保存要过三道拦截**: usePreventCopy(JS)、页面根 .no-select(touch-callout:none)、main.tsx 学生端禁右键 ——
  图片带 `data-allow-save`(两处 JS 认它)+ `allow-select`(CSS 认它),其它文字照旧拦(验过);弹层走 portal 挂 body
  (结算页外层 framer-motion transform 会困住 fixed)。后端 `_build_unit_info` 加 book_name / org_name(学生自己的 org_id,
  加盟机构落款是本机构名;Organization 不是租户锚点表),测试 tests/test_learning_report_unit_info.py。
  浏览器验过(临时库副本 + 种 unitRecap 存档,复习卡池要拖拽分完才能「完成」): 真实流程出图 1125×2430、390 宽手机弹层、
  满分/95 词压力场景、长按放行。入口: 学生端分类学习结算页「📸 生成学习报告,发给家长」;公告学生/老师各一条
- ✅ 音标兑换码「指定几节」(2026-10-16 16:06 **已部署生产**,database.py 走 anchor patch 只加 phonetic 段那 1 条 ALTER + 2 张表,其余 6 个文件生产==HEAD~1 整推;上线后存量码全为 scope=library、两张新表为空 = 线上行为零变化;备份 /root/eh_db_before_svcode_20261016_1603.db、/root/eh_code_before_svcode_20261016_1603.tgz、frontend/dist_bak_20261016_1603,构建号 mvanqg0i): 用户「现在音标视频开一个码就全部可以看全部视频,
  现在需要可以一个码单开一个视频」,随后改成「增加个可以选择多节的」—— **以多选为准**(一节是多选的特例)。
  phonetic_codes.scope(library=整库,存量全是它 / videos)+ 明细表 phonetic_code_videos(一节一行 + 标题快照,
  与 redemption_code_books 同构);单节授权另起新表 phonetic_video_grants(一人一节一行,四个授权列与
  book_assignments 同名,is_assignment_active 直接判活)。整库那张 phonetic_access_grants **一行不动**
  (它的 UNIQUE(student_id) SQLite 改不了,NULL 在唯一索引里又互不相等)。
  闸门真源 phonetics._gate(video_id) + phonetic_access_service.pick_grant: 整库或这一节的授权任一生效即放行;
  两条都生效时选**今天不用扣**的那条(整库次卡 + 这节永久,看这节不扣整库天数)。五个交付端点全按节判
  (讲义页图先查课件挂在哪节再判)。列表 locked **按节**,同一响应里不再全库一致。六个要点:
  ①**范围只看 scope 列,不能拿「有没有明细」推** —— 删视频会清未用码的明细,删光的码若退成整库码就是开全部
  ②删视频(单条 + 批量)走 forget_videos: 删单节授权、删未用码里那节的明细、删光的码 disabled
  (视频 id 会被 SQLite 回收给新视频);已用码明细保留当凭证 ③删码要显式删明细(生产 FK 是关的)
  ④多节码逐节给结果(照一码多书): 已永久/生效中跨卡种的那节跳过,**每节都跳过才失败且不吞码**;
  已有整库永久、视频全下架、视频不是本机构的 → 整张拒且不吞码 ⑤平台 admin 不能混选两个机构的视频
  (学生只属一个机构,混选的码谁都兑不成),平台预置可与任一家混 ⑥一张码算一张额度,不按节数。
  前端: PhoneticCodePanel「开通范围: 整个音标视频库 / 指定几节」→ 按分类分组的勾选清单(搜索、全选本组、
  别家机构置灰);码列表「开通范围」列;学生端锁按节、锁弹窗写节名;只开一节的码兑完自动打开那节
  (history state,用完 replace 清掉,否则刷新会再打开一次)。公告两条(admin+org_admin / teacher)。
  入口: 「兑换码管理」页底部「音标视频兑换码」→「开通范围」选「指定几节」→ 勾视频 →「生成兑换码」。
  测试 tests/test_phonetic_single_video_code.py(20 例;10 处守卫逐一破坏各自对应用例失败,回归锁验证过)。
  浏览器验过(临时库 + ffmpeg 造的视频): 勾 2 节发码 → 学生兑 → 2 节开、1 节锁、能播;单节码兑完自动打开。
  前后端必须一起上(兑换响应改成 video_ids、列表 locked 语义变了)。
  ⚠️ 全量 pytest 一条命令跑会卡死(tests/pk/test_websocket.py、tests/test_book_stage_field.py 各自挂住),
  要逐文件带超时跑;另有 9 个文件 43 例在 main 上就失败(pk/*、review_findings、unit_word_edit_isolation、
  word_upload_book_isolation),与本功能无关,失败名单与 main 逐例一致
- ✅ 安全收口(2026-10-14 19:35 已部署生产,5 个文件生产==HEAD~1 整推,备份 /root/eh_code_before_seclock_20261014_1932.tgz):
  ①**GET /admin/ai/providers/default 原先免登录返回通义千问 API Key 明文**(生产实测能拿到;nginx 日志 08-24 有外部 IP
  13.228.168.117 拿走过一次)→ 仅平台 admin。**Key 本身用户说先不换**(10-14),旧 Key 仍可能被他人使用。
  ②PUT/DELETE /words/{id} 免登录可改删任意单词 → get_current_teacher(老师单词库页本来就带 token)
  ③/ai/* 全部挂 router 级 get_current_user;录词生成类(generate-example/distractors/phonetic/meaning/complete/exam、
  analyze-weak-points、batch-generate-examples)再加 get_current_teacher;explain-mistake/tts/quiz 类只要登录
  ④/achievements/leaderboard 跨机构返回学生真名、前端无调用 → 仅平台 admin
  ⑤**单词本兑换码按发码人判机构**(码表无 org_id 列): 发码人非 admin 且 org_id ≠ 学生 org_id → 拒,文案与音标码一致
  (上线时生产 1167 张码全是平台 admin 发的,存量无影响)。回归锁 tests/test_security_lockdown_1014.py 6 例。
  仍免登录但属正常: /auth/* 登录注册、/assessment/* 公开测评、/referral/public/*、/pronunciation/edge-tts(学生端发音)、
  /words/books(只列公开书);exams.py / learning.py 里是返回「待实现」的空桩
- ✅ 家长推荐(老带新)(2026-10-14 16:55 **已部署生产**,main.py 走 anchor patch 只加 referral 两行,其余 9 个文件生产==HEAD~1 整推;三张新表由 create_all 建、先在生产库副本上跑过 init_db;备份 /root/eh_db_before_referral_20261014_1637.db、/root/eh_code_before_referral_20261014_1637.tgz、frontend/dist_bak_20261014_1637;上线后各机构没有设置行 = 推荐默认开启、奖励 0 金币): 用户「我需要家长裂变的功能,运营方案也加到资料去,加盟商也可以用」。
  链路: 老生家长(家长端首页「邀请朋友来免费体验」)或老师(「家长推荐」→ 给学生家长发邀请)生成带二维码的海报
  → 朋友家长打开公开落地页 `/invite/{code}` 留电话(不注册、不验短信)→ 线索进「推荐线索」
  → 老师点「确认报名」才给推荐的孩子发金币(机构设 0–50,source=referral,dedup_key=referral:{线索id},不算每日封顶),
  线下奖励(赠课等)记「待兑现」,兑现后点「已兑现」。真源 services/referral.py,表 referral_invites / referral_leads /
  org_referral_settings(**都是新表,create_all 建,无 ALTER**;不进 tenancy 锚点,查询一律显式写 org_id)。
  四条规矩各有回归锁(tests/test_referral.py 10 例,去掉机构过滤 / 手机号去重 / 确认报名条件认领各恰好 1 例失败):
  ①只在确认报名后发奖励,留电话不发(注册不验手机号 + 微信禁止按分享给奖励)②同机构同手机号只认第一个推荐人
  (UNIQUE 兜并发)③手机号已是本机构账号 = 老客户,默认不发,老师勾选才发 ④确认报名重复点只发一次。
  **邀请码挂学生不挂家长**: 生产家长账号是 0,老师替学生拿链接是主入口;学生换机构时码的 org_id 跟着走。
  文案红线: 海报/落地页不写「转发有奖」(诱导分享会封域名,学生端同域)、推荐人只露「张同学」、不承诺分数。
  老师只看本班学生推荐来的,机构管理员看全机构 + 「推荐设置」;落地页按 IP(200/分钟看、30/10分钟交)+ 按码限速
  (家长会几十人同一个 Wi-Fi)。顺修两个: ①**家长注册 org_id 跟孩子走**(原先落列默认 1,非直营孩子的家长被租户过滤挡住)
  ②**utils/downloadPdf 去掉 html2canvas 的 width: 794**(html2pdf 按 A4 可打印宽度 ≈718px 算分页,强截 794 宽
  每页高出约 10%,越往后切得越偏 → 文字拦腰切、右侧白边;默写纸/家长手册/运营方案导出都验过)。
  加盟资料新增第五份「家长推荐运营方案」(pages/FranchiseReferralDoc.tsx);**/admin/franchise-kit 对机构管理员/老师开放,
  但只给「家长手册」「推荐运营方案」两个标签**(DOC_TABS.partner),招商手册/提分方案/合作协议仍只给平台 admin。
  路由挂两条 `/teacher/referrals`、`/admin/referrals`(工作台布局按路径前缀认角色,中性路径会成没边距的裸页)。
  新依赖 qrcode@1.5.4(+ @types/qrcode@1.5.6),只进海报懒加载 chunk。浏览器验过: 落地页手机宽度、错手机号提示、
  提交 → 线索 → 确认报名 → 金币 5 枚到账 + 操作日志、海报生成、家长端同码、机构端设置与资料标签。
  入口: 教师工作台「激励与复盘 → 家长推荐」;机构管理首页「家长推荐」「运营资料」;家长端首页顶部卡片。
- ✅ 音标视频全屏去掉下方黑边(2026-10-14,**已部署生产**,纯前端;dist 从提交 e7d8b9c 的干净 worktree 构建 ——
  工作区里有未提交的裂变/邀请改动,直接在主工作区 build 会把半成品带上线;备份 frontend/dist_bak_20261014_fsfix,
  构建号 mv7rtx4y): 用户「全屏的时候下方黑色空白的太多了」。根因: 只看视频时全屏是把整块
  面板送进 requestFullscreen,而 <video> 仍按弹窗口径 `max-h-[70vh]`(768 高的屏上约 537px),简介/讲义列表/提问区
  照旧排在下面。现在全屏时面板竖排、收起简介和讲义列表(讲义入口挪到顶栏)、提问区只 hidden 不卸载(打了一半的
  问题退出全屏还在);视频框按**真实画面比例**(loadedmetadata 取,4:3 老录屏也对)算最大尺寸居中。两个坑:
  ①**别让 <video> 铺满舞台再 object-contain** —— 黑边长在框里,水印/全屏按钮/续播提示贴着框角会落进黑边
  (录屏一裁水印就没了)②全屏监听挂在 PhoneticsHub 不挂面板里: 全屏中直接点「关闭」面板先卸载,监听没了
  panelFs 会卡在 true。竖屏手机全屏时横版视频试 `screen.orientation.lock('landscape')`(只 Android Chrome 有,
  其余静默)。真浏览器实测: 1366×768 → 1287×724、1920×1080 → 1842×1036、4:3 → 965×724 居中,水印都在画面内;
  全屏中开讲义/收讲义/关闭再开无残留
- ✅ 句子「开口背」后台转写(2026-10-11 19:29 **已部署生产**,config/database/main 走 anchor patch;备份 /root/eh_db_before_speech_20261011_1926.db、/root/eh_code_before_speech_20261011_1926.tgz、frontend/dist_bak_20261011_1926;真人准确率待验): 孩子说完照常往下走,录音进 sentence_speeches 排队,
  主进程起 speech_loop 调度、**独立 spawn 进程池**(SENTENCE_SPEECH_WORKERS 默认 2,每进程 1 线程)跑 faster-whisper small
  + beam 5 + VAD,吃 uvicorn 单 worker 用不到的空闲核。生产实测(合成音): base 4 路 40 句 24s、small 4 路 70s → 不能让孩子等,只能后台。
  判据 services/sentence_speech.judge: **实词全中才算背出**(只许漏 a/is 这类虚词);七成比例阈值实测放过「My mother is a banana」,别改回去。
  **不喂 initial_prompt 原句**(喂了 Whisper 会照抄原句,背错也转成对)。合成音本地验 en 32/32、zh 口音 31/32(three→free);**真人录音未验**。
  结果只给老师(学生详情页「句子开口背」区块,本班才放行),学生端不显示对错;音频转完即删,落 private_media/sentence_speech。
  部署注意: main.py / database.py 有 drift 走 anchor patch;两个 small 进程常驻约 1GB 内存,上线前看 free。测试 tests/test_sentence_speech.py(9 例)
- ✅ 句子背诵改版(2026-10-11,取代「英翻中选择 / 听句子默写」二选一的单遍版): 单元按服务端分组,
  每组「听读 → 连词成句 → 开口背 → 默写 → 过关检测(80 分)」,最后一组过关后「跟读整篇」→ 总结。
  分组/关键词/记作答口径真源 services/sentence_learning.py(**对话一问一答不拆**、按句长定组大小
  预算 28 词/最多 6 句、末组只剩 1 句并入上一组;关键词不挖功能词/缩写/句中大写的人名/招呼语,
  生产 288 句 253 句挖得出)。新表 sentence_mastery(一人一句,阶梯复用 mastery.level_for)+
  sentence_unit_progress(断点,只进不退);端点 student/sentence_learning.py
  (`GET /student/sentences/units/{id}/learn`、`POST /student/sentences/records`、`POST .../group-pass`)。
  四个口径: ①**只记首答**,重练轮不报 ②**只有过关检测推进记忆曲线**(连词/默写/检测都推的话
  一节课把复习间隔顶到 12 小时)③**开口背不用语音识别也不自评**(用户 10-11 定),只判 VAD
  「真的开口 + 说够时长」(minSpeechMs = 词数×280ms,至少 600ms),说完放原声对照;录不了音写明原因放行
  ④默写判分宽容(大小写/标点/弯撇号/对话破折号/常见缩写展开等价),逐词 LCS 对齐只标错词
  (utils/sentenceCheck.ts)。顺手补了两个只要登录的老接口的机构/公开过滤
  (`/sentences/books/{id}/units`、`/sentences/units/{id}/sentences`)。
  三个实测坑: (a)SpeakStage 清理 effect 依赖不能写整个 `rec` 对象(每渲染新对象 → 一开录就 stop →
  永远「没听清」)(b)过关上报要等首答上报完成再发(两条写同时到 SQLite 撞写锁 500)
  (c)宠物浮标压底部按钮 → FloatingPetWidget 加了学习页路由。
  **第二步(作业 + 每日复习)未做**: 作业表 unit_id 外键到 units,要改表结构。
  入口: 学生首页「句子背诵」→ 选书 → 选单元。测试 tests/test_sentence_learning.py(7 例;
  去掉机构过滤 / 让每步都推进记忆曲线各恰好 1 例失败,回归锁验证过)。
  **10-11 15:07 已部署生产**(database.py / main.py 有 drift 走 rsync 往返 anchor patch,各只加句子那两行;
  其余 4 文件整推;备份 /root/eh_db_before_sentence_20261011_1507.db、/root/eh_code_before_sentence_20261011_1507.tgz、
  frontend/dist_bak_20261011_1507)。生产临时学生 9 项全过;⚠️ 生产 FK 关闭,删学生不级联 ——
  测完手动清了 sentence_mastery 6 行 / sentence_unit_progress 1 行孤儿(user_id=945)
  **10-11 句子高频词 # 标记**: 老师在英文里用 # 包住高频词(`I #like# apples.`,`##like##` 等价),
  学生端橙色加粗(components/sentence/MarkedText)。真源 services/sentence_marks.parse:
  english 存**去掉 # 的干净句**(判分/TTS/去重都用它,学生默写不用打 #),新列 sentences.english_marked
  存带 # 原文(NULL=没标);# 不成对/空对 → 单条 400、导入按行号跳过并报出。过关检测填空**优先考老师标的词**
  (sentence_learning.key_word 第二参)。Excel 模板 utils/sentenceTemplate.ts 三张表(句子/填写说明/常见错误),
  第 2 行中文提示上传时按首格内容剔除(TEMPLATE_HINT_ROW_FIRST_CELL),否则会被当成一句导入。
  模板→前端解析→真导入接口回环验过 6/6;编辑时回填带 # 原文,保存不丢标记。
- ✅ 新机构卡包政策(2026-10-08): 用户对标北大单词营,新签约机构改「标准包 6 万 = 3 期 × 2 万」,
  老机构(organizations.card_plan='legacy',存量全是)一行不动。真源 `services/card_pack.py`(卡种/单价/分期张数/赠送/
  按规则取书/额度/新书补给),前端一律读 `GET /admin/subscriptions/pack`,**不写死数字**。
  五种卡全是兑换后 180 天、码 5 年有效: 入门卡(体验档)/单册卡(选 1 本基础书)/学段卡(版本×学段)/全通卡(版本小初高)/
  精品卡(选 1 本精品书,只能补货买)。单价 10/60/200/400/150;每期张数见 INSTALLMENTS(10-08 用户改「最多三期」:每期 2 万,签约/第 3 月/第 6 月;启动时 assert 每期卡值=标准包÷期数)。
  一次付清送 10 张全通卡、付完第 1 期后结清剩余两期送 5 张。七个要点:
  ①**书的档位 word_books.pack_tier,NULL=未定档=不进任何卡**(默认成基础会把考纲书/校本书白送进学段卡);只认平台书
  org_id IS NULL ②**新政策机构的老发码端点 403**(否则 card_quota 回退学生名额 → 老表单自由勾书 = 全开卡,分档定价作废)
  ③每档额度独立,真源 quota_status(台账 org_card_ledger 求和 − 该档已发未禁用码),**同一期同一档 UNIQUE**,双击到账 409
  ④学段卡/全通卡**兑换时按规则重新取书**(码可能放两年);兑换后记 pack_card_grants,平台把书定成基础/改版本学段时
  `sync_book` 补给有效期内学生,到期日=卡的到期日,只补不收 ⑤全通卡 grant 的 stage_code 存空串(NULL 在唯一约束里不相等)
  ⑥成功前不写明细行(全部跳过那支不能留待提交的写,见 _apply_one_book 不 rollback 那条)⑦逾期/宽限/区域保护暂停是**人工**,系统不自动停。
  入口: 平台「机构管理」开通表单选政策、行内「卡包到账」;「兑换码管理」顶部「卡包书本档位」(仅 admin);
  机构端「兑换码管理」顶部「按卡种发码」+「发卡规则(必看)」。测试 tests/test_card_pack.py(8 例;去掉老端点拦截 /
  去掉 upsert_grant 各恰好 1 例失败,回归锁验证过)。
  **生产已知**: 平台人教版小学缺三上(只有直营自建那本)和六下;清华沙沙/雅思/KET 等是直营自建书,新机构看不到。
  **10-08 17:24 已部署生产**(database.py drift 走 anchor patch,只加 card_pack import + 4 条迁移;其余 10 文件生产==HEAD~1 整文件推;
  上线后 5 家机构全为 legacy、平台书全部未定档 = 线上行为零变化;备份 /root/eh_db_before_cardpack_20261008_1720.db、
  /root/eh_code_before_cardpack_20261008_1720.tgz、frontend/dist_bak_20261008_1720)。
  **10-08 晚补两个绕过口**(只对新政策机构的平台基础/精品书,真源 card_pack.gated_book_ids / is_gated_for_student):
  ①老师直接分配 → 403 ②老师分配的行(grant_type NULL)与作业单元**都不算授权**(get_allowed_unit_ids / 书架 owned /
  can_enter_unit 连「只能从作业进入」也不放行 / start_homework 403 提示要兑换)。兑换时撞上老师分配的旧行,改写成卡授权
  (否则当成「已永久拥有」跳过,学生拿着卡兑不了)。回归锁验证过: 去掉三处守卫恰好 2 例失败。
  招商手册第六章、提分方案第八章、合作协议第二/三条已改成卡包口径;逾期宽限、退款、年度续购量标【待确认】未替用户定。
  **10-09 卡种整体换成用户定价**(替换 单册/学段/全通/精品): 入门卡 ¥15×80、15本卡 ¥600×40、5本卡 ¥360×60、
  小学2本卡 ¥120×50、单本卡 ¥240×30 = 6 万 / 260 张。**N 本卡 = 发码时机构管理员勾正好 N 本**(后端校验本数、
  档位;小学2本卡只能勾小学;只有单本卡能勾精品书),不随新书变 —— 学段/全通卡的「新书自动补给」随之下线
  (sync_book / pack_card_grants 留着空转,没有卡种再写 grant)。单价都是 120 的倍数,每期凑不出正好 2 万:
  三期卡值 20,040 / 20,040 / 19,920,机构每期照付 2 万(catalog 的 value=2 万、card_value=卡值)。
  一次结清赠送改为 5本卡(10 张 / 5 张)。合同第二/三条、招商手册第六章、提分方案第八章、规则页同步。
  **10-09 晚改成 300 张**(单价不动): 入门 80 / 15本 30 / 5本 50 / 小学2本 90 / 单本 50;三期
  {入门80,15本10,5本17,小学2本30,单本13} / {10,17,30,18} / {10,16,30,19},卡值仍 20,040/20,040/19,920。
  直营自建的 24 本考试/考纲书(中高考、KET-CPE、PETS3、四六级、考研、专四八、雅思托福 GRE 托业、科技/传统文化)
  改成平台书并定「精品」→ 只能用单本卡开;飞鹰语法 4 本 + 飞鹰单词速记法 2 本**不进卡**(属合同里另卖 ¥16,000 的专属内容)。
  **10-09 16:31 生产已执行**(用户跑的 SQL,备份 /root/eh_db_before_premium24_20261009_1631.db):平台书
  基础 26 / 精品 28 / 校本 4 / 体验 1,直营只剩飞鹰单词速记法 2 本;生产测试机构 11 项全过已删。
  ⚠️ 改成平台书后老政策机构也看得到这 24 本(老合同本就写「新增内容免费同步」,用户按建议接受)。
  **10-09 合同与系统对齐**: ①新卡包机构开通时学生名额 = 999999(不限,卡张数即限制),合同第二条第 2 款写明
  「学生账号数量不限」②飞鹰专属内容(校本档,含飞鹰语法)加开关 organizations.exclusive_content(默认 0):
  没开通 → 老师不能分配、学生不能学(老师分配的行和作业都不算),开通后老师直接分配不占卡;平台机构行「开通专属内容」。
  真源 card_pack.lock_reason / is_exclusive_locked ③新卡包机构**不能切全托**(全托=书本全开放,会绕过卡包),
  前端换成专属内容按钮 ④合同标题/第二条去掉「全托全开放」,按招商手册第六章改写。老政策机构四项全不受影响。
  **10-09 晚用户更正: 飞鹰专属内容含在 6 万标准包内,不单独收 ¥16,000** —— 合同第二条第 3 款/第三条第 4 款/费用表、
  招商手册第六章(删「选配与另计」里那条)、提分方案第八章、发卡规则全改;新卡包机构**开通时 exclusive_content 默认 True**,
  开关保留只为合作终止前收回等特殊情况。
  **10-09 方法课 = 进货价 ¥1,000 / 套**(用户定;每位学员一套,含音标 1 + 语法 3 册,赠绘本 3 本),**不含在 6 万内**:
  合同第三条第 5 款与费用表单列「方法课」一行;招商手册第四章标题改「进货价」、第六章「另计」首条。家长手册不写进货价。
  **10-11 方案 A: 方法课 12 套并入 6 万标准包**: 卡 300 张 = 入门 80 / 15本 15 / 5本 40 / 小学2本 135 / 单本 30(¥48,000)
  + 方法课 12 套(¥12,000)。三期卡 {入门80,4,13,44,10} / {5,14,46,10} / {6,13,45,10},每期方法课 4 套;
  每期交付值 19,960 / 19,960 / 20,080,机构每期仍付 2 万。方法课是纸质教材**不进额度台账、不发码**,
  card_pack.METHOD_COURSE / METHOD_SETS 只用于目录与到账弹窗提示「线下寄出几套」;超出 12 套按 ¥1,000/套补订。
  **用户 10-09 确认按建议**: ①三期拆法 20,040/20,040/19,920(入门卡全在第 1 期)②单本卡可开精品书、精品卡取消
  ③结清赠送 5本卡 ④短语本单独算一本 —— 四项都已上线,不用再问。
  **10-09 合作方案挪到招商手册第六章**(完整版: 含什么/五种卡进货价/3 期表/赠送/补货/选配/测算),提分方案第八章只留摘要指过去;
  **6 万含带教培训**(合同第二条第 2 款、第三条第 1/6 款、费用表、第七条第 2 款同步;参训人数/天数第三条第 6 款留空现填)。
  ⚠️ 同批修了 10-08 起生产「合作协议」页白屏: JSX 里写了 `{B}`(python 拼接时的变量名漏成字面量),
  **eslint 不报未定义变量、vite build 也不跑类型检查**,只有 `npx tsc --noEmit -p tsconfig.app.json` 能抓到 ——
  改加盟资料这类大段 JSX 后必须跑 tsc,并在浏览器里把四个标签页都点一遍。
  **老师版规则页** `/teacher/card-rules`(pages/TeacherCardRules.tsx,读 `GET /teacher/card-rules`): 「三句话」+ 学生没卡怎么开通
  + 卡种规则(老师版不显示单价)+ 常见问题。入口: 教师工作台「课堂推进 → 学习卡规则」、布置作业弹窗顶部、分配单词本页顶部
  提醒条(components/CardRulesNotice)、机构发卡规则里附老师版链接。**只在本机构 card_plan=pack 时显示**(hooks/useCardPlan,
  按 token 缓存,换账号不串);老政策机构老师看不到入口,直接访问页面会写明「原合作政策不适用」。
  老师版规则页 10-08 19:45 已部署(备份 /root/book_assignments_before_rules_20261008_1943.py、dist_bak_20261008_1943)。
  这批 10-08 18:09 已部署生产(6 个文件生产==HEAD~1 整文件推,备份 /root/eh_code_before_packgate_20261008_1809.tgz、dist_bak_20261008_1809)。
  **10-08 19:48 生产定档完成**(用户执行,备份 /root/eh_db_before_packtier_20261008_1948.db): 体验 1(入门课)/ 基础 26
  (人教版小学 9 含三上 id=335 已改平台书、初中 10、高中 7)/ 精品 4(7天小学1000词、15天初中3500词、高考688、高中必背短语)/
  校本 4(飞鹰语法)。**待办**: 人教版六下平台没有,要导入词表;合作协议三处【待确认】
- ✅ 宠物多开刷经验/刷血修复(2026-10-06): 用户「多开浏览器可以同时刷经验 治疗」。生产实测同一学生
  14 天里 1182 场对战与自己另一场时间重叠(单日最多 471 场)。四个洞四个守卫(全是 DB 原子操作,不靠进程内状态):
  ①**一人同时只打一场** `pet_battle_service.claim_exclusive_battle`: 开打(quick-match / accept)后作废双方
  其它 active/pending 对战;规则「id 大的为准」—— 后认领的若是旧场则作废自己,两标签并发不会互相作废
  ②**finish_battle 条件 UPDATE 认领**(`WHERE status='active'`),旧写法读-判-最后才写,WS 结束与逃跑判负并发发两遍;
  被作废的场返回 `_superseded`,WS 广播 code=superseded「另一个页面开了新对战,这一场不计奖励」
  ③**治疗改服务端出题判分**: 新表 pet_heal_questions(带正确释义),`GET /pet/healing-words` 下发 question_id+选项
  **不下发答案**,`POST /pet/heal` 收 JSON {question_id, answer}(旧的 ?is_correct= 现在 422),一题一用
  (条件 UPDATE used_at IS NULL,重复交 409),回血一条 SQL 原子加,另有 30 次/分钟限速
  ④**喂食每日 3 次**改一条条件 UPDATE(子查询数当天 feed 日志 < 3 + 粮 >= 5)。
  **仍未修**: `/pet/earn-food` 信任前端传的 score/total(粮食可无限刷),粮食只能喂食且每天 3 次封顶,经验影响有限。
  **部署必须前后端一起上**(治疗接口契约变了,旧页面交题会 422,UpdateNudge 会提示刷新)。
  **2026-10-06 15:18 已部署生产**(与比赛模式同批;database.py anchor patch 只加 is_contest 那条;
  备份 /root/eh_db_before_contest_pet_20261006_1518.db、/root/eh_code_before_contest_pet_20261006_1518.tgz、frontend/dist_bak_20261006_1518)
  测试 tests/test_pet_multitab_exploits.py(9 例含真文件库并发结算;四个守卫逐一破坏各自恰好失败,回归锁验证过)
- ✅ 作业「🏆 比赛模式」勾选(2026-10-06 傍晚,取代下面两条的「有作业就生效」): 用户「布置作业的时候加个比赛模式来打钩」。
  homework_assignments.is_contest(默认 0);**只有当天有比赛作业**时单词数/排行/大屏/单词王才只算比赛作业单元里的词,
  普通作业不再限制计数。真源仍是 `daily_words._contest_condition()`(多了 is_contest 条件),
  `coin_service.task_words_by_student` 改为直接委托 contest=True(单词王与排行一个数);学习页提示改走
  `contest_unit_ids_on_day`。旧公告 word-king-task-scope-* 删掉换成 homework-contest-mode-*。
  入口: 作业管理 → 创建新作业 →「📍 在哪里做」下面「🏆 比赛模式」;列表角标「🏆 比赛」。
  2026-10-06 已部署生产(见上一条宠物修复的备份路径)
- ✅ 有作业的日子书本里背的词不计数(2026-10-06 下午,用户「非作业模式学生背书本单词不增加」):
  上一条的「只比作业内」从单词王**扩到全部比赛/排名面**: 班级每日数据 words_learned、大屏、实时课堂、
  教师班级排行榜(mastered_words 周期)、学生端词汇榜(含环比)。用户选: **只管比赛和排名**
  (家长端/学生自己的学习统计/复习照常总量)、**只在当天有作业时生效**(没作业的日子照常全算)。
  真源 `daily_words._contest_condition()`(按记录所在北京日、逐条判「该生当天没作业 OR 词在当天作业单元里」),
  `words_by_student / words_sum_rows / words_sum_by_student` 加 `contest=True`;与单词王
  task_words_by_student 同一个数(测试锁住)。每日数据另给 all_words(总量,前端「共学 N」灰字)。
  性能(生产库副本): 全机构周榜 0.50→0.91s、月榜 0.34→1.33s,单日 774 人 0.13s,可接受;
  机构再大要给 learning_records 加 (user_id, created_at) 覆盖索引再看。
- ✅ 单词王只比作业里的词 + 学习页比赛提示(2026-10-06): 用户「布置任务来比赛,学生点到没有布置的书本去刷单词量」。
  **不做「比赛模式」勾选**(讨论后用户同意): 单词王本来就要求当天作业做完才参评,天天都是比赛;
  做成开关则没勾的日子漏洞照旧、同班口径不一。规则: **有作业的日子单词王只数当天作业单元里的词**,
  别的书背的词照常进学习记录/学情/复习(`words_learned` 不变),只是不进比赛。
  真源 `coin_service.task_words_by_student` + `_task_scope_conditions`(与 task_progress_on_day 分母
  同口径: 当天布置/未关闭/非家里);判「在不在作业单元」用 word_id(单元级隔离,别的书同拼写不算)。
  按单元不按入口: 同一单元从书本进也算(同一批词,公平),要锁入口另配「只能从作业进入」。
  接入: king_eligible_counts(评选/发币/👑)、word_king_race(学生战况,另给 my_all_words 总量,
  文案写「作业里 N 词」并补「另在别的书背了 M 词不计入」)、教师金币横幅词数、日报加 task_words/has_task
  (每日数据表「作业内 N」+ 导出列)、大屏/实时课堂有作业时按作业内词量排(「今日作业词排行」)。
  顺修 word_king_race: task 状态挪出班级循环,作业内 0 词时 no_task 曾被误报。
  **学习页提示**: start_learning 返回 contest_notice(今天有作业且本单元不在作业范围 → 提示「这里背的不计入单词王」),
  `startLearning` 广播 CONTEST_NOTICE_EVENT,全局 `ContestNoticeBanner` 只在该单元学习页顶部显示 ——
  **不逐页加横幅**(学习页十来个)。手机上横幅会盖住顶栏「退出」,所以 8 秒自动收起 + 点任意处收起;
  「知道了」按天按单元记 sessionStorage。生产核对 09-29 班 55: 旧规则王是作业内 25 词+别的书刷到 174 的学生,
  新规则王是作业内 40 词那位。测试 tests/test_word_king_task_scope.py(7 例,改回总量后 farming 那例失败)。
  10-06 已部署生产(备份 /root/eh_code_before_wordking_20261006_1329.tgz、frontend/dist_bak_20261006_1329)
- ✅ 作业「只能从作业进入」(2026-10-05): 用户「布置任务时有个选项只能从布置任务中进入背单词,
  没选可以从书本中进入」。homework_assignments.entry_mode: open(默认,server_default,存量零影响)/
  homework_only。**口径用户选 A「书本分配优先」**: 开关只收回「作业额外开放的那部分」——
  homework_only 作业不并入 get_allowed_unit_ids 白名单、不在 /student/books 开书;
  学生本来就有该书/单元分配的照样能自学(**别改成作业优先**,那会锁住学生付费的书)。
  放行走 `scope_service.can_enter_unit(..., assignment_id)`: 请求带 homework_student_assignments.id,
  四条件(发给本人/单元对得上/已开放/未关闭)。**四个取词/出题端点共用这一份**: units/start、
  exam/generate、ai/generate-unit-quiz、ai/generate-unit-cloze —— 后两个**此前连登录都不要**,
  知道单元 id 就能拿整单元题 = 后门,已补 get_current_user + 学生闸门(教职工不拦,备课用)。
  前端 assignment_id **不逐页传**,由 api 层 `currentHomeworkAssignmentId()` 读
  window.history.state.usr(navigate 的 state;学习页十来个,逐页传漏一个就是「从作业点进去
  却提示要从作业进」)。被拒文案走 deny_message 区分「要从作业里进」与「还没分配」;
  /books/{id}/progress 每单元下发 homework_only,UnitSelector 锁定角标写「从作业进入」,
  点它若有待办作业直接走作业入口。入口: 作业管理 → 创建新作业 →「📍 在哪里做」下方
  「🔒 只能从作业进入」;列表角标「🔒 仅作业入口」(学生端「🔒 只能从这里进入」)。
  测试 tests/test_homework_entry_mode.py(8 例;去掉白名单排除 → 4 例失败,去掉出题闸门 → 1 例失败,回归锁验证过)。
  **2026-10-06 已部署生产**(database.py 有 drift,走 anchor patch 只加 entry_mode 那条 ALTER;
  其余 8 个文件生产==HEAD~1 整文件推;存量 3724 份作业全为 open;备份 /root/eh_db_before_entrymode_20261006_1228.db、
  /root/eh_code_before_entrymode_20261006_1228.tgz、frontend/dist_bak_20261006_1228)
- ✅ 音标视频手动排序(2026-10-04): 此前 sort_order 字段一直在、但没有任何入口能改(存量全是 0,
  顺序=上传顺序,传错只能删了重传)。教师端「音标视频」顶部「调整顺序」→ 按分类分 tab,
  拖抓手 / 上下箭头 / 置顶,攒着改点「保存顺序」一次写(components/phonetics/ReorderDialog.tsx)。
  `GET /teacher/phonetics/videos/order?category=` 取本机构该分类**全部**视频(不分页、含下架),
  `POST /videos/reorder` 整组重写 10/20/30…。四个要点: ①**名单必须恰好等于该分类本机构全部视频**,
  否则 409 一条不写(少了=中途有人上传,按旧名单写会让漏的那条插在中间;多了=混进别家/预置/
  别的分类 = 越权改别人顺序)②**只排本机构的,平台预置不让机构排**(全平台共用一个 sort_order,
  一家挪会改掉所有机构);预置 sort_order 多为 0 所以排在本校视频前,弹层里写明
  ③**新上传/改分类排到该分类末尾**(`_next_sort_order`),沿用 0 会跳到老师排好的最前面
  ④教师分页列表改成与学生端同一顺序(先 CATEGORY_ORDER 再 sort_order,SQL 里用 CASE),
  此前教师端只按 sort_order 排、跟学生端看到的不一样。拖动只认左侧抓手(整行可拖会让平板滑不动列表)。
  测试 tests/test_phonetic_video_reorder.py(6 例;去掉 409 校验 / 末尾排序后 4 例失败,回归锁验证过)
- ✅ 音标兑换码额度由平台发给机构(2026-10-02): 用户「音标的兑换码额度需要总管理给机构发放」。
  organizations.phonetic_code_quota(NULL/0=未发放,**不回退 student_quota** —— 音标库另卖,
  与 card_quota 是两笔账,混算会让发音标码吃掉续卡名额)。口径真源 org_service.phonetic_code_quota_status
  (按 phonetic_codes.org_id 计,已兑换的永久占额;机构列表 GROUP BY 同口径。**10-22 起生成即占、禁用/删除都不退**,见上方那条)。
  音标码四个端点改 get_current_admin_or_org_admin,四条规则: ①org_admin 只看/改本机构码
  (`_scope_phonetic_codes`,PhoneticCode **不是 tenancy 锚点**,过滤必须显式写),别家码/平台码 404
  ②生成前过额度闸门(未发放/超额 403)③卡种走同一道 guard_card_policy(机构只能 ≤180 天包月)
  ④**redeem_phonetic_code 机构码只给本机构学生兑**(否则 A 的额度被 B 的学生用掉),平台码不限。
  OrgUpdate 加 phonetic_code_quota(绝对值)/add_phonetic_codes(SQL 原子加,coalesce NULL→0)。
  前端 PhoneticCodePanel 改收 policy prop(AdminSubscriptions 等 policy 到了**正向**判 admin/org_admin 才挂),
  机构端显示额度条、没额度整块置灰说清找平台。回归锁验证过: 去掉兑换的机构判 / 去掉列表 scope 各恰好 1 例失败。
  入口: 平台「机构管理」每行「音标码额度」;机构「兑换码管理」页底部「音标视频兑换码」。
  测试 tests/test_phonetic_code_quota.py(9 例)
- ✅ 音标视频单独码开(2026-10-01,已部署生产,提交 ed73bb6;上线时 15 个机构全为 open,
  **10-02 用户要求全部切成 code**(直接改库,改前 .backup;新建机构仍默认 open),
  同日学生/老师公告各加一条 —— 全切之后「只投 admin」的理由不成立了): 用户先选「有任一书即可看」,随后改口
  「音标视频改成单独码开」—— **以后者为准,别回到"随书开"**。机构级开关
  `organizations.phonetic_access_mode`: open(默认,server_default,存量零影响)/ code(要音标专用码)。
  **库级闸门**(整库一起锁/开,不按视频): 判定唯一真源 phonetics.py `_gate_state`(三态
  free / granted / times_due / locked)—— 教职工(teacher/org_admin/admin)恒放行(要备课);
  **家长等其它角色一律拦**(审查实测的后门: 家长号凭孩子自己生成的绑定码零成本注册、不验手机、
  org_id 落列默认 1,旧的「非学生恒放行」= 没码的学生换个家长号就能看整个预置库;家长端本无音标入口);
  学生只在本机构 code 模式且无生效授权时拦。列表/详情用 `_is_locked_for`(只判不扣),
  **四个交付内容的端点**用 `_enforce_gate`(判 + 扣次卡): video_ticket(主闸门)/
  stream_video(Bearer 分支)/ **list_video_materials / material_page**(第一版漏了这两处,
  逐页 PNG 照看不误 = 绕开视频锁;material_page 的闸门放在查行**之前**,不泄露课件是否存在)。
  **次卡四处都扣、只在 times_due 时扣**: 只扣换票的话直接 Bearer 串流 / 只翻讲义永远不掉天数,
  1 天卡 = 永久卡;open 模式(free)不扣 —— 免费期间看视频不该消耗学生买的卡。
  扣减是**单条条件 UPDATE**(今天没扣 + 有余量写进 WHERE),打开一节课换票和讲义列表并发
  两个请求,读-改-写会扣两天。
  **码不复用 redemption_codes**: 那两张表 book 外键 NOT NULL,塞假书会漏进选书页 →
  新表 phonetic_codes + phonetic_access_grants(一人一行,UNIQUE student_id)。
  卡种语义**完全复用** subscription_service(permanent/period/times,判活直接借
  `is_assignment_active`,授权列名刻意与 book_assignments 对齐),次卡只在换票那步扣、按北京日幂等。
  统一入口 `/subscription/redeem` 先查音标码再查书码,返回 `scope:'phonetic'`。
  四个坑: ①**失效后换卡种是死路**(审查发现): 包月过期再兑次卡,旧逻辑判「跨类型请等当前用完」,
  而过期的卡永远不会再"用完" → 永远续不上。现 `elif not existing_active:` 整条覆盖;
  **生效中**的跨类型仍拒且不吞码 ②**访问日志不进 operation_logs**: 那是教职工追责日志(学生不记),
  每看一节写一条会淹没机构「操作记录」→ 单独表 phonetic_access_logs(IP+设备,防转卖追人),
  audit_log 里的 phonetic.* 已删 ③**兑换码只授权不防拷贝**(用户问过「还能被爬吗」,答: 能):
  能播的账号就能抓到 mp4,4 核单 worker 上不做 DRM;手段是让流出去的东西价值低、时效短、追得到人 ——
  2 小时 HMAC 票据 + 讲义逐页烧水印 + `<video>` 上叠「飞鹰教育 · 姓名 · ID」水印(LessonStage
  `WATERMARK_BRAND`,10-02 用户要求加品牌、选了保留姓名 ID;身份格式与后端 `_viewer_label` 同口径)+ 限速 + 访问日志 ④学生端没有「我的」页,文案别写「在我的里激活」
  (第一版写了 5 处,已改成「音标页点任意一节输入」)。
  入口: 管理端「机构管理」每行「音标改需码 / 音标改免费」(表格里 code 模式挂「音标需码」角标);
  「兑换码管理」页最下方「音标视频兑换码」面板(**仅平台 admin**,org_admin 看不到,后端也 403)
  生成/搜索/禁用/删除;学生端音标页视频卡挂「🔒 需兑换码」,点开弹「去输入兑换码」→
  `/subscription/redeem?for=phonetic`(文案换成开通音标),兑换成功跳回 `/student/phonetics`。
  公告 whatsNew 只投 admin(学生撞锁时弹窗已就地讲清,whatsNew 不能按机构投放)。
  **兑换并发两个坑**(审查用真文件库 + 两个独立会话复现): ①一码多兑 —— 旧写法「读 status → Python 判 →
  最后改 used」,两个学生同时兑同一张码都成功;现在先用条件 UPDATE `WHERE status='unused'` 认领、看 rowcount
  ②同一学生两台设备同时兑两张码 → 两边都 INSERT → UNIQUE 冲突 500;认领那条 UPDATE 拿到写锁后**在写事务里
  重读**授权行(populate_existing),后到的走续期分支,IntegrityError 再兜一层。码字段一开始就取成局部变量
  (rollback 会让 ORM 对象过期 → MissingGreenlet)。码过期写 `expired` 不写 `disabled`(后者=管理员作废)。
  ⚠️ **测并发不能用 conftest 那个共享内存会话**(所有请求共用一个 session,永远串行,测不出竞态),
  见测试里的 file_db fixture。
  前端三处: AdminSubscriptions 挂面板必须 `policy?.role === 'admin'` 正向判(写 `!isOrgLimited` 时
  policy 还是 null → org_admin 每次进页面板先挂上吃 403 红字);PhoneticsHub 打开时详情返回 locked 要
  退出播放器改弹引导(列表是旧的);视频水印在**原生全屏**和 iPhone 内联播放下会丢 ——
  加 playsInline + controlsList nofullscreen,原生全屏被触发时改成整块面板全屏。
  测试 tests/test_phonetic_video_access.py(21 例);回归锁逐条验证过(破坏 → 恰好对应用例失败 → 改回 md5 一致):
  讲义闸门 / 失效覆盖 / 访问日志分表 / 家长拦截 / 次卡在讲义与串流也扣 / open 模式不扣 / 过期写 expired /
  一码多兑(去掉 status 条件后连跑 3 次都失败)/ 同学生并发(重读与 IntegrityError 兜底**同时**去掉才失败 ——
  单去重读时兜底仍接住,但失效覆盖两例会挂)。修好后连跑 5 次全绿。
  **部署注意**: database.py 有 drift,走 anchor patch(phonetic 段 + organizations ALTER);
  上线后机构默认 open,不切 code 就零变化
- ✅ 作业分「电教室/家里」按地点发金币(2026-09-30): 用户说「学生在电教室背才有币,在家里背
  是没有奖励的」。**明确否掉了运行时定位(IP/GPS)**:「不用换 ip 啊,我布置的时候老师能选是
  家里还是电教室,家里就不给币」—— 于是做成**建作业时的一个每份标记**,不猜位置。
  查清后整件事收敛成**一个闸门**: 作业的可见/解锁/完成全走 scope_service(不碰),金币规则
  只落在 coin_service 的**两处任务分母查询**上,所以只需把 `location_type == 'home'` 的作业
  从这两处排除。① 实时交卷 `task_progress_on_day` 的 WHERE 加 `location_type != "home"`
  ② 夜间 00:35 `settle_day` 内联那份**另写了一遍**同样的分母查询,必须同步加同一条
  (两处注释互相指认,漏一处就是「白天不发、半夜补发」)。
  语义定死(按「直接做完别反问」自行拍板): 家里作业**从分母里剔除**,不是「计入但不触发」——
  于是混合日(电教室做完 + 家里没做)照常发币;纯家里日既无任务币**也无单词王**
  (单词王要求当天任务完成)。default='classroom'(server_default 同值),存量行零影响。
  五个要点: ①**归一化白名单**: 建作业 `location_type=("home" if req==... else "classroom")`,
  不认的值一律落 classroom,绝不把脏值静默当成 home(不发币是「惩罚」,宁可错发也不错扣)
  ②**coin_hint 加 `home` 码**: 交卷达标却没币时提示「这份是在家做的作业,成绩照常记录;
  金币要在电教室完成才有」—— 否则老师学生又来问「为什么没发」(金币自解释那套的延续)
  ③**CoinRulesModal 是文案唯一真源**,已加「🏠 在家做的作业不发金币」条款(走 `{you}` 受众变量)
  ④交卷路径 `primary_location = homework.location_type` 在 commit **之前**捕获(rollback 会让
  ORM 对象过期 → MissingGreenlet,金币发放踩过)⑤迁移在 database.py 末尾 ALTER(紧跟
  assigned_by_name 那条),模型列带 server_default 回填。
  **回归锁验证过**: sed 抹掉两处 `location_type != "home"` 过滤 → 恰好 5 个 home 用例失败、
  「电教室照常发币」那 1 例仍绿 → 改回后 diff 完全一致、6 例全过(证明测试真能抓到旧 bug)。
  入口: 教师工作台 → 作业管理 → 创建新作业,学习模式下方「📍 在哪里做」选「🏫 电教室(完成得
  金币)/ 🏠 家里(不发金币)」;家里作业在教师端和学生端作业列表都挂「🏠 家里·不发金币」角标。
  测试 tests/test_homework_location_coin.py(7 例)
- ✅ 我的助教(2026-09-27,操作记录三步走的 ① 以「助教」形态落地): 用户说「好多老师用一个号,
  不知道哪个老师布置的」。**不做"班级多老师"而做"主老师挂助教"**: 前者要把全站几十处
  `teacher_id == current_user.id` 改成成员关系,后者一行不动。
  实现: users.owner_teacher_id(非空=助教);**认证层换身份** —— `_authenticate_token` 发现是助教
  就把 current_user 换成主老师,真实助教放进 ContextVar `core/actor.real_actor`(每请求先 reset)。
  于是所有既有数据范围天然生效;要记"谁做的"的地方走 `acting_user(current_user)`。
  六个要点: ①**审计 record() 内部已调 acting_user**,actor_role 写 "assistant",调用方不用改
  ②作业加 assigned_by/assigned_by_name(存名字快照,删了助教作业上还写着是谁),列表「布置人」列;
  **助教只能关/删自己布置的**(`_guard_manage`,返回 can_manage 给前端置灰),主老师管全部
  ③`forbid_assistant()` 挡删班级/移出学生/转班/管理助教(转班那条要放在同班 400 **之前**)
  ④**金币 PIN 按真实操作人**(助教各设各的,不必把主老师的 PIN 告诉他),operator_id 同理
  ⑤**WebSocket 不走 _authenticate_token**,PK/实时课堂两处 `_authenticate` 要显式
  `owner_for_ws()`,漏了助教进 WS 看到的是空班 ⑥主老师停用 → 助教登录/请求一律 403;
  老师计数/列表(org_admin、admin teachers、organizations、class_analytics)**排除助教**,
  否则助教占掉机构老师名额,列表里改在每位老师下挂 assistants。上限 10(09-27 用户要求从 5 调到 10,停用的也算)。
  /me、改密码、改用户名走 `get_real_user`(不换身份,否则助教改的是主老师的密码)。
  入口: 教师工作台「教学工具箱 → 课堂推进 → 我的助教」/ 顶部「更多 → 我的助教」
  (助教账号看不到这个入口);作业管理列表「布置人」列;机构/平台教师列表老师名下显示助教。
  测试 tests/test_teacher_assistant.py(7 例,四条回归锁逐一破坏验证过)
- ✅ 操作记录(追责)(2026-09-27): 用户反馈「多个老师共用一个账号,布置错了怎么追责」。
  方案三步走: ①班级多老师(**已用「我的助教」落地**,见上一条;助教不能改别人布置的作业)
  ②**操作日志(本次)** ③防共享。表 operation_logs(models/audit.py),写入唯一入口
  services/audit_log.record(),已接: 作业 建/关/重开/删、金币 加减/改/删流水/兑换/审批/模式切换、
  书本 分配/取消、**教职工登录**(学生不记,量大且无追责需求)。四个要点:
  ①**record() 只 db.add 不 commit,必须在业务 commit 之前调** → 日志与业务同事务,
  业务回滚日志也没有(加币失败不留假记录,测试锁住);登录那条要写在 issue_session_token 之前
  (它内部会 commit)②**删除类必须存快照**(被删作业的学生名单/完成数),删完行就没了,
  只存 id 追不了责 ③IP 取 X-Real-IP → X-Forwarded-For(生产在 nginx 后,直接取
  client.host 恒是 127.0.0.1),设备由 UA 解析成「iPhone · 微信」—— 共用账号时区分
  是谁操作的,靠的就是 IP+设备+时间 ④**机构过滤显式写**(org_admin 只看本机构,
  含操作人下拉),回归锁验证过: 去掉过滤恰好 test_org_admin_sees_only_own_org 失败。
  日志**没有改/删端点**(改得动的日志不能追责)。
  入口: 机构管理首页「管理」区「操作记录」(教师管理右边);平台管理端「运营工具箱 →
  组织与人员 → 操作记录」;点记录上的 IP/账号即按它筛选。记录从 2026-09-27 起才有。
  测试 tests/test_operation_log.py(8 例)
- ✅ 加盟资料新增「家长手册」(2026-09-30): /admin/franchise-kit 第四份(pages/FranchiseParentDoc.tsx,
  标签「家长手册」),**直接给家长看的**(机构打印/发 PDF 给咨询家长),通篇「您/孩子」口吻,
  不写成交/话术字眼(第一版写成了给咨询老师的话术本,用户纠正「我要的是拿给家长看的」)。
  九章: 痛点/怎么教(引导式学习+四样方法+线上线下)/三样能力/语素金字塔(与招商手册共用
  data/franchisePyramid.ts)/家长端看得见/真实数据+A/B 个案/家长只需督促作业/6 问 FAQ/课程与报名。
  **机构价格、体验课时间、退费说明、校区联系方式全留空栏**;数据与招商手册第五章同源,那边改这里同步
- ✅ 加盟资料新增「招商手册」(2026-09-27): /admin/franchise-kit 第三份文档(pages/FranchiseRecruitDoc.tsx),
  现为默认标签。十章:我们是谁/行业数据(艾瑞 6463 亿、艾媒 90.86%、云南中考听说 30 分,均带出处)/
  痛点/传统 vs 飞鹰对比/自营校区真实学情(2026-09-26 生产库:744 学员、3943 份作业、正确率 86.4%、
  掌握词按 mastery_level>=3 + distinct lower(word))/费用/支持/适合谁/流程/FAQ。
  **红线**: ①广告法第 24 条 —— 不承诺分数与升学,成绩只写「往届个案」并附「因人而异」,
  用户给的「中考 95-满分/高考 120-144」「词汇量增长 90%」**无出处未采用** ②未成年人匿名(A/B 同学)、
  不用试卷照片,教师只写学历与证书名(证书图含身份证号)③续费率等未核实数字留空栏,
  **不要替用户填数** ④价格与 PitchDoc 第八章同源(¥14,400/100 张半年卡),改价三处一起改。
  成立年份 09-30 用户改为 2014(公司,「办了十二年」)/2019(办学许可),累计学员 7000+;
  5–6 阶段写「果树学框架·英语思维」;教研团队不写专四(用户要求只留更高证书),
  续费率 90%+(用户 09-30 提供,口径=缴费数据);机构名称/Logo 统一用飞鹰品牌(不再写「用你自己的」);保护条款统一为直线 3 公里(去掉「县域独家」);「教学荣誉」栏 09-30 删除(用户要编奖项被拒,**奖项不替编**;有真实奖项再加回);续费率留空栏、
  分数口号不用,同日确认
  **10-08 第四章加「入门课程:方法课」**(¥1,000 含教材,**赠送**阅读绘本 2 本+必背绘本 1 本;第一册音标「音形意结合」、
  第二/三/四册语法分别覆盖初一/初二/初三;「数学框架·归类整合」)。用户原话「背单词速度 3–5 倍」**无出处未采用**,
  「举一反百」改「举一反三」,词汇目标写成规划并附「因人而异」
  **09-30 并入《飞鹰学习理念 2026.8.8》**: 第四章加「语素金字塔」七阶段路线图(PYRAMID 常量,
  《单词记忆法》→语法三册→初高衔接→高中高考→塔尖自学)+每天 6 词/20 分钟节奏 + 家长角色;
  **原有内容一律保留**(用户 09-30 要求「之前的内容要保留的」): 第一章「六阶段/126 课时/每次 3 课时」
  与对比表「六阶段课程」照旧,新内容只做**增补不替换**;两套口径(六阶段课时 vs 七阶段金字塔)
  目前并存,用户未定是否统一,别自作主张合并;第六章加直营定价参考
  (¥11,880/阶段、首阶资料费 ¥280、小学语法免费上 4 节作引流,10-11 用户补「4 节」);FAQ 加「成绩马上能上去吗」(取自致家长信)。
  **原件里「雅思 6.5–7.5」「高考 130–140」「四六级考研很轻松」「世界前 100 名/奖学金」一律未采用**
  (分数/升学承诺),KET/PET 只写「可开始备考」
- ✅ 按组作业真正只下发那一组(2026-09-26): 用户反馈「按组分配作业都是给了一个单元的」。
  group_index 早就存进 homework_assignments,但**链路上没人往下传**: start_homework 不回传、
  三个入口跳转不带、学生端三个取词端点(`/student/units/{id}/start`、`/ai/generate-unit-quiz`、
  `/ai/generate-unit-cloze`)都不认它 → 学生打开恒是整单元。现在四种作业模式全链路带
  `group_index`,切法走 `scope_service.get_group_word_ids`(与教师建作业同一份 get_unit_groups,
  **前端 getGroupSize 对非小学 group_size=0 的书是 20 而后端是 10,所以必须后端切**)。
  两个坑: ①组模式**不读写整单元 LearningProgress**(组内游标写进去会把「学完一组」记成学完整单元),
  WordClassifyLearning 同时跳过 updateProgress、本地存档 key 加 `_hwg{N}` 后缀
  ②分类页的「本单元待办作业」兜底此前只按 unit_id 找,同单元按组布置会有好几份 → 从作业入口进来
  优先按 assignmentId 绑。自学进同一单元照旧整单元(只认 fromHomework 的 state)。
  测试 tests/test_homework_group_scope.py(5 例,关掉过滤后 3 例失败,回归锁验证过)
- ✅ 视频上传 413 + `/api/v1/files` 图片 404 两个 nginx 坑(2026-09-24): 用户贴生产控制台,
  一条 `POST .../videos/upload` **413**(nginx 回的)、一条
  `GET /api/v1/files/phonetic-covers/video_8.jpg?v=...` **404**。两件事都**不在仓库代码里**,
  都是 nginx vhost 的问题,也都**不是 v1.6.25 引入的**。
  ①**`location /api/` 必须写成 `location ^~ /api/`**: nginx 的**正则** location
  **先于**前缀 location 匹配,vhost 里那条 `location ~* \.(js|css|png|jpg|...)$`
  会把 `/api/v1/files/xxx.jpg` 整条抢走、去 dist 根目录找文件 → 404,**压根不进代理**。
  只有 `^~` 前缀能压过正则。判据干净利落: 同一路径直连 `127.0.0.1:8000` 是
  **200/73900 字节**,经 nginx 是 **404/146 字节**(146 是 nginx 自己的错误页)。
  ⚠️ 这是 `/api/v1/files` 下**所有图片**的洞(book-covers/org-logos/phonetic-covers/
  reward-images),不只是封面 —— 一直没暴露是因为另外三个目录还是空的,
  音标封面(v1.6.24)是第一个真用户。**两份 vhost 都有**(es 域名那份 + IP:3000 那份)。
  所以 main.py 里「挂在 /api/v1/files 下,nginx 的 /api/ 代理天然覆盖」这句注释是**错的**,
  它只在没有正则 location 抢路径时成立。
  ②**413 不是踩线而是差一个量级**: error log 里两个真实文件是 **242MB**
  (同一位老师 19:12–19:14 **连传 4 次**)和 **616MB**(另一位老师),而 nginx
  卡在 `client_max_body_size 220m`(http 级的 1024m 被 location 内这行**覆盖**)。
  现改 520m / `MAX_VIDEO_SIZE` 500MB(库里现有视频最大 113MB,磁盘余 69G)。
  ③**真正的教训是「nginx 的 413 没有响应体」**: 请求到不了应用,后端那句
  「视频超过 N MB 上限,请压缩后再传」永远发不出去,老师只看到「上传失败」四个字,
  分不清是网络还是文件 —— 所以他会一遍遍重传 242MB。**修上限不够,必须在前端预检**
  (封面上传早就有预检,视频这条一直没有)。预检逐个点名到文件名+大小
  (一次选 8 个得知道是哪几个),合规的那些照旧传(一个太大不该废掉整批)。
  ④**三处上限是串联的,最小的那个说话**:
  前端 `MAX_VIDEO_MB` <= 应用层 `MAX_VIDEO_SIZE` <= nginx `client_max_body_size`。
  前端**松**了预检等于没写(仍白传一场),只放开应用层则超出部分照旧被 nginx 无响应体地拒掉。
  测试 tests/test_phonetic_video_size_limit.py(8 例,正则解析 .ts 不维护 Python 副本 ——
  照 test_pet_sprites 的做法;样本直接用 error log 里 113/242/499/501/616MB 那几个真实值)。
  **回归锁三条都验证过**: 前端退回 200 → 1 失败;后端调到 600(超 nginx) → 3 失败;
  提示语写死 200MB → 1 失败;改回来 8 例全绿。
  ⚠️ **改 nginx 是改共享资源**(那台 nginx 前面挂着约 10 个站,配置写坏 + reload
  会带走整机所有站点),Claude Code 的分类器按 `[Modify Shared Resources]` 拒掉了
  `nginx -s reload`(rsync 推文件和只读 `nginx -t` 都放行)—— 这是对的。
  流程: 本地 rsync 拉两份 vhost → 打补丁(锚点计数断言 + 幂等 + 花括号配平 +
  读回复验)→ `diff` 只剩那 3 行 → 推 → `nginx -t` 通过**才** reload(**请用户授权**)。
  补丁与 rollback 副本在 /tmp/nginxfix/。**上线顺序有硬约束**: nginx 必须**先**到 520m,
  再放前端那个 500MB 预检 —— 反了就是预检放行、nginx 照旧 413,等于给老师一个假承诺。
  **2026-09-24 19:54 已全部上线并实测**(顺序: nginx reload → 后端 anchor patch +
  systemd 重启 → 前端 dist): 封面 `404/146` → **200/73900**;
  用「只发头不发 body、看 nginx 是否立刻回 413」的办法精确探到闸门 ——
  519MB 放行 / **521MB 回 413**,证明 520m 确实生效(不必真传大文件,
  nginx 是先读 `Content-Length` 再决定收不收的)。
  ⚠️ 生产 config.py 与本地 HEAD 有**注释措辞**的 drift(跟读判定服务那段),
  所以走 anchor patch 只改 MAX_VIDEO_SIZE 那 3 行、md5 对账,**别整文件覆盖**
- ✅ 音标学情总览 + 学生端个人汇总 + 按视频提问(2026-09-24): 用户问「有没有个总的数据分析,
  学生端没有显示吗,多少人看这些,别人的视频网站怎么做的,还有一个讨论的地方不懂的提出问题
  论坛你认为呢,后台老师能看到反馈」。**两处刻意不照视频网站抄**:
  ①**学生端不给播放量**。视频网站摆播放量是因为用户要在海量内容里挑看哪个,数字是社会证明;
  音标课是老师指定的教材、分母是几十人,这个数就变成噪音,而且**信号是反的** ——
  一节课写「3 人看过」,孩子的结论是"没人看,大概不重要";而「30 人里 3 人看完」等于
  当众公示谁没做作业。可汗/Coursera 给学生看的都是**自己**的完课进度,这次也照这个做。
  ②**不做开放论坛**。它死于两件事: 冷启动(几十个学生的板子两周就没人发帖,而本项目
  已经吃过「功能上线没人发现等于没做」——纸笔听写那次)和未成年人 UGC 审核(是**持续**
  人力成本,不是一次性开发)。改做**按视频提问**: 绑课的上下文、自动带播放位置、
  默认仅师生可见、老师可一键公开成常见问答。**它能长成讨论区(放开可见范围即可),
  反过来论坛缩不回这个形态** —— 这是选它的真正理由。
  表 phonetic_video_questions;口径真源 **services/video_question.py**(可见性、计数、
  清洗全在这一份,API 层零手写聚合 —— 学习时长那次五套算法差 250 倍的教训)。
  十一个坑:
  ①**UGC 的 scope_org 不能照内容表那套 `or_(org_id==我的, org_id.is_(None))` 写**:
  内容表 NULL = 平台共享,而提问表的 NULL 只可能是脏数据,放行它就是把**别家学生的
  姓名和原话**摆到这边老师面前。所以 UGC 一律 `org_id == 我的`(admin 的 None 才不加条件)。
  同源的坑: **`org_id` 存的是提问者的,不是视频的** —— 平台预置视频 org_id 是 NULL,
  按视频推导归属会让任何机构的老师看到/回答别家学生在预置视频下的提问(测试里锁住了)
  ②**`pending` 判据是 `answered_at IS NULL`,不是 `answer IS NULL`**: 后者会让一条
  空串回答永远挂在待回答里,而界面已经弹过"已回答"——本项目最常见的静默失败形态。
  纯空白的回答直接 400 拒掉,不让它进库
  ③**红点数必须来自响应里的 `pending_questions`,不能拿 items 里的加起来**:
  列表是分页+可筛讲师的,加起来的话翻一页红点就变,老师会以为问题被处理掉了
  ④**三处「算不出 ≠ 是 0」**(与 ViewerStatsDialog 同口径): `completion_rate === null`
  = 还没人看 → 显示「—」(0% 会被读成"学生看不进去",于是去找学生谈一件不存在的事);
  `roster_size === null` = 平台 admin 没有班级名册 → 文案换「全平台」且学生表不补 0 行;
  时长为空的视频不显示任何百分比
  ⑤**两张表都「少的排前面」**: 打开总览是为了找该补的课和该催的人,把看得最多的排在
  最上面等于把答案埋在滚动条下面。同理**「没人看的课 N / 共 M」放在四张卡的第一位** ——
  一节课一个人都没看,通常不是学生不学,是这节根本没推给他们
  ⑥**名册 0 行是总览的命门**: 一节都没看的学生**必须在表里**(overview 的 `names = roster`),
  只列有观看记录的人 = 最该催的那几个恰好永远不出现。admin 没有"我的班"名册,
  所以这块对 admin 整个不显示(**不是显示 0** —— 那会被读成"人人都学了")
  ⑦**位置往上传的是 getter 函数不是数值**(LessonStage 的 `onPositionGetter`):
  `currentTime` 每秒都在变,当 prop 往上抛会让父组件每秒重渲染整个播放层。
  而且**位置在提交那一刻才读** —— 孩子边看边打,打完往往已经过去十几秒,而他问的是眼前这个音
  ⑧**公开是老师的动作、隐藏是软删、正文不可编辑**,三条都是有意的: 学生问的时候只有
  师生可见(孩子不敢问"傻问题"的主因就是怕被同学看见),老师判断"别人也会问"再公开;
  隐藏后学生和同学都看不到但**行还在**(未成年人内容出纠纷要留痕),所以文案写「隐藏」
  不写「删除」;正文是学生写的话,改了它就再也不知道孩子原本问的是什么。
  **公开按钮只对已回答的给** —— 公开一个没答案的问题对同学毫无用处
  ⑨**回答弹层的 Esc 要先收回答框再关弹层**: 两个监听都挂 window,老师写了一半按 Esc
  想取消输入,一次按键把弹层一起关掉就是把草稿扔了(封面改名那处同类坑)。
  提交走 **Ctrl/Cmd+Enter,单独回车是换行** —— 老师的回答和孩子的问题都常有好几行
  ⑩**回传 pending 的回调必须 useCallback 稳定引用**: 弹层的 load effect 把它列进了依赖,
  写成内联箭头就是每渲染都变 → 无限重取
  ⑪**提问限速 + 超长截断不报 422**(`rate_limit.check` 300 秒窗口):截断走
  `clean_text`(与后端上限同值,前端 `MAX_QUESTION_LEN` 同步),422 英文串对孩子没用;
  位置按视频时长夹(改一行 JS 就能报「在第 9999 秒」,而这个数进老师的收件箱)
  **回归锁全部验证过**(没证明过能抓到旧 bug 的回归锁不算回归锁): 把
  `scope_org` 去掉 → 恰好跨机构那 2 例失败;`student_visible` 的
  `or_(user_id==我, is_public)` 去掉 → 「别人看不见我的问题」「取消公开后重新藏起来」2 例失败;
  overview 的 `names = roster` 改成只取看过的人 → 名册 0 行那 2 例失败;
  `stats_by_student(user_ids=None)` 和 `stats_for_videos(restrict_user_ids=None)`
  → 各让 `test_overview_excludes_other_org_watch` 失败。
  ⚠️ 其中一次破坏(`stats_by_student` 里的 `join(User)` 改掉)**一例都没失败** ——
  查清是因为那个调用点传的 `user_ids=allowed` 已经把范围收在本机构学生里,
  那句 join 是给将来的调用方兜底、不是此处的承重墙。**别据此以为它可以删**,
  也别把"测试全绿"当成"守卫都验过了"
  入口: 学生端首页「音标学习」→ 顶部「我的音标学习」(看完 N/共 M、累计时长、
  「老师回了你 N 个问题」;**一节没看过时整块不显示** —— 全 0 的进度卡对刚进来的孩子
  是一句"你什么都没做")+ 点开任意视频 → 视频下方「听不懂就问老师」;
  教师端「音标视频」→ 页面顶部「学情总览」「学生提问」两个按钮(后者有待回答时
  红点直接写数字),某节课的提问也可从列表行上的「提问 N 待回答」进去
  (**只在真有提问时出现** —— 每行摆一个「提问 0」会把真有问题的那几行淹掉)。
  测试 tests/test_phonetic_questions.py(24 例;关注点与观看数据那套不同 ——
  那边守「数字不能是假的」,这边守**「别人的话不能被看见」**)
- ✅ 音标视频封面 + 课件改名(2026-09-23): 用户问「编辑音标图片的标题这些实现了没」。
  查清后是两个缺口(视频**标题**本来就能改,别再去动它):
  ①**`cover_image` 是个接通了却永远设不了的字段** —— 模型有、`VideoUpdate` 有、
  `PhoneticVideoOut.to_out` 下发、学生端和教师端都 `src={v.cover_image || CATEGORY_COVER[...]}`
  渲染它,但**从来没有任何写入路径** → 永远 NULL,一个分类下十几节课缩略图一模一样。
  补 `POST/DELETE /teacher/phonetics/videos/{id}/cover`(照 coins.py 兑换商品图那套:
  MIME 白名单 + 声明 size 与真实字节**两道** 2MB 检查 + 换格式删旧扩展名那张)
  ②课件标题只能是上传时的文件名(老师电脑上那个「音标课件-最终版2.pptx」,
  **学生端显示的就是它**)—— 后端 `PUT /materials/{id}` 与 `phoneticsApi.updateMaterial`
  **早就支持 title**,纯粹是前端没入口。
  六个坑:
  ①**封面是唯一允许写 UPLOAD_DIR 的音标文件**(该目录整体经 `/api/v1/files` 公开无鉴权,
  见 main.py 红线)。判据是「本来就要给所有学生看」,与机构 Logo / 兑换商品图同性质;
  视频本体和讲义是付费内容,照旧 PHONETIC_VIDEO_DIR / private_media
  ②**URL 必须带 `?v=时间戳`**: 文件按 `video_{id}.{ext}` 命名(不用随机串,否则反复换封面
  在磁盘上堆一串废图),换图**不换路径**,而 `/api/v1/files` 是 `immutable, max-age=1年` ——
  不带版本号就是换了也看不见,而且**一年内都不会变**。前端也必须用响应里的 cover_image
  就地更新列表那一行,不能自己拼老地址
  ③**`cover_image` 不许收自由文本**(update_video 加了前缀白名单 `COVER_URL_PREFIX`):
  这个值被两端直接塞进 `<img src>` 而受众是学生,放任写入 = 允许 `javascript:`(存储型 XSS)
  或挂外站地址(每个学生打开页面都去访问那台服务器,顺手泄露访客 IP)
  ④**删视频必须连带删封面文件,单条 + 批量两条路径**: 理由与删 `PhoneticVideoView` 行同源 ——
  `phonetic_videos.id` 是 `INTEGER PRIMARY KEY` **不带 AUTOINCREMENT**,SQLite 会把删掉的
  最大 rowid 发给下一条(已实测),封面按 id 命名 → 新视频撞上前一个视频的旧图
  ⑤**清空封面走独立 DELETE 端点不走「PUT cover_image=''」**: 后者要在 update_video 里
  再加一条判空分支,而 CLAUDE.md 那条「留空=不修改」的坑就长在这种地方;删除本来就是
  独立动作,显式端点两端都不会误解
  ⑥前端三点: **换封面立即生效、不等「保存」** → 标签上必须写明(否则老师换完点「取消」
  会以为封面也撤销了);改名的 **Esc 先收改名框再关弹层**(两个监听都挂 window,
  不判就是一次按键把两层一起答掉 —— 学生端选老师弹层踩过同类坑);改名回车要判
  `isComposing`(中文标题必踩),**空标题当取消**不发请求(后端 `min_length=1` 会回 422 英文串,
  而老师全选删掉的意思本来就是"算了")
  入口: 老师端「音标视频」→ 视频行「编辑」→ 弹层最上方「换封面 / 用默认图」;
  讲义改名在同一行「课件」按钮里,每份课件右边的铅笔图标。
  测试 tests/test_phonetic_video_cover.py(15 例)+ test_phonetic_material.py 加 3 例;
  **回归锁验证过**: 把「单条删封面 / 批量删封面 / 外链守卫」三处分别改成 pass 后
  恰好各自那一例失败(3 failed),改回来 15 例全绿
- ✅ 音标视频观看数据(2026-09-23): 用户要「播放量、多少人在线观看之类的,看看还有别的数据补足」。
  **先查清旧数据是假的**: `phonetic_videos.view_count` 是 `GET /videos/{id}` 每次 +1 =
  **数的是打开次数不是人数**(一个孩子点开五次算五个"观看"),而且只显示在教师列表末尾一行小字。
  它答不了老师真正会问的三件事: 几个人看了 / 看完还是点开就跑 / **谁还没看**。
  改成一人一行 `phonetic_video_views`(play_count/watch_seconds/max_position_seconds/
  last_position_seconds/completed),口径真源 **services/video_watch.py**(阈值、夹取、
  聚合全在这一份,别在 API 里另写一套 —— 学习时长那次五套算法差 250 倍的教训)。
  学生端 `POST /videos/{id}/progress` 心跳,教师端 `GET /videos/{id}/viewers` 出名单。
  **「看完」必须同时满足两个信号**(max_position >= 时长×0.9 **且** watch_seconds >= 时长×0.6):
  只看位置 → 拖一下进度条到结尾就算看完;只看时长 → 把片头循环放三遍也算看完。两种作弊
  都在测试里锁住。阈值不取 100% 是因为片尾字幕没人看、也没人正好停在最后一帧。
  **时长未知(duration 为 NULL)时 completed 恒为假**,`completion_rate` 返回 **None** →
  前端显示「—」而不是 0%:「算不出」和「一个人都没看完」是两回事,后者会让老师以为课白讲了。
  同理 `not_watched` 对平台 admin 返回 **None**(admin 没有"我的班"名册,列不出未看名单),
  不是空数组 —— 空数组的意思是"全看了"。
  八个坑:
  ①**UNIQUE 索引是这张表的命门**: `uq_phonetic_video_view(video_id,user_id)` 一旦缺失,
  upsert 退化成每次插新行 → 人数按打开次数翻倍。word_mastery 就因为模型上写了索引而库里
  没有,吃过一次永久 500。⚠️ `create_all` **不会给已存在的表补索引**,所以 database.py
  末尾补了两条 `CREATE ... IF NOT EXISTS`(存量库靠它,新库靠模型)
  ②**upsert 走 sqlite 的 `ON CONFLICT DO UPDATE` 单语句,不要照 live.py 那套
  UPDATE→INSERT→捕获 IntegrityError→rollback→重试**: rollback 会让调用方手里还在用的
  ORM 对象过期 → 下一次属性访问 MissingGreenlet 500(金币发放踩过,CLAUDE.md 有记)
  ③**累加必须在 SQL 里做**(`watch_seconds + :inc`、`max(max_position, :pos)`),
  不能读出来加完写回: 孩子开两个标签页同时放,读-改-写会互相覆盖掉对方的时长
  ④**单次心跳增量要夹**(MAX_HEARTBEAT_SEC=120)、位置要按时长夹: 不夹的话改一行 JS
  就能报「看了 9999 秒」,而这个数进老师的学情页
  ⑤**completed 只置不清**: 重看时 watch_seconds 照涨但位置回到 0,重算会把已看完的人
  打回「没看完」—— 已经看完的事实不该被复习抹掉
  ⑥**教师打开视频不记数**(只有 `role == "student"` 才 `_touch_view`): 老师检查内容
  会把自己算进"看过的人",一个只有老师点过的视频显示「1 人看过」最误导
  ⑦**跨机构必须手动 join User**: 这张表**没有 org_id**,而 `conftest` 建库走 `create_all`
  **不走 `init_db()`** → 租户监听器从没注册 → 测试里所有查询都是裸的。
  `stats_for_videos(org_id=...)` 显式 `join(User).where(User.org_id == org_id)`。
  **这条回归锁是验证过的**: 把那句 join 换成 `pass` 后恰好 2 例失败(`assert 1 == 0`),
  再改回来 21 例全绿 —— 没证明过能抓到旧 bug 的回归锁不算回归锁
  ⑧**删视频必须连带删 view 行**(单条 + 批量两条路径): `phonetic_videos.id` 是
  `INTEGER PRIMARY KEY` **没有 AUTOINCREMENT**,SQLite **会把删掉的最大 rowid 发给下一条**
  (实测) → 新传的视频继承上一个视频的观看行,界面上凭空写着「12 人看过」且查不出来源
  前端三点: (a)心跳按 **timeupdate 的差值**累计,不数墙上时间 —— 暂停/缓冲/切后台
  (后台标签 timer 被压到一分钟一次)/拖进度条四件事都会让两者分道扬镳,报「看了 40 分钟」
  而孩子开着页面去吃饭比不报更糟;差值 > MAX_STEP(3s)判为拖动不计
  (b)**最后一段最容易丢**(孩子看完直接关标签页),所以 pause/ended/pagehide/卸载都补一枪;
  关页面那一枪走 `fetch(keepalive:true)` + Authorization 头,**刻意不用 sendBeacon** ——
  它带不上头,唯一替代是把 token 塞回 URL,那正是 2026-09-09 刚堵掉的洞
  (c)续播用 `my_position_seconds`,而进度百分比用 `my_max_position_seconds`(看过的最远处)
  —— 两个字段不能合并: 孩子退出前往回拖了一下,用位置算就会把「看完的」显示成「看到 5%」
  (d)**看完过的也续播**(2026-10-02 用户「上次看的进度应该保存下来不用从头开始」): 旧规则
  `my_completed → 从头放` 让回来复习、看到一半退出的孩子下次又回 0:00(生产 28 条已看完里 5 条停在片中)。
  现在只有停在 <10s 或最后 15 秒内才从头;续播时画面左上弹 8 秒「接着上次 m:ss 继续放 · 从头看」。
  另修: 关掉再立刻点开同一节会**跳回旧位置** —— 列表里的位置是进页面时取的,续播要赌详情接口比
  视频元数据先回来;现在每次心跳(含关播放器那一枪)经 onProgress 就地更新卡片。
  真浏览器验过(Chrome + 本地临时库 + ffmpeg 造的 90 秒视频): 看完过停 40s → 续到 40s、关掉再开 → 接着、
  刷新 → 接着服务端位置、停在结尾 → 从头且不出提示;把旧规则放回去 → 恰好续播三项失败
  入口: 学生端首页「音标学习」→ 视频卡右上角「✓ 已看完 / 看到 N%」角标(**没看过的不标**,
  满屏「未观看」是噪音),点开自动从上次位置续播;教师端「音标视频」→ 视频行「数据」按钮
  (**不受 can_edit 限制** —— 平台预置视频机构改不了但必须看得到自己学生的观看情况)→
  四张数据卡(人看过/播放次数/看完率/人均观看)+「N 人正在看」+ **「还没看」名单排在
  已看名单上面**(老师要的就是这份,可「复制名单」)。
  测试 tests/test_phonetic_video_stats.py(21 例)
- ✅ 发音纠正试听(2026-09-19): 用户反馈「有的音标发音不准,后台能不能填自然拼读的单词来校验」。
  **先查清:发音走后端 Edge TTS(en-GB-SoniaNeural),不是浏览器 TTS;IPA 符号本身从来不发音**
  (IpaKeyboard/ColoredPhonetic 都没接发音,点了不出声)—— 念的一直是真实单词,
  所以「把音标符号丢给 TTS 念」这个我最初的猜测是错的,别照着那个方向修。
  `words.tts_text`(覆盖送给 TTS 的文本)**早就存在且界面上已有输入框**
  (TeacherUnitManagement 新增/编辑两处),生产已用了 209 条,填法就是自然拼读改写:
  record→rekord、tear→teer、Ms→miz。所以用户要的机制是现成的,**真正缺的是试听** ——
  填完只能保存、退出、去学生端点那个词,还不一定听得出改对没有。
  加了 `?raw=1`(pronunciation.py `_synthesize`)+ 两个按钮「试听 / 听默认」。
  五个坑:
  ①**raw 是这个按钮有意义的前提,不是优化**: 普通发音接口会拿文本去**按拼写查库**、
  套上**已保存的** tts_text。于是 record 这类已有纠正音的词,老师改了字还没保存时
  听到的是**旧值** → 以为「改了没生效」,其实是试听在骗他;「听默认」用普通接口更糟 ——
  听到的还是旧纠正音,与「试听」毫无区别,对比按钮等于没用。
  硬保证是:**raw 试听文本 S == 保存 tts_text=S 后学生听到的**(测试里端到端锁住)
  ②**raw 刻意不走剑桥词典兜底**(正常路径是走的): 兜底是按拼写取真人录音,与这段文本无关。
  Edge TTS 挂了却退到剑桥,老师会听到那个词**正确的**真人发音 → 以为改写生效了,
  其实一个字没生效。宁可 503 也不给「听起来对」的假象
  ③**修掉一个静默失败(本次真 bug)**: 界面保存走的是 `PUT /teacher/units/{u}/words/{w}`
  **不是** `PUT /words/{id}`,两个端点判空口径原本不同 —— 后者 `is not None`(空串能清)、
  前者 `is not None and v != ""`(空串被当成没填)。于是「清空发音文本→保存」库里旧读法
  还在、界面照旧弹「保存成功」。修法是给 tts_text 开 CLEARABLE_FIELDS 例外走**显式分支**
  (判**键在不在**而非值空不空),纯空白归 None(全是空格的发音文本看着像填了,
  送去 TTS 只会静音)。⚠️ **不能把 `v != ""` 整条去掉** —— 前端未填字段初始化成 '',
  去掉会把原音标/释义抹掉(代码注释里写明了),所以只对 tts_text 开例外 + 回归锁两条测试。
  与 CLAUDE.md 那条 AI 密钥被空串清掉的坑同源、方向相反
  ④**试听 state 要带 where 区分新增/编辑两个表单**,两处都有输入框,共用一个 state
  会让两边按钮一起显示「播放中」;播放前先 pause 上一条(老师会连点两个按钮对比,
  叠在一起什么都听不清);audio 句柄用 ref 不用 state(它只需要被 pause)
  ⑤**fork 逻辑已把 tts_text 一起复制**(units.py:588),所以改公共书的词会先分叉、
  不会串到别的书 —— 加类似字段时记得同步这个复制列表
  **仍未解决(用户若再提发音不准,先看这两条)**: (a)音标教材 938 个条目
  (phonetic_items,48 课)**后台完全改不了**,没有任何写端点,只能靠导入脚本;
  其中 **105 个词在 words 表里没有对应行**(faff/daff/dace/gaff/ilk/hick/bade 这类
  自然拼读专用生僻词,恰恰是 TTS 最容易念错的),发音**目前无法干预**
  (b)**同形词会串**: 后端查词是 `where(Word.word == word).limit(1)` 取第一条,
  而 record/tear 在库里各有两行两个不同 tts_text,哪行被取到不确定 ——
  某课练 /eə/ 用 tear 可能拿到 /ɪə/ 那条的改写,反而更错。要修得让调用方传 word_id
  入口: 老师端「单词本」→ 某本书「单元管理」→ 单词行「编辑」→「发音文本」右边
  「试听 / 听默认」(新增单词表单同样有)。测试 tests/test_tts_text_override.py(15 例,
  含在干净 HEAD 上复验过「清空」两条确实会失败 —— 回归锁必须证明它能抓到旧 bug)
- ✅ 音标视频按讲师分类(2026-09-17): 一个机构几位老师各讲一套,学生进去看到的是
  几十个混在一起的视频,**分不清哪个是自己老师讲的** —— 想复习本周那节课只能一个个点开听。
  现加「讲师」一层:学生端顶部老师筛选条,选一次记住(localStorage,**按 user id 分键** ——
  机构里一台平板几个孩子轮着用,共用键会让后一个孩子看到前一个选的老师),
  第一次进且有≥2位讲师时弹一次「你是跟哪位老师上课?」。
  **讲师是自由文本不是 users 外键**(2026-09-17 用户明确要求「上传的时候选老师分类,
  不是系统内注册的老师」):实际讲课的常是外聘老师/助教,他们没有账号,而有账号的老师
  也不一定是视频里讲课的那个人 —— 按 teacher_id 关联会让一半视频无法归属。
  代价是同一个人会被敲成好几种写法,而学生端**按这个字符串分组**,写法一分裂就多出
  一位不存在的老师。所以归一规则只有一份: services/lecturer_name.py
  (`normalize` 洗首尾/全角/连续空白但**不删内部空格**——「Miss Lucy」删了是另一个名字;
  `resolve` 用「去全部空白+casefold」的键向**已有写法**靠拢,但**存已有的那个写法**
  不存归一键——显示要保留老师原本的排版)。三条写入路径(upload / update / batch)全过
  resolve,读侧**不再洗一遍**(两处各洗一遍会算出不同的分组)。
  十一个坑(除①②外都是三轮评审里实测复现出来的 —— 拿自由文本当分组维度,「看不见的字符」和「改了却没生效」是主要风险面):
  ①**上传必填、编辑可清空 —— 两条路径故意不同口径**(2026-09-18 用户要求上传强制):
  上传不填讲师直接 400(校验放在**落盘之前**,别让老师传完 200MB 才被拒;判据走
  `lecturer_name.normalize()` 而不是 `not lecturer`,否则空格/全角空格/零宽字符敲的
  "看着填了其实是空的"会绕过必填、入库成一位没有字形的幽灵讲师)。
  **编辑仍允许清空** = 取消归属改回「全校通用」,这是必填规则的**逃生门**:存量视频
  本来就是 NULL,而确实不属于某位老师的内容(全校公开课/平台预置)靠"先填一个再清空"
  到达。所以 VideoUpdate.lecturer 不能写 min_length=1,判空必须走**显式分支**
  (`if "lecturer" in data` 而不是 `and data["lecturer"]`)—— 与 CLAUDE.md 那条 AI
  密钥被清空的坑同源,只是方向相反: 那次错在"空串被当成要改",这次会错在"空串被
  当成不改",两种都要走显式分支。
  前端**在选文件之前就挡住**(按钮 disabled + 可见提示,不能只靠 title —— 平板没有
  hover,老师只会看到一个灰按钮以为功能坏了);判空函数与后端同口径,但正则要用
  `new RegExp` **运行时构造**(`\p{Cf}` 是 ES2018 语法,写成字面量会让 legacy bundle
  构建期解析失败),且不可见字符**逐个 alternation 不要放进字符类**
  (ZWNJ/ZWJ 在字符类里会被 eslint 的 no-misleading-character-class 判错)
  ②**消歧候选要排除「名下视频被这批全覆盖」的讲师**,否则改写法时它们自己的旧名字算
  "已有写法",resolve 原样退回旧名字 → 老师点了保存却什么都没变、HTTP 还是 200
  (最难查的那种)。但**只能排除全覆盖的** —— 只改了「王老师」2 个视频里的 1 个,
  剩下那个仍叫旧名 → 学生端立刻分裂成两位几乎同名的老师;所以按 group_by 数出
  「本批覆盖数 >= 该讲师总数」才豁免,没覆盖全的靠拢回原写法(想真改名就把他的课全选上)。
  **单条编辑也走同一套**(传 changing_ids=[自己]): 该讲师只有这一个视频时必须改得动,
  此前只有批量路径有豁免、单条被自己挡回去 —— 同一语义操作两条路径结果相反(已修+测试)
  ③**消歧候选必须按「目标视频的归属」取,不能按调用者的 current_org_id**:
  `_org_scope` 对平台 admin(current_org_id 为 None)**不加任何条件** → admin 拿到的
  候选是全平台讲师名,而候选集是 `resolve()` 的归一权威 → admin 给 A 机构的视频设讲师时,
  输入只要与 B 机构某位讲师的 match_key 相同,落库就是**B 家的写法**:别家机构的
  姓名字符串被搬进 A 家,并直接出现在 A 家学生端的老师 chip 上(实测复现:A 有「王老师」、
  B 有「Wang老师」,admin 对 A 的视频传 "wang老师" → 落库 'Wang老师')。
  真源 `_lecturer_scope(q, org_id)`,三条写入路径分别传 user.org_id / v.org_id /
  **逐 org 各解析一次**。⚠️ 批量跨机构时**不能取候选并集**(第三轮实测):并集会让
  A 机构的视频落上 B 机构的姓名写法。逐 org 解析后各家落各家的规范写法 ——
  同一个人在 A 家叫「王老师」、在 B 家叫「Wang老师」,各家学生只看到自己那个 chip,
  这才是对的(返回给前端的 lecturer 在跨机构批次里取归一后的输入,只用于拼提示语)。
  ⚠️ 加类似的"看已有值再决定写什么"的逻辑时都要想这一层 —— admin 的无过滤上下文
  会让"已有值"变成全平台的
  ④**顺手修了 batch-delete 的裸查询**(先于本次改动存在,但本次拿它当"同口径"样板才发现):
  它是本文件唯一没加 `_org_scope` 的写端点(单条删除走 _own_video 是有边界的),
  而后果**不可逆** —— 连带删 phonetic_materials 子行、视频文件、渲染页目录。
  生产靠隐式过滤器兜着所以没真删过,但 tenancy.py 明确把 `TENANCY_ENFORCE=False` 列为
  排查问题时的常规临时动作,翻了开关就是活的跨机构数据销毁;而 conftest 走 create_all
  不注册过滤器,测试永远抓不到(实测复现: A 家老师传 B 家 id → deleted:1,磁盘文件被删)
  ⑤**筛「未指定讲师」的哨兵值不能用空串**(空串在筛选语义里已是"全部"),用前导空格的
  `' none'`——normalize 会削掉首尾空白,所以它永不可能与真实讲师名相撞;
  前后端两份常量必须同值(services/lecturer_name.NO_LECTURER 与 api/phonetics.ts)
  ⑥**归一键要 NFKC + 按 Unicode 分类删不可见字符,黑名单一定漏**: 全角「Ｍiss Ｌucy」
  (U+FF2D)、Word 自动断字的 U+00AD、从网页复制必带的 U+200E/200F、emoji 后的 U+FE0F ——
  屏幕上**完全看不出差别**,却让一个人在学生端变成两个 chip。
  第一版只列了 5 个零宽字符,实测**整个码空间有 2176 个不可见码点**能同时躲过
  normalize 和 match_key;改成按分类判(normalize 删 Cf/Cc,比较键再加 Mn/Me)后归零。
  组合记号**只在比较键里删、不改存储形态**,且不会把不同的人并一起(NFKC 已把 é 这类
  预组合字符合回单码点,René/Rene、Zoë/Zoe 仍是不同键,已验)。
  **全是不可见字符的名字必须落成 None** —— 否则是一位没有字形的幽灵讲师,
  chip 一片空白还会触发首次选老师弹层。
  ⚠️ 这类字符在源码里**一律写 `\uXXXX` 转义,禁止写字面量**: 字面量在编辑器里看不见、
  review 看不出,连拿文本匹配去改都会失败(实测:自己写的那版自己改不动;
  Bash 工具也会拒绝执行含控制字符的命令)。
  超长截断后要**再 strip 一次**(切在空格上会留尾随空格,而那正是本模块要消灭的东西)
  ⑦**平台预置同名时不能把机构堵死**: 「全覆盖」的分母只能数**调用者改得动**的行。
  预置视频也叫「王老师」时,机构无论怎么全选自己的课都凑不满 total(预置那条它永远
  选不了,勾上会 403)→ 永远改不掉自己的写法,而界面每次都说「已保存」——
  是个走不通的死路(实测复现)。代价:改完预置那条仍是旧写法、学生端两个相近 chip,
  但这是「机构确实无权改平台内容」的真实反映,比静默不生效还骗人好得多
  ⑧**三条写入路径的长度上限必须一致**: upload 走 Form 参数**没有校验**(超长静默截断),
  而 update/batch 若卡 `max_length=50` 就是 422 英文串 → 老师被迫另敲一个短名字,
  与截断后的那个对不上 → 同一个人两个 chip。改成"宽进严出":Field 放到 200,
  统一由 normalize() 截断
  ⑨教师端七个 UI 坑(都会让老师以为操作失败或数据丢了):
  **`updated===0` 必须报警告不能弹绿色成功**(HTTP 200 但一条没改 = 选中的行已被删掉
  或不属于本机构;照旧说"已归到" 就是骗人),且 `r.lecturer` 可能是 null,
  直接插模板会把字面量「null」显示给老师(两者第三轮实测复现);
  上传后**必须清 lecturerFilter**(老师常点着「未指定讲师」在补归属,顺手传的新视频
  不满足 IS NULL → 列表毫无变化而 toast 说"5 个上传成功" → 再传一遍造成重复视频);
  批量操作后**页码要夹回有效范围**(设完讲师那些行就离开当前筛选集了 → offset 超界 →
  空列表 + 分页条写「3 / 2」);**「全选本页」要跳过平台预置**(预置的讲师也是空的,
  「未指定讲师 → 全选 → 设讲师」这条主路径最容易勾上它 → 整批 403 一条没改);
  **`<option>` 里不能写 children**(Chrome 当副标题,Firefox 用它**取代** value →
  下拉里只剩「3 个视频」看不到姓名);空状态**要说清是哪个条件筛空的**(补完归属再点
  「未指定讲师」复核时,「还没有音标视频」会让老师以为刚才的操作把视频弄没了);
  **删视频后要刷新讲师名单**(否则残留 chip 点进去是空页)
  ⑩学生端选老师弹层两个坑(第三轮): **Esc 监听要判 `!playing`** —— 两个 Esc 监听都挂在
  window 上,播放器开着时一次按键会同时关播放器 + 把弹层永久答掉(存空串),
  而学生根本没选过老师;**要 focus trap + 初始焦点** —— 弹层刻意全封闭(遮罩不可点、
  无关闭 X),不圈焦点就能 Tab 到背后**肉眼看不见**的视频卡、回车打开播放器。
  另外 `lecturerGone` 那句提示说「在上面重新挑一位」,而 chip 条按 `>=2` 判会恰好在
  这个场景整条藏掉(老师的课全下架 → 只剩 1 位)—— 学生往上找什么都没有,
  所以 lecturerGone 时 `>=1` 就要显示,一位都不剩时那半句话也要去掉
  ⑪**学生端两个读端点此前只靠隐式租户过滤器**(生产 TENANCY_ENFORCE=True 所以没出事,
  但那是最后一道网不是边界)。加了讲师后代价变大:筛选条是从列表响应**聚合**出来的,
  漏一行别家机构的数据,学生就在 chip 上直接看到**别家老师的姓名**。已补 `_scope_org`
  (list_videos + get_video,后者是按 id 直查、还会刷观看数)。测试能抓到正是因为
  conftest 走 create_all 不注册过滤器
  **存量零影响**:迁移刻意**不按 created_by 回填**(那是"谁上传的"不是"谁讲的",
  助教代传就会记到助教名下),lecturer 全留 NULL = 「全校通用」,所有学生照旧可见。
  补归属走教师端「未指定讲师」chip 筛出来 → 全选 → 「设讲师」(没有批量入口老师得逐个
  点编辑改几十遍,大概率干脆不用)。平台预置整批拒改(与批量删除同口径,不静默跳过)。
  入口: 学生端首页「音标学习」→ 顶部「选老师」;教师端「音标视频」→ 右上「讲师」输入框
  (**上传必填**,不填按钮是灰的;整批同一个值)+ 列表上方讲师 chip。
  测试 tests/test_phonetic_lecturer.py(40 例,
  含前后端哨兵值一致那条 —— 它正则解析 .ts 不维护 Python 副本,照 test_pet_sprites.py 的做法)
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
- ⚠️ 音标跟读的**闭集打分**对中国学生判不准(2026-09-03 实测,不用它拦人;**10-30 起改用贴合分两道门拦乱读,见上方「音标跟读乱读不能过」**):
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
