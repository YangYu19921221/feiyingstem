"""一码多书的 HTTP 端到端:发码 → 兑换 → 能学 → 到期锁上。

只测服务层不够 —— 真正的付费闸门在 scope_service.get_allowed_unit_ids,
而它是被 student/progress 的取词表端点调用的。这里从 HTTP 层走完整条链路,
并验证包月到期后单元真的进不去(那是这套卡最核心的承诺)。
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import Unit, UnitWord, Word, WordBook
from app.services import scope_service
from tests.conftest import _make_token


async def _setup(db):
    tenancy._org_cache.clear()
    org = Organization(name="一码多书机构", code="MB01", status="active",
                       student_quota=500)
    db.add(org)
    await db.flush()
    admin = User(username="mb_adm", email="mb_adm@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True)
    stu = User(username="mb_stu", email="mb_stu@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org.id)
    db.add_all([admin, stu])
    await db.flush()

    # 平台预置学段(生产由 init_db 建;本测试直接 ORM 建书,得自己造)。
    # 2026-09-11 学段从「按 grade_level 现算」改成 word_books.stage_id 真字段后,
    # **直接 ORM 插入的书必须显式挂 stage_id** —— 经 API 建书会按年级自动推
    # (book_stage.resolve_stage_id),但这里绕过了 API。
    from app.models.word import BookStage
    primary_stage = BookStage(name="小学", code="primary", org_id=None, sort_order=0)
    db.add(primary_stage)
    await db.flush()

    # 两本「人教版·小学」书,各一个单元一个词(取词表端点要真能返回内容)
    books, units = [], []
    for i, (nm, gl) in enumerate([("三年级上", "三年级"), ("四年级上", "四年级")]):
        b = WordBook(name=nm, grade_level=gl, series="人教版", is_public=True,
                     stage_id=primary_stage.id)
        db.add(b)
        await db.flush()
        u = Unit(book_id=b.id, name=f"{nm}-U1", unit_number=1, word_count=1)
        db.add(u)
        await db.flush()
        w = Word(word=f"apple{i}")
        db.add(w)
        await db.flush()
        db.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=1))
        books.append(b)
        units.append(u)
    await db.commit()
    return admin, stu, books, units


@pytest.mark.asyncio
async def test_group_card_full_http_flow(client, db_session):
    """管理端发一张 2 本的包月卡 → 学生兑换 → my-books 显示 2 本 → 单元可学
    → 手工改到期 → 闸门关上。"""
    admin, stu, books, units = await _setup(db_session)
    a_headers = {"Authorization": f"Bearer {_make_token(admin.id)}"}
    s_headers = {"Authorization": f"Bearer {_make_token(stu.id)}"}

    # ① 发码表单的目录接口:能看到「人教版 → 小学」两本
    r = await client.get("/api/v1/admin/subscriptions/book-groups", headers=a_headers)
    assert r.status_code == 200, r.text
    groups = {g["series"]: g for g in r.json()["groups"]}
    assert "人教版" in groups, groups
    primary = next(s for s in groups["人教版"]["stages"] if s["stage"] == "primary")
    assert primary["count"] == 2, primary
    assert primary["label"] == "小学"

    # ② 发一张覆盖这 2 本的 30 天包月卡
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=a_headers, json={
        "count": 1,
        "book_ids": [b["id"] for b in primary["books"]],
        "grant_type": "period", "grant_days": 30,
        "scope_series": "人教版", "scope_stage": "primary",
        "batch_note": "秋季·人教小学",
    })
    assert r.status_code == 200, r.text
    issued = r.json()[0]
    assert issued["book_count"] == 2, issued
    assert issued["scope_kind"] == "group"
    code_str = issued["code"]

    # ③ 列表能看清这张码开了什么
    r = await client.get("/api/v1/admin/subscriptions/codes", headers=a_headers,
                         params={"search": "秋季"})
    assert r.status_code == 200, r.text
    row = r.json()["codes"][0]
    assert row["book_count"] == 2
    assert len(row["books"]) == 2
    assert row["scope_series"] == "人教版" and row["scope_stage"] == "primary"

    # ④ 学生兑换:一次拿到 2 本
    r = await client.post("/api/v1/subscription/redeem", headers=s_headers,
                          json={"code": code_str})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["success"] is True, res
    assert "共开通 2 本" in res["message"], res["message"]
    assert len(res["books"]) == 2

    # ⑤ my-books 两本都在,且带包月剩余天数
    r = await client.get("/api/v1/subscription/my-books", headers=s_headers)
    assert r.status_code == 200, r.text
    mine = r.json()["books"]
    assert len(mine) == 2, mine
    for it in mine:
        assert it["grant_type"] == "period"
        assert it["active"] is True
        assert 29 <= it["days_left"] <= 30, it

    # ⑥ 闸门:未到期时两本都放行(None = 整本可学)
    for b in books:
        allowed = await scope_service.get_allowed_unit_ids(db_session, stu.id, b.id)
        assert allowed is None, f"{b.name} 应整本可学,实际 {allowed}"

    # ⑦ 到期后闸门关上 —— 这是包月卡最核心的承诺
    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    for a in rows:
        a.expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()

    for b in books:
        allowed = await scope_service.get_allowed_unit_ids(db_session, stu.id, b.id)
        assert allowed == set(), f"{b.name} 到期后应无可学单元,实际 {allowed}"


@pytest.mark.asyncio
async def test_generate_rejects_unknown_book(client, db_session):
    """发码时书不存在 → 400,而不是静默发出一张开不了任何书的废码。"""
    admin, stu, books, _ = await _setup(db_session)
    a_headers = {"Authorization": f"Bearer {_make_token(admin.id)}"}

    r = await client.post("/api/v1/admin/subscriptions/generate", headers=a_headers, json={
        "count": 1, "book_ids": [books[0].id, 999999],
    })
    assert r.status_code == 400, r.text
    assert "不存在" in r.text or "无权" in r.text


@pytest.mark.asyncio
async def test_generate_requires_at_least_one_book(client, db_session):
    """既不给 book_id 也不给 book_ids → 422(schema 层拦住)。"""
    admin, *_ = await _setup(db_session)
    a_headers = {"Authorization": f"Bearer {_make_token(admin.id)}"}
    r = await client.post("/api/v1/admin/subscriptions/generate", headers=a_headers,
                          json={"count": 1})
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_legacy_single_book_payload_still_works(client, db_session):
    """老前端只传 book_id 的请求体必须照旧工作(向后兼容的 HTTP 层钉子)。"""
    admin, stu, books, _ = await _setup(db_session)
    a_headers = {"Authorization": f"Bearer {_make_token(admin.id)}"}
    s_headers = {"Authorization": f"Bearer {_make_token(stu.id)}"}

    r = await client.post("/api/v1/admin/subscriptions/generate", headers=a_headers,
                          json={"count": 1, "book_id": books[0].id})
    assert r.status_code == 200, r.text
    item = r.json()[0]
    assert item["book_count"] == 1
    assert item["scope_kind"] == "book"

    r = await client.post("/api/v1/subscription/redeem", headers=s_headers,
                          json={"code": item["code"]})
    assert r.status_code == 200, r.text
    # 单书文案与改造前一致
    assert r.json()["message"] == f"兑换成功！已获得单词本《{books[0].name}》"
