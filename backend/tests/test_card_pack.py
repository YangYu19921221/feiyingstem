"""新政策卡包: 分档额度、按期到账、按卡种开书。

卡种 10-09 换成 入门卡 / 15本卡 / 5本卡 / 小学2本卡 / 单本卡(发码时勾 N 本)。
守的几件事(每条都对应一个会让钱算错或权益错发的洞):
- 老机构(legacy)零影响: 老发码照旧,不出现分档额度
- 新机构不能用老表单自由勾书(否则分档定价作废)
- 每种卡额度独立,入门卡的额度发不出 15本卡
- N 本卡必须正好勾 N 本;小学2本卡只能勾小学书;只有单本卡能开精品书
- 同一期不能确认两次;一次付清送 10 张 5本卡
- 只开平台的对应档位书: 未定档/校本/机构自建的书不进卡
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.word import BookStage, WordBook
from app.services import card_pack
from tests.conftest import _make_token


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


@pytest.fixture
async def env(db_session):
    tenancy._org_cache.clear()
    # id=1 固定是直营(不可删),先占住,让测试机构的 id 和生产一样不是 1
    db_session.add(Organization(name="直营", code="HQ01", status="active", student_quota=999999))
    await db_session.flush()
    pack = Organization(name="新机构", code="PK01", status="active", student_quota=100,
                        card_plan="pack")
    old = Organization(name="老机构", code="LG01", status="active", student_quota=100,
                       card_quota=5)
    db_session.add_all([pack, old])
    await db_session.flush()
    admin = User(username="pkadmin", email="a@e.com", hashed_password="x", role="admin",
                 is_active=True)
    oa = User(username="pkoa", email="b@e.com", hashed_password="x", role="org_admin",
              is_active=True, org_id=pack.id)
    old_oa = User(username="lgoa", email="c@e.com", hashed_password="x", role="org_admin",
                  is_active=True, org_id=old.id)
    stu = User(username="pkstu", email="d@e.com", hashed_password="x", role="student",
               is_active=True, org_id=pack.id)
    primary = BookStage(name="小学", code="primary", sort_order=1)
    junior = BookStage(name="初中", code="junior", sort_order=2)
    db_session.add_all([admin, oa, old_oa, stu, primary, junior])
    await db_session.flush()

    def book(name, tier, stage=primary, series="人教版", org_id=None):
        b = WordBook(name=name, series=series, stage_id=stage.id if stage else None,
                     pack_tier=tier, org_id=org_id, is_public=True)
        db_session.add(b)
        return b

    books = {
        "p3": book("三上", "basic"),
        "p4": book("四上", "basic"),
        "j7": book("七上", "basic", junior),
        "kao": book("中考688", "premium", junior),
        "intro": book("入门课", "trial", None, "校本教材"),
        "fy": book("飞鹰语法", "school", None, "校本教材"),
        "untier": book("新书未定档", None),
        "own": book("机构自建", "basic", org_id=pack.id),
    }
    await db_session.commit()
    return {"pack": pack, "old": old, "admin": admin, "oa": oa, "old_oa": old_oa,
            "stu": stu, "books": books, "primary": primary}


async def _pay(client, env, action="installment", **kw):
    return await client.post(f"/api/v1/admin/organizations/{env['pack'].id}/card-pack",
                             json={"action": action, **kw}, headers=_hdr(env["admin"]))


async def _gen(client, user, **body):
    return await client.post("/api/v1/admin/subscriptions/pack/generate",
                             json={"count": 1, **body}, headers=_hdr(user))


def test_pack_adds_up_to_60000():
    """用户 10-09 给的价: 15×80 + 600×40 + 360×60 + 120×50 + 240×30 = 60,000"""
    price = {k: v["price"] for k, v in card_pack.CARD_KINDS.items()}
    assert price == {"trial": 15, "b15": 600, "b5": 360, "p2": 120, "b1": 240}
    total = {}
    for cards in card_pack.INSTALLMENTS.values():
        for k, n in cards.items():
            total[k] = total.get(k, 0) + n
    assert total == {"trial": 80, "b15": 30, "b5": 50, "p2": 90, "b1": 50}
    assert sum(total.values()) == 300
    assert sum(price[k] * n for k, n in total.items()) == 60000
    # 每期收 2 万;卡值 20,040 / 20,040 / 19,920,合计正好 6 万
    assert [card_pack.installment_value(n) for n in card_pack.INSTALLMENTS] == [20040, 20040, 19920]
    assert [i["value"] for i in card_pack.catalog()["installments"]] == [20000] * 3


async def test_legacy_org_unchanged(client, env):
    """老机构: 老表单照常发,不能用新端点,统计里还是老额度条"""
    b = env["books"]["p3"]
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          json={"count": 1, "book_ids": [b.id], "grant_type": "period",
                                "grant_days": 180}, headers=_hdr(env["old_oa"]))
    assert r.status_code == 200, r.text
    r = await _gen(client, env["old_oa"], card_kind="trial")
    assert r.status_code == 403
    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(env["old_oa"]))).json()
    assert st["card_quota"] == 5


async def test_pack_org_cannot_use_legacy_form(client, env):
    r = await client.post("/api/v1/admin/subscriptions/generate",
                          json={"count": 1, "book_ids": [env["books"]["p3"].id],
                                "grant_type": "period", "grant_days": 180},
                          headers=_hdr(env["oa"]))
    assert r.status_code == 403
    st = (await client.get("/api/v1/admin/subscriptions/stats", headers=_hdr(env["oa"]))).json()
    assert st["card_quota"] is None


async def test_quota_per_kind_and_installment_once(client, env):
    # 没到账: 一张都发不出
    assert (await _gen(client, env["oa"], card_kind="trial")).status_code == 403
    r = await _pay(client, env)
    assert r.status_code == 200, r.text
    assert r.json()["installments"] == [1]
    kinds = {k["kind"]: k for k in r.json()["status"]["kinds"]}
    assert {k: v["quota"] for k, v in kinds.items()} == {"trial": 80, "b15": 10, "b5": 17, "p2": 30, "b1": 13}

    # 第 1 期只有 13 张单本卡: 发 14 张被拒,入门卡的额度不能挪用
    one = [env["books"]["p3"].id]
    r = await _gen(client, env["oa"], card_kind="b1", book_ids=one, count=14)
    assert r.status_code == 403
    r = await _gen(client, env["oa"], card_kind="b1", book_ids=one, count=13)
    assert r.status_code == 200, r.text
    code = r.json()[0]
    assert code["card_kind"] == "b1" and code["grant_days"] == 180
    # 5 年内可兑换
    exp = datetime.fromisoformat(code["code_expires_at"].replace("Z", ""))
    assert exp - datetime.utcnow() > timedelta(days=365 * 5 - 2)

    # 下一期是第 2 期,不是重复第 1 期
    r = await _pay(client, env)
    assert r.json()["installments"] == [2]


async def test_full_pay_bonus(client, env):
    r = await _pay(client, env, action="settle")
    assert r.status_code == 200
    kinds = {k["kind"]: k["quota"] for k in r.json()["status"]["kinds"]}
    assert kinds["b5"] == 50 + card_pack.BONUS_FULL_PAY
    assert kinds["b15"] == 30
    # 3 期都付完再点到账 → 400
    assert (await _pay(client, env)).status_code == 400
    assert (await _pay(client, env, action="settle")).status_code == 400


async def test_only_platform_books_of_right_tier(client, env):
    await _pay(client, env)
    b = env["books"]
    ok = lambda r: r.status_code == 200
    # 单本卡: 平台基础书、精品书都行;校本/未定档/机构自建/体验课不行
    for good in ("p3", "j7", "kao"):
        assert ok(await _gen(client, env["oa"], card_kind="b1", book_ids=[b[good].id])), good
    for bad in ("fy", "untier", "own", "intro"):
        r = await _gen(client, env["oa"], card_kind="b1", book_ids=[b[bad].id])
        assert r.status_code == 400, bad
    # 小学2本卡: 必须正好 2 本,而且都是小学书
    assert ok(await _gen(client, env["oa"], card_kind="p2", book_ids=[b["p3"].id, b["p4"].id]))
    r = await _gen(client, env["oa"], card_kind="p2", book_ids=[b["p3"].id, b["j7"].id])
    assert r.status_code == 400 and "小学" in r.json()["detail"]
    r = await _gen(client, env["oa"], card_kind="p2", book_ids=[b["p3"].id])
    assert r.status_code == 400 and "正好选 2 本" in r.json()["detail"]
    # 重复勾同一本不算两本
    r = await _gen(client, env["oa"], card_kind="p2", book_ids=[b["p3"].id, b["p3"].id])
    assert r.status_code == 400
    # 5本卡不能放精品书(精品书只走单本卡)
    r = await _gen(client, env["oa"], card_kind="b5",
                   book_ids=[b["p3"].id, b["p4"].id, b["j7"].id, b["kao"].id, b["untier"].id])
    assert r.status_code == 400
    # 入门卡开体验档,不用选
    r = await _gen(client, env["oa"], card_kind="trial")
    assert [x["name"] for x in r.json()[0]["books"]] == ["入门课"]


async def test_n_book_card_opens_exactly_picked_books(client, env, db_session):
    """5本卡兑换后正好开勾的 5 本;之后平台再给书定档,不会补给(N 本卡不随新书变)"""
    await _pay(client, env)
    extra = [WordBook(name=f"课本{i}", series="人教版", stage_id=env["primary"].id,
                      pack_tier="basic", is_public=True) for i in range(3)]
    db_session.add_all(extra)
    await db_session.commit()
    picked = [env["books"]["p3"].id, env["books"]["j7"].id] + [x.id for x in extra]
    r = await _gen(client, env["oa"], card_kind="b5", book_ids=picked)
    assert r.status_code == 200, r.text
    assert r.json()[0]["book_count"] == 5
    r = await client.post("/api/v1/subscription/redeem", json={"code": r.json()[0]["code"]},
                          headers=_hdr(env["stu"]))
    assert r.json()["success"], r.json()
    owned = set((await db_session.execute(select(BookAssignment.book_id).where(
        BookAssignment.student_id == env["stu"].id))).scalars())
    assert owned == set(picked)
    a = (await db_session.execute(select(BookAssignment).where(
        BookAssignment.student_id == env["stu"].id, BookAssignment.book_id == picked[0]))).scalar_one()
    assert a.grant_type == "period" and a.expires_at - datetime.utcnow() > timedelta(days=178)

    r = await client.put(f"/api/v1/admin/subscriptions/pack/books/{env['books']['untier'].id}",
                         json={"pack_tier": "basic"}, headers=_hdr(env["admin"]))
    assert r.json()["synced_students"] == 0


async def test_org_admin_cannot_set_tier_or_pay(client, env):
    r = await client.put(f"/api/v1/admin/subscriptions/pack/books/{env['books']['untier'].id}",
                         json={"pack_tier": "basic"}, headers=_hdr(env["oa"]))
    assert r.status_code == 403
    r = await client.post(f"/api/v1/admin/organizations/{env['pack'].id}/card-pack",
                          json={"action": "settle"}, headers=_hdr(env["oa"]))
    assert r.status_code == 403


# ---------- 新政策机构: 卡包书只能凭兑换码开 ----------

async def test_teacher_cannot_assign_gated_book(client, env, db_session):
    t = User(username="pkteacher", email="t@e.com", hashed_password="x", role="teacher",
             is_active=True, org_id=env["pack"].id)
    lt = User(username="lgteacher", email="lt@e.com", hashed_password="x", role="teacher",
              is_active=True, org_id=env["old"].id)
    db_session.add_all([t, lt])
    await db_session.commit()
    body = {"book_id": env["books"]["p3"].id, "student_ids": [env["stu"].id]}
    r = await client.post("/api/v1/teacher/assign", json=body, headers=_hdr(t))
    assert r.status_code == 403 and "兑换码" in r.json()["detail"]
    # 入门课(体验档)和机构自建书照常可分配 —— 至少不被卡包闸门拦
    for key in ("intro", "own"):
        r = await client.post("/api/v1/teacher/assign",
                              json={**body, "book_id": env["books"][key].id}, headers=_hdr(t))
        assert "兑换码" not in r.text, key
    # 老政策机构的老师不受影响
    r = await client.post("/api/v1/teacher/assign", json=body, headers=_hdr(lt))
    assert "兑换码" not in r.text


async def test_teacher_rows_and_homework_dont_open_gated_book(client, env, db_session):
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    from app.models.word import Unit
    from app.services.scope_service import get_allowed_unit_ids, can_enter_unit
    b = env["books"]["p3"]
    unit = Unit(book_id=b.id, name="U1", unit_number=1, order_index=1)
    db_session.add(unit)
    await db_session.flush()
    # 绕过接口写一条老师分配的行 + 一份作业(模拟改造前的存量或别的入口)
    db_session.add(BookAssignment(book_id=b.id, student_id=env["stu"].id,
                                  teacher_id=env["oa"].id, scope_type="book"))
    hw = HomeworkAssignment(title="作业", teacher_id=env["oa"].id, unit_id=unit.id,
                            learning_mode="spelling")
    db_session.add(hw)
    await db_session.flush()
    hsa = HomeworkStudentAssignment(homework_id=hw.id, student_id=env["stu"].id)
    db_session.add(hsa)
    await db_session.commit()

    assert await get_allowed_unit_ids(db_session, env["stu"].id, b.id) == set()
    assert not await can_enter_unit(db_session, env["stu"].id, b.id, unit.id, hsa.id)
    r = await client.post(f"/api/v1/student/homework/{hsa.id}/start", headers=_hdr(env["stu"]))
    assert r.status_code == 403 and "兑换" in r.json()["detail"]
    books = (await client.get("/api/v1/student/books", headers=_hdr(env["stu"]))).json()
    assert not next(x for x in books if x["id"] == b.id)["owned"]

    # 兑换单册卡之后: 整本可学,作业也能做
    await _pay(client, env)
    code = (await _gen(client, env["oa"], card_kind="b1", book_ids=[b.id])).json()[0]["code"]
    assert (await client.post("/api/v1/subscription/redeem", json={"code": code},
                              headers=_hdr(env["stu"]))).json()["success"]
    assert await get_allowed_unit_ids(db_session, env["stu"].id, b.id) is None
    books = (await client.get("/api/v1/student/books", headers=_hdr(env["stu"]))).json()
    assert next(x for x in books if x["id"] == b.id)["owned"]


async def test_legacy_org_homework_still_opens_book(env, db_session):
    """老政策机构: 老师分配照样整本可学(零影响)"""
    from app.services.scope_service import get_allowed_unit_ids
    s2 = User(username="lgstu", email="ls@e.com", hashed_password="x", role="student",
              is_active=True, org_id=env["old"].id)
    db_session.add(s2)
    await db_session.flush()
    db_session.add(BookAssignment(book_id=env["books"]["p3"].id, student_id=s2.id,
                                  teacher_id=env["old_oa"].id, scope_type="book"))
    await db_session.commit()
    assert await get_allowed_unit_ids(db_session, s2.id, env["books"]["p3"].id) is None


async def test_card_rules_for_teacher(client, env, db_session):
    """老师能看规则;card_plan 区分新老机构(前端据此决定是否显示入口);学生看不到"""
    t = User(username="pkrulet", email="rt@e.com", hashed_password="x", role="teacher",
             is_active=True, org_id=env["pack"].id)
    lt = User(username="lgrulet", email="lrt@e.com", hashed_password="x", role="teacher",
              is_active=True, org_id=env["old"].id)
    db_session.add_all([t, lt])
    await db_session.commit()
    r = await client.get("/api/v1/teacher/card-rules", headers=_hdr(t))
    assert r.status_code == 200
    assert r.json()["card_plan"] == "pack"
    assert len(r.json()["catalog"]["installments"]) == 3
    r = await client.get("/api/v1/teacher/card-rules", headers=_hdr(lt))
    assert r.json()["card_plan"] == "legacy"
    r = await client.get("/api/v1/teacher/card-rules", headers=_hdr(env["stu"]))
    assert r.status_code == 403


async def test_delete_pack_org_leaves_nothing(client, env, db_session):
    """删新政策机构: 台账、码、码明细、学生的卡授权一行不留(这几张表通用扫描找不到)"""
    from sqlalchemy import text
    await _pay(client, env)
    code = (await _gen(client, env["oa"], card_kind="p2",
                       book_ids=[env["books"]["p3"].id, env["books"]["p4"].id])).json()[0]["code"]
    assert (await client.post("/api/v1/subscription/redeem", json={"code": code},
                              headers=_hdr(env["stu"]))).json()["success"]
    oid, ocode = env["pack"].id, env["pack"].code
    await client.patch(f"/api/v1/admin/organizations/{oid}", json={"status": "suspended"}, headers=_hdr(env["admin"]))
    r = await client.delete(f"/api/v1/admin/organizations/{oid}", params={"code": ocode}, headers=_hdr(env["admin"]))
    assert r.status_code == 200, r.text
    for sql in ("SELECT count(*) FROM org_card_ledger WHERE org_id=:o",
                "SELECT count(*) FROM pack_card_grants",
                "SELECT count(*) FROM redemption_codes WHERE card_kind IS NOT NULL",
                "SELECT count(*) FROM redemption_code_books WHERE code_id NOT IN (SELECT id FROM redemption_codes)",
                "SELECT count(*) FROM users WHERE org_id=:o"):
        assert (await db_session.execute(text(sql), {"o": oid})).scalar() == 0, sql
    # 别家机构/平台的书和老机构的数据不受影响
    assert (await db_session.execute(text("SELECT count(*) FROM organizations WHERE id=:o"),
                                     {"o": env["old"].id})).scalar() == 1
