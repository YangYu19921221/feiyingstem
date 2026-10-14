"""家长推荐(老带新)—— 邀请码 / 推荐线索 / 机构推荐设置

口径(2026-10-13 定):
- 邀请码挂在**学生**身上,不挂家长账号: 生产上家长账号为 0,只认家长账号的话功能上线即空转。
  已绑定的家长在家长端拿链接,没绑定的由老师替这个孩子生成,两边是同一个码。
- 奖励只在**老师确认到店报名**后才发(微信规则:不能按「转发」给奖励;
  注册不验手机号,按「留了电话」给奖励会被小号刷)。
- 同一机构同一手机号只认第一个推荐人(先到先得),UNIQUE(org_id, parent_phone) 兜底并发。
- 三张表都**不进** tenancy 锚点注册表: 落地页是公开接口没有机构上下文,
  所有查询在 services/referral.py 里显式写 org_id 条件(CLAUDE.md:别押在隐式过滤器上)。
"""
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base


class ReferralInvite(Base):
    """一个学生一个邀请码(家长端/老师端拿到的是同一个)"""
    __tablename__ = "referral_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(16), unique=True, nullable=False, index=True)
    org_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, unique=True)
    created_by = Column(Integer, nullable=True)  # 生成人(家长或老师)
    created_at = Column(DateTime, server_default=func.now())


class ReferralLead(Base):
    """被推荐的新家庭(落地页提交一条)"""
    __tablename__ = "referral_leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False)
    invite_id = Column(Integer, ForeignKey("referral_invites.id", ondelete="SET NULL"), nullable=True)
    referrer_student_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    parent_name = Column(String(30), nullable=True)
    parent_phone = Column(String(20), nullable=False)
    child_name = Column(String(30), nullable=True)
    child_grade = Column(String(20), nullable=True)
    note = Column(String(200), nullable=True)            # 家长留言(方便联系的时间等)
    # 手机号已是本机构的学生/家长账号:老客户不算拉新,老师确认前列表里会标出来
    existing_account = Column(Boolean, default=False, server_default="0", nullable=False)
    # new 待联系 / contacted 已联系 / trial 已试听 / enrolled 已报名 / invalid 无效
    status = Column(String(12), default="new", server_default="new", nullable=False)
    staff_note = Column(Text, nullable=True)
    enrolled_at = Column(DateTime, nullable=True)
    enrolled_by = Column(Integer, nullable=True)
    # 奖励: none 不发 / pending 待发(线下奖励没兑现)/ granted 已兑现
    reward_status = Column(String(10), default="none", server_default="none", nullable=False)
    reward_coins = Column(Integer, default=0, server_default="0", nullable=False)  # 确认时实发金币(快照)
    reward_text = Column(String(200), nullable=True)     # 确认时的线下奖励说明(快照,机构后来改规则不影响旧单)
    reward_granted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "parent_phone", name="uq_referral_lead_org_phone"),
        Index("idx_referral_lead_org_status", "org_id", "status"),
        Index("idx_referral_lead_referrer", "referrer_student_id"),
    )


class OrgReferralSettings(Base):
    """机构推荐设置。没有行 = 用默认值(开启、不发金币、没写线下奖励)。
    单独一张表而不是 organizations 加列: 新表由 create_all 建,生产不用 ALTER(database.py 有 drift)"""
    __tablename__ = "org_referral_settings"

    org_id = Column(Integer, primary_key=True)
    enabled = Column(Boolean, default=True, server_default="1", nullable=False)
    reward_coins = Column(Integer, default=0, server_default="0", nullable=False)   # 推荐成功给老生的金币
    reward_text = Column(String(200), nullable=True)   # 推荐成功给老生家庭的线下奖励(如「赠 2 节课」)
    friend_offer = Column(String(200), nullable=True)  # 新朋友能得到什么(落地页显示,如「免费测评 + 体验课 1 节」)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
