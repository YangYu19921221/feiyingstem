"""后端多进程(2026-10-25): 主进程 + 工作进程池,跨请求的小数据放 core/shared_store。

这里锁住的是「换成多进程以后不会悄悄变错」的那几件事:
- shared_store 的内存后端和 Redis 后端**同一套语义**(两边跑同一批用例);Redis 挂了退回内存、不报错
- 两个「进程」(两个 SharedStore 实例连同一个 Redis)看到的是同一份: 限流 / AI 次数 / 验证码 / 在线状态
- 验证码同一个正确的码并发交两次只算一次;AI 次数并发也不会超
- 单元考试答案不在进程内存里(出卷和交卷落在不同进程照样能交),exam_id 签名防伪造 / 防跨学生 / 防重交 / 30 分钟过期
- 工作进程收到只该主进程处理的请求(PK / 竞赛 / 直播弹幕 / 宠物对战 WebSocket、本机语音模型)直接拒
- nginx 分流清单(deploy/multiproc/nginx/api-locations.inc)和 process_role 的清单完全一致;
  app 里所有 WebSocket 路由都在主进程清单里(新加一个 WS 漏了清单,这里会失败)
- 机构停用 / 续费跨进程生效(共享代数)、工作进程启动时注册租户过滤
- 开几个工作进程按 CPU 和内存算;跨进程文件锁真的互斥;发音自检升级后两个服务都重启

Redis 用例要本机有一个测试用 Redis(默认 redis://127.0.0.1:6391/15,环境变量 EH_TEST_REDIS_URL 可改),
连不上就跳过 —— 起一个: `redis-server --port 6391 --save '' --appendonly no`。
⚠️ 每个 Redis 用例结束时都检查「没有退回内存」: redis.asyncio 的连接绑事件循环,跨用例复用会出错,
而 shared_store 出错是静默退回内存的,不查这一句测试会在内存上假装通过。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, update

from app.core import process_role, shared_store, tenancy, worker_plan
from app.core.shared_store import SharedStore, reset_memory, store
from app.core.timeutil import local_today
from tests.conftest import _make_token

BACKEND = Path(__file__).resolve().parents[1]
NGINX_DIR = BACKEND.parent / "deploy" / "multiproc" / "nginx"
REDIS_TEST_URL = os.environ.get("EH_TEST_REDIS_URL", "redis://127.0.0.1:6391/15")


def _redis_reachable() -> bool:
    try:
        import redis
        r = redis.Redis.from_url(REDIS_TEST_URL, socket_timeout=0.3, socket_connect_timeout=0.3)
        ok = bool(r.ping())
        r.close()
        return ok
    except Exception:  # noqa: BLE001
        return False


REDIS_OK = _redis_reachable()


def _flush_test_db() -> None:
    import redis
    r = redis.Redis.from_url(REDIS_TEST_URL)
    r.flushdb()
    r.close()


async def _close(s: SharedStore) -> None:
    if s._redis is not None:
        await s._redis.close()
        s._redis = None


@pytest_asyncio.fixture(params=["memory", "redis"])
async def backend(request):
    """全局 store 切到内存或测试 Redis;用例结束切回内存(其它测试文件都按内存跑)"""
    if request.param == "redis":
        if not REDIS_OK:
            pytest.skip(f"没有测试用 Redis({REDIS_TEST_URL})")
        _flush_test_db()
        store.configure(REDIS_TEST_URL)
    else:
        store.configure("")
    reset_memory()
    yield request.param
    try:
        if request.param == "redis":
            assert store._down_until == 0.0, "Redis 调用出错退回了内存,这个用例不算数"
            assert store.backend_name() == "redis"
    finally:
        await _close(store)
        store.configure("")
        reset_memory()
        if request.param == "redis":
            _flush_test_db()


@pytest_asyncio.fixture
async def other_proc():
    """另一个「进程」: 连同一个测试 Redis 的独立 SharedStore(不共享任何进程内存)"""
    if not REDIS_OK:
        pytest.skip(f"没有测试用 Redis({REDIS_TEST_URL})")
    b = SharedStore()
    b.configure(REDIS_TEST_URL)
    yield b
    assert b._down_until == 0.0, "另一个进程的 Redis 调用出错退回了内存,这个用例不算数"
    await _close(b)


def _need_redis(name: str) -> None:
    if name != "redis":
        pytest.skip("只在 Redis 后端上有意义")


# ======================================================================== shared_store 语义

async def test_kv_ttl_delete(backend):
    await store.set("k", "v", 0.3)
    assert await store.get("k") == "v"
    assert await store.mget(["k", "nope"]) == ["v", None]
    await asyncio.sleep(0.45)
    assert await store.get("k") is None
    await store.set_json("j", {"a": 1, "中": "文"}, 10)
    assert await store.get_json("j") == {"a": 1, "中": "文"}
    assert await store.delete("j") == 1
    assert await store.delete("j") == 0      # 验证码靠这个返回值判「谁先删的」


async def test_incr_keeps_first_ttl(backend):
    assert await store.incr("c", 1, 0.4) == 1
    await asyncio.sleep(0.2)
    assert await store.incr("c", 2, 100) == 3      # 已有的过期时间不刷新
    await asyncio.sleep(0.3)
    assert await store.get("c") is None


async def test_incr_if_below_never_exceeds_limit_under_concurrency(backend):
    results = await asyncio.gather(*[store.incr_if_below("q", 5, 60) for _ in range(40)])
    assert sum(results) == 5
    assert await store.get("q") == "5"


async def test_set_max(backend):
    assert await store.set_max("m", 3, 60) == 3
    assert await store.set_max("m", 2, 60) == 3
    assert await store.set_max("m", 7, 60) == 7


async def test_sorted_set(backend):
    now = time.time()
    await store.zadd("z", {"a": now - 100, "b": now - 10, "c": now}, 60)
    assert await store.zcount("z", now - 50) == 2
    assert await store.zrange_since("z", now - 50) == ["b", "c"]
    await store.zprune("z", now - 50)
    assert await store.zcount("z", 0) == 2


async def test_window_hit_count_record(backend):
    windows = [(0.5, 3)]
    assert [await store.window_hit("w", windows) for _ in range(3)] == [0.0, 0.0, 0.0]
    wait = await store.window_hit("w", windows)
    assert 0 < wait <= 0.5
    assert await store.window_count("w", 0.5) == 3      # 被拒的那次不记
    await asyncio.sleep(0.55)
    assert await store.window_hit("w", windows) == 0.0
    # 两个窗口: 短窗没满、长窗满了也要拒
    two = [(0.2, 10), (5.0, 2)]
    assert await store.window_hit("w2", two) == 0.0
    assert await store.window_hit("w2", two) == 0.0
    assert await store.window_hit("w2", two) > 0
    await store.window_record("r", 10)
    await store.window_record("r", 10)
    assert await store.window_count("r", 10) == 2


async def test_redis_down_falls_back_to_memory_quickly():
    s = SharedStore()
    s.configure("redis://127.0.0.1:1/0")          # 没人听的端口
    try:
        await s.set("k", "v", 10)
        assert await s.get("k") == "v"            # 退回内存照样能用
        assert s.backend_name() == "memory_fallback"
        t0 = time.monotonic()
        for _ in range(50):                       # 冷却期内直接走内存,不再每次等超时
            await s.incr("n", 1, 10)
        assert time.monotonic() - t0 < 0.5
        assert await s.get("n") == "50"
    finally:
        await _close(s)


def test_no_redis_url_means_memory(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "  redis://example:6379/0 ")
    assert shared_store.redis_url_from_env() == "redis://example:6379/0"
    s = SharedStore()
    s.configure("")
    assert s.backend_name() == "memory"


# ======================================================================== 跨进程共享

async def test_rate_limit_shared_across_processes(backend, other_proc):
    _need_redis(backend)
    from app.services import rate_limit
    await rate_limit.check(("mp-test", 1), 3, 60, "太快了")
    await rate_limit.check(("mp-test", 1), 3, 60, "太快了")
    # 另一个进程接到第三次: 还没满,放行
    assert await other_proc.window_hit("rl:mp-test:1", [(60.0, 3)]) == 0.0
    with pytest.raises(HTTPException) as e:
        await rate_limit.check(("mp-test", 1), 3, 60, "太快了")
    assert e.value.status_code == 429 and int(e.value.headers["Retry-After"]) >= 1


async def test_rate_limit_retry_after_and_count(backend):
    from app.core.rate_limit import check_rate
    from app.services import rate_limit
    await rate_limit.record(("fail", "x"), 600)
    await rate_limit.record(("fail", "x"), 600)
    assert await rate_limit.count(("fail", "x"), 600) == 2
    await check_rate("7", "words", [(60, 1)])
    with pytest.raises(HTTPException) as e:
        await check_rate("7", "words", [(60, 1)])
    assert e.value.status_code == 429


async def test_ai_quota_shared_and_atomic(backend, other_proc):
    _need_redis(backend)
    from app.services import ai_quota

    async def one():
        try:
            await ai_quota.check_and_consume(42, "mp", 3)
            return True
        except HTTPException as e:
            assert e.status_code == 429
            return False

    assert sum(await asyncio.gather(*[one() for _ in range(20)])) == 3
    key = f"aiq:{local_today().isoformat()}:mp:42"
    assert await other_proc.get(key) == "3"
    assert await other_proc.incr_if_below(key, 3, 60) is False     # 别的进程也用不了了


async def test_ai_quota_memory(backend):
    from app.services import ai_quota
    for _ in range(2):
        await ai_quota.check_and_consume(1, "f", 2)
    with pytest.raises(HTTPException):
        await ai_quota.check_and_consume(1, "f", 2)
    await ai_quota.check_and_consume(2, "f", 2)                   # 别人的额度不受影响


async def test_sms_code_flow(backend):
    from app.services.sms_service import VerificationCodeStore
    cs = VerificationCodeStore()
    assert (await cs.can_send("13800000000"))[0] is True
    code = await cs.generate_and_store("13800000000")
    assert len(code) == 6 and code.isdigit()
    ok, msg = await cs.can_send("13800000000")
    assert ok is False and "秒后再试" in msg                      # 60 秒内不重发
    for _ in range(cs.MAX_ATTEMPTS):
        assert (await cs.verify("13800000000", "000000" if code != "000000" else "111111")) == (False, "验证码错误")
    ok, msg = await cs.verify("13800000000", code)
    assert ok is False and "错误次数过多" in msg                  # 输错 5 次作废,对的也不认
    assert (await cs.verify("13800000000", code))[1] == "验证码已过期或未发送"


async def test_sms_correct_code_counts_once_under_concurrency(backend):
    from app.services.sms_service import VerificationCodeStore
    cs = VerificationCodeStore()
    code = await cs.generate_and_store("13900000000")
    results = await asyncio.gather(*[cs.verify("13900000000", code) for _ in range(6)])
    assert sum(1 for ok, _ in results if ok) == 1


async def test_sms_code_visible_to_other_process(backend, other_proc):
    _need_redis(backend)
    from app.services.sms_service import VerificationCodeStore
    code = await VerificationCodeStore().generate_and_store("13700000000")
    rec = await other_proc.get_json("sms:code:13700000000")
    assert rec["code"] == code


async def test_presence_heartbeat_seen_by_other_process(backend, other_proc):
    _need_redis(backend)
    from app.services import presence_service
    await presence_service.heartbeat(11, visible=True, unit_id=3, unit_name="Unit 3")
    await presence_service.report_switch(12, leaving=True)
    st = await other_proc.get_json("presence:11")
    assert st["visible"] is True and st["unit_name"] == "Unit 3"
    snap = {r["user_id"]: r for r in await presence_service.snapshot([11, 12, 13])}
    assert snap[11]["status"] == "studying"
    assert snap[12]["status"] == "away"
    assert 13 not in snap


async def test_presence_status_logic(backend):
    from app.services import presence_service
    await presence_service.heartbeat(1, visible=True, idle=True)
    await presence_service.report_switch(2, leaving=True)
    await presence_service.report_switch(2, leaving=False)
    await presence_service.report_switch(2, leaving=True)
    rows = {r["user_id"]: r for r in await presence_service.snapshot([1, 2])}
    assert rows[1]["status"] == "distracted"
    assert rows[2]["status"] == "away"
    # 心跳超时: 最后可见 → 离线
    st = await store.get_json("presence:1")
    st["last_seen"] = time.time() - presence_service.OFFLINE_AFTER_SEC - 5
    st["idle"] = False
    await store.set_json("presence:1", st, 100)
    rows = {r["user_id"]: r for r in await presence_service.snapshot([1])}
    assert rows[1]["status"] == "offline"


async def test_online_tracker_merges_processes(backend, other_proc):
    _need_redis(backend)
    from app.services import online_tracker
    online_tracker.record_http("/api/v1/student/x", f"Bearer {_make_token(501)}", "1000")
    await online_tracker.flush()
    # 另一个进程报上来的活跃账号和请求数
    await other_proc.zadd("ot:seen", {"u502": time.time()}, 1200)
    await other_proc.incr(f"ot:reqs:{int(time.time() // 10)}", 9, 1200)
    assert await online_tracker.active_count(60) == 2
    assert sorted(await online_tracker.active_user_ids(60)) == [501, 502]
    _, rps = await online_tracker.app_rates(60)
    assert rps == pytest.approx(10 / 60)
    assert {"pid": os.getpid(), "role": "main"} in await online_tracker.processes()
    assert await online_tracker.peak_today() >= 1


async def test_online_tracker_memory(backend):
    from app.services import online_tracker
    online_tracker.touch("u7")
    online_tracker.touch_ws(8)
    await online_tracker.flush()
    assert await online_tracker.active_count(60) == 2


# ======================================================================== 机构缓存跨进程失效

async def test_org_cache_cleared_when_other_process_bumps_generation(backend, monkeypatch):
    monkeypatch.setattr(tenancy, "_gen_seen", None)
    monkeypatch.setattr(tenancy, "_gen_checked_at", 0.0)
    await tenancy._sync_org_cache_gen()                         # 先认下当前代数
    tenancy._org_cache[9] = (time.time() + 300, True, False, "open")
    # 别的进程停用了一个机构: 只有它自己的缓存清了,这边靠代数
    await store.incr(tenancy._GEN_KEY, 1, 3600)
    await tenancy._sync_org_cache_gen()                         # 2 秒内不重复看,这次不清
    assert 9 in tenancy._org_cache
    monkeypatch.setattr(tenancy, "_gen_checked_at", 0.0)
    await tenancy._sync_org_cache_gen()
    assert 9 not in tenancy._org_cache


async def test_invalidate_everywhere_bumps_generation(backend):
    before = int(await store.get(tenancy._GEN_KEY) or 0)
    tenancy._org_cache[5] = (time.time() + 300, True, False, "open")
    await tenancy.invalidate_org_cache_everywhere(5)
    assert 5 not in tenancy._org_cache
    assert int(await store.get(tenancy._GEN_KEY)) == before + 1


def test_api_layer_only_uses_cross_process_invalidation():
    """接口里改了机构状态只清本进程缓存 = 别的工作进程 5 分钟内还当它没停用"""
    bad = []
    for p in (BACKEND / "app").rglob("*.py"):
        if p.name == "tenancy.py":
            continue
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\binvalidate_org_cache\(", line) and not line.lstrip().startswith("#"):
                bad.append(f"{p.relative_to(BACKEND)}:{i}")
    assert not bad, f"改用 invalidate_org_cache_everywhere: {bad}"


# ======================================================================== 进程角色 / nginx 分流

async def test_worker_rejects_main_only_http(client, monkeypatch):
    monkeypatch.setattr(process_role, "ROLE", "worker")
    r = await client.get("/api/v1/pk/rooms/mine")
    assert r.status_code == 503 and r.headers["x-eh-proc"] == "worker"
    assert r.json()["detail"] == "服务正在调整,请稍后再试"
    r = await client.get("/health")
    assert r.status_code == 200 and r.headers["x-eh-proc"] == "worker"
    # 放主进程更好的路径: 工作进程上也照常处理(这里没登录,401/403 都行,就是不能 503)
    assert (await client.get("/api/v1/admin/server/metrics")).status_code != 503


async def test_main_process_handles_everything(client, monkeypatch):
    monkeypatch.setattr(process_role, "ROLE", "all")
    r = await client.get("/api/v1/pk/rooms/mine")
    assert r.status_code != 503 and r.headers["x-eh-proc"] == "main"


async def test_worker_closes_main_only_websocket(monkeypatch):
    monkeypatch.setattr(process_role, "ROLE", "worker")
    passed = []

    async def inner(scope, receive, send):
        passed.append(scope["path"])

    mw = process_role.ProcessRoleMiddleware(inner)
    sent = []

    async def receive():
        return {"type": "websocket.connect"}

    async def send(m):
        sent.append(m)

    await mw({"type": "websocket", "path": "/api/v1/pk/ws"}, receive, send)
    assert passed == [] and sent == [{"type": "websocket.close", "code": 1013}]
    await mw({"type": "websocket", "path": "/api/v1/somewhere/ws"}, receive, send)
    assert passed == ["/api/v1/somewhere/ws"]


def test_every_websocket_route_is_main_only():
    from fastapi.routing import APIWebSocketRoute
    from starlette.routing import WebSocketRoute
    from app.main import app
    ws = [r.path for r in app.routes if isinstance(r, (APIWebSocketRoute, WebSocketRoute))]
    assert len(ws) >= 5
    missing = [p for p in ws if not process_role.is_main_only(p)]
    assert not missing, f"WebSocket 连接对象在进程内存里,必须进 MAIN_ONLY(并同步 nginx 清单): {missing}"


def _parse_nginx_locations(text: str) -> list[dict]:
    """极简解析: 记下每个 location 的修饰符 / 路径 / 它自己的 proxy_pass / 父 location"""
    out, stack = [], []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.match(r"location\s+(\^~|=|~\*?)?\s*(\S+)\s*\{$", line)
        if m:
            loc = {"mod": m.group(1) or "", "path": m.group(2), "proxy": None,
                   "parent": stack[-1]["path"] if stack else None}
            out.append(loc)
            stack.append(loc)
            continue
        m = re.match(r"proxy_pass\s+http://(\w+);$", line)
        if m and stack:
            stack[-1]["proxy"] = m.group(1)
        if line == "}" and stack:
            stack.pop()
    assert not stack, "花括号没配平"
    return out


def test_nginx_routing_matches_process_role():
    locs = _parse_nginx_locations((NGINX_DIR / "api-locations.inc").read_text(encoding="utf-8"))
    main = {(l["mod"], l["path"]) for l in locs if l["proxy"] == "eh_main"}
    expected = ({("^~", p) for p in process_role.MAIN_ONLY_PREFIXES}
                | {("^~", p) for p in process_role.PREFER_MAIN_PREFIXES}
                | {("=", p) for p in process_role.MAIN_ONLY_EXACT}
                | {("~", p.pattern) for p in process_role.PREFER_MAIN_PATTERNS})
    assert main == expected, f"nginx 多了 {main - expected},少了 {expected - main}"
    # 正则那条必须嵌在 ^~ /api/ 里面(写在外面会被 ^~ 挡住永远匹配不到)
    for l in locs:
        if l["mod"].startswith("~"):
            assert l["parent"] == "/api/"
    api = [l for l in locs if l["path"] == "/api/" and l["mod"] == "^~"]
    assert len(api) == 1 and api[0]["proxy"] == "eh_workers"
    assert all(l["proxy"] for l in locs), "每个 location 都要写自己的 proxy_pass(嵌套 location 不继承)"
    up = (NGINX_DIR / "0.eh_upstream.conf").read_text(encoding="utf-8")
    workers = re.search(r"upstream eh_workers \{(.*?)\}", up, re.S).group(1)
    assert "127.0.0.1:8001" in workers and re.search(r"127\.0\.0\.1:8000\s+backup", workers), \
        "工作进程不在时要自动退回主进程"
    for inc in ("proxy-main.inc", "proxy-workers.inc"):
        body = (NGINX_DIR / inc).read_text(encoding="utf-8")
        assert "client_max_body_size 520m" in body          # 音标视频上传,见 test_phonetic_video_size_limit
        assert "X-Real-IP $remote_addr" in body              # 操作记录 / 限流按真实 IP
    assert "Upgrade $http_upgrade" in (NGINX_DIR / "proxy-main.inc").read_text(encoding="utf-8")


def test_role_helpers():
    assert process_role.is_main_only("/api/v1/pk/rooms")
    assert process_role.is_main_only("/api/v1/pronunciation/verify-word")
    assert not process_role.is_main_only("/api/v1/pronunciation/edge-tts")
    assert not process_role.is_main_only("/api/v1/student/homework")
    assert process_role.prefers_main("/api/v1/phonetics/videos/12/stream")
    assert not process_role.prefers_main("/api/v1/phonetics/videos/12/ticket")


async def test_init_worker_registers_tenant_filter():
    saved = list(tenancy.TENANT_MODELS)
    try:
        tenancy.TENANT_MODELS.clear()
        await process_role.init_worker()
        names = {m.__name__ for m, _ in tenancy.TENANT_MODELS}
        assert {"User", "Class", "WordBook", "PhoneticVideo"} <= names
    finally:
        tenancy.TENANT_MODELS.clear()
        tenancy.TENANT_MODELS.extend(saved)       # 其它测试按「没注册过滤」跑,别留着


# ======================================================================== 开几个工作进程

@pytest.mark.parametrize("cpus,mem,override,workers,by", [
    (4, 3900, "", 3, "cpu"),          # 生产 2026-10-25: 4 核、可用 3.9G → 3 个
    (8, 16000, "", 7, "cpu"),         # 升级到 8 核 16G
    (8, 2400, "", 2, "memory"),       # 核多内存少: (2400-1536)//300 = 2
    (4, 900, "", 1, "memory"),        # 内存很紧也至少 1 个
    (1, 4000, "", 1, "cpu"),          # 单核
    (64, 100000, "", 16, "max"),
    (4, 3900, "2", 2, "override"),    # EH_WORKERS 写死
    (4, 3900, "abc", 3, "cpu"),       # 写错了不认
])
def test_worker_plan(cpus, mem, override, workers, by):
    p = worker_plan.plan(cpus=cpus, avail_mb=mem, override=override, probe=False)
    assert (p["workers"], p["limited_by"]) == (workers, by)


def test_start_workers_dry_run():
    env = {**os.environ, "EH_WORKERS": "2"}
    r = subprocess.run([sys.executable, str(BACKEND / "scripts" / "start_workers.py"), "--dry-run"],
                       capture_output=True, text=True, timeout=60, env=env)
    assert r.returncode == 0, r.stderr
    assert "工作进程 2 个" in r.stdout and "EH_WORKERS" in r.stdout


# ======================================================================== 跨进程文件锁

async def test_interprocess_lock_serializes(tmp_path, monkeypatch):
    from app.core import file_lock
    monkeypatch.setattr(file_lock, "LOCK_DIR", tmp_path)
    events = []

    async def job(name, hold):
        async with file_lock.interprocess_lock("ffmpeg"):
            events.append(f"{name}+")
            await asyncio.sleep(hold)
            events.append(f"{name}-")

    await asyncio.gather(job("a", 0.4), job("b", 0.1))
    assert events in (["a+", "a-", "b+", "b-"], ["b+", "b-", "a+", "a-"])


async def test_interprocess_lock_waits_for_other_process(tmp_path, monkeypatch):
    from app.core import file_lock
    monkeypatch.setattr(file_lock, "LOCK_DIR", tmp_path)
    holder = subprocess.Popen([sys.executable, "-c", (
        "import fcntl,os,sys,time\n"
        f"fd=os.open({str(tmp_path / 'soffice.lock')!r}, os.O_RDWR|os.O_CREAT)\n"
        "fcntl.flock(fd, fcntl.LOCK_EX); print('locked', flush=True); time.sleep(1.0)\n")],
        stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "locked"
        t0 = time.monotonic()
        async with file_lock.interprocess_lock("soffice"):
            waited = time.monotonic() - t0
        assert waited >= 0.5
    finally:
        holder.wait(timeout=10)


# ======================================================================== 发音自检升级后两个服务都重启

def test_tts_guard_restarts_workers_too(monkeypatch):
    from app.services import tts_guard
    calls = []

    def fake_run(cmd, timeout=120):
        calls.append(cmd)
        if cmd[:2] == ["systemctl", "is-enabled"]:
            return (0 if enabled else 1), ""
        return 0, ""

    monkeypatch.setattr(tts_guard, "_run", fake_run)
    enabled = True
    assert tts_guard.restart_service() == (True, "")
    assert [c for c in calls if c[1] == "restart"] == [
        ["systemctl", "restart", "english-helper"], ["systemctl", "restart", "english-helper-workers"]]
    calls.clear()
    enabled = False
    tts_guard.restart_service()
    assert [c for c in calls if c[1] == "restart"] == [["systemctl", "restart", "english-helper"]]


# ======================================================================== 单元考试: 答案不在进程内存里

@pytest_asyncio.fixture
async def exam_env(db_session):
    from app.models.learning import BookAssignment
    from app.models.organization import Organization
    from app.models.user import DailyCheckin, User
    from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition

    tenancy._org_cache.clear()
    org = Organization(name="多进程测试机构", code="MPXORG", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="mpxteacher", email="mpxt@e.com", hashed_password="x", role="teacher",
                   is_active=True, org_id=org.id)
    stu = User(username="mpxstu", email="mpxs@e.com", hashed_password="x", role="student",
               is_active=True, org_id=org.id)
    other = User(username="mpxother", email="mpxo@e.com", hashed_password="x", role="student",
                 is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu, other])
    await db_session.flush()
    book = WordBook(name="mpxbook", is_public=True, grade_level="小学五年级")
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="mpx U1")
    db_session.add(unit)
    await db_session.flush()
    for i, w in enumerate(["apple", "banana", "orange", "grape", "lemon", "peach"]):
        word = Word(word=w)
        db_session.add(word)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=word.id, meaning=f"水果{i}", is_primary=True,
                                      example_sentence=f"I eat an {w} every day."))
        db_session.add(UnitWord(unit_id=unit.id, word_id=word.id, order_index=i))
    for s in (stu, other):
        db_session.add(DailyCheckin(user_id=s.id, checkin_date=local_today()))
        db_session.add(BookAssignment(student_id=s.id, book_id=book.id, scope_type="book",
                                      teacher_id=teacher.id))
    await db_session.commit()
    return {"stu": stu.id, "other": other.id, "unit": unit.id}


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _generate(client, uid, unit_id):
    r = await client.get(f"/api/v1/student/exam/generate/{unit_id}", headers=_h(uid))
    assert r.status_code == 200, r.text
    return r.json()


async def _answers_from_db(db_session, paper_id):
    from app.models.learning import ExamQuestion
    rows = (await db_session.execute(
        select(ExamQuestion).where(ExamQuestion.paper_id == paper_id))).scalars().all()
    return [{"question_id": q.order_index, "answer": q.correct_answer} for q in rows]


async def test_unit_exam_answers_come_from_db(client, db_session, exam_env):
    from app.models.learning import ExamQuestion, ExamSubmission
    exam = await _generate(client, exam_env["stu"], exam_env["unit"])
    pid = exam["paper_id"]
    assert exam["exam_id"].split(".")[0] == str(pid)
    # 改库里的标准答案: 若交卷还在读进程内存里的那份,改了就对不上
    await db_session.execute(update(ExamQuestion).where(
        ExamQuestion.paper_id == pid, ExamQuestion.order_index == 1).values(correct_answer="ZZZ"))
    await db_session.commit()
    answers = await _answers_from_db(db_session, pid)
    r = await client.post("/api/v1/student/exam/submit", headers=_h(exam_env["stu"]),
                          json={"exam_id": exam["exam_id"], "answers": answers, "time_spent": 30})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["score"] == 100 and body["correct_count"] == body["total_questions"]
    sub = (await db_session.execute(select(ExamSubmission).where(ExamSubmission.paper_id == pid))).scalar_one()
    assert sub.unit_id == exam_env["unit"]


async def test_unit_exam_id_is_tamper_proof(client, db_session, exam_env):
    from app.api.v1.student import unit_exam
    exam = await _generate(client, exam_env["stu"], exam_env["unit"])
    pid, ts, sig = exam["exam_id"].split(".")
    answers = await _answers_from_db(db_session, int(pid))
    other_exam = await _generate(client, exam_env["other"], exam_env["unit"])

    async def submit(uid, exam_id):
        return await client.post("/api/v1/student/exam/submit", headers=_h(uid),
                                 json={"exam_id": exam_id, "answers": answers, "time_spent": 1})

    # 乱写的 / 改了试卷号的 / 签名改一位的
    for bad in ("abc", "1.2", "x.y.z", f"{other_exam['paper_id']}.{ts}.{sig}",
                f"{pid}.{ts}.{'0' if sig[0] != '0' else '1'}{sig[1:]}"):
        assert (await submit(exam_env["stu"], bad)).status_code == 404, bad
    # 别的学生拿着这张卷的 exam_id 交(交卷那里还有一道 paper.user_id 判断兜着,
    # 所以签名本身绑不绑学生要单独锁: 签名不绑学生 = 拿到 id 就能冒充别人)
    assert (await submit(exam_env["other"], exam["exam_id"])).status_code == 404
    assert unit_exam._parse_exam_id(exam["exam_id"], exam_env["stu"]) == int(pid)
    assert unit_exam._parse_exam_id(exam["exam_id"], exam_env["other"]) is None
    # 过期(签名是对的)
    old = int(time.time()) - unit_exam.EXAM_CACHE_TTL - 5
    expired = f"{pid}.{old}.{unit_exam._exam_sig(int(pid), exam_env['stu'], old)}"
    assert (await submit(exam_env["stu"], expired)).status_code == 404
    # 正常交一次,第二次 404
    assert (await submit(exam_env["stu"], exam["exam_id"])).status_code == 200
    assert (await submit(exam_env["stu"], exam["exam_id"])).status_code == 404
    # 另一个「进程」重新签出同一张卷的 id 也交不了第二次(看的是库里有没有提交记录)
    resigned = unit_exam._make_exam_id(int(pid), exam_env["stu"])
    assert (await submit(exam_env["stu"], resigned)).status_code == 404


async def test_unit_exam_strategy_recorded(client, db_session, exam_env):
    from app.models.learning import ExamPaper
    exam = await _generate(client, exam_env["stu"], exam_env["unit"])
    paper = await db_session.get(ExamPaper, exam["paper_id"])
    assert json.loads(paper.generation_strategy) == {"kind": "unit_exam", "unit_id": exam_env["unit"]}
