"""音标视频观看统计(播放量 / 多少人看 / 谁没看)

这些测试守的是「**数字不能是假的**」—— 一个会骗人的统计比没有统计更糟:
老师会照着它去找学生谈话。所以覆盖面偏向"能不能被刷"和"会不会串":

1. **看完的判定挡得住两种作弊**: 拖到末尾 / 反复看开头(口径 services/video_watch)
2. **时长刷不上去**: 单次心跳增量服务端封顶;位置按 duration 夹
3. **人数不重复计**: 同一个学生刷十次仍是 1 个人(UNIQUE + upsert)
4. **跨机构不串**: ⚠️ conftest 走 create_all **不注册租户过滤器**,所以这里
   测到的就是裸查询下的真实边界 —— 统计必须手动 join User 才拦得住
   (CLAUDE.md:「聚合查询不经锚点模型,过滤器罩不住,已有两次此类泄漏教训」)
5. **删视频要连带删观看行**: phonetic_videos.id 不带 AUTOINCREMENT,
   SQLite 会把 id 发给下一个视频,留着旧行等于把观看数送给新视频
6. **老师自己点开不算观看**,否则催作业时名单里有自己
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.api.v1.phonetics import HEARTBEAT_RATE_LIMIT
from app.models.user import User, Class, ClassStudent
from app.models.phonetic import PhoneticVideo, PhoneticVideoView
from app.services import rate_limit, video_watch
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

S = "/api/v1/phonetics"
T = "/api/v1/teacher/phonetics"


@pytest_asyncio.fixture
async def watch_env(db_session):
    """两个机构,各自的视频与学生,外加一个平台预置视频(org_id=NULL)。

    甲机构的老师带一个班,班里有 stu1、stu2;stu3 在同机构但**不在他班上**
    (用来验「谁没看」的名单范围是班级而不是整个机构)。
    """
    rate_limit.reset()      # 限流器是进程内状态,跨测试会累计
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9921, '机构甲', 'orgwa', 'active', 'assigned'), "
        "(9922, '机构乙', 'orgwb', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchwatchone", "teacher", 9921),
        ("t2", "tchwatchtwo", "teacher", 9922),
        ("admin", "admwatch", "admin", 9921),
        ("stu1", "stuwatchone", "student", 9921),
        ("stu2", "stuwatchtwo", "student", 9921),
        ("stu3", "stuwatchthree", "student", 9921),
        ("stub", "stuwatchb", "student", 9922),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    cls = Class(name="甲班", teacher_id=users["t1"].id, org_id=9921)
    db_session.add(cls)
    await db_session.flush()
    for k in ("stu1", "stu2"):
        db_session.add(ClassStudent(class_id=cls.id, student_id=users[k].id,
                                    is_active=True))

    vids = {}
    for key, org in [("v1", 9921), ("v2", 9922), ("preset", None)]:
        v = PhoneticVideo(
            title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org,
            duration_seconds=600,
        )
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()

    return {
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "uid": {k: u.id for k, u in users.items()},
        "vid": vids,
    }


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ============ 1. 「看完」的判定(纯函数,不走 HTTP) ============

async def test_completion_needs_both_signals():
    """拖到末尾 / 反复看开头 都不算看完 —— 这是完看率能不能用的前提"""
    d = 600
    # 拖到末尾:位置满了但只看了 5 秒
    assert not video_watch.is_completed(5, 600, d)
    # 反复看开头:时长够了但从没看到结尾
    assert not video_watch.is_completed(600, 60, d)
    # 真看完
    assert video_watch.is_completed(400, 560, d)


async def test_completion_false_when_duration_unknown():
    """没有分母时返回 False —— 「算不出」不能冒充「看完了」"""
    assert not video_watch.is_completed(9999, 9999, None)
    assert not video_watch.is_completed(9999, 9999, 0)


async def test_completion_rate_none_when_nobody_watched():
    """没人看过 → None(界面显示「—」)。返回 0 会被读成「学生没看进去」"""
    assert video_watch.completion_rate(0, 0) is None
    assert video_watch.completion_rate(0, 4) == 0.0


# ============ 2. 时长刷不上去 ============

async def test_heartbeat_increment_is_capped(client: AsyncClient, watch_env):
    """客户端报 99999 秒,服务端只认 MAX_HEARTBEAT_SEC —— 否则改一行 JS 就是 10 小时"""
    r = await client.post(f"{S}/videos/{watch_env['vid']['v1']}/progress",
                          json={"seconds": 99999, "position": 10},
                          headers=_h(watch_env["tok"]["stu1"]))
    assert r.status_code == 200, r.text
    assert r.json()["watch_seconds"] == video_watch.MAX_HEARTBEAT_SEC


async def test_position_clamped_by_duration(client: AsyncClient, watch_env, db_session):
    """报个超大位置不能让 max_position 满足「到过结尾」,否则完看率虚高"""
    vid = watch_env["vid"]["v1"]
    r = await client.post(f"{S}/videos/{vid}/progress",
                          json={"seconds": 30, "position": 999999},
                          headers=_h(watch_env["tok"]["stu1"]))
    assert r.status_code == 200
    # 位置被夹到 600,但时长只有 30s < 600*0.6,所以仍不算看完
    assert r.json()["completed"] is False
    row = (await db_session.execute(
        PhoneticVideoView.__table__.select().where(
            PhoneticVideoView.video_id == vid)
    )).first()
    assert row.max_position_seconds == 600


async def test_scrub_to_end_does_not_complete(client: AsyncClient, watch_env):
    """把进度条直接拖到末尾:位置到头了,时长不够 → 不算看完(端到端复验)"""
    vid = watch_env["vid"]["v1"]
    r = await client.post(f"{S}/videos/{vid}/progress",
                          json={"seconds": 5, "position": 600},
                          headers=_h(watch_env["tok"]["stu1"]))
    assert r.json()["completed"] is False


async def test_enough_heartbeats_do_complete(client: AsyncClient, watch_env):
    """老老实实看完:累够时长 + 位置到尾 → completed。

    并且 completed **只置不清** —— 看完之后回头重看开头,不该变回没看完
    """
    vid = watch_env["vid"]["v1"]
    for _ in range(4):      # 4 × 120 = 480 >= 600*0.6
        r = await client.post(f"{S}/videos/{vid}/progress",
                              json={"seconds": 120, "position": 590},
                              headers=_h(watch_env["tok"]["stu1"]))
    assert r.json()["completed"] is True

    # 回头重看开头
    r = await client.post(f"{S}/videos/{vid}/progress",
                          json={"seconds": 30, "position": 5},
                          headers=_h(watch_env["tok"]["stu1"]))
    assert r.json()["completed"] is True


async def test_progress_backfills_duration(client: AsyncClient, watch_env, db_session):
    """存量视频 duration_seconds 全是 NULL,心跳顺手回填 —— 没有分母算不出完看率"""
    v = PhoneticVideo(title="no-duration", file_path="nd.mp4", category="vowel",
                      is_active=True, org_id=9921, duration_seconds=None)
    db_session.add(v)
    await db_session.commit()
    await db_session.refresh(v)

    await client.post(f"{S}/videos/{v.id}/progress",
                      json={"seconds": 30, "position": 10, "duration": 300},
                      headers=_h(watch_env["tok"]["stu1"]))
    await db_session.refresh(v)
    assert v.duration_seconds == 300


# ============ 3. 人数不重复计 ============

async def test_repeat_opens_count_one_viewer(client: AsyncClient, watch_env):
    """同一个学生打开 3 次: plays=3 但 viewers=1。

    这正是老 view_count 说不清的事 —— 它会报 3,而界面上写着「观看 3」
    谁都会读成 3 个人
    """
    vid = watch_env["vid"]["v1"]
    for _ in range(3):
        r = await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))
        assert r.status_code == 200
    body = r.json()
    assert body["viewers"] == 1
    assert body["view_count"] == 3          # 打开次数照旧累加

    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    st = r.json()["stats"]
    assert st["viewers"] == 1
    assert st["plays"] == 3


async def test_two_students_count_two(client: AsyncClient, watch_env):
    vid = watch_env["vid"]["v1"]
    for k in ("stu1", "stu2"):
        await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"][k]))
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    assert r.json()["stats"]["viewers"] == 2


async def test_teacher_open_not_counted(client: AsyncClient, watch_env):
    """老师点进去检查视频不算观看,否则「看过的人」里有他自己"""
    vid = watch_env["vid"]["v1"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["t1"]))
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    assert r.json()["stats"]["viewers"] == 0
    assert r.json()["watched"] == []

    # 心跳也不计,但不该报错(前端是同一个播放器组件)
    r = await client.post(f"{S}/videos/{vid}/progress", json={"seconds": 30},
                          headers=_h(watch_env["tok"]["t1"]))
    assert r.status_code == 200
    assert r.json()["counted"] is False


async def test_my_progress_returned_for_resume(client: AsyncClient, watch_env):
    """续播:列表与详情都要带上我自己停在哪 —— 否则下次打开又从头放"""
    vid = watch_env["vid"]["v1"]
    await client.post(f"{S}/videos/{vid}/progress",
                      json={"seconds": 60, "position": 123},
                      headers=_h(watch_env["tok"]["stu1"]))
    r = await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))
    assert r.json()["my_position_seconds"] == 123

    r = await client.get(f"{S}/videos", headers=_h(watch_env["tok"]["stu1"]))
    mine = [x for x in r.json() if x["id"] == vid][0]
    assert mine["my_position_seconds"] == 123
    # 别人的进度不能串到我身上
    r = await client.get(f"{S}/videos", headers=_h(watch_env["tok"]["stu2"]))
    other = [x for x in r.json() if x["id"] == vid][0]
    assert other["my_position_seconds"] == 0


# ============ 4. 跨机构不串 ============

async def test_cross_org_cannot_report_progress(client: AsyncClient, watch_env):
    """乙机构的学生拿甲机构的 video_id 刷时长 → 404。

    不拦的话那些时长会出现在**甲机构老师**的学情页上
    """
    r = await client.post(f"{S}/videos/{watch_env['vid']['v1']}/progress",
                          json={"seconds": 120, "position": 300},
                          headers=_h(watch_env["tok"]["stub"]))
    assert r.status_code == 404


async def test_preset_video_stats_are_per_org(client: AsyncClient, watch_env):
    """平台预置视频(全平台可见)的观看人数必须**按机构分开算**。

    ⚠️ 这是本文件最重要的一条: conftest 走 create_all 不注册租户过滤器,
    而 phonetic_video_views 没有 org_id 列 —— 只有手动 join User 才拦得住。
    不拦的话甲机构老师会看到乙机构学生的观看数,并把它读成本校学情
    """
    vid = watch_env["vid"]["preset"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stub"]))

    # 甲机构老师只看到自己机构那 1 个人
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    assert r.json()["stats"]["viewers"] == 1
    names = [w["name"] for w in r.json()["watched"]]
    assert "stuwatchb" not in names

    # 学生端卡片上的「多少人学过」同样按机构
    r = await client.get(f"{S}/videos", headers=_h(watch_env["tok"]["stu1"]))
    card = [x for x in r.json() if x["id"] == vid][0]
    assert card["viewers"] == 1

    # 平台 admin 看全部(与本模块其它端点对 admin 的口径一致)
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["admin"]))
    assert r.json()["stats"]["viewers"] == 2


async def test_teacher_list_stats_scoped_to_org(client: AsyncClient, watch_env):
    """列表页的统计列同样按机构收(一次聚合,别按行 N 次查)"""
    vid = watch_env["vid"]["preset"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stub"]))
    r = await client.get(f"{T}/videos", headers=_h(watch_env["tok"]["t1"]))
    row = [x for x in r.json()["items"] if x["id"] == vid][0]
    assert row["viewers"] == 0          # 乙机构那个人不算进甲机构
    assert row["completion_rate"] is None   # 没人看 → 前端显示「—」不是 0%


# ============ 5. 谁还没看 ============

async def test_not_watched_list_is_my_class_only(client: AsyncClient, watch_env):
    """「谁没看」= 我班上的学生 - 看过的。stu3 同机构但不在班里,不该出现"""
    vid = watch_env["vid"]["v1"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))

    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    body = r.json()
    assert [w["name"] for w in body["watched"]] == ["stuwatchone"]
    names = [x["name"] for x in body["not_watched"]]
    assert names == ["stuwatchtwo"]          # stu3 不在班上,不在名单里
    assert body["roster_size"] == 2


async def test_admin_gets_no_not_watched_list(client: AsyncClient, watch_env):
    """平台 admin 没有班级范围 → not_watched 是 None 而不是空数组。

    空数组会被前端显示成「所有人都看了」,而真相是"算不出"
    """
    r = await client.get(f"{T}/videos/{watch_env['vid']['v1']}/viewers",
                         headers=_h(watch_env["tok"]["admin"]))
    assert r.json()["not_watched"] is None
    assert r.json()["scope"] == "all"


async def test_watching_now_counts_recent_heartbeat(client: AsyncClient, watch_env,
                                                    db_session):
    """「在线观看」= 窗口内有心跳的人数。超窗的不算(否则这个数只会涨不会落)"""
    vid = watch_env["vid"]["v1"]
    await client.post(f"{S}/videos/{vid}/progress", json={"seconds": 30, "position": 10},
                      headers=_h(watch_env["tok"]["stu1"]))
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    assert r.json()["stats"]["watching_now"] == 1
    assert r.json()["watched"][0]["watching_now"] is True

    # 把心跳时间推到窗口之外
    from datetime import timedelta
    from app.core.timeutil import utc_now
    stale = utc_now() - timedelta(seconds=video_watch.WATCHING_WINDOW_SEC + 60)
    await db_session.execute(
        PhoneticVideoView.__table__.update()
        .where(PhoneticVideoView.video_id == vid)
        .values(last_viewed_at=stale)
    )
    await db_session.commit()
    r = await client.get(f"{T}/videos/{vid}/viewers",
                         headers=_h(watch_env["tok"]["t1"]))
    assert r.json()["stats"]["watching_now"] == 0
    # 但「看过的人」照旧算 —— 在看和看过是两件事
    assert r.json()["stats"]["viewers"] == 1


# ============ 6. 删视频要连带删观看行 ============

async def test_delete_video_removes_view_rows(client: AsyncClient, watch_env,
                                              db_session, monkeypatch, tmp_path):
    """删视频后观看行必须一起走。

    不是洁癖: phonetic_videos.id 是普通 INTEGER PRIMARY KEY(**不带 AUTOINCREMENT**),
    SQLite 会把删掉的最大 id 重新发给下一次插入 —— 留着旧行的话,新传的视频
    一上架就显示「有人看过、有人看完」,而且查不出来源
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path))
    vid = watch_env["vid"]["v1"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))

    r = await client.delete(f"{T}/videos/{vid}", headers=_h(watch_env["tok"]["t1"]))
    assert r.status_code == 204
    left = (await db_session.execute(
        PhoneticVideoView.__table__.select().where(PhoneticVideoView.video_id == vid)
    )).all()
    assert left == []


async def test_batch_delete_removes_view_rows(client: AsyncClient, watch_env,
                                              db_session, monkeypatch, tmp_path):
    from app.core.config import settings
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path))
    vid = watch_env["vid"]["v1"]
    await client.get(f"{S}/videos/{vid}", headers=_h(watch_env["tok"]["stu1"]))

    r = await client.post(f"{T}/videos/batch-delete", json={"ids": [vid]},
                          headers=_h(watch_env["tok"]["t1"]))
    assert r.status_code == 200 and r.json()["deleted"] == 1
    left = (await db_session.execute(
        PhoneticVideoView.__table__.select().where(PhoneticVideoView.video_id == vid)
    )).all()
    assert left == []


# ============ 7. 限流 ============

async def test_progress_rate_limited(client: AsyncClient, watch_env):
    """心跳本该 30 秒一次,一秒几十次的只能是脚本在刷时长"""
    vid = watch_env["vid"]["v1"]
    codes = []
    # 打到上限再多打几下,确认真的会被拒(而不是只是刚好卡在边界)
    for _ in range(HEARTBEAT_RATE_LIMIT + 5):
        r = await client.post(f"{S}/videos/{vid}/progress", json={"seconds": 1},
                              headers=_h(watch_env["tok"]["stu1"]))
        codes.append(r.status_code)
    assert codes.count(200) == HEARTBEAT_RATE_LIMIT
    assert 429 in codes
