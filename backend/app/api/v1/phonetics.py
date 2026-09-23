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
from sqlalchemy import select, func, or_, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.timeutil import utc_now
from app.core.tenancy import current_org_id, check_org_active
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.phonetic import PhoneticVideo, PhoneticMaterial, PhoneticVideoView
from app.services import phonetic_material_service, rate_limit, watermark_service
from app.services import auth_service, video_watch

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
    # 讲师姓名(自由文本,见 models/phonetic.py)。None = 全校通用。
    # 学生端按它分组挑「自己的老师」;**不在这里做二次归一** ——
    # 归一只在写入路径(lecturer_name.resolve()),读侧再洗一遍会让同一份数据
    # 在两处算出不同的分组
    lecturer: Optional[str] = None
    cover_image: Optional[str] = None
    duration_seconds: Optional[int] = None
    file_size: Optional[int] = None
    # ⚠️ **这是打开次数,不是人数**(每次 GET 详情 +1,同一个学生刷十次就是 10)。
    # 名字已经在生产用着不好改,新的人数口径一律看下面 viewers —— 界面上要显示
    # 「多少人」时**绝不能用这个字段**,那是一句假话
    view_count: int = 0

    # ===== 观看统计(2026-09-23)。口径真源 services/video_watch =====
    # 看过的**人**数(去重,且只数本机构的人)
    viewers: int = 0
    # 此刻还在看的人数(90 秒内有心跳)
    watching_now: int = 0
    # 我自己的进度。**position 与 max_position 是两个不同的问题,别合并**:
    # 前者是"上次停在哪"(续播用),后者是"看到过最远哪儿"(算「看到几成」用)。
    # 拿 position 去显示进度,孩子看完后往回拖一下再退出就会显示「看到 5%」
    my_position_seconds: int = 0
    my_max_position_seconds: int = 0
    my_watch_seconds: int = 0
    my_completed: bool = False

    # 播放地址:鉴权串流端点。刻意不下发 file_path —— 磁盘路径不该出现在响应里
    play_url: str = ""


def to_out(
    v: PhoneticVideo,
    stats: Optional[video_watch.VideoStats] = None,
    mine: Optional[PhoneticVideoView] = None,
) -> PhoneticVideoOut:
    return PhoneticVideoOut(
        id=v.id,
        title=v.title,
        description=v.description,
        phonetic_symbol=v.phonetic_symbol,
        category=v.category,
        category_label=CATEGORY_LABELS.get(v.category, v.category),
        lecturer=v.lecturer,
        cover_image=v.cover_image,
        duration_seconds=v.duration_seconds,
        file_size=v.file_size,
        view_count=v.view_count or 0,
        viewers=stats.viewers if stats else 0,
        watching_now=stats.watching_now if stats else 0,
        my_position_seconds=(mine.last_position_seconds or 0) if mine else 0,
        my_max_position_seconds=(mine.max_position_seconds or 0) if mine else 0,
        my_watch_seconds=(mine.watch_seconds or 0) if mine else 0,
        my_completed=bool(mine.completed) if mine else False,
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
    #
    # ⚠️ _scope_org 是 2026-09-17 补的:此前这里**只靠隐式租户过滤器**
    # (生产 TENANCY_ENFORCE=True 所以没出事),但那是最后一道网不是边界 ——
    # 任何没走认证的调用(后台任务/脚本/测试)拿到的就是裸查询。
    # 加了讲师分组后代价变大:前端的老师筛选条是从这个响应聚合出来的,
    # 一旦漏出别家机构的行,学生就会在 chip 上直接看到别家老师的**姓名**。
    stmt = _scope_org(
        select(PhoneticVideo).where(PhoneticVideo.is_active.is_(True)),
        PhoneticVideo,
    )
    if category:
        stmt = stmt.where(PhoneticVideo.category == category)
    if q:
        kw = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            PhoneticVideo.title.ilike(kw),
            PhoneticVideo.phonetic_symbol.ilike(kw),
            PhoneticVideo.description.ilike(kw),
            # 讲师也要能搜:学生看到卡片上写着「王老师」,搜它却搜不到很别扭
            PhoneticVideo.lecturer.ilike(kw),
        ))
    rows = (await db.execute(
        stmt.order_by(PhoneticVideo.sort_order.asc(), PhoneticVideo.id.asc())
    )).scalars().all()

    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    rows = sorted(rows, key=lambda v: (order.get(v.category, 99), v.sort_order or 0, v.id))

    # 统计与「我的进度」各一次批量查询(**不要按行 N 次查**,一屏几十个视频)
    ids = [v.id for v in rows]
    stats = await video_watch.stats_for_videos(db, ids, org_id=current_org_id.get())
    mine = await _my_views(db, user.id, ids)
    return [to_out(v, stats.get(v.id), mine.get(v.id)) for v in rows]


async def _my_views(
    db: AsyncSession, user_id: int, video_ids: list[int]
) -> dict[int, PhoneticVideoView]:
    """我自己在这批视频上的观看行。一次查完,按 video_id 索引。

    不加 org 过滤: 这是**我自己**的行,按 user_id 取本来就只有我的
    (而且我看过的视频里可能有平台预置的,加机构条件反而会把它们筛掉)。
    """
    if not video_ids:
        return {}
    rows = (await db.execute(
        select(PhoneticVideoView).where(
            PhoneticVideoView.user_id == user_id,
            PhoneticVideoView.video_id.in_(video_ids),
        )
    )).scalars().all()
    return {r.video_id: r for r in rows}


@router.get("/videos/{video_id}", response_model=PhoneticVideoOut)
async def get_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """视频详情,顺带记一次观看。

    ⚠️ _scope_org 同样是 2026-09-17 补的(理由见 list_videos)。这里是**按 id 直查**,
    漏了的话拿别家机构的 video_id 就能读到标题/讲师/简介并把观看数记上去。
    同文件的 /ticket 与 /stream 一直是有显式过滤的,只有这个读端点漏了。
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
    v.view_count = (v.view_count or 0) + 1
    # 同一动作记两处: view_count 是历史遗留的「打开次数」(老界面在用,不动它),
    # 新的按人一行用来回答「几个人看过」。**只有学生算观看** ——
    # 老师点进去检查视频不该计入学情,否则「5 个人看过」里有 3 个是老师自己刷的
    if user.role == "student":
        await _touch_view(db, v.id, user.id)
    await db.commit()

    stats = await video_watch.stats_for_videos(db, [v.id], org_id=current_org_id.get())
    mine = await _my_views(db, user.id, [v.id])
    return to_out(v, stats.get(v.id), mine.get(v.id))


async def _touch_view(db: AsyncSession, video_id: int, user_id: int) -> None:
    """记一次「这个人打开了这个视频」。没行就建,有行就 play_count +1。

    ⚠️ 走 **SQLite 的 ON CONFLICT DO UPDATE(单条语句)**,不走 live.py 那套
    「UPDATE → rowcount==0 → INSERT → IntegrityError → rollback → 重试」:
    那套在这里会踩 CLAUDE.md 记的 MissingGreenlet 坑 —— 本函数与调用方共用
    请求 session,而调用方手上还攥着 ORM 对象(v / user)。一旦 rollback,
    这些对象全部过期,接着读 v.title 就是一次隐式 IO → 500。
    单条 upsert 天然没有这个分支,并发也由 UNIQUE(video_id,user_id) 兜住。
    """
    now = utc_now()
    stmt = sqlite_insert(PhoneticVideoView).values(
        video_id=video_id,
        user_id=user_id,
        play_count=1,
        first_viewed_at=now,
        last_viewed_at=now,
    )
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[PhoneticVideoView.video_id, PhoneticVideoView.user_id],
        set_={
            "play_count": PhoneticVideoView.play_count + 1,
            "last_viewed_at": now,
        },
    ))


class WatchProgress(BaseModel):
    """一次心跳。三个数各有分工,别合并(见 services/video_watch 模块头)"""
    # 距上次心跳真看了多少秒。**服务端会封顶**,客户端报什么都不能直接累加
    seconds: int = video_watch.HEARTBEAT_SEC
    # 当前播放位置(秒)。用于续播 + 算「看到过最远处」
    position: int = 0
    # 前端拿到的视频总时长。存量视频 duration_seconds 全是 NULL,
    # 顺手回填 —— 没有分母就算不出完看率(见 video_watch 模块头「duration 为空怎么办」)
    duration: Optional[int] = None


# 心跳 30 秒一次,给到 20/min: 正常用量 2 次/分,余量兜标签页限流后的补报;
# 再多就是脚本在刷时长了
HEARTBEAT_RATE_LIMIT = 20


@router.post("/videos/{video_id}/progress")
async def report_progress(
    video_id: int,
    payload: WatchProgress,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """上报观看进度(播放中每 30 秒一次 + 暂停/离开时一次)。

    四道闸门,少一道这个数就不可信:
    ① **可见性必须显式校验** —— 否则学生拿别家机构的 video_id 就能往那边刷时长,
       而那些数字会出现在别家老师的学情页上(_scope_org 的理由见 list_videos)
    ② **增量服务端封顶**(video_watch.clamp_increment): 客户端报多少加多少的话,
       改一行 JS 就是 10 小时
    ③ **位置按 duration 夹**(clamp_position): 报个 999999 就永远满足「到过结尾」
    ④ 限速: 心跳本该 30 秒一次,一秒几十次的只能是脚本

    「看完」的判定不在这里手写,调 video_watch.is_completed —— 那是唯一真源
    (学习时长在五个界面算出五个数字的教训,见 services/study_time 文件头)。
    """
    rate_limit.check(("phonetic-progress", user.id), HEARTBEAT_RATE_LIMIT, 60,
                     "上报太频繁了")

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

    # 老师/管理员点进去看不计入学情(与 get_video 同口径),但也不该报错 ——
    # 前端是同一个播放器组件,为角色分叉只会让它更容易漏
    if user.role != "student":
        return {"ok": True, "counted": False}

    # duration 回填: 存量视频没有这个数,而它是完看率的分母。
    # 只在**库里没有**时写(前端报的是浏览器解出来的元数据,以先到的为准即可,
    # 不要每次心跳都覆盖 —— 那会让这一列在几个孩子的不同播放器之间来回跳)
    if not v.duration_seconds and payload.duration and payload.duration > 0:
        v.duration_seconds = int(payload.duration)
    duration = v.duration_seconds

    inc = video_watch.clamp_increment(payload.seconds)
    pos = video_watch.clamp_position(payload.position, duration)
    now = utc_now()

    # 先保证行存在(与 _touch_view 同一套单条 upsert,不走 rollback 分支)
    await db.execute(sqlite_insert(PhoneticVideoView).values(
        video_id=video_id, user_id=user.id, play_count=1,
        first_viewed_at=now, last_viewed_at=now,
    ).on_conflict_do_nothing(
        index_elements=[PhoneticVideoView.video_id, PhoneticVideoView.user_id],
    ))

    # 累加与取最大值都在 SQL 里做(不是读出来改再写回去):
    # 同一个孩子开两个标签页时,读改写会互相覆盖掉对方的增量
    await db.execute(
        update(PhoneticVideoView)
        .where(
            PhoneticVideoView.video_id == video_id,
            PhoneticVideoView.user_id == user.id,
        )
        .values({
            PhoneticVideoView.watch_seconds: PhoneticVideoView.watch_seconds + inc,
            # 看到过的最远处只增不减(往回拖进度条不该把它拉小)
            PhoneticVideoView.max_position_seconds: func.max(
                PhoneticVideoView.max_position_seconds, pos
            ),
            # 续播位置是「上次停在哪」,所以直接覆盖
            PhoneticVideoView.last_position_seconds: pos,
            PhoneticVideoView.last_viewed_at: now,
        })
    )

    # completed 是冗余标记(为了列表页不必每行现算),判定仍以 video_watch 为准。
    # 累加之后再读回来判 —— 用请求里的增量自己算会漏掉另一个标签页的贡献
    row = (await db.execute(
        select(PhoneticVideoView).where(
            PhoneticVideoView.video_id == video_id,
            PhoneticVideoView.user_id == user.id,
        )
    )).scalar_one()
    done = video_watch.is_completed(
        row.watch_seconds or 0, row.max_position_seconds or 0, duration
    )
    # **只置不清**: 已经看完的不因为重看开头而变回没看完
    if done and not row.completed:
        row.completed = True

    await db.commit()
    return {
        "ok": True,
        "counted": True,
        "watch_seconds": row.watch_seconds or 0,
        "completed": bool(row.completed),
    }


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
