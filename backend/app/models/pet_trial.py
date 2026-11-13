"""宠物对战 · 闯关进度(规则见 app/services/pet_trial.py)"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint

from app.core.database import Base


class PetTrialStage(Base):
    """一个孩子一关一行: 最好拿过几星、打过几次、第一次通过是什么时候。

    「通过了没有」只看 first_cleared_at 有没有值(stars 是 0 也可能有行: 打过但没赢)。
    写这张表只有 services/pet_trial.settle 一处,而且是单条 upsert(星星只升不降)。
    """
    __tablename__ = "pet_trial_stages"
    __table_args__ = (UniqueConstraint("user_id", "stage", name="uq_pet_trial_user_stage"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # 第几关,从 1 起,不封顶(40 关一圈,第 41 关是第二圈的第 1 关)
    stage = Column(Integer, nullable=False)
    stars = Column(Integer, nullable=False, default=0, server_default="0")
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    first_cleared_at = Column(DateTime, nullable=True)
    last_played_at = Column(DateTime, nullable=True)
