"""多租户上下文与全局过滤安全网

设计(见 docs/多租户SaaS设计方案.md §3):
- current_org_id: 请求级 ContextVar,认证时由 auth._authenticate_token 设置;
  平台 admin 设 None(不过滤,跨租户)。
- 全局过滤器: do_orm_execute 事件对锚点模型自动注入 org_id 条件,
  即使某接口忘了手写过滤,默认也漏不出去。
- P1 观察模式: settings.TENANCY_ENFORCE=False 时过滤器不注入(现网零行为变化),
  P2 验收通过后置 True 开启强制隔离。
"""
import time
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import event, or_, text
from sqlalchemy.orm import Session, with_loader_criteria

from app.core.config import settings

# 当前请求的机构ID。None = 平台admin/系统任务,不过滤
current_org_id: ContextVar = ContextVar("current_org_id", default=None)

# 锚点模型注册表: [(model, shared_nullable)]
# shared_nullable=True 的内容表准入为「本机构 OR org_id IS NULL(平台共享库)」
TENANT_MODELS: list = []


def register_tenant_models():
    """注册需要自动过滤的锚点模型(延迟导入避免循环依赖),init_db 时调用"""
    from app.models.user import User, Class
    from app.models.word import WordBook
    from app.models.sentence import SentenceBook
    from app.models.reading import ReadingPassage
    from app.models.competition import CompetitionQuestionSet, LeaderboardSnapshot
    from app.models.assessment import AssessmentLead
    from app.models.pk import PkRoom

    TENANT_MODELS.clear()
    TENANT_MODELS.extend([
        (User, False),
        (Class, False),
        (PkRoom, False),
        (AssessmentLead, False),
        (LeaderboardSnapshot, False),
        (WordBook, True),
        (SentenceBook, True),
        (ReadingPassage, True),
        (CompetitionQuestionSet, True),
    ])


@event.listens_for(Session, "do_orm_execute")
def _tenant_filter(execute_state):
    """全局安全网:对 SELECT 自动注入 org 过滤(TENANCY_ENFORCE 开启后生效)"""
    if not settings.TENANCY_ENFORCE:
        return
    if (not execute_state.is_select
            or execute_state.is_column_load
            or execute_state.is_relationship_load):
        return
    # 逃生口: 需要跨机构读取的场景(如学生入班时读取他机构班级做归属判定)
    # 显式 .execution_options(skip_tenant_filter=True) 跳过
    if execute_state.execution_options.get("skip_tenant_filter"):
        return
    org_id = current_org_id.get()
    if org_id is None:
        return  # 平台admin/系统任务不过滤

    for model, shared in TENANT_MODELS:
        if shared:
            crit = with_loader_criteria(
                model,
                lambda cls: or_(cls.org_id == org_id, cls.org_id.is_(None)),
                include_aliases=True,
            )
        else:
            crit = with_loader_criteria(
                model,
                lambda cls: cls.org_id == org_id,
                include_aliases=True,
            )
        execute_state.statement = execute_state.statement.options(crit)


@dataclass
class OrgContext:
    """请求级机构上下文,经 auth.get_org_context 依赖注入"""
    org_id: int
    is_platform_admin: bool = False


# 机构状态进程内缓存: {org_id: (过期时间戳, is_active)},5分钟TTL
_org_cache: dict = {}
_ORG_CACHE_TTL = 300


async def check_org_active(db, org_id: int) -> bool:
    """机构是否可用(status=active),带进程内缓存"""
    now = time.time()
    hit = _org_cache.get(org_id)
    if hit and hit[0] > now:
        return hit[1]
    row = (await db.execute(
        text("SELECT status FROM organizations WHERE id = :i"), {"i": org_id}
    )).first()
    active = bool(row and row[0] == "active")
    _org_cache[org_id] = (now + _ORG_CACHE_TTL, active)
    return active


def invalidate_org_cache(org_id: int | None = None):
    """机构状态变更(停用/续费)后调用,立即生效"""
    if org_id is None:
        _org_cache.clear()
    else:
        _org_cache.pop(org_id, None)
