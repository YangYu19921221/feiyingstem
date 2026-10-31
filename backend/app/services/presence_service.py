"""
实时课堂在线状态服务

学生端学习页每 30 秒心跳一次;切出/切回页面时即时上报(sendBeacon)。
教师端每 5-10 秒轮询班级快照。状态放 core/shared_store(2026-10-25 起,后端多进程):
- 学生心跳可能落在 A 进程、老师轮询落在 B 进程,各存各的老师就看不到人,所以必须共享
- 没配 Redis 时退回进程内存 = 原来的单进程行为
- 丢了无妨: 学生端持续心跳,几十秒内自动重建
- 「今日切屏次数」双轨:这里实时累计 + 持久化到 study_sessions 由会话统计,
  这里只服务实时页,历史口径走数据库
"""
import time
from datetime import datetime
from typing import Optional

from app.core.shared_store import store

# 心跳超时:超过该时长无心跳视为离线(学生关页面/断网)。心跳周期 15s,给 4 个周期余量
OFFLINE_AFTER_SEC = 60
# 切出状态的失联宽限:切出的人心跳被浏览器后台限流,超时不立即判离线;
# 但失联超过该时长(大概率已关浏览器)仍降级为离线,避免永远挂在"切出"上
AWAY_GRACE_SEC = 30 * 60
# 快照里保留多久内活跃过的人(每个人一条,过期自动删,每天课后自然清空)
EVICT_AFTER_SEC = 12 * 3600


def _now() -> datetime:
    return datetime.utcnow()


def _key(user_id: int) -> str:
    # 时间字段存 epoch 秒(time.time()): 跨进程、JSON 都好比较。
    # 别用 naive datetime 的 .timestamp() —— 它按本地时区解释,容易差 8 小时
    return f"presence:{user_id}"


async def heartbeat(
    user_id: int,
    visible: bool,
    idle: bool = False,
    unit_id: Optional[int] = None,
    unit_name: Optional[str] = None,
    no_face: Optional[bool] = None,
) -> None:
    """学习页周期心跳(30s)与状态变化时调用。no_face=None 表示这个页面没开摄像头"""
    st = await store.get_json(_key(user_id)) or {
        "away_since": None,
        "switch_count_today": 0,
        "count_date": None,
    }
    st["last_seen"] = time.time()
    st["visible"] = visible
    st["idle"] = idle
    if unit_id is not None:
        st["unit_id"] = unit_id
    if unit_name:
        st["unit_name"] = unit_name
    st["no_face"] = bool(no_face)
    # 心跳兜底:切走期间浏览器可能限流定时器,visible=False 的心跳也维持 away_since
    if visible:
        st["away_since"] = None
    elif st.get("away_since") is None:
        st["away_since"] = time.time()
    await store.set_json(_key(user_id), st, EVICT_AFTER_SEC)


async def report_switch(user_id: int, leaving: bool) -> None:
    """切出(leaving=True)/切回(False) 即时上报(sendBeacon 保证送达)"""
    st = await store.get_json(_key(user_id)) or {
        "switch_count_today": 0,
        "count_date": None,
    }
    now = _now()
    st["last_seen"] = time.time()
    today = now.date().isoformat()
    if st.get("count_date") != today:
        st["count_date"] = today
        st["switch_count_today"] = 0
    if leaving:
        st["visible"] = False
        st["away_since"] = time.time()
        st["switch_count_today"] = int(st.get("switch_count_today") or 0) + 1
    else:
        st["visible"] = True
        st["away_since"] = None
    await store.set_json(_key(user_id), st, EVICT_AFTER_SEC)


async def snapshot(student_ids: list[int]) -> list[dict]:
    """教师端轮询:给定班级学生,返回实时状态列表(一次批量取,不按人逐个查)"""
    now = _now()
    rows = await store.mget_json([_key(sid) for sid in student_ids]) if student_ids else []
    out = []
    for sid, st in zip(student_ids, rows):
        if not st or not st.get("last_seen"):
            continue
        now_ts = time.time()
        away_since = st.get("away_since")
        age = now_ts - float(st["last_seen"])
        if age > EVICT_AFTER_SEC:
            continue
        if age > OFFLINE_AFTER_SEC:
            # 超时前最后状态是「切出」→ 大概率还在别的页面上玩(浏览器对后台标签页
            # 限流心跳,切走越久越可能超时)。保持 away 并持续累计时长,不降级成离线;
            # 失联超过宽限(AWAY_GRACE_SEC,约等于关了浏览器)或最后状态可见才判离线。
            if not st.get("visible", True) and away_since and age <= AWAY_GRACE_SEC:
                status = "away"
                away_sec = int(now_ts - float(away_since))
            else:
                status = "offline"   # ⚪ 关页面/断网/锁屏
                away_sec = 0
        elif not st.get("visible", True):
            status = "away"          # 🔴 切出页面
            away_sec = int(now_ts - float(away_since)) if away_since else 0
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
            "no_face": bool(st.get("no_face")) and status != "offline",
            "last_seen_ago": int(age),
        })
    return out
