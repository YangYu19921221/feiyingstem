"""学段从「推导值」改成「真字段」: book_stages 表 + word_books.stage_id。

## 这组测试守的是什么

改造前学段不存在任何地方,是从 grade_level 现算的,而规则在三处各写一份且不一致:
教师端显示「大学」分组、发码那边归「其他」—— 同一批书两个说法。
CLAUDE.md 记过: 口径不一致的自动判定比没有判定更糟,它的结论无法自证。

所以核心断言是**两端读同一个真源**(test_teacher_and_code_page_agree),
以及机构自建的学段两端都认(改造前发码那边会把它整个过滤掉,书凭空消失)。
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import tenancy
from app.models.organization import Organization
from app.models.user import User
from app.models.word import BookStage, WordBook
from app.services import auth_service
from tests.conftest import _make_token


@pytest.fixture
async def stage_fixture(db_session):
    tenancy.register_tenant_models()   # conftest 走 create_all 不走 init_db
    tenancy._org_cache.clear()
    org = Organization(id=61, name="学段机构", code="STG61", status="active",
                       student_quota=100)
    other = Organization(id=62, name="别家机构", code="STG62", status="active",
                         student_quota=100)
    db_session.add_all([org, other])
    await db_session.flush()

    def mk(u, role, org_id):
        return User(username=u, email=f"{u}@e.com",
                    hashed_password=auth_service.get_password_hash("P@ss1234"),
                    role=role, full_name=u, is_active=True, org_id=org_id)

    admin = mk("stgadmin", "admin", None)
    teacher = mk("stgteacher", "teacher", org.id)
    oa = mk("stgoa", "org_admin", org.id)
    other_t = mk("stgother", "teacher", other.id)
    db_session.add_all([admin, teacher, oa, other_t])
    await db_session.flush()

    # 平台预置三档(生产由 init_db 建,测试里手动造)
    presets = [BookStage(name="小学", code="primary", org_id=None, sort_order=0),
               BookStage(name="初中", code="junior", org_id=None, sort_order=1),
               BookStage(name="高中", code="senior", org_id=None, sort_order=2)]
    db_session.add_all(presets)
    await db_session.flush()
    await db_session.commit()
    return {"org": org, "other_org": other, "admin": admin, "teacher": teacher,
            "oa": oa, "other_t": other_t,
            "primary": presets[0].id, "junior": presets[1].id, "senior": presets[2].id}


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


# ---------- 选项表 ----------

@pytest.mark.asyncio
async def test_list_stages_returns_presets(client: AsyncClient, stage_fixture):
    r = await client.get("/api/v1/words/book-stages", headers=_hdr(stage_fixture["teacher"]))
    assert r.status_code == 200, r.text
    names = [x["name"] for x in r.json()]
    assert names == ["小学", "初中", "高中"], names
    assert all(x["is_preset"] for x in r.json())
    # code 要下发 —— 前端/发码靠它对齐,不能靠中文名匹配
    assert {x["code"] for x in r.json()} == {"primary", "junior", "senior"}


@pytest.mark.asyncio
async def test_teacher_creates_custom_stage(client: AsyncClient, stage_fixture, db_session):
    """机构自建「大学」—— 这是改造的直接动因(平台没预置这一档)"""
    r = await client.post("/api/v1/words/book-stages",
                          headers=_hdr(stage_fixture["teacher"]), json={"name": "大学"})
    assert r.status_code == 201, r.text
    assert r.json()["is_preset"] is False
    # code 必须留空: 自建档冒用 primary/junior/senior 会被按预置档处理
    assert r.json()["code"] is None, r.json()

    row = (await db_session.execute(
        select(BookStage).where(BookStage.name == "大学")
        .execution_options(skip_tenant_filter=True))).scalar_one()
    assert row.org_id == stage_fixture["org"].id, "自建学段要归本机构(tenancy 写侧打戳)"


@pytest.mark.asyncio
async def test_custom_stage_not_visible_to_other_org(client: AsyncClient, stage_fixture):
    """自建学段只有本机构看得到;平台预置的所有机构都看得到"""
    await client.post("/api/v1/words/book-stages",
                      headers=_hdr(stage_fixture["teacher"]), json={"name": "大学"})

    r = await client.get("/api/v1/words/book-stages", headers=_hdr(stage_fixture["other_t"]))
    names = [x["name"] for x in r.json()]
    assert "大学" not in names, f"别家机构不该看到自建学段: {names}"
    assert "小学" in names, "平台预置档所有机构都该看到"


@pytest.mark.asyncio
async def test_duplicate_stage_name_rejected(client: AsyncClient, stage_fixture):
    r = await client.post("/api/v1/words/book-stages",
                          headers=_hdr(stage_fixture["teacher"]), json={"name": "小学"})
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_student_cannot_create_stage(client: AsyncClient, stage_fixture, db_session):
    stu = User(username="stgstu", email="stgstu@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True,
               org_id=stage_fixture["org"].id)
    db_session.add(stu)
    await db_session.commit()
    r = await client.post("/api/v1/words/book-stages", headers=_hdr(stu),
                          json={"name": "乱建"})
    assert r.status_code == 403, r.text


# ---------- 书上的 stage_id ----------

@pytest.mark.asyncio
async def test_book_stage_can_be_set_and_cleared(client: AsyncClient, stage_fixture, db_session):
    """学段可空,且能**改回**未分类 —— 传 0 表示清空。

    用 0 而不是 null: PATCH 里 None 的语义是"没传",无法表达"要清空"
    (CLAUDE.md 记过 AI 配置 api_key 被空串清空的同类陷阱)。
    """
    book = WordBook(name="课外读物", is_public=True, created_by=stage_fixture["teacher"].id)
    db_session.add(book)
    await db_session.commit()
    bid = book.id
    hdr = _hdr(stage_fixture["teacher"])

    r = await client.patch(f"/api/v1/words/books/{bid}", headers=hdr,
                          json={"stage_id": stage_fixture["primary"]})
    assert r.status_code == 200, r.text
    assert r.json()["stage_id"] == stage_fixture["primary"]

    r = await client.patch(f"/api/v1/words/books/{bid}", headers=hdr, json={"stage_id": 0})
    assert r.status_code == 200, r.text
    assert r.json()["stage_id"] is None, r.json()


@pytest.mark.asyncio
async def test_book_stage_rejects_unknown_id(client: AsyncClient, stage_fixture, db_session):
    """挂到不存在/别家机构的学段 id 上要拒 —— 否则分组里会出现一个空组"""
    book = WordBook(name="书", is_public=True, created_by=stage_fixture["teacher"].id)
    db_session.add(book)
    await db_session.commit()
    r = await client.patch(f"/api/v1/words/books/{book.id}",
                          headers=_hdr(stage_fixture["teacher"]),
                          json={"stage_id": 99999})
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_patch_without_stage_leaves_it_untouched(client: AsyncClient, stage_fixture, db_session):
    """只改书名不该把学段冲掉(PATCH 的 exclude_unset 语义)"""
    book = WordBook(name="旧名", is_public=True, stage_id=stage_fixture["senior"],
                    created_by=stage_fixture["teacher"].id)
    db_session.add(book)
    await db_session.commit()
    bid, sid = book.id, stage_fixture["senior"]

    r = await client.patch(f"/api/v1/words/books/{bid}",
                          headers=_hdr(stage_fixture["teacher"]), json={"name": "新名"})
    assert r.status_code == 200, r.text
    assert r.json()["stage_id"] == sid, r.json()


# ---------- 两端口径一致(这组改造的核心) ----------

@pytest.mark.asyncio
async def test_teacher_and_code_page_agree(client: AsyncClient, stage_fixture, db_session):
    """**核心**: 教师端分组与发码选书读同一个真源。

    改造前: 同一本「大学」教材,教师端显示成「大学」分组、发码那边归「其他」。
    现在两边都读 word_books.stage_id → book_stages,不可能不一致。
    """
    hdr = _hdr(stage_fixture["teacher"])
    # 机构自建「大学」,挂两本书
    r = await client.post("/api/v1/words/book-stages", headers=hdr, json={"name": "大学"})
    uni = r.json()["id"]
    for nm in ("大学英语一", "大学英语二"):
        db_session.add(WordBook(name=nm, series="校本教材", is_public=True,
                                stage_id=uni, created_by=stage_fixture["teacher"].id))
    await db_session.commit()

    # 教师端拿到的选项里有「大学」
    stages = {x["name"]: x["id"] for x in
              (await client.get("/api/v1/words/book-stages", headers=hdr)).json()}
    assert "大学" in stages

    # 发码目录里也必须有「大学」这一档,且书在里面
    r = await client.get("/api/v1/admin/subscriptions/book-groups",
                         headers=_hdr(stage_fixture["oa"]))
    assert r.status_code == 200, r.text
    groups = {g["series"]: g for g in r.json()["groups"]}
    assert "校本教材" in groups, groups.keys()
    labels = {s["label"]: s for s in groups["校本教材"]["stages"]}
    assert "大学" in labels, f"发码那边看不到自建学段: {labels.keys()}"
    assert labels["大学"]["count"] == 2, labels["大学"]
    # key 用 custom:{id},与预置档的 code 区分开
    assert labels["大学"]["stage"] == f"custom:{uni}", labels["大学"]


@pytest.mark.asyncio
async def test_code_page_unassigned_books_still_issuable(client: AsyncClient, stage_fixture, db_session):
    """没学段的书归「未分类」且**能正常发码** ——
    生产有 27 本(校本教材/大学/空年级)本来就没学段,不能因为分类空着就发不出卡。"""
    db_session.add(WordBook(name="总复习", series="人教版", is_public=True,
                            stage_id=None, created_by=stage_fixture["teacher"].id))
    await db_session.commit()

    r = await client.get("/api/v1/admin/subscriptions/book-groups",
                         headers=_hdr(stage_fixture["oa"]))
    groups = {g["series"]: g for g in r.json()["groups"]}
    labels = {s["label"]: s for s in groups["人教版"]["stages"]}
    assert "未分类" in labels, labels.keys()
    bid = labels["未分类"]["books"][0]["id"]

    # 真发一张卡出去
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(stage_fixture["oa"]),
                          json={"count": 1, "book_ids": [bid],
                                "grant_type": "period", "grant_days": 180,
                                "scope_stage": "unassigned"})
    assert r.status_code == 200, r.text
    assert r.json()[0]["scope_stage"] == "unassigned"


@pytest.mark.asyncio
async def test_custom_stage_scope_accepted_by_generate(client: AsyncClient, stage_fixture, db_session):
    """按自建学段发码不能被 422 拦死 ——
    scope_stage 原来写死 ^(primary|junior|senior|other)$,custom:N 会被拒。"""
    hdr = _hdr(stage_fixture["teacher"])
    uni = (await client.post("/api/v1/words/book-stages", headers=hdr,
                             json={"name": "成人"})).json()["id"]
    book = WordBook(name="成人英语", series="校本教材", is_public=True,
                    stage_id=uni, created_by=stage_fixture["teacher"].id)
    db_session.add(book)
    await db_session.commit()

    r = await client.post("/api/v1/admin/subscriptions/generate",
                          headers=_hdr(stage_fixture["oa"]),
                          json={"count": 1, "book_ids": [book.id],
                                "grant_type": "period", "grant_days": 180,
                                "scope_stage": f"custom:{uni}"})
    assert r.status_code == 200, r.text
    assert r.json()[0]["scope_stage"] == f"custom:{uni}"


@pytest.mark.asyncio
async def test_legacy_scope_stage_still_accepted(client: AsyncClient, stage_fixture, db_session):
    """老码用的 primary/other 那套 code 要继续收(存量 1136 张码上留着痕)"""
    book = WordBook(name="三上", series="人教版", is_public=True,
                    stage_id=stage_fixture["primary"],
                    created_by=stage_fixture["teacher"].id)
    db_session.add(book)
    await db_session.commit()
    for legacy in ("primary", "other"):
        r = await client.post("/api/v1/admin/subscriptions/generate",
                              headers=_hdr(stage_fixture["oa"]),
                              json={"count": 1, "book_ids": [book.id],
                                    "grant_type": "period", "grant_days": 180,
                                    "scope_stage": legacy})
        assert r.status_code == 200, f"{legacy}: {r.text}"


# ---------- 建书时按年级自动归类(防行为回退) ----------

@pytest.mark.asyncio
async def test_create_book_auto_derives_stage(client: AsyncClient, stage_fixture):
    """只填年级、不选学段 → 自动归到对应学段。

    这条守的是一个**我差点漏掉的行为回退**: 学段改成真字段后,如果不自动推导,
    老师填「三年级」建的书会落进「未分类」(改造前它自动出现在小学分组)。
    老师十有八九不会多点一次学段,几个月后「未分类」会堆成第一大组。
    (被 tests/test_redemption_multi_book_http.py 抓出来的。)
    """
    hdr = _hdr(stage_fixture["teacher"])
    for grade, want in [("三年级", stage_fixture["primary"]),
                        ("八年级", stage_fixture["junior"]),
                        ("高二", stage_fixture["senior"]),
                        ("小学", stage_fixture["primary"])]:
        r = await client.post("/api/v1/words/books", headers=hdr, json={
            "name": f"自动归类-{grade}", "grade_level": grade, "word_ids": []})
        assert r.status_code in (200, 201), r.text
        assert r.json()["stage_id"] == want, f"{grade} 应归到 {want}: {r.json()}"


@pytest.mark.asyncio
async def test_create_book_unknown_grade_stays_unassigned(client: AsyncClient, stage_fixture):
    """认不出的年级(大学/飞鹰/空)留未分类,**不兜底成小学** ——
    发码时把大学教材当小学开出去是真事故。"""
    hdr = _hdr(stage_fixture["teacher"])
    for grade in ["大学", "飞鹰", None]:
        r = await client.post("/api/v1/words/books", headers=hdr, json={
            "name": f"未分类-{grade}", "grade_level": grade, "word_ids": []})
        assert r.status_code in (200, 201), r.text
        assert r.json()["stage_id"] is None, f"{grade}: {r.json()}"


@pytest.mark.asyncio
async def test_explicit_stage_beats_auto_derive(client: AsyncClient, stage_fixture):
    """显式选了学段就用它,不被年级推导覆盖(老师说的算)"""
    r = await client.post("/api/v1/words/books", headers=_hdr(stage_fixture["teacher"]),
                          json={"name": "手动指定", "grade_level": "三年级",
                                "stage_id": stage_fixture["senior"], "word_ids": []})
    assert r.status_code in (200, 201), r.text
    assert r.json()["stage_id"] == stage_fixture["senior"], r.json()
