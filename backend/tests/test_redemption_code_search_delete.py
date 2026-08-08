"""兑换码搜索 + 删除。

删除是不可逆动作,重点验两件事:
  - 已使用的码不许删(它是学生兑换过某本书的凭证,删了出纠纷无据可依)
  - org_admin 删不到别家机构的码(按 404 处理,不泄露)
搜索重点验 LIKE 通配符转义 —— 搜下划线不能命中全部
(曾用 like('__t_%') 误删过两个真实学生账号)。
"""
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.organization import Organization
from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.word import WordBook
from tests.conftest import _make_token


@pytest.fixture
async def codes_fixture(db_session):
    tenancy._org_cache.clear()
    org_a = Organization(name="A机构", code="RCA01", status="active")
    org_b = Organization(name="B机构", code="RCB01", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()

    admin = User(username="rc_admin", email="rc_admin@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True, org_id=org_a.id)
    oa_a = User(username="rc_oa_a", email="rc_oa_a@e.com", hashed_password="x",
                role="org_admin", full_name="A机构管理", is_active=True, org_id=org_a.id)
    oa_b = User(username="rc_oa_b", email="rc_oa_b@e.com", hashed_password="x",
                role="org_admin", full_name="B机构管理", is_active=True, org_id=org_b.id)
    stu = User(username="rc_stu", email="rc_stu@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org_a.id)
    db_session.add_all([admin, oa_a, oa_b, stu])
    await db_session.flush()

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()

    expires = datetime.utcnow() + timedelta(days=90)

    def mk(code, status, creator, note=None, used_by=None):
        return RedemptionCode(
            code=code, book_id=book.id, status=status, created_by=creator.id,
            code_expires_at=expires, batch_note=note, used_by=used_by,
            used_at=datetime.utcnow() if used_by else None,
        )

    unused = mk("AAAA-BBBB-CCCC-DDDD", RedemptionCodeStatus.UNUSED, oa_a, "春季班")
    used = mk("EEEE-FFFF-GGGG-HHHH", RedemptionCodeStatus.USED, oa_a, "春季班", used_by=stu.id)
    other_org = mk("IIII-JJJJ-KKKK-LLLL", RedemptionCodeStatus.UNUSED, oa_b, "B机构批次")
    # 备注里带下划线,用来验证 LIKE 转义
    underscore = mk("MMMM-NNNN-OOOO-PPPP", RedemptionCodeStatus.UNUSED, oa_a, "秋季_特训")
    db_session.add_all([unused, used, other_org, underscore])
    await db_session.commit()
    return {"admin": admin, "oa_a": oa_a, "oa_b": oa_b,
            "unused": unused, "used": used, "other_org": other_org,
            "underscore": underscore}


def _hdr(user):
    return {"Authorization": f"Bearer {_make_token(user.id)}"}


@pytest.mark.asyncio
async def test_search_by_code_fragment(client: AsyncClient, codes_fixture):
    """按码片段搜 —— 老师手里往往只有抄下来的一段。"""
    r = await client.get("/api/v1/admin/subscriptions/codes",
                         params={"search": "CCCC"}, headers=_hdr(codes_fixture["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["codes"][0]["code"] == "AAAA-BBBB-CCCC-DDDD"


@pytest.mark.asyncio
async def test_search_by_batch_note(client: AsyncClient, codes_fixture):
    """按批次备注搜,便于整批捞出来。"""
    r = await client.get("/api/v1/admin/subscriptions/codes",
                         params={"search": "春季班"}, headers=_hdr(codes_fixture["admin"]))
    assert r.json()["total"] == 2


@pytest.mark.asyncio
async def test_search_escapes_like_wildcards(client: AsyncClient, codes_fixture):
    """搜下划线只能命中备注里真的有下划线的那条,不能当通配符匹配全部。"""
    r = await client.get("/api/v1/admin/subscriptions/codes",
                         params={"search": "_"}, headers=_hdr(codes_fixture["admin"]))
    body = r.json()
    assert body["total"] == 1, f"下划线被当通配符了: {body['total']} 条"
    assert body["codes"][0]["batch_note"] == "秋季_特训"


@pytest.mark.asyncio
async def test_delete_unused_code(client: AsyncClient, codes_fixture):
    """未使用的码可以删,删完列表里就没了。"""
    cid = codes_fixture["unused"].id
    r = await client.delete(f"/api/v1/admin/subscriptions/codes/{cid}",
                            headers=_hdr(codes_fixture["admin"]))
    assert r.status_code == 200, r.text

    again = await client.delete(f"/api/v1/admin/subscriptions/codes/{cid}",
                                headers=_hdr(codes_fixture["admin"]))
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_cannot_delete_used_code(client: AsyncClient, codes_fixture):
    """已使用的码必须拒删 —— 它是兑换记录凭证。"""
    r = await client.delete(
        f"/api/v1/admin/subscriptions/codes/{codes_fixture['used'].id}",
        headers=_hdr(codes_fixture["admin"]),
    )
    assert r.status_code == 400
    assert "已使用" in r.json()["detail"]


@pytest.mark.asyncio
async def test_org_admin_cannot_delete_other_orgs_code(client: AsyncClient, codes_fixture):
    """A 机构管理员删不到 B 机构的码,且按 404 不泄露其存在。"""
    r = await client.delete(
        f"/api/v1/admin/subscriptions/codes/{codes_fixture['other_org'].id}",
        headers=_hdr(codes_fixture["oa_a"]),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_org_admin_search_scoped_to_own_org(client: AsyncClient, codes_fixture):
    """org_admin 搜索也只在本机构范围内,搜不到别家的码。"""
    r = await client.get("/api/v1/admin/subscriptions/codes",
                         params={"search": "IIII"}, headers=_hdr(codes_fixture["oa_a"]))
    assert r.json()["total"] == 0
