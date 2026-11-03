"""音标学习报告 + 写音标 / 读音标作业

规则真源 services/phonetic_report.py 文件头。这里锁住:
1. 只认第一遍(第二遍辅音是回填的,算进去辅音正确率虚高)
2. 出现不到 MIN_SEEN 次不判弱;写混要出现 ≥ 2 次
3. 老师只看本班;学生只看自己(简版);家长只看绑定的孩子(简版,没有录音和写成了什么)
4. 写音标作业: 开放后每个词都结束过才完成;读音标作业: 没判出来(off)的不算读过
"""
import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import tenancy

from app.models.content_homework import ContentHomework, ContentHomeworkStudent
from app.models.organization import Organization
from app.models.phonetic_practice import PhoneticAttempt, PhoneticBook, PhoneticItem, PhoneticLesson, PhoneticReading
from app.models.user import Class, ClassStudent, ParentStudentLink, User
from tests.conftest import _make_token

T = "/api/v1/teacher/phonetic-books/report"
S = "/api/v1/phonetic-practice/report"

WORDS = [  # (词, 音素)
    ("bang", ["b", "æ", "ŋ"]), ("sing", ["s", "ɪ", "ŋ"]), ("long", ["l", "ɒ", "ŋ"]),
    ("king", ["k", "ɪ", "ŋ"]), ("hang", ["h", "æ", "ŋ"]), ("bad", ["b", "æ", "d"]),
]


@pytest.fixture
async def world(db_session):
    tenancy._org_cache.clear()
    o = Organization(name="报告机构", code="RPT01", status="active")
    db_session.add(o)
    await db_session.flush()
    t = User(username="rp_t", email="rp_t@e.com", hashed_password="x", role="teacher", is_active=True, org_id=o.id, full_name="甲老师")
    t2 = User(username="rp_t2", email="rp_t2@e.com", hashed_password="x", role="teacher", is_active=True, org_id=o.id, full_name="乙老师")
    s = User(username="rp_s", email="rp_s@e.com", hashed_password="x", role="student", is_active=True, org_id=o.id, full_name="小明")
    p = User(username="rp_p", email="rp_p@e.com", hashed_password="x", role="parent", is_active=True, org_id=o.id)
    p2 = User(username="rp_p2", email="rp_p2@e.com", hashed_password="x", role="parent", is_active=True, org_id=o.id)
    db_session.add_all([t, t2, s, p, p2])
    await db_session.flush()
    c = Class(name="一班", teacher_id=t.id, org_id=o.id)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=s.id, is_active=True))
    db_session.add(ParentStudentLink(parent_id=p.id, student_id=s.id))
    b = PhoneticBook(name="音标书", org_id=None)
    db_session.add(b)
    await db_session.flush()
    ls = PhoneticLesson(book_id=b.id, code="3—7", title="3—7 拼读", lesson_number=1)
    db_session.add(ls)
    await db_session.flush()
    items = []
    for i, (w, toks) in enumerate(WORDS):
        it = PhoneticItem(lesson_id=ls.id, word=w, answer_json=json.dumps(toks, ensure_ascii=False),
                          answer_display=f"[{''.join(toks)}]",
                          core_indexes_json=json.dumps([j for j, x in enumerate(toks) if x in ("æ", "ɪ", "ɒ")]),
                          order_index=i)
        db_session.add(it)
        items.append(it)
    await db_session.commit()
    return {"t": _make_token(t.id), "t2": _make_token(t2.id), "s": _make_token(s.id), "p": _make_token(p.id),
            "p2": _make_token(p2.id), "sid": s.id, "tid": t.id, "lesson": ls.id, "items": items}


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


async def _write(db, sid, it, sub, pass_number=1, ok=None, at=None):
    toks = json.loads(it.answer_json)
    db.add(PhoneticAttempt(user_id=sid, item_id=it.id, lesson_id=it.lesson_id, pass_number=pass_number,
                           submitted_json=json.dumps(sub, ensure_ascii=False),
                           is_correct=(sub == toks) if ok is None else ok,
                           created_at=at or datetime.utcnow()))


async def test_first_pass_only_and_confusions(client: AsyncClient, world, db_session):
    """5 个 ŋ 词第一遍都写成 n → ŋ 是弱音素,写混 ŋ→n 5 次;第二遍全对也不改这个结论"""
    d = world
    for it in d["items"][:5]:
        toks = json.loads(it.answer_json)
        wrong = [("n" if x == "ŋ" else x) for x in toks]
        await _write(db_session, d["sid"], it, wrong)
        await _write(db_session, d["sid"], it, toks, pass_number=2)
    await db_session.commit()
    r = (await client.get(f"{T}/students/{d['sid']}", headers=H(d["t"]))).json()
    weak = {p["phoneme"]: p for p in r["weak_phonemes"]}
    assert "ŋ" in weak and weak["ŋ"]["right"] == 0 and weak["ŋ"]["seen"] == 5
    assert weak["ŋ"]["wrong_as"][0]["phoneme"] == "n"
    assert weak["ŋ"]["lesson"]["code"] == "3—7"
    assert r["confusions"][0] == {"should": "ŋ", "wrote": "n", "times": 5, "words": r["confusions"][0]["words"]}
    # 第二遍的辅音是回填的,不能把 ŋ 的「对」算进去
    assert all(p["phoneme"] != "ŋ" or p["right"] == 0 for p in r["phonemes"])
    assert "/ŋ/ 常写成 /n/" in r["advice"][0]["text"]


async def test_second_pass_alone_never_counts(client: AsyncClient, world, db_session):
    """只有第二遍的记录(第一遍那条没交上来 / 被清掉)也不能算进音素对错: 第二遍的辅音是服务端回填的"""
    d = world
    for it in d["items"][:5]:
        await _write(db_session, d["sid"], it, json.loads(it.answer_json), pass_number=2)
    await db_session.commit()
    r = (await client.get(f"{T}/students/{d['sid']}", headers=H(d["t"]))).json()
    assert r["phonemes"] == []
    assert r["summary"]["write"]["words"] == 0


async def test_too_few_not_weak(client: AsyncClient, world, db_session):
    """d 只出现 1 次就错 1 次: 不判弱(冤枉),也不进写混"""
    d = world
    bad = d["items"][5]
    await _write(db_session, d["sid"], bad, ["b", "æ", "t"])
    await db_session.commit()
    r = (await client.get(f"{T}/students/{d['sid']}", headers=H(d["t"]))).json()
    assert all(p["phoneme"] != "d" for p in r["weak_phonemes"])
    dd = next(p for p in r["phonemes"] if p["phoneme"] == "d")
    assert dd["enough"] is False and dd["weak"] is False
    assert r["confusions"] == []


async def test_access_rules(client: AsyncClient, world, db_session):
    d = world
    await _write(db_session, d["sid"], d["items"][0], ["b", "æ", "n"])
    await db_session.commit()
    # 别的老师(同机构,不是本班)看不了
    assert (await client.get(f"{T}/students/{d['sid']}", headers=H(d["t2"]))).status_code == 403
    # 学生只能看自己的简版: 没有录音 id、没有写成了什么
    me = await client.get(f"{S}/me", headers=H(d["s"]))
    assert me.status_code == 200
    body = me.json()
    assert "hard_writes" not in body and "hard_reads" not in body and "confusions" not in body
    assert "bæn" not in me.text
    # 家长: 绑定的孩子能看,没绑定的不行
    assert (await client.get(f"{S}/children/{d['sid']}", headers=H(d["p"]))).status_code == 200
    assert (await client.get(f"{S}/children/{d['sid']}", headers=H(d["p2"]))).status_code == 403
    # 学生不能用家长接口看别人
    assert (await client.get(f"{S}/children/{d['sid']}", headers=H(d["s"]))).status_code == 403
    # 时间范围只能选给的几个
    assert (await client.get(f"{T}/students/{d['sid']}?days=13", headers=H(d["t"]))).status_code == 400
    cls = (await client.get(f"{T}/class", headers=H(d["t"]))).json()
    assert [x["id"] for x in cls["students"]] == [d["sid"]]


async def test_write_homework_completes_after_every_word(client: AsyncClient, world, db_session):
    from app.services import content_homework as chw
    d = world
    now = datetime.utcnow()
    hw = ContentHomework(kind="phonetic_write", target_id=d["lesson"], title="写 3—7",
                         teacher_id=d["tid"], available_from=now - timedelta(minutes=5))
    db_session.add(hw)
    await db_session.flush()
    link = ContentHomeworkStudent(homework_id=hw.id, student_id=d["sid"])
    db_session.add(link)
    # 开放前写对的不算;第一遍错的不算结束
    await _write(db_session, d["sid"], d["items"][0], json.loads(d["items"][0].answer_json), at=now - timedelta(days=1))
    await _write(db_session, d["sid"], d["items"][1], ["s", "ɪ", "n"])
    await db_session.commit()
    for it in d["items"]:
        if it is not d["items"][1]:
            await _write(db_session, d["sid"], it, json.loads(it.answer_json))
    await db_session.commit()
    assert await chw.refresh_completion(db_session, [(link, hw)]) is False
    await _write(db_session, d["sid"], d["items"][1], ["s", "ɪ", "n"], pass_number=2, ok=False)   # 第二遍判完也算结束
    await db_session.commit()
    assert await chw.refresh_completion(db_session, [(link, hw)]) is True


async def test_read_homework_ignores_unjudged(client: AsyncClient, world, db_session):
    """判定服务没判出来(off)的不算读过 —— 不然网络一卡整节都算完成"""
    from app.services import content_homework as chw
    d = world
    now = datetime.utcnow()
    hw = ContentHomework(kind="phonetic_read", target_id=d["lesson"], title="读 3—7",
                         teacher_id=d["tid"], available_from=now - timedelta(minutes=5))
    db_session.add(hw)
    await db_session.flush()
    link = ContentHomeworkStudent(homework_id=hw.id, student_id=d["sid"])
    db_session.add(link)
    for i, it in enumerate(d["items"]):
        db_session.add(PhoneticReading(user_id=d["sid"], item_id=it.id, lesson_id=it.lesson_id, file_path=f"x{i}",
                                       verdict="off" if i == 0 else "pass", created_at=now))
    await db_session.commit()
    assert await chw.refresh_completion(db_session, [(link, hw)]) is False
    db_session.add(PhoneticReading(user_id=d["sid"], item_id=d["items"][0].id, lesson_id=d["lesson"], file_path="y",
                                   verdict="not_close", self_passed=True, created_at=now))
    await db_session.commit()
    assert await chw.refresh_completion(db_session, [(link, hw)]) is True


async def test_homework_targets_list_lessons(client: AsyncClient, world):
    d = world
    r = await client.get("/api/v1/teacher/content-homework/targets?kind=phonetic_write", headers=H(d["t"]))
    assert r.status_code == 200
    assert r.json()[0]["units"][0]["name"] == "3—7(6 词)"
