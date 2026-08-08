"""机构(租户)模型 - 多租户 SaaS

org_id = 1 固定为「雪域飞鹰(直营)」,现有数据全部归属它。
"""
from sqlalchemy import Column, Integer, String, Text, DateTime
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
    created_at = Column(DateTime, server_default=func.now())
