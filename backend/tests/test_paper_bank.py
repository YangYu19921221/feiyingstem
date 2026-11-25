"""试卷库 + 专项小卷(services/paper_bank、paper_parse、paper_tiles): 拆卷模型用 httpx.MockTransport 假装,不真调。

锁住的规矩:
- 切图: 两页并排的图先分左右页,每页按空白缝分栏,高的栏上下切两块
- 合并: 每道题属于哪套卷 / 哪道大题照前面的补;重叠处拆两次的题只留一道;答案页的答案对上题号,和 AI 做的不一样标黄
- 拆卷用的 Key 不能设默认、别的 AI 功能读不到;留空不改密钥
- 只有核对通过的题进题库;题只给本机构用;年级高于孩子的不出
- 发给孩子的题没有答案;只认第一次交的;不在他小卷里的题交不了
- 把握度: 做对往上、做错往下;四选一做对加得少;题里有他没掌握的词又做错了,语法这边少扣;回头考到期那天或以后做对才升级
- 组卷: 刚开始先摸底(不同的点各一道);之后补最该补的点、带对比题、带他的薄弱词;同一道题不出第二次
- 小卷布置成作业: 那天的小卷做完就算完成
"""
import io
import json
from datetime import date, datetime, timedelta

import httpx
import pytest
from PIL import Image, ImageDraw
from sqlalchemy import select, text as sql_text

from app.api.v1.admin.ai_config import encrypt_api_key
from app.core import tenancy
from app.core.shared_store import reset_memory
from app.models.content_homework import KIND_PAPER_QUIZ, ContentHomework, ContentHomeworkStudent
from app.models.learning import LearningRecord, WordMastery
from app.models.paper_bank import PaperAnswer, PaperDoc, PaperItem, PaperKpMastery, PaperQuiz
from app.models.system_config import AIProvider
from app.models.user import Class, ClassStudent, User
from app.models.word import Word
from app.services import ai_service
from app.services import paper_bank as pb
from app.services import paper_kp as kpm
from app.services import paper_parse as pp
from app.services import paper_tiles as ptl
from app.services import tutor as tt
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


# ---------------------------------------------------------------- 假中转 / 环境

def _mc(no, stem, options, answer, kps, wrong=None, source="page", unsure=None, title="", section="", tile=1):
    return {"paper_title": title, "section": section, "no": no, "kind": "mc", "stem": stem, "options": options,
            "base_word": "", "answer": [answer], "answer_source": source, "alts": [], "explain": "讲解",
            "kps": kps, "wrong": wrong or [], "traps": [], "difficulty": 2, "needs_image": False,
            "unsure": unsure or [], "tile": tile, "y0": 0.1, "y1": 0.3}


def _fill(no, stem, answer, kps, base="", traps=None, source="ai", title="", section="", alts=None):
    return {"paper_title": title, "section": section, "no": no, "kind": "fill", "stem": stem, "options": [],
            "base_word": base, "answer": answer, "answer_source": source, "alts": alts or [], "explain": "讲解",
            "kps": kps, "wrong": [], "traps": traps or [], "difficulty": 2, "needs_image": False,
            "unsure": [], "tile": 1, "y0": 0.4, "y1": 0.5}


PAGE_ITEMS = [
    _mc("21", "He ___ football every day.", ["play", "plays", "playing", "is play"], "B", ["pres_3sg"],
        wrong=[{"option": "A", "code": "3sg.missing", "why": "主语是 He,动词要加 s"},
               {"option": "D", "code": "bedo.both", "why": "有了动作词就不要 is"}],
        title="Unit 1 综合能力测评卷", section="单项选择"),
    _mc("22", "There ___ much chicken in the fridge.", ["have", "is", "has", "are"], "B", ["there_be", "noun_plural"],
        wrong=[{"option": "A", "code": "there.have", "why": "有东西在某处要用 there is"}]),
    _mc("23", "They ___ to school by bus.", ["go", "goes", "going", "is go"], "A", ["pres_base"]),
    _mc("24", "—___ is your birthday? —Next Monday.", ["What", "Why", "When", "Where"], "C", ["wh_word"]),
    _mc("25", "I can't see the blackboard because two tall boys sit ___ me.",
        ["behind", "next to", "in front of", "across from"], "C", ["prep_place"]),
    _fill("56", "She ___ painting.", ["likes"], ["pres_3sg"], base="like",
          traps=[{"text": "like", "code": "3sg.missing", "why": "主语是 She,要加 s"}], section="用所给词的正确形式填空"),
    _fill("57", "We often read some ___ after school.", ["books"], ["noun_plural"], base="book"),
    _fill("58", "My sister and I ___ students.", ["are"], ["be"], base="be"),
]


def _tool_reply(items, keys=None, sections=None, is_key=False):
    inp = {"is_answer_key": is_key, "sections": sections or [], "items": items, "answer_keys": keys or []}
    return {"model": "claude-sonnet-5-5", "stop_reason": "tool_use",
            "content": [{"type": "thinking", "thinking": "", "signature": "x"},
                        {"type": "tool_use", "id": "t1", "name": pp.TOOL_NAME, "input": inp}],
            "usage": {"input_tokens": 9000, "output_tokens": 3000}}


class FakeRelay:
    def __init__(self, script):
        self.script = list(script)
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        status, payload = self.script.pop(0) if self.script else (500, {"error": "no more"})
        return httpx.Response(status, json=payload)


@pytest.fixture
def relay(monkeypatch):
    def install(script):
        fake = FakeRelay(script)
        monkeypatch.setattr(tt, "new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
        return fake

    reset_memory()
    yield install
    reset_memory()


@pytest.fixture
def env(db_session, monkeypatch, tmp_path):
    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(pp, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(pp, "INLINE", True)
    monkeypatch.setattr(pp, "PAPER_DIR", str(tmp_path / "paper_bank"))

    async def build(provider=True):
        tenancy._org_cache.clear()
        await db_session.execute(sql_text(
            "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
            "(1, '直营', 'HQ001', 'active', 'assigned'), (2, '分校', 'B002', 'active', 'assigned')"))
        users = {}
        for key, role, org in [("t", "teacher", 1), ("ot", "teacher", 2), ("a", "admin", 1),
                               ("s", "student", 1), ("s2", "student", 1), ("os", "student", 2)]:
            u = User(username=f"pb{key}", email=f"pb{key}@e.com", hashed_password="x", role=role,
                     full_name=f"名{key}", is_active=True, org_id=org)
            db_session.add(u)
            await db_session.flush()
            users[key] = u
        c = Class(name="七一班", teacher_id=users["t"].id, org_id=1)
        db_session.add(c)
        await db_session.flush()
        users["class"] = c
        for k in ("s", "s2"):
            db_session.add(ClassStudent(class_id=c.id, student_id=users[k].id, is_active=True))
        if provider:
            db_session.add(AIProvider(provider_name=pp.PROVIDER_NAME, display_name="拆卷专用",
                                      api_key=encrypt_api_key("sk-paper"), base_url="https://relay.example",
                                      model_name="claude-sonnet-5-5", enabled=True, is_default=False,
                                      extra_config={"fallback_model": "claude-sonnet-4-6"}))
        await db_session.commit()
        await pb.save_settings(db_session, {"scope": "hq"})     # 默认关着,试用期开直营
        await db_session.commit()
        return users

    return build


def _pdf(pages=1) -> bytes:
    import fitz
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((60, 80), f"Unit 1 test page {i + 1}", fontsize=16)
        for j in range(20):
            page.insert_text((60, 120 + j * 30), f"{21 + j}. He ___ football every day. A. play B. plays", fontsize=11)
    return doc.tobytes()


async def _upload(client, uid, raw=None, grade="初一", title="七上 Unit 1"):
    return await client.post("/api/v1/teacher/paper-bank/docs", headers=_h(uid),
                             data={"title": title, "grade": grade},
                             files={"file": ("u1.pdf", raw or _pdf(), "application/pdf")})


async def _bank(client, db, users, relay, items=None):
    """传一份、拆好、全部通过,返回 doc_id"""
    relay([(200, _tool_reply(items or PAGE_ITEMS))])
    r = await _upload(client, users["t"].id)
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    for it in (await db.execute(select(PaperItem).where(PaperItem.doc_id == doc_id))).scalars():
        it.status = "approved"
    await db.commit()
    return doc_id


# ---------------------------------------------------------------- 1. 切图

def _columns_image(w=3000, h=2200, cols=4):
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    cw = w / cols
    for c in range(cols):
        x0, x1 = int(c * cw + cw * 0.08), int((c + 1) * cw - cw * 0.08)
        for y in range(int(h * 0.1), int(h * 0.9), 40):
            d.rectangle([x0, y, x1, y + 14], fill="black")
    return img


def test_split_spread_into_columns_and_halves():
    tiles = ptl.split_page(_columns_image())
    # 横着的两页并排 → 左右两页 → 每页两栏 → 每栏上下两块
    assert len(tiles) == 8
    assert all(max(t.size) <= ptl.TILE_MAX for t in tiles)
    # 单栏竖着的作业纸: 不分栏,上下两块
    one = Image.new("RGB", (1200, 2400), "white")
    ImageDraw.Draw(one).rectangle([100, 200, 1100, 2200], fill="black")
    assert len(ptl.split_page(one)) == 2
    assert ptl.find_gutter(_columns_image(1500, 2200, 2)) == pytest.approx(0.5, abs=0.03)


def test_crop_item_keeps_padding():
    raw = ptl.to_jpeg(Image.new("RGB", (800, 1200), "white"))
    out = Image.open(io.BytesIO(ptl.crop_item(raw, 0.2, 0.4)))
    assert out.size[0] == 800 and 260 < out.size[1] < 320
    assert ptl.crop_item(raw, None, None) == raw


# ---------------------------------------------------------------- 2. 整理和合并

def test_normalize_maps_letters_codes_and_flags():
    x = pp.normalize_item(_mc("1", "He __ football.", ["A. play", "B. plays", "C. playing"], "plays", ["pres_3sg"],
                              wrong=[{"option": "A", "code": "bogus", "why": "w"},
                                     {"option": "B", "code": "3sg.missing", "why": "这是答案"}]), 8)
    # 选项去掉字母、答案按选项文字认出字母、空统一成 ___、错法不认识的算 other、正确选项不挂错法
    assert x["options"] == ["play", "plays", "playing"] and x["answer"] == "B" and "___" in x["stem"]
    assert x["wrong"] == {"A": {"code": "other", "why": "w"}}
    f = pp.normalize_item(_fill("2", "I ___ a boy and you ___ a girl.", ["am"], ["be"]), 8)
    assert any("2 个空" in fl for fl in f["flags"])
    bad = pp.normalize_item(_mc("3", "x y z", ["a"], "A", ["be"]), 8)
    assert bad is None                     # 一个选项的不是选择题


def test_merge_inherits_titles_dedupes_and_applies_answer_key():
    p1 = pp.normalize_page({"items": [
        _mc("21", "He ___ football.", ["play", "plays"], "A", ["pres_3sg"], title="1|Unit 1 综合能力测评卷",
            section="单项选择", source="ai"),
        _mc("22", "They ___ to school.", ["go", "goes"], "A", ["pres_base"]),
    ], "sections": [{"paper_title": "", "name": "阅读理解", "parsed": False, "reason": "第一版不拆"}]}, 8)
    p2 = pp.normalize_page({"items": [
        # 重叠处又拆了一次(题干更长的留下)
        _mc("22", "—Do they ___ to school by bus?", ["go", "goes"], "A", ["pres_base"]),
        _fill("56", "She ___ painting.", ["likes"], ["pres_3sg"], section="词形填空"),
        _mc("21", "Start of unit 2: I ___ a boy.", ["am", "is"], "A", ["be"], title="Unit 2 综合能力测评卷",
            section="单项选择"),
    ]}, 8)
    key = pp.normalize_page({"is_answer_key": True, "items": [], "answer_keys": [
        {"paper_title": "Unit 1 综合能力测评卷", "no": "21", "answer": ["B"]},
        {"paper_title": "Unit 1 综合能力测评卷", "no": "56", "answer": ["likes"]},
    ]}, 8)
    items, skipped = pp.merge("文件名", [(1, p1, {}), (2, p2, {}), (3, key, {})])
    by = {(pp.title_key(x["paper_title"]), x["no"]): x for x in items}
    assert len(items) == 4
    u1 = pp.title_key("Unit 1 综合能力测评卷")
    assert by[(u1, "22")]["stem"].startswith("—Do they")
    assert by[(u1, "56")]["section"] == "词形填空"
    assert by[(pp.title_key("Unit 2 综合能力测评卷"), "21")]["kps"] == ["be"]
    # 答案页和 AI 做的不一样: 用答案页的、标黄
    q21 = by[(u1, "21")]
    assert q21["answer"] == "B" and q21["answer_source"] == "key" and any("答案页" in f for f in q21["flags"])
    # 答案页对上了的不再标「AI 做的」
    assert not any("AI 做的" in f for f in by[(u1, "56")]["flags"])
    assert skipped and skipped[0]["name"] == "阅读理解"


def test_merge_untitled_restart_is_a_new_paper_not_duplicates():
    """11-25 真模型拆七上卷: Unit 5 第一页模型没写卷名 → 照前一道补成 Unit 4,题号又一样 → 被当成重复删掉"""
    p1 = pp.normalize_page({"items": [
        _mc(str(n), f"U4 q{n} He ___ football.", ["play", "plays"], "B", ["pres_3sg"],
            title="Unit 4 综合能力测评卷" if n == 21 else "", section="二、单项选择") for n in range(21, 31)]}, 8)
    p2 = pp.normalize_page({"items": [
        # 上一页最后两道在重叠处又拆了一次 → 照旧算重复
        _mc("29", "U4 q29 He ___ football.", ["play", "plays"], "B", ["pres_3sg"]),
        _mc("30", "U4 q30 He ___ football.", ["play", "plays"], "B", ["pres_3sg"]),
        *[_fill(str(n), f"U4 f{n} She ___ painting.", ["likes"], ["pres_3sg"], section="五、短文填空")
          for n in range(61, 71)]]}, 8)
    p3 = pp.normalize_page({"items": [   # Unit 5 第一页: 模型没写卷名
        _mc(str(n), f"U5 q{n} They ___ to school.", ["go", "goes"], "A", ["pres_base"], section="二、单项选择")
        for n in range(21, 31)]}, 8)
    p4 = pp.normalize_page({"items": [   # 同一套卷接着往下(大题名带括号说明)
        _fill(str(n), f"U5 f{n} I ___ a boy.", ["am"], ["be"], section="短文填空(接上一页)") for n in range(61, 66)]}, 8)
    items, _ = pp.merge("七上测评卷", [(9, p1, {}), (10, p2, {}), (11, p3, {}), (12, p4, {})])
    assert len(items) == 35
    titles = {x["paper_title"] for x in items}
    assert titles == {"Unit 4 综合能力测评卷", pp.untitled_paper(11)}
    u5 = [x for x in items if x["paper_title"] == pp.untitled_paper(11)]
    assert len(u5) == 15 and all(x["stem"].startswith("U5") for x in u5)
    # 按大题各自编号的练习(一、1–5 / 二、1–5)不算新的一套
    q = pp.normalize_page({"items": [
        *[_mc(str(n), f"a{n} He ___ it.", ["do", "does"], "B", ["pres_3sg"], title="Unit 1 练习", section="一、单项选择")
          for n in range(1, 6)],
        *[_fill(str(n), f"b{n} She ___ it.", ["likes"], ["pres_3sg"], section="二、词形填空") for n in range(1, 6)]]}, 8)
    items, _ = pp.merge("练习", [(1, q, {})])
    assert len(items) == 10 and {x["paper_title"] for x in items} == {"Unit 1 练习"}


def test_tag_words_test_vs_context():
    x = pp.normalize_item(_mc("1", "The teacher says science is very ___ because we learn a lot.",
                              ["useful", "easy", "boring"], "A", ["vocab_meaning"]), 8)
    test, ctx = pp.tag_words(x)
    assert "useful" in test and "teacher" in ctx and "the" not in ctx and "easy" in ctx


# ---------------------------------------------------------------- 3. Key 隔离

@pytest.mark.asyncio
async def test_paper_key_never_default_or_used_elsewhere(client, db_session, env):
    u = await env()
    row = (await db_session.execute(select(AIProvider).where(AIProvider.provider_name == pp.PROVIDER_NAME))).scalar_one()
    row.is_default = True          # 就算库里被手改成默认
    await db_session.commit()
    picked = await ai_service.ai_service._get_default_provider(db_session) if hasattr(
        ai_service.ai_service, "_get_default_provider") else None
    assert picked is None or getattr(picked, "provider_name", None) != pp.PROVIDER_NAME
    from app.api.v1.admin import ai_config
    assert pp.PROVIDER_NAME in ai_config.DEDICATED_PROVIDERS
    src = open(ai_service.__file__, encoding="utf-8").read()
    assert src.count('"claude_paper"') >= 3


@pytest.mark.asyncio
async def test_admin_blank_key_keeps_secret(client, db_session, env):
    u = await env()
    r = await client.put("/api/v1/teacher/paper-bank/admin", headers=_h(u["a"].id), json={"api_key": "", "quiz_size": 8})
    assert r.status_code == 200 and r.json()["settings"]["quiz_size"] == 8
    conf = await pp.relay_conf(db_session)
    assert conf is not None and conf.api_key == "sk-paper"
    # 老师改不了
    assert (await client.put("/api/v1/teacher/paper-bank/admin", headers=_h(u["t"].id), json={"quiz_size": 6})).status_code == 403


# ---------------------------------------------------------------- 4. 上传 → 拆 → 核对

@pytest.mark.asyncio
async def test_upload_parse_review_flow(client, db_session, env, relay):
    u = await env()
    fake = relay([(200, _tool_reply(PAGE_ITEMS, sections=[
        {"paper_title": "", "name": "完形填空", "parsed": False, "reason": "第一版不拆"}]))])
    raw = _pdf()
    r = await _upload(client, u["t"].id, raw)
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    body = fake.requests[0]
    assert body["tools"][0]["strict"] is True and body["thinking"] == {"type": "adaptive"}
    assert any(b["type"] == "image" for b in body["messages"][0]["content"])
    d = (await client.get(f"/api/v1/teacher/paper-bank/docs/{doc_id}", headers=_h(u["t"].id))).json()
    assert d["status"] == "review" and d["item_count"] == len(PAGE_ITEMS) and d["skipped"][0]["name"] == "完形填空"
    # 原文件拆完就删了,只留小图
    assert not any(n.startswith("source.") for n in __import__("os").listdir(pp.doc_dir(doc_id)))
    items = {i["no"]: i for i in d["items"] if True}
    assert items["21"]["paper_title"] == "Unit 1 综合能力测评卷" and items["22"]["section"] == "单项选择"
    assert items["21"]["test_words"] == ["play"] or "play" in items["21"]["test_words"]
    # AI 自己做的答案标黄,不能一键通过
    assert any("AI 做的" in f for f in items["56"]["flags"])
    r = await client.post(f"/api/v1/teacher/paper-bank/docs/{doc_id}/approve-clean", headers=_h(u["t"].id))
    assert r.json()["approved"] == 5          # 5 道卷面上标了答案的选择题
    # 改一道标黄的: 改完自动通过,标黄清掉
    r = await client.put(f"/api/v1/teacher/paper-bank/items/{items['56']['id']}", headers=_h(u["t"].id),
                         json={"answer": "likes", "alts": ["likes"]})
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["flags"] == []
    assert r.json()["answer_source"] == "ai"          # 答案没变(只是原样带回来): 不算老师改过答案
    r = await client.put(f"/api/v1/teacher/paper-bank/items/{items['56']['id']}", headers=_h(u["t"].id),
                         json={"answer": "Likes"})
    assert r.json()["answer_source"] == "edited"
    # 答案和空对不上的改不了
    r = await client.put(f"/api/v1/teacher/paper-bank/items/{items['57']['id']}", headers=_h(u["t"].id),
                         json={"answer": ["books", "pens"]})
    assert r.status_code == 400
    # 别的机构的老师看不到(开放给所有机构时也看不到: 按机构过滤,不是靠试用范围挡着)
    await pb.save_settings(db_session, {"scope": "all"})
    await db_session.commit()
    assert (await client.get(f"/api/v1/teacher/paper-bank/docs/{doc_id}", headers=_h(u["ot"].id))).status_code == 404
    assert (await client.get(f"/api/v1/teacher/paper-bank/items/{items['21']['id']}/image",
                             headers=_h(u["ot"].id))).status_code == 404
    assert (await client.get("/api/v1/teacher/paper-bank/docs", headers=_h(u["ot"].id))).json()["items"] == []
    # 整套改卷名: 只改这份文件里这一套;别的机构的老师改不了
    ren = {"old": "Unit 1 综合能力测评卷", "new": "  Unit 1  测评卷 "}
    assert (await client.post(f"/api/v1/teacher/paper-bank/docs/{doc_id}/rename-paper", headers=_h(u["ot"].id),
                              json=ren)).status_code == 404
    r = await client.post(f"/api/v1/teacher/paper-bank/docs/{doc_id}/rename-paper", headers=_h(u["t"].id), json=ren)
    assert r.status_code == 200 and r.json() == {"renamed": len(PAGE_ITEMS), "paper_title": "Unit 1 测评卷"}
    r = await client.post(f"/api/v1/teacher/paper-bank/docs/{doc_id}/rename-paper", headers=_h(u["t"].id),
                          json={"old": "Unit 1 测评卷", "new": "   "})
    assert r.status_code == 400
    await pb.save_settings(db_session, {"scope": "hq"})
    await db_session.commit()
    # 同一份文件不重复拆
    r = await _upload(client, u["t"].id, raw)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "duplicate"


@pytest.mark.asyncio
async def test_upload_needs_grade_and_configured_ai(client, db_session, env, relay):
    u = await env(provider=False)
    r = await _upload(client, u["t"].id)
    assert r.status_code == 409 and "Key" in r.json()["detail"]


@pytest.mark.asyncio
async def test_failed_page_can_be_retried(client, db_session, env, relay):
    u = await env()
    relay([(503, {"error": "No available accounts"}), (503, {"error": "No available accounts"}),
           (503, {"error": "busy"}), (503, {"error": "busy"})])
    doc_id = (await _upload(client, u["t"].id)).json()["id"]
    d = await db_session.get(PaperDoc, doc_id)
    assert d.status == "failed"
    reset_memory()                 # 「没号」的 5 分钟记号清掉
    relay([(200, _tool_reply(PAGE_ITEMS))])
    r = await client.post(f"/api/v1/teacher/paper-bank/docs/{doc_id}/retry", headers=_h(u["t"].id))
    assert r.status_code == 200
    await db_session.refresh(d)
    assert d.status == "review" and (await pb.doc_counts(db_session, [doc_id]))[doc_id]["total"] == len(PAGE_ITEMS)


# ---------------------------------------------------------------- 5. 判分

def _item(**kw):
    base = dict(id=1, doc_id=1, kind="mc", stem="He ___ football.", options=["play", "plays", "playing", "is play"],
                answer="B", alts=[], wrong={"A": {"code": "3sg.missing", "why": "要加 s"}}, traps=[],
                kps=["pres_3sg"], difficulty=0.0, n_answers=0, n_correct=0, test_words=["play"], context_words=["football"])
    base.update(kw)
    return PaperItem(**base)


def test_grade_mc_and_fill():
    it = _item()
    assert pb.grade(it, "b")[0] is True
    ok, code, why, shown = pb.grade(it, "A")
    assert ok is False and code == "3sg.missing" and why == "要加 s" and shown == "A"
    f = _item(kind="fill", stem="She ___ (not like) it.", options=None, answer=["doesn't like"],
              alts=[["does not like"]], traps=[{"text": "don't like", "code": "doq.helper", "why": "she 用 doesn't"}],
              kps=["do_neg_q"])
    assert pb.grade(f, ["Doesn’t like"])[0] is True          # 弯撇号、大小写不算错
    assert pb.grade(f, ["does not like."])[0] is True        # 全写、句末标点也算对
    ok, code, why, _ = pb.grade(f, ["don't like"])
    assert ok is False and code == "doq.helper"


# ---------------------------------------------------------------- 6. 把握度

@pytest.mark.asyncio
async def test_mastery_updates_and_word_drag(db_session, env):
    u = await env()
    sid = u["s"].id
    today = date(2026, 11, 22)
    now = datetime(2026, 11, 22, 4, 0)
    it = _item()
    db_session.add(it)
    await db_session.flush()
    p0 = await pb.apply_answer(db_session, sid, it, True, None, False, now=now, today=today)
    m = (await pb.mastery_of(db_session, sid))["pres_3sg"]
    t_right = m.theta
    assert t_right > 0 and 0.25 < p0 < 1 and m.stage == 1
    # 四选一能蒙对: 选择题做对加得比填空少
    f = _item(id=2, kind="fill", options=None, answer=["plays"], kps=["be"])
    db_session.add(f)
    await db_session.flush()
    await pb.apply_answer(db_session, sid, f, True, None, False, now=now, today=today)
    assert (await pb.mastery_of(db_session, sid))["be"].theta > t_right
    # 题里有他没掌握的词又做错了: 语法这边少扣
    a = _item(id=3, kps=["wh_word"])
    b = _item(id=4, kps=["article"])
    db_session.add_all([a, b])
    await db_session.flush()
    await pb.apply_answer(db_session, sid, a, False, "other", True, now=now, today=today)
    await pb.apply_answer(db_session, sid, b, False, "other", False, now=now, today=today)
    ms = await pb.mastery_of(db_session, sid)
    assert ms["wh_word"].theta < 0 and ms["article"].theta < ms["wh_word"].theta
    # 回头考: 没到期做对不升级,到期那天做对才升
    assert m.due == (today + timedelta(days=3)).isoformat()
    await pb.apply_answer(db_session, sid, it, True, None, False, now=now, today=today + timedelta(days=1))
    assert m.stage == 1
    await pb.apply_answer(db_session, sid, it, True, None, False, now=now, today=today + timedelta(days=3))
    assert m.stage == 2
    # 做错回到明天
    await pb.apply_answer(db_session, sid, it, False, "3sg.missing", False, now=now, today=today + timedelta(days=4))
    assert m.stage == 0 and m.due == (today + timedelta(days=5)).isoformat() and m.codes["3sg.missing"] == 1


# ---------------------------------------------------------------- 7. 组卷

def _pool(n_per_kp=4):
    pool, i = [], 100
    for k in ("pres_3sg", "pres_base", "be", "there_be", "noun_plural", "wh_word", "prep_time", "article"):
        for j in range(n_per_kp):
            i += 1
            pool.append(_item(id=i, kps=[k], test_words=[f"w{i}"], difficulty=0.0))
    return pool


def test_pick_quiz_diagnose_then_targets_weak_point():
    now = datetime(2026, 11, 22, 4, 0)
    today = date(2026, 11, 22)
    pool = _pool()
    picked, mode = pb.pick_quiz(pool, set(), {}, {}, today, now, 10, seed=1)
    kps = [x["kp"] for x in picked]
    diag = [x["kp"] for x in picked if x["why"] == "diagnose"]
    assert mode == "diagnose" and len(picked) == 10 and len(diag) == 7 and len(set(diag)) == 7
    # 同一个点不连着出
    assert all(a["kp"] != b["kp"] for a, b in zip(picked, picked[1:])) or len(set(kps)) == 1
    # 三单总错: 出三单 + 「不加 s」的对比题;他薄弱的词出现在题里
    mastery = {k: PaperKpMastery(user_id=1, kp=k, theta=1.0, n=5, right=5, stage=1, due="2026-12-30",
                                 last_at=now, codes={}) for k in ("be", "there_be", "noun_plural", "wh_word",
                                                                  "prep_time", "article", "pres_base")}
    mastery["pres_3sg"] = PaperKpMastery(user_id=1, kp="pres_3sg", theta=-1.5, n=6, right=1, stage=0,
                                         due="2026-11-23", last_at=now, codes={"3sg.missing": 3})
    weak_item = next(it for it in pool if it.kps == ["article"])
    picked, mode = pb.pick_quiz(pool, set(), mastery, {weak_item.test_words[0]: "apple"}, today, now, 10, seed=2)
    whys = [(x["why"], x["kp"]) for x in picked]
    assert mode == "daily"
    assert sum(1 for w, k in whys if w == "weak_kp" and k == "pres_3sg") == 2
    assert ("contrast", "pres_base") in whys
    assert any(x["id"] == weak_item.id and x["why"] == "weak_word" for x in picked)
    # 做过的题不再出
    done = {x["id"] for x in picked}
    again, _ = pb.pick_quiz(pool, done, mastery, {}, today, now, 10, seed=3)
    assert not done & {x["id"] for x in again}


@pytest.mark.asyncio
async def test_candidates_only_approved_own_org_and_grade(db_session, env):
    u = await env()
    d1 = PaperDoc(org_id=1, title="a", grade="初一", status="review")
    d2 = PaperDoc(org_id=2, title="b", grade="初一", status="review")
    d3 = PaperDoc(org_id=1, title="c", grade="初三", status="review")
    db_session.add_all([d1, d2, d3])
    await db_session.flush()
    rows = [PaperItem(doc_id=d1.id, org_id=1, grade="初一", kind="mc", stem="x ___", options=["a", "b"], answer="A",
                      kps=["be"], status="approved"),
            PaperItem(doc_id=d1.id, org_id=1, grade="初一", kind="mc", stem="y ___", options=["a", "b"], answer="A",
                      kps=["be"], status="pending"),
            PaperItem(doc_id=d2.id, org_id=2, grade="初一", kind="mc", stem="z ___", options=["a", "b"], answer="A",
                      kps=["be"], status="approved"),
            PaperItem(doc_id=d3.id, org_id=1, grade="初三", kind="mc", stem="w ___", options=["a", "b"], answer="A",
                      kps=["be"], status="approved"),
            PaperItem(doc_id=d1.id, org_id=1, grade="初一", kind="mc", stem="v ___", options=["a", "b"], answer="A",
                      kps=["common_sense"], status="approved")]
    db_session.add_all(rows)
    await db_session.commit()
    got = await pb.candidates(db_session, 1, pb.grade_rank("初一"))
    assert [it.stem for it in got] == ["x ___"]          # 没核对的、别家机构的、年级高的、不考英语的都不出
    assert len(await pb.candidates(db_session, 1, None)) == 2


# ---------------------------------------------------------------- 8. 孩子做小卷

async def _checkin(client, uid):
    r = await client.post("/api/v1/student/checkin", headers=_h(uid))
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_student_quiz_hides_answers_counts_first_answer(client, db_session, env, relay):
    u = await env()
    await _bank(client, db_session, u, relay)
    s = u["s"]
    assert (await client.post("/api/v1/student/paper-quiz/today", headers=_h(s.id))).status_code == 403   # 先签到
    await _checkin(client, s.id)
    r = await client.post("/api/v1/student/paper-quiz/today", headers=_h(s.id))
    assert r.status_code == 200, r.text
    quiz = r.json()
    text = json.dumps(quiz, ensure_ascii=False)
    assert quiz["total"] == len(PAGE_ITEMS) and "讲解" not in text and '"answer"' not in text
    qid = quiz["id"]
    # 再打开还是同一份
    assert (await client.post("/api/v1/student/paper-quiz/today", headers=_h(s.id))).json()["id"] == qid
    first = quiz["items"][0]
    ans = "Z" if first["kind"] == "mc" else ["zzz"]
    r1 = (await client.post(f"/api/v1/student/paper-quiz/{qid}/answer", headers=_h(s.id),
                            json={"item_id": first["id"], "answer": ans, "ms": 4000})).json()
    assert r1["first"] is True and r1["result"]["correct"] is False and r1["result"]["answer_text"]
    # 改答案再交: 还是第一次的结果
    it = await db_session.get(PaperItem, first["id"])
    right = it.answer if it.kind == "mc" else list(it.answer)
    r2 = (await client.post(f"/api/v1/student/paper-quiz/{qid}/answer", headers=_h(s.id),
                            json={"item_id": first["id"], "answer": right})).json()
    assert r2["first"] is False and r2["result"]["correct"] is False
    # 不在他小卷里的题交不了;别人的小卷交不了
    other = PaperItem(doc_id=it.doc_id, org_id=1, kind="mc", stem="q ___", options=["a", "b"], answer="A", kps=["be"],
                      status="approved")
    db_session.add(other)
    await db_session.commit()
    assert (await client.post(f"/api/v1/student/paper-quiz/{qid}/answer", headers=_h(s.id),
                              json={"item_id": other.id, "answer": "A"})).status_code == 400
    assert (await client.post(f"/api/v1/student/paper-quiz/{qid}/answer", headers=_h(u["s2"].id),
                              json={"item_id": first["id"], "answer": "A"})).status_code == 400
    # 做完: 小卷标完成,把握度记上
    for x in quiz["items"][1:]:
        it = await db_session.get(PaperItem, x["id"])
        await client.post(f"/api/v1/student/paper-quiz/{qid}/answer", headers=_h(s.id),
                          json={"item_id": x["id"], "answer": it.answer if it.kind == "mc" else list(it.answer)})
    q = await db_session.get(PaperQuiz, qid)
    await db_session.refresh(q)
    assert q.status == "done" and q.right == len(PAGE_ITEMS) - 1
    rows = (await db_session.execute(select(PaperKpMastery).where(PaperKpMastery.user_id == s.id))).scalars().all()
    assert {m.kp for m in rows} >= {"pres_3sg", "noun_plural", "be"}
    summary = (await client.get(f"/api/v1/student/paper-quiz/{qid}/summary", headers=_h(s.id))).json()
    assert summary["points"] and "弱" not in json.dumps(summary, ensure_ascii=False)


@pytest.mark.asyncio
async def test_other_org_student_gets_no_quiz(client, db_session, env, relay):
    u = await env()
    await _bank(client, db_session, u, relay)
    pb_settings = await pb.save_settings(db_session, {"scope": "all"})
    await db_session.commit()
    assert pb_settings["scope"] == "all"
    await _checkin(client, u["os"].id)
    r = await client.post("/api/v1/student/paper-quiz/today", headers=_h(u["os"].id))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "no_bank"


@pytest.mark.asyncio
async def test_scope_hq_blocks_other_org(client, db_session, env):
    u = await env()
    r = await client.get("/api/v1/student/paper-quiz/status", headers=_h(u["os"].id))
    assert r.json()["enabled"] is False
    assert (await client.get("/api/v1/teacher/paper-bank/docs", headers=_h(u["ot"].id))).status_code == 403


# ---------------------------------------------------------------- 9. 布置成作业 / 老师看全班 / 打印

@pytest.mark.asyncio
async def test_homework_completes_when_quiz_done_and_class_view(client, db_session, env, relay):
    u = await env()
    await _bank(client, db_session, u, relay)
    t, s = u["t"], u["s"]
    r = await client.post("/api/v1/teacher/content-homework", headers=_h(t.id),
                          json={"kind": KIND_PAPER_QUIZ, "target_ids": [7], "student_ids": [s.id], "days": 2})
    assert r.status_code == 200, r.text
    hw = (await client.get("/api/v1/student/content-homework", headers=_h(s.id))).json()
    today_hw = [h for h in hw if h["kind"] == KIND_PAPER_QUIZ and h["status"] == "pending"]
    assert today_hw and today_hw[0]["route"] == "/student/paper-quiz" and "初一" in today_hw[0]["target_name"]
    await _checkin(client, s.id)
    quiz = (await client.post("/api/v1/student/paper-quiz/today", headers=_h(s.id))).json()
    for x in quiz["items"]:
        it = await db_session.get(PaperItem, x["id"])
        await client.post(f"/api/v1/student/paper-quiz/{quiz['id']}/answer", headers=_h(s.id),
                          json={"item_id": x["id"], "answer": it.answer if it.kind == "mc" else list(it.answer)})
    hw = (await client.get("/api/v1/student/content-homework", headers=_h(s.id))).json()
    assert any(h["kind"] == KIND_PAPER_QUIZ and h["status"] == "completed" for h in hw)
    view = (await client.get(f"/api/v1/teacher/paper-bank/class/{u['class'].id}", headers=_h(t.id))).json()
    assert view["class"]["students"] == 2 and any(k["kp"] == "pres_3sg" for k in view["kps"])
    me = next(p for p in view["students"] if p["id"] == s.id)
    assert me["today"]["status"] == "done" and me["answered"] >= len(PAGE_ITEMS)
    # 别人的班看不到
    await pb.save_settings(db_session, {"scope": "all"})
    await db_session.commit()
    assert (await client.get(f"/api/v1/teacher/paper-bank/class/{u['class'].id}", headers=_h(u["ot"].id))).status_code == 404
    await pb.save_settings(db_session, {"scope": "hq"})
    await db_session.commit()
    # 打印: 每个孩子一份,教师版带答案
    pr = (await client.post("/api/v1/teacher/paper-bank/print", headers=_h(t.id),
                            json={"class_id": u["class"].id})).json()
    assert len(pr["papers"]) == 2 and pr["papers"][0]["items"][0]["answer_text"]


@pytest.mark.asyncio
async def test_weak_words_come_from_word_learning(db_session, env):
    u = await env()
    sid = u["s"].id
    w1 = Word(word="apples")
    w2 = Word(word="useful")
    db_session.add_all([w1, w2])
    await db_session.flush()
    db_session.add_all([
        LearningRecord(user_id=sid, word_id=w1.id, learning_mode="spelling", is_correct=False),
        LearningRecord(user_id=sid, word_id=w2.id, learning_mode="spelling", is_correct=False),
        WordMastery(user_id=sid, word_id=w2.id, mastery_level=4),
    ])
    await db_session.commit()
    weak = await pb.weak_word_stems(db_session, sid)
    assert "appl" in weak or "apple" in weak             # 词形归一(apples → apple 的词干)
    assert not any(v == "useful" for v in weak.values())   # 已经掌握的不算


@pytest.mark.asyncio
async def test_concurrent_second_submit_does_not_double_count(client, db_session, env, relay, monkeypatch):
    """两台设备同时交同一题: 另一台先写进去了,这一次什么都不记(把握度不算两遍)"""
    u = await env()
    await _bank(client, db_session, u, relay)
    s = u["s"]
    await _checkin(client, s.id)
    quiz = (await client.post("/api/v1/student/paper-quiz/today", headers=_h(s.id))).json()
    first = quiz["items"][0]
    real = pb.weak_word_stems

    async def other_device_wins(db, uid, limit=pb.WEAK_WORDS_MAX):
        db.add(PaperAnswer(user_id=uid, quiz_id=quiz["id"], item_id=first["id"], answer="Z", correct=False, code="other"))
        await db.flush()
        return await real(db, uid, limit)

    monkeypatch.setattr(pb, "weak_word_stems", other_device_wins)
    it = await db_session.get(PaperItem, first["id"])
    r = (await client.post(f"/api/v1/student/paper-quiz/{quiz['id']}/answer", headers=_h(s.id),
                           json={"item_id": first["id"], "answer": it.answer if it.kind == "mc" else list(it.answer)})).json()
    assert r["first"] is False and r["result"]["correct"] is False
    rows = (await db_session.execute(select(PaperKpMastery).where(PaperKpMastery.user_id == s.id))).scalars().all()
    assert sum(m.n for m in rows) == 0



@pytest.mark.asyncio
async def test_off_by_default(client, db_session):
    """没设过 = 关着(上线后平台管理员填好 Key、试拆没问题再打开)"""
    assert (await pb.get_settings(db_session))["scope"] == "off"
    assert pb.scope_allows("off", 1) is False and pb.scope_allows("hq", 1) is True and pb.scope_allows("hq", 2) is False


@pytest.mark.asyncio
async def test_uses_tutor_key_unless_own_key(client, db_session, env, relay):
    """用户 11-25: 拆卷和小鹰老师用同一个 Key;管理端另填了拆卷专用的就用那个"""
    u = await env(provider=False)
    assert await pp.relay_conf(db_session) is None
    assert (await _upload(client, u["t"].id)).status_code == 409
    db_session.add(AIProvider(provider_name=tt.PROVIDER_NAME, display_name="学习助手专用",
                              api_key=encrypt_api_key("sk-tutor"), base_url="https://tutor-relay.example/v1",
                              model_name="claude-sonnet-5-5", enabled=True, is_default=False,
                              extra_config={"fallback_model": "claude-sonnet-4-6"}))
    await db_session.commit()
    conf = await pp.relay_conf(db_session)
    assert conf.api_key == "sk-tutor" and conf.base_url == "https://tutor-relay.example"
    assert conf.chain("fast") == [pp.DEFAULT_MODEL, pp.DEFAULT_FALLBACK]
    assert await pp.key_source(db_session) == "tutor"
    # 只改模型(不填 Key): 仍用小鹰老师的 Key
    r = await client.put("/api/v1/teacher/paper-bank/admin", headers=_h(u["a"].id),
                         json={"model": "claude-opus-5-5", "fallback_model": ""})
    assert r.status_code == 200 and r.json()["provider"]["source"] == "tutor"
    conf = await pp.relay_conf(db_session)
    assert conf.api_key == "sk-tutor" and conf.chain("fast") == ["claude-opus-5-5"]
    # 填了拆卷专用的 Key: 用它
    r = await client.put("/api/v1/teacher/paper-bank/admin", headers=_h(u["a"].id), json={"api_key": "sk-paper-own"})
    assert r.json()["provider"]["source"] == "paper"
    assert (await pp.relay_conf(db_session)).api_key == "sk-paper-own"
    # 拆卷那一行永远不当默认
    row = await pp.provider_row(db_session)
    assert row.is_default is False or row.is_default == 0
    fake = relay([(200, _tool_reply(PAGE_ITEMS))])
    assert (await _upload(client, u["t"].id)).status_code == 200
    assert fake.requests and fake.requests[0]["model"] == "claude-opus-5-5"
