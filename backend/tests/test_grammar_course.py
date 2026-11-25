"""语法小课(句子积木): 内容自检 + 上课接口。规则见 services/grammar_course.py 文件头

守的几件事:
- 下发的题里没有答案;每道题用它自己的答案交卷都判对(写课写错了在这里就拦下)
- 样课阶段学生进不来,老师能进;开放范围改了学生才进得来
- 同一步错两次才把答案指给他看;「自己练」错过的不算一次做对
- 一道题的几步要按顺序交,交错了 409 并带上现在的进度;别人的上课记录 404
- 没上完再点开是接着上,上完了 / 要求重来是新的一次
"""
import json
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from jose import jwt
from sqlalchemy import text as sql_text

from app.core.config import settings
from app.grammar import course as C
from app.grammar import items as I
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services import grammar_course as gc

PUBLIC_KEYS = {"key", "type", "level", "parts", "prompt", "scene", "zh", "rows", "options", "audio", "cards", "ask",
               "insert", "pool", "bins", "items"}


def _headers(user_id: int) -> dict:
    token = jwt.encode({"sub": str(user_id), "exp": datetime.utcnow() + timedelta(hours=1)},
                       settings.SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def people(db_session):
    """一个机构里: 一位老师、两个学生。用户名用纯字母(LIKE 里下划线是通配符,带下划线的测试名误删过真账号)"""
    await db_session.execute(sql_text(
        "INSERT INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9901, '测试机构', 'testorg', 'active', 'assigned')"
    ))
    users = {
        "teacher": User(username="tchgrammar", email="tchgrammar@example.com", hashed_password="x", role="teacher",
                        full_name="语法老师", is_active=True, org_id=9901),
        "kid": User(username="kidgrammar", email="kidgrammar@example.com", hashed_password="x", role="student",
                    full_name="小明", is_active=True, org_id=9901),
        "other": User(username="kidother", email="kidother@example.com", hashed_password="x", role="student",
                      full_name="小红", is_active=True, org_id=9901),
    }
    db_session.add_all(users.values())
    await db_session.commit()
    out = {}
    for name, u in users.items():
        await db_session.refresh(u)
        out[name] = _headers(u.id)
    return out


async def _open_to(db_session, scope: str) -> None:
    db_session.add(SystemConfig(config_key=gc.SETTINGS_KEY, config_value=json.dumps({"scope": scope}),
                                config_type="json"))
    await db_session.commit()


async def _start(client, headers, lesson_id: int, fresh: bool = False):
    r = await client.post(f"/api/v1/student/grammar/lessons/{lesson_id}/start", json={"fresh": fresh}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _answer(client, headers, run_id: int, key: str, part: int, answer):
    return await client.post(f"/api/v1/student/grammar/runs/{run_id}/answer",
                             json={"key": key, "part": part, "answer": answer}, headers=headers)


async def _do_item(client, headers, run_id: int, it: dict) -> dict:
    """把一道题老老实实做对,回最后一步的响应"""
    last = {}
    for p in range(I.parts(it)):
        r = await _answer(client, headers, run_id, it["key"], p, I.show(it, p))
        assert r.status_code == 200, r.text
        last = r.json()
        assert last["ok"] is True, (it["key"], p)
    assert last["done"] is True
    return last


# ---------------------------------------------------------------- 内容

def test_every_item_hides_its_answer_and_grades_it_right():
    assert len(gc.LESSONS) >= 10
    for ls in gc.LESSONS.values():
        assert len(ls["practice"]) >= 5, ls["id"]
        for it in C.all_items(ls):
            pub = I.public(it)
            assert set(pub) <= PUBLIC_KEYS, (it["key"], set(pub) - PUBLIC_KEYS)
            for p in range(I.parts(it)):
                ok, _ = I.grade(it, p, I.show(it, p))
                assert ok, (it["key"], p)
        # 错法挂的名字,这节课都得有对应的那句话(否则判错时退回通用的那句,等于白挂)
        for it in C.all_items(ls):
            for code in (it.get("wrong") or {}).values():
                assert code in ls["misc"], (it["key"], code)


def test_lesson_view_carries_no_pool_items():
    """回头考的题还没接,不能提前发下去"""
    ls = gc.LESSONS[101]
    view = json.dumps(gc.lesson_view(ls), ensure_ascii=False)
    for it in ls["pool"]:
        assert f'"{it["key"]}"' not in view


# ---------------------------------------------------------------- 谁能进

@pytest.mark.asyncio
async def test_sample_stage_is_staff_only(client, people):
    r = await client.get("/api/v1/student/grammar/lessons", headers=people["kid"])
    assert r.status_code == 200
    assert r.json()["enabled"] is False and r.json()["reason"]
    assert r.json()["lines"] == []          # 进不来的时候,课的名字也不发下去
    r = await client.post("/api/v1/student/grammar/lessons/101/start", json={}, headers=people["kid"])
    assert r.status_code == 403 and r.json()["detail"]["code"] == "grammar_closed"

    r = await client.get("/api/v1/student/grammar/lessons", headers=people["teacher"])
    body = r.json()
    assert body["enabled"] is True and body["preview"] is True
    assert [x["id"] for x in body["lines"][0]["lessons"]][:3] == [101, 102, 103]
    assert all(x["done"] is False for x in body["lines"][0]["lessons"])


@pytest.mark.asyncio
async def test_scope_decides_which_students_get_in(client, people, db_session):
    await _open_to(db_session, "hq")          # 只开直营: 测试机构的学生还是进不来
    r = await client.post("/api/v1/student/grammar/lessons/101/start", json={}, headers=people["kid"])
    assert r.status_code == 403
    row = (await db_session.execute(sql_text("SELECT id FROM system_configs WHERE config_key = :k"),
                                    {"k": gc.SETTINGS_KEY})).scalar_one()
    await db_session.execute(sql_text("UPDATE system_configs SET config_value = :v WHERE id = :i"),
                             {"v": json.dumps({"scope": "all"}), "i": row})
    await db_session.commit()
    view = await _start(client, people["kid"], 101)
    assert view["run_id"] and view["resumed"] is False


@pytest.mark.asyncio
async def test_dashboard_entry_is_for_admin_and_hq_staff_only(client, people, db_session):
    """工作台上的入口: 平台管理员和直营老师有;分校老师没有(但知道地址仍然进得去);开给所有学生以后各机构都有"""
    await db_session.execute(sql_text(
        "INSERT INTO organizations (id, name, code, status, access_mode) VALUES (1, '直营', 'HQ001', 'active', 'assigned')"))
    hq = User(username="tchhq", email="tchhq@example.com", hashed_password="x", role="teacher", full_name="直营老师",
              is_active=True, org_id=1)
    boss = User(username="bossadmin", email="bossadmin@example.com", hashed_password="x", role="admin",
                full_name="平台管理员", is_active=True, org_id=1)
    db_session.add_all([hq, boss])
    await db_session.commit()
    await db_session.refresh(hq)
    await db_session.refresh(boss)

    async def entry(headers):
        r = await client.get("/api/v1/student/grammar/lessons", headers=headers)
        assert r.status_code == 200
        return r.json()["enabled"], r.json()["entry"]

    assert await entry(_headers(boss.id)) == (True, True)
    assert await entry(_headers(hq.id)) == (True, True)
    assert await entry(people["teacher"]) == (True, False)      # 分校老师: 进得去,但工作台上不放入口
    assert await entry(people["kid"]) == (False, False)

    await _open_to(db_session, "all")
    assert await entry(people["teacher"]) == (True, True)
    assert await entry(people["kid"]) == (True, False)          # 学生不是工作台的入口


# ---------------------------------------------------------------- 上课

@pytest.mark.asyncio
async def test_walk_a_whole_lesson(client, people):
    ls = gc.LESSONS[101]
    view = await _start(client, people["teacher"], 101)
    run_id = view["run_id"]
    # 发下来的东西里没有答案
    for st in view["steps"]:
        if st["kind"] == "item":
            assert set(st["item"]) <= PUBLIC_KEYS
    for it in view["practice"]:
        assert set(it) <= PUBLIC_KEYS
    assert all(v == {"part": 0, "tries": 0, "wrong": 0, "done": False} for v in view["state"].values())
    assert view["finish"] is None

    items = gc.run_items(ls)
    last = {}
    for n, it in enumerate(items):
        last = await _do_item(client, people["teacher"], run_id, it)
        if it["type"] != "sort":
            assert last["reveal"]["rows"] and last["reveal"]["audio"]
        assert last["praise"]["text"]
        assert (last["finish"] is not None) == (n == len(items) - 1)
    assert last["finish"]["total"] == len(ls["practice"])
    assert last["finish"]["first_right"] == len(ls["practice"])
    assert last["finish"]["good"] is True and last["finish"]["say"]["text"] == C.LINES["done_good"]

    r = await client.get("/api/v1/student/grammar/lessons", headers=people["teacher"])
    first = r.json()["lines"][0]["lessons"][0]
    assert first["done"] is True and first["times"] == 1 and first["best"] == len(ls["practice"])

    # 上完了再点开 = 新的一次
    again = await _start(client, people["teacher"], 101)
    assert again["run_id"] != run_id and again["resumed"] is False


@pytest.mark.asyncio
async def test_two_misses_show_the_answer_and_it_no_longer_counts_as_first_try(client, people):
    ls = gc.LESSONS[101]
    view = await _start(client, people["teacher"], 101)
    run_id = view["run_id"]
    it = next(x for x in ls["practice"] if x["type"] == "pick")
    right = I.show(it, 0)
    wrong = (right + 1) % len(it["options"])

    r = (await _answer(client, people["teacher"], run_id, it["key"], 0, wrong)).json()
    assert r["ok"] is False and r["hint"]["text"] and "show" not in r and r["tries"] == 1
    assert "reveal" not in r                       # 没做完不给整句

    r = (await _answer(client, people["teacher"], run_id, it["key"], 0, wrong)).json()
    assert r["ok"] is False and r["show"] == right and r["show_say"]["text"] == C.LINES["show"]

    r = (await _answer(client, people["teacher"], run_id, it["key"], 0, right)).json()
    assert r["ok"] is True and r["done"] is True and r["wrong"] == 2

    last = {}
    for other in gc.run_items(ls):
        if other["key"] != it["key"]:
            last = await _do_item(client, people["teacher"], run_id, other)
    assert last["finish"]["first_right"] == last["finish"]["total"] - 1


@pytest.mark.asyncio
async def test_parts_go_in_order_and_stale_taps_get_409_with_state(client, people):
    ls = gc.LESSONS[101]
    view = await _start(client, people["teacher"], 101)
    run_id = view["run_id"]
    it = next(x for x in ls["practice"] if x["type"] == "fix")

    r = await _answer(client, people["teacher"], run_id, it["key"], 1, I.show(it, 1))    # 跳过第一步
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "stale" and d["state"][it["key"]]["part"] == 0

    r = await _answer(client, people["teacher"], run_id, it["key"], 0, I.show(it, 0))
    body = r.json()
    assert body["ok"] is True and body["done"] is False and body["next"]["options"]

    r = await _answer(client, people["teacher"], run_id, it["key"], 0, I.show(it, 0))    # 同一步再交一遍
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["state"][it["key"]]["part"] == 1 and d["state"][it["key"]]["next"]["options"]

    r = await _answer(client, people["teacher"], run_id, it["key"], 1, I.show(it, 1))
    assert r.json()["done"] is True
    r = await _answer(client, people["teacher"], run_id, it["key"], 1, I.show(it, 1))    # 做完了再交
    assert r.status_code == 409
    # 做完了,拿「下一步」的号再交(这道题一共两步,没有第 3 步): 不能再判、不能给它记错
    r = await _answer(client, people["teacher"], run_id, it["key"], I.parts(it), 0)
    assert r.status_code == 409
    st = r.json()["detail"]["state"][it["key"]]
    assert st["done"] is True and st["wrong"] == 0


@pytest.mark.asyncio
async def test_two_devices_answering_at_once_only_one_lands(client, people, db_session):
    """两台设备(或连点)同时交同一步: 按 version 条件更新,后到的那个算进度旧了,不能把进度写乱"""
    from sqlalchemy import select
    from app.models.grammar import GrammarRun

    ls = gc.LESSONS[101]
    view = await _start(client, people["teacher"], 101)
    it = next(x for x in ls["practice"] if x["type"] == "pick")
    run = (await db_session.execute(select(GrammarRun).where(GrammarRun.id == view["run_id"]))).scalar_one()
    # 另一台设备先交了一次(这里直接把库里的版本号推进一格;手里这个 run 对象还是旧版本)
    await db_session.execute(sql_text("UPDATE grammar_runs SET version = version + 1 WHERE id = :i"), {"i": run.id})
    await db_session.commit()
    assert run.version == 0
    with pytest.raises(gc.Stale):
        await gc.answer(db_session, run, ls, it["key"], 0, I.show(it, 0))
    saved = (await db_session.execute(sql_text("SELECT state, version FROM grammar_runs WHERE id = :i"),
                                      {"i": view["run_id"]})).one()
    assert json.loads(saved[0]) == {"items": {}} and saved[1] == 1


@pytest.mark.asyncio
async def test_resume_within_window_and_fresh_restarts(client, people, db_session):
    await _open_to(db_session, "all")
    ls = gc.LESSONS[102]
    view = await _start(client, people["kid"], 102)
    first = gc.run_items(ls)[0]
    await _do_item(client, people["kid"], view["run_id"], first)

    again = await _start(client, people["kid"], 102)
    assert again["run_id"] == view["run_id"] and again["resumed"] is True
    assert again["state"][first["key"]]["done"] is True

    fresh = await _start(client, people["kid"], 102, fresh=True)
    assert fresh["run_id"] != view["run_id"] and fresh["state"][first["key"]]["done"] is False

    # 放了很久的不接着上
    old = (datetime.utcnow() - timedelta(hours=gc.RESUME_HOURS + 1)).strftime("%Y-%m-%d %H:%M:%S.%f")
    await db_session.execute(sql_text("UPDATE grammar_runs SET started_at = :t WHERE id = :i"),
                             {"t": old, "i": fresh["run_id"]})
    await db_session.commit()
    later = await _start(client, people["kid"], 102)
    assert later["run_id"] not in (view["run_id"], fresh["run_id"])


@pytest.mark.asyncio
async def test_someone_elses_run_and_unknown_things_are_404(client, people, db_session):
    await _open_to(db_session, "all")
    ls = gc.LESSONS[101]
    view = await _start(client, people["kid"], 101)
    it = gc.run_items(ls)[0]

    r = await _answer(client, people["other"], view["run_id"], it["key"], 0, I.show(it, 0))
    assert r.status_code == 404
    r = await client.get(f"/api/v1/student/grammar/runs/{view['run_id']}", headers=people["other"])
    assert r.status_code == 404

    r = await _answer(client, people["kid"], view["run_id"], "101.nope", 0, 0)
    assert r.status_code == 404
    # 回头考的题不在这次上课里,交了也不认
    r = await _answer(client, people["kid"], view["run_id"], ls["pool"][0]["key"], 0, I.show(ls["pool"][0], 0))
    assert r.status_code == 404
    r = await client.post("/api/v1/student/grammar/lessons/999/start", json={}, headers=people["kid"])
    assert r.status_code == 404
