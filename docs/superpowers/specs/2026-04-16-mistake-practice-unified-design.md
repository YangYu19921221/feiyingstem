# 错题集统一练习模式设计

**日期**: 2026-04-16  
**状态**: 待实现

## 背景

当前错题集练习要求学生在"选择题 / 拼写 / 填空"三种模式中手动选择，产生选择焦虑，导致学生犹豫或跳过练习。

## 目标

消除模式选择步骤，学生点一个按钮直接开始混合练习，三种题型自动循环出现。

---

## 设计

### 一、入口改动（MistakeBook.tsx）

删除：
- 选择题 / 拼写 / 填空 三个模式按钮
- `selectedMode` state
- `handleStartPractice` 中的模式路由逻辑

新增：
- 单一按钮"🚀 开始练习（N个待攻克）"
- 点击调用 `/student/mistake-book/practice`，存入 `sessionStorage: mistake_practice_words`
- 跳转 `/student/mistake-practice`

闯关入口按钮保持不变。

---

### 二、新页面（MistakePractice.tsx）

**路由**: `/student/mistake-practice`

**题型循环规则**：

| 单词索引 % 3 | 题型 | 说明 |
|---|---|---|
| 0 | 选择题（quiz） | 4选1，认识单词 |
| 1 | 填空题（fillblank） | 句中选词，理解语境 |
| 2 | 拼写题（spelling） | 听音拼写，最难 |

**页面结构**：
- 顶部：返回按钮 + "错题练习" 标题 + "当前/总数" 计数
- 进度条：已完成百分比
- 题型标签：显示当前题型名称（选择题 / 填空 / 拼写），学生知道当前类型但无需选择
- 题目区：根据当前题型渲染对应组件逻辑
- 答题后自动进入下一题

**结果页**（全部完成后）：
- 正确率 / 答对数 / 总题数
- 答错单词列表（词 + 释义）
- "再练一次"按钮 / "返回错题集"按钮

---

### 三、数据流

```
MistakeBook
  点击"开始练习"
  → POST /student/mistake-book/practice（limit=20, only_unresolved=true）
  → sessionStorage.setItem('mistake_practice_words', words)
  → sessionStorage.setItem('is_mistake_practice', 'true')
  → navigate('/student/mistake-practice')

MistakePractice 挂载
  → 读取 sessionStorage mistake_practice_words（最多20词）
  → 调用 /ai/generate-quiz-from-words（一次性获取 quiz + fillblank 题目）
  → 按 index % 3 分配题型
  → 渲染第1题

答题循环
  → 答完一题，记录对错，index++
  → 渲染下一题（不同题型）
  → 全部完成 → 结果页
```

---

### 四、技术实现

**后端改动**: 无，复用现有接口：
- `POST /student/mistake-book/practice` — 获取练习单词
- `POST /ai/generate-quiz-from-words` — 生成 quiz/fillblank 题目

**前端改动**:
1. `MistakeBook.tsx` — 删除模式选择 UI，改为单一跳转按钮
2. `MistakePractice.tsx` — 新建，混合练习主页面
3. `App.tsx` — 新增路由 `/student/mistake-practice`

**组件复用策略**:
- 从现有 `QuizPractice.tsx`、`FillBlankPractice.tsx`、`SpellingPractice.tsx` 提取核心题目渲染逻辑，在 `MistakePractice.tsx` 中按题型条件渲染，不重写交互逻辑。

---

### 五、不在本次范围内

- 按掌握度自适应分配题型（未来可加）
- 练习结果写入学习记录（复用现有各练习页的提交逻辑）
- 闯关模式改动
