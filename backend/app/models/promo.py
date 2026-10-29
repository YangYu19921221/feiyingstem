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
    JSON, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, Boolean, UniqueConstraint,
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
    # 实收体验费(元,最多两位小数,如 9.9),标「已付」时记。10-24 由 Integer 改 Float: 生产表是 INTEGER 亲和列,
    # SQLite 照样原样存 9.9(存成 REAL),不用 ALTER;读出来统一走 services/promo.money() 规整
    paid_amount = Column(Float, nullable=True)
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


class PromoCardDesign(Base):
    """一版卡的卡面: 选哪套模板 + 卡上印的老师名字和电话(2026-10-23,用户「老师可以在上面自定义加自己的号码和选不同的模版,
    这样就不会拿错卡片」)。没有行 = 默认模板 t01、名字取销售姓名、电话取销售账号手机号。
    单开一张表不往 promo_channels 加列: 那张表 10-23 已上线,create_all 不会给已有表补列,加列要 ALTER(database.py 有 drift)"""
    __tablename__ = "promo_card_designs"

    channel_id = Column(Integer, ForeignKey("promo_channels.id", ondelete="CASCADE"), primary_key=True)
    template_id = Column(String(8), nullable=True)      # t01..t20,真源 services/promo.TEMPLATE_IDS(前端 data/promoTemplates.ts 同值)
    display_name = Column(String(20), nullable=True)    # 卡上印的「王老师」;NULL = 销售姓名
    display_phone = Column(String(20), nullable=True)   # 卡上印的电话;NULL = 销售账号手机号,空串 = 不印
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PromoOrgSettings(Base):
    """机构的体验卡设置。没有行 = 默认(体验价 99 元、默认介绍语)。
    单开一张表不往 organizations 加列: 新表 create_all 就建,生产不用 ALTER(database.py 有 drift)"""
    __tablename__ = "promo_org_settings"

    org_id = Column(Integer, primary_key=True)
    trial_price = Column(Float, nullable=True)         # 体验价(元,最多两位小数,如 9.9);NULL = 默认 99。同上由 Integer 改来
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


# ---------------- 体验期 + 老带新延期(2026-10-29) ----------------
# 用户原话: 「地推体验卡如果家长分享一个用户报名了就增加 7 天,2 个 14 天以此增加,并且分享的用户报名付费了才有效」。
# 以前「已开通」只是线索上的一个状态,孩子的书是老师手动分配的永久授权,7 天到期全靠人记,
# 「+7 天」没地方加。现在开通体验 = 按包月卡的口径开限期授权(book_assignments.grant_type='period'),
# 到期日由 services/promo.trial_expiry 一处算。三张都是新表(create_all 建,不 ALTER),不进 tenancy 锚点。


class PromoTrial(Base):
    """一条线索开的 7 天体验(一个学生号只能有一份)。
    book_ids = **这份体验自己开出来、还在管的**那几本书: 学生本来就有的书不碰也不管;
    之后被兑换码续期 / 升级永久 / 老师改过的(到期日和 expires_at 对不上)就不再管,从这里去掉"""
    __tablename__ = "promo_trials"

    lead_id = Column(Integer, ForeignKey("promo_leads.id", ondelete="CASCADE"), primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    book_ids = Column(JSON, nullable=False, default=list)
    started_at = Column(DateTime, nullable=False)        # 开通时刻(UTC naive);按它的北京日起算 7 天
    # 退款 / 删线索让到期日往前缩时,孩子今天正在学 → 保底到今天 24 点(只在那一刻写一次,之后不再按当前时间推)
    floor_until = Column(DateTime, nullable=True)
    # 体验已经到期之后才有朋友付费: 「从今天起再给 7 天」,中间空着没学的那几天记在这里(只加不减),
    # 否则 11-05 到期、11-10 才算进来的那 7 天只剩 11-10 到 11-12 两天
    gap_days = Column(Integer, nullable=False, default=0, server_default="0")
    expires_at = Column(DateTime, nullable=False)        # 最近一次写到授权行上的到期时间
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PromoLeadLink(Base):
    """线索的推荐关系。一条线索一行(需要时才建):
    - 作为推荐人: share_code(朋友扫的链接 /c/{卡码}?f={share_code})+ view_code(家长自己看进度的页面)。
      两个码分开: 分享链接会转给朋友,进度页里有别的朋友的手机尾号和孩子的体验日期,不该朋友也能看
    - 作为被推荐的朋友: referred_by_lead_id + credited_at(付了体验费、算进推荐人的那一刻)+ revoked_at(退款,只写不清)"""
    __tablename__ = "promo_lead_links"

    lead_id = Column(Integer, ForeignKey("promo_leads.id", ondelete="CASCADE"), primary_key=True)
    org_id = Column(Integer, nullable=False)
    share_code = Column(String(16), nullable=True, unique=True)
    view_code = Column(String(16), nullable=True, unique=True)
    # referred = 这条线索是点朋友的链接来的;referred_by_lead_id = 推荐人那条线索。推荐人线索删了置 NULL、referred 留着
    # (显示「(推荐人已删除)」)—— 不能留着旧 id: promo_leads 的 id 会被 SQLite 回收给新线索,旧 id 会指到别人身上
    referred = Column(Boolean, nullable=False, default=False, server_default="0")
    referred_by_lead_id = Column(Integer, nullable=True, index=True)
    credited_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PromoReferralSettings(Base):
    """机构的老带新设置。没有行 = 开着、最多算 4 家。
    上限的原因: 每多一家就要多陪跑 7 天,一直在体验的孩子也不会去报正价"""
    __tablename__ = "promo_referral_settings"

    org_id = Column(Integer, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True, server_default="1")
    max_count = Column(Integer, nullable=False, default=4, server_default="4")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
