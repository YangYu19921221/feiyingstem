"""地推体验卡 —— 销售 / 卡码 / 线索 / 跟进记录(2026-10-23)

用户原话: 「地推扫码进群然后送我们的卡片,还需要是谁发出去的卡…需要销售跟单」「我有多个销售」。

结构(一句话): **一版卡 = 一个卡码(PromoChannel),卡码挂在一个销售名下**。
- 卡上印的是 /c/{卡码} 这个固定网址,不是群二维码 —— 群码 7 天过期、满 200 人扫不进,
  印出去的卡不能跟着换;扫码后显示什么(销售个人微信 / 群码)由销售自己在后台随时换(活码)。
- 一个销售可以有几版卡(不同学校门口分开印,看哪个点出线索);销售离职把卡码「转交」给别人,
  已经印出去的卡照样能用,之后的线索归新销售。
- 线索归属按「留电话那一刻卡码在谁名下」落 sales_user_id,之后只有机构管理员能改归属。
- 同一机构同一手机号只认第一张卡(UNIQUE),后扫的回显第一个销售的二维码,不新建线索 —— 防销售互相抢单。

四张表都是新表(create_all 建,不要 ALTER),**不进 tenancy 锚点**: 落地页公开无鉴权,
所有查询在 services/promo.py 里显式写 org_id(CLAUDE.md: 别押在隐式过滤器上)。
"""
from sqlalchemy import (
    Column, DateTime, ForeignKey, Index, Integer, String, Text, Boolean, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base


class PromoSalesProfile(Base):
    """销售的「扫码后显示什么」。一个销售一行;账号本身是 users 里 role='sales' 的那一行"""
    __tablename__ = "promo_sales_profiles"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    # 扫码后给家长看的二维码(个人微信 / 群码),公开图片,落 UPLOAD_DIR/promo-qr
    qr_image_url = Column(String(500), nullable=True)
    # wechat = 个人微信码(长期有效)/ group = 微信群码(7 天过期,要提醒换)
    qr_kind = Column(String(10), nullable=True)
    wechat_hint = Column(String(60), nullable=True)   # 二维码下面那句话,如「加我微信,拉您进体验群」
    qr_updated_at = Column(DateTime, nullable=True)   # 群码 7 天过期,超过 6 天没换在后台标黄提醒
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PromoChannel(Base):
    """一版卡(一个卡码)。卡上的二维码 = {站点}/c/{code}"""
    __tablename__ = "promo_channels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True)
    code = Column(String(16), unique=True, nullable=False, index=True)
    name = Column(String(60), nullable=False)          # 如「王老师 · 实验小学门口」
    sales_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, server_default="1", nullable=False)
    view_count = Column(Integer, default=0, server_default="0", nullable=False)  # 落地页打开次数(粗略,不去重)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PromoLead(Base):
    """扫卡留电话的家庭"""
    __tablename__ = "promo_leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False)
    channel_id = Column(Integer, ForeignKey("promo_channels.id", ondelete="SET NULL"), nullable=True)
    sales_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    parent_phone = Column(String(20), nullable=False)
    parent_name = Column(String(30), nullable=True)
    child_grade = Column(String(20), nullable=True)
    # 手机号已是本机构学生/家长账号 = 老客户(可能给二孩报名),不拦,列表里标出来
    existing_account = Column(Boolean, default=False, server_default="0", nullable=False)
    # new 待联系 / contacted 已加微信 / paid 已付体验费 / opened 已开通 / won 已报正价 / lost 无效
    status = Column(String(12), default="new", server_default="new", nullable=False)
    note = Column(Text, nullable=True)                 # 销售自己的备注(孩子情况、家长顾虑)
    next_follow_at = Column(DateTime, nullable=True)   # 下次跟进(过了还没跟 = 逾期,列表标红)
    paid_amount = Column(Integer, nullable=True)       # 实收体验费(元),标「已付」时记
    # 各阶段第一次到达的时间: 漏斗按它数(流失的线索也算它走到过哪一步),只写不清
    contacted_at = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    won_at = Column(DateTime, nullable=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # 开通后关联的学生号
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "parent_phone", name="uq_promo_lead_org_phone"),
        Index("idx_promo_lead_sales_status", "sales_user_id", "status"),
        Index("idx_promo_lead_org_created", "org_id", "created_at"),
    )


class PromoOrgSettings(Base):
    """机构的体验卡设置。没有行 = 默认(体验价 99 元、默认介绍语)。
    单开一张表不往 organizations 加列: 新表 create_all 就建,生产不用 ALTER(database.py 有 drift)"""
    __tablename__ = "promo_org_settings"

    org_id = Column(Integer, primary_key=True)
    trial_price = Column(Integer, nullable=True)       # 体验价(元),落地页显示;NULL = 默认 99
    offer_text = Column(String(200), nullable=True)    # 落地页「体验包含」上面那句话
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PromoFollowUp(Base):
    """跟进记录(时间线)。改不了也删不了 —— 出纠纷(谁答应了什么)要有据"""
    __tablename__ = "promo_follow_ups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("promo_leads.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    status_after = Column(String(12), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_by_name = Column(String(50), nullable=True)  # 冗余存名字: 销售账号删了时间线不残缺
    created_at = Column(DateTime, server_default=func.now())
