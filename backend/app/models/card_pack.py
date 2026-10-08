"""新政策卡包(2026-10-08): 机构按卡种分档进货,平台按期确认到账开额度。

只对 organizations.card_plan == 'pack' 的机构生效;老机构(legacy)仍走
organizations.card_quota 那一个总数,这里的表对它们永远是空的。

两张表:
- org_card_ledger  额度台账。每到账一期 / 补货一次就写几行(每档一行),
                   某档额度 = 该档所有行 count 之和。只增不改,对账靠它。
- pack_card_grants 学生手里生效中的学段卡 / 全通卡(按范围记一行)。
                   新书上架时按它把书补给学生 —— book_assignments 不知道
                   自己是哪张卡开出来的,没有这张表就找不到该补给谁。
口径真源 services/card_pack.py。
"""
from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class OrgCardLedger(Base):
    __tablename__ = "org_card_ledger"
    # 同一期同一档只能写一次: 平台双击「确认到账」会撞约束 → 409,不会把额度开两遍。
    # 补货行 installment_no 为 NULL,SQLite 里 NULL 互不相等,不受这条约束。
    # 赠送行 installment_no=0,于是一个机构一辈子只会拿到一次赠送
    __table_args__ = (
        UniqueConstraint("org_id", "source", "installment_no", "card_kind",
                         name="uq_card_ledger_installment"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True)
    card_kind = Column(String(10), nullable=False)      # trial/single/stage/full/premium
    count = Column(Integer, nullable=False)
    source = Column(String(12), nullable=False)          # installment / bonus / restock
    installment_no = Column(Integer, nullable=True)      # 第几期;赠送=0;补货=NULL
    note = Column(String(200), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PackCardGrant(Base):
    __tablename__ = "pack_card_grants"
    # 全通卡的 stage_code 存空串而不是 NULL —— NULL 在唯一约束里互不相等,
    # 会让同一学生攒出好几行全通卡
    __table_args__ = (
        UniqueConstraint("student_id", "card_kind", "series", "stage_code",
                         name="uq_pack_card_grant"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False, index=True)
    card_kind = Column(String(10), nullable=False)       # stage / full
    series = Column(String(30), nullable=False)
    stage_code = Column(String(20), nullable=False, default="")
    expires_at = Column(DateTime, nullable=False)
    granted_by = Column(Integer, nullable=False)          # 发码人,补书时写进 book_assignments.teacher_id
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
