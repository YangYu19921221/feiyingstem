"""例句跟读录音(2026-10-24)

孩子在单词单元里看着例句跟读,每读完一句录音进这张表排队,后台转写 + 逐词比对(与开口背同一套,
services/sentence_speech)。和开口背不同的两点:
- **录音保留 14 天**(用户 10-24 定),只有本班老师能听;到期由转写循环删文件、file_path 置空。
  老师边听边标「读对了 / 没读对」(teacher_verdict),拿来和机器判断对比,验证识别准不准
- 句子是**单词例句**(word_definitions.example_sentence),不是句子背诵库;sentence 存快照,例句后来改了也不乱

结果只给老师看,不进掌握度、不发金币、不拦学生。规则见 services/read_aloud.py。
"""
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text

from app.core.database import Base


class ReadAloudRecording(Base):
    __tablename__ = "read_aloud_recordings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    unit_id = Column(Integer, nullable=False)           # 单词单元 units.id
    word_id = Column(Integer, nullable=False)
    definition_id = Column(Integer, nullable=True)
    sentence = Column(Text, nullable=False)             # 读的那句(快照)
    org_id = Column(Integer, nullable=True)
    file_path = Column(String(200), nullable=True)      # 14 天后删文件并置空
    status = Column(String(20), nullable=False, default="pending", server_default="pending")
    transcript = Column(Text, nullable=True)
    missed_words = Column(Text, nullable=True)          # 逗号分隔
    hit_ratio = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)             # 机器判断: 实词全读出来了
    teacher_verdict = Column(String(10), nullable=True)  # ok / bad / NULL(没标)
    verdict_by = Column(Integer, nullable=True)
    verdict_at = Column(DateTime, nullable=True)
    # 写入时由 Python 显式给 utcnow(带微秒),不用 server_default:
    # 要和作业开放时刻(SQLAlchemy 写的 .000000 格式)比较,见 CLAUDE.md「SQLite 日期时间禁止混用微秒格式」
    created_at = Column(DateTime, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    audio_deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_read_aloud_user_unit", "user_id", "unit_id", "created_at"),
        Index("idx_read_aloud_status", "status"),
    )
