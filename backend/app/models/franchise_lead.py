"""加盟意向线索(平台管理端)

意向客户咨询加盟 → 管理员录入线索 → 跟进流转 → 签约后可关联开出的机构。
纯平台级数据(admin-only),不带 org_id 锚点、不进 tenancy 过滤。
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class FranchiseLead(Base):
    """加盟意向线索"""
    __tablename__ = "franchise_leads"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 基本信息
    name = Column(String(50), nullable=False)          # 客户姓名/称呼
    phone = Column(String(20), nullable=True, index=True)
    wechat = Column(String(50), nullable=True)
    email = Column(String(100), nullable=True)

    # 意向画像
    province = Column(String(30), nullable=True)       # 意向省份
    city = Column(String(50), nullable=True)           # 意向城市/区县
    channel = Column(String(30), nullable=True)        # 来源渠道: phone/wechat/website/referral/douyin/exhibition/other
    intent_level = Column(String(10), nullable=True)   # 意向等级: high/medium/low
    budget = Column(String(50), nullable=True)         # 预算范围(自由文本,如 "10-20万")
    background = Column(Text, nullable=True)           # 从业背景(是否做过教培/现有机构/资源)
    has_location = Column(Boolean, nullable=True)      # 是否已有场地(NULL=未知)
    expected_launch = Column(String(50), nullable=True)  # 计划启动时间(自由文本,如 "今年9月")

    # 跟进流转
    # new 新咨询 / contacted 已联系 / materials_sent 已发资料 / negotiating 洽谈中
    # / visited 已考察 / signed 已签约 / lost 已流失
    status = Column(String(20), nullable=False, default="new", server_default="new", index=True)
    lost_reason = Column(String(200), nullable=True)   # 流失原因(status=lost 时填)
    owner_name = Column(String(50), nullable=True)     # 跟进人(自由文本,平台管理员可能不止一人)
    next_follow_at = Column(DateTime, nullable=True)   # 下次跟进时间(逾期提醒用)
    signed_at = Column(DateTime, nullable=True)        # 签约时间(status 改 signed 时自动记)
    # 签约后关联开出的机构(organizations.id):打通「线索→机构」转化链
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)

    notes = Column(Text, nullable=True)                # 备注

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class FranchiseLeadFollowUp(Base):
    """线索跟进记录(时间线)"""
    __tablename__ = "franchise_lead_follow_ups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("franchise_leads.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    method = Column(String(20), nullable=True)         # 跟进方式: phone/wechat/meeting/visit/other
    content = Column(Text, nullable=False)             # 跟进内容
    status_after = Column(String(20), nullable=True)   # 本次跟进后线索状态(留痕:何时推进到哪一步)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String(50), nullable=True)  # 冗余存名字,管理员账号删了时间线不残缺
    created_at = Column(DateTime, server_default=func.now())
