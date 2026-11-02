"""音标视频共享给所有机构(2026-11-02)

用户先问「子机构音标视频不是共享的吗」: 生产 42 节全是直营(org 1)传的,只给直营看,会泽 / 罗平一节都看不到。
同日用户定:「这个开关设置在管理端 总的管理端音标视频是否共享给别的机构」—— **一个总开关,不按节勾**。

规则:
1. 开关在管理端首页「音标视频共享给所有机构」,存 system_configs.phonetic_share_settings(没有行 = 关 = 和以前一样)。
   只有平台 admin 能改,改了记操作记录 phonetic.share
2. **打开 = 直营(org 1)的视频所有机构都看得到**,包括打开以后直营新传的;关掉 = 别的机构马上看不到。
   开关一动,把直营全部视频的 phonetic_videos.shared_all 一起改成同一个值;直营新传的视频按开关落 shared_all
   —— 查询只认 shared_all 一列(列表、学生端、发码、作业、租户安全网都是它),不用每个查询再去读开关
3. 可见 = 本机构的 + 平台预置的(org_id IS NULL)+ shared_all 的
4. **改**只认归属: 平台 admin 全能改;机构只能改 org_id == 自己的。共享过来的只能看(不能改、删、排序、挂讲义)
5. 发「指定几节」码时,共享的视频和平台预置一样能和任何一家的视频混选;学生兑码 / 布置视频作业也按可见判
6. 兑换码、电教室、次卡这些闸门照旧按**看的学生自己的机构**判 —— 共享只管「看不看得见」,不管「要不要码」
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import DEFAULT_ORG_ID
from app.models.phonetic import PhoneticVideo

SETTINGS_KEY = "phonetic_share_settings"
SHARE_FROM_ORG = DEFAULT_ORG_ID     # 共享谁的视频: 直营


def visible_cond(org_id: int):
    """org_id 这家机构看得见的视频(SQL 条件)。平台 admin(org_id None)别调,它不加条件"""
    return or_(PhoneticVideo.org_id == org_id, PhoneticVideo.org_id.is_(None),
               PhoneticVideo.shared_all.is_(True))


def visible_to(video_org_id: Optional[int], shared: bool, org_id: Optional[int]) -> bool:
    """同一口径的 Python 版。org_id None = 平台 admin / 不限"""
    return org_id is None or video_org_id is None or video_org_id == org_id or bool(shared)


def can_edit(video_org_id: Optional[int], role: str, org_id: Optional[int]) -> bool:
    """改得动吗: 平台 admin 全能改;机构只能改自己机构的(平台预置 / 别人共享的都只读)"""
    return role == "admin" or (video_org_id is not None and video_org_id == org_id)


def mix_org(video_org_id: Optional[int], shared: bool) -> Optional[int]:
    """发码混选时算哪家的: 平台预置和共享的都不算哪家(能和任何一家混)"""
    return None if (video_org_id is None or shared) else video_org_id


async def get_enabled(db: AsyncSession) -> bool:
    from app.models.system_config import SystemConfig
    raw = (await db.execute(select(SystemConfig.config_value).where(
        SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    try:
        data = json.loads(raw) if raw else {}
    except ValueError:
        data = {}
    return isinstance(data, dict) and data.get("enabled") is True


async def shared_for_new(db: AsyncSession, org_id: Optional[int]) -> bool:
    """这家机构新传的视频要不要落 shared_all: 只有直营、且开关开着"""
    return org_id == SHARE_FROM_ORG and await get_enabled(db)


async def set_enabled(db: AsyncSession, enabled: bool) -> int:
    """改开关并把直营全部视频的 shared_all 改成同一个值。返回改了几节。不 commit"""
    from app.models.system_config import SystemConfig
    value = json.dumps({"enabled": bool(enabled)})
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        db.add(SystemConfig(config_key=SETTINGS_KEY, config_value=value, config_type="json",
                            description="直营音标视频是否共享给所有机构"))
    else:
        row.config_value = value
    r = await db.execute(update(PhoneticVideo).where(
        PhoneticVideo.org_id == SHARE_FROM_ORG, PhoneticVideo.shared_all.is_(not enabled))
        .values(shared_all=bool(enabled)).execution_options(synchronize_session=False))
    await db.flush()
    return r.rowcount or 0


async def status(db: AsyncSession) -> dict:
    from sqlalchemy import func
    from app.models.organization import Organization
    enabled = await get_enabled(db)
    from sqlalchemy import case
    total, active = (await db.execute(select(
        func.count(), func.coalesce(func.sum(case((PhoneticVideo.is_active.is_(True), 1), else_=0)), 0)).where(
        PhoneticVideo.org_id == SHARE_FROM_ORG))).one()
    orgs = (await db.execute(select(func.count()).select_from(Organization).where(
        Organization.id != SHARE_FROM_ORG, Organization.status == "active"))).scalar() or 0
    return {"enabled": enabled, "videos": int(total or 0), "active_videos": int(active or 0), "other_orgs": int(orgs)}
