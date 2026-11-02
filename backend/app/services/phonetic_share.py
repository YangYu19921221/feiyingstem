"""音标视频「共享给所有机构」(2026-11-02)

用户问「子机构音标视频不是共享的吗」: 生产 42 节全是直营(org 1)传的,org_id=1 只给直营看,
会泽 / 罗平的学生一节都看不到(罗平的 2 张音标码兑了也是空库)。用户选「加开关,直营老师照样能改」。

规则:
1. 可见 = 本机构的 + 平台预置的(org_id IS NULL)+ 别的机构打开了共享的(shared_all)
2. **改**只认归属: 平台 admin 全能改;机构只能改 org_id == 自己的。别人共享过来的只能看
   (不能改、删、排序、挂讲义)—— 不然一家机构能改掉另一家的课
3. 只有平台 admin 能开关共享(把一家的课给所有机构看是平台的决定)
4. 发「指定几节」码时,共享的视频和平台预置一样能和任何一家的视频混选;学生兑码时也按可见判
5. 兑换码、电教室、次卡这些闸门照旧按**看的学生自己的机构**判 —— 共享只管「看不看得见」,不管「要不要码」

所有判可见的地方都走这里,不在各处另写一遍(漏一处就是要么看不见、要么改得动别人的课)
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import or_

from app.models.phonetic import PhoneticVideo


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
