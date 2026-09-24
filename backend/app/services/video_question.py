"""音标视频提问的可见性与计数 —— 唯一口径

判「谁能看到这条提问」的规则有三处消费方(学生端问答列表、教师端待回答列表、
教师端红点计数),所以在**第一个消费方之前**就收在这里。
理由见 services/video_watch 的文件头(学习时长那件事:五份手写聚合 → 同一个
学生在五个界面看到五个数字,最大差 250 倍)。

## 可见性规则(一句话)

学生看得到:**我自己问的**(不管公开与否、回答没回答)+ 这节课下面**被老师
设为公开的**。两者都排除 `is_hidden`。
老师看得到:本机构的全部(含 hidden —— 他要能看到自己隐藏了什么)。

⚠️ `is_public` 单独存在的意义: 没有它就只有两个极端 —— 要么所有提问互相可见
(等于开了讨论区,审核责任和冷启动问题全来了),要么永远只有师生两人看得见
(同一个问题老师要答很多遍)。公开是**老师的动作**,所以这个字段只有老师能改。

## org_id 为什么显式存而不是从视频推导

平台预置视频的 `org_id` 是 NULL(全平台可见)。若按视频推导归属,A 机构学生
在预置视频下的公开提问会被 B 机构学生看到 —— 泄露的是**姓名 + 原话**。
所以提问行自带 org_id(落库时取提问者的),所有查询按它收口。
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

# 提问正文上限。宽进严出:前端也限这个数,后端**截断而不是回 422** ——
# 孩子打了一长段被英文报错弹回来,大概率就不问了
MAX_CONTENT_LEN = 500
# 回答上限。比提问宽 —— 回答里常要写几个例词加读法说明
MAX_ANSWER_LEN = 2000


def clean_text(raw: Optional[str], limit: int) -> str:
    """提问/回答正文归一:削首尾空白 + 截断。

    **纯空白归成空串**(而不是原样保留): 全是空格的提问在列表里是一行空白,
    老师点进去不知道要回答什么。调用方据此判 400。
    """
    if not raw:
        return ""
    return raw.strip()[:limit]


def scope_org(q, org_id: Optional[int]):
    """按机构收口。org_id 为 None(平台 admin)不加条件,与本项目既有口径一致。

    ⚠️ 这里**不能**写成 `or_(org_id == 我的, org_id.is_(None))` —— 那是**内容表**
    (视频/单词本)的口径,NULL 在那儿表示"平台共享内容"。提问是**用户产生的数据**,
    org_id 为 NULL 只可能是脏数据,放进可见范围就是让各机构互相看到对方学生的提问。
    """
    if org_id is None:
        return q
    from app.models.phonetic import PhoneticVideoQuestion as M
    return q.where(M.org_id == org_id)


def student_visible(q, video_id: int, user_id: int, org_id: Optional[int]):
    """学生端可见的提问(见模块头的可见性规则)"""
    from app.models.phonetic import PhoneticVideoQuestion as M
    q = q.where(
        M.video_id == video_id,
        M.is_hidden.is_(False),
        or_(M.user_id == user_id, M.is_public.is_(True)),
    )
    return scope_org(q, org_id)


async def pending_count(db: AsyncSession, org_id: Optional[int]) -> int:
    """本机构「待回答」的提问数 —— 教师端红点。

    判据是 `answered_at IS NULL` 而不是 `answer IS NULL`: 老师可能回了空串,
    而"回答过"这个事实要以时间戳为准(两个字段一起判会让那条永远挂在待回答里)。
    隐藏的不算 —— 老师隐藏它就是已经处理过了。
    """
    from app.models.phonetic import PhoneticVideoQuestion as M
    stmt = select(func.count(M.id)).where(
        M.answered_at.is_(None), M.is_hidden.is_(False)
    )
    return int((await db.execute(scope_org(stmt, org_id))).scalar() or 0)


async def counts_for_videos(
    db: AsyncSession, video_ids: list[int], org_id: Optional[int]
) -> dict[int, tuple[int, int]]:
    """每个视频的 (提问数, 待回答数)。**一次 group_by,别按行 N 次查** ——
    教师端列表一页 10 个视频,按行查就是 10 趟往返(讲义数那次已经踩过)。
    """
    out: dict[int, tuple[int, int]] = {vid: (0, 0) for vid in video_ids}
    if not video_ids:
        return out
    from app.models.phonetic import PhoneticVideoQuestion as M
    stmt = (
        select(
            M.video_id,
            func.count(M.id),
            func.coalesce(func.sum(case((M.answered_at.is_(None), 1), else_=0)), 0),
        )
        .where(M.video_id.in_(video_ids), M.is_hidden.is_(False))
        .group_by(M.video_id)
    )
    for vid, total, pending in (await db.execute(scope_org(stmt, org_id))).all():
        out[vid] = (int(total or 0), int(pending or 0))
    return out


async def my_answered_count(db: AsyncSession, user_id: int) -> int:
    """「老师回了我的问题」的条数 —— 学生端红点。

    **只数自己的**: 公开问答里的回答不是"回我的",拿它提醒会让孩子点进去
    找不到自己那条,而这个红点的唯一意义就是"有人回了你"。
    不按 org 收口 —— 按 user_id 取本来就只有我自己的行。
    """
    from app.models.phonetic import PhoneticVideoQuestion as M
    stmt = select(func.count(M.id)).where(
        M.user_id == user_id,
        M.is_hidden.is_(False),
        M.answered_at.isnot(None),
    )
    return int((await db.execute(stmt)).scalar() or 0)
