"""
竞赛系统数据模型
"""
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey, DECIMAL, Date, CheckConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class CompetitionSeason(Base):
    """竞赛赛季"""
    __tablename__ = "competition_seasons"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    season_type = Column(String(20), nullable=False, default='daily')
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.now)

    # 关系
    user_scores = relationship("UserScore", back_populates="season", cascade="all, delete-orphan")
    answer_records = relationship("AnswerRecord", back_populates="season", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("season_type IN ('daily', 'weekly', 'monthly', 'special')", name="check_season_type"),
    )


class UserScore(Base):
    """用户积分"""
    __tablename__ = "user_scores"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    season_id = Column(Integer, ForeignKey("competition_seasons.id", ondelete="CASCADE"), nullable=False)

    # 积分
    total_score = Column(Integer, default=0)
    daily_score = Column(Integer, default=0)
    weekly_score = Column(Integer, default=0)
    monthly_score = Column(Integer, default=0)

    # 连击
    current_combo = Column(Integer, default=0)
    max_combo = Column(Integer, default=0)

    # 统计
    questions_answered = Column(Integer, default=0)
    correct_count = Column(Integer, default=0)
    accuracy_rate = Column(DECIMAL(5, 2), default=0.00)

    # 排名
    rank_daily = Column(Integer)
    rank_weekly = Column(Integer)
    rank_overall = Column(Integer)

    # 时间
    last_answer_time = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系
    user = relationship("User", back_populates="scores")
    season = relationship("CompetitionSeason", back_populates="user_scores")


class AnswerRecord(Base):
    """答题记录"""
    __tablename__ = "answer_records"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    season_id = Column(Integer, ForeignKey("competition_seasons.id", ondelete="CASCADE"), nullable=False)

    # 题目信息
    question_type = Column(String(20), nullable=False, default='choice')
    is_correct = Column(Boolean, nullable=False)
    time_spent = Column(Integer, nullable=False)  # 毫秒

    # 分数构成
    base_score = Column(Integer, default=10)
    difficulty_bonus = Column(Integer, default=0)
    speed_bonus = Column(Integer, default=0)
    combo_bonus = Column(Integer, default=0)
    first_time_bonus = Column(Integer, default=0)
    total_score = Column(Integer, nullable=False)

    # 连击
    combo_count = Column(Integer, default=0)
    is_first_correct = Column(Boolean, default=False)

    # 时间
    created_at = Column(DateTime, default=datetime.now)

    # 关系
    user = relationship("User")
    word = relationship("Word")
    season = relationship("CompetitionSeason", back_populates="answer_records")

    __table_args__ = (
        CheckConstraint("question_type IN ('choice', 'spelling', 'fill_blank', 'listening')",
                       name="check_question_type"),
    )


class UnitChallenge(Base):
    """单元挑战赛"""
    __tablename__ = "unit_challenges"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)
    name = Column(String(100), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)
    max_participants = Column(Integer, default=1000)
    entry_fee = Column(Integer, default=0)
    reward_config = Column(Text)  # JSON格式
    created_at = Column(DateTime, default=datetime.now)

    # 关系
    rankings = relationship("ChallengeRanking", back_populates="challenge", cascade="all, delete-orphan")


class ChallengeRanking(Base):
    """挑战赛排名"""
    __tablename__ = "challenge_rankings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    challenge_id = Column(Integer, ForeignKey("unit_challenges.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    score = Column(Integer, default=0)
    rank = Column(Integer)
    questions_answered = Column(Integer, default=0)
    correct_count = Column(Integer, default=0)
    completion_time = Column(Integer)  # 秒

    joined_at = Column(DateTime, default=datetime.now)
    last_update = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系
    challenge = relationship("UnitChallenge", back_populates="rankings")
    user = relationship("User")


class LeaderboardSnapshot(Base):
    """排行榜快照"""
    __tablename__ = "leaderboard_snapshots"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    season_id = Column(Integer, ForeignKey("competition_seasons.id", ondelete="CASCADE"), nullable=False)
    snapshot_type = Column(String(20), nullable=False, default='daily')
    snapshot_date = Column(Date, nullable=False)
    rankings = Column(Text, nullable=False)  # JSON格式
    created_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        CheckConstraint("snapshot_type IN ('daily', 'weekly', 'monthly')",
                       name="check_snapshot_type"),
    )


class CompetitionQuestion(Base):
    """竞赛题库"""
    __tablename__ = "competition_questions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # 基本信息
    question_type = Column(String(20), nullable=False)  # choice, fill_blank, spelling, reading
    title = Column(Text)  # 题目标题(阅读理解用)
    content = Column(Text, nullable=False)  # 题目内容/题干
    passage = Column(Text)  # 阅读理解文章

    # 答案相关
    correct_answer = Column(Text, nullable=False)  # 正确答案(JSON格式)
    answer_explanation = Column(Text)  # 答案解析

    # 元数据
    difficulty = Column(String(20), default='medium')  # easy, medium, hard
    word_id = Column(Integer, ForeignKey("words.id", ondelete="SET NULL"))
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="SET NULL"))
    tags = Column(String(255))  # 标签(逗号分隔)

    # 创建信息
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(20), default='manual')  # manual(手动), ai(AI生成)
    is_active = Column(Boolean, default=True)  # 是否启用

    # 统计
    use_count = Column(Integer, default=0)  # 使用次数
    correct_count = Column(Integer, default=0)  # 答对次数
    total_attempts = Column(Integer, default=0)  # 总答题次数
    avg_time = Column(Integer, default=0)  # 平均答题时间(秒)

    # 时间戳
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系
    options = relationship("CompetitionQuestionOption", back_populates="question", cascade="all, delete-orphan")
    word = relationship("Word")
    creator = relationship("User")

    __table_args__ = (
        CheckConstraint("question_type IN ('choice', 'fill_blank', 'spelling', 'reading')",
                       name="check_competition_question_type"),
        CheckConstraint("difficulty IN ('easy', 'medium', 'hard')",
                       name="check_competition_difficulty"),
        CheckConstraint("source IN ('manual', 'ai')",
                       name="check_competition_source"),
    )


class CompetitionQuestionOption(Base):
    """题目选项"""
    __tablename__ = "competition_question_options"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    question_id = Column(Integer, ForeignKey("competition_questions.id", ondelete="CASCADE"), nullable=False)
    option_key = Column(String(10), nullable=False)  # A, B, C, D
    option_text = Column(Text, nullable=False)
    is_correct = Column(Boolean, default=False)
    display_order = Column(Integer, default=0)

    # 关系
    question = relationship("CompetitionQuestion", back_populates="options")


class CompetitionQuestionSet(Base):
    """题目集合"""
    __tablename__ = "competition_question_sets"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    total_questions = Column(Integer, default=0)
    is_public = Column(Boolean, default=False)  # 是否公开
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    # 关系
    items = relationship("QuestionSetItem", back_populates="question_set", cascade="all, delete-orphan")
    creator = relationship("User")


class QuestionSetItem(Base):
    """题目集合关联"""
    __tablename__ = "question_set_items"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    set_id = Column(Integer, ForeignKey("competition_question_sets.id", ondelete="CASCADE"), nullable=False)
    question_id = Column(Integer, ForeignKey("competition_questions.id", ondelete="CASCADE"), nullable=False)
    display_order = Column(Integer, default=0)

    # 关系
    question_set = relationship("CompetitionQuestionSet", back_populates="items")
    question = relationship("CompetitionQuestion")
