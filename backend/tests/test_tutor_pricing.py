"""学习助手收费规则(2026-10-26,用户「免费 20 次后需要付费」→「按你建议写进合同,要让家长觉得值、
便宜,也要确实能帮到孩子;不给答案孩子一直答不上来怎么办」)。规则真源 services/tutor.py 文件头「收费」。

锁住的规矩(合同第三条第 10 款写的就是这些):
1. 同一道题的追问不另算: 付过次数的那问之后 15 分钟内、快速回答、没有新照片,最多 3 次不扣;
   第 4 次、新对话、深度思考、过了 15 分钟都照常扣;没调通退回的那问不能当「付过」的起点
2. 加盟机构的老师给学生加次数要从机构次数池里扣: 池里不够整批 409 一个都不加;
   两位老师同时加不会扣成负数;直营不走池子;平台扣回最多扣到已经分出去的数
3. 学习卡(入门卡除外)兑换时带 50 次,同一张卡只送一次
4. 开放范围 pack = 直营 + 卡包机构(老政策加盟机构不开)
5. 提示词里写着三步: 先提示、再提示、试过两次还不会就讲答案和理由并出一道同类题
"""
from datetime import timedelta

import pytest
from sqlalchemy import select, text as sql_text, update

from app.models.audit import OperationLog
from app.models.tutor import TutorAllowance, TutorGrantLog, TutorMessage, TutorOrgPool
from app.models.user import Class, ClassStudent, User
from app.services import tutor as tt
from tests.test_tutor import _ask, _env, _h, _text_reply, relay, shared_session  # noqa: F401


async def _used(db, uid) -> int:
    row = await db.get(TutorAllowance, uid)
    await db.refresh(row)
    return row.used


# ---------------------------------------------------------------- 1. 追问不另算

@pytest.mark.asyncio
async def test_followups_on_same_question_are_free_up_to_three(client, db_session, relay, shared_session):
    users = await _env(db_session)
    uid = users["s"].id
    relay([(200, _text_reply(f"回答{i}")) for i in range(7)])
    r, ev = await _ask(client, uid, "这题选什么")
    cid = ev[0]["conversation_id"]
    assert ev[0]["cost"] == 1 and await _used(db_session, uid) == 1
    assert ev[-1]["followup"]["left"] == 3
    for i in range(3):
        r, ev = await _ask(client, uid, f"我选 B 对吗 {i}", conversation_id=cid)
        assert r.status_code == 200 and ev[0]["cost"] == 0
    assert await _used(db_session, uid) == 1
    assert ev[-1]["followup"] is None
    # 第 4 次追问照常扣,并且成了新的起点
    r, ev = await _ask(client, uid, "那下一题呢", conversation_id=cid)
    assert ev[0]["cost"] == 1 and await _used(db_session, uid) == 2
    # 新对话照常扣
    r, ev = await _ask(client, uid, "另一道题")
    assert ev[0]["cost"] == 1 and await _used(db_session, uid) == 3
    # 对话详情带追问状态(刷新页面后前端还知道下一问不另算)
    detail = (await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(uid))).json()
    assert detail["followup"]["left"] == 3
    costs = (await db_session.execute(
        select(TutorMessage.cost).where(TutorMessage.conversation_id == cid, TutorMessage.role == "user")
        .order_by(TutorMessage.id))).scalars().all()
    assert costs == [1, 0, 0, 0, 1]


@pytest.mark.asyncio
async def test_followup_window_and_deep_and_refunded_anchor(client, db_session, relay, shared_session):
    users = await _env(db_session)
    uid = users["s"].id
    relay([(200, _text_reply("一")), (200, _text_reply("二"))]
          + [(503, {"error": {"message": "No available accounts"}})] * 3   # 主模型 → 备用 → 备用再试一次
          + [(200, _text_reply("三"))])
    _, ev = await _ask(client, uid, "题目")
    cid = ev[0]["conversation_id"]
    # 过了 15 分钟就不算同一道题了
    await db_session.execute(update(TutorMessage).where(TutorMessage.conversation_id == cid)
                             .values(created_at=tt.utc_now() - timedelta(minutes=tt.FOLLOWUP_MINUTES + 1)))
    await db_session.commit()
    r, ev = await _ask(client, uid, "接着问", conversation_id=cid)
    assert ev[0]["cost"] == 1 and await _used(db_session, uid) == 2

    # 没调通退回的那问不能当起点: 新对话第一问失败 → 第二问照常扣
    _, ev = await _ask(client, uid, "新题")
    assert ev[-1]["type"] == "error" and await _used(db_session, uid) == 2
    cid2 = ev[0]["conversation_id"]
    um = await db_session.get(TutorMessage, ev[0]["user_message_id"])
    await db_session.refresh(um)
    assert um.cost == tt.COST_REFUNDED
    r, ev = await _ask(client, uid, "再问一次", conversation_id=cid2)
    assert ev[0]["cost"] == 1 and await _used(db_session, uid) == 3

    # 深度思考的追问照常扣(它一次就要几毛钱)
    assert await tt.followup_state(db_session, cid2) is not None
    relay([(200, _text_reply("深"))])
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(uid),
                          data={"text": "讲透一点", "conversation_id": str(cid2), "mode": "deep"})
    assert r.status_code == 200 and '"cost": 2' in r.text
    assert await _used(db_session, uid) == 5


# ---------------------------------------------------------------- 2. 机构次数池

async def _franchise_class(db, users):
    ft = User(username="tutft", email="tutft@e.com", hashed_password="x", role="teacher",
              is_active=True, org_id=9981, full_name="加盟老师")
    fs2 = User(username="tutfs2", email="tutfs2@e.com", hashed_password="x", role="student",
               is_active=True, org_id=9981)
    db.add_all([ft, fs2])
    await db.flush()
    c = Class(name="加盟一班", teacher_id=ft.id, org_id=9981)
    db.add(c)
    await db.flush()
    db.add_all([ClassStudent(class_id=c.id, student_id=users["fs"].id, is_active=True),
                ClassStudent(class_id=c.id, student_id=fs2.id, is_active=True)])
    await db.commit()
    return ft, fs2


@pytest.mark.asyncio
async def test_franchise_teacher_grant_takes_from_org_pool(client, db_session):
    users = await _env(db_session)
    await db_session.execute(sql_text("UPDATE organizations SET card_plan = 'pack' WHERE id = 9981"))
    await db_session.commit()
    ft, fs2 = await _franchise_class(db_session, users)
    fs = users["fs"].id

    # 池里没有次数: 加不了,一个都不加
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(ft.id), json={"student_ids": [fs], "add": 5})
    assert r.status_code == 409 and "购买次数" in r.json()["detail"]
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(fs))).json()
    assert st["extra"] == 0

    # 平台到账 8 次(只有平台 admin 能加)
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(ft.id), json={"times": 8})
    assert r.status_code == 403
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(users["a"].id),
                          json={"times": 8, "note": "转账 1"})
    assert r.status_code == 200 and r.json()["left"] == 8
    log = (await db_session.execute(select(OperationLog).where(OperationLog.action == "org.tutor_pool"))).scalar_one()
    assert "到账 8 次" in log.summary

    # 两个人各 5 次要 10 次 > 8: 整批拒,池子不动
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(ft.id),
                          json={"student_ids": [fs, fs2.id], "add": 5})
    assert r.status_code == 409 and "还剩 8 次" in r.json()["detail"]
    pool = await db_session.get(TutorOrgPool, 9981)
    await db_session.refresh(pool)
    assert pool.used == 0
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(ft.id), json={"student_ids": [fs], "add": 5})
    assert r.status_code == 200 and r.json()["pool"]["left"] == 3
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(fs))).json()
    assert st["extra"] == 5 and st["total"] == 25
    lst = (await client.get("/api/v1/teacher/tutor/students", headers=_h(ft.id))).json()
    assert lst["pool"]["left"] == 3

    # 扣回: 已经分出去 5 次,最多扣回 3 次
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(users["a"].id), json={"times": -4})
    assert r.status_code == 409
    r = await client.post("/api/v1/admin/tutor/pools/9981", headers=_h(users["a"].id), json={"times": -3})
    assert r.status_code == 200 and r.json()["left"] == 0 and len(r.json()["ledger"]) == 2

    # 直营老师不走池子;直营也没有池子可加
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(users["t"].id),
                          json={"student_ids": [users["s"].id], "add": 50})
    assert r.status_code == 200 and r.json()["pool"] is None
    assert (await client.get("/api/v1/teacher/tutor/students", headers=_h(users["t"].id))).json()["pool"] is None
    r = await client.post("/api/v1/admin/tutor/pools/1", headers=_h(users["a"].id), json={"times": 10})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_pool_take_never_goes_negative(db_session):
    """两位老师同时加: 条件 UPDATE 保证池子扣不过头"""
    await _env(db_session)
    assert await tt.credit_pool(db_session, 9981, 10, None, 1)
    results = [await tt.take_from_pool(db_session, 9981, 4) for _ in range(4)]
    assert results == [True, True, False, False]
    assert (await tt.pool_status(db_session, 9981))["left"] == 2


@pytest.mark.asyncio
async def test_grant_cap_only_charges_what_was_added(client, db_session):
    """快到上限的孩子只加得进差的那几次,池子也只扣那几次"""
    users = await _env(db_session)
    await db_session.execute(sql_text("UPDATE organizations SET card_plan = 'pack' WHERE id = 9981"))
    await db_session.commit()
    ft, _ = await _franchise_class(db_session, users)
    fs = users["fs"].id
    await tt.credit_pool(db_session, 9981, 100, None, users["a"].id)
    db_session.add(TutorAllowance(user_id=fs, used=0, extra=tt.MAX_EXTRA - 3))
    await db_session.commit()
    r = await client.post("/api/v1/teacher/tutor/grant", headers=_h(ft.id), json={"student_ids": [fs], "add": 10})
    assert r.status_code == 200 and r.json()["added"] == 3 and r.json()["capped"] == 1
    assert r.json()["pool"]["used"] == 3


# ---------------------------------------------------------------- 3. 学习卡带次数

@pytest.mark.asyncio
async def test_card_bonus_given_once_per_code(db_session):
    users = await _env(db_session)
    uid = users["s"].id
    assert await tt.add_card_bonus(db_session, uid, code_id=777)
    assert not await tt.add_card_bonus(db_session, uid, code_id=777)     # 同一张卡不送第二次
    assert await tt.add_card_bonus(db_session, uid, code_id=778)
    await db_session.commit()
    st = await tt.allowance_status(db_session, uid, await tt.get_settings(db_session))
    assert st["extra"] == 2 * tt.CARD_TUTOR_TIMES and await tt.card_times(db_session, uid) == 100
    n = (await db_session.execute(select(TutorGrantLog).where(TutorGrantLog.user_id == uid))).scalars().all()
    assert len(n) == 2


# ---------------------------------------------------------------- 4. 开放范围 pack

@pytest.mark.asyncio
async def test_scope_pack_opens_hq_and_pack_orgs_only(client, db_session):
    users = await _env(db_session)
    r = await client.put("/api/v1/admin/tutor", headers=_h(users["a"].id), json={"scope": "pack", "free_total": 20})
    assert r.status_code == 200
    st = lambda uid: client.get("/api/v1/student/tutor/status", headers=_h(uid))  # noqa: E731
    assert (await st(users["s"].id)).json()["enabled"] is True
    assert (await st(users["fs"].id)).json()["enabled"] is False        # 老政策加盟机构
    await db_session.execute(sql_text("UPDATE organizations SET card_plan = 'pack' WHERE id = 9981"))
    await db_session.commit()
    assert (await st(users["fs"].id)).json()["enabled"] is True


# ---------------------------------------------------------------- 5. 三步提示

def test_rules_say_explain_after_two_tries():
    """孩子一直答不上来: 规则里必须写着「试过两次还不会就讲答案 + 出同类题」,不能只写「不给答案」"""
    assert "试过两次" in tt.RULES and "同类的题" in tt.RULES and "还是不会" in tt.RULES
    assert "试过两次还不会" in tt.DEEP_NOTE
