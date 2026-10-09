"""新政策卡包(2026-10-08) —— 卡种、价格、分期、额度、按规则开书的**唯一真源**。

只管 organizations.card_plan == 'pack' 的机构。老机构(legacy)的发码/额度
一行不碰,仍走 org_service.card_quota_status。

## 卡种(2026-10-09 用户定价,替换 10-08 的单册/学段/全通/精品四种)

| 卡种 | 单价 | 标准包张数 | 开什么书(发码时机构管理员勾选) |
|------|------|-----------|---------------------------------|
| 入门卡 trial  | ¥15  | 80  | 全部「体验」档平台书(不用选)   |
| 15本卡 b15    | ¥600 | 40  | 任选 15 本「基础」档平台书       |
| 5本卡 b5      | ¥360 | 60  | 任选 5 本「基础」档平台书        |
| 小学2本卡 p2  | ¥120 | 50  | 任选 2 本小学「基础」档平台书    |
| 单本卡 b1     | ¥240 | 30  | 任选 1 本「基础」或「精品」档书  |

合计 80×15 + 40×600 + 60×360 + 50×120 + 30×240 = 60,000。每张卡兑换后 180 天,

兑换码本身 5 年内有效(没兑换就不开始计时)。

## 三条规则(改之前先想清楚)

1. **只认平台书**(org_id IS NULL)。机构自建的书本来就免费、老师直接分配,
   不该占卡额度;也不能让 A 机构的卡开出 B 机构的书。
2. **档位 NULL = 不进任何卡**。新书默认不进卡包,平台定档后才进 ——
   默认成「基础」会让考纲书/校本书在定档前就被学段卡白送出去。
3. **N 本卡就是发码时勾的那 N 本**,不随新书变化;入门卡兑换时按规则重新取体验档书。
   (10-08 的学段卡/全通卡「新书自动补给」随卡种一起下线;sync_book / PackCardGrant
   留着不删 —— 没有卡种再写 grant,它们是空转,删表反而要迁移)
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card_pack import OrgCardLedger, PackCardGrant
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import RedemptionCode, RedemptionCodeStatus, User
from app.models.word import BookStage, WordBook

PLAN_LEGACY = "legacy"
PLAN_PACK = "pack"

CARD_DAYS = 180            # 兑换后有效天数(所有卡种一样)
CODE_VALID_DAYS = 1826     # 兑换码 5 年内可兑换

TIERS = {
    "trial": "体验",
    "basic": "基础",
    "premium": "精品",
    "school": "校本(不进卡包)",
}

# pick: none=不用选(入门卡) / books=发码时勾 n 本。
# tiers: 能勾哪些档位的书;stage: 只能勾这个学段(None=不限)
CARD_KINDS: dict[str, dict] = {
    "trial": {"label": "入门卡", "price": 15, "pick": "none", "n": 0,
              "tiers": ("trial",), "stage": None, "covers": "全部体验课(目前是入门课)"},
    "b15":   {"label": "15本卡", "price": 600, "pick": "books", "n": 15,
              "tiers": ("basic",), "stage": None, "covers": "任选 15 本课本"},
    "b5":    {"label": "5本卡", "price": 360, "pick": "books", "n": 5,
              "tiers": ("basic",), "stage": None, "covers": "任选 5 本课本"},
    "p2":    {"label": "小学2本卡", "price": 120, "pick": "books", "n": 2,
              "tiers": ("basic",), "stage": "primary", "covers": "任选 2 本小学课本"},
    "b1":    {"label": "单本卡", "price": 240, "pick": "books", "n": 1,
              "tiers": ("basic", "premium"), "stage": None,
              "covers": "任选 1 本课本或精品书(考纲词汇等)"},
}
KIND_ORDER = ["trial", "b15", "b5", "p2", "b1"]

# 标准包 6 万,3 期每期收 2 万(2026-10-08 用户定「最多三期」)。
# 单价都是 120 的倍数,每期卡值凑不出正好 2 万: 拆成 20,040 / 20,040 / 19,920,三期合计正好 6 万,
# 机构每期照样付 2 万(差额 ±120,第 3 期补平)。入门卡全放第 1 期 —— 签约就能招生
PACK_PRICE = 60000
INSTALLMENT_PRICE = 20000
INSTALLMENTS: dict[int, dict[str, int]] = {
    1: {"trial": 80, "b15": 12, "b5": 20, "p2": 17, "b1": 10},
    2: {"b15": 14, "b5": 20, "p2": 17, "b1": 10},
    3: {"b15": 14, "b5": 20, "p2": 16, "b1": 10},
}
PACK_TOTALS = {"trial": 80, "b15": 40, "b5": 60, "p2": 50, "b1": 30}
INSTALLMENT_MONTHS = 3          # 每 3 个月一期(签约时付第 1 期)
# 一次结清赠送(10-09 原全通卡已下线,改送 5本卡;10 张 5本卡 ¥3,600 ≈ 原 10 张全通卡 ¥4,000)
BONUS_KIND = "b5"
BONUS_FULL_PAY = 10             # 一次付清 3 期
BONUS_EARLY_SETTLE = 5          # 付完第 1 期后结清剩余两期
RESTOCK_MIN = 20                # 补货每种 20 张起(提示用,不硬拦: 平台可能赠零头)

PACKABLE_KINDS = set(CARD_KINDS)


def installment_value(no: int) -> int:
    """这一期开的卡按单价合计(¥20,040 / 20,040 / 19,920),机构实付是 INSTALLMENT_PRICE"""
    return sum(CARD_KINDS[k]["price"] * n for k, n in INSTALLMENTS[no].items())


# 自检(启动时跑): 三期张数合计 = 标准包张数,卡值合计 = 6 万,每期卡值离 2 万不超过 ¥120
assert {k: sum(c.get(k, 0) for c in INSTALLMENTS.values()) for k in KIND_ORDER} == PACK_TOTALS, \
    "三期张数合计必须等于标准包张数"
assert sum(CARD_KINDS[k]["price"] * n for k, n in PACK_TOTALS.items()) == PACK_PRICE, \
    "标准包张数 × 单价 必须正好 6 万"
assert INSTALLMENT_PRICE * len(INSTALLMENTS) == PACK_PRICE
assert all(abs(installment_value(n) - INSTALLMENT_PRICE) <= 120 for n in INSTALLMENTS)


def catalog() -> dict:
    """前端规则说明 / 发码表单 / 到账弹窗共用的常量。别在前端另写一份价格。"""
    return {
        "card_days": CARD_DAYS,
        "code_valid_years": CODE_VALID_DAYS // 365,
        "kinds": [{"kind": k, **CARD_KINDS[k]} for k in KIND_ORDER],
        "tiers": TIERS,
        "pack_price": PACK_PRICE,
        "pack_totals": PACK_TOTALS,
        # value = 机构这一期要付的钱(都是 2 万);card_value = 这一期开的卡按单价合计
        "installments": [
            {"no": n, "cards": INSTALLMENTS[n], "value": INSTALLMENT_PRICE,
             "card_value": installment_value(n), "due_month": (n - 1) * INSTALLMENT_MONTHS}
            for n in INSTALLMENTS
        ],
        "bonus_kind": BONUS_KIND,
        "bonus_full_pay": BONUS_FULL_PAY,
        "bonus_early_settle": BONUS_EARLY_SETTLE,
        "restock_min": RESTOCK_MIN,
    }


async def plan_of(db: AsyncSession, org_id: Optional[int]) -> str:
    if not org_id:
        return PLAN_LEGACY
    plan = (await db.execute(
        select(Organization.card_plan).where(Organization.id == org_id)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    return plan or PLAN_LEGACY


# ---------- 按规则取书 ----------

async def _stage_ids(db: AsyncSession, stage: str) -> list[int]:
    """学段 key → book_stages.id。预置档用 code(primary/junior/senior),自建档 custom:{id}"""
    if stage.startswith("custom:"):
        try:
            return [int(stage.split(":", 1)[1])]
        except ValueError:
            return []
    return list((await db.execute(
        select(BookStage.id).where(BookStage.code == stage)
        .execution_options(skip_tenant_filter=True)
    )).scalars())


def _platform(tier: str):
    return and_(WordBook.org_id.is_(None), WordBook.pack_tier == tier)


async def resolve_books(
    db: AsyncSession, kind: str, book_ids: Optional[list[int]] = None,
) -> list[tuple[int, str]]:
    """某卡种 + 勾的书 → 这张卡开哪些书 [(id, name)]。不合规抛 400(带能照着改的说明)。

    入门卡不用选,按规则取全部体验档书;N 本卡必须正好勾 N 本、且每本都在该卡允许的范围里。
    """
    spec = CARD_KINDS.get(kind)
    if spec is None:
        raise HTTPException(400, f"不认识的卡种: {kind}")
    if spec["pick"] == "none":
        rows = (await db.execute(
            select(WordBook.id, WordBook.name)
            .where(WordBook.org_id.is_(None), WordBook.pack_tier.in_(spec["tiers"]))
            .order_by(WordBook.id).execution_options(skip_tenant_filter=True)
        )).all()
        if not rows:
            raise HTTPException(400, f"平台还没有可以开的体验课,发不了{spec['label']}")
        return [(r.id, r.name) for r in rows]

    ids = list(dict.fromkeys(b for b in (book_ids or []) if b))
    n = spec["n"]
    if len(ids) != n:
        raise HTTPException(400, f"{spec['label']}要正好选 {n} 本书,现在选了 {len(ids)} 本")
    q = (select(WordBook.id, WordBook.name)
         .where(WordBook.id.in_(ids), WordBook.org_id.is_(None),
                WordBook.pack_tier.in_(spec["tiers"])))
    if spec["stage"]:
        q = q.where(WordBook.stage_id.in_(await _stage_ids(db, spec["stage"])))
    rows = {r.id: r.name for r in (await db.execute(
        q.execution_options(skip_tenant_filter=True))).all()}
    bad = [b for b in ids if b not in rows]
    if bad:
        raise HTTPException(400, f"有 {len(bad)} 本书不能放进{spec['label']}({spec['covers']}),请重新选")
    return [(b, rows[b]) for b in ids]


async def options(db: AsyncSession) -> dict:
    """发码表单的可选项: 每档能选哪些书 / 版本 / 学段,以及每个范围几本书。"""
    rows = (await db.execute(
        select(WordBook.id, WordBook.name, WordBook.series, WordBook.stage_id, WordBook.pack_tier)
        .where(WordBook.org_id.is_(None), WordBook.pack_tier.is_not(None))
        .order_by(WordBook.series, WordBook.stage_id, WordBook.id)
        .execution_options(skip_tenant_filter=True)
    )).all()
    stages = (await db.execute(
        select(BookStage).where(BookStage.org_id.is_(None))
        .order_by(BookStage.sort_order, BookStage.id)
        .execution_options(skip_tenant_filter=True)
    )).scalars().all()
    key_of = {s.id: (s.code or f"custom:{s.id}") for s in stages}
    name_of = {key_of[s.id]: s.name for s in stages}

    basic = [r for r in rows if r.pack_tier == "basic"]
    series_map: dict[str, dict[str, int]] = {}
    for r in basic:
        if not r.series:
            continue
        st = key_of.get(r.stage_id)
        series_map.setdefault(r.series, {})
        if st:
            series_map[r.series][st] = series_map[r.series].get(st, 0) + 1
    series_list = []
    for s, st in series_map.items():
        total = sum(1 for r in basic if r.series == s)
        series_list.append({
            "series": s, "total": total,
            "stages": [{"stage": k, "label": name_of.get(k, k), "count": st[k]}
                       for k in sorted(st, key=lambda k: list(name_of).index(k) if k in name_of else 99)],
        })

    def books(tier):
        return [{"id": r.id, "name": r.name, "series": r.series,
                 "stage": key_of.get(r.stage_id, ""),
                 "stage_label": name_of.get(key_of.get(r.stage_id), "")}
                for r in rows if r.pack_tier == tier]

    return {
        "series": series_list,
        "basic_books": books("basic"),
        "premium_books": books("premium"),
        "trial_books": books("trial"),
    }


# ---------- 额度 ----------

async def quota_status(db: AsyncSession, org_id: int) -> dict:
    """每档 已到账 / 已发 / 剩余,和到账进度。发码闸门与三处界面共用这一份。"""
    bought = dict((await db.execute(
        select(OrgCardLedger.card_kind, func.sum(OrgCardLedger.count))
        .where(OrgCardLedger.org_id == org_id)
        .group_by(OrgCardLedger.card_kind)
    )).all())
    # 口径与老政策 count_issued_cards 一致: 按发码人所属机构计,禁用的退回额度
    used = dict((await db.execute(
        select(RedemptionCode.card_kind, func.count(RedemptionCode.id))
        .where(
            RedemptionCode.card_kind.is_not(None),
            RedemptionCode.created_by.in_(select(User.id).where(User.org_id == org_id)),
            RedemptionCode.status != RedemptionCodeStatus.DISABLED,
        )
        .group_by(RedemptionCode.card_kind)
        .execution_options(skip_tenant_filter=True)
    )).all())
    paid = sorted(set((await db.execute(
        select(OrgCardLedger.installment_no).where(
            OrgCardLedger.org_id == org_id, OrgCardLedger.source == "installment")
    )).scalars()))
    kinds = []
    for k in KIND_ORDER:
        q, u = int(bought.get(k) or 0), int(used.get(k) or 0)
        kinds.append({"kind": k, "label": CARD_KINDS[k]["label"],
                      "quota": q, "used": u, "left": max(0, q - u)})
    next_no = next((n for n in INSTALLMENTS if n not in paid), None)
    return {"kinds": kinds, "paid_installments": paid, "next_installment": next_no}


async def check_quota(db: AsyncSession, org_id: int, kind: str, count: int) -> None:
    st = await quota_status(db, org_id)
    row = next(k for k in st["kinds"] if k["kind"] == kind)
    if count > row["left"]:
        label = row["label"]
        raise HTTPException(403, (
            f"{label}额度不足: 已发 {row['used']}/{row['quota']} 张,剩 {row['left']} 张,"
            f"本次要发 {count} 张。请联系平台确认下一期到账或补货(每种 {RESTOCK_MIN} 张起);"
            "生成错的批次删掉后额度会退回来。"
        ))


async def record_payment(
    db: AsyncSession, org_id: int, action: str, operator_id: int,
    restock: Optional[dict[str, int]] = None, note: Optional[str] = None,
) -> dict:
    """平台确认到账 → 写台账开额度。只 add 不 commit(调用方与审计日志同事务提交)。

    action: installment=下一期 / settle=剩下的全部一次结清 / restock=补货(按档填张数)。
    返回本次开了哪些卡,供审计和提示。
    """
    st = await quota_status(db, org_id)
    paid = set(st["paid_installments"])
    lines: list[OrgCardLedger] = []

    def add(kind, n, source, no=None, line_note=note):
        if n > 0:
            lines.append(OrgCardLedger(org_id=org_id, card_kind=kind, count=n, source=source,
                                       installment_no=no, note=line_note, created_by=operator_id))

    if action in ("installment", "settle"):
        remaining = [n for n in INSTALLMENTS if n not in paid]
        if not remaining:
            raise HTTPException(400, f"{len(INSTALLMENTS)} 期都已经到账了,再要卡请用「补货」")
        todo = remaining[:1] if action == "installment" else remaining
        for no in todo:
            for kind, n in INSTALLMENTS[no].items():
                add(kind, n, "installment", no)
        if action == "settle":
            # 一次付清全部 3 期送 10 张;付过第 1 期后结清剩余 2 期送 5 张;只剩最后一期不送
            bonus = BONUS_FULL_PAY if not paid else (BONUS_EARLY_SETTLE if len(remaining) >= 2 else 0)
            add(BONUS_KIND, bonus, "bonus", 0, f"一次结清赠送(结清第 {todo[0]}–{todo[-1]} 期)")
    elif action == "restock":
        for kind, n in (restock or {}).items():
            if kind not in PACKABLE_KINDS:
                raise HTTPException(400, f"不认识的卡种: {kind}")
            if not isinstance(n, int) or n < 0 or n > 100000:
                raise HTTPException(400, "补货张数要在 0–100000 之间")
            add(kind, n, "restock")
        if not lines:
            raise HTTPException(400, "补货至少填一档的张数")
    else:
        raise HTTPException(400, f"不认识的到账类型: {action}")

    for ln in lines:
        db.add(ln)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "这一期已经确认过到账了(可能点了两次),请刷新看最新进度")
    granted: dict[str, int] = {}
    for ln in lines:
        granted[ln.card_kind] = granted.get(ln.card_kind, 0) + ln.count
    return {"granted": granted,
            "installments": sorted({ln.installment_no for ln in lines
                                    if ln.source == "installment"})}


# ---------- 学段卡 / 全通卡: 兑换后同范围新书自动补给 ----------

def _scope_key(code: RedemptionCode) -> tuple[str, str]:
    stage = (code.scope_stage or "") if code.card_kind == "stage" else ""
    return (code.scope_series or "", stage)


async def upsert_grant(db: AsyncSession, student_id: int, code: RedemptionCode,
                       now: datetime) -> None:
    """兑换学段/全通卡后记一行范围授权(续卡接着往后算)。只 add/改,不 commit。"""
    if code.card_kind not in ("stage", "full"):
        return
    series, stage_code = _scope_key(code)
    g = (await db.execute(select(PackCardGrant).where(
        PackCardGrant.student_id == student_id, PackCardGrant.card_kind == code.card_kind,
        PackCardGrant.series == series, PackCardGrant.stage_code == stage_code,
    ))).scalar_one_or_none()
    days = timedelta(days=code.grant_days or CARD_DAYS)
    if g is None:
        db.add(PackCardGrant(student_id=student_id, card_kind=code.card_kind, series=series,
                             stage_code=stage_code, expires_at=now + days,
                             granted_by=code.created_by))
    else:
        g.expires_at = max(g.expires_at, now) + days
        g.granted_by = code.created_by


async def sync_book(db: AsyncSession, book_id: int) -> int:
    """一本平台书变成「基础」档(或改了版本/学段)后,补给有效期内的学段/全通卡学生。

    返回新开/延长了几个学生。只补不收: 书挪出范围不回收已开的(学生正在学,
    收回会让孩子当场被踢出去)。会 commit。
    """
    book = (await db.execute(
        select(WordBook).where(WordBook.id == book_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if book is None or book.org_id is not None or book.pack_tier != "basic" or not book.series:
        return 0
    stage_keys: list[str] = []
    if book.stage_id:
        st = (await db.execute(
            select(BookStage).where(BookStage.id == book.stage_id)
            .execution_options(skip_tenant_filter=True)
        )).scalar_one_or_none()
        if st is not None:
            stage_keys.append(st.code or f"custom:{st.id}")
    scope = PackCardGrant.card_kind == "full"
    if stage_keys:
        scope = or_(scope, and_(PackCardGrant.card_kind == "stage",
                                PackCardGrant.stage_code.in_(stage_keys)))

    now = datetime.utcnow()
    grants = (await db.execute(select(PackCardGrant).where(
        PackCardGrant.series == book.series,
        PackCardGrant.expires_at > now,
        scope,
    ))).scalars().all()
    # 同一学生可能同时有学段卡和全通卡: 取最晚到期那张
    best: dict[int, PackCardGrant] = {}
    for g in grants:
        if g.student_id not in best or g.expires_at > best[g.student_id].expires_at:
            best[g.student_id] = g
    if not best:
        return 0

    existing = {a.student_id: a for a in (await db.execute(select(BookAssignment).where(
        BookAssignment.book_id == book.id, BookAssignment.scope_type == "book",
        BookAssignment.student_id.in_(list(best)),
    ))).scalars()}
    touched = 0
    for sid, g in best.items():
        a = existing.get(sid)
        if a is None:
            db.add(BookAssignment(book_id=book.id, student_id=sid, teacher_id=g.granted_by,
                                  scope_type="book", grant_type="period", expires_at=g.expires_at))
            touched += 1
        elif a.grant_type == "period" and (a.expires_at is None or a.expires_at < g.expires_at):
            # 永久/次卡的不动(永久已经够了,次卡与包月不能混算)
            a.expires_at = g.expires_at
            touched += 1
    await db.commit()
    return touched


# ---------- 新政策机构: 卡包书只能靠兑换码开(2026-10-08) ----------
# 两个绕开卡包的口子都收在这里判:
#   1. 老师直接分配平台书(teacher/book_assignments.assign) → 拒
#   2. 布置作业顺带开书(scope_service 的作业单元白名单 / 书架 owned) → 不算授权
# 老师分配的 book_assignments 行 grant_type 为 NULL,兑换码/新书补给写的行恒有值,
# 所以「有效授权 = grant_type 非空且判活」。老政策机构一律不走这里。
GATED_TIERS = ("basic", "premium")
PACK_CARD_REQUIRED_MSG = "这本书要先兑换学习卡才能学,请找老师要兑换码"


async def gated_book_ids(db: AsyncSession, org_id: Optional[int], book_ids) -> set[int]:
    """这些书里,对该机构来说哪些必须凭卡学。老政策机构返回空集。"""
    ids = [b for b in book_ids if b is not None]
    if not ids or await plan_of(db, org_id) != PLAN_PACK:
        return set()
    return set((await db.execute(
        select(WordBook.id).where(
            WordBook.id.in_(ids), WordBook.org_id.is_(None),
            WordBook.pack_tier.in_(GATED_TIERS),
        ).execution_options(skip_tenant_filter=True)
    )).scalars())


async def is_gated_for_student(db: AsyncSession, student_id: int, book_id: int) -> bool:
    # 先看书(多数请求是机构自建书或老政策,一条查询就返回),再看学生所在机构
    tier = (await db.execute(
        select(WordBook.pack_tier).where(WordBook.id == book_id, WordBook.org_id.is_(None))
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if tier not in GATED_TIERS:
        return False
    org_id = (await db.execute(
        select(User.org_id).where(User.id == student_id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    return await plan_of(db, org_id) == PLAN_PACK
