from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

class Word(Base):
    __tablename__ = "words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word = Column(String(100), unique=True, nullable=False)
    phonetic = Column(String(100))
    syllables = Column(String(200))
    tts_text = Column(String(200))  # TTS发音文本，有缩写时填完整版如 "say hi to somebody"
    difficulty = Column(Integer, default=3)
    grade_level = Column(String(20))
    audio_url = Column(String(255))
    image_url = Column(String(255))
    created_by = Column(Integer, nullable=True)  # 暂时不使用外键,等用户系统实现后再添加
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class WordDefinition(Base):
    __tablename__ = "word_definitions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    part_of_speech = Column(String(20))
    meaning = Column(Text, nullable=False)
    example_sentence = Column(Text)
    example_translation = Column(Text)
    is_primary = Column(Boolean, default=False)

class WordTag(Base):
    __tablename__ = "word_tags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    tag = Column(String(50), nullable=False)

class WordBook(Base):
    __tablename__ = "word_books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    grade_level = Column(String(20))       # 年级，如 "三年级"，课外书留空
    volume = Column(String(20))             # 册次，如 "上册"、"下册"，课外书留空
    created_by = Column(Integer, nullable=True)  # 暂时不使用外键
    is_public = Column(Boolean, default=True)
    cover_color = Column(String(20), default="#FF6B6B")
    created_at = Column(DateTime, server_default=func.now())

class BookWord(Base):
    __tablename__ = "book_words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, default=0)

class Unit(Base):
    """单元表 - 单词本下的单元(如 Unit 1, Unit 2)"""
    __tablename__ = "units"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    unit_number = Column(Integer, nullable=False)  # 单元序号 1,2,3...
    name = Column(String(100), nullable=False)     # 单元名称 "Unit 1: Animals"
    description = Column(Text)                      # 单元描述
    order_index = Column(Integer, default=0)        # 排序

    # 统计信息
    word_count = Column(Integer, default=0)         # 单词数量
    group_size = Column(Integer, default=0)          # 每组单词数，0表示使用默认值

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # 唯一约束: 同一个单词本内的单元序号不能重复
    __table_args__ = (
        UniqueConstraint('book_id', 'unit_number', name='uq_book_unit'),
    )

class UnitWord(Base):
    """单元-单词关联表"""
    __tablename__ = "unit_words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    unit_id = Column(Integer, ForeignKey("units.id", ondelete="CASCADE"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, default=0)  # 单词在单元内的顺序

    # 唯一约束: 同一个单元内的单词不能重复
    __table_args__ = (
        UniqueConstraint('unit_id', 'word_id', name='uq_unit_word'),
    )
