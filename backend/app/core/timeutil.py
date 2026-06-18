"""
时区工具:全站"今天/分天"统一按北京时间(Asia/Shanghai)。

背景:学习时间戳(created_at/started_at/last_practiced_at/next_review_at 等)
都按 UTC 存(datetime.utcnow() / func.now())。而"今天"对用户是北京日历日。
直接用本地午夜或 UTC 午夜去筛 UTC 时间戳都会差 8 小时,造成清晨/深夜数据跨天。

统一做法:把"北京日历日"转成对应的 UTC naive 区间 [start, end),
再与 UTC 存储的时间戳比较。
"""
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Asia/Shanghai")


def local_today() -> date:
    """服务器所在地(北京)当前日历日。"""
    return datetime.now(LOCAL_TZ).date()


def local_day_utc_range(d: date) -> tuple[datetime, datetime]:
    """北京日历日 d 的 [起, 止) 对应的 UTC naive 时间(与 DB 存储口径一致)。"""
    start_local = datetime(d.year, d.month, d.day, tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def local_today_utc_range() -> tuple[datetime, datetime]:
    """北京"今天"的 UTC naive 区间 [今日起, 明日起)。"""
    return local_day_utc_range(local_today())


def utc_now() -> datetime:
    """当前 UTC naive 时间(与 datetime.utcnow() 一致,供统一引用)。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)
