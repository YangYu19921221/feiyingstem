from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Float, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

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

class QuestionOption(Base):
    """题目选项表 - 用于选择题"""
    __tablename__ = "question_options"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("reading_questions.id", ondelete="CASCADE"))

    option_text = Column(Text, nullable=False)             # 选项内容
    option_label = Column(String(5))                       # 选项标签 A/B/C/D
    is_correct = Column(Boolean, default=False)            # 是否正确答案
    order_index = Column(Integer, default=0)               # 选项顺序

class QuestionAnswer(Base):
    """题目标准答案表 - 用于填空/简答题"""
    __tablename__ = "question_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("reading_questions.id", ondelete="CASCADE"))

    answer_text = Column(Text, nullable=False)             # 标准答案
    answer_explanation = Column(Text)                      # 答案解析

    # 对于填空题,可能有多个可接受的答案
    is_primary = Column(Boolean, default=True)             # 是否主要答案
    accept_alternatives = Column(Text)                     # 可接受的替代答案 JSON

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
        UniqueConstraint('user_id', 'passage_id', name='uq_user_reading_passage'),
    )
