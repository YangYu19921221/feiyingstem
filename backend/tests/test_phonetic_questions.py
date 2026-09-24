"""音标视频「看不懂就问」+ 跨视频学情总览 + 学生端个人汇总

这一套守的重点与统计那套不同: 那边守「数字不能是假的」,这边守
**「别人的话不能被看见」** —— 提问是未成年人写的内容,可见性一漏就是姓名 + 原话。

1. **默认只有提问者和老师看得见**(别的学生看不到,即使同机构同视频)
2. **老师设为公开之后同视频的学生才看得到**
3. **跨机构绝不互通** —— 尤其是**平台预置视频**(org_id=NULL)下的提问:
   按视频推导归属就会串,所以提问行自带 org_id。
   ⚠️ conftest 走 create_all **不注册租户过滤器**,所以这里测到的是裸查询下的
   真实边界(CLAUDE.md:聚合/直查不经锚点模型,过滤器罩不住)
4. **空白提问/空白回答当场拒**: 空白回答会让那条永远挂在待回答里而界面说"已回答"
   —— 正是本项目最常见的静默失败
5. **总览的分母不骗人**: 名册里一节没看的人也要出现在按学生表里(否则等于把
   该催的人藏了);零观看的课数要数得出来
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.api.v1.phonetics import ASK_RATE_LIMIT
from app.models.user import User, Class, ClassStudent
from app.models.phonetic import PhoneticVideo, PhoneticVideoView
from app.services import rate_limit, video_question
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio

S = "/api/v1/phonetics"
T = "/api/v1/teacher/phonetics"


@pytest_asyncio.fixture
async def qa_env(db_session):
    """两个机构 + 一个平台预置视频。

    甲机构老师带一个班(stu1/stu2 在班上,stu3 同机构但不在班上 ——
    用来验总览的名册范围是班级不是整个机构)。
    """
    rate_limit.reset()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9941, '问答甲', 'orgqa', 'active', 'assigned'), "
        "(9942, '问答乙', 'orgqb', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchqaone", "teacher", 9941),
        ("t2", "tchqatwo", "teacher", 9942),
        ("admin", "admqa", "admin", 9941),
        ("stu1", "stuqaone", "student", 9941),
        ("stu2", "stuqatwo", "student", 9941),
        ("stu3", "stuqathree", "student", 9941),
        ("stub", "stuqab", "student", 9942),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=f"名字{uname}", is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    cls = Class(name="问答班", teacher_id=users["t1"].id, org_id=9941)
    db_session.add(cls)
    await db_session.flush()
    for k in ("stu1", "stu2"):
        db_session.add(ClassStudent(class_id=cls.id, student_id=users[k].id,
                                    is_active=True))

    vids = {}
    for key, org in [("v1", 9941), ("v1b", 9941), ("v2", 9942), ("preset", None)]:
        v = PhoneticVideo(
            title=f"qa-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org, duration_seconds=600,
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


async def _ask(client, env, who="stu1", vid_key="v1", text="这个音怎么读", pos=None):
    body = {"content": text}
    if pos is not None:
        body["position_seconds"] = pos
    r = await client.post(f"{S}/videos/{env['vid'][vid_key]}/questions",
                          json=body, headers=_h(env["tok"][who]))
    assert r.status_code == 200, r.text
    return r.json()


# ============ 1. 可见性:默认仅师生 ============

async def test_other_student_cannot_see_my_question(client: AsyncClient, qa_env):
    """**这是整个功能的地基**: 默认别人看不见我的提问。

    孩子最真实的顾虑是"怕被同学看见问得蠢",这条一破功能就没人用了。
    """
    await _ask(client, qa_env, who="stu1", text="/æ/ 和 /e/ 有什么区别")

    mine = await client.get(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                            headers=_h(qa_env["tok"]["stu1"]))
    assert [q["content"] for q in mine.json()] == ["/æ/ 和 /e/ 有什么区别"]
    assert mine.json()[0]["is_mine"] is True

    other = await client.get(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                             headers=_h(qa_env["tok"]["stu2"]))
    assert other.json() == [], "同机构同视频的另一个学生不该看到别人的私有提问"


async def test_teacher_sees_pending_question(client: AsyncClient, qa_env):
    """老师看得到,并且进「待回答」"""
    await _ask(client, qa_env, who="stu1", text="第三个词读不出来")

    r = await client.get(f"{T}/questions", headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pending"] == 1
    assert body["items"][0]["content"] == "第三个词读不出来"
    assert body["items"][0]["student_name"] == "名字stuqaone"
    assert body["items"][0]["answered_at"] is None


async def test_public_question_visible_to_classmates(client: AsyncClient, qa_env):
    """老师设为公开之后,同视频的其他学生才看得到(一问一答一起可见)"""
    q = await _ask(client, qa_env, who="stu1", text="这个音要咬舌头吗")

    r = await client.post(f"{T}/questions/{q['id']}/answer",
                          json={"answer": "要,舌尖轻碰上齿", "is_public": True},
                          headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    assert r.json()["is_public"] is True
    assert r.json()["pending"] == 0

    other = await client.get(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                             headers=_h(qa_env["tok"]["stu2"]))
    rows = other.json()
    assert len(rows) == 1
    assert rows[0]["answer"] == "要,舌尖轻碰上齿"
    assert rows[0]["is_mine"] is False
    # 公开的问答要显示是谁问的(否则看着像老师自言自语)
    assert rows[0]["asker_name"] == "名字stuqaone"
    assert rows[0]["answered_by_name"] == "名字tchqaone"


async def test_unpublish_hides_again(client: AsyncClient, qa_env):
    """取消公开之后别人立刻看不到 —— 老师要能收回误公开的内容"""
    q = await _ask(client, qa_env, who="stu1")
    await client.post(f"{T}/questions/{q['id']}/answer",
                      json={"answer": "答", "is_public": True},
                      headers=_h(qa_env["tok"]["t1"]))
    r = await client.patch(f"{T}/questions/{q['id']}", json={"is_public": False},
                           headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 200, r.text

    other = await client.get(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                             headers=_h(qa_env["tok"]["stu2"]))
    assert other.json() == []


async def test_hidden_question_invisible_to_owner_too(client: AsyncClient, qa_env):
    """隐藏后连提问者自己也看不到(这是老师处理不当内容的手段),
    但**行还在库里** —— 软删不硬删,未成年人内容出纠纷要留痕"""
    q = await _ask(client, qa_env, who="stu1", text="不合适的话")
    await client.patch(f"{T}/questions/{q['id']}", json={"is_hidden": True},
                       headers=_h(qa_env["tok"]["t1"]))

    mine = await client.get(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                            headers=_h(qa_env["tok"]["stu1"]))
    assert mine.json() == []

    # 老师用 status=all 仍看得见(要能看到自己隐藏了什么)
    r = await client.get(f"{T}/questions?status=all", headers=_h(qa_env["tok"]["t1"]))
    assert [x["content"] for x in r.json()["items"]] == ["不合适的话"]
    assert r.json()["items"][0]["is_hidden"] is True
    # 隐藏的不算待回答(隐藏就是处理过了)
    assert r.json()["pending"] == 0


# ============ 2. 跨机构不串(重点:平台预置视频) ============

async def test_cross_org_cannot_see_public_question_on_preset_video(
    client: AsyncClient, qa_env
):
    """**最容易漏的一条**: 平台预置视频全平台可见,若按视频推导提问的归属,
    甲机构学生的公开提问会出现在乙机构学生眼前(姓名 + 原话都漏)。
    提问行自带 org_id 才拦得住。
    """
    q = await _ask(client, qa_env, who="stu1", vid_key="preset", text="甲机构的问题")
    await client.post(f"{T}/questions/{q['id']}/answer",
                      json={"answer": "甲机构老师的回答", "is_public": True},
                      headers=_h(qa_env["tok"]["t1"]))

    # 同一个预置视频,乙机构的学生看到的必须是空
    other = await client.get(f"{S}/videos/{qa_env['vid']['preset']}/questions",
                             headers=_h(qa_env["tok"]["stub"]))
    assert other.status_code == 200
    assert other.json() == [], "别家机构的公开问答泄漏了"

    # 甲机构学生照常看得到
    ours = await client.get(f"{S}/videos/{qa_env['vid']['preset']}/questions",
                            headers=_h(qa_env["tok"]["stu2"]))
    assert [x["content"] for x in ours.json()] == ["甲机构的问题"]


async def test_cross_org_teacher_cannot_list_or_answer(client: AsyncClient, qa_env):
    """乙机构老师既看不到也答不了甲机构的提问"""
    q = await _ask(client, qa_env, who="stu1", vid_key="preset")

    listed = await client.get(f"{T}/questions?status=all",
                              headers=_h(qa_env["tok"]["t2"]))
    assert listed.json()["items"] == []
    assert listed.json()["pending"] == 0

    r = await client.post(f"{T}/questions/{q['id']}/answer", json={"answer": "越权"},
                          headers=_h(qa_env["tok"]["t2"]))
    assert r.status_code == 404

    r = await client.patch(f"{T}/questions/{q['id']}", json={"is_public": True},
                           headers=_h(qa_env["tok"]["t2"]))
    assert r.status_code == 404


# ============ 3. 空白与越界 ============

async def test_blank_question_rejected(client: AsyncClient, qa_env):
    """纯空白提问当场拒 —— 它在老师列表里是一行看不懂的空白"""
    for bad in ["", "   ", "\n\t "]:
        r = await client.post(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                              json={"content": bad}, headers=_h(qa_env["tok"]["stu1"]))
        assert r.status_code == 400, f"{bad!r} 应该被拒"


async def test_blank_answer_rejected(client: AsyncClient, qa_env):
    """**空白回答必须拒**: 否则 answered_at 被写上 → 那条永远挂在"已回答"里,
    而学生看到的答案是一片空白。界面却弹了"已回答" —— 静默失败"""
    q = await _ask(client, qa_env, who="stu1")
    r = await client.post(f"{T}/questions/{q['id']}/answer", json={"answer": "   "},
                          headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 400
    # 仍然待回答
    r2 = await client.get(f"{T}/questions", headers=_h(qa_env["tok"]["t1"]))
    assert r2.json()["pending"] == 1


async def test_position_clamped_to_duration(client: AsyncClient, qa_env):
    """位置按时长夹: 前端报 999999 会让「问在第 277 小时」进老师的列表"""
    q = await _ask(client, qa_env, who="stu1", pos=999999)
    assert q["position_seconds"] == 600      # duration_seconds


async def test_position_kept_when_sane(client: AsyncClient, qa_env):
    """正常位置原样留下 —— 「3 分 20 秒那个音」是这个功能比论坛好用的关键"""
    q = await _ask(client, qa_env, who="stu1", pos=200)
    assert q["position_seconds"] == 200


async def test_ask_rate_limited(client: AsyncClient, qa_env, monkeypatch):
    """连点刷不出几十条把老师的列表淹掉"""
    monkeypatch.setattr("app.api.v1.phonetics.ASK_RATE_LIMIT", 3)
    rate_limit.reset()
    for _ in range(3):
        await _ask(client, qa_env, who="stu1")
    r = await client.post(f"{S}/videos/{qa_env['vid']['v1']}/questions",
                          json={"content": "再来一条"},
                          headers=_h(qa_env["tok"]["stu1"]))
    assert r.status_code == 429


async def test_cannot_ask_on_invisible_video(client: AsyncClient, qa_env):
    """别家机构的视频下面提不了问(404,与列表同口径)"""
    r = await client.post(f"{S}/videos/{qa_env['vid']['v2']}/questions",
                          json={"content": "越权提问"},
                          headers=_h(qa_env["tok"]["stu1"]))
    assert r.status_code == 404


async def test_content_truncated_not_rejected(client: AsyncClient, qa_env):
    """超长**截断而不是 422**: 孩子打了一长段被英文报错弹回来,大概率就不问了"""
    q = await _ask(client, qa_env, who="stu1", text="啊" * 900)
    assert len(q["content"]) == video_question.MAX_CONTENT_LEN


# ============ 4. 学生端红点 ============

async def test_my_answered_count_only_counts_mine(client: AsyncClient, qa_env):
    """「老师回了我的问题」只数自己的 —— 公开问答的回答不是"回我的",
    拿它提醒会让孩子点进去找不到自己那条"""
    mine = await _ask(client, qa_env, who="stu1", text="我的问题")
    theirs = await _ask(client, qa_env, who="stu2", text="别人的问题")
    for qid in (mine["id"], theirs["id"]):
        await client.post(f"{T}/questions/{qid}/answer",
                          json={"answer": "答", "is_public": True},
                          headers=_h(qa_env["tok"]["t1"]))

    r = await client.get(f"{S}/my-questions/answered-count",
                         headers=_h(qa_env["tok"]["stu1"]))
    assert r.json()["answered"] == 1


# ============ 5. 学生端个人汇总 ============

async def test_my_watch_summary_counts_only_visible_videos(
    client: AsyncClient, qa_env, db_session
):
    """分母是**我可见且上架**的视频数,不是全平台 ——
    两个数不同源会让「看完 12 / 共 8 节」这种自相矛盾的话出现。
    甲机构学生可见: v1 + v1b + preset = 3(v2 是乙机构的)
    """
    r = await client.get(f"{S}/my-watch-summary", headers=_h(qa_env["tok"]["stu1"]))
    assert r.status_code == 200, r.text
    assert r.json()["total_videos"] == 3
    assert r.json()["videos_completed"] == 0
    assert r.json()["videos_started"] == 0


async def test_my_watch_summary_reflects_progress(
    client: AsyncClient, qa_env, db_session
):
    """看完一节就要在个人汇总里体现(这是学生端唯一的激励数字)"""
    db_session.add(PhoneticVideoView(
        video_id=qa_env["vid"]["v1"], user_id=qa_env["uid"]["stu1"],
        play_count=2, watch_seconds=500, max_position_seconds=590,
        last_position_seconds=590, completed=True,
    ))
    db_session.add(PhoneticVideoView(
        video_id=qa_env["vid"]["v1b"], user_id=qa_env["uid"]["stu1"],
        play_count=1, watch_seconds=60, max_position_seconds=60,
        last_position_seconds=60, completed=False,
    ))
    await db_session.commit()

    r = await client.get(f"{S}/my-watch-summary", headers=_h(qa_env["tok"]["stu1"]))
    body = r.json()
    assert body["videos_started"] == 2
    assert body["videos_completed"] == 1
    assert body["total_watch_seconds"] == 560


async def test_my_summary_does_not_leak_other_org_watch(
    client: AsyncClient, qa_env, db_session
):
    """别家机构视频上的观看行不能进我的汇总(video_ids 收范围那一层)"""
    db_session.add(PhoneticVideoView(
        video_id=qa_env["vid"]["v2"], user_id=qa_env["uid"]["stu1"],
        play_count=1, watch_seconds=999, max_position_seconds=590, completed=True,
    ))
    await db_session.commit()

    r = await client.get(f"{S}/my-watch-summary", headers=_h(qa_env["tok"]["stu1"]))
    assert r.json()["total_watch_seconds"] == 0
    assert r.json()["videos_completed"] == 0


# ============ 6. 教师端总览 ============

async def test_overview_lists_roster_even_if_never_watched(
    client: AsyncClient, qa_env
):
    """**名册里一节没看的人也要出现**,而且排在最前 ——
    这份表的用处就是把该催的人点出来,只列有记录的人等于把他们藏了。
    范围是**班上的**学生(stu3 同机构但不在班上,不该出现)
    """
    r = await client.get(f"{T}/overview", headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    body = r.json()
    names = [s["name"] for s in body["students"]]
    assert names == ["名字stuqaone", "名字stuqatwo"], names
    assert body["roster_size"] == 2
    assert body["scope"] == "my_classes"
    assert all(s["videos_completed"] == 0 for s in body["students"])


async def test_overview_counts_zero_watch_videos(client: AsyncClient, qa_env, db_session):
    """「一个人都没看」的课数 —— 这是老师最该看到的缺口数字"""
    db_session.add(PhoneticVideoView(
        video_id=qa_env["vid"]["v1"], user_id=qa_env["uid"]["stu1"],
        play_count=1, watch_seconds=500, max_position_seconds=590, completed=True,
    ))
    await db_session.commit()

    r = await client.get(f"{T}/overview", headers=_h(qa_env["tok"]["t1"]))
    body = r.json()
    # 甲机构老师可见 3 个视频(v1/v1b/preset),只有 v1 被看过
    assert body["summary"]["videos"] == 3
    assert body["summary"]["zero_watch_videos"] == 2
    assert body["summary"]["active_students"] == 1
    # 看完的人排最后(升序),没看的排最前
    assert body["students"][0]["videos_completed"] == 0
    assert body["students"][-1]["name"] == "名字stuqaone"


async def test_overview_excludes_other_org_watch(client: AsyncClient, qa_env, db_session):
    """乙机构学生在预置视频上的观看,不能算进甲机构老师的学情页"""
    db_session.add(PhoneticVideoView(
        video_id=qa_env["vid"]["preset"], user_id=qa_env["uid"]["stub"],
        play_count=5, watch_seconds=999, max_position_seconds=590, completed=True,
    ))
    await db_session.commit()

    r = await client.get(f"{T}/overview", headers=_h(qa_env["tok"]["t1"]))
    body = r.json()
    assert body["summary"]["active_students"] == 0
    assert body["summary"]["total_watch_seconds"] == 0
    preset = [v for v in body["videos"] if v["id"] == qa_env["vid"]["preset"]][0]
    assert preset["viewers"] == 0, "别家机构的观看数漏进了预置视频那一行"


async def test_overview_filters_by_lecturer(client: AsyncClient, qa_env, db_session):
    """按讲师收窄 —— 老师要的是"我的学生在我这套课上花了多久" """
    v = (await db_session.execute(
        sql_text("SELECT id FROM phonetic_videos WHERE id = :i"),
        {"i": qa_env["vid"]["v1"]},
    )).scalar()
    await db_session.execute(
        sql_text("UPDATE phonetic_videos SET lecturer = '王老师' WHERE id = :i"),
        {"i": v},
    )
    await db_session.commit()

    r = await client.get(f"{T}/overview?lecturer=王老师", headers=_h(qa_env["tok"]["t1"]))
    body = r.json()
    assert body["summary"]["videos"] == 1
    assert [x["id"] for x in body["videos"]] == [qa_env["vid"]["v1"]]


async def test_overview_admin_has_no_roster(client: AsyncClient, qa_env):
    """平台 admin 没有班级名册 → roster_size 为 None(不是 0)。
    「算不出」和「一个学生都没有」必须能区分开(同 not_watched 的口径)
    """
    r = await client.get(f"{T}/overview", headers=_h(qa_env["tok"]["admin"]))
    assert r.status_code == 200, r.text
    assert r.json()["roster_size"] is None
    assert r.json()["scope"] == "all"


async def test_video_list_carries_question_counts(client: AsyncClient, qa_env):
    """视频列表要带提问数/待回答数: 待回答只在另一个页面显示,
    老师整理视频时不会想起去看"""
    await _ask(client, qa_env, who="stu1", vid_key="v1")
    r = await client.get(f"{T}/videos", headers=_h(qa_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pending_questions"] == 1
    row = [x for x in body["items"] if x["id"] == qa_env["vid"]["v1"]][0]
    assert row["question_count"] == 1
    assert row["pending_question_count"] == 1
