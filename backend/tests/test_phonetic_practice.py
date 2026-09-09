"""音标填空(看单词写音标)—— 答案不泄露 + 跨机构不越权 + 判分口径

这个模块最容易出的两类事故,各有测试守着:

1. **泄题**:音标是**题目的答案**。列表接口一旦下发 answer,学生打开开发者工具
   就能看到答案,整个题型作废。所以断言响应里搜不到答案字样。

2. **跨机构越权**:只有 PhoneticBook 是租户锚点,lessons/items **不是** ——
   按 ID 直查它们时 tenancy 过滤器罩不住,必须显式 join 回 books 按 org 过滤。
   CLAUDE.md 多租户须知记着「已有两次此类泄漏教训」,这里不能再犯。
"""
import json

import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.organization import Organization
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticLesson, PhoneticItem, PhoneticAttempt,
)
from app.models.user import User
from tests.conftest import _make_token


async def _mk_lesson(db, book_id, code="1—1", words=None):
    ls = PhoneticLesson(book_id=book_id, code=code, title=f"{code} 拼读",
                        lesson_number=1,
                        highlight_json=json.dumps(["æ", "eɪ"], ensure_ascii=False))
    db.add(ls)
    await db.flush()
    for i, (w, toks, mean) in enumerate(words or []):
        db.add(PhoneticItem(
            lesson_id=ls.id, word=w, meaning=mean,
            answer_json=json.dumps(toks, ensure_ascii=False),
            answer_display=f"[{''.join(toks)}]",
            # 元音下标 = 第二遍要挖的格
            core_indexes_json=json.dumps(
                [j for j, t in enumerate(toks) if t in ("æ", "eɪ", "iː", "e")]),
            order_index=i,
        ))
    await db.flush()
    return ls


@pytest.fixture
async def two_orgs_with_books(db_session):
    """两个机构各有自己的音标教材,外加一本平台共享的"""
    tenancy._org_cache.clear()
    o1 = Organization(name="机构甲", code="PHA01", status="active")
    o2 = Organization(name="机构乙", code="PHB01", status="active")
    db_session.add_all([o1, o2])
    await db_session.flush()

    s1 = User(username="ph_s1", email="ph_s1@e.com", hashed_password="x",
              role="student", full_name="甲学生", is_active=True, org_id=o1.id)
    s2 = User(username="ph_s2", email="ph_s2@e.com", hashed_password="x",
              role="student", full_name="乙学生", is_active=True, org_id=o2.id)
    db_session.add_all([s1, s2])
    await db_session.flush()

    b1 = PhoneticBook(name="甲机构自编教材", org_id=o1.id)
    shared = PhoneticBook(name="平台共享教材", org_id=None)   # NULL = 所有机构可见
    db_session.add_all([b1, shared])
    await db_session.flush()

    l1 = await _mk_lesson(db_session, b1.id, "9—9", [
        ("secret", ["s", "iː", "k", "r", "ə", "t"], "机构甲的词"),
    ])
    l_shared = await _mk_lesson(db_session, shared.id, "1—1", [
        ("bad", ["b", "æ", "d"], "坏的"),
        ("babe", ["b", "eɪ", "b"], "婴儿"),
        ("cab", ["k", "æ", "b"], "出租车"),
    ])
    await db_session.commit()
    return {
        "s1": _make_token(s1.id), "s2": _make_token(s2.id),
        "b1": b1.id, "shared": shared.id,
        "l1": l1.id, "l_shared": l_shared.id,
        "item_bad": (await _first_item(db_session, l_shared.id)).id,
        "item_secret": (await _first_item(db_session, l1.id)).id,
    }


async def _first_item(db, lesson_id):
    from sqlalchemy import select
    return (await db.execute(
        select(PhoneticItem).where(PhoneticItem.lesson_id == lesson_id)
        .order_by(PhoneticItem.order_index)
    )).scalars().first()


# ── 泄题 ────────────────────────────────────────────────────────────────

async def test_lesson_list_never_leaks_answer(
        client: AsyncClient, two_orgs_with_books):
    """列表接口只给格子数,**绝不给答案** —— 否则学生开发者工具一看就穿"""
    d = two_orgs_with_books
    r = await client.get(f"/api/v1/phonetic-practice/lessons/{d['l_shared']}",
                         headers={"Authorization": f"Bearer {d['s1']}"})
    assert r.status_code == 200
    raw = r.text
    body = r.json()

    # 结构上只有 slot_count
    assert [i["slot_count"] for i in body["items"]] == [3, 3, 3]
    assert all("answer" not in i for i in body["items"])

    # 字面上搜不到任何答案音素串
    for leaked in ("bæd", "beɪb", "kæb", "answer_json", "answer_display"):
        assert leaked not in raw, f"响应里泄露了 {leaked}"


async def test_first_pass_wrong_does_not_reveal_answer(
        client: AsyncClient, two_orgs_with_books):
    """第一遍答错只回哪几格错,不给答案;第二遍才给"""
    d = two_orgs_with_books
    h = {"Authorization": f"Bearer {d['s1']}"}

    r1 = await client.post("/api/v1/phonetic-practice/check", headers=h, json={
        "item_id": d["item_bad"], "pass_number": 1,
        "submitted": ["b", "e", "d"],          # 元音填错
    })
    assert r1.status_code == 200
    b1 = r1.json()
    assert b1["all_correct"] is False
    assert b1["wrong_indexes"] == [1]
    assert b1["answer_display"] is None, "第一遍就给答案 = 泄题"
    # 进第二遍时服务端回填辅音,挖掉的那格必须是空的
    assert b1["prefill"] == ["b", None, "d"]

    r2 = await client.post("/api/v1/phonetic-practice/check", headers=h, json={
        "item_id": d["item_bad"], "pass_number": 2,
        "submitted": ["b", "ɪ", "d"],
    })
    assert r2.json()["answer_display"] == "[bæd]", "第二遍仍错才该给答案"


# ── 跨机构越权 ──────────────────────────────────────────────────────────

async def test_cannot_read_other_org_lesson(
        client: AsyncClient, two_orgs_with_books):
    """lessons 不是租户锚点,按 ID 直查必须 join 回 books 过滤,否则跨机构泄题"""
    d = two_orgs_with_books
    r = await client.get(f"/api/v1/phonetic-practice/lessons/{d['l1']}",
                         headers={"Authorization": f"Bearer {d['s2']}"})
    assert r.status_code == 404, "机构乙的学生读到了机构甲的教材"


async def test_cannot_grade_other_org_item(
        client: AsyncClient, two_orgs_with_books):
    """判分端点同样要过滤 —— 否则拿 item_id 猜答案就绕过了列表的过滤"""
    d = two_orgs_with_books
    r = await client.post("/api/v1/phonetic-practice/check",
                          headers={"Authorization": f"Bearer {d['s2']}"},
                          json={"item_id": d["item_secret"], "pass_number": 1,
                                "submitted": ["s", "iː", "k", "r", "ə", "t"]})
    assert r.status_code == 404, "判分端点成了跨机构探答案的后门"


async def test_shared_book_visible_to_all_orgs(
        client: AsyncClient, two_orgs_with_books):
    """org_id IS NULL = 平台共享,两个机构都该看见(与 phonetic_videos 同口径)"""
    d = two_orgs_with_books
    for tok in (d["s1"], d["s2"]):
        r = await client.get("/api/v1/phonetic-practice/books",
                             headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        names = [b["name"] for b in r.json()]
        assert "平台共享教材" in names

    # 机构甲能看到自己的,机构乙看不到
    r1 = await client.get("/api/v1/phonetic-practice/books",
                          headers={"Authorization": f"Bearer {d['s1']}"})
    r2 = await client.get("/api/v1/phonetic-practice/books",
                          headers={"Authorization": f"Bearer {d['s2']}"})
    assert "甲机构自编教材" in [b["name"] for b in r1.json()]
    assert "甲机构自编教材" not in [b["name"] for b in r2.json()]


# ── 判分口径 ────────────────────────────────────────────────────────────

async def test_stress_mark_is_lenient(client: AsyncClient, db_session,
                                      two_orgs_with_books):
    """重音符漏点不判错:938 题里 177 题带重音,小学阶段不该因此判错整题"""
    d = two_orgs_with_books
    ls = await _mk_lesson(db_session, d["shared"], "9—1", [
        ("handle", ["ˈ", "h", "æ", "n", "d", "l"], "手柄"),
    ])
    await db_session.commit()
    it = await _first_item(db_session, ls.id)

    r = await client.post("/api/v1/phonetic-practice/check",
                          headers={"Authorization": f"Bearer {d['s1']}"},
                          json={"item_id": it.id, "pass_number": 1,
                                "submitted": [None, "h", "æ", "n", "d", "l"]})
    assert r.json()["all_correct"] is True, "漏点重音符被判错了"


# ── 卡片模式:背面揭示答案的下发闸门 ────────────────────────────────────

async def test_lesson_list_carries_progress_and_highlight(
        client: AsyncClient, two_orgs_with_books):
    """目录页要能看出「这节练什么音」和「学到哪」—— 否则 48 张卡长得一模一样

    写对数按 item_id **去重**:同一个词第二遍才对、或反复练,都只算一个词写对过。
    不去重的话反复练一个词就能把进度刷满,进度条会骗人。
    """
    d = two_orgs_with_books
    h = {"Authorization": f"Bearer {d['s1']}"}

    def shared(body):
        book = next(b for b in body if b["name"] == "平台共享教材")
        return book["lessons"][0]

    # 没练过:0 且没有时间戳,前端据此不显示进度条/继续条
    ls0 = shared((await client.get("/api/v1/phonetic-practice/books", headers=h)).json())
    assert ls0["mastered_count"] == 0
    assert ls0["last_practiced_at"] is None
    assert ls0["highlight"] == ["æ", "eɪ"], "目录页没下发这节在教的音素"

    # 同一个词写对两次 + 另一个词写错 → 只算 1 个词写对过
    for _ in range(2):
        await client.post("/api/v1/phonetic-practice/check", headers=h, json={
            "item_id": d["item_bad"], "pass_number": 1, "submitted": ["b", "æ", "d"]})
    ls1 = shared((await client.get("/api/v1/phonetic-practice/books", headers=h)).json())
    assert ls1["mastered_count"] == 1, "同一个词练两遍被算成两个词,进度条会骗人"
    assert ls1["last_practiced_at"], "缺时间戳,「继续上次」定位不到这一节"

    # 别人的作答不能算进我的进度
    h2 = {"Authorization": f"Bearer {d['s2']}"}
    other = next(b for b in (await client.get(
        "/api/v1/phonetic-practice/books", headers=h2)).json() if b["name"] == "平台共享教材")
    assert other["lessons"][0]["mastered_count"] == 0, "读到了别人的学情"


async def test_answer_tokens_only_when_card_is_over(
        client: AsyncClient, two_orgs_with_books):
    """卡片背面要揭示答案,但闸门必须是「这张卡已结束」

    第一遍做错**不能**给 —— 否则学生随手填三个格、按一下就白拿答案,
    第二遍(只填元音)那一步的教学意义直接归零。
    """
    d = two_orgs_with_books
    h = {"Authorization": f"Bearer {d['s1']}"}

    # 第一遍错:只给回填的辅音格,不给完整答案
    r = await client.post("/api/v1/phonetic-practice/check", headers=h, json={
        "item_id": d["item_bad"], "pass_number": 1, "submitted": ["b", "e", "d"],
    })
    b = r.json()
    assert b["answer_tokens"] is None, "第一遍做错就把答案发下去了 = 白拿答案"
    assert b["answer_display"] is None

    # 第一遍对:这张卡结束了,给完整答案供背面揭示
    r = await client.post("/api/v1/phonetic-practice/check", headers=h, json={
        "item_id": d["item_bad"], "pass_number": 1, "submitted": ["b", "æ", "d"],
    })
    b = r.json()
    assert b["all_correct"] is True
    assert b["answer_tokens"] == ["b", "æ", "d"]
    assert b["answer_display"] == "[bæd]"

    # 第二遍不论对错都结束,都给
    for sub in (["b", "æ", "d"], ["b", "ɪ", "d"]):
        b = (await client.post("/api/v1/phonetic-practice/check", headers=h, json={
            "item_id": d["item_bad"], "pass_number": 2, "submitted": sub,
        })).json()
        assert b["answer_tokens"] == ["b", "æ", "d"], f"第二遍交 {sub} 后没拿到答案"


async def test_answer_tokens_carry_stress_mark_student_skipped(
        client: AsyncClient, db_session, two_orgs_with_books):
    """答案必须由服务端给,不能拿学生填的格子当答案显示

    重音符判分是宽松的(没点 ˈ 也算对),用学生的作答画背面会漏掉重音符,
    跟纸书对不上 —— 孩子会以为纸书印错了。
    """
    d = two_orgs_with_books
    ls = await _mk_lesson(db_session, d["shared"], "9—2", [
        ("handle", ["ˈ", "h", "æ", "n", "d", "l"], "手柄"),
    ])
    await db_session.commit()
    it = await _first_item(db_session, ls.id)

    b = (await client.post("/api/v1/phonetic-practice/check",
                           headers={"Authorization": f"Bearer {d['s1']}"},
                           json={"item_id": it.id, "pass_number": 1,
                                 "submitted": [None, "h", "æ", "n", "d", "l"]})).json()
    assert b["all_correct"] is True
    assert b["answer_tokens"] == ["ˈ", "h", "æ", "n", "d", "l"], "揭示的答案漏了重音符"


async def test_page_submit_is_idempotent(client: AsyncClient, db_session,
                                         two_orgs_with_books):
    """整页交卷带 attempt_id:弱网连点两次,判分照常返回但不重复记账

    音标闯关课方案 §12 红线 9:「弱网学生场景必踩重复提交」
    """
    from sqlalchemy import func, select
    d = two_orgs_with_books
    h = {"Authorization": f"Bearer {d['s1']}"}
    body = {
        "lesson_id": d["l_shared"], "pass_number": 1, "attempt_id": "dup-1",
        "answers": [{"item_id": d["item_bad"], "submitted": ["b", "æ", "d"]}],
    }
    r1 = await client.post("/api/v1/phonetic-practice/check-page", headers=h, json=body)
    r2 = await client.post("/api/v1/phonetic-practice/check-page", headers=h, json=body)

    assert r1.json()["right_count"] == 1
    assert r2.json()["right_count"] == 1, "重复提交应照常返回判分(孩子要看到反馈)"

    n = (await db_session.execute(
        select(func.count(PhoneticAttempt.id))
        .where(PhoneticAttempt.lesson_id == d["l_shared"])
    )).scalar()
    assert n == 1, f"同一 attempt_id 记了 {n} 条,幂等失效"


# ── 跟读:判定不可用绝不能挡住孩子 ──────────────────────────────────

async def test_reading_lesson_gives_phonetic_not_spelling(
        client: AsyncClient, two_orgs_with_books):
    """跟读题给音标、**读完才揭示单词** —— 给了拼写孩子就照拼写猜,音标成摆设"""
    d = two_orgs_with_books
    r = await client.get(
        f"/api/v1/phonetic-practice/lessons/{d['l_shared']}/reading",
        headers={"Authorization": f"Bearer {d['s1']}"})
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["phonetic"] == "[bæd]", "跟读题就是要给音标"
    assert items[0]["word_reveal"] == "bad", "单词放 word_reveal,前端读完才显示"


async def test_reading_upload_works_without_judge_service(
        client: AsyncClient, two_orgs_with_books, monkeypatch):
    """判定服务没起时:录音照样存下来,verdict 回 off

    判定不可用是**常态**(它是独立进程,可能没部署)。绝不能因此挡住孩子 ——
    录音留档与判定是两件事,前者必须成功。
    """
    d = two_orgs_with_books
    # 默认 PHONEME_JUDGE_URL 为空,client.judge 直接回 None
    r = await client.post(
        "/api/v1/phonetic-practice/readings/judge",
        headers={"Authorization": f"Bearer {d['s1']}"},
        files={"audio": ("a.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 5000, "audio/webm")},
        data={"item_id": str(d["item_bad"]), "duration_ms": "1200"},
    )
    assert r.status_code == 200, "判定不可用不该报错"
    body = r.json()
    assert body["verdict"] == "off"
    assert body["reading_id"] is not None, "录音必须已存档,老师还要能听"


async def test_cannot_upload_reading_for_other_org_item(
        client: AsyncClient, two_orgs_with_books):
    """跟读上传也要过 org 过滤,否则成了跨机构探题的后门"""
    d = two_orgs_with_books
    r = await client.post(
        "/api/v1/phonetic-practice/readings/judge",
        headers={"Authorization": f"Bearer {d['s2']}"},
        files={"audio": ("a.webm", b"\x00" * 4000, "audio/webm")},
        data={"item_id": str(d["item_secret"])},
    )
    assert r.status_code == 404
