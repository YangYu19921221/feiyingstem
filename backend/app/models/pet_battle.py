"""宠物对战系统 - ORM 模型"""
from sqlalchemy import Column, Integer, String, Boolean, Text, TIMESTAMP, ForeignKey, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class PetBattle(Base):
    """宠物对战记录"""
    __tablename__ = "pet_battles"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 对战双方
    player1_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    player2_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    player1_pet_id = Column(Integer, ForeignKey("user_pets.id"), nullable=False)
    player2_pet_id = Column(Integer, ForeignKey("user_pets.id"), nullable=False)

    # 对战配置
    wordbook_id = Column(Integer, ForeignKey("word_books.id"))
    mode = Column(String(20), default="casual")
    max_rounds = Column(Integer, default=10)
    time_per_question = Column(Integer, default=15)

    # 对战状态
    status = Column(String(20), default="pending")
    current_round = Column(Integer, default=0)

    # 初始属性
    player1_initial_hp = Column(Integer, default=120)
    player2_initial_hp = Column(Integer, default=100)

    # 实时属性
    player1_hp = Column(Integer, default=120)
    player2_hp = Column(Integer, default=100)
    player1_combo = Column(Integer, default=0)
    player2_combo = Column(Integer, default=0)
    player1_ultimate_charges = Column(Integer, default=0)
    player2_ultimate_charges = Column(Integer, default=0)

    # 战斗数据
    questions_data = Column(Text)  # JSON

    # 胜负
    winner_id = Column(Integer, ForeignKey("users.id"))
    player1_total_correct = Column(Integer, default=0)
    player2_total_correct = Column(Integer, default=0)
    player1_total_damage = Column(Integer, default=0)
    player2_total_damage = Column(Integer, default=0)

    # 时间戳
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    started_at = Column(TIMESTAMP)
    finished_at = Column(TIMESTAMP)
    expires_at = Column(TIMESTAMP)
    
    # AI对战相关
    is_ai_battle = Column(Boolean, default=False)
    ai_config = Column(Text)  # JSON格式的AI配置

    # 关系
    player1 = relationship("User", foreign_keys=[player1_id])
    player2 = relationship("User", foreign_keys=[player2_id])
    player1_pet = relationship("UserPet", foreign_keys=[player1_pet_id])
    player2_pet = relationship("UserPet", foreign_keys=[player2_pet_id])
    rounds = relationship("PetBattleRound", back_populates="battle", cascade="all, delete-orphan")


class PetBattleRound(Base):
    """对战回合记录"""
    __tablename__ = "pet_battle_rounds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    battle_id = Column(Integer, ForeignKey("pet_battles.id"), nullable=False)
    round_number = Column(Integer, nullable=False)

    # 题目
    question_word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    question_text = Column(Text, nullable=False)
    options = Column(Text, nullable=False)  # JSON
    correct_answer = Column(String(1), nullable=False)

    # 玩家1答题
    player1_answer = Column(String(1))
    player1_correct = Column(Boolean, default=False)
    player1_submit_time = Column(TIMESTAMP)
    player1_time_ms = Column(Integer)
    player1_damage = Column(Integer, default=0)
    player1_used_ultimate = Column(Boolean, default=False)
    player1_type_multiplier = Column(Float, default=1.0)
    player1_type_text = Column(String(50))

    # 玩家2答题
    player2_answer = Column(String(1))
    player2_correct = Column(Boolean, default=False)
    player2_submit_time = Column(TIMESTAMP)
    player2_time_ms = Column(Integer)
    player2_damage = Column(Integer, default=0)
    player2_used_ultimate = Column(Boolean, default=False)
    player2_type_multiplier = Column(Float, default=1.0)
    player2_type_text = Column(String(50))

    # 回合结果
    player1_hp_after = Column(Integer)
    player2_hp_after = Column(Integer)

    created_at = Column(TIMESTAMP, default=datetime.utcnow)

    # 关系
    battle = relationship("PetBattle", back_populates="rounds")
    word = relationship("Word")


class PetBattleStats(Base):
    """对战统计"""
    __tablename__ = "pet_battle_stats"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)

    # 基础统计
    total_battles = Column(Integer, default=0)
    wins = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    draws = Column(Integer, default=0)

    # 连胜
    current_win_streak = Column(Integer, default=0)
    max_win_streak = Column(Integer, default=0)
    current_lose_streak = Column(Integer, default=0)

    # 战斗数据
    total_damage_dealt = Column(Integer, default=0)
    total_damage_taken = Column(Integer, default=0)
    total_correct_answers = Column(Integer, default=0)
    total_wrong_answers = Column(Integer, default=0)

    # 必杀技
    ultimates_used = Column(Integer, default=0)
    ultimates_landed = Column(Integer, default=0)

    # 特殊成就
    perfect_wins = Column(Integer, default=0)
    comeback_wins = Column(Integer, default=0)

    # 排位分
    rating = Column(Integer, default=1000)
    peak_rating = Column(Integer, default=1000)

    updated_at = Column(TIMESTAMP, default=datetime.utcnow)

    # 关系
    user = relationship("User")
