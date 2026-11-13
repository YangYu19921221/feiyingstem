"""宠物对战 · 挑战同学的影子: 战报(规则见 app/services/pet_shadow.py)"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String

from app.core.database import Base


class PetShadowLog(Base):
    """一场「挑战影子」打完(至少打了一回合)给影子的主人记一条: 谁来挑战、影子守住了没有。

    一场只记一条(battle_id 唯一)。只由 services/pet_shadow.settle 在对战结算认领成功之后写。
    名字都是当时的快照: 之后改名、被移出班级,战报上还是当时的样子。
    """
    __tablename__ = "pet_shadow_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    battle_id = Column(Integer, nullable=False, unique=True)
    # 影子的主人(被挑战的同学)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    challenger_id = Column(Integer, nullable=False, index=True)
    challenger_name = Column(String(60), nullable=False, default="同学")
    # 影子用的那只宠物当时叫什么(主人的出战宠物)
    pet_name = Column(String(50), nullable=True)
    # 影子守住了 = 挑战的人没赢(输了 / 平了 / 中途逃跑)
    owner_won = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False)
    # 主人看过这条战报的时刻(没看过是 NULL)
    seen_at = Column(DateTime, nullable=True)
