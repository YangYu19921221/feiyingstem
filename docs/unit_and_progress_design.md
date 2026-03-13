# 单元(Unit)与学习进度设计方案

## 🎯 核心需求

1. **单元化管理**: 教师录入单词时按单元组织 (如 Unit 1, Unit 2)
2. **进度记录**: 学生学到哪个单元的哪个单词,下次可以继续
3. **断点续学**: 学生退出后再进入,自动从上次位置继续
4. **灵活性**: 支持按单元学习,也支持打乱顺序学习

---

## 📊 重新设计的数据结构

### 1. 单词本 → 单元 → 单词 的三层结构

```
WordBook (单词本)
  ├─ Unit 1 (单元1)
  │   ├─ Word 1
  │   ├─ Word 2
  │   └─ Word 3
  ├─ Unit 2 (单元2)
  │   ├─ Word 4
  │   ├─ Word 5
  │   └─ Word 6
  └─ Unit 3 (单元3)
      ├─ Word 7
      ├─ Word 8
      └─ Word 9
```

### 2. 新增数据模型

```python
class Unit(Base):
    """单元表 - 单词本下的单元"""
    __tablename__ = "units"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    unit_number = Column(Integer, nullable=False)  # 单元序号 1,2,3...
    name = Column(String(100), nullable=False)     # 单元名称 "Unit 1: Animals"
    description = Column(Text)                      # 单元描述
    order_index = Column(Integer, default=0)        # 排序

    # 统计信息
    word_count = Column(Integer, default=0)         # 单词数量

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # 唯一约束: 同一个单词本内的单元序号不能重复
    __table_args__ = (
        UniqueConstraint('book_id', 'unit_number', name='uq_book_unit'),
    )

class UnitWord(Base):
    """单元-单词关联表 (替代原来的BookWord)"""
    __tablename__ = "unit_words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, default=0)  # 单词在单元内的顺序

    # 唯一约束: 同一个单元内的单词不能重复
    __table_args__ = (
        UniqueConstraint('unit_id', 'word_id', name='uq_unit_word'),
    )

class LearningProgress(Base):
    """学习进度表 - 记录学生在每个单词本/单元的学习进度"""
    __tablename__ = "learning_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="CASCADE"), nullable=True)

    # 学习模式
    learning_mode = Column(String(20), nullable=False)  # flashcard/quiz/spelling/fillblank

    # 进度信息
    current_word_id = Column(Integer, ForeignKey("words.id"), nullable=True)  # 当前学到的单词
    current_word_index = Column(Integer, default=0)  # 当前单词在单元中的索引

    # 完成状态
    completed_words = Column(Integer, default=0)  # 已完成的单词数
    total_words = Column(Integer, default=0)       # 总单词数
    is_completed = Column(Boolean, default=False)  # 该单元是否已完成

    # 时间戳
    last_studied_at = Column(DateTime)
    started_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

    # 唯一约束: 每个学生在每个单元的每个学习模式只有一条进度记录
    __table_args__ = (
        UniqueConstraint('user_id', 'unit_id', 'learning_mode', name='uq_user_unit_mode'),
    )

class StudySession(Base):
    """学习会话表 - 记录每次学习的详细会话"""
    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="CASCADE"), nullable=True)
    learning_mode = Column(String(20))

    # 会话统计
    words_studied = Column(Integer, default=0)     # 本次学习的单词数
    correct_count = Column(Integer, default=0)     # 正确次数
    wrong_count = Column(Integer, default=0)       # 错误次数
    time_spent = Column(Integer, default=0)        # 用时(秒)

    started_at = Column(DateTime, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)
```

---

## 🔄 数据关系图

```
WordBook (单词本)
  └─┬─ has many Units (单元)
    └─┬─ Unit
      └─┬─ has many UnitWords (单元单词)
        └─── UnitWord → Word

Student (学生)
  └─┬─ BookAssignment (分配)
    └─── assigned WordBook
  └─┬─ LearningProgress (进度)
    └─── for each Unit + Mode
  └─┬─ StudySession (学习会话)
    └─── each study session
  └─┬─ WordMastery (掌握度)
    └─── for each Word
```

---

## 📝 典型使用场景

### 场景1: 教师创建单词本并按单元录入单词

```python
# 1. 创建单词本
book = WordBook(
    name="小学三年级上册",
    description="人教版小学英语三年级上册",
    grade_level="3",
    created_by=teacher_id
)
db.add(book)
db.commit()

# 2. 创建单元
unit1 = Unit(
    book_id=book.id,
    unit_number=1,
    name="Unit 1: Hello!",
    description="打招呼相关单词"
)
unit2 = Unit(
    book_id=book.id,
    unit_number=2,
    name="Unit 2: Colors",
    description="颜色相关单词"
)
db.add_all([unit1, unit2])
db.commit()

# 3. 添加单词到单元
# Unit 1 的单词
unit1_words = [
    UnitWord(unit_id=unit1.id, word_id=1, order_index=1),  # hello
    UnitWord(unit_id=unit1.id, word_id=2, order_index=2),  # hi
    UnitWord(unit_id=unit1.id, word_id=3, order_index=3),  # goodbye
]

# Unit 2 的单词
unit2_words = [
    UnitWord(unit_id=unit2.id, word_id=4, order_index=1),  # red
    UnitWord(unit_id=unit2.id, word_id=5, order_index=2),  # blue
    UnitWord(unit_id=unit2.id, word_id=6, order_index=3),  # green
]

db.add_all(unit1_words + unit2_words)
db.commit()

# 4. 更新单元单词数量
unit1.word_count = len(unit1_words)
unit2.word_count = len(unit2_words)
db.commit()
```

### 场景2: 学生开始学习(卡片记忆模式)

```python
def start_learning(user_id, book_id, unit_id, mode='flashcard'):
    """
    学生开始学习某个单元
    返回: 当前应该学习的单词列表
    """

    # 1. 查找或创建学习进度
    progress = db.query(LearningProgress).filter(
        LearningProgress.user_id == user_id,
        LearningProgress.unit_id == unit_id,
        LearningProgress.learning_mode == mode
    ).first()

    if not progress:
        # 第一次学习这个单元,创建进度记录
        unit = db.query(Unit).get(unit_id)
        total_words = db.query(UnitWord).filter_by(unit_id=unit_id).count()

        progress = LearningProgress(
            user_id=user_id,
            book_id=book_id,
            unit_id=unit_id,
            learning_mode=mode,
            total_words=total_words,
            current_word_index=0,
            completed_words=0
        )
        db.add(progress)
        db.commit()

    # 2. 获取该单元的所有单词(按顺序)
    unit_words = db.query(UnitWord, Word).join(
        Word, UnitWord.word_id == Word.id
    ).filter(
        UnitWord.unit_id == unit_id
    ).order_by(
        UnitWord.order_index
    ).all()

    # 3. 从当前进度位置开始
    start_index = progress.current_word_index
    remaining_words = unit_words[start_index:]

    # 4. 创建学习会话
    session = StudySession(
        user_id=user_id,
        book_id=book_id,
        unit_id=unit_id,
        learning_mode=mode
    )
    db.add(session)
    db.commit()

    return {
        'session_id': session.id,
        'progress': {
            'current_index': progress.current_word_index,
            'completed': progress.completed_words,
            'total': progress.total_words,
            'percentage': (progress.completed_words / progress.total_words * 100) if progress.total_words > 0 else 0
        },
        'words': [
            {
                'word_id': word.id,
                'word': word.word,
                'phonetic': word.phonetic,
                'definitions': word.definitions,
                'index': start_index + i
            }
            for i, (unit_word, word) in enumerate(remaining_words)
        ]
    }
```

### 场景3: 学生学习中更新进度

```python
def update_learning_progress(user_id, unit_id, mode, word_id, is_correct):
    """
    学生每学完一个单词,更新进度
    """

    # 1. 更新学习进度
    progress = db.query(LearningProgress).filter(
        LearningProgress.user_id == user_id,
        LearningProgress.unit_id == unit_id,
        LearningProgress.learning_mode == mode
    ).first()

    if progress:
        # 更新当前单词位置
        progress.current_word_index += 1
        progress.completed_words += 1
        progress.last_studied_at = datetime.now()

        # 检查是否完成该单元
        if progress.completed_words >= progress.total_words:
            progress.is_completed = True
            progress.completed_at = datetime.now()

        # 更新当前单词ID
        next_word = db.query(UnitWord).filter(
            UnitWord.unit_id == unit_id
        ).order_by(
            UnitWord.order_index
        ).offset(progress.current_word_index).first()

        if next_word:
            progress.current_word_id = next_word.word_id

        db.commit()

    # 2. 记录学习记录
    record = LearningRecord(
        user_id=user_id,
        word_id=word_id,
        learning_mode=mode,
        is_correct=is_correct
    )
    db.add(record)

    # 3. 更新单词掌握度
    update_word_mastery(user_id, word_id, is_correct, mode)

    db.commit()

    return {
        'current_index': progress.current_word_index,
        'completed': progress.completed_words,
        'total': progress.total_words,
        'is_unit_completed': progress.is_completed
    }
```

### 场景4: 学生退出后继续学习(断点续学)

```python
def resume_learning(user_id, book_id, unit_id, mode='flashcard'):
    """
    断点续学: 从上次停止的位置继续
    """

    # 1. 获取学习进度
    progress = db.query(LearningProgress).filter(
        LearningProgress.user_id == user_id,
        LearningProgress.unit_id == unit_id,
        LearningProgress.learning_mode == mode
    ).first()

    if not progress:
        # 没有进度记录,从头开始
        return start_learning(user_id, book_id, unit_id, mode)

    if progress.is_completed:
        # 该单元已完成
        return {
            'status': 'completed',
            'message': f'您已完成 {mode} 模式的学习',
            'progress': {
                'completed': progress.completed_words,
                'total': progress.total_words,
                'percentage': 100
            },
            'next_action': 'review_or_next_unit'  # 建议复习或学习下一单元
        }

    # 2. 从当前进度继续
    unit_words = db.query(UnitWord, Word).join(
        Word, UnitWord.word_id == Word.id
    ).filter(
        UnitWord.unit_id == unit_id
    ).order_by(
        UnitWord.order_index
    ).offset(progress.current_word_index).all()

    # 3. 创建新的学习会话
    session = StudySession(
        user_id=user_id,
        book_id=book_id,
        unit_id=unit_id,
        learning_mode=mode
    )
    db.add(session)
    db.commit()

    return {
        'session_id': session.id,
        'status': 'resume',
        'message': f'从第 {progress.current_word_index + 1} 个单词继续',
        'progress': {
            'current_index': progress.current_word_index,
            'completed': progress.completed_words,
            'total': progress.total_words,
            'percentage': (progress.completed_words / progress.total_words * 100)
        },
        'words': [
            {
                'word_id': word.id,
                'word': word.word,
                'phonetic': word.phonetic,
                'definitions': word.definitions,
                'index': progress.current_word_index + i
            }
            for i, (unit_word, word) in enumerate(unit_words)
        ]
    }
```

### 场景5: 查看学习进度总览

```python
def get_book_progress_overview(user_id, book_id):
    """
    获取学生在某个单词本的整体学习进度
    """

    # 1. 获取单词本的所有单元
    units = db.query(Unit).filter_by(book_id=book_id).order_by(Unit.order_index).all()

    result = {
        'book_id': book_id,
        'total_units': len(units),
        'units': []
    }

    for unit in units:
        # 获取该单元在各学习模式的进度
        modes_progress = {}
        for mode in ['flashcard', 'quiz', 'spelling', 'fillblank']:
            progress = db.query(LearningProgress).filter(
                LearningProgress.user_id == user_id,
                LearningProgress.unit_id == unit.id,
                LearningProgress.learning_mode == mode
            ).first()

            if progress:
                modes_progress[mode] = {
                    'completed': progress.completed_words,
                    'total': progress.total_words,
                    'percentage': (progress.completed_words / progress.total_words * 100) if progress.total_words > 0 else 0,
                    'is_completed': progress.is_completed,
                    'last_studied_at': progress.last_studied_at
                }
            else:
                modes_progress[mode] = {
                    'completed': 0,
                    'total': unit.word_count,
                    'percentage': 0,
                    'is_completed': False,
                    'last_studied_at': None
                }

        result['units'].append({
            'unit_id': unit.id,
            'unit_number': unit.unit_number,
            'name': unit.name,
            'word_count': unit.word_count,
            'modes': modes_progress
        })

    return result
```

---

## 🎨 前端页面设计

### 1. 学生端 - 单词本详情页

```tsx
// 显示单元列表和进度
interface UnitProgress {
  unit_id: number;
  unit_number: number;
  name: string;
  word_count: number;
  modes: {
    flashcard: { completed: number; total: number; percentage: number };
    quiz: { completed: number; total: number; percentage: number };
    spelling: { completed: number; total: number; percentage: number };
    fillblank: { completed: number; total: number; percentage: number };
  };
}

const BookDetailPage = ({ bookId }) => {
  const [units, setUnits] = useState<UnitProgress[]>([]);

  return (
    <div>
      <h1>小学三年级上册</h1>

      {units.map((unit) => (
        <div key={unit.unit_id} className="unit-card">
          <h3>{unit.name}</h3>
          <p>{unit.word_count} 个单词</p>

          <div className="modes">
            {/* 卡片记忆进度 */}
            <div className="mode-progress">
              <span>🃏 卡片记忆</span>
              <ProgressBar
                percentage={unit.modes.flashcard.percentage}
                completed={unit.modes.flashcard.completed}
                total={unit.modes.flashcard.total}
              />
              <button onClick={() => startLearning(unit.unit_id, 'flashcard')}>
                {unit.modes.flashcard.percentage > 0 ? '继续学习' : '开始学习'}
              </button>
            </div>

            {/* AI测试进度 */}
            <div className="mode-progress">
              <span>✅ AI测试</span>
              <ProgressBar
                percentage={unit.modes.quiz.percentage}
                completed={unit.modes.quiz.completed}
                total={unit.modes.quiz.total}
              />
              <button onClick={() => startLearning(unit.unit_id, 'quiz')}>
                {unit.modes.quiz.percentage > 0 ? '继续练习' : 'AI出题'}
              </button>
            </div>

            {/* 其他模式... */}
          </div>
        </div>
      ))}
    </div>
  );
};
```

### 2. 学生端 - 学习页面(断点续学)

```tsx
const FlashcardLearning = ({ unitId, mode }) => {
  const [session, setSession] = useState(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);

  useEffect(() => {
    // 启动或恢复学习
    resumeLearning(unitId, mode).then((data) => {
      setSession(data);
      setCurrentWordIndex(data.progress.current_index);

      if (data.status === 'resume') {
        toast.info(`从第 ${data.progress.current_index + 1} 个单词继续`);
      }
    });
  }, []);

  const handleNext = (isCorrect) => {
    // 更新进度
    updateProgress(unitId, currentWord.word_id, isCorrect).then((progress) => {
      if (progress.is_unit_completed) {
        toast.success('🎉 恭喜!本单元已完成!');
        navigate('/unit-completed', { state: { unitId } });
      } else {
        setCurrentWordIndex(progress.current_index);
      }
    });
  };

  return (
    <div>
      {/* 进度条 */}
      <div className="progress-bar">
        <span>{session?.progress.completed} / {session?.progress.total}</span>
        <ProgressBar percentage={session?.progress.percentage} />
      </div>

      {/* 单词卡片 */}
      <FlashCard
        word={session?.words[currentWordIndex]}
        onNext={handleNext}
      />
    </div>
  );
};
```

### 3. 教师端 - 单元化录入单词

```tsx
const TeacherWordEntry = ({ bookId }) => {
  const [units, setUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);

  return (
    <div>
      <h2>录入单词到: 小学三年级上册</h2>

      {/* 单元选择器 */}
      <div className="unit-selector">
        <button onClick={() => createNewUnit()}>+ 新建单元</button>

        {units.map((unit) => (
          <button
            key={unit.id}
            onClick={() => setSelectedUnit(unit)}
            className={selectedUnit?.id === unit.id ? 'active' : ''}
          >
            {unit.name} ({unit.word_count} 词)
          </button>
        ))}
      </div>

      {/* 单词录入表单 */}
      {selectedUnit && (
        <div className="word-entry-form">
          <h3>向 {selectedUnit.name} 添加单词</h3>

          <form onSubmit={handleAddWord}>
            <input name="word" placeholder="单词" />
            <input name="phonetic" placeholder="音标" />
            <textarea name="meaning" placeholder="释义" />
            <input name="example" placeholder="例句" />
            <button type="submit">添加到 {selectedUnit.name}</button>
          </form>

          {/* 已添加的单词列表 */}
          <div className="word-list">
            <h4>已添加的单词 ({selectedUnit.word_count})</h4>
            <ul>
              {selectedUnit.words.map((word, index) => (
                <li key={word.id}>
                  {index + 1}. {word.word} - {word.meaning}
                  <button onClick={() => deleteWord(word.id)}>删除</button>
                  <button onClick={() => moveUp(word.id)}>上移</button>
                  <button onClick={() => moveDown(word.id)}>下移</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## 🔧 API接口设计

### 教师端API

```python
# 单元管理
POST   /api/v1/teacher/books/{book_id}/units          # 创建单元
PUT    /api/v1/teacher/units/{unit_id}                # 修改单元
DELETE /api/v1/teacher/units/{unit_id}                # 删除单元
GET    /api/v1/teacher/books/{book_id}/units          # 获取单词本的所有单元

# 向单元添加单词
POST   /api/v1/teacher/units/{unit_id}/words          # 添加单词到单元
PUT    /api/v1/teacher/units/{unit_id}/words/{word_id}/order  # 调整单词顺序
DELETE /api/v1/teacher/units/{unit_id}/words/{word_id}  # 从单元移除单词
```

### 学生端API

```python
# 查看单词本单元结构
GET    /api/v1/student/books/{book_id}/units          # 获取单元列表
GET    /api/v1/student/books/{book_id}/progress       # 获取学习进度总览

# 开始/继续学习
POST   /api/v1/student/units/{unit_id}/start          # 开始学习某单元
        {
          "mode": "flashcard",  # flashcard/quiz/spelling/fillblank
          "resume": true        # 是否从上次进度继续
        }

# 更新进度
POST   /api/v1/student/progress/update                # 更新学习进度
        {
          "unit_id": 1,
          "mode": "flashcard",
          "word_id": 123,
          "is_correct": true
        }

# 获取当前进度
GET    /api/v1/student/units/{unit_id}/progress?mode=flashcard
```

---

## 📋 数据迁移方案

### 从旧结构迁移到新结构

```python
def migrate_bookwords_to_units():
    """
    将现有的 book_words 迁移到 unit_words
    策略: 为每个单词本创建一个默认单元
    """
    books = db.query(WordBook).all()

    for book in books:
        # 创建默认单元
        default_unit = Unit(
            book_id=book.id,
            unit_number=1,
            name="Unit 1",
            description="默认单元"
        )
        db.add(default_unit)
        db.flush()

        # 迁移该单词本的所有单词到默认单元
        book_words = db.query(BookWord).filter_by(book_id=book.id).all()

        for bw in book_words:
            unit_word = UnitWord(
                unit_id=default_unit.id,
                word_id=bw.word_id,
                order_index=bw.order_index
            )
            db.add(unit_word)

        # 更新单元单词数
        default_unit.word_count = len(book_words)

    db.commit()
```

---

## ✅ 核心优势

1. **清晰的组织结构**: 单词本 → 单元 → 单词,符合教材结构
2. **精确的进度追踪**: 记录到具体的单元、模式、单词位置
3. **断点续学**: 学生可以随时继续上次的学习
4. **灵活的学习方式**: 支持顺序学习和复习
5. **多模式独立进度**: 每个学习模式都有独立的进度记录
6. **教师友好**: 按单元批量录入和管理单词

---

## 🎯 总结

通过引入 **Unit(单元)** 和 **LearningProgress(学习进度)** 两个核心表:

- ✅ 教师可以按单元组织和录入单词
- ✅ 学生可以看到清晰的单元结构和进度
- ✅ 实现断点续学,随时继续上次的位置
- ✅ 每个学习模式独立追踪进度
- ✅ 支持完成状态和时间记录
