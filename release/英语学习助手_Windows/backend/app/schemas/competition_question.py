"""
竞赛题目相关的Pydantic模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class QuestionOptionBase(BaseModel):
    """题目选项基础模型"""
    option_key: str = Field(..., description="选项键(A/B/C/D)")
    option_text: str = Field(..., description="选项文本")
    is_correct: bool = Field(default=False, description="是否为正确答案")
    display_order: int = Field(default=0, description="显示顺序")


class QuestionOptionCreate(QuestionOptionBase):
    """创建题目选项"""
    pass


class QuestionOption(QuestionOptionBase):
    """题目选项响应模型"""
    id: int
    question_id: int

    class Config:
        from_attributes = True


class CompetitionQuestionBase(BaseModel):
    """竞赛题目基础模型"""
    question_type: str = Field(..., description="题型:choice/fill_blank/spelling/reading")
    title: Optional[str] = Field(None, description="题目标题")
    content: str = Field(..., description="题目内容/题干")
    passage: Optional[str] = Field(None, description="阅读理解文章")
    correct_answer: str = Field(..., description="正确答案(JSON格式)")
    answer_explanation: Optional[str] = Field(None, description="答案解析")
    difficulty: str = Field(default="medium", description="难度:easy/medium/hard")
    word_id: Optional[int] = Field(None, description="关联单词ID")
    unit_id: Optional[int] = Field(None, description="关联单元ID")
    tags: Optional[str] = Field(None, description="标签(逗号分隔)")


class CompetitionQuestionCreate(CompetitionQuestionBase):
    """创建竞赛题目"""
    options: Optional[List[QuestionOptionCreate]] = Field(None, description="选项列表(选择题必填)")
    source: str = Field(default="manual", description="来源:manual/ai")


class CompetitionQuestionUpdate(BaseModel):
    """更新竞赛题目"""
    question_type: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    passage: Optional[str] = None
    correct_answer: Optional[str] = None
    answer_explanation: Optional[str] = None
    difficulty: Optional[str] = None
    word_id: Optional[int] = None
    unit_id: Optional[int] = None
    tags: Optional[str] = None
    is_active: Optional[bool] = None
    options: Optional[List[QuestionOptionCreate]] = None


class CompetitionQuestion(CompetitionQuestionBase):
    """竞赛题目响应模型"""
    id: int
    created_by: int
    source: str
    is_active: bool
    use_count: int
    correct_count: int
    total_attempts: int
    avg_time: int
    created_at: datetime
    updated_at: datetime
    options: List[QuestionOption] = []

    class Config:
        from_attributes = True


class CompetitionQuestionList(BaseModel):
    """竞赛题目列表响应"""
    total: int
    questions: List[CompetitionQuestion]


class AIGenerateQuestionRequest(BaseModel):
    """AI生成题目请求"""
    word_ids: Optional[List[int]] = Field(None, description="单词ID列表")
    unit_id: Optional[int] = Field(None, description="单元ID")
    question_types: List[str] = Field(..., description="题型列表")
    difficulty: str = Field(default="medium", description="难度")
    count: int = Field(default=10, ge=1, le=50, description="生成数量")
    custom_prompt: Optional[str] = Field(None, description="自定义提示词,用于指导AI生成题目")


class AIGenerateQuestionResponse(BaseModel):
    """AI生成题目响应"""
    success: bool
    generated_count: int
    questions: List[CompetitionQuestion]
    message: Optional[str] = None


class QuestionSetBase(BaseModel):
    """题目集合基础模型"""
    name: str = Field(..., description="集合名称")
    description: Optional[str] = Field(None, description="描述")
    is_public: bool = Field(default=False, description="是否公开")


class QuestionSetCreate(QuestionSetBase):
    """创建题目集合"""
    question_ids: List[int] = Field(default=[], description="题目ID列表")


class QuestionSetUpdate(BaseModel):
    """更新题目集合"""
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    question_ids: Optional[List[int]] = None


class QuestionSet(QuestionSetBase):
    """题目集合响应模型"""
    id: int
    created_by: int
    total_questions: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SubmitAnswerRequest(BaseModel):
    """提交答案请求"""
    question_id: int = Field(..., description="题目ID")
    user_answer: str = Field(..., description="用户答案")
    time_spent: int = Field(..., ge=0, description="答题时间(毫秒)")


class SubmitAnswerResponse(BaseModel):
    """提交答案响应"""
    is_correct: bool
    correct_answer: str
    answer_explanation: Optional[str] = None
    score: int
    combo_count: int


class QuestionStatistics(BaseModel):
    """题目统计"""
    total_questions: int
    by_type: dict
    by_difficulty: dict
    by_source: dict
    total_attempts: int
    avg_accuracy: float
