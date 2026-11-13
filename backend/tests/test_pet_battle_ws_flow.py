"""宠物对战 · 真走 WebSocket 打完整场(2026-11-12)

起因: 对战打到一半卡死 —— 孩子的页面永远停在「已提交答案 等待对手答题…」。
根因(线上 35 天的日志里 37 次): AI 的答题任务是另起的 asyncio 任务,却和对战主连接的驱动循环**共用同一个
数据库会话**。它 refresh(battle) 的那几毫秒里 battle 对象是「过期」的,驱动循环等答案时每 0.1 秒读一次
battle.player1_id —— 正好撞上就是在协程外面触发懒加载 → MissingGreenlet,驱动循环死掉,再没有人发下一题。

这里起一个真的 uvicorn(单独的线程、单独的事件循环)+ 文件型 SQLite,用 websockets 客户端当孩子:
  1. 闯关赢 / 闯关输 / 练习赛 各打一整场: 每回合都有 round_result、最后有 battle_end、库里 finished、
     闯关进度和星星对、赢了体力回满;「看中文选英文」出题时不带单词
  2. 专压那个竞态: 把 AI 那边 refresh(battle) 人为拖到 0.25 秒(对象过期着、事件循环空着),孩子每题都比 AI 先答,
     打满 10 回合 —— 改之前的代码第 1 回合就死
  3. 驱动循环出意外退出: 页面收到 driver_crashed,重新连上来接着打 ——
     孩子这一回合交过的答案不作废(不用再答一遍)、AI 不再出一次招、同一回合不结算两次
  4. 交上来的答案回合号对不上的,不算到这一回合头上
"""
import asyncio
import inspect
import json
import threading
import time

import httpx
import pytest
import pytest_asyncio
import uvicorn
import websockets
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.student import pet_battle_ws as ws_mod
from app.core import pet_formulas, tenancy
from app.core.database import Base, get_db
from app.core.pet_formulas import calculate_max_hp
from app.main import app
from app.models.organization import Organization
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle, PetBattleRound
from app.models.pet_trial import PetTrialStage
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.services import battle_tickets
from app.services import pet_battle_service as svc
from tests.conftest import _make_token

AI_MS = 120          # AI 几毫秒后答题(孩子收到题马上答,所以每一题孩子都比 AI 先答)
AI_RIGHT = {"v": False}   # 这一场 AI 每题答对还是答错(live 这个 fixture 每个用例开头重置成答错)


@pytest_asyncio.fixture
async def live(tmp_path, monkeypatch):
    """真的 uvicorn + 文件库。给出 (地址, 会话工厂, 孩子 id)。
    NullPool: 服务在另一个线程的事件循环里跑,连接不能跨循环复用,每次现开。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'ws.db'}", poolclass=NullPool,
                                 connect_args={"timeout": 15})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    tenancy._org_cache.clear()
    async with Session() as db:
        db.add(Organization(id=1, name="直营", code="WSHQ", status="active"))
        await db.flush()
        kid = User(username="wskid", email="wskid@e.com", hashed_password="x", role="student",
                   full_name="小飞", is_active=True, org_id=1)
        db.add(kid)
        await db.flush()
        db.add(UserPet(user_id=kid.id, name="皮卡", species="sparkhog", level=5, evolution_stage=1,
                       current_hp=calculate_max_hp(5, 1, "sparkhog"), is_active=True))
        for i in range(14):
            w = Word(word=f"wsword{i}")
            db.add(w)
            await db.flush()
            db.add(WordDefinition(word_id=w.id, meaning=f"意思{i}", is_primary=True))
        await battle_tickets.save_settings(db, {**await battle_tickets.get_settings(db), "enabled": False})
        await db.commit()
        kid_id = kid.id

    async def override_get_db():
        async with Session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(ws_mod, "session_factory", Session)
    monkeypatch.setattr(ws_mod, "COUNTDOWN_SECONDS", 0.05)
    monkeypatch.setattr(ws_mod, "round_gap_seconds", lambda *a, **k: 0.05)
    monkeypatch.setattr(ws_mod, "generate_ai_answer_time", lambda *_: AI_MS)
    # AI 的对错也定死(默认每题答错;要它答对的用例改 AI_RIGHT["v"])。不定死的话它 0.12 秒就答、
    # 拿满速度加成,练习赛里一成左右的机会打赢或打平 —— 用例时过时不过
    AI_RIGHT["v"] = False
    monkeypatch.setattr(ws_mod, "ai_should_answer_correctly", lambda *_: AI_RIGHT["v"])

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, lifespan="off", log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        await asyncio.sleep(0.02)
    assert server.started, "测试用的服务没起来"
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"127.0.0.1:{port}", Session, kid_id
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.pop(get_db, None)
        ws_mod.manager.round_answers.clear()
        ws_mod.manager.driver_battles.clear()
        tenancy._org_cache.clear()
        await engine.dispose()


def _auth(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _open_battle(host, uid, path):
    async with httpx.AsyncClient(base_url=f"http://{host}", headers=_auth(uid), timeout=20) as c:
        r = await c.post(path)
        assert r.status_code == 200, r.text
        return r.json()


async def _answers_of(Session, battle_id):
    async with Session() as db:
        bt = await db.get(PetBattle, battle_id)
        return json.loads(bt.questions_data)


async def _heal(Session, uid):
    async with Session() as db:
        pet = (await db.execute(select(UserPet).where(UserPet.user_id == uid, UserPet.is_active.is_(True)))).scalar_one()
        pet.is_injured = False
        pet.current_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
        await db.commit()


def _wrong(letter):
    return "B" if letter == "A" else "A"


async def _play(host, uid, battle_id, questions, *, right: bool, answer_rounds=None, timeout=30):
    """当孩子打完一场: 收到题马上答(right=答对 / 答错)。返回 (各回合的结果, battle_end, 收到的出题消息, 别的消息)"""
    token = _make_token(uid)
    results, rounds, others, end = [], [], [], None
    began = time.monotonic()
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{battle_id}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{battle_id}/answer?token={token}") as ans:
        while end is None:
            msg = json.loads(await asyncio.wait_for(main.recv(), timeout=timeout))
            kind = msg.get("type")
            if kind == "round_result" and not results:
                msg["_after_seconds"] = time.monotonic() - began
            if kind == "new_round":
                rounds.append(msg)
                n = msg["round_number"]
                if answer_rounds is None or n in answer_rounds:
                    correct = questions[n - 1]["correct_answer"]
                    await ans.send(json.dumps({
                        "type": "submit_answer", "round_number": n,
                        "answer": correct if right else _wrong(correct), "time_ms": 900, "use_ultimate": False,
                    }))
            elif kind == "round_result":
                results.append(msg)
            elif kind == "battle_end":
                end = msg
            else:
                others.append(msg)
    return results, end, rounds, others


def _check_rounds(results, rounds, questions):
    """每一回合都出了题、都有结果,回合号连着;出题的那一份没带答案"""
    assert [r["result"]["round_number"] for r in results] == list(range(1, len(results) + 1))
    assert [r["round_number"] for r in rounds] == list(range(1, len(results) + 1))
    for sent in rounds:
        q = questions[sent["round_number"] - 1]
        assert "correct_answer" not in sent["question"] and "meaning" not in sent["question"]
        assert sent["question"]["kind"] == q["kind"]
        if q["kind"] == "zh2en":
            assert sent["question"]["word"] == "", "「看中文选英文」出题时不能带单词(那就是答案)"
            assert sent["question"]["display"] == q["meaning"]
        elif q["kind"] == "listen":
            assert sent["question"]["word"] == q["word"] and sent["question"]["display"] is None
        else:
            assert sent["question"]["word"] == q["word"] == sent["question"]["display"]
    for r in results:
        q = questions[r["result"]["round_number"] - 1]
        assert r["result"]["question"]["word"] == q["word"], "结算时要给完整的单词"
        assert r["result"]["question"]["meaning"] == q["meaning"]
        assert r["result"]["question"]["correct_answer"] == q["correct_answer"]


# ---------- 1. 闯关赢 / 闯关输 / 练习赛,各打一整场 ----------

async def test_full_battles_over_real_websocket(live):
    host, Session, uid = live

    # 闯关第 1 关,每题秒答、全对 → 赢,3 星,首通,体力回满
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    results, end, rounds, others = await _play(host, uid, b["id"], qs, right=True)
    _check_rounds(results, rounds, qs)
    assert not [m for m in others if m.get("type") == "error"], others
    assert all(r["result"]["player1_correct"] for r in results)
    assert end["winner_id"] == uid
    assert end["trial"]["won"] is True and end["trial"]["stars"] == 3 and end["trial"]["first_clear"] is True
    assert end["trial"]["healed"] is True and end["trial"]["next_stage"] == 2
    assert end["player1_reward"]["trial_bonus"] == {"food": 20, "xp": 30}
    assert [x["word"] for x in end["review"]] == [q["word"] for q in qs[:len(results)]]
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        assert bt.status == "finished" and bt.winner_id == uid and bt.current_round == len(results)
        row = (await db.execute(select(PetTrialStage).where(PetTrialStage.user_id == uid))).scalar_one()
        assert (row.stage, row.stars, row.attempts) == (1, 3, 1) and row.first_cleared_at is not None
        pet = (await db.execute(select(UserPet).where(UserPet.user_id == uid, UserPet.is_active.is_(True)))).scalar_one()
        assert pet.is_injured is False
        assert pet.current_hp == calculate_max_hp(pet.level, pet.evolution_stage, pet.species), "闯关赢了体力回满"

    # 闯关第 2 关,每题都答错、AI 每题答对 → 输,不算通过,宠物受伤(不回血)
    AI_RIGHT["v"] = True
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/2/start")
    qs = await _answers_of(Session, b["id"])
    results, end, rounds, others = await _play(host, uid, b["id"], qs, right=False)
    _check_rounds(results, rounds, qs)
    assert not [m for m in others if m.get("type") == "error"], others
    assert end["winner_id"] == svc.AI_USER_ID
    assert end["trial"]["won"] is False and end["trial"]["stars"] == 0 and end["trial"]["healed"] is False
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        assert bt.status == "finished" and bt.player1_hp == 0
        rows = (await db.execute(select(PetTrialStage).where(PetTrialStage.user_id == uid)
                                 .order_by(PetTrialStage.stage))).scalars().all()
        assert [(r.stage, r.stars, r.first_cleared_at is not None) for r in rows] == [(1, 3, True), (2, 0, False)]
        pet = (await db.execute(select(UserPet).where(UserPet.user_id == uid, UserPet.is_active.is_(True)))).scalar_one()
        assert pet.is_injured is True and pet.current_hp == 0

    # 练习赛,全对 → 打完;不是闯关,结束消息里没有闯关那一段
    AI_RIGHT["v"] = False
    await _heal(Session, uid)
    b = await _open_battle(host, uid, "/api/v1/student/battle/quick-match")
    qs = await _answers_of(Session, b["id"])
    results, end, rounds, others = await _play(host, uid, b["id"], qs, right=True)
    _check_rounds(results, rounds, qs)
    assert not [m for m in others if m.get("type") == "error"], others
    assert end["winner_id"] == uid and end.get("trial") is None
    async with Session() as db:
        assert (await db.get(PetBattle, b["id"])).status == "finished"
        assert (await db.execute(select(func.count()).select_from(PetBattle)
                                 .where(PetBattle.status == "active"))).scalar() == 0


# ---------- 2. 竞态: AI 那边 refresh(battle) 的时候,驱动循环在轮询 ----------

async def test_driver_survives_ai_refresh_window(live, monkeypatch):
    """把 refresh(battle) 人为拖长: 先让对象过期(refresh 本来第一步就是这个),空出事件循环 0.15 秒,再真的刷新。
    AI 的答题任务要是还和驱动循环共用一个会话、驱动循环的轮询又在读 battle 的属性,
    0.1 秒一次的轮询必然在这 0.15 秒里读到过期的对象 → MissingGreenlet → 驱动循环死掉。
    (两道防线: AI 用自己的会话 + 轮询里不读 ORM 属性。只拆一道这个用例仍然过,两道都拆才死 ——
    所以下面另有两条盯着源码的用例,一道一道地锁)"""
    host, Session, uid = live
    real_refresh = AsyncSession.refresh

    async def slow_refresh(self, instance, *args, **kwargs):
        if isinstance(instance, PetBattle):
            self.sync_session.expire(instance)
            await asyncio.sleep(0.15)
        return await real_refresh(self, instance, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "refresh", slow_refresh)
    # 两边都答错(各扣自己 10 点;AI 答错是 fixture 定死的): 谁也打不死谁,打满 10 回合 = 10 次「孩子先答、AI 后答」

    for _ in range(1):
        await _heal(Session, uid)
        b = await _open_battle(host, uid, "/api/v1/student/battle/quick-match")
        qs = await _answers_of(Session, b["id"])
        results, end, rounds, others = await _play(host, uid, b["id"], qs, right=False, timeout=40)
        assert not [m for m in others if m.get("type") == "error"], others
        assert len(results) == 10, "两边都只扣自己的血,应该打满 10 回合"
        _check_rounds(results, rounds, qs)
        assert end is not None
        async with Session() as db:
            bt = await db.get(PetBattle, b["id"])
            assert bt.status == "finished" and bt.current_round == 10
            # 每一回合两边的答案都记上了(AI 是在它自己的会话里记的)
            got = (await db.execute(select(PetBattleRound).where(PetBattleRound.battle_id == b["id"])
                                    .order_by(PetBattleRound.round_number))).scalars().all()
            assert len(got) == 10 and all(r.player1_answer and r.player2_answer for r in got)


# ---------- 3. 驱动循环出意外: 重新连上来接着打 ----------

async def _play_through_crash(host, uid, battle_id, questions, before_reconnect=None):
    """第一条连接打到收到 driver_crashed 为止;然后重新连上来,**第 2 回合不再答**,后面的照常答。
    返回 (第一条连接收到的, 重连后各回合的结果, battle_end, 重连后收到的出题消息)"""
    token = _make_token(uid)
    first, crashed = [], None
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{battle_id}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{battle_id}/answer?token={token}") as ans:
        while crashed is None:
            msg = json.loads(await asyncio.wait_for(main.recv(), timeout=20))
            first.append(msg)
            if msg.get("type") == "new_round":
                n = msg["round_number"]
                await ans.send(json.dumps({"type": "submit_answer", "round_number": n,
                                           "answer": questions[n - 1]["correct_answer"], "time_ms": 900}))
            elif msg.get("type") == "error":
                crashed = msg
        # 出意外以后服务端会把这条连接关掉
        with pytest.raises(websockets.ConnectionClosed):
            for _ in range(20):
                await asyncio.wait_for(main.recv(), timeout=5)
    if before_reconnect:
        before_reconnect()
    results, end, rounds, others = await _play(host, uid, battle_id, questions, right=True,
                                               answer_rounds=set(range(3, 11)))
    assert not [m for m in others if m.get("type") == "error"], others
    return first, crashed, results, end, rounds


async def test_reconnect_after_crash_keeps_the_childs_answer_in_memory(live, monkeypatch):
    """等答案的时候出意外(孩子的答案只在内存里、还没进库): 重新接上以后第 2 回合直接出结果,用的是孩子原来交的答案"""
    host, Session, uid = live
    real = ws_mod.manager.both_answered
    state = {"done": False}

    def boom(battle_id, p1, p2, round_number=None):
        ok = real(battle_id, p1, p2, round_number)
        # 第 2 回合两边都答完的那一刻炸一次(这时 AI 的答案已经进库,孩子的还在内存里)
        if ok and round_number == 2 and not state["done"]:
            state["done"] = True
            raise RuntimeError("测试: 驱动循环出意外")
        return ok

    monkeypatch.setattr(ws_mod.manager, "both_answered", boom)

    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    first, crashed, results, end, rounds = await _play_through_crash(host, uid, b["id"], qs)

    assert crashed["code"] == "driver_crashed" and "RuntimeError" not in crashed["message"]
    assert "测试" not in crashed["message"], "报错原文不能发给孩子"
    assert [m["result"]["round_number"] for m in first if m.get("type") == "round_result"] == [1]
    # 重新接上: 从第 2 回合接着打(第 1 回合不重放)
    assert rounds[0]["round_number"] == 2 and results[0]["result"]["round_number"] == 2
    assert results[0]["_after_seconds"] < 6, "重连后这一回合该马上出结果,不是干等到超时"
    r2 = results[0]["result"]
    assert r2["player1_answer"] == qs[1]["correct_answer"] and r2["player1_correct"] is True, \
        "孩子断线前交的答案要算数(重连后没有再答第 2 回合)"
    assert r2["player1_time_ms"] == 900
    assert end["winner_id"] == uid and end["trial"]["stars"] == 3
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        assert bt.status == "finished"
        got = (await db.execute(select(PetBattleRound).where(PetBattleRound.battle_id == b["id"])
                                .order_by(PetBattleRound.round_number))).scalars().all()
        assert [r.round_number for r in got] == list(range(1, len(got) + 1)), "同一回合不能有两行"
        # AI 在第 2 回合只出了一次招: 它的答案还是断线前记下的那一个
        assert got[1].player2_answer in ("A", "B", "C", "D")
        # 血量对得上每回合的伤害,没有哪一回合被算了两遍
        dealt = sum(r.player1_damage for r in got if (r.player1_damage or 0) > 0)
        self_hit = sum(-r.player2_damage for r in got if (r.player2_damage or 0) < 0)
        assert bt.player2_initial_hp - bt.player2_hp == min(bt.player2_initial_hp, dealt + self_hit)


async def test_reconnect_after_crash_does_not_settle_a_round_twice(live, monkeypatch):
    """两边的答案都进了库、结算前出意外,而且内存里留的答案也没了(当成服务重启过):
    重新接上以后靠库里记下的答案接着打 —— 第 2 回合马上结算、只结算一次,孩子不用再答,AI 也不再出一次招"""
    host, Session, uid = live
    real = svc.finalize_round
    state = {"done": False}

    async def boom(db, battle_id, round_number):
        if round_number == 2 and not state["done"]:
            state["done"] = True
            raise RuntimeError("测试: 结算前出意外")
        return await real(db, battle_id, round_number)

    monkeypatch.setattr(svc, "finalize_round", boom)

    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    first, crashed, results, end, rounds = await _play_through_crash(
        host, uid, b["id"], qs, before_reconnect=ws_mod.manager.round_answers.clear)

    assert crashed["code"] == "driver_crashed"
    assert rounds[0]["round_number"] == 2 and results[0]["result"]["round_number"] == 2
    assert results[0]["_after_seconds"] < 6, "两边的答案都在库里了,重连后该马上结算,不是干等到超时"
    assert results[0]["result"]["player1_correct"] is True, "孩子的答案已经在库里,重连后不用再答"
    assert end["winner_id"] == uid
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        got = (await db.execute(select(PetBattleRound).where(PetBattleRound.battle_id == b["id"])
                                .order_by(PetBattleRound.round_number))).scalars().all()
        assert bt.status == "finished" and [r.round_number for r in got] == list(range(1, len(got) + 1))
        assert bt.player1_total_correct == len(got), "第 2 回合的答对只算一次"
        dealt = sum(r.player1_damage for r in got if (r.player1_damage or 0) > 0)
        self_hit = sum(-r.player2_damage for r in got if (r.player2_damage or 0) < 0)
        assert bt.player2_initial_hp - bt.player2_hp == min(bt.player2_initial_hp, dealt + self_hit)
    # 已经结算过的回合再结算一次: 原样返回,血量不动(第 1 回合孩子答对了,再算一遍对手一定掉血)
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        bt.status, bt.player1_hp, bt.player2_hp = "active", 500, 500
        await db.commit()
        again, _ = await real(db, b["id"], 1)
        assert (again.player1_hp, again.player2_hp) == (500, 500)


async def test_ai_failing_to_answer_does_not_stall_the_round(live, monkeypatch):
    """AI 那边答题出了错(没记上): 也要报一声,驱动循环按「超时没答」给它补一条 —— 不能让孩子干等 16 秒"""
    host, Session, uid = live
    real = svc.process_round_answer
    state = {"done": False}

    async def flaky(*args, **kwargs):
        # 驱动循环以后往这个函数多传什么参数(出招、咒语 …)这里都原样转过去
        if kwargs.get("player_id") == svc.AI_USER_ID and kwargs.get("round_number") == 1 and not state["done"]:
            state["done"] = True
            raise RuntimeError("测试: AI 答题出错")
        return await real(*args, **kwargs)

    monkeypatch.setattr(svc, "process_round_answer", flaky)
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    results, end, rounds, others = await _play(host, uid, b["id"], qs, right=True)
    assert not [m for m in others if m.get("type") == "error"], others
    assert results[0]["_after_seconds"] < 6, "AI 没记上答案,这一回合也该马上结算"
    assert results[0]["result"]["player2_answer"] == "X" and results[0]["result"]["player2_correct"] is False
    assert end["winner_id"] == uid


# ---------- 4. 回合号对不上的答案不算 ----------

async def test_answer_for_another_round_is_not_counted(live):
    host, Session, uid = live
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    token = _make_token(uid)
    monkey_timeout = 1          # 这一场每题只等 1 秒(+1 秒缓冲),不然要干等 16 秒
    async with Session() as db:
        bt = await db.get(PetBattle, b["id"])
        bt.time_per_question = monkey_timeout
        await db.commit()
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}/answer?token={token}") as ans:
        result = None
        while result is None:
            msg = json.loads(await asyncio.wait_for(main.recv(), timeout=20))
            if msg.get("type") == "new_round" and msg["round_number"] == 1:
                # 交一份正确答案,但回合号写成 7;再交一份连回合号都没有的
                await ans.send(json.dumps({"type": "submit_answer", "round_number": 7,
                                           "answer": qs[0]["correct_answer"], "time_ms": 500}))
                await ans.send(json.dumps({"type": "submit_answer", "answer": qs[0]["correct_answer"]}))
                assert json.loads(await asyncio.wait_for(ans.recv(), timeout=5))["type"] == "answer_error"
            elif msg.get("type") == "round_result":
                result = msg["result"]
        # 收场: 判负,服务端那条驱动循环下一回合开头看到对战结束就停(不然它要对着空气把剩下的回合打完)
        async with httpx.AsyncClient(base_url=f"http://{host}", headers=_auth(uid), timeout=20) as c:
            assert (await c.post(f"/api/v1/student/battle/{b['id']}/forfeit")).json()["forfeited"] is True
    assert result["round_number"] == 1
    assert result["player1_answer"] == "X" and result["player1_correct"] is False, "别的回合的答案不能算到这一回合"


# ---------- 5. 答题用时不全信页面报的 ----------

def test_fair_time_takes_the_larger_of_client_and_server():
    f = svc.fair_time_ms
    assert f(100, 6000, 16000) == 4500, "页面报 0.1 秒、服务端掐到 6 秒: 按 4.5 秒算"
    assert f(900, 950, 16000) == 900, "正常秒答: 服务端掐的减掉宽限比页面报的小,用页面的"
    assert f(5200, 5600, 16000) == 5200 and f(5200, 9000, 16000) == 7500
    assert f(100, None, 16000) == 100, "服务端没掐到: 只好信页面的"
    assert f(100, 60000, 16000) == 16000 and f(-5, 200, 16000) == 0, "夹在 0 和时限之间"
    assert svc.TIME_GRACE_MS == 1500


async def test_server_clock_overrides_a_lying_client(live):
    """页面永远报 100 毫秒: 实际过了 6 秒才答 → 按约 4.5 秒算,拿不到 3 秒内的 +10(只有 5 秒内的 +5)。
    断线重连补发题目不重新掐表;正常秒答不受影响。"""
    host, Session, uid = live
    b = await _open_battle(host, uid, "/api/v1/student/battle/trial/1/start")
    qs = await _answers_of(Session, b["id"])
    token = _make_token(uid)
    results = {}
    async with websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}?token={token}") as main, \
            websockets.connect(f"ws://{host}/api/v1/student/battle/ws/{b['id']}/answer?token={token}") as ans:
        while len(results) < 2:
            msg = json.loads(await asyncio.wait_for(main.recv(), timeout=30))
            if msg.get("type") == "new_round":
                n = msg["round_number"]
                if n == 1:
                    await asyncio.sleep(6)          # 想了 6 秒,却报 100 毫秒
                    sent = {"time_ms": 100}
                else:
                    sent = {"time_ms": 900}         # 正常秒答
                await ans.send(json.dumps({"type": "submit_answer", "round_number": n,
                                           "answer": qs[n - 1]["correct_answer"], "_recv_at": 0, **sent}))
            elif msg.get("type") == "round_result":
                results[msg["result"]["round_number"]] = msg["result"]
        async with httpx.AsyncClient(base_url=f"http://{host}", headers=_auth(uid), timeout=20) as c:
            await c.post(f"/api/v1/student/battle/{b['id']}/forfeit")
    r1, r2 = results[1], results[2]
    assert 4400 <= r1["player1_time_ms"] <= 5000, r1["player1_time_ms"]
    assert r1["player1_damage"] == 20 + 8 + 5, "按 4.5 秒算: 只有 5 秒内的 +5,没有 3 秒内的 +10"
    assert r2["player1_time_ms"] == 900, "正常秒答: 用时就是页面报的"
    assert r2["player1_damage"] == 20 + 8 + 5 + 10        # 连对 1 +5,3 秒内 +10


def test_resend_does_not_restart_the_clock():
    """同一回合补发题目(断线重连)不重新掐表: 不然断一下再连上就能把表归零"""
    m = ws_mod.BattleConnectionManager()
    m.mark_sent(7, 3, 41)
    first = m.round_clock[7][1][41]
    m.mark_sent(7, 3, 41)
    assert m.round_clock[7][1][41] == first
    m.store_answer(7, 41, {"round_number": 3, "answer": "A", "_recv_at": 0})
    ans = m.get_answers(7, 3)[41]
    assert ans["_recv_at"] >= first, "收到的时刻是服务端记的,页面自己带的不认"
    assert 0 <= m.server_ms(7, 3, 41, ans) < 1000
    assert m.server_ms(7, 4, 41, ans) is None and m.server_ms(8, 3, 41, ans) is None
    m.mark_sent(7, 4, 41)                 # 下一回合: 重新掐
    assert m.round_clock[7][0] == 4 and m.round_clock[7][1][41] >= first
    # 断开连接(这场没人连着了)不清这张表: 清了的话,断一下再连上就等于把表归零
    m.active_connections[7] = {41: object()}
    m.round_answers[7] = {}
    m.disconnect(7, 41)
    assert 7 not in m.active_connections and 7 not in m.round_answers
    assert m.round_clock[7][0] == 4 and 41 in m.round_clock[7][1]


# ---------- 两道防线各锁一条(上面那条竞态用例要两道都拆才会死) ----------

def test_ai_answer_task_never_borrows_the_drivers_session():
    """AI 的答题任务不收别人的会话,自己开。把 db 传给它 = 一个会话被两个任务同时用"""
    params = inspect.signature(ws_mod.schedule_ai_answer).parameters
    assert "db" not in params and "battle" not in params, "只给它普通的值,别给 ORM 对象 / 会话"
    assert "async with session_factory() as db" in inspect.getsource(ws_mod.schedule_ai_answer)
    # 答题通道也是自己的会话(以前半路跳出 get_db 的生成器,会话要等垃圾回收才关)
    assert "async with session_factory() as db" in inspect.getsource(ws_mod.answer_websocket)


def test_answer_wait_loop_reads_no_orm_attributes():
    """驱动循环等答案的那个轮询里不读 battle / current_user 的属性(读的都是开头取好的局部变量)"""
    src = inspect.getsource(ws_mod.battle_websocket)
    start = src.index("            while True:\n                elapsed = (datetime.utcnow() - start_time).total_seconds()")
    end = src.index("                await asyncio.sleep(0.1)", start)
    loop = src[start:end]
    assert "battle." not in loop and "current_user." not in loop, loop
    assert "manager.both_answered(battle_id, player1_id, player2_id, round_num)" in loop


# ---------- 时间常量别被测试里的桩带歪 ----------

def test_real_round_gap_is_still_the_formula():
    assert ws_mod.COUNTDOWN_SECONDS == 3
    assert ws_mod.round_gap_seconds is pet_formulas.round_gap_seconds
    assert ws_mod.session_factory is not None
