"""学生端-我的金币:看自己的余额 + 获得/消费明细(只读)"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_day_utc_range
from app.models.user import User
from app.models.coin import StudentCoin, CoinTransaction, CoinReward, CoinRedeemRequest
from app.api.v1.auth import get_current_student

router = APIRouter()

SOURCE_LABELS = {"task": "完成作业", "unit": "完成单元", "word_king": "单词王", "manual": "老师奖励", "redeem": "兑换消耗"}


class MyTx(BaseModel):
    id: int
    amount: int
    source: str
    source_label: str
    reason: Optional[str]
    created_at: datetime
    day_tasks_done: Optional[int] = None
    day_tasks_total: Optional[int] = None
    day_words: Optional[int] = None
    day_units_done: Optional[int] = None
    king_label: Optional[str] = None  # word_king 徽章文案(后端按北京时间算)


@router.get("/word-king-status")
async def word_king_status(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD,默认今天(实时)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我是不是某天的单词王(戴 👑 用)。默认今天=实时最高;可查历史某天。
    多班取任一班是王即算(学生通常只在一个班)。"""
    from datetime import date as _date
    from app.core.timeutil import local_today
    from app.models.user import ClassStudent
    from app.services.coin_service import word_kings_for_class

    if target_date:
        try:
            d = _date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式错误")
    else:
        d = local_today()

    class_ids = (await db.execute(
        select(ClassStudent.class_id).where(and_(
            ClassStudent.student_id == current_user.id, ClassStudent.is_active.is_(True)))
    )).scalars().all()
    is_king = False
    for cid in class_ids:
        kings = await word_kings_for_class(db, cid, d)
        if current_user.id in kings:
            is_king = True
            break
    return {"date": d.isoformat(), "is_word_king": is_king}


@router.get("/coins/today")
async def my_coins_today(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """今天的金币进度(学生端规则卡):任务完成几/几、任务币是否到手、单词王战况。

    口径与发币完全一致(走 coin_service 同一批函数),不在前端另算一套。
    """
    from app.core.timeutil import local_today
    from app.models.coin import CoinTransaction as CT
    from app.services import coin_service as cs

    d = local_today()
    key_date = d.strftime("%Y%m%d")
    total, done = (await cs.task_progress_on_day(db, [current_user.id], d)).get(
        current_user.id, (0, 0))
    got_task = (await db.execute(
        select(CT.id).where(CT.dedup_key == f"task:{current_user.id}:{key_date}").limit(1)
    )).scalar_one_or_none() is not None
    got_king = (await db.execute(
        select(CT.id).where(CT.dedup_key == f"word_king:{current_user.id}:{key_date}").limit(1)
    )).scalar_one_or_none() is not None
    earned_today = (await db.execute(
        select(func.coalesce(func.sum(CT.amount), 0)).where(and_(
            CT.user_id == current_user.id,
            CT.amount > 0,
            CT.created_at >= local_day_utc_range(d)[0],
            CT.created_at < local_day_utc_range(d)[1],
        ))
    )).scalar() or 0

    return {
        "date": d.isoformat(),
        "auto_coin": await cs.is_auto_coin_org(db, current_user.org_id),
        "tasks_total": total,
        "tasks_done": done,
        "tasks_all_done": total > 0 and total == done,
        "task_coin_earned": got_task,       # 任务币已到手(+1)
        "word_king_coin_earned": got_king,  # 单词王币已到手(次日 0 点后才可能为真)
        "earned_today": int(earned_today),   # 今天已进账(含老师手动奖励)
        "daily_cap": cs.DAILY_CAP,
        "task_reward": cs.TASK_REWARD,
        "word_king_reward": cs.WORD_KING_REWARD,
    }


@router.get("/word-king-race")
async def word_king_race_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """今日单词王争夺战况 + 一句提示语(学生端「可能有人超越你」用)。

    今天的榜单要到 24 点才结算,所以领先只是"暂列第一"。提示语由后端算好
    (含北京时区判断),前端直接显示,避免各页面各写一套口径不同的文案。
    """
    from app.core.timeutil import local_today
    from app.services.coin_service import word_king_race, is_auto_coin_org

    d = local_today()
    race = await word_king_race(db, current_user.id, d)
    auto = await is_auto_coin_org(db, current_user.org_id)

    if not race["in_class"]:
        tip, level = "", "none"
    elif race["my_words"] <= 0:
        tip, level = "今天还没开始学词。学得最多的同学 24 点会被评为单词王!", "idle"
    elif race["is_leading"] and race["tied"]:
        tip, level = (
            f"你和别人并列第一({race['my_words']} 词)!24 点结算,再多学几个才稳。", "tied")
    elif race["is_leading"] and race["chasers"] > 0:
        tip, level = (
            f"你暂列第一({race['my_words']} 词),但有 {race['chasers']} 人紧追不舍,"
            "随时可能被超越!24 点结算。", "chased")
    elif race["is_leading"]:
        tip, level = (
            f"你暂列第一({race['my_words']} 词)!别人随时可能反超,24 点结算才算数。", "leading")
    else:
        tip, level = (
            f"第一名 {race['top_words']} 词,你 {race['my_words']} 词,"
            f"还差 {race['gap']} 个就能追上!24 点结算。", "behind")

    return {
        "date": d.isoformat(),
        **race,
        "tip": tip,
        "level": level,
        "reward": 1,          # 当上单词王额外加几颗金币
        "auto_coin": auto,    # 手动模式下不自动发币,文案要改口
    }


@router.get("/coins/me")
async def my_coins(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我的金币:总余额 + 分页流水(自己只读,不能改)。"""
    balance = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == current_user.id)
    )).scalar() or 0

    total = (await db.execute(
        select(func.count(CoinTransaction.id)).where(CoinTransaction.user_id == current_user.id)
    )).scalar() or 0

    rows = (await db.execute(
        select(CoinTransaction)
        .where(CoinTransaction.user_id == current_user.id)
        .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    # 系统发放流水附带「当天完成任务数+学习单词数」,按流水各自日期算
    from app.services.coin_service import day_activity_map, word_king_label, reason_date
    day_cache: dict = {}
    for t in rows:
        if t.source in ("task", "unit", "word_king"):
            bj_day = reason_date(t.reason) or (t.created_at + timedelta(hours=8)).date()
            if bj_day not in day_cache:
                amap = await day_activity_map(db, [current_user.id], bj_day)
                day_cache[bj_day] = amap.get(
                    current_user.id,
                    {"tasks_done": 0, "tasks_total": 0, "words": 0, "units_done": 0})

    items = []
    for t in rows:
        dt = dtt = dw = du = None
        if t.source in ("task", "unit", "word_king"):
            bj_day = reason_date(t.reason) or (t.created_at + timedelta(hours=8)).date()
            act = day_cache.get(bj_day, {})
            dt = act.get("tasks_done", 0)
            dtt = act.get("tasks_total", 0)
            dw = act.get("words", 0)
            du = act.get("units_done", 0)
        items.append(MyTx(
            id=t.id, amount=t.amount, source=t.source,
            source_label=SOURCE_LABELS.get(t.source, t.source),
            reason=t.reason, created_at=t.created_at,
            day_tasks_done=dt, day_tasks_total=dtt, day_words=dw, day_units_done=du,
            king_label=word_king_label(t.reason) if t.source == "word_king" else None,
        ))

    return {"balance": balance, "total": total, "page": page, "page_size": page_size, "items": items}


# ========================================
# 学生申请兑换商品
# ========================================

class RedeemApply(BaseModel):
    reward_id: int


@router.get("/rewards")
async def list_available_rewards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """学生可兑换的商品(仅上架,带图);附我的余额 + 各商品是否有待审批申请。"""
    balance = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == current_user.id)
    )).scalar() or 0
    rows = (await db.execute(
        select(CoinReward).where(CoinReward.is_active == 1)
        .order_by(CoinReward.sort_order, CoinReward.id)
    )).scalars().all()
    # 我已有待审批申请的商品(防重复申请提示)
    pending_reward_ids = set((await db.execute(
        select(CoinRedeemRequest.reward_id).where(and_(
            CoinRedeemRequest.student_id == current_user.id,
            CoinRedeemRequest.status == "pending",
        ))
    )).scalars().all())
    return {
        "balance": balance,
        "rewards": [
            {"id": r.id, "name": r.name, "cost": r.cost, "note": r.note,
             "image_url": r.image_url,
             "stock": r.stock, "sold_out": r.stock is not None and r.stock <= 0,
             "pending": r.id in pending_reward_ids}
            for r in rows
        ],
    }


@router.get("/redeem-requests/mine")
async def my_redeem_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我的兑换申请记录(申请中/已通过/已拒绝)。"""
    rows = (await db.execute(
        select(CoinRedeemRequest).where(CoinRedeemRequest.student_id == current_user.id)
        .order_by(CoinRedeemRequest.created_at.desc()).limit(50)
    )).scalars().all()
    return [
        {"id": r.id, "reward_name": r.reward_name, "cost": r.cost, "status": r.status,
         "created_at": r.created_at, "reviewed_at": r.reviewed_at}
        for r in rows
    ]


@router.post("/redeem-requests")
async def apply_redeem(
    body: RedeemApply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """发起兑换申请(不立即扣币,等老师审批)。校验上架/库存/余额软检查/防重复申请。"""
    reward = (await db.execute(
        select(CoinReward).where(CoinReward.id == body.reward_id)
    )).scalar_one_or_none()
    if reward is None or not reward.is_active:
        raise HTTPException(status_code=404, detail="商品不存在或已下架")
    if reward.stock is not None and reward.stock <= 0:
        raise HTTPException(status_code=400, detail="该商品已兑完")
    balance = (await db.execute(
        select(StudentCoin.balance).where(StudentCoin.user_id == current_user.id)
    )).scalar() or 0
    if balance < reward.cost:
        raise HTTPException(status_code=400, detail=f"金币不足(当前 {balance},需 {reward.cost})")
    # 同一商品已有待审批申请 → 不重复提交
    dup = (await db.execute(
        select(CoinRedeemRequest.id).where(and_(
            CoinRedeemRequest.student_id == current_user.id,
            CoinRedeemRequest.reward_id == body.reward_id,
            CoinRedeemRequest.status == "pending",
        )).limit(1)
    )).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(status_code=400, detail="你已申请过该商品,等老师审批")

    req = CoinRedeemRequest(
        student_id=current_user.id, org_id=current_user.org_id or 1,
        reward_id=reward.id, reward_name=reward.name, cost=reward.cost, status="pending",
    )
    db.add(req)
    await db.commit()
    return {"success": True, "request_id": req.id}
