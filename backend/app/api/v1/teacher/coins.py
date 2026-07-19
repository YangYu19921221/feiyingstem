"""教师端-金币管理 API

金币流水的增删改查 + 分页搜索 + 每日结算 + 班级余额。
权限:仅本班老师 + 管理员(admin/org_admin)。教师只能操作自己班级里的学生。
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today
from app.models.user import User, Class, ClassStudent
from app.models.coin import StudentCoin, CoinTransaction
from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import get_my_class_student_ids
from app.services import coin_service

router = APIRouter()

SOURCE_LABELS = {"task": "完成作业", "word_king": "单词王", "manual": "手动调整", "redeem": "兑换消耗"}


# ---------- 权限:算出当前老师可见的学生 id 集合 ----------
async def _visible_student_ids(db: AsyncSession, user: User) -> Optional[set[int]]:
    """管理员返回 None(全部可见,配合 tenancy 机构过滤);普通老师返回本班学生 id 集合。"""
    if user.role in ("admin", "org_admin"):
        return None
    return await get_my_class_student_ids(db, user.id)


async def _assert_can_touch(db: AsyncSession, user: User, student_id: int) -> None:
    ids = await _visible_student_ids(db, user)
    if ids is not None and student_id not in ids:
        raise HTTPException(status_code=403, detail="无权操作该学生")


# ---------- Schemas ----------
class AdjustRequest(BaseModel):
    student_id: int
    amount: int = Field(..., description="正=发放,负=扣减/兑换")
    reason: Optional[str] = Field(None, max_length=200)
    source: str = Field("manual", description="manual 手动 / redeem 兑换")


class TxUpdateRequest(BaseModel):
    amount: Optional[int] = None
    reason: Optional[str] = Field(None, max_length=200)


class TxOut(BaseModel):
    id: int
    student_id: int
    student_name: Optional[str]
    amount: int
    balance_after: int
    source: str
    source_label: str
    reason: Optional[str]
    operator_id: Optional[int]
    created_at: datetime


# ---------- 结算(打开页面时调,幂等补发系统币) ----------
@router.post("/coins/settle")
async def settle(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,默认今天"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """幂等结算某日系统金币(单词王+2、完成全部作业+1)。重复调用不会多发。"""
    d = _parse_date(target_date)
    result = await coin_service.settle_day(db, d)
    await db.commit()
    return {"date": d.isoformat(), **result}


# ---------- 班级余额 ----------
@router.get("/coins/balances")
async def balances(
    class_id: int = Query(...),
    q: Optional[str] = Query(None, description="按学生姓名/用户名搜索"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """某班每个学生的金币余额(含从没有流水、余额为0的学生)。"""
    cls = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if cls is None:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role not in ("admin", "org_admin") and cls.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="不是你的班级")

    conds = [ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True),
             User.role == "student"]
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(User.full_name.like(like), User.username.like(like)))

    rows = (await db.execute(
        select(User.id, User.full_name, User.username,
               func.coalesce(StudentCoin.balance, 0))
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .outerjoin(StudentCoin, StudentCoin.user_id == User.id)
        .where(and_(*conds))
        .order_by(func.coalesce(StudentCoin.balance, 0).desc(), User.id)
    )).all()

    return {
        "class_id": class_id,
        "class_name": cls.name,
        "students": [
            {"student_id": uid, "name": full or username, "username": username, "balance": bal}
            for uid, full, username, bal in rows
        ],
    }


# ---------- 流水列表(分页 + 搜索 + 班级/来源筛选) ----------
@router.get("/coins/transactions")
async def list_transactions(
    class_id: Optional[int] = Query(None),
    student_id: Optional[int] = Query(None),
    source: Optional[str] = Query(None, description="task/word_king/manual/redeem"),
    q: Optional[str] = Query(None, description="按学生姓名/用户名搜索"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """金币流水分页。老师只看得到自己班学生的流水;管理员看本机构全部。"""
    visible = await _visible_student_ids(db, current_user)

    conds = []
    # 权限收口:普通老师限定在本班学生
    if visible is not None:
        if not visible:
            return {"total": 0, "page": page, "page_size": page_size, "items": []}
        conds.append(CoinTransaction.user_id.in_(visible))
    # 指定班级 → 交集到该班学生
    if class_id is not None:
        cls_ids = {r[0] for r in (await db.execute(
            select(ClassStudent.student_id).where(and_(
                ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
        )).all()}
        conds.append(CoinTransaction.user_id.in_(cls_ids or {-1}))
    if student_id is not None:
        conds.append(CoinTransaction.user_id == student_id)
    if source:
        conds.append(CoinTransaction.source == source)
    if q:
        like = f"%{q.strip()}%"
        name_ids = {r[0] for r in (await db.execute(
            select(User.id).where(or_(User.full_name.like(like), User.username.like(like)))
        )).all()}
        conds.append(CoinTransaction.user_id.in_(name_ids or {-1}))

    where = and_(*conds) if conds else True
    total = (await db.execute(
        select(func.count(CoinTransaction.id)).where(where)
    )).scalar() or 0

    rows = (await db.execute(
        select(CoinTransaction, User.full_name, User.username)
        .join(User, User.id == CoinTransaction.user_id)
        .where(where)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).all()

    items = [
        TxOut(
            id=tx.id, student_id=tx.user_id, student_name=full or username,
            amount=tx.amount, balance_after=tx.balance_after,
            source=tx.source, source_label=SOURCE_LABELS.get(tx.source, tx.source),
            reason=tx.reason, operator_id=tx.operator_id, created_at=tx.created_at,
        )
        for tx, full, username in rows
    ]
    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ---------- 增:手动增减 / 兑换 ----------
@router.post("/coins/adjust")
async def adjust(
    body: AdjustRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """老师手动给学生加/减金币,或记一笔兑换消耗(负数)。不足扣不允许扣成负数。"""
    await _assert_can_touch(db, current_user, body.student_id)
    if body.amount == 0:
        raise HTTPException(status_code=400, detail="变动值不能为 0")
    src = body.source if body.source in ("manual", "redeem") else "manual"

    student = (await db.execute(select(User).where(User.id == body.student_id))).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="学生不存在")

    coin = (await db.execute(
        select(StudentCoin).where(StudentCoin.user_id == body.student_id)
    )).scalar_one_or_none()
    cur = coin.balance if coin else 0
    if cur + body.amount < 0:
        raise HTTPException(status_code=400, detail=f"金币不足(当前 {cur},无法扣 {-body.amount})")

    tx = await coin_service.apply_delta(
        db, body.student_id, student.org_id or 1, body.amount, src,
        reason=body.reason, operator_id=current_user.id,
    )
    await db.commit()
    return {"success": True, "tx_id": tx.id if tx else None, "balance_after": tx.balance_after if tx else cur}


# ---------- 改:修改流水(仅手动/兑换;自动发放不可改) ----------
@router.patch("/coins/transactions/{tx_id}")
async def update_transaction(
    tx_id: int,
    body: TxUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """改流水金额/事由。系统自动发放(task/word_king)不可改,避免破坏结算幂等。
    改金额会同步修正学生余额(按差值增减),并回填后续所有流水的 balance_after 不做——
    仅调整当前余额(balance_after 为历史留档,不追溯重算)。"""
    tx = (await db.execute(select(CoinTransaction).where(CoinTransaction.id == tx_id))).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="流水不存在")
    await _assert_can_touch(db, current_user, tx.user_id)
    if tx.source in ("task", "word_king"):
        raise HTTPException(status_code=400, detail="系统自动发放的流水不可修改")

    coin = (await db.execute(select(StudentCoin).where(StudentCoin.user_id == tx.user_id))).scalar_one_or_none()
    if body.amount is not None and body.amount != tx.amount:
        if body.amount == 0:
            raise HTTPException(status_code=400, detail="变动值不能为 0")
        delta = body.amount - tx.amount  # 余额需要多变动的量
        new_bal = (coin.balance if coin else 0) + delta
        if new_bal < 0:
            raise HTTPException(status_code=400, detail="修改后余额为负,不允许")
        if coin:
            coin.balance = new_bal
        tx.balance_after = (tx.balance_after or 0) + delta
        tx.amount = body.amount
    if body.reason is not None:
        tx.reason = body.reason
    await db.commit()
    return {"success": True}


# ---------- 删:删除流水(仅手动/兑换;回滚余额) ----------
@router.delete("/coins/transactions/{tx_id}")
async def delete_transaction(
    tx_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """删流水并回滚学生余额。系统自动发放不可删(否则下次结算又补回,徒劳)。"""
    tx = (await db.execute(select(CoinTransaction).where(CoinTransaction.id == tx_id))).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="流水不存在")
    await _assert_can_touch(db, current_user, tx.user_id)
    if tx.source in ("task", "word_king"):
        raise HTTPException(status_code=400, detail="系统自动发放的流水不可删除")

    coin = (await db.execute(select(StudentCoin).where(StudentCoin.user_id == tx.user_id))).scalar_one_or_none()
    if coin:
        new_bal = coin.balance - tx.amount
        coin.balance = max(0, new_bal)  # 撤销这笔变动
    await db.delete(tx)
    await db.commit()
    return {"success": True}


def _parse_date(s: Optional[str]) -> date:
    if not s:
        return local_today()
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式错误,应为 YYYY-MM-DD")
