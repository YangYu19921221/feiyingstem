from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Numeric,
    UniqueConstraint, CheckConstraint,
)
from sqlalchemy.sql import func
from app.core.database import Base


class PkRoom(Base):
    __tablename__ = "pk_rooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invite_code = Column(String(6), unique=True, nullable=False, index=True)
    host_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")  # 房间归属机构(多租户);索引由init_db迁移建
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)  # 旧版按单元开房的遗留,现为空
    max_players = Column(Integer, nullable=False, default=4)
    status = Column(String(10), nullable=False, index=True)
    word_ids = Column(String, nullable=False)  # JSON string
    created_at = Column(DateTime, server_default=func.current_timestamp())
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("max_players BETWEEN 2 AND 20", name="ck_pk_rooms_max_players"),
    )


class PkRoomPlayer(Base):
    __tablename__ = "pk_room_players"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, ForeignKey("pk_rooms.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rank = Column(Integer, nullable=True)
    accuracy = Column(Numeric(5, 2), nullable=True)
    total_time_ms = Column(Integer, nullable=True)
    correct_count = Column(Integer, nullable=True)
    wrong_count = Column(Integer, nullable=True)
    final_score = Column(Integer, nullable=True)
    is_disconnected = Column(Boolean, default=False)
    joined_at = Column(DateTime, server_default=func.current_timestamp())

    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="uq_pk_room_user"),
    )


class PkAnswerRecord(Base):
    __tablename__ = "pk_answer_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, ForeignKey("pk_rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    phase = Column(String(20), nullable=False)
    is_correct = Column(Boolean, nullable=True)
    time_spent_ms = Column(Integer, nullable=True)
    answered_at = Column(DateTime, server_default=func.current_timestamp())
