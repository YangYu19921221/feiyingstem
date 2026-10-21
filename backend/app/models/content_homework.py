"""句子 / 音标视频作业(2026-10-21)

为什么单开一张表、不往 homework_assignments 里塞:
那张表的 unit_id 是 NOT NULL 外键到**单词单元**,金币分母、每日单词数、比赛模式、单元解锁、
今日报告、班级分析十几处都按「作业 = 一个单词单元」在 join。把句子/视频作业塞进去要么改成可空
(SQLite 得重建 8000 多行的表,十几处 join 都得加 outer 判断),要么造假单元 —— 两样都会让
那十几处在没人注意的地方算错数。单开一张,单词作业的所有口径**一行不动**。

一份作业 = 一个内容目标(一个句子单元 / 一节音标视频)× 一批学生。
完成判定**不由前端报**,在服务端按已有的学习数据现算:
- 句子: sentence_unit_progress.completed_at 落在作业开放之后(全部组过关)
- 视频: phonetic_video_views.completed(services/video_watch.is_completed 判的那个,唯一真源)
所以学生不用「交作业」,学完就自动算完成;也不会因为前端漏报而显示没做。

不发金币(用户 2026-09-30 定的口径: 金币只给电教室的单词作业),不进单词数/排行榜。
"""
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base

KIND_SENTENCE = "sentence"
KIND_PHONETIC_VIDEO = "phonetic_video"
# 每日复习(2026-10-21): 没有具体内容目标(target_id=0),当天那一份 20 个词做完就算完成,
# 见 services/daily_review.py。一天一份作业,「连续 N 天」= 建 N 份、逐天顺延
KIND_DAILY_REVIEW = "daily_review"
KINDS = (KIND_SENTENCE, KIND_PHONETIC_VIDEO, KIND_DAILY_REVIEW)


class ContentHomework(Base):
    __tablename__ = "content_homework"

    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String(20), nullable=False)               # sentence / phonetic_video
    # 目标 id: kind=sentence → sentence_units.id;kind=phonetic_video → phonetic_videos.id。
    # 刻意不加外键(一列指两张表);删内容时由对应删除路径清掉这里的行
    target_id = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(Integer, nullable=True, index=True)
    assigned_by = Column(Integer, nullable=True)
    assigned_by_name = Column(String(100), nullable=True)
    # 开放时刻(北京某天 0 点对应的 UTC);截止 = 开放 + 1 天(与单词当日任务同口径)。
    # 「在家做」是这类作业的本意(电教室一般在背单词),所以没有 location_type —— 一律不发金币
    available_from = Column(DateTime, nullable=False)
    deadline = Column(DateTime, nullable=True)              # NULL = 不限当天,开放后一直能做
    is_closed = Column(Boolean, default=False, server_default="0", nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_content_hw_teacher", "teacher_id", "created_at"),
        Index("idx_content_hw_target", "kind", "target_id"),
    )


class ContentHomeworkStudent(Base):
    __tablename__ = "content_homework_students"

    id = Column(Integer, primary_key=True, autoincrement=True)
    homework_id = Column(Integer, ForeignKey("content_homework.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # 完成时刻: 服务端首次判到「学完了」时写入(只写不清)。NULL = 还没完成。
    # 状态不存列,读的时候按 completed_at / 开放 / 截止现算,不会和真实学习数据对不上
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("homework_id", "student_id", name="uq_content_hw_student"),
    )
