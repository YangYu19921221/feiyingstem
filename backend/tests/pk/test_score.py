from app.services.pk.score import compute_final_score, rank_players


def test_compute_final_score_basic():
    # 10 题全对,总用时 30000ms => 100*10 - 30000/100 = 1000 - 300 = 700
    assert compute_final_score(correct=10, total_time_ms=30000) == 700


def test_compute_final_score_zero_correct():
    assert compute_final_score(correct=0, total_time_ms=10000) == -100


def test_compute_final_score_floor_to_int():
    # 总用时不是 100 整数倍,应该向下取整
    assert compute_final_score(correct=5, total_time_ms=12345) == 500 - 123


def test_rank_players_higher_score_first():
    players = [
        {"user_id": 1, "correct": 8, "wrong": 2, "total_time_ms": 25000},
        {"user_id": 2, "correct": 9, "wrong": 1, "total_time_ms": 30000},
        {"user_id": 3, "correct": 9, "wrong": 1, "total_time_ms": 28000},
    ]
    ranked = rank_players(players)
    # user 3: 900-280=620; user 2: 900-300=600; user 1: 800-250=550
    assert [p["user_id"] for p in ranked] == [3, 2, 1]
    assert ranked[0]["rank"] == 1 and ranked[0]["final_score"] == 620
    assert ranked[1]["rank"] == 2 and ranked[1]["final_score"] == 600
    assert ranked[2]["rank"] == 3 and ranked[2]["final_score"] == 550


def test_rank_players_tie_breaks_by_time():
    players = [
        {"user_id": 1, "correct": 5, "wrong": 5, "total_time_ms": 20000},
        {"user_id": 2, "correct": 5, "wrong": 5, "total_time_ms": 18000},
    ]
    ranked = rank_players(players)
    # 同对/错,时短者胜:user 2 first
    assert ranked[0]["user_id"] == 2 and ranked[0]["rank"] == 1
    assert ranked[1]["user_id"] == 1 and ranked[1]["rank"] == 2
