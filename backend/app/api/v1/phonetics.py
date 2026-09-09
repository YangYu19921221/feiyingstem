"""音标教学视频 — 学生端(只读 + 鉴权串流)

音标是英语的基础,这里只负责「列出来 + 能播」。视频文件存私有目录,
必须登录才能播:串流端点自己校验 token,不走 UPLOAD_DIR 的公开静态服务。
"""
import asyncio
import hashlib
import hmac
import logging
import os
import re
import time
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
from app.services import phonetic_material_service, rate_limit, watermark_service
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

    **每张图现烧取图人的姓名 + ID**(与直播课件同一套水印):抓包/截图/录屏在用户
    自己的设备上拦不住,能做的是让流出去的每一张都写着是谁拿的。
    代价是不能让浏览器缓存(no-store)—— 但前端 useMaterialPages 自己在内存里
    缓存了 blob,来回翻页不重复走网络,服务端缓存本来就用不上。
    再加速率上限:学生手翻一秒一两页,爬虫一秒几十页,速率一卡就露馅。
    """
    rate_limit.check(("phonetic-page", user.id), PAGE_RATE_LIMIT, 60,
                     "翻得太快了,歇一下再看")
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

    # 烧水印是 CPU 活(Pillow),丢线程池 —— 单 worker 下在事件循环里做,
    # 一个学生翻页会卡住所有人的请求
    try:
        data = await asyncio.to_thread(
            watermark_service.stamp_image, path, viewer_label=_viewer_label(user))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="这一页丢了,请联系老师重新上传课件")

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
    # 顶号校验与主认证链(auth._authenticate_token)同口径:被顶下线的会话,
    # 它的 token 拿来串流/回放也不该再好使 —— 此前这里漏了这一步
    sv = payload.get("sv")
    cur_ver = u.session_ver or 0
    if (sv is not None and sv != cur_ver) or (sv is None and u.role == "student" and cur_ver > 0):
        raise cred_exc
    # 多租户上下文与机构有效期:与主认证链保持一致,别让串流成为绕过口
    current_org_id.set(None if u.role == "admin" else u.org_id)
    if u.role in ("student", "teacher", "parent"):
        if not await check_org_active(db, u.org_id):
            raise HTTPException(status_code=402, detail="机构服务已到期")
    return u


# ==================== 播放票据(替代 URL 里的整站会话 token)====================
#
# <video src> 是浏览器原生请求,带不上 Authorization 头,凭证只能放 URL 上。
# 此前放的是**整站 7 天会话 token** —— 抓包/复制地址栏就等于拿走整个账号,
# 拿它能调所有 API。现在换成票据:
#   - 用**独立密钥**签(SECRET_KEY 派生),拿它当 Bearer 用会直接签名失败;
#   - 绑定单个视频 + 用户 + 会话版本:泄了只能播这一个视频,账号一顶号就作废;
#   - 两小时过期。
# 抓包本身在用户自己的设备上拦不住,能做的是让抓到的东西**用处小、时限短、追得到人**。

TICKET_TTL_SEC = 2 * 3600
# 换票 / 翻页的速率上限。学生手翻讲义一秒一两页,爬虫一秒几十页 —— 速率一卡就露馅。
# 模块级常量便于测试 monkeypatch 成很小的数
TICKET_RATE_LIMIT = 30      # 每分钟
PAGE_RATE_LIMIT = 90        # 每分钟(含前端预取下一页,正常翻页 ~2 请求/页)


def _ticket_key() -> str:
    """票据签名密钥:从 SECRET_KEY 派生,与会话 JWT 的密钥**不同**。
    同一把钥匙签两种令牌,就防不住把一种冒充另一种"""
    return hmac.new(settings.SECRET_KEY.encode(), b"phonetic-media-ticket",
                    hashlib.sha256).hexdigest()


def _mint_ticket(user: User, video_id: int) -> tuple[str, int]:
    exp = int(time.time()) + TICKET_TTL_SEC
    payload = {
        "typ": "media",
        "sub": str(user.id),
        "vid": video_id,
        "sv": user.session_ver or 0,
        "exp": exp,
    }
    return jwt.encode(payload, _ticket_key(), algorithm="HS256"), exp


async def _user_from_ticket(ticket: str, video_id: int, db: AsyncSession) -> User:
    """校验播放票据。任何一项不符都是同一个 401,不给探测方向"""
    bad = HTTPException(status_code=401, detail="播放凭证无效或已过期,请刷新页面")
    try:
        payload = jwt.decode(ticket, _ticket_key(), algorithms=["HS256"])
    except JWTError:
        raise bad
    if payload.get("typ") != "media" or payload.get("vid") != video_id:
        raise bad
    uid = payload.get("sub")
    if uid is None:
        raise bad
    u = await auth_service.get_user_by_id(db, user_id=int(uid))
    if u is None or not u.is_active:
        raise bad
    # 顶号即作废:别处重新登录后,旧设备上抓到的票据也跟着死
    if payload.get("sv") != (u.session_ver or 0):
        raise bad
    current_org_id.set(None if u.role == "admin" else u.org_id)
    if u.role in ("student", "teacher", "parent"):
        if not await check_org_active(db, u.org_id):
            raise HTTPException(status_code=402, detail="机构服务已到期")
    return u


def _viewer_label(user: User) -> str:
    """水印上的身份串。**必须能定位到人** —— 泄露时靠这个溯源(与直播课件同口径)"""
    name = (user.full_name or user.username or "").strip()
    return f"{name} · ID{user.id}"


class MediaTicketOut(BaseModel):
    url: str
    expires_at: int


@router.get("/videos/{video_id}/ticket", response_model=MediaTicketOut)
async def video_ticket(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """换一张播放票据。走正常 Bearer 鉴权(axios 请求),再签一张只能播这个视频的票"""
    rate_limit.check(("phonetic-ticket", user.id), TICKET_RATE_LIMIT, 60,
                     "切换太频繁,稍等一下")
    v = (await db.execute(
        _scope_org(
            select(PhoneticVideo).where(
                PhoneticVideo.id == video_id, PhoneticVideo.is_active.is_(True)),
            PhoneticVideo,
        )
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="视频不存在或已下架")
    tok, exp = _mint_ticket(user, v.id)
    return MediaTicketOut(url=f"/api/v1/phonetics/videos/{v.id}/stream?t={tok}", expires_at=exp)


_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


@router.get("/videos/{video_id}/stream")
async def stream_video(
    video_id: int,
    request: Request,
    t: Optional[str] = Query(None, description="播放票据(见 /videos/{id}/ticket),<video> 标签带不了请求头"),
    db: AsyncSession = Depends(get_db),
):
    """鉴权串流。支持 Range 请求 —— 不支持的话移动端拖不动进度条、Safari 可能整个不播。

    鉴权双通道:Authorization 头(fetch/axios)或 ?t= 播放票据(<video> 标签)。
    ⚠️ **不再接受 ?token= 整站会话 token**:那等于把账号写在视频地址里,
    抓包/复制地址栏就能拿去调所有 API。旧前端刷新后自动换成票据。
    """
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        await _user_from_query_token(auth_header[7:].strip(), db)
    elif t:
        await _user_from_ticket(t, video_id, db)
    else:
        raise HTTPException(status_code=401, detail="需要登录后观看")

    v = (await db.execute(
        _scope_org(
            select(PhoneticVideo).where(
                PhoneticVideo.id == video_id, PhoneticVideo.is_active.is_(True)),
            PhoneticVideo,
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
