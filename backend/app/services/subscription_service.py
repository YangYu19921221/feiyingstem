"""
单词本兑换码服务
"""
import random
import string
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.models.user import (
    User, RedemptionCode, RedemptionCodeBook, RedemptionCodeStatus,
)
from app.models.learning import BookAssignment
from app.models.word import WordBook

# 去掉易混淆字符 0/O/1/I/L
CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

# 卡种
GRANT_PERMANENT = "permanent"   # 永久(旧行为)
GRANT_PERIOD = "period"         # 包月:按天数计时,到期即停
GRANT_TIMES = "times"           # 次卡:按「学习天」计次,当天首次进入扣 1


def _normalize_grant_type(gt: Optional[str]) -> str:
    """归一化卡种:NULL/空串/permanent 统一返回 GRANT_PERMANENT"""
    return gt if gt in (GRANT_PERIOD, GRANT_TIMES) else GRANT_PERMANENT


# ===== 谁能发什么卡(2026-09-11) =====
# 机构(org_admin)只能发**包月卡且最长半年**,有效期从「学生兑换那天」起算
# (expires_at = 兑换时刻 + grant_days,见 _apply_one_book)。
#
# 依据加盟协议第三条: 平台卖给机构的计费单位就是「每张半年(180 天)的学生学习卡」。
# 另两种卡都能绕开这个上限,所以对机构一律不放行:
#   - 永久卡: 无到期日,等于把按期续费的权益一次性送掉;
#   - 次卡: 按「学习天」计次,一周学两天的孩子拿 30 天次卡能横跨三四个月,
#     日历时长不封顶(和"最多半年"是两个量纲,不是"改小一点"能对齐的)。
# 机构要给学生更长的期限就走续卡(协议允许,50 张起) —— 每张仍是半年,
# 续期从原到期日往后接(_apply_one_book),权益连续但每一张都在上限内。
#
# 平台 admin 不受限: 它是定价方,永久卡/长期卡/次卡都要能发(存量 838 张全是永久卡)。
ORG_MAX_CARD_DAYS = 180
ORG_ALLOWED_GRANT_TYPES: tuple[str, ...] = (GRANT_PERIOD,)

_GRANT_TYPE_HINTS = {
    GRANT_PERMANENT: "永久（一直可学）",
    GRANT_PERIOD: "包月（按天计时，从学生兑换那天算起）",
    GRANT_TIMES: "次卡（按学习天计次，没进不扣）",
}


def card_policy_for(role: str) -> dict:
    """该身份能发什么卡 —— 发码端点与前端表单共用的**唯一**口径。

    前端照这份结果画表单(而不是自己写死 180),避免"界面让你选、后端不收"。
    """
    if role == "org_admin":
        return {
            "role": role,
            "allowed_grant_types": list(ORG_ALLOWED_GRANT_TYPES),
            "max_grant_days": ORG_MAX_CARD_DAYS,
            "default_grant_days": ORG_MAX_CARD_DAYS,
            "max_grant_times": None,
            "note": (
                f"机构发的学生学习卡最长半年（{ORG_MAX_CARD_DAYS} 天），"
                "有效期从学生兑换那天开始算。需要更长时间请续卡（到期日往后接）。"
            ),
            "grant_type_labels": {
                t: _GRANT_TYPE_HINTS[t] for t in ORG_ALLOWED_GRANT_TYPES
            },
        }
    return {
        "role": role,
        "allowed_grant_types": [GRANT_PERMANENT, GRANT_PERIOD, GRANT_TIMES],
        "max_grant_days": 3650,
        "default_grant_days": 30,
        "max_grant_times": 1000,
        "note": "平台发码不限卡种与时长。",
        "grant_type_labels": dict(_GRANT_TYPE_HINTS),
    }


def guard_card_policy(
    role: str,
    grant_type: str,
    grant_days: Optional[int] = None,
    grant_times: Optional[int] = None,
) -> None:
    """发码前的卡种/时长闸门。越界抛 403(带能照着改的说明)。

    ⚠️ 收在这一个函数里,别在端点里手写角色判断 —— 手写副本会漂移
    (CLAUDE.md 记过 guard_org_admin 的同类教训)。
    """
    policy = card_policy_for(role)
    gt = _normalize_grant_type(grant_type)

    if gt not in policy["allowed_grant_types"]:
        allowed = "、".join(_grant_label(t) for t in policy["allowed_grant_types"])
        raise HTTPException(
            status_code=403,
            detail=(
                f"机构不能发{_grant_label(gt)}，只能发{allowed}"
                f"（最长 {policy['max_grant_days']} 天，从学生兑换那天算起）。"
                "要让学生学更久请续卡，有效期会从原到期日往后接。"
            ),
        )

    max_days = policy["max_grant_days"]
    if gt == GRANT_PERIOD and grant_days is not None and grant_days > max_days:
        raise HTTPException(
            status_code=403,
            detail=(
                f"机构发的学习卡最长 {max_days} 天（半年），本次填了 {grant_days} 天。"
                "需要更长时间请分次续卡（到期日往后接，权益不断档）。"
            ),
        )

    max_times = policy["max_grant_times"]
    if gt == GRANT_TIMES and max_times is not None and grant_times is not None \
            and grant_times > max_times:
        raise HTTPException(
            status_code=403,
            detail=f"次卡可用天数最多 {max_times} 天，本次填了 {grant_times} 天。",
        )


def is_assignment_active(a: BookAssignment, today: Optional[str] = None) -> bool:
    """这条授权现在还能不能学。

    永久(grant_type 为 NULL/permanent,含全部老师直接分配的行)恒 True——
    这是旧行为,不能因为加了卡种就把存量授权判死。

    次卡的判活口径是「有余量 **或** 今天已经扣过」: 只看 times_left>0 会让最后
    一天在当天首次进入扣减后立刻失效(扣到 0 → 判死 → 学生学一半被踢出去)。
    """
    gt = _normalize_grant_type(a.grant_type)
    if gt == GRANT_PERMANENT:
        return True
    if gt == GRANT_PERIOD:
        return a.expires_at is None or a.expires_at > utc_now()
    # GRANT_TIMES
    if (a.times_left or 0) > 0:
        return True
    return a.last_consumed_date == (today or local_today().isoformat())


async def active_assignments(
    db: AsyncSession, student_id: int, book_id: Optional[int] = None
) -> List[BookAssignment]:
    """该学生仍然有效的授权行(过期/用尽的次卡被滤掉)。"""
    q = select(BookAssignment).where(BookAssignment.student_id == student_id)
    if book_id is not None:
        q = q.where(BookAssignment.book_id == book_id)
    rows = (await db.execute(q)).scalars().all()
    today = local_today().isoformat()
    return [a for a in rows if is_assignment_active(a, today)]


async def consume_times_if_needed(
    db: AsyncSession, student_id: int, book_id: int
) -> None:
    """次卡扣减:该学生该书的次卡授权,当天首次进入扣 1 天。

    只在「真正开始学习」的入口调用(取单元词表),不要挂在任何列表/统计接口上——
    挂错地方会让学生翻一下书本列表就掉一天。

    幂等靠 last_consumed_date(北京日):同一天再进不重复扣,所以提交队列重放、
    刷新页面、切模式都不会多扣。
    """
    today = local_today().isoformat()
    rows = (await db.execute(
        select(BookAssignment).where(
            BookAssignment.student_id == student_id,
            BookAssignment.book_id == book_id,
            BookAssignment.grant_type == GRANT_TIMES,
        )
    )).scalars().all()
    changed = False
    for a in rows:
        if a.last_consumed_date == today:
            continue
        if (a.times_left or 0) <= 0:
            continue
        a.times_left = (a.times_left or 0) - 1
        a.last_consumed_date = today
        changed = True
    if changed:
        await db.commit()


def describe_grant(a: BookAssignment) -> dict:
    """给前端的卡片状态(剩余天数/次数/是否今天已用)。"""
    gt = _normalize_grant_type(a.grant_type)
    today = local_today().isoformat()
    info = {"grant_type": gt, "active": is_assignment_active(a, today)}
    if gt == GRANT_PERIOD:
        info["expires_at"] = a.expires_at
        if a.expires_at:
            info["days_left"] = max(0, (a.expires_at - utc_now()).days)
    elif gt == GRANT_TIMES:
        info["times_left"] = a.times_left or 0
        info["used_today"] = a.last_consumed_date == today
    return info


def generate_code_string() -> str:
    """生成格式化兑换码 XXXX-XXXX-XXXX-XXXX"""
    parts = []
    for _ in range(4):
        part = ''.join(random.choices(CHARSET, k=4))
        parts.append(part)
    return '-'.join(parts)


async def batch_generate_codes(
    db: AsyncSession,
    admin_id: int,
    count: int,
    book_id: Optional[int] = None,
    batch_note: Optional[str] = None,
    code_valid_days: int = 180,
    grant_type: str = GRANT_PERMANENT,
    grant_days: Optional[int] = None,
    grant_times: Optional[int] = None,
    book_ids: Optional[List[int]] = None,
    scope_series: Optional[str] = None,
    scope_stage: Optional[str] = None,
) -> List[RedemptionCode]:
    """批量生成兑换码。

    grant_type: permanent=永久 / period=包月(grant_days 必填) / times=次卡(grant_times 必填)。
    注意 code_valid_days 是「码本身多久内必须兑换」,与卡的时长/次数是两件事。
    Pydantic schema 已校验必填字段,这里不重复检查。

    一码多书(2026-08-29): `book_ids` 传一批书 → 每张码覆盖这一批;
    `book_id` 单书是旧调用形态,等价于 book_ids=[book_id]。
    `redemption_codes.book_id` 仍写主书(第一本)——存量语义与旧查询不炸;
    真实范围写进 `redemption_code_books` 明细表,兑换时按明细逐本发授权。
    scope_series/scope_stage 只是发码条件的留痕,供列表展示与事后追溯。
    """
    ids = list(dict.fromkeys(book_ids or ([book_id] if book_id else [])))
    if not ids:
        raise ValueError("必须指定至少一本单词本")
    primary_book_id = ids[0]

    codes = []
    code_expires_at = datetime.utcnow() + timedelta(days=code_valid_days)

    # 收集已有code避免重复
    existing = set()
    result = await db.execute(select(RedemptionCode.code))
    for row in result.scalars():
        existing.add(row)

    generated = []
    attempts = 0
    while len(generated) < count and attempts < count * 10:
        code_str = generate_code_string()
        attempts += 1
        if code_str not in existing:
            existing.add(code_str)
            generated.append(code_str)

    for code_str in generated:
        code = RedemptionCode(
            code=code_str,
            book_id=primary_book_id,
            status=RedemptionCodeStatus.UNUSED,
            created_by=admin_id,
            code_expires_at=code_expires_at,
            batch_note=batch_note,
            grant_type=grant_type,
            grant_days=grant_days if grant_type == GRANT_PERIOD else None,
            grant_times=grant_times if grant_type == GRANT_TIMES else None,
            scope_kind="group" if len(ids) > 1 else "book",
            scope_series=scope_series,
            scope_stage=scope_stage,
        )
        # 明细表随码一起 flush(relationship cascade),单书码也走这条路 → 读取侧同构
        code.books = [RedemptionCodeBook(book_id=bid) for bid in ids]
        db.add(code)
        codes.append(code)

    await db.commit()
    for c in codes:
        await db.refresh(c)
    return codes


async def _apply_one_book(
    db: AsyncSession,
    user: User,
    code: RedemptionCode,
    book: WordBook,
    now: datetime,
) -> tuple[str, str]:
    """把一张码的权益施加到**一本书**上 → (结果, 文案)。

    结果取值: 'granted'(新开) | 'renewed'(续期/升级) | 'skipped'(本本跳过,文案说明原因)。
    这是原先 redeem_code 里的单书续期矩阵,原样搬出来供逐本调用 —— 语义与**文案**都
    一字未改(单书码的提示语必须和改造前完全一致,学生和客服都习惯了那几句):
    已永久→跳过 / 永久卡覆盖→升级 / 跨类型→跳过 / 包月→接期 / 次卡→累加。

    ⚠️ 不在这里 commit。多书码要整批一致地落库(见 redeem_code)。
    """
    grant_type = code.grant_type or GRANT_PERMANENT
    book_name = book.name

    existing = (await db.execute(
        select(BookAssignment).where(
            BookAssignment.book_id == book.id,
            BookAssignment.student_id == user.id,
            BookAssignment.scope_type == 'book',
        )
    )).scalars().first()

    if existing is not None:
        existing_type = existing.grant_type or GRANT_PERMANENT
        # 已经是永久的,任何卡都没有意义;拿永久卡去覆盖次卡/月卡则是升级,放行
        if existing_type == GRANT_PERMANENT:
            return "skipped", f"你已拥有单词本《{book_name}》，无需重复兑换"
        if grant_type == GRANT_PERMANENT:
            existing.grant_type = GRANT_PERMANENT
            existing.expires_at = None
            existing.times_left = None
            return "renewed", f"兑换成功！《{book_name}》已升级为永久可学"
        if grant_type != existing_type:
            return "skipped", (f"《{book_name}》当前是{_grant_label(existing_type)}，"
                               f"不能直接用{_grant_label(grant_type)}续期，请等当前的用完")
        if grant_type == GRANT_PERIOD:
            # 未过期从原到期日往后接,已过期从现在算(别把过期的空窗期白送)
            base = existing.expires_at
            if base is None or base < now:
                base = now
            existing.expires_at = base + timedelta(days=code.grant_days or 0)
            return "renewed", (f"续期成功！《{book_name}》有效期延长 {code.grant_days} 天，"
                               f"到 {existing.expires_at.strftime('%Y-%m-%d')}")
        existing.times_left = (existing.times_left or 0) + (code.grant_times or 0)
        return "renewed", (f"续期成功！《{book_name}》增加 {code.grant_times} 天，"
                           f"剩余 {existing.times_left} 天")

    assignment = BookAssignment(
        book_id=book.id,
        student_id=user.id,
        teacher_id=code.created_by,
        scope_type='book',
        grant_type=grant_type,
    )
    if grant_type == GRANT_PERIOD:
        assignment.expires_at = now + timedelta(days=code.grant_days or 0)
        msg = (f"兑换成功！已获得《{book_name}》{code.grant_days} 天，"
               f"到 {assignment.expires_at.strftime('%Y-%m-%d')}")
    elif grant_type == GRANT_TIMES:
        assignment.times_left = code.grant_times or 0
        msg = f"兑换成功！已获得《{book_name}》次卡 {code.grant_times} 天（学习当天才计次）"
    else:
        msg = f"兑换成功！已获得单词本《{book_name}》"
    db.add(assignment)
    return "granted", msg


async def redeem_code(
    db: AsyncSession,
    user: User,
    code_str: str,
) -> dict:
    """兑换码激活单词本(支持一码多书)。

    返回 {success, message, book_name, books:[...], granted/renewed/skipped}。
    `book_name` 保留为**主书名**,老前端只读这个字段仍然工作。

    一码多书的两条关键规则(2026-08-29):
    1. **逐本独立判定**:14 本里有 1 本已拥有,其余 13 本照发,不整码作废。
    2. **只要有 ≥1 本成功就把码标 USED**;全部失败(如整批都已拥有)则**不**标 USED,
       让学生还能把这张卡用在别处/申诉。这是"一码作废"与"权益白送"之间的取舍点。
    """
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.code == code_str)
    )
    code = result.scalar_one_or_none()

    if not code:
        return {"success": False, "message": "兑换码不存在"}

    if code.status == RedemptionCodeStatus.USED:
        return {"success": False, "message": "兑换码已被使用"}

    if code.status == RedemptionCodeStatus.DISABLED:
        return {"success": False, "message": "兑换码已被禁用"}

    # 检查兑换码本身是否过期
    now = datetime.utcnow()
    if code.code_expires_at < now:
        code.status = RedemptionCodeStatus.EXPIRED
        await db.commit()
        return {"success": False, "message": "兑换码已过期"}

    # 该码覆盖的书:明细表是真源(存量单书码已由启动迁移回填,读取侧同构);
    # 明细表意外为空时退回 book_id,避免老库迁移没跑成就无法兑换
    detail_ids = list((await db.execute(
        select(RedemptionCodeBook.book_id).where(RedemptionCodeBook.code_id == code.id)
    )).scalars())
    if not detail_ids and code.book_id:
        detail_ids = [code.book_id]

    books: list[WordBook] = []
    for bid in detail_ids:
        b = await db.get(WordBook, bid)
        if b is not None:
            books.append(b)

    if not books:
        # 绑定的书全被删了
        code.status = RedemptionCodeStatus.DISABLED
        await db.commit()
        return {"success": False, "message": "兑换码绑定的单词本已不存在，请联系管理员"}

    # 主书名:优先 code.book_id 对应那本,否则第一本(老前端只读 book_name)
    primary = next((b for b in books if b.id == code.book_id), books[0])
    # ⚠️ 书名/ID 必须**在任何 commit/rollback 之前**取成普通值。
    # rollback 会把 ORM 对象标记为过期,之后读 b.name 会触发懒加载 →
    # 在 async 会话里就是 MissingGreenlet 500(CLAUDE.md 记过同类事故:
    # 发币走共用 session 时 rollback 让 current_user 过期)。
    primary_name = primary.name
    book_pairs = [(b.id, b.name) for b in books]

    granted: list[str] = []
    renewed: list[str] = []
    skipped: list[str] = []
    ok_names: list[str] = []   # 真正开通/续期成功的书名,用于多书汇总文案
    for b in books:
        outcome, text_ = await _apply_one_book(db, user, code, b, now)
        if outcome == "granted":
            granted.append(text_)
            ok_names.append(b.name)
        elif outcome == "renewed":
            renewed.append(text_)
            ok_names.append(b.name)
        else:
            skipped.append(text_)

    ok_count = len(ok_names)
    if ok_count == 0:
        # 一本都没成 → 不消耗这张码,原因如实回给学生。
        # **刻意不 rollback**:走到这里意味着每一本都是 skipped,而 _apply_one_book
        # 的所有 skipped 分支都在任何写操作之前 return,所以此刻没有待回滚的改动
        # (这条不变量别破坏:将来若在判定前加写操作,要改成 SAVEPOINT 而不是 rollback)。
        # 而 rollback 会让**共用 session 里所有 ORM 对象过期** —— 调用方随后读
        # current_user.xxx 就触发懒加载,async 会话下即 MissingGreenlet 500;
        # 它还会连带丢掉调用方本请求内其它未提交的改动。
        return {
            "success": False,
            "message": skipped[0] if len(skipped) == 1 else
                       f"这张卡里的 {len(skipped)} 本单词本你都已拥有或无法续期",
            "book_name": primary_name,
            "skipped": skipped,
        }

    code.status = RedemptionCodeStatus.USED
    code.used_by = user.id
    code.used_at = now
    await db.commit()

    # 文案:单书**原样**沿用改造前那几句(学生/客服都习惯了,别动);
    # 多书给汇总,附前几本书名让学生确认拿到了什么
    if len(book_pairs) == 1:
        msg = (granted + renewed)[0]
    else:
        head = "、".join(ok_names[:3])
        msg = f"兑换成功！共开通 {ok_count} 本单词本"
        if head:
            msg += f"（{head}{'…' if ok_count > 3 else ''}）"
        if skipped:
            msg += f"，另有 {len(skipped)} 本已拥有未重复开通"

    return {
        "success": True,
        "message": msg,
        "book_name": primary_name,
        "books": [{"id": i, "name": n} for i, n in book_pairs],
        "granted": granted,
        "renewed": renewed,
        "skipped": skipped,
    }


def _grant_label(grant_type: str) -> str:
    return {
        GRANT_PERMANENT: "永久卡",
        GRANT_PERIOD: "包月卡",
        GRANT_TIMES: "次卡",
    }.get(grant_type, grant_type)
