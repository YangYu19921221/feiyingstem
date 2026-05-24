"""排行榜按班级 / 全平台范围过滤 (scope='class'|'all')。

需求:
- scope='all' 仍返回全平台排名（默认行为）
- scope='class' 仅返回当前学生所在最近 active 班级的同学
- 学生没班级时 scope='class' 返回 class_name=None top=[] total=0
- 不再 [:10] 截断, 返回完整排名 (上限 100)
"""
from datetime import datetime, timedelta

from app.models.user import User, Class, ClassStudent
from app.models.learning import LearningRecord
from app.services.auth_service import create_access_token


async def _make_student(db_session, username: str) -> User:
    u = User(username=username, email=f"{username}@x.com", hashed_password="x",
             role="student", full_name=username, is_active=True)
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


async def _make_class(db_session, name: str, teacher_id: int) -> Class:
    c = Class(name=name, teacher_id=teacher_id)
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c


async def _join(db_session, class_id: int, student_id: int):
    db_session.add(ClassStudent(class_id=class_id, student_id=student_id, is_active=True))
    await db_session.commit()


async def _seed_vocab(db_session, user_id: int, count: int):
    """造 count 条本周 is_correct=True 的 LearningRecord (词 id 各异)。"""
    base = datetime.utcnow() - timedelta(days=1)
    for i in range(count):
        db_session.add(LearningRecord(
            user_id=user_id, word_id=10000 + user_id * 1000 + i,
            learning_mode="classify", is_correct=True, time_spent=10,
            created_at=base,
        ))
    await db_session.commit()


async def test_scope_all_returns_all_students(client, db_session):
    teacher = await _make_student(db_session, "t_owner")
    teacher.role = "teacher"
    await db_session.commit()
    s_a = await _make_student(db_session, "alice")
    s_b = await _make_student(db_session, "bob")
    await _seed_vocab(db_session, s_a.id, 5)
    await _seed_vocab(db_session, s_b.id, 3)

    token = create_access_token({"sub": str(s_a.id)})
    r = await client.get("/api/v1/student/leaderboard",
                         params={"kind": "vocabulary", "period": "this_week", "scope": "all"},
                         headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "all"
    assert body["class_name"] is None
    ids = {e["user_id"] for e in body["top"]}
    assert s_a.id in ids and s_b.id in ids
    assert body["total_participants"] >= 2


async def test_scope_class_only_includes_classmates(client, db_session):
    teacher = await _make_student(db_session, "t2")
    teacher.role = "teacher"
    await db_session.commit()
    cls = await _make_class(db_session, "我的小班", teacher.id)
    s_in1 = await _make_student(db_session, "in1")
    s_in2 = await _make_student(db_session, "in2")
    s_out = await _make_student(db_session, "out")
    await _join(db_session, cls.id, s_in1.id)
    await _join(db_session, cls.id, s_in2.id)
    await _seed_vocab(db_session, s_in1.id, 7)
    await _seed_vocab(db_session, s_in2.id, 4)
    await _seed_vocab(db_session, s_out.id, 99)

    token = create_access_token({"sub": str(s_in1.id)})
    r = await client.get("/api/v1/student/leaderboard",
                         params={"kind": "vocabulary", "period": "this_week", "scope": "class"},
                         headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "class"
    assert body["class_name"] == "我的小班"
    ids = {e["user_id"] for e in body["top"]}
    assert s_in1.id in ids
    assert s_in2.id in ids
    assert s_out.id not in ids
    assert body["total_participants"] == 2


async def test_scope_class_with_no_class_returns_empty(client, db_session):
    s = await _make_student(db_session, "lonely")
    await _seed_vocab(db_session, s.id, 5)
    token = create_access_token({"sub": str(s.id)})

    r = await client.get("/api/v1/student/leaderboard",
                         params={"kind": "vocabulary", "period": "this_week", "scope": "class"},
                         headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "class"
    assert body["class_name"] is None
    assert body["top"] == []
    assert body["total_participants"] == 0


async def test_scope_all_no_truncation_at_10(client, db_session):
    """以前 rows[:10] 截断, 现在返回全部 (上限 100)。"""
    teacher = await _make_student(db_session, "tn")
    teacher.role = "teacher"
    await db_session.commit()
    students = []
    for i in range(15):
        s = await _make_student(db_session, f"u{i}")
        await _seed_vocab(db_session, s.id, 20 - i)
        students.append(s)

    token = create_access_token({"sub": str(students[0].id)})
    r = await client.get("/api/v1/student/leaderboard",
                         params={"kind": "vocabulary", "period": "this_week", "scope": "all"},
                         headers={"Authorization": f"Bearer {token}"})
    body = r.json()
    assert len(body["top"]) >= 15, f"Expected >=15, got {len(body['top'])}"
    assert body["total_participants"] >= 15
