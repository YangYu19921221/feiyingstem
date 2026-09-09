"""机构区域保护(协议第四条:直线三公里内不发展第二家合作点)。

关注点不是「Haversine 算得准不准」(那是教科书公式),而是这几个容易做错的判定:
  - 体验机构不能参与判定(销售演示环境天天开,拿它拦真实签约会误报到没人敢看)
  - 没登记坐标的机构判不了 → 不阻挡,但预检必须报出「有几家判不了」
  - 保护是相互的: 对方 5 公里独家,我在 4 公里外开新点仍然违的是对方那份协议
  - 只填一半坐标必须拦(半条数据既判不出冲突,又让机构看着"已登记"实则不受保护)
  - 改地址(搬迁)要排除自己,否则永远和自己相距 0 公里
  - force 放行后要在响应里回报被跳过的冲突(事后能对账)
"""
import pytest

from app.models.organization import Organization
from app.models.user import User
from app.services import geo_service
from tests.conftest import _make_token

# 杭州文三路一带。1 度纬度 ≈ 111.19 km,所以 0.018° ≈ 2.0 km、0.09° ≈ 10 km
BASE_LAT, BASE_LNG = 30.2741, 120.1551
NEAR_LAT = BASE_LAT + 0.018    # 约 2.0 公里 → 3 公里内,冲突
FAR_LAT = BASE_LAT + 0.09      # 约 10 公里 → 不冲突


async def _admin(db):
    admin = User(username="terradm", email="terradm@e.com", hashed_password="x",
                 role="admin", full_name="平台管理员", is_active=True)
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return {"Authorization": f"Bearer {_make_token(admin.id)}"}


async def _org(db, name, code, lat=None, lng=None, plan="standard",
               radius=None, status="active"):
    org = Organization(name=name, code=code, plan=plan, status=status,
                       student_quota=100, lat=lat, lng=lng,
                       protect_radius_km=radius)
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


# ---------- 纯函数层 ----------

def test_haversine_matches_known_distance():
    """0.018° 纬度差约 2 公里(误差 <50 米),判定阈值靠这个数才有意义。"""
    d = geo_service.haversine_km(BASE_LAT, BASE_LNG, NEAR_LAT, BASE_LNG)
    assert 1.95 < d < 2.05


def test_looks_swapped_catches_reversed_pair():
    """高德复制出来是「经度,纬度」,填反了距离完全无意义却不会报错,必须能认出。"""
    assert geo_service.looks_swapped(120.1551, 30.2741) is True
    assert geo_service.looks_swapped(30.2741, 120.1551) is False


def test_trial_orgs_never_conflict():
    """体验机构没有区域条款,不能参与判定。"""
    trial = Organization(id=1, name="体验机构", code="T1", plan="trial",
                         status="active", lat=NEAR_LAT, lng=BASE_LNG)
    assert geo_service.find_territory_conflicts(BASE_LAT, BASE_LNG, 3.0, [trial]) == []


def test_unmapped_orgs_do_not_block():
    """没登记坐标的机构判不了距离,不阻挡开通(录了坐标才受保护)。"""
    blank = Organization(id=1, name="没坐标", code="N1", plan="standard",
                         status="active", lat=None, lng=None)
    assert geo_service.find_territory_conflicts(BASE_LAT, BASE_LNG, 3.0, [blank]) == []


def test_protection_uses_the_larger_radius():
    """区域保护是相互的: 对方 5 公里独家,我在 4 公里外开点仍然违对方那份协议。"""
    far = Organization(id=1, name="县级独家", code="C1", plan="county",
                       status="active", lat=BASE_LAT + 0.036, lng=BASE_LNG,  # 约 4 公里
                       protect_radius_km=5.0)
    # 本方只要 3 公里,但对方要 5 公里 → 仍然冲突
    hits = geo_service.find_territory_conflicts(BASE_LAT, BASE_LNG, 3.0, [far])
    assert len(hits) == 1
    assert hits[0]["threshold_km"] == 5.0


def test_conflicts_sorted_nearest_first():
    orgs = [
        Organization(id=1, name="远的", code="F1", plan="standard", status="active",
                     lat=BASE_LAT + 0.018, lng=BASE_LNG),   # 2 km
        Organization(id=2, name="近的", code="N2", plan="standard", status="active",
                     lat=BASE_LAT + 0.009, lng=BASE_LNG),   # 1 km
    ]
    hits = geo_service.find_territory_conflicts(BASE_LAT, BASE_LNG, 3.0, orgs)
    assert [h["org_name"] for h in hits] == ["近的", "远的"]


# ---------- HTTP 层 ----------

@pytest.mark.asyncio
async def test_create_blocked_by_nearby_org(client, db_session):
    """3 公里内已有合作点 → 409 带明细,且库里不留半家机构。"""
    headers = await _admin(db_session)
    await _org(db_session, "已签约的", "OLD1", lat=BASE_LAT, lng=BASE_LNG)

    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "新开的", "lat": NEAR_LAT, "lng": BASE_LNG,
        "address": "文三路 200 号",
    })
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "TERRITORY_CONFLICT"
    assert detail["radius_km"] == 3.0
    assert len(detail["conflicts"]) == 1
    c = detail["conflicts"][0]
    assert c["org_name"] == "已签约的"
    assert 1.95 < c["distance_km"] < 2.05

    # 抛 409 时不能留下半家机构
    listed = (await client.get("/api/v1/admin/organizations", headers=headers)).json()
    assert [o["name"] for o in listed] == ["已签约的"]


@pytest.mark.asyncio
async def test_create_allowed_when_far_enough(client, db_session):
    headers = await _admin(db_session)
    await _org(db_session, "已签约的", "OLD2", lat=BASE_LAT, lng=BASE_LNG)

    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "十公里外", "lat": FAR_LAT, "lng": BASE_LNG,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["lat"] == FAR_LAT
    assert "territory_overridden" not in body


@pytest.mark.asyncio
async def test_force_creates_and_reports_override(client, db_session):
    """勾选「我已核对」后带 force=true 放行,响应回报被跳过的冲突供事后对账。"""
    headers = await _admin(db_session)
    await _org(db_session, "已签约的", "OLD3", lat=BASE_LAT, lng=BASE_LNG)

    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "硬开的", "lat": NEAR_LAT, "lng": BASE_LNG, "force": True,
    })
    assert r.status_code == 200
    assert len(r.json()["territory_overridden"]) == 1


@pytest.mark.asyncio
async def test_half_coordinate_rejected(client, db_session):
    """只填纬度会存成半条数据: 判不出冲突,却让机构看着"已登记"实则不受保护。"""
    headers = await _admin(db_session)
    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "只填一半", "lat": BASE_LAT,
    })
    assert r.status_code == 400
    assert "同时填写" in r.json()["detail"]


@pytest.mark.asyncio
async def test_swapped_coordinates_rejected(client, db_session):
    headers = await _admin(db_session)
    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "填反了", "lat": BASE_LNG, "lng": BASE_LAT,
    })
    assert r.status_code == 400
    assert "填反" in r.json()["detail"]


@pytest.mark.asyncio
async def test_out_of_range_latitude_gives_readable_error(client, db_session):
    """范围校验不能挂在 Pydantic Field 上,否则会退化成 422 的英文校验串。

    lat=120 既超范围又是"填反了"的典型值 —— 必须先给出「填反了」那句更有用的话
    (这条与 test_swapped_coordinates_rejected 是一对: 单纯超范围走另一支)
    """
    headers = await _admin(db_session)
    # 纬度 95 超范围,但经度正常 → 不是填反,报范围错
    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "越界的", "lat": 95.0, "lng": BASE_LNG,
    })
    assert r.status_code == 400
    assert "纬度应在" in r.json()["detail"]


@pytest.mark.asyncio
async def test_create_without_coordinates_still_works(client, db_session):
    """坐标是选填的: 新增这个功能不能让不填坐标的老流程失败。"""
    headers = await _admin(db_session)
    await _org(db_session, "已签约的", "OLD4", lat=BASE_LAT, lng=BASE_LNG)
    r = await client.post("/api/v1/admin/organizations", headers=headers,
                          json={"name": "不填坐标"})
    assert r.status_code == 200
    assert r.json()["lat"] is None


@pytest.mark.asyncio
async def test_relocation_excludes_self(client, db_session):
    """改自己的地址不能被自己拦住(否则永远和自己相距 0 公里)。"""
    headers = await _admin(db_session)
    org = await _org(db_session, "要搬家的", "MV1", lat=BASE_LAT, lng=BASE_LNG)

    r = await client.patch(f"/api/v1/admin/organizations/{org.id}", headers=headers,
                           json={"lat": BASE_LAT + 0.001, "lng": BASE_LNG,
                                 "address": "搬到隔壁"})
    assert r.status_code == 200
    assert r.json()["address"] == "搬到隔壁"


@pytest.mark.asyncio
async def test_relocation_into_others_zone_blocked(client, db_session):
    """搬到别家保护圈里,和新开一家一样违约。"""
    headers = await _admin(db_session)
    await _org(db_session, "别人家", "OTH1", lat=BASE_LAT, lng=BASE_LNG)
    mover = await _org(db_session, "搬迁的", "MV2", lat=FAR_LAT, lng=BASE_LNG)

    r = await client.patch(f"/api/v1/admin/organizations/{mover.id}", headers=headers,
                           json={"lat": NEAR_LAT, "lng": BASE_LNG})
    assert r.status_code == 409
    assert r.json()["detail"]["conflicts"][0]["org_name"] == "别人家"


@pytest.mark.asyncio
async def test_radius_only_change_is_rechecked(client, db_session):
    """只改半径不动坐标: 新半径也可能把原本合规的位置变成冲突,同样要过闸。"""
    headers = await _admin(db_session)
    await _org(db_session, "十公里外那家", "R1", lat=FAR_LAT, lng=BASE_LNG)
    me = await _org(db_session, "要放宽的", "R2", lat=BASE_LAT, lng=BASE_LNG)

    # 3 公里时互不冲突;放宽到 20 公里就把 10 公里外那家圈进来了
    r = await client.patch(f"/api/v1/admin/organizations/{me.id}", headers=headers,
                           json={"protect_radius_km": 20})
    assert r.status_code == 409
    assert r.json()["detail"]["conflicts"][0]["org_name"] == "十公里外那家"


@pytest.mark.asyncio
async def test_territory_check_reports_unmapped_count(client, db_session):
    """预检的「零冲突」必须连"有几家判不了"一起给,否则会被误读成这一带没人。"""
    headers = await _admin(db_session)
    await _org(db_session, "没坐标的", "U1")                       # 判不了
    await _org(db_session, "体验的", "U2", plan="trial")            # 不参与判定,不计入
    await _org(db_session, "十公里外", "U3", lat=FAR_LAT, lng=BASE_LNG)

    r = await client.get("/api/v1/admin/organizations/territory-check", headers=headers,
                         params={"lat": BASE_LAT, "lng": BASE_LNG})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["conflicts"] == []
    assert body["unmapped_orgs"] == 1          # 只数没坐标的正式机构,体验的不算
    assert body["nearby"][0]["org_name"] == "十公里外"


@pytest.mark.asyncio
async def test_territory_check_matches_write_gate(client, db_session):
    """预检与写端点共用一份判定,不该出现「预检说行、开通被拦」。"""
    headers = await _admin(db_session)
    await _org(db_session, "已签约的", "M1", lat=BASE_LAT, lng=BASE_LNG)

    pre = (await client.get("/api/v1/admin/organizations/territory-check", headers=headers,
                            params={"lat": NEAR_LAT, "lng": BASE_LNG})).json()
    assert pre["ok"] is False

    post = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "新开的", "lat": NEAR_LAT, "lng": BASE_LNG,
    })
    assert post.status_code == 409
    assert (post.json()["detail"]["conflicts"][0]["distance_km"]
            == pre["conflicts"][0]["distance_km"])


@pytest.mark.asyncio
async def test_suspended_org_still_protected_but_flagged(client, db_session):
    """停用常常只是欠费停服,协议未必终止 → 照样拦,但明细里标出状态供管理员决断。"""
    headers = await _admin(db_session)
    await _org(db_session, "停用的", "S1", lat=BASE_LAT, lng=BASE_LNG,
               status="suspended")

    r = await client.post("/api/v1/admin/organizations", headers=headers, json={
        "name": "新开的", "lat": NEAR_LAT, "lng": BASE_LNG,
    })
    assert r.status_code == 409
    assert r.json()["detail"]["conflicts"][0]["status"] == "suspended"


@pytest.mark.asyncio
async def test_non_admin_cannot_check_territory(client, db_session):
    """区域数据是招商机密,只有平台 admin 能查。"""
    from sqlalchemy import text
    await db_session.execute(text(
        "INSERT INTO organizations (id, name, code, status, access_mode) "
        "VALUES (9801, '某机构', 'terrorg', 'active', 'assigned')"))
    teacher = User(username="terrtch", email="terrtch@e.com", hashed_password="x",
                   role="teacher", full_name="老师", is_active=True, org_id=9801)
    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)

    r = await client.get("/api/v1/admin/organizations/territory-check",
                         headers={"Authorization": f"Bearer {_make_token(teacher.id)}"},
                         params={"lat": BASE_LAT, "lng": BASE_LNG})
    assert r.status_code == 403
