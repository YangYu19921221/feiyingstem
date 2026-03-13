# Database models
"""
导入所有模型以确保SQLAlchemy能正确解析关系引用
"""
from app.models.user import User, UserRole, Achievement, UserAchievement, StudyCalendar
from app.models.word import Word, WordDefinition, WordTag, WordBook, Unit, UnitWord
from app.models.learning import (
    LearningRecord,
    WordMastery,
    BookAssignment,
    AIQuizRecord,
    LearningProgress,
    StudySession,
    HomeworkAssignment,
    HomeworkStudentAssignment,
    HomeworkAttemptRecord
)
from app.models.reading import (
    ReadingPassage,
    ReadingVocabulary,
    ReadingQuestion,
    QuestionOption,
    QuestionAnswer,
    ReadingAssignment,
    ReadingAttempt,
    ReadingProgress
)
from app.models.system_config import AIProvider, SystemConfig
from app.models.competition import (
    CompetitionSeason,
    UserScore,
    AnswerRecord,
    UnitChallenge,
    ChallengeRanking,
    LeaderboardSnapshot,
    CompetitionQuestion,
    CompetitionQuestionOption,
    CompetitionQuestionSet,
    QuestionSetItem
)

__all__ = [
    # User models
    "User",
    "UserRole",
    "Achievement",
    "UserAchievement",
    "StudyCalendar",
    # Word models
    "Word",
    "WordDefinition",
    "WordTag",
    "WordBook",
    "Unit",
    "UnitWord",
    # Learning models
    "LearningRecord",
    "WordMastery",
    "BookAssignment",
    "AIQuizRecord",
    "LearningProgress",
    "StudySession",
    "HomeworkAssignment",
    "HomeworkStudentAssignment",
    "HomeworkAttemptRecord",
    # Reading models
    "ReadingPassage",
    "ReadingVocabulary",
    "ReadingQuestion",
    "QuestionOption",
    "QuestionAnswer",
    "ReadingAssignment",
    "ReadingAttempt",
    "ReadingProgress",
    # System config
    "AIProvider",
    "SystemConfig",
    # Competition models
    "CompetitionSeason",
    "UserScore",
    "AnswerRecord",
    "UnitChallenge",
    "ChallengeRanking",
    "LeaderboardSnapshot",
    "CompetitionQuestion",
    "CompetitionQuestionOption",
    "CompetitionQuestionSet",
    "QuestionSetItem",
]
