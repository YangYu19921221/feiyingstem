from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]
ModeLiteral = Literal["individual", "team"]


class CreateRoomRequest(BaseModel):
    max_players: int = Field(4, ge=2, le=20)
    word_count: int = Field(10, ge=4, le=30)  # 每人每轮词数,每词 4 阶段;答完循环续刷
    mode: ModeLiteral = "individual"           # individual=个人 PK;team=分组 PK
    team_count: int = Field(2, ge=2, le=6)     # 分组 PK 队伍数;个人 PK 忽略
    countdown_seconds: int = Field(300, ge=60, le=1800)  # 全场倒计时秒数(1-30分钟,默认5)


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
    team: Optional[int] = None  # 分组 PK 里的队号;个人 PK 为 None
    n_words: int = 0            # 该玩家私有词表大小(算个人进度%)


class SpectatorSnapshot(BaseModel):
    user_id: int
    nickname: str
    online: bool = True


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
    mode: ModeLiteral = "individual"
    team_count: int = 2
    host_is_player: bool = True   # 房主是否下场(教师组织的房为 False)
    countdown_seconds: int = 300
    deadline_at: Optional[str] = None
    players: list[PlayerSnapshot]
    spectators: list[SpectatorSnapshot] = []


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
