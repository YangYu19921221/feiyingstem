"""体验卡: 体验期 + 老带新延期(services/promo.py 文件头「体验期 + 老带新延期」)

每条规矩一例:
- 朋友付了体验费且实收 > 0 才算(实收 0 不算)
- 计入一家 → 推荐人体验管着的那本书到期日 +7 天;上限 4 家,第 5 家不算,退一家第 5 家补上
- 退款缩短时孩子今天在学 → 保底到今天 24 点;保底只写一次,之后重算不会再往后推
- 老客户不计入 / 别家机构的分享码当没带 / 同号已登记不算推荐 / 朋友归推荐人那家的销售
- 孩子本来就有的书不碰;后来被兑换码改过的书不再管
- 卡包机构凭卡才能开的书不能开体验
- 删线索连带删推荐关系和体验
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.promo import PromoLead, PromoLeadLink, PromoTrial
from app.models.user import User
from app.models.word import WordBook
from app.services import promo as svc
from app.services import rate_limit
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def ctx(db_session):
    tenancy._org_cache.clear()
    rate_limit.reset()
    org_a = Organization(name="甲校区", code="RFA", status="active")
    org_b = Organization(name="乙校区", code="RFB", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    mk = lambda un, role, org, name, phone=None: User(  # noqa: E731
        username=un, email=f"{un}@e.com", hashed_password="x", role=role,
        full_name=name, org_id=org.id, is_active=True, phone=phone)
    oa = mk("rfoa", "org_admin", org_a, "甲管理员")
    ob = mk("rfob", "org_admin", org_b, "乙管理员")
    s1 = mk("rfsone", "sales", org_a, "王销售")
    s2 = mk("rfstwo", "sales", org_a, "李销售")
    sb = mk("rfsb", "sales", org_b, "乙销售")
    stu = mk("rfstu", "student", org_a, "张小明")
    stu2 = mk("rfstutwo", "student", org_a, "李小红")
    old = mk("rfold", "student", org_a, "老学员", phone="13700000099")
    db_session.add_all([oa, ob, s1, s2, sb, stu, stu2, old])
    await db_session.flush()
    b1 = WordBook(name="体验书一", org_id=org_a.id, is_public=True)
    b2 = WordBook(name="体验书二", org_id=org_a.id, is_public=True)
    db_session.add_all([b1, b2])
    await db_session.commit()
    # 只留 id: 用例里要读库里最新的值(populate_existing),ORM 对象过期后再读属性会触发懒加载
    ids = lambda o: SimpleNamespace(id=o.id)  # noqa: E731
    return {"org_a": ids(org_a), "org_b": ids(org_b), "oa": ids(oa), "ob": ids(ob), "s1": ids(s1),
            "s2": ids(s2), "sb": ids(sb), "stu": ids(stu), "stu2": ids(stu2), "b1": ids(b1), "b2": ids(b2)}


async def _channel(client, admin, sales):
    r = await client.post("/api/v1/promo/channels", json={"name": "门口", "sales_user_id": sales.id}, headers=_h(admin.id))
    assert r.status_code == 200, r.text
    return r.json()


async def _submit(client, code, phone, ref=None):
    body = {"parent_phone": phone}
    if ref:
        body["ref"] = ref
    r = await client.post(f"/api/v1/promo/public/{code}/leads", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def _lead(db_session, phone):
    return (await db_session.execute(select(PromoLead).where(PromoLead.parent_phone == phone)
                                     .execution_options(populate_existing=True))).scalar_one()


async def _get(db_session, model, key):
    return await db_session.get(model, key, populate_existing=True)


async def _pay(client, user, lead_id, amount=99):
    r = await client.patch(f"/api/v1/promo/leads/{lead_id}", json={"status": "paid", "paid_amount": amount},
                           headers=_h(user.id))
    assert r.status_code == 200, r.text
    return r.json()


async def _referrer_with_trial(client, db_session, ctx, phone="13900000001", student="rfstu", books=None):
    """开一版卡 → 家长登记 → 关联学生号 → 开体验。返回 (卡, 推荐人线索, 分享码)"""
    ch = await _channel(client, ctx["oa"], ctx["s1"])
    await _submit(client, ch["code"], phone)
    lead = await _lead(db_session, phone)
    r = await client.patch(f"/api/v1/promo/leads/{lead.id}", json={"student_ref": student}, headers=_h(ctx["s1"].id))
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/promo/leads/{lead.id}/trial",
                          json={"book_ids": books or [ctx["b1"].id]}, headers=_h(ctx["s1"].id))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "opened" and r.json()["trial"]["active"]
    r = await client.get(f"/api/v1/promo/leads/{lead.id}/share", headers=_h(ctx["s1"].id))
    assert r.status_code == 200 and r.json()["enabled"], r.text
    return ch, lead, r.json()["share_code"]


async def _assignment(db_session, student_id, book_id):
    return (await db_session.execute(select(BookAssignment).where(
        BookAssignment.student_id == student_id, BookAssignment.book_id == book_id)
        .execution_options(populate_existing=True))).scalar_one()


async def _trial(db_session, lead_id):
    return await _get(db_session, PromoTrial, lead_id)


@pytest.mark.asyncio
async def test_trial_is_a_real_period_grant(client, db_session, ctx):
    _ch, lead, _code = await _referrer_with_trial(client, db_session, ctx)
    a = await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)
    t = await _trial(db_session, lead.id)
    assert a.grant_type == "period" and a.expires_at == t.expires_at
    assert t.expires_at == svc.trial_expiry(t.started_at, 0, 4)
    # 开通那天(北京日)起 7 天: 到期时刻是北京 0 点
    assert (t.expires_at + timedelta(hours=8)).hour == 0
    days = (t.expires_at - t.started_at).total_seconds() / 86400
    assert 6 < days <= 7


@pytest.mark.asyncio
async def test_paid_friend_extends_and_zero_amount_does_not(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    base = (await _trial(db_session, ref_lead.id)).expires_at
    await _submit(client, ch["code"], "13900000002", ref=code)
    await _submit(client, ch["code"], "13900000003", ref=code)
    f0 = await _lead(db_session, "13900000002")
    f1 = await _lead(db_session, "13900000003")
    # 标了已付但实收 0: 不算
    await _pay(client, ctx["s1"], f0.id, amount=0)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base
    # 只加微信: 不算
    await client.patch(f"/api/v1/promo/leads/{f1.id}", json={"status": "contacted"}, headers=_h(ctx["s1"].id))
    assert (await _trial(db_session, ref_lead.id)).expires_at == base
    # 付了 99: +7 天,写到管着的授权上
    out = await _pay(client, ctx["s1"], f1.id)
    assert out["referral_state"] == "counted"
    t = await _trial(db_session, ref_lead.id)
    assert t.expires_at == base + timedelta(days=7)
    assert (await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)).expires_at == t.expires_at
    first_credit = (await _get(db_session, PromoLeadLink, f1.id)).credited_at
    # 再保存一次实收、改个备注、改成别的状态再改回已付: 不重复算(时间不变、推荐人只记一笔)
    await client.patch(f"/api/v1/promo/leads/{f1.id}", json={"paid_amount": 99, "note": "x"}, headers=_h(ctx["s1"].id))
    await client.patch(f"/api/v1/promo/leads/{f1.id}", json={"status": "opened"}, headers=_h(ctx["s1"].id))
    await _pay(client, ctx["s1"], f1.id)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=7)
    assert (await _get(db_session, PromoLeadLink, f1.id)).credited_at == first_credit
    logs = (await client.get(f"/api/v1/promo/leads/{ref_lead.id}/follow-ups", headers=_h(ctx["s1"].id))).json()
    assert sum("付了体验费" in x["content"] for x in logs) == 1


@pytest.mark.asyncio
async def test_cap_four_and_refund_lets_fifth_fill_in(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    base = (await _trial(db_session, ref_lead.id)).expires_at
    phones = [f"1390000010{i}" for i in range(5)]
    for p in phones:
        await _submit(client, ch["code"], p, ref=code)
        await _pay(client, ctx["s1"], (await _lead(db_session, p)).id)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=28)
    r = await client.get(f"/api/v1/promo/leads/{ref_lead.id}/share", headers=_h(ctx["s1"].id))
    states = [f["state"] for f in r.json()["friends"]]
    assert states.count("counted") == 4 and states.count("over") == 1
    # 第一家退款: 第 5 家补上,还是 +28
    first = await _lead(db_session, phones[0])
    await client.patch(f"/api/v1/promo/leads/{first.id}", json={"status": "refunded"}, headers=_h(ctx["s1"].id))
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=28)
    r = await client.get(f"/api/v1/promo/leads/{ref_lead.id}/share", headers=_h(ctx["s1"].id))
    states = [f["state"] for f in r.json()["friends"]]
    assert states.count("counted") == 4 and states.count("refunded") == 1
    # 再退一家: 只剩 3 家,+21
    second = await _lead(db_session, phones[1])
    await client.patch(f"/api/v1/promo/leads/{second.id}", json={"status": "refunded"}, headers=_h(ctx["s1"].id))
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=21)
    # 退款只写不清: 改回已付也不再算
    await _pay(client, ctx["s1"], second.id)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=21)
    # 还没付就先标了退款(付错了退回去)的朋友,之后再付: 也不算
    await _submit(client, ch["code"], "13900000199", ref=code)
    early = await _lead(db_session, "13900000199")
    await client.patch(f"/api/v1/promo/leads/{early.id}", json={"status": "refunded"}, headers=_h(ctx["s1"].id))
    await _pay(client, ctx["s1"], early.id)
    assert (await _get(db_session, PromoLeadLink, early.id)).credited_at is None


@pytest.mark.asyncio
async def test_refund_floor_keeps_today_and_does_not_creep(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    await _submit(client, ch["code"], "13900000201", ref=code)
    friend = await _lead(db_session, "13900000201")
    await _pay(client, ctx["s1"], friend.id)
    # 往回拨 10 天: 体验原本到期了,靠朋友那 7 天现在还能学
    t = await _trial(db_session, ref_lead.id)
    a = await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)
    shift = timedelta(days=10)
    t.started_at -= shift
    t.expires_at -= shift
    a.expires_at -= shift
    await db_session.commit()
    assert t.expires_at > datetime.utcnow()
    # 朋友退款: 本该缩到 3 天前,孩子今天在学 → 保底到今天 24 点
    await client.patch(f"/api/v1/promo/leads/{friend.id}", json={"status": "refunded"}, headers=_h(ctx["s1"].id))
    t = await _trial(db_session, ref_lead.id)
    _, today_end = svc._today_bounds()
    assert t.expires_at == today_end and t.floor_until == today_end
    assert (await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)).expires_at == today_end
    # 一天过去了(整体再往回拨 1 天),再重算: 不能再保底到新的「今天」
    day = timedelta(days=1)
    a = await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)
    t.started_at -= day
    t.expires_at -= day
    t.floor_until -= day
    a.expires_at -= day
    await db_session.commit()
    await svc.recompute_trial(db_session, ref_lead.id)
    await db_session.commit()
    t = await _trial(db_session, ref_lead.id)
    assert t.expires_at == today_end - day
    assert t.expires_at < datetime.utcnow()


@pytest.mark.asyncio
async def test_existing_account_other_org_and_duplicate_are_not_referrals(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    base = (await _trial(db_session, ref_lead.id)).expires_at
    # 老客户(手机号已是本机构账号): 记成推荐来的,但付费也不算
    await _submit(client, ch["code"], "13700000099", ref=code)
    old = await _lead(db_session, "13700000099")
    out = await _pay(client, ctx["s1"], old.id)
    assert out["referred"] and out["referral_state"] == "existing"
    assert (await _trial(db_session, ref_lead.id)).expires_at == base
    # 别家机构的分享码: 当没带
    chb = await _channel(client, ctx["ob"], ctx["sb"])
    await _submit(client, chb["code"], "13900000301")
    lb = await _lead(db_session, "13900000301")
    rb = await client.get(f"/api/v1/promo/leads/{lb.id}/share", headers=_h(ctx["sb"].id))
    await _submit(client, ch["code"], "13900000302", ref=rb.json()["share_code"])
    x = await _lead(db_session, "13900000302")
    link = await _get(db_session, PromoLeadLink, x.id)
    assert link is not None and not link.referred and link.referred_by_lead_id is None
    # 同号已登记过: 不算推荐、不建关系
    await _submit(client, ch["code"], "13900000303")
    r = await _submit(client, ch["code"], "13900000303", ref=code)
    assert r["status"] == "duplicate" and r["share"]["view_code"] is None
    dup = await _lead(db_session, "13900000303")
    dl = await _get(db_session, PromoLeadLink, dup.id)
    assert dl is not None and not dl.referred and dl.referred_by_lead_id is None


@pytest.mark.asyncio
async def test_friend_goes_to_referrer_sales_and_progress_page(client, db_session, ctx):
    _ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    ch2 = await _channel(client, ctx["oa"], ctx["s2"])           # 朋友扫的是李销售的卡
    r = await _submit(client, ch2["code"], "13900000401", ref=code)
    assert r["status"] == "created" and r["share"]["view_code"]
    friend = await _lead(db_session, "13900000401")
    assert friend.sales_user_id == ctx["s1"].id and friend.channel_id == ch2["id"]
    await _pay(client, ctx["s1"], friend.id)
    view = (await client.get(f"/api/v1/promo/leads/{ref_lead.id}/share", headers=_h(ctx["s1"].id))).json()["view_code"]
    r = await client.get(f"/api/v1/promo/public/share/{view}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counted"] == 1 and body["added_days"] == 7 and body["trial_last_day"]
    assert body["friends"][0]["phone"] == "139****0401"
    # 分享码不能当看进度码用
    assert (await client.get(f"/api/v1/promo/public/share/{code}")).status_code == 404


@pytest.mark.asyncio
async def test_existing_book_untouched_and_changed_grant_dropped(client, db_session, ctx):
    db_session.add(BookAssignment(book_id=ctx["b1"].id, student_id=ctx["stu"].id, teacher_id=ctx["oa"].id,
                                  scope_type="book"))
    await db_session.commit()
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx, books=[ctx["b1"].id, ctx["b2"].id])
    t = await _trial(db_session, ref_lead.id)
    assert t.book_ids == [ctx["b2"].id]
    a1 = await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)
    assert a1.grant_type is None and a1.expires_at is None
    # b2 后来被兑换码续了期(到期日对不上了): 体验不再管它
    a2 = await _assignment(db_session, ctx["stu"].id, ctx["b2"].id)
    renewed = a2.expires_at + timedelta(days=30)
    a2.expires_at = renewed
    await db_session.commit()
    await _submit(client, ch["code"], "13900000501", ref=code)
    await _pay(client, ctx["s1"], (await _lead(db_session, "13900000501")).id)
    assert (await _assignment(db_session, ctx["stu"].id, ctx["b2"].id)).expires_at == renewed
    assert (await _trial(db_session, ref_lead.id)).book_ids == []


@pytest.mark.asyncio
async def test_pack_org_cannot_open_gated_book(client, db_session, ctx):
    (await _get(db_session, Organization, ctx["org_a"].id)).card_plan = "pack"
    tenancy._org_cache.clear()
    gated = WordBook(name="人教版三上", org_id=None, is_public=True, pack_tier="basic")
    db_session.add(gated)
    await db_session.commit()
    ch = await _channel(client, ctx["oa"], ctx["s1"])
    await _submit(client, ch["code"], "13900000601")
    lead = await _lead(db_session, "13900000601")
    await client.patch(f"/api/v1/promo/leads/{lead.id}", json={"student_ref": "rfstu"}, headers=_h(ctx["s1"].id))
    r = await client.get(f"/api/v1/promo/leads/{lead.id}/trial-books", headers=_h(ctx["s1"].id))
    assert gated.id not in {b["id"] for b in r.json()["items"]}
    r = await client.post(f"/api/v1/promo/leads/{lead.id}/trial", json={"book_ids": [gated.id]}, headers=_h(ctx["s1"].id))
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_credit_before_trial_counts_when_opened(client, db_session, ctx):
    ch = await _channel(client, ctx["oa"], ctx["s1"])
    await _submit(client, ch["code"], "13900000701")
    ref_lead = await _lead(db_session, "13900000701")
    code = (await client.get(f"/api/v1/promo/leads/{ref_lead.id}/share", headers=_h(ctx["s1"].id))).json()["share_code"]
    await _submit(client, ch["code"], "13900000702", ref=code)
    await _pay(client, ctx["s1"], (await _lead(db_session, "13900000702")).id)
    await client.patch(f"/api/v1/promo/leads/{ref_lead.id}", json={"student_ref": "rfstu"}, headers=_h(ctx["s1"].id))
    r = await client.post(f"/api/v1/promo/leads/{ref_lead.id}/trial", json={"book_ids": [ctx["b1"].id]},
                          headers=_h(ctx["s1"].id))
    t = await _trial(db_session, ref_lead.id)
    assert t.expires_at == svc.trial_expiry(t.started_at, 1, 4)
    assert r.json()["trial"]["added_days"] == 7


@pytest.mark.asyncio
async def test_delete_cleans_links_and_trials(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    base = (await _trial(db_session, ref_lead.id)).expires_at
    await _submit(client, ch["code"], "13900000801", ref=code)
    await _submit(client, ch["code"], "13900000802", ref=code)
    f1 = await _lead(db_session, "13900000801")
    f2 = await _lead(db_session, "13900000802")
    await _pay(client, ctx["s1"], f1.id)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=7)
    # 删掉算过数的朋友(假线索): 推荐人少一家
    r = await client.delete(f"/api/v1/promo/leads/{f1.id}", headers=_h(ctx["oa"].id))
    assert r.status_code == 200
    assert (await _trial(db_session, ref_lead.id)).expires_at == base
    assert await _get(db_session, PromoLeadLink, f1.id) is None
    # 删掉推荐人: 体验记录和分享码一起删,朋友那边显示「(推荐人已删除)」,以后付费也不算给谁
    r = await client.delete(f"/api/v1/promo/leads/{ref_lead.id}", headers=_h(ctx["oa"].id))
    assert r.status_code == 200
    assert await _trial(db_session, ref_lead.id) is None
    assert await _get(db_session, PromoLeadLink, ref_lead.id) is None
    link = await _get(db_session, PromoLeadLink, f2.id)
    assert link.referred and link.referred_by_lead_id is None
    out = await _pay(client, ctx["s1"], f2.id)
    assert out["referred_by"] == "(推荐人已删除)" and out["referral_state"] == "orphan"
    assert (await _get(db_session, PromoLeadLink, f2.id)).credited_at is None
    # 开出去的授权留着(到期自己锁)
    assert (await _assignment(db_session, ctx["stu"].id, ctx["b1"].id)).grant_type == "period"


@pytest.mark.asyncio
async def test_board_counts_referred(client, db_session, ctx):
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    await _submit(client, ch["code"], "13900000901", ref=code)
    await _submit(client, ch["code"], "13900000902", ref=code)
    await _pay(client, ctx["s1"], (await _lead(db_session, "13900000901")).id)
    r = await client.get("/api/v1/promo/board", headers=_h(ctx["oa"].id))
    row = next(x for x in r.json()["items"] if x["sales_user_id"] == ctx["s1"].id)
    assert row["referred"] == 2 and row["referred_paid"] == 1
    assert r.json()["total"]["referred"] == 2


@pytest.mark.asyncio
async def test_cap_setting_and_disabled(client, db_session, ctx):
    r = await client.put("/api/v1/promo/settings", json={"referral_max": 21}, headers=_h(ctx["oa"].id))
    assert r.status_code == 400
    r = await client.put("/api/v1/promo/settings", json={"referral_max": 1}, headers=_h(ctx["oa"].id))
    assert r.status_code == 200 and r.json()["referral_max"] == 1
    ch, ref_lead, code = await _referrer_with_trial(client, db_session, ctx)
    base = (await _trial(db_session, ref_lead.id)).expires_at
    for p in ("13900001001", "13900001002"):
        await _submit(client, ch["code"], p, ref=code)
        await _pay(client, ctx["s1"], (await _lead(db_session, p)).id)
    assert (await _trial(db_session, ref_lead.id)).expires_at == base + timedelta(days=7)
    # 关掉邀请: 分享链接不给,新登记的不再记推荐关系
    r = await client.put("/api/v1/promo/settings", json={"referral_enabled": False}, headers=_h(ctx["oa"].id))
    assert r.json()["referral_enabled"] is False
    assert (await client.get(f"/api/v1/promo/leads/{ref_lead.id}/share", headers=_h(ctx["s1"].id))).json()["enabled"] is False
    r = await _submit(client, ch["code"], "13900001003", ref=code)
    assert r["share"] is None
    x = await _lead(db_session, "13900001003")
    link = await _get(db_session, PromoLeadLink, x.id)
    assert link is None or (not link.referred and link.referred_by_lead_id is None)
