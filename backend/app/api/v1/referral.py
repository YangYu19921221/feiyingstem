"""家长推荐(老带新)API —— 口径与规矩全在 services/referral.py

三组端点:
- 公开(落地页,无鉴权): GET /referral/public/{code}、POST /referral/public/{code}/leads
- 家长 / 老师拿邀请链接: GET /parent/children/{sid}/invite、GET /teacher/referral/students/{sid}/invite
- 跟进(老师看本班学生推荐来的,机构管理员看全机构): /referral/leads...、/referral/settings

公开提交按 IP 限速: 落地页不验手机号,不限速就是一个往机构线索表灌垃圾的口子。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_parent, get_current_teacher, require_role
from app.api.v1.teacher._permissions import assert_student_in_my_class, get_my_class_student_ids
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import ParentStudentLink, User
from app.services import audit_log, rate_limit
from app.services import referral as svc
from app.services.weak_words import mastery_buckets

router = APIRouter()

get_lead_staff = require_role("teacher", "org_admin", "admin")
get_org_manager = require_role("org_admin", "admin")


# ================== Schemas ==================

class LeadSubmit(BaseModel):
    # 长度在 service 里截断,这里放宽: 超长报 422 英文串对家长没用
    parent_name: Optional[str] = Field(None, max_length=100)
    parent_phone: str = Field(..., max_length=30)
    child_name: Optional[str] = Field(None, max_length=100)
    child_grade: Optional[str] = Field(None, max_length=50)
    note: Optional[str] = Field(None, max_length=500)


class LeadUpdate(BaseModel):
    status: Optional[str] = None
    staff_note: Optional[str] = Field(None, max_length=2000)


class EnrollRequest(BaseModel):
    # 手机号已是本机构账号(老客户)时,前端先弹确认,老师勾了才带 True
    grant_reward: bool = False


class SettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    reward_coins: Optional[int] = None
    reward_text: Optional[str] = Field(None, max_length=500)
    friend_offer: Optional[str] = Field(None, max_length=500)


# ================== 公开: 落地页 ==================

@router.get("/referral/public/{code}")
async def public_invite(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    # 家长会现场几十人连同一个 Wi-Fi 扫码,出口 IP 是同一个,别卡太紧
    await rate_limit.check(("referral-view", audit_log.client_ip(request) or "-"), 200, 60,
                     "打开太频繁了,请稍后再试")
    inv, student, org = await svc.resolve_invite(db, code)
    s = await svc.get_settings(db, inv.org_id)
    words = (await mastery_buckets(db, [student.id])).get(student.id, {}).get("words", 0)
    return {
        "org_name": org.name,
        "org_logo": org.logo_url or "",
        "referrer": svc.mask_name(student.full_name),
        # 推荐的孩子学了多少词: 给新家长一个具体的数字,比「效果好」可信。0 就不显示
        "referrer_words": int(words),
        "friend_offer": s.friend_offer or "",
    }


@router.post("/referral/public/{code}/leads")
async def public_submit(code: str, body: LeadSubmit, request: Request,
                        db: AsyncSession = Depends(get_db)):
    # 按 IP 限速,但不能卡太紧: 家长会现场几十位家长连同一个 Wi-Fi 扫码,出口 IP 是同一个;
    # 再加一道按邀请码的,防一个码被脚本灌满线索
    ip = audit_log.client_ip(request) or "-"
    await rate_limit.check(("referral-submit", ip), 30, 600, "提交太频繁了,请 10 分钟后再试")
    await rate_limit.check(("referral-submit-code", (code or "").upper()[:16]), 20, 600,
                     "这个邀请链接提交太频繁了,请稍后再试")
    return await svc.submit_lead(db, code, body.model_dump())


# ================== 拿邀请链接 ==================

async def _invite_payload(db: AsyncSession, student: User, creator_id: int) -> dict:
    # 先把要用的字段取成局部变量: 生成邀请码那步可能 commit/rollback,之后不能再碰 ORM 对象
    sid, org_id, child_name = student.id, student.org_id, (student.full_name or student.username)
    inv = await svc.get_or_create_invite(db, sid, org_id, creator_id)
    code, invite_id = inv.code, inv.id
    s = await svc.get_settings(db, org_id)
    org = await db.get(Organization, org_id)
    stats = await svc.invite_stats(db, invite_id)
    words = (await mastery_buckets(db, [sid])).get(sid, {}).get("words", 0)
    return {
        "code": code,
        "path": f"/invite/{code}",
        "enabled": bool(s.enabled),
        "org_name": org.name if org else "",
        "child_name": child_name,
        # 海报上「孩子已经学会了 N 个单词」: 与家长端看板 total_words_learned 同一口径(mastery_buckets)
        "words": int(words),
        "friend_offer": s.friend_offer or "",
        "reward_coins": int(s.reward_coins or 0),
        "reward_text": s.reward_text or "",
        **stats,
    }


@router.get("/parent/children/{student_id}/invite")
async def parent_child_invite(student_id: int, db: AsyncSession = Depends(get_db),
                              current_parent: User = Depends(get_current_parent)):
    link = (await db.execute(
        select(ParentStudentLink).where(and_(
            ParentStudentLink.parent_id == current_parent.id,
            ParentStudentLink.student_id == student_id,
        ))
    )).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="没有绑定这个孩子")
    student = (await db.execute(
        select(User).where(User.id == student_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="孩子账号不存在")
    return await _invite_payload(db, student, current_parent.id)


@router.get("/teacher/referral/students/{student_id}/invite")
async def teacher_student_invite(student_id: int, db: AsyncSession = Depends(get_db),
                                 current_user: User = Depends(get_current_teacher)):
    """老师替本班学生拿链接,发到家长群/私聊(生产上家长账号是 0,这是主要入口)"""
    if current_user.role != "admin":
        await assert_student_in_my_class(db, current_user.id, student_id)
    student = (await db.execute(select(User).where(User.id == student_id))).scalar_one_or_none()
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="学生不存在")
    return await _invite_payload(db, student, current_user.id)


# ================== 跟进 ==================

async def _scope(db: AsyncSession, user: User) -> tuple[Optional[int], Optional[set[int]]]:
    """(org_id, student_ids): admin=全平台;org_admin=本机构;老师=本机构 + 只看本班学生推荐来的"""
    if user.role == "admin":
        return None, None
    if user.role == "org_admin":
        return user.org_id, None
    return user.org_id, await get_my_class_student_ids(db, user.id)


@router.get("/referral/leads")
async def list_referral_leads(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_lead_staff),
):
    org_id, sids = await _scope(db, current_user)
    data = await svc.list_leads(db, org_id, sids, status, search)
    s = await svc.get_settings(db, current_user.org_id) if org_id is not None else None
    data["settings"] = svc.settings_out(s) if s is not None else None
    data["can_edit_settings"] = current_user.role in ("org_admin", "admin") and org_id is not None
    return data


@router.patch("/referral/leads/{lead_id}")
async def update_referral_lead(lead_id: int, body: LeadUpdate, request: Request,
                               db: AsyncSession = Depends(get_db),
                               current_user: User = Depends(get_lead_staff)):
    org_id, sids = await _scope(db, current_user)
    lead = await svc.load_lead(db, lead_id, org_id, sids)
    data = body.model_dump(exclude_unset=True)
    if "status" in data:
        st = data["status"]
        if st == "enrolled":
            raise HTTPException(status_code=400, detail="确认报名请点「确认报名」(会发推荐奖励)")
        if st not in svc.STATUSES:
            raise HTTPException(status_code=400, detail="状态不对")
        if lead.status == "enrolled":
            # 奖励已经发出去了,不让改回去 —— 改回去再点一次确认就是第二份线下奖励
            raise HTTPException(status_code=409, detail="已确认报名的线索不能改状态")
        lead.status = st
    if "staff_note" in data:
        lead.staff_note = (data["staff_note"] or "").strip()[:2000] or None
    await db.commit()
    return {"ok": True}


@router.post("/referral/leads/{lead_id}/enroll")
async def enroll_referral_lead(lead_id: int, body: EnrollRequest, request: Request,
                               db: AsyncSession = Depends(get_db),
                               current_user: User = Depends(get_lead_staff)):
    org_id, sids = await _scope(db, current_user)
    lead = await svc.load_lead(db, lead_id, org_id, sids)
    result = await svc.confirm_enrolled(db, lead, current_user, body.grant_reward)
    who = lead.child_name or lead.parent_name or svc.mask_phone(lead.parent_phone)
    audit_log.record(
        db, request, current_user, "referral.enroll",
        f"确认推荐报名: {who}(奖励 {result['coins']} 金币"
        + (f",线下: {result['reward_text']}" if result["reward_text"] else "") + ")",
        target_type="referral_lead", target_id=lead.id,
        detail={"lead_id": lead.id, "referrer_student_id": lead.referrer_student_id,
                "existing_account": lead.existing_account, **result},
    )
    await db.commit()
    return result


@router.post("/referral/leads/{lead_id}/reward-granted")
async def mark_reward_granted(lead_id: int, request: Request,
                              db: AsyncSession = Depends(get_db),
                              current_user: User = Depends(get_lead_staff)):
    """线下奖励(赠课等)兑现了点一下,列表上「待兑现」变「已兑现」,机构对账用"""
    org_id, sids = await _scope(db, current_user)
    lead = await svc.load_lead(db, lead_id, org_id, sids)
    if lead.reward_status != "pending":
        raise HTTPException(status_code=409, detail="这条没有待兑现的奖励")
    from datetime import datetime
    lead.reward_status = "granted"
    lead.reward_granted_at = datetime.utcnow()
    audit_log.record(db, request, current_user, "referral.reward",
                     f"兑现推荐奖励: {lead.reward_text or ''}",
                     target_type="referral_lead", target_id=lead.id)
    await db.commit()
    return {"ok": True}


@router.put("/referral/settings")
async def update_referral_settings(body: SettingsUpdate, request: Request,
                                   db: AsyncSession = Depends(get_db),
                                   current_user: User = Depends(get_org_manager)):
    """只给机构管理员(平台 admin 没有自己的机构,不改别家的奖励规则)。
    老师不能改: 奖励是机构的钱,老师自己定奖励等于自己给自己班批预算"""
    if current_user.role == "admin":
        raise HTTPException(status_code=400, detail="推荐奖励由各机构管理员在机构端设置")
    row = await svc.save_settings(db, current_user.org_id, body.model_dump(exclude_unset=True))
    audit_log.record(db, request, current_user, "referral.settings",
                     f"修改推荐奖励: {row.reward_coins} 金币 / {row.reward_text or '无线下奖励'}"
                     + ("" if row.enabled else "(已关闭推荐)"),
                     detail=svc.settings_out(row))
    await db.commit()
    return svc.settings_out(row)
