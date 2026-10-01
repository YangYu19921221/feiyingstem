"""音标视频库访问授权服务(2026-10-01)

和单词本兑换码分开的一套码 —— 为什么分开见 models/phonetic.py 的 PhoneticCode
类注释(单词本码的 book 外键 NOT NULL,音标不是单词本,塞假书会漏进选书页)。

卡种语义与 subscription_service **完全复用**:判活走 `is_assignment_active`
(鸭子类型,只读 grant_type/expires_at/times_left/last_consumed_date 四列,
PhoneticAccessGrant 的列名刻意对齐),发码串走 `generate_code_string`,
发码权限走 `guard_card_policy`。别在这里另写一套卡种规则 —— 两套会漂移。
"""
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.models.phonetic import PhoneticCode, PhoneticAccessGrant, PhoneticAccessLog
from app.models.user import User
from app.services import subscription_service as subs
from app.services.subscription_service import (
    GRANT_PERMANENT, GRANT_PERIOD, GRANT_TIMES,
    _normalize_grant_type, _grant_label, generate_code_string,
)


async def _active_grant(
    db: AsyncSession, student_id: int, today: Optional[str] = None
) -> Optional[PhoneticAccessGrant]:
    """该学生对音标库那条授权行(若生效)。一人一行(uq_phonetic_access_student)。

    判活直接借 subscription_service.is_assignment_active —— PhoneticAccessGrant
    的四个授权列与 BookAssignment 同名同义,鸭子类型拿来即用。
    """
    row = (await db.execute(
        select(PhoneticAccessGrant).where(
            PhoneticAccessGrant.student_id == student_id
        )
    )).scalars().first()
    if row is None:
        return None
    if subs.is_assignment_active(row, today or local_today().isoformat()):
        return row
    return None


async def has_phonetic_access(db: AsyncSession, student_id: int) -> bool:
    """学生现在能不能看音标视频库(有一条生效的授权行)。"""
    return (await _active_grant(db, student_id)) is not None


async def active_grant(db: AsyncSession, student_id: int) -> Optional[PhoneticAccessGrant]:
    """生效的授权行;没有生效授权返回 None。闸门据此判断是否要扣次卡。"""
    return await _active_grant(db, student_id)


def times_due_today(grant: PhoneticAccessGrant) -> bool:
    """这条授权是次卡且今天还没扣过 —— 只有这时交付内容才需要扣一次(开一次写事务)。
    永久/包月、或今天已扣过的次卡都不碰写锁(翻讲义一分钟几十次)。
    这只是**省写**的预判;真正防重复扣的是 consume_times_if_needed 里的条件 UPDATE。"""
    return (_normalize_grant_type(grant.grant_type) == GRANT_TIMES
            and grant.last_consumed_date != local_today().isoformat())


def log_access(
    db: AsyncSession,
    user: User,
    video_id: Optional[int],
    *,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """记一条音标视频访问日志(只 add 不 commit,由调用方的 commit 一起落库)。

    **刻意不写 operation_logs** —— 那是教职工追责日志(学生不记,见 CLAUDE.md)。
    观看是学生行为、量大,单独落 phonetic_access_logs,不污染机构操作记录列表。
    IP/设备用于防转卖追人;与 audit_log 同口径,设备解析复用 describe_device。
    """
    db.add(PhoneticAccessLog(
        user_id=user.id,
        org_id=user.org_id,
        video_id=video_id,
        ip=(ip or "")[:64] or None,
        user_agent=(user_agent or "")[:300] or None,
    ))


async def consume_times_if_needed(db: AsyncSession, student_id: int) -> None:
    """次卡扣减:该学生的音标次卡授权,当天首次「真的进去看」扣 1 天。

    只在交付内容的端点调(换票/串流/讲义),由 phonetics._enforce_gate 统一调用,
    且只在「靠授权进来」时调(open 模式不扣)。不要挂在列表/红点等接口上。

    **必须是单条条件 UPDATE,不能读出来减完写回**: 打开一节课会同时发换票和讲义列表两个
    请求,两边各读到「今天还没扣」就会扣两天。幂等条件(今天没扣过 + 还有余量)写进 WHERE,
    谁先拿到写锁谁扣,另一个匹配 0 行。
    """
    today = local_today().isoformat()
    await db.execute(
        update(PhoneticAccessGrant)
        .where(
            PhoneticAccessGrant.student_id == student_id,
            PhoneticAccessGrant.grant_type == GRANT_TIMES,
            PhoneticAccessGrant.times_left > 0,
            or_(PhoneticAccessGrant.last_consumed_date.is_(None),
                PhoneticAccessGrant.last_consumed_date != today),
        )
        .values(times_left=PhoneticAccessGrant.times_left - 1, last_consumed_date=today)
        .execution_options(synchronize_session=False)
    )
    # 匹配 0 行也要 commit:UPDATE 已开启写事务,不提交会一直占着写锁到请求结束
    await db.commit()


def describe_grant(a: Optional[PhoneticAccessGrant]) -> dict:
    """给前端的授权状态卡片(剩余天数/次数/今天是否已用)。无授权返回 active=False。"""
    if a is None:
        return {"active": False, "grant_type": None}
    gt = _normalize_grant_type(a.grant_type)
    today = local_today().isoformat()
    info = {"grant_type": gt, "active": subs.is_assignment_active(a, today)}
    if gt == GRANT_PERIOD:
        info["expires_at"] = a.expires_at
        if a.expires_at:
            info["days_left"] = max(0, (a.expires_at - utc_now()).days)
    elif gt == GRANT_TIMES:
        info["times_left"] = a.times_left or 0
        info["used_today"] = a.last_consumed_date == today
    return info


async def batch_generate_phonetic_codes(
    db: AsyncSession,
    admin_id: int,
    count: int,
    org_id: Optional[int] = None,
    batch_note: Optional[str] = None,
    code_valid_days: int = 180,
    grant_type: str = GRANT_PERMANENT,
    grant_days: Optional[int] = None,
    grant_times: Optional[int] = None,
) -> List[PhoneticCode]:
    """批量生成音标专用兑换码。

    grant_type: permanent / period(grant_days 必填) / times(grant_times 必填)。
    code_valid_days 是「码本身多久内必须兑换」,与卡的时长/次数无关。
    卡种/时长的身份闸门由调用方先过 guard_card_policy(与单词本发码同口径)。
    """
    gt = _normalize_grant_type(grant_type)
    code_expires_at = datetime.utcnow() + timedelta(days=code_valid_days)

    # 收集已有码避免重复(与 subscription_service.batch_generate_codes 同套路)
    existing = set((await db.execute(select(PhoneticCode.code))).scalars())

    generated: List[str] = []
    attempts = 0
    while len(generated) < count and attempts < count * 10:
        code_str = generate_code_string()
        attempts += 1
        if code_str not in existing:
            existing.add(code_str)
            generated.append(code_str)

    codes: List[PhoneticCode] = []
    for code_str in generated:
        code = PhoneticCode(
            code=code_str,
            grant_type=gt,
            grant_days=grant_days if gt == GRANT_PERIOD else None,
            grant_times=grant_times if gt == GRANT_TIMES else None,
            status="unused",
            created_by=admin_id,
            org_id=org_id,
            batch_note=batch_note,
            code_expires_at=code_expires_at,
        )
        db.add(code)
        codes.append(code)

    await db.commit()
    for c in codes:
        await db.refresh(c)
    return codes


_STATUS_MESSAGES = {
    "used": "兑换码已被使用",
    "disabled": "兑换码已被禁用",
    "expired": "兑换码已过期",
}


def _reject_reason(grant: Optional[PhoneticAccessGrant], grant_type: str, today: str) -> Optional[str]:
    """已有授权下这张码**不该兑**的理由(不消耗码);None = 可以兑。"""
    if grant is None:
        return None
    existing_type = _normalize_grant_type(grant.grant_type)
    if existing_type == GRANT_PERMANENT:
        # 已永久,任何卡都没意义;**不消耗**这张码,让学生用在别处/申诉
        return "你已拥有音标视频库的永久权限，无需重复兑换"
    if grant_type == GRANT_PERMANENT:
        return None   # 永久卡覆盖任何卡 = 升级
    if not subs.is_assignment_active(grant, today):
        return None   # 已失效:按新卡整条覆盖(见 _apply_code)
    if grant_type != existing_type:
        return (f"音标视频库当前是{_grant_label(existing_type)}，"
                f"不能直接用{_grant_label(grant_type)}续期，请等当前的用完")
    return None


def _apply_code(
    grant: Optional[PhoneticAccessGrant], *, student_id: int, grant_type: str,
    grant_days: int, grant_times: int, created_by: Optional[int], now: datetime, today: str,
) -> tuple[Optional[PhoneticAccessGrant], str]:
    """把一张码落到授权行上,返回 (要新增的行或 None, 成功文案)。调用前已过 _reject_reason。"""
    if grant is None:
        new = PhoneticAccessGrant(student_id=student_id, grant_type=grant_type,
                                  created_by=created_by)
        if grant_type == GRANT_PERIOD:
            new.expires_at = now + timedelta(days=grant_days)
            msg = (f"兑换成功！已开通音标视频库 {grant_days} 天，"
                   f"到 {new.expires_at.strftime('%Y-%m-%d')}")
        elif grant_type == GRANT_TIMES:
            new.times_left = grant_times
            msg = f"兑换成功！已开通音标视频库次卡 {grant_times} 天（学习当天才计次）"
        else:
            msg = "兑换成功！已开通音标视频库(永久可看)"
        return new, msg

    existing_type = _normalize_grant_type(grant.grant_type)
    if grant_type == GRANT_PERMANENT:
        grant.grant_type = GRANT_PERMANENT
        grant.expires_at = None
        grant.times_left = None
        return None, "兑换成功！音标视频库已升级为永久可看"

    if not subs.is_assignment_active(grant, today):
        # 当前这张**已失效**(包月过期 / 次卡用完):跨类型「请等用完」会把学生锁死 ——
        # 失效的卡永远不会再"用完"。所以失效时按新卡种**整条覆盖**,等同重新开通。
        # 另一类的残留列一并清掉(次卡的 last_consumed_date 也清,新卡当天能正常计次)
        grant.grant_type = grant_type
        grant.last_consumed_date = None
        if grant_type == GRANT_PERIOD:
            grant.expires_at = now + timedelta(days=grant_days)
            grant.times_left = None
            return None, (f"兑换成功！音标视频库已重新开通 {grant_days} 天，"
                          f"到 {grant.expires_at.strftime('%Y-%m-%d')}")
        grant.times_left = grant_times
        grant.expires_at = None
        return None, f"兑换成功！音标视频库已重新开通次卡 {grant_times} 天（学习当天才计次）"

    if existing_type == GRANT_PERIOD:   # 同类续期:从原到期日往后接
        base = grant.expires_at
        if base is None or base < now:
            base = now
        grant.expires_at = base + timedelta(days=grant_days)
        return None, (f"续期成功！音标视频库有效期延长 {grant_days} 天，"
                      f"到 {grant.expires_at.strftime('%Y-%m-%d')}")
    grant.times_left = (grant.times_left or 0) + grant_times   # 次卡:累加
    return None, (f"续期成功！音标视频库增加 {grant_times} 天，"
                  f"剩余 {grant.times_left} 天")


async def _load_grant(db: AsyncSession, student_id: int) -> Optional[PhoneticAccessGrant]:
    # populate_existing: 第二次读(写事务里)必须拿库里的最新值,不能用身份映射里的旧对象
    return (await db.execute(
        select(PhoneticAccessGrant)
        .where(PhoneticAccessGrant.student_id == student_id)
        .execution_options(populate_existing=True)
    )).scalars().first()


async def redeem_phonetic_code(
    db: AsyncSession,
    user: User,
    code_str: str,
) -> dict:
    """兑换音标码 → 开通/续期整个音标视频库的访问权。

    返回 {success, message, scope:'phonetic'} —— scope 字段让统一 /redeem 端点
    和前端能区分这是音标码还是单词本码,给不同的成功文案与跳转。

    重复兑换 = 续期/充值(与单词本码同语义):
    已永久 → 跳过;永久卡覆盖 → 升级;当前已失效 → 按新卡整条覆盖;
    生效中跨类型 → 拒(请等当前用完);包月 → 从原到期日往后接;次卡 → 累加。

    ## 并发(审查实测复现过两种)
    ①**一码多兑**: 旧写法是「读 status → Python 判 → 最后改 used」,两个学生同时兑同一张码
    都会成功 —— 防转卖的码被一张开两个号。现在**先用条件 UPDATE 认领**
    (`WHERE status='unused'`,看 rowcount),认领不到就是被别人抢先了。
    ②**同一学生两张码同时兑 → UNIQUE 冲突 500**: 两边都读到「没有授权行」都去 INSERT。
    认领那条 UPDATE 拿到了写锁,之后在**同一写事务里重读**授权行,后到的那个就能看到
    先到的那行、走续期分支。IntegrityError 仍兜一层,不让它变成 500。
    ⚠️ rollback 会让会话里所有 ORM 对象过期(再访问 → MissingGreenlet,金币发放踩过),
    所以码和学生的字段一开始就取成局部变量,rollback 之后只用局部变量。
    """
    def _fail(msg: str) -> dict:
        return {"success": False, "message": msg, "scope": "phonetic"}

    student_id = user.id
    code = (await db.execute(
        select(PhoneticCode).where(PhoneticCode.code == code_str)
    )).scalar_one_or_none()
    if not code:
        return _fail("兑换码不存在")
    if code.status in _STATUS_MESSAGES:
        return _fail(_STATUS_MESSAGES[code.status])

    now = datetime.utcnow()
    if code.code_expires_at and code.code_expires_at < now:
        # 写 expired 而不是 disabled:后者是管理员手动作废,混用会让学生二次输入时
        # 看到「已被禁用」、后台对账也分不清是谁作废的
        code.status = "expired"
        await db.commit()
        return _fail("兑换码已过期")

    code_id = code.id
    grant_type = _normalize_grant_type(code.grant_type)
    grant_days = code.grant_days or 0
    grant_times = code.grant_times or 0
    created_by = code.created_by
    today = local_today().isoformat()

    # 先按当前授权判一遍:注定要拒的(已永久 / 生效中跨类型)不碰码、不开写事务
    reason = _reject_reason(await _load_grant(db, student_id), grant_type, today)
    if reason:
        return _fail(reason)

    # 原子认领:谁的 UPDATE 先拿到写锁谁兑成;另一个匹配 0 行
    claimed = await db.execute(
        update(PhoneticCode)
        .where(PhoneticCode.id == code_id, PhoneticCode.status == "unused")
        .values(status="used", used_by=student_id, used_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await db.rollback()
        status = (await db.execute(
            select(PhoneticCode.status).where(PhoneticCode.id == code_id)
        )).scalar_one_or_none()
        return _fail(_STATUS_MESSAGES.get(status, "兑换码已被使用"))

    # 写事务里重读授权行(同一学生并发兑两张码时,后到的要看到先到的那行)
    grant = await _load_grant(db, student_id)
    reason = _reject_reason(grant, grant_type, today)
    if reason:
        await db.rollback()   # 退回认领,码保持未使用
        return _fail(reason)

    new_row, msg = _apply_code(
        grant, student_id=student_id, grant_type=grant_type, grant_days=grant_days,
        grant_times=grant_times, created_by=created_by, now=now, today=today,
    )
    if new_row is not None:
        db.add(new_row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return _fail("刚刚已经兑换过一张，请刷新页面后再试")

    return {"success": True, "message": msg, "scope": "phonetic"}
