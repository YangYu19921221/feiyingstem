from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# ========================================
# 单词释义相关
# ========================================

class WordDefinitionBase(BaseModel):
    part_of_speech: Optional[str] = Field(None, description="词性")
    meaning: str = Field(..., description="中文释义")
    example_sentence: Optional[str] = Field(None, description="例句")
    example_translation: Optional[str] = Field(None, description="例句翻译")
    is_primary: bool = Field(False, description="是否主要释义")

class WordDefinitionCreate(WordDefinitionBase):
    pass

class WordDefinitionResponse(WordDefinitionBase):
    id: int

    class Config:
        from_attributes = True

# ========================================
# 单词相关
# ========================================

class WordBase(BaseModel):
    word: str = Field(..., description="英文单词", min_length=1, max_length=100)
    phonetic: Optional[str] = Field(None, description="音标")
    difficulty: int = Field(3, ge=1, le=5, description="难度(1-5)")
    grade_level: Optional[str] = Field(None, description="适合年级")
    audio_url: Optional[str] = Field(None, description="发音音频URL")
    image_url: Optional[str] = Field(None, description="配图URL")

class WordCreate(WordBase):
    """老师录入单词时使用"""
    definitions: List[WordDefinitionCreate] = Field(..., min_items=1, description="单词释义列表")
    tags: List[str] = Field(default_factory=list, description="标签列表")

class WordUpdate(BaseModel):
    """更新单词信息"""
    phonetic: Optional[str] = None
    difficulty: Optional[int] = Field(None, ge=1, le=5)
    grade_level: Optional[str] = None
    audio_url: Optional[str] = None
    image_url: Optional[str] = None
    definitions: Optional[List[WordDefinitionCreate]] = None
    tags: Optional[List[str]] = None

class WordResponse(WordBase):
    """单词详细信息响应"""
    id: int
    definitions: List[WordDefinitionResponse] = []
    tags: List[str] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class WordListItem(BaseModel):
    """单词列表项(简化版)"""
    id: int
    word: str
    phonetic: Optional[str]
    difficulty: int
    grade_level: Optional[str]
    primary_meaning: Optional[str]  # 主要释义

    class Config:
        from_attributes = True

# ========================================
# 单词本相关
# ========================================

class WordBookBase(BaseModel):
    name: str = Field(..., description="单词本名称", min_length=1, max_length=100)
    description: Optional[str] = Field(None, description="描述")
    grade_level: Optional[str] = Field(None, description="适合年级")
    is_public: bool = Field(True, description="是否公开")
    cover_color: str = Field("#FF6B6B", description="封面颜色")

class WordBookCreate(WordBookBase):
    word_ids: List[int] = Field(default_factory=list, description="单词ID列表")

class WordBookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    grade_level: Optional[str] = None
    is_public: Optional[bool] = None
    cover_color: Optional[str] = None

class WordBookResponse(WordBookBase):
    id: int
    created_by: int
    word_count: int = Field(0, description="单词数量")
    created_at: datetime

    class Config:
        from_attributes = True

class WordBookDetailResponse(WordBookResponse):
    """单词本详情(包含单词列表)"""
    words: List[WordListItem] = []

# ========================================
# 批量导入相关
# ========================================

class WordBatchImport(BaseModel):
    """批量导入单词"""
    words: List[WordCreate] = Field(..., min_items=1, description="单词列表")
    book_id: Optional[int] = Field(None, description="导入到指定单词本")

class WordBatchImportResponse(BaseModel):
    success_count: int = Field(..., description="成功导入数量")
    failed_count: int = Field(..., description="失败数量")
    failed_words: List[str] = Field(default_factory=list, description="失败的单词列表")
