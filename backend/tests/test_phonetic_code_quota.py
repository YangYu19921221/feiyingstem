"""音标兑换码额度: 平台给机构发放,机构在额度内自己发(2026-10-02)

守的是四件事:
- 平台没发额度 → 机构发不出(403);额度用完 → 403;禁用归还额度;
- 机构只看得见/改得动本机构的码(平台码、别家码一律 404);
- 机构码只给本机构学生兑(否则 A 的额度被 B 的学生用掉);平台码不限机构;
- 机构只能发 ≤180 天包月卡(与单词本发码同一道 guard_card_policy)。
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.core import tenancy
from app.models.user import User
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/admin/subscriptions/phonetic-codes"


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
        "(9931, '甲', 'pqorga', 'active', 'assigned', 'code'), "
        "(9932, '乙', 'pqorgb', 'active', 'assigned', 'code')"
    ))
    users = {}
    for key, uname, role, org in [
        ("oaA", "pqoadma", "org_admin", 9931),
        ("oaB", "pqoadmb", "org_admin", 9932),
        ("stuA", "pqstua", "student", 9931),
        ("stuB", "pqstub", "student", 9932),
        ("admin", "pqadmin", "admin", 9931),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    await db_session.commit()
    return {"tok": {k: _make_token(u.id) for k, u in users.items()}}


async def _gen(client, tok, count=1, grant_type="period", grant_days=180):
    body = {"count": count, "grant_type": grant_type}
    if grant_days is not None:
        body["grant_days"] = grant_days
    return await client.post(f"{BASE}/generate", headers=_h(tok), json=body)


async def _grant(client, admin_tok, org_id, **kw):
    r = await client.patch(f"/api/v1/admin/organizations/{org_id}",
                           headers=_h(admin_tok), json=kw)
    assert r.status_code == 200, r.text
    return r.json()


async def test_no_quota_org_admin_cannot_generate(client: AsyncClient, env):
    """平台没发额度(NULL)→ 403,不回退学生名额。"""
    r = await _gen(client, env["tok"]["oaA"])
    assert r.status_code == 403, r.text
    assert "额度" in r.json()["detail"]


async def test_quota_granted_then_exhausted(client: AsyncClient, env):
    out = await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=3)
    assert out["phonetic_code_quota"] == 3 and out["phonetic_codes_left"] == 3
    r = await _gen(client, env["tok"]["oaA"], count=2)
    assert r.status_code == 200, r.text
    r = await _gen(client, env["tok"]["oaA"], count=2)   # 2+2 > 3
    assert r.status_code == 403, r.text
    r = await _gen(client, env["tok"]["oaA"], count=1)   # 恰好用满
    assert r.status_code == 200, r.text
    q = (await client.get(f"{BASE}/quota", headers=_h(env["tok"]["oaA"]))).json()
    assert q["phonetic_codes_used"] == 3 and q["phonetic_codes_left"] == 0


async def test_add_is_incremental_and_absolute_set(client: AsyncClient, env):
    await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=50)
    out = await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=100)
    assert out["phonetic_code_quota"] == 150
    out = await _grant(client, env["tok"]["admin"], 9931, phonetic_code_quota=20)
    assert out["phonetic_code_quota"] == 20
    # 机构列表与详情同口径
    lst = (await client.get("/api/v1/admin/organizations", headers=_h(env["tok"]["admin"]))).json()
    row = next(o for o in lst if o["id"] == 9931)
    assert row["phonetic_code_quota"] == 20 and row["phonetic_codes_used"] == 0


async def test_disable_returns_quota_and_list_counts(client: AsyncClient, env):
    await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=1)
    code_id = (await _gen(client, env["tok"]["oaA"])).json()[0]["id"]
    assert (await _gen(client, env["tok"]["oaA"])).status_code == 403
    r = await client.post(f"{BASE}/{code_id}/disable", headers=_h(env["tok"]["oaA"]))
    assert r.status_code == 200
    assert (await _gen(client, env["tok"]["oaA"])).status_code == 200
    lst = (await client.get("/api/v1/admin/organizations", headers=_h(env["tok"]["admin"]))).json()
    assert next(o for o in lst if o["id"] == 9931)["phonetic_codes_used"] == 1


async def test_org_admin_sees_only_own_codes(client: AsyncClient, env):
    await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=5)
    await _grant(client, env["tok"]["admin"], 9932, add_phonetic_codes=5)
    a_id = (await _gen(client, env["tok"]["oaA"])).json()[0]["id"]
    await _gen(client, env["tok"]["oaB"])
    plat = (await _gen(client, env["tok"]["admin"], grant_type="permanent", grant_days=None)).json()[0]
    lst = (await client.get(BASE, headers=_h(env["tok"]["oaB"]))).json()
    assert lst["total"] == 1
    assert a_id not in [c["id"] for c in lst["codes"]]
    # 别家的码 / 平台码: 禁用和删除都 404
    for cid in (a_id, plat["id"]):
        assert (await client.post(f"{BASE}/{cid}/disable", headers=_h(env["tok"]["oaB"]))).status_code == 404
        assert (await client.delete(f"{BASE}/{cid}", headers=_h(env["tok"]["oaB"]))).status_code == 404
    # 平台 admin 看全部
    assert (await client.get(BASE, headers=_h(env["tok"]["admin"]))).json()["total"] == 3


async def test_org_code_only_redeemable_in_same_org(client: AsyncClient, env):
    await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=5)
    code = (await _gen(client, env["tok"]["oaA"])).json()[0]["code"]
    r = await client.post("/api/v1/subscription/redeem", headers=_h(env["tok"]["stuB"]),
                          json={"code": code})
    assert r.json().get("success") is not True, r.text
    r = await client.post("/api/v1/subscription/redeem", headers=_h(env["tok"]["stuA"]),
                          json={"code": code})
    assert r.status_code == 200 and r.json()["success"] is True, r.text


async def test_platform_code_redeemable_by_any_org(client: AsyncClient, env):
    code = (await _gen(client, env["tok"]["admin"], grant_type="permanent", grant_days=None)).json()[0]["code"]
    r = await client.post("/api/v1/subscription/redeem", headers=_h(env["tok"]["stuB"]),
                          json={"code": code})
    assert r.status_code == 200 and r.json()["success"] is True, r.text


async def test_org_admin_card_policy_enforced(client: AsyncClient, env):
    await _grant(client, env["tok"]["admin"], 9931, add_phonetic_codes=5)
    assert (await _gen(client, env["tok"]["oaA"], grant_type="permanent", grant_days=None)).status_code == 403
    assert (await _gen(client, env["tok"]["oaA"], grant_days=365)).status_code == 403
    assert (await _gen(client, env["tok"]["oaA"], grant_days=180)).status_code == 200


async def test_org_admin_cannot_grant_own_quota(client: AsyncClient, env):
    r = await client.patch("/api/v1/admin/organizations/9931", headers=_h(env["tok"]["oaA"]),
                           json={"add_phonetic_codes": 100})
    assert r.status_code in (401, 403), r.text
