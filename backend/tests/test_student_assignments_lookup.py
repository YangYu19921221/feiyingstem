"""GET /teacher/students/{id}/assignments —— 按学生查"他开了哪些书"。

关键口径:返回**所有**老师分配给该学生的书(学生实际可学范围的并集),
不像 /teacher/assignments 那样只看 teacher_id=自己;权限只放行本班学生。
"""
import pytest
from httpx import AsyncClient

from app.core import tenancy
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent
from app.models.word import WordBook, Unit
from tests.conftest import _make_token


@pytest.fixture
async def two_teachers_one_student(db_session):
    """t1/t2 两个老师;学生在 t1 班上;两人各给该学生分配了书。"""
    tenancy._org_cache.clear()  # 机构状态有进程内缓存,测试间必须清
    org = Organization(name="测试机构", code="BKT01", status="active")
    db_session.add(org)
    await db_session.flush()

    t1 = User(username="bk_t1", email="bk_t1@e.com", hashed_password="x",
              role="teacher", full_name="老师一", is_active=True, org_id=org.id)
    t2 = User(username="bk_t2", email="bk_t2@e.com", hashed_password="x",
              role="teacher", full_name="老师二", is_active=True, org_id=org.id)
    stu = User(username="bk_stu", email="bk_stu@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    outsider = User(username="bk_out", email="bk_out@e.com", hashed_password="x",
                    role="student", full_name="别班学生", is_active=True, org_id=org.id)
    db_session.add_all([t1, t2, stu, outsider])
    await db_session.flush()

    cls = Class(name="三年级1班", teacher_id=t1.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))

    book_a = WordBook(name="人教版三上", is_public=True)
    book_b = WordBook(name="牛津分级", is_public=True)
    db_session.add_all([book_a, book_b])
    await db_session.flush()
    unit = Unit(book_id=book_a.id, unit_number=3, name="Unit 3: Colors")
    db_session.add(unit)
    await db_session.flush()

    # t1 分配整本 + 一个单元;t2 分配另一本(这条是老接口查不到的)
    db_session.add_all([
        BookAssignment(book_id=book_a.id, student_id=stu.id, teacher_id=t1.id,
                       scope_type="book"),
        BookAssignment(book_id=book_a.id, student_id=stu.id, teacher_id=t1.id,
                       scope_type="unit", unit_id=unit.id),
        BookAssignment(book_id=book_b.id, student_id=stu.id, teacher_id=t2.id,
                       scope_type="book"),
    ])
    await db_session.commit()
    return t1, t2, stu, outsider, org


@pytest.mark.asyncio
async def test_returns_all_teachers_assignments(client: AsyncClient, two_teachers_one_student):
    """t1 查自己班学生,应看到 3 条 —— 包括 t2 分配的那本。"""
    t1, t2, stu, _, org = two_teachers_one_student
    r = await client.get(
        f"/api/v1/teacher/students/{stu.id}/assignments",
        headers={"Authorization": f"Bearer {_make_token(t1.id)}"},
    )
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 3
    # 并集口径:两个老师的分配都在
    assert {row["teacher_id"] for row in rows} == {t1.id, t2.id}
    assert {row["book_name"] for row in rows} == {"人教版三上", "牛津分级"}


@pytest.mark.asyncio
async def test_unit_scope_carries_unit_name(client: AsyncClient, two_teachers_one_student):
    """单元级分配要带出单元名/编号,否则前端只能显示裸 book 名。"""
    t1, _, stu, _, org = two_teachers_one_student
    r = await client.get(
        f"/api/v1/teacher/students/{stu.id}/assignments",
        headers={"Authorization": f"Bearer {_make_token(t1.id)}"},
    )
    unit_rows = [x for x in r.json() if x["scope_type"] == "unit"]
    assert len(unit_rows) == 1
    assert unit_rows[0]["unit_name"] == "Unit 3: Colors"
    assert unit_rows[0]["unit_number"] == 3


@pytest.mark.asyncio
async def test_other_teachers_student_is_403(client: AsyncClient, two_teachers_one_student):
    """t2 班上没这个学生 → 403,不能拿别人的学生 id 随便查。"""
    _, t2, stu, _, org = two_teachers_one_student
    r = await client.get(
        f"/api/v1/teacher/students/{stu.id}/assignments",
        headers={"Authorization": f"Bearer {_make_token(t2.id)}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_call(client: AsyncClient, two_teachers_one_student):
    """学生自己不能走教师端接口(免得拿同学 id 互查)。"""
    _, _, stu, outsider, org = two_teachers_one_student
    r = await client.get(
        f"/api/v1/teacher/students/{stu.id}/assignments",
        headers={"Authorization": f"Bearer {_make_token(outsider.id)}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_no_assignments_returns_empty(client: AsyncClient, two_teachers_one_student, db_session):
    """没分配过书的学生返回空列表而不是 404 —— 前端靠这个显示"去分配"引导。"""
    t1, _, _, _, org = two_teachers_one_student
    fresh = User(username="bk_stu2", email="bk_stu2@e.com", hashed_password="x",
                 role="student", full_name="学生乙", is_active=True, org_id=org.id)
    db_session.add(fresh)
    await db_session.flush()
    cls_id = (await db_session.execute(
        __import__("sqlalchemy").select(Class.id).where(Class.teacher_id == t1.id)
    )).scalar_one()
    db_session.add(ClassStudent(class_id=cls_id, student_id=fresh.id, is_active=True))
    await db_session.commit()

    r = await client.get(
        f"/api/v1/teacher/students/{fresh.id}/assignments",
        headers={"Authorization": f"Bearer {_make_token(t1.id)}"},
    )
    assert r.status_code == 200
    assert r.json() == []
