"""2026-10-14 安全收口: 原先不用登录就能调的接口 + 兑换码跨机构

守的是:
- GET /admin/ai/providers/default 返回 API Key 明文 → 只给平台管理员
- PUT/DELETE /words/{id} 改删任意单词 → 至少老师
- /ai/* 大模型/TTS → 必须登录;录词用的生成类再收紧到老师
- /achievements/leaderboard 跨机构返回学生真名 → 只给平台管理员
- 机构发的单词本兑换码只给本机构学生兑;平台管理员发的码不限机构
"""
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.core import tenancy
from app.models.user import User, RedemptionCode, RedemptionCodeBook
from app.models.word import Word, WordBook
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _reset_process_state():
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest_asyncio.fixture
async def env(db_session):
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations "
        "(id, name, code, status, access_mode, phonetic_access_mode) VALUES "
        "(9941, '甲', 'sl1014a', 'active', 'assigned', 'code'), "
        "(9942, '乙', 'sl1014b', 'active', 'assigned', 'code')"
    ))
    users = {}
    for key, uname, role, org in [
        ("admin", "sladmin", "admin", 9941),
        ("oaA", "sloadma", "org_admin", 9941),
        ("teacher", "slteach", "teacher", 9941),
        ("stuA", "slstua", "student", 9941),
        ("stuB", "slstub", "student", 9942),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    w = Word(word="lockdown", phonetic="/x/")
    db_session.add(w)
    book = WordBook(name="锁测试书", is_public=True, org_id=None, created_by=users["admin"].id)
    db_session.add(book)
    await db_session.commit()
    return {
        "u": users,
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "word_id": w.id,
        "book_id": book.id,
    }


async def _code(db_session, creator: User, book_id: int, s: str) -> str:
    c = RedemptionCode(code=s, book_id=book_id, created_by=creator.id,
                       code_expires_at=datetime.utcnow() + timedelta(days=30))
    db_session.add(c)
    await db_session.flush()
    db_session.add(RedemptionCodeBook(code_id=c.id, book_id=book_id))
    await db_session.commit()
    return s


async def test_ai_provider_key_needs_platform_admin(client: AsyncClient, env):
    url = "/api/v1/admin/ai/providers/default"
    assert (await client.get(url)).status_code == 401
    for who in ("teacher", "oaA", "stuA"):
        assert (await client.get(url, headers=_h(env["tok"][who]))).status_code == 403, who
    # 管理员能过鉴权(测试库没配默认提供商 → 404,不是 401/403)
    assert (await client.get(url, headers=_h(env["tok"]["admin"]))).status_code == 404


async def test_word_put_delete_need_teacher(client: AsyncClient, env):
    url = f"/api/v1/words/{env['word_id']}"
    assert (await client.put(url, json={"phonetic": "/y/"})).status_code == 401
    assert (await client.delete(url)).status_code == 401
    assert (await client.put(url, json={"phonetic": "/y/"}, headers=_h(env["tok"]["stuA"]))).status_code == 403
    assert (await client.delete(url, headers=_h(env["tok"]["stuA"]))).status_code == 403
    r = await client.put(url, json={"phonetic": "/y/"}, headers=_h(env["tok"]["teacher"]))
    assert r.status_code == 200, r.text


async def test_ai_routes_need_login(client: AsyncClient, env):
    assert (await client.post("/api/v1/ai/tts", json={"text": "hi"})).status_code == 401
    assert (await client.post("/api/v1/ai/generate-phonetic", json={"word": "hi"})).status_code == 401
    assert (await client.post("/api/v1/ai/explain-mistake", json={})).status_code == 401
    # 录词生成类: 学生登录了也不行
    r = await client.post("/api/v1/ai/generate-phonetic", json={"word": "hi"}, headers=_h(env["tok"]["stuA"]))
    assert r.status_code == 403


async def test_leaderboard_needs_platform_admin(client: AsyncClient, env):
    url = "/api/v1/achievements/leaderboard"
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=_h(env["tok"]["stuA"]))).status_code == 403
    assert (await client.get(url, headers=_h(env["tok"]["admin"]))).status_code == 200


async def test_org_word_code_only_in_same_org(client: AsyncClient, env, db_session):
    code = await _code(db_session, env["u"]["oaA"], env["book_id"], "SLAA-AAAA-AAAA-AAA1")
    r = await client.post("/api/v1/subscription/redeem", json={"code": code}, headers=_h(env["tok"]["stuB"]))
    assert r.status_code == 200 and r.json()["success"] is False, r.text
    assert "不是你所在学校" in r.json()["message"]
    r = await client.post("/api/v1/subscription/redeem", json={"code": code}, headers=_h(env["tok"]["stuA"]))
    assert r.json()["success"] is True, r.text


async def test_platform_word_code_any_org(client: AsyncClient, env, db_session):
    code = await _code(db_session, env["u"]["admin"], env["book_id"], "SLAA-AAAA-AAAA-AAA2")
    r = await client.post("/api/v1/subscription/redeem", json={"code": code}, headers=_h(env["tok"]["stuB"]))
    assert r.json()["success"] is True, r.text
