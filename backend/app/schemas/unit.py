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
