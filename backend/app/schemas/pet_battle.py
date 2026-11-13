"""宠物对战系统 - Pydantic Schema"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ========== 请求模型 ==========

class BattleCreateRequest(BaseModel):
    """创建对战请求"""
    opponent_id: int = Field(..., description="对手用户ID")
    wordbook_id: Optional[int] = Field(None, description="单词本ID，为空则随机")
    mode: str = Field("casual", description="模式: casual/ranked")
    max_rounds: int = Field(10, description="最大回合数")


class BattleAnswerRequest(BaseModel):
    """提交答案请求"""
    battle_id: int
    round_number: int
    answer: str = Field(..., description="A/B/C/D")
    use_ultimate: bool = Field(False, description="是否使用必杀技")


# ========== 响应模型 ==========

class PetBattleInfo(BaseModel):
    """宠物战斗信息"""
    pet_id: int
    name: str
    species: str
    level: int
    evolution_stage: int
    hp: int
    max_hp: int
    combo: int
    ultimate_charges: int

    class Config:
        from_attributes = True


class BattlePetOption(BaseModel):
    """可在回合间切换的宠物。hp 是该宠物自己的本场剩余生命值。"""
    pet_id: int
    name: str
    species: str
    level: int
    evolution_stage: int
    hp: int
    max_hp: int
    is_current: bool
    can_switch: bool


class QuestionData(BaseModel):
    """题目数据(答题结束之前发给孩子的那一份,由 pet_battle_service.public_question 做出来)"""
    word_id: int
    # zh2en(看中文选英文)出题时是空串 —— 单词就是答案,结算时才给
    word: str
    question_text: str
    options: List[str]  # ["A. 快乐的", "B. 悲伤的", "C. 生气的", "D. 害怕的"];zh2en 是 ["A. apple", ...]
    # 题型: en2zh 看英文选中文 / zh2en 看中文选英文 / listen 听读音选中文。老题目没有这个键 = en2zh
    kind: str = "en2zh"
    # 题目里大字显示什么: en2zh 是单词,zh2en 是中文意思,listen 是 None(只放读音,不显示)
    display: Optional[str] = None
    # 放大招要拼的咒语(规则见 services/battle_moves): 只有这一回合手里有大招的孩子才有。
    # {meaning: 中文意思, length: 几个字母, letters: 打乱的字母(含 2 个干扰字母)}。**不带单词**
    spell: Optional[dict] = None


class RoundQuestionData(QuestionData):
    """结算时才返回正确答案，避免在新回合消息里提前泄题。"""
    correct_answer: str
    # 这个词的中文意思(结算时给,三种题型都有;很老的题目可能是 None)
    meaning: Optional[str] = None


class RoundResult(BaseModel):
    """回合结果"""
    round_number: int
    question: RoundQuestionData

    # 玩家1
    player1_answer: Optional[str]
    player1_correct: bool
    player1_time_ms: Optional[int]
    player1_damage: int
    player1_used_ultimate: bool
    player1_type_multiplier: float = 1.0
    player1_type_text: Optional[str] = None
    player1_hp_after: int
    player1_combo: int
    player1_ultimate_charges: int
    # 这一回合的出招: normal / heavy / guard / ultimate(真的放出了大招)
    player1_stance: str = "normal"
    # 这一回合挨的打被自己的防守减过
    player1_guarded: bool = False
    # 咒语: 没试是 None;试了是 {ok, word, meaning, typed}(结算时才给答案)
    player1_spell: Optional[dict] = None

    # 玩家2
    player2_answer: Optional[str]
    player2_correct: bool
    player2_time_ms: Optional[int]
    player2_damage: int
    player2_used_ultimate: bool
    player2_type_multiplier: float = 1.0
    player2_type_text: Optional[str] = None
    player2_hp_after: int
    player2_combo: int
    player2_ultimate_charges: int
    player2_stance: str = "normal"
    player2_guarded: bool = False
    player2_spell: Optional[dict] = None


class BattleResponse(BaseModel):
    """对战详情响应"""
    id: int
    status: str
    mode: str
    current_round: int
    max_rounds: int

    # 玩家1
    player1_id: int
    player1_username: str
    player1_pet: PetBattleInfo
    player1_roster: List[BattlePetOption] = Field(default_factory=list)
    player1_total_correct: int
    player1_total_damage: int

    # 玩家2
    player2_id: int
    player2_username: str
    player2_pet: PetBattleInfo
    player2_roster: List[BattlePetOption] = Field(default_factory=list)
    player2_total_correct: int
    player2_total_damage: int

    # 胜负
    winner_id: Optional[int]

    # 时间
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    expires_at: Optional[datetime]

    # 闯关的这一场是第几关(规则见 services/pet_trial);练习赛 / 真人对战是 None
    # {stage, boss, arena, area_name, title, lap, area_index, pos, type_rule, result?}
    # result 只有打完才有: {stage, boss, won, stars, best_stars, first_clear, next_stage, bonus, cleared}
    trial: Optional[dict] = None

    # 学习增益(规则见 services/battle_moves): {"player1": [{key, label, detail}], "player2": [...]},没有是空数组
    buffs: dict = Field(default_factory=lambda: {"player1": [], "player2": []})
    # 这一场开没开「出招三选一 / 大招要拼咒语」: 前端按它决定画不画那几个按钮。
    # hints = 三个出招按钮下面那行带数字的小字 {heavy, normal, guard}(后端从常量拼的;出招关着是 None)
    # spell_bonus = 念咒语那一块上写的「拼对咒语 大招伤害 ×1.5」(后端从常量拼的;咒语关着是 None)
    play: dict = Field(default_factory=lambda: {
        "stances": False, "spell_ultimate": False, "hints": None, "spell_bonus": None,
    })
    # 挑战同学的影子(规则见 services/pet_shadow): {owner_name, pet_name, type_rule, type_mult};别的对战是 None。
    # 只给名字和这一场的克制规矩(type_rule = "help_only"、type_mult = 1.3),不给影子主人的 id
    shadow: Optional[dict] = None

    class Config:
        from_attributes = True


class BattleListItem(BaseModel):
    """对战列表项"""
    id: int
    opponent_username: str
    opponent_pet_name: str
    status: str
    mode: str
    result: Optional[str]  # win/lose/draw
    created_at: datetime

    class Config:
        from_attributes = True


class BattleStatsResponse(BaseModel):
    """对战统计响应"""
    total_battles: int
    wins: int
    losses: int
    draws: int
    win_rate: float

    current_win_streak: int
    max_win_streak: int

    total_damage_dealt: int
    total_damage_taken: int
    avg_damage_per_battle: float

    accuracy: float  # 正确率

    ultimates_used: int
    ultimates_landed: int

    perfect_wins: int
    comeback_wins: int

    rating: int
    peak_rating: int

    class Config:
        from_attributes = True


# ========== WebSocket 消息 ==========

class WSBattleStart(BaseModel):
    """战斗开始消息"""
    type: str = "battle_start"
    battle: BattleResponse


class WSNewRound(BaseModel):
    """新回合消息。真人对战时两个孩子各收各的一份(咒语不一样);time_limit 是这一回合实际的时限
    (有人要拼咒语的回合已经加过 10 秒)"""
    type: str = "new_round"
    round_number: int
    question: QuestionData
    time_limit: int  # 秒


class WSAnswerReceived(BaseModel):
    """收到答案消息"""
    type: str = "answer_received"
    player_id: int
    round_number: int


class WSRoundResult(BaseModel):
    """回合结果消息"""
    type: str = "round_result"
    result: RoundResult
    # 几秒后发下一题(招式演完 + 看答案的时间);最后一回合为 None。前端用它画「下一回合」的进度
    next_in: Optional[float] = None


class WSBattleEnd(BaseModel):
    """战斗结束消息"""
    type: str = "battle_end"
    winner_id: Optional[int]
    winner_name: Optional[str]

    # 奖励（兼容旧字段：当前连接玩家的值）
    food_earned: int
    xp_earned: int
    rating_change: Optional[int]

    # 奖惩明细（按玩家，含段位/积分升降/连胜全对等加成；前端按 isPlayer1 取自己那份）
    player1_reward: Optional[dict] = None
    player2_reward: Optional[dict] = None
    capture: Optional[dict] = None
    # 打赢了、出战的宠物体力回满(闯关和挑战影子;练习赛 / 真人对战恒为 False)。闯关的 trial.healed 是同一个值
    healed: bool = False

    # 统计
    player1_final_stats: dict
    player2_final_stats: dict

    # 这一场每一题: 单词、正确的中文、两边答对没有(结算页列出答错的词,让孩子再看一眼)
    # [{round, word_id, word, meaning, player1_correct, player2_correct, player1_answered, player2_answered}]
    review: list = []

    # 闯关的这一场打完的结果(不是闯关就是 None):
    # {stage, boss, title, won, stars, best_stars, first_clear, next_stage, bonus: {food, xp}, cleared}
    trial: Optional[dict] = None


class WSError(BaseModel):
    """错误消息"""
    type: str = "error"
    message: str
    code: Optional[str] = None  # Pydantic v2 里 Optional 不带默认值仍是必填,给 None 才可省略
