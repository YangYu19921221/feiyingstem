"""
试卷相关的Pydantic模型
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime


class ExamQuestionOption(BaseModel):
    """选择题选项"""
    key: str = Field(..., description="选项标识(A/B/C/D)")
    text: str = Field(..., description="选项内容")
    is_correct: Optional[bool] = Field(False, description="是否正确答案")
    display_order: Optional[int] = Field(None, description="显示顺序")


class ClozeBlank(BaseModel):
    """完形填空空题"""
    blank_number: int = Field(..., description="空号")
    content: Optional[str] = Field(None, description="题干")
    options: List[ExamQuestionOption] = Field(..., description="选项")
    correct_answer: str = Field(..., description="正确答案")
    explanation: Optional[str] = Field(None, description="解析")
    score: int = Field(1, description="分值")
    word: Optional[str] = Field(None, description="关联单词")


class ClozeOptions(BaseModel):
    """完形填空选项结构"""
    blanks: List[ClozeBlank] = Field(..., description="完形填空空题列表")


class ExamQuestionBase(BaseModel):
    """试卷题目基础模型"""
    question_number: int = Field(..., description="题号")
    question_type: str = Field(..., description="题型:choice/cloze_test/fill_blank/spelling/reading")
    content: str = Field(..., description="题干内容")
    correct_answer: Optional[str] = Field(None, description="正确答案")
    explanation: Optional[str] = Field(None, description="答案解析")
    score: int = Field(5, description="分值")
    word: Optional[str] = Field(None, description="关联的单词")
    options: Optional[Union[List[ExamQuestionOption], ClozeOptions]] = Field(None, description="选择题选项或完形填空结构")
    passage: Optional[str] = Field(None, description="阅读理解/完形填空短文")
    passage_id: Optional[str] = Field(None, description="阅读理解文章ID")
    passage_title: Optional[str] = Field(None, description="阅读理解文章标题")
    blanks: Optional[List[ClozeBlank]] = Field(None, description="完形填空空题列表")


class ExamPaperBase(BaseModel):
    """试卷基础模型"""
    title: str = Field(..., description="试卷标题")
    description: Optional[str] = Field(None, description="试卷描述")
    total_score: int = Field(100, description="总分")
    questions: List[ExamQuestionBase] = Field(..., description="题目列表")


class ExamPaperCreate(ExamPaperBase):
    """创建试卷"""
    student_id: int = Field(..., description="学生ID")
    generated_by_ai: bool = Field(True, description="是否AI生成")
    generation_strategy: Optional[Dict[str, Any]] = Field(None, description="生成策略")


class ExamPaperResponse(ExamPaperBase):
    """试卷响应"""
    id: int
    student_id: int
    generated_by_ai: bool
    created_at: datetime

    class Config:
        from_attributes = True


class StudentMistakeAnalysis(BaseModel):
    """学生错题分析结果"""
    total_words: int = Field(..., description="总单词数")
    weak_words: List[Dict[str, Any]] = Field(..., description="薄弱单词列表")
    weak_question_types: List[str] = Field(..., description="薄弱题型")
    recommended_distribution: Dict[str, int] = Field(..., description="推荐题型分布")
    difficulty_level: str = Field(..., description="推荐难度")
    accuracy_rate: float = Field(..., description="正确率")


class GenerateExamRequest(BaseModel):
    """生成试卷请求"""
    student_id: int = Field(..., description="学生ID")
    question_count: Optional[int] = Field(None, description="题目总数(不指定时使用AI推荐的60题标准分布)")
    custom_distribution: Optional[Dict[str, int]] = Field(None, description="自定义题型分布")
    difficulty: Optional[str] = Field(None, description="指定难度:easy/medium/hard")


class GenerateExamResponse(BaseModel):
    """生成试卷响应"""
    exam_id: int = Field(..., description="试卷ID")
    analysis: StudentMistakeAnalysis = Field(..., description="学生错题分析")
    exam: ExamPaperResponse = Field(..., description="生成的试卷")


class ExamSubmissionCreate(BaseModel):
    """提交试卷答案"""
    paper_id: int = Field(..., description="试卷ID")
    answers: List[Dict[str, Any]] = Field(..., description="答案列表")


class ExamSubmissionResponse(BaseModel):
    """试卷提交结果"""
    id: int
    paper_id: int
    user_id: int
    score: int
    total_score: int
    submitted_at: datetime
    answers: List[Dict[str, Any]]

    class Config:
        from_attributes = True
