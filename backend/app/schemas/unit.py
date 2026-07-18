from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# ========================================
# 单元相关 Schemas
# ========================================

class UnitBase(BaseModel):
    unit_number: Optional[int] = Field(None, ge=1, description="单元序号(自动生成)")
    name: str = Field(..., min_length=1, max_length=100, description="单元名称")
    description: Optional[str] = Field(None, description="单元描述")
    order_index: Optional[int] = Field(0, description="排序索引")
    group_size: Optional[int] = Field(0, ge=0, le=50, description="每组单词数，0表示使用默认值")

class UnitCreate(UnitBase):
    """创建单元"""
    pass

class UnitUpdate(BaseModel):
    """更新单元"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    order_index: Optional[int] = None
    group_size: Optional[int] = Field(None, ge=0, le=50)

class UnitResponse(UnitBase):
    """单元响应"""
    id: int
    book_id: int
    word_count: int = Field(0, description="单词数量")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class UnitDetailResponse(UnitResponse):
    """单元详情(包含单词列表)"""
    words: List[dict] = Field(default_factory=list, description="单词列表")

# ========================================
# 单元-单词关联相关
# ========================================

class UnitWordAdd(BaseModel):
    """添加单词到单元"""
    word_ids: List[int] = Field(..., min_items=1, description="要添加的单词ID列表")

class UnitWordAddResponse(BaseModel):
    """添加单词到单元响应"""
    success_count: int = Field(..., description="成功添加数量")
    failed_count: int = Field(0, description="失败数量")
    failed_word_ids: List[int] = Field(default_factory=list, description="失败的单词ID")
    message: str = Field(..., description="操作结果")

class UnitWordBatchOperation(BaseModel):
    """批量操作单元内的单词"""
    word_ids: List[int] = Field(..., min_items=1, description="单词ID列表")
    operation: str = Field(..., description="操作类型: add/remove/reorder")


# ========================================
# 整本 Excel 一键导入 Schemas
# ========================================
# 限长与 models/word.py 列宽严格对齐(word 100/phonetic 100/syllables 200/
# tts 200/词性 20);meaning/例句落 TEXT 列,不设限——姊妹路径(单元内导入的
# WordCreate)也不限,同一份 Excel 两条路径必须同进同出。前端 parseWordRows
# 已按同一组数字截断,正常流量不会触发 422。

from pydantic import ConfigDict


class WorkbookImportWord(BaseModel):
    """工作表里的一行单词(前端已按列名别名解析好)"""
    model_config = ConfigDict(str_strip_whitespace=True)

    word: str = Field(..., min_length=1, max_length=100)
    phonetic: Optional[str] = Field(None, max_length=100)
    syllables: Optional[str] = Field(None, max_length=200)
    tts_text: Optional[str] = Field(None, max_length=200)
    part_of_speech: Optional[str] = Field(None, max_length=20)
    meaning: Optional[str] = None
    example_sentence: Optional[str] = None
    example_translation: Optional[str] = None


class WorkbookImportUnit(BaseModel):
    """一个工作表 = 一个单元"""
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=1, max_length=100, description="单元名 = 工作表名")
    words: List[WorkbookImportWord] = Field(default_factory=list)


class WorkbookImportRequest(BaseModel):
    """整本导入: 书名=工作簿文件名,单元=工作表,一次请求全建好"""
    model_config = ConfigDict(str_strip_whitespace=True)

    book_name: str = Field(..., min_length=1, max_length=100)
    grade_level: Optional[str] = Field(None, max_length=20)
    volume: Optional[str] = Field(None, max_length=20)
    series: Optional[str] = Field(None, max_length=30, description="教材版本,如人教版/苏教版")
    description: Optional[str] = Field(None, max_length=500)
    units: List[WorkbookImportUnit] = Field(..., min_length=1)
