from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum, Text, Date, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base
import enum

class UserRole(str, enum.Enum):
    """用户角色"""
    ADMIN = "admin"      # 管理员
    TEACHER = "teacher"  # 教师
    STUDENT = "student"  # 学生

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    role = Column(String(20), default=UserRole.STUDENT)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String(255))

    # 等级和经验值系统
    level = Column(Integer, default=1)  # 用户等级
    experience_points = Column(Integer, default=0)  # 经验值
    total_points = Column(Integer, default=0)  # 总积分

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    last_login = Column(DateTime)

    # 关系
    scores = relationship("UserScore", back_populates="user")


class Achievement(Base):
    """成就表"""
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    icon = Column(String(100))  # 图标或emoji
    condition_type = Column(String(50))  # 条件类型: total_words, consecutive_days, accuracy_rate, perfect_score
    condition_value = Column(Integer)  # 条件值
    reward_points = Column(Integer, default=10)  # 奖励积分


class UserAchievement(Base):
    """用户成就关联表"""
    __tablename__ = "user_achievements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    achievement_id = Column(Integer, ForeignKey('achievements.id', ondelete='CASCADE'), nullable=False)
    unlocked_at = Column(DateTime, server_default=func.now())


class StudyCalendar(Base):
    """学习日历(打卡记录)"""
    __tablename__ = "study_calendar"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    study_date = Column(Date, nullable=False)
    words_learned = Column(Integer, default=0)
    duration = Column(Integer, default=0)  # 学习时长(秒)
