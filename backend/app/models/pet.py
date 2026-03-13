from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class UserPet(Base):
    """用户宠物表"""
    __tablename__ = "user_pets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)
    name = Column(String(50), nullable=False, default='小伙伴')
    species = Column(String(20), nullable=False, default='pikachu')  # pikachu/eevee/bulbasaur/charmander/squirtle/jigglypuff
    level = Column(Integer, default=1)
    experience = Column(Integer, default=0)
    happiness = Column(Integer, default=80)       # 0-100
    hunger = Column(Integer, default=80)           # 0-100
    evolution_stage = Column(Integer, default=0)   # 0=egg,1=baby,2=teen,3=adult,4=legendary
    food_balance = Column(Integer, default=10)     # 宠物粮余额，新用户送10粮
    last_fed_at = Column(DateTime, nullable=True)
    last_interaction_at = Column(DateTime, server_default=func.now())
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PetEventLog(Base):
    """宠物事件日志表"""
    __tablename__ = "pet_event_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pet_id = Column(Integer, ForeignKey('user_pets.id', ondelete='CASCADE'), nullable=False)
    event_type = Column(String(30), nullable=False)  # feed/evolve/adopt/happiness_decay
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
