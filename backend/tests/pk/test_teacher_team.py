"""教师组织房 + 分组 PK 的单元测试(本次新增功能)。

覆盖:
- 教师建房 host_is_player=False:房主不进 players、不占玩家名额,但占 USER_ACTIVE
- 分组赛入房自动均衡分队;set_player_team 手动调队
- 教师房最后一名学生退出不解散(生命周期归教师);close_room 才解散
- team_ranking 队伍聚合;select_words_with_fallback 共同词不足时补齐
"""
import random
import pytest
from app.services.pk import manager
from app.services.pk.score import team_ranking, live_ranking
from app.services.pk.engine import select_words_with_fallback


@pytest.fixture(autouse=True)
def reset_manager():
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()
    yield
    manager.ROOMS.clear()
    manager.INVITE_INDEX.clear()
    manager.USER_ACTIVE.clear()


# ---------- 教师组织房:房主不下场 ----------

def test_teacher_room_host_not_a_player():
    room = manager.create_room(host_id=100, max_players=8, org_id=1, host_is_player=False)
    assert room.host_is_player is False
    assert 100 not in room.players           # 教师不作为玩家
    assert room.host_id == 100
    assert manager.USER_ACTIVE[100] == room.room_id  # 仍占用,防重复建房


def test_teacher_cannot_open_two_rooms():
    manager.create_room(host_id=100, max_players=8, org_id=1, host_is_player=False)
    with pytest.raises(manager.UserAlreadyInRoom):
        manager.create_room(host_id=100, max_players=8, org_id=1, host_is_player=False)


def test_teacher_room_survives_empty_after_students_leave():
    room = manager.create_room(host_id=100, max_players=8, org_id=1, host_is_player=False)
    manager.join_room(invite_code=room.invite_code, user_id=1, nickname="A", org_id=1)
    manager.leave_room(room.room_id, 1)
    # 学生走空,教师房不解散(教师仍掌控生命周期)
    assert manager.get_room(room.room_id) is not None
    # 教师主动解散才真正回收
    manager.close_room(room.room_id)
    assert manager.get_room(room.room_id) is None
    assert 100 not in manager.USER_ACTIVE


def test_student_room_still_abandons_when_empty():
    # 老行为(房主下场)不受影响:走空即解散
    room = manager.create_room(host_id=1, max_players=4, org_id=1)  # host_is_player 默认 True
    assert 1 in room.players
    manager.leave_room(room.room_id, 1)
    assert manager.get_room(room.room_id) is None


# ---------- 分组赛:均衡分队 + 手动调队 ----------

def test_team_mode_balances_assignment():
    room = manager.create_room(host_id=100, max_players=8, org_id=1,
                               mode="team", team_count=2, host_is_player=False)
    for uid in (1, 2, 3, 4):
        manager.join_room(invite_code=room.invite_code, user_id=uid, nickname=f"U{uid}", org_id=1)
    teams = [room.players[uid].team for uid in (1, 2, 3, 4)]
    # 4 人 2 队 → 每队 2 人
    assert sorted(teams) == [1, 1, 2, 2]


def test_set_player_team_manual_override():
    room = manager.create_room(host_id=100, max_players=8, org_id=1,
                               mode="team", team_count=2, host_is_player=False)
    manager.join_room(invite_code=room.invite_code, user_id=1, nickname="A", org_id=1)
    manager.set_player_team(room.room_id, 1, 2)
    assert room.players[1].team == 2
    # 越界队号被夹取
    manager.set_player_team(room.room_id, 1, 99)
    assert room.players[1].team == 2


def test_individual_mode_has_no_teams():
    room = manager.create_room(host_id=100, max_players=8, org_id=1, host_is_player=False)
    manager.join_room(invite_code=room.invite_code, user_id=1, nickname="A", org_id=1)
    assert room.players[1].team is None
    # 个人赛调队无效
    assert manager.set_player_team(room.room_id, 1, 2) is None


# ---------- team_ranking 聚合 ----------

class _Room:
    def __init__(self, players, team_count=2):
        self.players = {p.user_id: p for p in players}
        self.team_count = team_count


class _PS:
    def __init__(self, uid, points, correct, wrong, time_ms, team, online=True):
        self.user_id = uid
        self.nickname = f"U{uid}"
        self.points = points
        self.correct = correct
        self.wrong = wrong
        self.total_time_ms = time_ms
        self.team = team
        self.online = online
        self.streak = 0
        self.current_word_idx = 0


def test_team_ranking_aggregates_and_orders():
    room = _Room([
        _PS(1, 100, 2, 0, 3000, team=1),
        _PS(2, 50, 1, 1, 4000, team=1),
        _PS(3, 200, 3, 0, 2000, team=2),
    ], team_count=2)
    board = team_ranking(room)
    by_team = {t["team"]: t for t in board}
    assert by_team[1]["points"] == 150 and by_team[1]["member_count"] == 2
    assert by_team[2]["points"] == 200 and by_team[2]["member_count"] == 1
    # 人均分:队1=75,队2=200 → 队2 第一
    assert by_team[1]["avg_points"] == 75.0
    assert by_team[2]["avg_points"] == 200.0
    assert by_team[2]["rank"] == 1 and by_team[1]["rank"] == 2


def test_team_ranking_by_average_not_total():
    # 人多的队总分高但人均低,不应因人数占优:队1 三人共 300(人均100),队2 两人共 240(人均120)
    room = _Room([
        _PS(1, 100, 1, 0, 1000, team=1),
        _PS(2, 100, 1, 0, 1000, team=1),
        _PS(3, 100, 1, 0, 1000, team=1),
        _PS(4, 120, 1, 0, 1000, team=2),
        _PS(5, 120, 1, 0, 1000, team=2),
    ], team_count=2)
    board = team_ranking(room)
    by_team = {t["team"]: t for t in board}
    assert by_team[1]["points"] == 300 and by_team[2]["points"] == 240  # 队1 总分更高
    assert by_team[2]["rank"] == 1  # 但人均分高的队2 排第一(公平)


def test_team_ranking_lists_empty_teams():
    room = _Room([_PS(1, 100, 1, 0, 1000, team=1)], team_count=3)
    board = team_ranking(room)
    assert len(board) == 3  # 空队也列出,教师等待室可见全部队号


# ---------- 选词兜底 ----------

def test_word_fallback_pads_when_common_insufficient():
    learned = {1: {10, 11}, 2: {11, 12}}   # 共同词只有 {11}
    pool = {10, 11, 12, 13, 14}
    chosen, common = select_words_with_fallback(
        learned, word_count=4, rng=random, min_common=4, fill_pool=pool,
    )
    assert common == 1
    assert len(chosen) == 4                 # 补齐到 4 个
    assert 11 in chosen                     # 共同词优先入选
    assert set(chosen) <= pool


def test_word_fallback_no_pool_keeps_strict_intersection():
    learned = {1: {10, 11, 12, 13, 14}, 2: {10, 11, 12, 13, 14}}
    chosen, common = select_words_with_fallback(
        learned, word_count=3, rng=random, min_common=4, fill_pool=None,
    )
    assert common == 5
    assert len(chosen) == 3
    assert set(chosen) <= {10, 11, 12, 13, 14}


# ---------- 引擎兜底:空词表 / 空房不推进(#3 #6) ----------

def _playing_room(word_ids, joiners=(1,), team_count=None):
    """建教师房 → 学生在 waiting 阶段入房 → 装词表 → 切 playing。"""
    mode = "team" if team_count else "individual"
    room = manager.create_room(
        host_id=100, max_players=8, org_id=1, host_is_player=False,
        mode=mode, team_count=team_count or 2,
    )
    for uid in joiners:
        manager.join_room(invite_code=room.invite_code, user_id=uid, nickname=f"U{uid}", org_id=1)
    room.word_ids = list(word_ids)
    room.status = "playing"
    return room


def test_submit_answer_no_word_ids_no_crash():
    from app.services.pk import engine
    room = _playing_room([], joiners=(1,))  # 空词表
    # 不能因 current_word_id 取模除零而 500,应直接丢弃
    events = engine.submit_answer(
        room, user_id=1, word_idx=0, phase="classify",
        payload={"category": "x"}, time_spent_ms=1000, word_lookup={},
    )
    assert events == []


def test_force_timeout_empty_room_does_not_advance():
    from app.services.pk import engine
    room = _playing_room([1, 2], joiners=(1,))
    # 玩家全部离线(模拟走空)
    room.players[1].online = False
    events = engine.force_timeout(room, 0, "classify", {1: object(), 2: object()})
    assert events == []                       # 不推进
    assert room.current_word_idx == 0         # 题号没动
    assert room.status == "playing"           # 没被推到假终局
