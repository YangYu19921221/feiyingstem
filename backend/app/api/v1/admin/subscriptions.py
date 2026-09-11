"""
管理员兑换码管理API
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import (
    User, RedemptionCode, RedemptionCodeBook, RedemptionCodeStatus,
)
from app.models.word import WordBook, BookStage
from app.api.v1.auth import get_current_admin_or_org_admin
from app.schemas.subscription import (
    RedemptionCodeGenerate,
    RedemptionCodeResponse,
    RedemptionCodeListResponse,
    SubscriptionStatsResponse,
)
from app.services import subscription_service, book_stage

router = APIRouter()


@router.get("/book-groups")
async def list_book_groups(
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """发码表单用的「分组 → 学段 → 书」三级目录。

    多租户由 tenancy 过滤器自动罩住(WordBook 是 shared_nullable 锚点:
    机构看到平台共享 + 自建,平台 admin 看全部),这里不手写 org 条件。

    ## 学段口径(2026-09-11 改)

    以前是从 `grade_level` **现算**的(services/book_stage.stage_of),而教师端
    单词本页另写了一份规则,两边对不上: 同一批书教师端显示「大学」分组、
    这里归进「其他」。现在改为读 `word_books.stage_id` → `book_stages` 表,
    **与教师端二级分组同一个真源**,机构自建的学段(大学/成人/…)两边都认。

    `stage_id` 为空的书归 `unassigned`(界面「未分类」)且**可以正常发码** ——
    生产有课外书/总复习/校本教材本来就没有学段,不能因为分类空着就发不出卡。
    兼容: 老码上留痕的 `scope_stage` 仍是 primary/junior/senior 那套 code,
    所以预置档的 key 继续用 code,机构自建档用 `custom:{id}`。
    """
    rows = (await db.execute(
        select(WordBook.id, WordBook.name, WordBook.series,
               WordBook.grade_level, WordBook.stage_id)
        .order_by(WordBook.series, WordBook.grade_level, WordBook.name)
    )).all()

    # 学段表(平台预置 + 本机构自建,经 tenancy 过滤) → 供 key/名称/排序
    stage_rows = (await db.execute(
        select(BookStage).order_by(BookStage.sort_order, BookStage.id)
    )).scalars().all()
    # key: 预置档用 code(与老码的 scope_stage 对齐),自建档用 custom:{id}
    stage_key = {s.id: (s.code or f"custom:{s.id}") for s in stage_rows}
    stage_name = {stage_key[s.id]: s.name for s in stage_rows}
    stage_rank = {stage_key[s.id]: i for i, s in enumerate(stage_rows)}
    UNASSIGNED = "unassigned"
    stage_name[UNASSIGNED] = "未分类"
    stage_rank[UNASSIGNED] = len(stage_rows)   # 未分类恒排最后

    # series → stage → books
    by_series: dict[str, dict[str, list]] = {}
    for r in rows:
        series = r.series or ""      # 空串代表「未分组」,前端显示成"未分组"
        stage = stage_key.get(r.stage_id, UNASSIGNED) if r.stage_id else UNASSIGNED
        by_series.setdefault(series, {}).setdefault(stage, []).append({
            "id": r.id, "name": r.name, "grade_level": r.grade_level,
        })

    out = []
    for series in sorted(by_series, key=lambda s: (s == "", s)):
        stages = by_series[series]
        out.append({
            "series": series,
            "series_label": series or "未分组",
            "total": sum(len(v) for v in stages.values()),
            "stages": [
                {
                    "stage": st,
                    "label": stage_name.get(st, st),
                    "count": len(stages[st]),
                    "books": stages[st],
                }
                # 按 book_stages.sort_order 排,未分类恒最后。
                # 不再用 book_stage.STAGE_ORDER —— 那是写死的三档,
                # 机构自建的学段会被它整个过滤掉(书凭空消失,发不出卡)
                for st in sorted(stages, key=lambda k: stage_rank.get(k, 999))
            ],
        })
    return {"groups": out}


@router.get("/card-policy")
async def card_policy(
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """当前身份能发什么卡(卡种白名单 + 时长上限)。

    前端发码表单照这份结果画选项,**别在前端写死 180** —— 两处各写一份,
    改上限时必然漂移成"界面让你选、后端 403"。判定真源在
    services/subscription_service.card_policy_for。
    """
    return subscription_service.card_policy_for(current_user.role)


@router.post("/generate", response_model=list[RedemptionCodeResponse])
async def generate_codes(
    req: RedemptionCodeGenerate,
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量生成兑换码(支持一码多书)。

    机构管理员两道闸门:
    1. **发码总量**与学生配额对等——累计已发(未禁用)不得超过 student_quota,
       防止用兑换码绕过名额;删除/禁用的码归还额度。平台 admin 不限。
       配额按**码张数**计,不按 码×书数 —— 一张卡开几本书是权益厚度,不是名额。
    2. **卡种与时长**(2026-09-11):只能发包月卡、最长半年(180 天),从学生兑换
       那天算起;永久卡/次卡一律拒(它们都能绕开这个上限,见 guard_card_policy)。
    """
    # 卡种/时长闸门:纯判断不查库,放最前面(选错卡种时不必先等书本校验)
    subscription_service.guard_card_policy(
        current_user.role, req.grant_type, req.grant_days, req.grant_times,
    )

    # 目标书集合:book_ids 优先,单 book_id 是旧调用形态
    want_ids = list(dict.fromkeys(req.book_ids or ([req.book_id] if req.book_id else [])))
    if not want_ids:
        raise HTTPException(status_code=400, detail="请至少选择一本单词本")

    # 逐本校验存在且**当前身份可见**(经 tenancy 过滤,org_admin 拿不到别家的书);
    # 用一条 IN 查询,不要按 id 循环 db.get —— 200 本会发 200 条 SQL
    found = (await db.execute(
        select(WordBook.id, WordBook.name).where(WordBook.id.in_(want_ids))
    )).all()
    name_by_id = {r.id: r.name for r in found}
    missing = [i for i in want_ids if i not in name_by_id]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"以下单词本不存在或无权使用: {missing}",
        )

    if current_user.role == "org_admin":
        from app.services import org_service
        st = await org_service.card_quota_status(db, current_user.org_id)
        if st["cards_used"] + req.count > st["card_quota"]:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"学习卡额度不足: 已发 {st['cards_used']}/{st['card_quota']} 张，"
                    f"剩 {st['cards_left']} 张，本次申请 {req.count} 张。"
                    f"请联系平台续卡（{st['renewal_min']} 张起，无需另签合同）；"
                    "生成错的批次可以删掉，额度会退回来。"
                ),
            )

    codes = await subscription_service.batch_generate_codes(
        db=db,
        admin_id=current_user.id,
        count=req.count,
        book_ids=want_ids,
        batch_note=req.batch_note,
        grant_type=req.grant_type,
        grant_days=req.grant_days,
        grant_times=req.grant_times,
        scope_series=req.scope_series,
        scope_stage=req.scope_stage,
    )

    books_payload = [{"id": i, "name": name_by_id[i]} for i in want_ids]
    result = []
    for code in codes:
        code_dict = {
            "id": code.id,
            "code": code.code,
            "book_id": code.book_id,
            "book_name": name_by_id.get(code.book_id),
            "status": code.status,
            "created_by": code.created_by,
            "created_by_name": current_user.full_name or current_user.username,
            "created_at": code.created_at,
            "code_expires_at": code.code_expires_at,
            "used_by": code.used_by,
            "used_at": code.used_at,
            "batch_note": code.batch_note,
            "grant_type": code.grant_type or "permanent",
            "grant_days": code.grant_days,
            "grant_times": code.grant_times,
            "scope_kind": code.scope_kind or "book",
            "scope_series": code.scope_series,
            "scope_stage": code.scope_stage,
            "book_count": len(want_ids),
            "books": books_payload,
        }
        result.append(code_dict)
    return result


@router.get("/codes", response_model=RedemptionCodeListResponse)
async def list_codes(
    status: Optional[str] = Query(None, description="按状态筛选"),
    search: Optional[str] = Query(None, description="搜索兑换码或批次备注"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """兑换码列表（分页+筛选+搜索;机构管理员只见本机构发的码）"""
    query = select(RedemptionCode)
    count_query = select(func.count(RedemptionCode.id))

    if current_user.role == "org_admin":
        org_users = select(User.id).where(User.org_id == current_user.org_id)
        query = query.where(RedemptionCode.created_by.in_(org_users))
        count_query = count_query.where(RedemptionCode.created_by.in_(org_users))

    if status:
        query = query.where(RedemptionCode.status == status)
        count_query = count_query.where(RedemptionCode.status == status)

    if search and search.strip():
        # 码是 XXXX-XXXX-XXXX-XXXX,老师手里常是抄下来的片段,所以按片段模糊匹配;
        # 顺带搜批次备注,便于按"某某班春季"整批捞出来。
        # LIKE 的 _ 和 % 是通配符,必须转义——否则搜 "_" 会命中全部
        # (曾用 like('__t_%') 误删过两个真实学生账号)
        kw = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{kw}%"
        cond = or_(
            RedemptionCode.code.ilike(pattern, escape="\\"),
            RedemptionCode.batch_note.ilike(pattern, escape="\\"),
        )
        query = query.where(cond)
        count_query = count_query.where(cond)

    query = query.order_by(RedemptionCode.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    codes = result.scalars().all()

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 收集所有涉及的 book_id，批量查询 book_name
    book_ids = set(c.book_id for c in codes)
    book_name_map = {}
    if book_ids:
        books_result = await db.execute(
            select(WordBook).where(WordBook.id.in_(book_ids))
        )
        for book in books_result.scalars().all():
            book_name_map[book.id] = book.name

    # 批量查发码人姓名(N+1 会让每页多打 20 次库)。
    # 跨机构读取: org_admin 的租户过滤会把平台 admin 的行滤掉,导致平台发的码
    # 显示不出创建人,所以这里显式跳过过滤——只读姓名,不涉及越权写。
    creator_ids = set(c.created_by for c in codes)
    creator_name_map = {}
    if creator_ids:
        creators = await db.execute(
            select(User.id, User.full_name, User.username)
            .where(User.id.in_(creator_ids))
            .execution_options(skip_tenant_filter=True)
        )
        for uid, full_name, username in creators.all():
            creator_name_map[uid] = full_name or username

    # 一码多书: 一次查出本页所有码的书明细(按 code_id 分组),不要按码循环发 SQL。
    # 存量单书码已由启动迁移回填明细表,所以这里对新旧码同构;
    # 万一某行没回填成(老库迁移失败),下面用 book_id 兜底。
    detail_rows = []
    if codes:
        detail_rows = (await db.execute(
            select(RedemptionCodeBook.code_id, RedemptionCodeBook.book_id)
            .where(RedemptionCodeBook.code_id.in_([c.id for c in codes]))
        )).all()
    books_by_code: dict[int, list[int]] = {}
    for cid, bid in detail_rows:
        books_by_code.setdefault(cid, []).append(bid)

    # 明细里的书名也要一并解析(多书码的书不止 code.book_id 那一本)
    all_book_ids = set(book_ids) | {b for v in books_by_code.values() for b in v}
    if all_book_ids - set(book_name_map):
        more = await db.execute(
            select(WordBook.id, WordBook.name)
            .where(WordBook.id.in_(all_book_ids - set(book_name_map)))
        )
        for bid, bname in more.all():
            book_name_map[bid] = bname

    # 构造响应，添加 book_name
    code_responses = []
    for code in codes:
        bids = books_by_code.get(code.id) or ([code.book_id] if code.book_id else [])
        code_responses.append(RedemptionCodeResponse(
            id=code.id,
            code=code.code,
            book_id=code.book_id,
            book_name=book_name_map.get(code.book_id, "未知"),
            status=code.status,
            created_by=code.created_by,
            created_by_name=creator_name_map.get(code.created_by),
            created_at=code.created_at,
            code_expires_at=code.code_expires_at,
            used_by=code.used_by,
            used_at=code.used_at,
            batch_note=code.batch_note,
            grant_type=code.grant_type or "permanent",
            grant_days=code.grant_days,
            grant_times=code.grant_times,
            scope_kind=code.scope_kind or "book",
            scope_series=code.scope_series,
            scope_stage=code.scope_stage,
            book_count=len(bids),
            # 只回前 8 本:一张卡可能开 200 本,整列表全塞会把响应撑大;
            # 前端显示"共 N 本"+展开看前几本足够核对
            books=[{"id": b, "name": book_name_map.get(b, "未知")} for b in bids[:8]],
        ))

    return RedemptionCodeListResponse(total=total, codes=code_responses)


@router.get("/stats", response_model=SubscriptionStatsResponse)
async def subscription_stats(
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """兑换码统计(机构管理员只统计本机构发的码)"""
    base_cond = []
    if current_user.role == "org_admin":
        org_users = select(User.id).where(User.org_id == current_user.org_id)
        base_cond.append(RedemptionCode.created_by.in_(org_users))

    def _q(*conds):
        stmt = select(func.count(RedemptionCode.id))
        for c in [*base_cond, *conds]:
            stmt = stmt.where(c)
        return stmt

    total_q = await db.execute(_q())
    total = total_q.scalar() or 0

    unused_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.UNUSED))
    unused = unused_q.scalar() or 0

    used_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.USED))
    used = used_q.scalar() or 0

    expired_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.EXPIRED))
    expired_codes = expired_q.scalar() or 0

    disabled_q = await db.execute(_q(RedemptionCode.status == RedemptionCodeStatus.DISABLED))
    disabled = disabled_q.scalar() or 0

    # 卡额度水位:与发码闸门同源(org_service),否则会出现
    # 「界面说还剩 5 张、点生成说额度不足」。平台 admin 不限额,不下发这组字段。
    cards = None
    if current_user.role == "org_admin":
        from app.services import org_service
        cards = await org_service.card_quota_status(db, current_user.org_id)

    return SubscriptionStatsResponse(
        total_codes=total,
        unused_codes=unused,
        used_codes=used,
        expired_codes=expired_codes,
        disabled_codes=disabled,
        **(cards or {}),
    )


@router.post("/codes/{code_id}/disable")
async def disable_code(
    code_id: int,
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """禁用兑换码"""
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.id == code_id)
    )
    code = result.scalar_one_or_none()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    # 机构管理员只能操作本机构发的码(按不存在处理,不泄露)
    if current_user.role == "org_admin":
        creator_org = (await db.execute(
            select(User.org_id).where(User.id == code.created_by)
        )).scalar()
        if creator_org != current_user.org_id:
            raise HTTPException(status_code=404, detail="兑换码不存在")

    if code.status == RedemptionCodeStatus.USED:
        raise HTTPException(status_code=400, detail="已使用的兑换码无法禁用")

    code.status = RedemptionCodeStatus.DISABLED
    await db.commit()
    return {"message": "兑换码已禁用"}


@router.delete("/codes/{code_id}")
async def delete_code(
    code_id: int,
    current_user: User = Depends(get_current_admin_or_org_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除兑换码(彻底删行,不可恢复)。

    与"禁用"的区别:禁用留痕、码还在列表里;删除是清理生成错的批次,列表里不再出现。
    **已使用的码一律不许删**——它是学生兑换过某本书的凭证,删了就查不到这本书是怎么来的,
    出纠纷时无据可依。要停用已使用的码没有意义(书已发出),只能走禁用。
    """
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.id == code_id)
    )
    code = result.scalar_one_or_none()
    if not code:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    # 机构管理员只能操作本机构发的码(按不存在处理,不泄露别家数据)
    if current_user.role == "org_admin":
        creator_org = (await db.execute(
            select(User.org_id).where(User.id == code.created_by)
        )).scalar()
        if creator_org != current_user.org_id:
            raise HTTPException(status_code=404, detail="兑换码不存在")

    if code.status == RedemptionCodeStatus.USED:
        raise HTTPException(
            status_code=400,
            detail="已使用的兑换码不能删除(需保留兑换记录),如需停用请改为禁用",
        )

    await db.delete(code)
    await db.commit()
    return {"message": "兑换码已删除"}
