"""家长绑定(2026-10-21)—— 生产 0 个家长的根因与老师发链接

根因: 孩子的学生号注册时填的就是家长手机(生产 793 个学生 768 个有手机号),
家长注册原先跟**所有角色**查重 →「该手机号已被其它角色注册」,一个家长都没注册上。
另守: 同号两个账号时主登录页不 500、家长登录只认家长号、老师只能给本班发链接/重置密码、
码一次性、全站输错闸门换 IP 也绕不过。
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.audit import OperationLog
from app.models.organization import Organization
from app.models.user import Class, ClassStudent, ParentBindCode, ParentStudentLink, User
from app.services import rate_limit
from app.services.auth_service import get_password_hash
from tests.conftest import _make_token

PHONE = "13812345678"


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    rate_limit.reset()
    org = Organization(name="甲校区", code="PBIND", status="active")
    db_session.add(org)
    await db_session.flush()
    t1 = User(username="pbteach", email="pbt@e.com", hashed_password="x", role="teacher",
              full_name="王老师", org_id=org.id, is_active=True)
    t2 = User(username="pbteachtwo", email="pbt2@e.com", hashed_password="x", role="teacher",
              full_name="李老师", org_id=org.id, is_active=True)
    # 孩子的学生号用的就是家长手机
    stu = User(username="pbstu", email="pbs@e.com", hashed_password=get_password_hash("stupass1"),
               role="student", full_name="张小明", org_id=org.id, is_active=True, phone=PHONE)
    sib = User(username="pbsib", email="pbsib@e.com", hashed_password="x", role="student",
               full_name="张小红", org_id=org.id, is_active=True)
    other = User(username="pbother", email="pbo@e.com", hashed_password="x", role="student",
                 full_name="刘别班", org_id=org.id, is_active=True)
    db_session.add_all([t1, t2, stu, sib, other])
    await db_session.flush()
    c1 = Class(name="一班", teacher_id=t1.id, org_id=org.id)
    c2 = Class(name="二班", teacher_id=t2.id, org_id=org.id)
    db_session.add_all([c1, c2])
    await db_session.flush()
    db_session.add_all([
        ClassStudent(class_id=c1.id, student_id=stu.id, is_active=True),
        ClassStudent(class_id=c1.id, student_id=sib.id, is_active=True),
        ClassStudent(class_id=c2.id, student_id=other.id, is_active=True),
    ])
    await db_session.commit()
    return {"org": org, "t1": t1, "t2": t2, "stu": stu, "sib": sib, "other": other}


async def _student_code(client, stu):
    r = await client.post("/api/v1/student/parent-bind-codes", headers=_h(stu.id))
    assert r.status_code == 200, r.text
    return r.json()


async def _register(client, code, phone=PHONE, password="parpass1", ip="198.51.100.1"):
    return await client.post("/api/v1/parent/register", headers={"X-Real-IP": ip}, json={
        "bind_code": code, "phone": phone, "password": password, "full_name": "小明妈妈"})


@pytest.mark.asyncio
async def test_parent_registers_with_same_phone_as_child(client, db_session, env):
    """生产 0 家长的根因: 家长手机号 == 孩子学生号的手机号。原先 400 phone_taken"""
    d = await _student_code(client, env["stu"])
    # 码: 8 位数字、24 小时
    assert d["code"].isdigit() and len(d["code"]) == 8
    assert d["minutes_left"] == 24 * 60
    r = await _register(client, d["code"])
    assert r.status_code == 200, r.text
    pid = r.json()["parent_id"]
    rows = (await db_session.execute(select(User).where(User.phone == PHONE))).scalars().all()
    assert sorted(u.role for u in rows) == ["parent", "student"]
    link = (await db_session.execute(select(ParentStudentLink).where(ParentStudentLink.parent_id == pid))).scalar_one()
    assert link.student_id == env["stu"].id
    # 码一次性
    r = await _register(client, d["code"], phone="13900000002")
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid_bind_code"


@pytest.mark.asyncio
async def test_same_phone_logins_pick_the_right_account(client, db_session, env):
    """同号两个账号: 家长登录只认家长号;主登录页按密码分得开,原先 scalar_one_or_none 会 500"""
    # 只有学生号时,家长登录提示要去注册,并说清「手机号可以一样」
    r = await client.post("/api/v1/parent/login", json={"phone": PHONE, "password": "stupass1"})
    assert r.status_code == 401 and "学生账号" in r.json()["detail"]["message"]

    d = await _student_code(client, env["stu"])
    assert (await _register(client, d["code"])).status_code == 200

    r = await client.post("/api/v1/parent/login", json={"phone": PHONE, "password": "parpass1"})
    assert r.status_code == 200, r.text
    r = await client.post("/api/v1/parent/login", json={"phone": PHONE, "password": "stupass1"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "wrong_password"

    r = await client.post("/api/v1/auth/login/json", json={"username": PHONE, "password": "stupass1"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "student"
    r = await client.post("/api/v1/auth/login/json", json={"username": PHONE, "password": "parpass1"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "parent"
    r = await client.post("/api/v1/auth/login/json", json={"username": PHONE, "password": "wrong999"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_existing_parent_reregister_binds_second_child(client, db_session, env):
    """家长忘了自己注册过,拿二孩的码又去注册: 密码对 → 直接绑上;密码错 → 不吞码"""
    d1 = await _student_code(client, env["stu"])
    pid = (await _register(client, d1["code"])).json()["parent_id"]

    d2 = await _student_code(client, env["sib"])
    r = await _register(client, d2["code"], password="nottheone")
    assert r.status_code == 400 and r.json()["detail"]["code"] == "phone_taken"
    row = await db_session.get(ParentBindCode, d2["code"])
    assert row.used_at is None  # 密码错不吞码

    r = await _register(client, d2["code"])
    assert r.status_code == 200 and r.json()["parent_id"] == pid
    kids = (await db_session.execute(
        select(ParentStudentLink.student_id).where(ParentStudentLink.parent_id == pid))).scalars().all()
    assert sorted(kids) == sorted([env["stu"].id, env["sib"].id])
    parents = (await db_session.execute(select(User).where(User.role == "parent"))).scalars().all()
    assert len(parents) == 1


@pytest.mark.asyncio
async def test_teacher_link_reused_until_renewed_and_scoped_to_class(client, db_session, env):
    t1, stu, other = env["t1"], env["stu"], env["other"]
    r = await client.post(f"/api/v1/teacher/parent-binding/students/{stu.id}/code", headers=_h(t1.id))
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    assert len(code) == 8 and not code.isdigit()
    # 再点一次是同一个码(老师可能已经发出去了)
    r = await client.post(f"/api/v1/teacher/parent-binding/students/{stu.id}/code", headers=_h(t1.id))
    assert r.json()["code"] == code and r.json()["renewed"] is False
    # 换新: 旧码作废
    r = await client.post(f"/api/v1/teacher/parent-binding/students/{stu.id}/code?renew=true", headers=_h(t1.id))
    new_code = r.json()["code"]
    assert new_code != code and r.json()["renewed"] is True
    assert (await _register(client, code)).status_code == 400
    # 别班学生: 403
    r = await client.post(f"/api/v1/teacher/parent-binding/students/{other.id}/code", headers=_h(t1.id))
    assert r.status_code == 403
    r = await client.post("/api/v1/teacher/parent-binding/codes", headers=_h(t1.id),
                          json={"student_ids": [stu.id, other.id]})
    assert r.status_code == 403
    # 家长手抄成小写 / 带空格也认
    r = await _register(client, " " + new_code.lower()[:4] + " " + new_code.lower()[4:])
    assert r.status_code == 200, r.text
    logs = (await db_session.execute(select(OperationLog.action))).scalars().all()
    assert logs.count("parent.bind_link") == 2


@pytest.mark.asyncio
async def test_teacher_list_unbound_first_and_masks_phone(client, db_session, env):
    t1, stu, sib = env["t1"], env["stu"], env["sib"]
    d = await _student_code(client, stu)
    assert (await _register(client, d["code"])).status_code == 200
    # 孩子自己的码不算「已发的链接」
    await _student_code(client, sib)
    r = await client.post("/api/v1/teacher/parent-binding/codes", headers=_h(t1.id),
                          json={"student_ids": [sib.id]})
    batch_code = r.json()["items"][0]["code"]

    r = await client.get("/api/v1/teacher/parent-binding/students", headers=_h(t1.id))
    assert r.status_code == 200, r.text
    data = r.json()
    assert (data["bound"], data["total"]) == (1, 2)
    first, second = data["items"]
    assert first["id"] == sib.id and first["parents"] == [] and first["pending"]["code"] == batch_code
    assert second["id"] == stu.id
    assert second["parents"][0]["phone"] == "138****5678"
    # 别班老师看不到
    r = await client.get("/api/v1/teacher/parent-binding/students", headers=_h(env["t2"].id))
    assert [x["id"] for x in r.json()["items"]] == [env["other"].id]


@pytest.mark.asyncio
async def test_reset_password_only_when_all_kids_in_my_class(client, db_session, env):
    t1, t2, stu, other = env["t1"], env["t2"], env["stu"], env["other"]
    d = await _student_code(client, stu)
    pid = (await _register(client, d["code"])).json()["parent_id"]
    link_id = (await db_session.execute(
        select(ParentStudentLink.id).where(ParentStudentLink.parent_id == pid))).scalar_one()

    r = await client.post(f"/api/v1/teacher/parent-binding/links/{link_id}/reset-password", headers=_h(t2.id))
    assert r.status_code == 403
    r = await client.post(f"/api/v1/teacher/parent-binding/links/{link_id}/reset-password", headers=_h(t1.id))
    assert r.status_code == 200, r.text
    pwd = r.json()["password"]
    r = await client.post("/api/v1/parent/login", json={"phone": PHONE, "password": pwd})
    assert r.status_code == 200

    # 这位家长再绑一个别班的孩子 → 一班老师不能再重置(否则进得去别班孩子的家长号)
    d2 = await _student_code(client, other)
    r = await client.post("/api/v1/parent/bind", headers=_h(pid), json={"bind_code": d2["code"]})
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/teacher/parent-binding/links/{link_id}/reset-password", headers=_h(t1.id))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_unbind_removes_link_and_logs(client, db_session, env):
    t1, t2, stu = env["t1"], env["t2"], env["stu"]
    d = await _student_code(client, stu)
    pid = (await _register(client, d["code"])).json()["parent_id"]
    link_id = (await db_session.execute(
        select(ParentStudentLink.id).where(ParentStudentLink.parent_id == pid))).scalar_one()
    r = await client.delete(f"/api/v1/teacher/parent-binding/links/{link_id}", headers=_h(t2.id))
    assert r.status_code == 403
    r = await client.delete(f"/api/v1/teacher/parent-binding/links/{link_id}", headers=_h(t1.id))
    assert r.status_code == 200
    assert (await db_session.execute(select(ParentStudentLink))).scalars().all() == []
    assert await db_session.get(User, pid) is not None  # 家长号不删
    log = (await db_session.execute(select(OperationLog).where(OperationLog.action == "parent.unbind"))).scalar_one()
    assert "138****5678" in log.summary and PHONE not in log.summary


@pytest.mark.asyncio
async def test_global_wrong_code_gate_survives_ip_rotation(client, db_session, env):
    """学生码 24 小时有效,只按 IP 限速挡不住换 IP 猜码;全站输错 100 次后整体 429"""
    for i in range(100):
        r = await _register(client, f"{10000000 + i}", ip=f"203.0.113.{i % 250}")
        assert r.status_code == 400
    d = await _student_code(client, env["stu"])
    r = await _register(client, d["code"], ip="192.0.2.77")
    assert r.status_code == 429
    rate_limit.reset()
    assert (await _register(client, d["code"], ip="192.0.2.77")).status_code == 200


@pytest.mark.asyncio
async def test_student_signup_not_blocked_by_parent_phone(client, db_session, env):
    """反方向: 家长先注册了,孩子再用家长手机注册学生号也不该被挡"""
    d = await _student_code(client, env["stu"])
    assert (await _register(client, d["code"], phone="13700001111")).status_code == 200
    r = await client.post("/api/v1/auth/register", json={
        "phone": "13700001111", "username": "pbnewkid", "password": "kidpass1"})
    assert r.status_code == 200, r.text
