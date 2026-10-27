"""学习助手上传文件(services/tutor_files,2026-10-27,用户「拍照有了,上传文件的功能呢」→「doc 文档也要支持」)

锁住的规矩:
1. PDF / .docx / txt 读出文字发给模型;扫描件(没有文字层)改成前几页的图片
2. 文件内容**不存库**: 存的只有孩子写的话 + 一张 {"type":"file"} 卡(文件名、类型)
3. 太长截断并告诉模型;太大 / 不认识的格式 / 打不开 / 有密码 → 400 中文原因,不扣次数
4. 照片和文件一次只能发一样;发文件的那问不算「同一道题的追问」(算 1 次)
5. 只发文件不写字: 对话标题用文件名
6. 下一问的历史里只提一句「之前发了一份文件《xxx》」,不重发内容
7. .doc 不转换,400 让孩子另存为 docx / PDF(前端同一句话当场提示,不上传)
"""
import io
import json
import zipfile

import pytest
from sqlalchemy import select

from app.models.tutor import TutorAllowance, TutorConversation, TutorMessage
from app.services import tutor as tt
from app.services import tutor_files as tf
from tests.test_tutor import _env, _h, _text_reply, relay, shared_session  # noqa: F401


def _pdf(text: str = "", pages: int = 1, password: str = "") -> bytes:
    import pymupdf
    doc = pymupdf.open()
    for i in range(pages):
        p = doc.new_page()
        if text:
            p.insert_text((50, 72), text, fontname="china-s")
    buf = io.BytesIO()
    if password:
        doc.save(buf, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password)
    else:
        doc.save(buf)
    return buf.getvalue()


def _docx(paragraphs: list[str], table: list[list[str]] | None = None) -> bytes:
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    if table:
        rows = "".join("<w:tr>" + "".join(f"<w:tc><w:p><w:r><w:t>{c}</w:t></w:r></w:p></w:tc>" for c in r) + "</w:tr>"
                       for r in table)
        body += f"<w:tbl>{rows}</w:tbl>"
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document {w}><w:body>{body}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


# ---------------------------------------------------------------- 读文件

@pytest.mark.asyncio
async def test_extract_formats():
    d = await tf.extract("卷子.pdf", _pdf("1. She ___ (like) apples. 2. He ___ (go) to school every day."))
    assert d.kind == "pdf" and "She ___ (like) apples" in d.text and d.pages == 1 and not d.images
    d = await tf.extract("作业.docx", _docx(["第一题 choose the right word", "第二题"], [["A", "likes"], ["B", "like"]]))
    assert d.kind == "docx" and "choose the right word" in d.text and "A | likes" in d.text
    d = await tf.extract("notes.txt", "我的笔记 apple 苹果".encode("gb18030"))
    assert d.kind == "txt" and "apple 苹果" in d.text
    d = await tf.extract("long.txt", ("x" * (tf.MAX_CHARS + 500)).encode())
    assert d.truncated and len(d.text) == tf.MAX_CHARS and "只读了前" in d.prompt_block()


@pytest.mark.asyncio
async def test_scanned_pdf_becomes_images():
    d = await tf.extract("扫描.pdf", _pdf("", pages=5))
    assert d.kind == "pdf" and d.pages == 5 and len(d.images) == tf.SCAN_PAGES
    assert all(mime == "image/jpeg" for _, mime in d.images)
    assert "扫描件" in d.prompt_block() and "只看了前 3 页" in d.prompt_block()


@pytest.mark.asyncio
async def test_extract_rejects():
    for name, raw, word in [
        ("a.exe", b"MZ...", "只能发"),
        ("a.pdf", b"", "空的"),
        ("a.pdf", b"not a pdf at all", "打不开"),
        ("a.docx", b"not a zip", "打不开"),
        ("a.pdf", _pdf("hello world " * 5, password="123"), "密码"),
        ("big.txt", b"x" * (tf.MAX_BYTES + 1), "太大"),
        ("pics.docx", _docx([]), "没有文字"),
    ]:
        with pytest.raises(tf.FileRejected) as e:
            await tf.extract(name, raw)
        assert word in str(e.value), (name, str(e.value))


@pytest.mark.asyncio
async def test_doc_is_rejected_without_calling_soffice(monkeypatch):
    """.doc 不转换: 直接让孩子另存为 docx / PDF,也不去碰 soffice(那把锁是音标课件在用)"""
    from app.services import office_convert

    async def boom(*a, **k):
        raise AssertionError("不该调 soffice")

    monkeypatch.setattr(office_convert, "office_available", lambda: True)
    monkeypatch.setattr(office_convert, "convert_to_pdf_async", boom)
    with pytest.raises(tf.FileRejected) as e:
        await tf.extract("老作业.doc", b"\xd0\xcf\x11\xe0 fake doc")
    assert ".docx" in str(e.value) and "另存为" in str(e.value)


def test_doc_hint_matches_frontend():
    """前端选到 .doc 当场提示同一句话(不上传),两边别说两样"""
    import pathlib, re
    ts = (pathlib.Path(__file__).resolve().parents[2] / "frontend/src/utils/tutorFile.ts").read_text()
    m = re.search(r"DOC_HINT\s*=\s*'([^']+)'", ts)
    assert m and m.group(1) == tf.DOC_HINT


def test_safe_name():
    assert tf.safe_name("../../etc/passwd") == "passwd"
    assert tf.safe_name("C:\\Users\\a\\作业.docx") == "作业.docx"
    assert tf.safe_name("a\x00b.pdf") == "ab.pdf"
    long = tf.safe_name("很" * 100 + ".pdf")
    assert len(long) == tf.NAME_MAX and long.endswith(".pdf")


# ---------------------------------------------------------------- 提问

async def _used(db, uid):
    row = await db.get(TutorAllowance, uid)
    await db.refresh(row)
    return row.used


@pytest.mark.asyncio
async def test_ask_with_file_sends_text_and_does_not_store(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    secret = "Q7. The secret sentence only in the file."
    fake = relay([(200, _text_reply("我看了你发的《卷子.pdf》: 一张练习卷。你想先看哪一题?")),
                  (200, _text_reply("第 7 题考的是…"))])
    pdf = _pdf(secret)
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s), data={"text": ""},
                          files={"file": ("卷子.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    events = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")]
    assert events[0]["cost"] == 1
    sent = fake.requests[0]["messages"][-1]["content"]
    assert any(secret in (b.get("text") or "") for b in sent) and "帮我看看这份文件" in sent[-1]["text"]
    um = (await db_session.execute(select(TutorMessage).where(TutorMessage.role == "user"))).scalar_one()
    assert um.text == "" and secret not in json.dumps(um.cards, ensure_ascii=False)
    assert um.cards == [{"type": "file", "name": "卷子.pdf", "kind": "pdf", "pages": 1, "scanned": False, "truncated": False}]
    conv = (await db_session.execute(select(TutorConversation))).scalar_one()
    assert conv.title == "文件: 卷子.pdf"
    # 对话详情里用户消息带文件卡
    d = (await client.get(f"/api/v1/student/tutor/conversations/{conv.id}", headers=_h(s))).json()
    assert d["messages"][0]["cards"][0]["name"] == "卷子.pdf"
    # 下一问: 历史里只提文件名,不重发内容;追问不另算
    used = await _used(db_session, s)
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s),
                          data={"text": "第 7 题怎么做", "conversation_id": str(conv.id)})
    hist = json.dumps(fake.requests[1]["messages"][:-1], ensure_ascii=False)
    assert "《卷子.pdf》" in hist and secret not in hist
    assert await _used(db_session, s) == used


@pytest.mark.asyncio
async def test_file_question_is_not_a_free_followup(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    relay([(200, _text_reply("好")), (200, _text_reply("好"))])
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s), data={"text": "apple 怎么记"})
    cid = [json.loads(c[6:]) for c in r.text.split("\n\n") if c.startswith("data: ")][0]["conversation_id"]
    used = await _used(db_session, s)
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s), data={"text": "看看这个", "conversation_id": str(cid)},
                          files={"file": ("a.txt", "She likes apples.".encode(), "text/plain")})
    assert r.status_code == 200
    assert await _used(db_session, s) == used + 1


@pytest.mark.asyncio
async def test_ask_file_rejections_do_not_charge(client, db_session, relay, shared_session):
    users = await _env(db_session)
    s = users["s"].id
    relay([])
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s), data={"text": "x"},
                          files={"file": ("a.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 400 and "只能发" in r.json()["detail"]
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (100, 100), "white").save(buf, "PNG")
    r = await client.post("/api/v1/student/tutor/ask", headers=_h(s), data={"text": "x"},
                          files={"image": ("q.png", buf.getvalue(), "image/png"), "file": ("a.txt", b"hi", "text/plain")})
    assert r.status_code == 400 and "一次只能发一样" in r.json()["detail"]
    row = await db_session.get(TutorAllowance, s)
    assert row is None or row.used == 0
