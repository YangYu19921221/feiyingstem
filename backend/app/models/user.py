from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum, Text, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base
import enum

class UserRole(str, enum.Enum):
    """用户角色"""
    ADMIN = "admin"          # 平台管理员(总部,跨机构)
    ORG_ADMIN = "org_admin"  # 机构管理员(加盟商老板,只管本机构)
    TEACHER = "teacher"      # 教师
    STUDENT = "student"      # 学生
    PARENT = "parent"        # 家长

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
    org_id = Column(Integer, nullable=False, default=1, server_default="1")  # 所属机构(多租户),1=直营;索引由init_db迁移建
    is_active = Column(Boolean, default=True)
    # 顶号机制: 会话版本号。范围内账号(学生/体验机构全角色)每次登录 +1 并写进
    # JWT 的 sv,认证时不符=被顶下线(后登录踢先登录)。范围外角色恒 0 且 token 不带 sv
    session_ver = Column(Integer, nullable=False, default=0, server_default="0")
    avatar_url = Column(String(255))
    # 加币 PIN(bcrypt 哈希,可空=未设)。教师手动加币需校验,防学生冒用老师账号自己加币
    coin_pin_hash = Column(String(255), nullable=True)

    # 等级和经验值系统
    level = Column(Integer, default=1)  # 用户等级
    experience_points = Column(Integer, default=0)  # 经验值
    total_points = Column(Integer, default=0)  # 总积分

    # 最后一只宠物被对手收服后，需在此绝对词数目标上重新解锁领养。
    pet_recovery_goal_words = Column(Integer, nullable=True)
    pet_food_reserve = Column(Integer, nullable=True)

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


class DailyCheckin(Base):
    """每日签到:学生每天使用平台前先签到(教师端可查签到列表)"""
    __tablename__ = "daily_checkins"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    checkin_date = Column(Date, nullable=False)               # 北京日历日
    checkin_at = Column(DateTime, server_default=func.now())  # 具体签到时刻(UTC)

    __table_args__ = (
        UniqueConstraint('user_id', 'checkin_date', name='uq_user_checkin_date'),
    )


class StudyCalendar(Base):
    """学习日历(打卡记录)"""
    __tablename__ = "study_calendar"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    study_date = Column(Date, nullable=False)
    words_learned = Column(Integer, default=0)
    duration = Column(Integer, default=0)  # 学习时长(秒)
    switch_count = Column(Integer, default=0, server_default="0")  # 当日切屏次数(离开学习页面)
    distracted_count = Column(Integer, default=0, server_default="0")  # 当日发呆次数(60秒无操作被全屏提醒)


class Class(Base):
    """班级表"""
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    teacher_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")  # 冗余自 teacher.org_id(多租户);索引由init_db迁移建
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
    is_active = Column(Boolean, default=True, nullable=False)  # 是否仍在班级中
    joined_at = Column(DateTime, server_default=func.now())
    left_at = Column(DateTime, nullable=True)  # 离开班级时间

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

    # ===== 卡种(2026-08-21) =====
    # permanent=永久(旧行为,默认) / period=包月按天数计时 / times=次卡按「学习天」计次
    grant_type = Column(String(10), nullable=False, default="permanent", server_default="permanent")
    grant_days = Column(Integer, nullable=True)    # period: 有效天数(如 30/90)
    grant_times = Column(Integer, nullable=True)   # times: 可用天数(次数)

    # ===== 一码多书(2026-08-29) =====
    # 真实覆盖范围在 redemption_code_books 明细表,这三列只用于**展示与追溯**
    # (列表里显示「人教版·小学 14 本」、事后查这批码当初是按什么条件发的),
    # 不参与判活、不参与兑换逻辑 —— 判活一律逐本走 book_assignments。
    # book_id 保留且继续写主书,存量 1133 行不动、旧代码路径不炸。
    scope_kind = Column(String(10), nullable=False, default="book", server_default="book")  # book | group
    scope_series = Column(String(30), nullable=True)   # 发码时选的单词本分组
    scope_stage = Column(String(10), nullable=True)    # 发码时选的学段(见 services/book_stage)

    books = relationship(
        "RedemptionCodeBook", back_populates="code",
        cascade="all, delete-orphan", lazy="selectin",
    )


class RedemptionCodeBook(Base):
    """一张兑换码覆盖的单词本明细(一码多书)。

    单书码 = 这里 1 行,与多书码同构,兑换逻辑不必分叉。
    学生兑换时按**这张表的当时内容**逐本发授权(= 兑换时快照):
    之后往该分组新加的书,已兑换的学生拿不到 —— 2026-08-29 用户明确选的语义,
    避免权益边界随运营上架而无声膨胀。
    """
    __tablename__ = "redemption_code_books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code_id = Column(Integer, ForeignKey('redemption_codes.id', ondelete='CASCADE'),
                     nullable=False, index=True)
    book_id = Column(Integer, ForeignKey('word_books.id'), nullable=False)

    code = relationship("RedemptionCode", back_populates="books")

    __table_args__ = (
        UniqueConstraint('code_id', 'book_id', name='uq_code_book'),
    )


class ParentStudentLink(Base):
    """家长-学生绑定表（一对多：一个家长可绑多个孩子，一个孩子可被多家长绑）"""
    __tablename__ = "parent_student_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    parent_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    bound_at = Column(DateTime, server_default=func.now())


class ParentBindCode(Base):
    """家长绑定临时码（学生生成 → 家长输入注册）"""
    __tablename__ = "parent_bind_codes"

    code = Column(String(8), primary_key=True)
    student_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class ClassInviteCode(Base):
    """班级邀请码（教师生成 → 学生输入加入班级）

    设计：
    - 一个班级只保留 1 条 active 码（重复生成会替换）
    - 24 小时有效，过期自动失效（不删除，仅作历史记录）
    - 一次性兑换码（学生兑换会增量加入；不限领取人数前不标 used_at）
    """
    __tablename__ = "class_invite_codes"

    code = Column(String(8), primary_key=True)
    class_id = Column(Integer, ForeignKey('classes.id', ondelete='CASCADE'), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    redemption_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
