"""开口背录音的后台转写结果(2026-10-11)。

学生说完照常往下走,录音进这张表排队;后台转写 + 逐词比对后**删掉音频文件**,只留文字结果给老师看。
status: pending(排队)/ done / failed。结果只给老师参考,不进掌握度、不拦学生。
"""
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class SentenceSpeech(Base):
    __tablename__ = "sentence_speeches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sentence_id = Column(Integer, ForeignKey("sentences.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(Integer, nullable=False)
    org_id = Column(Integer, nullable=True)
    file_path = Column(String(200), nullable=True)       # 转写完置空(文件已删)
    status = Column(String(20), nullable=False, default="pending", server_default="pending", index=True)
    transcript = Column(Text, nullable=True)
    missed_words = Column(Text, nullable=True)           # 逗号分隔的漏说/说错的词
    hit_ratio = Column(Float, nullable=True)             # 原句词命中比例 0~1
    passed = Column(Boolean, nullable=True)              # hit_ratio >= 阈值
    created_at = Column(DateTime, server_default=func.now())
    processed_at = Column(DateTime, nullable=True)
