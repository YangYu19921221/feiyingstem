from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime


class PetCreate(BaseModel):
    """领养宠物请求"""
    name: str = Field(default="小伙伴", min_length=1, max_length=50)
    species: str = Field(default="pikachu", pattern="^(pikachu|eevee|bulbasaur|charmander|squirtle|jigglypuff|gastly|dratini|machop|abra|geodude|vulpix|growlithe|magikarp|oddish|poliwag)$")


class PetResponse(BaseModel):
    """宠物信息响应"""
    id: int
    user_id: int
    name: str
    species: str
    level: int
    experience: int
    happiness: int
    hunger: int
    evolution_stage: int
    xp_to_next_level: int
    evolution_stage_name: str
    food_balance: int = 0
    last_fed_at: Optional[datetime] = None
    last_interaction_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PetFeedResponse(BaseModel):
    """喂食响应"""
    message: str
    pet: PetResponse
    leveled_up: bool = False
    evolved: bool = False
    new_level: Optional[int] = None
    new_stage: Optional[int] = None


class PetEventResponse(BaseModel):
    """宠物事件响应"""
    id: int
    pet_id: int
    event_type: str
    detail: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PetLeaderboardEntry(BaseModel):
    """排行榜条目"""
    rank: int
    username: str
    pet_name: str
    species: str
    level: int
    evolution_stage: int
    evolution_stage_name: str


class PetLeaderboardResponse(BaseModel):
    """排行榜响应"""
    entries: List[PetLeaderboardEntry]
    my_rank: Optional[int] = None


class EarnFoodRequest(BaseModel):
    """做题赚粮请求"""
    score: int = Field(ge=0, description="答对题数")
    total: int = Field(ge=1, description="总题数")
    mode: str = Field(pattern="^(flashcard|quiz|fillblank|spelling)$", description="练习模式")


class EarnFoodResponse(BaseModel):
    """赚粮响应"""
    food_earned: int
    food_balance: int
    is_first_today: bool
    breakdown: Dict[str, int]
