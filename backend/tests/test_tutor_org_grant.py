"""平台给机构发学习助手次数(2026-10-27,用户「总管理端可以给别的机构发总 AI 学习助手次数」)

用户选了: 老师分给学生 / 这些机构的学生不送免费次数,只用机构的 / 进货和赠送分开记。锁住的规矩:
1. 平台给机构发过次数(池子 total > 0)的机构自动开通,不受「只开直营」限制;开关为「关闭」时照样全关
2. 老政策加盟机构的学生不送免费次数(total = 老师分的 + 学习卡带的);卡包政策机构照合同送 free_total;直营照旧
3. 赠送(gift)和进货(purchase)分开记,操作记录写清;扣回仍最多扣到已经分出去的
4. 各机构一览只给平台 admin
"""
import pytest
from sqlalchemy import select, text as sql_text

from app.models.audit import OperationLog
from app.models.tutor import TutorPoolLedger
from app.services import tutor as tt
from tests.test_tutor import _env, _h
from tests.test_tutor_pricing import _franchise_class


@pytest.mark.asyncio
async def test_gift_opens_legacy_org_and_no_free_times(client, db_session):
    users = await _env(db_session)        # 9981 是老政策加盟机构,开放范围默认 hq
    ft, fs2 = await _franchise_class(db_session, users)
    fs, a = users["fs"].id, users["a"].id
    st = lambda uid: client.get("/api/v1/student/tutor/status", headers=_h(uid))  # noqa: E731
    assert (await st(fs)).json()["enabled"] is False
    assert (await client.get("/api/v1/teacher/tutor/available", headers=_h(ft.id))).json()["enabled"] is False

    # 平台赠送 100 次: 机构自动开通,学生不送免费次数,要老师分
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a),
                          json={"times": 100, "source": "gift", "note": "试用"})
    assert r.status_code == 200 and r.json()["gifted"] == 100 and r.json()["purchased"] == 0
    assert r.json()["ledger"][0]["source"] == "gift"
    log = (await db_session.execute(select(OperationLog).where(OperationLog.action == "org.tutor_pool"))).scalar_one()
    assert "平台赠送 100 次" in log.summary and "¥" not in log.summary
    s = (await st(fs)).json()
    assert s["enabled"] is True and s["total"] == 0 and s["left"] == 0 and s["free_total"] == 0
    assert (await client.get("/api/v1/teacher/tutor/available", headers=_h(ft.id))).json()["enabled"] is True
    lst = (await client.get("/api/v1/teacher/tutor/students", headers=_h(ft.id))).json()
    assert lst["free_total"] == 0 and lst["pool"]["left"] == 100

    # 没分次数: 问不了
    r = await client.post("/api/v1/student/tutor/ask", data={"text": "apple"}, headers=_h(fs))
    assert r.status_code == 429
    # 老师分 5 次
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(ft.id), json={"student_ids": [fs], "add": 5})
    assert r.status_code == 200 and r.json()["pool"]["left"] == 95
    s = (await st(fs)).json()
    assert s["total"] == 5 and s["left"] == 5

    # 进货另记一笔,带金额
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a), json={"times": 1000})
    assert r.json()["purchased"] == 1000 and r.json()["gifted"] == 100
    logs = (await db_session.execute(select(OperationLog.summary).where(OperationLog.action == "org.tutor_pool")
                                     .order_by(OperationLog.id))).scalars().all()
    assert "进货到账 1000 次(¥300)" in logs[-1]
    src = (await db_session.execute(select(TutorPoolLedger.source).order_by(TutorPoolLedger.id))).scalars().all()
    assert src == ["gift", "purchase"]

    # 开关「关闭」: 发过次数的机构也关
    await client.put("/api/v1/admin/tutor", headers=_h(a), json={"scope": "off", "free_total": 20})
    assert (await st(fs)).json()["enabled"] is False


@pytest.mark.asyncio
async def test_free_times_by_org_kind(db_session):
    users = await _env(db_session)
    settings = await tt.get_settings(db_session)
    assert await tt.free_for(db_session, 1, settings) == 20            # 直营
    assert await tt.free_for(db_session, None, settings) == 20
    assert await tt.free_for(db_session, 9981, settings) == 0          # 老政策加盟机构
    await db_session.execute(sql_text("UPDATE organizations SET card_plan = 'pack' WHERE id = 9981"))
    await db_session.commit()
    assert await tt.free_for(db_session, 9981, settings) == 20         # 卡包政策: 合同写了送 20
    # 学生状态跟着走
    st = await tt.allowance_status(db_session, users["fs"].id, settings, 9981)
    assert st["total"] == 20


@pytest.mark.asyncio
async def test_clawback_all_closes_again(client, db_session):
    users = await _env(db_session)
    a = users["a"].id
    await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a), json={"times": 10, "source": "gift"})
    assert (await client.get("/api/v1/student/tutor/status", headers=_h(users["fs"].id))).json()["enabled"] is True
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a), json={"times": -10})
    assert r.status_code == 200 and r.json()["total"] == 0
    assert (await client.get("/api/v1/student/tutor/status", headers=_h(users["fs"].id))).json()["enabled"] is False


@pytest.mark.asyncio
async def test_admin_org_overview(client, db_session):
    users = await _env(db_session)
    ft, _ = await _franchise_class(db_session, users)
    a = users["a"].id
    assert (await client.get("/api/v1/admin/tutor/orgs", headers=_h(ft.id))).status_code == 403
    r = await client.get("/api/v1/admin/tutor/orgs", headers=_h(a))
    assert r.status_code == 200
    by = {o["id"]: o for o in r.json()["items"]}
    assert by[1]["open"] == "直营" and by[1]["pool"] is None and by[1]["free_per_student"] == 20
    assert by[9981]["open"] is None and by[9981]["pool"]["total"] == 0 and by[9981]["free_per_student"] == 0
    assert by[9981]["students"] == 2
    await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(a), json={"times": 50, "source": "gift"})
    by = {o["id"]: o for o in (await client.get("/api/v1/admin/tutor/orgs", headers=_h(a))).json()["items"]}
    assert by[9981]["open"] == "发过次数" and by[9981]["pool"]["gifted"] == 50
