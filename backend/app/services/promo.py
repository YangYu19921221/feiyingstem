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

## 体验期 + 老带新延期(2026-10-29,用户「家长分享一个用户报名了就增加 7 天,2 个 14 天以此增加,
## 并且分享的用户报名付费了才有效」→「别的按你建议」: 最多算 4 家、朋友付了体验费就算)
- **体验期是真的日期**: 「开通体验」= 给孩子的学生号按包月卡口径开限期授权(book_assignments.grant_type='period'),
  到期自动锁。到期时间只在 trial_expiry() 一处算: 开通那天(北京日)起 7 天 + 每计入一家朋友 7 天(最多 max_count 家)。
  学生本来就有的书不碰;被兑换码续期 / 升级永久 / 老师改过的授权(到期日和体验记的对不上)不再管
- **朋友怎么来**: 每条线索一个分享码,链接 = 卡上那个地址 /c/{卡码}?f={分享码}。朋友留电话 → 新线索记上推荐人、
  归推荐人那家的销售。同号只认第一次不变(朋友之前扫过卡 = 不算推荐);手机号已是本机构账号 = 老客户,不计入
- **什么时候算**: 朋友那条线索走到过「已付体验费」**且实收 > 0** 才算(credited_at 只写一次)。只留电话 / 加微信不算
- **退款**: 状态「已退款」→ 这家不再算(revoked_at 只写不清),推荐人的到期日跟着往前缩;孩子今天正在学的话保底到今天 24 点
  (floor_until 只在缩的那一刻写,之后不按当前时间推,否则每次重算都会顺延)
- 体验已经过期才有朋友付费: 从今天起再给 7 天(gap_days 记中间空着的天数)
- 合规: 落地页 / 邀请链接 / 进度页**不写**「转发得 7 天」「分享有奖」—— 微信按利益诱导分享封域名,学生端同域名。
  奖励规则只写在销售和管理员看的页面里,由销售私聊告诉家长
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

from app.core.timeutil import local_day_utc_range
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.promo import (
    PromoCardDesign, PromoChannel, PromoFollowUp, PromoLead, PromoLeadLink, PromoOrgSettings,
    PromoReferralSettings, PromoSalesProfile, PromoTrial,
)
from app.models.user import StudyCalendar, User
from app.models.word import WordBook
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


CARD_ADDRESS_MAX = 22   # 卡正面印的地址最多几个字: 22 个汉字在最小字号下刚好放进名字条(utils/promoPrint TWO_LINE_TEXT_W)
DEFAULT_OFFER = "7 天 AI 陪跑:每天一份单词任务 + 20 个复习词,老师每天点评,第 7 天给家长一份学习总结。"

STATUSES = ("new", "contacted", "paid", "opened", "won", "lost", "refunded")
STATUS_LABELS = {
    "new": "待联系", "contacted": "已加微信", "paid": "已付体验费",
    "opened": "已开通", "won": "已报正价", "lost": "无效", "refunded": "已退款",
}
CLOSED_STATUSES = ("won", "lost", "refunded")   # 不用再跟进的(不标「该跟进了」)
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
    ref = await referral_settings(db, org_id)
    return {
        "trial_price": money(row.trial_price) if row and row.trial_price is not None else DEFAULT_TRIAL_PRICE,
        "offer_text": (row.offer_text if row and row.offer_text else DEFAULT_OFFER),
        "card_address": (row.card_address if row and row.card_address else ""),
        "referral_enabled": ref["enabled"],
        "referral_max": ref["max_count"],
        "referral_days": REFERRAL_DAYS,
        "trial_days": TRIAL_DAYS,
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
    # 地址: 键在才改(只改体验价的请求不能把地址抹掉),空串 = 不印;换行、连续空格并成一个空格(卡上只印一行)
    if "card_address" in data:
        a = " ".join((data["card_address"] or "").split())
        if len(a) > CARD_ADDRESS_MAX:
            raise HTTPException(status_code=400, detail=f"地址最多 {CARD_ADDRESS_MAX} 个字,再长卡上印不下")
        row.card_address = a or None
    if "referral_enabled" in data or "referral_max" in data:
        ref = await db.get(PromoReferralSettings, org_id)
        if ref is None:
            ref = PromoReferralSettings(org_id=org_id, enabled=True, max_count=DEFAULT_REFERRAL_MAX)
            db.add(ref)
        if data.get("referral_enabled") is not None:
            ref.enabled = bool(data["referral_enabled"])
        old_max = ref.max_count
        if data.get("referral_max") is not None:
            m = int(data["referral_max"])
            if m < 0 or m > MAX_REFERRAL_MAX:
                raise HTTPException(status_code=400, detail=f"最多算几家要在 0 到 {MAX_REFERRAL_MAX} 之间")
            ref.max_count = m
        await db.flush()
        if ref.max_count != old_max:
            # 上限改了: 已经开着的体验都按新上限重算(调低了的,孩子今天在学的保底到今天 24 点)
            for lid in (await db.execute(select(PromoTrial.lead_id).where(PromoTrial.org_id == org_id))).scalars().all():
                await recompute_trial(db, lid)
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
    """返回 {"status": "created" | "duplicate", 二维码..., "share": 邀请链接}。duplicate 不报错,
    回第一个销售的码 —— 家长换个销售的卡再扫一次,加的还是同一个人。
    data["ref"] = 朋友发来的链接里的分享码(?f=): 只认同机构的;同号已登记过 = 不算推荐(规矩 2 不变)"""
    ch, _org, _owner = await resolve_channel(db, code)
    phone = normalize_phone(data.get("parent_phone", ""))
    grade = _clip(data.get("child_grade"), 20)
    if grade and grade not in GRADES:
        grade = None

    existing = (await db.execute(
        select(PromoLead).where(PromoLead.org_id == ch.org_id, PromoLead.parent_phone == phone)
    )).scalar_one_or_none()
    if existing is not None:
        # 已登记过: 只给邀请链接,**不给看进度的链接** —— 谁都能在这页随手填一个手机号,
        # 给了就能看到那家朋友的手机尾号和孩子的体验日期。看进度的链接找销售要
        return {"status": "duplicate", **(await _contact_of(db, existing.sales_user_id)),
                "share": await _public_share(db, existing, with_view=False)}

    referrer = None
    if data.get("ref") and (await referral_settings(db, ch.org_id))["enabled"]:
        referrer = await resolve_referrer(db, ch.org_id, data.get("ref"))

    # 手机号已是本机构学生/家长账号: 老客户,不拦(可能给二孩报名),列表里标出来
    old = (await db.execute(
        select(User.id).where(User.phone == phone, User.org_id == ch.org_id)
        .execution_options(skip_tenant_filter=True).limit(1)
    )).scalar_one_or_none()
    sales_id = ch.sales_user_id
    if referrer is not None and referrer.sales_user_id:
        # 朋友推荐来的归推荐人那家的销售(那个销售在跟这家人,朋友多半也找他),不归卡的主人
        sales_id = referrer.sales_user_id
    lead = PromoLead(
        org_id=ch.org_id, channel_id=ch.id, sales_user_id=sales_id,
        parent_phone=phone, parent_name=_clip(data.get("parent_name"), 30), child_grade=grade,
        existing_account=old is not None,
    )
    db.add(lead)
    try:
        await db.flush()
        if referrer is not None:
            db.add(PromoLeadLink(lead_id=lead.id, org_id=ch.org_id, referred=True, referred_by_lead_id=referrer.id))
        await db.commit()
    except IntegrityError:
        # 两张卡同时提交同一个手机号: 后到的撞 UNIQUE,当成已登记,回先到那条的销售
        await db.rollback()
        first = (await db.execute(
            select(PromoLead.sales_user_id).where(PromoLead.org_id == ch.org_id, PromoLead.parent_phone == phone)
        )).scalar_one_or_none()
        return {"status": "duplicate", **(await _contact_of(db, first))}
    return {"status": "created", **(await _contact_of(db, sales_id)), "share": await _public_share(db, lead)}


async def _public_share(db: AsyncSession, lead: PromoLead, with_view: bool = True) -> Optional[dict]:
    """落地页登记成功后给家长的「邀请朋友一起体验」链接 + 看进度的链接。关了 / 没卡就不给"""
    info = await share_info(db, lead)
    await db.commit()
    if not info.get("enabled"):
        return None
    return {"card_code": info["card_code"], "share_code": info["share_code"],
            "view_code": info["view_code"] if with_view else None}


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
            and lead.status not in CLOSED_STATUSES)


async def _users_by_id(db: AsyncSession, ids) -> dict[int, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(ids)).execution_options(skip_tenant_filter=True)
    )).scalars().all()}


_NO_EXTRAS = {"referred": False, "referred_by": "", "referral_state": "", "referral_label": "",
              "friends_total": 0, "friends_counted": 0, "trial": None}


def lead_out(lead: PromoLead, users: dict[int, User], channels: dict[int, PromoChannel],
             now: datetime, studied: Optional[int] = None, extras: Optional[dict] = None) -> dict:
    ch = channels.get(lead.channel_id) if lead.channel_id else None
    stu = users.get(lead.student_id) if lead.student_id else None
    return {
        **(extras or _NO_EXTRAS),
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
                          PromoLead.status.not_in(CLOSED_STATUSES))
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
               PromoLead.status.not_in(CLOSED_STATUSES))
    )).scalar() or 0
    ex = await lead_extras(db, leads)
    return {
        "items": [lead_out(l, users, chs, now, sd.get(l.id), ex.get(l.id)) for l in leads],
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


# ---------------- 体验期 + 老带新延期(规矩见文件头「体验期 + 老带新延期」) ----------------

TRIAL_DAYS = 7                 # 开通体验送几天
REFERRAL_DAYS = 7              # 每计入一家朋友延几天
DEFAULT_REFERRAL_MAX = 4       # 默认最多算几家(机构可改)
MAX_REFERRAL_MAX = 20
TRIAL_MAX_BOOKS = 20


def _bj_date(dt: datetime) -> date:
    return (dt + timedelta(hours=8)).date()


def _today_bounds() -> tuple[datetime, datetime]:
    """北京今天 [0 点, 24 点) 的 UTC naive"""
    return local_day_utc_range(_bj_date(datetime.utcnow()))


def trial_expiry(started_at: datetime, counted: int, cap: int, gap_days: int = 0,
                 floor_until: Optional[datetime] = None) -> datetime:
    """体验到期时间的**唯一**算法(UTC naive)。
    开通那天(北京日)D 起 7 天 = 到 D+7 的北京 0 点;每计入一家朋友再加 7 天(最多 cap 家);
    gap_days = 体验过期之后才算进来的朋友,中间空着的天数(从当天起再给 7 天);
    floor_until = 到期日往前缩时孩子今天正在学的保底(今天 24 点)"""
    base = local_day_utc_range(_bj_date(started_at) + timedelta(days=TRIAL_DAYS))[0]
    end = base + timedelta(days=REFERRAL_DAYS * max(0, min(counted, cap)) + max(0, gap_days))
    if floor_until is not None and floor_until > end:
        end = floor_until
    return end


async def referral_settings(db: AsyncSession, org_id: Optional[int]) -> dict:
    row = await db.get(PromoReferralSettings, org_id) if org_id else None
    return {"enabled": bool(row.enabled) if row else True,
            "max_count": int(row.max_count) if row and row.max_count is not None else DEFAULT_REFERRAL_MAX}


async def _counted_friends(db: AsyncSession, org_id: int, lead_id: int) -> int:
    """这家推荐来的朋友里算数的有几家(付了体验费、没退款)。上限在调用方套: 退了一家,超出上限的那家自动补上"""
    return int((await db.execute(
        select(func.count(PromoLeadLink.lead_id)).where(
            PromoLeadLink.org_id == org_id, PromoLeadLink.referred_by_lead_id == lead_id,
            PromoLeadLink.credited_at.is_not(None), PromoLeadLink.revoked_at.is_(None))
    )).scalar() or 0)


async def recompute_trial(db: AsyncSession, lead_id: int) -> Optional[PromoTrial]:
    """按现在的朋友数重算这份体验的到期日,写回它还在管的那几本书。不 commit"""
    trial = await db.get(PromoTrial, lead_id)
    if trial is None:
        return None
    cap = (await referral_settings(db, trial.org_id))["max_count"]
    counted = await _counted_friends(db, trial.org_id, lead_id)
    new_end = trial_expiry(trial.started_at, counted, cap, trial.gap_days or 0, trial.floor_until)
    now = datetime.utcnow()
    _, today_end = _today_bounds()
    if new_end < today_end and trial.expires_at is not None and trial.expires_at > now:
        # 往前缩到今天之前了(退款 / 删线索 / 调低上限),而孩子今天还能学: 保底到今天 24 点,别学到一半被踢出去。
        # 只在这一刻写一次;以后重算用的是存下来的这个时间,不会每算一次往后推一天
        trial.floor_until = today_end
        new_end = today_end
    rows = list((await db.execute(
        select(BookAssignment).where(BookAssignment.student_id == trial.student_id,
                                     BookAssignment.book_id.in_(list(trial.book_ids or []) or [-1]),
                                     BookAssignment.scope_type == "book")
    )).scalars().all())
    keep = []
    for a in rows:
        # 还是这份体验写的那个到期日 = 还归体验管;对不上 = 后来兑换码续了 / 升永久了 / 老师改过,不再动它
        if a.grant_type == "period" and a.expires_at == trial.expires_at:
            a.expires_at = new_end
            keep.append(a.book_id)
    trial.book_ids = sorted(set(keep))
    trial.expires_at = new_end
    trial.updated_at = now
    return trial


async def openable_books(db: AsyncSession, org_id: int) -> list[dict]:
    """能开体验的书: 本机构自建的 + 平台公开的;**卡包机构凭卡才能开的书不给**(课本 / 精品 / 没开通的专属内容) ——
    体验开出来的是 period 授权,scope_service 认它,放进来就绕开了卡包"""
    books = list((await db.execute(
        select(WordBook).where(or_(WordBook.org_id == org_id,
                                   (WordBook.org_id.is_(None)) & (WordBook.is_public.is_(True))))
        .order_by(WordBook.org_id.is_(None), WordBook.id).execution_options(skip_tenant_filter=True)
    )).scalars().all())
    from app.services import card_pack
    gated = await card_pack.gated_book_ids(db, org_id, [b.id for b in books])
    return [{"id": b.id, "name": b.name, "grade_level": b.grade_level or "", "volume": b.volume or "",
             "series": b.series or "", "own": b.org_id == org_id}
            for b in books if b.id not in gated]


async def _book_names(db: AsyncSession, ids) -> dict[int, str]:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return dict((await db.execute(
        select(WordBook.id, WordBook.name).where(WordBook.id.in_(ids)).execution_options(skip_tenant_filter=True)
    )).all())


async def open_trial(db: AsyncSession, lead: PromoLead, book_ids: list[int], actor: User) -> tuple[PromoTrial, list[str], list[str]]:
    """开通体验 / 给已开的体验加书。返回 (体验, 新开的书名, 跳过的书名)。不 commit。
    学生本来就有这本书的授权(不管哪种)→ 跳过,不碰也不管: 体验到期不能把人家买的书一起锁了"""
    if not lead.student_id:
        raise HTTPException(status_code=400, detail="先在上面关联孩子的学生号,再开通体验")
    want = list(dict.fromkeys(int(b) for b in book_ids if b))
    if not want:
        raise HTTPException(status_code=400, detail="至少选一本书")
    if len(want) > TRIAL_MAX_BOOKS:
        raise HTTPException(status_code=400, detail=f"一次最多开 {TRIAL_MAX_BOOKS} 本")
    allowed = {b["id"] for b in await openable_books(db, lead.org_id)}
    bad = [b for b in want if b not in allowed]
    if bad:
        raise HTTPException(status_code=400, detail="选的书里有本机构开不了体验的(卡包机构的课本、精品书要凭学习卡开)")
    trial = await db.get(PromoTrial, lead.id)
    if trial is not None and trial.student_id != lead.student_id:
        raise HTTPException(status_code=409, detail="这条线索的体验开在另一个学生号上,不能换")
    other = (await db.execute(
        select(PromoTrial.lead_id).where(PromoTrial.student_id == lead.student_id, PromoTrial.lead_id != lead.id)
    )).scalar_one_or_none()
    if other is not None:
        raise HTTPException(status_code=409, detail="这个学生号已经在另一条线索上开过体验了")
    now = datetime.utcnow()
    if trial is None:
        cap = (await referral_settings(db, lead.org_id))["max_count"]
        counted = await _counted_friends(db, lead.org_id, lead.id)   # 开通前就付了费的朋友: 开通时一起算
        trial = PromoTrial(lead_id=lead.id, org_id=lead.org_id, student_id=lead.student_id, book_ids=[],
                           started_at=now, gap_days=0, expires_at=trial_expiry(now, counted, cap),
                           created_by=actor.id, updated_at=now)
        db.add(trial)
    elif trial.expires_at <= now:
        raise HTTPException(status_code=409, detail="这份体验已经到期了,不能再加书")
    have = set((await db.execute(
        select(BookAssignment.book_id).where(BookAssignment.student_id == lead.student_id,
                                             BookAssignment.book_id.in_(want))
    )).scalars().all())
    names = await _book_names(db, want)
    added, skipped = [], []
    managed = set(trial.book_ids or [])
    for bid in want:
        if bid in have:
            skipped.append(names.get(bid, f"#{bid}"))
            continue
        db.add(BookAssignment(book_id=bid, student_id=lead.student_id, teacher_id=actor.id, scope_type="book",
                              grant_type="period", expires_at=trial.expires_at, is_completed=False))
        managed.add(bid)
        added.append(names.get(bid, f"#{bid}"))
    if not added:
        raise HTTPException(status_code=400, detail=f"孩子本来就能学《{'》《'.join(skipped)}》,不用开体验")
    trial.book_ids = sorted(managed)
    trial.updated_at = now
    if lead.status in ("new", "contacted", "paid"):
        apply_status(lead, "opened", now)
    elif lead.opened_at is None:
        lead.opened_at = now
    await db.flush()
    return trial, added, skipped


def trial_out(trial: Optional[PromoTrial], names: dict[int, str], counted: int, cap: int) -> Optional[dict]:
    if trial is None:
        return None
    now = datetime.utcnow()
    last_day = _bj_date(trial.expires_at - timedelta(seconds=1))   # 到期时间是某天 0 点 → 最后能学的是前一天
    return {
        "started_at": to_local_str(trial.started_at),
        "expires_at": to_local_str(trial.expires_at),
        "last_day": last_day.isoformat(),
        "active": trial.expires_at > now,
        "days_left": max(0, (last_day - _bj_date(now)).days + 1) if trial.expires_at > now else 0,
        "books": [{"id": b, "name": names.get(b, f"#{b}")} for b in (trial.book_ids or [])],
        "counted": min(counted, cap), "counted_raw": counted, "cap": cap,
        "added_days": REFERRAL_DAYS * min(counted, cap),
    }


async def _new_code(db: AsyncSession, col) -> str:
    for _ in range(8):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))
        if (await db.execute(select(PromoLeadLink.lead_id).where(col == code))).first() is None:
            return code
    raise HTTPException(status_code=500, detail="生成邀请码失败,请再试一次")


async def ensure_share(db: AsyncSession, lead: PromoLead) -> PromoLeadLink:
    """这家的分享码 / 看进度的码,没有就生成。不 commit"""
    link = await db.get(PromoLeadLink, lead.id)
    if link is None:
        link = PromoLeadLink(lead_id=lead.id, org_id=lead.org_id)
        db.add(link)
    if not link.share_code:
        link.share_code = await _new_code(db, PromoLeadLink.share_code)
    if not link.view_code:
        link.view_code = await _new_code(db, PromoLeadLink.view_code)
    await db.flush()
    return link


async def share_card(db: AsyncSession, lead: PromoLead) -> Optional[PromoChannel]:
    """朋友扫的链接用哪张卡: 这家扫的那张(还在用的话)→ 这家销售名下在用的 → 本机构任一张在用的"""
    if lead.channel_id:
        ch = await db.get(PromoChannel, lead.channel_id)
        if ch is not None and ch.is_active and ch.org_id == lead.org_id:
            return ch
    stmt = select(PromoChannel).where(PromoChannel.org_id == lead.org_id, PromoChannel.is_active.is_(True))
    if lead.sales_user_id:
        ch = (await db.execute(stmt.where(PromoChannel.sales_user_id == lead.sales_user_id)
                               .order_by(PromoChannel.id).limit(1))).scalar_one_or_none()
        if ch is not None:
            return ch
    return (await db.execute(stmt.order_by(PromoChannel.id).limit(1))).scalar_one_or_none()


async def share_info(db: AsyncSession, lead: PromoLead) -> dict:
    """给销售复制 / 落地页显示的邀请链接(前端拼成 /c/{卡码}?f={分享码} 和 /c/share/{看进度码})"""
    if not (await referral_settings(db, lead.org_id))["enabled"]:
        return {"enabled": False, "reason": "本机构关了「邀请朋友」"}
    ch = await share_card(db, lead)
    if ch is None:
        return {"enabled": False, "reason": "本机构没有在用的卡码,先在「卡码」里开一版"}
    link = await ensure_share(db, lead)
    return {"enabled": True, "card_code": ch.code, "share_code": link.share_code, "view_code": link.view_code}


async def resolve_referrer(db: AsyncSession, org_id: int, f: Optional[str]) -> Optional[PromoLead]:
    """落地页带的 ?f=: 只认同一机构的分享码(别家机构的码当没带)"""
    c = (f or "").strip().upper()
    if not c or len(c) > 16:
        return None
    link = (await db.execute(
        select(PromoLeadLink).where(PromoLeadLink.share_code == c, PromoLeadLink.org_id == org_id)
    )).scalar_one_or_none()
    if link is None:
        return None
    return (await db.execute(
        select(PromoLead).where(PromoLead.id == link.lead_id, PromoLead.org_id == org_id)
    )).scalar_one_or_none()


async def maybe_credit(db: AsyncSession, lead: PromoLead, actor: Optional[User]) -> Optional[int]:
    """朋友这条线索付了体验费(走到过「已付」且实收 > 0)→ 算进推荐人,推荐人的体验重算。
    返回推荐人线索 id(这次算进去了)或 None。不 commit"""
    link = await db.get(PromoLeadLink, lead.id)
    if (link is None or not link.referred or link.referred_by_lead_id is None
            or link.credited_at is not None or link.revoked_at is not None):
        return None
    if lead.existing_account or lead.paid_at is None or not lead.paid_amount or float(lead.paid_amount) <= 0:
        return None
    ref = (await db.execute(
        select(PromoLead).where(PromoLead.id == link.referred_by_lead_id, PromoLead.org_id == lead.org_id)
    )).scalar_one_or_none()
    if ref is None:
        return None
    now = datetime.utcnow()
    trial = await db.get(PromoTrial, ref.id)
    cap = (await referral_settings(db, lead.org_id))["max_count"]
    before = await _counted_friends(db, lead.org_id, ref.id)
    if trial is not None and before < cap:
        today_start, _ = _today_bounds()
        if trial.expires_at < today_start:
            # 体验已经过期了才算进来: 从今天起再给 7 天,不是从过期那天往后接(那样孩子只剩一两天)。
            # 空档按不带保底的到期日算: 退款保底过的体验,保底那天不算「给过的」
            raw = trial_expiry(trial.started_at, before, cap, trial.gap_days or 0)
            trial.gap_days = (trial.gap_days or 0) + max(0, (today_start - raw).days)
    link.credited_at = now
    await db.flush()
    trial = await recompute_trial(db, ref.id)
    if actor is not None:
        masked = mask_phone(lead.parent_phone)
        if before >= cap:
            note = f"推荐的朋友 {masked} 付了体验费(已经算满 {cap} 家,这家不再延期)"
        elif trial is not None:
            note = f"推荐的朋友 {masked} 付了体验费,体验延 {REFERRAL_DAYS} 天,到 {_bj_date(trial.expires_at - timedelta(seconds=1)).strftime('%m-%d')}"
        else:
            note = f"推荐的朋友 {masked} 付了体验费,开通体验时一起多算 {REFERRAL_DAYS} 天"
        add_follow_up(db, ref, actor, note)
    return ref.id


async def revoke_referral(db: AsyncSession, lead: PromoLead, actor: Optional[User]) -> Optional[int]:
    """朋友退了体验费: 这家不再算(只写不清),推荐人的体验重算。返回推荐人线索 id 或 None。不 commit"""
    link = await db.get(PromoLeadLink, lead.id)
    if link is None or not link.referred or link.revoked_at is not None:
        return None
    was_credited = link.credited_at is not None
    link.revoked_at = datetime.utcnow()
    await db.flush()
    if not was_credited or link.referred_by_lead_id is None:
        return None
    ref = (await db.execute(
        select(PromoLead).where(PromoLead.id == link.referred_by_lead_id, PromoLead.org_id == lead.org_id)
    )).scalar_one_or_none()
    if ref is None:
        return None
    trial = await recompute_trial(db, ref.id)
    if actor is not None:
        tail = f",体验到 {_bj_date(trial.expires_at - timedelta(seconds=1)).strftime('%m-%d')}" if trial else ""
        add_follow_up(db, ref, actor, f"推荐的朋友 {mask_phone(lead.parent_phone)} 退了体验费,这家不再算{tail}")
    return ref.id


def _friend_state(link: PromoLeadLink, friend: PromoLead, counted_ids: set[int]) -> tuple[str, str]:
    if friend.existing_account:
        return "existing", "老客户不计入"
    if link.revoked_at is not None:
        return "refunded", "已退款"
    if link.credited_at is not None:
        return ("counted", "已付体验费,计入") if friend.id in counted_ids else ("over", "已付体验费(超过上限)")
    return "pending", "留了电话"


async def friends_of(db: AsyncSession, org_id: int, lead_id: int, cap: int) -> list[dict]:
    """这家推荐来的朋友,每家现在算不算。按付费先后套上限"""
    links = list((await db.execute(
        select(PromoLeadLink).where(PromoLeadLink.org_id == org_id, PromoLeadLink.referred_by_lead_id == lead_id)
    )).scalars().all())
    friends = {l.id: l for l in (await db.execute(
        select(PromoLead).where(PromoLead.org_id == org_id, PromoLead.id.in_([x.lead_id for x in links] or [-1]))
    )).scalars().all()}
    ok = sorted((x for x in links if x.credited_at is not None and x.revoked_at is None and x.lead_id in friends),
                key=lambda x: (x.credited_at, x.lead_id))
    counted_ids = {x.lead_id for x in ok[:cap]}
    out = []
    for x in sorted(links, key=lambda x: x.lead_id):
        f = friends.get(x.lead_id)
        if f is None:
            continue
        state, label = _friend_state(x, f, counted_ids)
        out.append({"lead_id": f.id, "phone": mask_phone(f.parent_phone), "state": state, "label": label,
                    "created_at": to_local_str(f.created_at)})
    return out


async def lead_extras(db: AsyncSession, leads: list[PromoLead]) -> dict[int, dict]:
    """列表 / 抽屉里每条线索的推荐和体验信息(一批几条查询,不按条 N 次)"""
    ids = [l.id for l in leads]
    if not ids:
        return {}
    org_ids = {l.org_id for l in leads}
    own = {x.lead_id: x for x in (await db.execute(
        select(PromoLeadLink).where(PromoLeadLink.lead_id.in_(ids))
    )).scalars().all()}
    ref_ids = {x.referred_by_lead_id for x in own.values() if x.referred_by_lead_id}
    ref_phone = dict((await db.execute(
        select(PromoLead.id, PromoLead.parent_phone).where(PromoLead.id.in_(ref_ids or {-1}),
                                                           PromoLead.org_id.in_(org_ids))
    )).all())
    fr_rows = (await db.execute(
        select(PromoLeadLink.referred_by_lead_id, PromoLeadLink.credited_at, PromoLeadLink.revoked_at)
        .where(PromoLeadLink.referred_by_lead_id.in_(ids), PromoLeadLink.org_id.in_(org_ids))
    )).all()
    fr_total: dict[int, int] = {}
    fr_ok: dict[int, int] = {}
    for rid, cr, rv in fr_rows:
        fr_total[rid] = fr_total.get(rid, 0) + 1
        if cr is not None and rv is None:
            fr_ok[rid] = fr_ok.get(rid, 0) + 1
    trials = {t.lead_id: t for t in (await db.execute(
        select(PromoTrial).where(PromoTrial.lead_id.in_(ids))
    )).scalars().all()}
    names = await _book_names(db, {b for t in trials.values() for b in (t.book_ids or [])})
    caps = {oid: (await referral_settings(db, oid))["max_count"] for oid in org_ids}
    out = {}
    for l in leads:
        x = own.get(l.id)
        referred = bool(x and x.referred)
        if not referred:
            referred_by, rstate, rlabel = "", "", ""
        else:
            rid = x.referred_by_lead_id
            referred_by = mask_phone(ref_phone[rid]) if rid in ref_phone else "(推荐人已删除)"
            if l.existing_account:
                rstate, rlabel = "existing", "老客户不计入"
            elif x.revoked_at is not None:
                rstate, rlabel = "refunded", "已退款,不再计入"
            elif x.credited_at is not None:
                rstate, rlabel = "counted", "已计入推荐人"
            elif rid not in ref_phone:
                rstate, rlabel = "orphan", "推荐人已删除,不计入"
            else:
                rstate, rlabel = "pending", "付了体验费(实收 > 0)才计入推荐人"
        cap = caps[l.org_id]
        out[l.id] = {
            "referred": referred, "referred_by": referred_by, "referral_state": rstate, "referral_label": rlabel,
            "friends_total": fr_total.get(l.id, 0), "friends_counted": min(fr_ok.get(l.id, 0), cap),
            "trial": trial_out(trials.get(l.id), names, fr_ok.get(l.id, 0), cap),
        }
    return out


async def share_progress(db: AsyncSession, view_code: str) -> dict:
    """推荐人家长自己看的进度页(公开,按看进度码)。只写事实: 几家朋友付了体验费、孩子的体验到哪天。
    不出孩子姓名,朋友手机号打码"""
    c = (view_code or "").strip().upper()
    if not c or len(c) > 16:
        raise HTTPException(status_code=404, detail="这个链接打不开了")
    link = (await db.execute(select(PromoLeadLink).where(PromoLeadLink.view_code == c))).scalar_one_or_none()
    lead = (await db.execute(
        select(PromoLead).where(PromoLead.id == link.lead_id, PromoLead.org_id == link.org_id)
    )).scalar_one_or_none() if link else None
    org = await db.get(Organization, lead.org_id) if lead else None
    if lead is None or org is None or org.status != "active":
        raise HTTPException(status_code=404, detail="这个链接打不开了")
    cap = (await referral_settings(db, lead.org_id))["max_count"]
    friends = await friends_of(db, lead.org_id, lead.id, cap)
    counted = sum(1 for f in friends if f["state"] == "counted")
    trial = await db.get(PromoTrial, lead.id)
    t = trial_out(trial, {}, counted, cap)
    return {
        "org_name": org.name,
        "friends": [{k: f[k] for k in ("phone", "state", "label", "created_at")} for f in friends],
        "counted": counted, "cap": cap, "added_days": REFERRAL_DAYS * counted,
        "trial_last_day": t["last_day"] if t else None,
        "trial_active": t["active"] if t else False,
    }


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

    ref_paid = await _referred_ids(db, leads)

    def blank(uid, name, active, role=None):
        return {"sales_user_id": uid, "name": name, "is_active": active, "channels": 0, "views": 0,
                "leads": 0, "contacted": 0, "paid": 0, "opened": 0, "studied": 0, "won": 0,
                "lost": 0, "revenue": 0, "overdue": 0, "referred": 0, "referred_paid": 0,
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
        if l.id in ref_paid:
            r["referred"] += 1
            r["referred_paid"] += ref_paid[l.id]
    items = sorted(rows.values(), key=lambda r: (-r["won"], -r["studied"], -r["paid"], -r["leads"]))
    total = blank(None, "合计", True)
    for r in items:
        for k in ("channels", "views", "leads", "contacted", "paid", "opened", "studied", "won", "lost", "revenue", "overdue",
                  "referred", "referred_paid"):
            total[k] += r[k]
    # 实收按浮点加(9.9 × 3 = 29.700000000000003),出口统一规整
    for r in [*items, total]:
        r["revenue"] = money(r["revenue"])
    return {"items": items, "total": total, "study_days_target": STUDY_DAYS_TARGET}


# ---------------- 平台汇总(各校区) ----------------

_FUNNEL = ("leads", "contacted", "paid", "opened", "studied", "won", "lost", "overdue", "referred", "referred_paid")


async def _referred_ids(db: AsyncSession, leads: list[PromoLead]) -> dict[int, int]:
    """这批线索里点朋友链接来的: {线索 id: 付了体验费且算数(1)/ 没有(0)}。
    「推荐后付费」和计入推荐人同一个判据(实收 > 0、不是老客户、没退款)"""
    ids = [l.id for l in leads]
    if not ids:
        return {}
    links = {x.lead_id: x for x in (await db.execute(
        select(PromoLeadLink).where(PromoLeadLink.lead_id.in_(ids), PromoLeadLink.referred.is_(True))
    )).scalars().all()}
    out = {}
    for l in leads:
        x = links.get(l.id)
        if x is None or x.org_id != l.org_id:
            continue
        out[l.id] = int(x.credited_at is not None and x.revoked_at is None)
    return out


async def org_summary(db: AsyncSession, since: Optional[datetime], until: Optional[datetime]) -> dict:
    """平台管理员看各校区(10-24 用户「加一个汇总页」): 每个机构一行,口径与机构自己的看板同一套
    (按留电话日期切一批线索 / 学满 5 天看 study_calendar / 扫开是累计的)。
    **没开始做的机构也列出来**(卡和线索都是 0),一眼看出谁还没动。只读,不改任何机构的数据。
    平台 admin 的租户上下文本来就不过滤,这里仍逐条显式按 org_id 归组(CLAUDE.md: 别押在隐式过滤器上)"""
    orgs = (await db.execute(select(Organization).order_by(Organization.id))).scalars().all()
    stmt = select(PromoLead)
    if since is not None:
        stmt = stmt.where(PromoLead.created_at >= since)
    if until is not None:
        stmt = stmt.where(PromoLead.created_at < until)
    leads = list((await db.execute(stmt)).scalars().all())
    sd = await studied_days(db, leads)
    ref_paid = await _referred_ids(db, leads)
    chans = (await db.execute(select(PromoChannel))).scalars().all()
    sales = dict((await db.execute(
        select(User.org_id, func.count(User.id))
        .where(User.role == "sales", User.is_active.is_(True))
        .group_by(User.org_id).execution_options(skip_tenant_filter=True)
    )).all())
    prices = {s.org_id: s.trial_price for s in (await db.execute(select(PromoOrgSettings))).scalars().all()}
    now = datetime.utcnow()

    def blank(org=None):
        r = {"org_id": org.id if org else None, "name": org.name if org else "合计",
             "status": org.status if org else "", "trial_price": None,
             "sales": 0, "channels": 0, "active_channels": 0, "views": 0, "revenue": 0.0,
             "last_lead_at": None}
        r.update({k: 0 for k in _FUNNEL})
        if org is not None:
            p = prices.get(org.id)
            r["trial_price"] = money(p) if p is not None else DEFAULT_TRIAL_PRICE
            r["sales"] = int(sales.get(org.id, 0))
        return r

    rows = {o.id: blank(o) for o in orgs}
    for c in chans:
        r = rows.get(c.org_id)
        if r is None:
            continue
        r["channels"] += 1
        r["active_channels"] += bool(c.is_active)
        r["views"] += int(c.view_count or 0)
    last: dict[int, datetime] = {}
    for l in leads:
        r = rows.get(l.org_id)
        if r is None:
            continue
        r["leads"] += 1
        r["contacted"] += l.contacted_at is not None
        r["paid"] += l.paid_at is not None
        r["opened"] += l.opened_at is not None
        r["studied"] += sd.get(l.id, 0) >= STUDY_DAYS_TARGET
        r["won"] += l.won_at is not None
        r["lost"] += l.status == "lost"
        r["overdue"] += is_overdue(l, now)
        r["revenue"] += float(l.paid_amount or 0)
        if l.id in ref_paid:
            r["referred"] += 1
            r["referred_paid"] += ref_paid[l.id]
        if l.created_at and (l.org_id not in last or l.created_at > last[l.org_id]):
            last[l.org_id] = l.created_at
    for oid, t in last.items():
        rows[oid]["last_lead_at"] = to_local_str(t)
    items = sorted(rows.values(), key=lambda r: (-r["won"], -r["studied"], -r["paid"], -r["leads"], -r["channels"], r["org_id"]))
    total = blank()
    for r in items:
        for k in ("sales", "channels", "active_channels", "views", "revenue", *_FUNNEL):
            total[k] += r[k]
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
    gone = [l.id for l in leads]
    # 推荐关系 / 体验(生产外键关着,显式删):
    # - 被删的是推荐人: 朋友那边只断开(referred 留着,显示「(推荐人已删除)」),以后付费也不算给任何人 ——
    #   线索 id 会被 SQLite 回收,留着旧 id 会指到下一条新线索身上
    # - 被删的是算过数的朋友(测试号 / 假线索): 推荐人少一家,重算他的体验
    # - 被删线索自己开的体验: 体验记录删掉,已经开出去的授权留着(到期自己锁)
    hit = list((await db.execute(
        select(PromoLeadLink.referred_by_lead_id).where(
            PromoLeadLink.lead_id.in_(gone), PromoLeadLink.org_id == org_id,
            PromoLeadLink.credited_at.is_not(None), PromoLeadLink.revoked_at.is_(None),
            PromoLeadLink.referred_by_lead_id.is_not(None))
    )).scalars().all())
    await db.execute(update(PromoLeadLink).where(PromoLeadLink.org_id == org_id,
                                                 PromoLeadLink.referred_by_lead_id.in_(gone))
                     .values(referred_by_lead_id=None))
    await db.execute(delete(PromoLeadLink).where(PromoLeadLink.lead_id.in_(gone)))
    await db.execute(delete(PromoTrial).where(PromoTrial.lead_id.in_(gone)))
    await db.execute(delete(PromoFollowUp).where(PromoFollowUp.lead_id.in_(gone)))
    for l in leads:
        await db.delete(l)
    await db.flush()
    for rid in sorted({r for r in hit if r not in gone}):
        await recompute_trial(db, rid)
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
