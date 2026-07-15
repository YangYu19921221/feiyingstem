"""
句子背诵模型 — 与单词本独立的内容体系。
结构镜像 WordBook → Unit → UnitWord：
  SentenceBook → SentenceUnit → Sentence
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class SentenceBook(Base):
    """句子集（如：人教版七年级上册重点句型 / 日常对话句库）"""
    __tablename__ = "sentence_books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(120), nullable=False)
    description = Column(Text)
    grade_level = Column(String(20))       # 年级，如 "七年级"，课外句库留空
    volume = Column(String(20))             # 册次，如 "上册"
    cover_color = Column(String(20), default="#5FD35F")  # 句子集默认绿色，与单词本橙色区分
    cover_url = Column(String(500), nullable=True)
    is_public = Column(Boolean, default=True)
    org_id = Column(Integer, nullable=True)  # 多租户: NULL=平台共享库,非NULL=机构自建;索引由init_db迁移建
    created_by = Column(Integer, nullable=True)  # 教师 id
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SentenceUnit(Base):
    """句子单元（如 Unit 1 问候 / Unit 2 介绍家人）"""
    __tablename__ = "sentence_units"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("sentence_books.id", ondelete="CASCADE"), nullable=False)
    unit_number = Column(Integer, nullable=False)
    name = Column(String(120), nullable=False)
    description = Column(Text)
    order_index = Column(Integer, default=0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('book_id', 'unit_number', name='uq_sbook_unit'),
    )


class Sentence(Base):
    """单个句子 — 英文 + 中文 + 可选音标 / 难度 / 主题"""
    __tablename__ = "sentences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    unit_id = Column(Integer, ForeignKey("sentence_units.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, default=0)

    english = Column(Text, nullable=False)          # 英文原句
    chinese = Column(Text, nullable=False)          # 中文翻译
    phonetic = Column(String(500), nullable=True)   # 整句音标（可选，AI 生成或人工填）
    audio_url = Column(String(500), nullable=True)  # 音频 URL（一般不填，前端走 Edge TTS）
    tts_text = Column(String(500), nullable=True)   # 有缩写时的完整版本，给 TTS 用

    difficulty = Column(Integer, default=3)         # 1-5
    topic = Column(String(60), nullable=True)       # 主题/语法点 "问候 / 一般现在时"
    grammar_focus = Column(String(120), nullable=True)  # 重点语法标注

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
