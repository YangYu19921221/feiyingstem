"""机构端: 管理员改自己密码 + 老师账号增删改查。

重点不在"功能能跑",而在三类事故:
  1. **提权**: 机构管理员能不能借老师端点去动别家机构的人、动别的 org_admin、
     动平台 admin。`_my_teacher` 把 role 锁死 teacher 就是为这个。
  2. **静默数据损坏**: 删老师会不会留下悬挂班级 / 抹掉学生已付费的书本授权。
     生产 `PRAGMA foreign_keys=0`,模型上的 ondelete=CASCADE 根本不生效。
  3. **会话残留**: 停用/重置密码后,旧 token 还能不能继续用。
"""
import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook
from app.services import auth_service
from tests.conftest import _make_token


@pytest.fixture
async def org_fixture(db_session):
    tenancy._org_cache.clear()
    org_a = Organization(name="A机构", code="OTA01", status="active", student_quota=100)
    org_b = Organization(name="B机构", code="OTB01", status="active", student_quota=100)
    db_session.add_all([org_a, org_b])
    await db_session.flush()

    def mk(username, role, org_id, pwd="Passw0rd!"):
        return User(username=username, email=f"{username}@e.com",
                    hashed_password=auth_service.get_password_hash(pwd),
                    role=role, full_name=f"{username}-姓名", is_active=True, org_id=org_id)

    oa_a = mk("otoaa", "org_admin", org_a.id)
    oa_b = mk("otoab", "org_admin", org_b.id)
    t_a1 = mk("otta1", "teacher", org_a.id)
    t_a2 = mk("otta2", "teacher", org_a.id)
    t_b1 = mk("ottb1", "teacher", org_b.id)
    stu_a = mk("ottstu", "student", org_a.id)
    plat = mk("otplat", "admin", org_a.id)
    db_session.add_all([oa_a, oa_b, t_a1, t_a2, t_b1, stu_a, plat])
    await db_session.commit()
    return {"org_a": org_a, "org_b": org_b, "oa_a": oa_a, "oa_b": oa_b,
            "t_a1": t_a1, "t_a2": t_a2, "t_b1": t_b1, "stu": stu_a, "plat": plat}


def _hdr(u):
    return {"Authorization": f"Bearer {_make_token(u.id)}"}


# ============ 一、机构管理员改自己密码 ============

@pytest.mark.asyncio
async def test_change_own_password_success(client: AsyncClient, org_fixture, db_session):
    oa = org_fixture["oa_a"]
    r = await client.put("/api/v1/org/my-password", headers=_hdr(oa),
                         json={"old_password": "Passw0rd!", "new_password": "NewPass123"})
    assert r.status_code == 200, r.text

    row = (await db_session.execute(
        select(User.hashed_password).where(User.id == oa.id)
    )).scalar()
    assert auth_service.verify_password("NewPass123", row)
    assert not auth_service.verify_password("Passw0rd!", row)


@pytest.mark.asyncio
async def test_change_own_password_wrong_old(client: AsyncClient, org_fixture, db_session):
    oa = org_fixture["oa_a"]
    r = await client.put("/api/v1/org/my-password", headers=_hdr(oa),
                         json={"old_password": "WrongOld", "new_password": "NewPass123"})
    assert r.status_code == 400, r.text
    # 密码没被改动
    row = (await db_session.execute(
        select(User.hashed_password).where(User.id == oa.id)
    )).scalar()
    assert auth_service.verify_password("Passw0rd!", row)


@pytest.mark.asyncio
async def test_change_own_password_same_as_old(client: AsyncClient, org_fixture):
    """改成与原密码相同要拒 —— 通用端点允许,但那等于没改却提示成功"""
    oa = org_fixture["oa_a"]
    r = await client.put("/api/v1/org/my-password", headers=_hdr(oa),
                         json={"old_password": "Passw0rd!", "new_password": "Passw0rd!"})
    assert r.status_code == 400, r.text
    assert "相同" in r.json()["detail"]


@pytest.mark.asyncio
async def test_change_own_password_too_short(client: AsyncClient, org_fixture):
    oa = org_fixture["oa_a"]
    r = await client.put("/api/v1/org/my-password", headers=_hdr(oa),
                         json={"old_password": "Passw0rd!", "new_password": "abc"})
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_change_password_does_not_kick_self(client: AsyncClient, org_fixture, db_session):
    """改完密码不该把自己踢下线(正式机构管理员不在顶号范围)"""
    oa = org_fixture["oa_a"]
    before = (await db_session.execute(
        select(User.session_ver).where(User.id == oa.id))).scalar() or 0
    await client.put("/api/v1/org/my-password", headers=_hdr(oa),
                     json={"old_password": "Passw0rd!", "new_password": "NewPass123"})
    after = (await db_session.execute(
        select(User.session_ver).where(User.id == oa.id))).scalar() or 0
    assert after == before
    # 原 token 仍可用
    r = await client.get("/api/v1/org/info", headers=_hdr(oa))
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_teacher_cannot_use_org_endpoints(client: AsyncClient, org_fixture):
    """老师不是机构管理员,拿不到这些端点"""
    r = await client.put("/api/v1/org/my-password", headers=_hdr(org_fixture["t_a1"]),
                         json={"old_password": "Passw0rd!", "new_password": "NewPass123"})
    assert r.status_code == 403, r.text


# ============ 二、查 ============

@pytest.mark.asyncio
async def test_list_only_own_org_teachers(client: AsyncClient, org_fixture):
    r = await client.get("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]))
    assert r.status_code == 200, r.text
    names = {t["username"] for t in r.json()}
    assert names == {"otta1", "otta2"}, names   # 不含 B 机构的 ottb1
    # 也不含学生/管理员账号
    assert "ottstu" not in names and "otoaa" not in names


@pytest.mark.asyncio
async def test_list_search(client: AsyncClient, org_fixture):
    r = await client.get("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]),
                         params={"q": "otta2"})
    assert r.status_code == 200, r.text
    assert [t["username"] for t in r.json()] == ["otta2"]


@pytest.mark.asyncio
async def test_list_search_underscore_is_literal(client: AsyncClient, org_fixture):
    """搜下划线不能命中全部(LIKE 通配符转义)"""
    r = await client.get("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]),
                         params={"q": "_"})
    assert r.status_code == 200, r.text
    assert r.json() == [], r.json()


@pytest.mark.asyncio
async def test_list_shows_dependent_counts(client: AsyncClient, org_fixture, db_session):
    """列表要带班级/学生数,否则停用前看不见影响面。学生按去重计"""
    t, stu = org_fixture["t_a1"], org_fixture["stu"]
    c1 = Class(name="班1", teacher_id=t.id, org_id=org_fixture["org_a"].id)
    c2 = Class(name="班2", teacher_id=t.id, org_id=org_fixture["org_a"].id)
    db_session.add_all([c1, c2])
    await db_session.flush()
    # 同一个学生进两个班 → 只能算 1 个人
    db_session.add_all([
        ClassStudent(class_id=c1.id, student_id=stu.id, is_active=True),
        ClassStudent(class_id=c2.id, student_id=stu.id, is_active=True),
    ])
    await db_session.commit()

    r = await client.get("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]))
    row = next(x for x in r.json() if x["username"] == "otta1")
    assert row["class_count"] == 2, row
    assert row["student_count"] == 1, row


# ============ 三、增 ============

@pytest.mark.asyncio
async def test_create_teacher(client: AsyncClient, org_fixture, db_session):
    r = await client.post("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]),
                          json={"username": "newteacher", "full_name": "新老师"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["initial_password"] and len(body["initial_password"]) >= 6

    u = (await db_session.execute(
        select(User).where(User.username == "newteacher")
        .execution_options(skip_tenant_filter=True)
    )).scalar_one()
    assert u.role == "teacher"
    assert u.org_id == org_fixture["org_a"].id   # 归本机构,不能是别家


@pytest.mark.asyncio
async def test_create_duplicate_username_across_orgs(client: AsyncClient, org_fixture):
    """用户名是全站唯一的登录凭据 —— 撞上别家机构的名字也要拒(不能靠唯一约束抛 500)。

    这是 tenancy 过滤器的经典陷阱: 按本机构查重会查不到别家的同名账号。
    """
    r = await client.post("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]),
                          json={"username": "ottb1"})   # B 机构已有的老师名
    assert r.status_code == 400, r.text
    assert "已存在" in r.json()["detail"]


@pytest.mark.asyncio
async def test_create_rejects_short_password(client: AsyncClient, org_fixture):
    r = await client.post("/api/v1/org/teachers", headers=_hdr(org_fixture["oa_a"]),
                          json={"username": "shortpw", "password": "123"})
    assert r.status_code == 400, r.text


# ============ 四、改 ============

@pytest.mark.asyncio
async def test_update_teacher_profile(client: AsyncClient, org_fixture, db_session):
    # ⚠️ id 先取成普通值再发请求: 请求会 commit,之后 expire_all 让 ORM 对象过期,
    # 再读 t.id 就触发懒加载 → async 会话下即 MissingGreenlet(CLAUDE.md 记过同类)
    tid = org_fixture["t_a1"].id
    hdr = _hdr(org_fixture["oa_a"])
    r = await client.patch(f"/api/v1/org/teachers/{tid}", headers=hdr,
                           json={"full_name": "改名后", "phone": "13800001111"})
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "改名后"

    db_session.expire_all()
    row = (await db_session.execute(
        select(User.full_name, User.phone).where(User.id == tid))).first()
    assert row.full_name == "改名后" and row.phone == "13800001111"


@pytest.mark.asyncio
async def test_update_phone_can_be_cleared(client: AsyncClient, org_fixture, db_session):
    """空串 = 明确要清空(老师换号了),不能被当成"没传"而跳过"""
    t = org_fixture["t_a1"]
    await client.patch(f"/api/v1/org/teachers/{t.id}", headers=_hdr(org_fixture["oa_a"]),
                       json={"phone": "13800002222"})
    r = await client.patch(f"/api/v1/org/teachers/{t.id}", headers=_hdr(org_fixture["oa_a"]),
                           json={"phone": ""})
    assert r.status_code == 200, r.text
    assert r.json()["phone"] is None, r.json()


@pytest.mark.asyncio
async def test_update_name_cannot_be_blank(client: AsyncClient, org_fixture):
    t = org_fixture["t_a1"]
    r = await client.patch(f"/api/v1/org/teachers/{t.id}", headers=_hdr(org_fixture["oa_a"]),
                           json={"full_name": "   "})
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_update_omitted_fields_untouched(client: AsyncClient, org_fixture, db_session):
    """只传姓名不该把手机号冲掉"""
    tid = org_fixture["t_a1"].id
    hdr = _hdr(org_fixture["oa_a"])
    await client.patch(f"/api/v1/org/teachers/{tid}", headers=hdr,
                       json={"phone": "13800003333"})
    await client.patch(f"/api/v1/org/teachers/{tid}", headers=hdr,
                       json={"full_name": "只改名"})
    db_session.expire_all()
    row = (await db_session.execute(
        select(User.full_name, User.phone).where(User.id == tid))).first()
    assert (row.full_name, row.phone) == ("只改名", "13800003333"), row


# ============ 五、重置老师密码 ============

@pytest.mark.asyncio
async def test_reset_teacher_password(client: AsyncClient, org_fixture, db_session):
    tid = org_fixture["t_a1"].id
    r = await client.post(f"/api/v1/org/teachers/{tid}/reset-password",
                          headers=_hdr(org_fixture["oa_a"]), json={})
    assert r.status_code == 200, r.text
    pwd = r.json()["new_password"]
    assert pwd and len(pwd) >= 6

    db_session.expire_all()
    row = (await db_session.execute(
        select(User.hashed_password).where(User.id == tid))).scalar()
    assert auth_service.verify_password(pwd, row)


@pytest.mark.asyncio
async def test_reset_with_explicit_password_not_echoed(client: AsyncClient, org_fixture):
    """管理员自己设的密码不回显 —— 他已经知道了,回显只多一处泄露面"""
    t = org_fixture["t_a1"]
    r = await client.post(f"/api/v1/org/teachers/{t.id}/reset-password",
                          headers=_hdr(org_fixture["oa_a"]),
                          json={"new_password": "MySetPass9"})
    assert r.status_code == 200, r.text
    assert r.json()["new_password"] is None, r.json()


@pytest.mark.asyncio
async def test_reset_password_invalidates_old_sessions(client: AsyncClient, org_fixture, db_session):
    """重置密码 = 原密码可能已泄露,旧 token 必须立刻失效"""
    tid = org_fixture["t_a1"].id
    before = (await db_session.execute(
        select(User.session_ver).where(User.id == tid))).scalar() or 0
    await client.post(f"/api/v1/org/teachers/{tid}/reset-password",
                      headers=_hdr(org_fixture["oa_a"]), json={})
    db_session.expire_all()
    after = (await db_session.execute(
        select(User.session_ver).where(User.id == tid))).scalar() or 0
    assert after == before + 1


# ============ 六、提权防线(最关键) ============

@pytest.mark.asyncio
async def test_cannot_touch_other_org_teacher(client: AsyncClient, org_fixture):
    """A 机构管理员碰不到 B 机构的老师,一律 404(不泄露存在性)"""
    tb = org_fixture["t_b1"]
    oa_a = _hdr(org_fixture["oa_a"])
    for call in [
        client.patch(f"/api/v1/org/teachers/{tb.id}", headers=oa_a, json={"full_name": "x"}),
        client.post(f"/api/v1/org/teachers/{tb.id}/reset-password", headers=oa_a, json={}),
        client.patch(f"/api/v1/org/teachers/{tb.id}/toggle-active", headers=oa_a),
        client.delete(f"/api/v1/org/teachers/{tb.id}", headers=oa_a),
        client.get(f"/api/v1/org/teachers/{tb.id}/dependents", headers=oa_a),
    ]:
        r = await call
        assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_cannot_reset_other_org_admin_password(client: AsyncClient, org_fixture, db_session):
    """**提权**: 不能拿老师端点去重置另一个 org_admin 的密码"""
    victim = org_fixture["oa_b"]
    r = await client.post(f"/api/v1/org/teachers/{victim.id}/reset-password",
                          headers=_hdr(org_fixture["oa_a"]), json={})
    assert r.status_code == 404, r.text
    row = (await db_session.execute(
        select(User.hashed_password).where(User.id == victim.id))).scalar()
    assert auth_service.verify_password("Passw0rd!", row)   # 没被动过


@pytest.mark.asyncio
async def test_cannot_reset_platform_admin_password(client: AsyncClient, org_fixture, db_session):
    """**提权**: 平台 admin 恰好同 org_id,只靠 org_id 过滤会漏 —— role 必须锁死"""
    victim = org_fixture["plat"]
    assert victim.org_id == org_fixture["oa_a"].org_id   # 同机构,前提成立
    r = await client.post(f"/api/v1/org/teachers/{victim.id}/reset-password",
                          headers=_hdr(org_fixture["oa_a"]), json={})
    assert r.status_code == 404, r.text
    row = (await db_session.execute(
        select(User.hashed_password).where(User.id == victim.id))).scalar()
    assert auth_service.verify_password("Passw0rd!", row)


@pytest.mark.asyncio
async def test_cannot_touch_student_via_teacher_endpoint(client: AsyncClient, org_fixture):
    stu = org_fixture["stu"]
    r = await client.post(f"/api/v1/org/teachers/{stu.id}/reset-password",
                          headers=_hdr(org_fixture["oa_a"]), json={})
    assert r.status_code == 404, r.text


# ============ 七、停用 ============

@pytest.mark.asyncio
async def test_toggle_active_kicks_sessions(client: AsyncClient, org_fixture, db_session):
    tid = org_fixture["t_a1"].id
    t_hdr = _hdr(org_fixture["t_a1"])   # 先建好,过期后拿不到 .id
    oa_hdr = _hdr(org_fixture["oa_a"])
    before = (await db_session.execute(
        select(User.session_ver).where(User.id == tid))).scalar() or 0

    r = await client.patch(f"/api/v1/org/teachers/{tid}/toggle-active", headers=oa_hdr)
    assert r.status_code == 200 and r.json()["is_active"] is False, r.text
    db_session.expire_all()
    after = (await db_session.execute(
        select(User.session_ver).where(User.id == tid))).scalar() or 0
    assert after == before + 1, "停用必须作废已发出的会话"

    # 停用后老师立刻用不了系统
    r = await client.get("/api/v1/org/teachers", headers=t_hdr)
    assert r.status_code in (400, 401, 403), r.text

    # 恢复不 bump(没有泄露风险,不必踢掉谁)
    r = await client.patch(f"/api/v1/org/teachers/{tid}/toggle-active", headers=oa_hdr)
    assert r.json()["is_active"] is True
    db_session.expire_all()
    final = (await db_session.execute(
        select(User.session_ver).where(User.id == tid))).scalar() or 0
    assert final == after


# ============ 八、删(静默数据损坏防线) ============

@pytest.mark.asyncio
async def test_delete_clean_teacher(client: AsyncClient, org_fixture, db_session):
    """零依赖的账号(建错名字/体验号)可以删"""
    t = org_fixture["t_a2"]
    tid = t.id
    r = await client.delete(f"/api/v1/org/teachers/{tid}", headers=_hdr(org_fixture["oa_a"]))
    assert r.status_code == 200, r.text
    gone = (await db_session.execute(
        select(User).where(User.id == tid).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    assert gone is None


@pytest.mark.asyncio
async def test_delete_refused_when_teacher_has_class(client: AsyncClient, org_fixture, db_session):
    """有班级就不许删 —— FK 关闭,删了只会留下没人看得见的悬挂班级"""
    t = org_fixture["t_a1"]
    db_session.add(Class(name="有学生的班", teacher_id=t.id, org_id=org_fixture["org_a"].id))
    await db_session.commit()

    r = await client.delete(f"/api/v1/org/teachers/{t.id}", headers=_hdr(org_fixture["oa_a"]))
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "TEACHER_HAS_DEPENDENTS"
    assert detail["dependents"]["classes"] == 1
    assert "停用" in detail["message"]     # 必须给出路

    # 账号仍在
    still = (await db_session.execute(
        select(User).where(User.id == t.id).execution_options(skip_tenant_filter=True)
    )).scalar_one_or_none()
    assert still is not None


@pytest.mark.asyncio
async def test_delete_refused_protects_paid_book_access(client: AsyncClient, org_fixture, db_session):
    """最关键的一条: 老师名下有学生书本授权时删除必须被拒。

    模型上 book_assignments.teacher_id 是 ondelete=CASCADE —— 一旦哪天有人
    打开 `PRAGMA foreign_keys`,删老师就会**连学生已付费的书本授权一起删掉**。
    这道 409 是唯一挡住它的东西。
    """
    t, stu = org_fixture["t_a1"], org_fixture["stu"]
    book = WordBook(name="学生付过钱的书", is_public=True)
    db_session.add(book)
    await db_session.flush()
    db_session.add(BookAssignment(book_id=book.id, student_id=stu.id,
                                  teacher_id=t.id, scope_type="book"))
    await db_session.commit()

    r = await client.delete(f"/api/v1/org/teachers/{t.id}", headers=_hdr(org_fixture["oa_a"]))
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["dependents"]["book_assignments"] == 1

    # 授权一行没少
    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_dependents_precheck_matches_delete(client: AsyncClient, org_fixture, db_session):
    """预检与删除共用一份判定,不能"预检说能删、删的时候被拒" """
    t = org_fixture["t_a1"]
    oa = _hdr(org_fixture["oa_a"])

    r = await client.get(f"/api/v1/org/teachers/{t.id}/dependents", headers=oa)
    assert r.status_code == 200 and r.json()["deletable"] is True, r.text
    assert (await client.delete(f"/api/v1/org/teachers/{t.id}", headers=oa)).status_code == 200

    # 加了依赖后预检要说不可删
    t2 = org_fixture["t_a2"]
    db_session.add(Class(name="班", teacher_id=t2.id, org_id=org_fixture["org_a"].id))
    await db_session.commit()
    r = await client.get(f"/api/v1/org/teachers/{t2.id}/dependents", headers=oa)
    assert r.json()["deletable"] is False, r.json()
    assert (await client.delete(f"/api/v1/org/teachers/{t2.id}", headers=oa)).status_code == 409


@pytest.mark.asyncio
async def test_fk_enforcement_is_off_assumption(db_session):
    """把「FK 关闭」这个前提钉成测试。

    删除策略整个建立在它上面: FK 关就是留悬挂行,FK 开就是级联删掉付费授权。
    哪天有人打开它,这条会失败,提醒回来重看 _teacher_dependents 的注释。
    """
    fk = (await db_session.execute(text("PRAGMA foreign_keys"))).scalar()
    assert fk == 0, (
        "FK 变成开启了: 此时删老师会级联删掉 book_assignments(学生付费授权)。"
        "删除闸门必须继续拦住有依赖的账号,不能放宽"
    )
