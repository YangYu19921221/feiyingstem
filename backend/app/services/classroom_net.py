"""电教室网络 —— 判「这个请求是不是在电教室发出来的」(2026-10-30),唯一真源

规则(老师页面 pages/ClassroomNet.tsx 的说明要和这里同步):
1. 机构开关 classroom_net_settings.phonetic_mode: any(默认,没有行也是 any)/ classroom。
   只有 classroom 时学生才受限;老师、助教、机构管理员、平台管理员永不受限(要在家备课)。
2. 电教室 IP = 本机构**没移除**的电教室电脑最近 IP_KEEP_DAYS 天报过的 IP
   + 老师「今天先把这个网络算作电教室」登记的 IP(当天北京日有效)。只认完全相同的 IP,不放行整段。
3. 请求带着本机构电教室电脑的设备码(请求头 X-EH-Classroom)→ 直接算在电教室,顺手记下它现在的 IP
   (学校换了出网 IP,这台电脑下一个请求就把新 IP 带上来,不用人改)。<video> 取片段带不了请求头,
   靠的是第 2 条: 同一台电脑的 IP 已经记下了。
4. 老师给孩子开了「允许在家看」(classroom_home_allows,until_day 含当天)→ 在哪都能看。
5. IP 只认 nginx 写的 X-Real-IP(vhost: proxy_set_header X-Real-IP $remote_addr,客户端改不了);
   **不读 X-Forwarded-For**(客户端自己能填)。没有 X-Real-IP(本机开发 / 测试)才退回连接地址。
   生产 8000 / 8001 外网连不上(防火墙),请求只能经 nginx 进来。

挡不住的(页面上写明):
- 在学校已经打开的那一节,走 COS 时签名地址 3 小时内照样能取(COS 地址绑不了 IP);
  本机串流每个片段都会再查一次 IP,出了学校就停。
- 孩子把电教室电脑的设备码抄回家 → 家里的 IP 会被记成电教室。设备列表里每台电脑报过的 IP
  都列出来、新 IP 标「新」,老师能看到并移除那台电脑。

判定结果在进程里缓存 CACHE_TTL 秒(串流每 1MB 一个请求都要判)。多进程下别的进程最多晚 CACHE_TTL 秒生效。
"""
from __future__ import annotations

import hashlib
import secrets
import time
from datetime import timedelta
from typing import Optional

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import local_today, utc_now
from app.models.classroom_net import (
    ClassroomDevice, ClassroomDeviceIp, ClassroomHomeAllow, ClassroomNetSetting, ClassroomTempNet,
)
from app.models.user import User

HEADER = "x-eh-classroom"
IP_KEEP_DAYS = 7
CACHE_TTL = 15.0
TOUCH_EVERY_SEC = 300     # 同一台电脑同一个 IP,5 分钟内只写一次库
MODES = ("any", "classroom")
STAFF_ROLES = frozenset({"teacher", "org_admin", "admin"})

AWAY_MESSAGE = "音标视频只能在电教室看。你现在连的不是电教室的网络,到电教室连上那里的网络就能看"

# ---- 进程内小缓存 ----
_cache: dict[tuple, tuple[float, object]] = {}


def reset_cache() -> None:
    """测试用 / 改了设置后清掉本进程的缓存"""
    _cache.clear()


def _cached(key: tuple):
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return True, hit[1]
    return False, None


def _put(key: tuple, value) -> None:
    if len(_cache) > 5000:
        _cache.clear()
    _cache[key] = (time.monotonic() + CACHE_TTL, value)


def _drop_org(org_id: int) -> None:
    for k in [k for k in _cache if len(k) > 1 and k[1] == org_id]:
        _cache.pop(k, None)


# ---- IP 与设备码 ----

def client_ip(request: Optional[Request]) -> Optional[str]:
    """真实客户端 IP。只认 nginx 写的 X-Real-IP,不读 X-Forwarded-For(见模块说明第 5 条)"""
    if request is None:
        return None
    ip = (request.headers.get("x-real-ip") or "").strip()
    if not ip and request.client:
        ip = request.client.host or ""
    return ip[:64] or None


def new_device_key() -> str:
    return secrets.token_urlsafe(32)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def device_key_of(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    k = (request.headers.get(HEADER) or "").strip()
    return k if 20 <= len(k) <= 100 else None


async def find_device(db: AsyncSession, key: Optional[str]) -> Optional[ClassroomDevice]:
    """设备码对应的电脑(没移除的)。查不到 / 已移除返回 None"""
    if not key:
        return None
    return (await db.execute(
        select(ClassroomDevice).where(
            ClassroomDevice.key_hash == hash_key(key), ClassroomDevice.revoked_at.is_(None))
    )).scalar_one_or_none()


async def touch_device(db: AsyncSession, device: ClassroomDevice, ip: Optional[str], *, force: bool = False) -> None:
    """记下这台电脑现在的 IP。同一台同一个 IP 5 分钟内只写一次(按共享存储判,多进程也只写一次)。
    **自己 commit**: 调用方都在闸门最前面,此时会话里没有别的待写数据"""
    if not ip:
        return
    # 节流键用设备码散列不用 id: id 可能被 SQLite 回收给新登记的电脑,撞上旧电脑的节流键会让新 IP 5 分钟记不上
    if not force and not await store.incr_if_below(f"cnet:touch:{device.key_hash[:24]}:{ip}", 1, TOUCH_EVERY_SEC):
        return
    now = utc_now()
    await db.execute(
        sqlite_insert(ClassroomDeviceIp)
        .values(device_id=device.id, ip=ip, first_seen_at=now, last_seen_at=now)
        .on_conflict_do_update(index_elements=["device_id", "ip"], set_={"last_seen_at": now})
    )
    await db.execute(
        update(ClassroomDevice).where(ClassroomDevice.id == device.id)
        .values(last_seen_at=now, last_ip=ip)
    )
    await db.commit()
    _drop_org(device.org_id)


# ---- 机构设置 / 电教室 IP ----

async def org_mode(db: AsyncSession, org_id: int) -> str:
    hit, val = _cached(("mode", org_id))
    if hit:
        return val  # type: ignore[return-value]
    row = await db.get(ClassroomNetSetting, org_id)
    mode = row.phonetic_mode if row and row.phonetic_mode in MODES else "any"
    _put(("mode", org_id), mode)
    return mode


async def set_org_mode(db: AsyncSession, org_id: int, mode: str, actor_id: Optional[int]) -> None:
    """调用方 commit。改完清掉本进程缓存"""
    now = utc_now()
    await db.execute(
        sqlite_insert(ClassroomNetSetting)
        .values(org_id=org_id, phonetic_mode=mode, updated_by=actor_id, updated_at=now)
        .on_conflict_do_update(index_elements=["org_id"],
                               set_={"phonetic_mode": mode, "updated_by": actor_id, "updated_at": now})
    )
    _drop_org(org_id)


def _keep_since():
    return utc_now() - timedelta(days=IP_KEEP_DAYS)


async def classroom_ip_sources(db: AsyncSession, org_id: int) -> dict[str, list[str]]:
    """现在算电教室的 IP → 来源说明(哪几台电脑 / 谁今天临时加的)。页面和判定共用这一份"""
    rows = (await db.execute(
        select(ClassroomDeviceIp.ip, ClassroomDevice.name)
        .join(ClassroomDevice, ClassroomDevice.id == ClassroomDeviceIp.device_id)
        .where(ClassroomDevice.org_id == org_id, ClassroomDevice.revoked_at.is_(None),
               ClassroomDeviceIp.last_seen_at >= _keep_since())
    )).all()
    out: dict[str, list[str]] = {}
    for ip, name in rows:
        out.setdefault(ip, []).append(name)
    temps = (await db.execute(
        select(ClassroomTempNet.ip, ClassroomTempNet.created_by_name)
        .where(ClassroomTempNet.org_id == org_id, ClassroomTempNet.day == local_today().isoformat())
    )).all()
    for ip, who in temps:
        out.setdefault(ip, []).append(f"今天临时加的({who or '老师'})")
    return out


async def classroom_ips(db: AsyncSession, org_id: int) -> frozenset[str]:
    hit, val = _cached(("ips", org_id))
    if hit:
        return val  # type: ignore[return-value]
    ips = frozenset((await classroom_ip_sources(db, org_id)).keys())
    _put(("ips", org_id), ips)
    return ips


async def home_allowed(db: AsyncSession, org_id: int, student_id: int) -> bool:
    hit, val = _cached(("home", org_id, student_id))
    if hit:
        return bool(val)
    row = await db.get(ClassroomHomeAllow, student_id)
    ok = bool(row and row.org_id == org_id
              and (row.until_day is None or row.until_day >= local_today().isoformat()))
    _put(("home", org_id, student_id), ok)
    return ok


async def at_classroom(db: AsyncSession, request: Optional[Request], org_id: int) -> bool:
    """这个请求是不是从本机构的电教室发出来的"""
    ip = client_ip(request)
    device = await find_device(db, device_key_of(request))
    if device is not None and device.org_id == org_id:
        await touch_device(db, device, ip)
        return True
    return bool(ip) and ip in await classroom_ips(db, org_id)


async def watch_place(db: AsyncSession, request: Optional[Request], user: User) -> str:
    """音标视频观看地点闸门: 'ok' 放行 / 'away' 不在电教室。
    只管地点;兑换码那道在 api/v1/phonetics._code_gate。request 为空(没有请求上下文)不拦"""
    if request is None or user.role != "student" or user.org_id is None:
        return "ok"
    if await org_mode(db, user.org_id) != "classroom":
        return "ok"
    if await home_allowed(db, user.org_id, user.id):
        return "ok"
    if await at_classroom(db, request, user.org_id):
        return "ok"
    return "away"
