"""单词本封面改成前端现画(2026-10-28)之后,后端要守住的两件事。

1. **建书 / 整本导入不再出图**。原来建书接口同步等 AI 出图最多 30 秒,网页 10 秒就放弃,
   老师看到「创建失败」书其实已建好(生产近 30 天 7 次出图全部超时)。封面现在由前端
   按书名 / 年级 / 册次 / 版本现画(frontend/src/utils/bookJacket),老师和学生看到同一张。
   谁要是把出图调用加回建书路径,这里的假出图函数会被调到,用例失败。

2. **学生作业接口带上年级 / 册次 / 版本**。书封的颜色和画面按这几个字段定,
   作业页拿不到它们,同一本书在作业页和书架上就会长得不一样。
"""
import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import WordBook
from app.services import auth_service, image_service
from tests.conftest import _make_token


@pytest.fixture
async def cover_fixture(db_session, monkeypatch):
    tenancy.register_tenant_models()   # conftest 走 create_all 不走 init_db
    tenancy._org_cache.clear()
    org = Organization(id=71, name="书封机构", code="JKT71", status="active", student_quota=100)
    db_session.add(org)
    await db_session.flush()

    def mk(u, role):
        return User(username=u, email=f"{u}@e.com",
                    hashed_password=auth_service.get_password_hash("P@ss1234"),
                    role=role, full_name=u, is_active=True, org_id=org.id)

    teacher, student = mk("jktteacher", "teacher"), mk("jktstudent", "student")
    db_session.add_all([teacher, student])
    await db_session.commit()

    calls = []

    async def fake_generate_image(*args, **kwargs):
        calls.append((args, kwargs))
        return "https://example.com/should-not-be-used.png"

    monkeypatch.setattr(image_service, "generate_image", fake_generate_image)
    return {"teacher": teacher, "student": student, "image_calls": calls}


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


@pytest.mark.asyncio
async def test_create_book_does_not_generate_cover(client: AsyncClient, cover_fixture):
    r = await client.post("/api/v1/words/books", headers=_hdr(cover_fixture["teacher"]), json={
        "name": "人教版七年级上册", "grade_level": "七年级", "volume": "上册",
        "series": "人教版", "word_ids": [],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["cover_url"] is None
    assert body["grade_level"] == "七年级" and body["volume"] == "上册" and body["series"] == "人教版"
    assert cover_fixture["image_calls"] == [], "建书不该再调出图"


@pytest.mark.asyncio
async def test_import_workbook_does_not_generate_cover(client: AsyncClient, cover_fixture, db_session):
    r = await client.post("/api/v1/teacher/books/import-workbook", headers=_hdr(cover_fixture["teacher"]), json={
        "book_name": "飞鹰语法二", "grade_level": None, "volume": None, "series": "校本教材",
        "units": [{"name": "Unit 1", "words": [{"word": "apple", "meaning": "苹果"}]}],
    })
    assert r.status_code == 201, r.text
    book = await db_session.get(WordBook, r.json()["book_id"])
    assert book.cover_url is None
    assert cover_fixture["image_calls"] == [], "整本导入不该再在后台出图"


@pytest.mark.asyncio
async def test_my_assignments_carries_jacket_fields(client: AsyncClient, cover_fixture, db_session):
    t, s = cover_fixture["teacher"], cover_fixture["student"]
    book = WordBook(name="人教版八年级下册", grade_level="八年级", volume="下册", series="人教版",
                    is_public=True, created_by=t.id, org_id=71)
    db_session.add(book)
    await db_session.flush()
    db_session.add(BookAssignment(book_id=book.id, student_id=s.id, teacher_id=t.id, scope_type="book"))
    await db_session.commit()

    r = await client.get("/api/v1/student/my-assignments", headers=_hdr(s))
    assert r.status_code == 200, r.text
    row = next(a for a in r.json() if a["book_id"] == book.id)
    assert row["book_name"] == "人教版八年级下册"
    assert row["book_grade_level"] == "八年级"
    assert row["book_volume"] == "下册"
    assert row["book_series"] == "人教版"
