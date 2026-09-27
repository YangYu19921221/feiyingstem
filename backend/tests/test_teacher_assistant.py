"""助教账号(2026-09-27)—— 几位老师共用一个账号追不了责,改成主老师给助教各开一个号。

守五件事:
  1. 助教看数据/改数据按主老师的范围(班级、作业都看得见),但**操作记录记助教本人**
  2. 作业记布置人;助教只能关闭/删除**自己**布置的,主老师能动全部
  3. 助教不能删班级/移出学生/转班/管理助教
  4. 越权: 不能管别的老师/别家机构的助教;主老师停用后助教登不进来
  5. 助教不进教师统计;上限 MAX_ASSISTANTS 个;加币走助教自己的 PIN
"""
import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.audit import OperationLog
from app.models.coin import CoinTransaction
from app.models.learning import HomeworkAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, UnitWord, Word
from app.services.auth_service import get_password_hash
from tests.conftest import _make_token


@pytest.fixture
async def ctx(db_session):
    tenancy._org_cache.clear()
    org_a = Organization(name="甲机构", code="ASTA", status="active", coin_mode="auto")
    org_b = Organization(name="乙机构", code="ASTB", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    owner = User(username="astowner", email="asto@e.com", hashed_password=get_password_hash("pw123456"),
                 role="teacher", full_name="王老师", is_active=True, org_id=org_a.id,
                 coin_pin_hash=get_password_hash("1111"))
    other = User(username="astother", email="astx@e.com", hashed_password="x",
                 role="teacher", full_name="李老师", is_active=True, org_id=org_a.id)
    teacher_b = User(username="astteacherb", email="astb@e.com", hashed_password="x",
                     role="teacher", full_name="乙老师", is_active=True, org_id=org_b.id)
    stu = User(username="aststudent", email="asts@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org_a.id)
    oa = User(username="astorgadmin", email="asta@e.com", hashed_password="x",
              role="org_admin", full_name="甲管理员", is_active=True, org_id=org_a.id)
    db_session.add_all([owner, other, teacher_b, stu, oa])
    await db_session.flush()
    cls = Class(name="三年级1班", teacher_id=owner.id, org_id=org_a.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))
    book = WordBook(name="人教版三上", is_public=True)
    db_session.add(book)
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    db_session.add(unit)
    await db_session.flush()
    for i in range(3):
        w = Word(word=f"astword{i}")
        db_session.add(w)
        await db_session.flush()
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
    await db_session.commit()
    return {"owner": owner, "other": other, "teacher_b": teacher_b, "stu": stu,
            "oa": oa, "cls": cls, "unit": unit, "org_a": org_a}


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


async def _add_assistant(client, owner, name="小张", username="astzhang"):
    r = await client.post("/api/v1/teacher/assistants", headers=_h(owner.id), json={
        "full_name": name, "username": username, "password": "abc123"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _create_hw(client, uid, ctx, title="听写"):
    r = await client.post("/api/v1/teacher/homework", headers=_h(uid), json={
        "title": title, "unit_id": ctx["unit"].id, "learning_mode": "classify",
        "student_ids": [ctx["stu"].id], "target_score": 80, "max_attempts": 3})
    assert r.status_code == 200, r.text
    return r.json()["homework_id"]


@pytest.mark.asyncio
async def test_assistant_sees_owner_data_and_is_logged_as_self(client, db_session, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    # 能用自己的账号密码登录
    r = await client.post("/api/v1/auth/login/json", json={"username": "astzhang", "password": "abc123"})
    assert r.status_code == 200, r.text
    # /me 是助教本人,带 owner_teacher_id
    me = (await client.get("/api/v1/auth/me", headers=_h(aid))).json()
    assert me["id"] == aid and me["owner_teacher_id"] == ctx["owner"].id
    # 看得见主老师的班级
    r = await client.get("/api/v1/teacher/classes", headers=_h(aid))
    assert r.status_code == 200 and [c["id"] for c in r.json()] == [ctx["cls"].id]

    hw = await _create_hw(client, aid, ctx, "助教布置的")
    row = (await db_session.execute(select(HomeworkAssignment).where(HomeworkAssignment.id == hw))).scalar_one()
    assert row.teacher_id == ctx["owner"].id  # 数据归主老师
    assert row.assigned_by == aid and row.assigned_by_name == "小张"
    # 主老师的作业列表里看得见,带布置人
    lst = (await client.get("/api/v1/teacher/homework", headers=_h(ctx["owner"].id))).json()
    item = next(x for x in lst if x["id"] == hw)
    assert item["assigned_by_name"] == "小张"

    log = (await db_session.execute(
        select(OperationLog).where(OperationLog.action == "homework.create"))).scalar_one()
    assert log.actor_id == aid and log.actor_name == "小张" and log.actor_role == "assistant"


@pytest.mark.asyncio
async def test_assistant_only_manages_own_homework(client, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    aid2 = await _add_assistant(client, ctx["owner"], "小刘", "astliu")
    by_owner = await _create_hw(client, ctx["owner"].id, ctx, "主老师的")
    by_other_assistant = await _create_hw(client, aid2, ctx, "小刘的")
    mine = await _create_hw(client, aid, ctx, "我的")

    lst = {x["id"]: x for x in (await client.get("/api/v1/teacher/homework", headers=_h(aid))).json()}
    assert lst[mine]["can_manage"] and not lst[by_owner]["can_manage"]

    for hw in (by_owner, by_other_assistant):
        assert (await client.post(f"/api/v1/teacher/homework/{hw}/toggle-closed", headers=_h(aid))).status_code == 403
        assert (await client.delete(f"/api/v1/teacher/homework/{hw}", headers=_h(aid))).status_code == 403
    assert (await client.post(f"/api/v1/teacher/homework/{mine}/toggle-closed", headers=_h(aid))).status_code == 200
    assert (await client.delete(f"/api/v1/teacher/homework/{mine}", headers=_h(aid))).status_code == 200
    # 主老师能动助教布置的
    assert (await client.delete(f"/api/v1/teacher/homework/{by_other_assistant}",
                                headers=_h(ctx["owner"].id))).status_code == 200


@pytest.mark.asyncio
async def test_assistant_forbidden_actions(client, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    cid, sid = ctx["cls"].id, ctx["stu"].id
    assert (await client.delete(f"/api/v1/teacher/classes/{cid}", headers=_h(aid))).status_code == 403
    assert (await client.delete(f"/api/v1/teacher/classes/{cid}/students/{sid}", headers=_h(aid))).status_code == 403
    assert (await client.post(f"/api/v1/teacher/students/{sid}/transfer", headers=_h(aid),
                              json={"from_class_id": cid, "to_class_id": cid})).status_code == 403
    assert (await client.get("/api/v1/teacher/assistants", headers=_h(aid))).status_code == 403
    assert (await client.post("/api/v1/teacher/assistants", headers=_h(aid), json={
        "full_name": "套娃", "username": "astnested", "password": "abc123"})).status_code == 403


@pytest.mark.asyncio
async def test_cannot_touch_other_teachers_assistant(client, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    for uid in (ctx["other"].id, ctx["teacher_b"].id):
        assert (await client.patch(f"/api/v1/teacher/assistants/{aid}", headers=_h(uid),
                                   json={"is_active": False})).status_code == 404
        assert (await client.delete(f"/api/v1/teacher/assistants/{aid}", headers=_h(uid))).status_code == 404
        items = (await client.get("/api/v1/teacher/assistants", headers=_h(uid))).json()["items"]
        assert items == []


@pytest.mark.asyncio
async def test_disabled_owner_or_assistant_blocks_login(client, db_session, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    # 停用助教
    r = await client.patch(f"/api/v1/teacher/assistants/{aid}", headers=_h(ctx["owner"].id), json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert (await client.get("/api/v1/teacher/classes", headers=_h(aid))).status_code in (400, 401, 403)  # 既有口径: 已禁用=400
    await client.patch(f"/api/v1/teacher/assistants/{aid}", headers=_h(ctx["owner"].id), json={"is_active": True})
    assert (await client.get("/api/v1/teacher/classes", headers=_h(aid))).status_code == 200
    # 停用主老师 → 助教一并不可用(接口 + 登录)
    ctx["owner"].is_active = False
    await db_session.commit()
    assert (await client.get("/api/v1/teacher/classes", headers=_h(aid))).status_code == 403
    r = await client.post("/api/v1/auth/login/json", json={"username": "astzhang", "password": "abc123"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_limit_and_excluded_from_teacher_counts(client, ctx):
    from app.api.v1.teacher.assistants import MAX_ASSISTANTS
    assert MAX_ASSISTANTS == 10
    for i in range(MAX_ASSISTANTS):
        await _add_assistant(client, ctx["owner"], f"助教{i}", f"astmany{i}")
    r = await client.post("/api/v1/teacher/assistants", headers=_h(ctx["owner"].id), json={
        "full_name": "超额", "username": "astmanyover", "password": "abc123"})
    assert r.status_code == 400
    # 用户名撞别家机构的也要拒(用户名全平台唯一)
    r = await client.post("/api/v1/teacher/assistants", headers=_h(ctx["other"].id), json={
        "full_name": "撞名", "username": "astteacherb", "password": "abc123"})
    assert r.status_code == 409

    teachers = (await client.get("/api/v1/org/teachers", headers=_h(ctx["oa"].id))).json()
    assert {t["username"] for t in teachers} == {"astowner", "astother"}
    owner_row = next(t for t in teachers if t["username"] == "astowner")
    assert len(owner_row["assistants"]) == MAX_ASSISTANTS


@pytest.mark.asyncio
async def test_assistant_uses_own_coin_pin(client, db_session, ctx):
    aid = await _add_assistant(client, ctx["owner"])
    body = {"student_id": ctx["stu"].id, "amount": -1, "reason": "扣"}
    # 主老师的 PIN 助教用不了;助教没设过 → PIN_NOT_SET
    r = await client.post("/api/v1/teacher/coins/adjust", headers=_h(aid), json={**body, "pin": "1111"})
    assert r.status_code == 403 and r.json()["detail"] == "PIN_NOT_SET"
    assert (await client.get("/api/v1/teacher/coins/pin-status", headers=_h(aid))).json()["has_pin"] is False
    assert (await client.post("/api/v1/teacher/coins/pin", headers=_h(aid), json={"new_pin": "2222"})).status_code == 200
    # 主老师的 PIN 不受影响
    await db_session.refresh(ctx["owner"])
    from app.services.auth_service import verify_password
    assert verify_password("1111", ctx["owner"].coin_pin_hash)
    r = await client.post("/api/v1/teacher/coins/adjust", headers=_h(aid),
                          json={"student_id": ctx["stu"].id, "amount": 2, "reason": "表现好", "pin": "2222"})
    assert r.status_code == 200, r.text
    tx = (await db_session.execute(select(CoinTransaction).where(CoinTransaction.amount == 2))).scalar_one()
    assert tx.operator_id == aid
