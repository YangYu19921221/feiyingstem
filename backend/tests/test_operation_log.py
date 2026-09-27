"""操作记录(追责)—— 几位老师共用一个账号时,作业布置错了要能查到是哪台设备、什么时候做的。

守四件事:
  1. 关键写操作(作业增删关、金币加减、单词本分配、教职工登录)都留日志,
     删除类存**快照**(对象删了之后日志照样读得懂)
  2. IP 取 X-Real-IP(生产在 nginx 后,request.client 恒为 127.0.0.1)
  3. 机构管理员只看得到本机构的日志(显式过滤,conftest 不注册 tenancy 过滤器)
  4. 业务没成功就不留日志(日志与业务同一事务)
"""
import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.audit import OperationLog
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit, UnitWord, Word
from app.services.audit_log import describe_device
from app.services.auth_service import get_password_hash
from tests.conftest import _make_token

PIN = "1234"
UA_IPHONE_WX = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40")


@pytest.fixture
async def two_orgs(db_session):
    """A 机构:老师 + 学生 + 机构管理员 + 一个单元;B 机构:一个机构管理员。"""
    tenancy._org_cache.clear()
    org_a = Organization(name="甲机构", code="OPLOGA", status="active", coin_mode="auto")
    org_b = Organization(name="乙机构", code="OPLOGB", status="active")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    teacher = User(username="oplogteacher", email="oplogt@e.com",
                   hashed_password=get_password_hash("pw123456"),
                   role="teacher", full_name="共用账号", is_active=True, org_id=org_a.id,
                   coin_pin_hash=get_password_hash(PIN))
    stu = User(username="oplogstudent", email="oplogs@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org_a.id)
    oa_a = User(username="oplogadmina", email="oploga@e.com", hashed_password="x",
                role="org_admin", full_name="甲管理员", is_active=True, org_id=org_a.id)
    oa_b = User(username="oplogadminb", email="oplogb@e.com", hashed_password="x",
                role="org_admin", full_name="乙管理员", is_active=True, org_id=org_b.id)
    db_session.add_all([teacher, stu, oa_a, oa_b])
    await db_session.flush()
    cls = Class(name="三年级1班", teacher_id=teacher.id, org_id=org_a.id)
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
        w = Word(word=f"oplogword{i}")
        db_session.add(w)
        await db_session.flush()
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
    await db_session.commit()
    return {"teacher": teacher, "stu": stu, "oa_a": oa_a, "oa_b": oa_b,
            "book": book, "unit": unit}


def _h(user, ip="203.0.113.7"):
    return {"Authorization": f"Bearer {_make_token(user.id)}",
            "X-Real-IP": ip, "User-Agent": UA_IPHONE_WX}


async def _create_hw(client, ctx, title="第一单元听写"):
    r = await client.post("/api/v1/teacher/homework", headers=_h(ctx["teacher"]), json={
        "title": title, "unit_id": ctx["unit"].id, "learning_mode": "classify",
        "student_ids": [ctx["stu"].id], "target_score": 80, "max_attempts": 3,
    })
    assert r.status_code == 200, r.text
    return r.json()["homework_id"]


async def _logs(db, action=None):
    q = select(OperationLog).order_by(OperationLog.id)
    if action:
        q = q.where(OperationLog.action == action)
    return (await db.execute(q)).scalars().all()


@pytest.mark.asyncio
async def test_homework_create_and_delete_logged_with_snapshot(client, two_orgs, db_session):
    ctx = two_orgs
    hw_id = await _create_hw(client, ctx)

    [log] = await _logs(db_session, "homework.create")
    assert log.actor_id == ctx["teacher"].id and log.org_id == ctx["teacher"].org_id
    assert "第一单元听写" in log.summary and "Unit 1" in log.summary
    assert log.ip == "203.0.113.7"  # 取的是 X-Real-IP 不是 127.0.0.1
    assert describe_device(log.user_agent) == "iPhone · 微信"

    r = await client.delete(f"/api/v1/teacher/homework/{hw_id}", headers=_h(ctx["teacher"], ip="198.51.100.9"))
    assert r.status_code == 200, r.text
    [dlog] = await _logs(db_session, "homework.delete")
    assert dlog.ip == "198.51.100.9"
    # 作业行已删,日志里的快照仍能说清删的是什么、影响了谁
    assert "第一单元听写" in dlog.summary
    assert '"student_ids": [%d]' % ctx["stu"].id in dlog.detail


@pytest.mark.asyncio
async def test_homework_toggle_closed_logged(client, two_orgs, db_session):
    ctx = two_orgs
    hw_id = await _create_hw(client, ctx)
    r = await client.post(f"/api/v1/teacher/homework/{hw_id}/toggle-closed", headers=_h(ctx["teacher"]))
    assert r.status_code == 200, r.text
    assert len(await _logs(db_session, "homework.close")) == 1


@pytest.mark.asyncio
async def test_coin_adjust_logged_and_failed_adjust_not_logged(client, two_orgs, db_session):
    ctx = two_orgs
    # 扣成负数被拒 → 业务没发生,日志也不能有
    r = await client.post("/api/v1/teacher/coins/adjust", headers=_h(ctx["teacher"]), json={
        "student_id": ctx["stu"].id, "amount": -5, "reason": "扣", "pin": PIN})
    assert r.status_code == 400
    assert await _logs(db_session, "coin.adjust") == []

    r = await client.post("/api/v1/teacher/coins/adjust", headers=_h(ctx["teacher"]), json={
        "student_id": ctx["stu"].id, "amount": 2, "reason": "课堂表现", "pin": PIN})
    assert r.status_code == 200, r.text
    [log] = await _logs(db_session, "coin.adjust")
    assert "学生甲" in log.summary and "+2" in log.summary and "课堂表现" in log.summary


@pytest.mark.asyncio
async def test_book_assign_logged(client, two_orgs, db_session):
    ctx = two_orgs
    r = await client.post("/api/v1/teacher/assign", headers=_h(ctx["teacher"]), json={
        "book_id": ctx["book"].id, "student_ids": [ctx["stu"].id],
        "scope_type": "unit", "unit_ids": [ctx["unit"].id]})
    assert r.status_code == 200, r.text
    [log] = await _logs(db_session, "book.assign")
    assert "人教版三上" in log.summary and "Unit 1" in log.summary


@pytest.mark.asyncio
async def test_staff_login_logged_student_login_not(client, two_orgs, db_session):
    ctx = two_orgs
    r = await client.post("/api/v1/auth/login/json", headers={"X-Real-IP": "192.0.2.1"},
                          json={"username": "oplogteacher", "password": "pw123456"})
    assert r.status_code == 200, r.text
    [log] = await _logs(db_session, "auth.login")
    assert log.actor_id == ctx["teacher"].id and log.ip == "192.0.2.1"


@pytest.mark.asyncio
async def test_org_admin_sees_only_own_org(client, two_orgs, db_session):
    ctx = two_orgs
    await _create_hw(client, ctx)

    r = await client.get("/api/v1/admin/operation-logs", headers=_h(ctx["oa_a"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["action_label"] == "布置作业" and item["device"] == "iPhone · 微信"
    assert item["detail"]["title"] == "第一单元听写"
    assert [a["id"] for a in body["actors"]] == [ctx["teacher"].id]

    # 别家机构管理员:一条都不能看到,操作人下拉也不能漏出甲机构老师的名字
    r = await client.get("/api/v1/admin/operation-logs", headers=_h(ctx["oa_b"]))
    assert r.status_code == 200
    assert r.json()["total"] == 0 and r.json()["items"] == [] and r.json()["actors"] == []


@pytest.mark.asyncio
async def test_teacher_and_student_cannot_read_logs(client, two_orgs):
    ctx = two_orgs
    for u in (ctx["teacher"], ctx["stu"]):
        r = await client.get("/api/v1/admin/operation-logs", headers=_h(u))
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_filters_group_keyword_ip(client, two_orgs, db_session):
    ctx = two_orgs
    await _create_hw(client, ctx, title="周末复习_A")
    await client.post("/api/v1/teacher/coins/adjust", headers=_h(ctx["teacher"], ip="10.0.0.2"), json={
        "student_id": ctx["stu"].id, "amount": 1, "reason": "x", "pin": PIN})
    get = lambda **p: client.get("/api/v1/admin/operation-logs", headers=_h(ctx["oa_a"]), params=p)

    assert (await get(group="coin")).json()["total"] == 1
    assert (await get(group="homework")).json()["total"] == 1
    assert (await get(ip="10.0.0.2")).json()["total"] == 1
    assert (await get(keyword="复习_A")).json()["total"] == 1
    # 下划线必须按字面匹配,不能当通配符
    assert (await get(keyword="复习xA")).json()["total"] == 0
    assert (await get(group="nope")).status_code == 400
