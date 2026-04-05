"""
测评漏斗 - 匿名测评线索模型
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class AssessmentLead(Base):
    """匿名测评线索表"""
    __tablename__ = "assessment_leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), unique=True, nullable=False, index=True)
    grade_level = Column(String(20))  # 小学/初中/高中

    # 测评数据
    scores_json = Column(Text)      # JSON: [{word, total_score, accuracy, fluency, integrity}]
    avg_score = Column(Float, default=0)
    avg_accuracy = Column(Float, default=0)
    avg_fluency = Column(Float, default=0)
    weak_areas = Column(Text)       # JSON: AI分析的薄弱点
    grade_label = Column(String(20))  # 优秀/良好/需提升/薄弱

    # 线索捕获
    phone = Column(String(20), nullable=True, index=True)
    phone_verified = Column(Boolean, default=False)
    deep_report = Column(Text)      # JSON: AI深度报告

    # 转化跟踪
    sms_sent = Column(Boolean, default=False)
    converted = Column(Boolean, default=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    notes = Column(Text)            # 教师跟进备注

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
