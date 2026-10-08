"""机构(租户)模型 - 多租户 SaaS

org_id = 1 固定为「雪域飞鹰(直营)」,现有数据全部归属它。
"""
from sqlalchemy import Column, Float, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class Organization(Base):
    """机构(租户)表"""
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)                    # 机构名称
    code = Column(String(16), unique=True, nullable=False, index=True)  # 机构码(注册/测评链接用,如 KM001)
    plan = Column(String(20), default="standard")                 # trial/standard/county/city(加盟档位)
    student_quota = Column(Integer, default=100)                  # 学生账号配额(标准档100)
    # 学习卡额度(2026-09-11): 已购学习卡**张数**,与 student_quota 是两笔账 ——
    # student_quota 管「同时在读多少人」(可复用: 学生毕业离班就腾出名额),
    # card_quota 管「买过多少张半年卡」(一次性消耗: 同一学生学一年要两张)。
    #
    # ⚠️ 为什么必须分开: 机构改成只能发半年卡之后,发码上限若仍与学生名额对等,
    # 配额 100 的机构发到第 100 张就再也发不出**续卡** —— 学生半年到期即断档,
    # 而协议明确允许续卡(50 张起)。实测确认过这个锁死(发 2/2 后续卡 403)。
    #
    # NULL = 未单独设置,回退成 student_quota(存量机构零影响,见 org_service.card_quota_of)。
    card_quota = Column(Integer, nullable=True)
    ai_quota_json = Column(Text, nullable=True)                   # AI限额覆盖配置(NULL=全局默认)
    contact_name = Column(String(50))
    contact_phone = Column(String(20))
    logo_url = Column(String(500), nullable=True)             # 机构Logo(机构管理端可自传)
    status = Column(String(20), default="active", nullable=False) # active/suspended/expired
    expires_at = Column(DateTime, nullable=True)                  # 年费到期,过期→suspended
    # 内容授权模式: assigned=逐本分配(默认,老师分配/兑换码开书) |
    # all_books=全托(按 expires_at+student_quota 收费,书本全开放不再逐本限制)
    access_mode = Column(String(20), default="assigned", nullable=False)
    # 金币发放模式: auto=系统按规则自动发(默认) | manual=只能老师核实后手动加。
    # 关成 manual 后自动结算跳过该机构,已发的币不回收(见 services/coin_service.py)
    coin_mode = Column(String(10), default="auto", server_default="auto", nullable=False)
    # 音标视频访问模式(2026-10-01): open=免费开放(默认,=上线前的行为,零影响) |
    # code=需音标专用兑换码。置 code 后,学生必须有生效的 PhoneticAccessGrant 才能拿
    # 播放票据(见 api/v1/phonetics.py 的闸门);老师/管理员永不受限。
    # ⚠️ 机构应**先备好码再翻 code**,否则学生当场全被挡在外面
    phonetic_access_mode = Column(String(10), default="open", server_default="open", nullable=False)
    # 音标兑换码额度(2026-10-02): 平台给机构发放的「可生成多少张音标码」。
    # NULL/0 = 平台还没给额度 → 机构不能自己发音标码(只能用平台发的)。
    # **不回退 student_quota**(与 card_quota 不同): 音标库是另卖的内容,不是合作费自带的。
    # 口径真源 org_service.phonetic_code_quota_status
    phonetic_code_quota = Column(Integer, nullable=True)
    # 卡政策(2026-10-08): legacy=老政策(一个总数 card_quota,存量机构全是它,零影响) |
    # pack=新政策(按卡种分档进货、按期到账开额度,见 services/card_pack.py)。
    # 模型默认 legacy,只有「开通新机构」接口显式写 pack —— 体验机构等其它建行路径不受影响
    card_plan = Column(String(10), default="legacy", server_default="legacy", nullable=False)
    # 区域保护(协议第四条): 经营场所地址与坐标 + 独家半径。
    # 坐标为空 = 未登记,不参与冲突判定也不受保护(存量机构默认如此,零影响)。
    # 判定与口径见 services/geo_service.py
    address = Column(String(255), nullable=True)                  # 经营场所详细地址(写进协议那一栏)
    # ⚠️ 坐标系要前后一致: 高德/腾讯是 GCJ02,GPS/谷歌是 WGS84,两者在国内偏移可达约 500 米。
    # 混着录会让 3 公里边界上的判定偏一截。统一从高德复制(GCJ02),别一半 GPS 一半地图
    lat = Column(Float, nullable=True)                            # 纬度
    lng = Column(Float, nullable=True)                            # 经度
    protect_radius_km = Column(Float, nullable=True)              # 独家半径(NULL=默认 3 公里,县级/市级可放宽)
    created_at = Column(DateTime, server_default=func.now())
