"""PK 评分与排名(纯函数,无副作用)。

计分规则(2026-07 版):
- 每题基础分按学段:小学 100 / 初中 120 / 高中 150(取自单词本 grade_level)
- 答对得 基础分 + 手速加成(剩余时间比例 × 30% 基础分,答得越快加越多)
- 答错/超时 0 分,不倒扣;连击(streak)只做展示,不影响得分
- 排名按累计 points 倒序,同分按总用时升序
"""
from __future__ import annotations
from typing import Any

# 学段 → 每题基础分
GRADE_BASE_POINTS: dict[str, int] = {
    "primary": 100,
    "junior": 120,
    "senior": 150,
}

# 手速加成占基础分的最大比例
SPEED_BONUS_RATIO = 0.3

_JUNIOR_GRADES = {"七年级", "八年级", "九年级"}
_SENIOR_PREFIXES = ("高一", "高二", "高三", "高中")

GRADE_TIER_LABEL: dict[str, str] = {
    "primary": "小学",
    "junior": "初中",
    "senior": "高中",
}


def grade_level_to_tier(grade_level: str | None) -> str:
    """单词本 grade_level → 学段 tier。

    三~六年级/空/未知 → primary;七~九年级 → junior;高一/高二/高三 → senior。
    """
    if not grade_level:
        return "primary"
    g = grade_level.strip()
    if g in _JUNIOR_GRADES or g == "初中":
        return "junior"
    if g.startswith(_SENIOR_PREFIXES):
        return "senior"
    return "primary"


def base_points_for_grade(grade_level: str | None) -> int:
    return GRADE_BASE_POINTS[grade_level_to_tier(grade_level)]


_TIER_ORDER = {"primary": 0, "junior": 1, "senior": 2}


def base_points_for_word_grades(grade_levels: list[str | None]) -> int:
    """一个词可能出现在多本书里:取最早学段(在三年级书里出现过就算小学词)。

    没有任何书籍信息时按小学兜底。
    """
    if not grade_levels:
        return GRADE_BASE_POINTS["primary"]
    tier = min((grade_level_to_tier(g) for g in grade_levels), key=_TIER_ORDER.__getitem__)
    return GRADE_BASE_POINTS[tier]


def compute_question_points(
    base_points: int, is_correct: bool, time_spent_ms: int, timeout_ms: int,
) -> int:
    """单题得分:答错 0;答对 = 基础分 + 手速加成(剩余时间比例 × 30% 基础分)。"""
    if not is_correct:
        return 0
    if timeout_ms <= 0:
        return base_points
    remaining_ratio = max(0.0, 1.0 - time_spent_ms / timeout_ms)
    return base_points + round(base_points * SPEED_BONUS_RATIO * remaining_ratio)


def rank_players(players: list[dict]) -> list[dict]:
    """按累计 points 倒序排名,同分按 total_time_ms 升序。

    输入 dict 至少含 points, correct, wrong, total_time_ms。
    返回新 list,每个 dict 添加 final_score(=points), accuracy, rank 字段。
    """
    enriched = []
    for p in players:
        correct = p.get("correct", 0)
        wrong = p.get("wrong", 0)
        total = correct + wrong
        accuracy = round(correct / total * 100, 2) if total > 0 else 0.0
        enriched.append({**p, "final_score": p.get("points", 0), "accuracy": accuracy, "_answered": total})

    # 排名:得分高优先;同分再看用时少。但"一题没答"的人(缺席/全程掉线)一律垫底——
    # 否则双方都 0 分时,没答题的人 total_time_ms=0 反而排到认真答完(全错)的人前面,
    # 把胜利判给根本没参赛的一方。用时只在"确实答过题"的人之间比。
    enriched.sort(key=lambda x: (-x["final_score"], x["_answered"] == 0, x["total_time_ms"]))
    for idx, p in enumerate(enriched, start=1):
        p["rank"] = idx
        p.pop("_answered", None)
    return enriched


def live_ranking(room: Any) -> list[dict]:
    """对局中实时榜单:按 points 倒序、同分总用时升序,含进度/连击/在线状态。"""
    items = [
        {
            "user_id": ps.user_id,
            "nickname": ps.nickname,
            "points": ps.points,
            "correct": ps.correct,
            "wrong": ps.wrong,
            "streak": ps.streak,
            "total_time_ms": ps.total_time_ms,
            "current_word_idx": ps.current_word_idx,
            "online": ps.online,
            "team": getattr(ps, "team", None),
        }
        for ps in room.players.values()
    ]
    items.sort(key=lambda x: (-x["points"], x["total_time_ms"]))
    for idx, it in enumerate(items, start=1):
        it["rank"] = idx
    return items


def team_ranking(room: Any) -> list[dict]:
    """分组赛队伍榜:队内成员得分/正确/用时求和,按队伍总分倒序、同分总用时升序。

    个人榜(live_ranking)照常返回,前端分组赛下用队伍榜做主视图、个人榜做队内明细。
    空队(没人分到)也列出,让教师在等待室看到全部队号。
    """
    teams: dict[int, dict] = {}
    for t in range(1, getattr(room, "team_count", 2) + 1):
        teams[t] = {
            "team": t, "points": 0, "correct": 0, "wrong": 0,
            "total_time_ms": 0, "member_count": 0, "online_count": 0,
        }
    for ps in room.players.values():
        t = ps.team
        if t not in teams:  # 容错:队号越界的成员并入其原队号(理论上不会发生)
            teams[t] = {"team": t, "points": 0, "correct": 0, "wrong": 0,
                        "total_time_ms": 0, "member_count": 0, "online_count": 0}
        agg = teams[t]
        agg["points"] += ps.points
        agg["correct"] += ps.correct
        agg["wrong"] += ps.wrong
        agg["total_time_ms"] += ps.total_time_ms
        agg["member_count"] += 1
        if ps.online:
            agg["online_count"] += 1
    # 排名按「人均分」而非总分:两队人数不等(如 3v2)时,人多的队总分天然占优,
    # 用人均分才公平。榜单仍展示 points 总分,avg_points 供前端/排序用。
    for agg in teams.values():
        n = agg["member_count"]
        agg["avg_points"] = round(agg["points"] / n, 1) if n else 0.0
    items = list(teams.values())
    items.sort(key=lambda x: (-x["avg_points"], x["total_time_ms"]))
    for idx, it in enumerate(items, start=1):
        it["rank"] = idx
    return items
