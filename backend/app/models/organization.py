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
