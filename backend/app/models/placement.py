"""
入学摸底测评 - 学生首次确定起点难度
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class PlacementTest(Base):
    """学生摸底测评记录表

    每名学生可多次测评（允许重测），以最新一条 completed/skipped 为准。

    status:
      pending   - 题目已生成，尚未提交
      completed - 学生已完成并提交
      skipped   - 学生跳过测评，自己填了年级

    question_type 两种：
      recognition  看英文单词选正确中文意思（4选1）
      spelling     看中文意思写英文单词（主观填写）
    """
    __tablename__ = "placement_tests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)

    # 状态
    status = Column(String(20), nullable=False, default="pending")

    # 题目快照（生成后不可变）
    # [{word_id, word, phonetic, question_type,
    #   options, correct_index,  <-- recognition 题专用
    #   prompt, correct_answer,  <-- spelling 题专用
    #   difficulty}]
    questions_json = Column(Text, nullable=True)

    # 学生提交的答案
    # [{word_id, question_type, difficulty,
    #   chosen_index,   <-- recognition
    #   typed_answer,   <-- spelling
    #   is_correct}]
    answers_json = Column(Text, nullable=True)

    # 汇总计数
    correct_count = Column(Integer, default=0)
    total_questions = Column(Integer, default=0)

    # 双技能详细画像（JSON）
    # {recognition_accuracy, spelling_accuracy,
    #  solid_through_band, first_gap_band,
    #  band_scores: {"1": 1.0, "2": 0.5, ...},
    #  recommendation}
    skill_profile_json = Column(Text, nullable=True)

    # 答错的词（供老师参考 / 未来预填 CatchupGap）
    # [{word_id, word, meaning, difficulty, question_type}]
    weak_words_json = Column(Text, nullable=True)

    # 答对的高难度词（已预埋 WordMastery，不再从头教）
    # [{word_id, word, difficulty}]
    known_words_json = Column(Text, nullable=True)

    # 推荐起点
    placement_difficulty = Column(Integer, nullable=True)   # 1-5
    placement_label = Column(String(20), nullable=True)     # 小学低段 / … / 高中

    # 跳过时学生自报
    self_reported_level = Column(String(30), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)
