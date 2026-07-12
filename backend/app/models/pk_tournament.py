"""PK 晋级赛(锦标赛)模型

结构:赛事 → 参赛者(分组) → 对局(小组赛/淘汰赛/安慰赛)。
对局真正开打时才动态创建内存 PK 房间(复用现有对战引擎),
打完由 tournament service 记结果并自动推进赛程。
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from app.core.database import Base


class PkTournament(Base):
    __tablename__ = "pk_tournaments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(80), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # running(小组赛+淘汰赛全程) / finished
    status = Column(String(12), nullable=False, default="running", index=True)
    group_size = Column(Integer, nullable=False, default=4)
    word_count = Column(Integer, nullable=False, default=8)   # 每场对局词数
    unit_ids = Column(String, nullable=False)                 # JSON: 词库来源单元
    class_ids = Column(String, nullable=False)                # JSON: 参赛班级
    has_consolation = Column(Boolean, nullable=False, default=True)  # 安慰赛(黑马组)
    champion_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    consolation_champion_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.current_timestamp())
    finished_at = Column(DateTime, nullable=True)


class PkTournamentPlayer(Base):
    __tablename__ = "pk_tournament_players"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tournament_id = Column(Integer, ForeignKey("pk_tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    seed_metric = Column(Integer, nullable=False, default=0)  # 分组依据:已学词数
    group_no = Column(Integer, nullable=False, default=0)
    points = Column(Integer, nullable=False, default=0)       # 小组积分(胜3负0)
    wins = Column(Integer, nullable=False, default=0)
    losses = Column(Integer, nullable=False, default=0)
    correct_total = Column(Integer, nullable=False, default=0)
    time_total_ms = Column(Integer, nullable=False, default=0)
    qualified = Column(Boolean, nullable=False, default=False)  # 小组出线

    __table_args__ = (
        UniqueConstraint("tournament_id", "user_id", name="uq_pk_tourn_player"),
    )


class PkTournamentMatch(Base):
    __tablename__ = "pk_tournament_matches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tournament_id = Column(Integer, ForeignKey("pk_tournaments.id", ondelete="CASCADE"), nullable=False, index=True)
    stage = Column(String(12), nullable=False)   # group / ko / consolation
    round_no = Column(Integer, nullable=False, default=1)
    bracket_pos = Column(Integer, nullable=False, default=0)  # 本轮内的对阵序号(淘汰赛配对用)
    group_no = Column(Integer, nullable=True)    # 小组赛所属组
    p1_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    p2_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # None=轮空
    winner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(10), nullable=False, default="pending", index=True)  # pending/finished/bye
    invite_code = Column(String(6), nullable=True)  # 最近一次开的房(内存房可能已回收)
    room_db_id = Column(Integer, nullable=True)     # 落库后的 pk_rooms.id
    p1_correct = Column(Integer, nullable=True)
    p1_score = Column(Integer, nullable=True)
    p1_time_ms = Column(Integer, nullable=True)
    p2_correct = Column(Integer, nullable=True)
    p2_score = Column(Integer, nullable=True)
    p2_time_ms = Column(Integer, nullable=True)
    finished_at = Column(DateTime, nullable=True)
