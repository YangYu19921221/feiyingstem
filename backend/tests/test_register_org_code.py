"""学生自注册必须填机构码(2026-10-22)

以前无码/无效码默认归直营,直营攒了几百个从没进过班的自注册学生,分不清是哪家机构的。
守的是: 不填 / 填错 / 机构停用 → 400 且不建账号;填对(大小写、首尾空格不敏感)→ 归属该机构。
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import select, text as sql_text

from app.core import tenancy
from app.models.user import User
from app.services import rate_limit

pytestmark = pytest.mark.asyncio
URL = "/api/v1/auth/register"


@pytest.fixture(autouse=True)
async def _orgs(db_session):
    tenancy.invalidate_org_cache()
    rate_limit.reset()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(9961, '注册甲', 'REGA01', 'active', 'assigned'), "
        "(9962, '注册停', 'REGS01', 'suspended', 'assigned')"
    ))
    await db_session.commit()
    yield
    tenancy.invalidate_org_cache()
    rate_limit.reset()


def _body(phone: str, username: str, org_code=None) -> dict:
    b = {"phone": phone, "username": username, "password": "regpass1"}
    if org_code is not None:
        b["org_code"] = org_code
    return b


async def _user(db_session, username: str):
    db_session.expire_all()
    return (await db_session.execute(select(User).where(User.username == username))).scalar_one_or_none()


@pytest.mark.parametrize("org_code,code", [
    (None, "org_code_required"),
    ("   ", "org_code_required"),
    ("NOPE99", "org_code_invalid"),
    ("REGS01", "org_inactive"),
])
async def test_register_rejected_without_valid_org(client: AsyncClient, db_session, org_code, code):
    r = await client.post(URL, json=_body("13900009001", "reg_bad", org_code))
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == code
    assert await _user(db_session, "reg_bad") is None   # 一个账号都不能建


async def test_register_with_org_code_joins_that_org(client: AsyncClient, db_session):
    r = await client.post(URL, json=_body("13900009002", "reg_ok", "  rega01 "))
    assert r.status_code == 200, r.text
    u = await _user(db_session, "reg_ok")
    assert u is not None and u.org_id == 9961 and u.role == "student"
