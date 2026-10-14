"""家长推荐(老带新)—— 口径唯一真源

整条链路:
  老生家长(或老师替老生)拿邀请链接 /invite/{code}
  → 朋友家长打开落地页,看到「谁推荐的 + 机构 + 新朋友能得到什么」,留姓名电话
  → 推荐线索进机构/老师的「推荐线索」列表,老师联系、约试听
  → 老师点「确认报名」→ 系统给推荐的那个孩子发金币(机构设了才发),
    线下奖励(如赠课)记成「待兑现」,老师兑现后点「已兑现」

四条规矩(每一条都对应一个会被钻的空子):
1. **只在确认报名后发奖励**,留电话不发: 注册/留资都不验手机号,按留资发奖励一个孩子能刷几十个假号;
   微信也禁止按「分享」给奖励(诱导分享会封域名,学生端与落地页同域名)。
2. **同一机构同一手机号只认第一个推荐人**: 两个老生都推荐了同一家,先提交的算;
   UNIQUE(org_id, parent_phone) 兜底并发 —— 两边同时提交,后到的撞约束后回成「已登记」。
3. **手机号已是本机构账号的不算拉新**(existing_account): 不拦提交(可能是老生给弟弟妹妹报名),
   但列表里标出来,确认报名时默认不发奖励,老师勾「仍然发放」才发。
4. **金币 dedup_key = referral:{lead_id}**: 双击「确认报名」、两个老师同时点,都只发一次。

这些表不在 tenancy 锚点里,所有查询显式写 org_id(落地页公开无鉴权,没有机构上下文)。
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.referral import OrgReferralSettings, ReferralInvite, ReferralLead
from app.models.user import User

# 邀请码字母表: 去掉 0/O/1/I/L 这些在微信截图里会认错的字符
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_LEN = 8
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

STATUSES = ("new", "contacted", "trial", "enrolled", "invalid")
STATUS_LABELS = {
    "new": "待联系", "contacted": "已联系", "trial": "已试听",
    "enrolled": "已报名", "invalid": "无效",
}
REWARD_LABELS = {"none": "不发", "pending": "待兑现", "granted": "已兑现"}

MAX_REWARD_COINS = 50  # 推荐奖励金币上限(金币日常一天最多 2 枚,50 已经很大方;防手滑填成 5000)

COIN_SOURCE = "referral"


def normalize_phone(raw: str) -> str:
    """去空格/横线/+86 前缀;不合法抛 400(落地页要给家长一句能看懂的话)"""
    p = re.sub(r"[\s\-()]", "", raw or "")
    if p.startswith("+86"):
        p = p[3:]
    elif p.startswith("86") and len(p) == 13:
        p = p[2:]
    if not PHONE_RE.match(p):
        raise HTTPException(status_code=400, detail="手机号格式不对,请填 11 位手机号")
    return p


def mask_name(name: Optional[str]) -> str:
    """落地页上推荐人只露姓 + 「同学」: 不把孩子全名摆在公开链接上"""
    n = (name or "").strip()
    if not n:
        return "一位同学"
    return f"{n[0]}同学"


def mask_phone(p: Optional[str]) -> str:
    if not p or len(p) < 7:
        return p or ""
    return f"{p[:3]}****{p[-4:]}"


def _clip(s: Optional[str], n: int) -> Optional[str]:
    s = (s or "").strip()
    return s[:n] or None


# ---------------- 设置 ----------------

async def get_settings(db: AsyncSession, org_id: int) -> OrgReferralSettings:
    """没有行返回一个未入库的默认对象(开启、不发金币)。调用方只读,别拿去 add"""
    row = await db.get(OrgReferralSettings, org_id)
    return row or OrgReferralSettings(org_id=org_id, enabled=True, reward_coins=0,
                                      reward_text=None, friend_offer=None)


def settings_out(s: OrgReferralSettings) -> dict:
    return {
        "enabled": bool(s.enabled),
        "reward_coins": int(s.reward_coins or 0),
        "reward_text": s.reward_text or "",
        "friend_offer": s.friend_offer or "",
        "max_reward_coins": MAX_REWARD_COINS,
    }


async def save_settings(db: AsyncSession, org_id: int, data: dict) -> OrgReferralSettings:
    """「留空=不修改」那个坑在这里不存在: 前端整份提交,空串就是「清空这句话」。
    所以判的是**键在不在**,在就照写(空串落 None),不在才保留旧值。"""
    row = await db.get(OrgReferralSettings, org_id)
    if row is None:
        row = OrgReferralSettings(org_id=org_id, enabled=True, reward_coins=0)
        db.add(row)
    if "enabled" in data:
        row.enabled = bool(data["enabled"])
    if "reward_coins" in data:
        coins = int(data["reward_coins"] or 0)
        if coins < 0 or coins > MAX_REWARD_COINS:
            raise HTTPException(status_code=400, detail=f"推荐奖励金币要在 0–{MAX_REWARD_COINS} 之间")
        row.reward_coins = coins
    if "reward_text" in data:
        row.reward_text = _clip(data["reward_text"], 200)
    if "friend_offer" in data:
        row.friend_offer = _clip(data["friend_offer"], 200)
    return row


# ---------------- 邀请码 ----------------

async def get_or_create_invite(db: AsyncSession, student_id: int, org_id: int,
                               created_by: Optional[int]) -> ReferralInvite:
    """一个学生一个码,重复调用返回同一个(家长端和老师端拿到的是同一条链接)。

    参数收的是 id 不是 User 对象: 并发首次生成撞 UNIQUE 后要 rollback,rollback 会让会话里
    所有 ORM 对象过期,再读 student.id 就是异步懒加载 → MissingGreenlet 500(金币发放踩过同一个坑)。

    学生换了机构(直营学生扫别家班级码入班会被迁过去)时,把码的 org_id 跟过去 ——
    否则链接按旧机构校验永远 404,线索也会落到旧机构"""
    existing = (await db.execute(
        select(ReferralInvite).where(ReferralInvite.student_id == student_id)
    )).scalar_one_or_none()
    if existing is not None:
        if existing.org_id != org_id:
            existing.org_id = org_id
            await db.commit()
        return existing
    for _ in range(5):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))
        inv = ReferralInvite(code=code, org_id=org_id, student_id=student_id, created_by=created_by)
        db.add(inv)
        try:
            await db.commit()
            return inv
        except IntegrityError:
            await db.rollback()
            existing = (await db.execute(
                select(ReferralInvite).where(ReferralInvite.student_id == student_id)
            )).scalar_one_or_none()
            if existing is not None:
                return existing
            # 撞的是 code(8 位 31 进制,几乎不会)→ 换一个再试
    raise HTTPException(status_code=500, detail="邀请码生成失败,请重试")


async def invite_stats(db: AsyncSession, invite_id: int) -> dict:
    """这个码带来了多少: 留资数 / 报名数"""
    rows = (await db.execute(
        select(ReferralLead.status, func.count(ReferralLead.id))
        .where(ReferralLead.invite_id == invite_id)
        .group_by(ReferralLead.status)
    )).all()
    by = {s: n for s, n in rows}
    return {"leads": sum(by.values()), "enrolled": by.get("enrolled", 0)}


async def resolve_invite(db: AsyncSession, code: str) -> tuple[ReferralInvite, User, Organization]:
    """落地页用: 码 → (邀请, 推荐的孩子, 机构)。码不存在 / 孩子停用 / 机构停用或关了推荐一律 404,
    不区分原因(公开接口不告诉外人这个码属于谁、机构是什么状态)"""
    c = (code or "").strip().upper()
    if not c or len(c) > 16:
        raise HTTPException(status_code=404, detail="邀请链接无效")
    inv = (await db.execute(
        select(ReferralInvite).where(ReferralInvite.code == c)
    )).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="邀请链接无效")
    student = (await db.execute(
        select(User).where(User.id == inv.student_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    org = await db.get(Organization, inv.org_id)
    if (student is None or not student.is_active or student.role != "student"
            or student.org_id != inv.org_id or org is None or org.status != "active"):
        raise HTTPException(status_code=404, detail="邀请链接已失效")
    s = await get_settings(db, inv.org_id)
    if not s.enabled:
        raise HTTPException(status_code=404, detail="邀请链接已失效")
    return inv, student, org


# ---------------- 线索 ----------------

async def submit_lead(db: AsyncSession, code: str, data: dict) -> dict:
    """落地页提交。返回 {"status": "created" | "duplicate"};duplicate 不报错 ——
    家长重复点提交、或已被别人推荐过,都回一句「已登记,老师会联系您」,
    不告诉他「已经被谁推荐了」(那是别人家的信息)"""
    inv, student, _org = await resolve_invite(db, code)
    phone = normalize_phone(data.get("parent_phone", ""))

    dup = (await db.execute(
        select(ReferralLead.id).where(ReferralLead.org_id == inv.org_id, ReferralLead.parent_phone == phone)
    )).scalar_one_or_none()
    if dup is not None:
        return {"status": "duplicate"}

    # 手机号已是本机构账号(学生自己注册的手机号 / 已绑定的家长)→ 老客户,标出来
    existing = (await db.execute(
        select(User.id).where(User.phone == phone, User.org_id == inv.org_id)
        .execution_options(skip_tenant_filter=True).limit(1)
    )).scalar_one_or_none()

    lead = ReferralLead(
        org_id=inv.org_id,
        invite_id=inv.id,
        referrer_student_id=student.id,
        parent_name=_clip(data.get("parent_name"), 30),
        parent_phone=phone,
        child_name=_clip(data.get("child_name"), 30),
        child_grade=_clip(data.get("child_grade"), 20),
        note=_clip(data.get("note"), 200),
        existing_account=existing is not None,
    )
    db.add(lead)
    try:
        await db.commit()
    except IntegrityError:
        # 两个推荐人同时提交同一个手机号: 后到的撞 UNIQUE,当成已登记
        await db.rollback()
        return {"status": "duplicate"}
    return {"status": "created"}


def lead_out(lead: ReferralLead, referrer: Optional[User], *, full_phone: bool = True) -> dict:
    return {
        "id": lead.id,
        "parent_name": lead.parent_name or "",
        "parent_phone": lead.parent_phone if full_phone else mask_phone(lead.parent_phone),
        "child_name": lead.child_name or "",
        "child_grade": lead.child_grade or "",
        "note": lead.note or "",
        "existing_account": bool(lead.existing_account),
        "status": lead.status,
        "status_label": STATUS_LABELS.get(lead.status, lead.status),
        "staff_note": lead.staff_note or "",
        "referrer_student_id": lead.referrer_student_id,
        "referrer_name": (referrer.full_name or referrer.username) if referrer else "(已删除)",
        "reward_status": lead.reward_status,
        "reward_status_label": REWARD_LABELS.get(lead.reward_status, lead.reward_status),
        "reward_coins": int(lead.reward_coins or 0),
        "reward_text": lead.reward_text or "",
        "enrolled_at": lead.enrolled_at,
        "reward_granted_at": lead.reward_granted_at,
        "created_at": lead.created_at,
    }


def scope_leads(stmt, org_id: Optional[int], student_ids: Optional[set[int]]):
    """机构过滤显式写。student_ids 非空 = 老师只看本班学生推荐来的;None = 机构管理员看全机构"""
    if org_id is not None:
        stmt = stmt.where(ReferralLead.org_id == org_id)
    if student_ids is not None:
        stmt = stmt.where(ReferralLead.referrer_student_id.in_(student_ids or {-1}))
    return stmt


async def list_leads(db: AsyncSession, org_id: Optional[int], student_ids: Optional[set[int]],
                     status: Optional[str] = None, search: Optional[str] = None) -> dict:
    stmt = scope_leads(select(ReferralLead), org_id, student_ids)
    if status:
        if status not in STATUSES:
            raise HTTPException(status_code=400, detail="状态不对")
        stmt = stmt.where(ReferralLead.status == status)
    if search:
        kw = search.strip()[:30]
        # LIKE 的 _ 和 % 要转义(CLAUDE.md 记过: 下划线是通配符)
        esc = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(or_(
            ReferralLead.parent_phone.like(f"%{esc}%", escape="\\"),
            ReferralLead.parent_name.like(f"%{esc}%", escape="\\"),
            ReferralLead.child_name.like(f"%{esc}%", escape="\\"),
        ))
    leads = (await db.execute(stmt.order_by(ReferralLead.id.desc()).limit(500))).scalars().all()

    ref_ids = {l.referrer_student_id for l in leads if l.referrer_student_id}
    refs = {}
    if ref_ids:
        refs = {u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(ref_ids)).execution_options(skip_tenant_filter=True)
        )).scalars().all()}

    # 汇总: 按状态计数 + 待兑现奖励数 + 推荐榜(按报名数)
    sum_rows = (await db.execute(
        scope_leads(select(ReferralLead.status, func.count(ReferralLead.id)), org_id, student_ids)
        .group_by(ReferralLead.status)
    )).all()
    counts = {s: 0 for s in STATUSES}
    counts.update({s: n for s, n in sum_rows})
    pending_rewards = (await db.execute(
        scope_leads(select(func.count(ReferralLead.id)), org_id, student_ids)
        .where(ReferralLead.reward_status == "pending")
    )).scalar() or 0

    top_rows = (await db.execute(
        scope_leads(select(ReferralLead.referrer_student_id,
                           func.count(ReferralLead.id),
                           func.sum(case((ReferralLead.status == "enrolled", 1), else_=0))),
                    org_id, student_ids)
        .where(ReferralLead.referrer_student_id.is_not(None))
        .group_by(ReferralLead.referrer_student_id)
    )).all()
    top_ids = {r[0] for r in top_rows} - set(refs)
    if top_ids:
        refs.update({u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(top_ids)).execution_options(skip_tenant_filter=True)
        )).scalars().all()})
    top = sorted(
        ({"student_id": sid, "name": (refs[sid].full_name or refs[sid].username) if sid in refs else "(已删除)",
          "leads": int(n), "enrolled": int(e or 0)} for sid, n, e in top_rows),
        key=lambda x: (-x["enrolled"], -x["leads"]),
    )[:10]

    return {
        "items": [lead_out(l, refs.get(l.referrer_student_id)) for l in leads],
        "counts": counts,
        "total": sum(counts.values()),
        "pending_rewards": int(pending_rewards),
        "top_referrers": top,
    }


async def load_lead(db: AsyncSession, lead_id: int, org_id: Optional[int],
                    student_ids: Optional[set[int]]) -> ReferralLead:
    """别家机构 / 别班学生推荐的线索一律 404(不暴露存在与否)"""
    lead = (await db.execute(
        scope_leads(select(ReferralLead).where(ReferralLead.id == lead_id), org_id, student_ids)
    )).scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="线索不存在")
    return lead


async def confirm_enrolled(db: AsyncSession, lead: ReferralLead, operator: User,
                           grant_reward: bool) -> dict:
    """确认报名并发奖励。调用方负责 commit(与操作日志同一事务)。

    状态用条件 UPDATE 认领(WHERE status != 'enrolled'): 两个老师同时点,只有一个成功,
    另一个回 409 —— 金币那边 dedup_key 也会挡,这里挡的是「两条日志 + 两次线下奖励待兑现」。
    """
    from app.services import coin_service

    if lead.status == "enrolled":
        raise HTTPException(status_code=409, detail="这条已经确认过报名了")
    s = await get_settings(db, lead.org_id)
    # 老客户(手机号已是本机构账号)默认不发: 前端先弹确认,老师勾了「仍然发放」才带 grant_reward=True
    give = grant_reward or not lead.existing_account
    coins = int(s.reward_coins or 0) if give else 0
    reward_text = (s.reward_text or None) if give else None

    now = datetime.utcnow()
    res = await db.execute(
        update(ReferralLead)
        .where(ReferralLead.id == lead.id, ReferralLead.status != "enrolled")
        .values(status="enrolled", enrolled_at=now, enrolled_by=operator.id,
                reward_coins=coins, reward_text=reward_text,
                reward_status="pending" if reward_text else "none")
    )
    if res.rowcount != 1:
        raise HTTPException(status_code=409, detail="这条已经确认过报名了")

    coin_granted = False
    if coins > 0 and lead.referrer_student_id:
        referrer = (await db.execute(
            select(User).where(User.id == lead.referrer_student_id).execution_options(skip_tenant_filter=True)
        )).scalar_one_or_none()
        # 推荐人后来转去别家机构 / 被删: 不发(金币是机构自己的奖励)
        if referrer is not None and referrer.org_id == lead.org_id and referrer.role == "student":
            who = lead.child_name or lead.parent_name or "新同学"
            tx = await coin_service.apply_delta(
                db, referrer.id, referrer.org_id, coins, COIN_SOURCE,
                reason=f"推荐 {who} 报名成功",
                dedup_key=f"referral:{lead.id}",
                operator_id=operator.id,
            )
            coin_granted = tx is not None
    return {"coins": coins if coin_granted else 0, "reward_text": reward_text or ""}
