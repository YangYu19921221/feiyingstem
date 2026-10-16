"""音标视频库访问授权服务(2026-10-01)

和单词本兑换码分开的一套码 —— 为什么分开见 models/phonetic.py 的 PhoneticCode
类注释(单词本码的 book 外键 NOT NULL,音标不是单词本,塞假书会漏进选书页)。

卡种语义与 subscription_service **完全复用**:判活走 `is_assignment_active`
(鸭子类型,只读 grant_type/expires_at/times_left/last_consumed_date 四列,
PhoneticAccessGrant 的列名刻意对齐),发码串走 `generate_code_string`,
发码权限走 `guard_card_policy`。别在这里另写一套卡种规则 —— 两套会漂移。
"""
from datetime import datetime, timedelta
from typing import Callable, Iterable, List, Optional, Union

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.models.phonetic import (
    PhoneticCode, PhoneticCodeVideo, PhoneticAccessGrant, PhoneticAccessLog,
    PhoneticVideo, PhoneticVideoGrant,
)

# 码的开通范围(phonetic_codes.scope): 整个音标视频库 / 只开指定的几节(明细在 phonetic_code_videos)
SCOPE_LIBRARY = "library"
SCOPE_VIDEOS = "videos"
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


Grant = Union[PhoneticAccessGrant, PhoneticVideoGrant]


async def active_video_grant(
    db: AsyncSession, student_id: int, video_id: int
) -> Optional[PhoneticVideoGrant]:
    """该学生对**这一节**的单节授权(若生效)。一人一节一行(uq_phonetic_video_grant)。"""
    row = (await db.execute(
        select(PhoneticVideoGrant).where(
            PhoneticVideoGrant.student_id == student_id,
            PhoneticVideoGrant.video_id == video_id,
        )
    )).scalars().first()
    if row is not None and subs.is_assignment_active(row, local_today().isoformat()):
        return row
    return None


async def granted_video_ids(
    db: AsyncSession, student_id: int, video_ids: Iterable[int]
) -> set[int]:
    """这批视频里该学生有生效单节授权的那些。列表页一次查完(**别按行 N 次查**)。"""
    ids = list(video_ids)
    if not ids:
        return set()
    rows = (await db.execute(
        select(PhoneticVideoGrant).where(
            PhoneticVideoGrant.student_id == student_id,
            PhoneticVideoGrant.video_id.in_(ids),
        )
    )).scalars().all()
    today = local_today().isoformat()
    return {r.video_id for r in rows if subs.is_assignment_active(r, today)}


async def pick_grant(
    db: AsyncSession, student_id: int, video_id: Optional[int] = None
) -> Optional[Grant]:
    """看这一节靠哪条授权放行:整库授权或这一节的单节授权,都没有返回 None。

    两条都生效时**优先选今天不用扣的那条**: 整库是次卡、这一节另有永久单节码,
    看这一节就不该扣整库次卡的天数(单节码是专门买来开这一节的)。
    video_id 为 None = 只问整库(讲义页图在查到课件之前、列表页先判整库)。
    """
    found: List[Grant] = []
    lib = await _active_grant(db, student_id)
    if lib is not None:
        found.append(lib)
    if video_id is not None:
        vg = await active_video_grant(db, student_id, video_id)
        if vg is not None:
            found.append(vg)
    if not found:
        return None
    for g in found:
        if not times_due_today(g):
            return g
    return found[0]


def times_due_today(grant: Grant) -> bool:
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


async def consume_times_if_needed(db: AsyncSession, grant: Grant) -> None:
    """次卡扣减:放行这次访问的那条授权(整库或单节,见 pick_grant)是次卡时,
    当天首次「真的进去看」扣 1 天。

    只在交付内容的端点调(换票/串流/讲义),由 phonetics._enforce_gate 统一调用,
    且只在「靠授权进来」时调(open 模式不扣)。不要挂在列表/红点等接口上。

    **必须是单条条件 UPDATE,不能读出来减完写回**: 打开一节课会同时发换票和讲义列表两个
    请求,两边各读到「今天还没扣」就会扣两天。幂等条件(今天没扣过 + 还有余量)写进 WHERE,
    谁先拿到写锁谁扣,另一个匹配 0 行。
    """
    model = type(grant)
    grant_id = grant.id
    today = local_today().isoformat()
    await db.execute(
        update(model)
        .where(
            model.id == grant_id,
            model.grant_type == GRANT_TIMES,
            model.times_left > 0,
            or_(model.last_consumed_date.is_(None), model.last_consumed_date != today),
        )
        .values(times_left=model.times_left - 1, last_consumed_date=today)
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
    videos: Optional[List[tuple[int, str]]] = None,
) -> List[PhoneticCode]:
    """批量生成音标专用兑换码。

    grant_type: permanent / period(grant_days 必填) / times(grant_times 必填)。
    code_valid_days 是「码本身多久内必须兑换」,与卡的时长/次数无关。
    卡种/时长的身份闸门由调用方先过 guard_card_policy(与单词本发码同口径)。
    videos 为空 = 整库码;非空 = 只开这几节,[(视频id, 标题)],归属由调用方先过
    resolve_code_videos 校验,标题存进明细当快照。
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
            scope=SCOPE_VIDEOS if videos else SCOPE_LIBRARY,
        )
        db.add(code)
        codes.append(code)

    if videos:
        await db.flush()   # 拿到码 id 再写明细
        for c in codes:
            for vid, title in videos:
                db.add(PhoneticCodeVideo(code_id=c.id, video_id=vid, video_title=title))

    await db.commit()
    for c in codes:
        await db.refresh(c)
    return codes


async def code_videos(db: AsyncSession, code_ids: Iterable[int]) -> dict[int, list[dict]]:
    """这批码各开哪几节(码列表一次查完)。标题是发码时的快照。整库码不在返回里。"""
    ids = list(code_ids)
    if not ids:
        return {}
    rows = (await db.execute(
        select(PhoneticCodeVideo).where(PhoneticCodeVideo.code_id.in_(ids))
        .order_by(PhoneticCodeVideo.id)
    )).scalars().all()
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r.code_id, []).append({"id": r.video_id, "title": r.video_title})
    return out


_STATUS_MESSAGES = {
    "used": "兑换码已被使用",
    "disabled": "兑换码已被禁用",
    "expired": "兑换码已过期",
}


LIBRARY_LABEL = "音标视频库"


def _video_label(title: str) -> str:
    return f"「{title}」这一节"


def _reject_reason(grant: Optional[Grant], grant_type: str, today: str,
                   label: str = LIBRARY_LABEL) -> Optional[str]:
    """已有授权下这张码**不该兑**的理由(不消耗码);None = 可以兑。
    整库码和单节码同一套规则,label 只决定文案里说的是「音标视频库」还是「某一节」。"""
    if grant is None:
        return None
    existing_type = _normalize_grant_type(grant.grant_type)
    if existing_type == GRANT_PERMANENT:
        # 已永久,任何卡都没意义;**不消耗**这张码,让学生用在别处/申诉
        return f"你已拥有{label}的永久权限，无需重复兑换"
    if grant_type == GRANT_PERMANENT:
        return None   # 永久卡覆盖任何卡 = 升级
    if not subs.is_assignment_active(grant, today):
        return None   # 已失效:按新卡整条覆盖(见 _apply_code)
    if grant_type != existing_type:
        return (f"{label}当前是{_grant_label(existing_type)}，"
                f"不能直接用{_grant_label(grant_type)}续期，请等当前的用完")
    return None


def _apply_code(
    grant: Optional[Grant], *, new_row: Callable[[], Grant], grant_type: str,
    grant_days: int, grant_times: int, now: datetime, today: str,
    label: str = LIBRARY_LABEL,
) -> tuple[Optional[Grant], str]:
    """把一张码落到授权行上,返回 (要新增的行或 None, 成功文案)。调用前已过 _reject_reason。
    new_row 造一条空授权行(整库 PhoneticAccessGrant / 单节 PhoneticVideoGrant)。"""
    if grant is None:
        new = new_row()
        if grant_type == GRANT_PERIOD:
            new.expires_at = now + timedelta(days=grant_days)
            msg = (f"兑换成功！已开通{label} {grant_days} 天，"
                   f"到 {new.expires_at.strftime('%Y-%m-%d')}")
        elif grant_type == GRANT_TIMES:
            new.times_left = grant_times
            msg = f"兑换成功！已开通{label}次卡 {grant_times} 天（学习当天才计次）"
        else:
            msg = f"兑换成功！已开通{label}(永久可看)"
        return new, msg

    existing_type = _normalize_grant_type(grant.grant_type)
    if grant_type == GRANT_PERMANENT:
        grant.grant_type = GRANT_PERMANENT
        grant.expires_at = None
        grant.times_left = None
        return None, f"兑换成功！{label}已升级为永久可看"

    if not subs.is_assignment_active(grant, today):
        # 当前这张**已失效**(包月过期 / 次卡用完):跨类型「请等用完」会把学生锁死 ——
        # 失效的卡永远不会再"用完"。所以失效时按新卡种**整条覆盖**,等同重新开通。
        # 另一类的残留列一并清掉(次卡的 last_consumed_date 也清,新卡当天能正常计次)
        grant.grant_type = grant_type
        grant.last_consumed_date = None
        if grant_type == GRANT_PERIOD:
            grant.expires_at = now + timedelta(days=grant_days)
            grant.times_left = None
            return None, (f"兑换成功！{label}已重新开通 {grant_days} 天，"
                          f"到 {grant.expires_at.strftime('%Y-%m-%d')}")
        grant.times_left = grant_times
        grant.expires_at = None
        return None, f"兑换成功！{label}已重新开通次卡 {grant_times} 天（学习当天才计次）"

    if existing_type == GRANT_PERIOD:   # 同类续期:从原到期日往后接
        base = grant.expires_at
        if base is None or base < now:
            base = now
        grant.expires_at = base + timedelta(days=grant_days)
        return None, (f"续期成功！{label}有效期延长 {grant_days} 天，"
                      f"到 {grant.expires_at.strftime('%Y-%m-%d')}")
    grant.times_left = (grant.times_left or 0) + grant_times   # 次卡:累加
    return None, (f"续期成功！{label}增加 {grant_times} 天，"
                  f"剩余 {grant.times_left} 天")


async def _load_grant(
    db: AsyncSession, student_id: int, video_id: Optional[int] = None
) -> Optional[Grant]:
    """取授权行:video_id 为空取整库那行,否则取这一节那行。
    populate_existing: 第二次读(写事务里)必须拿库里的最新值,不能用身份映射里的旧对象"""
    if video_id is None:
        q = select(PhoneticAccessGrant).where(PhoneticAccessGrant.student_id == student_id)
    else:
        q = select(PhoneticVideoGrant).where(
            PhoneticVideoGrant.student_id == student_id,
            PhoneticVideoGrant.video_id == video_id,
        )
    return (await db.execute(
        q.execution_options(populate_existing=True)
    )).scalars().first()


def _card_desc(grant_type: str, grant_days: int, grant_times: int) -> str:
    if grant_type == GRANT_PERIOD:
        return f"{grant_days} 天"
    if grant_type == GRANT_TIMES:
        return f"次卡 {grant_times} 天,学习当天才计次"
    return "永久可看"


def _titles(ts: List[str]) -> str:
    return "".join(f"「{t}」" for t in ts)


async def redeem_phonetic_code(
    db: AsyncSession,
    user: User,
    code_str: str,
) -> dict:
    """兑换音标码 → 开通/续期整个音标视频库,或只开码上指定的那几节。

    返回 {success, message, scope:'phonetic', video_ids} —— scope 字段让统一 /redeem 端点
    和前端能区分这是音标码还是单词本码,给不同的成功文案与跳转;video_ids = 这次开通/续期的那几节
    (整库码为 None),前端兑完据此打开或标出它们(否则学生回到一屏卡片里找不到开的是哪几节)。

    指定几节的码(2026-10-16)与整库码**同一套续期规则**,逐节落 PhoneticVideoGrant
    (一人一节一行),照单词本「一码多书」逐节给结果: 开通 / 续期 / 跳过(已永久或生效中跨卡种)。
    **每一节都跳过才算失败,且不吞码**;只要有一节开成,码就用掉。另三道整张拒的判定(都不吞码):
    视频都被删了 / 都下架了、视频不属于学生的学校(平台 admin 能给任何机构的视频发平台码)、
    学生已有整库永久权限(这几节本来就能看)。

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
    # 机构码只给本机构学生兑(2026-10-02): 否则 A 机构的额度会被 B 机构的学生用掉。
    # 平台码(org_id 为 NULL)不限机构。放在过期判定之前: 别家的码不该被这边改成 expired
    if code.org_id is not None and code.org_id != user.org_id:
        return _fail("这张兑换码不是你所在学校发放的,请向自己的老师索取")

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
    by_video = code.scope == SCOPE_VIDEOS
    today = local_today().isoformat()

    # targets: [(视频id 或 None=整库, 显示名)]
    targets: List[tuple[Optional[int], str]]
    if by_video:
        # 视频要还在、且是学生看得见的(本机构或平台预置)。inner join 掉已删的视频;
        # skip_tenant_filter + 显式判归属: 别家机构的视频要说「不是你学校的」而不是「不存在」
        rows = (await db.execute(
            select(PhoneticCodeVideo.video_id, PhoneticVideo.org_id,
                   PhoneticVideo.is_active, PhoneticVideo.title)
            .join(PhoneticVideo, PhoneticVideo.id == PhoneticCodeVideo.video_id)
            .where(PhoneticCodeVideo.code_id == code_id)
            .order_by(PhoneticCodeVideo.id)
            .execution_options(skip_tenant_filter=True)
        )).all()
        if not rows:
            return _fail("这张兑换码开的视频已被删除,请找老师换一张")
        if any(r.org_id is not None and r.org_id != user.org_id for r in rows):
            return _fail("这张兑换码开的视频不是你所在学校的,请向自己的老师索取")
        if not any(r.is_active for r in rows):
            return _fail("这张兑换码开的视频暂时都下架了,码没有用掉,等老师重新上架后再兑换")
        lib = await _load_grant(db, student_id)
        if lib is not None and _normalize_grant_type(lib.grant_type) == GRANT_PERMANENT:
            return _fail("你已开通整个音标视频库(永久),这几节本来就能看,这张码不用兑换,留着给别人吧")
        # 下架的那几节也一并授权: 重新上架后就能看(此刻全下架的已在上面整张拒掉)
        targets = [(r.video_id, r.title) for r in rows]
    else:
        targets = [(None, LIBRARY_LABEL)]

    def _label(vid: Optional[int], title: str) -> str:
        return LIBRARY_LABEL if vid is None else _video_label(title)

    async def _load_all() -> dict:
        if not by_video:
            return {None: await _load_grant(db, student_id)}
        rows = (await db.execute(
            select(PhoneticVideoGrant).where(
                PhoneticVideoGrant.student_id == student_id,
                PhoneticVideoGrant.video_id.in_([t[0] for t in targets]),
            ).execution_options(populate_existing=True)
        )).scalars().all()
        return {r.video_id: r for r in rows}

    def _reasons(grants: dict) -> List[Optional[str]]:
        return [_reject_reason(grants.get(vid), grant_type, today, _label(vid, title))
                for vid, title in targets]

    def _all_skipped_msg(reasons: List[str]) -> str:
        if len(reasons) == 1:
            return reasons[0]
        return "这几节你都已经开通了(已是永久,或当前卡种不同、要等用完再续),这张码没有用掉,留着给别人吧"

    # 先按当前授权判一遍:每一节都注定要跳过的,不碰码、不开写事务
    reasons = _reasons(await _load_all())
    if all(reasons):
        return _fail(_all_skipped_msg(reasons))

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
    grants = await _load_all()
    reasons = _reasons(grants)
    if all(reasons):
        await db.rollback()   # 退回认领,码保持未使用
        return _fail(_all_skipped_msg(reasons))

    opened: List[str] = []
    renewed: List[str] = []
    skipped: List[str] = []
    done_ids: List[int] = []
    single_msg = ""
    for (vid, title), reason in zip(targets, reasons):
        if reason:
            skipped.append(title)
            continue
        g = grants.get(vid)
        was_active = g is not None and subs.is_assignment_active(g, today)

        def _new_row(vid=vid) -> Grant:
            if vid is None:
                return PhoneticAccessGrant(student_id=student_id, grant_type=grant_type,
                                           created_by=created_by)
            return PhoneticVideoGrant(student_id=student_id, video_id=vid,
                                      grant_type=grant_type, created_by=created_by)

        new_row, single_msg = _apply_code(
            g, new_row=_new_row, grant_type=grant_type, grant_days=grant_days,
            grant_times=grant_times, now=now, today=today, label=_label(vid, title),
        )
        if new_row is not None:
            db.add(new_row)
        (renewed if was_active else opened).append(title)
        if vid is not None:
            done_ids.append(vid)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return _fail("刚刚已经兑换过一张，请刷新页面后再试")

    if len(targets) == 1:
        msg = single_msg   # 整库码 / 只开一节:沿用逐条文案(带到期日、剩余天数)
    else:
        parts = []
        if opened:
            parts.append(f"已开通 {len(opened)} 节({_card_desc(grant_type, grant_days, grant_times)})"
                         f":{_titles(opened)}")
        if renewed:
            parts.append(f"续期 {len(renewed)} 节:{_titles(renewed)}")
        if skipped:
            parts.append(f"{len(skipped)} 节之前已开通、没有重复开:{_titles(skipped)}")
        msg = "兑换成功！" + ";".join(parts)
    return {"success": True, "message": msg, "scope": "phonetic",
            "video_ids": done_ids or None}


async def forget_videos(db: AsyncSession, video_ids: Iterable[int]) -> None:
    """删视频时调(只改不 commit,跟着删视频的事务一起提交)。

    phonetic_videos.id **不带 AUTOINCREMENT**,SQLite 会把删掉的最大 id 发给下一条新视频
    (实测,见 teacher/phonetics 删视频处)。所以:
    - 单节授权行要删 —— 留着的话学生凭旧授权直接看新传的那节;
    - **未使用**码里这一节的明细删掉 —— 否则兑出来开的是新视频;一节都不剩的码改 disabled
      (禁用的同时归还机构额度)。码的 scope 仍是 videos,不会退化成整库码。
    已使用的码不动(兑换凭证,明细里的标题快照还写着当时开的是哪几节)。
    """
    from sqlalchemy import delete as sa_delete, exists
    ids = list(video_ids)
    if not ids:
        return
    await db.execute(sa_delete(PhoneticVideoGrant).where(PhoneticVideoGrant.video_id.in_(ids)))

    affected = list((await db.execute(
        select(PhoneticCodeVideo.code_id).distinct()
        .join(PhoneticCode, PhoneticCode.id == PhoneticCodeVideo.code_id)
        .where(PhoneticCodeVideo.video_id.in_(ids), PhoneticCode.status == "unused")
    )).scalars())
    if not affected:
        return
    await db.execute(sa_delete(PhoneticCodeVideo).where(
        PhoneticCodeVideo.code_id.in_(affected), PhoneticCodeVideo.video_id.in_(ids)))
    await db.execute(
        update(PhoneticCode)
        .where(
            PhoneticCode.id.in_(affected),
            PhoneticCode.status == "unused",
            ~exists().where(PhoneticCodeVideo.code_id == PhoneticCode.id),
        )
        .values(status="disabled")
        .execution_options(synchronize_session=False)
    )


# 一张码最多指定多少节(整套音标课也就几十节;再多直接发整库码)
MAX_CODE_VIDEOS = 200


async def resolve_code_videos(
    db: AsyncSession, user: User, video_ids: Iterable[int]
) -> List[tuple[int, str]]:
    """发「指定几节」码前校验所选视频,返回 [(视频id, 标题)](去重,保持勾选顺序)。

    - 机构只能选**本机构**或**平台预置**的视频(本机构学生看得见的就是这两类);平台 admin 不限。
      PhoneticVideo 的租户过滤对 admin 不加条件、对机构会放行 NULL —— 不押在隐式过滤上,
      skip 掉后显式判(别家视频按 404,不暴露存在性);
    - 下架的不让选(学生兑了也看不到);
    - 平台 admin 混选了**两个机构**的视频 → 400: 学生只属于一个机构,兑换时另一家的那几节
      会让整张码被拒(平台预置的可以和任何一家混选)。
    """
    from fastapi import HTTPException
    ids = list(dict.fromkeys(video_ids))
    if not ids:
        raise HTTPException(status_code=400, detail="请至少选一节视频")
    if len(ids) > MAX_CODE_VIDEOS:
        raise HTTPException(
            status_code=400,
            detail=f"一张码最多指定 {MAX_CODE_VIDEOS} 节,要开全部请选「整个音标视频库」")
    rows = (await db.execute(
        select(PhoneticVideo).where(PhoneticVideo.id.in_(ids))
        .execution_options(skip_tenant_filter=True)
    )).scalars().all()
    by_id = {v.id: v for v in rows}

    def _visible(v: Optional[PhoneticVideo]) -> bool:
        return v is not None and (
            user.role == "admin" or v.org_id is None or v.org_id == user.org_id)

    missing = [i for i in ids if not _visible(by_id.get(i))]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"有 {len(missing)} 节视频不存在或已被删除,请刷新页面后重新选择")
    inactive = [by_id[i].title for i in ids if not by_id[i].is_active]
    if inactive:
        raise HTTPException(
            status_code=400,
            detail=f"{_titles(inactive)}已下架,学生兑了码也看不到。先在「音标视频」里上架,或取消勾选")
    orgs = {by_id[i].org_id for i in ids if by_id[i].org_id is not None}
    if len(orgs) > 1:
        raise HTTPException(
            status_code=400,
            detail="选中的视频来自不同机构。学生只属于一个机构,一张码只能开同一个机构的视频"
                   "(平台预置的可以和任何一家混选),请分开发码")
    return [(i, by_id[i].title) for i in ids]


async def codeable_videos(db: AsyncSession, user: User) -> List[tuple]:
    """发码表单的视频列表: (视频, 所属机构名)。口径同 resolve_code_videos(只列上架的)。"""
    from app.models.organization import Organization
    q = (
        select(PhoneticVideo, Organization.name)
        .outerjoin(Organization, Organization.id == PhoneticVideo.org_id)
        .where(PhoneticVideo.is_active.is_(True))
        .execution_options(skip_tenant_filter=True)
    )
    if user.role != "admin":
        q = q.where(or_(PhoneticVideo.org_id == user.org_id, PhoneticVideo.org_id.is_(None)))
    return list((await db.execute(q)).all())
