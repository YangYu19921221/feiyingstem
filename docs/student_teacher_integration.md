# 学生端与教师端数据打通设计方案

## 一、核心业务流程

### 1. 教师端 → 学生端的数据流

```
教师录入单词 → 创建单词本 → 分配给学生 → 学生学习 → 记录学习数据 → AI分析薄弱点 → 智能出题
```

### 2. 角色职责划分

#### 教师端职责
- ✅ **单词录入与管理** (核心职责)
  - 批量录入单词
  - 一词多义管理
  - 添加音标、例句、图片
  - 设置难度和年级

- ✅ **单词本创建与分配**
  - 创建主题单词本
  - 将单词添加到单词本
  - 分配单词本给学生/班级

- ✅ **学生学习监控**
  - 查看学生学习进度
  - 查看学生薄弱单词
  - 查看学习时长统计
  - 导出学习报告

- ❌ **AI出题** (移到学生端)
  - 教师端不需要出题功能
  - AI根据学生数据自动出题

#### 学生端职责
- ✅ **学习模块** (核心功能)
  - 卡片记忆 (flashcard)
  - 测试练习 (quiz) - AI自动出题
  - 拼写训练 (spelling) - AI自动出题
  - 填空题 (fill-blank) - AI自动出题

- ✅ **学习数据记录**
  - 每次学习自动记录
  - 正确率统计
  - 用时统计
  - 错误次数统计

- ✅ **个人学习中心**
  - 我的单词本 (教师分配的)
  - 学习进度
  - 成就系统
  - 连续打卡

## 二、数据模型设计

### 1. 现有模型(已实现)
```python
# 单词表
Word {
    id, word, phonetic, difficulty, grade_level,
    audio_url, image_url, created_by, created_at
}

# 单词释义(一词多义)
WordDefinition {
    id, word_id, part_of_speech, meaning,
    example_sentence, example_translation, is_primary
}

# 单词标签
WordTag {
    id, word_id, tag
}

# 单词本
WordBook {
    id, name, description, grade_level,
    created_by, is_public, cover_color
}

# 单词本-单词关联
BookWord {
    id, book_id, word_id, order_index
}

# 学习记录
LearningRecord {
    id, user_id, word_id, learning_mode,
    is_correct, time_spent, created_at
}
```

### 2. 需要新增的模型

```python
# 单词本分配表(关键!)
class BookAssignment(Base):
    """教师分配单词本给学生"""
    id = Column(Integer, primary_key=True)
    book_id = Column(Integer, ForeignKey("word_books.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    teacher_id = Column(Integer, ForeignKey("users.id"))
    assigned_at = Column(DateTime, server_default=func.now())
    deadline = Column(DateTime, nullable=True)  # 学习截止日期
    is_completed = Column(Boolean, default=False)

# 学生单词掌握度表
class WordMastery(Base):
    """记录学生对每个单词的掌握程度"""
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    word_id = Column(Integer, ForeignKey("words.id"))

    # 掌握度指标
    total_encounters = Column(Integer, default=0)  # 总遇到次数
    correct_count = Column(Integer, default=0)     # 正确次数
    wrong_count = Column(Integer, default=0)       # 错误次数
    mastery_level = Column(Integer, default=0)     # 0-5级掌握度

    # 各模式表现
    flashcard_correct = Column(Integer, default=0)
    flashcard_wrong = Column(Integer, default=0)
    quiz_correct = Column(Integer, default=0)
    quiz_wrong = Column(Integer, default=0)
    spelling_correct = Column(Integer, default=0)
    spelling_wrong = Column(Integer, default=0)
    fillblank_correct = Column(Integer, default=0)
    fillblank_wrong = Column(Integer, default=0)

    last_practiced_at = Column(DateTime)
    next_review_at = Column(DateTime)  # 间隔重复学习

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

# AI出题记录表
class AIQuizRecord(Base):
    """记录AI生成的题目"""
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    quiz_type = Column(String(20))  # quiz/spelling/fillblank
    word_ids = Column(Text)  # JSON格式: [1,2,3,4,5]
    difficulty_level = Column(Integer)
    based_on_weakness = Column(Boolean, default=True)
    generated_at = Column(DateTime, server_default=func.now())

# 班级管理(可选,后续扩展)
class Class(Base):
    """班级表"""
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    teacher_id = Column(Integer, ForeignKey("users.id"))
    grade = Column(String(20))
    created_at = Column(DateTime, server_default=func.now())

class ClassStudent(Base):
    """班级-学生关联"""
    id = Column(Integer, primary_key=True)
    class_id = Column(Integer, ForeignKey("classes.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    joined_at = Column(DateTime, server_default=func.now())
```

## 三、核心API接口设计

### 教师端API

```python
# 单词管理
POST   /api/v1/teacher/words              # 录入单词
POST   /api/v1/teacher/words/batch        # 批量录入
PUT    /api/v1/teacher/words/{id}         # 修改单词
DELETE /api/v1/teacher/words/{id}         # 删除单词
GET    /api/v1/teacher/words              # 查看所有单词

# 单词本管理
POST   /api/v1/teacher/wordbooks          # 创建单词本
POST   /api/v1/teacher/wordbooks/{id}/words  # 添加单词到单词本
GET    /api/v1/teacher/wordbooks          # 查看我创建的单词本

# 分配单词本
POST   /api/v1/teacher/assignments        # 分配单词本给学生
GET    /api/v1/teacher/assignments        # 查看分配记录

# 学生监控
GET    /api/v1/teacher/students           # 查看所有学生
GET    /api/v1/teacher/students/{id}/progress  # 学生学习进度
GET    /api/v1/teacher/students/{id}/weakness  # 学生薄弱单词
GET    /api/v1/teacher/students/{id}/report    # 学生学习报告
```

### 学生端API

```python
# 我的单词本(教师分配的)
GET    /api/v1/student/wordbooks          # 获取分配给我的单词本
GET    /api/v1/student/wordbooks/{id}/words  # 获取单词本中的单词

# 学习模块
GET    /api/v1/student/words/random       # 随机获取单词(卡片记忆)
POST   /api/v1/student/learn/flashcard    # 记录卡片学习

# AI出题(核心!)
POST   /api/v1/student/quiz/generate      # AI生成测试题
POST   /api/v1/student/spelling/generate  # AI生成拼写题
POST   /api/v1/student/fillblank/generate # AI生成填空题

# 提交答案
POST   /api/v1/student/quiz/submit        # 提交测试答案
POST   /api/v1/student/spelling/submit    # 提交拼写答案
POST   /api/v1/student/fillblank/submit   # 提交填空答案

# 学习数据
GET    /api/v1/student/progress           # 我的学习进度
GET    /api/v1/student/mastery            # 单词掌握度
GET    /api/v1/student/weakness           # 我的薄弱单词
GET    /api/v1/student/report             # 学习报告
```

## 四、AI出题算法设计

### 1. 薄弱点识别算法

```python
def identify_weak_words(user_id, limit=10):
    """
    识别学生的薄弱单词

    评分标准:
    1. 错误率高 (wrong_count / total_encounters > 0.5)
    2. 掌握度低 (mastery_level < 3)
    3. 最近练习过但仍然错误
    4. 某个特定模式(如拼写)错误率高
    """
    weak_words = db.query(WordMastery).filter(
        WordMastery.user_id == user_id,
        or_(
            WordMastery.mastery_level < 3,
            WordMastery.wrong_count > WordMastery.correct_count
        )
    ).order_by(
        WordMastery.mastery_level.asc(),
        WordMastery.last_practiced_at.desc()
    ).limit(limit).all()

    return weak_words
```

### 2. AI出题策略

#### 测试练习(Quiz)
```python
def generate_quiz(user_id, count=10):
    """
    生成选择题

    策略:
    - 70% 薄弱单词
    - 20% 正在学习的单词
    - 10% 随机复习单词
    """
    weak_words = identify_weak_words(user_id, int(count * 0.7))
    learning_words = get_recent_words(user_id, int(count * 0.2))
    review_words = get_random_words(user_id, int(count * 0.1))

    questions = []
    for word in weak_words + learning_words + review_words:
        # 生成4个选项(1个正确+3个干扰项)
        options = generate_options(word)
        questions.append({
            'word': word.word,
            'question': word.word,  # 给单词,选释义
            'options': options,
            'correct_answer': word.primary_meaning
        })

    return shuffle(questions)
```

#### 拼写训练(Spelling)
```python
def generate_spelling(user_id, count=10):
    """
    生成拼写题

    策略:
    - 80% 拼写错误率高的单词
    - 20% 新单词
    """
    spelling_weak = db.query(WordMastery).filter(
        WordMastery.user_id == user_id,
        WordMastery.spelling_wrong > WordMastery.spelling_correct
    ).limit(int(count * 0.8)).all()

    new_words = get_new_words(user_id, int(count * 0.2))

    questions = []
    for mastery in spelling_weak + new_words:
        word = mastery.word
        questions.append({
            'audio_url': word.audio_url,  # 播放发音
            'phonetic': word.phonetic,
            'hint': word.word[0] + '_' * (len(word.word) - 1),  # 首字母提示
            'correct_answer': word.word
        })

    return questions
```

#### 填空题(Fill-blank)
```python
def generate_fillblank(user_id, count=10):
    """
    生成例句填空题

    策略:
    - 70% 薄弱单词
    - 30% 需要复习的单词
    """
    weak_words = identify_weak_words(user_id, int(count * 0.7))
    review_words = get_review_words(user_id, int(count * 0.3))

    questions = []
    for mastery in weak_words + review_words:
        word = mastery.word
        definition = word.definitions[0]  # 取主要释义

        if definition.example_sentence:
            # 将单词替换为空格
            sentence = definition.example_sentence.replace(
                word.word, '______'
            )
            questions.append({
                'sentence': sentence,
                'translation': definition.example_translation,
                'correct_answer': word.word,
                'hint': word.phonetic
            })

    return questions
```

### 3. 掌握度计算算法

```python
def update_mastery_level(user_id, word_id, is_correct, mode):
    """
    更新单词掌握度

    掌握度等级:
    0 - 未学习
    1 - 初识(正确率 0-20%)
    2 - 认识(正确率 20-40%)
    3 - 熟悉(正确率 40-60%)
    4 - 掌握(正确率 60-80%)
    5 - 精通(正确率 80-100%)
    """
    mastery = db.query(WordMastery).filter_by(
        user_id=user_id,
        word_id=word_id
    ).first()

    if not mastery:
        mastery = WordMastery(user_id=user_id, word_id=word_id)

    # 更新统计
    mastery.total_encounters += 1
    if is_correct:
        mastery.correct_count += 1
        setattr(mastery, f'{mode}_correct', getattr(mastery, f'{mode}_correct') + 1)
    else:
        mastery.wrong_count += 1
        setattr(mastery, f'{mode}_wrong', getattr(mastery, f'{mode}_wrong') + 1)

    # 计算正确率
    accuracy = mastery.correct_count / mastery.total_encounters

    # 确定掌握度等级
    if accuracy >= 0.8:
        mastery.mastery_level = 5
    elif accuracy >= 0.6:
        mastery.mastery_level = 4
    elif accuracy >= 0.4:
        mastery.mastery_level = 3
    elif accuracy >= 0.2:
        mastery.mastery_level = 2
    else:
        mastery.mastery_level = 1

    # 更新时间
    mastery.last_practiced_at = datetime.now()

    # 间隔重复算法(Spaced Repetition)
    if is_correct:
        # 答对了,延长复习间隔
        days_to_add = [1, 3, 7, 14, 30][mastery.mastery_level]
    else:
        # 答错了,缩短复习间隔
        days_to_add = 1

    mastery.next_review_at = datetime.now() + timedelta(days=days_to_add)

    db.add(mastery)
    db.commit()

    return mastery
```

## 五、前端页面更新方案

### 学生端Dashboard更新

```typescript
// 快速操作更新
const quickActions = [
  {
    icon: '🃏',
    title: '卡片记忆',
    desc: '翻转学习',
    route: '/learn/flashcard'
  },
  {
    icon: '✅',
    title: 'AI测试',
    desc: '智能选择题',  // 强调AI
    route: '/learn/quiz',
    badge: 'AI'
  },
  {
    icon: '✏️',
    title: 'AI拼写',
    desc: '听写练习',
    route: '/learn/spelling',
    badge: 'AI'
  },
  {
    icon: '📝',
    title: 'AI填空',
    desc: '例句练习',
    route: '/learn/fillblank',
    badge: 'AI'
  },
];

// 显示薄弱单词提醒
<div className="bg-yellow-100 border-yellow-300 rounded-xl p-4">
  <h4>💡 薄弱单词提醒</h4>
  <p>您有 {weakWords.length} 个单词需要重点复习</p>
  <button>AI智能练习</button>
</div>
```

### 教师端Dashboard更新

```typescript
// 移除AI出题按钮,改为学生监控
const quickActions = [
  { icon: '➕', title: '录入单词', desc: '添加新单词' },
  { icon: '📖', title: '创建单词本', desc: '组织单词' },
  { icon: '📤', title: '分配单词本', desc: '分配给学生' },  // 新增
  { icon: '📊', title: '学生监控', desc: '查看学习数据' },
];

// 显示分配统计
<div className="stats">
  <div>待分配单词本: {pendingBooks}</div>
  <div>学生完成率: {completionRate}%</div>
</div>
```

## 六、实施步骤

### Phase 1: 数据模型(后端)
1. 创建 BookAssignment 模型
2. 创建 WordMastery 模型
3. 创建 AIQuizRecord 模型
4. 运行数据库迁移

### Phase 2: 教师端API(后端)
1. 单词录入API
2. 单词本管理API
3. 单词本分配API
4. 学生监控API

### Phase 3: 学生端API(后端)
1. 我的单词本API
2. AI出题API (3种模式)
3. 答案提交API
4. 学习数据API

### Phase 4: 前端更新
1. 更新教师端Dashboard
2. 更新学生端Dashboard
3. 创建AI出题页面组件
4. 创建学习数据可视化组件

## 七、数据流示例

### 示例1: 教师分配单词本给学生

```
1. 教师创建单词本 "小学三年级上册"
   POST /api/v1/teacher/wordbooks
   { name: "小学三年级上册", grade_level: "3" }

2. 教师添加单词到单词本
   POST /api/v1/teacher/wordbooks/1/words
   { word_ids: [1, 2, 3, 4, 5] }

3. 教师分配给学生
   POST /api/v1/teacher/assignments
   {
     book_id: 1,
     student_ids: [10, 11, 12],
     deadline: "2024-12-31"
   }

4. 学生登录后看到新单词本
   GET /api/v1/student/wordbooks
   返回: [{ id: 1, name: "小学三年级上册", word_count: 5, progress: 0 }]
```

### 示例2: 学生AI学习流程

```
1. 学生点击"AI测试"
   POST /api/v1/student/quiz/generate
   { book_id: 1, count: 10 }

   系统分析学生薄弱点,生成10道题
   返回: [
     {
       word: "apple",
       options: ["苹果", "香蕉", "橙子", "梨"],
       correct: 0
     },
     ...
   ]

2. 学生答题并提交
   POST /api/v1/student/quiz/submit
   {
     quiz_id: 123,
     answers: [0, 1, 0, 2, ...]
   }

3. 系统更新掌握度
   - 对每个单词调用 update_mastery_level()
   - 记录学习记录到 LearningRecord
   - 更新 WordMastery 表

4. 返回结果给学生
   {
     score: 80,
     weak_words: ["banana", "orange"],
     suggestion: "建议重点复习这些单词"
   }
```

## 八、总结

### 核心改变
1. ✅ **AI出题移到学生端** - 根据每个学生的薄弱点个性化出题
2. ✅ **教师端专注内容管理** - 录入单词、创建单词本、分配任务
3. ✅ **数据打通** - 通过 BookAssignment 和 WordMastery 连接师生
4. ✅ **智能算法** - AI分析学习数据,针对性训练

### 优势
- 教师减轻出题负担,专注内容质量
- 学生获得个性化学习体验
- 系统自动追踪学习效果
- 数据驱动的教学决策
