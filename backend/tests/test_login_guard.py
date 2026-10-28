"""登录防爆破 + 改密码踢掉旧登录 + 接口文档不对外(2026-10-28)。

守的是四件事:
  1. 同一个号不能被无限猜(按账号 × IP、按账号、按 IP 三道闸门,见 services/login_guard)
  2. 闸门不能变成「谁都能把别人锁在外面」的按钮: 最近在这个 IP 登录成功过的,不受「按账号」那道拦
  3. 改密码 / 被重置密码后,别的设备手里的旧 token 立刻作废;当前设备拿新 token 接着用
  4. bcrypt 不在事件循环里算(否则有人刷登录,同进程所有孩子的请求一起卡住)
"""
import asyncio
import time

import pytest
from jose import jwt
from sqlalchemy import select

from app.core import tenancy
from app.core.config import settings
from app.models.organization import Organization
from app.models.user import User
from app.services import auth_service, login_guard
from tests.conftest import _make_token

PWD = "Passw0rd!"


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    org = Organization(id=81, name="防爆破机构", code="LG81", status="active", student_quota=100)
    db_session.add(org)
    await db_session.flush()

    def mk(username, role, **kw):
        return User(username=username, email=f"{username}@e.com",
                    hashed_password=auth_service.get_password_hash(PWD),
                    role=role, full_name=username, is_active=True, org_id=org.id, **kw)

    users = {
        "admin": mk("lgadmin", "admin"),
        "teacher": mk("lgteacher", "teacher", coin_pin_hash=auth_service.get_password_hash("1234")),
        "student": mk("lgstudent", "student", phone="13900000081"),
    }
    db_session.add_all(users.values())
    await db_session.commit()
    return users


def _hdr(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _login(client, username, password, ip="198.51.100.7"):
    return await client.post("/api/v1/auth/login/json", headers={"X-Real-IP": ip},
                             json={"username": username, "password": password})


# ============ 一、闸门 ============

@pytest.mark.asyncio
async def test_staff_locked_after_5_tries_from_same_ip(client, env):
    for _ in range(login_guard.PAIR_LIMIT_STAFF):
        assert (await _login(client, "lgteacher", "wrong999")).status_code == 401
    # 锁住以后连对的密码也不收(这一次根本不去校验)
    r = await _login(client, "lgteacher", PWD)
    assert r.status_code == 429, r.text
    assert r.json()["detail"]["code"] == "login_locked"
    assert int(r.headers["Retry-After"]) > 0
    # 换一个网络还能登(只锁「这个号 × 这个 IP」)
    assert (await _login(client, "lgteacher", PWD, ip="198.51.100.8")).status_code == 200


@pytest.mark.asyncio
async def test_success_clears_counter(client, env):
    """输错几次再输对,不该离锁更近: 再错 4 次仍能登"""
    for _ in range(login_guard.PAIR_LIMIT_STAFF - 1):
        await _login(client, "lgteacher", "wrong999")
    assert (await _login(client, "lgteacher", PWD)).status_code == 200
    for _ in range(login_guard.PAIR_LIMIT_STAFF - 1):
        await _login(client, "lgteacher", "wrong999")
    assert (await _login(client, "lgteacher", PWD)).status_code == 200


@pytest.mark.asyncio
async def test_student_gets_more_tries(client, env):
    for _ in range(login_guard.PAIR_LIMIT_STAFF):
        await _login(client, "lgstudent", "wrong999")
    assert (await _login(client, "lgstudent", PWD)).status_code == 200
    for _ in range(login_guard.PAIR_LIMIT_OTHER):
        await _login(client, "lgstudent", "wrong999")
    assert (await _login(client, "lgstudent", PWD)).status_code == 429


@pytest.mark.asyncio
async def test_phone_and_username_count_as_same_account(client, env):
    """用手机号登录和用用户名登录是同一个号,换着输不能多试几次"""
    for i in range(login_guard.PAIR_LIMIT_OTHER):
        name = "lgstudent" if i % 2 else "13900000081"
        await _login(client, name, "wrong999")
    assert (await _login(client, "13900000081", PWD)).status_code == 429


@pytest.mark.asyncio
async def test_account_lock_across_ips_spares_trusted_ip(client, env):
    """换 IP 轮着猜也有上限;但真管理员在常用网络里照样登得进来"""
    assert (await _login(client, "lgadmin", PWD, ip="203.0.113.1")).status_code == 200
    for i in range(login_guard.ACCT_LIMIT_STAFF):
        await _login(client, "lgadmin", "wrong999", ip=f"192.0.2.{i + 1}")
    r = await _login(client, "lgadmin", PWD, ip="192.0.2.200")
    assert r.status_code == 429, r.text
    assert "暂时锁住" in r.json()["detail"]["message"]
    assert (await _login(client, "lgadmin", PWD, ip="203.0.113.1")).status_code == 200


@pytest.mark.asyncio
async def test_unknown_username_is_counted_too(client, env):
    for _ in range(login_guard.PAIR_LIMIT_OTHER):
        assert (await _login(client, "nosuchuser", "xxxxxx")).status_code == 401
    assert (await _login(client, "nosuchuser", "xxxxxx")).status_code == 429


@pytest.mark.asyncio
async def test_ip_wide_limit(client, env, monkeypatch):
    monkeypatch.setattr(login_guard, "IP_LIMIT", 12)
    for i in range(12):
        await _login(client, f"scan{i}", "xxxxxx")
    assert (await _login(client, "lgstudent", PWD)).status_code == 429
    assert (await _login(client, "lgstudent", PWD, ip="198.51.100.99")).status_code == 200


@pytest.mark.asyncio
async def test_parent_login_is_guarded(client, db_session, env):
    parent = User(username="parent_13900000082", email="p82@parent.local", phone="13900000082",
                  hashed_password=auth_service.get_password_hash(PWD), role="parent", org_id=81)
    db_session.add(parent)
    await db_session.commit()
    for _ in range(login_guard.PAIR_LIMIT_OTHER):
        r = await client.post("/api/v1/parent/login", json={"phone": "13900000082", "password": "wrong999"})
        assert r.status_code == 401
    r = await client.post("/api/v1/parent/login", json={"phone": "13900000082", "password": PWD})
    assert r.status_code == 429, r.text


# ============ 二、改密码 / 重置密码踢掉旧登录 ============

@pytest.mark.asyncio
async def test_change_password_kicks_other_devices_keeps_this_one(client, env):
    t = env["teacher"]
    old = await _login(client, "lgteacher", PWD)
    other_device = {"Authorization": f"Bearer {old.json()['access_token']}"}
    legacy = _hdr(t.id)   # 上线前发的、没带 sv 的旧 token
    assert (await client.get("/api/v1/auth/me", headers=legacy)).status_code == 200

    r = await client.put("/api/v1/auth/change-password", headers=other_device,
                         json={"old_password": PWD, "new_password": "NewPass123"})
    assert r.status_code == 200, r.text
    new_token = r.json()["access_token"]

    for h in (other_device, legacy):
        r = await client.get("/api/v1/auth/me", headers=h)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "SESSION_KICKED"
    r = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    assert r.status_code == 200
    assert (await _login(client, "lgteacher", "NewPass123")).status_code == 200


@pytest.mark.asyncio
async def test_same_password_rejected(client, env):
    r = await client.put("/api/v1/auth/change-password", headers=_hdr(env["teacher"].id),
                         json={"old_password": PWD, "new_password": PWD})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_admin_reset_kicks_target(client, env):
    t = env["teacher"]
    target = _hdr(t.id)
    r = await client.post(f"/api/v1/admin/users/{t.id}/reset-password", headers=_hdr(env["admin"].id),
                          json={"new_password": "Reset12345"})
    assert r.status_code == 200, r.text
    assert (await client.get("/api/v1/auth/me", headers=target)).status_code == 401


@pytest.mark.asyncio
async def test_login_does_not_kick_staff_second_device(client, env):
    """正式机构老师手机电脑双开照旧: 再登录一次不让前一台下线"""
    a = (await _login(client, "lgteacher", PWD)).json()["access_token"]
    b = (await _login(client, "lgteacher", PWD, ip="198.51.100.9")).json()["access_token"]
    for tok in (a, b):
        assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})).status_code == 200


@pytest.mark.asyncio
async def test_admin_token_lasts_one_day(client, env):
    def days_left(tok):
        exp = jwt.decode(tok, settings.SECRET_KEY, algorithms=["HS256"])["exp"]
        return (exp - time.time()) / 86400
    admin_tok = (await _login(client, "lgadmin", PWD)).json()["access_token"]
    teacher_tok = (await _login(client, "lgteacher", PWD)).json()["access_token"]
    assert 0.9 < days_left(admin_tok) <= 1.01
    assert days_left(teacher_tok) > 6


# ============ 三、登录后输密码确认也有上限 ============

@pytest.mark.asyncio
async def test_change_password_wrong_old_password_limited(client, env):
    h = _hdr(env["teacher"].id)
    for _ in range(login_guard.CONFIRM_LIMIT):
        r = await client.put("/api/v1/auth/change-password", headers=h,
                             json={"old_password": "wrong999", "new_password": "NewPass123"})
        assert r.status_code == 400
    r = await client.put("/api/v1/auth/change-password", headers=h,
                         json={"old_password": PWD, "new_password": "NewPass123"})
    assert r.status_code == 429, r.text


@pytest.mark.asyncio
async def test_coin_pin_wrong_limited(client, env):
    h = _hdr(env["teacher"].id)
    for _ in range(login_guard.CONFIRM_LIMIT):
        r = await client.post("/api/v1/teacher/coins/pin", headers=h,
                              json={"old_pin": "0000", "new_pin": "5678"})
        assert r.status_code == 403
    r = await client.post("/api/v1/teacher/coins/pin", headers=h, json={"old_pin": "1234", "new_pin": "5678"})
    assert r.status_code == 429, r.text


# ============ 四、bcrypt 不卡事件循环 / 文档不对外 ============

@pytest.mark.asyncio
async def test_password_check_does_not_block_other_requests(client, env, monkeypatch):
    def slow_verify(plain, hashed):
        time.sleep(0.6)
        return False
    monkeypatch.setattr(auth_service.pwd_context, "verify", slow_verify)
    t0 = time.perf_counter()
    login = asyncio.create_task(_login(client, "lgteacher", "wrong999"))
    await asyncio.sleep(0.1)
    assert (await client.get("/health")).status_code == 200
    health_done = time.perf_counter() - t0
    assert (await login).status_code == 401
    assert health_done < 0.45, f"登录在算密码时别的请求被卡住了 {health_done:.2f}s"


@pytest.mark.asyncio
async def test_api_docs_not_public(client):
    for path in ("/docs", "/openapi.json", "/redoc"):
        assert (await client.get(path)).status_code == 404, path
    r = await client.get("/_internal/openapi.json")
    assert r.status_code == 200 and "/api/v1/auth/login/json" in r.json()["paths"]
