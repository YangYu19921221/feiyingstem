"""机构发卡上限: 只能发包月卡、最长半年(180 天),从兑换那天算起。

为什么要拦另两种卡而不是"把天数改小":
  - 永久卡没有到期日,等于把按期续费的权益一次性送掉;
  - 次卡按「学习天」计次,一周学两天的孩子拿 30 天次卡能横跨三四个月,
    日历时长根本不封顶 —— 和"最多半年"是两个量纲。
平台 admin 是定价方,不受这套限制(存量 838 张码全是永久卡,不能被这条改动打死)。
"""
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User, RedemptionCode
from app.models.word import WordBook
from app.services import subscription_service
from app.services.subscription_service import (
    ORG_MAX_CARD_DAYS, GRANT_PERIOD, GRANT_PERMANENT, GRANT_TIMES,
    card_policy_for, guard_card_policy,
)
from tests.conftest import _make_token


@pytest.fixture
async def policy_fixture(db_session):
    tenancy._org_cache.clear()
    org = Organization(name="加盟机构", code="CARD01", status="active",
                       student_quota=100)
    db_session.add(org)
    await db_session.flush()

    admin = User(username="cpadmin", email="cpadmin@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True)
    oa = User(username="cporgadmin", email="cporgadmin@e.com", hashed_password="x",
              role="org_admin", full_name="机构管理员", is_active=True, org_id=org.id)
    stu = User(username="cpstu", email="cpstu@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org.id)
    db_session.add_all([admin, oa, stu])
    await db_session.flush()

    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.commit()
    return {"org": org, "admin": admin, "oa": oa, "stu": stu, "book": book}


def _hdr(user):
    return {"Authorization": f"Bearer {_make_token(user.id)}"}


# ---------- 纯判定(不需要 HTTP) ----------

def test_policy_shape_for_org_admin():
    """机构: 只有包月一种卡种,上限半年,默认值也是半年"""
    p = card_policy_for("org_admin")
    assert p["allowed_grant_types"] == [GRANT_PERIOD]
    assert p["max_grant_days"] == ORG_MAX_CARD_DAYS == 180
    assert p["default_grant_days"] == 180
    # 说明文案要能照着改(界面直接显示这句)
    assert "半年" in p["note"] and "兑换" in p["note"]


def test_policy_shape_for_platform_admin():
    """平台 admin 不受限 —— 存量永久卡与长期卡都要还能发"""
    p = card_policy_for("admin")
    assert set(p["allowed_grant_types"]) == {GRANT_PERMANENT, GRANT_PERIOD, GRANT_TIMES}
    assert p["max_grant_days"] == 3650


def test_guard_rejects_permanent_and_times_for_org():
    """机构发永久卡/次卡都要 403,并且提示里要写清能发什么"""
    for gt, extra in [(GRANT_PERMANENT, {}), (GRANT_TIMES, {"grant_times": 30})]:
        with pytest.raises(Exception) as ei:
            guard_card_policy("org_admin", gt, **extra)
        assert getattr(ei.value, "status_code", None) == 403
        assert "包月" in ei.value.detail


def test_guard_day_boundary_for_org():
    """180 天放行、181 天拒 —— 边界必须验,差一天就是协议口径"""
    guard_card_policy("org_admin", GRANT_PERIOD, grant_days=180)
    guard_card_policy("org_admin", GRANT_PERIOD, grant_days=1)
    with pytest.raises(Exception) as ei:
        guard_card_policy("org_admin", GRANT_PERIOD, grant_days=181)
    assert getattr(ei.value, "status_code", None) == 403
    assert "续卡" in ei.value.detail  # 要给出路,不能只说"不行"


def test_guard_lets_platform_admin_through():
    guard_card_policy("admin", GRANT_PERMANENT)
    guard_card_policy("admin", GRANT_PERIOD, grant_days=365)
    guard_card_policy("admin", GRANT_TIMES, grant_times=60)


# ---------- HTTP 层 ----------

@pytest.mark.asyncio
async def test_card_policy_endpoint(client: AsyncClient, policy_fixture):
    """前端表单读的就是这个端点,两种身份各给自己那份"""
    r = await client.get("/api/v1/admin/subscriptions/card-policy",
                         headers=_hdr(policy_fixture["oa"]))
    assert r.status_code == 200, r.text
    assert r.json()["allowed_grant_types"] == ["period"]
    assert r.json()["max_grant_days"] == 180

    r = await client.get("/api/v1/admin/subscriptions/card-policy",
                         headers=_hdr(policy_fixture["admin"]))
    assert r.status_code == 200, r.text
    assert "permanent" in r.json()["allowed_grant_types"]


@pytest.mark.asyncio
async def test_org_cannot_generate_permanent_code(client: AsyncClient, policy_fixture, db_session):
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 2, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "permanent"})
    assert r.status_code == 403, r.text
    # 拒了就一张码都不能落库(闸门在建行之前)
    assert (await db_session.execute(select(RedemptionCode))).scalars().first() is None


@pytest.mark.asyncio
async def test_org_cannot_generate_times_card(client: AsyncClient, policy_fixture):
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 1, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "times", "grant_times": 30})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_org_cannot_exceed_half_year(client: AsyncClient, policy_fixture):
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 1, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "period", "grant_days": 365})
    assert r.status_code == 403, r.text
    assert "180" in r.json()["detail"]


@pytest.mark.asyncio
async def test_org_half_year_card_works_end_to_end(client: AsyncClient, policy_fixture, db_session):
    """机构发 180 天卡 → 学生兑换 → 到期日 = **兑换那天** + 180(不是发码那天)"""
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 1, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "period", "grant_days": 180})
    assert r.status_code == 200, r.text
    code_str = r.json()[0]["code"]

    redeem_at = datetime.utcnow()
    r = await client.post("/api/v1/subscription/redeem",
                          headers=_hdr(policy_fixture["stu"]), json={"code": code_str})
    assert r.status_code == 200 and r.json()["success"] is True, r.text

    a = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == policy_fixture["stu"].id)
    )).scalars().one()
    assert a.grant_type == GRANT_PERIOD
    # 从兑换时刻起算 180 天(容忍几秒执行误差)
    delta = a.expires_at - (redeem_at + timedelta(days=180))
    assert abs(delta.total_seconds()) < 120, a.expires_at


@pytest.mark.asyncio
async def test_platform_admin_still_issues_permanent(client: AsyncClient, policy_fixture):
    """这条改动不能顺手把平台自己的发码能力收掉"""
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["admin"]),
                          json={"count": 1, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "permanent"})
    assert r.status_code == 200, r.text
    assert r.json()[0]["grant_type"] == "permanent"


@pytest.mark.asyncio
async def test_org_renewal_extends_from_existing_expiry(client: AsyncClient, policy_fixture, db_session):
    """续卡: 第二张半年卡从**原到期日**往后接,不是从今天重算。

    这是"最长半年"能站得住的前提 —— 学生要学一年就发两张,权益连续但每张都在上限内。
    """
    # ⚠️ id 先取成普通值:后面这些请求会 commit,ORM 对象过期后再读
    # policy_fixture["stu"].id 会触发懒加载 → async 会话下就是 MissingGreenlet
    oa_hdr = _hdr(policy_fixture["oa"])
    stu_hdr = _hdr(policy_fixture["stu"])
    stu_id, book_id = policy_fixture["stu"].id, policy_fixture["book"].id

    async def issue_and_redeem():
        r = await client.post("/api/v1/admin/subscriptions/generate", headers=oa_hdr,
                              json={"count": 1, "book_ids": [book_id],
                                    "grant_type": "period", "grant_days": 180})
        assert r.status_code == 200, r.text
        code = r.json()[0]["code"]
        rr = await client.post("/api/v1/subscription/redeem", headers=stu_hdr,
                               json={"code": code})
        assert rr.status_code == 200 and rr.json()["success"] is True, rr.text

    # 列级 select 每次都真查库(不走身份映射缓存),所以不必 expire_all ——
    # expire_all 会把 fixture 里的 User 一起标过期,再读 .id 就是上面那个坑
    async def current_expiry():
        return (await db_session.execute(
            select(BookAssignment.expires_at)
            .where(BookAssignment.student_id == stu_id)
        )).scalar_one()

    await issue_and_redeem()
    first = await current_expiry()

    await issue_and_redeem()
    second = await current_expiry()

    # 接在原到期日之后 → 相差正好 180 天(而不是"从今天+180"的 ~0 天差)
    assert abs((second - first).total_seconds() - 180 * 86400) < 120, (first, second)


@pytest.mark.asyncio
async def test_org_expired_card_locks_learning(client: AsyncClient, policy_fixture, db_session):
    """半年到期后闸门真的关上(付费墙收在 scope_service 一处)"""
    from app.services import scope_service

    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 1, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "period", "grant_days": 180})
    code_str = r.json()[0]["code"]
    await client.post("/api/v1/subscription/redeem",
                      headers=_hdr(policy_fixture["stu"]), json={"code": code_str})

    stu_id, book_id = policy_fixture["stu"].id, policy_fixture["book"].id
    assert await scope_service.get_allowed_unit_ids(db_session, stu_id, book_id) is None

    a = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu_id)
    )).scalars().one()
    a.expires_at = datetime.utcnow() - timedelta(seconds=1)
    await db_session.commit()

    assert await scope_service.get_allowed_unit_ids(db_session, stu_id, book_id) == set()


@pytest.mark.asyncio
async def test_org_quota_gate_still_applies(client: AsyncClient, policy_fixture):
    """卡种闸门加在配额闸门之前,不能把配额那道挤掉:
    卡种合法但超配额仍要 403。"""
    policy_fixture["org"].student_quota = 1
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(policy_fixture["oa"]),
                          json={"count": 5, "book_ids": [policy_fixture["book"].id],
                                "grant_type": "period", "grant_days": 180})
    assert r.status_code == 403, r.text
    assert "额度" in r.json()["detail"]
