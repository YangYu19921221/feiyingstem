from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional, Any

PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]
ModeLiteral = Literal["individual", "team"]  # 个人 PK / 分组 PK
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
    points: int = 0          # 累计得分(基础分+手速加成,服务端权威)
    streak: int = 0          # 当前连击(连续答对数)
    best_streak: int = 0     # 本局最高连击
    # 并行竞速:每人一份私有词表 + 独立进度指针。current_word_idx = 已完成题数(0..∞,
    # 答完循环续刷不清零);当前词/阶段由它对 word_ids 取模推出(见下方计算属性)。
    word_ids: list[int] = field(default_factory=list)   # 该玩家私有词表(从自己背过的词抽)
    current_word_idx: int = 0                            # 已完成题数(个人进度指针)
    answers: list[AnswerRecord] = field(default_factory=list)  # 个人答题流水(按提交顺序)
    finished: bool = False   # 保留字段;全场倒计时定胜负,答完循环续刷,通常不置 True
    team: Optional[int] = None  # 分组 PK 里的队号(1..team_count);个人 PK 恒为 None
    last_heartbeat_at: datetime = field(default_factory=datetime.utcnow)
    disconnected_at: Optional[datetime] = None

    @property
    def n_words(self) -> int:
        return len(self.word_ids)

    @property
    def current_word_id(self) -> Optional[int]:
        """个人当前词:按已完成题数对私有词表取模(答完循环续刷)。词表空返回 None。"""
        if not self.word_ids:
            return None
        return self.word_ids[(self.current_word_idx % (self.n_words * len(PHASES_IN_ORDER))) % self.n_words]

    @property
    def current_phase(self) -> PhaseLiteral:
        """个人当前阶段:一轮 = n_words*4 题,轮内前 n_words 题分类、次 n_words 语音…"""
        if not self.word_ids:
            return "classify"
        idx_in_round = self.current_word_idx % (self.n_words * len(PHASES_IN_ORDER))
        return PHASES_IN_ORDER[idx_in_round // self.n_words]


@dataclass
class SpectatorState:
    """观战者:只收广播不作答,不占玩家名额,掉线即移除(无重连窗口)。"""
    user_id: int
    nickname: str
    ws: Any = None  # WebSocket | None
    online: bool = True
    joined_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class RoomState:
    room_id: int
    invite_code: str
    host_id: int
    max_players: int
    status: StatusLiteral
    word_ids: list[int]                  # 开局前为空;开局时从「所有人都背过」交集里随机抽 word_count 个
    org_id: int = 1                      # 房间归属机构(多租户): 随房主,跨机构不可见/不可加入
    unit_id: Optional[int] = None        # 旧版按单元开房的遗留字段,现不再使用
    word_count: int = 10                 # 房主选的每局词数(每词 4 阶段)
    base_points: int = 100               # 无学段信息单词的兜底基础分
    word_points: dict[int, int] = field(default_factory=dict)  # word_id → 每题基础分(按该词学段)
    word_lookup: dict[int, Any] = field(default_factory=dict)  # word_id → Word ORM(开局时装载,全房共享)
    # PK 模式:individual=个人赛(默认,兼容学生自建房/晋级赛);team=分组赛(队伍聚合计分)
    mode: ModeLiteral = "individual"
    team_count: int = 2                  # 分组赛队伍数;个人赛忽略
    # 房主是否作为选手下场。学生自建房/晋级赛=True;教师组织的房=False(只监控不答题)
    host_is_player: bool = True
    host_ws: Any = None                  # 非参赛房主(教师)的控制台 WS;host_is_player=True 时不用
    host_online: bool = False            # 非参赛房主是否在线(教师控制台连接状态)
    current_phase: PhaseLiteral = "classify"
    current_word_idx: int = 0  # 全局题号(跨 phase 不重置)
    players: dict[int, PlayerState] = field(default_factory=dict)
    spectators: dict[int, "SpectatorState"] = field(default_factory=dict)  # 观战者(不参与结算)
    answers: dict[int, dict[int, AnswerRecord]] = field(default_factory=dict)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    # 全场倒计时(并行竞速):教师建房设时长(秒),开局时算出 deadline;到点强制全场结算
    countdown_seconds: int = 300
    deadline_at: Optional[datetime] = None
    join_order: list[int] = field(default_factory=list)  # 用于房主转移
    # 晋级赛对局:非 None 时这间房属于某场锦标赛,结束后由 tournament service
    # 记结果并自动推进赛程(出线/下一轮对阵)
    tournament_match_id: Optional[int] = None
    # 晋级赛房间的词表在建房时就按赛事单元预置,开局不再走"共同背过"交集
    fixed_words: bool = False

    # 注:并行竞速后"当前词/进度"下沉到 PlayerState(每人各跑各的),房间级
    # current_word_id/total_questions 已废弃删除(旧同步引擎遗留,会对空词表除零)。

    def points_for_word(self, word_id: int) -> int:
        return self.word_points.get(word_id, self.base_points)
