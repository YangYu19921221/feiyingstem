"""音标学习报告接口(2026-11-03)。数从 services/phonetic_report 出,这里只管谁能看

- 老师 GET /teacher/phonetic-books/report/students/{id}?days=30   一个学生的完整报告(只本班)
- 老师 GET /teacher/phonetic-books/report/class?days=30&class_id=&q=&status=&page=&page_size=
                                                                    全班一览(分页 / 搜名字 / 按班 / 按状态)+ 全班最多人弱的音
- 学生 GET /phonetic-practice/report/me?days=30                    自己的简版(哪几个音还要练 + 去练的入口)
- 家长 GET /phonetic-practice/report/children/{id}?days=30         孩子的简版(只能看绑定的孩子)

挂在已有路由上(teacher/phonetic_books、phonetic_practice),main.py 不动。
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services import phonetic_report as pr

teacher_router = APIRouter()
student_router = APIRouter()

DAYS_ALLOWED = (7, 30, 90, 0)


def _days(days: int) -> int:
    if days not in DAYS_ALLOWED:
        raise HTTPException(status_code=400, detail="时间范围只能选 7 天 / 30 天 / 90 天 / 全部")
    return days


async def _roster(db: AsyncSession, user: User) -> dict[int, str] | None:
    """老师本班学生 {id: 名字};平台 admin 返回 None(不限)"""
    if user.role == "admin":
        return None
    from app.api.v1.teacher._permissions import get_my_class_student_ids
    ids = await get_my_class_student_ids(db, user.id)
    if not ids:
        return {}
    return {u.id: (u.full_name or u.username) for u in (await db.execute(
        select(User).where(User.id.in_(ids)))).scalars()}


@teacher_router.get("/students/{student_id}")
async def teacher_student_report(student_id: int, days: int = Query(pr.DAYS), db: AsyncSession = Depends(get_db),
                                 user: User = Depends(get_current_user)):
    if user.role not in ("teacher", "org_admin", "admin"):
        raise HTTPException(status_code=403, detail="只有老师能看学生的音标报告")
    days = _days(days)
    roster = await _roster(db, user)
    if roster is not None and student_id not in roster:
        raise HTTPException(status_code=403, detail="只能看你班上学生的报告")
    stu = (await db.execute(select(User).where(User.id == student_id))).scalar_one_or_none()
    if stu is None or stu.role != "student":
        raise HTTPException(status_code=404, detail="学生不存在")
    out = await pr.build(db, student_id, days)
    out["student"] = {"id": stu.id, "name": stu.full_name or stu.username}
    return out


# 全班报告算一次要把每个学生都过一遍(248 人约 1.5 秒),翻页 / 换筛选不该每次重算:
# 同一个老师 + 时间范围 + 班级 60 秒内复用。只是性能缓存,过期了重算,不影响对错;每个进程各一份
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL = 60
_CACHE_MAX = 64
PAGE_SIZES = (20, 50, 100)
STATUS = ("all", "not_started", "weak", "ok")


async def _my_classes(db: AsyncSession, user: User) -> list[dict]:
    from app.models.user import Class, ClassStudent
    rows = (await db.execute(
        select(Class.id, Class.name, func.count(ClassStudent.id))
        .join(ClassStudent, (ClassStudent.class_id == Class.id) & ClassStudent.is_active.is_(True), isouter=True)
        .where(Class.teacher_id == user.id).group_by(Class.id).order_by(Class.id))).all()
    return [{"id": i, "name": n, "students": c} for i, n, c in rows]


async def _class_roster(db: AsyncSession, user: User, class_id: Optional[int]) -> dict[int, str]:
    roster = await _roster(db, user) or {}
    if class_id is None:
        return roster
    from app.models.user import Class, ClassStudent
    ids = {sid for (sid,) in (await db.execute(
        select(ClassStudent.student_id).join(Class, Class.id == ClassStudent.class_id)
        .where(Class.id == class_id, Class.teacher_id == user.id, ClassStudent.is_active.is_(True)))).all()}
    return {k: v for k, v in roster.items() if k in ids}


@teacher_router.get("/class")
async def teacher_class_report(
    days: int = Query(pr.DAYS),
    class_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None, max_length=50),
    status: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """全班报告,分页 + 搜名字 + 按班级 + 按状态(没练过 / 有弱音 / 没弱音)。

    排序不变: 没练过的排前、其余写对率从低到高 —— 老师要找的人在第一页。
    「全班最多人弱的音」和人数统计按**当前班级**算(不受搜索 / 状态 / 翻页影响,那是全班的事)"""
    if user.role not in ("teacher", "org_admin", "admin"):
        raise HTTPException(status_code=403, detail="只有老师能看全班的音标报告")
    days = _days(days)
    if status not in STATUS:
        raise HTTPException(status_code=400, detail="筛选条件不对")
    if page_size not in PAGE_SIZES:
        raise HTTPException(status_code=400, detail="每页只能 20 / 50 / 100 人")
    if await _roster(db, user) is None:
        raise HTTPException(status_code=400, detail="平台管理员没有班级,请从学生详情页看单个学生")
    classes = await _my_classes(db, user)
    if class_id is not None and class_id not in {c["id"] for c in classes}:
        raise HTTPException(status_code=403, detail="只能看你自己的班级")

    key = (user.id, days, class_id)
    hit = _CACHE.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        full = hit[1]
    else:
        roster = await _class_roster(db, user, class_id)
        full = await pr.class_overview(db, list(roster), roster, days)
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.pop(min(_CACHE, key=lambda k: _CACHE[k][0]), None)
        _CACHE[key] = (time.monotonic(), full)

    rows = full["students"]
    if q and q.strip():
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (r["name"] or "").lower()]
    if status == "not_started":
        rows = [r for r in rows if not r["has_data"]]
    elif status == "weak":
        rows = [r for r in rows if r["has_data"] and r["weak"]]
    elif status == "ok":
        rows = [r for r in rows if r["has_data"] and not r["weak"]]
    total = len(rows)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    return {
        "days": days, "class_id": class_id, "classes": classes,
        "class_weak": full["class_weak"], "not_started": full["not_started"],
        "class_total": len(full["students"]),
        "counts": {"all": len(full["students"]), "not_started": full["not_started"],
                   "weak": sum(1 for r in full["students"] if r["has_data"] and r["weak"]),
                   "ok": sum(1 for r in full["students"] if r["has_data"] and not r["weak"])},
        "total": total, "page": page, "pages": pages, "page_size": page_size,
        "students": rows[(page - 1) * page_size: page * page_size],
    }


@student_router.get("/me")
async def my_report(days: int = Query(pr.DAYS), db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="学生才有自己的音标报告")
    return pr.brief(await pr.build(db, user.id, _days(days)))


@student_router.get("/children/{student_id}")
async def child_report(student_id: int, days: int = Query(pr.DAYS), db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if user.role != "parent":
        raise HTTPException(status_code=403, detail="家长才能看孩子的音标报告")
    from app.models.user import ParentStudentLink
    linked = (await db.execute(select(ParentStudentLink.id).where(
        ParentStudentLink.parent_id == user.id, ParentStudentLink.student_id == student_id).limit(1)
    )).scalar_one_or_none()
    if linked is None:
        raise HTTPException(status_code=403, detail="只能看你绑定的孩子")
    return pr.brief(await pr.build(db, student_id, _days(days)))
