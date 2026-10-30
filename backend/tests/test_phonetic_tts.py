"""音标教材「发音」列 —— 标准音读得不对时,老师指定按哪个词读(2026-10-30)

用户原话:「有的长音或者短音发音的后台传的时候可以增加个重发音按我给的单词发音吗」。
守四件事:
1. 「发音」只收英文(填音标 / 中文 TTS 读不出来),空着 = 按单词读
2. 改已有教材的发音**不换题目 id**(整本替换会让学生的进度、录音全对不上)
3. 写音标卡片: 发音和答案同一个闸门,卡片结束才下发(「读起来像 seed」是很强的提示)
4. 权限: 别的机构的书 404,平台预置的书老师改不了
"""
import json

import pytest
from sqlalchemy import select

from app.models.phonetic_practice import PhoneticBook, PhoneticItem, PhoneticLesson
from app.models.user import User
from app.services.phonetic_tokenize import check_tts_text
from tests.conftest import _make_token

B = "/api/v1/teacher/phonetic-books"


def test_check_tts_text():
    assert check_tts_text(None) == (None, None)
    assert check_tts_text("   ") == (None, None), "空着 = 按单词读"
    assert check_tts_text(" seed ") == ("seed", None)
    assert check_tts_text("ice  cream")[0] == "ice cream"
    assert check_tts_text("don’t")[0] == "don't", "弯撇号换直撇号"
    for bad in ("[siːd]", "/bæd/", "种子", "s1d", "x" * 61):
        t, err = check_tts_text(bad)
        assert t is None and err, f"{bad!r} 应该被拦"


def _book(rows, name="发音测试教材"):
    return {
        "book_name": name,
        "lessons": [{"code": "1—1", "title": "1—1 拼读", "rows": rows}],
    }


async def _student(db, org_id=9901, name="tsstu"):
    u = User(username=name, email=f"{name}@e.com", hashed_password="x",
             role="student", full_name="发音学生", is_active=True, org_id=org_id)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return _make_token(u.id)


@pytest.mark.asyncio
async def test_import_stores_tts_and_rejects_bad(client, db_session, teacher_token):
    h = {"Authorization": f"Bearer {teacher_token}"}
    bad = _book([{"word": "cede", "phonetic": "[siːd]", "tts": "[siːd]"}])
    v = (await client.post(f"{B}/books/validate", json=bad, headers=h)).json()
    assert v["ok"] is False and "英文" in v["errors"][0]["reason"]
    assert (await client.post(f"{B}/books/import", json=bad, headers=h)).status_code == 400

    good = _book([
        {"word": "cede", "phonetic": "[siːd]", "tts": "seed"},
        {"word": "bad", "phonetic": "[bæd]"},
    ])
    v = (await client.post(f"{B}/books/validate", json=good, headers=h)).json()
    assert v["ok"] and v["tts_count"] == 1
    r = await client.post(f"{B}/books/import", json=good, headers=h)
    assert r.status_code == 200
    got = {it.word: it.tts_text for it in (await db_session.execute(select(PhoneticItem))).scalars()}
    assert got == {"cede": "seed", "bad": None}


@pytest.mark.asyncio
async def test_student_gets_tts_only_after_card_ends(client, db_session, teacher_token):
    h = {"Authorization": f"Bearer {teacher_token}"}
    r = await client.post(f"{B}/books/import", headers=h, json=_book(
        [{"word": "cede", "phonetic": "[siːd]", "tts": "seed"}]))
    assert r.status_code == 200
    it = (await db_session.execute(select(PhoneticItem))).scalars().first()
    stu = {"Authorization": f"Bearer {await _student(db_session)}"}

    detail = await client.get(f"/api/v1/phonetic-practice/lessons/{it.lesson_id}", headers=stu)
    assert detail.status_code == 200
    assert "seed" not in detail.text, "写音标的题目列表不能带发音(等于提示答案)"

    wrong = (await client.post("/api/v1/phonetic-practice/check", headers=stu, json={
        "item_id": it.id, "pass_number": 1, "submitted": ["s", "ɪ", "d"]})).json()
    assert not wrong["all_correct"] and wrong.get("tts_text") is None, "第一遍做错不给"
    right = (await client.post("/api/v1/phonetic-practice/check", headers=stu, json={
        "item_id": it.id, "pass_number": 1, "submitted": ["s", "iː", "d"]})).json()
    assert right["all_correct"] and right["tts_text"] == "seed", "卡片结束了,背面「再听一遍」按它读"

    reading = (await client.get(
        f"/api/v1/phonetic-practice/lessons/{it.lesson_id}/reading", headers=stu)).json()
    assert reading["items"][0]["tts_text"] == "seed", "跟读页的「听标准音」按它读"


@pytest.mark.asyncio
async def test_update_tts_keeps_item_ids(client, db_session, teacher_token):
    """在用的教材改发音: 题目 id 不变、只动发音;空着 = 改回按单词读"""
    h = {"Authorization": f"Bearer {teacher_token}"}
    r = await client.post(f"{B}/books/import", headers=h, json=_book([
        {"word": "cede", "phonetic": "[siːd]"},
        {"word": "bad", "phonetic": "[bæd]", "tts": "bad"},
        {"word": "fee", "phonetic": "[fiː]", "tts": "fee"},
    ]))
    book_id = r.json()["book_id"]
    before = {it.word: it.id for it in (await db_session.execute(select(PhoneticItem))).scalars()}

    items = (await client.get(f"{B}/books/{book_id}/items", headers=h)).json()
    assert [i["word"] for i in items] == ["cede", "bad", "fee"]
    assert items[0]["phonetic"] == "[siːd]" and items[1]["tts_text"] == "bad"
    ids = {i["word"]: i["id"] for i in items}

    r = await client.post(f"{B}/books/{book_id}/tts", headers=h, json={"items": [
        {"id": ids["cede"], "tts": "seed"},
        {"id": ids["bad"], "tts": "bad"},      # 没变不算改
        {"id": ids["fee"], "tts": "  "},       # 空着 = 改回按单词读
    ]})
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 2, "with_tts": 2}
    db_session.expire_all()
    after = {it.word: (it.id, it.tts_text) for it in (await db_session.execute(select(PhoneticItem))).scalars()}
    assert {w: i for w, (i, _) in after.items()} == before, "题目 id 一个都不能换"
    assert after["cede"][1] == "seed" and after["fee"][1] is None and after["bad"][1] == "bad"
    lst = (await client.get(f"{B}/books", headers=h)).json()
    assert next(b for b in lst if b["id"] == book_id)["tts_count"] == 2


@pytest.mark.asyncio
async def test_update_tts_all_or_nothing(client, db_session, teacher_token):
    """有一个不合格就一个都不改: 发音不是英文、或者混进了别的书的题"""
    h = {"Authorization": f"Bearer {teacher_token}"}
    b1 = (await client.post(f"{B}/books/import", headers=h, json=_book(
        [{"word": "cede", "phonetic": "[siːd]", "tts": "seed"}], name="甲书"))).json()["book_id"]
    b2 = (await client.post(f"{B}/books/import", headers=h, json=_book(
        [{"word": "bad", "phonetic": "[bæd]"}], name="乙书"))).json()["book_id"]
    i1 = (await client.get(f"{B}/books/{b1}/items", headers=h)).json()[0]["id"]
    i2 = (await client.get(f"{B}/books/{b2}/items", headers=h)).json()[0]["id"]

    r = await client.post(f"{B}/books/{b1}/tts", headers=h, json={"items": [
        {"id": i1, "tts": "sid"}, {"id": i1, "tts": "[siːd]"}]})
    assert r.status_code == 400 and "一个都没改" in r.json()["detail"]
    r = await client.post(f"{B}/books/{b1}/tts", headers=h, json={"items": [
        {"id": i1, "tts": "sid"}, {"id": i2, "tts": "bed"}]})
    assert r.status_code == 400, "乙书的题不能借甲书的接口改"
    db_session.expire_all()
    got = {it.word: it.tts_text for it in (await db_session.execute(select(PhoneticItem))).scalars()}
    assert got == {"cede": "seed", "bad": None}


@pytest.mark.asyncio
async def test_update_tts_permissions(client, db_session, teacher_token):
    """别的机构的书 404;平台预置的书老师改不了(403),但能看;学生都不行"""
    other = PhoneticBook(name="别家的", org_id=9902)
    preset = PhoneticBook(name="平台的", org_id=None)
    db_session.add_all([other, preset])
    await db_session.flush()
    ids = {}
    for b in (other, preset):
        ls = PhoneticLesson(book_id=b.id, code="1—1", title="1—1", lesson_number=1)
        db_session.add(ls)
        await db_session.flush()
        it = PhoneticItem(lesson_id=ls.id, word="cede",
                          answer_json=json.dumps(["s", "iː", "d"]), order_index=0)
        db_session.add(it)
        await db_session.flush()
        ids[b.id] = it.id
    await db_session.commit()
    h = {"Authorization": f"Bearer {teacher_token}"}
    body = lambda bid: {"items": [{"id": ids[bid], "tts": "seed"}]}  # noqa: E731
    assert (await client.get(f"{B}/books/{other.id}/items", headers=h)).status_code == 404
    assert (await client.post(f"{B}/books/{other.id}/tts", headers=h, json=body(other.id))).status_code == 404
    assert (await client.get(f"{B}/books/{preset.id}/items", headers=h)).status_code == 200
    assert (await client.post(f"{B}/books/{preset.id}/tts", headers=h, json=body(preset.id))).status_code == 403
    stu = {"Authorization": f"Bearer {await _student(db_session)}"}
    assert (await client.get(f"{B}/books/{preset.id}/items", headers=stu)).status_code == 403
