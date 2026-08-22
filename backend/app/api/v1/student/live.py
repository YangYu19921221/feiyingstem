"""学生端 - 看直播 + 看课件(能看不能下)

## 三条不可破的约束
1. **推流地址永不出现在本文件任何响应里** —— 拿到就能劫持直播。
2. **课件原文件没有任何可访问 URL** —— 学生只能拿 `/materials/{id}/page/{n}`,
   那是按他本人烧了水印的渲染图,右键另存下来也是带自己名字的水印图。
3. **播放地址按人签发、5 分钟过期** —— 转发到校外很快失效(CDN 防盗链)。

课件页响应刻意 `Cache-Control: no-store`:水印带时间戳和本人身份,缓存下来
既没意义又留一堆带个人信息的图在设备上。
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, update, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, ClassStudent
from app.models.live import LiveSession, LiveMaterial, LiveAttendance, MaterialViewLog
from app.api.v1.auth import get_current_student
from app.services import live_service, watermark_service
import asyncio

router = APIRouter()


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


async def _my_class_ids(db: AsyncSession, student_id: int) -> set[int]:
    rows = (await db.execute(
        select(ClassStudent.class_id).where(ClassStudent.student_id == student_id)
    )).scalars().all()
    return set(rows)


async def _visible_session(db: AsyncSession, session_id: int, student: User) -> LiveSession:
    """课对该学生是否可见:本机构 + (未绑班级 or 绑的是他的班)"""
    row = (await db.execute(
        select(LiveSession).where(LiveSession.id == session_id)
    )).scalar_one_or_none()
    if not row or row.status == "canceled":
        raise HTTPException(status_code=404, detail="直播课不存在")
    if row.class_id is not None:
        if row.class_id not in await _my_class_ids(db, student.id):
            raise HTTPException(status_code=403, detail="这节课不是你的班级")
    return row


def _viewer_label(student: User) -> str:
    """水印上的身份串。**必须能定位到人** —— 泄露时靠这个溯源"""
    name = (student.full_name or student.username or "").strip()
    return f"{name} · ID{student.id}"


@router.get("/live/sessions")
async def my_live_sessions(
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    """我的直播课:正在直播的排最前,然后是即将开课,最后是可回放的"""
    my_classes = await _my_class_ids(db, student.id)
    cond = or_(LiveSession.class_id.is_(None), LiveSession.class_id.in_(my_classes or {-1}))
    rows = (await db.execute(
        select(LiveSession)
        .where(and_(cond, LiveSession.status != "canceled"))
        .order_by(LiveSession.created_at.desc())
        .limit(60)
    )).scalars().all()

    order = {"live": 0, "created": 1, "ended": 2}
    rows = sorted(rows, key=lambda r: (order.get(r.status, 3), -(r.id)))
    return [
        {
            "id": r.id,
            "title": r.title,
            "description": r.description,
            "status": r.status,
            "scheduled_at": _iso(r.scheduled_at),
            "started_at": _iso(r.started_at),
            # 回放要同时满足:老师允许 + 已转码好
            "replay_available": bool(r.allow_replay and r.replay_ready),
            "replay_duration": r.replay_duration,
        }
        for r in rows
    ]


@router.post("/live/sessions/{session_id}/join")
async def join_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    """进直播间:签播放地址 + 落考勤。响应不含任何推流信息。"""
    row = await _visible_session(db, session_id, student)
    if row.status != "live":
        raise HTTPException(status_code=409, detail="老师还没开始上课")

    # 考勤 UPSERT。**并发心跳下必须靠 UNIQUE 兜底**,不然写出多行让时长翻倍
    att = LiveAttendance(live_session_id=session_id, student_id=student.id)
    db.add(att)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await db.execute(
            update(LiveAttendance)
            .where(and_(LiveAttendance.live_session_id == session_id,
                        LiveAttendance.student_id == student.id))
            .values(last_seen_at=datetime.utcnow())
        )
        await db.commit()

    urls = live_service.build_play_urls(row.stream_key, student.id, row.origin_node)
    return {
        "session_id": row.id,
        "title": row.title,
        "flv_url": urls.flv,
        "hls_url": urls.hls,
        "webrtc_url": urls.webrtc,
        "expires_at": urls.expires_at,
        # 前端把它叠在播放器上,并烧进录屏也带得走的角标
        "watermark": f"{settings.WATERMARK_TEXT} · {_viewer_label(student)}",
    }


class HeartbeatRequest(BaseModel):
    seconds: int = 30          # 本次心跳覆盖的时长
    blurred: bool = False      # 这段时间是否切屏
    is_replay: bool = False


@router.post("/live/sessions/{session_id}/heartbeat")
async def heartbeat(
    session_id: int,
    payload: HeartbeatRequest,
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    """累加观看时长。**服务端封顶单次增量**,否则改前端就能刷出 10 小时观看时长。

    走 UPSERT 而不是纯 UPDATE: 回放场景没走过 /join(那里要求 status=='live'),
    考勤行不存在 → UPDATE 匹配 0 行 → 还返回 ok, replay_seconds 永远是 0,
    静默坏掉没人发现。这里没行就先建再累加。

    可见性也要校验: 否则学生能对任意 session_id 刷时长, 连别的班的课都能刷。
    """
    await _visible_session(db, session_id, student)

    inc = max(0, min(payload.seconds, 120))
    col = LiveAttendance.replay_seconds if payload.is_replay else LiveAttendance.watch_seconds
    res = await db.execute(
        update(LiveAttendance)
        .where(and_(LiveAttendance.live_session_id == session_id,
                    LiveAttendance.student_id == student.id))
        .values({
            col: col + inc,
            LiveAttendance.last_seen_at: datetime.utcnow(),
            LiveAttendance.blur_count: LiveAttendance.blur_count + (1 if payload.blurred else 0),
        })
    )

    if res.rowcount == 0:
        # 回放首次心跳: 建行并把本次增量直接写进去。UNIQUE 兜并发,
        # 撞了就回滚重跑 UPDATE(此时行已由并发请求建好)
        att = LiveAttendance(
            live_session_id=session_id,
            student_id=student.id,
            watch_seconds=0 if payload.is_replay else inc,
            replay_seconds=inc if payload.is_replay else 0,
            blur_count=1 if payload.blurred else 0,
        )
        db.add(att)
        try:
            await db.commit()
            return {"ok": True}
        except IntegrityError:
            await db.rollback()
            await db.execute(
                update(LiveAttendance)
                .where(and_(LiveAttendance.live_session_id == session_id,
                            LiveAttendance.student_id == student.id))
                .values({
                    col: col + inc,
                    LiveAttendance.last_seen_at: datetime.utcnow(),
                    LiveAttendance.blur_count:
                        LiveAttendance.blur_count + (1 if payload.blurred else 0),
                })
            )

    await db.commit()
    return {"ok": True}


# ========================================
# 课件浏览
# ========================================

@router.get("/live/materials")
async def my_materials(
    session_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    """可看的课件清单。**不含 file_path**,只给 id 和页数"""
    my_classes = await _my_class_ids(db, student.id)
    cond = [
        LiveMaterial.is_published.is_(True),
        LiveMaterial.render_ready.is_(True),
        or_(LiveMaterial.class_id.is_(None), LiveMaterial.class_id.in_(my_classes or {-1})),
    ]
    if session_id is not None:
        await _visible_session(db, session_id, student)
        cond.append(LiveMaterial.live_session_id == session_id)

    rows = (await db.execute(
        select(LiveMaterial).where(and_(*cond))
        .order_by(LiveMaterial.sort_order, LiveMaterial.created_at.desc())
        .limit(200)
    )).scalars().all()
    return [
        {
            "id": m.id,
            "title": m.title,
            "kind": m.kind,
            "page_count": m.page_count or 0,
            "live_session_id": m.live_session_id,
        }
        for m in rows
    ]


async def _assert_material_visible(
    db: AsyncSession, material_id: int, student: User
) -> LiveMaterial:
    row = (await db.execute(
        select(LiveMaterial).where(LiveMaterial.id == material_id)
    )).scalar_one_or_none()
    if not row or not row.is_published or not row.render_ready:
        raise HTTPException(status_code=404, detail="课件不存在或尚未开放")
    if row.class_id is not None:
        if row.class_id not in await _my_class_ids(db, student.id):
            raise HTTPException(status_code=403, detail="无权查看该课件")
    return row


@router.get("/live/materials/{material_id}/page/{page_no}")
async def material_page(
    material_id: int,
    page_no: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    student: User = Depends(get_current_student),
):
    """取课件某页 —— 现烧水印现返回,不落盘、不缓存。

    烧水印是 CPU 活(Pillow),丢线程池,别在事件循环里做:单 worker 下
    一个学生翻页会卡住所有人的请求。
    """
    row = await _assert_material_visible(db, material_id, student)
    if page_no < 1 or page_no > (row.page_count or 0):
        raise HTTPException(status_code=404, detail="页码超出范围")

    try:
        data = await asyncio.to_thread(
            watermark_service.stamp_page,
            material_id, page_no, viewer_label=_viewer_label(student),
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="该页尚未渲染完成")

    # 留痕:出泄露纠纷时,水印上的 ID 对应这里的调阅时间
    db.add(MaterialViewLog(
        material_id=material_id,
        user_id=student.id,
        page_no=page_no,
        ip=(request.client.host if request.client else None),
    ))
    await db.commit()

    return Response(
        content=data,
        media_type="image/webp",
        headers={
            # 水印含本人身份和时间,不允许任何层缓存
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
            # 明确告知不是可下载附件(挡不住手动保存,但挡住浏览器下载器识别)
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )
