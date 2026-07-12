"""
实时课堂在线状态服务(内存态)

学生端学习页每 30 秒心跳一次;切出/切回页面时即时上报(sendBeacon)。
教师端每 5-10 秒轮询班级快照。全部状态存进程内存:
- 单进程 uvicorn 部署(无 --workers),内存态安全
- 重启丢失无妨:学生端持续心跳,几十秒内自动重建
- 「今日切屏次数」双轨:内存实时累计 + 持久化到 study_sessions 由会话统计,
  这里只服务实时页,历史口径走数据库
"""
from datetime import datetime, timedelta
from typing import Optional

# 心跳超时:超过该时长无心跳视为离线(学生关页面/断网)。心跳周期 15s,给 4 个周期余量
OFFLINE_AFTER_SEC = 60
# 切出状态的失联宽限:切出的人心跳被浏览器后台限流,超时不立即判离线;
# 但失联超过该时长(大概率已关浏览器)仍降级为离线,避免永远挂在"切出"上
AWAY_GRACE_SEC = 30 * 60
# 快照里保留多久内活跃过的人(避免字典无限膨胀,每天课后自然清空)
EVICT_AFTER_SEC = 12 * 3600

# user_id -> 状态
_presence: dict[int, dict] = {}


def _now() -> datetime:
    return datetime.utcnow()


def heartbeat(
    user_id: int,
    visible: bool,
    unit_id: Optional[int] = None,
    unit_name: Optional[str] = None,
    idle: bool = False,
) -> None:
    """学习页周期心跳(30s)与状态变化时调用"""
    st = _presence.setdefault(user_id, {
        "away_since": None,
        "switch_count_today": 0,
        "count_date": None,
    })
    st["last_seen"] = _now()
    st["visible"] = visible
    st["idle"] = idle
    if unit_id is not None:
        st["unit_id"] = unit_id
    if unit_name:
        st["unit_name"] = unit_name
    # 心跳兜底:切走期间浏览器可能限流定时器,visible=False 的心跳也维持 away_since
    if visible:
        st["away_since"] = None
    elif st.get("away_since") is None:
        st["away_since"] = _now()


def report_switch(user_id: int, leaving: bool) -> None:
    """切出(leaving=True)/切回(False) 即时上报(sendBeacon 保证送达)"""
    st = _presence.setdefault(user_id, {
        "switch_count_today": 0,
        "count_date": None,
    })
    now = _now()
    st["last_seen"] = now
    today = now.date().isoformat()
    if st.get("count_date") != today:
        st["count_date"] = today
        st["switch_count_today"] = 0
    if leaving:
        st["visible"] = False
        st["away_since"] = now
        st["switch_count_today"] += 1
    else:
        st["visible"] = True
        st["away_since"] = None


def snapshot(student_ids: list[int]) -> list[dict]:
    """教师端轮询:给定班级学生,返回实时状态列表"""
    now = _now()
    out = []
    for sid in student_ids:
        st = _presence.get(sid)
        if not st or not st.get("last_seen"):
            continue
        age = (now - st["last_seen"]).total_seconds()
        if age > EVICT_AFTER_SEC:
            _presence.pop(sid, None)
            continue
        if age > OFFLINE_AFTER_SEC:
            # 超时前最后状态是「切出」→ 大概率还在别的页面上玩(浏览器对后台标签页
            # 限流心跳,切走越久越可能超时)。保持 away 并持续累计时长,不降级成离线;
            # 失联超过宽限(AWAY_GRACE_SEC,约等于关了浏览器)或最后状态可见才判离线。
            if not st.get("visible", True) and st.get("away_since") and age <= AWAY_GRACE_SEC:
                status = "away"
                away_sec = int((now - st["away_since"]).total_seconds())
            else:
                status = "offline"   # ⚪ 关页面/断网/锁屏
                away_sec = 0
        elif not st.get("visible", True):
            status = "away"          # 🔴 切出页面
            away_sec = int((now - st["away_since"]).total_seconds()) if st.get("away_since") else 0
        elif st.get("idle"):
            status = "distracted"    # 🟡 页面在但无操作(疑似走神/分屏)
            away_sec = 0
        else:
            status = "studying"      # 🟢 正常学习
            away_sec = 0
        out.append({
            "user_id": sid,
            "status": status,
            "away_seconds": away_sec,
            "switch_count_today": st.get("switch_count_today", 0)
                if st.get("count_date") == now.date().isoformat() else 0,
            "unit_id": st.get("unit_id"),
            "unit_name": st.get("unit_name"),
            "last_seen_ago": int(age),
        })
    return out
