"""离开记录 / 摄像头同意 / 家长「今天」(2026-10-31)。规则真源 services/focus_watch.py 文件头。

挂在 presence.router 下(**main.py 没动**,它在生产有 drift)。
学生: GET  /student/presence/camera          摄像头开不开(家长同意了才开)
      POST /student/presence/camera-status   这台设备今天摄像头开起来没有
      (离开记录走 presence.py 原来的 POST /student/presence/focus-event,多带 away_ms)
家长: GET  /parent/children/{id}/today       今天的卡片
      GET  /parent/children/{id}/camera      同意状态 + 告知
      PUT  /parent/children/{id}/camera      打开 / 关掉
      DELETE /parent/children/{id}/camera/records  删掉摄像头的离开记录
老师: PUT  /teacher/camera-consents/{id}     登记家长签了纸质同意书 / 撤回(本班才行,进操作记录)
      GET  /teacher/camera-consent-notice    打印纸质同意书用的告知
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_parent, get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.database import get_db
from app.models.focus_watch import FocusAwayEvent
from app.models.organization import Organization
from app.models.user import ParentStudentLink, User
from app.services import audit_log, focus_watch as fw

router = APIRouter()


async def _org_name(db: AsyncSession, org_id: int | None) -> str | None:
    if not org_id:
        return None
    return (await db.execute(select(Organization.name).where(Organization.id == org_id))).scalar_one_or_none()


def _label(u: User) -> str:
    return u.full_name or u.username


# ---------------- 学生 ----------------

@router.get("/student/presence/camera")
async def student_camera(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    return {"enabled": await fw.consent_active(db, current_user.id), "no_face_ms": fw.NO_FACE_MS}


class CameraStatusIn(BaseModel):
    status: str


@router.post("/student/presence/camera-status")
async def student_camera_status(
    data: CameraStatusIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    if data.status not in fw.CAMERA_STATUSES:
        raise HTTPException(422, "status 必须是 on/denied/unavailable/error")
    if not await fw.consent_active(db, current_user.id):
        raise HTTPException(403, "家长还没同意用摄像头")
    await fw.set_camera_status(db, current_user.id, data.status)
    await db.commit()
    return {"ok": True}


# ---------------- 家长 ----------------

async def _my_child(db: AsyncSession, parent: User, student_id: int) -> User:
    link = (await db.execute(select(ParentStudentLink).where(
        ParentStudentLink.parent_id == parent.id, ParentStudentLink.student_id == student_id,
    ))).scalar_one_or_none()
    if not link:
        raise HTTPException(403, "无权查看该孩子的数据")
    student = (await db.execute(select(User).where(User.id == student_id))).scalar_one_or_none()
    if not student:
        raise HTTPException(404, "学生不存在")
    return student


@router.get("/parent/children/{student_id}/today")
async def parent_child_today(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    student = await _my_child(db, current_parent, student_id)
    return await fw.parent_today(db, student)


@router.get("/parent/children/{student_id}/camera")
async def parent_child_camera(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    student = await _my_child(db, current_parent, student_id)
    return {
        "consent": fw.consent_out(await fw.consent_row(db, student_id)),
        "notice": fw.notice(await _org_name(db, student.org_id)),
    }


class ParentCameraIn(BaseModel):
    enabled: bool
    agree: bool = False   # 打开时必须勾「我已看过上面的说明,同意」


@router.put("/parent/children/{student_id}/camera")
async def parent_set_camera(
    student_id: int,
    data: ParentCameraIn,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    await _my_child(db, current_parent, student_id)
    if data.enabled and not data.agree:
        raise HTTPException(400, "请先看完说明并勾选同意")
    row = await fw.set_consent(db, student_id, enabled=data.enabled, method="parent",
                               actor_id=current_parent.id, actor_name=f"家长 {_label(current_parent)}")
    await db.commit()
    return {"consent": fw.consent_out(row)}


@router.delete("/parent/children/{student_id}/camera/records")
async def parent_delete_camera_records(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_parent: User = Depends(get_current_parent),
):
    await _my_child(db, current_parent, student_id)
    n = (await db.execute(delete(FocusAwayEvent).where(
        FocusAwayEvent.user_id == student_id, FocusAwayEvent.kind == "no_face",
    ))).rowcount
    await db.commit()
    return {"deleted": n or 0}


# ---------------- 老师 ----------------

class TeacherCameraIn(BaseModel):
    enabled: bool
    paper_signed: bool = False   # 打开时必须确认「家长已签纸质同意书」


@router.put("/teacher/camera-consents/{student_id}")
async def teacher_set_camera(
    student_id: int,
    data: TeacherCameraIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await assert_student_in_my_class(db, current_user.id, student_id)
    if data.enabled and not data.paper_signed:
        raise HTTPException(400, "要先拿到家长签字的纸质同意书")
    student = (await db.execute(select(User).where(User.id == student_id))).scalar_one()
    from app.core.actor import acting_user
    actor = acting_user(current_user)
    row = await fw.set_consent(db, student_id, enabled=data.enabled, method="paper",
                               actor_id=actor.id, actor_name=f"老师 {_label(actor)}(纸质同意书)")
    audit_log.record(
        db, request, current_user, "camera.consent",
        f"「{_label(student)}」摄像头看在不在: " + ("登记家长纸质同意书,打开" if data.enabled else "关掉"),
        target_type="user", target_id=student_id,
    )
    await db.commit()
    return {"consent": fw.consent_out(row)}


@router.get("/teacher/camera-consent-notice")
async def teacher_camera_notice(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    return fw.notice(await _org_name(db, current_user.org_id))
