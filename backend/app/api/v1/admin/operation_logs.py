"""操作记录(追责)查询 —— 平台 admin 看全部,机构管理员只看本机构

只读:日志没有任何改/删端点(改得动的日志不能拿来追责)。
机构过滤**显式**写 `OperationLog.org_id == current_user.org_id`,不押在 tenancy 隐式过滤器上
(conftest 走 create_all 不注册过滤器,后台任务/脚本也是裸查询,见 CLAUDE.md 多租户须知)。
"""
import json
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.timeutil import local_day_utc_range
from app.api.v1.auth import get_current_admin_or_org_admin
from app.models.user import User
from app.models.audit import OperationLog
from app.services.audit_log import ACTION_LABELS, ACTION_GROUPS, describe_device

router = APIRouter()


def _escape_like(s: str) -> str:
    # LIKE 里 _ 和 % 是通配符(误删学生账号那次的教训),必须转义
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/operation-logs")
async def list_operation_logs(
    actor_id: Optional[int] = Query(None, description="操作人"),
    group: Optional[str] = Query(None, description="动作大类: homework/book/coin/auth"),
    action: Optional[str] = Query(None, description="具体动作,如 homework.delete"),
    keyword: Optional[str] = Query(None, max_length=50, description="按摘要模糊搜索(作业名/学生名)"),
    ip: Optional[str] = Query(None, max_length=64),
    date_from: Optional[date] = Query(None, description="北京日期,含当天"),
    date_to: Optional[date] = Query(None, description="北京日期,含当天"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    conds = []
    if current_user.role != "admin":
        if current_user.org_id is None:
            raise HTTPException(status_code=403, detail="未绑定机构")
        conds.append(OperationLog.org_id == current_user.org_id)
    if actor_id is not None:
        conds.append(OperationLog.actor_id == actor_id)
    if action:
        conds.append(OperationLog.action == action)
    elif group:
        if group not in ACTION_GROUPS:
            raise HTTPException(status_code=400, detail="未知的动作分类")
        conds.append(OperationLog.action.like(f"{group}.%"))
    if keyword and keyword.strip():
        kw = f"%{_escape_like(keyword.strip())}%"
        conds.append(or_(OperationLog.summary.like(kw, escape="\\"),
                         OperationLog.actor_name.like(kw, escape="\\")))
    if ip and ip.strip():
        conds.append(OperationLog.ip == ip.strip())
    if date_from:
        conds.append(OperationLog.created_at >= local_day_utc_range(date_from)[0])
    if date_to:
        conds.append(OperationLog.created_at < local_day_utc_range(date_to)[1])

    total = (await db.execute(select(func.count(OperationLog.id)).where(*conds))).scalar() or 0
    rows = (await db.execute(
        select(OperationLog).where(*conds)
        .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    items = []
    for r in rows:
        try:
            detail = json.loads(r.detail) if r.detail else None
        except ValueError:
            detail = r.detail  # 被截断的超长 detail 解析不了,原样给
        items.append({
            "id": r.id,
            "created_at": r.created_at.isoformat() + "Z" if r.created_at else None,
            "actor_id": r.actor_id,
            "actor_name": r.actor_name,
            "actor_role": r.actor_role,
            "action": r.action,
            "action_label": ACTION_LABELS.get(r.action, r.action),
            "target_type": r.target_type,
            "target_id": r.target_id,
            "summary": r.summary,
            "detail": detail,
            "ip": r.ip,
            "device": describe_device(r.user_agent),
            "user_agent": r.user_agent,
        })

    # 操作人下拉:只列在本范围内留过日志的人(含已删账号,名字取快照)
    actor_conds = [OperationLog.org_id == current_user.org_id] if current_user.role != "admin" else []
    actor_rows = (await db.execute(
        select(OperationLog.actor_id, func.max(OperationLog.actor_name), func.max(OperationLog.actor_role))
        .where(*actor_conds, OperationLog.actor_id.isnot(None))
        .group_by(OperationLog.actor_id)
        .order_by(func.max(OperationLog.created_at).desc())
        .limit(300)
    )).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
        "actors": [{"id": a, "name": n, "role": ro} for a, n, ro in actor_rows],
        "action_labels": ACTION_LABELS,
        "action_groups": ACTION_GROUPS,
    }
