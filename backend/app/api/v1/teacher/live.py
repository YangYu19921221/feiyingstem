"""教师端 - 线上授课(直播)+ 课件管理

**推流地址只在本文件下发**(老师身份校验后),学生端任何响应都不含它。
课件原文件落 MATERIAL_DIR,不进 UPLOAD_DIR(那个目录整体公开无鉴权,CLAUDE.md 红线)。
"""
import asyncio
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.live import LiveSession, LiveMaterial, LiveAttendance
from app.api.v1.auth import get_current_user
from app.services import live_service, watermark_service

router = APIRouter()

# 允许上传的课件类型 → 渲染方式
_PDF_EXT = {".pdf"}
_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}


async def get_current_teacher(current_user: User = Depends(get_current_user)) -> User:
    """教师及以上。org_admin/admin 也能开课和管资料"""
    if current_user.role not in (UserRole.TEACHER, UserRole.ORG_ADMIN, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="仅教师可用")
    return current_user


class CreateLiveRequest(BaseModel):
    title: str
    description: Optional[str] = None
    class_id: Optional[int] = None
    scheduled_at: Optional[str] = None  # ISO 字符串
    allow_replay: bool = True


class LiveSessionOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    class_id: Optional[int]
    status: str
    scheduled_at: Optional[str]
    started_at: Optional[str]
    ended_at: Optional[str]
    allow_replay: bool
    replay_ready: bool
    material_count: int = 0
    viewer_count: int = 0


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


async def _own_session(db: AsyncSession, session_id: int, teacher: User) -> LiveSession:
    """取自己的课。**不放行别人的课** —— 否则能拿到别人的推流密钥劫持直播"""
    row = (await db.execute(
        select(LiveSession).where(LiveSession.id == session_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="直播课不存在")
    # admin/org_admin 可管本机构全部;teacher 只能管自己的
    if teacher.role == UserRole.TEACHER and row.teacher_id != teacher.id:
        raise HTTPException(status_code=403, detail="无权操作该直播课")
    return row


async def _own_material(db: AsyncSession, material_id: int, teacher: User) -> LiveMaterial:
    """取自己的课件。**不放行同事的课件** —— 发布/删除都是不可逆的对外动作:
    撤销发布会让正在看的学生当场断档,删除还连带清原文件和渲染页。

    与 _own_session 同口径: admin/org_admin 管本机构全部, teacher 只管自己上传的。
    跨机构由 tenancy 过滤器兜住(LiveMaterial 带 org_id 且已注册), 这里管的是
    同机构内老师之间——加盟机构里十几个老师共用一个库, 互删是真会发生的事。
    """
    row = (await db.execute(
        select(LiveMaterial).where(LiveMaterial.id == material_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="课件不存在")
    if teacher.role == UserRole.TEACHER and row.uploader_id != teacher.id:
        raise HTTPException(status_code=403, detail="这份课件不是你上传的,无权操作")
    return row


@router.get("/live/config")
async def live_config(_: User = Depends(get_current_teacher)):
    """直播是否可用。未配源站时前端隐藏入口,而不是让老师点进去报错"""
    return {
        "enabled": live_service.live_available(),
        "watermark_text": settings.WATERMARK_TEXT,
    }


@router.get("/live/sessions", response_model=List[LiveSessionOut])
async def list_sessions(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    q = select(LiveSession).order_by(LiveSession.created_at.desc()).limit(100)
    if teacher.role == UserRole.TEACHER:
        q = q.where(LiveSession.teacher_id == teacher.id)
    if status:
        q = q.where(LiveSession.status == status)
    rows = (await db.execute(q)).scalars().all()
    if not rows:
        return []

    ids = [r.id for r in rows]
    mat_counts = dict((await db.execute(
        select(LiveMaterial.live_session_id, func.count())
        .where(LiveMaterial.live_session_id.in_(ids))
        .group_by(LiveMaterial.live_session_id)
    )).all())
    view_counts = dict((await db.execute(
        select(LiveAttendance.live_session_id, func.count())
        .where(LiveAttendance.live_session_id.in_(ids))
        .group_by(LiveAttendance.live_session_id)
    )).all())

    return [
        LiveSessionOut(
            id=r.id, title=r.title, description=r.description, class_id=r.class_id,
            status=r.status, scheduled_at=_iso(r.scheduled_at),
            started_at=_iso(r.started_at), ended_at=_iso(r.ended_at),
            allow_replay=r.allow_replay, replay_ready=r.replay_ready,
            material_count=mat_counts.get(r.id, 0),
            viewer_count=view_counts.get(r.id, 0),
        )
        for r in rows
    ]


@router.post("/live/sessions")
async def create_session(
    payload: CreateLiveRequest,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    scheduled = None
    if payload.scheduled_at:
        try:
            scheduled = datetime.fromisoformat(payload.scheduled_at.replace("Z", "+00:00"))
            if scheduled.tzinfo:
                scheduled = scheduled.replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="scheduled_at 格式不正确")

    row = LiveSession(
        org_id=teacher.org_id,
        teacher_id=teacher.id,
        class_id=payload.class_id,
        title=payload.title.strip() or "线上课堂",
        description=payload.description,
        scheduled_at=scheduled,
        stream_key=live_service.new_stream_key(),
        origin_node=live_service.pick_origin_node(),
        allow_replay=payload.allow_replay,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "title": row.title, "status": row.status}


@router.post("/live/sessions/{session_id}/start")
async def start_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """开播:返回推流凭据。**只有这个端点会吐 whip/rtmp 地址**"""
    if not live_service.live_available():
        raise HTTPException(status_code=503, detail="直播源站未配置,请联系管理员")
    row = await _own_session(db, session_id, teacher)
    if row.status == "ended":
        raise HTTPException(status_code=400, detail="该课已结束,请新建一节课")

    row.status = "live"
    if not row.started_at:
        row.started_at = datetime.utcnow()
    await db.commit()

    cred = live_service.build_push_credentials(row.stream_key, row.origin_node)
    return {
        "session_id": row.id,
        "whip_url": cred.whip_url,
        "rtmp_url": cred.rtmp_url,
        "stream_key": cred.stream_key,
        "expires_at": cred.expires_at,
    }


@router.post("/live/sessions/{session_id}/end")
async def end_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    row = await _own_session(db, session_id, teacher)
    row.status = "ended"
    row.ended_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "status": row.status}


@router.delete("/live/sessions/{session_id}")
async def cancel_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """取消未开播的课。**已开播的不删行**(考勤要留档),改成 canceled"""
    row = await _own_session(db, session_id, teacher)
    if row.started_at:
        row.status = "canceled"
        await db.commit()
        return {"ok": True, "soft": True}
    await db.delete(row)
    await db.commit()
    return {"ok": True, "soft": False}


@router.get("/live/sessions/{session_id}/attendance")
async def session_attendance(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """考勤表:谁来了、看了多久、切屏几次"""
    await _own_session(db, session_id, teacher)
    rows = (await db.execute(
        select(LiveAttendance, User.full_name, User.username)
        .join(User, User.id == LiveAttendance.student_id)
        .where(LiveAttendance.live_session_id == session_id)
        .order_by(LiveAttendance.watch_seconds.desc())
    )).all()
    return [
        {
            "student_id": a.student_id,
            "name": full_name or username,
            "first_join_at": _iso(a.first_join_at),
            "watch_seconds": a.watch_seconds,
            "replay_seconds": a.replay_seconds,
            "blur_count": a.blur_count,
        }
        for a, full_name, username in rows
    ]


# ========================================
# 课件资料
# ========================================

class MaterialOut(BaseModel):
    id: int
    title: str
    kind: str
    page_count: Optional[int]
    render_ready: bool
    render_error: Optional[str]
    is_published: bool
    file_size: Optional[int]
    created_at: Optional[str]
    uploader_id: Optional[int] = None
    # 前端据此灰掉同事课件的发布/删除按钮,别让人点了才吃 403
    can_edit: bool = True


@router.get("/live/materials", response_model=List[MaterialOut])
async def list_materials(
    session_id: Optional[int] = None,
    mine_only: bool = False,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """课件列表。跨机构由 tenancy 过滤器兜住。

    默认列出本机构全部(课件本就是机构内共享的教研资料),mine_only=True 只看自己传的。
    能看不等于能改——发布/删除走 _own_material 校验,同事的课件列得出但动不了。
    """
    q = select(LiveMaterial).order_by(
        LiveMaterial.sort_order, LiveMaterial.created_at.desc()
    ).limit(200)
    if session_id is not None:
        q = q.where(LiveMaterial.live_session_id == session_id)
    if mine_only:
        q = q.where(LiveMaterial.uploader_id == teacher.id)
    rows = (await db.execute(q)).scalars().all()
    return [
        MaterialOut(
            id=m.id, title=m.title, kind=m.kind, page_count=m.page_count,
            render_ready=m.render_ready, render_error=m.render_error,
            is_published=m.is_published, file_size=m.file_size,
            created_at=_iso(m.created_at),
            uploader_id=m.uploader_id,
            can_edit=(teacher.role != UserRole.TEACHER or m.uploader_id == teacher.id),
        )
        for m in rows
    ]


@router.post("/live/materials")
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(...),
    session_id: Optional[int] = Form(None),
    class_id: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    """上传课件。原文件落 MATERIAL_DIR(私有),同步渲染成逐页底图。

    渲染是 CPU 活且阻塞,丢线程池 —— 单 worker 下直接跑会把整个服务卡住。
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in _PDF_EXT:
        kind = "pdf"
    elif ext in _IMG_EXT:
        kind = "image"
    else:
        raise HTTPException(status_code=400, detail="只支持 PDF 和图片(png/jpg/webp)")

    # 归属校验放在落盘前:被 403 挡掉的请求不该留下文件
    if session_id is not None:
        await _own_session(db, session_id, teacher)

    os.makedirs(settings.MATERIAL_DIR, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    abs_path = os.path.join(settings.MATERIAL_DIR, stored)

    # **边读边写边计数**,不要 await file.read() 一次性进内存:
    # 单 worker 下一个超大文件就能把进程打爆,而且限额是在读完之后才判的,
    # 等于先把内存吃满再说"你超了"。超限立刻停手并清掉半截文件。
    limit = settings.MAX_MATERIAL_SIZE
    size = 0
    try:
        with open(abs_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"文件超过 {limit // 1024 // 1024}MB 上限",
                    )
                f.write(chunk)
    except Exception:
        # 半截文件必须清掉,否则超限重试几次就把盘塞满了
        try:
            os.remove(abs_path)
        except OSError:
            pass
        raise

    row = LiveMaterial(
        live_session_id=session_id,
        org_id=teacher.org_id,
        uploader_id=teacher.id,
        title=title.strip() or (file.filename or "课件"),
        kind=kind,
        file_path=stored,          # 只存文件名,不存绝对路径(换机器不用改库)
        file_size=size,
        class_id=class_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    try:
        pages = await asyncio.to_thread(
            watermark_service.render_material, abs_path, row.id, kind
        )
        row.page_count = pages
        row.render_ready = True
        row.render_error = None
    except Exception as exc:  # 渲染失败不丢文件,留 error 让老师看见并可重试
        row.render_ready = False
        row.render_error = f"{type(exc).__name__}: {exc}"[:400]
    await db.commit()

    return {
        "id": row.id,
        "title": row.title,
        "kind": row.kind,
        "page_count": row.page_count,
        "render_ready": row.render_ready,
        "render_error": row.render_error,
    }


@router.post("/live/materials/{material_id}/publish")
async def toggle_publish(
    material_id: int,
    is_published: bool = Form(...),
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    row = await _own_material(db, material_id, teacher)
    row.is_published = is_published
    await db.commit()
    return {"ok": True, "is_published": row.is_published}


@router.delete("/live/materials/{material_id}")
async def delete_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_teacher),
):
    row = await _own_material(db, material_id, teacher)

    abs_path = os.path.join(settings.MATERIAL_DIR, row.file_path)
    mid = row.id
    await db.delete(row)
    await db.commit()

    # 原文件和渲染页一起清,别留孤儿文件占盘
    try:
        os.remove(abs_path)
    except OSError:
        pass
    watermark_service.cleanup_rendered(mid)
    return {"ok": True}
