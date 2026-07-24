from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional, Any

PhaseLiteral = Literal["classify", "speech", "dictation", "exam", "summary"]
StatusLiteral = Literal["waiting", "playing", "finished", "abandoned"]
ModeLiteral = Literal["individual", "team"]  # 个人 PK / 分组 PK
PHASES_IN_ORDER: tuple[PhaseLiteral, ...] = ("classify", "speech", "dictation", "exam")

# 分类记忆法流程(PK 照搬):每人把词表分组,每组走 分类循环→听写(错词抄写)→过关检测。
# StageLiteral 是「组内当前阶段」;done = 该玩家全部组过关完成(记 finished_at)。
StageLiteral = Literal["classify", "dictation", "exam", "done"]
DEFAULT_GROUP_SIZE = 10        # 每组词数(对齐分类记忆法小学档;PK 词数通常不多,统一 10)
DICT_COPY_REQUIRED = 3         # 听写错词需连续抄对几遍才过(对齐 classify 正常模式)
EXAM_PASS_RATIO = 0.6          # 过关检测通过线(≥60%)
# 组内阶段在「单组进度」里的权重(用于实时榜的掌握进度百分比:先分类后听写再过关)
STAGE_WEIGHT: dict[str, float] = {"classify": 0.0, "dictation": 0.34, "exam": 0.67, "done": 1.0}


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
    points: int = 0          # 累计得分(答对/过关的即时鼓励,仅展示,不再决定排名)
    streak: int = 0          # 当前连击(连续答对数,展示用)
    best_streak: int = 0     # 本局最高连击
    # 分类记忆法流程(PK 照搬):每人私有词表切成 groups,逐组走 分类→听写→过关。
    word_ids: list[int] = field(default_factory=list)   # 该玩家私有词表(从自己背过的词抽)
    answers: list[AnswerRecord] = field(default_factory=list)  # 个人答题流水(按提交顺序)
    finished: bool = False   # 全部组过关 = True(率先完成者赢);置 True 时同时写 finished_at
    finished_at: Optional[datetime] = None  # 完成时刻(排名主键:先完成先赢)
    team: Optional[int] = None  # 分组 PK 里的队号(1..team_count);个人 PK 恒为 None
    last_heartbeat_at: datetime = field(default_factory=datetime.utcnow)
    disconnected_at: Optional[datetime] = None

    # ---- 分组队列状态机(替代旧的单调计数器取模) ----
    groups: list[list[int]] = field(default_factory=list)  # 分好的组(开局初始化)
    gi: int = 0                          # 当前组下标
    stage: StageLiteral = "classify"     # 当前组内阶段
    q_seq: int = 0                       # 单调题号(幂等/计时器 key;客户端回显校验)
    current_wid: Optional[int] = None    # 当前推出的词 id
    current_meta: dict = field(default_factory=dict)  # 当前题附加信息(exam_type/options/copies_left)
    # 分类态
    cls_pending: list[int] = field(default_factory=list)   # 本轮待分类词队列
    cls_results: dict[int, str] = field(default_factory=dict)  # word_id → familiar/semi/unknown
    # 听写态
    dict_pending: list[int] = field(default_factory=list)  # 本轮待听写词队列
    dict_copies_left: int = 0            # 当前错词还需连续抄对几遍(0=不在抄写态)
    dict_first: dict[int, bool] = field(default_factory=dict)  # word_id → 首次是否听写对
    # 过关态
    exam_pending: list[int] = field(default_factory=list)  # 本次过关待答词队列
    exam_correct: int = 0                # 本次过关答对数
    exam_total: int = 0                  # 本次过关总题数
    exam_attempt: int = 0                # 过关重考次数(0=首考)
    # 派生进度缓存(0..1),便于排名/快照,推进时重算
    progress: float = 0.0

    @property
    def n_words(self) -> int:
        return len(self.word_ids)

    @property
    def group_total(self) -> int:
        return len(self.groups)

    @property
    def cur_group(self) -> list[int]:
        return self.groups[self.gi] if 0 <= self.gi < len(self.groups) else []

    def compute_progress(self) -> float:
        """掌握进度 0..1:已过关组数 + 当前组阶段权重(+组内细分),再除以总组数。"""
        if not self.groups:
            return 1.0 if self.finished else 0.0
        total = len(self.groups)
        if self.stage == "done" or self.finished:
            return 1.0
        gsize = len(self.cur_group) or 1
        stage_w = STAGE_WEIGHT.get(self.stage, 0.0)
        # 组内细分:分类/听写按剩余队列比例、过关按已答比例,平滑推进(乘 0.33 段宽)
        if self.stage == "classify":
            within = 1.0 - (len(self.cls_pending) / gsize if gsize else 0)
        elif self.stage == "dictation":
            within = 1.0 - (len(self.dict_pending) / gsize if gsize else 0)
        elif self.stage == "exam":
            within = (self.exam_total - len(self.exam_pending)) / gsize if gsize else 0
        else:
            within = 0.0
        seg = 0.33
        group_frac = min(1.0, stage_w + within * seg)
        return round((self.gi + group_frac) / total, 4)


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
    created_at: datetime = field(default_factory=datetime.utcnow)
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
