"""音标视频手动排序

守四件事:
1. 保存后学生端/教师端都按新顺序(先分类、再 sort_order)
2. 名单不完整(中途有人上传)或混进别家/预置/别的分类的 id → 409,一条都不写
3. 新上传的视频排到分类末尾,不会以 sort_order=0 插到老师排好的最前面
4. 改分类后排到新分类末尾
"""
import io

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.models.user import User
from app.models.phonetic import PhoneticVideo
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def env(db_session):
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9931, '机构甲', 'orgroja', 'active', 'assigned'), "
        "(9932, '机构乙', 'orgroyi', 'active', 'assigned')"
    ))
    users = {}
    for key, uname, role, org in [
        ("t1", "tchroone", "teacher", 9931),
        ("t2", "tchrotwo", "teacher", 9932),
        ("s1", "sturoone", "student", 9931),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u
    vids = {}
    for key, org, cat in [("a", 9931, "vowel"), ("b", 9931, "vowel"), ("c", 9931, "vowel"),
                          ("basic1", 9931, "basic"), ("other_org", 9932, "vowel"),
                          ("preset", None, "vowel")]:
        v = PhoneticVideo(title=f"v-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
                          category=cat, is_active=True, org_id=org)
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()
    return {"tok": {k: _make_token(u.id) for k, u in users.items()}, "vid": vids}


def _h(t):
    return {"Authorization": f"Bearer {t}"}


async def _reorder(client, tok, category, ids):
    return await client.post("/api/v1/teacher/phonetics/videos/reorder",
                             headers=_h(tok), json={"category": category, "ids": ids})


async def test_order_list_only_own_org(client: AsyncClient, env):
    r = await client.get("/api/v1/teacher/phonetics/videos/order",
                         headers=_h(env["tok"]["t1"]), params={"category": "vowel"})
    assert r.status_code == 200, r.text
    ids = [x["id"] for x in r.json()["items"]]
    v = env["vid"]
    assert ids == [v["a"], v["b"], v["c"]]          # 不含别家、不含预置、不含别的分类
    assert r.json()["preset_count"] == 1


async def test_reorder_applies_to_teacher_and_student_lists(client: AsyncClient, env):
    v = env["vid"]
    r = await _reorder(client, env["tok"]["t1"], "vowel", [v["c"], v["a"], v["b"]])
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/teacher/phonetics/videos/order",
                         headers=_h(env["tok"]["t1"]), params={"category": "vowel"})
    assert [x["id"] for x in r.json()["items"]] == [v["c"], v["a"], v["b"]]

    # 教师分页列表: 先分类(basic 在 vowel 前),组内按新顺序;预置 sort_order=0 排最前
    r = await client.get("/api/v1/teacher/phonetics/videos",
                         headers=_h(env["tok"]["t1"]), params={"page": 1, "page_size": 50})
    ids = [x["id"] for x in r.json()["items"]]
    assert ids == [v["basic1"], v["preset"], v["c"], v["a"], v["b"]]

    # 学生端同一个顺序
    r = await client.get("/api/v1/phonetics/videos", headers=_h(env["tok"]["s1"]))
    assert r.status_code == 200, r.text
    ids = [x["id"] for x in r.json()]
    assert ids == [v["basic1"], v["preset"], v["c"], v["a"], v["b"]]


async def test_reorder_rejects_incomplete_or_foreign_ids(client: AsyncClient, env, db_session):
    v = env["vid"]
    tok = env["tok"]["t1"]
    for bad in (
        [v["a"], v["b"]],                               # 漏一条(中途有人上传)
        [v["a"], v["b"], v["c"], v["other_org"]],       # 混进别家
        [v["a"], v["b"], v["c"], v["preset"]],          # 混进平台预置
        [v["a"], v["b"], v["c"], v["basic1"]],          # 混进别的分类
    ):
        r = await _reorder(client, tok, "vowel", bad)
        assert r.status_code == 409, (bad, r.text)
    r = await _reorder(client, tok, "vowel", [v["a"], v["a"], v["b"]])
    assert r.status_code == 400
    # 一条都没写
    rows = (await db_session.execute(sql_text(
        "SELECT sort_order FROM phonetic_videos WHERE id IN (:a,:b,:c,:o,:p)"),
        {"a": v["a"], "b": v["b"], "c": v["c"], "o": v["other_org"], "p": v["preset"]})).all()
    assert all(r[0] == 0 for r in rows)


async def test_other_org_cannot_reorder_mine(client: AsyncClient, env):
    v = env["vid"]
    r = await _reorder(client, env["tok"]["t2"], "vowel", [v["c"], v["a"], v["b"]])
    assert r.status_code == 409


async def test_new_upload_goes_to_end(client: AsyncClient, env, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path / "pv"), raising=False)
    v = env["vid"]
    tok = env["tok"]["t1"]
    assert (await _reorder(client, tok, "vowel", [v["c"], v["a"], v["b"]])).status_code == 200
    r = await client.post(
        "/api/v1/teacher/phonetics/videos/upload", headers=_h(tok),
        data={"category": "vowel", "lecturer": "王老师", "title": "new"},
        files={"file": ("x.mp4", io.BytesIO(b"\x00" * 64), "video/mp4")},
    )
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    r = await client.get("/api/v1/teacher/phonetics/videos/order",
                         headers=_h(tok), params={"category": "vowel"})
    assert [x["id"] for x in r.json()["items"]] == [v["c"], v["a"], v["b"], new_id]


async def test_change_category_goes_to_end(client: AsyncClient, env):
    v = env["vid"]
    tok = env["tok"]["t1"]
    assert (await _reorder(client, tok, "vowel", [v["c"], v["a"], v["b"]])).status_code == 200
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{v['basic1']}",
                         headers=_h(tok), json={"category": "vowel"})
    assert r.status_code == 200, r.text
    r = await client.get("/api/v1/teacher/phonetics/videos/order",
                         headers=_h(tok), params={"category": "vowel"})
    assert [x["id"] for x in r.json()["items"]] == [v["c"], v["a"], v["b"], v["basic1"]]


# ---------------- 按讲师分开排(2026-10-18) ----------------
# 一个机构两位老师各讲一套,混在一个列表里没法排。只排一位讲师时:
# 1. 列表只给这位讲师的;另返回该分类里有哪几位讲师
# 2. 保存后这位讲师的课按新顺序,**另一位讲师的课一个都不动**(相对位置也不变)
# 3. 整个分类重写成 10/20/30…,不会和另一位讲师撞成并列
# 4. 名单不全 / 混进别的讲师 → 409 一条不写

@pytest_asyncio.fixture
async def two_lecturers(db_session):
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9933, '机构丙', 'orgrobi', 'active', 'assigned')"
    ))
    t = User(username="tchrolec", email="tchrolec@e.com", hashed_password="x",
             role="teacher", full_name="tchrolec", is_active=True, org_id=9933)
    db_session.add(t)
    await db_session.flush()
    # 交错着传: E1 J1 E2 J2 E3 + 一个未指定讲师的 N1
    vids = {}
    for i, (key, lec) in enumerate([("e1", "Ella老师"), ("j1", "佳佳老师"), ("e2", "Ella老师"),
                                    ("j2", "佳佳老师"), ("e3", "Ella老师"), ("n1", None)]):
        v = PhoneticVideo(title=f"v-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
                          category="basic", is_active=True, org_id=9933, lecturer=lec,
                          sort_order=(i + 1) * 10)
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()
    return _make_token(t.id), vids


async def _order(client, tok, lecturer=None):
    params = {"category": "basic"}
    if lecturer is not None:
        params["lecturer"] = lecturer
    r = await client.get("/api/v1/teacher/phonetics/videos/order", headers=_h(tok), params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_order_list_by_lecturer(client: AsyncClient, two_lecturers):
    tok, v = two_lecturers
    data = await _order(client, tok, "Ella老师")
    assert [x["id"] for x in data["items"]] == [v["e1"], v["e2"], v["e3"]]
    assert data["lecturers"] == [
        {"name": "Ella老师", "count": 3}, {"name": "佳佳老师", "count": 2}, {"name": " none", "count": 1},
    ]
    assert [x["id"] for x in (await _order(client, tok, " none"))["items"]] == [v["n1"]]


async def test_reorder_one_lecturer_leaves_other_in_place(client: AsyncClient, two_lecturers, db_session):
    tok, v = two_lecturers
    r = await client.post("/api/v1/teacher/phonetics/videos/reorder", headers=_h(tok), json={
        "category": "basic", "lecturer": "Ella老师", "ids": [v["e3"], v["e1"], v["e2"]]})
    assert r.status_code == 200, r.text
    # Ella 的课填回她原来的三个位置(1、3、5),佳佳老师和未指定的原地不动
    whole = [x["id"] for x in (await _order(client, tok))["items"]]
    assert whole == [v["e3"], v["j1"], v["e1"], v["j2"], v["e2"], v["n1"]]
    rows = (await db_session.execute(sql_text(
        "SELECT sort_order FROM phonetic_videos WHERE org_id=9933 ORDER BY sort_order"))).all()
    assert [r[0] for r in rows] == [10, 20, 30, 40, 50, 60]     # 没有并列


async def test_reorder_lecturer_rejects_foreign_or_incomplete(client: AsyncClient, two_lecturers, db_session):
    tok, v = two_lecturers
    for bad in ([v["e1"], v["e2"]],                       # 漏一条
                [v["e1"], v["e2"], v["e3"], v["j1"]]):    # 混进另一位讲师
        r = await client.post("/api/v1/teacher/phonetics/videos/reorder", headers=_h(tok), json={
            "category": "basic", "lecturer": "Ella老师", "ids": bad})
        assert r.status_code == 409, (bad, r.text)
    rows = (await db_session.execute(sql_text(
        "SELECT id FROM phonetic_videos WHERE org_id=9933 ORDER BY sort_order"))).all()
    assert [r[0] for r in rows] == [v["e1"], v["j1"], v["e2"], v["j2"], v["e3"], v["n1"]]
