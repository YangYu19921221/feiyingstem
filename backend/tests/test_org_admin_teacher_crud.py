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


# ============ 九、转交(离职交接,删除的前置步骤) ============

@pytest.mark.asyncio
async def test_handover_moves_classes_and_keeps_students(client: AsyncClient, org_fixture, db_session):
    """班级转交后学生跟着班走 —— class_students 一行都不该动"""
    src, dst, stu = org_fixture["t_a1"], org_fixture["t_a2"], org_fixture["stu"]
    src_id, dst_id, stu_id = src.id, dst.id, stu.id
    c = Class(name="交接班", teacher_id=src_id, org_id=org_fixture["org_a"].id)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=stu_id, is_active=True))
    await db_session.commit()
    cid = c.id

    r = await client.post(f"/api/v1/org/teachers/{src_id}/handover",
                          headers=_hdr(org_fixture["oa_a"]),
                          json={"to_teacher_id": dst_id})
    assert r.status_code == 200, r.text
    assert r.json()["moved"]["classes"] == 1, r.json()

    db_session.expire_all()
    owner = (await db_session.execute(
        select(Class.teacher_id).where(Class.id == cid))).scalar()
    assert owner == dst_id, "班级应归接手人"
    # 学生还在这个班里(没被动过)
    n = (await db_session.execute(
        select(ClassStudent).where(ClassStudent.class_id == cid,
                                   ClassStudent.student_id == stu_id))).scalars().all()
    assert len(n) == 1, "转交不该动学生与班级的关系"


@pytest.mark.asyncio
async def test_handover_then_delete_works(client: AsyncClient, org_fixture, db_session):
    """交接完就能删了 —— 这正是这个功能存在的理由"""
    src, dst = org_fixture["t_a1"], org_fixture["t_a2"]
    src_id, dst_id = src.id, dst.id
    hdr = _hdr(org_fixture["oa_a"])
    db_session.add(Class(name="班", teacher_id=src_id, org_id=org_fixture["org_a"].id))
    await db_session.commit()

    # 交接前删不掉
    assert (await client.delete(f"/api/v1/org/teachers/{src_id}", headers=hdr)).status_code == 409
    # 交接
    assert (await client.post(f"/api/v1/org/teachers/{src_id}/handover", headers=hdr,
                              json={"to_teacher_id": dst_id})).status_code == 200
    # 交接后删得掉
    assert (await client.delete(f"/api/v1/org/teachers/{src_id}", headers=hdr)).status_code == 200


@pytest.mark.asyncio
async def test_handover_duplicate_assignment_dropped_not_crashed(client: AsyncClient, org_fixture, db_session):
    """两位老师给同一学生开过同一本书时,交接要合并而不是撞唯一约束炸掉。

    ⚠️ 关于这条测试的真实性,必须说清(2026-09-11 实测):
    生产 `book_assignments` 上有三个**部分唯一索引**(uq_assign_book/unit/group),
    键里不含 teacher_id,例如 `(book_id, student_id) WHERE scope_type='book'`。
    它们由 `init_db()` 的裸 SQL 建,而 conftest 走 `create_all` **不建这些索引**
    (实测测试库上 book_assignments 索引为空)。所以:
      - 在**生产**上,下面这种"两位老师各有一行同 (book,student)"的状态
        **根本插不进去** —— 第二行会被唯一索引拒掉。合并分支是**防御性**的。
      - 在**测试**里能造出这个状态,恰恰因为测试库缺那些索引。

    那为什么保留这条测试和那段合并逻辑? 三个理由:
      ① scope_type='unit'/'group' 的键更宽((.., unit_id[, group_index])),
         同一 (book,student) 在不同 unit 上可以有多行,交接时仍要逐行判重;
      ② 索引是"部分"的 —— 历史数据里 scope_type 为 NULL 的行不受任何索引约束;
      ③ 若哪天有人改动索引定义,盲目 UPDATE 会让整个交接 500 回滚,
         而这段逻辑让它退化成"合并",代价只是多一次判重。
    这条测试锁住的是**合并语义本身**(学生权益不能因交接而丢),不是索引行为。
    """
    src, dst, stu = org_fixture["t_a1"], org_fixture["t_a2"], org_fixture["stu"]
    src_id, dst_id, stu_id = src.id, dst.id, stu.id
    book = WordBook(name="两人都开过的书", is_public=True)
    other = WordBook(name="只有他开过的书", is_public=True)
    db_session.add_all([book, other])
    await db_session.flush()
    db_session.add_all([
        BookAssignment(book_id=book.id, student_id=stu_id, teacher_id=src_id, scope_type="book"),
        BookAssignment(book_id=book.id, student_id=stu_id, teacher_id=dst_id, scope_type="book"),
        BookAssignment(book_id=other.id, student_id=stu_id, teacher_id=src_id, scope_type="book"),
    ])
    await db_session.commit()
    bid, oid = book.id, other.id

    r = await client.post(f"/api/v1/org/teachers/{src_id}/handover",
                          headers=_hdr(org_fixture["oa_a"]),
                          json={"to_teacher_id": dst_id})
    assert r.status_code == 200, r.text
    m = r.json()["moved"]
    assert m["dropped_duplicate_assignments"] == 1, m
    assert m["book_assignments"] == 1, m

    db_session.expire_all()
    # 重复的那本: 只剩一行,归接手人
    rows = (await db_session.execute(select(BookAssignment).where(
        BookAssignment.book_id == bid, BookAssignment.student_id == stu_id))).scalars().all()
    assert len(rows) == 1 and rows[0].teacher_id == dst_id, rows
    # 不重复的那本: 转给接手人,**学生仍然有这本书**(权益没丢)
    rows2 = (await db_session.execute(select(BookAssignment).where(
        BookAssignment.book_id == oid, BookAssignment.student_id == stu_id))).scalars().all()
    assert len(rows2) == 1 and rows2[0].teacher_id == dst_id, rows2


@pytest.mark.asyncio
async def test_handover_rejects_cross_org_target(client: AsyncClient, org_fixture):
    """接手人必须是本机构老师 —— 否则能把班级塞给别家机构(跨租户污染)"""
    r = await client.post(f"/api/v1/org/teachers/{org_fixture['t_a1'].id}/handover",
                          headers=_hdr(org_fixture["oa_a"]),
                          json={"to_teacher_id": org_fixture["t_b1"].id})
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_handover_rejects_self_and_inactive(client: AsyncClient, org_fixture, db_session):
    src_id, dst_id = org_fixture["t_a1"].id, org_fixture["t_a2"].id
    hdr = _hdr(org_fixture["oa_a"])

    r = await client.post(f"/api/v1/org/teachers/{src_id}/handover", headers=hdr,
                          json={"to_teacher_id": src_id})
    assert r.status_code == 400 and "自己" in r.json()["detail"], r.text

    # 交给停用的账号 = 这些班级立刻没人管,等于换个地方悬挂
    await client.patch(f"/api/v1/org/teachers/{dst_id}/toggle-active", headers=hdr)
    r = await client.post(f"/api/v1/org/teachers/{src_id}/handover", headers=hdr,
                          json={"to_teacher_id": dst_id})
    assert r.status_code == 400 and "停用" in r.json()["detail"], r.text


@pytest.mark.asyncio
async def test_handover_is_idempotent(client: AsyncClient, org_fixture, db_session):
    """重复交接安全: 第二次没有属于原老师的行可转,全 0"""
    src_id, dst_id = org_fixture["t_a1"].id, org_fixture["t_a2"].id
    hdr = _hdr(org_fixture["oa_a"])
    db_session.add(Class(name="班", teacher_id=src_id, org_id=org_fixture["org_a"].id))
    await db_session.commit()

    r1 = await client.post(f"/api/v1/org/teachers/{src_id}/handover", headers=hdr,
                           json={"to_teacher_id": dst_id})
    assert r1.json()["moved"]["classes"] == 1
    r2 = await client.post(f"/api/v1/org/teachers/{src_id}/handover", headers=hdr,
                           json={"to_teacher_id": dst_id})
    assert r2.status_code == 200 and r2.json()["moved"]["classes"] == 0, r2.text
