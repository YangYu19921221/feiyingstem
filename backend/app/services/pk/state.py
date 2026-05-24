from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional, Any

PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]
PHASES_IN_ORDER: tuple[PhaseLiteral, ...] = ("classify", "speech", "dictation", "exam")


@dataclass
class AnswerRecord:
    user_id: int
    word_id: int
    phase: PhaseLiteral
    is_correct: bool
    time_spent_ms: int
    payload: dict[str, Any]
    answered_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class PlayerState:
    user_id: int
    nickname: str
    ws: Any = None  # WebSocket | None; Any 避免循环导入
    online: bool = True
    joined_at: datetime = field(default_factory=datetime.utcnow)
    correct: int = 0
    wrong: int = 0
    total_time_ms: int = 0
    current_word_idx: int = 0
    finished: bool = False
    last_heartbeat_at: datetime = field(default_factory=datetime.utcnow)
    disconnected_at: Optional[datetime] = None


@dataclass
class RoomState:
    room_id: int
    invite_code: str
    host_id: int
    unit_id: int
    max_players: int
    status: StatusLiteral
    word_ids: list[int]
    current_phase: PhaseLiteral = "classify"
    current_word_idx: int = 0  # 全局题号(跨 phase 不重置)
    players: dict[int, PlayerState] = field(default_factory=dict)
    answers: dict[int, dict[int, AnswerRecord]] = field(default_factory=dict)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    join_order: list[int] = field(default_factory=list)  # 用于房主转移

    @property
    def total_questions(self) -> int:
        """5 阶段中 4 个真正出题(summary 不出题)。"""
        return len(self.word_ids) * len(PHASES_IN_ORDER)

    @property
    def current_word_id(self) -> int:
        idx_in_phase = self.current_word_idx % len(self.word_ids)
        return self.word_ids[idx_in_phase]

    def is_phase_complete(self) -> bool:
        """当前 phase 的 word_ids 是否全部答完(全员到齐 OR 时间到)。"""
        next_word_idx_global = self.current_word_idx + 1
        phase_idx = next_word_idx_global // len(self.word_ids)
        prev_phase_idx = self.current_word_idx // len(self.word_ids)
        return phase_idx > prev_phase_idx
