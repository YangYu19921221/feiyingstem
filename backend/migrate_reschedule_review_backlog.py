#!/usr/bin/env python3
"""
把"严重逾期的复习积压"按用户重新摊到未来若干天,避免"今日待复习"动辄几千、
学生永远清不完。

规则(每个用户独立):
- 取该用户所有 next_review_at < now-2天 的逾期词(graduated/已毕业的 next_review_at
  为 NULL,不在此列,不动)
- 按 next_review_at 升序(越早逾期越优先复习)
- 从"明天"开始,每天最多 DAILY_CAP 个,顺序铺到未来。
  第 i 个词(0-based)安排到第 (i // DAILY_CAP + 1) 天的上午 8 点。
- 只改 next_review_at,不动 review_stage / 掌握度 / 学习进度。

幂等:重复跑会把同一批再次从明天起重排(结果稳定,因为只依据 next_review_at 排序)。

用法:
  python3 migrate_reschedule_review_backlog.py <db_path> [--apply] [--cap N] [--overdue-days D]
  不带 --apply 为 dry-run。
"""
import sqlite3
import sys
from datetime import datetime, timedelta

DAILY_CAP = 60          # 每人每天最多复习数
OVERDUE_DAYS = 2        # 只重排逾期超过这么多天的


def main():
    if len(sys.argv) < 2:
        print("用法: python3 migrate_reschedule_review_backlog.py <db_path> [--apply] [--cap N] [--overdue-days D]")
        sys.exit(1)
    db_path = sys.argv[1]
    apply = "--apply" in sys.argv
    cap = DAILY_CAP
    overdue_days = OVERDUE_DAYS
    if "--cap" in sys.argv:
        cap = int(sys.argv[sys.argv.index("--cap") + 1])
    if "--overdue-days" in sys.argv:
        overdue_days = int(sys.argv[sys.argv.index("--overdue-days") + 1])

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    now = datetime.utcnow()
    cutoff = now - timedelta(days=overdue_days)
    # 明天 00:00 起的上午 8 点作为每日复习时刻
    tomorrow = (now + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)

    # 受影响用户
    users = [r[0] for r in cur.execute(
        "SELECT DISTINCT user_id FROM word_mastery "
        "WHERE next_review_at IS NOT NULL AND next_review_at < ?",
        (cutoff.strftime("%Y-%m-%d %H:%M:%S"),)
    ).fetchall()]

    print(f"逾期>{overdue_days}天的用户数: {len(users)}, 每日上限: {cap}")
    total_reschedule = 0
    max_span_days = 0

    for uid in users:
        rows = cur.execute(
            "SELECT id FROM word_mastery "
            "WHERE user_id=? AND next_review_at IS NOT NULL AND next_review_at < ? "
            "ORDER BY next_review_at ASC",
            (uid, cutoff.strftime("%Y-%m-%d %H:%M:%S"))
        ).fetchall()
        for i, (mid,) in enumerate(rows):
            day_offset = i // cap
            new_dt = tomorrow + timedelta(days=day_offset)
            max_span_days = max(max_span_days, day_offset + 1)
            if apply:
                cur.execute(
                    "UPDATE word_mastery SET next_review_at=? WHERE id=?",
                    (new_dt.strftime("%Y-%m-%d %H:%M:%S"), mid)
                )
            total_reschedule += 1

    print(f"将重排词数: {total_reschedule}, 最长摊到未来 {max_span_days} 天")
    if apply:
        conn.commit()
        print("已提交 (--apply)")
    else:
        print("DRY-RUN,未写库。加 --apply 实际执行。")
    conn.close()


if __name__ == "__main__":
    main()
