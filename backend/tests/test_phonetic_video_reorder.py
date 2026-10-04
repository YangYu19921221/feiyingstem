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
