from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

class Word(Base):
    __tablename__ = "words"

    id = Column(Integer, primary_key=True, autoincrement=True)
    word = Column(String(100), nullable=False, index=True)
    phonetic = Column(String(100))
    syllables = Column(String(200))
    tts_text = Column(String(200))  # TTS发音文本，有缩写时填完整版如 "say hi to somebody"
    memory_hook = Column(Text, nullable=True)  # AI记忆钩子(谐音/词根/联想),一词一次全平台缓存
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
    series = Column(String(30), nullable=True)  # 教材版本，如 "人教版"、"苏教版"，选项见 book_series 表
    # 学段(二级分组): 选项见 book_stages 表。可空 —— 课外书/总复习/机构自编教材
    # 很多本来就没有学段,强制必填只会迫使人乱填。空值在界面归「未分类」。
    # 存量行由 init_db 按 grade_level 一次性回填(见 database.py)
    stage_id = Column(Integer, nullable=True)
    created_by = Column(Integer, nullable=True)  # 暂时不使用外键
    org_id = Column(Integer, nullable=True)  # 多租户: NULL=平台共享库,非NULL=机构自建;索引由init_db迁移建
    is_public = Column(Boolean, default=True)
    cover_color = Column(String(20), default="#FF6B6B")
    cover_url = Column(String(500), nullable=True)  # AI 生成的封面图 URL，可空
    created_at = Column(DateTime, server_default=func.now())

class BookSeries(Base):
    """教材版本分类选项(单词本的 series 字段取值范围)
    org_id=NULL 为平台预置(所有机构可见),非 NULL 为机构自定义(仅本机构,tenancy 锚点隔离)
    """
    __tablename__ = "book_series"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(30), nullable=False)
    org_id = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class BookStage(Base):
    """学段选项(小学/初中/高中/…),单词本的二级分组。

    ## 为什么要建这张表(2026-09-11)

    学段此前**不是一个字段**,而是从 `grade_level`(存的是"三年级""高一"这类年级名)
    现算出来的推导值,而且推导规则在三处各写一份、彼此不一致:
      - services/book_stage.py  发码用,认不出的归 other
      - TeacherBooks.tsx stageOf 教师端分组用,认不出的**原样当组名**
      - services/pk/score.py    PK 计分用,认不出的兜底成 primary
    后果是同一批书两个说法: 教师端显示「大学」分组,发码那边归进「其他」。
    CLAUDE.md 记过——口径不一致的自动判定比没有判定更糟,它的结论无法自证。

    现在学段真存一个值,教师端分组与发码选书读**同一张表**,永不漂移;
    并且机构能自建("大学""成人""幼儿园"这些平台没预置的档)。

    与 BookSeries 完全同构: org_id=NULL 为平台预置(所有机构可见),
    非 NULL 为机构自定义(tenancy 写侧自动打戳、读侧自动过滤)。
    """
    __tablename__ = "book_stages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(20), nullable=False)     # 小学 / 初中 / 高中 / 大学 …
    # 稳定标识: 平台预置档给 primary/junior/senior,机构自建的留 NULL。
    # 存在的意义是让**已有的推导逻辑**(book_stage.py 的 STAGE_ORDER、
    # 兑换码的 scope_stage、PK 计分的 tier)能继续按 code 对齐,
    # 而不是靠中文名字符串匹配 —— 机构把「小学」改名成「小学部」就不该炸。
    code = Column(String(10), nullable=True)
    org_id = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0)
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
