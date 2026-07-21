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


class CoinReward(Base):
    """兑换奖励商品(机构自建自用,org_id 隔离,纳入 tenancy 安全网)

    如「200 人民币 = 200 币」。stock=None 表示不限量;is_active=False 下架
    (不删除,保留历史兑换记录的可读性)。
    """
    __tablename__ = "coin_rewards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")
    name = Column(String(100), nullable=False)          # 商品名
    cost = Column(Integer, nullable=False)              # 所需金币
    stock = Column(Integer, nullable=True)              # 库存;NULL=不限量
    is_active = Column(Integer, nullable=False, default=1, server_default="1")  # 1上架/0下架
    note = Column(String(200), nullable=True)           # 备注说明
    image_url = Column(String(255), nullable=True)      # 商品图(公开,学生端可看)
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, server_default=func.now())


class CoinRedeemRequest(Base):
    """学生兑换申请(学生发起→教师审批)。org_id 隔离,纳入 tenancy 安全网。

    审批通过才扣币+扣库存(见 coins.py approve)。商品名/所需币做快照,
    即便之后商品改名/删除,历史申请仍可读。
    """
    __tablename__ = "coin_redeem_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, default=1, server_default="1")
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reward_id = Column(Integer, ForeignKey("coin_rewards.id", ondelete="SET NULL"), nullable=True)
    reward_name = Column(String(100), nullable=False)   # 快照:申请时的商品名
    cost = Column(Integer, nullable=False)              # 快照:申请时的所需金币
    status = Column(String(20), nullable=False, default="pending", server_default="pending")  # pending/approved/rejected
    created_at = Column(DateTime, server_default=func.now())        # 申请时间
    reviewed_at = Column(DateTime, nullable=True)                   # 审批时间
    reviewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # 审批人

    __table_args__ = (
        Index("idx_redeem_req_status", "org_id", "status"),
        Index("idx_redeem_req_student", "student_id"),
    )


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
