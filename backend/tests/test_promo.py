"""地推体验卡 + 销售跟单 —— services/promo.py 五条规矩各锁一例,外加越权

1. 扫码先留电话才给二维码(GET 落地页不带二维码)
2. 同机构同手机号只认第一张卡,后扫的回第一个销售的码、不新建线索
3. 卡码转交后,已有线索不跟着走,之后的归新销售;销售不能自己改归属
4. 阶段时间只写不清(标无效、改回去都不清),直接标「已付」补上「已加微信」
5. 「学满 5 天」按 study_calendar 实际学习天数算
另守: 销售只看自己的线索 / 别家机构看不到 / sales 角色进不了老师接口
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.organization import Organization
from app.models.promo import PromoChannel, PromoLead
from app.models.user import StudyCalendar, User
from app.services import rate_limit
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def ctx(db_session):
    tenancy._org_cache.clear()
    rate_limit.reset()
    org_a = Organization(name="甲校区", code="PRMA", status="active")
    org_b = Organization(name="乙校区", code="PRMB", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    mk = lambda un, role, org, name: User(  # noqa: E731
        username=un, email=f"{un}@e.com", hashed_password="x", role=role,
        full_name=name, org_id=org.id, is_active=True)
    oa = mk("prmoa", "org_admin", org_a, "甲管理员")
    ob = mk("prmob", "org_admin", org_b, "乙管理员")
    s1 = mk("prmsone", "sales", org_a, "王销售")
    s2 = mk("prmstwo", "sales", org_a, "李销售")
    sb = mk("prmsb", "sales", org_b, "乙销售")
    stu = mk("prmstu", "student", org_a, "张小明")
    db_session.add_all([oa, ob, s1, s2, sb, stu])
    await db_session.commit()
    return {"org_a": org_a, "org_b": org_b, "oa": oa, "ob": ob, "s1": s1, "s2": s2, "sb": sb, "stu": stu}


async def _new_channel(client, admin, sales, name="实验小学门口"):
    r = await client.post("/api/v1/promo/channels", json={"name": name, "sales_user_id": sales.id},
                          headers=_h(admin.id))
    assert r.status_code == 200, r.text
    return r.json()


async def _set_qr(db_session, sales, url):
    from app.models.promo import PromoSalesProfile
    db_session.add(PromoSalesProfile(user_id=sales.id, org_id=sales.org_id, qr_image_url=url, qr_kind="wechat"))
    await db_session.commit()


@pytest.mark.asyncio
async def test_landing_hides_qr_until_phone_left(client, db_session, ctx):
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await _set_qr(db_session, ctx["s1"], "/api/v1/files/promo-qr/sales_1.png?v=1")
    r = await client.get(f"/api/v1/promo/public/{ch['code']}")
    assert r.status_code == 200
    body = r.json()
    assert body["trial_price"] == 99
    assert "qr_image_url" not in body and "sales_name" not in body
    r = await client.post(f"/api/v1/promo/public/{ch['code']}/leads",
                          json={"parent_phone": "139 0000 0001", "child_grade": "三年级"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "created"
    assert r.json()["qr_image_url"].startswith("/api/v1/files/promo-qr/")
    assert r.json()["sales_name"] == "王销售"
    lead = (await db_session.execute(select(PromoLead))).scalar_one()
    assert lead.sales_user_id == ctx["s1"].id and lead.parent_phone == "13900000001"


@pytest.mark.asyncio
async def test_same_phone_keeps_first_sales(client, db_session, ctx):
    c1 = await _new_channel(client, ctx["oa"], ctx["s1"])
    c2 = await _new_channel(client, ctx["oa"], ctx["s2"], "二中门口")
    await _set_qr(db_session, ctx["s1"], "/api/v1/files/promo-qr/first.png?v=1")
    await client.post(f"/api/v1/promo/public/{c1['code']}/leads", json={"parent_phone": "13900000002"})
    r = await client.post(f"/api/v1/promo/public/{c2['code']}/leads", json={"parent_phone": "13900000002"})
    assert r.json()["status"] == "duplicate"
    # 后扫李销售的卡,页面给的还是王销售的码
    assert r.json()["sales_name"] == "王销售"
    assert r.json()["qr_image_url"].endswith("first.png?v=1")
    leads = (await db_session.execute(select(PromoLead))).scalars().all()
    assert len(leads) == 1 and leads[0].sales_user_id == ctx["s1"].id


@pytest.mark.asyncio
async def test_transfer_moves_only_future_leads(client, db_session, ctx):
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000003"})
    r = await client.patch(f"/api/v1/promo/channels/{ch['id']}", json={"sales_user_id": ctx["s2"].id},
                           headers=_h(ctx["oa"].id))
    assert r.status_code == 200 and r.json()["sales_name"] == "李销售"
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000004"})
    by_phone = {l.parent_phone: l.sales_user_id for l in (await db_session.execute(select(PromoLead))).scalars()}
    assert by_phone == {"13900000003": ctx["s1"].id, "13900000004": ctx["s2"].id}
    # 销售自己不能把线索改到别人名下
    lead = (await db_session.execute(select(PromoLead).where(PromoLead.parent_phone == "13900000004"))).scalar_one()
    r = await client.patch(f"/api/v1/promo/leads/{lead.id}", json={"sales_user_id": ctx["s1"].id},
                           headers=_h(ctx["s2"].id))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_stage_times_are_sticky(client, db_session, ctx):
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000005"})
    lead = (await db_session.execute(select(PromoLead))).scalar_one()
    r = await client.patch(f"/api/v1/promo/leads/{lead.id}", json={"status": "paid", "paid_amount": 99},
                           headers=_h(ctx["s1"].id))
    assert r.status_code == 200, r.text
    assert r.json()["contacted_at"] and r.json()["paid_at"]          # 直接标已付,加微信那步补上
    r = await client.patch(f"/api/v1/promo/leads/{lead.id}", json={"status": "lost"}, headers=_h(ctx["s1"].id))
    assert r.json()["status"] == "lost" and r.json()["paid_at"]     # 标无效不清
    r = await client.get("/api/v1/promo/board", headers=_h(ctx["oa"].id))
    row = next(x for x in r.json()["items"] if x["sales_user_id"] == ctx["s1"].id)
    assert row["paid"] == 1 and row["lost"] == 1 and row["revenue"] == 99
    # 改状态都留了跟进记录
    r = await client.get(f"/api/v1/promo/leads/{lead.id}/follow-ups", headers=_h(ctx["s1"].id))
    assert [x["status_after"] for x in r.json()] == ["lost", "paid"]


@pytest.mark.asyncio
async def test_studied_days_from_calendar(client, db_session, ctx):
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000006"})
    lead = (await db_session.execute(select(PromoLead))).scalar_one()
    r = await client.patch(f"/api/v1/promo/leads/{lead.id}",
                           json={"status": "opened", "student_ref": "prmstu"}, headers=_h(ctx["s1"].id))
    assert r.status_code == 200, r.text and r.json()["student_name"] == "张小明"
    opened = (lead.opened_at + timedelta(hours=8)).date()
    # 开通后第 0..4 天学了 5 天,第 8 天(窗口外)也学了;另有一天只打开没学(0 词 0 秒)不算
    for i in (0, 1, 2, 3, 4, 8):
        db_session.add(StudyCalendar(user_id=ctx["stu"].id, study_date=opened + timedelta(days=i),
                                     words_learned=10, duration=600))
    db_session.add(StudyCalendar(user_id=ctx["stu"].id, study_date=opened + timedelta(days=5),
                                 words_learned=0, duration=0))
    await db_session.commit()
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["s1"].id))
    assert r.json()["items"][0]["studied_days"] == 5
    r = await client.get("/api/v1/promo/board", headers=_h(ctx["oa"].id))
    row = next(x for x in r.json()["items"] if x["sales_user_id"] == ctx["s1"].id)
    assert row["studied"] == 1 and row["opened"] == 1


@pytest.mark.asyncio
async def test_sales_sees_only_own_and_other_org_isolated(client, db_session, ctx):
    c1 = await _new_channel(client, ctx["oa"], ctx["s1"])
    c2 = await _new_channel(client, ctx["oa"], ctx["s2"], "二中门口")
    await client.post(f"/api/v1/promo/public/{c1['code']}/leads", json={"parent_phone": "13900000007"})
    await client.post(f"/api/v1/promo/public/{c2['code']}/leads", json={"parent_phone": "13900000008"})
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["s1"].id))
    assert [x["parent_phone"] for x in r.json()["items"]] == ["13900000007"]
    other = (await db_session.execute(select(PromoLead).where(PromoLead.parent_phone == "13900000008"))).scalar_one()
    r = await client.patch(f"/api/v1/promo/leads/{other.id}", json={"note": "x"}, headers=_h(ctx["s1"].id))
    assert r.status_code == 404
    # 机构管理员看全机构
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["oa"].id))
    assert len(r.json()["items"]) == 2
    # 别家机构: 管理员看不到、销售看不到、不能把卡码挂给别家销售
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["ob"].id))
    assert r.json()["items"] == []
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["sb"].id))
    assert r.json()["items"] == []
    r = await client.post("/api/v1/promo/channels", json={"sales_user_id": ctx["sb"].id}, headers=_h(ctx["oa"].id))
    assert r.status_code == 400
    r = await client.patch(f"/api/v1/promo/channels/{c1['id']}", json={"is_active": False}, headers=_h(ctx["ob"].id))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_sales_role_is_boxed_in(client, db_session, ctx):
    s1 = ctx["s1"]
    # 进不了老师接口 / 管理接口 / 学生接口
    for url in ("/api/v1/teacher/students", "/api/v1/promo/channels", "/api/v1/promo/sales",
                "/api/v1/student/today-report", "/api/v1/referral/leads"):
        r = await client.get(url, headers=_h(s1.id))
        assert r.status_code == 403, (url, r.status_code)
    # 学生也进不了销售接口
    r = await client.get("/api/v1/promo/leads", headers=_h(ctx["stu"].id))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_sales_account_and_stopped_card(client, db_session, ctx):
    r = await client.post("/api/v1/promo/sales", json={"username": "prmsnew", "full_name": "赵销售"},
                          headers=_h(ctx["oa"].id))
    assert r.status_code == 200, r.text
    assert r.json()["initial_password"]
    u = (await db_session.execute(select(User).where(User.username == "prmsnew"))).scalar_one()
    assert u.role == "sales" and u.org_id == ctx["org_a"].id
    # 销售不能建销售
    r = await client.post("/api/v1/promo/sales", json={"username": "prmsx", "full_name": "x"},
                          headers=_h(ctx["s1"].id))
    assert r.status_code == 403
    # 停用的卡码扫了打不开
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await client.patch(f"/api/v1/promo/channels/{ch['id']}", json={"is_active": False}, headers=_h(ctx["oa"].id))
    r = await client.get(f"/api/v1/promo/public/{ch['code']}")
    assert r.status_code == 404
    r = await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000009"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_platform_admin_manages_own_org_only(client, db_session, ctx):
    """生产上直营没有机构管理员账号,平台 admin(org_id=直营)要能自己发卡;但只管自己那个机构"""
    adm = User(username="prmadm", email="prmadm@e.com", hashed_password="x", role="admin",
               full_name="平台", org_id=ctx["org_a"].id, is_active=True)
    db_session.add(adm)
    await db_session.commit()
    ch = await _new_channel(client, adm, ctx["s1"])
    assert ch["sales_name"] == "王销售"
    r = await client.post("/api/v1/promo/channels", json={"sales_user_id": ctx["sb"].id}, headers=_h(adm.id))
    assert r.status_code == 400   # 别家机构的销售挂不上
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000010"})
    r = await client.get("/api/v1/promo/board", headers=_h(adm.id))
    assert r.json()["total"]["leads"] == 1


# ---------------- 10-23 第二批: 销售增删改查 + 分页 + 卡面模板 ----------------

@pytest.mark.asyncio
async def test_delete_sales_requires_handover(client, db_session, ctx):
    """名下有卡或线索的销售,不选接手人不让删;选了就把卡和线索一起转过去再删"""
    from app.models.promo import PromoFollowUp
    s1_id, s2_id, oa_id = ctx["s1"].id, ctx["s2"].id, ctx["oa"].id
    ch = await _new_channel(client, ctx["oa"], ctx["s1"])
    await client.post(f"/api/v1/promo/public/{ch['code']}/leads", json={"parent_phone": "13900000011"})
    r = await client.delete(f"/api/v1/promo/sales/{ctx['s1'].id}", headers=_h(ctx["oa"].id))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "TRANSFER_REQUIRED"
    assert r.json()["detail"]["channels"] == 1 and r.json()["detail"]["leads"] == 1
    # 不能转给别家机构的销售
    r = await client.delete(f"/api/v1/promo/sales/{ctx['s1'].id}?transfer_to={ctx['sb'].id}", headers=_h(ctx["oa"].id))
    assert r.status_code == 400
    r = await client.delete(f"/api/v1/promo/sales/{ctx['s1'].id}?transfer_to={ctx['s2'].id}", headers=_h(ctx["oa"].id))
    assert r.status_code == 200, r.text
    assert r.json() == {"moved_channels": 1, "moved_leads": 1}
    fresh = {"populate_existing": True}
    assert (await db_session.execute(select(User).where(User.id == s1_id))).scalar_one_or_none() is None
    chan = (await db_session.execute(select(PromoChannel).where(PromoChannel.id == ch["id"])
                                     .execution_options(**fresh))).scalar_one()
    lead = (await db_session.execute(select(PromoLead).execution_options(**fresh))).scalar_one()
    assert chan.sales_user_id == s2_id and lead.sales_user_id == s2_id
    logs = (await db_session.execute(select(PromoFollowUp).where(PromoFollowUp.lead_id == lead.id))).scalars().all()
    assert any("转给「李销售」" in x.content for x in logs)
    # 名下没东西的销售直接删
    r = await client.post("/api/v1/promo/sales", json={"username": "prmsempty", "full_name": "空销售"}, headers=_h(oa_id))
    r = await client.delete(f"/api/v1/promo/sales/{r.json()['id']}", headers=_h(oa_id))
    assert r.status_code == 200 and r.json()["moved_leads"] == 0
    # 别家机构的管理员删不了本机构销售;通用用户管理也不让直接删销售(会丢线索)
    r = await client.delete(f"/api/v1/promo/sales/{s2_id}", headers=_h(ctx["ob"].id))
    assert r.status_code == 404
    r = await client.delete(f"/api/v1/admin/users/{s2_id}", headers=_h(oa_id))
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_sales_crud_and_pagination(client, db_session, ctx):
    for i in range(23):
        r = await client.post("/api/v1/promo/sales", json={"username": f"prmspage{chr(97 + i)}", "full_name": f"分页{i}"},
                              headers=_h(ctx["oa"].id))
        assert r.status_code == 200
    r = await client.get("/api/v1/promo/sales?page=1&size=10", headers=_h(ctx["oa"].id))
    body = r.json()
    assert body["total"] == 25 and len(body["items"]) == 10      # 23 + fixture 里的王销售、李销售
    r = await client.get("/api/v1/promo/sales?page=3&size=10", headers=_h(ctx["oa"].id))
    assert len(r.json()["items"]) == 5
    r = await client.get("/api/v1/promo/sales?search=" + "王", headers=_h(ctx["oa"].id))
    assert [x["full_name"] for x in r.json()["items"]] == ["王销售"]
    # 搜索里的 _ 不当通配符(CLAUDE.md: LIKE 下划线坑)
    r = await client.get("/api/v1/promo/sales?search=_", headers=_h(ctx["oa"].id))
    assert r.json()["total"] == 0
    # 改: 姓名 / 用户名 / 手机号,清空手机号走显式分支
    sid = ctx["s1"].id
    r = await client.patch(f"/api/v1/promo/sales/{sid}", json={"full_name": "王老师", "username": "prmswangnew",
                                                               "phone": "13700000001"}, headers=_h(ctx["oa"].id))
    assert r.status_code == 200, r.text
    r = await client.patch(f"/api/v1/promo/sales/{sid}", json={"username": "prmstwo"}, headers=_h(ctx["oa"].id))
    assert r.status_code == 409                                    # 用户名撞了李销售
    r = await client.patch(f"/api/v1/promo/sales/{sid}", json={"phone": ""}, headers=_h(ctx["oa"].id))
    u = (await db_session.execute(select(User).where(User.id == sid)
                                  .execution_options(populate_existing=True))).scalar_one()
    assert u.full_name == "王老师" and u.username == "prmswangnew" and u.phone is None
    # 停用后 all=true 的下拉不出现
    await client.patch(f"/api/v1/promo/sales/{sid}", json={"is_active": False}, headers=_h(ctx["oa"].id))
    r = await client.get("/api/v1/promo/sales?all=true", headers=_h(ctx["oa"].id))
    assert sid not in [x["id"] for x in r.json()["items"]]


@pytest.mark.asyncio
async def test_card_design_templates_and_print_fields(client, db_session, ctx):
    from app.services.promo import TEMPLATE_IDS
    ctx["s1"].phone = "13800000001"
    await db_session.commit()
    a = await _new_channel(client, ctx["oa"], ctx["s1"], "一版")
    b = await _new_channel(client, ctx["oa"], ctx["s2"], "二版")
    # 新开的卡按机构里还没人用过的顺序分模板 —— 两个销售默认就不是同一套
    assert a["design"]["template_id"] == "t01" and b["design"]["template_id"] == "t02"
    # 没自定义过: 名字电话跟销售账号走
    assert a["design"]["display_name"] == "王销售" and a["design"]["display_phone"] == "13800000001"
    # 销售改自己的卡面
    r = await client.put(f"/api/v1/promo/channels/{a['id']}/design",
                         json={"template_id": "t07", "display_name": "王老师", "display_phone": "138-0000-0002"},
                         headers=_h(ctx["s1"].id))
    assert r.status_code == 200, r.text
    assert r.json()["design"] == {"template_id": "t07", "display_name": "王老师", "display_phone": "138-0000-0002"}
    # 空串电话 = 不印(不是退回账号手机号)
    r = await client.put(f"/api/v1/promo/channels/{a['id']}/design", json={"display_phone": ""}, headers=_h(ctx["s1"].id))
    assert r.json()["design"]["display_phone"] == ""
    # 不能改别人的卡面、不能填不存在的模板、电话不能乱写
    r = await client.put(f"/api/v1/promo/channels/{b['id']}/design", json={"template_id": "t03"}, headers=_h(ctx["s1"].id))
    assert r.status_code == 404
    r = await client.put(f"/api/v1/promo/channels/{a['id']}/design", json={"template_id": "t99"}, headers=_h(ctx["s1"].id))
    assert r.status_code == 400
    r = await client.put(f"/api/v1/promo/channels/{a['id']}/design", json={"display_phone": "<script>"}, headers=_h(ctx["s1"].id))
    assert r.status_code == 400
    # 销售工作台里能看到自己卡的卡面
    r = await client.get("/api/v1/promo/me", headers=_h(ctx["s1"].id))
    assert r.json()["channels"][0]["design"]["template_id"] == "t07"
    # 卡码列表分页
    r = await client.get("/api/v1/promo/channels?page=1&size=1", headers=_h(ctx["oa"].id))
    assert r.json()["total"] == 2 and len(r.json()["items"]) == 1
    assert len(TEMPLATE_IDS) == 50


def test_template_ids_match_frontend():
    """前端 data/promoTemplates.ts 与后端 TEMPLATE_IDS 必须同一组(正则解析 .ts,不维护副本);
    每套模板的三张图都得在 public 里 —— *.png 被 .gitignore 挡过一次,这里顺带锁住"""
    import os
    import re
    from app.services.promo import TEMPLATE_IDS
    root = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
    ts = open(os.path.join(root, "src", "data", "promoTemplates.ts"), encoding="utf-8").read()
    ids = re.findall(r"\{ id: '(t\d{2})'", ts)
    assert tuple(ids) == TEMPLATE_IDS
    for t in TEMPLATE_IDS:
        for side in ("front", "back", "thumb"):
            assert os.path.isfile(os.path.join(root, "public", "promo-card", "tpl", f"{t}_{side}.jpg")), (t, side)
