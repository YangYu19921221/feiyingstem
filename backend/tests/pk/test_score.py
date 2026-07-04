from app.services.pk.score import (
    GRADE_BASE_POINTS,
    SPEED_BONUS_RATIO,
    grade_level_to_tier,
    base_points_for_grade,
    compute_question_points,
    rank_players,
    live_ranking,
)


# ---------- 学段映射 ----------

def test_grade_level_to_tier_primary():
    for g in (None, "", "三年级", "四年级", "五年级", "六年级", "随便什么"):
        assert grade_level_to_tier(g) == "primary"


def test_grade_level_to_tier_junior():
    for g in ("七年级", "八年级", "九年级", "初中"):
        assert grade_level_to_tier(g) == "junior"


def test_grade_level_to_tier_senior():
    for g in ("高一", "高二", "高三", "高中必修"):
        assert grade_level_to_tier(g) == "senior"


def test_base_points_for_grade():
    assert base_points_for_grade("三年级") == 100
    assert base_points_for_grade("七年级") == 120
    assert base_points_for_grade("高一") == 150
    assert base_points_for_grade(None) == 100
    assert GRADE_BASE_POINTS == {"primary": 100, "junior": 120, "senior": 150}


# ---------- 单题得分 ----------

def test_wrong_answer_zero_points():
    assert compute_question_points(100, False, 1000, 20_000) == 0
    assert compute_question_points(150, False, 19_999, 20_000) == 0


def test_instant_answer_gets_max_speed_bonus():
    # 0ms 用时 → 基础分 + 30%
    assert compute_question_points(100, True, 0, 20_000) == 130
    assert compute_question_points(150, True, 0, 20_000) == 195


def test_answer_at_timeout_gets_base_only():
    assert compute_question_points(100, True, 20_000, 20_000) == 100
    # 超过 timeout(理论上不会,防御)不出现负加成
    assert compute_question_points(100, True, 30_000, 20_000) == 100


def test_half_time_answer_gets_half_bonus():
    # 剩一半时间 → +15%
    assert compute_question_points(100, True, 10_000, 20_000) == 115
    assert compute_question_points(120, True, 10_000, 20_000) == 120 + round(120 * SPEED_BONUS_RATIO * 0.5)


def test_zero_timeout_defensive():
    assert compute_question_points(100, True, 500, 0) == 100


# ---------- 终局排名 ----------

def test_rank_players_by_points_desc():
    players = [
        {"user_id": 1, "correct": 8, "wrong": 2, "total_time_ms": 25000, "points": 900},
        {"user_id": 2, "correct": 9, "wrong": 1, "total_time_ms": 30000, "points": 1100},
        {"user_id": 3, "correct": 9, "wrong": 1, "total_time_ms": 28000, "points": 1050},
    ]
    ranked = rank_players(players)
    assert [p["user_id"] for p in ranked] == [2, 3, 1]
    assert ranked[0]["rank"] == 1 and ranked[0]["final_score"] == 1100
    assert ranked[2]["rank"] == 3 and ranked[2]["final_score"] == 900


def test_rank_players_tie_breaks_by_time():
    players = [
        {"user_id": 1, "correct": 5, "wrong": 5, "total_time_ms": 20000, "points": 600},
        {"user_id": 2, "correct": 5, "wrong": 5, "total_time_ms": 18000, "points": 600},
    ]
    ranked = rank_players(players)
    # 同分,时短者胜:user 2 first
    assert ranked[0]["user_id"] == 2 and ranked[0]["rank"] == 1
    assert ranked[1]["user_id"] == 1 and ranked[1]["rank"] == 2


def test_rank_players_accuracy_computed():
    players = [
        {"user_id": 1, "correct": 3, "wrong": 1, "total_time_ms": 1000, "points": 300},
        {"user_id": 2, "correct": 0, "wrong": 0, "total_time_ms": 0, "points": 0},
    ]
    ranked = rank_players(players)
    by_uid = {p["user_id"]: p for p in ranked}
    assert by_uid[1]["accuracy"] == 75.0
    assert by_uid[2]["accuracy"] == 0.0  # 无作答不除零


# ---------- 实时榜单 ----------

class _PS:
    def __init__(self, user_id, nickname, points, total_time_ms, correct=0, wrong=0,
                 streak=0, current_word_idx=0, online=True):
        self.user_id = user_id
        self.nickname = nickname
        self.points = points
        self.total_time_ms = total_time_ms
        self.correct = correct
        self.wrong = wrong
        self.streak = streak
        self.current_word_idx = current_word_idx
        self.online = online


class _Room:
    def __init__(self, players):
        self.players = {p.user_id: p for p in players}


def test_live_ranking_orders_and_ranks():
    room = _Room([
        _PS(1, "甲", points=200, total_time_ms=5000, streak=2),
        _PS(2, "乙", points=350, total_time_ms=6000, streak=3),
        _PS(3, "丙", points=200, total_time_ms=4000, online=False),
    ])
    items = live_ranking(room)
    assert [it["user_id"] for it in items] == [2, 3, 1]  # 同分 3 比 1 时短
    assert [it["rank"] for it in items] == [1, 2, 3]
    assert items[0]["streak"] == 3
    assert items[1]["online"] is False


def test_base_points_for_word_grades_takes_earliest_tier():
    from app.services.pk.score import base_points_for_word_grades
    # 同时出现在三年级和高一书里 → 按小学(最早学段)
    assert base_points_for_word_grades(["高一", "三年级"]) == 100
    assert base_points_for_word_grades(["高二"]) == 150
    assert base_points_for_word_grades(["七年级", "高一"]) == 120
    assert base_points_for_word_grades([None]) == 100
    assert base_points_for_word_grades([]) == 100
