# 英雄通关 + 班级光荣榜 设计文档

**Date**: 2026-05-23
**Scope**: 学生端
**Status**: Draft - awaiting user approval

---

## 1. 目标

把现有"分类通关页 emoji + 静态 hero 图"升级为「原创热血英雄角色登场」体验，并在班级范围内新增一个显眼的「光荣榜」，让学生持续看到自己/同学的高光时刻。

具体期望：
1. 通关时出现的人物**每次不一样**（按档位随机抽角色池），不是固定 emoji
2. 失败档（<80 分）的画面要**鼓励**学生，不是单纯"再来一次"
3. 排行榜尾段（排名靠后）的学生也要被**鼓励**
4. 班级光荣榜放在学生 Dashboard 的**显眼位置**

---

## 2. 范围（本期做什么、不做什么）

### 本期做

| # | 项 | 类型 |
|---|---|---|
| 1 | 用 image2 接口生成 8 张 2K 原创角色立绘 → 提交到 `frontend/public/heroes/` | 一次性脚本 |
| 2 | `users` 表新增 `hero_id` 字段 + 学生注册时随机分配（含存量学生回填） | 后端迁移 |
| 3 | `VictoryScreen`（分类通关全屏页）按档位随机抽角色 + 入场/呼吸/光环 + SVG 招式特效 | 前端重做 |
| 4 | `CompletionScreen`（通用完成页）顶部 hero 横幅换成角色立绘 | 前端微改 |
| 5 | `ChallengeVictory`（错题挑战胜利）第三幕奖励揭示换成角色登场 | 前端微改 |
| 6 | 新增后端 `GET /api/v1/student/class/hall-of-fame` 接口（实时聚合三类高光） | 后端新接口 |
| 7 | 前端新增 `HallOfFame` 组件，挂载到 `StudentDashboard_New` 顶部显眼位置 | 前端新组件 |
| 8 | `LiveLeaderboard` 排名靠后（>=10 名或后 30%）时显示鼓励角色 + 文案 | 前端微改 |
| 9 | `VictoryScreen` retry 档（<80 分）显示鼓励角色 + 鼓励文案 | 已合并在 #3 |

### 本期不做

- 序列帧动画 / 视频
- image2 运行时调用（生成一次，PNG 提交进 git，运行时零依赖）
- 学生自选角色界面
- 教师端 / 管理员端任何改动
- 光荣榜的写入/管理界面（纯展示，从现有数据实时聚合）

---

## 3. 角色池设计

8 个原创角色，分 3 档：

### 满分池（perfect, 100 分）— 3 个霸气登场角色

| ID | 代号 | 形象关键词 |
|---|---|---|
| `hero_blaze` | 烈焰 | 红/橙战袍少年，手握火焰拳，背后火焰爆气 |
| `hero_thunder` | 雷霆 | 蓝/银铠甲少女，长剑蓄电，闪电环绕 |
| `hero_galaxy` | 星河 | 紫/金披风战士，手持星辰法杖，星河漩涡背景 |

### 优秀池（great, 80-99 分）— 3 个开心鼓掌角色

| ID | 代号 | 形象关键词 |
|---|---|---|
| `hero_sunny` | 晴空 | 黄/橙学子，双手比赞，阳光放射 |
| `hero_wave` | 潮汐 | 蓝/绿少年，托举奖杯，水花飞溅 |
| `hero_breeze` | 微风 | 粉/白少女，撒花瓣，樱花飘 |

### 重练池（retry, <80 分）— 2 个鼓励陪伴角色

| ID | 代号 | 形象关键词 |
|---|---|---|
| `hero_phoenix` | 凤凰 | 红/金少年，单手举拳向前，凤凰虚影伴飞，眼神坚定 |
| `hero_dawn` | 黎明 | 暖色调少女，伸手邀请姿势，晨光背景，温暖微笑 |

**所有角色统一规范**：
- 中国风 + 日漫融合，**完全原创**，不影射任何已知作品角色
- **正面 2/3 视角**，胸像 + 上半身，构图重心居中偏上
- **2048x2048**，PNG，透明背景**不要**（要带场景背景，便于做"全屏沉浸"）
- 风格统一：扁平+渐变，类似《原神》/《崩坏：星穹铁道》主视觉，**不要**写实，**不要**赛博朋克

---

## 4. 数据层（后端）

### 4.1 users 表迁移

本项目无 alembic，按现有约定走两条路并存：

1. **新部署**：在 `backend/app/models/user.py` `User` 类加 `hero_id = Column(String(32), nullable=True)`，让 `Base.metadata.create_all` 自动生成
2. **存量库**：在 `backend/app/core/database.py` `init_db()` 末尾追加幂等 ALTER（参考 23-128 行已有的 `try / except` 模式）：
   ```python
   try:
       await conn.execute(text("ALTER TABLE users ADD COLUMN hero_id VARCHAR(32)"))
   except Exception:
       pass  # 列已存在
   # 同步回填 NULL 的现有学生
   await conn.execute(text(
       "UPDATE users SET hero_id = "
       "(CASE id % 8 WHEN 0 THEN 'hero_blaze' WHEN 1 THEN 'hero_thunder' ... END) "
       "WHERE hero_id IS NULL AND role = 'student'"
   ))
   ```

- 写入时机：注册流程末尾（`backend/app/api/v1/auth.py` 注册接口），从 8 个角色里**等概率**随机写入
- 前端读取：从 `/api/v1/auth/me` 返回字段读 `hero_id`，NULL 时前端回退 `hero_sunny`

### 4.2 光荣榜接口

`GET /api/v1/student/class/hall-of-fame`

**入参**：从 token 解出 `user_id` → 反查该学生所在班级（如果学生没有班级，返回空列表 + `class_name=null`）

**返回**：
```json
{
  "class_id": 7,
  "class_name": "三年级二班",
  "period": "2026-05",
  "champions": {
    "perfect_king": {
      "user_id": 42,
      "nickname": "小明",
      "hero_id": "hero_blaze",
      "metric": 12,
      "metric_label": "12 次满分通关"
    },
    "speed_king": {
      "user_id": 18,
      "nickname": "小红",
      "hero_id": "hero_thunder",
      "metric": 87,
      "metric_label": "最快 87 秒满分通关"
    },
    "progress_star": {
      "user_id": 33,
      "nickname": "小刚",
      "hero_id": "hero_phoenix",
      "metric": 41,
      "metric_label": "本月进步 41 分"
    }
  }
}
```

**任意一项可能为 null**（班级里没人满足条件时）。前端要能渲染缺位状态。

**聚合规则**（基于现有 `StudySession` + `LearningProgress` 表）：
- **perfect_king**：本班学生本月（自然月）`StudySession` 中 `correct_count == words_studied AND words_studied >= 5` 的会话条数最多者
- **speed_king**：本班学生本月**满分**会话（同上条件）中 `time_spent` 最短者
- **progress_star**：本月**最新 3 次会话**平均正确率 vs **上月最后 3 次会话**平均正确率，差值最大者（差值需 ≥ 10%，否则空缺）

**性能考虑**：单班级查询数据量可控（一般 <50 人 × 一个月会话数），用 SQL 聚合即可，不加缓存表。若实测 P95 > 500ms 再考虑加 `class_highlights_cache` 表（不在本期）。

---

## 5. 前端

### 5.1 共享工具：`src/utils/hero.ts`

```typescript
export const PERFECT_POOL = ['hero_blaze', 'hero_thunder', 'hero_galaxy'] as const;
export const GREAT_POOL = ['hero_sunny', 'hero_wave', 'hero_breeze'] as const;
export const RETRY_POOL = ['hero_phoenix', 'hero_dawn'] as const;
export const ALL_HEROES = [...PERFECT_POOL, ...GREAT_POOL, ...RETRY_POOL];

export interface HeroMeta {
  id: string;
  name: string;       // "烈焰"
  tier: 'perfect' | 'great' | 'retry';
  imageUrl: string;   // /heroes/hero_blaze.png
  accentColor: string;  // 主色，用于光环/按钮渐变
  taglinePerfect?: string;  // "炎之拳，所向披靡！"
  taglineEncourage?: string;  // retry 池角色的鼓励台词
}

export const HERO_META: Record<string, HeroMeta> = { ... };

export function pickHeroByScore(score: number): HeroMeta { ... }
export function getHeroById(id: string | null | undefined): HeroMeta { ... }  // null 时 fallback
```

### 5.2 `VictoryScreen` 重做（核心）

**保留**：现有三档配色 / 分数滚动 / 数据三联 / 错题折叠 / 按钮逻辑 / `prefers-reduced-motion` 兼容。

**改造**：
- 把原本的巨型 emoji `🏆/🌟/💪` 换成 `<img src={hero.imageUrl}>`（**2K 原图，CSS 缩放到全屏背景层**）
- 角色按 `pickHeroByScore(score)` 在该档位池里**随机抽一个**（`Math.random()` 即可，不需要持久化）
- 在 emoji 原位置（标题上方）放一个**角色立绘半身像**，居中，入场动画：
  - 0-0.3s：从右下角斜飞入 + 旋转校正（spring）
  - 0.3-0.6s：白光闪一下（已有 `FlashOverlay` 复用）
  - 0.6s+：呼吸动画（y: [0, -16, 0]，3s 循环）
- 在角色身后叠 **SVG 招式特效层**（按档位不同）：
  - perfect：6 道剑光辐射 + 闪电环（已有 `LightningRing` 复用）
  - great：12 个旋转星星轨道
  - retry：暖色光晕脉冲（呼吸式放大缩小）
- retry 档：在副标题位置增加**鼓励文案**，来源 `hero.taglineEncourage`（如 "凤凰浴火重生，你也可以！"）

**伪代码骨架**：
```tsx
const hero = useMemo(() => pickHeroByScore(score), [score]);
// ...
<img
  src={hero.imageUrl}
  className="absolute inset-0 w-full h-full object-cover opacity-25"
  style={{ filter: 'blur(8px) saturate(1.2)' }}
/>
{/* 现有 SunRays / LightningRing / ConfettiBurst / FlashOverlay / FloatingParticles 保留 */}
<motion.img
  src={hero.imageUrl}
  initial={{ x: 300, y: 300, rotate: -20, scale: 0 }}
  animate={{ x: 0, y: 0, rotate: 0, scale: 1 }}
  transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
  style={{ width: 'clamp(180px, 32vh, 320px)', filter: theme.glow }}
/>
```

### 5.3 `CompletionScreen` 微改

把 `<img src="/hero-completion.jpeg">` 那个顶部 hero 横幅换成：
- 读取**学生自己的** `hero_id`（注册时分配那个），对应 PNG
- 若学生 100% 这次成绩→在角色上叠"满分光环"光圈

### 5.4 `ChallengeVictory` 微改

第三幕 `RewardReveal` 内部：把原本的奖励容器背景换成**学生自己的 hero 半身像作为背景**，奖励数字/经验/金币照旧叠在上面。

### 5.5 新组件：`HallOfFame.tsx`

挂在 `StudentDashboard_New` 顶部、欢迎语下方、统计卡片上方。

**视觉**：
- 横向 3 张「英雄卡片」并排（移动端纵向 stack）
- 每张卡：
  - 头部 banner：满分王 / 速度之王 / 进步之星 （三种渐变色对应三档主色：金 / 蓝 / 橙）
  - 中部：该学生的 hero 立绘（半身，从对应角色 PNG 裁切）
  - 底部：昵称 + metric_label
- 顶部标题：「🏆 {班级名} · 本月光荣榜」
- 缺位卡：灰色占位 + "本月空缺，加油成为第一人！" + 一个鼓励池角色的小图

### 5.6 `LiveLeaderboard` 微改

在排行榜底部加一块**鼓励横幅**，触发条件：
- `leaderboard.my_rank` 存在且 ≥ 10，或者 `my_rank / total_participants ≥ 0.7`
- 显示：随机一个 `RETRY_POOL` 角色 + 鼓励文案（来自 `hero.taglineEncourage`）
- 永不消失（学生只要在该区段就一直看到这个鼓励位）

---

## 6. image2 生成脚本

**位置**：`scripts/generate-heroes.py`（Python，因为后端栈就是 Python，复用环境最方便）

**做什么**：
1. 读 8 个角色的 prompt（写在脚本顶部常量里，便于调整）
2. 逐个调 `POST https://pikachu.claudecode.love/v1/images/generations`
3. 接口返回 `data[0].url`，脚本下载图片
4. 保存到 `frontend/public/heroes/{hero_id}.png`
5. 失败时打印明确错误，不删原有图，**幂等**：已存在就跳过（用 `--force` 覆盖）

**Prompt 模板**（统一前后缀，仅变体描述变）：
```
<前缀> Anime-style heroic illustration, vibrant flat colors with soft gradients,
similar to Genshin Impact main visual aesthetic. Front 2/3 view, upper body
portrait, centered composition, dynamic action pose.

<变体> {character_specific_description}

<后缀> Full background scene (not transparent), 2048x2048 square,
no text, no logo, no signature, no watermark, no resemblance to any
known anime character.
```

**API Key 来源**：从环境变量 `IMAGE2_API_KEY` 读，**不写进脚本**，**不入 git**。脚本顶部加 `KEY = os.environ['IMAGE2_API_KEY']`，缺失直接报错。

**手动一次性运行**：`IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py`，运行完把生成的 8 张 PNG `git add` 提交。后续运行时**零调用**。

---

## 7. 关键边界条件

- **学生没有班级**：`HallOfFame` 显示「你还没有加入班级哦」+ 引导联系老师；不报错。
- **班级里只有 1 个学生**：聚合接口照常返回，速度之王 / 满分王 = 该学生本人（如果有成绩）；UI 不做特殊处理。
- **图片加载失败**：所有用 `<img src="/heroes/xxx.png">` 的位置都加 `onError`，失败时回退到一个**通用 emoji**（按 tier：🏆/🌟/💪），保证页面不裂。
- **存量学生 hero_id 回填**：迁移脚本一次性写入，但接口实现要兼容 NULL（前端 `getHeroById(null)` 返回一个稳定 fallback 角色，比如 `hero_sunny`）。
- **随机种子**：`pickHeroByScore` 不需要稳定（学生每次通关期待"惊喜"），直接 `Math.random()`；但同一次 render 内必须稳定（用 `useMemo([score])`），避免重渲染抽到新角色看起来跳变。

---

## 8. 不做也不引入的事

- **不**做角色等级/培养系统
- **不**做角色商店/抽卡
- **不**让学生切换/解锁新角色（首期）
- **不**把光荣榜写到 PWA 推送 / 邮件 / 微信通知
- **不**碰教师端、管理员端任何 UI
- **不**改现有 `LiveLeaderboard` 上半部分（仅在底部加鼓励位）

---

## 9. 测试要点

- 后端：聚合接口对「单班 30 学生 × 30 天会话」mock 数据，跑通 perfect / speed / progress 三个聚合，验证空缺场景返回 null
- 前端：
  - 三档（100 / 85 / 60 分）`VictoryScreen` 各跑一遍，看角色入场动画
  - `prefers-reduced-motion` 启用时跑一遍，确认动画退化
  - 故意把 `/heroes/hero_blaze.png` 改成不存在路径，验证 fallback emoji
  - `HallOfFame` 在「无班级」「班级无成绩」「正常」三个状态分别截图

---

## 10. 交付清单

```
backend/
  app/models/user.py                          # User 类 + hero_id 字段
  app/core/database.py                        # init_db 追加幂等 ALTER + 回填
  app/api/v1/auth.py                          # 注册时分配 hero_id
  app/api/v1/student/hall_of_fame.py          # 新接口
  app/schemas/hall_of_fame.py                 # 响应 schema
  app/services/hall_of_fame_service.py        # 聚合逻辑

frontend/
  public/heroes/hero_blaze.png                # 8 张 2K PNG
  public/heroes/hero_thunder.png
  public/heroes/hero_galaxy.png
  public/heroes/hero_sunny.png
  public/heroes/hero_wave.png
  public/heroes/hero_breeze.png
  public/heroes/hero_phoenix.png
  public/heroes/hero_dawn.png
  src/utils/hero.ts                           # 角色池 + 工具函数
  src/components/HallOfFame.tsx               # 新组件
  src/api/hallOfFame.ts                       # 接口客户端
  src/components/classify/VictoryScreen.tsx   # 改造
  src/pages/CompletionScreen.tsx              # 微改
  src/components/challenge-fx/RewardReveal.tsx # 微改
  src/components/LiveLeaderboard.tsx          # 微改
  src/pages/StudentDashboard_New.tsx          # 挂载 HallOfFame

scripts/
  generate-heroes.py                          # image2 一次性生成
```
