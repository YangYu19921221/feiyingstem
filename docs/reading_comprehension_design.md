# 阅读理解功能设计方案

## 🎯 功能概述

### 核心功能
1. **教师端**: 上传阅读文章 + 手动出题 OR AI自动生成文章和题目
2. **学生端**: 阅读文章 + 答题 + 实时反馈 + 成绩统计
3. **AI辅助**:
   - AI根据难度/主题自动生成文章
   - AI自动从文章中生成理解题目
   - 生成词汇注释和语法提示

---

## 📊 数据模型设计

### 1. ReadingPassage (阅读文章表)

```python
class ReadingPassage(Base):
    """阅读理解文章表"""
    __tablename__ = "reading_passages"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 基本信息
    title = Column(String(200), nullable=False)           # 文章标题
    content = Column(Text, nullable=False)                 # 文章内容(英文)
    content_translation = Column(Text)                     # 文章翻译(中文)

    # 分类信息
    difficulty = Column(Integer, default=3)                # 难度 1-5
    grade_level = Column(String(20))                       # 适合年级
    word_count = Column(Integer)                           # 单词数

    # 主题标签
    topic = Column(String(100))                            # 主题 (故事/科学/历史/日常)
    tags = Column(Text)                                    # 标签 JSON: ["animals", "nature"]

    # 生成方式
    source = Column(String(20), default='manual')          # manual/ai_generated
    ai_prompt = Column(Text)                               # AI生成时使用的提示词

    # 元数据
    created_by = Column(Integer, ForeignKey("users.id"))   # 教师ID
    is_public = Column(Boolean, default=False)             # 是否公开
    cover_image = Column(String(255))                      # 封面图片

    # 统计信息
    view_count = Column(Integer, default=0)                # 阅读次数
    completion_count = Column(Integer, default=0)          # 完成次数
    avg_score = Column(Float, default=0.0)                 # 平均分

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

### 2. ReadingVocabulary (文章词汇注释表)

```python
class ReadingVocabulary(Base):
    """阅读文章中的重点词汇注释"""
    __tablename__ = "reading_vocabulary"

    id = Column(Integer, primary_key=True, autoincrement=True)
    passage_id = Column(Integer, ForeignKey("reading_passages.id", ondelete="CASCADE"))

    word = Column(String(100), nullable=False)             # 单词
    meaning = Column(String(255))                          # 中文释义
    phonetic = Column(String(100))                         # 音标
    context = Column(Text)                                 # 在文章中的上下文
    position = Column(Integer)                             # 在文章中的位置(字符索引)

    # AI可以自动标注重点词汇
    is_key_vocabulary = Column(Boolean, default=False)     # 是否重点词汇
```

### 3. ReadingQuestion (阅读理解题目表)

```python
class ReadingQuestion(Base):
    """阅读理解题目表"""
    __tablename__ = "reading_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    passage_id = Column(Integer, ForeignKey("reading_passages.id", ondelete="CASCADE"))

    # 题目信息
    question_type = Column(String(20), nullable=False)     # 题型
    # 题型类型:
    # - multiple_choice: 选择题
    # - true_false: 判断题
    # - fill_blank: 填空题
    # - short_answer: 简答题
    # - sequence: 排序题

    question_text = Column(Text, nullable=False)           # 题目内容
    order_index = Column(Integer, default=0)               # 题目顺序

    # 分值
    points = Column(Integer, default=1)                    # 分值

    # 生成方式
    source = Column(String(20), default='manual')          # manual/ai_generated

    created_at = Column(DateTime, server_default=func.now())
```

### 4. QuestionOption (题目选项表 - 用于选择题)

```python
class QuestionOption(Base):
    """题目选项表"""
    __tablename__ = "question_options"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("reading_questions.id", ondelete="CASCADE"))

    option_text = Column(Text, nullable=False)             # 选项内容
    option_label = Column(String(5))                       # 选项标签 A/B/C/D
    is_correct = Column(Boolean, default=False)            # 是否正确答案
    order_index = Column(Integer, default=0)               # 选项顺序
```

### 5. QuestionAnswer (标准答案表 - 用于填空/简答题)

```python
class QuestionAnswer(Base):
    """题目标准答案表"""
    __tablename__ = "question_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("reading_questions.id", ondelete="CASCADE"))

    answer_text = Column(Text, nullable=False)             # 标准答案
    answer_explanation = Column(Text)                      # 答案解析

    # 对于填空题,可能有多个可接受的答案
    is_primary = Column(Boolean, default=True)             # 是否主要答案
    accept_alternatives = Column(Text)                     # 可接受的替代答案 JSON
```

### 6. ReadingAssignment (阅读作业分配表)

```python
class ReadingAssignment(Base):
    """教师分配阅读作业给学生"""
    __tablename__ = "reading_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    passage_id = Column(Integer, ForeignKey("reading_passages.id", ondelete="CASCADE"))
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))

    assigned_at = Column(DateTime, server_default=func.now())
    deadline = Column(DateTime)                            # 截止时间
    is_completed = Column(Boolean, default=False)          # 是否完成

    # 要求
    min_score = Column(Integer)                            # 最低分要求
    max_attempts = Column(Integer, default=3)              # 最多尝试次数
```

### 7. ReadingAttempt (学生答题记录表)

```python
class ReadingAttempt(Base):
    """学生阅读理解答题记录"""
    __tablename__ = "reading_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    passage_id = Column(Integer, ForeignKey("reading_passages.id", ondelete="CASCADE"))
    assignment_id = Column(Integer, ForeignKey("reading_assignments.id"), nullable=True)

    # 答题情况
    attempt_number = Column(Integer, default=1)            # 第几次尝试
    score = Column(Integer, default=0)                     # 得分
    total_points = Column(Integer)                         # 总分
    percentage = Column(Float)                             # 百分比

    # 时间统计
    time_spent = Column(Integer)                           # 用时(秒)
    started_at = Column(DateTime, server_default=func.now())
    submitted_at = Column(DateTime)

    # 答案JSON
    answers = Column(Text)                                 # JSON: {"q1": "A", "q2": "answer text"}

    is_passed = Column(Boolean, default=False)             # 是否通过
```

### 8. ReadingProgress (阅读进度表)

```python
class ReadingProgress(Base):
    """学生阅读进度(用于长文章)"""
    __tablename__ = "reading_progress"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    passage_id = Column(Integer, ForeignKey("reading_passages.id", ondelete="CASCADE"))

    # 阅读进度
    last_position = Column(Integer, default=0)             # 上次阅读到的位置(字符索引)
    progress_percentage = Column(Float, default=0.0)       # 阅读进度百分比

    # 笔记和标记
    highlights = Column(Text)                              # 高亮标记 JSON
    notes = Column(Text)                                   # 笔记 JSON

    last_read_at = Column(DateTime)

    __table_args__ = (
        UniqueConstraint('user_id', 'passage_id', name='uq_user_passage'),
    )
```

---

## 🔄 数据关系图

```
Teacher (教师)
  │
  ├─ creates ─────► ReadingPassage (文章)
  │                     │
  │                     ├─ has ─────► ReadingVocabulary (词汇注释)
  │                     │
  │                     ├─ has ─────► ReadingQuestion (题目)
  │                     │                 │
  │                     │                 ├─ has ─► QuestionOption (选项)
  │                     │                 └─ has ─► QuestionAnswer (答案)
  │                     │
  └─ assigns ────► ReadingAssignment (分配作业)
                         │
                         │ assigned to
                         ↓
                   Student (学生)
                         │
                         ├─ attempts ─► ReadingAttempt (答题记录)
                         │
                         └─ tracks ───► ReadingProgress (阅读进度)
```

---

## 🤖 AI功能设计

### 功能1: AI生成阅读文章

```python
def generate_reading_passage_by_ai(
    topic: str,           # 主题: "动物", "科学", "历史"
    difficulty: int,      # 难度: 1-5
    word_count: int,      # 单词数: 100-500
    grade_level: str,     # 年级: "3", "4", "5"
    keywords: List[str]   # 必须包含的关键词
):
    """
    使用阿里云通义千问生成阅读文章
    """

    prompt = f"""
    请生成一篇适合{grade_level}年级学生的英语阅读文章。

    要求:
    - 主题: {topic}
    - 难度级别: {difficulty}/5 (1最简单,5最难)
    - 单词数: 约{word_count}词
    - 必须包含这些词汇: {', '.join(keywords)}
    - 语言要符合该年级学生的理解能力
    - 内容要有趣且具有教育意义

    请按以下格式输出:

    标题: [文章标题]

    正文:
    [文章内容,分段]

    重点词汇 (5-10个):
    - word1: 中文释义
    - word2: 中文释义

    建议理解问题 (3-5个):
    1. [问题1]
       答案: [答案]
    2. [问题2]
       答案: [答案]
    """

    # 调用阿里云API
    response = call_tongyi_api(prompt)

    # 解析响应
    parsed = parse_ai_response(response)

    # 保存到数据库
    passage = ReadingPassage(
        title=parsed['title'],
        content=parsed['content'],
        difficulty=difficulty,
        grade_level=grade_level,
        word_count=len(parsed['content'].split()),
        topic=topic,
        source='ai_generated',
        ai_prompt=prompt
    )
    db.add(passage)
    db.commit()

    # 保存词汇注释
    for vocab in parsed['vocabulary']:
        reading_vocab = ReadingVocabulary(
            passage_id=passage.id,
            word=vocab['word'],
            meaning=vocab['meaning'],
            is_key_vocabulary=True
        )
        db.add(reading_vocab)

    # 保存AI生成的问题
    for i, q in enumerate(parsed['questions']):
        question = ReadingQuestion(
            passage_id=passage.id,
            question_type='short_answer',
            question_text=q['question'],
            order_index=i,
            source='ai_generated'
        )
        db.add(question)
        db.flush()

        # 保存答案
        answer = QuestionAnswer(
            question_id=question.id,
            answer_text=q['answer'],
            is_primary=True
        )
        db.add(answer)

    db.commit()
    return passage
```

### 功能2: AI从已有文章生成题目

```python
def generate_questions_by_ai(passage_id: int, question_count: int = 5):
    """
    AI根据已有文章自动生成理解题目
    """

    passage = db.query(ReadingPassage).get(passage_id)

    prompt = f"""
    请根据以下英语文章生成{question_count}道阅读理解题目。

    文章标题: {passage.title}
    文章内容:
    {passage.content}

    要求:
    1. 生成多种题型:
       - 2道选择题 (4个选项,只有1个正确答案)
       - 1道判断题 (True/False)
       - 1道填空题
       - 1道简答题

    2. 题目要涵盖:
       - 主旨理解
       - 细节理解
       - 词汇理解
       - 推理判断

    3. 难度适中,符合文章的难度级别

    请按以下JSON格式输出:
    {{
        "questions": [
            {{
                "type": "multiple_choice",
                "question": "What is the main idea of the passage?",
                "options": [
                    {{"label": "A", "text": "选项A", "is_correct": false}},
                    {{"label": "B", "text": "选项B", "is_correct": true}},
                    {{"label": "C", "text": "选项C", "is_correct": false}},
                    {{"label": "D", "text": "选项D", "is_correct": false}}
                ]
            }},
            {{
                "type": "true_false",
                "question": "The story happened in summer.",
                "answer": true,
                "explanation": "因为文章第二段提到..."
            }},
            {{
                "type": "fill_blank",
                "question": "The boy's name is ____.",
                "answer": "Tom",
                "alternatives": ["Thomas"]
            }},
            {{
                "type": "short_answer",
                "question": "Why did the boy go to the park?",
                "answer": "Because he wanted to play with his friends."
            }}
        ]
    }}
    """

    # 调用AI
    response = call_tongyi_api(prompt)
    questions_data = json.loads(response)

    # 保存题目到数据库
    for i, q_data in enumerate(questions_data['questions']):
        question = ReadingQuestion(
            passage_id=passage_id,
            question_type=q_data['type'],
            question_text=q_data['question'],
            order_index=i,
            source='ai_generated'
        )
        db.add(question)
        db.flush()

        if q_data['type'] == 'multiple_choice':
            # 保存选项
            for opt in q_data['options']:
                option = QuestionOption(
                    question_id=question.id,
                    option_text=opt['text'],
                    option_label=opt['label'],
                    is_correct=opt['is_correct']
                )
                db.add(option)

        else:
            # 保存答案
            answer = QuestionAnswer(
                question_id=question.id,
                answer_text=str(q_data['answer']),
                answer_explanation=q_data.get('explanation'),
                accept_alternatives=json.dumps(q_data.get('alternatives', []))
            )
            db.add(answer)

    db.commit()
```

### 功能3: AI评分简答题

```python
def ai_grade_short_answer(question_id: int, student_answer: str):
    """
    AI评判简答题
    """

    question = db.query(ReadingQuestion).get(question_id)
    standard_answer = db.query(QuestionAnswer).filter_by(
        question_id=question_id,
        is_primary=True
    ).first()

    passage = db.query(ReadingPassage).get(question.passage_id)

    prompt = f"""
    请评判学生的英语阅读理解简答题答案。

    文章片段:
    {passage.content[:500]}...

    题目: {question.question_text}

    标准答案: {standard_answer.answer_text}

    学生答案: {student_answer}

    评分标准:
    - 10分: 完全正确,表述清晰
    - 7-9分: 基本正确,表述可以改进
    - 4-6分: 部分正确,但有明显错误
    - 1-3分: 大部分错误
    - 0分: 完全错误或答非所问

    请给出:
    1. 分数 (0-10)
    2. 评语 (50字以内,指出优点和不足)

    输出JSON格式:
    {{
        "score": 8,
        "feedback": "回答基本正确,抓住了要点。建议完整表达...",
        "is_correct": true
    }}
    """

    response = call_tongyi_api(prompt)
    result = json.loads(response)

    return result
```

---

## 🎨 前端页面设计

### 教师端页面

#### 1. 阅读文章管理页

```tsx
<TeacherReadingManagement>
  {/* 顶部操作栏 */}
  <div className="actions">
    <button onClick={() => setShowUploadModal(true)}>
      📄 手动上传文章
    </button>
    <button onClick={() => setShowAIGenerateModal(true)}>
      🤖 AI生成文章
    </button>
  </div>

  {/* 文章列表 */}
  <div className="passage-list">
    {passages.map(passage => (
      <PassageCard key={passage.id}>
        <img src={passage.cover_image} />
        <h3>{passage.title}</h3>
        <div className="meta">
          <span>难度: {'⭐'.repeat(passage.difficulty)}</span>
          <span>{passage.word_count} 词</span>
          <span>{passage.topic}</span>
        </div>
        <div className="stats">
          <span>👁️ {passage.view_count} 次阅读</span>
          <span>📊 平均分: {passage.avg_score}</span>
        </div>
        <div className="actions">
          <button onClick={() => editPassage(passage.id)}>编辑</button>
          <button onClick={() => addQuestions(passage.id)}>出题</button>
          <button onClick={() => assignToStudents(passage.id)}>分配</button>
        </div>
      </PassageCard>
    ))}
  </div>
</TeacherReadingManagement>
```

#### 2. AI生成文章对话框

```tsx
<AIGenerateModal>
  <h2>🤖 AI生成阅读文章</h2>

  <form onSubmit={handleGenerate}>
    {/* 主题选择 */}
    <div>
      <label>主题</label>
      <select name="topic">
        <option value="daily">日常生活</option>
        <option value="animal">动物</option>
        <option value="science">科学</option>
        <option value="history">历史</option>
        <option value="story">故事</option>
      </select>
    </div>

    {/* 难度 */}
    <div>
      <label>难度级别</label>
      <StarRating value={difficulty} onChange={setDifficulty} max={5} />
    </div>

    {/* 年级 */}
    <div>
      <label>适合年级</label>
      <select name="grade">
        <option value="3">小学三年级</option>
        <option value="4">小学四年级</option>
        <option value="5">小学五年级</option>
      </select>
    </div>

    {/* 单词数 */}
    <div>
      <label>单词数</label>
      <input type="number" name="word_count" defaultValue={200} />
    </div>

    {/* 关键词 */}
    <div>
      <label>必须包含的词汇 (可选)</label>
      <TagInput
        tags={keywords}
        onAdd={(tag) => setKeywords([...keywords, tag])}
        onRemove={(tag) => setKeywords(keywords.filter(k => k !== tag))}
        placeholder="输入词汇后按回车"
      />
    </div>

    {/* 自定义要求 */}
    <div>
      <label>额外要求 (可选)</label>
      <textarea
        name="custom_requirements"
        placeholder="例如: 文章要包含对话,或者要有情节转折..."
        rows={3}
      />
    </div>

    <button type="submit" disabled={generating}>
      {generating ? (
        <><Spinner /> AI生成中...</>
      ) : (
        '🚀 生成文章'
      )}
    </button>
  </form>

  {/* 生成结果 */}
  {generatedPassage && (
    <div className="generated-result">
      <h3>✅ 生成成功!</h3>
      <PassagePreview passage={generatedPassage} />
      <div className="actions">
        <button onClick={() => savePassage(generatedPassage)}>
          保存文章
        </button>
        <button onClick={() => regenerate()}>
          🔄 重新生成
        </button>
      </div>
    </div>
  )}
</AIGenerateModal>
```

#### 3. 题目编辑页

```tsx
<QuestionEditor passageId={passageId}>
  {/* 顶部工具栏 */}
  <div className="toolbar">
    <button onClick={() => addQuestion('multiple_choice')}>
      ➕ 选择题
    </button>
    <button onClick={() => addQuestion('true_false')}>
      ➕ 判断题
    </button>
    <button onClick={() => addQuestion('fill_blank')}>
      ➕ 填空题
    </button>
    <button onClick={() => addQuestion('short_answer')}>
      ➕ 简答题
    </button>
    <button onClick={() => aiGenerateQuestions()} className="ai-button">
      🤖 AI自动出题
    </button>
  </div>

  {/* 题目列表 */}
  <div className="questions">
    {questions.map((q, index) => (
      <QuestionCard key={q.id} question={q} index={index}>
        {/* 选择题 */}
        {q.type === 'multiple_choice' && (
          <MultipleChoiceEditor
            question={q}
            onChange={(updated) => updateQuestion(q.id, updated)}
          />
        )}

        {/* 判断题 */}
        {q.type === 'true_false' && (
          <TrueFalseEditor
            question={q}
            onChange={(updated) => updateQuestion(q.id, updated)}
          />
        )}

        {/* 填空题 */}
        {q.type === 'fill_blank' && (
          <FillBlankEditor
            question={q}
            onChange={(updated) => updateQuestion(q.id, updated)}
          />
        )}

        {/* 简答题 */}
        {q.type === 'short_answer' && (
          <ShortAnswerEditor
            question={q}
            onChange={(updated) => updateQuestion(q.id, updated)}
          />
        )}

        <button onClick={() => deleteQuestion(q.id)}>删除</button>
      </QuestionCard>
    ))}
  </div>
</QuestionEditor>
```

### 学生端页面

#### 1. 阅读理解列表

```tsx
<StudentReadingList>
  {/* 我的阅读作业 */}
  <section>
    <h2>📚 我的阅读作业</h2>
    {assignments.map(assignment => (
      <AssignmentCard key={assignment.id}>
        <div className="passage-info">
          <img src={assignment.passage.cover_image} />
          <div>
            <h3>{assignment.passage.title}</h3>
            <div className="meta">
              <span>{'⭐'.repeat(assignment.passage.difficulty)}</span>
              <span>{assignment.passage.word_count} 词</span>
            </div>
          </div>
        </div>

        <div className="assignment-info">
          <span>截止: {formatDate(assignment.deadline)}</span>
          <span>最低分: {assignment.min_score}</span>
          {assignment.is_completed && (
            <span className="completed">✅ 已完成</span>
          )}
        </div>

        <button onClick={() => startReading(assignment.passage_id)}>
          {assignment.is_completed ? '查看结果' : '开始阅读'}
        </button>
      </AssignmentCard>
    ))}
  </section>

  {/* 推荐阅读 */}
  <section>
    <h2>💡 推荐阅读</h2>
    {recommendations.map(passage => (
      <PassageCard
        key={passage.id}
        passage={passage}
        onClick={() => startReading(passage.id)}
      />
    ))}
  </section>
</StudentReadingList>
```

#### 2. 阅读答题页面

```tsx
<ReadingPage passageId={passageId}>
  <div className="layout">
    {/* 左侧: 文章内容 */}
    <div className="passage-panel">
      <h1>{passage.title}</h1>

      {/* 文章内容(可高亮标记) */}
      <div className="content">
        <Highlightable
          text={passage.content}
          onHighlight={(text, position) => {
            addHighlight(text, position);
          }}
        />
      </div>

      {/* 词汇注释 */}
      <div className="vocabulary">
        <h3>📖 重点词汇</h3>
        {vocabularies.map(vocab => (
          <VocabItem key={vocab.id}>
            <span className="word">{vocab.word}</span>
            <span className="phonetic">{vocab.phonetic}</span>
            <span className="meaning">{vocab.meaning}</span>
            <button onClick={() => playAudio(vocab.word)}>🔊</button>
          </VocabItem>
        ))}
      </div>
    </div>

    {/* 右侧: 题目 */}
    <div className="questions-panel">
      <div className="progress">
        <span>题目进度: {answeredCount}/{questions.length}</span>
        <span>用时: {formatTime(timeSpent)}</span>
      </div>

      {questions.map((q, index) => (
        <QuestionCard key={q.id} number={index + 1}>
          <p className="question-text">{q.question_text}</p>

          {/* 选择题 */}
          {q.type === 'multiple_choice' && (
            <div className="options">
              {q.options.map(opt => (
                <label key={opt.id}>
                  <input
                    type="radio"
                    name={`question_${q.id}`}
                    value={opt.option_label}
                    checked={answers[q.id] === opt.option_label}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                  <span>{opt.option_label}. {opt.option_text}</span>
                </label>
              ))}
            </div>
          )}

          {/* 判断题 */}
          {q.type === 'true_false' && (
            <div className="true-false">
              <button
                className={answers[q.id] === 'true' ? 'selected' : ''}
                onClick={() => setAnswer(q.id, 'true')}
              >
                ✅ True
              </button>
              <button
                className={answers[q.id] === 'false' ? 'selected' : ''}
                onClick={() => setAnswer(q.id, 'false')}
              >
                ❌ False
              </button>
            </div>
          )}

          {/* 填空题 */}
          {q.type === 'fill_blank' && (
            <input
              type="text"
              value={answers[q.id] || ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              placeholder="请输入答案"
            />
          )}

          {/* 简答题 */}
          {q.type === 'short_answer' && (
            <textarea
              value={answers[q.id] || ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              placeholder="请用英语作答"
              rows={4}
            />
          )}
        </QuestionCard>
      ))}

      <button
        onClick={submitAnswers}
        disabled={!allAnswered}
        className="submit-button"
      >
        提交答案
      </button>
    </div>
  </div>
</ReadingPage>
```

#### 3. 结果反馈页面

```tsx
<ResultPage attemptId={attemptId}>
  {/* 成绩卡片 */}
  <div className="score-card">
    <div className="score-circle">
      <CircularProgress value={attempt.percentage} />
      <div className="score-text">
        <h2>{attempt.score}/{attempt.total_points}</h2>
        <p>{attempt.percentage}%</p>
      </div>
    </div>

    <div className="stats">
      <div>用时: {formatTime(attempt.time_spent)}</div>
      <div>尝试次数: {attempt.attempt_number}</div>
      {attempt.is_passed ? (
        <div className="passed">✅ 通过</div>
      ) : (
        <div className="failed">❌ 未通过</div>
      )}
    </div>
  </div>

  {/* 题目详解 */}
  <div className="question-review">
    <h3>📝 答题详情</h3>
    {questions.map((q, index) => {
      const studentAnswer = attempt.answers[q.id];
      const isCorrect = checkAnswer(q, studentAnswer);

      return (
        <QuestionReview key={q.id} isCorrect={isCorrect}>
          <div className="header">
            <span>第{index + 1}题</span>
            {isCorrect ? (
              <span className="correct">✅ 正确</span>
            ) : (
              <span className="wrong">❌ 错误</span>
            )}
          </div>

          <p className="question">{q.question_text}</p>

          <div className="answer-comparison">
            <div className="student-answer">
              <label>你的答案:</label>
              <span className={isCorrect ? 'correct' : 'wrong'}>
                {studentAnswer}
              </span>
            </div>

            {!isCorrect && (
              <div className="correct-answer">
                <label>正确答案:</label>
                <span>{getCorrectAnswer(q)}</span>
              </div>
            )}
          </div>

          {/* AI评语(简答题) */}
          {q.type === 'short_answer' && (
            <div className="ai-feedback">
              <h4>🤖 AI评语</h4>
              <p>{q.ai_feedback}</p>
            </div>
          )}

          {/* 答案解析 */}
          {q.explanation && (
            <div className="explanation">
              <h4>💡 解析</h4>
              <p>{q.explanation}</p>
            </div>
          )}
        </QuestionReview>
      );
    })}
  </div>

  {/* 操作按钮 */}
  <div className="actions">
    {!attempt.is_passed && attempt.attempt_number < maxAttempts && (
      <button onClick={() => retry()}>
        🔄 再次尝试
      </button>
    )}
    <button onClick={() => goBack()}>
      返回列表
    </button>
  </div>
</ResultPage>
```

---

## 📋 API接口设计

### 教师端API

```python
# 文章管理
POST   /api/v1/teacher/reading/passages          # 手动上传文章
POST   /api/v1/teacher/reading/generate-ai       # AI生成文章
GET    /api/v1/teacher/reading/passages          # 获取文章列表
PUT    /api/v1/teacher/reading/passages/{id}     # 编辑文章
DELETE /api/v1/teacher/reading/passages/{id}     # 删除文章

# 词汇注释
POST   /api/v1/teacher/reading/passages/{id}/vocabulary   # 添加词汇注释
PUT    /api/v1/teacher/reading/vocabulary/{id}            # 编辑词汇
DELETE /api/v1/teacher/reading/vocabulary/{id}            # 删除词汇

# 题目管理
POST   /api/v1/teacher/reading/passages/{id}/questions     # 添加题目
POST   /api/v1/teacher/reading/passages/{id}/questions-ai  # AI生成题目
PUT    /api/v1/teacher/reading/questions/{id}              # 编辑题目
DELETE /api/v1/teacher/reading/questions/{id}              # 删除题目

# 作业分配
POST   /api/v1/teacher/reading/assignments        # 分配阅读作业
GET    /api/v1/teacher/reading/assignments        # 查看分配记录
GET    /api/v1/teacher/reading/assignments/{id}/results  # 查看学生成绩
```

### 学生端API

```python
# 阅读列表
GET    /api/v1/student/reading/assignments        # 获取我的作业
GET    /api/v1/student/reading/passages           # 获取可阅读文章
GET    /api/v1/student/reading/recommendations    # 获取推荐阅读

# 阅读和答题
GET    /api/v1/student/reading/passages/{id}      # 获取文章详情
POST   /api/v1/student/reading/attempts           # 开始答题
PUT    /api/v1/student/reading/attempts/{id}      # 提交答案
GET    /api/v1/student/reading/attempts/{id}      # 获取答题结果

# 阅读进度
GET    /api/v1/student/reading/progress/{passage_id}      # 获取阅读进度
POST   /api/v1/student/reading/progress/{passage_id}      # 更新阅读进度
POST   /api/v1/student/reading/highlights                 # 保存高亮
POST   /api/v1/student/reading/notes                      # 保存笔记
```

---

## ✅ 功能总结

### 教师端功能 ✅
- [x] 手动上传阅读文章
- [x] AI生成阅读文章(自定义主题/难度/单词数)
- [x] 手动出题(选择/判断/填空/简答)
- [x] AI自动从文章生成题目
- [x] 管理词汇注释
- [x] 分配阅读作业给学生
- [x] 查看学生答题情况和成绩

### 学生端功能 ✅
- [x] 查看分配的阅读作业
- [x] 阅读文章(支持高亮标记)
- [x] 查看词汇注释和发音
- [x] 答题(多种题型)
- [x] 实时反馈和AI评分
- [x] 查看错题解析
- [x] 保存阅读进度和笔记

### AI功能 ✅
- [x] 根据要求生成阅读文章
- [x] 自动标注重点词汇
- [x] 自动生成理解题目
- [x] AI评判简答题

---

**设计完成日期**: 2025-11-21
**版本**: v1.0
**状态**: 设计完成,待实施
