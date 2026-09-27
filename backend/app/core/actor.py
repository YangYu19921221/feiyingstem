"""助教账号的「真实操作人」(2026-09-27)

助教登录后,认证层把 current_user 换成主老师 —— 看数据、改数据都按主老师的范围走,
全站几十处 `Class.teacher_id == current_user.id` 不用逐个改。但「是谁干的」不能丢:
真实账号放在这里,操作日志、作业布置人、改密码/金币密码这些「只属于本人」的动作读它。

ContextVar 是请求级的(每个请求一份上下文),认证时每次都显式重设,不会串到别的请求。
"""
from contextvars import ContextVar
from typing import Optional

from fastapi import HTTPException

real_actor: ContextVar = ContextVar("real_actor", default=None)


def acting_user(user):
    """当前请求真正在操作的人:助教请求返回助教本人,其余原样返回 user。
    只在 ContextVar 里的助教确实挂在 user 名下时才替换(防御性,不信任残留值)。"""
    ra = real_actor.get()
    if ra is not None and user is not None and getattr(ra, "owner_teacher_id", None) == user.id:
        return ra
    return user


def is_assistant_request(user) -> bool:
    return acting_user(user) is not user


def forbid_assistant(user, what: str) -> None:
    """助教不能做的事(删班级/移出学生/管理助教),统一 403 + 人话提示。"""
    if is_assistant_request(user):
        raise HTTPException(status_code=403, detail=f"助教账号不能{what},请让主老师操作")


async def owner_for_ws(db, user):
    """自建鉴权的 WS 路径(PK/直播)也要做同样的换身份:
    助教在 REST 上建的房间/开的课归主老师,WS 若按助教本人判归属就进不去自己刚建的房。
    主老师不可用时返回 None(调用方按鉴权失败处理)。"""
    if user is None or not getattr(user, "owner_teacher_id", None):
        return user
    from sqlalchemy import select
    from app.models.user import User
    owner = (await db.execute(
        select(User).where(User.id == user.owner_teacher_id)
        .execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    if (owner is None or not owner.is_active or owner.role != "teacher"
            or owner.owner_teacher_id or owner.org_id != user.org_id):
        return None
    real_actor.set(user)
    return owner
