"""一次性回补历史成就。

背景:成就检查是 2026-07-21 才挂到学习记录提交路径上的,在那之前学习的学生
(大量在 5 月活跃、之后没再来)从没被检查过,导致「达标却没解锁」。成就只在
提交学习记录时检查,这些学生不回来学就永远补不上,必须离线回补一次。

只回补「按当前累计数据可判定」的类型:
- total_words(累计词数)
- consecutive_days(连续打卡天数)
不回补 accuracy_rate / perfect_score —— 那两类依赖单次测验的当场成绩,
历史无法还原,硬补会凭空发徽章。

用法:
    python scripts/backfill_achievements.py --dry-run    # 先看会补什么
    python scripts/backfill_achievements.py              # 真正写入
幂等:重复执行不会重复解锁(check_and_unlock_achievements 会跳过已解锁的)。
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, func  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.learning import WordMastery  # noqa: E402
from app.models.user import Achievement as AchievementModel, UserAchievement  # noqa: E402
from app.api.v1.achievements import get_user_stats, check_and_unlock_achievements  # noqa: E402

BACKFILLABLE = ("total_words", "consecutive_days")


async def main(dry_run: bool) -> None:
    async with AsyncSessionLocal() as db:
        # 只处理有学习痕迹的用户(有 word_mastery 记录),避免扫全表用户
        user_ids = [
            r[0] for r in (await db.execute(
                select(WordMastery.user_id).group_by(WordMastery.user_id)
            )).fetchall()
        ]
        names = {
            a.id: (a.name, a.condition_type)
            for a in (await db.execute(select(AchievementModel))).scalars().all()
        }

        before = (await db.execute(
            select(func.count(UserAchievement.id))
        )).scalar() or 0

        total_new = 0
        per_achievement: dict[str, int] = {}
        touched_users = 0

        for uid in user_ids:
            stats = await get_user_stats(db, uid)
            # test_score/test_total 传 None → 只会判定 total_words / consecutive_days,
            # accuracy_rate 与 perfect_score 分支自然跳过(它们要求这两个参数非 None)
            unlocked = await check_and_unlock_achievements(
                db=db, user_id=uid, stats=stats, test_score=None, test_total=None,
            )
            # 双保险:即使将来 check 函数放宽了,也只认可回补类型
            kept = [u for u in unlocked if names.get(u.id, ("", ""))[1] in BACKFILLABLE]
            if kept:
                touched_users += 1
                total_new += len(kept)
                for u in kept:
                    label = names.get(u.id, (str(u.id), "?"))[0]
                    per_achievement[label] = per_achievement.get(label, 0) + 1
                print(f"  user {uid}: 补 {len(kept)} 个 -> "
                      f"{', '.join(names.get(u.id, (str(u.id),'?'))[0] for u in kept)}"
                      f"  (词数={stats['total_words']}, 连续={stats['consecutive_days']})")

        print("\n=== 汇总 ===")
        print(f"扫描学生: {len(user_ids)}")
        print(f"受影响学生: {touched_users}")
        print(f"新解锁成就条数: {total_new}")
        for k, v in sorted(per_achievement.items(), key=lambda x: -x[1]):
            print(f"  {k}: {v}")

        if dry_run:
            await db.rollback()
            print("\n[dry-run] 已回滚,未写入任何数据")
        else:
            await db.commit()
            after = (await db.execute(
                select(func.count(UserAchievement.id))
            )).scalar() or 0
            print(f"\n已提交。user_achievements 总数 {before} -> {after}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印将要回补的内容,不写库")
    args = ap.parse_args()
    asyncio.run(main(args.dry_run))
