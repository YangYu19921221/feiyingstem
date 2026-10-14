"""家长推荐(老带新)—— services/referral.py 四条规矩各锁一例

1. 只在老师确认报名后发奖励,留电话不发
2. 同机构同手机号只认第一个推荐人
3. 手机号已是本机构账号 → 标老客户,默认不发奖励
4. 确认报名重复点只发一次
另守: 跨机构看不到/改不了别家线索、老师只看本班学生推荐来的、落地页不露孩子全名、
家长注册跟孩子的机构走(原先落直营,非直营孩子的家长看不到孩子)
"""
import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.coin import CoinTransaction, StudentCoin
from app.models.organization import Organization
from app.models.referral import OrgReferralSettings, ReferralLead
from app.models.user import Class, ClassStudent, ParentBindCode, ParentStudentLink, User
from app.services import rate_limit
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def ctx(db_session):
    tenancy._org_cache.clear()
    rate_limit.reset()
    org_a = Organization(name="甲校区", code="REFA", status="active")
    org_b = Organization(name="乙校区", code="REFB", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    t1 = User(username="reft", email="reft@e.com", hashed_password="x", role="teacher",
              full_name="王老师", org_id=org_a.id, is_active=True)
    t2 = User(username="refttwo", email="reft2@e.com", hashed_password="x", role="teacher",
              full_name="李老师", org_id=org_a.id, is_active=True)
    tb = User(username="reftb", email="reftb@e.com", hashed_password="x", role="teacher",
              full_name="乙老师", org_id=org_b.id, is_active=True)
    oa = User(username="refoa", email="refoa@e.com", hashed_password="x", role="org_admin",
              full_name="甲管理员", org_id=org_a.id, is_active=True)
    oa_b = User(username="refoab", email="refoab@e.com", hashed_password="x", role="org_admin",
                full_name="乙管理员", org_id=org_b.id, is_active=True)
    stu = User(username="refstu", email="refs@e.com", hashed_password="x", role="student",
               full_name="张小明", org_id=org_a.id, is_active=True, phone="13900000001")
    other_stu = User(username="refstutwo", email="refs2@e.com", hashed_password="x", role="student",
                     full_name="刘小红", org_id=org_a.id, is_active=True)
    db_session.add_all([t1, t2, tb, oa, oa_b, stu, other_stu])
    await db_session.flush()
    c1 = Class(name="一班", teacher_id=t1.id, org_id=org_a.id)
    c2 = Class(name="二班", teacher_id=t2.id, org_id=org_a.id)
    db_session.add_all([c1, c2])
    await db_session.flush()
    db_session.add_all([
        ClassStudent(class_id=c1.id, student_id=stu.id, is_active=True),
        ClassStudent(class_id=c2.id, student_id=other_stu.id, is_active=True),
    ])
    db_session.add(OrgReferralSettings(org_id=org_a.id, enabled=True, reward_coins=5,
                                       reward_text="赠送 2 节课", friend_offer="免费测评 + 体验课 1 节"))
    await db_session.commit()
    return {"org_a": org_a, "org_b": org_b, "t1": t1, "t2": t2, "tb": tb, "oa": oa, "oa_b": oa_b,
            "stu": stu, "other_stu": other_stu}


async def _code(client, teacher, student):
    r = await client.get(f"/api/v1/teacher/referral/students/{student.id}/invite", headers=_h(teacher.id))
    assert r.status_code == 200, r.text
    return r.json()["code"]


async def _submit(client, code, phone, child="王小宝"):
    return await client.post(f"/api/v1/referral/public/{code}/leads", json={
        "parent_name": "王妈妈", "parent_phone": phone, "child_name": child, "child_grade": "三年级"})


async def _balance(db, uid):
    row = (await db.execute(select(StudentCoin).where(StudentCoin.user_id == uid))).scalar_one_or_none()
    return row.balance if row else 0


@pytest.mark.asyncio
async def test_reward_only_after_enroll_and_only_once(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    r = await _submit(client, code, "138 0000 1111")
    assert r.json() == {"status": "created"}
    # 留了电话: 不发
    assert await _balance(db_session, ctx["stu"].id) == 0

    leads = (await client.get("/api/v1/referral/leads", headers=_h(ctx["t1"].id))).json()
    assert leads["total"] == 1
    lead = leads["items"][0]
    assert lead["parent_phone"] == "13800001111"  # 规范化后入库
    assert lead["referrer_name"] == "张小明"

    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/enroll", headers=_h(ctx["t1"].id), json={})
    assert r.status_code == 200, r.text
    assert r.json() == {"coins": 5, "reward_text": "赠送 2 节课"}
    assert await _balance(db_session, ctx["stu"].id) == 5

    # 重复点: 409,金币不变,只有一条流水
    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/enroll", headers=_h(ctx["t1"].id), json={})
    assert r.status_code == 409
    assert await _balance(db_session, ctx["stu"].id) == 5
    txs = (await db_session.execute(
        select(CoinTransaction).where(CoinTransaction.source == "referral"))).scalars().all()
    assert len(txs) == 1 and txs[0].dedup_key == f"referral:{lead['id']}"

    # 线下奖励: 待兑现 → 已兑现,不能兑两次
    after = (await client.get("/api/v1/referral/leads", headers=_h(ctx["t1"].id))).json()
    assert after["pending_rewards"] == 1
    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/reward-granted", headers=_h(ctx["t1"].id))
    assert r.status_code == 200
    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/reward-granted", headers=_h(ctx["t1"].id))
    assert r.status_code == 409

    # 已报名的不能改回其它状态(改回去再确认一次 = 第二份线下奖励)
    r = await client.patch(f"/api/v1/referral/leads/{lead['id']}", headers=_h(ctx["t1"].id),
                           json={"status": "contacted"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_same_phone_first_referrer_wins(client, db_session, ctx):
    code1 = await _code(client, ctx["t1"], ctx["stu"])
    code2 = await _code(client, ctx["t2"], ctx["other_stu"])
    assert (await _submit(client, code1, "13800002222")).json()["status"] == "created"
    # 另一个老生也推荐了同一家: 不报错(不告诉他被谁推荐过),但不新建
    assert (await _submit(client, code2, "+86 138-0000-2222")).json()["status"] == "duplicate"
    rows = (await db_session.execute(select(ReferralLead))).scalars().all()
    assert len(rows) == 1 and rows[0].referrer_student_id == ctx["stu"].id


@pytest.mark.asyncio
async def test_existing_account_flagged_and_not_rewarded_by_default(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    # 13900000001 是本机构学生自己的手机号 → 老客户
    await _submit(client, code, "13900000001")
    lead = (await client.get("/api/v1/referral/leads", headers=_h(ctx["t1"].id))).json()["items"][0]
    assert lead["existing_account"] is True
    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/enroll", headers=_h(ctx["t1"].id), json={})
    assert r.json() == {"coins": 0, "reward_text": ""}
    assert await _balance(db_session, ctx["stu"].id) == 0


@pytest.mark.asyncio
async def test_existing_account_rewarded_when_confirmed(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    await _submit(client, code, "13900000001")
    lead = (await client.get("/api/v1/referral/leads", headers=_h(ctx["t1"].id))).json()["items"][0]
    r = await client.post(f"/api/v1/referral/leads/{lead['id']}/enroll", headers=_h(ctx["t1"].id),
                          json={"grant_reward": True})
    assert r.json()["coins"] == 5


@pytest.mark.asyncio
async def test_scope_other_org_and_other_class(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    await _submit(client, code, "13800003333")
    lead_id = (await db_session.execute(select(ReferralLead.id))).scalar_one()

    # 别家机构的老师: 列表空、确认 404
    assert (await client.get("/api/v1/referral/leads", headers=_h(ctx["tb"].id))).json()["total"] == 0
    r = await client.post(f"/api/v1/referral/leads/{lead_id}/enroll", headers=_h(ctx["tb"].id), json={})
    assert r.status_code == 404
    # 同机构别的班的老师: 也看不到(只看本班学生推荐来的)
    assert (await client.get("/api/v1/referral/leads", headers=_h(ctx["t2"].id))).json()["total"] == 0
    r = await client.patch(f"/api/v1/referral/leads/{lead_id}", headers=_h(ctx["t2"].id),
                           json={"staff_note": "x"})
    assert r.status_code == 404
    # 机构管理员看全机构;别家机构管理员看不到也改不了(这条锁住 org_id 过滤 ——
    # 老师那边有「只看本班」兜着,去掉机构过滤老师用例照样绿)
    assert (await client.get("/api/v1/referral/leads", headers=_h(ctx["oa"].id))).json()["total"] == 1
    assert (await client.get("/api/v1/referral/leads", headers=_h(ctx["oa_b"].id))).json()["total"] == 0
    r = await client.post(f"/api/v1/referral/leads/{lead_id}/enroll", headers=_h(ctx["oa_b"].id), json={})
    assert r.status_code == 404
    # 老师不能替别班学生拿链接
    r = await client.get(f"/api/v1/teacher/referral/students/{ctx['other_stu'].id}/invite",
                         headers=_h(ctx["t1"].id))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_public_page_masks_name_and_hides_disabled(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    r = await client.get(f"/api/v1/referral/public/{code}")
    assert r.status_code == 200
    body = r.json()
    assert body["referrer"] == "张同学"
    assert "张小明" not in r.text
    assert body["org_name"] == "甲校区"
    assert body["friend_offer"] == "免费测评 + 体验课 1 节"
    # 小写也认
    assert (await client.get(f"/api/v1/referral/public/{code.lower()}")).status_code == 200
    # 机构关掉推荐 → 链接失效,提交也进不来
    r = await client.put("/api/v1/referral/settings", headers=_h(ctx["oa"].id), json={"enabled": False})
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/referral/public/{code}")).status_code == 404
    assert (await _submit(client, code, "13800004444")).status_code == 404
    assert (await client.get("/api/v1/referral/public/NOPE2345")).status_code == 404


@pytest.mark.asyncio
async def test_settings_only_org_admin_and_bounds(client, db_session, ctx):
    r = await client.put("/api/v1/referral/settings", headers=_h(ctx["t1"].id), json={"reward_coins": 3})
    assert r.status_code == 403
    r = await client.put("/api/v1/referral/settings", headers=_h(ctx["oa"].id), json={"reward_coins": 5000})
    assert r.status_code == 400
    # 清空线下奖励: 空串照写(判键在不在,不是判值空不空)
    r = await client.put("/api/v1/referral/settings", headers=_h(ctx["oa"].id), json={"reward_text": ""})
    assert r.status_code == 200 and r.json()["reward_text"] == ""
    assert r.json()["reward_coins"] == 5  # 没传的键不动


@pytest.mark.asyncio
async def test_bad_phone_rejected(client, db_session, ctx):
    code = await _code(client, ctx["t1"], ctx["stu"])
    r = await _submit(client, code, "12345")
    assert r.status_code == 400 and "手机号" in r.json()["detail"]


@pytest.mark.asyncio
async def test_parent_gets_same_code_and_registers_into_child_org(client, db_session, ctx):
    from datetime import datetime, timedelta
    db_session.add(ParentBindCode(code="556677", student_id=ctx["stu"].id,
                                  expires_at=datetime.utcnow() + timedelta(minutes=5)))
    await db_session.commit()
    r = await client.post("/api/v1/parent/register", json={
        "bind_code": "556677", "phone": "13700009999", "password": "abc123"})
    assert r.status_code == 200, r.text
    parent = (await db_session.execute(select(User).where(User.phone == "13700009999"))).scalar_one()
    # 原先落列默认 1(直营);现在跟孩子的机构
    assert parent.org_id == ctx["org_a"].id
    teacher_code = await _code(client, ctx["t1"], ctx["stu"])
    r = await client.get(f"/api/v1/parent/children/{ctx['stu'].id}/invite", headers=_h(parent.id))
    assert r.status_code == 200, r.text
    assert r.json()["code"] == teacher_code
    # 没绑定的孩子: 404
    r = await client.get(f"/api/v1/parent/children/{ctx['other_stu'].id}/invite", headers=_h(parent.id))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_invite_follows_student_to_new_org(client, db_session, ctx):
    """学生换了机构(扫别家班级码入班会被迁过去): 邀请码跟着走,不然链接永远 404、线索落到旧机构"""
    code = await _code(client, ctx["t1"], ctx["stu"])
    stu = ctx["stu"]
    stu.org_id = ctx["org_b"].id
    cls_b = Class(name="乙一班", teacher_id=ctx["tb"].id, org_id=ctx["org_b"].id)
    db_session.add(cls_b)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls_b.id, student_id=stu.id, is_active=True))
    await db_session.commit()
    r = await client.get(f"/api/v1/teacher/referral/students/{stu.id}/invite", headers=_h(ctx["tb"].id))
    assert r.status_code == 200, r.text
    assert r.json()["code"] == code and r.json()["org_name"] == "乙校区"
    # 乙校区没有设置行 = 默认开启
    assert (await _submit(client, code, "13800005555")).json()["status"] == "created"
    lead = (await db_session.execute(select(ReferralLead))).scalar_one()
    assert lead.org_id == ctx["org_b"].id
