"""音标听力 —— 不泄题 + 跨机构不越权 + 两部分都对才算对 + 作业完成口径

规则真源 services/phonetic_listening.py 文件头。
"""
import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.organization import Organization
from app.models.phonetic_listening import ListeningAttempt
from app.models.phonetic_practice import PhoneticBook
from app.models.user import User
from tests.conftest import _make_token

BASE_T = "/api/v1/teacher/phonetic-books/listening"
BASE_S = "/api/v1/phonetic-practice/listening"

ITEMS = [
    {"word": "block", "phonetic": "[blɒk]", "meaning": "街区", "hint": "3—4 尾2"},
    {"word": "hoe", "phonetic": "[həʊ]", "meaning": "锄头", "hint": "3—4 元+a"},
    {"word": "rifle", "phonetic": "[ˈraɪfl]", "meaning": "步枪", "hint": "4—5 尾+e"},
]


@pytest.fixture
async def orgs(db_session):
    tenancy._org_cache.clear()
    o1 = Organization(name="机构甲", code="LSA01", status="active")
    o2 = Organization(name="机构乙", code="LSB01", status="active")
    db_session.add_all([o1, o2])
    await db_session.flush()
    t1 = User(username="ls_t1", email="ls_t1@e.com", hashed_password="x", role="teacher",
              full_name="甲老师", is_active=True, org_id=o1.id)
    s1 = User(username="ls_s1", email="ls_s1@e.com", hashed_password="x", role="student",
              full_name="甲学生", is_active=True, org_id=o1.id)
    s2 = User(username="ls_s2", email="ls_s2@e.com", hashed_password="x", role="student",
              full_name="乙学生", is_active=True, org_id=o2.id)
    t2 = User(username="ls_t2", email="ls_t2@e.com", hashed_password="x", role="teacher",
              full_name="乙老师", is_active=True, org_id=o2.id)
    db_session.add_all([t1, s1, s2, t2])
    await db_session.flush()
    b1 = PhoneticBook(name="甲机构音标书", org_id=o1.id)
    preset = PhoneticBook(name="平台预置音标书", org_id=None)
    db_session.add_all([b1, preset])
    await db_session.commit()
    return {"t1": _make_token(t1.id), "s1": _make_token(s1.id), "s2": _make_token(s2.id),
            "t2": _make_token(t2.id), "b1": b1.id, "preset": preset.id,
            "t1_id": t1.id, "s1_id": s1.id}


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


async def _make_set(client, d):
    r = await client.post(f"{BASE_T}/books/{d['b1']}/sets", headers=H(d["t1"]),
                          json={"title": "听-2", "items": ITEMS})
    assert r.status_code == 200, r.text
    return r.json()


async def test_student_list_does_not_leak_answers(client: AsyncClient, orgs):
    """题目列表不给单词、音标、释义 —— 听力就是听出来写;只给提示和格子数"""
    d = orgs
    s = await _make_set(client, d)
    r = await client.get(f"{BASE_S}/sets/{s['id']}", headers=H(d["s1"]))
    assert r.status_code == 200
    body = r.json()
    assert [i["hint"] for i in body["items"]] == ["3—4 尾2", "3—4 元+a", "4—5 尾+e"]
    assert [i["slot_count"] for i in body["items"]] == [4, 2, 5]
    assert body["items"][2]["stress_at"] == [0]
    for leaked in ("block", "hoe", "rifle", "blɒk", "街区", "锄头"):
        assert leaked not in r.text, f"题目列表泄露了 {leaked}"
    # 系统读音按题目 id 取,网址里没有单词
    assert all(set(i) == {"id", "hint", "slot_count", "stress_at", "has_audio"} for i in body["items"])


async def test_other_org_cannot_see_or_answer(client: AsyncClient, orgs):
    d = orgs
    s = await _make_set(client, d)
    item_id = s["items"][0]["id"]
    assert (await client.get(f"{BASE_S}/sets/{s['id']}", headers=H(d["s2"]))).status_code == 404
    r = await client.post(f"{BASE_S}/check", headers=H(d["s2"]),
                          json={"item_id": item_id, "word": "block", "phonetic": ["b", "l", "ɒ", "k"]})
    assert r.status_code == 404
    assert (await client.get(f"{BASE_S}/items/{item_id}/tts", headers=H(d["s2"]))).status_code == 404
    # 别家老师也看不到、改不了
    assert (await client.get(f"{BASE_T}/sets/{s['id']}", headers=H(d["t2"]))).status_code == 404
    lst = (await client.get(f"{BASE_S}/sets", headers=H(d["s2"]))).json()
    assert all(x["id"] != d["b1"] for x in lst)


async def test_both_parts_must_be_right_and_answer_only_when_finished(client: AsyncClient, orgs):
    """单词对音标错 = 这题没对;第一遍错不给答案;第二遍判完才给"""
    d = orgs
    s = await _make_set(client, d)
    item_id = s["items"][0]["id"]
    r = await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                          json={"item_id": item_id, "pass_number": 1, "word": " Block ",
                                "phonetic": ["b", "l", "æ", "k"]})
    j = r.json()
    assert j["word_ok"] is True and j["phonetic_ok"] is False and j["all_correct"] is False
    assert j["finished"] is False and "answer" not in j
    assert j["prefill"] == ["b", "l", None, "k"]          # 第二遍只挖元音
    assert "ɒ" not in r.text
    r = await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                          json={"item_id": item_id, "pass_number": 2, "word": "block",
                                "phonetic": ["b", "l", "ɒ", "k"]})
    j = r.json()
    assert j["all_correct"] is True and j["finished"] is True
    assert j["answer"]["word"] == "block" and j["answer"]["phonetic_tokens"] == ["b", "l", "ɒ", "k"]


async def test_word_wrong_phonetic_right_is_wrong(client: AsyncClient, orgs):
    d = orgs
    s = await _make_set(client, d)
    item_id = s["items"][1]["id"]
    j = (await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                           json={"item_id": item_id, "word": "ho", "phonetic": ["h", "əʊ"]})).json()
    assert j["phonetic_ok"] is True and j["word_ok"] is False and j["all_correct"] is False


async def test_give_up_finishes_and_counts_wrong(client: AsyncClient, orgs, db_session):
    d = orgs
    s = await _make_set(client, d)
    item_id = s["items"][0]["id"]
    j = (await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                           json={"item_id": item_id, "give_up": True, "word": "block",
                                 "phonetic": ["b", "l", "ɒ", "k"]})).json()
    assert j["finished"] is True and j["all_correct"] is False and j["answer"]["word"] == "block"


async def test_invalid_phonetic_rejects_whole_set(client: AsyncClient, orgs):
    """有一题音标用了键盘上没有的符号(学生永远打不出来)→ 整套不落库"""
    d = orgs
    bad = ITEMS + [{"word": "cat", "phonetic": "[kat]", "hint": "x"}]   # a 不是音标符号
    r = await client.post(f"{BASE_T}/books/{d['b1']}/sets", headers=H(d["t1"]),
                          json={"title": "听-9", "items": bad})
    assert r.status_code == 400
    assert "第 4 题" in r.json()["detail"]["message"]
    sets = (await client.get(f"{BASE_T}/books/{d['b1']}/sets", headers=H(d["t1"]))).json()["sets"]
    assert sets == []


async def test_sets_under_preset_book_belong_to_creator_org(client: AsyncClient, orgs):
    """生产只有一本平台预置教材: 老师必须能往里加听力,建的归自己机构,别的机构看不到、也改不了"""
    d = orgs
    r = await client.post(f"{BASE_T}/books/{d['preset']}/sets", headers=H(d["t1"]),
                          json={"title": "听-1", "items": ITEMS})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    # 甲机构学生看得到,乙机构学生看不到
    mine = (await client.get(f"{BASE_S}/sets", headers=H(d["s1"]))).json()
    assert any(st["id"] == sid for g in mine for st in g["sets"])
    other = (await client.get(f"{BASE_S}/sets", headers=H(d["s2"]))).json()
    assert all(st["id"] != sid for g in other for st in g["sets"])
    assert (await client.get(f"{BASE_S}/sets/{sid}", headers=H(d["s2"]))).status_code == 404
    # 乙机构老师在同一本预置教材下看不到这套,也改不了、删不了
    lst = (await client.get(f"{BASE_T}/books/{d['preset']}/sets", headers=H(d["t2"]))).json()["sets"]
    assert lst == []
    assert (await client.put(f"{BASE_T}/sets/{sid}", headers=H(d["t2"]),
                             json={"title": "x", "items": ITEMS})).status_code == 404
    assert (await client.delete(f"{BASE_T}/sets/{sid}", headers=H(d["t2"]))).status_code == 404


async def test_update_keeps_item_ids(client: AsyncClient, orgs):
    """改一套按 id 原地改 —— 删了重建 id 会变,学生记录对不上"""
    d = orgs
    s = await _make_set(client, d)
    ids = [i["id"] for i in s["items"]]
    items = [dict(ITEMS[0], id=ids[0], hint="3—4 尾2 改"), dict(ITEMS[2], id=ids[2])]
    r = await client.put(f"{BASE_T}/sets/{s['id']}", headers=H(d["t1"]),
                         json={"title": "听-2", "items": items})
    assert r.status_code == 200
    got = r.json()["items"]
    assert [i["id"] for i in got] == [ids[0], ids[2]]
    assert got[0]["hint"] == "3—4 尾2 改"


async def test_homework_completes_after_every_item_finished(client: AsyncClient, orgs, db_session):
    """作业开放后每题都结束过才完成;开放前做的不算"""
    from app.services import content_homework as chw
    d = orgs
    s = await _make_set(client, d)
    now = datetime.utcnow()
    hw = ContentHomework(kind="phonetic_listening", target_id=s["id"], title="听-2",
                         teacher_id=d["t1_id"], available_from=now - timedelta(minutes=5))
    db_session.add(hw)
    await db_session.flush()
    link = ContentHomeworkStudent(homework_id=hw.id, student_id=d["s1_id"])
    db_session.add(link)
    # 开放前做过第 1 题(不算)
    db_session.add(ListeningAttempt(user_id=d["s1_id"], item_id=s["items"][0]["id"], set_id=s["id"],
                                    is_correct=True, created_at=now - timedelta(days=1)))
    await db_session.commit()
    for it in s["items"][1:]:
        await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                          json={"item_id": it["id"], "give_up": True, "word": "", "phonetic": []})
    assert await chw.refresh_completion(db_session, [(link, hw)]) is False
    await client.post(f"{BASE_S}/check", headers=H(d["s1"]),
                      json={"item_id": s["items"][0]["id"], "word": "block", "phonetic": ["b", "l", "ɒ", "k"]})
    assert await chw.refresh_completion(db_session, [(link, hw)]) is True
    assert link.completed_at is not None


async def test_teacher_audio_upload_and_student_play(client: AsyncClient, orgs, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "PHONETIC_AUDIO_DIR", str(tmp_path / "phonetic_audio"))
    d = orgs
    s = await _make_set(client, d)
    item_id = s["items"][0]["id"]
    r = await client.post(f"{BASE_T}/items/{item_id}/audio", headers=H(d["t1"]),
                          files={"audio": ("a.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 3000, "audio/webm")})
    assert r.status_code == 200, r.text
    lst = (await client.get(f"{BASE_S}/sets/{s['id']}", headers=H(d["s1"]))).json()
    assert lst["items"][0]["has_audio"] is True
    r = await client.get(f"{BASE_S}/items/{item_id}/audio", headers=H(d["s1"]))
    assert r.status_code == 200 and r.content.startswith(b"\x1a\x45\xdf\xa3")
    # 别家学生拿不到
    assert (await client.get(f"{BASE_S}/items/{item_id}/audio", headers=H(d["s2"]))).status_code == 404
    # 不是录音的文件拒掉
    r = await client.post(f"{BASE_T}/items/{item_id}/audio", headers=H(d["t1"]),
                          files={"audio": ("a.png", b"\x89PNG" + b"\x00" * 3000, "image/png")})
    assert r.status_code == 400


async def test_check_page_grades_like_single_and_rejects_foreign_items(client: AsyncClient, orgs):
    """整页一次交: 逐题规则和单题一样(两部分都对才对、第一遍错不给答案);混进别的套的题整页拒"""
    d = orgs
    s = await _make_set(client, d)
    other = (await client.post(f"{BASE_T}/books/{d['b1']}/sets", headers=H(d["t1"]),
                               json={"title": "听-9", "items": ITEMS[:1]})).json()
    a, b, c = s["items"]
    r = await client.post(f"{BASE_S}/check-page", headers=H(d["s1"]), json={
        "set_id": s["id"], "pass_number": 1, "answers": [
            {"item_id": a["id"], "word": "block", "phonetic": ["b", "l", "ɒ", "k"]},      # 全对
            {"item_id": b["id"], "word": "hoe", "phonetic": ["h", "æ"]},                  # 单词对音标错
            {"item_id": c["id"], "word": "", "phonetic": [], "give_up": True},            # 看答案
        ]})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["right_count"] == 1 and j["total"] == 3
    r0, r1, r2 = j["results"]
    assert r0["all_correct"] and r0["finished"] and r0["answer"]["word"] == "block"
    assert r1["word_ok"] and not r1["phonetic_ok"] and not r1["finished"] and "answer" not in r1
    assert "həʊ" not in json.dumps(r1)
    assert r2["finished"] and not r2["all_correct"] and r2["answer"]["word"] == "rifle"
    # 别的套的题混进来 → 整页拒,一题都不判
    bad = await client.post(f"{BASE_S}/check-page", headers=H(d["s1"]), json={
        "set_id": s["id"], "answers": [{"item_id": a["id"], "word": "x", "phonetic": []},
                                       {"item_id": other["items"][0]["id"], "word": "x", "phonetic": []}]})
    assert bad.status_code == 400
    # 别家学生整页交 404
    assert (await client.post(f"{BASE_S}/check-page", headers=H(d["s2"]), json={
        "set_id": s["id"], "answers": [{"item_id": a["id"], "word": "block", "phonetic": []}]})).status_code == 404
