"""发音纠正(words.tts_text)与后台试听(raw=1)的行为约束。

这个字段此前**零测试**,但它决定学生听到什么;而 raw=1 是 2026-09-19 新加的,
它存在的唯一理由是让后台试听**诚实** —— 老师听到的必须就是学生将来听到的。

核心不变式(本文件的全部意义):
    raw=1 试听文本 S  ==  保存 tts_text=S 之后学生听到的
两条路径必须逐字一致,否则"试听"就是个骗人的按钮。
"""
import pytest
from httpx import AsyncClient

from app.api.v1 import pronunciation
from app.models.word import Word

pytestmark = pytest.mark.asyncio

TTS = "/api/v1/pronunciation/edge-tts"


@pytest.fixture
def spy(monkeypatch):
    """拦住真的 TTS 调用,记录**实际送去合成的文本**。

    断言的是"送给 TTS 的是什么",而不是音频内容 —— 发音对不对是 Edge TTS 的事,
    我们能保证的是把正确的文本交给它。
    """
    calls = []

    async def fake_generate(text: str) -> bytes:
        calls.append(text)
        return b"\xff\xfb\x00" + b"fake-mp3"

    monkeypatch.setattr(pronunciation.edge_tts_service,
                        "generate_pronunciation", fake_generate)
    monkeypatch.setattr(pronunciation.edge_tts_service,
                        "is_available", lambda: True)
    return calls


@pytest.fixture
async def word_with_fix(db_session):
    """一个**库里已存了旧纠正音**的词 —— 这是最关键的场景。

    不加 raw 时 `?word=record` 会命中这一行、套上 'rekord',
    于是老师在输入框敲的新内容根本没被念出来。
    """
    w = Word(word="record", phonetic="/ˈrekɔːd/", difficulty=2,
             tts_text="rekord")
    db_session.add(w)
    await db_session.flush()
    await db_session.commit()
    return w


# ── raw=1:逐字合成,不查库 ──────────────────────────────────────

async def test_raw_uses_text_verbatim(client: AsyncClient, spy):
    """raw=1 把 word 原样送去合成。"""
    r = await client.get(TTS, params={"raw": 1, "word": "rekord"})
    assert r.status_code == 200, r.text
    assert spy == ["rekord"]
    assert r.headers["x-source"] == "edge-tts-raw"


async def test_raw_ignores_stored_tts_text(client: AsyncClient, spy,
                                           word_with_fix):
    """**这条是 raw 存在的理由**:库里有旧纠正音,raw 也不许套用它。

    场景:record 已存 tts_text='rekord',老师想改成 'ri-KORD' 先试听一下。
    不加 raw → 命中 record 那行 → 念旧的 'rekord' → 老师以为"改了没生效",
    而其实是试听在骗他。加了 raw → 念他刚敲的字。
    """
    r = await client.get(TTS, params={"raw": 1, "word": "ri-KORD"})
    assert r.status_code == 200, r.text
    assert spy == ["ri-KORD"], "raw 模式套用了库里的旧 tts_text"


async def test_raw_skips_abbreviation_expansion(client: AsyncClient, spy):
    """raw 不做缩写展开 —— 非 raw 路径会把 sb./sth. 展开成 somebody/something,
    但老师填的就是最终文本,再替换一次等于改了他的输入。
    """
    r = await client.get(TTS, params={"raw": 1, "word": "sb sth"})
    assert r.status_code == 200, r.text
    assert spy == ["sb sth"], "raw 模式做了缩写展开"


@pytest.mark.parametrize("blank", ["", "   ", "\t"])
async def test_raw_rejects_blank(client: AsyncClient, spy, blank):
    """raw 空文本必须 400,不能把空串送去合成(会得到静音或报错)。"""
    r = await client.get(TTS, params={"raw": 1, "word": blank})
    assert r.status_code == 400, r.text
    assert spy == [], "空文本被送去合成了"


async def test_raw_does_not_fall_back_to_cambridge(client: AsyncClient,
                                                   monkeypatch):
    """Edge TTS 不可用时 raw 必须**明确报错**,不许退到剑桥真人录音。

    退过去的话:老师会听到那个词**正确的**真人发音 → 以为自己的改写生效了,
    实际一个字都没生效。宁可报错也不能给"听起来对"的假象。
    """
    monkeypatch.setattr(pronunciation.edge_tts_service,
                        "is_available", lambda: False)
    r = await client.get(TTS, params={"raw": 1, "word": "rekord"})
    assert r.status_code == 503, r.text


# ── 非 raw:学生端实际走的路径 ─────────────────────────────────

async def test_stored_fix_wins_over_spelling(client: AsyncClient, spy,
                                             word_with_fix):
    """学生端按拼写请求时,库里的 tts_text 优先 —— 纠正音真的生效。"""
    r = await client.get(TTS, params={"word": "record"})
    assert r.status_code == 200, r.text
    assert spy == ["rekord"], "存了纠正音却没用上"


async def test_empty_fix_falls_back_to_spelling(client: AsyncClient, spy,
                                                db_session):
    """**清空即恢复默认** —— tts_text 存成空串时按拼写念。

    这是必填之外的逃生门:老师清空输入框保存,PUT 会写入空串
    (update_word 用 `value is not None`),发音端点这一侧必须把空串
    当成"没设置",否则会把空文本送去合成 → 那个词从此静音。
    """
    w = Word(word="cleared", difficulty=1, tts_text="")
    db_session.add(w)
    await db_session.flush()
    await db_session.commit()

    r = await client.get(TTS, params={"word": "cleared"})
    assert r.status_code == 200, r.text
    assert spy == ["cleared"], "空串没有回退到拼写"


# ── 端到端:保存后学生听到的 == 试听听到的 ────────────────────

async def test_preview_matches_what_students_hear(
        client: AsyncClient, spy, teacher_token, db_session):
    """本文件的核心不变式,端到端验一遍。

    ①老师 raw 试听 'teer' → ②保存 tts_text='teer' → ③学生请求 tear
    三步送给 TTS 的文本必须完全一致。
    """
    w = Word(word="tear", phonetic="/tɪə/", difficulty=2)
    db_session.add(w)
    await db_session.flush()
    await db_session.commit()
    wid = w.id

    # ① 试听
    r1 = await client.get(TTS, params={"raw": 1, "word": "teer"})
    assert r1.status_code == 200, r1.text
    previewed = spy[-1]

    # ② 保存
    r2 = await client.put(
        f"/api/v1/words/{wid}",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={"tts_text": "teer"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["tts_text"] == "teer"

    # ③ 学生端
    r3 = await client.get(TTS, params={"word": "tear"})
    assert r3.status_code == 200, r3.text
    heard = spy[-1]

    assert previewed == heard == "teer", (
        f"试听({previewed}) 与学生听到({heard}) 不一致 —— 试听在骗人")


async def test_clearing_via_api_restores_default(
        client: AsyncClient, spy, teacher_token, word_with_fix):
    """老师清空输入框保存后,学生听到的回到拼写本身。"""
    r = await client.put(
        f"/api/v1/words/{word_with_fix.id}",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={"tts_text": ""},
    )
    assert r.status_code == 200, r.text

    spy.clear()
    r2 = await client.get(TTS, params={"word": "record"})
    assert r2.status_code == 200, r2.text
    assert spy == ["record"], "清空后没有恢复默认发音"


# ── 单元内编辑路径(界面实际走的那条) ──────────────────────────
#
# ⚠️ 上面那些用的是 PUT /words/{id},而**教师端界面保存走的是**
# PUT /teacher/units/{unit}/words/{word} —— 两个端点判空口径原本不一样,
# 前者 `is not None`(空串能清)、后者 `is not None and v != ""`(空串被当成没填)。
# 于是"清空发音文本→保存"在界面上是**静默失败**:库里旧读法还在,
# 而界面照旧弹「保存成功」。2026-09-19 修,下面是回归锁。

UNIT_EDIT = "/api/v1/teacher/units/{unit}/words/{word}"


async def _unit_edit(client, token, unit_id, word_id, payload):
    return await client.put(
        UNIT_EDIT.format(unit=unit_id, word=word_id),
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )


async def test_unit_edit_can_clear_tts_text(
        client: AsyncClient, spy, teacher_token, sample_unit_with_words,
        db_session):
    """**本次修的 bug**:单元内编辑时清空发音文本,必须真的清掉。

    (编辑可能触发 fork —— 公共书里的词会复制一份避免影响别的书,
     所以断言用响应里的 word_id,不用原来那个。)
    """
    unit, word_ids = sample_unit_with_words

    # 先设一个纠正音
    r1 = await _unit_edit(client, teacher_token, unit.id, word_ids[0],
                          {"tts_text": "faff-fake"})
    assert r1.status_code == 200, r1.text
    wid = r1.json()["word_id"]

    w = await db_session.get(Word, wid)
    await db_session.refresh(w)
    assert w.tts_text == "faff-fake", "没存进去"

    # 清空
    r2 = await _unit_edit(client, teacher_token, unit.id, wid,
                          {"tts_text": ""})
    assert r2.status_code == 200, r2.text

    w2 = await db_session.get(Word, r2.json()["word_id"])
    await db_session.refresh(w2)
    assert w2.tts_text is None, (
        "清空没生效 —— 界面会弹「保存成功」而学生仍听旧读法(静默失败)")


async def test_unit_edit_blank_tts_text_becomes_none(
        client: AsyncClient, teacher_token, sample_unit_with_words,
        db_session):
    """纯空白的发音文本要归成 None,不能原样入库。

    全是空格的"发音文本"在界面上看着像填了,送去 TTS 只会得到静音 ——
    那个词从此没有声音,比不填更糟。
    """
    unit, word_ids = sample_unit_with_words
    r = await _unit_edit(client, teacher_token, unit.id, word_ids[1],
                         {"tts_text": "   "})
    assert r.status_code == 200, r.text
    w = await db_session.get(Word, r.json()["word_id"])
    await db_session.refresh(w)
    assert w.tts_text is None, "纯空白原样入库了 → 该词会变静音"


async def test_unit_edit_still_protects_other_fields(
        client: AsyncClient, teacher_token, sample_unit_with_words,
        db_session):
    """**回归锁**:放开 tts_text 的同时,不能把别的字段的空串保护一起放开。

    原来那条 `v != ""` 是有用的 —— 前端未填字段初始化成 '',直接 setattr
    会把原音标/释义抹掉(代码注释里写明了)。我只给 tts_text 开了例外,
    这条确保 phonetic/syllables 仍然被保护。
    """
    unit, word_ids = sample_unit_with_words

    r1 = await _unit_edit(client, teacher_token, unit.id, word_ids[2],
                          {"phonetic": "/kæt/", "syllables": "cat"})
    assert r1.status_code == 200, r1.text
    wid = r1.json()["word_id"]

    # 空串提交这两个字段:应当被忽略,不许抹掉已有值
    r2 = await _unit_edit(client, teacher_token, unit.id, wid,
                          {"phonetic": "", "syllables": ""})
    assert r2.status_code == 200, r2.text

    w = await db_session.get(Word, r2.json()["word_id"])
    await db_session.refresh(w)
    assert w.phonetic == "/kæt/", "空串把音标抹掉了(原有保护被破坏)"
    assert w.syllables == "cat", "空串把音节抹掉了(原有保护被破坏)"


async def test_unit_edit_omitted_key_leaves_tts_text_alone(
        client: AsyncClient, teacher_token, sample_unit_with_words,
        db_session):
    """只改别的字段时不许顺手动掉 tts_text —— 判据是**键在不在**,不是值空不空。

    否则老师改个音标就把之前调好的发音纠正弄丢了。
    """
    unit, word_ids = sample_unit_with_words

    r1 = await _unit_edit(client, teacher_token, unit.id, word_ids[3],
                          {"tts_text": "dawg"})
    assert r1.status_code == 200, r1.text
    wid = r1.json()["word_id"]

    # payload 里完全不带 tts_text
    r2 = await _unit_edit(client, teacher_token, unit.id, wid,
                          {"phonetic": "/dɒɡ/"})
    assert r2.status_code == 200, r2.text

    w = await db_session.get(Word, r2.json()["word_id"])
    await db_session.refresh(w)
    assert w.tts_text == "dawg", "没传这个键却把发音纠正弄丢了"
