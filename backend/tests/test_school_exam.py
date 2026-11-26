"""学校考试 · 丢分分析(services/school_exam): 拆卷和读卷子都用 httpx.MockTransport 假装,不真调。

锁住的规矩:
- 只能给自己的班建考试、录分、看孩子;孩子只能看 / 传自己班上的考试;别的机构看不到
- 老师录的分照片不覆盖;照片上写的分补上老师没录的
- 每道题: 老师的记号说了算;看不清 / 记号和题库答案对不上 / 老师没批且答案没核对 → 要老师确认,不直接记;照片里没找到的不记
- 一题只记一次: 重新拍一次不会把把握度记两遍;记下的题记进把握度(每日小卷接着补)
- 老师确认一道「要确认」的题: 记下并记进把握度
"""
import io
import json

import pytest
from PIL import Image
from sqlalchemy import select

from app.models.paper_bank import PaperItem, PaperKpMastery
from app.models.school_exam import SchoolExam, SchoolExamAnswer, SchoolExamSheet
from app.services import paper_kp as kpm
from app.services import school_exam as se
from tests.test_paper_bank import PAGE_ITEMS, _bank, _h, env, relay  # noqa: F401  (fixtures)


def _photo() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (900, 1200), "white").save(buf, "JPEG")
    return buf.getvalue()


def _read_reply(answers, sections=None, total=-1, readable=True, same=True, reason=""):
    inp = {"readable": readable, "is_same_exam": same, "reason": reason, "answers": answers,
           "sections": sections or [], "total": total, "total_full": 100}
    return {"model": "claude-sonnet-5-5", "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "id": "t1", "name": se.TOOL_NAME, "input": inp}],
            "usage": {"input_tokens": 12000, "output_tokens": 2500}}


def _a(no, given, mark, unsure=False, found=True, lost=-1):
    return {"no": no, "found": found, "given": given, "mark": mark, "lost": lost, "unsure": unsure}


READING = [
    _a("21", ["A"], "wrong"),                 # 错: plays 写成 play → 记下,错法 3sg.missing
    _a("22", ["B"], "right"),                 # 对
    _a("23", ["B"], "right"),                 # 老师打勾,但题库答案是 A → 要确认
    _a("24", ["C"], "right", unsure=True),    # 看不清 → 要确认
    _a("25", [], "none", found=False),        # 没拍到 → 不记
    _a("56", ["like"], "none"),               # 老师没批,答案核对过 → 按题库判错(落进 trap)
    _a("57", ["books"], "half"),              # 扣了分但写的和答案一样 → 要确认
    _a("58", ["are"], "right"),
]


@pytest.fixture
def sx(db_session, env, monkeypatch):  # noqa: F811
    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(se, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(se, "INLINE", True)
    return env


async def _exam(client, users, doc_id, **kw):
    body = {"class_id": users["class"].id, "name": "七上期中", "exam_date": "2026-11-20", "doc_id": doc_id,
            "sections": [{"name": "听力", "full": 20}, {"name": "单项选择", "full": 15},
                         {"name": "阅读理解", "full": 30}], **kw}
    r = await client.post("/api/v1/teacher/school-exams", headers=_h(users["t"].id), json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _sheet(client, uid, exam_id, student_id=None, n=1):
    files = [("files", (f"p{i}.jpg", _photo(), "image/jpeg")) for i in range(n)]
    url = (f"/api/v1/teacher/school-exams/{exam_id}/students/{student_id}/sheets" if student_id
           else f"/api/v1/student/school-exams/{exam_id}/sheets")
    return await client.post(url, headers=_h(uid), files=files)


async def test_create_scores_and_class_report(client, db_session, sx, relay):  # noqa: F811
    u = await sx()
    doc_id = await _bank(client, db_session, u, relay)
    eid = await _exam(client, u, doc_id)
    # 别人的班建不了、看不了
    r = await client.post("/api/v1/teacher/school-exams", headers=_h(u["ot"].id),
                          json={"class_id": u["class"].id, "name": "x"})
    assert r.status_code in (403, 404)
    assert (await client.get(f"/api/v1/teacher/school-exams/{eid}", headers=_h(u["ot"].id))).status_code in (403, 404)
    # 录分: 两个孩子;不在班上的孩子整批拒
    rows = [{"student_id": u["s"].id, "total": 80, "sections": {"听力": 18, "单项选择": 9}},
            {"student_id": u["s2"].id, "total": "90", "sections": {"听力": 16, "单项选择": 13}}]
    r = await client.put(f"/api/v1/teacher/school-exams/{eid}/scores", headers=_h(u["t"].id), json={"rows": rows})
    assert r.status_code == 200 and r.json()["changed"] == 2
    bad = await client.put(f"/api/v1/teacher/school-exams/{eid}/scores", headers=_h(u["t"].id),
                           json={"rows": [{"student_id": u["os"].id, "total": 1}]})
    assert bad.status_code == 403
    d = (await client.get(f"/api/v1/teacher/school-exams/{eid}", headers=_h(u["t"].id))).json()
    secs = {s["name"]: s for s in d["sections"]}
    assert secs["听力"]["avg"] == 17 and secs["单项选择"]["lost_avg"] == 4 and d["avg_total"] == 85
    me = next(p for p in d["students"] if p["id"] == u["s"].id)
    assert me["weakest"] == "单项选择"        # 15 分丢了 6 分,比听力丢得多(按比例)
    # 空着 = 清掉这一项
    await client.put(f"/api/v1/teacher/school-exams/{eid}/scores", headers=_h(u["t"].id),
                     json={"rows": [{"student_id": u["s"].id, "total": "", "sections": {"听力": None}}]})
    d = (await client.get(f"/api/v1/teacher/school-exams/{eid}", headers=_h(u["t"].id))).json()
    me = next(p for p in d["students"] if p["id"] == u["s"].id)
    assert me["total"] is None and me["sections"]["听力"] is None and me["sections"]["单项选择"] == 9


async def test_photo_reading_records_once_and_confirms(client, db_session, sx, relay):  # noqa: F811
    u = await sx()
    doc_id = await _bank(client, db_session, u, relay)
    eid = await _exam(client, u, doc_id)
    # 老师先录了总分 80: 照片上读出来的 72 不覆盖它;单项选择老师没录,照片上的补上
    await client.put(f"/api/v1/teacher/school-exams/{eid}/scores", headers=_h(u["t"].id),
                     json={"rows": [{"student_id": u["s"].id, "total": 80, "sections": {}}]})
    fake = relay([(200, _read_reply(READING, sections=[{"name": "二、单项选择", "score": 8, "full": 15}], total=72))])
    r = await _sheet(client, u["s"].id, eid, n=2)
    assert r.status_code == 200, r.text
    body = fake.requests[0]
    assert body["tools"][0]["name"] == se.TOOL_NAME and body["tools"][0]["strict"] is True
    assert sum(1 for b in body["messages"][0]["content"] if b["type"] == "image") == 2
    assert "21 | 单项选择" in body["messages"][0]["content"][0]["text"]
    items = {i.no: i for i in (await db_session.execute(select(PaperItem).where(PaperItem.doc_id == doc_id))).scalars()}
    ans = {a.item_id: a for a in (await db_session.execute(select(SchoolExamAnswer).where(
        SchoolExamAnswer.exam_id == eid))).scalars()}
    got = {no for no, it in items.items() if it.id in ans}
    assert got == {"21", "22", "56", "58"}
    assert ans[items["21"].id].correct is False and ans[items["21"].id].code == "3sg.missing"
    assert ans[items["56"].id].correct is False and ans[items["56"].id].code == "3sg.missing"
    assert ans[items["22"].id].correct is True
    m = (await db_session.execute(select(PaperKpMastery).where(PaperKpMastery.user_id == u["s"].id,
                                                               PaperKpMastery.kp == "pres_3sg"))).scalar_one()
    assert m.n == 2 and m.right == 0 and m.codes.get("3sg.missing") == 2
    # 报告
    rep = (await client.get(f"/api/v1/teacher/school-exams/{eid}/students/{u['s'].id}", headers=_h(u["t"].id))).json()
    assert rep["score"]["total"] == 80 and rep["score"]["total_source"] == "teacher"
    sec = {s["name"]: s for s in rep["score"]["sections"]}
    assert sec["单项选择"]["score"] == 8 and sec["单项选择"]["source"] == "photo"
    assert rep["sheet"]["confirm"] == 3 and rep["sheet"]["missing"] == 1
    assert rep["kps"][0]["kp"] == "pres_3sg" and rep["kps"][0]["wrong"] == 2
    assert {w["no"] for w in rep["wrong_items"]} == {"21", "56"}
    states = {x["no"]: x["state"] for x in rep["sheet_items"]}
    assert states["23"] == states["24"] == states["57"] == "confirm" and states["25"] == "missing"
    # 照片不存: 表里只有读出来的字
    sheet = (await db_session.execute(select(SchoolExamSheet).where(SchoolExamSheet.exam_id == eid))).scalar_one()
    assert "data" not in json.dumps(sheet.items) and sheet.input_tokens == 12000
    # 老师确认 23 是错的: 记下、记进把握度
    r = await client.put(f"/api/v1/teacher/school-exams/{eid}/students/{u['s'].id}/items/{items['23'].id}",
                         headers=_h(u["t"].id), json={"correct": False})
    assert r.status_code == 200
    pb_ = (await db_session.execute(select(PaperKpMastery).where(PaperKpMastery.user_id == u["s"].id,
                                                                 PaperKpMastery.kp == "pres_base"))).scalar_one()
    assert pb_.n == 1 and pb_.right == 0
    # 再拍一次(读出来一样): 已经记下的不再记,把握度不变
    relay([(200, _read_reply(READING))])
    assert (await _sheet(client, u["s"].id, eid)).status_code == 200
    await db_session.refresh(m)
    assert m.n == 2
    # 一次考试最多传 MAX_SHEETS 次
    relay([(200, _read_reply(READING))])
    assert (await _sheet(client, u["s"].id, eid)).status_code == 200
    r = await _sheet(client, u["s"].id, eid)
    assert r.status_code == 409 and str(se.MAX_SHEETS) in r.json()["detail"]
    # 孩子看自己的报告: 没有逐题读出来的那张表(那是老师确认用的)
    mine = (await client.get(f"/api/v1/student/school-exams/{eid}", headers=_h(u["s"].id))).json()
    assert "sheet_items" not in mine and mine["wrong"] == 3


async def test_student_access_and_bad_photos(client, db_session, sx, relay):  # noqa: F811
    u = await sx()
    doc_id = await _bank(client, db_session, u, relay)
    eid = await _exam(client, u, doc_id)
    lst = (await client.get("/api/v1/student/school-exams", headers=_h(u["s"].id))).json()
    assert [x["id"] for x in lst["items"]] == [eid] and lst["items"][0]["can_upload"] is True
    # 别的机构的孩子看不到也传不了
    assert (await client.get(f"/api/v1/student/school-exams/{eid}", headers=_h(u["os"].id))).status_code in (403, 404)
    assert (await _sheet(client, u["os"].id, eid)).status_code in (403, 404)
    # 看不清: 标失败、把原因告诉孩子,不算进 MAX_SHEETS
    relay([(200, _read_reply([], readable=False, reason="照片太暗,开灯再拍"))])
    assert (await _sheet(client, u["s"].id, eid)).status_code == 200
    mine = (await client.get(f"/api/v1/student/school-exams/{eid}", headers=_h(u["s"].id))).json()
    assert mine["sheet"]["status"] == "failed" and "太暗" in mine["sheet"]["reason"]
    # 不是这次考试的卷子
    relay([(200, _read_reply([], same=False))])
    await _sheet(client, u["s"].id, eid)
    mine = (await client.get(f"/api/v1/student/school-exams/{eid}", headers=_h(u["s"].id))).json()
    assert mine["sheet"]["status"] == "failed" and "不是这次考试" in mine["sheet"]["reason"]
    # 不是照片
    r = await client.post(f"/api/v1/student/school-exams/{eid}/sheets", headers=_h(u["s"].id),
                          files=[("files", ("a.jpg", b"not an image", "image/jpeg"))])
    assert r.status_code == 400
    # 老师说由老师传: 孩子传不了
    await client.patch(f"/api/v1/teacher/school-exams/{eid}", headers=_h(u["t"].id), json={"open_upload": False})
    assert (await _sheet(client, u["s"].id, eid)).status_code == 409
    # 没挂卷子的考试: 只能录分,拍了也不读
    e2 = await _exam(client, u, None, name="月考")
    r = await _sheet(client, u["t"].id, e2, student_id=u["s"].id)
    assert r.status_code == 409 and "试卷库" in r.json()["detail"]


def test_judge_rules():
    it = PaperItem(kind="mc", stem="He ___ it.", options=["do", "does"], answer="B", kps=["pres_3sg"],
                   wrong={"A": {"code": "3sg.missing", "why": "w"}}, status="approved", answer_source="ai")
    assert se.judge(it, ["A"], "wrong", False)["state"] == "recorded"
    assert se.judge(it, ["A"], "right", False)["state"] == "confirm"      # 勾了但和答案对不上
    assert se.judge(it, ["B"], "wrong", False)["state"] == "confirm"      # 叉了但和答案一样
    j = se.judge(it, [], "none", False)
    assert j["final"] is False and j["state"] == "recorded"               # 没写 = 错
    it.status = "pending"                                                  # 答案是 AI 做的、没核对
    assert se.judge(it, ["B"], "none", False)["state"] == "confirm"
    assert se.judge(it, ["B"], "right", False)["state"] == "recorded"     # 老师批了就以老师为准
    assert se.match_section("二、单项选择(每小题 1 分)", [{"name": "单项选择", "full": 15}]) == "单项选择"
    assert se.clean_sections([{"name": " 听 力 ", "full": 20}, {"name": "听力", "full": 5}, {"name": ""}]) == \
        [{"name": "听 力", "full": 20}]
    assert kpm.OTHER == "other"


async def test_exam_items_follow_paper_title(db_session, sx, client, relay):  # noqa: F811
    u = await sx()
    items = [dict(x) for x in PAGE_ITEMS]
    items[5] = {**items[5], "paper_title": "Unit 2 综合能力测评卷"}       # 56 起是另一套卷
    doc_id = await _bank(client, db_session, u, relay, items=items)
    eid = await _exam(client, u, doc_id, paper_title="Unit 1 综合能力测评卷")
    e = await db_session.get(SchoolExam, eid)
    assert {i.no for i in await se.exam_items(db_session, e)} == {"21", "22", "23", "24", "25"}
