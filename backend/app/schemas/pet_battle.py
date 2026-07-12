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


class QuestionData(BaseModel):
    """题目数据"""
    word_id: int
    word: str
    question_text: str
    options: List[str]  # ["A. 快乐的", "B. 悲伤的", "C. 生气的", "D. 害怕的"]


class RoundResult(BaseModel):
    """回合结果"""
    round_number: int
    question: QuestionData

    # 玩家1
    player1_answer: Optional[str]
    player1_correct: bool
    player1_time_ms: Optional[int]
    player1_damage: int
    player1_used_ultimate: bool
    player1_hp_after: int

    # 玩家2
    player2_answer: Optional[str]
    player2_correct: bool
    player2_time_ms: Optional[int]
    player2_damage: int
    player2_used_ultimate: bool
    player2_hp_after: int


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
    player1_total_correct: int
    player1_total_damage: int

    # 玩家2
    player2_id: int
    player2_username: str
    player2_pet: PetBattleInfo
    player2_total_correct: int
    player2_total_damage: int

    # 胜负
    winner_id: Optional[int]

    # 时间
    created_at: datetime
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    expires_at: Optional[datetime]

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
    """新回合消息"""
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


class WSBattleEnd(BaseModel):
    """战斗结束消息"""
    type: str = "battle_end"
    winner_id: Optional[int]
    winner_name: Optional[str]

    # 奖励
    food_earned: int
    xp_earned: int
    rating_change: Optional[int]

    # 统计
    player1_final_stats: dict
    player2_final_stats: dict


class WSError(BaseModel):
    """错误消息"""
    type: str = "error"
    message: str
    code: Optional[str] = None
