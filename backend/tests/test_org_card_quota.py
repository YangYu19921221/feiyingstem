"""机构学习卡额度: 与学生名额分账、发码时扣、未使用可退、续卡不锁死。

## 为什么必须分账(这组测试存在的理由)

机构改成只能发半年卡之后,发码上限若仍与 student_quota 对等,配额 100 的机构
发到第 100 张就再也发不出**续卡** —— 学生半年到期即断档,而协议明确允许续卡
(50 张起)。分账前实测确认过这个锁死:发满 2/2 后续卡返回 403。

两笔账的语义差别:
  student_quota = 同时在读多少人(**可复用**: 学生毕业离班就腾出名额)
  card_quota    = 买过多少张半年卡(**一次性消耗**: 同一学生学一年要两张)
"""
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import tenancy
from app.models.organization import Organization
from app.models.user import User, RedemptionCode, RedemptionCodeStatus
from app.models.word import WordBook
from app.services import org_service
from tests.conftest import _make_token


@pytest.fixture
async def quota_fixture(db_session):
    tenancy._org_cache.clear()
    org = Organization(name="额度机构", code="CQ01", status="active",
                       student_quota=100, card_quota=3)
    db_session.add(org)
    await db_session.flush()

    admin = User(username="cqadmin", email="cqadmin@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True)
    oa = User(username="cqoa", email="cqoa@e.com", hashed_password="x",
              role="org_admin", full_name="机构管理员", is_active=True, org_id=org.id)
    stu = User(username="cqstu", email="cqstu@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org.id)
    db_session.add_all([admin, oa, stu])
    await db_session.flush()

    book = WordBook(name="三上", is_public=True)
    db_session.add(book)
    await db_session.commit()
    return {"org": org, "admin": admin, "oa": oa, "stu": stu, "book": book}


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


def _gen(book_id, count=1, days=180):
    return {"count": count, "book_ids": [book_id],
            "grant_type": "period", "grant_days": days}


# ---------- 额度回退语义(存量机构零影响) ----------

def test_card_quota_falls_back_to_student_quota():
    """card_quota 为 NULL(存量机构全部如此)→ 按 student_quota 生效。

    这条保证改动上线时没有任何机构的发码上限发生变化。
    """
    org = Organization(name="x", code="x", student_quota=100, card_quota=None)
    assert org_service.card_quota_of(org) == 100

    org.card_quota = 250
    assert org_service.card_quota_of(org) == 250

    # 0 是合法的显式值(停售),不能被当成"没设过"而回退成 100
    org.card_quota = 0
    assert org_service.card_quota_of(org) == 0

    assert org_service.card_quota_of(None) == 0


# ---------- 发码时扣 / 未使用可退 ----------

@pytest.mark.asyncio
async def test_quota_consumed_on_generate(client: AsyncClient, quota_fixture):
    oa = quota_fixture["oa"]
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=2))
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))
    st = r.json()
    assert (st["card_quota"], st["cards_used"], st["cards_left"]) == (3, 2, 1), st


@pytest.mark.asyncio
async def test_quota_blocks_when_exhausted(client: AsyncClient, quota_fixture):
    """超额要说清剩几张、并告诉他续卡 —— 只说"不足"没法照着做"""
    oa = quota_fixture["oa"]
    await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                      json=_gen(quota_fixture["book"].id, count=3))
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=1))
    assert r.status_code == 403, r.text
    detail = r.json()["detail"]
    assert "3/3" in detail and "续卡" in detail, detail


@pytest.mark.asyncio
async def test_deleting_unused_code_refunds_quota(client: AsyncClient, quota_fixture):
    """印错的批次删掉要退额度(不然点错一次就永久损失一张卡)"""
    oa = quota_fixture["oa"]
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=3))
    code_id = r.json()[0]["id"]

    r = await client.delete(f"/api/v1/admin/subscriptions/codes/{code_id}", headers=_hdr(oa))
    assert r.status_code == 200, r.text

    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))).json()
    assert (st["cards_used"], st["cards_left"]) == (2, 1), st
    # 退回来的额度真能再用
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=1))
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_disabling_unused_code_refunds_quota(client: AsyncClient, quota_fixture):
    oa = quota_fixture["oa"]
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=3))
    code_id = r.json()[0]["id"]
    await client.post(f"/api/v1/admin/subscriptions/codes/{code_id}/disable", headers=_hdr(oa))

    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))).json()
    assert st["cards_used"] == 2, st


@pytest.mark.asyncio
async def test_redeemed_code_keeps_occupying_quota(client: AsyncClient, quota_fixture):
    """已兑换的码永久占额 —— 那才是真卖出去的一张卡,而且它不许被删"""
    oa, stu = quota_fixture["oa"], quota_fixture["stu"]
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(quota_fixture["book"].id, count=1))
    issued = r.json()[0]
    rr = await client.post("/api/v1/subscription/redeem", headers=_hdr(stu),
                           json={"code": issued["code"]})
    assert rr.json()["success"] is True, rr.text

    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))).json()
    assert st["cards_used"] == 1, st
    # 想靠删码退额度是不行的(已使用的码是兑换凭证)
    r = await client.delete(f"/api/v1/admin/subscriptions/codes/{issued['id']}", headers=_hdr(oa))
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_whole_stage_card_costs_one(client: AsyncClient, quota_fixture, db_session):
    """一张卡开一整个学段(多本书)只占 1 张额度 —— 权益厚度不是名额"""
    for nm, gl in [("四上", "四年级"), ("五上", "五年级"), ("六上", "六年级")]:
        db_session.add(WordBook(name=nm, grade_level=gl, series="人教版", is_public=True))
    await db_session.commit()
    ids = list((await db_session.execute(select(WordBook.id))).scalars())

    oa = quota_fixture["oa"]
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json={"count": 1, "book_ids": ids,
                                "grant_type": "period", "grant_days": 180})
    assert r.status_code == 200, r.text
    assert r.json()[0]["book_count"] == len(ids)

    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))).json()
    assert st["cards_used"] == 1, st  # 4 本书 → 仍然 1 张


# ---------- 这组改动的核心: 续卡不再被锁死 ----------

@pytest.mark.asyncio
async def test_renewal_no_longer_locked_by_student_quota(client: AsyncClient, db_session):
    """学生名额 2 人、卡额度 4 张 → 两个学生各续一次卡都发得出来。

    分账之前这里必然 403(发满 2 张就没了),半年卡到期即断档。
    """
    tenancy._org_cache.clear()
    org = Organization(name="续卡机构", code="CQ02", status="active",
                       student_quota=2, card_quota=4)
    db_session.add(org)
    await db_session.flush()
    oa = User(username="cqoa2", email="cqoa2@e.com", hashed_password="x",
              role="org_admin", full_name="机构管理员", is_active=True, org_id=org.id)
    stu = User(username="cqstu2", email="cqstu2@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org.id)
    db_session.add_all([oa, stu])
    await db_session.flush()
    book = WordBook(name="三上B", is_public=True)
    db_session.add(book)
    await db_session.commit()
    oa_h, stu_h, bid = _hdr(oa), _hdr(stu), book.id

    # 第一个半年
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=oa_h, json=_gen(bid))
    assert r.status_code == 200, r.text
    rr = await client.post("/api/v1/subscription/redeem", headers=stu_h,
                           json={"code": r.json()[0]["code"]})
    assert rr.json()["success"] is True, rr.text

    # 续卡(分账前这里是 403)
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=oa_h, json=_gen(bid))
    assert r.status_code == 200, f"续卡被额度挡死: {r.text}"
    rr = await client.post("/api/v1/subscription/redeem", headers=stu_h,
                           json={"code": r.json()[0]["code"]})
    assert rr.json()["success"] is True, rr.text
    assert "续期" in rr.json()["message"], rr.json()["message"]


@pytest.mark.asyncio
async def test_student_quota_and_card_quota_are_independent(client: AsyncClient, db_session):
    """卡额度用完不影响学生入班,学生名额满也不影响发卡 —— 两笔账互不干扰"""
    tenancy._org_cache.clear()
    org = Organization(name="独立机构", code="CQ03", status="active",
                       student_quota=1, card_quota=5)
    db_session.add(org)
    await db_session.flush()
    oa = User(username="cqoa3", email="cqoa3@e.com", hashed_password="x",
              role="org_admin", full_name="机构管理员", is_active=True, org_id=org.id)
    db_session.add(oa)
    await db_session.flush()
    book = WordBook(name="三上C", is_public=True)
    db_session.add(book)
    await db_session.commit()

    # 学生名额只有 1,但卡额度 5 → 能发 5 张(名额是"同时在读",卡是"买过几张")
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                          json=_gen(book.id, count=5))
    assert r.status_code == 200, r.text
    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(oa))).json()
    assert (st["card_quota"], st["cards_left"]) == (5, 0), st


# ---------- 平台端: 设额度 / 续卡 ----------

@pytest.mark.asyncio
async def test_platform_sets_and_tops_up_quota(client: AsyncClient, quota_fixture):
    admin, org = quota_fixture["admin"], quota_fixture["org"]
    org_id = org.id

    r = await client.patch(f"/api/v1/admin/organizations/{org_id}", headers=_hdr(admin),
                           json={"card_quota": 100})
    assert r.status_code == 200, r.text
    assert r.json()["card_quota"] == 100
    assert r.json()["card_quota_explicit"] is True

    # 续卡: 在现有额度上加(不是覆盖)
    r = await client.patch(f"/api/v1/admin/organizations/{org_id}", headers=_hdr(admin),
                           json={"add_cards": 50})
    assert r.status_code == 200, r.text
    assert r.json()["card_quota"] == 150, r.json()


@pytest.mark.asyncio
async def test_add_cards_on_null_quota_org(client: AsyncClient, db_session):
    """存量机构(card_quota 为 NULL)续卡: 要先落成生效值再加。

    NULL + 50 在 SQL 里是 NULL —— 那笔续卡会静默丢失,机构付了钱却没拿到额度。
    """
    tenancy._org_cache.clear()
    org = Organization(name="存量机构", code="CQ04", status="active",
                       student_quota=100, card_quota=None)
    db_session.add(org)
    await db_session.flush()
    admin = User(username="cqadmin4", email="cqadmin4@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True)
    db_session.add(admin)
    await db_session.commit()
    org_id = org.id

    r = await client.patch(f"/api/v1/admin/organizations/{org_id}", headers=_hdr(admin),
                           json={"add_cards": 50})
    assert r.status_code == 200, r.text
    # 100(回退自 student_quota) + 50
    assert r.json()["card_quota"] == 150, r.json()

    row = (await db_session.execute(
        select(Organization.card_quota).where(Organization.id == org_id)
    )).scalar()
    assert row == 150, row


@pytest.mark.asyncio
async def test_org_list_shows_card_water_level(client: AsyncClient, quota_fixture):
    """平台列表要能一眼看出谁快用完了(否则"续卡"永远是机构先来催)"""
    oa, admin = quota_fixture["oa"], quota_fixture["admin"]
    await client.post("/api/v1/admin/subscriptions/generate", headers=_hdr(oa),
                      json=_gen(quota_fixture["book"].id, count=2))

    r = await client.get("/api/v1/admin/organizations", headers=_hdr(admin))
    assert r.status_code == 200, r.text
    row = next(o for o in r.json() if o["code"] == "CQ01")
    assert (row["card_quota"], row["cards_used"], row["cards_left"]) == (3, 2, 1), row


@pytest.mark.asyncio
async def test_platform_admin_stats_have_no_card_fields(client: AsyncClient, quota_fixture):
    """平台 admin 不限额 → 不下发这组字段,前端据此整块隐藏"""
    r = await client.get("/api/v1/admin/subscriptions/stats",
                         headers=_hdr(quota_fixture["admin"]))
    assert r.status_code == 200, r.text
    assert r.json()["card_quota"] is None, r.json()


@pytest.mark.asyncio
async def test_org_info_exposes_card_quota(client: AsyncClient, quota_fixture):
    """机构首页也要看得见 —— 只显示学生名额会让机构把"发不出卡"当成"学生满了" """
    r = await client.get("/api/v1/org/info", headers=_hdr(quota_fixture["oa"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["card_quota"] == 3 and body["cards_left"] == 3, body
    assert body["student_quota"] == 100, body   # 两个数各自独立
