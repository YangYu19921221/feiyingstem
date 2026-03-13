from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

class LearningRecord(Base):
    __tablename__ = "learning_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    learning_mode = Column(String(20))
    is_correct = Column(Boolean)
    time_spent = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())

class WordMastery(Base):
    """学生单词掌握度表 - 记录每个学生对每个单词的掌握程度"""
    __tablename__ = "word_mastery"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)

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
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class BookAssignment(Base):
    """单词本分配表 - 教师分配单词本给学生"""
    __tablename__ = "book_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime, server_default=func.now())
    deadline = Column(DateTime, nullable=True)  # 学习截止日期
    is_completed = Column(Boolean, default=False)

class AIQuizRecord(Base):
    """AI出题记录表 - 记录AI生成的题目"""
    __tablename__ = "ai_quiz_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    quiz_type = Column(String(20))  # quiz/spelling/fillblank
    word_ids = Column(Text)  # JSON格式: [1,2,3,4,5]
    difficulty_level = Column(Integer)
    based_on_weakness = Column(Boolean, default=True)
    score = Column(Integer, nullable=True)  # 得分
    generated_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

class LearningProgress(Base):
    """学习进度表 - 记录学生在每个单元/模式的学习进度"""
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

class HomeworkAssignment(Base):
    """作业分配表 - 教师布置的作业"""
    __tablename__ = "homework_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="CASCADE"), nullable=False)
    learning_mode = Column(String(50), nullable=False)  # flashcard, spelling, fillblank, quiz
    target_score = Column(Integer, default=80)  # 目标分数
    min_completion_time = Column(Integer, nullable=True)  # 最少完成时间(秒)
    max_attempts = Column(Integer, default=3)  # 最多尝试次数
    deadline = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class HomeworkStudentAssignment(Base):
    """作业-学生关联表"""
    __tablename__ = "homework_student_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    homework_id = Column(Integer, ForeignKey("homework_assignments.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime, server_default=func.now())
    status = Column(String(50), default='pending')  # pending, in_progress, completed, overdue
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    attempts_count = Column(Integer, default=0)
    best_score = Column(Integer, default=0)
    total_time_spent = Column(Integer, default=0)  # 秒

    __table_args__ = (
        UniqueConstraint('homework_id', 'student_id', name='uq_homework_student'),
    )

class HomeworkAttemptRecord(Base):
    """作业完成记录表 - 每次尝试的详细记录"""
    __tablename__ = "homework_attempt_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    homework_student_assignment_id = Column(Integer, ForeignKey("homework_student_assignments.id", ondelete="CASCADE"), nullable=False)
    attempt_number = Column(Integer, nullable=False)
    score = Column(Integer, nullable=False)
    time_spent = Column(Integer, nullable=False)  # 秒
    correct_count = Column(Integer, default=0)
    wrong_count = Column(Integer, default=0)
    total_words = Column(Integer, default=0)
    completed_at = Column(DateTime, server_default=func.now())
    details = Column(Text, nullable=True)  # JSON格式存储详细答题记录


class ExamPaper(Base):
    """试卷表 - AI根据薄弱点生成"""
    __tablename__ = "exam_papers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    total_score = Column(Integer, default=100)
    generated_by_ai = Column(Boolean, default=False)
    generation_strategy = Column(Text, nullable=True)  # JSON格式,记录薄弱点
    created_at = Column(DateTime, server_default=func.now())


class ExamQuestion(Base):
    """试卷题目表"""
    __tablename__ = "exam_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    question_type = Column(String(20))  # choice, fill_blank, spelling, reading, translation
    word_id = Column(Integer, ForeignKey("words.id", ondelete="SET NULL"), nullable=True)
    question_text = Column(Text, nullable=False)
    options = Column(Text, nullable=True)  # JSON格式选项
    correct_answer = Column(Text, nullable=False)
    score = Column(Integer, default=5)
    order_index = Column(Integer, default=0)


class ExamSubmission(Base):
    """试卷答题记录"""
    __tablename__ = "exam_submissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_id = Column(Integer, ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    score = Column(Integer, nullable=True)
    total_score = Column(Integer, nullable=True)
    submitted_at = Column(DateTime, server_default=func.now())


class ExamAnswer(Base):
    """答题详情"""
    __tablename__ = "exam_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    submission_id = Column(Integer, ForeignKey("exam_submissions.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("exam_questions.id", ondelete="CASCADE"), nullable=False)
    user_answer = Column(Text, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    time_spent = Column(Integer, nullable=True)
