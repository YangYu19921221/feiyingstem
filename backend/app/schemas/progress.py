from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# ========================================
# 学习进度相关 Schemas
# ========================================

class LearningProgressBase(BaseModel):
    """学习进度基础模型"""
    unit_id: int = Field(..., description="单元ID")
    learning_mode: str = Field(..., description="学习模式: flashcard/quiz/spelling/fillblank")

class StartLearningRequest(BaseModel):
    """开始学习请求 - unit_id从路径参数获取"""
    learning_mode: str = Field(..., description="学习模式: flashcard/quiz/spelling/fillblank")

class StartLearningResponse(BaseModel):
    """开始学习响应"""
    has_existing_progress: bool = Field(..., description="是否有已存在的学习进度")
    current_word_index: int = Field(..., description="当前单词索引(从0开始)")
    completed_words: int = Field(..., description="已完成单词数")
    total_words: int = Field(..., description="总单词数")
    progress_percentage: float = Field(..., description="进度百分比")
    words: List[dict] = Field(..., description="单词列表")
    message: str = Field(..., description="提示信息")
    unit_info: dict = Field(..., description="单元信息")

class UpdateProgressRequest(BaseModel):
    """更新学习进度请求"""
    unit_id: int = Field(..., description="单元ID")
    learning_mode: str = Field(..., description="学习模式")
    current_word_index: int = Field(..., description="当前单词索引")
    current_word_id: Optional[int] = Field(None, description="当前单词ID")
    word_result: Optional[str] = Field(None, description="单词学习结果: know/dont_know/correct/wrong")
    is_completed: bool = Field(False, description="是否完成该单元学习")

class UpdateProgressResponse(BaseModel):
    """更新学习进度响应"""
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="提示信息")
    progress_percentage: float = Field(..., description="进度百分比")
    completed_words: int = Field(..., description="已完成单词数")
    total_words: int = Field(..., description="总单词数")
    is_completed: bool = Field(..., description="是否完成")

# ========================================
# 单元进度相关
# ========================================

class UnitProgressResponse(BaseModel):
    """单元进度响应"""
    unit_id: int
    unit_number: int
    unit_name: str
    word_count: int
    completed_words: int = Field(0, description="已完成单词数")
    progress_percentage: float = Field(0.0, description="进度百分比")
    has_progress: bool = Field(False, description="是否有学习进度")
    current_word_index: int = Field(0, description="当前单词索引")
    last_studied_at: Optional[datetime] = Field(None, description="最后学习时间")
    learning_mode: Optional[str] = Field(None, description="学习模式")
    is_completed: bool = Field(False, description="是否完成")
    best_accuracy: Optional[float] = Field(None, description="最佳正确率")
    is_perfect: bool = Field(False, description="是否满分通过过")
    total_study_time: int = Field(0, description="总学习时长(秒)")
    attempt_count: int = Field(0, description="学习轮次(会话数)")

class BookProgressResponse(BaseModel):
    """单词本进度响应"""
    book_id: int
    book_name: str
    unit_count: int = Field(..., description="单元数量")
    word_count: int = Field(..., description="总单词数")
    completed_words: int = Field(0, description="已完成单词数")
    progress_percentage: float = Field(0.0, description="整体进度百分比")
    units: List[UnitProgressResponse] = Field(default_factory=list, description="单元进度列表")

# ========================================
# 学生单词本列表
# ========================================

class StudentBookListItem(BaseModel):
    """学生单词本列表项"""
    id: int
    name: str
    description: Optional[str]
    grade_level: Optional[str]
    volume: Optional[str] = None
    cover_color: str
    unit_count: int = Field(0, description="单元数量")
    word_count: int = Field(0, description="总单词数")
    progress_percentage: float = Field(0.0, description="学习进度百分比")
    owned: bool = Field(False, description="是否已购买/已分配")
    created_at: datetime

    class Config:
        from_attributes = True
