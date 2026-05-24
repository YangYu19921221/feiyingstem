"""单词本封面: 上传 / AI 重新生成 / image2 失败时的容错。"""
from unittest.mock import AsyncMock

from app.models.word import WordBook
from app.models.user import User


async def _make_teacher(db_session) -> User:
    u = User(
        username="t1", email="t1@example.com", hashed_password="x",
        role="teacher", full_name="T1", is_active=True,
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


async def _login(teacher: User) -> str:
    from app.services.auth_service import create_access_token
    return create_access_token({"sub": str(teacher.id)})


async def _make_book(db_session, name="BookA", created_by=None) -> WordBook:
    b = WordBook(name=name, grade_level="一年级", created_by=created_by)
    db_session.add(b)
    await db_session.commit()
    await db_session.refresh(b)
    return b


_PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc````"
    b"\x00\x00\x00\x05\x00\x01]\xcc\xdb\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def test_upload_cover_png_writes_url_and_serves_file(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(teacher)
    book = await _make_book(db_session, created_by=teacher.id)

    files = {"file": ("a.png", _PNG_1X1, "image/png")}
    r = await client.post(
        f"/api/v1/words/books/{book.id}/cover/upload",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cover_url"], body
    assert body["cover_url"].startswith("/uploads/book-covers/")

    g = await client.get(body["cover_url"])
    assert g.status_code == 200, g.text
    assert g.content[:8] == _PNG_1X1[:8]


async def test_upload_cover_rejects_non_image(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(teacher)
    book = await _make_book(db_session, created_by=teacher.id)
    files = {"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")}
    r = await client.post(
        f"/api/v1/words/books/{book.id}/cover/upload",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


async def test_upload_cover_rejects_oversized(client, db_session):
    teacher = await _make_teacher(db_session)
    token = await _login(teacher)
    book = await _make_book(db_session, created_by=teacher.id)
    big = _PNG_1X1 + b"\x00" * (6 * 1024 * 1024)
    files = {"file": ("big.png", big, "image/png")}
    r = await client.post(
        f"/api/v1/words/books/{book.id}/cover/upload",
        files=files,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


async def test_regenerate_cover_via_mocked_image2(client, db_session, monkeypatch):
    teacher = await _make_teacher(db_session)
    token = await _login(teacher)
    book = await _make_book(db_session, created_by=teacher.id)
    monkeypatch.setattr(
        "app.api.v1.words.generate_image_with_fallback",
        AsyncMock(return_value="https://fake.example.com/x.png"),
    )
    monkeypatch.setattr(
        "app.api.v1.words.download_image_to_uploads",
        AsyncMock(return_value=f"/uploads/book-covers/book-{book.id}-abcd1234.png"),
    )
    r = await client.post(
        f"/api/v1/words/books/{book.id}/cover/generate",
        json={"prompt": "kid friendly cartoon"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cover_url"]
    assert body["cover_url"].startswith("/uploads/book-covers/")


async def test_regenerate_cover_image2_failure_keeps_book(client, db_session, monkeypatch):
    teacher = await _make_teacher(db_session)
    token = await _login(teacher)
    book = await _make_book(db_session, created_by=teacher.id)
    monkeypatch.setattr(
        "app.api.v1.words.generate_image_with_fallback",
        AsyncMock(return_value=None),
    )
    r = await client.post(
        f"/api/v1/words/books/{book.id}/cover/generate",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cover_url"] in (None, "")
