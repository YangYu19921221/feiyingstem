"""金币每日自动结算(轻量后台循环,随 app 生命周期运行)

背景:单词王要到当天 24 点结束、榜单定了才能评。原先只在老师打开金币页时
才触发结算,没人打开就一直不发。这里加一个进程内定时循环,每天北京 00:35
(过了 24 点)自动结算「前一天」的单词王 + 作业币,无需人工、不装新依赖。

幂等:settle_day 用 dedup_key,重复跑不会多发;进程重启后循环重建,当天若已
结算过也不会重复(dedup 命中跳过)。多 worker 部署时会各起一个循环,靠
dedup 唯一约束保证只发一次(P3 换共享调度再优化)。
"""
import asyncio
import logging
from datetime import timedelta

from app.core.database import AsyncSessionLocal
from app.core.timeutil import local_today, LOCAL_TZ
from app.services.coin_service import settle_day

logger = logging.getLogger(__name__)

SETTLE_HOUR = 0      # 北京 0 点后
SETTLE_MINUTE = 35   # :35 结算(错开 0 点整点,避开跨天边界抖动)


def _seconds_until_next_run() -> float:
    """距下一个北京 00:35 的秒数。"""
    from datetime import datetime
    now_local = datetime.now(LOCAL_TZ)
    target = now_local.replace(hour=SETTLE_HOUR, minute=SETTLE_MINUTE, second=0, microsecond=0)
    if target <= now_local:
        target = target + timedelta(days=1)
    return (target - now_local).total_seconds()


async def _settle_yesterday() -> None:
    """结算前一天(北京日)。"""
    y = local_today() - timedelta(days=1)
    async with AsyncSessionLocal() as db:
        try:
            result = await settle_day(db, y)
            await db.commit()
            logger.info(f"[coin] 每日自动结算 {y.isoformat()}: {result}")
        except Exception as e:
            await db.rollback()
            logger.error(f"[coin] 自动结算 {y.isoformat()} 失败: {e}")


async def daily_settle_loop() -> None:
    """常驻循环:睡到北京 00:35 → 结算昨天 → 再睡到明天。"""
    # 启动时先补一次昨天(服务半夜重启/白天首次上线,补上可能漏结算的昨天)
    try:
        await _settle_yesterday()
    except Exception as e:
        logger.error(f"[coin] 启动补结算失败: {e}")
    while True:
        try:
            await asyncio.sleep(_seconds_until_next_run())
            await _settle_yesterday()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[coin] 结算循环异常,60s 后继续: {e}")
            await asyncio.sleep(60)
