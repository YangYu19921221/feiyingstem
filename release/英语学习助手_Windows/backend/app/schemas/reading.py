"""
阅读理解相关的Pydantic Schema
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


# ========================================
# 阅读文章相关
# ========================================

class ReadingPassageBase(BaseModel):
    """阅读文章基础模型"""
    title: str = Field(..., max_length=200, description="文章标题")
    content: str = Field(..., description="文章内容(英文)")
    content_translation: Optional[str] = Field(None, description="文章翻译(中文)")
    difficulty: int = Field(3, ge=1, le=5, description="难度1-5")
    grade_level: Optional[str] = Field(None, max_length=20, description="适合年级")
    topic: Optional[str] = Field(None, max_length=100, description="主题")
    tags: Optional[List[str]] = Field(None, description="标签列表")
    is_public: bool = Field(False, description="是否公开")
    cover_image: Optional[str] = Field(None, description="封面图片URL")


class ReadingPassageCreate(ReadingPassageBase):
    """创建阅读文章"""
    pass


class ReadingPassageUpdate(BaseModel):
    """更新阅读文章"""
    title: Optional[str] = None
    content: Optional[str] = None
    content_translation: Optional[str] = None
    difficulty: Optional[int] = None
    grade_level: Optional[str] = None
    topic: Optional[str] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None
    cover_image: Optional[str] = None


class ReadingPassageResponse(ReadingPassageBase):
    """阅读文章响应"""
    id: int
    word_count: int
    source: str
    created_by: int
    view_count: int
    completion_count: int
    avg_score: float
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ========================================
# 词汇注释相关
# ========================================

class VocabularyItem(BaseModel):
    """词汇项"""
    word: str
    meaning: Optional[str] = None
    phonetic: Optional[str] = None
    context: Optional[str] = None
    position: Optional[int] = None
    is_key_vocabulary: bool = False


class VocabularyResponse(VocabularyItem):
    """词汇响应"""
    id: int
    passage_id: int

    class Config:
        from_attributes = True


# ========================================
# 题目相关
# ========================================

class QuestionOptionBase(BaseModel):
    """选项基础"""
    option_text: str
    option_label: str = Field(..., max_length=5, description="A/B/C/D")
    is_correct: bool = False
    order_index: int = 0


class QuestionOptionResponse(QuestionOptionBase):
    """选项响应"""
    id: int

    class Config:
        from_attributes = True


class QuestionAnswerBase(BaseModel):
    """答案基础"""
    answer_text: str
    answer_explanation: Optional[str] = None
    is_primary: bool = True
    accept_alternatives: Optional[List[str]] = None


class ReadingQuestionBase(BaseModel):
    """题目基础"""
    question_type: str = Field(..., description="题型: multiple_choice/true_false/fill_blank/short_answer")
    question_text: str
    order_index: int = 0
    points: int = 1


class ReadingQuestionCreate(ReadingQuestionBase):
    """创建题目"""
    options: Optional[List[QuestionOptionBase]] = None  # 选择题选项
    answer: Optional[QuestionAnswerBase] = None  # 填空/简答题答案


class ReadingQuestionResponse(ReadingQuestionBase):
    """题目响应"""
    id: int
    passage_id: int
    source: str
    options: List[QuestionOptionResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True


class ReadingQuestionWithAnswer(ReadingQuestionResponse):
    """带答案的题目响应(教师端使用)"""
    answer: Optional[QuestionAnswerBase] = None


# ========================================
# 完整文章(含词汇和题目)
# ========================================

class ReadingPassageDetail(ReadingPassageResponse):
    """文章详情(含词汇和题目)"""
    vocabularies: List[VocabularyResponse] = []
    questions: List[ReadingQuestionResponse] = []


class ReadingPassageWithAnswers(ReadingPassageResponse):
    """文章详情(教师端,含答案)"""
    vocabularies: List[VocabularyResponse] = []
    questions: List[ReadingQuestionWithAnswer] = []


# ========================================
# 答题相关
# ========================================

class AnswerSubmission(BaseModel):
    """学生提交的答案"""
    question_id: int
    answer: str  # 选择题是选项标签(A/B/C/D),填空题是文本


class SubmitReadingAttempt(BaseModel):
    """提交答题"""
    passage_id: int
    answers: List[AnswerSubmission]
    time_spent: int = Field(..., description="用时(秒)")
    assignment_id: Optional[int] = None


class QuestionResult(BaseModel):
    """单题结果"""
    question_id: int
    is_correct: bool
    user_answer: str
    correct_answer: str
    explanation: Optional[str] = None
    points: int
    earned_points: int


class ReadingAttemptResult(BaseModel):
    """答题结果"""
    attempt_id: int
    score: int
    total_points: int
    percentage: float
    is_passed: bool
    question_results: List[QuestionResult]


# ========================================
# 作业分配相关
# ========================================

class AssignReadingRequest(BaseModel):
    """分配阅读作业"""
    passage_id: int
    student_ids: List[int]
    deadline: Optional[datetime] = None
    min_score: Optional[int] = None
    max_attempts: int = 3


class ReadingAssignmentResponse(BaseModel):
    """作业响应"""
    id: int
    passage_id: int
    student_id: int
    teacher_id: int
    assigned_at: datetime
    deadline: Optional[datetime] = None
    is_completed: bool
    min_score: Optional[int] = None
    max_attempts: int

    class Config:
        from_attributes = True


# ========================================
# 学生端列表相关
# ========================================

class StudentPassageListItem(BaseModel):
    """学生端文章列表项"""
    id: int
    title: str
    topic: Optional[str]
    difficulty: int
    grade_level: Optional[str]
    word_count: int
    question_count: int
    cover_image: Optional[str]

    # 学生的学习状态
    is_assigned: bool = False  # 是否被分配
    is_started: bool = False  # 是否开始
    is_completed: bool = False  # 是否完成
    best_score: Optional[int] = None  # 最高分
    attempts_count: int = 0  # 尝试次数
    deadline: Optional[datetime] = None  # 截止时间


# ========================================
# AI生成相关
# ========================================

class GenerateReadingRequest(BaseModel):
    """AI生成阅读文章请求"""
    topic: str = Field(..., description="主题")
    difficulty: int = Field(3, ge=1, le=5, description="难度")
    grade_level: str = Field(..., description="年级")
    word_count_target: int = Field(200, ge=100, le=1000, description="目标字数")
    question_count: int = Field(5, ge=3, le=10, description="题目数量")


class GenerateReadingResponse(BaseModel):
    """AI生成阅读文章响应"""
    passage: ReadingPassageCreate
    vocabularies: List[VocabularyItem]
    questions: List[ReadingQuestionCreate]
