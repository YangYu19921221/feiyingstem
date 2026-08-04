from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

from app.core.config import PK_MAX_PLAYERS


PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]
ModeLiteral = Literal["individual", "team"]


class CreateRoomRequest(BaseModel):
    # 上限取 config.PK_MAX_PLAYERS(Python 侧唯一真源)。
    # 原来卡 20/40 是因为实时榜「每人每答一题都向全房广播全量榜单」→ 流量按人数²涨,
    # 30 人房就吃掉 12M 上行的一半。2026-07-26 已解:榜单合并推送(窗口随人数放宽)
    # + 按人裁剪(学生只收前10名+自己)→ 流量与人数近似无关。
    max_players: int = Field(4, ge=2, le=PK_MAX_PLAYERS)
    # 每人每轮词数,每词 4 阶段;答完循环续刷。
    # 上限放开到 200:真正的天花板是"全场背得最少的学生的词汇量"——开局时
    # _try_start_game 会把 word_count 压到 min(设定值, 全场最小词汇量),
    # 所以填大不会出题超纲,只是等于"用满这个学生会的所有词"。
    # 留 200 这个宽松硬顶而非彻底无上限:防手滑填 99999 造出超长对局/大 payload。
    word_count: int = Field(10, ge=4, le=200)
    mode: ModeLiteral = "individual"           # individual=个人 PK;team=分组 PK
    # 分组 PK:教师建房时自己创建分组并起名,学生进房后自己选组。
    # 少于 2 组会自动补足到 2 组(空名按「第N组」兜底),见 manager.normalize_team_names
    team_names: list[str] = Field(default_factory=list, max_length=8)
    # 旧客户端仍会发 team_count(过去的"分几队"),服务端忽略:队数由 team_names 决定
    team_count: int = Field(2, ge=2, le=8, deprecated=True)
    countdown_seconds: int = Field(300, ge=60, le=1800)  # 全场倒计时秒数(1-30分钟,默认5)
    # 同题公平赛(默认开):全员考「所有人都背过」的同一批词、同一顺序,
    # 同满分 → 先背完者分数必然最高(发奖品用这个)。关掉则各考各背过的词
    # (共同背过的词太少开不了同题局时用;题量仍全场统一)
    same_words: bool = True


class JoinRoomRequest(BaseModel):
    invite_code: str = Field(..., min_length=6, max_length=6)


class PlayerSnapshot(BaseModel):
    user_id: int
    nickname: str
    online: bool
    correct: int
    wrong: int
    total_time_ms: int
    points: int = 0
    streak: int = 0
    finished: bool
    # 学生自选的组号;None = 分组赛里还没选组(个人赛恒为 None)。
    # 组名不逐行下发,前端用 RoomSnapshot.team_names 映射(省广播带宽)
    team: Optional[int] = None
    n_words: int = 0            # 该玩家私有词表大小
    # 掌握赛(分类记忆法流程):阶段 + 第几组 + 掌握进度
    stage: str = "classify"
    group_idx: int = 0
    group_total: int = 0
    progress: float = 0.0


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
    # 组号 → 组名(教师建房时起的)。学生在等待室据此选组。
    # key 用字符串:JSON 对象的键本来就只能是字符串,前端拿到 "1" 而非 1
    team_names: dict[str, str] = {}
    host_is_player: bool = True   # 房主是否下场(教师组织的房为 False)
    countdown_seconds: int = 300
    same_words: bool = True       # 同题公平赛(全员同一批词)/ 关=各考各背过的词
    deadline_at: Optional[str] = None
    players: list[PlayerSnapshot]
    spectators: list[SpectatorSnapshot] = []


class CreateRoomResponse(BaseModel):
    room_id: int
    invite_code: str


class MyRoomItem(BaseModel):
    """教师大厅「我的房间」列表项:当前进行中的房间(内存态,含等待/对局中)。"""
    room_id: int
    invite_code: str
    status: StatusLiteral
    mode: ModeLiteral = "individual"
    word_count: int = 10
    player_count: int = 0        # 已加入玩家数
    online_count: int = 0        # 在线玩家数
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None


class PlayerHistoryItem(BaseModel):
    room_id: int
    invite_code: str
    unit_id: Optional[int] = None
    finished_at: Optional[datetime]
    rank: Optional[int]
    accuracy: Optional[float]
    final_score: Optional[int]
