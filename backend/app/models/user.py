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

class RedemptionCodeStatus(str, enum.Enum):
    """兑换码状态"""
    UNUSED = "unused"      # 未使用
    USED = "used"          # 已使用
    EXPIRED = "expired"    # 已过期
    DISABLED = "disabled"  # 已禁用

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    phone = Column(String(20), unique=True, nullable=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    role = Column(String(20), default=UserRole.STUDENT)
    is_active = Column(Boolean, default=True)
    avatar_url = Column(String(255))

    # 等级和经验值系统
    level = Column(Integer, default=1)  # 用户等级
    experience_points = Column(Integer, default=0)  # 经验值
    total_points = Column(Integer, default=0)  # 总积分

    # 订阅到期时间（仅学生需要）
    subscription_expires_at = Column(DateTime, nullable=True)

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


class Class(Base):
    """班级表"""
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    teacher_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # 关系
    students = relationship("ClassStudent", back_populates="class_")


class ClassStudent(Base):
    """班级-学生关联表"""
    __tablename__ = "class_students"

    id = Column(Integer, primary_key=True, autoincrement=True)
    class_id = Column(Integer, ForeignKey('classes.id', ondelete='CASCADE'), nullable=False)
    student_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    joined_at = Column(DateTime, server_default=func.now())

    # 关系
    class_ = relationship("Class", back_populates="students")


class RedemptionCode(Base):
    """兑换码表"""
    __tablename__ = "redemption_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(19), unique=True, nullable=False, index=True)  # XXXX-XXXX-XXXX-XXXX
    book_id = Column(Integer, ForeignKey('word_books.id'), nullable=False)  # 绑定的单词本ID
    status = Column(String(20), default=RedemptionCodeStatus.UNUSED)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    code_expires_at = Column(DateTime, nullable=False)  # 兑换码本身过期时间
    used_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    used_at = Column(DateTime, nullable=True)
    batch_note = Column(String(200), nullable=True)  # 批次备注
