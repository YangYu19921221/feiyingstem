# 分类记忆法 单元复习（Unit Recap）设计稿

**日期**: 2026-05-28
**作者**: 与 Claude Opus 4.7 共同 brainstorming
**状态**: design accepted, ready for implementation plan
**触发场景**: 学生在分类记忆法（classify mode）走完一个单元的所有组之后，需要一个仪式化、可互动、可针对性补练的"单元收官"环节。

---

## 1. 目标 + 非目标

### 目标

- 让学生在通关单元后，**重新看一遍**这单元所有词，加深记忆
- 形式要"好玩"：**卡片闪现 → 散落入池 → 自评分类 → 针对性听写**，把"复习"做成 mini game
- 闭环：自评出"再练"的词后，可一键进听写，比机械刷一遍更高效
- 复用现有视觉语言（暖橙系 / `card-soft` / `font-display`），跟主页 hero、VictoryScreen 同语系

### 非目标

- 不替代或修改现有的 5 个 phase（classify / speechVerify / dictation / exam / summary）
- 不引入 PK / 多人对战（与 PK arena 区分）
- 不做"双卡碰撞连读" / "自动巡演"等过度复杂玩法
- 不动后端 API，不动数据库 schema
- 本特性本次**不补**前端测试基础设施（vitest + RTL）

---

## 2. 触发与流程总览

### 触发时机

`WordClassifyLearning` 当前 phase 流转：
```
classify → speechVerify → dictation → exam → summary
```

新增 phase `unitRecap`，**仅在最后一组通关后插入**：
```
（最后一组的）exam → unitRecap → summary
```

非最后一组（中间的组）通关：流转不变，仍然 `exam → summary`。

### 内部三幕

```
幕 1  闪现 (FlashStage)
   ├── 暗色舞台,单卡居中
   ├── 卡片逐张淡入 (0.4s) → 静态显示 1.5s + 自动播音 → 淡出 (0.4s)
   ├── 单卡总耗时 ~2.5s, 30 词约 75 秒
   └── 全部播完 → 0.5s 黑屏过渡 + 字幕 "现在挑你想再看的"
              ↓
幕 2  卡片池 (CardPool)
   ├── 暖色矩形池子 (16:10 桌面 / 9:14 移动)
   ├── 卡片"自然散落": 4 列网格 × N 行, 每张 ±15% jitter, ±12° 旋转
   ├── 单击翻面 (英文 ↔ 中文释义+例句)
   ├── 长按 0.4s 读发音 (节流 800ms)
   ├── 拖动重排, dragConstraints 锁矩形内
   ├── 右下角两个篮子: 我会了 (金) / 再练 (橙)
   ├── 右上角 "🎲 摇一摇" 重洗位置
   ├── 顶部进度条: 已分类 N / 总数
   └── 所有卡都进篮子,或学生点 "完成" → 进幕 3
              ↓
幕 3  收官 (RecapSummary)
   ├── 显示 "我会了 X 个 · 再练 Y 个"
   ├── Y > 0: 列出 Y 个再练词 + 主按钮 「立刻听写这 Y 个 →」
   ├── Y = 0 (满分): 金光特效 + "单元收官 · 完美" 称号
   └── 副按钮 "跳过去结算"  → 走原 summary
```

### 流转分支

```
unitRecap.summary
  ├── 点 "立刻听写" → DictationPhase(practice 词子集)
  │                    完成后 → summary (不进 exam)
  └── 点 "跳过去结算" 或 满分 → summary
```

---

## 3. 组件结构

5 个新组件，全部在 `frontend/src/components/classify/recap/`：

| 组件 | 行数估计 | 职责 |
|---|---|---|
| `UnitRecapPhase.tsx` | ~120 | 三幕状态机；接收单元词数组；产出 `mastered` / `practice` 两个词列表 |
| `FlashStage.tsx` | ~80 | 幕 1 闪现，自管定时器，播完 onDone() |
| `CardPool.tsx` | ~150 | 幕 2 矩形容器；散落算法；卡片状态管理；篮子；摇一摇；onAllSorted({mastered, practice}) |
| `RecapCard.tsx` | ~100 | 单张卡：翻面、拖动、长按发音、视觉切换 |
| `RecapSummary.tsx` | ~80 | 幕 3 收官，触发 onRetryDictation / onSkipToSummary |

**散落算法**单独抽 `scatter.ts` 纯函数（~30 行），便于单元测试。

`WordClassifyLearning.tsx` 改 1 处：
- `Phase` 类型加 `unitRecap`
- 新增 state `recapRetryWords: WordData[] | null` 和 `dictationSource: 'normal' | 'recap'`
- isLastGroup 时 `setPhase('exam')` → 完成后 `setPhase('unitRecap')`
- DictationPhase onComplete 路径根据 `dictationSource` 决定下一站

---

## 4. 数据模型

### 输入

`UnitRecapPhase` props：
```ts
{
  words: WordData[]           // 单元所有词，已加载
  unitName: string            // 用于收官标题
  onComplete: (result: {
    masteredWordIds: number[]
    practiceWords: WordData[]
  }) => void
}
```

### 卡片池内部状态（CardPool 私有）

```ts
type Verdict = 'unknown' | 'mastered' | 'practice'

interface PoolCard {
  wordId: number
  word: string
  meaning: string
  phonetic: string | null
  example_sentence: string | null
  example_translation: string | null
  // 池内态
  x: number         // 矩形坐标 0-100 百分比
  y: number         // 同上
  rotation: number  // -12 ~ 12 度
  flipped: boolean
  verdict: Verdict
}
```

### 状态变化映射

| 用户动作 | 影响 |
|---|---|
| 单击卡片 | toggle `flipped` |
| 长按 0.4s | 调 `playAudio(word)`，节流 800ms |
| 拖动结束（落空白处） | 更新 `x`, `y` |
| 拖动结束（落 mastered 篮子） | `verdict = 'mastered'`，卡淡出 |
| 拖动结束（落 practice 篮子） | `verdict = 'practice'`，卡淡出 |
| 摇一摇按钮 | 重生成所有卡的 `x/y/rotation`，spring 弹回 |
| "撤销最后一张"按钮 | 5 秒内可点，把最后入篮的卡 `verdict='unknown'` |
| 所有卡 verdict !== unknown 或 学生点完成 | 触发 onComplete |

---

## 5. 散落算法

矩形池子 80% width × 60% height。卡片固定 `120×160px`（桌面）或 `90×120px`（移动 / N>32）。

```
1. 列数 cols = (移动端 || N > 32) ? 5 : 4    // 移动竖屏改 3 列
2. 行数 rows = ceil(N / cols)
3. 第 i 张卡:
   col = i % cols
   row = i / cols
   anchorX = (col + 0.5) / cols * 100   // 百分比
   anchorY = (row + 0.5) / rows * 100
4. 加抖动:
   x = anchorX + uniform(-15, 15)
   y = anchorY + uniform(-15, 15)
   rotation = uniform(-12, 12)
5. z-index 按生成顺序递增
```

**摇一摇**：保留 anchor，重新生成 jitter 和 rotation（结构不变，散落感更新）。

---

## 6. 视觉规范

### 幕 1 闪现舞台

- 底色 `bg-ink/95`（深色聚焦）
- 卡片 `scale 0.6 → 1` + `opacity 0 → 1`，0.4s spring 入场
- 静态 1.5s，入场后 0.2s 触发 TTS
- `scale 1 → 1.1` + `opacity 1 → 0`，0.4s ease 出场
- 底部进度 `5 / 30`
- 第 30 张后出现"快速跳到池子"小按钮（避免长单元失耐心）

### 幕 2 卡片池

| 元素 | 样式 |
|---|---|
| 矩形容器 | `bg-gradient-to-br from-amber-50 to-orange-50` + `border-2 border-amber-200` + `rounded-2xl` |
| 卡片正面 | `bg-paper border border-amber-200 shadow-md`；上 1/3 英文 `font-display text-2xl font-bold`；中 1/3 音标 `text-ink-soft text-sm`；右下角小喇叭 emoji（提示长按读音） |
| 卡片背面 | `bg-amber-50` 渐变；中文释义 `text-2xl`；例句小字；🔊 按钮 |
| 翻面动画 | `rotateY 0 → 180°`，0.5s spring，`backface-visibility: hidden` |
| 拖动 | `whileDrag={{ scale: 1.1, zIndex: 999 }}` |
| "我会了"篮子 | 右下，`#f59e0b` + 🏆，hover 金光 |
| "再练"篮子 | 右下偏左，`#fb7185` + 💪 |
| 入篮动画 | 卡 `scale 1 → 0.8` + `opacity 1 → 0`，篮子数字 +1 抖一下 |
| 摇一摇按钮 | 右上 `🎲 摇一摇`，stagger 30ms 弹回 |

### 幕 3 收官

- 全屏 modal-like，跟 VictoryScreen 同语系（暖橙渐变）
- 满分（Y=0）：金光从中心散射 + "单元收官 · 完美" 大字
- 部分（Y>0）：再练词以小卡列表展示；主按钮 "立刻听写这 Y 个 →"；副按钮 "跳过去结算"

### CSS 防抖（移动端）

```css
.recap-card {
  -webkit-touch-callout: none;
  user-select: none;
}
```

避免 iOS 长按弹原生菜单。

### 响应式

| 断点 | 矩形比例 | 列数 | 卡片大小 |
|---|---|---|---|
| ≥ md (≥768px) | 16:10 | 4 | 120×160 |
| < md 竖屏 | 9:14 | 3 | 90×120 |
| 任何屏 N>32 | 同上 | +1 列 | -25% size |

---

## 7. 边界 + 错误处理

### 单元词数边界

| N | 行为 |
|---|---|
| 0 | 不可能进入此 phase |
| 1, 2 | 跳过整个 unitRecap 直接进 summary（极小单元复习无意义） |
| 3-4 | 正常走，池子 2 列 |
| 5-32 | 主要场景 |
| 33+ | 5 列 + 缩卡，闪现阶段 30 张后显示快速跳过按钮 |
| 60+ | 同上，闪现总耗时 > 2.5 分钟，依赖快速跳过按钮 |

### 音频失败

- `playAudio` 失败时静默（沿用仓库其它 phase 行为）
- 长按 1s 仍无声 → 卡片角小喇叭闪红 0.5s（视觉提示）
- 节流：同卡 800ms 内重复长按忽略

### localStorage 恢复

`progressKey` 写入 `unitRecapState`，含 phase 子状态 + cards 数组：

| 离开时 | 恢复行为 |
|---|---|
| 幕 1 闪现中 | 跳过闪现直进幕 2（闪现是单向流，重看冗余） |
| 幕 2 池子 | 完整恢复 cards 数组（位置 + verdict + flipped） |
| 幕 3 收官 | mastered+practice 总数 = N 时显示收官；否则回退到幕 2 |
| 7 天后或学生点"重新学习" | 清 progressKey，下次全新一遍 |

### 拖动陷阱

- `dragConstraints={containerRef}` 物理锁矩形内，无需 snap-back
- 篮子误拖：5 秒"撤销最后一张"小按钮兜底
- iOS 长按系统菜单：上述 CSS 抑制

### DictationPhase 复用陷阱

DictationPhase 不动，**用 `dictationSource` flag 指示来源**：
- `dictationSource = 'normal'`（默认）：完成后 setPhase('exam')
- `dictationSource = 'recap'`：完成后 setPhase('summary')，不再回 exam

---

## 8. 测试策略

### 不测的（信任）

- Framer Motion 动画
- 仓库现有 TTS hook
- 浏览器 localStorage API

### 要测的

仓库现无 vitest + RTL 基础设施。**本次只对纯函数加单测**，UI 用手动 checklist。

| 项 | 方式 |
|---|---|
| `scatter.ts` 散落算法（坐标无重叠，N=1/2/30/60 边界） | 单测（如有 vitest） |
| 三幕状态机推进 | 单测 |
| `dictationSource = 'recap'` 完成后回 summary 而非 exam | 单测 |
| 篮子分类后 verdict 状态正确 | 单测 |

### 手动测试 checklist（发布前必过）

1. [ ] N=1, 2, 5, 15, 30, 50 各跑一遍流程
2. [ ] N=1/2 时跳过整个 unitRecap
3. [ ] 闪现中刷新页面 → 跳过闪现直进池子
4. [ ] 池子分类 5 mastered + 5 practice + 余点完成 → 进收官
5. [ ] 收官点"立刻听写"→ DictationPhase → 完成后回 summary（不进 exam）
6. [ ] 收官满分 → 金光特效正常
7. [ ] 移动端 Safari + Chrome：长按读音、拖动、无原生菜单
8. [ ] 摇一摇连点 5 次：spring 动画不打架
9. [ ] 篮子误拖 → 5 秒撤销可用
10. [ ] 拖动卡片不出矩形

---

## 9. 实施顺序建议（给 writing-plans 用）

按风险递减：

1. **scatter.ts** 纯函数 + 单测（无 UI 依赖，最先做）
2. **RecapCard.tsx** 单卡片（可独立预览）
3. **CardPool.tsx** 池子容器，集成 RecapCard + scatter
4. **FlashStage.tsx** 闪现（独立幕）
5. **RecapSummary.tsx** 收官
6. **UnitRecapPhase.tsx** 三幕串联
7. **WordClassifyLearning.tsx** 接入 + dictationSource flag
8. localStorage 恢复逻辑
9. 手动测 checklist 全过
10. build + rsync 上线

---

## 10. 风险 + 回滚

### 主要风险

- **散落算法 N>32 时仍可能轻微重叠** → 视觉可接受范围内（卡片有 z-index 区分）；测试中观察
- **iOS Safari 拖动手势冲突** → 已用 Framer Motion + CSS 抑制，但仍可能踩到边缘情况，手动测必查
- **DictationPhase 修改 dictationSource flag 影响现有非 recap 流程** → 默认 normal，行为不变；测试中需验证
- **localStorage 恢复路径多** → 4 种恢复分支都要跑一遍

### 回滚

`Phase` 类型移除 `unitRecap` + isLastGroup 直进 summary（一行 if 还原）+ 删 `recap/` 目录 + 删 dictationSource flag。前端纯 UI 改动，无 DB / 后端改动。

---

## 11. 已替用户做的设计决策清单

按 brainstorming 阶段用户授权"按你建议"做的拍板，列出供 review：

- ① 单击卡片改读发音 → **改为长按 0.4s** 读发音（点击空出给翻面）
- ② 拖动重排：保留
- ③ 翻面看中文：保留，背面也有 🔊 按钮
- ④ "我会了 / 再练" 篮子：保留（关键 — 给"复习"产出）
- ⑤ 双卡碰撞连读：去掉（实现复杂，与场景关联弱）
- ⑥ 摇一摇：保留（必须给 reset 出口）
- ⑦ 自动巡演：去掉（与开头闪现重复）
- 视觉风格：暖橙系，复用 `card-soft / accent-warm`
- 闪现节奏：2.5s/卡，1 次发音（用户在问题 2 选的"平稳"）
- 卡片入场：自然散落（用户在问题 3 选的 B）
- 触发时机：整单元所有组通关后（用户在问题 1 选的 B）

如果上述任一项 review 时不满意，调整 spec 再实施。

---

**END**
