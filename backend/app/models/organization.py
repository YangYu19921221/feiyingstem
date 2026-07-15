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
    status = Column(String(20), default="active", nullable=False) # active/suspended/expired
    expires_at = Column(DateTime, nullable=True)                  # 年费到期,过期→suspended
    created_at = Column(DateTime, server_default=func.now())
