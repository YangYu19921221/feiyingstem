"""音标视频按「讲师」分类(学生挑自己的老师听课)

讲师是**自由文本**不是 users 外键(讲课的常是没账号的外聘老师/助教),
代价是同一个人会被敲成好几种写法,而学生端**按这个字符串分组** ——
写法一分裂,学生眼里就多出一位不存在的老师。所以覆盖三类风险:

1. **归一与消歧**:上传/编辑/批量三条写入路径都必须向已有写法靠拢,
   否则「王老师」「王 老师」在学生端是两个 chip
2. **存量零影响**:讲师为 NULL 的老视频(生产上已有几十个)必须照旧对所有学生可见
3. **多租户 + 预置只读**:讲师名单不能跨机构泄漏;平台预置视频整批拒改(不静默跳过)

⚠️ conftest 走 create_all **不走 init_db**,所以租户过滤器没注册 ——
这里测到的隔离全靠端点里显式的 _org_scope,正是要守的那一层。
"""
import io

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.core.config import settings
from app.models.user import User
from app.models.phonetic import PhoneticVideo
from app.services import lecturer_name
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def lec_env(db_session, monkeypatch, tmp_path):
    """两个机构 + 各自老师/学生 + 一个平台预置视频。

    视频落盘指到 tmp_path:测试不能往 private_media/ 里拉屎。
    """
    monkeypatch.setattr(settings, "PHONETIC_VIDEO_DIR", str(tmp_path / "pv"))

    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9921, '机构甲', 'orglecjia', 'active', 'assigned'), "
        "(9922, '机构乙', 'orglecyi', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchlecone", "teacher", 9921),
        ("t2", "tchlectwo", "teacher", 9922),
        ("admin", "admlec", "admin", 9921),
        ("stu", "stulec", "student", 9921),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    async def mkvideo(key, org, lecturer=None, active=True, category="vowel"):
        v = PhoneticVideo(
            title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category=category, is_active=active, org_id=org, lecturer=lecturer,
        )
        db_session.add(v)
        await db_session.flush()
        return v.id

    vids = {
        # 机构甲:王老师 2 个、李老师 1 个、无讲师 1 个(= 存量老视频)
        "wang1": await mkvideo("wang1", 9921, "王老师"),
        "wang2": await mkvideo("wang2", 9921, "王老师", category="consonant"),
        "li1": await mkvideo("li1", 9921, "李老师"),
        "legacy": await mkvideo("legacy", 9921, None),
        # 机构乙:另一位讲师(名单不能串到甲那边)
        "other": await mkvideo("other", 9922, "赵老师"),
        # 平台预置:对机构只读
        "preset": await mkvideo("preset", None, None),
    }
    await db_session.commit()

    return {"tok": {k: _make_token(u.id) for k, u in users.items()}, "vid": vids}


async def _upload(client: AsyncClient, token: str, name="元音 /æ/.mp4", lecturer=None):
    data = {"category": "basic"}
    if lecturer is not None:
        data["lecturer"] = lecturer
    return await client.post(
        "/api/v1/teacher/phonetics/videos/upload",
        headers=_h(token), data=data,
        files={"file": (name, io.BytesIO(b"\x00" * 2048), "video/mp4")},
    )


# ---------- 前后端哨兵值一致(两份常量必然漂移)----------

def test_sentinel_matches_frontend_constant():
    """`NO_LECTURER` 前后端必须**逐字节**相同。

    它是「只看未指定讲师」的筛选值,前端传什么后端就得认什么 ——
    不一致的表现是**静默返回零条**(不报错、不 500),老师只会看到
    「未指定讲师」筛出来空空如也,而实际上有一批等着补归属。

    这个坑真踩过(2026-09-17):前端那行被写成了 '\\x00none'(一个 NUL 字节
    而不是空格),文件因此还被 git 当成二进制。所以照 test_pet_sprites.py 的做法
    **直接正则解析 .ts 而不维护 Python 副本** —— 副本漂移了测试还会照旧全绿。
    """
    import re
    from pathlib import Path

    ts = (Path(__file__).resolve().parents[2]
          / "frontend" / "src" / "api" / "phonetics.ts")
    src = ts.read_text(encoding="utf-8")
    m = re.search(r"export const NO_LECTURER = '([^']*)';", src)
    assert m, "前端 api/phonetics.ts 里找不到 NO_LECTURER,改名了就同步这个测试"
    assert m.group(1) == lecturer_name.NO_LECTURER, (
        f"前后端哨兵值不一致: 前端 {m.group(1)!r} vs 后端 "
        f"{lecturer_name.NO_LECTURER!r} —— 「未指定讲师」筛选会静默返回零条"
    )
    # 顺带守住"看不见的字符":哨兵值只允许空格 + 字母
    assert "\x00" not in src, "phonetics.ts 里有 NUL 字节(会被 git 当二进制)"


# ---------- 归一与消歧(纯函数,不打端点)----------

def test_normalize_strips_invisible_differences():
    """看不见的差异必须洗掉 —— 老师在输入框里根本看不出尾随空格"""
    assert lecturer_name.normalize("  王老师  ") == "王老师"
    assert lecturer_name.normalize("王　老师") == "王 老师"      # 全角空格→半角
    assert lecturer_name.normalize("王  老师") == "王 老师"      # 连续空白压成一个
    # 空 / 纯空白 = 不归属任何讲师(全校通用),不是空字符串
    assert lecturer_name.normalize("") is None
    assert lecturer_name.normalize("   ") is None
    assert lecturer_name.normalize(None) is None


def test_normalize_keeps_inner_space():
    """**不能删内部空格**:「Miss Lucy」删了就是另一个名字"""
    assert lecturer_name.normalize("Miss Lucy") == "Miss Lucy"


def test_resolve_snaps_to_existing_spelling():
    """向已有写法靠拢,且**存已有的那个写法**(不存归一键)"""
    assert lecturer_name.resolve("王 老师", ["王老师"]) == "王老师"
    assert lecturer_name.resolve("WANG老师", ["wang老师"]) == "wang老师"
    # 显示形态要保留老师原本的排版,不能被折叠成 misslucy
    assert lecturer_name.resolve("MISS LUCY", ["Miss Lucy"]) == "Miss Lucy"
    # 认不出来的就是新讲师
    assert lecturer_name.resolve("李老师", ["王老师"]) == "李老师"
    assert lecturer_name.resolve("", ["王老师"]) is None


# ---------- 学生端 ----------

async def test_student_list_carries_lecturer_and_keeps_legacy_videos(
        client: AsyncClient, lec_env):
    """学生端下发 lecturer 字段;**讲师为空的存量视频照旧可见**(零影响)"""
    r = await client.get("/api/v1/phonetics/videos", headers=_h(lec_env["tok"]["stu"]))
    assert r.status_code == 200, r.text
    rows = r.json()
    by_title = {v["title"]: v for v in rows}

    assert by_title["video-wang1"]["lecturer"] == "王老师"
    # 存量老视频:lecturer 为 None,但**必须仍在列表里** ——
    # 这条挂了就是"上线后老视频集体消失"
    assert "video-legacy" in by_title
    assert by_title["video-legacy"]["lecturer"] is None
    # 平台预置(org_id NULL)照旧共享
    assert "video-preset" in by_title
    # 机构乙的视频不能出现在甲的学生这里
    assert "video-other" not in by_title


# ---------- 讲师名单 ----------

async def test_lecturers_aggregated_and_org_scoped(client: AsyncClient, lec_env):
    """名单按视频数倒序;**不跨机构**;讲师为空的不占一行"""
    r = await client.get("/api/v1/teacher/phonetics/lecturers",
                         headers=_h(lec_env["tok"]["t1"]))
    assert r.status_code == 200, r.text
    got = r.json()
    # 王老师 2 个排在李老师 1 个前面;赵老师(机构乙)不该出现
    assert [x["name"] for x in got] == ["王老师", "李老师"]
    assert got[0]["video_count"] == 2

    r2 = await client.get("/api/v1/teacher/phonetics/lecturers",
                          headers=_h(lec_env["tok"]["t2"]))
    assert [x["name"] for x in r2.json()] == ["赵老师"]


# ---------- 上传 ----------

async def test_upload_with_lecturer_snaps_to_existing(client: AsyncClient, lec_env):
    """上传时敲「王 老师」要归到已有的「王老师」,不能新开一位"""
    r = await _upload(client, lec_env["tok"]["t1"], lecturer="王 老师")
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "王老师"

    r2 = await client.get("/api/v1/teacher/phonetics/lecturers",
                          headers=_h(lec_env["tok"]["t1"]))
    assert [x["name"] for x in r2.json()] == ["王老师", "李老师"]
    assert r2.json()[0]["video_count"] == 3


async def test_upload_without_lecturer_is_shared(client: AsyncClient, lec_env):
    """不填讲师 = 全校通用(旧调用方式行为不变)"""
    r = await _upload(client, lec_env["tok"]["t1"])
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] is None


# ---------- 编辑 ----------

async def test_update_sets_and_clears_lecturer(client: AsyncClient, lec_env):
    """改讲师;**传空串 = 取消归属改回全校通用**(有意义的操作,不是"没填")"""
    vid = lec_env["vid"]["legacy"]
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                         headers=_h(lec_env["tok"]["t1"]), json={"lecturer": "李 老师"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "李老师"       # 靠拢已有写法

    # 空串必须真的清掉。这条挂了老师就永远没法取消归属
    r2 = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                          headers=_h(lec_env["tok"]["t1"]), json={"lecturer": ""})
    assert r2.status_code == 200, r2.text
    assert r2.json()["lecturer"] is None


async def test_update_without_lecturer_key_leaves_it_alone(client: AsyncClient, lec_env):
    """没传 lecturer 就别动它 —— 改标题不该把讲师抹掉"""
    vid = lec_env["vid"]["wang1"]
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                         headers=_h(lec_env["tok"]["t1"]), json={"title": "改个名"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "王老师"


# ---------- 批量设讲师 ----------

async def test_batch_set_lecturer_backfills_legacy(client: AsyncClient, lec_env):
    """存量视频补归属:这是上线当天最主要的动作"""
    ids = [lec_env["vid"]["legacy"]]
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": ids, "lecturer": "王老师"})
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 1, "requested": 1, "lecturer": "王老师"}


async def test_batch_rename_whole_group_is_not_blocked_by_itself(
        client: AsyncClient, lec_env):
    """把整组从「王老师」改成新写法时,**不能被它们自己的旧名字挡住**。

    消歧要排除正在改的这批 —— 不排除的话它们自己的旧名字算"已有写法",
    resolve 原样退回旧名字,老师点了保存却什么都没变(最难查的那种 bug)。
    """
    ids = [lec_env["vid"]["wang1"], lec_env["vid"]["wang2"]]
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": ids, "lecturer": "王小明老师"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "王小明老师"
    assert r.json()["updated"] == 2


async def test_batch_partial_selection_snaps_back_instead_of_splitting(
        client: AsyncClient, lec_env):
    """只选了「王老师」2 个视频里的 1 个还想改写法 → **靠拢回原写法,不分裂**。

    改了的话剩下那个仍叫「王老师」,学生端顶部立刻出现两个几乎一样的 chip ——
    而学生分不出「王老师」和「王 老师」哪个是自己的老师。
    真要改名就把那位老师的课全选上(见上一条测试)。
    """
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": [lec_env["vid"]["wang1"]], "lecturer": "王 老师"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "王老师"

    # 名单里仍然只有一位王老师(没分裂)
    r2 = await client.get("/api/v1/teacher/phonetics/lecturers",
                          headers=_h(lec_env["tok"]["t1"]))
    assert [x["name"] for x in r2.json()] == ["王老师", "李老师"]


async def test_batch_clear_lecturer(client: AsyncClient, lec_env):
    """整批改回全校通用"""
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": [lec_env["vid"]["wang1"]], "lecturer": ""})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] is None


async def test_batch_rejects_preset_wholesale(client: AsyncClient, lec_env):
    """选中含平台预置 → **整批 403**,不静默跳过。

    勾了 3 条只改了 2 条又不说,老师会以为都改了(与批量删除同口径)。
    """
    ids = [lec_env["vid"]["wang1"], lec_env["vid"]["preset"]]
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": ids, "lecturer": "王老师"})
    assert r.status_code == 403, r.text
    # 一条都不能改动(整批原子)
    r2 = await client.get("/api/v1/teacher/phonetics/videos",
                          headers=_h(lec_env["tok"]["t1"]),
                          params={"q": "video-preset"})
    assert r2.json()["items"][0]["lecturer"] is None


async def test_admin_may_set_preset_lecturer(client: AsyncClient, lec_env):
    """平台 admin 能给预置视频设讲师(机构不能)"""
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["admin"]),
                          json={"ids": [lec_env["vid"]["preset"]], "lecturer": "总部教研"})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 1


# ---------- 教师端筛选(补归属的工作流)----------

async def test_teacher_list_filters_by_lecturer(client: AsyncClient, lec_env):
    """精确筛某位讲师的课(补归属时先把他的课全找出来)"""
    r = await client.get("/api/v1/teacher/phonetics/videos",
                         headers=_h(lec_env["tok"]["t1"]),
                         params={"lecturer": "王老师"})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 2
    assert {x["title"] for x in r.json()["items"]} == {"video-wang1", "video-wang2"}


async def test_teacher_list_filters_unassigned(client: AsyncClient, lec_env):
    """哨兵值筛「未指定讲师」—— 这是整个补归属流程的入口。

    必须只捞到本机构那条(平台预置的 lecturer 也是 NULL,但它不属于本机构)。
    """
    r = await client.get("/api/v1/teacher/phonetics/videos",
                         headers=_h(lec_env["tok"]["t1"]),
                         params={"lecturer": lecturer_name.NO_LECTURER})
    assert r.status_code == 200, r.text
    titles = {x["title"] for x in r.json()["items"]}
    assert "video-legacy" in titles
    # 平台预置也是未指定讲师且对机构可见,所以会一起列出 —— 但它 can_edit=False,
    # 老师勾了它去批量设讲师会吃 403(见 test_batch_rejects_preset_wholesale)。
    # 断言它**没有**混进机构乙的行
    assert "video-other" not in titles
    assert all(not x["lecturer"] for x in r.json()["items"])


async def test_teacher_search_matches_lecturer(client: AsyncClient, lec_env):
    """模糊搜索也要能命中讲师(与学生端同口径)"""
    r = await client.get("/api/v1/teacher/phonetics/videos",
                         headers=_h(lec_env["tok"]["t1"]), params={"q": "李"})
    assert r.status_code == 200, r.text
    assert {x["title"] for x in r.json()["items"]} == {"video-li1"}


async def test_student_search_matches_lecturer(client: AsyncClient, lec_env):
    """学生端搜讲师名:卡片上写着「王老师」,搜它搜不到很别扭"""
    r = await client.get("/api/v1/phonetics/videos",
                         headers=_h(lec_env["tok"]["stu"]), params={"q": "王老师"})
    assert r.status_code == 200, r.text
    assert {x["title"] for x in r.json()} == {"video-wang1", "video-wang2"}


async def test_student_detail_is_org_scoped(client: AsyncClient, lec_env):
    """详情端点必须显式过滤:拿别家机构的 id 不能读到标题/讲师并刷观看数。

    (2026-09-17 补的显式过滤,此前只靠隐式过滤器 —— 而 conftest 不注册它)
    """
    r = await client.get(f"/api/v1/phonetics/videos/{lec_env['vid']['other']}",
                         headers=_h(lec_env["tok"]["stu"]))
    assert r.status_code == 404, r.text


# ---------- 消歧候选的归属边界(评审发现,均已实测复现过)----------

async def test_single_edit_can_change_own_spelling(client: AsyncClient, lec_env):
    """**唯一持有者**改写法要改得动 —— 不能被自己的旧名字挡回去。

    「李老师」在机构甲只有一个视频,把它改成「李 老师」时候选里若含它自己,
    resolve 原样退回「李老师」→ HTTP 200、响应体合法、值却没变(最难查的那种)。
    批量路径本来就有这层豁免,单条此前漏了。
    """
    vid = lec_env["vid"]["li1"]
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                         headers=_h(lec_env["tok"]["t1"]), json={"lecturer": "李 老师"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "李 老师"


async def test_single_edit_still_snaps_when_others_share_the_name(
        client: AsyncClient, lec_env):
    """但该讲师**还有别的视频**时,单条改写法要靠拢回原写法(否则学生端分裂)。

    「王老师」有 2 个视频,只改其中 1 个 → 落回「王老师」。
    与上一条是同一段逻辑的两侧,必须同时成立。
    """
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{lec_env['vid']['wang1']}",
                         headers=_h(lec_env["tok"]["t1"]), json={"lecturer": "王 老师"})
    assert r.status_code == 200, r.text
    assert r.json()["lecturer"] == "王老师"


async def test_admin_does_not_borrow_other_org_spelling(client: AsyncClient, lec_env):
    """admin 改甲机构的视频时,**不能靠拢到乙机构的写法**。

    _org_scope 对 admin(current_org_id 为 None)不加任何条件 → 候选是全平台的,
    而候选集是归一权威:输入与别家某位讲师的 match_key 相同,落库就是**别家的写法**,
    那串姓名随即出现在甲机构学生端的老师 chip 上。
    机构乙有「赵老师」,admin 对甲的视频传「赵 老师」应得到甲自己的新写法。
    """
    vid = lec_env["vid"]["legacy"]      # 机构甲,原本无讲师
    r = await client.put(f"/api/v1/teacher/phonetics/videos/{vid}",
                         headers=_h(lec_env["tok"]["admin"]), json={"lecturer": "赵 老师"})
    assert r.status_code == 200, r.text
    # 关键:**不是**机构乙的「赵老师」那个写法
    assert r.json()["lecturer"] == "赵 老师"

    # 机构乙的名单不受影响(没被改写,也没多一位)
    r2 = await client.get("/api/v1/teacher/phonetics/lecturers",
                          headers=_h(lec_env["tok"]["t2"]))
    assert [x["name"] for x in r2.json()] == ["赵老师"]


async def test_batch_delete_is_org_scoped(client: AsyncClient, lec_env):
    """批量删除**不能跨机构** —— 它此前是本文件唯一裸查询的写端点。

    比一般泄漏重且不可逆:连带删课件子行、视频文件、渲染页目录。
    生产靠隐式租户过滤器兜着,但 conftest 不注册过滤器 —— 正因如此这里能测到,
    也正因如此在此之前谁都测不出来。
    """
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-delete",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": [lec_env["vid"]["other"]]})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 0, "跨机构删成功了"

    # 那条视频必须还在(用它自己机构的老师去确认)。
    # 机构乙看得到的还有平台预置那条(org_id NULL = 共享),所以用 in 而不是全等
    r2 = await client.get("/api/v1/teacher/phonetics/videos",
                          headers=_h(lec_env["tok"]["t2"]))
    assert "video-other" in {x["title"] for x in r2.json()["items"]}


async def test_batch_cannot_touch_other_org(client: AsyncClient, lec_env):
    """跨机构改不动 —— _org_scope 捞不到那一行,updated 为 0(不是 500)"""
    r = await client.post("/api/v1/teacher/phonetics/videos/batch-lecturer",
                          headers=_h(lec_env["tok"]["t1"]),
                          json={"ids": [lec_env["vid"]["other"]], "lecturer": "王老师"})
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 0
