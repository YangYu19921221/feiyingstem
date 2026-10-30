"""电教室网络设置(2026-10-30)。规则真源 services/classroom_net.py,这里只是接口。

挂在 api/v1/phonetics.py 的 router 上(prefix /classroom-net)→ /api/v1/phonetics/classroom-net/...
**main.py 没动**(生产有 drift)。

谁能做什么:
- 老师 / 助教 / 机构管理员 / 平台管理员(按自己账号所在机构,直营是 org 1): 看设置、登记电教室电脑、
  「今天先把这个网络算作电教室」、给孩子开「允许在家看」(老师只能给本班孩子开)
- 开关「只能在电教室看」只给机构管理员和平台管理员(一个老师切了全机构跟着变)
- ping: 不要登录,凭设备码报到(电教室电脑停在登录页也能把新 IP 报上来)
"""
from __future__ import annotations

from datetime import date as _date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.api.v1.teacher._permissions import get_my_class_student_ids
from app.core.actor import acting_user
from app.core.database import get_db
from app.core.timeutil import local_today, utc_now
from app.models.audit import OperationLog
from app.models.classroom_net import (
    ClassroomDevice, ClassroomDeviceIp, ClassroomHomeAllow, ClassroomTempNet,
)
from app.models.phonetic import PhoneticAccessLog
from app.models.user import User
from app.services import audit_log, rate_limit
from app.services import classroom_net as cn

router = APIRouter()

MAX_DEVICES = 30
IMPACT_DAYS = 14
# 估「这个 IP 是不是学校」: 这段时间里本机构有这么多位老师从它登录过(老师家里一般只有自己)。
# 只用在「最近在电教室以外看过的孩子」那张名单上,不参与放行
SCHOOLISH_STAFF = 3
SWITCH_ROLES = ("org_admin", "admin")


def _iso(dt) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def _name(u: User) -> str:
    return (u.full_name or u.username or "").strip()


async def _staff(user: User = Depends(get_current_user)) -> User:
    if user.role not in cn.STAFF_ROLES:
        raise HTTPException(status_code=403, detail="只有老师和管理员能设置电教室网络")
    if user.org_id is None:
        raise HTTPException(status_code=400, detail="这个账号不属于任何机构,没有电教室可设")
    return user


async def _student_scope(db: AsyncSession, user: User) -> Optional[set[int]]:
    """能管哪些孩子: 老师(含助教,认证层已换成主老师)= 本班;机构管理员 / 平台管理员 = 全机构(None 表示不限名单)"""
    if user.role == "teacher":
        return await get_my_class_student_ids(db, user.id)
    return None


async def _check_student(db: AsyncSession, user: User, student_id: int) -> User:
    s = await db.get(User, student_id)
    if s is None or s.role != "student" or s.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="没有这个学生")
    scope = await _student_scope(db, user)
    if scope is not None and student_id not in scope:
        raise HTTPException(status_code=403, detail="只能给本班的孩子设置")
    return s


# ---------------- 总览 ----------------

@router.get("")
async def get_settings(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(_staff)):
    org_id = user.org_id
    ip = cn.client_ip(request)
    this_dev = await cn.find_device(db, cn.device_key_of(request))
    if this_dev is not None and this_dev.org_id != org_id:
        this_dev = None
    if this_dev is not None:
        await cn.touch_device(db, this_dev, ip)

    sources = await cn.classroom_ip_sources(db, org_id)
    devs = (await db.execute(
        select(ClassroomDevice).where(ClassroomDevice.org_id == org_id, ClassroomDevice.revoked_at.is_(None))
        .order_by(ClassroomDevice.id)
    )).scalars().all()
    since30 = utc_now() - timedelta(days=30)
    ip_rows = (await db.execute(
        select(ClassroomDeviceIp).where(
            ClassroomDeviceIp.device_id.in_([d.id for d in devs] or [0]),
            ClassroomDeviceIp.last_seen_at >= since30)
        .order_by(ClassroomDeviceIp.last_seen_at.desc())
    )).scalars().all()
    keep_since = utc_now() - timedelta(days=cn.IP_KEEP_DAYS)
    new_since = utc_now() - timedelta(days=2)
    by_dev: dict[int, list[dict]] = {}
    for r in ip_rows:
        by_dev.setdefault(r.device_id, []).append({
            "ip": r.ip,
            "first_seen_at": _iso(r.first_seen_at),
            "last_seen_at": _iso(r.last_seen_at),
            "counts": bool(r.last_seen_at and r.last_seen_at >= keep_since),
            "new": bool(r.first_seen_at and r.first_seen_at >= new_since),
        })
    temps = (await db.execute(
        select(ClassroomTempNet).where(
            ClassroomTempNet.org_id == org_id, ClassroomTempNet.day == local_today().isoformat())
        .order_by(ClassroomTempNet.id)
    )).scalars().all()
    allows = (await db.execute(
        select(func.count()).select_from(ClassroomHomeAllow).where(ClassroomHomeAllow.org_id == org_id)
    )).scalar() or 0
    return {
        "mode": await cn.org_mode(db, org_id),
        "can_switch": user.role in SWITCH_ROLES,
        "keep_days": cn.IP_KEEP_DAYS,
        "my_ip": ip,
        "ip_is_classroom": bool(ip and ip in sources),
        "this_device": {"id": this_dev.id, "name": this_dev.name} if this_dev else None,
        "classroom_ips": [{"ip": k, "sources": v} for k, v in sorted(sources.items())],
        "devices": [{
            "id": d.id, "name": d.name, "created_by_name": d.created_by_name,
            "created_at": _iso(d.created_at), "last_seen_at": _iso(d.last_seen_at), "last_ip": d.last_ip,
            "ips": by_dev.get(d.id, []),
        } for d in devs],
        "temp_nets": [{"id": t.id, "ip": t.ip, "created_by_name": t.created_by_name,
                       "created_at": _iso(t.created_at)} for t in temps],
        "home_allow_count": allows,
    }


# ---------------- 开关 ----------------

class ModeIn(BaseModel):
    mode: str = Field(..., pattern="^(any|classroom)$")


@router.put("/mode")
async def set_mode(body: ModeIn, request: Request, db: AsyncSession = Depends(get_db),
                   user: User = Depends(_staff)):
    if user.role not in SWITCH_ROLES:
        raise HTTPException(status_code=403, detail="这个开关管整个机构,请机构管理员来切")
    if body.mode == "classroom" and not await cn.classroom_ip_sources(db, user.org_id):
        # 一个电教室 IP 都没认出来就打开 = 全机构的孩子都看不了
        raise HTTPException(status_code=409, detail={
            "code": "no_classroom_net",
            "message": "还没认出电教室的网络。先在电教室的电脑上点「这台电脑在电教室」,再打开这个开关"})
    old = await cn.org_mode(db, user.org_id)
    await cn.set_org_mode(db, user.org_id, body.mode, acting_user(user).id)
    label = "只能在电教室看" if body.mode == "classroom" else "在哪都能看"
    audit_log.record(db, request, user, "classroom.mode", f"音标视频改成「{label}」",
                     detail={"from": old, "to": body.mode})
    await db.commit()
    return {"mode": body.mode}


# ---------------- 电教室电脑 ----------------

class DeviceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)


@router.post("/devices")
async def register_device(body: DeviceIn, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(_staff)):
    """把**发这个请求的电脑**登记为电教室电脑。设备码只在这次响应里给一次(库里只存散列)"""
    await rate_limit.check(("classroom-device", user.id), 10, 3600, "登记得太频繁了,过一会再试")
    name = " ".join(body.name.split())[:30]
    if not name:
        raise HTTPException(status_code=400, detail="给这台电脑起个名字,比如「电教室 1 号机」")
    ip = cn.client_ip(request)
    if not ip:
        raise HTTPException(status_code=400, detail="读不到这台电脑的网络地址")
    existing = await cn.find_device(db, cn.device_key_of(request))
    if existing is not None and existing.org_id == user.org_id:
        existing.name = name
        await db.commit()
        await cn.touch_device(db, existing, ip, force=True)
        return {"id": existing.id, "name": existing.name, "key": None}
    n = (await db.execute(
        select(func.count()).select_from(ClassroomDevice).where(
            ClassroomDevice.org_id == user.org_id, ClassroomDevice.revoked_at.is_(None))
    )).scalar() or 0
    if n >= MAX_DEVICES:
        raise HTTPException(status_code=409, detail=f"最多登记 {MAX_DEVICES} 台电脑,先移除不用的")
    key = cn.new_device_key()
    real = acting_user(user)
    dev = ClassroomDevice(org_id=user.org_id, key_hash=cn.hash_key(key), name=name,
                          created_by=real.id, created_by_name=_name(real)[:100] or None,
                          created_at=utc_now())
    db.add(dev)
    await db.flush()
    audit_log.record(db, request, user, "classroom.device_add", f"登记电教室电脑「{name}」({ip})",
                     target_type="classroom_device", target_id=dev.id)
    await db.commit()
    await cn.touch_device(db, dev, ip, force=True)
    return {"id": dev.id, "name": dev.name, "key": key}


async def _own_device(db: AsyncSession, user: User, device_id: int) -> ClassroomDevice:
    d = await db.get(ClassroomDevice, device_id)
    if d is None or d.org_id != user.org_id or d.revoked_at is not None:
        raise HTTPException(status_code=404, detail="没有这台电脑")
    return d


@router.patch("/devices/{device_id}")
async def rename_device(device_id: int, body: DeviceIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(_staff)):
    d = await _own_device(db, user, device_id)
    name = " ".join(body.name.split())[:30]
    if not name:
        raise HTTPException(status_code=400, detail="名字不能是空的")
    d.name = name
    await db.commit()
    cn.reset_cache()
    return {"id": d.id, "name": d.name}


@router.delete("/devices/{device_id}")
async def remove_device(device_id: int, request: Request, db: AsyncSession = Depends(get_db),
                        user: User = Depends(_staff)):
    """移除 = 软删: 它报过的 IP 立刻不算电教室,行留着备查"""
    d = await _own_device(db, user, device_id)
    d.revoked_at = utc_now()
    d.revoked_by = acting_user(user).id
    audit_log.record(db, request, user, "classroom.device_remove", f"移除电教室电脑「{d.name}」",
                     target_type="classroom_device", target_id=d.id, detail={"last_ip": d.last_ip})
    await db.commit()
    cn.reset_cache()
    return {"ok": True}


@router.post("/ping")
async def ping(request: Request, db: AsyncSession = Depends(get_db)):
    """电教室电脑报到(不要登录,凭设备码)。前端在登记过的电脑上开页面时和每 5 分钟发一次。
    设备码已移除 / 不存在 → 404 code=device_gone,前端据此删掉本机存的码"""
    await rate_limit.check(("classroom-ping", cn.client_ip(request) or "-"), 120, 60, "太频繁")
    d = await cn.find_device(db, cn.device_key_of(request))
    if d is None:
        raise HTTPException(status_code=404, detail={"code": "device_gone", "message": "这台电脑已经不是电教室电脑了"})
    await cn.touch_device(db, d, cn.client_ip(request))
    return {"ok": True, "name": d.name}


# ---------------- 今天先把这个网络算作电教室 ----------------

@router.post("/temp-net")
async def add_temp_net(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(_staff)):
    """把**发这个请求的网络**算作电教室,只管今天(北京日 24 点失效)。不登记设备"""
    await rate_limit.check(("classroom-temp", user.id), 20, 86400, "今天加得太多了")
    ip = cn.client_ip(request)
    if not ip:
        raise HTTPException(status_code=400, detail="读不到这个网络的地址")
    real = acting_user(user)
    res = await db.execute(
        sqlite_insert(ClassroomTempNet).values(
            org_id=user.org_id, ip=ip, day=local_today().isoformat(),
            created_by=real.id, created_by_name=_name(real)[:100] or None, created_at=utc_now(),
        ).on_conflict_do_nothing(index_elements=["org_id", "ip", "day"])
    )
    if res.rowcount:
        audit_log.record(db, request, user, "classroom.temp_net", f"今天把 {ip} 算作电教室网络")
    await db.commit()
    cn.reset_cache()
    return {"ip": ip}


@router.delete("/temp-net/{temp_id}")
async def remove_temp_net(temp_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(_staff)):
    t = await db.get(ClassroomTempNet, temp_id)
    if t is None or t.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="没有这一条")
    await db.delete(t)
    await db.commit()
    cn.reset_cache()
    return {"ok": True}


# ---------------- 允许在家看 ----------------

def _allow_out(a: ClassroomHomeAllow) -> dict:
    return {"until_day": a.until_day, "note": a.note, "created_by_name": a.created_by_name,
            "active": a.until_day is None or a.until_day >= local_today().isoformat()}


@router.get("/students")
async def list_students(q: Optional[str] = None, db: AsyncSession = Depends(get_db),
                        user: User = Depends(_staff)):
    """孩子名单 + 是否允许在家看。老师 = 本班全部;机构管理员 = 已允许的 + 搜得到的(最多 50 个)"""
    scope = await _student_scope(db, user)
    stmt = select(User).where(User.org_id == user.org_id, User.role == "student", User.is_active.is_(True))
    allowed_ids = set((await db.execute(
        select(ClassroomHomeAllow.student_id).where(ClassroomHomeAllow.org_id == user.org_id)
    )).scalars().all())
    kw = (q or "").strip()
    if scope is not None:
        stmt = stmt.where(User.id.in_(scope or {0}))
    elif kw:
        esc = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where((User.username.like(f"%{esc}%", escape="\\")) | (User.full_name.like(f"%{esc}%", escape="\\")))
    else:
        stmt = stmt.where(User.id.in_(allowed_ids or {0}))
    if scope is not None and kw:
        esc = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where((User.username.like(f"%{esc}%", escape="\\")) | (User.full_name.like(f"%{esc}%", escape="\\")))
    users = (await db.execute(stmt.order_by(User.id).limit(300 if scope is not None else 50))).scalars().all()
    allows = {a.student_id: a for a in (await db.execute(
        select(ClassroomHomeAllow).where(ClassroomHomeAllow.student_id.in_([u.id for u in users] or [0]))
    )).scalars().all()}
    items = [{"id": u.id, "name": _name(u), "username": u.username,
              "home_allow": _allow_out(allows[u.id]) if u.id in allows else None} for u in users]
    items.sort(key=lambda x: (x["home_allow"] is None, x["id"]))
    return {"items": items, "limited": scope is None}


class HomeAllowIn(BaseModel):
    until_day: Optional[str] = Field(None, description="YYYY-MM-DD,含这一天;不传 = 一直允许")
    note: Optional[str] = Field(None, max_length=60)


@router.put("/home-allows/{student_id}")
async def set_home_allow(student_id: int, body: HomeAllowIn, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(_staff)):
    s = await _check_student(db, user, student_id)
    until = None
    if body.until_day:
        try:
            d = _date.fromisoformat(body.until_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="日期格式不对")
        if d < local_today():
            raise HTTPException(status_code=400, detail="到期日不能早于今天")
        until = d.isoformat()
    real = acting_user(user)
    note = (body.note or "").strip()[:60] or None
    await db.execute(
        sqlite_insert(ClassroomHomeAllow).values(
            student_id=s.id, org_id=user.org_id, until_day=until, note=note,
            created_by=real.id, created_by_name=_name(real)[:100] or None, updated_at=utc_now(),
        ).on_conflict_do_update(index_elements=["student_id"], set_={
            "org_id": user.org_id, "until_day": until, "note": note, "created_by": real.id,
            "created_by_name": _name(real)[:100] or None, "updated_at": utc_now()})
    )
    audit_log.record(db, request, user, "classroom.home_allow",
                     f"允许「{_name(s)}」在家看音标视频" + (f"(到 {until})" if until else "(一直)"),
                     target_type="user", target_id=s.id, detail={"until_day": until, "note": note})
    await db.commit()
    cn.reset_cache()
    return {"ok": True}


@router.delete("/home-allows/{student_id}")
async def remove_home_allow(student_id: int, request: Request, db: AsyncSession = Depends(get_db),
                            user: User = Depends(_staff)):
    s = await _check_student(db, user, student_id)
    res = await db.execute(delete(ClassroomHomeAllow).where(
        ClassroomHomeAllow.student_id == s.id, ClassroomHomeAllow.org_id == user.org_id))
    if res.rowcount:
        audit_log.record(db, request, user, "classroom.home_allow",
                         f"取消「{_name(s)}」在家看音标视频", target_type="user", target_id=s.id)
    await db.commit()
    cn.reset_cache()
    return {"ok": True}


# ---------------- 打开之前: 最近谁在电教室以外看过 ----------------

@router.get("/impact")
async def impact(db: AsyncSession = Depends(get_db), user: User = Depends(_staff)):
    """最近 14 天在电教室以外看过音标视频的孩子(打开开关后他们在那儿就看不了了)。

    「电教室以外」按 IP 估: 不是现在认出来的电教室 IP,也不是本机构 ≥3 位老师登录过的 IP
    (学校出网 IP 几天一换,上线前的旧学校 IP 不在电教室名单里,靠这条认出来)。估的,不参与放行。
    老师只看本班。"""
    org_id = user.org_id
    since = utc_now() - timedelta(days=IMPACT_DAYS)
    school = set((await cn.classroom_ip_sources(db, org_id)).keys())
    school |= set((await db.execute(
        select(OperationLog.ip).where(
            OperationLog.org_id == org_id, OperationLog.action == "auth.login",
            OperationLog.created_at >= since, OperationLog.ip.is_not(None))
        .group_by(OperationLog.ip).having(func.count(func.distinct(OperationLog.actor_id)) >= SCHOOLISH_STAFF)
    )).scalars().all())
    rows = (await db.execute(
        select(PhoneticAccessLog.user_id, PhoneticAccessLog.ip, PhoneticAccessLog.created_at)
        .join(User, User.id == PhoneticAccessLog.user_id)
        .where(PhoneticAccessLog.org_id == org_id, User.org_id == org_id, User.role == "student",
               PhoneticAccessLog.created_at >= since)
    )).all()
    scope = await _student_scope(db, user)
    agg: dict[int, dict] = {}
    for uid, ip, at in rows:
        if scope is not None and uid not in scope:
            continue
        a = agg.setdefault(uid, {"outside": 0, "inside": 0, "last_outside_at": None})
        if ip and ip in school:
            a["inside"] += 1
        else:
            a["outside"] += 1
            if a["last_outside_at"] is None or at > a["last_outside_at"]:
                a["last_outside_at"] = at
    ids = [uid for uid, a in agg.items() if a["outside"] > 0]
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids or [0])))).scalars().all()}
    allows = {a.student_id: a for a in (await db.execute(
        select(ClassroomHomeAllow).where(ClassroomHomeAllow.student_id.in_(ids or [0]))
    )).scalars().all()}
    items = [{
        "id": uid, "name": _name(users[uid]), "outside_views": agg[uid]["outside"],
        "inside_views": agg[uid]["inside"], "last_outside_at": _iso(agg[uid]["last_outside_at"]),
        "home_allow": _allow_out(allows[uid]) if uid in allows else None,
    } for uid in ids if uid in users]
    items.sort(key=lambda x: (-x["outside_views"], x["id"]))
    return {"days": IMPACT_DAYS, "items": items}
