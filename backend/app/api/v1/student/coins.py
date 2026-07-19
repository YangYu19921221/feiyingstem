"""学生端-我的金币:看自己的余额 + 获得/消费明细(只读)"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.coin import StudentCoin, CoinTransaction
from app.api.v1.auth import get_current_student

router = APIRouter()

SOURCE_LABELS = {"task": "完成作业", "word_king": "单词王", "manual": "老师奖励", "redeem": "兑换消耗"}


class MyTx(BaseModel):
    id: int
    amount: int
    source: str
    source_label: str
    reason: Optional[str]
    created_at: datetime
    day_tasks_done: Optional[int] = None
    day_words: Optional[int] = None


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
    from app.services.coin_service import day_activity_map
    day_cache: dict = {}
    for t in rows:
        if t.source in ("task", "word_king"):
            bj_day = (t.created_at + timedelta(hours=8)).date()
            if bj_day not in day_cache:
                amap = await day_activity_map(db, [current_user.id], bj_day)
                day_cache[bj_day] = amap.get(current_user.id, {"tasks_done": 0, "words": 0})

    items = []
    for t in rows:
        dt = dw = None
        if t.source in ("task", "word_king"):
            bj_day = (t.created_at + timedelta(hours=8)).date()
            act = day_cache.get(bj_day, {})
            dt = act.get("tasks_done", 0)
            dw = act.get("words", 0)
        items.append(MyTx(
            id=t.id, amount=t.amount, source=t.source,
            source_label=SOURCE_LABELS.get(t.source, t.source),
            reason=t.reason, created_at=t.created_at,
            day_tasks_done=dt, day_words=dw,
        ))

    return {"balance": balance, "total": total, "page": page, "page_size": page_size, "items": items}
