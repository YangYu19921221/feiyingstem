"""金币系统模型

规则(教师端后台运营用):
- 完成当日老师布置的全部作业 → +1 币(当天无作业则不发);
- 当日班级词量榜第一(单词王)→ +2 币。
两者均每日结算、幂等(靠 CoinTransaction.dedup_key 唯一约束防重复发放)。
兑换 = 记一条负数流水(不设商品目录,老师自由填事由)。

多租户:两表都带 org_id,纳入 tenancy 读写双安全网(见 core/tenancy.py)。
"""
from sqlalchemy import (
    Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.sql import func

from app.core.database import Base


class StudentCoin(Base):
    """学生金币余额(每个学生一行)"""
    __tablename__ = "student_coins"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, unique=True)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")
    balance = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CoinTransaction(Base):
    """金币流水(增减都记一条;兑换=负数)

    source:
      - task      系统:完成当日全部作业 +1
      - word_king 系统:当日单词王 +2
      - manual    老师手动增减(可正可负)
      - redeem    兑换消耗(负数)
    dedup_key: 系统发放的幂等键(如 task:20260719、word_king:20260719),
               同键唯一,重复结算被唯一约束挡下;手动/兑换为 NULL(不去重)。
    """
    __tablename__ = "coin_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")
    amount = Column(Integer, nullable=False)  # 变动值,正=获得,负=消耗
    balance_after = Column(Integer, nullable=False, default=0)  # 变动后余额(留档,便于对账)
    source = Column(String(20), nullable=False)  # task/word_king/manual/redeem
    reason = Column(String(200), nullable=True)  # 事由(兑换内容/手动备注)
    dedup_key = Column(String(80), nullable=True)  # 系统发放幂等键;手动/兑换为空
    operator_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # 操作人(系统发放为空)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("dedup_key", name="uq_coin_tx_dedup"),
        Index("idx_coin_tx_user", "user_id"),
        Index("idx_coin_tx_org_created", "org_id", "created_at"),
    )
