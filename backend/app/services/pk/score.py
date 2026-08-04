"""PK 评分与排名(纯函数,无副作用)。

计分规则(2026-08-04 公平版:发奖品的硬要求 —— 先背完者分数必然最高):

    得分 = 掌握进度(0~1) × 满分 + 速度分
    满分 = 词数 × 100(全场统一,与词难度无关)
    速度分 = 只有全部完成才拿,按用时严格递减,完成必为正、到截止才归零

为什么满分必须统一(2026-08-04 实测暴露):以前满分 = 词表难度分之和
(小学 100/初中 120/高中 150,按词所在书的最早学段)。但每人开局随机抽词,
抽到几个"纯初中词"全凭运气 —— 同班同题量,A 满分 1000、B 满分 1100,
B 慢 40 秒反而赢。奖品赛里分数天花板不能靠抽签。学段难度分已整体退出
胜负计算(下方 grade 系函数仅余测试引用,勿再接回计分链路)。

为什么这样设计(别改回"每题累加"):
- **进度天然封顶 100%,分数刷不出来。** 累加制下,背得快的人跑完就锁分,
  背得慢的人却能一直刷题累加 → "慢慢刷"反而赢,激励完全反向。
  之前为此打过一个"提前完成奖励"的补丁;改成进度制后那个补丁不再需要,已删。
- **正确率不用单独计分。** 答错会强制抄写/重考,进度自然变慢,
  时间成本已经惩罚了错误 —— 再扣一次分是双重惩罚,小学生会挫败。
- **速度分全程严格递减且完成必为正**(见 speed_score):满分统一后,
  这保证了「先完成者总分严格最高」,大屏柱高与名次永远一致。

排名:总分降序 → 同分先完成者优先 → 再比总用时升序 → 正确数兜底。
(同分只剩两种情形:都没到该组阶段边界,或速度分四舍五入撞到同一整数 ——
后者相差不到 1 分,按完成时刻裁决仍是公平的。)
"""
from __future__ import annotations
from typing import Any

# 速度分的参照节奏:每个词算多少秒"正常速度"。
# 一个词要走 分类→听写→过关 三阶段,实测一个词约 8~15 秒;取 12 秒作中间值。
# 这是速度分的尺子,与教师设的倒计时解耦(见 speed_reference_seconds)。
REFERENCE_SECONDS_PER_WORD = 12.0

# 速度分占满分的最大比例:一开局就全掌握完拿满这个比例,拖到截止才为 0。
# 0.3 = "又快又准"最多比"压线做完"多 30% 分。
# 调大 → 更奖励手速;调小 → 更接近纯掌握度比拼。
SPEED_SCORE_RATIO = 0.3

# 参照用时点(词数×12s)仍保留的速度分份额。速度分两段递减:
#   [0, 参照用时] 从 100% 降到 25%;(参照用时, 全场截止] 从 25% 降到 0。
# 为什么不能在参照用时处直接归零(2026-08-04 发现):抄写 3 遍 + 重考的正常
# 消耗远超 12s/词,大量完赛者会落在参照用时之后 —— 若那里就归零,他们全部
# 同分(=满分),名次只能靠看不见的完成时刻裁决,又回到"6 根等高柱"的老问题。
# 保留一段缓降的尾巴,先完成者的分数就严格更高、柱高肉眼可辨。
SPEED_FLOOR_RATIO = 0.25

# 学段 → 每词难度分。⚠️ 2026-08-04 起已退出胜负计算(满分统一 100/词,见模块
# docstring),整组 grade 系函数仅余 pk_routes.load_word_points 与测试引用,
# 别再接回计分链路 —— 抽词是随机的,按词难度给分等于按运气定分数天花板。
GRADE_BASE_POINTS: dict[str, int] = {
    "primary": 100,
    "junior": 120,
    "senior": 150,
}

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


def potential_points(word_count: int, per_word: int = 100) -> int:
    """
    该玩家的「满分」= 词数 × 100,全场统一。全部掌握即拿到这个分。

    满分刻意与词难度脱钩:题量开局已强制全场一致,所以满分也人人相同 ——
    这是「先完成者分数必然最高」成立的前提(否则天花板高的人可以更慢却更高分)。
    """
    return max(0, word_count) * per_word


def speed_reference_seconds(word_count: int, countdown_seconds: float) -> float:
    """
    速度分的参照用时 = min(倒计时, 词数 × REFERENCE_SECONDS_PER_WORD)。

    为什么不直接用倒计时(2026-07-26 实测暴露):倒计时是教师随手设的。
    6 个词的房配了 5 分钟,全班 30 秒做完 —— 在 300 秒的尺子上 9 秒差距只有 3%,
    柱高看不出快慢,速度分等于白给。教师不该为了让分数有意义去调倒计时。
    改用「按词量推算的合理用时」当尺子,倒计时只作上限(设得很紧时仍以它为准)。
    """
    if word_count <= 0:
        return max(1.0, countdown_seconds)
    paced = word_count * REFERENCE_SECONDS_PER_WORD
    if countdown_seconds <= 0:
        return paced
    return max(1.0, min(countdown_seconds, paced))


def speed_score(
    potential: int, used_seconds: float, countdown_seconds: float, word_count: int,
) -> int:
    """
    速度分:只有「全部掌握完成」才拿,在 [0, 全场截止] 上严格递减:

        用时 ≤ 参照用时:满速段,从 满分×0.3 线性降到 满分×0.3×0.25
        参照用时 < 用时 < 截止:缓降尾巴,从 满分×0.3×0.25 线性降到 0

    两段连续拼接,完成必为正分 → 满分统一后「先完成者总分严格最高」是数学
    保证,不再依赖看不见的完成时刻裁决(奖品赛的硬要求)。

    为什么必须有速度分(2026-07-26 实测暴露):6 人同场全部完成 → 全部同分,
    名次只能靠完成时刻裁决,大屏上是 6 根等高柱标着 1~6 名,学生当场质疑。

    参照用时按 speed_reference_seconds 的尺子算(词数×12s 与倒计时取小),
    不直接用教师随手设的倒计时当满速尺(见该函数)。
    """
    if potential <= 0 or used_seconds < 0:
        return 0
    band = potential * SPEED_SCORE_RATIO
    ref = speed_reference_seconds(word_count, countdown_seconds)
    if used_seconds <= ref:
        ratio = SPEED_FLOOR_RATIO + (1.0 - SPEED_FLOOR_RATIO) * (ref - used_seconds) / ref
    elif countdown_seconds > ref:
        ratio = SPEED_FLOOR_RATIO * max(0.0, (countdown_seconds - used_seconds) / (countdown_seconds - ref))
    else:
        ratio = 0.0
    if ratio <= 0.0:
        return 0
    # 压线完成也至少 1 分:否则取整会把贴着截止完成的人归零,
    # "完成者总分 > 任何未完成者" 就少了最后一块保证(round(0.4)=0)
    return max(1, round(band * ratio))


def score_for_progress(progress: float, potential: int) -> int:
    """
    得分 = 掌握进度 × 满分。

    进度封顶 1.0 → 分数封顶 potential,所以"多刷题"刷不出分数,
    只有真的把词掌握了才涨分(见模块 docstring)。
    """
    p = max(0.0, min(1.0, progress))
    return round(p * max(0, potential))


def _score_sort_key(x: dict):
    """
    排序键(得分定胜负):①总分降序;②同分先完成者优先;③再按总用时升序;
    ④正确数降序兜底。

    同分才看完成时刻 —— 分数是主判据,时间只是平局裁决。
    """
    fa = x.get("finished_at_ms")
    return (
        -x.get("points", 0),                        # 总分高者赢
        0 if x.get("finished") else 1,              # 同分:完成者优先
        fa if fa is not None else float("inf"),     # 同分同完成:先完成者优先
        x.get("total_time_ms", 0),                  # 再比总用时
        -x.get("correct", 0),
    )


def _mastery_sort_key(x: dict):
    """实时榜排序键:与结算同源,走 _score_sort_key(得分定胜负)。

    保留此名是因为 live_ranking 等处已在引用;实现只有一份,避免"大屏第一名
    和最终赢家不是同一人"——那是学生当场质疑的地方。
    """
    return _score_sort_key(x)


def rank_players(players: list[dict]) -> list[dict]:
    """掌握赛排名:率先完成(全部组过关)者赢;未完成按掌握进度。

    输入 dict 含 finished, finished_at_ms, progress, correct, wrong, total_time_ms, points。
    返回新 list,每个 dict 添加 final_score(=points 仅展示), accuracy, rank 字段。
    """
    enriched = []
    for p in players:
        correct = p.get("correct", 0)
        wrong = p.get("wrong", 0)
        total = correct + wrong
        accuracy = round(correct / total * 100, 2) if total > 0 else 0.0
        enriched.append({**p, "final_score": p.get("points", 0), "accuracy": accuracy})

    enriched.sort(key=_mastery_sort_key)
    for idx, p in enumerate(enriched, start=1):
        p["rank"] = idx
    return enriched


def live_ranking(room: Any) -> list[dict]:
    """对局中实时榜单:按掌握进度/完成时刻排名,含 stage/进度/连击/在线状态。"""
    items = [
        {
            "user_id": ps.user_id,
            "nickname": ps.nickname,
            "points": ps.points,
            "potential_points": getattr(ps, "potential_points", 0),
            "correct": ps.correct,
            "wrong": ps.wrong,
            "streak": ps.streak,
            "total_time_ms": ps.total_time_ms,
            "stage": getattr(ps, "stage", "classify"),
            "group_idx": getattr(ps, "gi", 0),
            "group_total": ps.group_total,
            "progress": ps.compute_progress(),
            "finished": ps.finished,
            "finished_at_ms": int(ps.finished_at.timestamp() * 1000) if ps.finished_at else None,
            "online": ps.online,
            # 只带队号不带队名:队名靠快照里的 team_names 映射,前端自己查。
            # 实时榜每答一题就全房广播(教师大屏收全量 200 行),每行塞一个班名
            # 白占约 28 字节 × 人数,而 12M 上行是这套系统的既有瓶颈。
            "team": getattr(ps, "team", None),
        }
        for ps in room.players.values()
    ]
    items.sort(key=_mastery_sort_key)
    for idx, it in enumerate(items, start=1):
        it["rank"] = idx
    return items


def team_ranking(room: Any) -> list[dict]:
    """分组赛队伍榜:队内成员得分/正确/用时求和,按队伍总分倒序、同分总用时升序。

    个人榜(live_ranking)照常返回,前端分组赛下用队伍榜做主视图、个人榜做队内明细。
    队伍 = 班级(队名即班级名),这里是队名唯一逐行下发的地方。
    """
    teams: dict[int, dict] = {}
    names: dict[int, str] = getattr(room, "team_names", None) or {}
    # 开局后只统计真正有人的组(active_teams);等待室(未开局)列出教师建的全部组,
    # 让学生看到每组当前几人好决定进哪组。
    listed = getattr(room, "active_teams", None) or sorted(names)

    def _blank(t):
        # 队名只在队伍榜逐行下发(几行而已);学生行只带队号,由前端查映射
        return {"team": t, "team_name": names.get(t) or f"第 {t} 队",
                "points": 0, "potential": 0, "correct": 0, "wrong": 0, "total_time_ms": 0,
                "member_count": 0, "online_count": 0, "done_count": 0, "_prog_sum": 0.0}
    for t in listed:
        teams[t] = _blank(t)
    for ps in room.players.values():
        t = ps.team
        if t is None:      # 还没选组的学生不计入任何组(等待室阶段常见)
            continue
        if t not in teams:  # 容错:组号越界的成员(理论上不会发生)
            teams[t] = _blank(t)
        agg = teams[t]
        agg["points"] += ps.points
        agg["potential"] += getattr(ps, "potential_points", 0)
        agg["correct"] += ps.correct
        agg["wrong"] += ps.wrong
        agg["total_time_ms"] += ps.total_time_ms
        agg["member_count"] += 1
        agg["_prog_sum"] += ps.compute_progress()
        if ps.finished:
            agg["done_count"] += 1
        if ps.online:
            agg["online_count"] += 1
    # 排名按「人均得分」:与个人榜同源(得分定胜负),用人均而非总分,
    # 否则人多的队自动赢。同分再比完成人数、总用时。
    # ⚠️ 别改回按 avg_progress 排:那会让大屏队伍第一名与最终冠军不是同一队。
    for agg in teams.values():
        n = agg["member_count"]
        agg["avg_points"] = round(agg["points"] / n, 1) if n else 0.0
        agg["avg_potential"] = round(agg["potential"] / n, 1) if n else 0.0
        agg["avg_progress"] = round(agg["_prog_sum"] / n, 4) if n else 0.0
        agg.pop("_prog_sum", None)
    items = list(teams.values())
    items.sort(key=lambda x: (-x["avg_points"], -x["done_count"], x["total_time_ms"]))
    for idx, it in enumerate(items, start=1):
        it["rank"] = idx
    return items
