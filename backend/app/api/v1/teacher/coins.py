"""教师端-金币管理 API

金币流水的增删改查 + 分页搜索 + 每日结算 + 班级余额。
权限:仅本班老师 + 管理员(admin/org_admin)。教师只能操作自己班级里的学生。
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_day_utc_range
from app.models.user import User, Class, ClassStudent
from app.models.coin import StudentCoin, CoinTransaction, CoinReward
from app.models.learning import LearningRecord
from app.models.word import Word
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


class RewardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    cost: int = Field(..., gt=0, description="所需金币,正整数")
    stock: Optional[int] = Field(None, ge=0, description="库存;不填=不限量")
    note: Optional[str] = Field(None, max_length=200)


class RewardUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    cost: Optional[int] = Field(None, gt=0)
    stock: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=200)


class RedeemRequest(BaseModel):
    student_id: int
    reward_id: int


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
    # 系统发放(task/word_king)附带:该流水所在日期的当天完成任务数 + 学习单词数
    day_tasks_done: Optional[int] = None
    day_words: Optional[int] = None
    king_label: Optional[str] = None  # word_king 徽章文案(后端按北京时间算:今日/昨日单词王)


@router.get("/coins/word-kings")
async def word_kings(
    class_id: int = Query(...),
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,默认今天(实时)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """某班某天的单词王 student_id 列表(戴 👑 用)。今天=实时最高,历史=当天结果。"""
    cls = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if cls is None:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role not in ("admin", "org_admin") and cls.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="不是你的班级")
    d = _parse_date(target_date)
    kings = await coin_service.word_kings_for_class(db, class_id, d)
    return {"date": d.isoformat(), "class_id": class_id, "king_ids": sorted(kings)}


@router.get("/coins/word-king-banner")
async def word_king_banner(
    class_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """金币流水页顶部横幅:昨天单词王(已定)+ 今日实时单词王(未结束,含词数)。
    并列都返回。名字取 full_name,空则 username。"""
    cls = (await db.execute(select(Class).where(Class.id == class_id))).scalar_one_or_none()
    if cls is None:
        raise HTTPException(status_code=404, detail="班级不存在")
    if current_user.role not in ("admin", "org_admin") and cls.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="不是你的班级")

    today = local_today()
    yesterday = today - timedelta(days=1)

    async def _detail(d) -> list[dict]:
        king_ids = await coin_service.word_kings_for_class(db, class_id, d)
        if not king_ids:
            return []
        day_start, day_end = local_day_utc_range(d)
        # 每王的当日词量
        rows = (await db.execute(
            select(
                LearningRecord.user_id,
                func.count(func.distinct(func.lower(Word.word))),
            )
            .join(Word, Word.id == LearningRecord.word_id)
            .where(and_(
                LearningRecord.user_id.in_(king_ids),
                LearningRecord.created_at >= day_start,
                LearningRecord.created_at < day_end,
            ))
            .group_by(LearningRecord.user_id)
        )).all()
        wc = {uid: v for uid, v in rows}
        users = {u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(king_ids))
        )).scalars().all()}
        return [
            {"student_id": uid, "name": (users[uid].full_name or users[uid].username) if uid in users else str(uid),
             "words": wc.get(uid, 0)}
            for uid in sorted(king_ids)
        ]

    return {
        "class_id": class_id,
        "yesterday": {"date": yesterday.isoformat(), "kings": await _detail(yesterday)},
        "today": {"date": today.isoformat(), "kings": await _detail(today)},
    }


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
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,只看某天流水"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """金币流水分页。老师只看得到自己班学生的流水;管理员看本机构全部。"""
    visible = await _visible_student_ids(db, current_user)

    conds = []
    # 按北京日历日筛选(created_at 存 UTC,转成当日 UTC 区间比较)
    if target_date:
        d = _parse_date(target_date)
        day_start, day_end = local_day_utc_range(d)
        conds.append(and_(
            CoinTransaction.created_at >= day_start,
            CoinTransaction.created_at < day_end,
        ))
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

    # 给本页系统发放流水(task/word_king)附带「当天完成任务数+学习单词数」。
    # 按 (学生, 流水日期) 去重批量查,翻历史时每条对应它自己那天。
    from app.services.coin_service import day_activity_map, word_king_label, reason_date
    sys_keys: dict[tuple[int, date], dict] = {}
    for tx, _f, _u in rows:
        if tx.source in ("task", "word_king"):
            # 用 reason 里的所属日期(非 created_at:单词王次日结算会差一天)
            bj_day = reason_date(tx.reason) or (tx.created_at + timedelta(hours=8)).date()
            sys_keys[(tx.user_id, bj_day)] = {}
    for (uid, day) in list(sys_keys.keys()):
        amap = await day_activity_map(db, [uid], day)
        sys_keys[(uid, day)] = amap.get(uid, {"tasks_done": 0, "words": 0})

    items = []
    for tx, full, username in rows:
        extra_tasks = extra_words = None
        if tx.source in ("task", "word_king"):
            bj_day = reason_date(tx.reason) or (tx.created_at + timedelta(hours=8)).date()
            act = sys_keys.get((tx.user_id, bj_day), {})
            extra_tasks = act.get("tasks_done", 0)
            extra_words = act.get("words", 0)
        items.append(TxOut(
            id=tx.id, student_id=tx.user_id, student_name=full or username,
            amount=tx.amount, balance_after=tx.balance_after,
            source=tx.source, source_label=SOURCE_LABELS.get(tx.source, tx.source),
            reason=tx.reason, operator_id=tx.operator_id, created_at=tx.created_at,
            day_tasks_done=extra_tasks, day_words=extra_words,
            king_label=word_king_label(tx.reason) if tx.source == "word_king" else None,
        ))
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


# ========================================
# 兑换商品(奖励)管理 + 按商品兑换
# ========================================

def _reward_out(r: CoinReward) -> dict:
    return {
        "id": r.id, "name": r.name, "cost": r.cost, "stock": r.stock,
        "is_active": bool(r.is_active), "note": r.note, "sort_order": r.sort_order,
    }


@router.get("/coins/rewards")
async def list_rewards(
    include_inactive: bool = Query(True, description="是否含已下架"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """本机构的兑换商品列表(tenancy 自动按 org 过滤)。"""
    stmt = select(CoinReward).order_by(CoinReward.sort_order, CoinReward.id)
    if not include_inactive:
        stmt = stmt.where(CoinReward.is_active == 1)
    rows = (await db.execute(stmt)).scalars().all()
    return [_reward_out(r) for r in rows]


@router.post("/coins/rewards", status_code=status.HTTP_201_CREATED)
async def create_reward(
    body: RewardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """新增兑换商品。org_id 由 tenancy 写侧自动打戳(admin 上下文落 NULL=平台级)。"""
    max_sort = (await db.execute(select(func.max(CoinReward.sort_order)))).scalar() or 0
    r = CoinReward(name=body.name.strip(), cost=body.cost, stock=body.stock,
                   note=body.note, sort_order=max_sort + 1, is_active=1)
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _reward_out(r)


@router.patch("/coins/rewards/{reward_id}")
async def update_reward(
    reward_id: int,
    body: RewardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """改商品(名称/金币/库存/上下架/备注)。tenancy 过滤保证只能改本机构的。"""
    r = (await db.execute(select(CoinReward).where(CoinReward.id == reward_id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="商品不存在")
    if body.name is not None:
        r.name = body.name.strip()
    if body.cost is not None:
        r.cost = body.cost
    if body.stock is not None:
        r.stock = body.stock
    if body.is_active is not None:
        r.is_active = 1 if body.is_active else 0
    if body.note is not None:
        r.note = body.note
    await db.commit()
    return _reward_out(r)


@router.delete("/coins/rewards/{reward_id}")
async def delete_reward(
    reward_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """删商品(历史兑换流水已把商品名写进 reason,删商品不影响记录可读性)。"""
    r = (await db.execute(select(CoinReward).where(CoinReward.id == reward_id))).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="商品不存在")
    await db.delete(r)
    await db.commit()
    return {"success": True}


@router.post("/coins/redeem")
async def redeem(
    body: RedeemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """给学生兑换某商品:扣 cost 金币 + 记兑换流水(reason=商品名)+ 扣库存。
    金币不足或缺货则拒绝。"""
    await _assert_can_touch(db, current_user, body.student_id)
    reward = (await db.execute(
        select(CoinReward).where(CoinReward.id == body.reward_id)
    )).scalar_one_or_none()
    if reward is None:
        raise HTTPException(status_code=404, detail="商品不存在")
    if not reward.is_active:
        raise HTTPException(status_code=400, detail="该商品已下架")
    if reward.stock is not None and reward.stock <= 0:
        raise HTTPException(status_code=400, detail="该商品库存不足")

    student = (await db.execute(select(User).where(User.id == body.student_id))).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="学生不存在")

    coin = (await db.execute(
        select(StudentCoin).where(StudentCoin.user_id == body.student_id)
    )).scalar_one_or_none()
    cur = coin.balance if coin else 0
    if cur < reward.cost:
        raise HTTPException(status_code=400, detail=f"金币不足(当前 {cur},需 {reward.cost})")

    tx = await coin_service.apply_delta(
        db, body.student_id, student.org_id or 1, -reward.cost, "redeem",
        reason=f"兑换:{reward.name}", operator_id=current_user.id,
    )
    if reward.stock is not None:
        reward.stock -= 1
    await db.commit()
    return {"success": True, "tx_id": tx.id if tx else None,
            "balance_after": tx.balance_after if tx else cur,
            "stock": reward.stock}


def _parse_date(s: Optional[str]) -> date:
    """None/today→服务器北京今天;yesterday→昨天;否则按 YYYY-MM-DD。
    前端不自己算日期,传相对词让后端(北京时区)解释,避免用户设备时区出错。"""
    if not s or s == "today":
        return local_today()
    if s == "yesterday":
        return local_today() - timedelta(days=1)
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式错误,应为 YYYY-MM-DD")
