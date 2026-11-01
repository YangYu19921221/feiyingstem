"""音标视频「每个学生 × 每节课」观看明细(GET /teacher/phonetics/watch-records)

守三件事:
1. **范围对**: 只给本班学生(同机构不在班上的不给)、别家机构在预置视频上的观看不给;
   单个学生不在本班 → 404
2. **一节没看的学生也在名单里** —— 导出表要拿来找没看的人
3. **和总览对得上**: 同一个学生,明细里加起来的时长 / 看完节数 == 总览那一行。
   对不上的话老师拿导出表核对页面会发现两个数,两个都不敢信了
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.models.user import User, Class, ClassStudent
from app.models.phonetic import PhoneticVideo, PhoneticVideoView
from app.services import rate_limit
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

T = "/api/v1/teacher/phonetics"


@pytest_asyncio.fixture
async def wr_env(db_session):
    """甲机构老师带一个班(stu1 / stu2);stu3 同机构不在班上;stub 在乙机构。
    视频: 甲机构 v1(讲师王老师)、v1b(讲师李老师)、乙机构 v2、平台预置 preset。
    """
    rate_limit.reset()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9961, '明细甲', 'orgwra', 'active', 'assigned'), "
        "(9962, '明细乙', 'orgwrb', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchwrone", "teacher", 9961),
        ("admin", "admwr", "admin", 9961),
        ("stu1", "stuwrone", "student", 9961),
        ("stu2", "stuwrtwo", "student", 9961),
        ("stu3", "stuwrthree", "student", 9961),
        ("stub", "stuwrb", "student", 9962),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=f"名字{uname}", is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    cls = Class(name="明细一班", teacher_id=users["t1"].id, org_id=9961)
    db_session.add(cls)
    await db_session.flush()
    for k in ("stu1", "stu2"):
        db_session.add(ClassStudent(class_id=cls.id, student_id=users[k].id,
                                    is_active=True))

    vids = {}
    for key, org, lecturer in [
        ("v1", 9961, "王老师"), ("v1b", 9961, "李老师"),
        ("v2", 9962, None), ("preset", None, None),
    ]:
        v = PhoneticVideo(
            title=f"wr-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org, duration_seconds=600,
            lecturer=lecturer,
        )
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id

    def view(vk, uk, secs, pos, done, plays=1):
        db_session.add(PhoneticVideoView(
            video_id=vids[vk], user_id=users[uk].id, play_count=plays,
            watch_seconds=secs, max_position_seconds=pos,
            last_position_seconds=pos, completed=done,
        ))

    view("v1", "stu1", 500, 590, True, plays=3)
    view("v1b", "stu1", 120, 200, False)
    view("preset", "stu1", 30, 30, False)
    view("v1", "stu3", 400, 590, True)          # 同机构但不在班上
    view("preset", "stub", 999, 600, True)      # 别家机构的学生看预置视频
    await db_session.commit()

    return {
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "uid": {k: u.id for k, u in users.items()},
        "vid": vids,
    }


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def test_records_scoped_to_my_class(client: AsyncClient, wr_env):
    """名单 = 本班两人(没看的 stu2 也在),记录只有本班学生在本机构可见视频上的"""
    r = await client.get(f"{T}/watch-records", headers=_h(wr_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    body = r.json()
    uid, vid = wr_env["uid"], wr_env["vid"]

    assert body["scope"] == "my_classes"
    assert body["roster_size"] == 2
    assert [s["student_id"] for s in body["students"]] == [uid["stu1"], uid["stu2"]]
    assert body["students"][0]["classes"] == ["明细一班"]

    # 视频: 甲机构的两个 + 预置,没有乙机构的
    assert {v["id"] for v in body["videos"]} == {vid["v1"], vid["v1b"], vid["preset"]}

    got = {(x["student_id"], x["video_id"]) for x in body["records"]}
    assert got == {(uid["stu1"], vid["v1"]), (uid["stu1"], vid["v1b"]),
                   (uid["stu1"], vid["preset"])}, got
    row = next(x for x in body["records"] if x["video_id"] == vid["v1"])
    assert row["play_count"] == 3
    assert row["watch_seconds"] == 500
    assert row["max_position_seconds"] == 590
    assert row["completed"] is True


async def test_single_student(client: AsyncClient, wr_env):
    """只看一个学生: 本班的给,不在班上的 / 别家机构的 404"""
    uid = wr_env["uid"]
    hdr = _h(wr_env["tok"]["t1"])

    r = await client.get(f"{T}/watch-records", params={"student_id": uid["stu1"]},
                         headers=hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["student_id"] for s in body["students"]] == [uid["stu1"]]
    assert {x["student_id"] for x in body["records"]} == {uid["stu1"]}
    assert len(body["records"]) == 3

    # 没看过的本班学生: 名单里有他,记录为空
    r = await client.get(f"{T}/watch-records", params={"student_id": uid["stu2"]},
                         headers=hdr)
    assert r.status_code == 200
    assert r.json()["records"] == []
    assert len(r.json()["students"]) == 1

    for other in ("stu3", "stub"):
        r = await client.get(f"{T}/watch-records", params={"student_id": uid[other]},
                             headers=hdr)
        assert r.status_code == 404, (other, r.text)


async def test_lecturer_filter(client: AsyncClient, wr_env):
    """按讲师筛: 视频和记录一起收窄"""
    r = await client.get(f"{T}/watch-records", params={"lecturer": "王老师"},
                         headers=_h(wr_env["tok"]["t1"]))
    body = r.json()
    assert [v["id"] for v in body["videos"]] == [wr_env["vid"]["v1"]]
    assert [x["video_id"] for x in body["records"]] == [wr_env["vid"]["v1"]]


async def test_records_agree_with_overview(client: AsyncClient, wr_env):
    """同一个学生: 明细加起来 == 总览那一行(导出表拿来核对页面不能出两个数)"""
    hdr = _h(wr_env["tok"]["t1"])
    ov = (await client.get(f"{T}/overview", headers=hdr)).json()
    rec = (await client.get(f"{T}/watch-records", headers=hdr)).json()

    for s in ov["students"]:
        mine = [x for x in rec["records"] if x["student_id"] == s["student_id"]]
        assert sum(x["watch_seconds"] for x in mine) == s["total_watch_seconds"]
        assert sum(1 for x in mine if x["completed"]) == s["videos_completed"]
        assert len(mine) == s["videos_started"]


async def test_admin_sees_only_watchers(client: AsyncClient, wr_env):
    """平台 admin 没有班级名册: 名单只有看过的人,roster_size 为 None(算不出,不是 0)"""
    r = await client.get(f"{T}/watch-records", headers=_h(wr_env["tok"]["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "all"
    assert body["roster_size"] is None
    ids = {s["student_id"] for s in body["students"]}
    assert wr_env["uid"]["stu2"] not in ids        # 没看过的不在
    assert wr_env["uid"]["stu1"] in ids
    # 名单里的每个人都有记录
    assert ids == {x["student_id"] for x in body["records"]}


async def test_student_cannot_call(client: AsyncClient, wr_env):
    r = await client.get(f"{T}/watch-records", headers=_h(wr_env["tok"]["stu1"]))
    assert r.status_code == 403
