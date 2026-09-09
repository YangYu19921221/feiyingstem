"""直播弹幕互动 —— 过滤/禁言/删除/清屏/班级隔离/节流合并。

弹幕逻辑跑在 WS 端点里,业务副作用都在 live_ws 的独立 AsyncSessionLocal 会话中。
真起 WS 握手在 httpx 里很繁琐,这里改为:
- 纯函数(clean_danmaku)直接测;
- 连接管理器(DanmakuManager)用假 WebSocket 测内存行为(节流合并、在线数、禁言集);
- handler(_handle_danmaku/_handle_mute/_handle_delete/_handle_clear)把 live_ws 的
  AsyncSessionLocal 换成共享连接的内存库(StaticPool),验证落库 + 广播副作用;
- 班级归属(_check_access)直接传 db_session。
"""
import asyncio
import json

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.live import LiveSession, LiveDanmaku, LiveDanmakuMute
from app.services.danmaku_filter import clean_danmaku
import app.api.v1.live_ws as ws


# ---------------- 纯函数:内容过滤 ----------------

def test_clean_danmaku_normal_pass():
    cleaned, blocked = clean_danmaku("老师好，这道题我会")
    assert not blocked
    assert cleaned == "老师好，这道题我会"


def test_clean_danmaku_masks_profanity():
    cleaned, blocked = clean_danmaku("你这个傻逼快点讲")
    assert "傻逼" not in cleaned
    assert "**" in cleaned
    assert not blocked  # 只有一处脏话,不整条拦


def test_clean_danmaku_blocks_all_profanity():
    _, blocked = clean_danmaku("傻逼")
    assert blocked


def test_clean_danmaku_masks_contact_and_long_digits():
    cleaned, _ = clean_danmaku("加微信 13800138000")
    assert "微信" not in cleaned
    assert "13800138000" not in cleaned


def test_clean_danmaku_truncates_and_rejects_empty():
    long, _ = clean_danmaku("好" * 500)
    assert len(long) <= 200
    _, blocked = clean_danmaku("    ")
    assert blocked


# ---------------- 假 WebSocket ----------------

class FakeWS:
    def __init__(self):
        self.sent = []
        self.closed = None

    async def accept(self):
        pass

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)

    def events(self, etype):
        return [m for m in self.sent if m.get("type") == etype]


@pytest.fixture(autouse=True)
def _clean_manager():
    """每个测试前后清空模块级单例,避免串味。"""
    ws.manager.active.clear()
    ws.manager.pending.clear()
    ws.manager.muted.clear()
    for t in ws.manager.flush_tasks.values():
        if not t.done():
            t.cancel()
    ws.manager.flush_tasks.clear()
    yield


# ---------------- 连接管理器:内存行为 ----------------

@pytest.mark.asyncio
async def test_manager_connect_online_count():
    a, b = FakeWS(), FakeWS()
    await ws.manager.connect(1, 101, a)
    await ws.manager.connect(1, 102, b)
    assert ws.manager.online_count(1) == 2
    ws.manager.disconnect(1, 101, a)
    assert ws.manager.online_count(1) == 1


@pytest.mark.asyncio
async def test_manager_second_tab_kicks_first():
    a, b = FakeWS(), FakeWS()
    await ws.manager.connect(1, 101, a)
    await ws.manager.connect(1, 101, b)  # 同一用户再连
    assert a.closed is not None and a.closed[0] == 4000
    assert ws.manager.online_count(1) == 1


@pytest.mark.asyncio
async def test_manager_throttle_merges_batch():
    """窗口内多条弹幕合并成一个 danmaku_batch 广播。"""
    a = FakeWS()
    await ws.manager.connect(1, 101, a)
    for i in range(5):
        ws.manager.queue_danmaku(1, {"id": i, "name": "甲", "role": "student", "content": f"m{i}"})
    # 等过一个窗口
    await asyncio.sleep(ws.FLUSH_INTERVAL_MS / 1000 + 0.1)
    batches = a.events("danmaku_batch")
    assert len(batches) == 1
    assert len(batches[0]["items"]) == 5


@pytest.mark.asyncio
async def test_manager_broadcast_cleans_dead():
    class DeadWS(FakeWS):
        async def send_text(self, text):
            raise RuntimeError("connection gone")
    good, dead = FakeWS(), DeadWS()
    await ws.manager.connect(1, 101, good)
    await ws.manager.connect(1, 102, dead)
    await ws.manager.broadcast(1, {"type": "ping"})
    # 死连接被清掉
    assert ws.manager.online_count(1) == 1


# ---------------- handler:落库 + 广播副作用 ----------------

@pytest_asyncio.fixture
async def ws_db(monkeypatch):
    """共享连接的内存库(StaticPool 让多个 session 看到同一份数据),
    并把 live_ws 的 AsyncSessionLocal 指过来。"""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    monkeypatch.setattr(ws, "AsyncSessionLocal", Maker)

    # 播种:机构 + 老师 + 两个班 + 各一个学生 + 一节绑 A 班的课
    async with Maker() as db:
        org = Organization(name="弹幕机构", code="DM01", status="active")
        db.add(org)
        await db.flush()
        teacher = User(username="dm_t", email="dm_t@e.com", hashed_password="x",
                       role="teacher", full_name="王老师", is_active=True, org_id=org.id)
        stu_a = User(username="dm_a", email="dm_a@e.com", hashed_password="x",
                     role="student", full_name="学生甲", is_active=True, org_id=org.id)
        stu_b = User(username="dm_b", email="dm_b@e.com", hashed_password="x",
                     role="student", full_name="学生乙", is_active=True, org_id=org.id)
        db.add_all([teacher, stu_a, stu_b])
        await db.flush()
        cls_a = Class(name="A班", teacher_id=teacher.id, org_id=org.id)
        cls_b = Class(name="B班", teacher_id=teacher.id, org_id=org.id)
        db.add_all([cls_a, cls_b])
        await db.flush()
        db.add(ClassStudent(class_id=cls_a.id, student_id=stu_a.id, is_active=True))
        db.add(ClassStudent(class_id=cls_b.id, student_id=stu_b.id, is_active=True))
        sess = LiveSession(org_id=org.id, teacher_id=teacher.id, class_id=cls_a.id,
                           title="第一课", status="live", stream_key="k_dm_1")
        db.add(sess)
        await db.commit()
        ids = {"teacher": teacher.id, "stu_a": stu_a.id, "stu_b": stu_b.id,
               "cls_a": cls_a.id, "cls_b": cls_b.id, "session": sess.id, "org": org.id}
    yield Maker, ids
    await engine.dispose()


async def _count_danmaku(Maker, session_id, include_deleted=False):
    async with Maker() as db:
        q = select(LiveDanmaku).where(LiveDanmaku.live_session_id == session_id)
        if not include_deleted:
            q = q.where(LiveDanmaku.is_deleted == False)  # noqa: E712
        return len((await db.execute(q)).scalars().all())


@pytest.mark.asyncio
async def test_handle_danmaku_persists_and_queues(ws_db):
    Maker, ids = ws_db
    sid = ids["session"]
    stu = User(id=ids["stu_a"], username="dm_a", role="student", full_name="学生甲")
    a = FakeWS()
    await ws.manager.connect(sid, stu.id, a)
    await ws._handle_danmaku(sid, stu, "学生甲", False, {"content": "老师好"})
    assert await _count_danmaku(Maker, sid) == 1
    await asyncio.sleep(ws.FLUSH_INTERVAL_MS / 1000 + 0.1)
    assert a.events("danmaku_batch")


@pytest.mark.asyncio
async def test_handle_danmaku_blocked_not_persisted(ws_db):
    Maker, ids = ws_db
    sid = ids["session"]
    stu = User(id=ids["stu_a"], username="dm_a", role="student", full_name="学生甲")
    a = FakeWS()
    await ws.manager.connect(sid, stu.id, a)
    await ws._handle_danmaku(sid, stu, "学生甲", False, {"content": "傻逼"})
    assert await _count_danmaku(Maker, sid) == 0
    assert a.events("error")


@pytest.mark.asyncio
async def test_muted_student_cannot_send(ws_db):
    Maker, ids = ws_db
    sid = ids["session"]
    stu = User(id=ids["stu_a"], username="dm_a", role="student", full_name="学生甲")
    a = FakeWS()
    await ws.manager.connect(sid, stu.id, a)
    ws.manager.set_mute(sid, stu.id, True)
    await ws._handle_danmaku(sid, stu, "学生甲", False, {"content": "我想说话"})
    assert await _count_danmaku(Maker, sid) == 0
    errs = a.events("error")
    assert errs and errs[0]["code"] == "muted"


@pytest.mark.asyncio
async def test_mute_persists_then_unmute(ws_db):
    Maker, ids = ws_db
    sid, stu_id = ids["session"], ids["stu_a"]
    target = FakeWS()
    await ws.manager.connect(sid, stu_id, target)
    await ws._handle_mute(sid, {"student_id": stu_id}, on=True)
    assert ws.manager.is_muted(sid, stu_id)
    async with Maker() as db:
        row = (await db.execute(
            select(LiveDanmakuMute).where(LiveDanmakuMute.live_session_id == sid,
                                          LiveDanmakuMute.student_id == stu_id)
        )).scalar_one_or_none()
        assert row is not None
    assert target.events("you_are_muted")
    # 解禁
    await ws._handle_mute(sid, {"student_id": stu_id}, on=False)
    assert not ws.manager.is_muted(sid, stu_id)
    async with Maker() as db:
        row = (await db.execute(
            select(LiveDanmakuMute).where(LiveDanmakuMute.live_session_id == sid,
                                          LiveDanmakuMute.student_id == stu_id)
        )).scalar_one_or_none()
        assert row is None


@pytest.mark.asyncio
async def test_teacher_delete_marks_and_broadcasts(ws_db):
    Maker, ids = ws_db
    sid = ids["session"]
    async with Maker() as db:
        row = LiveDanmaku(live_session_id=sid, user_id=ids["stu_a"], user_role="student",
                          display_name="学生甲", content="待删")
        db.add(row)
        await db.commit()
        await db.refresh(row)
        did = row.id
    watcher = FakeWS()
    await ws.manager.connect(sid, ids["teacher"], watcher)
    await ws._handle_delete(sid, {"danmaku_id": did})
    assert await _count_danmaku(Maker, sid) == 0            # 未删口径少了这条
    assert await _count_danmaku(Maker, sid, include_deleted=True) == 1  # 行还在(留痕)
    assert watcher.events("deleted")


@pytest.mark.asyncio
async def test_clear_marks_all(ws_db):
    Maker, ids = ws_db
    sid = ids["session"]
    async with Maker() as db:
        for i in range(3):
            db.add(LiveDanmaku(live_session_id=sid, user_id=ids["stu_a"],
                               user_role="student", display_name="甲", content=f"c{i}"))
        await db.commit()
    watcher = FakeWS()
    await ws.manager.connect(sid, ids["teacher"], watcher)
    await ws._handle_clear(sid)
    assert await _count_danmaku(Maker, sid) == 0
    assert await _count_danmaku(Maker, sid, include_deleted=True) == 3
    assert watcher.events("cleared")


@pytest.mark.asyncio
async def test_class_isolation_access(ws_db):
    """班级隔离:A 班学生可进、B 班学生被拒;本人老师可进、别的老师被拒。"""
    Maker, ids = ws_db
    async with Maker() as db:
        sess = await db.get(LiveSession, ids["session"])
        stu_a = await db.get(User, ids["stu_a"])
        stu_b = await db.get(User, ids["stu_b"])
        teacher = await db.get(User, ids["teacher"])
        assert await ws._check_access(db, sess, stu_a) is True
        assert await ws._check_access(db, sess, stu_b) is False
        assert await ws._check_access(db, sess, teacher) is True
        # 别的老师
        other = User(username="dm_t2", email="dm_t2@e.com", hashed_password="x",
                     role="teacher", full_name="李老师", is_active=True, org_id=ids["org"])
        db.add(other)
        await db.flush()
        assert await ws._check_access(db, sess, other) is False
