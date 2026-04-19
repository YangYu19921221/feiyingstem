"""
错题集相关的数据模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class MistakeWordDetail(BaseModel):
    """错题单词详情"""
    word_id: int
    word: str
    phonetic: Optional[str]
    syllables: Optional[str] = None  # 音节划分，用于彩色显示
    meaning: str
    part_of_speech: Optional[str]

    # 错题统计
    total_mistakes: int = 0  # 总错误次数
    recent_mistakes: int = 0  # 最近7天错误次数
    last_mistake_at: Optional[datetime] = None  # 最后一次答错时间

    # 掌握度信息
    mastery_level: int = 0  # 当前掌握度 0-5
    correct_count: int = 0
    wrong_count: int = 0

    # 错误模式统计
    flashcard_wrong: int = 0
    quiz_wrong: int = 0
    spelling_wrong: int = 0
    fillblank_wrong: int = 0

    # 是否已解决
    is_resolved: bool = False  # 如果掌握度 >= 4,视为已解决


class MistakeWordPage(BaseModel):
    """错题分页响应"""
    items: List[MistakeWordDetail]
    total: int
    page: int
    page_size: int
    total_pages: int


class MistakeBookStats(BaseModel):
    """错题集统计"""
    total_mistakes: int  # 总错题数
    unresolved_mistakes: int  # 未解决的错题数 (掌握度 < 4)
    resolved_mistakes: int  # 已解决的错题数 (掌握度 >= 4)

    # 按学习模式分类
    flashcard_mistakes: int = 0
    quiz_mistakes: int = 0
    spelling_mistakes: int = 0
    fillblank_mistakes: int = 0
    classify_mistakes: int = 0  # 分类学习中标为夹生/陌生的词

    # 时间统计
    today_practice_count: int = 0  # 今天练习的错题数
    week_practice_count: int = 0  # 本周练习的错题数


class MistakePracticeRequest(BaseModel):
    """错题练习请求"""
    learning_mode: str = Field(description="学习模式: flashcard/quiz/spelling/fillblank")
    limit: int = Field(default=20, ge=1, le=100, description="练习单词数量")
    only_unresolved: bool = Field(default=True, description="只练习未解决的错题")
    unit_id: Optional[int] = Field(default=None, description="指定单元ID(可选)")


class MistakePracticeResponse(BaseModel):
    """错题练习响应"""
    total_mistakes: int
    practice_words: List[MistakeWordDetail]
    message: str

    class Config:
        from_attributes = True


# ===== 闯关模式 =====

class ChallengeLevelWord(BaseModel):
    """闯关关卡中的单词"""
    word_id: int
    word: str
    meaning: str
    phonetic: Optional[str] = None
    part_of_speech: Optional[str] = None


class ChallengeLevel(BaseModel):
    """闯关关卡"""
    level: int
    status: str  # locked / unlocked / cleared
    words: List[ChallengeLevelWord]
    word_count: int


class ChallengeLevelsResponse(BaseModel):
    """闯关关卡列表响应"""
    levels: List[ChallengeLevel]
    total_levels: int
    cleared_levels: int
    total_unresolved: int
    message: str


class ChallengeAnswerItem(BaseModel):
    """单个答题项"""
    word_id: int
    user_answer: str


class ChallengeSubmitRequest(BaseModel):
    """闯关提交请求"""
    level: int
    answers: List[ChallengeAnswerItem]


class ChallengeSubmitResult(BaseModel):
    """闯关提交结果"""
    passed: bool
    correct_count: int
    total_count: int
    wrong_words: List[ChallengeLevelWord]
    message: str
