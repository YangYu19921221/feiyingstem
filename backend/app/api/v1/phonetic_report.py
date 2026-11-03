"""音标学习报告接口(2026-11-03)。数从 services/phonetic_report 出,这里只管谁能看

- 老师 GET /teacher/phonetic-books/report/students/{id}?days=30   一个学生的完整报告(只本班)
- 老师 GET /teacher/phonetic-books/report/class?days=30           全班一览 + 全班最多人弱的音
- 学生 GET /phonetic-practice/report/me?days=30                    自己的简版(哪几个音还要练 + 去练的入口)
- 家长 GET /phonetic-practice/report/children/{id}?days=30         孩子的简版(只能看绑定的孩子)

挂在已有路由上(teacher/phonetic_books、phonetic_practice),main.py 不动。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
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


@teacher_router.get("/class")
async def teacher_class_report(days: int = Query(pr.DAYS), db: AsyncSession = Depends(get_db),
                               user: User = Depends(get_current_user)):
    if user.role not in ("teacher", "org_admin", "admin"):
        raise HTTPException(status_code=403, detail="只有老师能看全班的音标报告")
    days = _days(days)
    roster = await _roster(db, user)
    if roster is None:
        raise HTTPException(status_code=400, detail="平台管理员没有班级,请从学生详情页看单个学生")
    return await pr.class_overview(db, list(roster), roster, days)


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
