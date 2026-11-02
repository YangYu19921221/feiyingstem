"""直营音标视频给哪些机构看(2026-11-02)

用户先问「子机构音标视频不是共享的吗」: 生产 42 节全是直营(org 1)传的,只给直营看,会泽 / 罗平一节都看不到。
同日用户定:「不应该是选择那些机构可以看那些不可以看吗 默认是打开 然后非直营机构教师端不能上传视频」。

规则:
1. **按机构开关**: organizations.phonetic_hq_videos(默认 1 = 能看;存量机构加列时就是 1,新机构也是 1)。
   平台管理员在管理端首页「直营音标视频给哪些机构看」逐个开关,改了记操作记录 phonetic.share
2. 能看的机构 = 直营的全部视频都看得到(包括以后直营新传的);关了的机构一节都看不到
3. 可见 = 本机构的 + 平台预置的(org_id IS NULL)+ 直营的(本机构开着时)。判断在 SQL 里现查机构那一列,
   不进进程缓存 —— 改了马上生效,多进程也不用通知
4. **改**只认归属: 平台 admin 全能改;机构只能改 org_id == 自己的。直营的视频别的机构只能看(不能改、删、排序、挂讲义)
5. **只有直营老师和平台管理员能上传音标视频**(can_upload)。分校老师的上传入口不给,接口 403
6. 发「指定几节」码时,直营的视频和平台预置一样能和任何一家的视频混选;学生兑码 / 布置视频作业也按可见判
7. 兑换码、电教室、次卡这些闸门照旧按**看的学生自己的机构**判 —— 这里只管「看不看得见」,不管「要不要码」

所有判可见的地方都走这里(租户安全网 core/tenancy._criteria_for 也调 visible_cond),不在各处另写一遍
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import DEFAULT_ORG_ID
from app.models.phonetic import PhoneticVideo

HQ_ORG_ID = DEFAULT_ORG_ID      # 直营


def _hq_on(org_id: int):
    """这家机构开着「看直营的音标视频」吗(SQL 标量子查询)"""
    from app.models.organization import Organization
    return select(Organization.phonetic_hq_videos).where(Organization.id == org_id).scalar_subquery().is_(True)


def visible_cond_for(model, org_id: int):
    """model(PhoneticVideo / PhoneticMaterial,课件的 org_id 跟父视频)对 org_id 这家机构可见的 SQL 条件。
    平台 admin(org_id None)别调,它不加条件"""
    return or_(model.org_id == org_id, model.org_id.is_(None),
               and_(model.org_id == HQ_ORG_ID, _hq_on(org_id)))


def visible_cond(org_id: int):
    return visible_cond_for(PhoneticVideo, org_id)


async def hq_visible(db: AsyncSession, org_id: Optional[int]) -> bool:
    if org_id is None or org_id == HQ_ORG_ID:
        return True
    from app.models.organization import Organization
    v = (await db.execute(select(Organization.phonetic_hq_videos).where(Organization.id == org_id))).scalar_one_or_none()
    return bool(v)


async def visible_to(db: AsyncSession, video_org_id: Optional[int], org_id: Optional[int]) -> bool:
    """同一口径的 Python 版。org_id None = 平台 admin / 不限"""
    if org_id is None or video_org_id is None or video_org_id == org_id:
        return True
    return video_org_id == HQ_ORG_ID and await hq_visible(db, org_id)


def can_edit(video_org_id: Optional[int], role: str, org_id: Optional[int]) -> bool:
    """改得动吗: 平台 admin 全能改;机构只能改自己机构的(平台预置 / 直营给的都只读)"""
    return role == "admin" or (video_org_id is not None and video_org_id == org_id)


def can_upload(role: str, org_id: Optional[int]) -> bool:
    """能上传音标视频吗: 只有直营老师和平台管理员(用户 11-02「非直营机构教师端不能上传视频」)"""
    return role == "admin" or org_id == HQ_ORG_ID


def mix_org(video_org_id: Optional[int]) -> Optional[int]:
    """发码混选时算哪家的: 平台预置和直营的都不算哪家(能和任何一家混)"""
    return None if (video_org_id is None or video_org_id == HQ_ORG_ID) else video_org_id


async def org_list(db: AsyncSession) -> dict:
    """管理端卡片: 直营几节 + 每个别的机构开没开"""
    from sqlalchemy import case, func
    from app.models.organization import Organization
    from app.models.user import User
    total, active = (await db.execute(select(
        func.count(), func.coalesce(func.sum(case((PhoneticVideo.is_active.is_(True), 1), else_=0)), 0)).where(
        PhoneticVideo.org_id == HQ_ORG_ID))).one()
    students = dict((await db.execute(
        select(User.org_id, func.count()).where(User.role == "student", User.is_active.is_(True))
        .group_by(User.org_id).execution_options(skip_tenant_filter=True))).all())
    orgs = (await db.execute(select(Organization.id, Organization.name, Organization.status,
                                    Organization.phonetic_hq_videos)
                             .where(Organization.id != HQ_ORG_ID).order_by(Organization.id))).all()
    return {
        "hq_videos": int(total or 0), "hq_active_videos": int(active or 0),
        "orgs": [{"id": i, "name": n, "status": s, "enabled": bool(e), "students": int(students.get(i, 0))}
                 for i, n, s, e in orgs],
    }
