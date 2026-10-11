"""句子背诵学习数据(2026-10-11)。

句子与单词是两套内容树(sentence_books → sentence_units → sentences),而 learning_records /
word_mastery / learning_progress 全部外键到 words / units,存不了句子 → 这里单开两张表。

- SentenceMastery: 一人一句一行,计数 + 掌握度 + 记忆曲线排期(阶梯与间隔复用 services/mastery,
  不另写一套)。**只记「第一次作答」**: 前端每句每阶段只上报首答,重练轮不报 —— 与分类学习的听写同口径
- SentenceUnitProgress: 一人一单元一行,记已过关到第几组,给「断点续学」用
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class SentenceMastery(Base):
    __tablename__ = "sentence_mastery"
    # 并发首插同一 (user, sentence) 靠唯一约束 + ON CONFLICT DO NOTHING 占位(word_mastery 缺约束吃过永久 500)
    __table_args__ = (UniqueConstraint("user_id", "sentence_id", name="uq_sentence_mastery_user_sentence"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sentence_id = Column(Integer, ForeignKey("sentences.id", ondelete="CASCADE"), nullable=False, index=True)

    total_encounters = Column(Integer, default=0, nullable=False)
    correct_count = Column(Integer, default=0, nullable=False)
    wrong_count = Column(Integer, default=0, nullable=False)
    mastery_level = Column(Integer, default=0, nullable=False)    # 0-5,阶梯同 mastery.level_for
    review_stage = Column(Integer, default=0, server_default="0", nullable=False)
    next_review_at = Column(DateTime, nullable=True, index=True)
    last_practiced_at = Column(DateTime, nullable=True)
    last_wrong_answer = Column(String(500), nullable=True)        # 默写/填空最近一次写错的原文,给老师看错在哪


class SentenceUnitProgress(Base):
    __tablename__ = "sentence_unit_progress"
    __table_args__ = (UniqueConstraint("user_id", "unit_id", name="uq_sentence_unit_progress"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    unit_id = Column(Integer, ForeignKey("sentence_units.id", ondelete="CASCADE"), nullable=False)
    groups_passed = Column(Integer, default=0, nullable=False)    # 已过关的组数(组按服务端切法,见 sentence_service.split_groups)
    best_score = Column(Integer, default=0, nullable=False)       # 最近一次过关检测分数
    completed_at = Column(DateTime, nullable=True)                # 全部组过关的时间(重学不清)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
