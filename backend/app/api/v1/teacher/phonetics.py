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
from app.core.tenancy import current_org_id
from app.api.v1.auth import get_current_teacher
from app.models.user import User
from app.models.phonetic import PhoneticVideo, PhoneticMaterial
from app.api.v1.phonetics import PhoneticVideoOut, to_out, CATEGORY_LABELS
from app.services import office_convert, phonetic_material_service

logger = logging.getLogger(__name__)

router = APIRouter()

# 白名单:只收常见且浏览器能直接播的格式。avi/rmvb 之类即使传上来也播不了
ALLOWED_VIDEO_MIME = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}
VALID_CATEGORIES = set(CATEGORY_LABELS.keys())

# 课件白名单。**按扩展名判而不是 content_type**:pptx 的 MIME 各浏览器/系统报得五花八门
# (标准的 vnd.openxmlformats-...presentationml.presentation、application/octet-stream
# 都见得到),按 MIME 判会把老师正常的文件挡在门外
ALLOWED_MATERIAL_EXTS = {".pdf", ".ppt", ".pptx"}


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


def _base_filename(filename: str) -> str:
    """取纯文件名。**只削 Windows 反斜杠,正斜杠当普通字符保留**。

    理由同 _title_from_filename:音标文件名天然带斜杠(「元音 /æ/ 讲义.pdf」),
    按 / 切会把它截成「 讲义.pdf」。浏览器上传只送纯文件名,不会有目录。
    """
    name = (filename or "").strip()
    if "\\" in name:
        name = name.rsplit("\\", 1)[-1]
    return name


def _material_title_from_filename(filename: str) -> str:
    """课件默认标题 = 文件名去扩展名(不能复用 _title_from_filename:
    它只削视频后缀、兜底文案也是「未命名视频」)"""
    name = _base_filename(filename)
    low = name.lower()
    for ext in (".pptx", ".ppt", ".pdf"):     # 先长后短,否则 .pptx 会被 .ppt 截半
        if low.endswith(ext):
            name = name[: -len(ext)]
            break
    return name.strip()[:200] or "未命名课件"


def _org_scope(q, model):
    """给查询显式加上 org 可见性(自己机构的 + 平台共享的)。

    ⚠️ **不要只依赖 tenancy 的自动过滤器**。它确实会为注册过的模型注入同样的条件,
    但那是最后一道网,不是边界本身:
    - 它依赖认证时设置的 ContextVar,任何没走那条路的调用(后台任务、脚本、
      测试环境)就是完全无过滤的裸查询;
    - 本项目的既有规矩就是显式过滤(见 phonetic_practice.py 的 _visible_book,
      CLAUDE.md 记明此类泄漏「已踩过两次」)。
    admin 的 current_org_id 是 None(看全部),与既有口径一致。
    """
    org_id = current_org_id.get()
    if org_id is not None:
        q = q.where(or_(model.org_id == org_id, model.org_id.is_(None)))
    return q


async def _visible_video(db: AsyncSession, video_id: int, user: User) -> PhoneticVideo:
    """取一个**看得见**的视频(含平台预置)。读操作用这个"""
    v = (await db.execute(
        _org_scope(select(PhoneticVideo).where(PhoneticVideo.id == video_id),
                   PhoneticVideo)
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(404, "视频不存在")
    return v


async def _own_video(db: AsyncSession, video_id: int, user: User) -> PhoneticVideo:
    """取一个**改得动**的视频。写操作(改/删/配课件)必须用这个。

    ⚠️ 平台预置内容(org_id IS NULL)对机构只读 —— 这是本项目的既有规矩
    (见 phonetic_books.py 的 _own_book:「平台预置教材对机构只读」)。
    租户过滤器**罩不住这一层**:它为了让机构能看见共享内容而放行 org_id IS NULL,
    于是任何机构的老师都能改、能删平台预置视频,删还连带删磁盘文件、影响所有机构。
    只有平台 admin 能动预置内容。
    """
    v = await _visible_video(db, video_id, user)
    if v.org_id is None and user.role != "admin":
        raise HTTPException(403, "平台预置视频对机构只读,如需调整请联系平台管理员")
    return v


async def _own_material(db: AsyncSession, material_id: int, user: User) -> PhoneticMaterial:
    """取一份**改得动**的课件(同预置只读规则)。

    ⚠️ 必须 join 回 phonetic_videos:PhoneticMaterial 虽然注册了租户过滤,
    但按 id 直查时过滤器只看它自己的 org_id,罩不住"这份课件挂在哪个视频上"
    (音标教材那边踩过同样的坑:lessons 按 ID 直查必须 join 回 books)。
    """
    m = (await db.execute(
        _org_scope(
            select(PhoneticMaterial)
            .join(PhoneticVideo, PhoneticVideo.id == PhoneticMaterial.video_id)
            .where(PhoneticMaterial.id == material_id),
            PhoneticVideo,      # 按**父视频**的归属判,课件自己的 org_id 只是冗余
        )
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "课件不存在")
    if m.org_id is None and user.role != "admin":
        raise HTTPException(403, "平台预置课件对机构只读,如需调整请联系平台管理员")
    return m


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

    # 显式加 org 可见性(理由见 _org_scope:不把安全边界押在隐式过滤器上)
    base = _org_scope(select(PhoneticVideo), PhoneticVideo)
    if conds:
        base = base.where(*conds)

    total = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar() or 0

    rows = (await db.execute(
        base.order_by(PhoneticVideo.sort_order.asc(), PhoneticVideo.id.asc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    # 每个视频配了几份课件:一次 group_by 聚合,别按行 N 次查。
    # 列表上不显示的话,老师看不出哪个视频已经配过讲义(同「48 张卡长得一样」那个问题)
    counts: dict[int, int] = {}
    if rows:
        vids = [v.id for v in rows]
        for vid, n in (await db.execute(
            select(PhoneticMaterial.video_id, func.count())
            .where(PhoneticMaterial.video_id.in_(vids))
            .group_by(PhoneticMaterial.video_id)
        )).all():
            counts[vid] = n or 0

    items = []
    for v in rows:
        out = to_out(v).model_dump()
        out["is_active"] = bool(v.is_active)
        out["created_at"] = v.created_at
        out["material_count"] = counts.get(v.id, 0)
        # 平台预置对机构只读:前端据此置灰按钮,别让老师点了才吃 403
        out["is_preset"] = v.org_id is None
        out["can_edit"] = (user.role == "admin") or v.org_id is not None
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
    v = await _own_video(db, video_id, user)

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

    # ⚠️ 与单条删除同口径:平台预置内容(org_id IS NULL)对机构只读。
    # **整批拒掉而不是静默跳过** —— 勾了 5 条只删掉 3 条又不说,老师会以为都删了
    if user.role != "admin":
        preset = [v.id for v in rows if v.org_id is None]
        if preset:
            raise HTTPException(
                403,
                f"选中的 {len(preset)} 条是平台预置视频,对机构只读,"
                "请取消勾选后重试(如需调整请联系平台管理员)",
            )

    stored = [os.path.basename(v.file_path) for v in rows if v.file_path]

    # 配套课件跟着视频走(SQLite 默认不开外键级联,不显式删会留孤儿行 + 渲染页目录)
    vids = [v.id for v in rows]
    mats = (await db.execute(
        select(PhoneticMaterial).where(PhoneticMaterial.video_id.in_(vids))
    )).scalars().all()
    mat_files = [(m.id, os.path.basename(m.file_path)) for m in mats if m.file_path]
    for m in mats:
        await db.delete(m)

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
    for mid, name in mat_files:
        _remove_material_files(mid, name)
    logger.info("批量删除音标视频: %d 条(连带课件 %d 份) by=%s",
                len(rows), len(mats), user.id)
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
    v = await _own_video(db, video_id, user)
    stored = os.path.basename(v.file_path) if v.file_path else None

    # 配套课件跟着视频一起走:SQLite 默认不开外键级联,不显式删就会留下
    # 一批指向已删视频的孤儿课件行 + 永远清不掉的渲染页目录
    mats = (await db.execute(
        select(PhoneticMaterial).where(PhoneticMaterial.video_id == v.id)
    )).scalars().all()
    mat_files = [(m.id, os.path.basename(m.file_path)) for m in mats if m.file_path]
    for m in mats:
        await db.delete(m)

    await db.delete(v)
    await db.commit()

    if stored:
        p = os.path.join(settings.PHONETIC_VIDEO_DIR, stored)
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            logger.warning("删除音标视频文件失败(记录已删): %s %s", p, e)
    for mid, name in mat_files:
        _remove_material_files(mid, name)
    return None


# ==================== 配套课件(PDF / PPT)====================
#
# 老师讲音标时手上那份 PPT,学生看完视频想回看讲义 —— 视频与讲义本来是配套的。
# 学生只拿逐页渲染的图,**原文件永不下发**(课件是老师的劳动成果,
# 给了原文件等于给了可二次分发的母版)。


class MaterialOut(BaseModel):
    id: int
    video_id: int
    title: str
    kind: str
    page_count: int
    render_ready: bool
    render_error: Optional[str] = None
    file_size: Optional[int] = None
    sort_order: int = 0
    is_active: bool = True
    # 平台预置的课件机构只能看不能改,前端据此把按钮置灰 —— 别让老师点了才吃 403
    is_preset: bool = False
    can_edit: bool = True


def _material_out(m: PhoneticMaterial, user: User) -> MaterialOut:
    preset = m.org_id is None
    return MaterialOut(
        id=m.id, video_id=m.video_id, title=m.title, kind=m.kind,
        page_count=m.page_count or 0,
        render_ready=bool(m.render_ready), render_error=m.render_error,
        file_size=m.file_size, sort_order=m.sort_order or 0,
        is_active=bool(m.is_active),
        is_preset=preset,
        can_edit=(user.role == "admin" or not preset),
    )


def _remove_material_files(material_id: int, stored_name: Optional[str]) -> None:
    """删课件的磁盘部分:原文件 + 渲染页目录。失败只记日志(以库为准)"""
    if stored_name:
        p = os.path.join(settings.PHONETIC_MATERIAL_DIR, os.path.basename(stored_name))
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            logger.warning("删除课件原文件失败(记录已删): %s %s", p, e)
    try:
        phonetic_material_service.cleanup(material_id)
    except Exception as e:      # noqa: BLE001 - 清理失败不该影响删除结果
        logger.warning("清理课件渲染页失败: id=%s %s", material_id, e)


@router.get("/videos/{video_id}/materials", response_model=list[MaterialOut])
async def list_materials(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """某视频的课件列表。读端点放行平台预置(能看不能改)"""
    await _visible_video(db, video_id, user)
    rows = (await db.execute(
        select(PhoneticMaterial)
        .where(PhoneticMaterial.video_id == video_id)
        .order_by(PhoneticMaterial.sort_order.asc(), PhoneticMaterial.id.asc())
    )).scalars().all()
    return [_material_out(m, user) for m in rows]


@router.post("/videos/{video_id}/materials", response_model=MaterialOut)
async def upload_material(
    video_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """给视频配一份课件。PDF 直接渲染;PPT/PPTX 先经 LibreOffice 转 PDF。

    渲染失败**不丢文件**:留 render_error 让老师看见并可重传,学生端则看不到
    这份课件(而不是看到一片空白页)。
    """
    # 归属校验放在落盘前:被 403/404 挡掉的请求不该留下文件
    video = await _own_video(db, video_id, user)

    # 按扩展名判(理由见 ALLOWED_MATERIAL_EXTS 注释)。
    # ⚠️ 取文件名只能削反斜杠:音标文件名天然带 /(「元音 /æ/ 讲义.pdf」)
    raw_name = _base_filename(file.filename)
    ext = os.path.splitext(raw_name)[1].lower()
    if ext not in ALLOWED_MATERIAL_EXTS:
        raise HTTPException(400, "只支持 PDF 和 PPT(.pdf / .ppt / .pptx)")
    # PPT 得有转换组件才收:先拒掉比收下来再报「渲染失败」对老师友好
    if ext in (".ppt", ".pptx") and not office_convert.office_available():
        raise HTTPException(
            400, "服务器暂不支持 PPT 转换,请在 PowerPoint 里另存为 PDF 后上传")

    d = settings.PHONETIC_MATERIAL_DIR
    os.makedirs(d, exist_ok=True)
    stored_name = f"{secrets.token_hex(16)}{ext}"
    path = os.path.join(d, stored_name)

    # 流式落盘 + 边写边计大小(不能先 read() 整个进内存,单 worker 会被一个大文件打爆)
    size = 0
    limit = settings.MAX_PHONETIC_MATERIAL_SIZE
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
                        f"课件超过 {limit // (1024 * 1024)}MB 上限,请压缩或拆分后再传",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(path):
            os.remove(path)
        logger.exception("音标课件落盘失败: %s", e)
        raise HTTPException(500, "课件保存失败,请重试")

    if size == 0:
        os.remove(path)
        raise HTTPException(400, "文件是空的,请重新选择")

    kind = "pdf" if ext == ".pdf" else ext.lstrip(".")
    m = PhoneticMaterial(
        video_id=video.id,
        title=(title or "").strip() or _material_title_from_filename(raw_name),
        kind=kind,
        file_path=stored_name,
        file_size=size,
        created_by=user.id,
        # 归属跟着父视频:admin 给平台视频配的课件也是平台共享(NULL),
        # 不能照抄 user.org_id —— admin 的 users.org_id 是 NOT NULL DEFAULT 1,
        # 那样会让平台视频下挂着一份属于机构 1 的课件
        org_id=video.org_id,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)

    # 转换 + 渲染。失败只记 render_error,不删文件也不报 500(老师可重传)
    try:
        pages = await phonetic_material_service.prepare(path, m.id, kind)
        m.page_count = pages
        m.render_ready = True
        m.render_error = None
    except Exception as exc:    # noqa: BLE001 - 任何失败都要落到 render_error
        m.render_ready = False
        m.page_count = 0
        m.render_error = f"{exc}"[:400] or f"{type(exc).__name__}"
        logger.warning("音标课件渲染失败: id=%s %s", m.id, exc)
    await db.commit()
    await db.refresh(m)
    logger.info("音标课件上传: id=%s video=%s pages=%s by=%s",
                m.id, video.id, m.page_count, user.id)
    return _material_out(m, user)


class MaterialUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


@router.put("/materials/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: int,
    body: MaterialUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """改标题/排序/上下架。文件本身不换(要换重新上传)"""
    m = await _own_material(db, material_id, user)
    data = body.model_dump(exclude_unset=True)
    if "title" in data and data["title"]:
        m.title = data["title"].strip()
    if "sort_order" in data and data["sort_order"] is not None:
        m.sort_order = data["sort_order"]
    if "is_active" in data and data["is_active"] is not None:
        m.is_active = data["is_active"]
    await db.commit()
    await db.refresh(m)
    return _material_out(m, user)


@router.delete("/materials/{material_id}", status_code=204)
async def delete_material(
    material_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_teacher),
):
    """删课件:先删库再删磁盘(原文件 + 渲染页),与视频删除同惯例"""
    m = await _own_material(db, material_id, user)
    mid, stored = m.id, m.file_path
    await db.delete(m)
    await db.commit()
    _remove_material_files(mid, stored)
    return None
