"""操作日志写入与展示 —— 唯一真源

写入方式: `record(...)` 只 `db.add`,**不 commit**,由业务端点自己的 commit 一起提交。
这样日志与业务同一事务:业务回滚了日志也不留(不会出现「日志说删了、其实没删」),
业务成功了日志一定在。所以调用点必须放在业务 `await db.commit()` **之前**。

设备描述(describe_device)也放在这里,查询端与将来其它展示处共用一份解析,
别在前端再写一套 UA 判断。
"""
import json
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import OperationLog
from app.models.user import User

# 动作 → 中文名。前端筛选下拉与列表标签都从查询接口拿这份,不在前端维护副本
ACTION_LABELS: dict[str, str] = {
    "auth.login": "登录",
    "homework.create": "布置作业",
    "homework.close": "关闭作业",
    "homework.reopen": "重新开放作业",
    "homework.delete": "删除作业",
    "book.assign": "分配单词本",
    "book.unassign": "取消分配",
    "coin.adjust": "手动加减币",
    "coin.tx_update": "修改金币流水",
    "coin.tx_delete": "删除金币流水",
    "coin.redeem": "兑换商品",
    "coin.redeem_approve": "同意兑换申请",
    "coin.redeem_reject": "拒绝兑换申请",
    "coin.mode": "切换金币模式",
}

# 筛选用的大类(按 action 前缀)
ACTION_GROUPS: dict[str, str] = {
    "homework": "作业",
    "book": "单词本分配",
    "coin": "金币",
    "auth": "登录",
}

_MAX_DETAIL = 20000  # detail JSON 上限:被删作业的学生名单可能很长,截断防止单行过大


def client_ip(request: Optional[Request]) -> Optional[str]:
    """真实客户端 IP。生产经 nginx 反代,request.client 恒为 127.0.0.1,
    必须先读 X-Real-IP(vhost 里 proxy_set_header X-Real-IP $remote_addr)。"""
    if request is None:
        return None
    h = request.headers
    ip = h.get("x-real-ip")
    if not ip:
        xff = h.get("x-forwarded-for")
        if xff:
            ip = xff.split(",")[0]
    if not ip and request.client:
        ip = request.client.host
    return (ip or "").strip()[:64] or None


def describe_device(ua: Optional[str]) -> str:
    """把 User-Agent 压成「iPhone · 微信」这种一眼能认的描述。
    判断顺序有讲究: iPad 的 UA 也含 Mac OS X、Edge 的 UA 也含 Chrome,先判特殊的。"""
    if not ua:
        return "未知设备"
    u = ua.lower()
    if "ipad" in u:
        os_name = "iPad"
    elif "iphone" in u:
        os_name = "iPhone"
    elif "android" in u:
        os_name = "安卓"
    elif "windows" in u:
        os_name = "Windows 电脑"
    elif "mac os x" in u or "macintosh" in u:
        os_name = "Mac 电脑"
    elif "linux" in u:
        os_name = "Linux"
    else:
        os_name = "其它设备"
    if "micromessenger" in u:
        browser = "微信"
    elif "edg/" in u:
        browser = "Edge"
    elif "firefox" in u:
        browser = "Firefox"
    elif "chrome" in u or "crios" in u:
        browser = "Chrome"
    elif "safari" in u:
        browser = "Safari"
    else:
        browser = "浏览器"
    return f"{os_name} · {browser}"


def record(
    db: AsyncSession,
    request: Optional[Request],
    actor: User,
    action: str,
    summary: str,
    *,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    detail: Optional[Any] = None,
) -> None:
    """记一条操作日志(只 add 不 commit,见模块说明)。"""
    detail_text = None
    if detail is not None:
        detail_text = json.dumps(detail, ensure_ascii=False, default=str)
        if len(detail_text) > _MAX_DETAIL:
            detail_text = detail_text[:_MAX_DETAIL] + "…(已截断)"
    ua = request.headers.get("user-agent") if request is not None else None
    db.add(OperationLog(
        org_id=actor.org_id,
        actor_id=actor.id,
        actor_name=(actor.full_name or actor.username or "")[:100] or None,
        actor_role=actor.role,
        action=action,
        target_type=target_type,
        target_id=target_id,
        summary=summary[:500],
        detail=detail_text,
        ip=client_ip(request),
        user_agent=(ua or "")[:300] or None,
    ))
