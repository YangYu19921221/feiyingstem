"""AI 学习助手对话(2026-10-26)

学生和助手的一段对话 = 一行 tutor_conversations,每条消息一行 tutor_messages。
- 孩子发的题目照片**不落盘**(只过内存给模型看),消息上只记 has_image;
  助手回答第一行会写「我看到的题目: …」,老师看记录时知道孩子问的是什么
- 每条助手消息记模型和用量(input/output/cache tokens),管理端按天汇总控成本
- 只有本班老师能看(api/v1/tutor.py 的 teacher_router)
规则见 services/tutor.py。
"""
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class TutorConversation(Base):
    __tablename__ = "tutor_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(Integer, nullable=True)
    title = Column(String(60), nullable=False, default="")
    message_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_tutor_conv_user", "user_id", "updated_at"),)


class TutorMessage(Base):
    __tablename__ = "tutor_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("tutor_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, nullable=False)          # 学生本人(助手消息也记学生 id,方便按人汇总)
    role = Column(String(10), nullable=False)          # user / assistant
    text = Column(Text, nullable=False, default="")
    has_image = Column(Boolean, nullable=False, default=False, server_default="0")
    # 助手消息上的卡片/按钮(默写卡、去复习),刷新后照样能重新画出来
    cards = Column(JSON, nullable=True)
    tools = Column(String(200), nullable=True)         # 这次用了哪些工具,逗号分隔
    model = Column(String(60), nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cache_read_tokens = Column(Integer, nullable=True)
    cache_write_tokens = Column(Integer, nullable=True)
    error = Column(String(200), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_tutor_msg_conv", "conversation_id", "id"),
        Index("ix_tutor_msg_day", "created_at"),
    )
