"""
教师端数据分析相关的数据模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class StudentLearningStats(BaseModel):
    """学生学习统计"""
    user_id: int
    username: str
    full_name: str

    # 学习统计(使用前端期望的字段名)
    words_learned: int = Field(0, description="已学单词数")  # 前端期望的字段名
    total_words_studied: int = 0  # 保留兼容性
    mastered_words: int = 0  # 掌握度>=4的单词数
    average_mastery: float = 0.0  # 平均掌握度

    # 活跃度
    total_study_days: int = 0
    study_sessions: int = Field(0, description="学习会话数")  # 前端期望的字段名
    total_learning_time: int = Field(0, description="总学习时长(秒)")  # 前端期望的字段名
    total_study_time: int = 0  # 保留兼容性
    last_active: Optional[datetime] = Field(None, description="最后活动时间")  # 前端期望的字段名
    last_study_date: Optional[datetime] = None  # 保留兼容性

    # 准确率
    total_correct: int = 0
    total_wrong: int = 0
    accuracy_rate: float = 0.0

    # 薄弱点
    weak_words_count: int = Field(0, description="薄弱单词数(掌握度<3)")  # 前端期望的字段名


class ClassOverviewStats(BaseModel):
    """班级整体统计"""
    total_students: int
    active_students: int  # 最近7天有学习记录的学生数

    # 学习统计
    total_words_studied: int
    average_mastered_words: float
    average_accuracy: float

    # 活跃度
    total_study_hours: float
    average_study_time_per_student: float


class WordDifficultyStats(BaseModel):
    """单词难度统计"""
    word_id: int
    word: str
    phonetic: Optional[str]
    meaning: str

    # 统计数据
    total_attempts: int = 0  # 总答题次数
    correct_count: int = 0
    wrong_count: int = 0
    error_rate: float = 0.0  # 错误率

    # 学生掌握情况
    students_mastered: int = 0  # 掌握的学生数(掌握度>=4)
    students_struggling: int = 0  # 困难的学生数(掌握度<2)


class LearningModeStats(BaseModel):
    """学习模式统计"""
    learning_mode: str
    total_sessions: int = 0
    total_attempts: int = 0
    correct_count: int = 0
    wrong_count: int = 0
    average_accuracy: float = 0.0
    average_time_per_word: float = 0.0  # 平均每个单词用时(秒)


class StudentProgressDetail(BaseModel):
    """学生进度详情"""
    user_id: int
    username: str
    full_name: str

    # 单词本进度
    book_id: int
    book_name: str
    total_units: int
    completed_units: int
    progress_percentage: float

    # 时间统计
    total_study_time: int  # 秒
    last_studied_at: Optional[datetime]


class StudentWeakPoint(BaseModel):
    """学生薄弱点分析"""
    word_id: int
    word: str
    meaning: str
    mastery_level: int
    correct_count: int
    wrong_count: int
    error_count: int  # 别名,与wrong_count相同
    total_attempts: int  # correct_count + wrong_count
    error_rate: float
    accuracy_rate: float  # 100 - error_rate
    last_practiced_at: Optional[datetime]
    last_error_at: Optional[datetime]  # 别名,与last_practiced_at相同
    learning_modes: List[str] = []  # 该单词在哪些学习模式中出现过错误


class ClassRanking(BaseModel):
    """班级排行"""
    rank: int
    user_id: int
    username: str
    full_name: str
    score: float  # 可以是掌握单词数、准确率等
    metric_name: str  # 排行依据


class StudyTrendData(BaseModel):
    """学习趋势数据"""
    date: str
    students_active: int  # 当天活跃学生数
    words_learned: int  # 当天学习的单词数
    average_accuracy: float  # 当天平均准确率
