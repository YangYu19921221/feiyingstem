"""音标视频配套课件(PDF / PPT)

覆盖三类风险:
1. **PDF 全链路真跑**(不 mock 渲染):本机没装 soffice,PDF 这条路必须独立可用
2. **平台预置内容对机构只读** —— 修复前 update/delete/batch-delete 三个入口都能被
   任意机构老师改动平台视频,删还连带删磁盘文件、影响所有机构
3. **学生端只看得到渲染好且上架的课件**,原文件永不下发
"""
import io
import os

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text as sql_text

from app.core.config import settings
from app.models.user import User
from app.models.phonetic import PhoneticVideo, PhoneticMaterial
from app.services import office_convert, phonetic_material_service
from tests.conftest import _make_token

pytestmark = pytest.mark.asyncio


def _pdf_bytes(pages: int = 3) -> bytes:
    """造一份真 PDF。用 PyMuPDF 现造而不是放二进制 fixture:
    仓库里不该躺着来历不明的二进制,而这个依赖后端本来就有"""
    import pymupdf
    doc = pymupdf.open()
    for i in range(pages):
        pg = doc.new_page(width=960, height=540)      # 16:9,跟真幻灯片一个比例
        pg.insert_text((60, 100), f"Lesson page {i + 1}", fontsize=28)
    return doc.tobytes()


@pytest_asyncio.fixture
async def material_env(db_session, monkeypatch, tmp_path):
    """两个机构 + 一个平台预置视频 + 各自的自有视频。

    渲染目录指到 tmp_path:测试不能往 private_media/ 里拉屎,
    且每个测试拿到干净目录(否则上一轮的渲染页会让下一轮"看起来成功")
    """
    monkeypatch.setattr(settings, "PHONETIC_MATERIAL_DIR", str(tmp_path / "pm"))

    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9911, '机构甲', 'orgjia', 'active', 'assigned'), "
        "(9912, '机构乙', 'orgyi', 'active', 'assigned')"
    ))

    users = {}
    for key, uname, role, org in [
        ("t1", "tchmatone", "teacher", 9911),
        ("t2", "tchmattwo", "teacher", 9912),
        ("admin", "admmat", "admin", 9911),
        ("stu", "stumat", "student", 9911),
    ]:
        u = User(username=uname, email=f"{uname}@e.com", hashed_password="x",
                 role=role, full_name=uname, is_active=True, org_id=org)
        db_session.add(u)
        await db_session.flush()
        users[key] = u

    vids = {}
    for key, org in [("v1", 9911), ("v2", 9912), ("preset", None)]:
        v = PhoneticVideo(
            title=f"video-{key}", file_path=f"{key}.mp4", mime_type="video/mp4",
            category="vowel", is_active=True, org_id=org,
        )
        db_session.add(v)
        await db_session.flush()
        vids[key] = v.id
    await db_session.commit()

    return {
        "tok": {k: _make_token(u.id) for k, u in users.items()},
        "vid": vids,
    }


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _upload(client: AsyncClient, token: str, video_id: int,
                  name: str = "讲义.pdf", data: bytes | None = None,
                  ctype: str = "application/pdf"):
    return await client.post(
        f"/api/v1/teacher/phonetics/videos/{video_id}/materials",
        headers=_h(token),
        files={"file": (name, io.BytesIO(data if data is not None else _pdf_bytes()), ctype)},
    )


# ---------- PDF 全链路(本机无 soffice,这条必须独立可用)----------

async def test_pdf_upload_renders_and_student_reads_pages(
        client: AsyncClient, material_env):
    """PDF:上传 → 逐页渲染 → 学生取到图。全程不碰 soffice"""
    env = material_env
    r = await _upload(client, env["tok"]["t1"], env["vid"]["v1"], data=_pdf_bytes(3))
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["render_ready"] is True and m["page_count"] == 3
    assert m["render_error"] is None
    assert m["kind"] == "pdf"

    # 学生端列表能看到
    lst = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/materials",
                           headers=_h(env["tok"]["stu"]))
    assert lst.status_code == 200
    assert [x["id"] for x in lst.json()] == [m["id"]]
    # ⚠️ 不能把文件名/路径下发给学生(原文件永不给)
    assert "file_path" not in lst.json()[0]

    # 每一页都拿得到,且是图(烧过水印后转 webp)
    for p in (1, 2, 3):
        pg = await client.get(f"/api/v1/phonetics/materials/{m['id']}/page/{p}",
                              headers=_h(env["tok"]["stu"]))
        assert pg.status_code == 200, f"page {p}"
        assert pg.headers["content-type"] == "image/webp"
        assert len(pg.content) > 500
    # 图上烧了本人身份,不允许任何层缓存
    assert "no-store" in pg.headers.get("cache-control", "")


async def test_page_out_of_range_is_404(client: AsyncClient, material_env):
    """页码越界按 404,不能拿去拼路径"""
    env = material_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"],
                       data=_pdf_bytes(2))).json()
    for bad in (0, -1, 3, 999):
        r = await client.get(f"/api/v1/phonetics/materials/{m['id']}/page/{bad}",
                             headers=_h(env["tok"]["stu"]))
        assert r.status_code == 404, f"page_no={bad} 应该 404"


# ---------- PPT ----------

async def test_ppt_rejected_when_soffice_missing(
        client: AsyncClient, material_env, monkeypatch):
    """没装转换组件时**落盘前**就拒,并且给出可照做的提示(不是 500 堆栈)"""
    env = material_env
    monkeypatch.setattr(office_convert, "office_available", lambda: False)
    r = await _upload(client, env["tok"]["t1"], env["vid"]["v1"],
                      name="讲义.pptx", data=b"fake-ppt",
                      ctype="application/vnd.openxmlformats-officedocument"
                            ".presentationml.presentation")
    assert r.status_code == 400
    assert "另存为 PDF" in r.json()["detail"]
    # 被拒的请求不该留下文件
    d = settings.PHONETIC_MATERIAL_DIR
    assert not os.path.isdir(d) or not os.listdir(d)


async def test_pptx_goes_through_conversion(
        client: AsyncClient, material_env, monkeypatch):
    """PPT 走「先转 PDF 再复用 PDF 渲染」这条路。

    转换本身 mock 掉(本机没 soffice),但**渲染是真跑的** ——
    要验的是接线正确:kind 存原始类型、转出的 PDF 被喂进渲染。
    """
    env = material_env
    monkeypatch.setattr(office_convert, "office_available", lambda: True)

    calls = []

    async def fake_convert(src, out_dir):
        calls.append(src)
        os.makedirs(out_dir, exist_ok=True)
        p = os.path.join(out_dir, "converted.pdf")
        with open(p, "wb") as f:
            f.write(_pdf_bytes(4))
        return p

    monkeypatch.setattr(office_convert, "convert_to_pdf_async", fake_convert)

    r = await _upload(client, env["tok"]["t1"], env["vid"]["v1"],
                      name="第1课 讲义.pptx", data=b"fake-ppt",
                      ctype="application/octet-stream")   # 各系统 MIME 五花八门
    assert r.status_code == 200, r.text
    m = r.json()
    assert len(calls) == 1, "没有走转换"
    assert m["kind"] == "pptx", "应保留原始类型便于排查"
    assert m["render_ready"] is True and m["page_count"] == 4
    assert m["title"] == "第1课 讲义", "默认标题该是文件名去扩展名"


async def test_conversion_failure_keeps_file_and_records_error(
        client: AsyncClient, material_env, monkeypatch):
    """转换失败不丢文件、不报 500:留 render_error 让老师看见并可重传,
    但学生端看不到这份课件(而不是看到空白页)"""
    env = material_env
    monkeypatch.setattr(office_convert, "office_available", lambda: True)

    async def boom(src, out_dir):
        raise RuntimeError("PPT 转换失败,没有生成有效的 PDF")

    monkeypatch.setattr(office_convert, "convert_to_pdf_async", boom)

    r = await _upload(client, env["tok"]["t1"], env["vid"]["v1"],
                      name="坏文件.ppt", data=b"broken")
    assert r.status_code == 200, "渲染失败不该让上传整体报错"
    m = r.json()
    assert m["render_ready"] is False and m["page_count"] == 0
    assert "转换失败" in m["render_error"]

    # 老师看得到(能发现并重传)
    tl = await client.get(f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}/materials",
                          headers=_h(env["tok"]["t1"]))
    assert [x["id"] for x in tl.json()] == [m["id"]]

    # 学生看不到
    sl = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/materials",
                          headers=_h(env["tok"]["stu"]))
    assert sl.json() == []
    pg = await client.get(f"/api/v1/phonetics/materials/{m['id']}/page/1",
                          headers=_h(env["tok"]["stu"]))
    assert pg.status_code == 404


async def test_bad_extension_rejected(client: AsyncClient, material_env):
    for name in ("讲义.docx", "讲义.txt", "讲义.mp4", "讲义"):
        r = await _upload(client, material_env["tok"]["t1"],
                          material_env["vid"]["v1"], name=name, data=b"x")
        assert r.status_code == 400, name


# ---------- 平台预置内容对机构只读(修复前三个入口全是洞)----------

async def test_preset_video_is_readonly_for_org_teacher(
        client: AsyncClient, material_env):
    """机构老师不能改/删平台预置视频,也不能往上挂课件。

    修复前:租户过滤器为了让机构**看见**共享内容而放行 org_id IS NULL,
    于是任意机构老师都能改、能删平台视频 —— 删还连带删磁盘文件、影响所有机构。
    """
    env = material_env
    pid = env["vid"]["preset"]
    tok = env["tok"]["t1"]

    # 看得见(只读)
    assert (await client.get(f"/api/v1/teacher/phonetics/videos/{pid}/materials",
                             headers=_h(tok))).status_code == 200
    # 改不动
    assert (await client.put(f"/api/v1/teacher/phonetics/videos/{pid}",
                             headers=_h(tok), json={"title": "改了"})).status_code == 403
    # 删不掉
    assert (await client.delete(f"/api/v1/teacher/phonetics/videos/{pid}",
                                headers=_h(tok))).status_code == 403
    # 也不能挂课件
    assert (await _upload(client, tok, pid)).status_code == 403


async def test_admin_can_manage_preset(client: AsyncClient, material_env):
    """平台 admin 照旧能管预置内容(只读规则只针对机构)"""
    env = material_env
    pid = env["vid"]["preset"]
    r = await _upload(client, env["tok"]["admin"], pid)
    assert r.status_code == 200, r.text
    # 预置视频下的课件也是平台共享:org_id 跟父视频,不能取 admin 的 org_id
    assert r.json()["is_preset"] is True


async def test_batch_delete_rejects_preset_as_a_whole(
        client: AsyncClient, material_env):
    """勾中预置视频时**整批拒**,不静默跳过 ——
    勾 2 条只删掉 1 条又不说,老师会以为都删了"""
    env = material_env
    r = await client.post(
        "/api/v1/teacher/phonetics/videos/batch-delete",
        headers=_h(env["tok"]["t1"]),
        json={"ids": [env["vid"]["v1"], env["vid"]["preset"]]},
    )
    assert r.status_code == 403
    assert "平台预置" in r.json()["detail"]
    # 自己那条也必须还在(整批回退)
    still = await client.get("/api/v1/teacher/phonetics/videos", headers=_h(env["tok"]["t1"]))
    assert env["vid"]["v1"] in [v["id"] for v in still.json()["items"]]


async def test_cross_org_material_invisible(client: AsyncClient, material_env):
    """机构乙的老师碰不到机构甲的视频与课件"""
    env = material_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"])).json()

    t2 = env["tok"]["t2"]
    assert (await client.get(
        f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}/materials",
        headers=_h(t2))).status_code == 404
    assert (await client.put(f"/api/v1/teacher/phonetics/materials/{m['id']}",
                             headers=_h(t2), json={"title": "抢改"})).status_code == 404
    assert (await client.delete(f"/api/v1/teacher/phonetics/materials/{m['id']}",
                                headers=_h(t2))).status_code == 404


async def test_material_org_follows_video_not_uploader(
        client: AsyncClient, material_env, db_session):
    """课件归属跟**父视频**,不是上传者。

    照抄 user.org_id 会让平台视频下挂着一份属于某机构的课件 ——
    admin 的 users.org_id 是 NOT NULL DEFAULT,不是 None。
    """
    env = material_env
    m = (await _upload(client, env["tok"]["admin"], env["vid"]["preset"])).json()
    row = (await db_session.execute(
        sql_text("SELECT org_id FROM phonetic_materials WHERE id = :i"), {"i": m["id"]}
    )).first()
    assert row[0] is None, "预置视频的课件必须是平台共享(NULL)"


# ---------- 下架 / 删除 / 级联 ----------

async def test_inactive_material_hidden_from_student(
        client: AsyncClient, material_env):
    env = material_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"])).json()
    await client.put(f"/api/v1/teacher/phonetics/materials/{m['id']}",
                     headers=_h(env["tok"]["t1"]), json={"is_active": False})

    sl = await client.get(f"/api/v1/phonetics/videos/{env['vid']['v1']}/materials",
                          headers=_h(env["tok"]["stu"]))
    assert sl.json() == []
    pg = await client.get(f"/api/v1/phonetics/materials/{m['id']}/page/1",
                          headers=_h(env["tok"]["stu"]))
    assert pg.status_code == 404


async def test_material_hidden_when_video_goes_inactive(
        client: AsyncClient, material_env):
    """视频下架,配套讲义也跟着不给看(否则下架的课还能从讲义看到内容)"""
    env = material_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"])).json()
    await client.put(f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}",
                     headers=_h(env["tok"]["t1"]), json={"is_active": False})
    pg = await client.get(f"/api/v1/phonetics/materials/{m['id']}/page/1",
                          headers=_h(env["tok"]["stu"]))
    assert pg.status_code == 404


async def test_delete_material_cleans_disk(client: AsyncClient, material_env):
    env = material_env
    m = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"])).json()
    rendered = phonetic_material_service.material_dir(m["id"])
    assert os.path.isdir(rendered) and os.listdir(rendered)

    r = await client.delete(f"/api/v1/teacher/phonetics/materials/{m['id']}",
                            headers=_h(env["tok"]["t1"]))
    assert r.status_code == 204
    assert not os.path.isdir(rendered), "渲染页目录该被清掉"
    # 原文件也该没了(私有目录里只剩渲染根目录)
    leftovers = [f for f in os.listdir(settings.PHONETIC_MATERIAL_DIR)
                 if os.path.isfile(os.path.join(settings.PHONETIC_MATERIAL_DIR, f))]
    assert leftovers == []


async def test_delete_video_cascades_materials(
        client: AsyncClient, material_env, db_session):
    """删视频要连带删课件:SQLite 默认不开外键级联,
    不显式删就会留下指向已删视频的孤儿行 + 永远清不掉的渲染页目录"""
    env = material_env
    m1 = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"], name="a.pdf")).json()
    m2 = (await _upload(client, env["tok"]["t1"], env["vid"]["v1"], name="b.pdf")).json()
    dirs = [phonetic_material_service.material_dir(m["id"]) for m in (m1, m2)]
    assert all(os.path.isdir(d) for d in dirs)

    r = await client.delete(f"/api/v1/teacher/phonetics/videos/{env['vid']['v1']}",
                            headers=_h(env["tok"]["t1"]))
    assert r.status_code == 204

    left = (await db_session.execute(sql_text(
        "SELECT COUNT(*) FROM phonetic_materials WHERE video_id = :v"),
        {"v": env["vid"]["v1"]})).scalar()
    assert left == 0, "留下了孤儿课件行"
    assert not any(os.path.isdir(d) for d in dirs), "留下了渲染页目录"


async def test_empty_file_rejected(client: AsyncClient, material_env):
    r = await _upload(client, material_env["tok"]["t1"],
                      material_env["vid"]["v1"], data=b"")
    assert r.status_code == 400
    assert "空" in r.json()["detail"]


async def test_oversize_rejected(client: AsyncClient, material_env, monkeypatch):
    """超限要在**边写边计**时就断掉,并且清掉半个文件"""
    monkeypatch.setattr(settings, "MAX_PHONETIC_MATERIAL_SIZE", 1024)
    r = await _upload(client, material_env["tok"]["t1"],
                      material_env["vid"]["v1"], data=b"x" * 5000)
    assert r.status_code == 413
    leftovers = [f for f in os.listdir(settings.PHONETIC_MATERIAL_DIR)
                 if os.path.isfile(os.path.join(settings.PHONETIC_MATERIAL_DIR, f))]
    assert leftovers == [], "超限的半个文件没清掉"


async def test_title_keeps_slash_in_filename(client: AsyncClient, material_env):
    """音标文件名天然带斜杠(「元音 /æ/ 讲义.pdf」),
    按 / 切会把标题截成「 讲义」—— 只能削 Windows 反斜杠"""
    env = material_env
    r = await _upload(client, env["tok"]["t1"], env["vid"]["v1"],
                      name="元音 /æ/ 讲义.pdf")
    assert r.status_code == 200
    assert r.json()["title"] == "元音 /æ/ 讲义"
