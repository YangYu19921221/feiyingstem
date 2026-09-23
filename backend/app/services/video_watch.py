"""音标视频「看了多久 / 看完没有」的唯一口径

学习时长那件事已经教过一次了(services/study_time.py 的文件头:同一个学生的时长
在五个界面里能看到五个数字,最大差 250 倍,因为代码里有五份手写聚合)。
所以这次在**第一个消费方出现之前**就把口径收在这里:学生端心跳、教师端统计、
学生端「看完没有」的角标,全都调这个模块,不要再手写。

## 判「看完」为什么必须同时看两个数

- 只看 `max_position`(看到过的最远处): 把进度条**直接拖到末尾**就算看完 ——
  孩子学会这一手之后「完看率」就是废数,而完看率恰恰是老师唯一能用来判断
  "这个视频有没有被真看"的指标。
- 只看 `watch_seconds`(净时长): 反复看开头也能攒够时长,却从没看到结尾;
  更糟的是这样判会把"认真看了三遍前半段"和"看完整节"混为一谈。

两个都要:看到过结尾附近(POS_RATIO)**且**累计时长够(TIME_RATIO)。

## 阈值为什么不是 100%

视频结尾常有几秒片尾/空黑帧,而 `timeupdate` 也不保证正好报到 duration ——
卡 100% 会让"确实看完的"永远差一点点,完看率恒为 0(比没有这个指标更糟,
因为它看起来像个真数)。0.9 / 0.6 的组合意思是:**看到了最后一成之内,
且至少真看了六成时长**。

TIME_RATIO 取 0.6 而不是 0.9: 音标视频里老师常有重复示范,孩子听懂了拖过去
是正常学习行为,不该判成没看完;而 0.6 已经足够排除"拖到末尾骗完成"。

## duration 为空怎么办

`phonetic_videos.duration_seconds` 是可空列,而在这个功能之前**没有任何代码
写过它**(模型注释写着"前端拿到元数据后可回填",但那段回填一直没实现)。
所以存量视频全是 NULL —— 没有分母就算不出完看率。
两件事一起做: ①心跳带上前端 `video.duration` 顺手回填(见 api 层)
②分母缺失时 `is_completed` 返回 **False 而不是 True**,并且统计侧把这些视频的
完看率显示成「—」而不是 0% —— 「算不出」和「没人看完」是两件事,
混在一起会让老师以为学生没看(我们自己数据缺失,却去怀疑学生)。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable, Optional

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

# 看到过视频的最后 10% 之内,才算"到过结尾"
POS_RATIO = 0.9
# 且累计净时长至少占 60%(排除"拖到末尾骗完成",又容忍正常的快进重复示范)
TIME_RATIO = 0.6

# 单次心跳能累加的上限(秒)。**必须在服务端封顶** —— 客户端报多少就加多少的话,
# 改一行 JS 就能刷出 10 小时观看时长,而这个数会进老师的教学统计。
# 30 是前端心跳周期,给 4 倍余量兜「标签页被限流后一次补报」
MAX_HEARTBEAT_SEC = 120

# 前端心跳周期(秒)。两端必须一致:后端拿它算「还算在看吗」的窗口
HEARTBEAT_SEC = 30
# 「正在看」的判定窗口。**取心跳周期的 3 倍**,不是 1 倍 ——
# 心跳会因为标签页被浏览器限流(后台标签 setInterval 被压到 1 分钟一次)、
# 网络抖动、或正好卡在两次心跳之间而迟到;窗口 == 周期的话在线人数会一直闪。
# 代价是关掉页面后最多 90 秒仍显示「在看」,这个误差方向是对的:
# 老师看这个数是为了知道「现在有没有人在上课」,宁可多算一分钟也别漏报成 0
WATCHING_WINDOW_SEC = HEARTBEAT_SEC * 3


def is_completed(
    watch_seconds: int,
    max_position_seconds: int,
    duration_seconds: Optional[int],
) -> bool:
    """这次观看算不算「看完」。分母缺失时返回 False(见模块头:算不出 ≠ 没看完)"""
    if not duration_seconds or duration_seconds <= 0:
        return False
    return (
        max_position_seconds >= duration_seconds * POS_RATIO
        and watch_seconds >= duration_seconds * TIME_RATIO
    )


def clamp_increment(seconds: Optional[int]) -> int:
    """客户端报的本次增量 → 可信增量。负数/None 归 0,超上限截断"""
    if not seconds or seconds <= 0:
        return 0
    return min(int(seconds), MAX_HEARTBEAT_SEC)


def clamp_position(position: Optional[int], duration_seconds: Optional[int]) -> int:
    """播放位置 → 可信位置。

    **必须按 duration 夹**: 前端报个 999999 就会让 max_position 永远满足
    "到过结尾",完看率虚高。duration 未知时不夹(只能先信着,等回填之后
    下一次心跳就会被夹回来)。
    """
    if not position or position <= 0:
        return 0
    p = int(position)
    if duration_seconds and duration_seconds > 0:
        return min(p, int(duration_seconds))
    return p


def completion_rate(completed: int, viewers: int) -> Optional[float]:
    """完看率(0~1)。**没人看过时返回 None 而不是 0** ——

    「还没有人看」和「看了但没人看完」在界面上必须是两句不同的话:
    前者要说的是"这节还没推给学生",后者才是"学生没看进去"。
    返回 0 会把前者显示成 0%,老师照着它去找学生谈话,而问题其实在他自己。
    """
    if viewers <= 0:
        return None
    return completed / viewers


@dataclass
class VideoStats:
    """一个视频的观看统计。字段命名刻意区分「次」和「人」——

    老的 `phonetic_videos.view_count` 叫 view_count 却是**打开次数**,
    界面上写着「观看 37」谁都会读成 37 个人(实际可能是 3 个学生刷新出来的)。
    所以这里 viewers / plays 分开命名,别再合成一个数。
    """
    viewers: int = 0            # 看过的**人**数(去重)
    plays: int = 0              # 打开**次**数(所有人相加)
    completed: int = 0          # 看完的人数(口径见 is_completed)
    watching_now: int = 0       # 此刻还在看的人数(WATCHING_WINDOW_SEC 窗口内有心跳)
    total_watch_seconds: int = 0
    viewers_today: int = 0      # 今天看过的人数(北京日,由调用方给窗口)

    @property
    def avg_watch_seconds(self) -> int:
        """人均观看时长。分母是**人**不是次 —— 按次算会把"看了三次各 2 分钟"
        说成人均 2 分钟,而老师想知道的是这个学生总共在这节课上花了 6 分钟。
        """
        if self.viewers <= 0:
            return 0
        return int(self.total_watch_seconds / self.viewers)

    @property
    def completion_rate(self) -> Optional[float]:
        return completion_rate(self.completed, self.viewers)


async def stats_for_videos(
    db: AsyncSession,
    video_ids: Iterable[int],
    *,
    org_id: Optional[int] = None,
    restrict_user_ids: Optional[Iterable[int]] = None,
) -> dict[int, VideoStats]:
    """批量取多个视频的统计。**一次 group_by 聚合,不要按行 N 次查** ——

    教师端列表一页 10 个视频,按行查就是 10 趟往返(讲义数那次已经踩过,
    见 teacher/phonetics.py 的 material_count 注释「别按行 N 次查」)。

    ## 两个收范围的参数,作用不同

    `org_id`: **必须显式传,靠过滤器罩不住这张表**。phonetic_video_views 不是
    9 张锚点表之一(没有 org_id 列),归属要经 user_id 推导 —— 而 CLAUDE.md
    写明「聚合/统计查询若不经锚点模型,过滤器罩不住,必须手动 join User,
    已有两次此类泄漏教训」。音标视频大量是平台预置的(org_id=NULL,全平台可见),
    不 join User 的话 A 机构的学生会在卡片上看到全平台的观看人数 ——
    而「多少人学过」这个数是会被当成本校学情读的。

    `restrict_user_ids`: 教师端收到「我班上的学生」。老师要的是"我的学生看了没有",
    全校几千人的数字对他没用。传**空集合** = 范围内没有学生 → 全 0
    (与 None「不限制」是两件事,别搞混)。
    """
    from app.models.phonetic import PhoneticVideoView as V
    from app.models.user import User

    ids = list(video_ids)
    out: dict[int, VideoStats] = {vid: VideoStats() for vid in ids}
    if not ids:
        return out

    watching_after = _now() - timedelta(seconds=WATCHING_WINDOW_SEC)
    today_start, today_end = _today_range()

    stmt = (
        select(
            V.video_id,
            func.count(V.id),
            func.coalesce(func.sum(V.play_count), 0),
            func.coalesce(func.sum(case((V.completed.is_(True), 1), else_=0)), 0),
            func.coalesce(
                func.sum(case((V.last_viewed_at >= watching_after, 1), else_=0)), 0
            ),
            func.coalesce(func.sum(V.watch_seconds), 0),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (V.last_viewed_at >= today_start)
                            & (V.last_viewed_at < today_end),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .where(V.video_id.in_(ids))
        .group_by(V.video_id)
    )
    if org_id is not None:
        # 手动 join User 推导归属(见 docstring:这张表没有 org_id,过滤器罩不住)。
        # 只数本机构的人;平台 admin(org_id 为 None)看全部,与既有口径一致
        stmt = stmt.join(User, User.id == V.user_id).where(User.org_id == org_id)
    if restrict_user_ids is not None:
        allowed = list(restrict_user_ids)
        if not allowed:
            return out
        stmt = stmt.where(V.user_id.in_(allowed))

    for (
        vid, viewers, plays, completed, watching, secs, today,
    ) in (await db.execute(stmt)).all():
        out[vid] = VideoStats(
            viewers=viewers or 0,
            plays=plays or 0,
            completed=completed or 0,
            watching_now=watching or 0,
            total_watch_seconds=secs or 0,
            viewers_today=today or 0,
        )
    return out


def _now():
    from app.core.timeutil import utc_now
    return utc_now()


def _today_range():
    """今天的 UTC 区间(按**北京日**切,不是 UTC 日)。

    ⚠️ 比较的是 DateTime 列不是手拼字符串,所以不涉及 CLAUDE.md 那条
    「SQLite 微秒格式混用」的坑(那条只在手写 SQL 字面量时会翻车)。
    """
    from app.core.timeutil import local_today_utc_range
    return local_today_utc_range()
