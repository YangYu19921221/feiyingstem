"""孩子说到难过、被欺负、想伤害自己(services/tutor_safety,2026-10-27)

锁住的规矩:
1. 规则里有例外: 先接住感受、建议告诉信任的大人、给 12355 / 110、不答应保密,并调 flag_concern
2. 孩子自己写的字命中关键词 → 记提醒(和提问同一事务),这一问不扣次数,系统提示尾部加提醒;问翻译的不按关键词记
3. 模型调 flag_concern → 记提醒(和关键词命中同一条提问就合并,取更严重的),这一问退回次数
4. 次数用完了也能说(不扣次数);一天最多 CARE_DAILY 次免费
5. 本班老师看得到、别班 403;机构管理员只看本机构;处理时记谁处理的 + 操作记录
6. 孩子删了对话、对话到期清理,提醒还在
"""
import pytest
from sqlalchemy import select, text as sql_text

from app.models.tutor import TutorAlert, TutorAllowance, TutorMessage
from app.models.user import User
from app.services import tutor as tt
from app.services import tutor_safety as ts
from tests.test_tutor import _ask, _env, _h, _text_reply, _tool_call, relay, shared_session  # noqa: F401


def test_rules_and_tool():
    r = tt.RULES
    assert "例外" in r and "12355" in r and "110" in r and "flag_concern" in r and "不答应替他保密" in r
    assert any(t["name"] == "flag_concern" for t in tt.TOOLS)


@pytest.mark.parametrize("text,level", [
    ("我不想活了", "urgent"), ("我好想死", "urgent"), ("活着没意思", "urgent"), ("我想割腕", "urgent"),
    ("我被同学欺负了", "concern"), ("他们天天打我", "concern"), ("没人跟我玩", "concern"),
])
def test_detect_hits(text, level):
    assert ts.detect(text)[0] == level


@pytest.mark.parametrize("text", [
    "自杀用英语怎么说", "bully 是什么意思", "累死了今天作业好多", "die 的过去式", "apple 怎么记", "",
    "被欺负用英语怎么说", "被打了英文怎么写",          # 有关键词但在问翻译: 交给模型判断
])
def test_detect_ignores(text):
    assert ts.detect(text) is None


async def _alerts(db, uid):
    return (await db.execute(select(TutorAlert).where(TutorAlert.user_id == uid))).scalars().all()


@pytest.mark.asyncio
async def test_keyword_records_alert_and_is_free(client, db_session, relay, shared_session):
    users = await _env(db_session)
    fake = relay([(200, _text_reply("听起来你很难受,愿意说出来很勇敢。今天就告诉老师好吗?"))])
    r, events = await _ask(client, users["s"].id, "我被同学欺负了,不想上学")
    assert r.status_code == 200 and events[-1]["type"] == "done"
    assert events[0]["cost"] == 0
    a = await _alerts(db_session, users["s"].id)
    assert len(a) == 1 and a[0].level == "concern" and a[0].source == "keyword" and "欺负" in a[0].excerpt
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user"))).scalars().one()
    assert um.cost == tt.COST_CARE and a[0].message_id == um.id
    assert tt.CARE_NOTE in fake.requests[0]["system"][1]["text"]
    row = await db_session.get(TutorAllowance, users["s"].id)
    assert row is None or row.used == 0


@pytest.mark.asyncio
async def test_can_speak_when_out_of_uses(client, db_session, relay, shared_session):
    users = await _env(db_session)
    await db_session.execute(sql_text("INSERT INTO tutor_allowances (user_id, used, extra) VALUES (:u, 999, 0)"),
                             {"u": users["s"].id})
    await db_session.commit()
    relay([(200, _text_reply("我在听。"))])
    r, _ = await _ask(client, users["s"].id, "我不想活了")
    assert r.status_code == 200
    r2, _ = await _ask(client, users["s"].id, "apple 怎么记")
    assert r2.status_code == 429


@pytest.mark.asyncio
async def test_model_flag_records_and_refunds(client, db_session, relay, shared_session):
    users = await _env(db_session)
    relay([(200, _tool_call("flag_concern", {"level": "urgent", "reason": "说每天都不想醒来"})),
           (200, _text_reply("这件事很重要,请马上告诉老师或家长。"))])
    r, events = await _ask(client, users["s"].id, "每天早上都希望别醒过来")
    assert r.status_code == 200 and events[-1]["type"] == "done" and events[0]["cost"] == 1
    a = await _alerts(db_session, users["s"].id)
    assert len(a) == 1 and a[0].level == "urgent" and a[0].source == "model" and a[0].reason
    await db_session.refresh(await db_session.get(TutorAllowance, users["s"].id))
    assert (await db_session.get(TutorAllowance, users["s"].id)).used == 0


@pytest.mark.asyncio
async def test_keyword_and_model_merge(client, db_session, relay, shared_session):
    users = await _env(db_session)
    relay([(200, _tool_call("flag_concern", {"level": "urgent", "reason": "说每天早上都希望别醒"})),
           (200, _text_reply("我会让你的老师知道。"))])
    # 关键词只看出「被欺负」(concern),模型看出更严重的 → 合并成 urgent
    assert ts.detect("我被他们欺负了,每天早上都希望别醒")[0] == "concern"
    await _ask(client, users["s"].id, "我被他们欺负了,每天早上都希望别醒")
    a = await _alerts(db_session, users["s"].id)
    assert len(a) == 1 and a[0].level == "urgent" and set(a[0].source.split(",")) == {"keyword", "model"}


@pytest.mark.asyncio
async def test_daily_cap(client, db_session, relay, shared_session, monkeypatch):
    monkeypatch.setattr(ts, "CARE_DAILY", 1)
    users = await _env(db_session)
    relay([(200, _text_reply("我在听。")), (200, _text_reply("我在听。"))])
    _, e1 = await _ask(client, users["s"].id, "我被欺负了")
    _, e2 = await _ask(client, users["s"].id, "我又被欺负了")
    assert e1[0]["cost"] == 0 and e2[0]["cost"] == 1
    assert len(await _alerts(db_session, users["s"].id)) == 2      # 提醒照记


@pytest.mark.asyncio
async def test_teacher_and_org_admin_scope(client, db_session, relay, shared_session):
    users = await _env(db_session)
    await tt.save_settings(db_session, "all", 20, 2)      # 加盟机构的孩子也能问
    await db_session.commit()
    relay([(200, _text_reply("我在听。")), (200, _text_reply("我在听。"))])
    await _ask(client, users["s"].id, "我不想活了")
    await _ask(client, users["fs"].id, "我被同学打了")
    r = await client.get("/api/v1/teacher/tutor/alerts", headers=_h(users["t"].id))
    assert r.status_code == 200 and [x["student_id"] for x in r.json()["items"]] == [users["s"].id]
    assert r.json()["counts"] == {"open": 1, "urgent": 1}
    av = await client.get("/api/v1/teacher/tutor/available", headers=_h(users["t"].id))
    assert av.json()["alerts"]["urgent"] == 1
    other = await client.get("/api/v1/teacher/tutor/alerts", headers=_h(users["ot"].id))
    assert other.json()["items"] == []
    aid = r.json()["items"][0]["id"]
    assert (await client.post(f"/api/v1/teacher/tutor/alerts/{aid}/handle", json={"note": "x"},
                              headers=_h(users["ot"].id))).status_code == 403
    # 机构管理员只看本机构
    oa = User(username="tutoa", email="tutoa@e.com", hashed_password="x", role="org_admin", is_active=True, org_id=9981)
    db_session.add(oa)
    await db_session.commit()
    r2 = await client.get("/api/v1/admin/tutor/alerts", headers=_h(oa.id))
    assert r2.status_code == 200 and [x["student_id"] for x in r2.json()["items"]] == [users["fs"].id]
    assert (await client.post(f"/api/v1/admin/tutor/alerts/{aid}/handle", json={}, headers=_h(oa.id))).status_code == 404
    ra = await client.get("/api/v1/admin/tutor/alerts", headers=_h(users["a"].id))
    assert len(ra.json()["items"]) == 2
    # 本班老师处理: 记谁处理的 + 操作记录
    h = await client.post(f"/api/v1/teacher/tutor/alerts/{aid}/handle", json={"note": "已经和家长通了电话"},
                          headers=_h(users["t"].id))
    assert h.status_code == 200 and h.json()["handled_by_name"] and h.json()["handled_note"] == "已经和家长通了电话"
    from app.models.audit import OperationLog
    assert (await db_session.execute(select(OperationLog).where(OperationLog.action == "tutor.alert_handle"))).scalars().first()
    r3 = await client.get("/api/v1/teacher/tutor/alerts", headers=_h(users["t"].id))
    assert r3.json()["counts"]["open"] == 0


@pytest.mark.asyncio
async def test_alert_survives_purge(client, db_session, relay, shared_session):
    from datetime import timedelta
    from app.core.timeutil import utc_now
    from app.services import tutor_history
    users = await _env(db_session)
    relay([(200, _text_reply("我在听。"))])
    await _ask(client, users["s"].id, "我不想活了")
    await tutor_history.purge_expired(db_session, now=utc_now() + timedelta(days=400))
    assert (await db_session.execute(select(TutorMessage))).scalars().first() is None
    assert len(await _alerts(db_session, users["s"].id)) == 1


@pytest.mark.asyncio
async def test_care_button_when_out_of_uses(client, db_session, relay, shared_session, monkeypatch):
    """次数用完的孩子点「想说说心里话」: 不扣次数、提示词让它不讲题;一天 CARE_BUTTON_DAILY 次;老师看记录带提醒"""
    monkeypatch.setattr(ts, "CARE_BUTTON_DAILY", 1)
    users = await _env(db_session)
    await db_session.execute(sql_text("INSERT INTO tutor_allowances (user_id, used, extra) VALUES (:u, 999, 0)"),
                             {"u": users["s"].id})
    await db_session.commit()
    fake = relay([(200, _text_reply("我在听,慢慢说。"))])
    r = await client.post("/api/v1/student/tutor/ask", data={"text": "活着好累", "care": "1"}, headers=_h(users["s"].id))
    assert r.status_code == 200 and tt.CARE_BUTTON_NOTE in fake.requests[0]["system"][1]["text"]
    r2 = await client.post("/api/v1/student/tutor/ask", data={"text": "活着好累", "care": "1"}, headers=_h(users["s"].id))
    assert r2.status_code == 429
    log = await client.get(f"/api/v1/teacher/students/{users['s'].id}/tutor", headers=_h(users["t"].id))
    assert "alerts" in log.json()
