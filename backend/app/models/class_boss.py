"""全班打大怪: 领奖记录(规则见 app/services/class_boss.py)"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from app.core.database import Base


class ClassBossClaim(Base):
    """大怪打死以后,出过力的孩子领奖 —— 一人一周一行。

    「只能领一次」靠的就是这张表的唯一约束: 领奖时先插这一行,插成了才发粮食和经验。
    伤害本身不存(每次从作业 / 复习 / 学词的记录现算),这里只记领没领。
    """
    __tablename__ = "class_boss_claims"
    __table_args__ = (UniqueConstraint("class_id", "week_start", "user_id", name="uq_class_boss_claim"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    class_id = Column(Integer, nullable=False)
    # 那一周周一的北京日 YYYY-MM-DD(存字符串: 不碰 SQLite 日期时间格式的坑)
    week_start = Column(String(10), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    claimed_at = Column(DateTime, nullable=False)
