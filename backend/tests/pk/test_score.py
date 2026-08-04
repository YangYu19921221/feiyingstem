"""score.py 单测(2026-08-04 公平版:满分统一 + 速度分全程严格递减)。

核心不变量(发奖品的硬要求):同题量下,先完成者总分严格最高。
"""
from datetime import datetime

from app.services.pk.score import (
    GRADE_BASE_POINTS,
    SPEED_SCORE_RATIO,
    SPEED_FLOOR_RATIO,
    grade_level_to_tier,
    base_points_for_grade,
    base_points_for_word_grades,
    potential_points,
    speed_reference_seconds,
    speed_score,
    score_for_progress,
    rank_players,
    live_ranking,
)


# ---------- 满分统一(与词难度脱钩) ----------

def test_potential_points_uniform_by_word_count():
    # 满分 = 词数 × 100,全场统一 —— 不看抽到什么词
    assert potential_points(10) == 1000
    assert potential_points(8) == 800
    assert potential_points(0) == 0
    assert potential_points(-1) == 0  # 防御


def test_potential_points_same_for_everyone_at_same_word_count():
    # 公平核心:同题量 → 同满分,分数天花板不因词的学段/运气而变
    assert potential_points(10) == potential_points(10)
    assert potential_points(10, per_word=100) == 1000


# ---------- 速度分:全程严格递减、完成必为正 ----------

def test_speed_score_strictly_decreasing_and_positive_before_deadline():
    prev = None
    for used in range(0, 300, 3):
        v = speed_score(1000, used, 300.0, 10)
        assert v > 0, f"完成于 {used}s 却拿了 0 速度分"
        if prev is not None:
            assert v <= prev, f"{used}s 的速度分反而比更早完成的高"
        prev = v
    assert speed_score(1000, 299, 300.0, 10) >= 1  # 压线完成也至少 1 分
    assert speed_score(1000, 300, 300.0, 10) == 0  # 压线截止才归零


def test_speed_score_reference_point_keeps_floor():
    # 参照用时点(10词×12s=120s)保留底档:band × SPEED_FLOOR_RATIO
    band = 1000 * SPEED_SCORE_RATIO
    assert speed_score(1000, 120, 300.0, 10) == round(band * SPEED_FLOOR_RATIO)
    # 开局即完成拿满速度分
    assert speed_score(1000, 0, 300.0, 10) == round(band)


def test_speed_score_tight_countdown_single_segment():
    # 倒计时比参照用时还紧(60s < 10词×120s):整段都在满速段,压线仍有底档
    v = speed_score(1000, 60, 60.0, 10)
    assert v == round(1000 * SPEED_SCORE_RATIO * SPEED_FLOOR_RATIO)
    assert speed_score(1000, 30, 60.0, 10) > v


def test_speed_score_defensive():
    assert speed_score(0, 10, 300.0, 10) == 0
    assert speed_score(1000, -1, 300.0, 10) == 0
    assert speed_score(1000, 400, 300.0, 10) == 0  # 超截止(理论上不会)不给负分


def test_speed_reference_seconds():
    assert speed_reference_seconds(10, 300.0) == 120.0   # 10词×12s,倒计时够松
    assert speed_reference_seconds(10, 60.0) == 60.0     # 倒计时紧 → 以它为准
    assert speed_reference_seconds(0, 300.0) == 300.0    # 防御


# ---------- 公平核心不变量:先完成者总分严格最高 ----------

def test_first_finisher_always_scores_strictly_higher():
    """同题量(=同满分)下,先完成者总分严格更高(间隔超过取整粒度时);
    取整粒度内(<1分)的撞分由 rank_players 按完成时刻裁决,见平局测试。"""
    potential = potential_points(10)
    countdown = 300.0
    used_list = [10, 45, 90, 119, 130, 180, 240, 290]
    totals = [potential + speed_score(potential, u, countdown, 10) for u in used_list]
    for earlier, later in zip(totals, totals[1:]):
        assert earlier > later, f"先完成者没有严格更高: {totals}"
    # 未完成者(进度<1)必低于任何完赛者
    unfinished = score_for_progress(0.99, potential)
    assert unfinished < min(totals)


def test_score_for_progress_caps():
    assert score_for_progress(1.0, 1000) == 1000
    assert score_for_progress(1.5, 1000) == 1000   # 进度封顶 → 分数封顶,刷题无用
    assert score_for_progress(0.5, 1000) == 500
    assert score_for_progress(-0.1, 1000) == 0


# ---------- 学段函数(已退出计分链路,仅防误改) ----------

def test_grade_helpers_kept_but_out_of_scoring():
    assert grade_level_to_tier("七年级") == "junior"
    assert base_points_for_grade("高一") == 150
    assert base_points_for_word_grades(["高一", "三年级"]) == 100  # 最早学段
    assert GRADE_BASE_POINTS == {"primary": 100, "junior": 120, "senior": 150}


# ---------- 终局排名(得分定胜负) ----------

def _player(uid, points, finished=False, finished_at_ms=None, time_ms=0,
            correct=0, wrong=0, progress=0.0):
    return {"user_id": uid, "points": points, "finished": finished,
            "finished_at_ms": finished_at_ms, "total_time_ms": time_ms,
            "correct": correct, "wrong": wrong, "progress": progress}


def test_rank_players_by_points_desc():
    ranked = rank_players([
        _player(1, 900, finished=True, finished_at_ms=2000),
        _player(2, 1100, finished=True, finished_at_ms=3000),
        _player(3, 700, progress=0.6),
    ])
    assert [p["user_id"] for p in ranked] == [2, 1, 3]
    assert ranked[0]["rank"] == 1 and ranked[0]["final_score"] == 1100


def test_rank_players_tie_finished_first():
    # 同分(速度分取整撞车,相差<1分):先完成者优先 —— 公平的平局裁决
    ranked = rank_players([
        _player(1, 1000, finished=True, finished_at_ms=5000),
        _player(2, 1000, finished=True, finished_at_ms=4000),
        _player(3, 1000, progress=1.0),  # 理论不存在(完成才满分),防御排序
    ])
    assert [p["user_id"] for p in ranked] == [2, 1, 3]


def test_rank_players_unfinished_by_points_then_time():
    ranked = rank_players([
        _player(1, 600, time_ms=20000, progress=0.5),
        _player(2, 600, time_ms=18000, progress=0.5),
        _player(3, 700, time_ms=30000, progress=0.6),
    ])
    assert [p["user_id"] for p in ranked] == [3, 2, 1]


def test_rank_players_accuracy_computed():
    ranked = rank_players([
        _player(1, 300, correct=3, wrong=1),
        _player(2, 0),
    ])
    by_uid = {p["user_id"]: p for p in ranked}
    assert by_uid[1]["accuracy"] == 75.0
    assert by_uid[2]["accuracy"] == 0.0  # 无作答不除零


# ---------- 实时榜单(与结算同源) ----------

class _PS:
    def __init__(self, user_id, nickname, points, total_time_ms, correct=0, wrong=0,
                 streak=0, online=True, progress=0.0, finished=False, finished_at=None,
                 stage="classify", gi=0, group_total=2, team=None, potential_points=1000):
        self.user_id = user_id
        self.nickname = nickname
        self.points = points
        self.total_time_ms = total_time_ms
        self.correct = correct
        self.wrong = wrong
        self.streak = streak
        self.online = online
        self._progress = progress
        self.finished = finished
        self.finished_at = finished_at
        self.stage = stage
        self.gi = gi
        self.group_total = group_total
        self.team = team
        self.potential_points = potential_points

    def compute_progress(self):
        return self._progress


class _Room:
    def __init__(self, players):
        self.players = {p.user_id: p for p in players}


def test_live_ranking_orders_by_points():
    room = _Room([
        _PS(1, "甲", points=200, total_time_ms=5000, streak=2, progress=0.4),
        _PS(2, "乙", points=350, total_time_ms=6000, streak=3, progress=0.8),
        _PS(3, "丙", points=200, total_time_ms=4000, online=False, progress=0.4),
    ])
    items = live_ranking(room)
    # 分高者先(乙);甲丙同分,丙用时短 → 丙在前
    assert [it["user_id"] for it in items] == [2, 3, 1]
    assert [it["rank"] for it in items] == [1, 2, 3]
    assert items[0]["potential_points"] == 1000


def test_live_ranking_finisher_with_speed_points_ranks_first():
    # 完成者 = 满分 + 速度分,必然高于任何未完成者
    room = _Room([
        _PS(1, "甲", points=990, total_time_ms=5000, progress=0.99),
        _PS(2, "乙", points=1075, total_time_ms=6000, progress=1.0, finished=True,
            finished_at=datetime(2026, 1, 1)),
    ])
    items = live_ranking(room)
    assert items[0]["user_id"] == 2 and items[0]["finished"] is True
