"""
PK 竞赛压力测试:测「同时在线多少人」。

为什么不直接打生产:生产是单 worker、内存只剩 1GB,且上面有真实学生在上课。
本脚本打本地 uvicorn(与生产同为单 worker),量出「每连接 CPU/内存成本」和
「消息吞吐上限」,再按生产核数/带宽外推 —— 瓶颈是单核 asyncio 事件循环,
本机单核性能与云主机同数量级,结论可迁移。

关键结论先说(见 README 或 --report 输出):
- 出站流量按 O(房间人数²) 涨:每人每答一题都会向全房广播一次 live_ranking,
  20 人房一次提交就要发 52KB;房间人数是比总人数更强的成本因子。
- 所以"能承载多少人"必须连着"每房多少人"一起报,单说人数没意义。

用法:
    # 1. 先起本地服务(单 worker,与生产一致)
    venv/bin/uvicorn app.main:app --port 8001

    # 2. 造测试学生(只需一次)
    venv/bin/python tests/load/pk_load_test.py --setup --students 200

    # 3. 跑压测:20 个房间 × 每房 8 人 = 160 人同时在线
    venv/bin/python tests/load/pk_load_test.py --rooms 20 --per-room 8

    # 4. 阶梯加压找拐点
    venv/bin/python tests/load/pk_load_test.py --ramp
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    import websockets
except ImportError:
    print("需要 websockets:  venv/bin/pip install websockets")
    sys.exit(1)
import httpx

BASE = "http://127.0.0.1:8001"
WS_BASE = "ws://127.0.0.1:8001"
API = f"{BASE}/api/v1"

TEST_PASSWORD = "LoadTest#2026"
STUDENT_PREFIX = "loadtest_stu_"
TEACHER_PREFIX = "loadtest_tea_"
MIN_ROOM_PLAYERS = 2   # 一个房间最少 2 人 → 教师数按此上限估


# ──────────────────────────── 指标收集 ────────────────────────────

@dataclass
class Metrics:
    connected: int = 0
    conn_failed: int = 0
    msgs_in: int = 0
    bytes_in: int = 0
    msgs_out: int = 0
    answer_latencies_ms: list[float] = field(default_factory=list)
    ws_connect_ms: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    games_started: int = 0
    games_finished: int = 0
    bytes_by_type: dict = field(default_factory=dict)   # 事件类型 → 累计字节(诊断流量构成)

    def summary(self, wall: float, players: int, per_room: int) -> str:
        lat = self.answer_latencies_ms
        conn = self.ws_connect_ms
        def pct(xs, p):
            if not xs:
                return 0.0
            xs = sorted(xs)
            return xs[min(len(xs) - 1, int(len(xs) * p / 100))]
        lines = [
            f"  在线玩家        : {self.connected} 连接成功 / {self.conn_failed} 失败",
            f"  房间规模        : 每房 {per_room} 人",
            f"  WS 建连延迟     : p50 {pct(conn,50):.0f}ms  p95 {pct(conn,95):.0f}ms  max {max(conn) if conn else 0:.0f}ms",
            f"  答题响应延迟    : p50 {pct(lat,50):.0f}ms  p95 {pct(lat,95):.0f}ms  p99 {pct(lat,99):.0f}ms",
            f"  收到消息        : {self.msgs_in} 条 / {self.bytes_in/1024/1024:.1f} MB",
            f"  发出提交        : {self.msgs_out} 条",
            f"  下行带宽(客户端视角): {self.bytes_in/wall/1024:.0f} KB/s"
            f"  → 服务器上行需 {self.bytes_in/wall/1024:.0f} KB/s",
            f"  对局            : 开始 {self.games_started} / 结束 {self.games_finished}",
            "  流量构成        : " + ", ".join(
                f"{k} {v/1024/1024:.1f}MB" for k, v in
                sorted(self.bytes_by_type.items(), key=lambda x: -x[1])[:5]) if self.bytes_by_type else "",
            f"  错误            : {len(self.errors)} 条" + (f" (前3: {self.errors[:3]})" if self.errors else ""),
        ]
        if lat:
            lines.append(
                f"  判定            : "
                + ("✅ 流畅 (p95 < 500ms)" if pct(lat, 95) < 500
                   else "⚠️  开始吃力 (p95 500~2000ms)" if pct(lat, 95) < 2000
                   else "❌ 已过载 (p95 > 2s,学生会明显卡)")
            )
        return "\n".join(lines)


# ──────────────────────────── 准备数据 ────────────────────────────

async def setup_students(n: int) -> None:
    """建测试学生 + 教师,并给每个学生塞够 word_mastery(否则开局被"背过词太少"拦)。"""
    from sqlalchemy import select, text
    from app.core.database import AsyncSessionLocal
    from app.models.user import User
    from app.models.word import Word
    from app.services.auth_service import get_password_hash

    async with AsyncSessionLocal() as db:
        words = (await db.execute(select(Word.id).limit(300))).scalars().all()
        if len(words) < 60:
            print(f"⚠️  库里只有 {len(words)} 个词,压测需要 ≥60,先导入词库")
            return
        pw = get_password_hash(TEST_PASSWORD)

        made = 0
        for i in range(n):
            uname = f"{STUDENT_PREFIX}{i:04d}"
            u = (await db.execute(select(User).where(User.username == uname))).scalar_one_or_none()
            if not u:
                # email 是 NOT NULL + unique,必须给唯一值
                u = User(username=uname, email=f"{uname}@loadtest.local",
                         full_name=f"压测学生{i:04d}", hashed_password=pw,
                         role="student", org_id=1)
                db.add(u)
                await db.flush()
                made += 1
            # 每人 60 词掌握度(word_count 上限 200 时也够开局;不够会被 MIN_COMMON_WORDS 拦)
            await db.execute(text(
                "INSERT OR IGNORE INTO word_mastery "
                "(user_id, word_id, total_encounters, correct_count, wrong_count, mastery_level) "
                "SELECT :uid, value, 3, 3, 0, 3 FROM (" +
                " UNION ALL ".join(f"SELECT {w} AS value" for w in words[:60]) + ")"
            ), {"uid": u.id})

        # ⚠️ 每个房间必须有独立教师:manager.create_room 里,同一 host 再建房会把他
        # 上一个 waiting 房直接 close_room 回收(教师组织房的孤儿房清理逻辑)。
        # 复用一个教师建 N 个房 → 只有最后一个活着,压测就成了假的。
        n_teachers = max(1, (n + MIN_ROOM_PLAYERS - 1) // MIN_ROOM_PLAYERS)
        for i in range(n_teachers):
            tname = f"{TEACHER_PREFIX}{i:03d}"
            if not (await db.execute(select(User).where(User.username == tname))).scalar_one_or_none():
                db.add(User(username=tname, email=f"{tname}@loadtest.local",
                            full_name=f"压测老师{i:03d}", hashed_password=pw,
                            role="teacher", org_id=1))
        await db.commit()
    print(f"✅ 测试账号就绪:新建 {made} 个学生(共 {n})+ {n_teachers} 个教师,密码统一 {TEST_PASSWORD}")
    print("   清理:  venv/bin/python tests/load/pk_load_test.py --cleanup")


async def cleanup() -> None:
    from sqlalchemy import text
    from app.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "DELETE FROM word_mastery WHERE user_id IN "
            "(SELECT id FROM users WHERE username LIKE :p)"), {"p": f"{STUDENT_PREFIX}%"})
        await db.execute(text("DELETE FROM users WHERE username LIKE :p OR username LIKE :t"),
                         {"p": f"{STUDENT_PREFIX}%", "t": f"{TEACHER_PREFIX}%"})
        await db.commit()
    print("✅ 压测账号已清理")


async def login(client: httpx.AsyncClient, username: str, retries: int = 4) -> str | None:
    """
    登录拿 token。登录端点是 OAuth2 form-data,不是 JSON。

    带重试:登录本身是压测的已知瓶颈(bcrypt 346ms/次且跑在事件循环上,单 worker
    下完全串行;并发高时还会撞 SQLite 写锁)。这里重试是为了让"建立 N 个在线连接"
    这一步别卡死,从而能量到 PK 对局本身的容量 —— 登录容量单独在报告里给数。
    """
    for attempt in range(retries):
        try:
            r = await client.post(f"{API}/auth/login",
                                  data={"username": username, "password": TEST_PASSWORD})
            if r.status_code == 200:
                return r.json()["access_token"]
            # 500 多为写锁冲突,退避后重试
            await asyncio.sleep(0.4 * (attempt + 1))
        except Exception:
            await asyncio.sleep(0.4 * (attempt + 1))
    return None


# ──────────────────────────── 单个玩家 ────────────────────────────

async def play(room_id: int, token: str, m: Metrics, stop: asyncio.Event,
               think_ms: int) -> None:
    """一个学生:连 WS → 等题 → 按 think_ms 节奏答题,直到收到终局或被叫停。"""
    url = f"{WS_BASE}/api/v1/pk/ws?token={token}&room_id={room_id}"
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, max_size=2**22, open_timeout=30) as ws:
            m.ws_connect_ms.append((time.perf_counter() - t0) * 1000)
            m.connected += 1
            pending: dict | None = None
            sent_at: float | None = None

            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=20)
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed:
                    break

                m.msgs_in += 1
                m.bytes_in += len(raw)
                try:
                    ev = json.loads(raw)
                    _t = ev.get('type', '?')
                    m.bytes_by_type[_t] = m.bytes_by_type.get(_t, 0) + len(raw)
                except Exception:
                    continue
                et = ev.get("type")

                if et == "question_pushed":
                    if sent_at is not None:
                        m.answer_latencies_ms.append((time.perf_counter() - sent_at) * 1000)
                        sent_at = None
                    pending = ev
                    # 模拟思考时间后作答
                    await asyncio.sleep(think_ms / 1000)
                    if stop.is_set():
                        break
                    payload = _answer_for(ev)
                    try:
                        await ws.send(json.dumps(payload))
                        m.msgs_out += 1
                        sent_at = time.perf_counter()
                    except websockets.ConnectionClosed:
                        break
                elif et == "question_settled":
                    if sent_at is not None:
                        m.answer_latencies_ms.append((time.perf_counter() - sent_at) * 1000)
                        sent_at = None
                elif et == "game_finished":
                    m.games_finished += 1
                    break
                elif et == "error":
                    m.errors.append(f"{ev.get('code')}:{ev.get('message','')[:40]}")
    except Exception as e:
        m.conn_failed += 1
        m.errors.append(f"{type(e).__name__}:{str(e)[:50]}")


def _answer_for(ev: dict) -> dict:
    """
    按阶段构造一个合法提交(答对答错不影响压力,只要 schema 对)。

    协议以服务端为准(pk_websocket.py submit_answer + adapters.judge):
    type=submit_answer,定位字段是 word_idx + phase(不是 q_seq/stage),
    各阶段 payload 键分别为 category / result / text / selected。
    """
    stage = ev.get("stage") or ev.get("phase")
    word = (ev.get("word") or {})
    spelling = word.get("word") if isinstance(word, dict) else None
    base = {
        "type": "submit_answer",
        "word_idx": ev.get("q_seq", 0),   # 服务端用 q_seq 校验,字段名叫 word_idx
        "phase": stage,
        "time_spent_ms": 1500,
    }
    if stage == "classify":
        return {**base, "payload": {"category": "familiar"}}
    if stage == "speech":
        return {**base, "payload": {"result": "pass"}}
    if stage == "dictation":
        return {**base, "payload": {"text": spelling or "x"}}
    if stage == "exam":
        etype = ev.get("exam_type", "spelling")
        opts = ev.get("options") or []
        if etype in ("en_to_cn", "cn_to_en") and opts:
            return {**base, "payload": {"selected": opts[0]}}
        return {**base, "payload": {"text": spelling or "x"}}
    return {**base, "payload": {}}


# ──────────────────────────── 一个房间 ────────────────────────────

async def run_room(client: httpx.AsyncClient, teacher_token: str, student_tokens: list[str],  # noqa: C901
                   word_count: int, m: Metrics, stop: asyncio.Event,
                   think_ms: int) -> None:
    """教师建房 → 学生全部 join+连 WS → 教师开局 → 跑到终局。"""
    n = len(student_tokens)
    r = await client.post(f"{API}/pk/rooms",
                          headers={"Authorization": f"Bearer {teacher_token}"},
                          json={"max_players": max(2, n), "word_count": word_count,
                                "mode": "individual", "team_count": 2,
                                "countdown_seconds": 600})
    if r.status_code != 200:
        m.errors.append(f"create_room {r.status_code}:{r.text[:60]}")
        return
    room = r.json()
    room_id, code = room["room_id"], room["invite_code"]

    # 加入走 by-code 路由(POST /rooms/by-code/{code}/join,body 无需 invite_code)
    for tk in student_tokens:
        rr = await client.post(f"{API}/pk/rooms/by-code/{code}/join",
                               headers={"Authorization": f"Bearer {tk}"})
        if rr.status_code != 200:
            m.errors.append(f"join {rr.status_code}:{rr.text[:50]}")

    tasks = [asyncio.create_task(play(room_id, tk, m, stop, think_ms)) for tk in student_tokens]
    await asyncio.sleep(2.0)  # 等 WS 都连上再开局

    # 教师控制台:同一个 /ws 端点,服务端按 user.id==host_id 且 host_is_player=False 自动识别
    host_url = f"{WS_BASE}/api/v1/pk/ws?token={teacher_token}&room_id={room_id}"
    try:
        async with websockets.connect(host_url, max_size=2**22, open_timeout=30) as hws:
            await hws.send(json.dumps({"type": "start_game"}))
            m.games_started += 1
            # 教师控制台也在收广播(真实场景老师盯大屏),计入流量
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(hws.recv(), timeout=15)
                    m.msgs_in += 1
                    m.bytes_in += len(raw)
                    if json.loads(raw).get("type") == "game_finished":
                        break
                except (asyncio.TimeoutError, websockets.ConnectionClosed):
                    break
                except Exception:
                    break
    except Exception as e:
        m.errors.append(f"host_ws {type(e).__name__}:{str(e)[:40]}")

    await asyncio.gather(*tasks, return_exceptions=True)

    # 必须显式删房:manager.USER_ACTIVE 记着"这个教师有活跃房",而 status=playing 的房
    # 不会被下次建房自动回收(只回收 waiting 的孤儿房)。阶梯加压里不删,
    # 上一档的教师就永久卡在 USER_ALREADY_IN_ROOM,后面档位一半房间建不起来
    # (实测 20 房只成 10 房、160 人只上 80 人,全是这个原因,不是服务器到顶)
    try:
        await client.delete(f"{API}/pk/rooms/{room_id}",
                            headers={"Authorization": f"Bearer {teacher_token}"})
    except Exception:
        pass


# ──────────────────────────── 压测主流程 ────────────────────────────

async def run_load(rooms: int, per_room: int, word_count: int, duration: int,
                   think_ms: int) -> Metrics:
    m = Metrics()
    stop = asyncio.Event()
    need = rooms * per_room

    async with httpx.AsyncClient(timeout=60) as client:
        # 每房一个独立教师(同一教师建第二个房会回收第一个,见 setup_students 注释)
        teacher_tokens: list[str] = []
        for batch in range(0, rooms, 16):
            got = await asyncio.gather(*[
                login(client, f"{TEACHER_PREFIX}{i:03d}")
                for i in range(batch, min(batch + 16, rooms))
            ])
            teacher_tokens.extend([t for t in got if t])
        if len(teacher_tokens) < rooms:
            print(f"❌ 只登录上 {len(teacher_tokens)}/{rooms} 个教师,先跑 --setup --students {need}")
            return m
        # 分小批登录:bcrypt 是 CPU 密集且在事件循环上跑,一次灌太多会把服务器
        # 压在登录上、连 WS 都排不上号,量不到对局本身的容量
        print(f"  登录 {need} 个学生(分批,避开登录瓶颈)…", flush=True)
        tokens: list[str] = []
        for batch in range(0, need, 16):
            got = await asyncio.gather(*[
                login(client, f"{STUDENT_PREFIX}{i:04d}")
                for i in range(batch, min(batch + 16, need))
            ])
            tokens.extend([t for t in got if t])
        if len(tokens) < need:
            print(f"❌ 只登录上 {len(tokens)}/{need},先跑 --setup --students {need}")
            return m

        print(f"  起 {rooms} 个房间 × {per_room} 人 = {need} 人,持续 {duration}s…", flush=True)
        t0 = time.perf_counter()
        room_tasks = [
            asyncio.create_task(run_room(
                client, teacher_tokens[i], tokens[i * per_room:(i + 1) * per_room],
                word_count, m, stop, think_ms))
            for i in range(rooms)
        ]
        timer = asyncio.create_task(asyncio.sleep(duration))
        await asyncio.wait([timer, *room_tasks], return_when=asyncio.FIRST_COMPLETED)
        if not timer.done():
            await timer
        stop.set()
        await asyncio.gather(*room_tasks, return_exceptions=True)
        wall = time.perf_counter() - t0

    print(m.summary(wall, need, per_room))
    return m


async def ramp(word_count: int, think_ms: int) -> None:
    """阶梯加压:固定每房 8 人,房间数递增,找 p95 崩掉的拐点。"""
    print("\n" + "=" * 74)
    print("阶梯加压(每房 8 人):找 p95 延迟越过 500ms / 2s 的拐点")
    print("=" * 74)
    # 从 30 人起步:业务底线是"至少 30 人同时在线"(一个班的规模),
    # 低于这个数的档位没有决策价值
    for rooms in (4, 8, 13, 20, 25):
        print(f"\n▶ {rooms} 房 × 8 人 = {rooms*8} 人")
        m = await run_load(rooms, 8, word_count, 45, think_ms)
        lat = sorted(m.answer_latencies_ms)
        if lat:
            p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))]
            if p95 > 2000:
                print(f"\n⛔ {rooms*8} 人时 p95={p95:.0f}ms 已过载,拐点在此之前")
                break
        await asyncio.sleep(3)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--setup", action="store_true")
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--students", type=int, default=200)
    ap.add_argument("--rooms", type=int, default=10)
    ap.add_argument("--per-room", type=int, default=8)
    ap.add_argument("--word-count", type=int, default=10)
    ap.add_argument("--duration", type=int, default=60)
    ap.add_argument("--think-ms", type=int, default=1500, help="模拟每题思考时间")
    ap.add_argument("--ramp", action="store_true")
    a = ap.parse_args()

    if a.setup:
        asyncio.run(setup_students(a.students))
    elif a.cleanup:
        asyncio.run(cleanup())
    elif a.ramp:
        asyncio.run(ramp(a.word_count, a.think_ms))
    else:
        asyncio.run(run_load(a.rooms, a.per_room, a.word_count, a.duration, a.think_ms))
    return 0


if __name__ == "__main__":
    sys.exit(main())
