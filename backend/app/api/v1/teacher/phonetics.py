"""音标教学视频 — 教师端(上传 + 增删改查 + 搜索 + 分页)

上传的视频落 settings.PHONETIC_VIDEO_DIR(私有目录),经学生端鉴权串流端点播放。
⚠️ 别改成写 UPLOAD_DIR:那个目录整体公开无鉴权(见 main.py 与 CLAUDE.md)。

标题默认取上传文件名(去扩展名),老师可再改。
"""
import logging
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.api.v1.auth import get_current_teacher
from app.models.user import User
from app.models.phonetic import PhoneticVideo
from app.api.v1.phonetics import PhoneticVideoOut, to_out, CATEGORY_LABELS

logger = logging.getLogger(__name__)

router = APIRouter()

# 白名单:只收常见且浏览器能直接播的格式。avi/rmvb 之类即使传上来也播不了
ALLOWED_VIDEO_MIME = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}
VALID_CATEGORIES = set(CATEGORY_LABELS.keys())


def _ensure_dir() -> str:
    d = settings.PHONETIC_VIDEO_DIR
    os.makedirs(d, exist_ok=True)
    return d


def category_from_title(title: str) -> Optional[str]:
    """从标题/文件名猜分类。老师的文件名普遍带「元音/辅音」(如「元音_01音标动画」),
    自动归类省得传完 20 个再一个个改;认不出来时返回 None 交给调用方兜底。

    先判辅音:中文「辅音」里不含「元音」二字,但顺序反了会让"辅音"被
    先匹配到的其它规则截走,所以显式按最具体的先来。
    """
    s = (title or "").lower()
    if "辅音" in s or "consonant" in s:
        return "consonant"
    if "元音" in s or "vowel" in s:
        return "vowel"
    # 入门/总览类关键词
    if any(k in s for k in ("入门", "总览", "概述", "基础", "intro", "basic")):
        return "basic"
    return None


def _title_from_filename(filename: str) -> str:
    """默认标题 = 上传文件名去扩展名(用户要求)。空名兜底为「未命名视频」。

    ⚠️ 不能用 os.path.basename:音标文件名里天然带斜杠(如「元音 /æ/ 发音.mp4」),
    basename 会把它当路径分隔符,标题被截成「 发音」——恰恰是本模块最常见的命名。
    浏览器上传只会送**纯文件名**(不含目录),所以正斜杠一律当普通字符保留;
    只处理 Windows 反斜杠(个别客户端会送整条 `C:\\...\\音标课.mp4`)。
    """
    name = (filename or "").strip()
    if "\\" in name:                      # Windows 整条路径 → 取最后一段
        name = name.rsplit("\\", 1)[-1]
    # 扩展名不分大小写(.MP4 也要去掉);只削已知视频后缀,免得把「第1.课」的点当扩展名
    low = name.lower()
    for ext in (".mp4", ".webm", ".mov"):
        if low.endswith(ext):
            name = name[: -len(ext)]
            break
    return name.strip()[:200] or "未命名视频"


class VideoUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    phonetic_symbol: Optional[str] = Field(None, max_length=50)
    category: Optional[str] = None
    cover_image: Optional[str] = Field(None, max_length=500)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


@router.get("/videos")
async def list_videos(
    q: Optional[str] = Query(None, description="搜索标题/音标/描述"),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """分页列表(视频多了要翻页)。返回 {total, page, page_size, items},
    与教师端其它列表端点同样式。含已下架的,老师要能看到并重新启用。
    顺序与学生端一致:按上传顺序(id 升序),老师看到的排序就是学生看到的。"""
    conds = []
    if q:
        kw = f"%{q.strip()}%"
        conds.append(or_(
            PhoneticVideo.title.ilike(kw),
            PhoneticVideo.phonetic_symbol.ilike(kw),
            PhoneticVideo.description.ilike(kw),
        ))
    if category:
        conds.append(PhoneticVideo.category == category)

    base = select(PhoneticVideo)
    if conds:
        base = base.where(*conds)

    total = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar() or 0

    rows = (await db.execute(
        base.order_by(PhoneticVideo.sort_order.asc(), PhoneticVideo.id.asc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    items = []
    for v in rows:
        out = to_out(v).model_dump()
        out["is_active"] = bool(v.is_active)
        out["created_at"] = v.created_at
        items.append(out)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.post("/videos/upload", response_model=PhoneticVideoOut)
async def upload_video(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    phonetic_symbol: Optional[str] = Form(None),
    category: str = Form("basic"),
    sort_order: int = Form(0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """上传视频文件。**不传 title 时默认用文件名(去扩展名)**。

    落盘文件名随机化:原名可能带中文/空格/../,直接用会有编码与路径穿越问题。
    """
    ext = ALLOWED_VIDEO_MIME.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "仅支持 mp4 / webm / mov 格式的视频")
    if category not in VALID_CATEGORIES:
        category = "basic"

    d = _ensure_dir()
    stored_name = f"{secrets.token_hex(16)}.{ext}"
    path = os.path.join(d, stored_name)

    # 流式落盘 + 边写边计大小:不能先 file.read() 整个进内存(200MB 视频会打爆内存)
    size = 0
    limit = settings.MAX_VIDEO_SIZE
    try:
        with open(path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    out.close()
                    os.remove(path)
                    raise HTTPException(
                        413,
                        f"视频超过 {limit // (1024 * 1024)}MB 上限,请压缩后再传或改用外链",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(path):
            os.remove(path)
        logger.exception("音标视频落盘失败: %s", e)
        raise HTTPException(500, "视频保存失败,请重试")

    if size == 0:
        os.remove(path)
        raise HTTPException(400, "文件是空的,请重新选择")

    final_title = (title or "").strip() or _title_from_filename(file.filename)
    # 分类:调用方没明确指定(仍是默认 basic)时,按文件名自动识别元音/辅音。
    # 老师批量传「元音_01…」「辅音_01…」时不用再一个个改分类,
    # 分错了还能在列表里手动编辑。
    final_category = category
    if category == "basic":
        guessed = category_from_title(final_title)
        if guessed:
            final_category = guessed

    v = PhoneticVideo(
        title=final_title,
        description=description,
        file_path=stored_name,
        file_size=size,
        mime_type=file.content_type,
        phonetic_symbol=phonetic_symbol,
        category=final_category,
        sort_order=sort_order,
        created_by=user.id,
        org_id=user.org_id,
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    logger.info("音标视频上传: id=%s title=%s size=%s by=%s", v.id, v.title, size, user.id)
    return to_out(v)


@router.put("/videos/{video_id}", response_model=PhoneticVideoOut)
async def update_video(
    video_id: int,
    body: VideoUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """改标题/描述/音标/分类/排序/上下架。视频文件本身不换(要换重新上传)。"""
    v = (await db.execute(
        select(PhoneticVideo).where(PhoneticVideo.id == video_id)
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, "视频不存在")

    data = body.model_dump(exclude_unset=True)
    if "category" in data and data["category"] not in VALID_CATEGORIES:
        data.pop("category")
    if "title" in data and data["title"]:
        data["title"] = data["title"].strip()
    for k, val in data.items():
        setattr(v, k, val)
    await db.commit()
    await db.refresh(v)
    return to_out(v)


class BatchDeleteRequest(BaseModel):
    # 一次最多 100 条:再多就该用筛选条件删,免得一个误点清空整库
    ids: list[int] = Field(..., min_length=1, max_length=100)


@router.post("/videos/batch-delete")
async def batch_delete_videos(
    body: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """批量删除(勾选多条一起删)。返回实际删掉的条数。

    用 POST 而不是 DELETE:DELETE 带 body 在部分代理/浏览器上会被丢掉,
    批量 id 走 body 最稳。文件删失败只记日志 —— 留个孤儿文件不影响业务,
    但库里删不掉会留下"有记录播不了"的坏条目,所以以库为准。
    """
    rows = (await db.execute(
        select(PhoneticVideo).where(PhoneticVideo.id.in_(body.ids))
    )).scalars().all()
    if not rows:
        return {"deleted": 0, "requested": len(body.ids)}

    stored = [os.path.basename(v.file_path) for v in rows if v.file_path]
    for v in rows:
        await db.delete(v)
    await db.commit()

    for name in stored:
        p = os.path.join(settings.PHONETIC_VIDEO_DIR, name)
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            logger.warning("批量删除音标视频文件失败(记录已删): %s %s", p, e)
    logger.info("批量删除音标视频: %d 条 by=%s", len(rows), user.id)
    return {"deleted": len(rows), "requested": len(body.ids)}


@router.delete("/videos/{video_id}", status_code=204)
async def delete_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """删除条目,顺带删磁盘文件(否则文件会一直占空间,服务器只剩 80G)。

    先删库再删文件:文件删失败只是留个孤儿文件,不影响业务;
    反过来先删文件、库里删失败,就会出现"有记录但播不了"的坏条目。
    """
    v = (await db.execute(
        select(PhoneticVideo).where(PhoneticVideo.id == video_id)
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, "视频不存在")
    stored = os.path.basename(v.file_path) if v.file_path else None
    await db.delete(v)
    await db.commit()
    if stored:
        p = os.path.join(settings.PHONETIC_VIDEO_DIR, stored)
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            logger.warning("删除音标视频文件失败(记录已删): %s %s", p, e)
    return None
