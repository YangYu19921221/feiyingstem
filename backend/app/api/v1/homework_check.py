"""作业批改(2026-10-30): 学生拍一页做完的英语作业,小鹰老师逐题批改、学生自己订正。规则见 services/homework_check.py。

路由挂在 api/v1/tutor.py 已有的 student_router / teacher_router 上(main.py 生产有 drift,不动它):
    GET  /student/homework-check/status             能不能用、还剩几次、一页用几次
    POST /student/homework-check                    上传一页照片(image),开始批改(后台跑),返回 id
    GET  /student/homework-check                    最近批过的(列表,不带每题)
    GET  /student/homework-check/{id}               这一页的结果(还在批时 status=pending,页面每 3 秒问一次)
    POST /student/homework-check/{id}/items/{idx}/fix      订正一题 {answer}
    POST /student/homework-check/{id}/items/{idx}/dispute  觉得批错了(只做记号给老师看)
    GET  /teacher/students/{student_id}/homework-checks    本班学生批过的作业(带正确答案,只读)
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.models.tutor import HomeworkCheck
from app.models.user import User
from app.services import homework_check as hc
from app.services import tutor as tt

student_router = APIRouter()
teacher_router = APIRouter()

# 网页先在浏览器里转成 JPEG 再传(iPhone 的 HEIC 也是),服务器的 Pillow 读不了 HEIC
IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}


@student_router.get("/homework-check/status")
async def check_status(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    ok, reason, settings = await hc.availability(db, student)
    left = (await tt.allowance_status(db, student.id, settings, student.org_id))["left"] if ok else 0
    return {"enabled": ok, "reason": reason, "left": left, "cost": hc.COST,
            "reveal_after": hc.REVEAL_AFTER, "pending": await hc.pending_of(db, student.id)}


@student_router.post("/homework-check")
async def start_check(image: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                      student: User = Depends(get_current_student)):
    ok, reason, settings = await hc.availability(db, student)
    if not ok:
        raise HTTPException(403, reason)
    if (image.content_type or "").lower() not in IMAGE_MIME:
        raise HTTPException(400, "只能发 jpg / png 照片")
    raw = await image.read(hc.MAX_BYTES + 1)
    if len(raw) > hc.MAX_BYTES:
        raise HTTPException(400, "照片太大了,换一张小一点的")
    try:
        b64, mime = await asyncio.to_thread(hc.prepare_image, raw)
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "这张照片打不开或者太小了,换一张试试")
    del raw
    # 限速在扣次数之前: 被限速的那一下不该扣
    await check_rate(str(student.id), "homework_check", [(60, 3), (3600, 30)])
    await hc.expire_stale(db, student.id)
    if await hc.pending_of(db, student.id):
        raise HTTPException(409, "上一页还在批,等它批完再拍下一页")
    if not await tt.consume(db, student.id, hc.COST, await tt.free_for(db, student.org_id, settings)):
        raise HTTPException(429, "「问小鹰老师」的次数用完了,点「请老师加次数」让老师给你加")
    try:
        row = HomeworkCheck(user_id=student.id, org_id=student.org_id, status="pending", cost=hc.COST)
        db.add(row)
        await db.commit()
        check_id = row.id
    except Exception:
        await db.rollback()
        await tt.refund(db, student.id, hc.COST)
        raise
    await hc.run_later(hc.grade_job, check_id, b64, mime)
    return {"id": check_id}


@student_router.get("/homework-check")
async def list_checks(db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    await hc.expire_stale(db, student.id)
    await hc.purge_old(db, student.id)
    await db.commit()
    return {"items": [hc.check_out(r, with_items=False) for r in await hc.list_for(db, student.id)]}


async def _mine(db: AsyncSession, student: User, check_id: int) -> HomeworkCheck:
    row = await db.get(HomeworkCheck, check_id)
    if row is None or row.user_id != student.id:
        raise HTTPException(404, "没有这一页")
    return row


@student_router.get("/homework-check/{check_id}")
async def get_check(check_id: int, db: AsyncSession = Depends(get_db), student: User = Depends(get_current_student)):
    row = await _mine(db, student, check_id)
    if row.status == "pending":
        await hc.expire_stale(db, student.id)
        await db.refresh(row)
    return hc.check_out(row)


class FixIn(BaseModel):
    answer: str = Field("", max_length=300)


@student_router.post("/homework-check/{check_id}/items/{idx}/fix")
async def fix(check_id: int, idx: int, body: FixIn, db: AsyncSession = Depends(get_db),
              student: User = Depends(get_current_student)):
    await check_rate(str(student.id), "homework_fix", [(60, 40)])
    try:
        return await hc.fix_item(db, student.id, check_id, idx, body.answer)
    except hc.NotFound:
        raise HTTPException(404, "没有这一题")
    except hc.Rule as e:
        raise HTTPException(400, str(e))


@student_router.post("/homework-check/{check_id}/items/{idx}/dispute")
async def dispute(check_id: int, idx: int, db: AsyncSession = Depends(get_db),
                  student: User = Depends(get_current_student)):
    try:
        return await hc.dispute_item(db, student.id, check_id, idx)
    except hc.NotFound:
        raise HTTPException(404, "没有这一题")
    except hc.Rule as e:
        raise HTTPException(400, str(e))


@teacher_router.get("/students/{student_id}/homework-checks")
async def teacher_checks(student_id: int, db: AsyncSession = Depends(get_db),
                         teacher: User = Depends(get_current_teacher)):
    await assert_student_in_my_class(db, teacher.id, student_id)
    rows = [r for r in await hc.list_for(db, student_id) if r.status != "pending"]
    return {"items": [hc.check_out(r, teacher=True) for r in rows]}
