"""
学习记录相关的数据模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class WordAnswerCreate(BaseModel):
    """单个单词答题记录"""
    word_id: int
    is_correct: bool
    time_spent: int = Field(ge=0, description="答题用时(毫秒)")
    learning_mode: str = Field(description="学习模式: flashcard/quiz/spelling/fillblank")


class LearningRecordBatchCreate(BaseModel):
    """批量创建学习记录"""
    unit_id: int
    learning_mode: str
    records: List[WordAnswerCreate]


class LearningRecordResponse(BaseModel):
    """学习记录响应"""
    id: int
    user_id: int
    word_id: int
    learning_mode: str
    is_correct: bool
    time_spent: int
    created_at: datetime

    class Config:
        from_attributes = True


class StudySessionCreate(BaseModel):
    """创建学习会话"""
    unit_id: int
    learning_mode: str


class StudySessionUpdate(BaseModel):
    """更新学习会话"""
    session_id: int
    words_studied: int = Field(ge=0)
    correct_count: int = Field(ge=0)
    wrong_count: int = Field(ge=0)
    time_spent: int = Field(ge=0, description="总用时(秒)")


class StudySessionResponse(BaseModel):
    """学习会话响应"""
    id: int
    user_id: int
    book_id: int
    unit_id: Optional[int]
    learning_mode: str
    words_studied: int
    correct_count: int
    wrong_count: int
    time_spent: int
    started_at: datetime
    ended_at: Optional[datetime]

    class Config:
        from_attributes = True


class WordMasteryResponse(BaseModel):
    """单词掌握度响应"""
    id: int
    user_id: int
    word_id: int
    total_encounters: int
    correct_count: int
    wrong_count: int
    mastery_level: int
    review_stage: int = 0
    flashcard_correct: int
    flashcard_wrong: int
    quiz_correct: int
    quiz_wrong: int
    spelling_correct: int
    spelling_wrong: int
    fillblank_correct: int
    fillblank_wrong: int
    last_practiced_at: Optional[datetime]
    next_review_at: Optional[datetime]

    class Config:
        from_attributes = True


class ReviewWordResponse(BaseModel):
    """复习单词响应（含完整单词信息）"""
    mastery_id: int
    word_id: int
    mastery_level: int
    review_stage: int = 0
    next_review_at: Optional[datetime]
    last_practiced_at: Optional[datetime]
    word: str
    phonetic: Optional[str] = None
    syllables: Optional[str] = None
    meaning: Optional[str] = None
    part_of_speech: Optional[str] = None
    example_sentence: Optional[str] = None
    example_translation: Optional[str] = None
    difficulty: int = 1


class ReviewRecordBatchCreate(BaseModel):
    """批量创建复习记录（不需要unit_id）"""
    records: List[WordAnswerCreate]


class StudyCalendarUpdate(BaseModel):
    """更新学习日历"""
    words_learned: int = Field(ge=0)
    duration: int = Field(ge=0, description="学习时长(秒)")
