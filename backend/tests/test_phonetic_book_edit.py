"""音标教材增删改(2026-11-05,用户「我需要可以改教材的名字 还有些增删改查的功能你设计完善点」)

守五件事:
1. 改名查重: 同一层不能两本同名(导入按名字找「要覆盖的那本」);空名 400
2. 整本覆盖 = 原地改: 书 id、同编号的节 id、同一个单词的题 id 都不变(学生记录、听力、作业还对得上)
3. 改一节: 单词没改的题 id 不变;**单词改了算新题**;一题不合格整节不改
4. 删掉的节 / 题的 id 不会再发给新建的节 / 题(SQLite 没 AUTOINCREMENT 会复用最大 id)
5. 权限: 平台预置只有 admin 能改,别家的书 404;删前 /usage 数得出学生记录
"""
import pytest
from sqlalchemy import select

from app.models.phonetic_practice import PhoneticAttempt, PhoneticItem, PhoneticLesson
from app.models.user import User
from tests.conftest import _make_token

B = "/api/v1/teacher/phonetic-books"


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def _book(name="编辑测试教材", lessons=None):
    return {"book_name": name, "lessons": lessons or [
        {"code": "1—1", "title": "1—1 拼读", "rows": [
            {"word": "bad", "phonetic": "[bæd]", "meaning": "坏的"},
            {"word": "cab", "phonetic": "[kæb]"},
        ]},
        {"code": "1—2", "title": "1—2 拼读", "rows": [{"word": "fee", "phonetic": "[fiː]"}]},
    ]}


async def _import(client, tok, payload):
    r = await client.post(f"{B}/books/import", headers=H(tok), json=payload)
    assert r.status_code == 200, r.text
    return r.json()["book_id"]


async def _lessons(client, tok, book_id):
    return (await client.get(f"{B}/books/{book_id}/lessons", headers=H(tok))).json()


async def _detail(client, tok, lesson_id):
    r = await client.get(f"{B}/lessons/{lesson_id}", headers=H(tok))
    assert r.status_code == 200, r.text
    return r.json()


async def _attempt(db, item_id, lesson_id, uid=4242):
    db.add(PhoneticAttempt(user_id=uid, item_id=item_id, lesson_id=lesson_id, pass_number=1, is_correct=True))
    await db.commit()


@pytest.mark.asyncio
async def test_rename_checks_duplicates(client, teacher_token):
    a = await _import(client, teacher_token, _book("书甲"))
    await _import(client, teacher_token, _book("书乙"))
    r = await client.patch(f"{B}/books/{a}", headers=H(teacher_token), json={"name": "书乙"})
    assert r.status_code == 409 and "书乙" in r.json()["detail"]
    r = await client.patch(f"{B}/books/{a}", headers=H(teacher_token), json={"name": "   "})
    assert r.status_code == 400
    r = await client.patch(f"{B}/books/{a}", headers=H(teacher_token), json={"name": "  新  名字 "})
    assert r.status_code == 200 and r.json()["name"] == "新 名字"
    assert r.json()["lesson_count"] == 2 and r.json()["item_count"] == 3


@pytest.mark.asyncio
async def test_replace_keeps_book_lesson_and_item_ids(client, db_session, teacher_token):
    bid = await _import(client, teacher_token, _book())
    ls = {x["code"]: x["id"] for x in await _lessons(client, teacher_token, bid)}
    items = {it["word"]: it["id"] for it in (await _detail(client, teacher_token, ls["1—1"]))["items"]}
    await _attempt(db_session, items["bad"], ls["1—1"])

    payload = _book(lessons=[
        {"code": "1—1", "title": "1—1 拼读(改)", "rows": [
            {"word": "Bad", "phonetic": "[bæd]", "meaning": "坏"},       # 大小写不同也是同一个词
            {"word": "dab", "phonetic": "[dæb]"},                       # 新词
        ]},
        {"code": "1—3", "title": "1—3", "rows": [{"word": "bee", "phonetic": "[biː]"}]},
    ])
    payload["replace"] = True
    r = await client.post(f"{B}/books/import", headers=H(teacher_token), json=payload)
    assert r.status_code == 200 and r.json()["book_id"] == bid and r.json()["replaced"] is True
    after = {x["code"]: x["id"] for x in await _lessons(client, teacher_token, bid)}
    assert set(after) == {"1—1", "1—3"} and after["1—1"] == ls["1—1"]
    got = {it["word"]: it for it in (await _detail(client, teacher_token, ls["1—1"]))["items"]}
    assert got["Bad"]["id"] == items["bad"] and got["Bad"]["meaning"] == "坏"
    assert items["cab"] not in {it["id"] for it in got.values()}
    # 学生的记录没删
    n = (await db_session.execute(select(PhoneticAttempt))).scalars().all()
    assert len(n) == 1


@pytest.mark.asyncio
async def test_edit_lesson_keeps_ids_and_changed_word_is_new_item(client, db_session, teacher_token):
    bid = await _import(client, teacher_token, _book())
    lid = (await _lessons(client, teacher_token, bid))[0]["id"]
    d = await _detail(client, teacher_token, lid)
    bad, cab = d["items"][0], d["items"][1]
    body = {"code": "1-1", "title": "第一节", "rows": [
        {"id": cab["id"], "word": "cab", "phonetic": "[kæb]", "tts": "kab"},
        {"id": bad["id"], "word": "bed", "phonetic": "[bed]"},                 # 单词改了 → 新题
        {"word": "add", "phonetic": "[æd]"},
    ]}
    r = await client.put(f"{B}/lessons/{lid}", headers=H(teacher_token), json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["code"] == "1—1" and j["title"] == "第一节"
    assert [it["word"] for it in j["items"]] == ["cab", "bed", "add"]
    assert j["items"][0]["id"] == cab["id"] and j["items"][0]["tts"] == "kab"
    assert j["items"][1]["id"] != bad["id"]
    assert bad["id"] not in {it["id"] for it in j["items"]}

    # 一题不合格 → 一题都不改
    bad_body = {"code": "1—1", "rows": [{"id": cab["id"], "word": "cab", "phonetic": "[kab]"}]}
    r = await client.put(f"{B}/lessons/{lid}", headers=H(teacher_token), json=bad_body)
    assert r.status_code == 400 and r.json()["detail"]["errors"]
    assert [it["word"] for it in (await _detail(client, teacher_token, lid))["items"]] == ["cab", "bed", "add"]
    # 编号撞了别的节 409
    r = await client.put(f"{B}/lessons/{lid}", headers=H(teacher_token),
                         json={"code": "1—2", "rows": [{"word": "cab", "phonetic": "[kæb]"}]})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_deleted_ids_are_never_reused(client, db_session, teacher_token):
    bid = await _import(client, teacher_token, _book())
    ls = await _lessons(client, teacher_token, bid)
    last = ls[-1]
    last_item = (await _detail(client, teacher_token, last["id"]))["items"][-1]["id"]
    await _attempt(db_session, last_item, last["id"])
    assert (await client.delete(f"{B}/lessons/{last['id']}", headers=H(teacher_token))).status_code == 200

    r = await client.post(f"{B}/books/{bid}/lessons", headers=H(teacher_token),
                          json={"code": "1—9", "rows": [{"word": "bee", "phonetic": "[biː]"}]})
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["id"] > last["id"], "新节拿到了被删那节的 id,学生的旧记录会算到新节头上"
    assert new["items"][0]["id"] > last_item, "新题拿到了被删那题的 id"
    assert [x["code"] for x in await _lessons(client, teacher_token, bid)][-1] == "1—9"


@pytest.mark.asyncio
async def test_reorder_needs_full_list(client, teacher_token):
    bid = await _import(client, teacher_token, _book())
    ids = [x["id"] for x in await _lessons(client, teacher_token, bid)]
    r = await client.post(f"{B}/books/{bid}/lessons/reorder", headers=H(teacher_token), json={"lesson_ids": ids[:1]})
    assert r.status_code == 409
    r = await client.post(f"{B}/books/{bid}/lessons/reorder", headers=H(teacher_token),
                          json={"lesson_ids": list(reversed(ids))})
    assert r.status_code == 200
    assert [x["id"] for x in await _lessons(client, teacher_token, bid)] == list(reversed(ids))


@pytest.mark.asyncio
async def test_permissions_and_usage(client, db_session, teacher_token):
    bid = await _import(client, teacher_token, _book())
    lid = (await _lessons(client, teacher_token, bid))[0]["id"]
    item = (await _detail(client, teacher_token, lid))["items"][0]["id"]
    await _attempt(db_session, item, lid)
    u = (await client.get(f"{B}/books/{bid}/usage", headers=H(teacher_token))).json()
    assert u["students"] == 1 and u["attempts"] == 1

    # 别家的老师: 看不到也改不了
    other = User(username="edother", email="edother@e.com", hashed_password="x", role="teacher",
                 full_name="别家", is_active=True, org_id=9901)
    from sqlalchemy import text
    await db_session.execute(text("INSERT INTO organizations (id, name, code, status, access_mode) "
                                  "VALUES (9902, '别家', 'otherorg', 'active', 'assigned')"))
    other.org_id = 9902
    db_session.add(other)
    await db_session.commit()
    t2 = _make_token(other.id)
    assert (await client.get(f"{B}/lessons/{lid}", headers=H(t2))).status_code == 404
    assert (await client.patch(f"{B}/books/{bid}", headers=H(t2), json={"name": "x"})).status_code == 404
    assert (await client.delete(f"{B}/lessons/{lid}", headers=H(t2))).status_code == 404

    # 平台预置: 老师能看(只读),不能改
    preset_ls = await _make_preset(db_session)
    r = await client.get(f"{B}/lessons/{preset_ls}", headers=H(teacher_token))
    assert r.status_code == 200 and r.json()["can_edit"] is False
    r = await client.put(f"{B}/lessons/{preset_ls}", headers=H(teacher_token),
                         json={"code": "9—9", "rows": [{"word": "bad", "phonetic": "[bæd]"}]})
    assert r.status_code == 403


async def _make_preset(db):
    from app.models.phonetic_practice import PhoneticBook
    b = PhoneticBook(id=8001, name="平台书", org_id=None)
    db.add(b)
    await db.flush()
    ls = PhoneticLesson(id=8001, book_id=b.id, code="9—1", title="9—1", lesson_number=1)
    db.add(ls)
    db.add(PhoneticItem(id=8001, lesson_id=ls.id, word="bad", answer_json='["b","æ","d"]', core_indexes_json="[1]"))
    await db.commit()
    return ls.id


@pytest.mark.asyncio
async def test_edit_removing_last_item_does_not_reuse_its_id(client, db_session, teacher_token):
    """删掉本节最大 id 的题、同时加新题: 新题不能接手被删那题(学生的旧记录会算到新词头上)"""
    bid = await _import(client, teacher_token, _book(lessons=[
        {"code": "1—1", "title": "1—1", "rows": [{"word": "bad", "phonetic": "[bæd]"},
                                                 {"word": "cab", "phonetic": "[kæb]"}]}]))
    lid = (await _lessons(client, teacher_token, bid))[0]["id"]
    d = await _detail(client, teacher_token, lid)
    bad, cab = d["items"]
    await _attempt(db_session, cab["id"], lid)
    r = await client.put(f"{B}/lessons/{lid}", headers=H(teacher_token), json={"code": "1—1", "rows": [
        {"id": bad["id"], "word": "bad", "phonetic": "[bæd]"}, {"word": "dab", "phonetic": "[dæb]"}]})
    assert r.status_code == 200
    new_id = r.json()["items"][1]["id"]
    assert new_id > cab["id"]
