"""音标视频库「单独码开」闸门(2026-10-01)

机构可把音标视频库从「免费开放」切成「需兑换码」。切成 code 模式后:
- 学生没有生效授权 → 换票据(主闸门)和 Bearer 直连串流都 403;列表 locked=true;
- 用音标专用兑换码兑换后 → 立刻能换票、能播,列表 locked=false;
- 老师/管理员**永不**受限(他们要备课、要检查内容);
- 授权是**一人一行**,甲机构学生兑了码不会让乙机构学生跟着解锁;
- open 模式(默认、存量零影响)照旧谁都能看。

守的核心是**授权**不是防拷贝(抓包防不住,见 test_phonetic_media_guard)。
每条断言都配一处可破坏的守卫:破坏它 → 对应用例失败,这才算回归锁。
"""
import time

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.core.config import settings
from datetime import datetime, timedelta

from app.core.timeutil import local_today
from app.models.audit import OperationLog
from app.models.phonetic import (
    PhoneticVideo, PhoneticAccessGrant, PhoneticAccessLog, PhoneticCode,
)
from app.models.user import User
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _reset_process_state():
    """机构状态缓存和限速桶都是**进程内**状态,测试间必须清:
    - _org_cache 按 org_id 缓存 5 分钟,不清的话上个测试把 9921 缓存成 code 后,
      下个测试换了新内存库同样用 9921 会命中旧值 → 判定串台;
    - 限速桶灌满会让后面的 ticket 莫名 429。
    """
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def access_env(db_session, monkeypatch, tmp_path):
    """三机构(甲乙需码、丙开放)+ 各自视频 + 一个平台预置视频,视频文件真落盘。

    - 甲(9921)/乙(9922): phonetic_access_mode='code'(需兑换码)
    - 丙(9923): 'open'(默认免费开放)
    串流端点要真有文件可发,所以把 PHONETIC_VIDEO_DIR 指到 tmp_path 并写入假 mp4。
    """
    vdir = tmp_path / "vid"
    vdir.mkdir()
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(vdir))
    for key in ("vA", "vB", "preset"):
        (vdir / f"{key}.mp4").write_bytes(f"FAKE-MP4-{key}-".encode() * 64)

    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations "
        "(id, name, code, status, access_mode, phonetic_access_mode) VALUES "
        "(9921, '甲-需码', 'orgcodea', 'active', 'assigned', 'code'), "
        "(9922, '乙-需码', 'orgcodeb', 'active', 'assigned', 'code'), "
        "(9923, '丙-开放', 'orgopenc', 'active', 'assigned', 'open')"
    ))

    users = {}
    for key, uname, role, org in [
        ("stuA", "stucodea", "student", 9921),
        ("stuB", "stucodeb", "student", 9922),
        ("stuOpen", "stuopenc", "student", 9923),
        ("teacherA", "tchcodea", "teacher", 9921),
        ("admin", "admcodex", "admin", 9921),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    vids = {}
    for key, org in [("vA", 9921), ("vB", 9922), ("preset", None)]:
        v = PhoneticVideo(
            title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org,
        )
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()

    return {
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "uid": {k: u.id for k, u in users.items()},
        "vid": vids,
    }


async def _gen_code(client: AsyncClient, admin_tok: str, *, grant_type="permanent",
                    grant_days=None, grant_times=None) -> str:
    """平台 admin 发一张音标码,返回码串"""
    body = {"count": 1, "grant_type": grant_type}
    if grant_days is not None:
        body["grant_days"] = grant_days
    if grant_times is not None:
        body["grant_times"] = grant_times
    r = await client.post("/api/v1/admin/subscriptions/phonetic-codes/generate",
                          headers=_h(admin_tok), json=body)
    assert r.status_code == 200, r.text
    return r.json()[0]["code"]


async def _redeem(client: AsyncClient, stu_tok: str, code: str):
    return await client.post("/api/v1/subscription/redeem",
                             headers=_h(stu_tok), json={"code": code})


async def _ticket(client: AsyncClient, tok: str, vid: int):
    return await client.get(f"/api/v1/phonetics/videos/{vid}/ticket", headers=_h(tok))


# ---------- open 模式:存量零影响,谁都能看 ----------

async def test_open_mode_student_not_gated(client: AsyncClient, access_env):
    """丙机构 open 模式(默认):学生照旧换到票、列表不锁。
    守卫: _is_locked_for 里 `mode != "code" → False` 那支。"""
    env = access_env
    r = await _ticket(client, env["tok"]["stuOpen"], env["vid"]["preset"])
    assert r.status_code == 200, r.text
    assert "?t=" in r.json()["url"]
    assert r.json()["expires_at"] > int(time.time()) + 3600

    lst = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["stuOpen"]))
    assert lst.status_code == 200
    assert all(item["locked"] is False for item in lst.json())


# ---------- code 模式 + 无授权 → 全锁 ----------

async def test_code_mode_no_grant_ticket_403(client: AsyncClient, access_env):
    """甲机构 code 模式、学生没授权:换票 403(主闸门)。
    守卫: video_ticket 里 `if await _is_locked_for(...): raise 403`。"""
    env = access_env
    r = await _ticket(client, env["tok"]["stuA"], env["vid"]["vA"])
    assert r.status_code == 403
    assert "兑换码" in r.json()["detail"]


async def test_code_mode_no_grant_list_locked(client: AsyncClient, access_env):
    """列表接口对无授权学生返回 locked=true(前端据此画 🔒)。
    守卫: list_videos 的 `locked = await _is_locked_for(...)`。"""
    env = access_env
    lst = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["stuA"]))
    assert lst.status_code == 200
    assert len(lst.json()) >= 1
    assert all(item["locked"] is True for item in lst.json())


async def test_code_mode_no_grant_stream_bearer_403(client: AsyncClient, access_env):
    """Bearer 直连串流也过闸门:拿账号 token 直接 GET /stream 不能绕过票据。
    守卫: stream_video 的 Bearer 分支 `if await _is_locked_for(u): raise 403`。"""
    env = access_env
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/stream",
                         headers=_h(env["tok"]["stuA"]))
    assert r.status_code == 403


# ---------- 兑换后解锁 ----------

async def test_redeem_permanent_unlocks(client: AsyncClient, access_env):
    """发永久码 → 学生兑换 → 立刻能换票、能 Bearer 串流、列表不锁。
    这是整条链路(发码→兑换→授权→闸门放行)的正向验证。"""
    env = access_env
    # 兑换前锁住
    assert (await _ticket(client, env["tok"]["stuA"], env["vid"]["vA"])).status_code == 403

    code = await _gen_code(client, env["tok"]["admin"])
    rd = await _redeem(client, env["tok"]["stuA"], code)
    assert rd.status_code == 200, rd.text
    assert rd.json()["success"] is True
    assert rd.json()["scope"] == "phonetic"

    # 兑换后放行
    tk = await _ticket(client, env["tok"]["stuA"], env["vid"]["vA"])
    assert tk.status_code == 200, tk.text
    play = await client.get(tk.json()["url"])
    assert play.status_code == 200 and play.content.startswith(b"FAKE-MP4-vA-")

    stream = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/stream",
                             headers=_h(env["tok"]["stuA"]))
    assert stream.status_code == 200

    lst = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["stuA"]))
    assert all(item["locked"] is False for item in lst.json())


async def test_used_code_cannot_be_redeemed_twice(client: AsyncClient, access_env):
    """一张码只兑一次:第二次兑换(即便换个学生)被拒。"""
    env = access_env
    code = await _gen_code(client, env["tok"]["admin"])
    assert (await _redeem(client, env["tok"]["stuA"], code)).json()["success"] is True
    again = await _redeem(client, env["tok"]["stuA"], code)
    assert again.json()["success"] is False
    assert "已被使用" in again.json()["message"]


# ---------- 次卡:换票那一步才扣,同天幂等 ----------

async def test_times_card_consumed_on_ticket(client: AsyncClient, access_env, db_session):
    """次卡兑换后 times_left=2;第一次换票扣 1 → 1;同一天再换票不重复扣。
    守卫: video_ticket 里 `await consume_times_if_needed(...)`(漏掉则永远不扣)。"""
    env = access_env
    code = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=2)
    assert (await _redeem(client, env["tok"]["stuA"], code)).json()["success"] is True

    async def _times_left() -> int:
        row = (await db_session.execute(
            select(PhoneticAccessGrant).where(
                PhoneticAccessGrant.student_id == env["uid"]["stuA"])
        )).scalars().first()
        await db_session.refresh(row)
        return row.times_left

    assert await _times_left() == 2
    assert (await _ticket(client, env["tok"]["stuA"], env["vid"]["vA"])).status_code == 200
    assert await _times_left() == 1
    # 同一天再换一张票:幂等,不再扣
    assert (await _ticket(client, env["tok"]["stuA"], env["vid"]["vA"])).status_code == 200
    assert await _times_left() == 1


# ---------- 老师/管理员永不受限 ----------

async def test_teacher_never_gated(client: AsyncClient, access_env):
    """甲机构 code 模式,老师没有也不需要授权,照常换票。
    守卫: _is_locked_for 开头 `if user.role != "student": return False`。"""
    env = access_env
    r = await _ticket(client, env["tok"]["teacherA"], env["vid"]["vA"])
    assert r.status_code == 200, r.text
    lst = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["teacherA"]))
    assert all(item["locked"] is False for item in lst.json())


# ---------- 授权是一人一行,不跨学生/跨机构外溢 ----------

async def test_grant_does_not_leak_across_students(client: AsyncClient, access_env):
    """甲机构学生兑了码,乙机构学生仍无授权 → 仍 403。
    授权挂在 student_id 上,不是机构级,也不是全局开关。"""
    env = access_env
    code = await _gen_code(client, env["tok"]["admin"])
    assert (await _redeem(client, env["tok"]["stuA"], code)).json()["success"] is True

    # 乙机构学生看自己机构的视频:仍锁
    r = await _ticket(client, env["tok"]["stuB"], env["vid"]["vB"])
    assert r.status_code == 403
    lst = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["stuB"]))
    assert all(item["locked"] is True for item in lst.json())


async def test_video_not_visible_cross_org(client: AsyncClient, access_env):
    """顺带锁住 _scope_org:甲机构学生换乙机构视频的票 → 404(看不见,不是 403)。
    （先于本功能存在的边界,这里一并守住,免得闸门改动把它削弱。）"""
    env = access_env
    # 先给甲学生授权,排除「因为锁了才 404」的歧义 —— 这里要的是「看不见」
    code = await _gen_code(client, env["tok"]["admin"])
    await _redeem(client, env["tok"]["stuA"], code)
    r = await _ticket(client, env["tok"]["stuA"], env["vid"]["vB"])
    assert r.status_code == 404


# ---------- 讲义同属闸门(审查补的漏洞) ----------

async def test_code_mode_no_grant_materials_403(client: AsyncClient, access_env):
    """讲义列表和讲义页图也要过闸门,否则逐页 PNG 照看不误 = 绕开视频锁。
    守卫: list_video_materials / material_page 里的 `_is_locked_for → 403`。
    material_page 的闸门在查行之前,所以随便一个 material_id 都应 403 而不是 404。"""
    env = access_env
    tok = env["tok"]["stuA"]
    lst = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/materials",
                           headers=_h(tok))
    assert lst.status_code == 403
    page = await client.get("/api/v1/phonetics/materials/999999/page/1", headers=_h(tok))
    assert page.status_code == 403

    # 兑换后放行:列表 200(这里没传课件所以是空表),页图回到「不存在」的 404
    code = await _gen_code(client, env["tok"]["admin"])
    assert (await _redeem(client, tok, code)).json()["success"] is True
    lst = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/materials",
                           headers=_h(tok))
    assert lst.status_code == 200 and lst.json() == []
    page = await client.get("/api/v1/phonetics/materials/999999/page/1", headers=_h(tok))
    assert page.status_code == 404


# ---------- 失效后换卡种重新开通(审查补的死路) ----------

async def _grant_row(db_session, student_id: int) -> PhoneticAccessGrant:
    row = (await db_session.execute(
        select(PhoneticAccessGrant).where(PhoneticAccessGrant.student_id == student_id)
    )).scalars().first()
    await db_session.refresh(row)
    return row


async def test_expired_period_can_reopen_with_times(client: AsyncClient, access_env, db_session):
    """包月过期后兑次卡:旧逻辑判「跨类型请等用完」→ 永远续不上(过期的卡不会再"用完")。
    守卫: redeem_phonetic_code 里 `elif not existing_active:` 整条覆盖那支。"""
    env = access_env
    tok, uid = env["tok"]["stuA"], env["uid"]["stuA"]
    code = await _gen_code(client, env["tok"]["admin"], grant_type="period", grant_days=30)
    assert (await _redeem(client, tok, code)).json()["success"] is True

    row = await _grant_row(db_session, uid)
    row.expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()
    assert (await _ticket(client, tok, env["vid"]["vA"])).status_code == 403

    code2 = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=3)
    rd = await _redeem(client, tok, code2)
    assert rd.json()["success"] is True, rd.json()
    row = await _grant_row(db_session, uid)
    assert row.grant_type == "times" and row.times_left == 3 and row.expires_at is None
    assert (await _ticket(client, tok, env["vid"]["vA"])).status_code == 200


async def test_exhausted_times_can_reopen_with_period(client: AsyncClient, access_env, db_session):
    """次卡用完(times_left=0 且不是今天扣的)后兑包月:同样必须能重新开通。"""
    env = access_env
    tok, uid = env["tok"]["stuA"], env["uid"]["stuA"]
    code = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=1)
    assert (await _redeem(client, tok, code)).json()["success"] is True

    row = await _grant_row(db_session, uid)
    row.times_left = 0
    row.last_consumed_date = (local_today() - timedelta(days=1)).isoformat()
    await db_session.commit()
    assert (await _ticket(client, tok, env["vid"]["vA"])).status_code == 403

    code2 = await _gen_code(client, env["tok"]["admin"], grant_type="period", grant_days=30)
    rd = await _redeem(client, tok, code2)
    assert rd.json()["success"] is True, rd.json()
    row = await _grant_row(db_session, uid)
    assert row.grant_type == "period" and row.times_left is None
    assert row.expires_at > datetime.utcnow() + timedelta(days=29)
    assert (await _ticket(client, tok, env["vid"]["vA"])).status_code == 200


async def test_active_period_still_rejects_times(client: AsyncClient, access_env):
    """**生效中**的包月兑次卡仍拒(不吞码):放开「失效覆盖」不能顺手把这条也放开。"""
    env = access_env
    tok = env["tok"]["stuA"]
    code = await _gen_code(client, env["tok"]["admin"], grant_type="period", grant_days=30)
    assert (await _redeem(client, tok, code)).json()["success"] is True
    code2 = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=3)
    rd = await _redeem(client, tok, code2)
    assert rd.json()["success"] is False
    assert "请等当前的用完" in rd.json()["message"]


# ---------- 访问日志单独落表,不进机构操作记录 ----------

async def test_ticket_logs_to_access_table_not_operation_logs(
        client: AsyncClient, access_env, db_session):
    """学生换票写 phonetic_access_logs(带 IP/设备),**不写** operation_logs ——
    后者是教职工追责日志(学生不记),学生每看一节写一条会把机构「操作记录」淹没。"""
    env = access_env
    tok, uid = env["tok"]["stuOpen"], env["uid"]["stuOpen"]
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['preset']}/ticket",
                         headers={**_h(tok), "X-Real-IP": "10.1.2.3", "User-Agent": "UA-test"})
    assert r.status_code == 200, r.text

    logs = (await db_session.execute(
        select(PhoneticAccessLog).where(PhoneticAccessLog.user_id == uid)
    )).scalars().all()
    assert len(logs) == 1
    assert logs[0].video_id == env["vid"]["preset"]
    assert logs[0].ip == "10.1.2.3" and logs[0].user_agent == "UA-test"

    ops = (await db_session.execute(
        select(OperationLog).where(OperationLog.actor_id == uid)
    )).scalars().all()
    assert ops == []


# ---------- 审查第二轮(4 路对抗审查 11 条确认问题)的回归锁 ----------

async def test_parent_account_cannot_bypass_gate(client: AsyncClient, access_env, db_session):
    """家长号能凭孩子自己生成的绑定码零成本注册(不验手机,org_id 落列默认值),
    早先「非学生恒放行」= 没码的学生换个家长号就能看。家长一律拦(家长端本无音标入口)。
    守卫: _gate_state 里 `if user.role != "student": return "locked"`。"""
    env = access_env
    parent = User(username="parcodex", email="parcodex@e.com", hashed_password="x",
                  role="parent", full_name="家长", is_active=True, org_id=9923)  # 开放机构也拦
    db_session.add(parent)
    await db_session.commit()
    tok = _make_token(parent.id)
    assert (await _ticket(client, tok, env["vid"]["preset"])).status_code == 403
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['preset']}/stream", headers=_h(tok))
    assert r.status_code == 403
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['preset']}/materials", headers=_h(tok))
    assert r.status_code == 403


async def test_times_card_consumed_on_materials_and_stream(client: AsyncClient, access_env, db_session):
    """次卡不只在换票扣:只翻讲义 / 直接 Bearer 串流也算「进去看」,否则 1 天的卡等于永久卡。
    守卫: list_video_materials / stream_video 走 _enforce_gate(内含扣减)。"""
    env = access_env
    tok, uid = env["tok"]["stuA"], env["uid"]["stuA"]
    code = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=2)
    assert (await _redeem(client, tok, code)).json()["success"] is True

    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/materials", headers=_h(tok))
    assert r.status_code == 200
    assert (await _grant_row(db_session, uid)).times_left == 1

    # 同一天再走 Bearer 串流:幂等不再扣,但要留访问日志
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/stream", headers=_h(tok))
    assert r.status_code == 200
    assert (await _grant_row(db_session, uid)).times_left == 1
    logs = (await db_session.execute(
        select(PhoneticAccessLog).where(PhoneticAccessLog.user_id == uid)
    )).scalars().all()
    assert len(logs) == 1 and logs[0].video_id == env["vid"]["vA"]

    # 换个北京日(把「今天已扣」挪到昨天)→ Bearer 串流单独也会扣
    row = await _grant_row(db_session, uid)
    row.last_consumed_date = (local_today() - timedelta(days=1)).isoformat()
    await db_session.commit()
    r = await client.get(f"/api/v1/phonetics/videos/{env['vid']['vA']}/stream", headers=_h(tok))
    assert r.status_code == 200
    assert (await _grant_row(db_session, uid)).times_left == 0


async def test_open_mode_does_not_consume_times_card(client: AsyncClient, access_env, db_session):
    """机构是免费开放(open)时,学生手里的次卡**不扣**:免费期间看视频不该消耗买的卡。
    守卫: _enforce_gate 只在 times_due(靠次卡进来)时扣。"""
    env = access_env
    tok, uid = env["tok"]["stuOpen"], env["uid"]["stuOpen"]
    code = await _gen_code(client, env["tok"]["admin"], grant_type="times", grant_times=3)
    assert (await _redeem(client, tok, code)).json()["success"] is True
    assert (await _ticket(client, tok, env["vid"]["preset"])).status_code == 200
    assert (await _grant_row(db_session, uid)).times_left == 3


async def test_expired_code_marked_expired_not_disabled(client: AsyncClient, access_env, db_session):
    """码过期写 status='expired'(不是 disabled):disabled 是管理员手动作废,混用会让学生
    再输一次看到「已被禁用」、后台对账分不清。"""
    env = access_env
    code = await _gen_code(client, env["tok"]["admin"])
    row = (await db_session.execute(
        select(PhoneticCode).where(PhoneticCode.code == code))).scalars().first()
    row.code_expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    r1 = await _redeem(client, env["tok"]["stuA"], code)
    assert r1.json()["success"] is False and "过期" in r1.json()["message"]
    await db_session.refresh(row)
    assert row.status == "expired"
    r2 = await _redeem(client, env["tok"]["stuA"], code)
    assert "过期" in r2.json()["message"]


# ---------- 并发:必须用真文件库 + 独立会话(共享一个内存会话测不出竞态) ----------

@pytest_asyncio.fixture
async def file_db(tmp_path):
    """文件型 SQLite + 两个独立会话,复现生产「两个请求同时到」。"""
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.core.database import Base
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}",
                                 connect_args={"timeout": 15})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as s:
        ids = []
        for n in ("racea", "raceb"):
            u = User(username=n, email=f"{n}@e.com", hashed_password="x", role="student",
                     full_name=n, is_active=True, org_id=1)
            s.add(u)
            await s.flush()
            ids.append(u.id)
        for c in ("RACE-AAAA-AAAA-AAA1", "RACE-AAAA-AAAA-AAA2"):
            s.add(PhoneticCode(code=c, grant_type="permanent", status="unused"))
        await s.commit()
    try:
        yield Session, ids
    finally:
        await engine.dispose()


async def _redeem_in_own_session(Session, uid: int, code: str) -> dict:
    from app.services import phonetic_access_service
    async with Session() as s:
        user = await s.get(User, uid)
        return await phonetic_access_service.redeem_phonetic_code(s, user, code)


async def test_one_code_cannot_unlock_two_students_concurrently(file_db):
    """一码多兑(审查实测复现): 两个学生同时兑同一张码,旧写法两个都成功。
    守卫: 认领用条件 UPDATE `WHERE status='unused'` + rowcount。"""
    import asyncio
    Session, (a, b) = file_db
    ra, rb = await asyncio.gather(
        _redeem_in_own_session(Session, a, "RACE-AAAA-AAAA-AAA1"),
        _redeem_in_own_session(Session, b, "RACE-AAAA-AAAA-AAA1"),
    )
    assert sorted([ra["success"], rb["success"]]) == [False, True], (ra, rb)
    async with Session() as s:
        grants = (await s.execute(select(PhoneticAccessGrant))).scalars().all()
        assert len(grants) == 1
        code = (await s.execute(select(PhoneticCode).where(
            PhoneticCode.code == "RACE-AAAA-AAAA-AAA1"))).scalars().first()
        assert code.used_by == grants[0].student_id


async def test_same_student_two_codes_concurrently_no_500(file_db):
    """同一学生两台设备同时兑两张码: 旧写法两边都 INSERT → UNIQUE 冲突 → 500。
    现在后到的那个在写事务里重读到先到的行、走续期分支(两张都是永久 → 第二张被拒且不吞码)。"""
    import asyncio
    Session, (a, _b) = file_db
    r1, r2 = await asyncio.gather(
        _redeem_in_own_session(Session, a, "RACE-AAAA-AAAA-AAA1"),
        _redeem_in_own_session(Session, a, "RACE-AAAA-AAAA-AAA2"),
    )
    assert sorted([r1["success"], r2["success"]]) == [False, True], (r1, r2)
    async with Session() as s:
        grants = (await s.execute(select(PhoneticAccessGrant))).scalars().all()
        assert len(grants) == 1
        statuses = sorted((await s.execute(select(PhoneticCode.status))).scalars().all())
        assert statuses == ["unused", "used"]   # 被拒的那张码退回未使用
