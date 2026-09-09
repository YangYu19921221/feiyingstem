"""音标教学视频 — 学生端(只读 + 鉴权串流)

音标是英语的基础,这里只负责「列出来 + 能播」。视频文件存私有目录,
必须登录才能播:串流端点自己校验 token,不走 UPLOAD_DIR 的公开静态服务。
"""
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.tenancy import current_org_id, check_org_active
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.phonetic import PhoneticVideo, PhoneticMaterial
from app.services import phonetic_material_service
from app.services import auth_service

logger = logging.getLogger(__name__)

router = APIRouter()

# 一次读多少(串流分块)。1MB:小了请求太碎,大了首帧变慢
CHUNK_SIZE = 1024 * 1024

CATEGORY_LABELS = {
    "basic": "入门总览",
    "vowel": "元音",
    "consonant": "辅音",
    "other": "其他",
}
# 学生端分组顺序:先看入门,再元音、辅音
CATEGORY_ORDER = ("basic", "vowel", "consonant", "other")


class PhoneticVideoOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    phonetic_symbol: Optional[str] = None
    category: str
    category_label: str = ""
    cover_image: Optional[str] = None
    duration_seconds: Optional[int] = None
    file_size: Optional[int] = None
    view_count: int = 0
    # 播放地址:鉴权串流端点。刻意不下发 file_path —— 磁盘路径不该出现在响应里
    play_url: str = ""


def to_out(v: PhoneticVideo) -> PhoneticVideoOut:
    return PhoneticVideoOut(
        id=v.id,
        title=v.title,
        description=v.description,
        phonetic_symbol=v.phonetic_symbol,
        category=v.category,
        category_label=CATEGORY_LABELS.get(v.category, v.category),
        cover_image=v.cover_image,
        duration_seconds=v.duration_seconds,
        file_size=v.file_size,
        view_count=v.view_count or 0,
        play_url=f"/api/v1/phonetics/videos/{v.id}/stream",
    )


@router.get("/videos", response_model=list[PhoneticVideoOut])
async def list_videos(
    category: Optional[str] = Query(None, description="basic/vowel/consonant/other"),
    q: Optional[str] = Query(None, description="搜索标题/音标/描述"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """学生端视频列表:只列启用的,按「分类顺序 → sort_order → 新的在前」排。

    音标视频量级是几十个,一次全给前端做分组展示;真多起来再上分页。
    组内顺序 = 老师的上传顺序(sort_order 相同时按 id 升序)。
    """
    # 排序按「上传顺序」(id 升序):老师是按教学顺序一个个传的,
    # 之前用 id.desc() 会把最后传的排最前,批量传 1234 显示成 4321
    stmt = select(PhoneticVideo).where(PhoneticVideo.is_active.is_(True))
    if category:
        stmt = stmt.where(PhoneticVideo.category == category)
    if q:
        kw = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            PhoneticVideo.title.ilike(kw),
            PhoneticVideo.phonetic_symbol.ilike(kw),
            PhoneticVideo.description.ilike(kw),
        ))
    rows = (await db.execute(
        stmt.order_by(PhoneticVideo.sort_order.asc(), PhoneticVideo.id.asc())
    )).scalars().all()

    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    rows = sorted(rows, key=lambda v: (order.get(v.category, 99), v.sort_order or 0, v.id))
    return [to_out(v) for v in rows]


@router.get("/videos/{video_id}", response_model=PhoneticVideoOut)
async def get_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """视频详情,顺带记一次观看。"""
    v = (await db.execute(
        select(PhoneticVideo).where(
            PhoneticVideo.id == video_id, PhoneticVideo.is_active.is_(True)
        )
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="视频不存在或已下架")
    v.view_count = (v.view_count or 0) + 1
    await db.commit()
    return to_out(v)


def _scope_org(q, model):
    """显式加 org 可见性(自己机构的 + 平台共享的)。

    ⚠️ **不要只依赖 tenancy 的自动过滤器**。它会为注册过的模型注入同样的条件,
    但那是最后一道网、不是边界本身:它依赖认证时设置的 ContextVar,任何没走那条路的
    调用(后台任务、脚本、测试)就是裸查询。本项目既有规矩就是显式过滤
    (见 phonetic_practice.py 的 _visible_book,CLAUDE.md 记明此类泄漏「已踩过两次」)。
    admin 的 current_org_id 是 None(看全部),与既有口径一致。
    """
    org_id = current_org_id.get()
    if org_id is not None:
        q = q.where(or_(model.org_id == org_id, model.org_id.is_(None)))
    return q


class MaterialBrief(BaseModel):
    """配套课件(讲义 PPT/PDF)。**只给页数,不给文件名/原文件地址**"""
    id: int
    title: str
    page_count: int


@router.get("/videos/{video_id}/materials", response_model=list[MaterialBrief])
async def list_video_materials(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """某个视频的配套讲义列表。

    只列**渲染好且上架**的:渲染没成的课件如果列出来,学生点进去只会看到
    一片空白页,不如当它不存在(老师那边能看到 render_error 并重传)。
    """
    v = (await db.execute(
        _scope_org(
            select(PhoneticVideo).where(
                PhoneticVideo.id == video_id, PhoneticVideo.is_active.is_(True)
            ),
            PhoneticVideo,
        )
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="视频不存在或已下架")

    rows = (await db.execute(
        select(PhoneticMaterial)
        .where(
            PhoneticMaterial.video_id == video_id,
            PhoneticMaterial.is_active.is_(True),
            PhoneticMaterial.render_ready.is_(True),
            PhoneticMaterial.page_count > 0,
        )
        .order_by(PhoneticMaterial.sort_order.asc(), PhoneticMaterial.id.asc())
    )).scalars().all()
    return [
        MaterialBrief(id=m.id, title=m.title, page_count=m.page_count or 0)
        for m in rows
    ]


@router.get("/materials/{material_id}/page/{page_no}")
async def material_page(
    material_id: int,
    page_no: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """取课件第 N 页的渲染图。**原文件永不下发**,学生只能拿到图。

    ⚠️ 必须 join 回 phonetic_videos:PhoneticMaterial 虽然注册了租户过滤,
    但按 id 直查时过滤器只看它自己的 org_id,罩不住"这份课件挂的视频是否已下架"
    (音标教材那边踩过同样的坑:lessons 按 ID 直查必须 join 回 books)。

    与直播课件不同,这里**不烧水印**,所以每个学生拿到的图完全一样 ——
    可以让浏览器缓存(直播课件那边按人烧水印才必须 no-store)。
    课件几十页来回翻,不缓存的话每翻一页都要重新走一次网络。
    """
    row = (await db.execute(
        _scope_org(
            select(PhoneticMaterial)
            .join(PhoneticVideo, PhoneticVideo.id == PhoneticMaterial.video_id)
            .where(
                PhoneticMaterial.id == material_id,
                PhoneticMaterial.is_active.is_(True),
                PhoneticMaterial.render_ready.is_(True),
                PhoneticVideo.is_active.is_(True),   # 视频下架,配套讲义也跟着不给看
            ),
            PhoneticVideo,      # 按**父视频**的归属判
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="课件不存在或已下架")

    # 页码必须落在已渲染范围内:传 0 / 负数 / 超页数都按 404,
    # 不要拿它去拼路径(page_path 只接整数,这里再兜一层)
    if page_no < 1 or page_no > (row.page_count or 0):
        raise HTTPException(status_code=404, detail="页码超出范围")

    path = phonetic_material_service.page_path(row.id, page_no)
    if not os.path.isfile(path):
        logger.warning("音标课件渲染页缺失: id=%s page=%s path=%s",
                       row.id, page_no, path)
        raise HTTPException(status_code=404, detail="这一页丢了,请联系老师重新上传课件")

    return FileResponse(
        path,
        media_type="image/png",
        headers={
            # private:内容仍需登录才能拿,不许共享代理缓存;
            # 但同一个学生自己的浏览器可以缓存(图对所有人相同,不含个人信息)
            "Cache-Control": "private, max-age=86400",
        },
    )


async def _user_from_query_token(token: str, db: AsyncSession) -> User:
    """用 query 参数里的 token 认证。

    为什么需要:<video src="..."> 是浏览器原生请求,**带不上 Authorization 头**
    (也不过 axios 拦截器),所以取鉴权媒体资源只能把 token 放 URL 上 ——
    这是原生标签取受保护资源的常规做法。校验逻辑与 auth._authenticate_token 等价。
    """
    cred_exc = HTTPException(status_code=401, detail="无法验证凭据")
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        uid = payload.get("sub")
        if uid is None:
            raise cred_exc
    except JWTError:
        raise cred_exc
    u = await auth_service.get_user_by_id(db, user_id=int(uid))
    if u is None or not u.is_active:
        raise cred_exc
    # 多租户上下文与机构有效期:与主认证链保持一致,别让串流成为绕过口
    current_org_id.set(None if u.role == "admin" else u.org_id)
    if u.role in ("student", "teacher", "parent"):
        if not await check_org_active(db, u.org_id):
            raise HTTPException(status_code=402, detail="机构服务已到期")
    return u


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


@router.get("/videos/{video_id}/stream")
async def stream_video(
    video_id: int,
    request: Request,
    token: Optional[str] = Query(None, description="<video> 标签带不了请求头,故支持 query token"),
    db: AsyncSession = Depends(get_db),
):
    """鉴权串流。支持 Range 请求 —— 不支持的话移动端拖不动进度条、Safari 可能整个不播。

    鉴权双通道:Authorization 头(fetch/axios)或 ?token=(<video> 标签)。
    """
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        await _user_from_query_token(auth_header[7:].strip(), db)
    elif token:
        await _user_from_query_token(token, db)
    else:
        raise HTTPException(status_code=401, detail="需要登录后观看")

    v = (await db.execute(
        select(PhoneticVideo).where(
            PhoneticVideo.id == video_id, PhoneticVideo.is_active.is_(True)
        )
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="视频不存在或已下架")

    if not v.file_path:
        raise HTTPException(status_code=404, detail="视频文件缺失")
    # 只用文件名拼接,杜绝 ../ 穿越(file_path 入库时已随机化,这里再兜一层)
    safe_name = os.path.basename(v.file_path)
    path = os.path.join(settings.PHONETIC_VIDEO_DIR, safe_name)
    if not os.path.isfile(path):
        logger.warning("音标视频文件不存在: id=%s path=%s", video_id, path)
        raise HTTPException(status_code=404, detail="视频文件已丢失,请联系老师重新上传")

    total = os.path.getsize(path)
    mime = v.mime_type or "video/mp4"
    range_header = request.headers.get("range")

    if not range_header:
        # 整file 返回时也要声明 accept-ranges,否则部分播放器不给拖进度条
        return FileResponse(path, media_type=mime, headers={"Accept-Ranges": "bytes"})

    m = _RANGE_RE.match(range_header)
    if not m:
        raise HTTPException(status_code=416, detail="Range 格式不支持")
    start_s, end_s = m.group(1), m.group(2)
    start = int(start_s) if start_s else 0
    end = int(end_s) if end_s else min(start + CHUNK_SIZE - 1, total - 1)
    end = min(end, total - 1)
    if start > end or start >= total:
        # 起点越界必须回 416 并带 Content-Range,否则播放器会一直重试
        return Response(
            status_code=416, headers={"Content-Range": f"bytes */{total}"}
        )

    def _iter():
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(CHUNK_SIZE, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        _iter(),
        status_code=206,
        media_type=mime,
        headers={
            "Content-Range": f"bytes {start}-{end}/{total}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        },
    )
