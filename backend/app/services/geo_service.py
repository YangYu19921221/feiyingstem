"""机构区域保护(加盟排他)——经纬度距离判定

协议第四条承诺:甲方在乙方经营场所**直线距离三公里**内不再发展其他合作点。
这个模块的职责就是在平台开新机构 / 改机构地址时,把违约拦在下单之前。

为什么用直线距离而不是导航距离:
    直线距离恒 <= 导航距离,所以「直线 3km 内不开第二家」比「导航 3km 内不开」
    **更严格**,永远不会违约(只会偶尔误拦实际绕路超 3km 的点,由 force 放行)。
    代价是零外部依赖:不调地图 API、不联网、机构离线也能判。
    协议文案已同步改成「直线距离」,让系统判定与合同口径逐字一致——
    口径不一致的自动判定比没有判定更糟,因为它会给出一个无法自证的结论。

为什么不上空间索引:
    机构总数是几十家的量级,全表 Haversine 是微秒级。SQLite 也没有原生空间索引。
    真涨到几千家再上 bbox 粗筛(±0.03° ≈ ±3.3km)即可,判定函数签名不用变。
"""
import math
from typing import Iterable, Optional

# 默认保护半径(公里),与协议第四条一致。县级/市级独家可按机构单独放宽。
DEFAULT_PROTECT_RADIUS_KM = 3.0

_EARTH_RADIUS_KM = 6371.0088  # IUGG 平均地球半径

# 中国大陆经纬度大致范围,用于「经纬度填反了」的判定。
# 地图工具复制出来的坐标顺序不统一(高德 API 是 lng,lat;而人读写习惯是 lat,lng),
# 填反了算出的距离完全无意义却不会报错——必须显式拦
CHINA_LAT_RANGE = (3.0, 54.0)
CHINA_LNG_RANGE = (73.0, 136.0)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面直线距离(公里)。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    d_phi = p2 - p1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d_lambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def coord_error(lat: float, lng: float) -> Optional[str]:
    """坐标合法性校验,返回给用户看的错误文案(None=通过)。

    ⚠️ 范围校验刻意**不放在 Pydantic Field 的 ge/le 上**: 那样 lat=120(填反了的典型值)
    会先被 Pydantic 拦成 422「Input should be less than or equal to 90」,
    而这恰恰是最需要说清"你把经纬度填反了"的一种输入。范围与填反两件事必须由同一处判,
    才能保证先给出更有用的那句话。
    """
    if looks_swapped(lat, lng):
        return (
            f"经纬度似乎填反了(纬度 {lat}、经度 {lng} 都不在中国范围内)。"
            "高德复制出来的顺序是「经度,纬度」,填写时请注意对调"
        )
    if not -90 <= lat <= 90:
        return f"纬度应在 -90 ~ 90 之间(收到 {lat})"
    if not -180 <= lng <= 180:
        return f"经度应在 -180 ~ 180 之间(收到 {lng})"
    return None


def looks_swapped(lat: float, lng: float) -> bool:
    """判断经纬度是否填反了(仅对中国范围内的坐标有意义)。

    判据:纬度落在中国经度带内、且经度落在中国纬度带内 —— 两边同时越界才算反,
    单边越界可能是境外地址(境外不做判断,直接放过)。
    """
    return (
        CHINA_LNG_RANGE[0] <= lat <= CHINA_LNG_RANGE[1]
        and CHINA_LAT_RANGE[0] <= lng <= CHINA_LAT_RANGE[1]
        and not (CHINA_LAT_RANGE[0] <= lat <= CHINA_LAT_RANGE[1])
    )


def find_territory_conflicts(
    lat: float,
    lng: float,
    radius_km: float,
    others: Iterable,
    exclude_org_id: Optional[int] = None,
) -> list[dict]:
    """找出与给定坐标冲突的已有机构,按距离近到远排序。

    冲突判据是 `距离 < max(本方半径, 对方半径)` —— 区域保护是**相互**的:
    对方若签的是 5 公里独家,我在 4 公里外开新点仍然违的是对方那份协议,
    只按本方的 3 公里判会漏掉这种情况。

    `plan == 'trial'` 的机构不参与判定:体验机构是销售演示用的临时环境,
    没有区域保护条款,拿它拦真实签约会天天误报。
    停用/过期的机构**照样参与**判定(停用常常只是欠费停服,协议未必终止),
    但结果里带上 status,由管理员看明细自行决定要不要 force 放行。
    """
    conflicts = []
    for org in others:
        if exclude_org_id is not None and org.id == exclude_org_id:
            continue
        if (org.plan or "") == "trial":
            continue
        o_lat, o_lng = getattr(org, "lat", None), getattr(org, "lng", None)
        if o_lat is None or o_lng is None:
            continue  # 没录坐标的老机构无法判定,不阻挡(录了坐标才受保护)
        o_radius = getattr(org, "protect_radius_km", None) or DEFAULT_PROTECT_RADIUS_KM
        threshold = max(radius_km, o_radius)
        dist = haversine_km(lat, lng, o_lat, o_lng)
        if dist < threshold:
            conflicts.append({
                "org_id": org.id,
                "org_name": org.name,
                "org_code": org.code,
                "status": org.status,
                "plan": org.plan,
                "address": getattr(org, "address", None),
                "distance_km": round(dist, 2),
                "threshold_km": round(threshold, 2),
            })
    conflicts.sort(key=lambda c: c["distance_km"])
    return conflicts


def conflict_payload(conflicts: list[dict], radius_km: float) -> dict:
    """409 响应体。前端据此弹「列明细 + 勾选已核对」的确认框,再带 force=true 重试。"""
    nearest = conflicts[0]
    return {
        "code": "TERRITORY_CONFLICT",
        "message": (
            f"与「{nearest['org_name']}」相距 {nearest['distance_km']} 公里,"
            f"在 {nearest['threshold_km']} 公里区域保护范围内"
            f"{f'(共 {len(conflicts)} 家冲突)' if len(conflicts) > 1 else ''}。"
            "继续开通将违反协议第四条区域保护条款。"
        ),
        "radius_km": radius_km,
        "conflicts": conflicts,
    }
