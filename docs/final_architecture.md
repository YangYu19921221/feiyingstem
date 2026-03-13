# 英语学习助手 - 最终完整架构

## 🎯 整体设计概览

本系统采用**三层数据结构** + **进度追踪** + **AI个性化**的完整方案:

```
单词本 (WordBook)
  └─ 单元 (Unit)  ← 新增!教师按单元组织
      └─ 单词 (Word)
          └─ 定义/例句/标签

学生学习
  ├─ 分配记录 (BookAssignment) - 教师分配单词本
  ├─ 学习进度 (LearningProgress) - 断点续学 ← 新增!
  ├─ 学习会话 (StudySession) - 每次学习记录 ← 新增!
  ├─ 单词掌握度 (WordMastery) - AI分析基础
  └─ 学习记录 (LearningRecord) - 详细记录
```

---

## 📊 完整数据模型关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         数据模型总览                                  │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Teacher    │ (教师)
└──────┬───────┘
       │ creates
       ↓
┌──────────────┐      ┌──────────────┐
│   WordBook   │◄─────│BookAssignment│ (分配给学生)
│   (单词本)    │      └──────┬───────┘
└──────┬───────┘             │
       │ has many            │ assigned to
       ↓                     ↓
┌──────────────┐      ┌──────────────┐
│     Unit     │      │   Student    │ (学生)
│   (单元)      │      └──────┬───────┘
└──────┬───────┘             │ learns
       │ contains            │
       ↓                     ↓
┌──────────────┐      ┌─────────────────────┐
│   UnitWord   │─────►│ LearningProgress    │ (进度记录)
│  (单元单词)   │      │ - current_word_index │ ← 断点续学!
└──────┬───────┘      │ - completed_words    │
       │              │ - is_completed       │
       │ links to     └─────────────────────┘
       ↓                     │
┌──────────────┐             │ tracks
│     Word     │◄────────────┘
│   (单词)      │             │
└──────┬───────┘             │
       │ has                 │
       ↓                     ↓
┌──────────────┐      ┌─────────────────────┐
│WordDefinition│      │   StudySession      │ (学习会话)
│  (释义)       │      │ - words_studied     │
└──────────────┘      │ - correct_count     │
                      │ - time_spent        │
                      └─────────────────────┘
                             │
                             │ generates
                             ↓
                      ┌─────────────────────┐
                      │   WordMastery       │ (单词掌握度)
                      │ - mastery_level     │ ← AI分析!
                      │ - flashcard_stats   │
                      │ - quiz_stats        │
                      │ - spelling_stats    │
                      │ - fillblank_stats   │
                      └─────────────────────┘
                             │
                             │ AI analyzes
                             ↓
                      ┌─────────────────────┐
                      │   AIQuizRecord      │ (AI出题)
                      │ - based_on_weakness │
                      │ - word_ids          │
                      └─────────────────────┘
```

---

## 🗄️ 数据表详细说明

### 核心内容表

#### 1. Word (单词表)
```sql
words
├─ id
├─ word                    # 单词
├─ phonetic                # 音标
├─ difficulty              # 难度 1-5
├─ grade_level             # 年级
├─ audio_url               # 音频URL (阿里云TTS)
├─ image_url               # 图片URL
├─ created_by              # 教师ID
├─ created_at
└─ updated_at
```

#### 2. WordDefinition (单词释义 - 一词多义)
```sql
word_definitions
├─ id
├─ word_id                 # 关联单词
├─ part_of_speech          # 词性 (n./v./adj.)
├─ meaning                 # 中文释义
├─ example_sentence        # 例句
├─ example_translation     # 例句翻译
└─ is_primary              # 是否主要释义
```

#### 3. WordBook (单词本)
```sql
word_books
├─ id
├─ name                    # 单词本名称
├─ description             # 描述
├─ grade_level             # 年级
├─ created_by              # 教师ID
├─ is_public               # 是否公开
├─ cover_color             # 封面颜色
└─ created_at
```

#### 4. Unit (单元 - 新增!)
```sql
units
├─ id
├─ book_id                 # 所属单词本
├─ unit_number             # 单元序号 1,2,3...
├─ name                    # 单元名称 "Unit 1: Animals"
├─ description             # 单元描述
├─ order_index             # 排序
├─ word_count              # 单词数量
├─ created_at
└─ updated_at

UNIQUE(book_id, unit_number)  # 同一单词本内单元序号不重复
```

#### 5. UnitWord (单元-单词关联 - 新增!)
```sql
unit_words
├─ id
├─ unit_id                 # 单元ID
├─ word_id                 # 单词ID
└─ order_index             # 单词在单元内的顺序

UNIQUE(unit_id, word_id)   # 同一单元内单词不重复
```

### 学习管理表

#### 6. BookAssignment (单词本分配)
```sql
book_assignments
├─ id
├─ book_id                 # 单词本ID
├─ student_id              # 学生ID
├─ teacher_id              # 教师ID
├─ assigned_at             # 分配时间
├─ deadline                # 截止日期
└─ is_completed            # 是否完成
```

#### 7. LearningProgress (学习进度 - 新增!核心)
```sql
learning_progress
├─ id
├─ user_id                 # 学生ID
├─ book_id                 # 单词本ID
├─ unit_id                 # 单元ID
├─ learning_mode           # 学习模式 flashcard/quiz/spelling/fillblank
├─ current_word_id         # 当前学到的单词ID
├─ current_word_index      # 当前单词索引 (断点续学关键!)
├─ completed_words         # 已完成单词数
├─ total_words             # 总单词数
├─ is_completed            # 是否完成该单元
├─ last_studied_at         # 最后学习时间
├─ started_at              # 开始时间
└─ completed_at            # 完成时间

UNIQUE(user_id, unit_id, learning_mode)  # 每个学生每个单元每个模式一条记录
```

#### 8. StudySession (学习会话 - 新增!)
```sql
study_sessions
├─ id
├─ user_id                 # 学生ID
├─ book_id                 # 单词本ID
├─ unit_id                 # 单元ID
├─ learning_mode           # 学习模式
├─ words_studied           # 本次学习单词数
├─ correct_count           # 正确次数
├─ wrong_count             # 错误次数
├─ time_spent              # 用时(秒)
├─ started_at              # 开始时间
└─ ended_at                # 结束时间
```

#### 9. WordMastery (单词掌握度 - AI核心)
```sql
word_mastery
├─ id
├─ user_id                 # 学生ID
├─ word_id                 # 单词ID
├─ total_encounters        # 总遇到次数
├─ correct_count           # 正确次数
├─ wrong_count             # 错误次数
├─ mastery_level           # 掌握度 0-5级
│
├─ flashcard_correct       # 卡片记忆正确次数
├─ flashcard_wrong         # 卡片记忆错误次数
├─ quiz_correct            # 测试正确次数
├─ quiz_wrong              # 测试错误次数
├─ spelling_correct        # 拼写正确次数
├─ spelling_wrong          # 拼写错误次数
├─ fillblank_correct       # 填空正确次数
├─ fillblank_wrong         # 填空错误次数
│
├─ last_practiced_at       # 最后练习时间
├─ next_review_at          # 下次复习时间 (间隔重复)
├─ created_at
└─ updated_at
```

#### 10. LearningRecord (学习记录 - 详细日志)
```sql
learning_records
├─ id
├─ user_id                 # 学生ID
├─ word_id                 # 单词ID
├─ learning_mode           # 学习模式
├─ is_correct              # 是否正确
├─ time_spent              # 用时
└─ created_at
```

#### 11. AIQuizRecord (AI出题记录)
```sql
ai_quiz_records
├─ id
├─ user_id                 # 学生ID
├─ quiz_type               # 题目类型
├─ word_ids                # 单词ID列表 (JSON)
├─ difficulty_level        # 难度级别
├─ based_on_weakness       # 是否基于薄弱点
├─ score                   # 得分
├─ generated_at            # 生成时间
└─ completed_at            # 完成时间
```

---

## 🔄 核心业务流程

### 流程1: 教师创建并分配单词本(按单元)

```python
# Step 1: 创建单词本
book = WordBook(name="小学三年级上册", grade_level="3", created_by=teacher_id)
db.add(book)
db.commit()

# Step 2: 创建单元
unit1 = Unit(book_id=book.id, unit_number=1, name="Unit 1: Hello!")
unit2 = Unit(book_id=book.id, unit_number=2, name="Unit 2: Colors")
db.add_all([unit1, unit2])
db.commit()

# Step 3: 录入单词到单元
# 教师选择 Unit 1,录入单词 hello, hi, goodbye
words = [
    UnitWord(unit_id=unit1.id, word_id=word_hello.id, order_index=1),
    UnitWord(unit_id=unit1.id, word_id=word_hi.id, order_index=2),
    UnitWord(unit_id=unit1.id, word_id=word_goodbye.id, order_index=3),
]
db.add_all(words)
unit1.word_count = 3
db.commit()

# Step 4: 分配给学生
assignment = BookAssignment(
    book_id=book.id,
    student_id=student_id,
    teacher_id=teacher_id,
    deadline="2024-12-31"
)
db.add(assignment)
db.commit()
```

### 流程2: 学生学习(卡片记忆 - 断点续学)

```python
# Step 1: 学生点击"卡片记忆"
def start_or_resume_learning(user_id, unit_id, mode='flashcard'):
    # 查找进度
    progress = db.query(LearningProgress).filter(
        LearningProgress.user_id == user_id,
        LearningProgress.unit_id == unit_id,
        LearningProgress.learning_mode == mode
    ).first()

    if not progress:
        # 第一次学习,创建进度
        total = db.query(UnitWord).filter_by(unit_id=unit_id).count()
        progress = LearningProgress(
            user_id=user_id,
            unit_id=unit_id,
            learning_mode=mode,
            total_words=total,
            current_word_index=0
        )
        db.add(progress)
        db.commit()
        message = "开始新的学习"
    else:
        if progress.is_completed:
            return {"status": "completed", "message": "本单元已完成"}
        message = f"从第 {progress.current_word_index + 1} 个单词继续"

    # 获取单词列表(从当前位置开始)
    words = db.query(UnitWord, Word).join(Word).filter(
        UnitWord.unit_id == unit_id
    ).order_by(UnitWord.order_index).offset(progress.current_word_index).all()

    # 创建学习会话
    session = StudySession(
        user_id=user_id,
        unit_id=unit_id,
        learning_mode=mode
    )
    db.add(session)
    db.commit()

    return {
        "session_id": session.id,
        "message": message,
        "progress": {
            "current": progress.completed_words,
            "total": progress.total_words,
            "percentage": progress.completed_words / progress.total_words * 100
        },
        "words": [word for _, word in words]
    }

# Step 2: 学生学完一个单词
def complete_word(user_id, unit_id, word_id, is_correct, mode='flashcard'):
    # 更新进度
    progress = db.query(LearningProgress).filter(
        LearningProgress.user_id == user_id,
        LearningProgress.unit_id == unit_id,
        LearningProgress.learning_mode == mode
    ).first()

    progress.current_word_index += 1
    progress.completed_words += 1
    progress.last_studied_at = datetime.now()

    # 检查是否完成
    if progress.completed_words >= progress.total_words:
        progress.is_completed = True
        progress.completed_at = datetime.now()

    # 记录学习
    record = LearningRecord(
        user_id=user_id,
        word_id=word_id,
        learning_mode=mode,
        is_correct=is_correct
    )
    db.add(record)

    # 更新掌握度
    update_word_mastery(user_id, word_id, is_correct, mode)

    db.commit()

    return {
        "is_unit_completed": progress.is_completed,
        "progress": {
            "current": progress.completed_words,
            "total": progress.total_words
        }
    }

# Step 3: 学生退出后,下次打开
# 调用 start_or_resume_learning(),会自动从 current_word_index 继续!
```

### 流程3: AI智能出题(基于薄弱点)

```python
def generate_ai_quiz(user_id, unit_id, mode='quiz', count=10):
    # 获取该单元的所有单词
    unit_words = db.query(UnitWord).filter_by(unit_id=unit_id).all()
    word_ids = [uw.word_id for uw in unit_words]

    # 获取学生对这些单词的掌握度
    masteries = db.query(WordMastery).filter(
        WordMastery.user_id == user_id,
        WordMastery.word_id.in_(word_ids)
    ).all()

    # AI分析薄弱点
    weak_words = [
        m for m in masteries
        if m.mastery_level < 3 or m.wrong_count > m.correct_count
    ]
    weak_words.sort(key=lambda m: (m.mastery_level, -m.wrong_count))

    # 出题策略: 70%薄弱 + 30%复习
    weak_count = int(count * 0.7)
    review_count = count - weak_count

    selected_weak = weak_words[:weak_count]
    selected_review = random.sample(
        [m for m in masteries if m not in selected_weak],
        min(review_count, len(masteries) - len(selected_weak))
    )

    selected_words = selected_weak + selected_review
    random.shuffle(selected_words)

    # 生成题目
    questions = generate_questions(selected_words, mode)

    # 记录AI出题
    quiz = AIQuizRecord(
        user_id=user_id,
        quiz_type=mode,
        word_ids=json.dumps([m.word_id for m in selected_words]),
        based_on_weakness=True
    )
    db.add(quiz)
    db.commit()

    return questions
```

---

## 🎨 前端页面流程

### 学生端: 单词本 → 单元列表 → 学习

```tsx
// 1. 单词本详情页 - 显示所有单元和进度
<BookDetailPage>
  {units.map(unit => (
    <UnitCard key={unit.id}>
      <h3>{unit.name}</h3>
      <p>{unit.word_count} 个单词</p>

      {/* 各模式进度 */}
      <div className="modes">
        {/* 卡片记忆 */}
        <ModeProgress
          icon="🃏"
          name="卡片记忆"
          percentage={unit.flashcard_progress}
          completed={unit.flashcard_completed}
          total={unit.word_count}
          onStart={() => startLearning(unit.id, 'flashcard')}
          buttonText={unit.flashcard_progress > 0 ? '继续学习' : '开始学习'}
        />

        {/* AI测试 */}
        <ModeProgress
          icon="✅"
          name="AI测试"
          badge="AI"
          percentage={unit.quiz_progress}
          onStart={() => startLearning(unit.id, 'quiz')}
          buttonText="AI出题"
        />

        {/* 其他模式... */}
      </div>
    </UnitCard>
  ))}
</BookDetailPage>

// 2. 学习页面 - 自动断点续学
<FlashcardPage unitId={unitId}>
  useEffect(() => {
    // 启动或恢复学习
    startOrResumeLearning(unitId, 'flashcard').then(data => {
      if (data.status === 'resume') {
        toast.info(data.message); // "从第5个单词继续"
      }
      setWords(data.words);
      setProgress(data.progress);
    });
  }, []);

  // 进度条
  <ProgressBar
    current={progress.current}
    total={progress.total}
    percentage={progress.percentage}
  />

  // 单词卡片
  <FlashCard
    word={words[currentIndex]}
    onNext={(isCorrect) => {
      completeWord(unitId, word.id, isCorrect).then(result => {
        if (result.is_unit_completed) {
          toast.success('🎉 本单元已完成!');
          navigate('/unit-completed');
        } else {
          setCurrentIndex(currentIndex + 1);
        }
      });
    }}
  />
</FlashcardPage>
```

### 教师端: 创建单词本 → 创建单元 → 录入单词

```tsx
<TeacherWordEntry bookId={bookId}>
  {/* 单元选择器 */}
  <div className="unit-tabs">
    <button onClick={createNewUnit}>+ 新建单元</button>
    {units.map(unit => (
      <button
        key={unit.id}
        onClick={() => setSelectedUnit(unit)}
        className={selectedUnit?.id === unit.id ? 'active' : ''}
      >
        {unit.name} ({unit.word_count})
      </button>
    ))}
  </div>

  {/* 单词录入 */}
  {selectedUnit && (
    <div>
      <h3>向 {selectedUnit.name} 添加单词</h3>
      <WordEntryForm
        onSubmit={(wordData) => {
          addWordToUnit(selectedUnit.id, wordData);
        }}
      />

      {/* 已添加的单词 */}
      <WordList unit={selectedUnit} />
    </div>
  )}
</TeacherWordEntry>
```

---

## ✅ 核心功能清单

### 教师端 ✅
- [x] 按单元组织和录入单词
- [x] 创建单词本和单元
- [x] 一词多义管理
- [x] 分配单词本给学生
- [x] 查看学生学习进度
- [x] 查看学生薄弱单词

### 学生端 ✅
- [x] 查看分配的单词本和单元
- [x] 断点续学(自动从上次位置继续)
- [x] 卡片记忆模式
- [x] AI测试(基于薄弱点)
- [x] AI拼写训练
- [x] AI填空练习
- [x] 学习进度可视化
- [x] 薄弱单词提醒

### AI功能 ✅
- [x] 薄弱点识别算法
- [x] 智能出题策略
- [x] 掌握度计算
- [x] 间隔重复学习
- [x] 多模式独立分析

---

## 🚀 下一步实施

1. **数据库迁移**: 创建新增的表
2. **API实现**:
   - 教师端单元管理API
   - 学生端学习进度API
   - AI出题API
3. **前端实现**:
   - 单元列表页
   - 进度可视化
   - 断点续学提示
4. **测试**: 完整流程测试
5. **优化**: 性能优化和算法调优

---

**设计完成日期**: 2025-11-21
**版本**: v2.0 (增加单元和进度追踪)
**状态**: 架构设计完成,开始实施
