"""学习助手画记忆图(services/word_picture)+ 学情档案(services/tutor_profile),2026-10-27

锁住的规矩:
1. 画图 Key 只给学习助手: image_tutor 行不能设默认,默认通道 / OCR 都看不见它
2. 一个词全平台只画一张: 第一个人扣 1 次;再点(自己或别人)不扣、拿同一张;正在画时别人点也不扣
3. 没画出来退回次数和当天张数;卡住(进程重启)的下一个人点会重画,并退回上一次扣的
4. 每人每天最多画 N 张新图;次数不够画不了(不留半截记录)
5. 没配画图 Key 时不把 draw_word_picture 给模型
6. 学情档案: 只放这个孩子自己的数据;老师点评里的孩子名字换成「你」;拼写毛病和诊断页同一份判据
7. 助手工具 draw_word_picture 能出图片卡,刷新对话时卡片是最新状态
"""
import asyncio
import base64
import io
import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, text as sql_text

from app.api.v1 import tutor as tutor_api
from app.api.v1.admin.ai_config import encrypt_api_key
from app.models.learning import LearningRecord
from app.models.system_config import AIProvider
from app.models.tutor import TutorAllowance, WordPicture
from app.models.word import Word, WordDefinition
from app.services import tutor as tt
from app.services import tutor_profile, word_picture as wp
from tests.test_tutor import _ask, _env, _h, _text_reply, _tool_call, relay, shared_session  # noqa: F401


def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (250, 200, 50)).save(buf, "PNG")
    return buf.getvalue()


class FakeImages:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(json.loads(request.content))
        if self.fail:
            return httpx.Response(503, json={"error": {"message": "No available accounts"}})
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(_png()).decode()}]})


@pytest.fixture
def images(monkeypatch, tmp_path, db_session):
    holder = {}

    def install(fail=False):
        fake = FakeImages(fail)
        holder["f"] = fake
        monkeypatch.setattr(wp, "new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
        return fake

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(wp, "session_factory", lambda: _Ctx())
    monkeypatch.setattr(wp.settings, "UPLOAD_DIR", str(tmp_path))
    # 测试里所有请求共用一个会话,后台画图和下一个请求同时用它会撞(生产各开各的会话,没这个问题):
    # 开画先记下来,_wait_tasks() 时按顺序画完
    _PENDING.clear()
    monkeypatch.setattr(wp, "_spawn", lambda pid, prompt: _PENDING.append((pid, prompt)))
    from app.core.shared_store import reset_memory
    reset_memory()      # 每天画几张记在共享存储里,上一个用例的计数别带过来
    yield install
    reset_memory()


async def _picture_env(db, *, key=True):
    users = await _env(db)
    if key:
        db.add(AIProvider(provider_name=wp.PROVIDER_NAME, display_name="画记忆图", api_key=encrypt_api_key("sk-img-secret"),
                          base_url="https://img.example", model_name="gpt-image-2.5-sunburst",
                          enabled=True, is_default=False, extra_config={"quality": "low"}))
    w = Word(word="elephant", phonetic="/ˈelɪfənt/")
    db.add(w)
    await db.flush()
    db.add(WordDefinition(word_id=w.id, meaning="n. 大象", is_primary=True))
    await db.commit()
    return users, w


_PENDING: list = []


async def _wait_tasks():
    while _PENDING:
        pid, prompt = _PENDING.pop(0)
        await wp._generate(pid, prompt)


async def _used(db, uid):
    row = await db.get(TutorAllowance, uid)
    if row is None:
        return 0
    await db.refresh(row)
    return row.used


# ---------------------------------------------------------------- 1. Key 隔离

@pytest.mark.asyncio
async def test_picture_key_never_default(client, db_session, monkeypatch):
    users, _ = await _picture_env(db_session)
    row = (await db_session.execute(select(AIProvider).where(AIProvider.provider_name == wp.PROVIDER_NAME))).scalar_one()
    r = await client.put(f"/api/v1/admin/ai/providers/{row.id}", json={"is_default": True}, headers=_h(users["a"].id))
    assert r.status_code == 400
    # 库里被手改成默认,周报那些也拿不到
    await db_session.execute(sql_text("UPDATE ai_providers SET is_default = 0"))
    await db_session.execute(sql_text("UPDATE ai_providers SET is_default = 1, extra_config = :e WHERE provider_name = :p"),
                             {"p": wp.PROVIDER_NAME, "e": json.dumps({"ocr_model": "x"})})
    await db_session.commit()
    db_session.expire_all()     # 上面那行是裸 SQL,会话里缓存的那一行还是旧的 extra_config
    from app.services import ai_service as ais

    async def fake_get_db():
        yield db_session

    monkeypatch.setattr("app.core.database.get_db", fake_get_db)
    cfg = await ais.ai_service._get_ai_config()
    assert cfg is None or cfg.get("api_key") != "sk-img-secret"
    ocr = await ais.ai_service._get_ocr_config()
    assert not ocr or ocr.get("api_key") != "sk-img-secret"


# ---------------------------------------------------------------- 2. 一个词一张

@pytest.mark.asyncio
async def test_one_picture_per_word_first_one_pays(client, db_session, images, shared_session):
    users, w = await _picture_env(db_session)
    fake = images()
    s, s2 = users["s"].id, users["s2"].id
    r = await client.get(f"/api/v1/student/tutor/pictures/word/{w.id}", headers=_h(s))
    assert r.json()["exists"] is False and r.json()["enabled"] is True
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s))
    assert r.status_code == 200 and r.json()["charged"] == 1 and r.json()["status"] == "pending"
    pid = r.json()["pic_id"]
    # 正在画时别人点: 不扣,同一张
    r2 = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s2))
    assert r2.json()["charged"] == 0 and r2.json()["pic_id"] == pid
    await _wait_tasks()
    r = await client.get(f"/api/v1/student/tutor/pictures/{pid}", headers=_h(s2))
    assert r.json()["status"] == "ready" and r.json()["url"].startswith(wp.URL_PREFIX)
    # 画好之后再点: 不扣
    r3 = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s))
    assert r3.json()["charged"] == 0 and r3.json()["status"] == "ready"
    assert await _used(db_session, s) == 1 and await _used(db_session, s2) == 0
    assert len(fake.calls) == 1
    body = fake.calls[0]
    assert body["model"] == "gpt-image-2.5-sunburst" and body["quality"] == "low"
    assert "elephant" in body["prompt"] and "大象" in body["prompt"]
    assert "孩子s" not in body["prompt"]          # 不带孩子信息
    # 存的是压过的 JPEG
    name = r.json()["url"][len(wp.URL_PREFIX):].split("?")[0]
    import os
    raw = open(os.path.join(wp.settings.UPLOAD_DIR, wp.SUBDIR, name), "rb").read()
    assert raw[:3] == b"\xff\xd8\xff"


@pytest.mark.asyncio
async def test_failed_picture_refunds_and_can_retry(client, db_session, images, shared_session):
    users, w = await _picture_env(db_session)
    images(fail=True)
    s = users["s"].id
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s))
    pid = r.json()["pic_id"]
    await _wait_tasks()
    r = await client.get(f"/api/v1/student/tutor/pictures/{pid}", headers=_h(s))
    assert r.json()["status"] == "failed" and "没扣次数" in r.json()["error"]
    assert await _used(db_session, s) == 0
    # 再点: 重画(扣 1 次)
    images()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s))
    assert r.json()["charged"] == 1 and r.json()["pic_id"] == pid
    await _wait_tasks()
    assert await _used(db_session, s) == 1


@pytest.mark.asyncio
async def test_stale_pending_redrawn_and_previous_refunded(client, db_session, images, shared_session):
    users, w = await _picture_env(db_session)
    images()
    s, s2 = users["s"].id, users["s2"].id
    # s 扣了 1 次开画,进程重启没画完(模拟: 直接改成很久以前开画的 pending,没有后台任务)
    await tt.consume(db_session, s, 1, 20)
    db_session.add(WordPicture(pic_key=wp.pic_key("elephant", "n. 大象"), word="elephant", meaning="n. 大象",
                               status="pending", requested_by=s, charged=1,
                               started_at=tt.utc_now() - timedelta(seconds=wp.STALE_SEC + 5)))
    await db_session.commit()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(s2))
    assert r.json()["charged"] == 1
    await _wait_tasks()
    assert await _used(db_session, s) == 0       # 上一次退回了
    assert await _used(db_session, s2) == 1


@pytest.mark.asyncio
async def test_daily_limit_and_not_enough_times(client, db_session, images, shared_session):
    users, _ = await _picture_env(db_session)
    images()
    s = users["s"].id
    await wp.save_settings(db_session, True, 2)
    ids = []
    for sp in ("apple", "banana", "cherry"):
        w = Word(word=sp)
        db_session.add(w)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=w.id, meaning=f"n. {sp}", is_primary=True))
        ids.append(w.id)
    await db_session.commit()
    for wid in ids[:2]:
        assert (await client.post("/api/v1/student/tutor/pictures", json={"word_id": wid}, headers=_h(s))).status_code == 200
        await _wait_tasks()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": ids[2]}, headers=_h(s))
    assert r.status_code == 429 and "今天已经画了 2 张" in r.json()["detail"]
    await _wait_tasks()
    # 次数不够: 不留半截记录
    await wp.save_settings(db_session, True, 10)
    await db_session.execute(sql_text("UPDATE tutor_allowances SET used = 20 WHERE user_id = :u"), {"u": s})
    await db_session.commit()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": ids[2]}, headers=_h(s))
    assert r.status_code == 429 and "次数不够" in r.json()["detail"]
    assert (await wp.lookup(db_session, "cherry", "n. cherry")) is None


@pytest.mark.asyncio
async def test_no_picture_key_means_no_tool(client, db_session, relay, shared_session):
    users, _ = await _picture_env(db_session, key=False)
    fake = relay([(200, _text_reply("好"))])
    await _ask(client, users["s"].id)
    assert "draw_word_picture" not in [t["name"] for t in fake.requests[0]["tools"]]
    st = (await client.get("/api/v1/student/tutor/status", headers=_h(users["s"].id))).json()
    assert st["picture_enabled"] is False


@pytest.mark.asyncio
async def test_tutor_tool_draws_picture_card(client, db_session, relay, images, shared_session):
    users, w = await _picture_env(db_session)
    images()
    fake = relay([(200, _tool_call("draw_word_picture", {"word": "Elephant", "idea": "大象鼻子卷着 e 字母气球"})),
                  (200, _text_reply("图在画,先记住 e 开头。"))])
    r, events = await _ask(client, users["s"].id, "elephant 好难记")
    assert "draw_word_picture" in [t["name"] for t in fake.requests[0]["tools"]]
    cards = [e["card"] for e in events if e["type"] == "card"]
    assert cards and cards[0]["type"] == "picture" and cards[0]["word"] == "elephant"
    await _wait_tasks()
    cid = events[0]["conversation_id"]
    detail = (await client.get(f"/api/v1/student/tutor/conversations/{cid}", headers=_h(users["s"].id))).json()
    card = detail["messages"][1]["cards"][0]
    assert card["status"] == "ready" and card["url"]        # 刷新后是最新状态
    # 提问 1 次 + 画图 1 次
    assert await _used(db_session, users["s"].id) == 2


@pytest.mark.asyncio
async def test_admin_remove_picture(client, db_session, images, shared_session):
    users, w = await _picture_env(db_session)
    images()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(users["s"].id))
    pid = r.json()["pic_id"]
    await _wait_tasks()
    assert (await client.delete(f"/api/v1/admin/tutor/pictures/{pid}", headers=_h(users["t"].id))).status_code == 403
    listed = (await client.get("/api/v1/admin/tutor/pictures", headers=_h(users["a"].id))).json()["items"]
    assert [p["pic_id"] for p in listed] == [pid]
    assert (await client.delete(f"/api/v1/admin/tutor/pictures/{pid}", headers=_h(users["a"].id))).status_code == 200
    # 删掉的不再出现在「最近画的图」里
    assert (await client.get("/api/v1/admin/tutor/pictures", headers=_h(users["a"].id))).json()["items"] == []
    r = await client.get(f"/api/v1/student/tutor/pictures/word/{w.id}", headers=_h(users["s2"].id))
    assert r.json()["exists"] is False


# ---------------------------------------------------------------- 学情档案

@pytest.mark.asyncio
async def test_profile_only_own_data_and_names_removed(client, db_session):
    users, w = await _picture_env(db_session)
    s, s2 = users["s"], users["s2"]
    believe = Word(word="believe")
    db_session.add(believe)
    await db_session.flush()
    # s 两次把 ie 写成 ei;s2 的错误不能出现在 s 的档案里
    for ans in ("beleive", "releive"):
        db_session.add(LearningRecord(user_id=s.id, word_id=believe.id, learning_mode="spelling", is_correct=False,
                                      user_answer=ans if ans == "beleive" else "beleive"))
    db_session.add(LearningRecord(user_id=s2.id, word_id=w.id, learning_mode="spelling", is_correct=False,
                                  user_answer="elefant"))
    from app.models.coach import CoachNote
    db_session.add(CoachNote(student_id=s.id, teacher_id=users["t"].id, org_id=1, note_date=tt.local_today(),
                             content=f"{s.full_name},今天 2 份任务全部完成,believe 拼错了,明天再写两遍。"))
    await db_session.commit()
    lines = await tutor_profile.profile_lines(db_session, s, use_cache=False)
    text = "\n".join(lines)
    assert "该写「ie」常写成「ei」" in text
    assert "elephant" not in text and "elefant" not in text
    assert s.full_name not in text and "今天 2 份任务全部完成" in text
    assert "believe" in text                               # 常错的词
    # 老师能看到同一份摘要
    log = (await client.get(f"/api/v1/teacher/students/{s.id}/tutor", headers=_h(users["t"].id))).json()
    assert log["profile"] is None                          # 没问过不算
    # 拼写毛病与错题诊断页同一份判据
    from app.utils.spelling_diff import first_diff_chunk
    assert first_diff_chunk("believe", "beleive") == ("ie", "ei")


@pytest.mark.asyncio
async def test_profile_goes_into_system_prompt(client, db_session, relay, shared_session):
    from app.models.learning import WordMastery

    users, w = await _picture_env(db_session)
    db_session.add(LearningRecord(user_id=users["s"].id, word_id=w.id, learning_mode="spelling", is_correct=False,
                                  user_answer="elefant"))
    db_session.add(WordMastery(user_id=users["s"].id, word_id=w.id, mastery_level=1, total_encounters=1,
                               correct_count=0, wrong_count=1))
    await db_session.commit()
    await tutor_profile.invalidate(users["s"].id)
    fake = relay([(200, _text_reply("好"))])
    await _ask(client, users["s"].id)
    tail = fake.requests[0]["system"][1]["text"]
    assert "一共学过" in tail and "elephant" in tail and "孩子s" not in tail
    assert len(tail) < 900


@pytest.mark.asyncio
async def test_my_progress_tool(db_session):
    users, w = await _picture_env(db_session)
    db_session.add(LearningRecord(user_id=users["s"].id, word_id=w.id, learning_mode="spelling", is_correct=True))
    await db_session.commit()
    out = await tutor_profile.my_progress(db_session, users["s"])
    assert set(out) >= {"this_week", "last_week", "daily", "recent_units", "spelling_habits"}
    assert len(out["daily"]) == 14 and out["this_week"]["words"] == 1


@pytest.mark.asyncio
async def test_reclaim_only_failed_removed_or_stale(db_session):
    """两个孩子同时点同一个没画出来的词: 只有一个认领到(另一个在 request 里退回)"""
    await _picture_env(db_session)
    now = tt.utc_now()
    rows = {}
    for st, started in (("ready", now), ("pending", now), ("pending", now - timedelta(seconds=wp.STALE_SEC + 5)),
                        ("failed", now), ("removed", now)):
        p = WordPicture(pic_key=f"k-{st}-{started.timestamp()}", word="x", status=st, started_at=started)
        db_session.add(p)
        await db_session.flush()
        rows[(st, started == now)] = p.id
    got = {k: await wp.reclaim(db_session, pid, 1, now) for k, pid in rows.items()}
    assert got == {("ready", True): False, ("pending", True): False, ("pending", False): True,
                   ("failed", True): True, ("removed", True): True}
    # 第二个同时点的: 已经被第一个认领成 pending 了,认领不到
    assert await wp.reclaim(db_session, rows[("failed", True)], 2, now) is False


# ---------------------------------------------------------------- 8. 单词印在图下面(10-27)

@pytest.mark.asyncio
async def test_card_has_word_printed_below_and_art_kept(client, db_session, images, shared_session):
    """画图模型拼不准单词,画面里不让它写;服务器在下面印单词。成图 768×960,原画另存一份,删图时一起删"""
    import os
    from PIL import Image

    users, w = await _picture_env(db_session)
    images()
    r = await client.post("/api/v1/student/tutor/pictures", json={"word_id": w.id}, headers=_h(users["s"].id))
    assert r.status_code == 200
    prompt = _PENDING[0][1]
    assert "不要出现任何文字" in prompt and "印在图片下面" in prompt
    await _wait_tasks()
    p = (await db_session.execute(select(WordPicture))).scalar_one()
    await db_session.refresh(p)
    assert p.status == "ready"
    card = os.path.join(wp._pic_dir(), os.path.basename(p.url.split("?")[0][len(wp.URL_PREFIX):]))
    img = Image.open(card)
    assert img.size == (wp.SAVE_DIM, wp.CARD_H)
    # 下面那条不是白的(印了字),上面是画
    band = img.crop((0, wp.SAVE_DIM + 10, wp.SAVE_DIM, wp.CARD_H)).convert("L")
    assert min(band.getdata()) < 120
    art = wp.art_path(p.url)
    assert art and os.path.exists(art)

    await wp.remove(db_session, p.id, users["a"].id)
    await db_session.commit()
    assert not os.path.exists(card) and not os.path.exists(art)


def test_caption_text():
    assert wp.caption_meaning("n. 名字;姓名") == "n. 名字"
    assert wp.caption_meaning("adj. (尤指女人)美丽的,漂亮的") == "adj. 美丽的"
    assert wp.caption_meaning("中秋节") == "中秋节"
    assert wp.caption_meaning("v. & n. 跑;奔跑") == "v.&n. 跑"
    assert wp.caption_phonetic("neɪm") == "/neɪm/"
    assert wp.caption_phonetic("/neɪm/") == "/neɪm/"
    assert wp.caption_phonetic(None) == ""
