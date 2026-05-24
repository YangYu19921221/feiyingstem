from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]


class CreateRoomRequest(BaseModel):
    unit_id: int
    max_players: int = Field(4, ge=2, le=6)


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
    finished: bool


class RoomSnapshot(BaseModel):
    room_id: int
    invite_code: str
    host_id: int
    unit_id: int
    max_players: int
    status: StatusLiteral
    current_phase: PhaseLiteral
    current_word_idx: int
    total_words: int
    players: list[PlayerSnapshot]


class CreateRoomResponse(BaseModel):
    room_id: int
    invite_code: str


class PlayerHistoryItem(BaseModel):
    room_id: int
    invite_code: str
    unit_id: int
    finished_at: Optional[datetime]
    rank: Optional[int]
    accuracy: Optional[float]
    final_score: Optional[int]
