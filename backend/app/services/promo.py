"""地推体验卡 + 销售跟单 —— 口径唯一真源(模型说明见 models/promo.py)

整条链路:
  机构管理员给每个销售开账号(role='sales')、给每个销售开一版或几版卡(卡码)→ 按卡码打印卡片
  → 家长扫卡上的码打开 /c/{卡码},留手机号 + 孩子年级 → 线索记到这张卡当时的销售名下
  → 页面显示这个销售自己上传的微信 / 群二维码(活码: 换图不用重印卡)
  → 销售在「我的线索」里一步步推: 已加微信 → 已付体验费 → 已开通 → 已报正价(或无效),写跟进记录

五条规矩(每条对应一个会被钻的空子 / 会吵架的地方):
1. **扫码先留电话才看到二维码**: 不留电话就给码,线索归不到人,销售之间就只能靠嘴说是谁拉的。
2. **同机构同手机号只认第一张卡**: 家长扫了两个销售的卡,后扫的不新建线索,页面照样显示**第一个销售**的码
   (UNIQUE(org_id, parent_phone) 兜并发)。不这样做,销售会互相去扫同一批家长。
3. **归属按留电话那一刻**: 卡码转交给别人后,已经留下的线索不跟着走,只有之后的归新销售;改归属只有机构管理员能做。
4. **各阶段时间只写不清**: 改回去、标无效都不清 —— 漏斗和提成按「走到过哪一步」算,不能被事后改状态抹掉。
5. **「学满 5 天」看真实学习记录**(study_calendar,与每日陪跑同口径),不看销售标的状态 ——
   抖音方案里提成按学满 5 天的人数给,不按卖了多少张卡(按卡数给会拉凑数的单)。
"""
from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.promo import (
    PromoCardDesign, PromoChannel, PromoFollowUp, PromoLead, PromoOrgSettings, PromoSalesProfile,
)
from app.models.user import StudyCalendar, User
from app.services.referral import mask_phone, normalize_phone  # noqa: F401  mask_phone 给 API 写操作记录用

# 卡码字母表: 去掉 0/O/1/I/L 这些印在卡上、念电话时会认错的字符
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_CODE_LEN = 8

DEFAULT_TRIAL_PRICE = 99   # 用户 10-23 定: 9.9 改 99,「这样家长才愿意掏钱」
MAX_PRICE = 100000


def money(v):
    """金额规整成给前端的数: 保留两位小数,整数就给整数(99 而不是 99.0,卡面和文件名里写「99」)。
    10-24 用户「没法输入 9.9」: 体验价和实收原先都只收整数元"""
    if v is None:
        return None
    x = round(float(v), 2)
    return int(x) if x == int(x) else x


def parse_money(v, what: str):
    """收进来的金额: 0~10 万元、最多两位小数(第三位四舍五入),NaN / 无穷拒掉"""
    import math
    x = float(v)
    if not math.isfinite(x) or x < 0 or x > MAX_PRICE:
        raise HTTPException(status_code=400, detail=f"{what}要在 0 到 {MAX_PRICE} 元之间")
    return round(x, 2)
DEFAULT_OFFER = "7 天 AI 陪跑:每天一份单词任务 + 20 个复习词,老师每天点评,第 7 天给家长一份学习总结。"

STATUSES = ("new", "contacted", "paid", "opened", "won", "lost")
STATUS_LABELS = {
    "new": "待联系", "contacted": "已加微信", "paid": "已付体验费",
    "opened": "已开通", "won": "已报正价", "lost": "无效",
}
# 状态 → 第一次到达时写的时间列。走到后面的状态时,前面没写过的一并补上(直接标「已付」= 也加过微信了)
_STAGE_ORDER = ("contacted", "paid", "opened", "won")
_STAGE_COL = {"contacted": "contacted_at", "paid": "paid_at", "opened": "opened_at", "won": "won_at"}

OWNER_ROLES = ("sales", "org_admin", "admin")   # 能挂卡码、能有线索的账号(admin 只在自己那个机构)
QR_STALE_DAYS = 6                     # 个人微信群码 7 天过期: 6 天没换就提醒
STUDY_DAYS_TARGET = 5                 # 开通后 7 天里学满几天算「学满」
# 卡面模板(2026-10-23 先出 20 套,10-24 再加 30 套 = 50 套): 图在 frontend/public/promo-card/tpl/,
# 前端 data/promoTemplates.ts 同一组 id(加模板: 出图 → OCR 核对 → 扫白框 → 重写那个 .ts → 改这里的范围)
# (tests/test_promo.py 解析那个 .ts 锁住两边一致)。新开的卡按「本机构还没人用的」顺序分一套,不同销售的卡一眼分得开
TEMPLATE_IDS = tuple(f"t{i:02d}" for i in range(1, 51))
DEFAULT_TEMPLATE = TEMPLATE_IDS[0]
_PHONE_PRINT_RE = re.compile(r"^[0-9+\- ]{5,20}$")   # 卡上印的电话: 数字、+、横线、空格

GRADES = ("幼儿园", "一年级", "二年级", "三年级", "四年级", "五年级", "六年级",
          "初一", "初二", "初三", "高一", "高二", "高三")


def _clip(s: Optional[str], n: int) -> Optional[str]:
    s = (s or "").strip()
    return s[:n] if s else None


def display_name(u: Optional[User]) -> str:
    if u is None:
        return "(已删除)"
    return (u.full_name or u.username or "").strip()


def to_local_str(dt: Optional[datetime]) -> Optional[str]:
    """库里存 UTC naive,给前端北京时间(YYYY-MM-DDTHH:MM)"""
    if dt is None:
        return None
    return (dt + timedelta(hours=8)).strftime("%Y-%m-%dT%H:%M")


def parse_local(s: Optional[str]) -> Optional[datetime]:
    """前端传北京时间(datetime-local 控件的值,不带时区)→ UTC naive。空串/None → None"""
    s = (s or "").strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="下次跟进时间格式不对")
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt - timedelta(hours=8)


# ---------------- 设置 ----------------

async def get_settings(db: AsyncSession, org_id: int) -> dict:
    row = await db.get(PromoOrgSettings, org_id)
    return {
        "trial_price": money(row.trial_price) if row and row.trial_price is not None else DEFAULT_TRIAL_PRICE,
        "offer_text": (row.offer_text if row and row.offer_text else DEFAULT_OFFER),
    }


async def save_settings(db: AsyncSession, org_id: int, data: dict) -> dict:
    row = await db.get(PromoOrgSettings, org_id)
    if row is None:
        row = PromoOrgSettings(org_id=org_id)
        db.add(row)
    # 「留空 = 恢复默认」走显式分支(CLAUDE.md: 空串别被 if 吞掉)
    if "trial_price" in data:
        p = data["trial_price"]
        if p is None:
            row.trial_price = None
        else:
            row.trial_price = parse_money(p, "体验价")
    if "offer_text" in data:
        row.offer_text = _clip(data["offer_text"], 200)
    await db.flush()
    return await get_settings(db, org_id)


# ---------------- 销售 ----------------

async def get_profile(db: AsyncSession, user_id: int) -> Optional[PromoSalesProfile]:
    return await db.get(PromoSalesProfile, user_id)


async def ensure_profile(db: AsyncSession, user: User) -> PromoSalesProfile:
    p = await db.get(PromoSalesProfile, user.id)
    if p is None:
        p = PromoSalesProfile(user_id=user.id, org_id=user.org_id)
        db.add(p)
        await db.flush()
    return p


def profile_out(p: Optional[PromoSalesProfile]) -> dict:
    stale = False
    if p and p.qr_image_url and p.qr_kind == "group" and p.qr_updated_at:
        stale = datetime.utcnow() - p.qr_updated_at > timedelta(days=QR_STALE_DAYS)
    return {
        "qr_image_url": (p.qr_image_url if p else None) or "",
        "qr_kind": (p.qr_kind if p else None) or "wechat",
        "wechat_hint": (p.wechat_hint if p else None) or "",
        "qr_updated_at": to_local_str(p.qr_updated_at) if p else None,
        # 群码 7 天过期: 超过 6 天没换,家长扫了进不去,后台标黄
        "qr_stale": stale,
    }


async def load_owner(db: AsyncSession, user_id: int, org_id: int) -> User:
    """卡码的主人: 本机构在用的销售或机构管理员。别家的 / 停用的 / 学生老师一律 400"""
    u = (await db.execute(
        select(User).where(User.id == user_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if u is None or u.org_id != org_id or u.role not in OWNER_ROLES or not u.is_active:
        raise HTTPException(status_code=400, detail="只能挂给本机构在用的销售账号")
    return u


async def load_sales(db: AsyncSession, user_id: int, org_id: int) -> User:
    """管理员改销售账号用: 只认本机构 role=sales 的(机构管理员账号不在这里改)"""
    u = (await db.execute(
        select(User).where(User.id == user_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if u is None or u.org_id != org_id or u.role != "sales":
        raise HTTPException(status_code=404, detail="销售账号不存在")
    return u


# ---------------- 卡码 ----------------

async def create_channel(db: AsyncSession, org_id: int, name: str, owner: User, created_by: int) -> PromoChannel:
    nm = _clip(name, 60) or f"{display_name(owner)}的体验卡"
    for _ in range(5):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))
        ch = PromoChannel(org_id=org_id, code=code, name=nm, sales_user_id=owner.id, created_by=created_by)
        try:
            # 撞码(8 位 31 进制,几乎不会)只回滚这一条: 用保存点,整个会话 rollback 会让调用方的 ORM 对象过期
            async with db.begin_nested():
                db.add(ch)
                await db.flush()
            db.add(PromoCardDesign(channel_id=ch.id, template_id=await _next_template(db, org_id)))
            await db.flush()
            return ch
        except IntegrityError:
            continue
    raise HTTPException(status_code=500, detail="卡码生成失败,请重试")


async def _next_template(db: AsyncSession, org_id: int) -> str:
    """本机构在用的卡还没用过的第一套;全都用过了就按卡数轮"""
    used = (await db.execute(
        select(PromoCardDesign.template_id)
        .join(PromoChannel, PromoChannel.id == PromoCardDesign.channel_id)
        .where(PromoChannel.org_id == org_id, PromoChannel.is_active.is_(True))
    )).scalars().all()
    for t in TEMPLATE_IDS:
        if t not in used:
            return t
    return TEMPLATE_IDS[len(used) % len(TEMPLATE_IDS)]


async def designs_of(db: AsyncSession, channel_ids) -> dict[int, PromoCardDesign]:
    ids = [i for i in channel_ids if i]
    if not ids:
        return {}
    return {d.channel_id: d for d in (await db.execute(
        select(PromoCardDesign).where(PromoCardDesign.channel_id.in_(ids))
    )).scalars().all()}


def design_out(d: Optional[PromoCardDesign], owner: Optional[User]) -> dict:
    """卡上印什么。名字/电话没自定义过就用销售账号上的;display_phone 空串 = 老师选了不印电话"""
    tpl = d.template_id if d and d.template_id in TEMPLATE_IDS else DEFAULT_TEMPLATE
    name = d.display_name if d and d.display_name else display_name(owner) if owner else ""
    if d is not None and d.display_phone is not None:
        phone = d.display_phone
    else:
        phone = (owner.phone if owner else None) or ""
    return {"template_id": tpl, "display_name": name, "display_phone": phone}


async def save_design(db: AsyncSession, ch: PromoChannel, data: dict) -> PromoCardDesign:
    d = await db.get(PromoCardDesign, ch.id)
    if d is None:
        d = PromoCardDesign(channel_id=ch.id)
        db.add(d)
    if "template_id" in data:
        t = data["template_id"]
        if t not in TEMPLATE_IDS:
            raise HTTPException(status_code=400, detail="没有这套模板")
        d.template_id = t
    # 「留空 = 用账号上的」走显式分支(CLAUDE.md: 空串别被 if 吞掉)
    if "display_name" in data:
        d.display_name = _clip(data["display_name"], 20)
    if "display_phone" in data:
        v = (data["display_phone"] or "").strip()
        if v and not _PHONE_PRINT_RE.match(v):
            raise HTTPException(status_code=400, detail="电话只能填数字、空格和横线")
        d.display_phone = v   # 空串 = 不印电话(和 NULL「跟账号走」区分开)
    await db.flush()
    return d


async def resolve_channel(db: AsyncSession, code: str) -> tuple[PromoChannel, Organization, Optional[User]]:
    """落地页用。码不存在 / 停用 / 机构停用一律 404,不区分原因(公开接口不告诉外人这张卡是谁的、机构什么状态)"""
    c = (code or "").strip().upper()
    if not c or len(c) > 16:
        raise HTTPException(status_code=404, detail="这张卡的二维码无效")
    ch = (await db.execute(select(PromoChannel).where(PromoChannel.code == c))).scalar_one_or_none()
    if ch is None or not ch.is_active:
        raise HTTPException(status_code=404, detail="这张卡已经停用了,请联系发卡的老师")
    org = await db.get(Organization, ch.org_id)
    if org is None or org.status != "active":
        raise HTTPException(status_code=404, detail="这张卡已经停用了,请联系发卡的老师")
    owner = None
    if ch.sales_user_id:
        owner = (await db.execute(
            select(User).where(User.id == ch.sales_user_id).execution_options(skip_tenant_filter=True)
        )).scalar_one_or_none()
    return ch, org, owner


async def bump_view(db: AsyncSession, channel_id: int) -> None:
    # 原子加: 读出来 +1 再写回,地推现场几十人同时扫会互相覆盖
    await db.execute(update(PromoChannel).where(PromoChannel.id == channel_id)
                     .values(view_count=PromoChannel.view_count + 1))
    await db.commit()


# ---------------- 落地页留电话 ----------------

async def _contact_of(db: AsyncSession, sales_user_id: Optional[int]) -> dict:
    """给家长看的「加谁」: 销售名字 + 二维码。销售停用了就不给码(家长扫了加不上人)"""
    if not sales_user_id:
        return {"sales_name": "", "qr_image_url": "", "wechat_hint": ""}
    u = (await db.execute(
        select(User).where(User.id == sales_user_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if u is None or not u.is_active:
        return {"sales_name": "", "qr_image_url": "", "wechat_hint": ""}
    p = await db.get(PromoSalesProfile, u.id)
    return {
        "sales_name": display_name(u),
        "qr_image_url": (p.qr_image_url if p else None) or "",
        "wechat_hint": (p.wechat_hint if p else None) or "",
    }


async def submit_lead(db: AsyncSession, code: str, data: dict) -> dict:
    """返回 {"status": "created" | "duplicate", 二维码...}。duplicate 不报错,
    回第一个销售的码 —— 家长换个销售的卡再扫一次,加的还是同一个人"""
    ch, _org, _owner = await resolve_channel(db, code)
    phone = normalize_phone(data.get("parent_phone", ""))
    grade = _clip(data.get("child_grade"), 20)
    if grade and grade not in GRADES:
        grade = None

    existing = (await db.execute(
        select(PromoLead).where(PromoLead.org_id == ch.org_id, PromoLead.parent_phone == phone)
    )).scalar_one_or_none()
    if existing is not None:
        return {"status": "duplicate", **(await _contact_of(db, existing.sales_user_id))}

    # 手机号已是本机构学生/家长账号: 老客户,不拦(可能给二孩报名),列表里标出来
    old = (await db.execute(
        select(User.id).where(User.phone == phone, User.org_id == ch.org_id)
        .execution_options(skip_tenant_filter=True).limit(1)
    )).scalar_one_or_none()
    sales_id = ch.sales_user_id
    lead = PromoLead(
        org_id=ch.org_id, channel_id=ch.id, sales_user_id=sales_id,
        parent_phone=phone, parent_name=_clip(data.get("parent_name"), 30), child_grade=grade,
        existing_account=old is not None,
    )
    db.add(lead)
    try:
        await db.commit()
    except IntegrityError:
        # 两张卡同时提交同一个手机号: 后到的撞 UNIQUE,当成已登记,回先到那条的销售
        await db.rollback()
        first = (await db.execute(
            select(PromoLead.sales_user_id).where(PromoLead.org_id == ch.org_id, PromoLead.parent_phone == phone)
        )).scalar_one_or_none()
        return {"status": "duplicate", **(await _contact_of(db, first))}
    return {"status": "created", **(await _contact_of(db, sales_id))}


# ---------------- 线索 ----------------

def apply_status(lead: PromoLead, status: str, now: datetime) -> None:
    if status not in STATUSES:
        raise HTTPException(status_code=400, detail="状态不对")
    lead.status = status
    if status in _STAGE_ORDER:
        # 走到这一步 = 前面几步也都走过了(直接标「已付」的,加微信那步也补上时间)
        for st in _STAGE_ORDER[: _STAGE_ORDER.index(status) + 1]:
            col = _STAGE_COL[st]
            if getattr(lead, col) is None:
                setattr(lead, col, now)


def scope_stmt(stmt, org_id: Optional[int], sales_user_id: Optional[int]):
    """机构过滤显式写。sales_user_id 非空 = 销售只看自己的;org_id None = 平台 admin 看全平台(只读汇总用)"""
    if org_id is not None:
        stmt = stmt.where(PromoLead.org_id == org_id)
    if sales_user_id is not None:
        stmt = stmt.where(PromoLead.sales_user_id == sales_user_id)
    return stmt


async def load_lead(db: AsyncSession, lead_id: int, org_id: Optional[int], sales_user_id: Optional[int]) -> PromoLead:
    lead = (await db.execute(
        scope_stmt(select(PromoLead).where(PromoLead.id == lead_id), org_id, sales_user_id)
    )).scalar_one_or_none()
    if lead is None:
        # 别人的线索和不存在一样回 404,不告诉销售「这条是别人的」
        raise HTTPException(status_code=404, detail="线索不存在")
    return lead


def is_overdue(lead: PromoLead, now: datetime) -> bool:
    return (lead.next_follow_at is not None and lead.next_follow_at < now
            and lead.status not in ("won", "lost"))


async def _users_by_id(db: AsyncSession, ids) -> dict[int, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(ids)).execution_options(skip_tenant_filter=True)
    )).scalars().all()}


def lead_out(lead: PromoLead, users: dict[int, User], channels: dict[int, PromoChannel],
             now: datetime, studied: Optional[int] = None) -> dict:
    ch = channels.get(lead.channel_id) if lead.channel_id else None
    stu = users.get(lead.student_id) if lead.student_id else None
    return {
        "id": lead.id,
        "parent_phone": lead.parent_phone,
        "parent_name": lead.parent_name or "",
        "child_grade": lead.child_grade or "",
        "existing_account": bool(lead.existing_account),
        "status": lead.status,
        "status_label": STATUS_LABELS.get(lead.status, lead.status),
        "note": lead.note or "",
        "next_follow_at": to_local_str(lead.next_follow_at),
        "overdue": is_overdue(lead, now),
        "paid_amount": money(lead.paid_amount),
        "sales_user_id": lead.sales_user_id,
        "sales_name": display_name(users.get(lead.sales_user_id)) if lead.sales_user_id else "(未分配)",
        "channel_id": lead.channel_id,
        "channel_name": ch.name if ch else "(卡已删除)",
        "channel_code": ch.code if ch else "",
        "student_id": lead.student_id,
        "student_name": display_name(stu) if stu else "",
        "studied_days": studied,
        "created_at": to_local_str(lead.created_at),
        "contacted_at": to_local_str(lead.contacted_at),
        "paid_at": to_local_str(lead.paid_at),
        "opened_at": to_local_str(lead.opened_at),
        "won_at": to_local_str(lead.won_at),
    }


async def studied_days(db: AsyncSession, leads: list[PromoLead]) -> dict[int, int]:
    """每条已开通且关联了学生号的线索: 开通当天起 7 天里实际学了几天(与每日陪跑同一个「学了」判据)"""
    rows = [(l.id, l.student_id, l.opened_at) for l in leads if l.student_id and l.opened_at]
    if not rows:
        return {}
    start = {lid: (op + timedelta(hours=8)).date() for lid, _, op in rows}
    learned = or_(func.coalesce(StudyCalendar.duration, 0) > 0, func.coalesce(StudyCalendar.words_learned, 0) > 0)
    sids = {sid for _, sid, _ in rows}
    first = min(start.values())
    days: dict[int, set[date]] = {}
    for uid, d in (await db.execute(
        select(StudyCalendar.user_id, StudyCalendar.study_date)
        .where(StudyCalendar.user_id.in_(sids), StudyCalendar.study_date >= first, learned)
    )).all():
        d = date.fromisoformat(d) if isinstance(d, str) else d
        days.setdefault(uid, set()).add(d)
    out = {}
    for lid, sid, _ in rows:
        s = start[lid]
        out[lid] = sum(1 for d in days.get(sid, ()) if s <= d < s + timedelta(days=7))
    return out


async def list_leads(db: AsyncSession, org_id: Optional[int], sales_user_id: Optional[int], *,
                     status: Optional[str] = None, owner: Optional[int] = None,
                     overdue_only: bool = False, search: Optional[str] = None,
                     page: int = 1, size: int = 20) -> dict:
    now = datetime.utcnow()
    stmt = scope_stmt(select(PromoLead), org_id, sales_user_id)
    if status:
        if status not in STATUSES:
            raise HTTPException(status_code=400, detail="状态不对")
        stmt = stmt.where(PromoLead.status == status)
    if owner is not None:
        stmt = stmt.where(PromoLead.sales_user_id == owner)
    if overdue_only:
        stmt = stmt.where(PromoLead.next_follow_at.is_not(None), PromoLead.next_follow_at < now,
                          PromoLead.status.not_in(("won", "lost")))
    if search:
        kw = search.strip()[:30]
        # LIKE 的 _ 和 % 要转义(CLAUDE.md 记过: 下划线是通配符)
        esc = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(or_(PromoLead.parent_phone.like(f"%{esc}%", escape="\\"),
                              PromoLead.parent_name.like(f"%{esc}%", escape="\\")))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    page = max(1, page)
    size = max(1, min(100, size))
    leads = list((await db.execute(
        stmt.order_by(PromoLead.id.desc()).offset((page - 1) * size).limit(size)
    )).scalars().all())

    users = await _users_by_id(db, [l.sales_user_id for l in leads] + [l.student_id for l in leads])
    chs = {c.id: c for c in (await db.execute(
        select(PromoChannel).where(PromoChannel.id.in_({l.channel_id for l in leads if l.channel_id} or {-1}))
    )).scalars().all()}
    sd = await studied_days(db, leads)

    count_rows = (await db.execute(
        scope_stmt(select(PromoLead.status, func.count(PromoLead.id)), org_id, sales_user_id)
        .group_by(PromoLead.status)
    )).all()
    counts = {s: 0 for s in STATUSES}
    counts.update({s: int(n) for s, n in count_rows})
    overdue = (await db.execute(
        scope_stmt(select(func.count(PromoLead.id)), org_id, sales_user_id)
        .where(PromoLead.next_follow_at.is_not(None), PromoLead.next_follow_at < now,
               PromoLead.status.not_in(("won", "lost")))
    )).scalar() or 0
    return {
        "items": [lead_out(l, users, chs, now, sd.get(l.id)) for l in leads],
        "total": int(total), "page": page, "size": size,
        "counts": counts,
        "overdue": int(overdue),
        "statuses": [{"value": s, "label": STATUS_LABELS[s]} for s in STATUSES],
    }


async def link_student(db: AsyncSession, lead: PromoLead, ref: str) -> User:
    """开通后把线索关联到学生号(按用户名或手机号找,只找本机构的学生)。「学满 5 天」靠它算"""
    ref = (ref or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="请填学生的用户名或手机号")
    stu = (await db.execute(
        select(User).where(User.org_id == lead.org_id, User.role == "student",
                           or_(User.username == ref, User.phone == ref))
        .order_by(User.id.desc()).limit(1).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if stu is None:
        raise HTTPException(status_code=400, detail="本机构没找到这个学生账号,先开好学生号再关联")
    lead.student_id = stu.id
    return stu


def add_follow_up(db: AsyncSession, lead: PromoLead, actor: User, content: str,
                  status_after: Optional[str] = None) -> None:
    db.add(PromoFollowUp(lead_id=lead.id, content=content[:2000], status_after=status_after,
                         created_by=actor.id, created_by_name=display_name(actor)))


async def follow_ups(db: AsyncSession, lead_id: int) -> list[dict]:
    rows = (await db.execute(
        select(PromoFollowUp).where(PromoFollowUp.lead_id == lead_id).order_by(PromoFollowUp.id.desc())
    )).scalars().all()
    return [{
        "id": r.id, "content": r.content,
        "status_after": r.status_after,
        "status_label": STATUS_LABELS.get(r.status_after or "", ""),
        "created_by_name": r.created_by_name or "",
        "created_at": to_local_str(r.created_at),
    } for r in rows]


# ---------------- 看板 ----------------

async def board(db: AsyncSession, org_id: int, since: Optional[datetime], until: Optional[datetime]) -> dict:
    """按销售分别看: 卡码几版 / 扫码打开 / 留电话 / 加微信 / 付费 / 开通 / 学满 5 天 / 报正价 / 实收。
    时间段按「留电话的时间」切(这批线索后来走到了哪一步),不按各阶段发生的时间 ——
    后者会把上个月的线索这个月成交算进本月,两个月的转化率都失真"""
    stmt = select(PromoLead).where(PromoLead.org_id == org_id)
    if since is not None:
        stmt = stmt.where(PromoLead.created_at >= since)
    if until is not None:
        stmt = stmt.where(PromoLead.created_at < until)
    leads = list((await db.execute(stmt)).scalars().all())
    sd = await studied_days(db, leads)

    chans = list((await db.execute(select(PromoChannel).where(PromoChannel.org_id == org_id))).scalars().all())
    owners = (await db.execute(
        select(User).where(User.org_id == org_id, User.role.in_(OWNER_ROLES))
        .execution_options(skip_tenant_filter=True)
    )).scalars().all()
    now = datetime.utcnow()
    owned = await owned_counts(db, org_id, [u.id for u in owners])

    def blank(uid, name, active, role=None):
        return {"sales_user_id": uid, "name": name, "is_active": active, "channels": 0, "views": 0,
                "leads": 0, "contacted": 0, "paid": 0, "opened": 0, "studied": 0, "won": 0,
                "lost": 0, "revenue": 0, "overdue": 0,
                # 看板上能点「删除」的只有销售账号(机构管理员 / 平台管理员自己发卡的那行不能删);
                # owned_* 是名下全部(不随日期段变),删之前判断要不要选接手人
                "role": role, "deletable": role == "sales", "owned_channels": 0, "owned_leads": 0}
    rows: dict = {}
    for u in owners:
        oc = owned.get(u.id, {"channels": 0, "leads": 0})
        has_any = bool(oc["channels"] or oc["leads"])
        # 停用了、名下也没有卡和线索的销售不上看板: 删账号前常先停用,一排全 0 的旧账号只是噪音
        if u.role == "sales" and not u.is_active and not has_any:
            continue
        if u.role == "sales" or has_any or any(l.sales_user_id == u.id for l in leads):
            r = rows[u.id] = blank(u.id, display_name(u), bool(u.is_active), u.role)
            r["owned_channels"], r["owned_leads"] = oc["channels"], oc["leads"]
    for c in chans:
        r = rows.setdefault(c.sales_user_id, blank(c.sales_user_id, "(未分配)", True))
        r["channels"] += 1
        r["views"] += int(c.view_count or 0)   # 打开次数是累计的,不随时间段变(没存每次打开的时间)
    for l in leads:
        r = rows.setdefault(l.sales_user_id, blank(l.sales_user_id, "(未分配)", True))
        r["leads"] += 1
        r["contacted"] += l.contacted_at is not None
        r["paid"] += l.paid_at is not None
        r["opened"] += l.opened_at is not None
        r["studied"] += sd.get(l.id, 0) >= STUDY_DAYS_TARGET
        r["won"] += l.won_at is not None
        r["lost"] += l.status == "lost"
        r["revenue"] += float(l.paid_amount or 0)
        r["overdue"] += is_overdue(l, now)
    items = sorted(rows.values(), key=lambda r: (-r["won"], -r["studied"], -r["paid"], -r["leads"]))
    total = blank(None, "合计", True)
    for r in items:
        for k in ("channels", "views", "leads", "contacted", "paid", "opened", "studied", "won", "lost", "revenue", "overdue"):
            total[k] += r[k]
    # 实收按浮点加(9.9 × 3 = 29.700000000000003),出口统一规整
    for r in [*items, total]:
        r["revenue"] = money(r["revenue"])
    return {"items": items, "total": total, "study_days_target": STUDY_DAYS_TARGET}


# ---------------- 删除销售 ----------------

async def owned_counts(db: AsyncSession, org_id: int, user_ids) -> dict[int, dict]:
    """每个人名下几版卡、几条线索(删销售前要知道要不要选接手人)"""
    ids = [i for i in user_ids if i]
    out = {i: {"channels": 0, "leads": 0} for i in ids}
    if not ids:
        return out
    for uid, n in (await db.execute(
        select(PromoChannel.sales_user_id, func.count(PromoChannel.id))
        .where(PromoChannel.org_id == org_id, PromoChannel.sales_user_id.in_(ids))
        .group_by(PromoChannel.sales_user_id)
    )).all():
        out[uid]["channels"] = int(n)
    for uid, n in (await db.execute(
        select(PromoLead.sales_user_id, func.count(PromoLead.id))
        .where(PromoLead.org_id == org_id, PromoLead.sales_user_id.in_(ids))
        .group_by(PromoLead.sales_user_id)
    )).all():
        out[uid]["leads"] = int(n)
    return out


async def delete_sales(db: AsyncSession, sales: User, transfer_to: Optional[User], actor: User) -> dict:
    """删销售账号。名下有卡或线索就必须选一个接手人 —— 不转就删,线索没人跟、卡扫了显示不出微信。
    生产库外键是关的(CLAUDE.md: 删用户前必查依赖),所以引用都在这里显式改掉再删行"""
    c = (await owned_counts(db, sales.org_id, [sales.id]))[sales.id]
    if (c["channels"] or c["leads"]) and transfer_to is None:
        raise HTTPException(status_code=409, detail={
            "code": "TRANSFER_REQUIRED",
            "message": f"他名下还有 {c['channels']} 版卡、{c['leads']} 条线索,先选一个接手的人",
            **c,
        })
    if transfer_to is not None and transfer_to.id == sales.id:
        raise HTTPException(status_code=400, detail="不能转给他自己")
    moved_leads = 0
    if transfer_to is not None:
        await db.execute(update(PromoChannel)
                         .where(PromoChannel.org_id == sales.org_id, PromoChannel.sales_user_id == sales.id)
                         .values(sales_user_id=transfer_to.id))
        lead_ids = list((await db.execute(
            select(PromoLead.id).where(PromoLead.org_id == sales.org_id, PromoLead.sales_user_id == sales.id)
        )).scalars().all())
        if lead_ids:
            await db.execute(update(PromoLead).where(PromoLead.id.in_(lead_ids))
                             .values(sales_user_id=transfer_to.id))
            note = f"销售「{display_name(sales)}」账号删除,线索转给「{display_name(transfer_to)}」"
            for lid in lead_ids:
                db.add(PromoFollowUp(lead_id=lid, content=note, created_by=actor.id,
                                     created_by_name=display_name(actor)))
        moved_leads = len(lead_ids)
    prof = await db.get(PromoSalesProfile, sales.id)
    if prof is not None:
        await db.delete(prof)
    await db.delete(sales)
    await db.flush()
    return {"moved_channels": c["channels"], "moved_leads": moved_leads}


# ---------------- 删线索 / 删卡码(只给机构管理员) ----------------

def _lead_snapshot(l: PromoLead, users: dict, chs: dict) -> dict:
    """删前快照,写进操作记录 —— 删完行就没了,只存 id 追不了责(CLAUDE.md 操作记录那条)"""
    ch = chs.get(l.channel_id) if l.channel_id else None
    return {
        "id": l.id, "parent_phone": l.parent_phone, "parent_name": l.parent_name or "",
        "child_grade": l.child_grade or "", "status": l.status,
        "sales": display_name(users.get(l.sales_user_id)) if l.sales_user_id else "(未分配)",
        "channel": f"{ch.name}({ch.code})" if ch else "(卡已删除)",
        "paid_amount": money(l.paid_amount), "student_id": l.student_id,
        "created_at": to_local_str(l.created_at), "note": (l.note or "")[:200],
    }


async def delete_leads(db: AsyncSession, org_id: int, ids) -> list[dict]:
    """删线索,返回被删那几条的快照(调用方写操作记录)。
    **只删本机构的**: 混进别家机构的 id 直接忽略;跟进记录显式一起删 —— 生产外键是关的,不会级联。
    删了以后这个手机号可以重新扫码登记(同号只认第一张卡的约束跟着这条线索一起没了)"""
    want = sorted({int(i) for i in ids if i})
    if not want:
        return []
    leads = list((await db.execute(
        select(PromoLead).where(PromoLead.org_id == org_id, PromoLead.id.in_(want))
    )).scalars().all())
    if not leads:
        return []
    users = await _users_by_id(db, [l.sales_user_id for l in leads])
    chs = {c.id: c for c in (await db.execute(
        select(PromoChannel).where(PromoChannel.id.in_({l.channel_id for l in leads if l.channel_id} or {-1}))
    )).scalars().all()}
    snaps = [_lead_snapshot(l, users, chs) for l in leads]
    await db.execute(delete(PromoFollowUp).where(PromoFollowUp.lead_id.in_([l.id for l in leads])))
    for l in leads:
        await db.delete(l)
    await db.flush()
    return snaps


async def delete_channel(db: AsyncSession, ch: PromoChannel) -> dict:
    """删一版卡码。印出去的卡扫了会显示「已停用」(码查不到 = 404,和停用同一句话)。
    已经留下的线索**留着**,归属销售不变,只断开和这版卡的关联(列表里卡名显示「(卡已删除)」)——
    线索是家长留的电话,不该跟着一张卡没了。卡面设计一起删。
    看板里这版卡的「扫开」次数跟着没了(打开次数只记在卡码上)"""
    kept = (await db.execute(
        select(func.count(PromoLead.id)).where(PromoLead.org_id == ch.org_id, PromoLead.channel_id == ch.id)
    )).scalar() or 0
    snap = {"id": ch.id, "code": ch.code, "name": ch.name, "sales_user_id": ch.sales_user_id,
            "view_count": int(ch.view_count or 0), "is_active": bool(ch.is_active), "leads_kept": int(kept)}
    await db.execute(update(PromoLead).where(PromoLead.org_id == ch.org_id, PromoLead.channel_id == ch.id)
                     .values(channel_id=None))
    await db.execute(delete(PromoCardDesign).where(PromoCardDesign.channel_id == ch.id))
    await db.delete(ch)
    await db.flush()
    return snap
