from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]


class CreateRoomRequest(BaseModel):
    max_players: int = Field(4, ge=2, le=20)
    word_count: int = Field(10, ge=4, le=30)  # 每局词数,每词 4 阶段


class JoinRoomRequest(BaseModel):
    invite_code: str = Field(..., min_length=6, max_length=6)


class PlayerSnapshot(BaseModel):
    user_id: int
    nickname: str
    online: bool
    current_word_idx: int
    correct: int
    wrong: int
    total_time_ms: int
    points: int = 0
    streak: int = 0
    finished: bool


class RoomSnapshot(BaseModel):
    room_id: int
    invite_code: str
    host_id: int
    unit_id: Optional[int] = None
    max_players: int
    status: StatusLiteral
    current_phase: PhaseLiteral
    current_word_idx: int
    total_words: int          # 开局前为 0,开局后 = 实际抽到的词数
    word_count: int = 10      # 房主设定的目标词数
    players: list[PlayerSnapshot]


class CreateRoomResponse(BaseModel):
    room_id: int
    invite_code: str


class PlayerHistoryItem(BaseModel):
    room_id: int
    invite_code: str
    unit_id: Optional[int] = None
    finished_at: Optional[datetime]
    rank: Optional[int]
    accuracy: Optional[float]
    final_score: Optional[int]
