"""语法小课(句子积木)接口(2026-11-15,第一步: 样课)。规则见 services/grammar_course.py 文件头

路由挂在 tutor.py 的 student_router 上(main.py 生产有 drift,不动它),地址是 /api/v1/student/grammar/*。
老师、机构管理员、平台管理员试课也走这几个接口: 用 get_current_user,谁能进由 grammar_course.can_enter 判。

GET  /student/grammar/lessons                     课表: 开没开、每节上完过没有;entry = 工作台上放不放入口
POST /student/grammar/lessons/{lesson_id}/start   开始 / 接着上一节课: 整节课要用的东西(没有答案)+ 做到哪了
GET  /student/grammar/runs/{run_id}               这次上课现在做到哪了(页面上的进度旧了时重新取)
POST /student/grammar/runs/{run_id}/answer        孩子点了一下: 判对错,给提示或给整句;全做完了带上小结
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.models.grammar import GrammarRun
from app.models.user import User
from app.services import grammar_course as gc

student_router = APIRouter()


class StartIn(BaseModel):
    fresh: bool = False          # True = 不接着上次的,从头再学一遍


class AnswerIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=40)
    part: int = Field(0, ge=0, le=60)
    # 选第几个(数字)/ 点的哪一块({"r": 第几排, "i": 第几块})/ 排好的顺序(一串数字)
    answer: Any = None


async def _must_enter(db: AsyncSession, user: User) -> None:
    ok, reason = await gc.can_enter(db, user)
    if not ok:
        raise HTTPException(403, detail={"code": "grammar_closed", "message": reason})


def _lesson(lesson_id: int) -> dict:
    ls = gc.LESSONS.get(lesson_id)
    if ls is None:
        raise HTTPException(404, detail={"code": "no_lesson", "message": "没有这节课"})
    return ls


async def _own_run(db: AsyncSession, user_id: int, run_id: int) -> GrammarRun:
    # populate_existing: 作答是一条条件 UPDATE,不会同步会话里已经读出来的那个对象;不加会读到旧进度
    run = (await db.execute(
        select(GrammarRun).where(GrammarRun.id == run_id).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if run is None or run.user_id != user_id:
        raise HTTPException(404, detail={"code": "no_run", "message": "没有这次上课记录,回课表重新点开"})
    return run


@student_router.get("/grammar/lessons")
async def grammar_lessons(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ok, reason = await gc.can_enter(db, user)
    done = await gc.done_map(db, user.id) if ok else {}
    lines = []
    for line in gc.LINES if ok else []:
        lessons = []
        for ls in line["lessons"]:
            d = done.get(ls["id"])
            lessons.append({**gc.lesson_brief(ls), "done": d is not None, "times": d["times"] if d else 0,
                            "best": d["best"] if d else None})
        lines.append({"id": line["id"], "name": line["name"], "sub": line["sub"], "lessons": lessons})
    scope = (await gc.get_settings(db))["scope"]
    return {"enabled": ok, "reason": reason, "preview": user.role in gc.STAFF_ROLES,
            "entry": gc.show_staff_entry(user, scope), "lines": lines}


@student_router.post("/grammar/lessons/{lesson_id}/start")
async def grammar_start(lesson_id: int, body: Optional[StartIn] = None, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    await _must_enter(db, user)
    ls = _lesson(lesson_id)
    await check_rate(str(user.id), "grammar_start", [(60, 30)])
    run, resumed = await gc.start_run(db, user, ls, fresh=bool(body and body.fresh))
    view = gc.run_view(ls, run, resumed)      # 先算好再提交: 提交后 ORM 对象会过期
    await db.commit()
    return view


@student_router.get("/grammar/runs/{run_id}")
async def grammar_run(run_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _must_enter(db, user)
    run = await _own_run(db, user.id, run_id)
    ls = _lesson(run.lesson_id)
    return {"run_id": run.id, "version": run.version, "state": gc.state_view(ls, run.state),
            "finish": gc.summary(ls, run.state) if run.finished_at is not None else None}


@student_router.post("/grammar/runs/{run_id}/answer")
async def grammar_answer(run_id: int, body: AnswerIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    await _must_enter(db, user)
    user_id = user.id
    # 一节课孩子每点一下交一次;正常上课一分钟几十下,脚本乱交的压下来
    await check_rate(str(user_id), "grammar_answer", [(60, 240)])
    if isinstance(body.answer, (list, dict, str)) and len(body.answer) > 40:
        raise HTTPException(400, detail={"code": "bad_answer", "message": "这一步交的东西不对,再点一次"})
    run = await _own_run(db, user_id, run_id)
    ls = _lesson(run.lesson_id)
    try:
        return await gc.answer(db, run, ls, body.key, body.part, body.answer)
    except LookupError:
        raise HTTPException(404, detail={"code": "no_item", "message": "这节课里没有这道题"})
    except gc.Stale:
        now = await _own_run(db, user_id, run_id)
        raise HTTPException(409, detail={
            "code": "stale", "message": "进度变了,已经按最新的重新摆好",
            "version": now.version, "state": gc.state_view(ls, now.state),
            "finish": gc.summary(ls, now.state) if now.finished_at is not None else None,
        })
