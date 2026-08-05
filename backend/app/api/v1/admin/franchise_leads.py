"""平台管理端 - 加盟意向线索管理

意向客户咨询加盟 → 录入线索 → 跟进流转(新咨询→已联系→发资料→洽谈→考察→签约/流失)
→ 签约后可关联开出的机构。仅平台 admin 可用(加盟是平台级业务,org_admin 不可见)。

导出:GET /franchise-leads/export 返回按当前筛选的全量 JSON,前端用 xlsx 库生成
Excel 下载(项目惯例,见 AdminUserManagement)。禁止在后端把报表写进 UPLOAD_DIR
(该目录经 /api/v1/files 公开无鉴权,见 CLAUDE.md 安全须知)。
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_today, local_month_utc_range, utc_now
from app.api.v1.auth import get_current_admin
from app.models.user import User
from app.models.franchise_lead import FranchiseLead, FranchiseLeadFollowUp
from app.models.organization import Organization

router = APIRouter()

# 状态机:前端下拉/校验与此对齐,别造新值
LEAD_STATUSES = ("new", "contacted", "materials_sent", "negotiating", "visited", "signed", "lost")
CHANNELS = ("phone", "wechat", "website", "referral", "douyin", "exhibition", "other")
INTENT_LEVELS = ("high", "medium", "low")
FOLLOW_METHODS = ("phone", "wechat", "meeting", "visit", "other")


# ---------- Schemas ----------

class LeadCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    wechat: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=30)
    city: Optional[str] = Field(None, max_length=50)
    channel: Optional[str] = None
    intent_level: Optional[str] = None
    budget: Optional[str] = Field(None, max_length=50)
    background: Optional[str] = Field(None, max_length=2000)
    has_location: Optional[bool] = None
    expected_launch: Optional[str] = Field(None, max_length=50)
    status: str = "new"
    owner_name: Optional[str] = Field(None, max_length=50)
    next_follow_at: Optional[datetime] = None
    notes: Optional[str] = Field(None, max_length=2000)


class LeadUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    wechat: Optional[str] = Field(None, max_length=50)
    email: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=30)
    city: Optional[str] = Field(None, max_length=50)
    channel: Optional[str] = None
    intent_level: Optional[str] = None
    budget: Optional[str] = Field(None, max_length=50)
    background: Optional[str] = Field(None, max_length=2000)
    has_location: Optional[bool] = None
    expected_launch: Optional[str] = Field(None, max_length=50)
    status: Optional[str] = None
    lost_reason: Optional[str] = Field(None, max_length=200)
    owner_name: Optional[str] = Field(None, max_length=50)
    next_follow_at: Optional[datetime] = None
    # next_follow_at=None 语义是"未传不动",清空用独立布尔(同 organizations.clear_expires)
    clear_next_follow: Optional[bool] = None
    org_id: Optional[int] = None
    notes: Optional[str] = Field(None, max_length=2000)


class FollowUpCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    method: Optional[str] = None
    # 顺带流转状态/约下次跟进(跟进和推进通常同时发生,免得两次操作)
    status: Optional[str] = None
    next_follow_at: Optional[datetime] = None


def _to_utc_naive(dt: Optional[datetime]) -> Optional[datetime]:
    """前端送来的时间可能带时区(toISOString 的 Z 后缀),入库前统一转 UTC naive,
    与全库时间戳口径一致(见 core/timeutil.py);naive 视为已是 UTC 原样存。"""
    if dt is None or dt.tzinfo is None:
        return dt
    from datetime import timezone
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _lead_dict(lead: FranchiseLead, org_name: Optional[str] = None,
               last_follow: Optional[str] = None, follow_count: int = 0) -> dict:
    return {
        "id": lead.id,
        "name": lead.name,
        "phone": lead.phone,
        "wechat": lead.wechat,
        "email": lead.email,
        "province": lead.province,
        "city": lead.city,
        "channel": lead.channel,
        "intent_level": lead.intent_level,
        "budget": lead.budget,
        "background": lead.background,
        "has_location": lead.has_location,
        "expected_launch": lead.expected_launch,
        "status": lead.status,
        "lost_reason": lead.lost_reason,
        "owner_name": lead.owner_name,
        "next_follow_at": lead.next_follow_at.isoformat() if lead.next_follow_at else None,
        "signed_at": lead.signed_at.isoformat() if lead.signed_at else None,
        "org_id": lead.org_id,
        "org_name": org_name,
        "notes": lead.notes,
        "last_follow": last_follow,
        "follow_count": follow_count,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
    }


def _validate_enums(status: Optional[str] = None, channel: Optional[str] = None,
                    intent_level: Optional[str] = None, method: Optional[str] = None) -> None:
    if status is not None and status not in LEAD_STATUSES:
        raise HTTPException(status_code=422, detail=f"无效状态: {status}")
    if channel is not None and channel not in CHANNELS:
        raise HTTPException(status_code=422, detail=f"无效渠道: {channel}")
    if intent_level is not None and intent_level not in INTENT_LEVELS:
        raise HTTPException(status_code=422, detail=f"无效意向等级: {intent_level}")
    if method is not None and method not in FOLLOW_METHODS:
        raise HTTPException(status_code=422, detail=f"无效跟进方式: {method}")


def _list_query(status: Optional[str], channel: Optional[str], intent_level: Optional[str],
                keyword: Optional[str], date_from: Optional[str], date_to: Optional[str],
                follow: Optional[str]):
    """列表/导出共用的筛选条件。follow: today=今日待跟进, overdue=已逾期。"""
    q = select(FranchiseLead)
    if status:
        q = q.where(FranchiseLead.status == status)
    if channel:
        q = q.where(FranchiseLead.channel == channel)
    if intent_level:
        q = q.where(FranchiseLead.intent_level == intent_level)
    if keyword:
        kw = f"%{keyword.strip()}%"
        q = q.where(or_(
            FranchiseLead.name.like(kw),
            FranchiseLead.phone.like(kw),
            FranchiseLead.wechat.like(kw),
            FranchiseLead.city.like(kw),
            FranchiseLead.province.like(kw),
        ))
    if date_from:
        q = q.where(FranchiseLead.created_at >= f"{date_from} 00:00:00")
    if date_to:
        q = q.where(FranchiseLead.created_at <= f"{date_to} 23:59:59")
    if follow == "today":
        # 下次跟进时间在今天(北京日历日)之内或已逾期,且还没到终态
        from app.core.timeutil import local_today_utc_range
        _, today_end = local_today_utc_range()
        q = q.where(
            FranchiseLead.next_follow_at.isnot(None),
            FranchiseLead.next_follow_at < today_end,
            FranchiseLead.status.notin_(("signed", "lost")),
        )
    elif follow == "overdue":
        q = q.where(
            FranchiseLead.next_follow_at.isnot(None),
            FranchiseLead.next_follow_at < utc_now(),
            FranchiseLead.status.notin_(("signed", "lost")),
        )
    return q


async def _attach_follow_info(db: AsyncSession, leads: list[FranchiseLead]) -> dict[int, tuple[str, int]]:
    """批量取每条线索的最近跟进摘要与跟进次数(避免 N+1)。"""
    if not leads:
        return {}
    ids = [l.id for l in leads]
    rows = (await db.execute(
        select(FranchiseLeadFollowUp.lead_id, FranchiseLeadFollowUp.content,
               FranchiseLeadFollowUp.created_at)
        .where(FranchiseLeadFollowUp.lead_id.in_(ids))
        .order_by(FranchiseLeadFollowUp.lead_id, FranchiseLeadFollowUp.created_at.desc())
    )).fetchall()
    out: dict[int, tuple[str, int]] = {}
    for lead_id, content, created_at in rows:
        if lead_id in out:
            out[lead_id] = (out[lead_id][0], out[lead_id][1] + 1)
        else:
            date_str = created_at.isoformat()[:10] if created_at else ""
            snippet = (content or "")[:40]
            out[lead_id] = (f"{date_str} {snippet}", 1)
    return out


async def _org_names(db: AsyncSession, leads: list[FranchiseLead]) -> dict[int, str]:
    org_ids = {l.org_id for l in leads if l.org_id}
    if not org_ids:
        return {}
    rows = (await db.execute(
        select(Organization.id, Organization.name).where(Organization.id.in_(org_ids))
    )).fetchall()
    return dict(rows)


# ---------- 统计 ----------

@router.get("/franchise-leads/stats")
async def lead_stats(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """顶部统计卡:总数/本月新增/待跟进(今日+逾期)/已签约 + 状态、渠道分布。"""
    total = (await db.execute(select(func.count(FranchiseLead.id)))).scalar() or 0
    month_start, month_end = local_month_utc_range(local_today())
    month_new = (await db.execute(
        select(func.count(FranchiseLead.id))
        .where(FranchiseLead.created_at >= month_start, FranchiseLead.created_at < month_end)
    )).scalar() or 0
    from app.core.timeutil import local_today_utc_range
    _, today_end = local_today_utc_range()
    pending_follow = (await db.execute(
        select(func.count(FranchiseLead.id)).where(
            FranchiseLead.next_follow_at.isnot(None),
            FranchiseLead.next_follow_at < today_end,
            FranchiseLead.status.notin_(("signed", "lost")),
        )
    )).scalar() or 0
    by_status_rows = (await db.execute(
        select(FranchiseLead.status, func.count(FranchiseLead.id)).group_by(FranchiseLead.status)
    )).fetchall()
    by_status = {s: c for s, c in by_status_rows}
    by_channel_rows = (await db.execute(
        select(FranchiseLead.channel, func.count(FranchiseLead.id))
        .where(FranchiseLead.channel.isnot(None)).group_by(FranchiseLead.channel)
    )).fetchall()
    return {
        "total": total,
        "month_new": month_new,
        "pending_follow": pending_follow,
        "signed": by_status.get("signed", 0),
        "by_status": by_status,
        "by_channel": {ch: c for ch, c in by_channel_rows},
    }


# ---------- 导出(全量 JSON,前端生成 Excel) ----------

@router.get("/franchise-leads/export")
async def export_leads(
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    intent_level: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, description="创建起始日 YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="创建截止日 YYYY-MM-DD"),
    follow: Optional[str] = Query(None, description="today/overdue"),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """按当前筛选导出全量(不分页)。前端 xlsx 生成文件下载,后端不落盘。"""
    q = _list_query(status, channel, intent_level, keyword, date_from, date_to, follow)
    leads = (await db.execute(q.order_by(FranchiseLead.created_at.desc()))).scalars().all()
    follow_info = await _attach_follow_info(db, leads)
    org_names = await _org_names(db, leads)
    return [
        _lead_dict(
            l, org_names.get(l.org_id),
            last_follow=follow_info.get(l.id, ("", 0))[0] or None,
            follow_count=follow_info.get(l.id, ("", 0))[1],
        )
        for l in leads
    ]


# ---------- 列表 / CRUD ----------

@router.get("/franchise-leads")
async def list_leads(
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    intent_level: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None, max_length=50),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    follow: Optional[str] = Query(None, description="today=今日待跟进(含逾期) / overdue=仅逾期"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    q = _list_query(status, channel, intent_level, keyword, date_from, date_to, follow)
    total = (await db.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar() or 0
    leads = (await db.execute(
        q.order_by(FranchiseLead.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    follow_info = await _attach_follow_info(db, leads)
    org_names = await _org_names(db, leads)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            _lead_dict(
                l, org_names.get(l.org_id),
                last_follow=follow_info.get(l.id, ("", 0))[0] or None,
                follow_count=follow_info.get(l.id, ("", 0))[1],
            )
            for l in leads
        ],
    }


@router.post("/franchise-leads")
async def create_lead(
    body: LeadCreate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    _validate_enums(status=body.status, channel=body.channel, intent_level=body.intent_level)
    # 手机号重复提醒(不硬拦:同一人可能多次咨询,但重复录入大概率是失误)
    if body.phone:
        dup = (await db.execute(
            select(FranchiseLead.id).where(FranchiseLead.phone == body.phone).limit(1)
        )).scalar_one_or_none()
        if dup is not None:
            raise HTTPException(status_code=409, detail=f"手机号已存在于线索 #{dup},请先搜索查看,避免重复录入")
    lead = FranchiseLead(**body.model_dump())
    lead.next_follow_at = _to_utc_naive(lead.next_follow_at)
    if lead.status == "signed":
        lead.signed_at = utc_now()
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    return _lead_dict(lead)


@router.get("/franchise-leads/{lead_id}")
async def get_lead(
    lead_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(FranchiseLead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="线索不存在")
    follow_ups = (await db.execute(
        select(FranchiseLeadFollowUp).where(FranchiseLeadFollowUp.lead_id == lead_id)
        .order_by(FranchiseLeadFollowUp.created_at.desc())
    )).scalars().all()
    org_name = None
    if lead.org_id:
        org_name = (await db.execute(
            select(Organization.name).where(Organization.id == lead.org_id)
        )).scalar_one_or_none()
    d = _lead_dict(lead, org_name, follow_count=len(follow_ups))
    d["follow_ups"] = [
        {
            "id": f.id,
            "method": f.method,
            "content": f.content,
            "status_after": f.status_after,
            "created_by_name": f.created_by_name,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in follow_ups
    ]
    return d


@router.patch("/franchise-leads/{lead_id}")
async def update_lead(
    lead_id: int,
    body: LeadUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(FranchiseLead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="线索不存在")
    _validate_enums(status=body.status, channel=body.channel, intent_level=body.intent_level)
    data = body.model_dump(exclude_unset=True)
    clear_next = data.pop("clear_next_follow", None)
    if "next_follow_at" in data:
        data["next_follow_at"] = _to_utc_naive(data["next_follow_at"])
    # 关联机构要真实存在,防手滑填错 id 造出悬空关联
    if data.get("org_id") is not None:
        org = await db.get(Organization, data["org_id"])
        if org is None:
            raise HTTPException(status_code=404, detail="关联的机构不存在")
    for k, v in data.items():
        setattr(lead, k, v)
    if clear_next:
        lead.next_follow_at = None
    # 首次流转到已签约自动记签约时间(改回其他状态不清,保留史实)
    if body.status == "signed" and lead.signed_at is None:
        lead.signed_at = utc_now()
    await db.commit()
    await db.refresh(lead)
    return _lead_dict(lead)


@router.delete("/franchise-leads/{lead_id}", status_code=204)
async def delete_lead(
    lead_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(FranchiseLead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="线索不存在")
    # 跟进记录一并删(SQLite 默认不执行 ON DELETE CASCADE,显式删干净)
    for f in (await db.execute(
        select(FranchiseLeadFollowUp).where(FranchiseLeadFollowUp.lead_id == lead_id)
    )).scalars().all():
        await db.delete(f)
    await db.delete(lead)
    await db.commit()
    return None


# ---------- 跟进记录 ----------

@router.post("/franchise-leads/{lead_id}/follow-ups")
async def add_follow_up(
    lead_id: int,
    body: FollowUpCreate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(FranchiseLead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="线索不存在")
    _validate_enums(status=body.status, method=body.method)
    if body.status:
        lead.status = body.status
        if body.status == "signed" and lead.signed_at is None:
            lead.signed_at = utc_now()
    if body.next_follow_at is not None:
        lead.next_follow_at = _to_utc_naive(body.next_follow_at)
    fu = FranchiseLeadFollowUp(
        lead_id=lead_id,
        method=body.method,
        content=body.content,
        status_after=lead.status,
        created_by=admin.id,
        created_by_name=admin.full_name or admin.username,
    )
    db.add(fu)
    await db.commit()
    await db.refresh(fu)
    return {
        "id": fu.id,
        "method": fu.method,
        "content": fu.content,
        "status_after": fu.status_after,
        "created_by_name": fu.created_by_name,
        "created_at": fu.created_at.isoformat() if fu.created_at else None,
    }
