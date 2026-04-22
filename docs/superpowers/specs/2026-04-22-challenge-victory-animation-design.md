# 错题闯关通关动画 —— "单词爆裂 · 宠物进化 · 神性降临" 三幕剧

## Context（背景）

当前 `MistakeChallenge.tsx` 通关结果页（第 450-560 行）用的是 SVG 分数环渐填 + 数字 spring 放大 + 满分时一个 👑 emoji。存在感弱，像结算页而非"过关"，没有任何音效、粒子、奖励入账的具象化，也没有利用项目已有的宠物系统。

目标用户是 6-15 岁中小学生。需要的不是"好看"，是**多巴胺刺激 + 记忆点 + 自传播闭环**。

## 设计原则

1. **记忆点而非特效密度**：一段短剧，而非粒子堆砌
2. **和已有系统联动**：奖励飞向已有的宠物头像、升级触发已有的 `dispatchPetEvent`
3. **概率性高潮**：普通 / 幸运 / 暴击 / 神迹四档，每次都让孩子期待"这次会不会中"
4. **自传播**：神迹档触发可分享的进化卡片，用 `html2canvas`（已装）生成
5. **视觉基调**：**国风赛博**（霓虹紫 `#8B5CF6` + 赛博青 `#06B6D4` + 金箔黄 `#FCD34D`）—— 和市面教育 App 拉开差异
6. **音效必须做**：没有音效整个方案塌一半

## 三幕结构

### 第一幕：单词被劈开（0 – 1.2s）

| 时刻 | 动效 |
|---|---|
| 0.00s | 触发 `camera shake` 150ms（translateX 抖 ±8px 三次） |
| 0.00s | 闯关单词从答题框浮起、放大 1.5×、镀金描边（`-webkit-text-stroke: 2px #FCD34D`） |
| 0.20s | 全屏红蓝 `chromatic aberration`（`filter: hue-rotate` + `drop-shadow` 两层错位） |
| 0.50s | 一道 45° 白色光剑从左上劈下（SVG `<line>` + `strokeDasharray` 绘制） |
| 0.60s | 单词被劈成左右两半（各自 `transform: translateX(±30px) rotate(±8deg)`） |
| 0.60s | 全屏闪白 80ms（`opacity` 从 0 → 1 → 0，`background: white`） |
| 0.60s | **音效**：`sword_slash.mp3`（"叮——！"铿锵） |
| 1.00s | 劈开的两半开始瓦解为粒子 |

### 第二幕：字母变星尘飞向宠物（1.2 – 2.5s）

| 时刻 | 动效 |
|---|---|
| 1.20s | 劈开的字母散为 ~100 颗粒子（每个字母约 20 颗） |
| 1.20s | 粒子形状随机：`★` / `福` / `⚔` / `●` 四种交替 |
| 1.30s | 每颗粒子沿**贝塞尔曲线**飞向右上角宠物头像（`motion.circle` + `path` 约束） |
| 1.30s | 粒子带金色拖尾（`filter: drop-shadow(0 0 4px #FCD34D)` + 短暂 `motion blur`） |
| 1.50-2.40s | 粒子陆续命中头像，每命中一次头像 `scale: 1 → 1.08 → 1` 弹跳 |
| 1.50-2.40s | **音效**：10 颗粒子触发 10 个"啵"（音高从 C4 半音级升到 A4，用 `Howler.rate` 实现） |

### 第三幕：神性降临（2.5 – 4.0s）

**概率分档**（后端统一生成随机数，避免前端可预测）：

| 概率 | 名称 | 表现 | 奖励 |
|---|---|---|---|
| 70% | 普通 | 顶部经验条滚动 + 金币老虎机翻牌 `+5 EXP +5 金币` | 5 EXP / 5 金币 |
| 20% | 幸运 | 背景小烟花 + 宠物头顶浮字 `+10 EXP`  | 10 EXP / 10 金币 |
| 8% | 暴击 | 全屏红金震动 + **"CRITICAL! ×2"** 霓虹大字从中心炸出 | 20 EXP / 10 金币 |
| 2% | 神迹 | 金柱冲天、宠物图片切进化形态、触发分享卡片 | 50 EXP + 进化 |

### 连击系统（横穿三幕）

连续通关不中断：

| 连击数 | 效果 |
|---|---|
| 2 | 右侧徽章 `×2 COMBO` |
| 3 | `🔥 TRIPLE`，宠物头像边缘冒火焰粒子 |
| 5 | `⚡ MEGA COMBO`，全屏呼吸红光 2s |
| 10 | 屏幕黑化 0.3s → 宠物大头特写横扫屏幕 + 霓虹字 `👑 LEGENDARY` + 号角音效 |

连击状态存 `sessionStorage`，过 10 分钟无操作或失败一关即重置。

### 彩蛋："完美主义者"成就

触发条件：关卡 100% 正确 **且** 全部首字母输入都对（无删除重打）→ 结果页最后追加一段"电影片尾风格"的致敬滚动：

```
              完 美 主 义 者
          
          出品：{username}
          挑战：错题闯关 第 N 关
          用时：{elapsed}s
          
          — 你比 99% 的同学更专注 —
```

从下往上滚动 4s，白底黑字（复古字幕风），配钢琴音效。

## 视觉规范

### 色板
```
neon-purple   #8B5CF6   主高亮
cyber-cyan    #06B6D4   副高亮 / 经验条
gold-leaf     #FCD34D   金边 / 暴击
crit-red      #DC2626   暴击震动
ink-black     #111827   背景黑化
white-flash   #FFFFFF   闪白
```

### 字体
- 通关横幅（LEGENDARY / CRITICAL）：引入 `ZCOOL KuaiLe` web font（Google Fonts CDN）
- 粒子符号：直接用 emoji + 汉字字符，避免图片资源

### 粒子
- 不用 PNG / sprite，全部用 `motion.div` + CSS text/emoji，兼容性好、体积为零

## 组件划分

新增目录 `frontend/src/components/challenge-fx/`：

```
challenge-fx/
├── ChallengeVictory.tsx      # 顶层编排组件，接 result prop，调度三幕
├── SwordSlash.tsx            # 第一幕：光剑 + 劈字
├── ParticleBurst.tsx         # 第二幕：粒子飞向宠物头像
├── RewardReveal.tsx          # 第三幕：概率分档动画
├── ComboBadge.tsx            # 连击徽章
├── LegendaryCutscene.tsx     # 10 连专属大特写
├── PerfectionistCredits.tsx  # "完美主义者" 彩蛋滚动
├── EvolutionCard.tsx         # 神迹档的进化分享卡
└── useChallengeSfx.ts        # 音效 hook，封装 Howler
```

每个组件单文件 < 200 行，单一职责，独立可预览。

## 数据流

```
MistakeChallenge.tsx (existing)
  ↓ result, combo, elapsed
ChallengeVictory.tsx (new, replaces current result panel)
  ↓ phase='slash'    →  SwordSlash
  ↓ phase='particles'→  ParticleBurst
  ↓ phase='reveal'   →  RewardReveal (with tier=normal|lucky|crit|miracle)
  ↓ combo>=2         →  ComboBadge
  ↓ combo>=10        →  LegendaryCutscene (overlay)
  ↓ perfect          →  PerfectionistCredits (after reveal)
```

阶段切换由顶层组件用 `setTimeout` 链（或 `framer-motion` 的 `onAnimationComplete`）串起来，不依赖外部状态库。

## 后端变更

`backend/app/api/v1/student/mistake_book.py` 的 `submit_challenge_level` 接口在返回 `ChallengeSubmitResult` 时新增字段：

```python
class ChallengeSubmitResult(BaseModel):
    passed: bool
    correct_count: int
    total_count: int
    wrong_words: list[ChallengeLevelWord]
    message: str
    # 新增：
    reward_tier: Literal['normal', 'lucky', 'crit', 'miracle']
    exp_gained: int
    coin_gained: int
    pet_evolved: Optional[str] = None   # 神迹档返回进化形态 key
```

`reward_tier` 由后端 `random.random()` 按 70/20/8/2 分档生成，前端无法作弊。
`pet_evolved` 仅在 `miracle` 且当前宠物可进化时非空。

## 音效清单（public/sfx/）

| 文件 | 用途 | 大小上限 |
|---|---|---|
| `sword_slash.mp3` | 第一幕劈字 | 30 KB |
| `particle_tick_{0..4}.mp3` | 粒子击中，5 个音调交替 | 5 × 8 KB |
| `coin_drop.mp3` | 金币翻牌 | 20 KB |
| `crit_boom.mp3` | 暴击 | 40 KB |
| `miracle_horn.mp3` | 神迹号角 | 60 KB |
| `legendary_horn.mp3` | 10 连 LEGENDARY | 50 KB |
| `piano_credits.mp3` | 完美主义者彩蛋钢琴 | 80 KB |

合计 < 320 KB，按需 lazy-load。

## Phase 交付

| Phase | 内容 | 预估工时 |
|---|---|---|
| 1 | 三幕基础 + 音效（70% 普通档） | 5h |
| 2 | 概率分档（幸运 / 暴击 / 神迹）+ 后端 `reward_tier` | 3h |
| 3 | 连击系统 + LEGENDARY 大特写 | 2.5h |
| 4 | 完美主义者彩蛋 + 进化分享卡（`html2canvas`） | 2h |

**总计约 12.5 小时**，分 4 个 commit 上线，每个 Phase 可独立部署。

## 验证步骤

每个 Phase 做完：
1. 本地起前后端，用 `student` 账号做一关错题闯关
2. 验证三幕时序（总时长 4s 左右，不能卡）
3. 检查浏览器 Console 无报错、无 audio autoplay 拦截警告
4. 手机尺寸（375×667）下粒子轨迹正常、不超框
5. Phase 2 之后：后端 mock 固定概率（开发模式下 `?force_tier=miracle`）手动触发每一档
6. Phase 3 之后：快速连做 10 关，检查 LEGENDARY 触发
7. Phase 4 之后：触发神迹 → 截图分享卡 → 能保存到本地

## 风险 & 已知限制

1. **autoplay 拦截**：iOS Safari 在首次用户手势前不能放声音。解决：把 `Howler.ctx.resume()` 绑到第一次点击 "开始闯关" 按钮。
2. **低端 Android 性能**：100 粒子可能卡。解决：`useChallengeSfx` 内探测 `navigator.hardwareConcurrency < 4` → 粒子数降到 30。
3. **被孩子家长投诉"太吵"**：每个音效分别有静音开关，存 `localStorage`。顶层右上角一个小喇叭图标。

## 不在本次范围

- 宝箱开奖、抽卡池、赛季通行证（后续功能）
- 排行榜、好友对战
- 服务器端音效推送 / 自定义主题包
