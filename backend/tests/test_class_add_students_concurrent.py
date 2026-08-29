"""并发重复「加学生进班」不应 500(2026-08-29 生产实测)。

`class_students` 上有偏索引 `uq_active_student(student_id) WHERE is_active=1`
(一个学生只能活跃在一个班)。老师连点/前端并发发多份时,多个请求都查不到活跃关系
→ 都走 INSERT → 后到的撞约束。原先直接冒 500:生产 18:38:36-37 一秒内
6 次 500 与 3 次 200 交错。数据没坏(约束挡住了重复行),但老师看到"服务器错误"。

现在后到的那次按「已在班」返回成功(幂等语义)。
"""
import asyncio

import pytest

from app.api.v1.teacher._permissions import place_students_in_class
from app.core import tenancy
from app.models.organization import Organization
from app.models.user import Class, ClassStudent, User
from sqlalchemy import select, text


async def _setup(db):
    tenancy._org_cache.clear()
    org = Organization(name="并发测试机构", code="CONC1", status="active")
    db.add(org)
    await db.flush()
    teacher = User(username="t_conc", email="t_conc@e.com", hashed_password="x",
                   role="teacher", full_name="老师", is_active=True, org_id=org.id)
    stu = User(username="s_conc", email="s_conc@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True, org_id=org.id)
    db.add_all([teacher, stu])
    await db.flush()
    klass = Class(name="并发班", teacher_id=teacher.id, org_id=org.id)
    db.add(klass)
    await db.flush()
    # 内存库默认没有生产上的偏索引,显式建出来才能复现这个约束冲突
    await db.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student "
        "ON class_students(student_id) WHERE is_active = 1"))
    return teacher, stu, klass


@pytest.mark.asyncio
async def test_duplicate_add_hits_unique_index(db_session):
    """钉住约束本身:同一学生插入两条活跃关系必须被数据库拒绝。

    这是数据正确性的防线 —— 它失效了才会真的出现"一个学生活跃在两个班"。
    """
    from sqlalchemy.exc import IntegrityError
    teacher, stu, klass = await _setup(db_session)

    db_session.add(ClassStudent(class_id=klass.id, student_id=stu.id, is_active=True))
    await db_session.flush()

    klass2 = Class(name="并发班2", teacher_id=teacher.id, org_id=klass.org_id)
    db_session.add(klass2)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=klass2.id, student_id=stu.id, is_active=True))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_add_students_endpoint_is_idempotent(client, db_session):
    """重复调用加学生接口:第二次返回 200 + already_in,不是 500。"""
    teacher, stu, klass = await _setup(db_session)
    await db_session.commit()

    from tests.conftest import _make_token
    headers = {"Authorization": f"Bearer {_make_token(teacher.id)}"}
    body = {"student_ids": [stu.id]}

    r1 = await client.post(f"/api/v1/teacher/classes/{klass.id}/students",
                           json=body, headers=headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["added"] == 1

    # 第二次:place_students_in_class 会识别为 already_in,不产生新行
    r2 = await client.post(f"/api/v1/teacher/classes/{klass.id}/students",
                           json=body, headers=headers)
    assert r2.status_code == 200, r2.text
    assert stu.id in r2.json()["already_in"], r2.json()

    # 无论走哪条路径,活跃关系必须只有一条
    n = (await db_session.execute(
        select(ClassStudent).where(ClassStudent.student_id == stu.id,
                                   ClassStudent.is_active.is_(True))
    )).scalars().all()
    assert len(n) == 1, f"活跃关系应只有 1 条,实际 {len(n)}"


@pytest.mark.asyncio
async def test_true_concurrent_add_via_endpoint_never_500(tmp_path):
    """真并发打**端点**:三个请求同时加同一学生,一个 500 都不许有。

    这是生产 18:38:36-37 那一秒的实况(6 次 500 与 3 次 200 交错)。

    必须走 HTTP 端点、且每个请求一个独立 session —— 直接调
    place_students_in_class 会绕过端点的 try/except,旧代码也能过,
    测试就成了空跑(第一版就踩了这个,负控暴露出来的)。
    """
    from httpx import AsyncClient, ASGITransport
    from sqlalchemy.ext.asyncio import (
        create_async_engine, async_sessionmaker, AsyncSession,
    )
    from app.core.database import Base, get_db
    from app.main import app
    from tests.conftest import _make_token

    db_file = tmp_path / "conc_api.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student "
            "ON class_students(student_id) WHERE is_active = 1"))
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as db:
        teacher, stu, klass = await _setup(db)
        await db.commit()
        tid, sid, cid = teacher.id, stu.id, klass.id

    # 每个请求拿自己的 session(生产就是这样),否则并发写不会真正竞争
    async def override_get_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    try:
        headers = {"Authorization": f"Bearer {_make_token(tid)}"}
        body = {"student_ids": [sid]}
        async with AsyncClient(transport=ASGITransport(app=app),
                               base_url="http://test") as c:
            rs = await asyncio.gather(*[
                c.post(f"/api/v1/teacher/classes/{cid}/students",
                       json=body, headers=headers)
                for _ in range(3)
            ], return_exceptions=True)
    finally:
        app.dependency_overrides.pop(get_db, None)

    codes = [getattr(r, "status_code", repr(r)) for r in rs]
    assert all(c == 200 for c in codes), f"并发下出现非 200(线上就是 500): {codes}"

    # 约束仍然保住数据:活跃关系恰好一条
    async with Session() as db:
        rows = (await db.execute(
            select(ClassStudent).where(ClassStudent.student_id == sid,
                                       ClassStudent.is_active.is_(True))
        )).scalars().all()
        assert len(rows) == 1, f"活跃关系应只有 1 条,实际 {len(rows)}"

    await engine.dispose()
