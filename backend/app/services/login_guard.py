"""登录防爆破(2026-10-28)

起因: /auth/login 不限次数,管理员账号可以无限猜密码;而 bcrypt 一次校验约 0.3 秒,
有人狂刷登录还会把孩子们的请求一起拖慢(校验已挪到线程里跑,见 auth_service.verify_password_async)。

登录三道闸门,**算的是「尝试次数」不是「失败次数」**(先记一次再去校验密码):
只记失败的话,同一时刻并发打进来的一百个请求都会在「还没记上」时通过检查。
登录成功时清掉「这个账号 × 这个 IP」那一道,手滑输错几次再输对的人不会离锁更近。

① 同一账号 × 同一 IP: 教职工 15 分钟 5 次,学生 / 家长 15 分钟 10 次 —— 挡住一个人对着一个号猜
② 同一账号 × 所有 IP: 教职工 1 小时 30 次,学生 / 家长 1 小时 60 次 —— 挡住换 IP 轮着猜。
   **最近 7 天在这个 IP 上成功登录过这个账号的不受这一道拦**: 否则别人每小时随手试 30 次,
   就能让真管理员永远登不进来
③ 同一 IP × 所有账号: 10 分钟 500 次 —— 挡住拿一个 IP 扫一片账号。数字按生产日志定:
   学校机房几十个孩子共用一个出口 IP,2026-02 以来单 IP 10 分钟最多失败 257 次

**刻意没有全站总闸门**(家长绑定码那种): 登录的全站闸门等于给攻击者一个「一个人锁住全校」的按钮。

账号存在就按用户 id 记(用户名 / 手机号 / 邮箱登录的都算同一个号);不存在就按输入的字记
(散列后,不把原文写进存储),扫不存在的号照样被 ① 和 ③ 挡住。

登录后的「输当前密码确认」(改密码 / 改用户名 / 金币 PIN)走 confirm_secret: 只数输错的,
15 分钟错 8 次就先停 —— 拿到别人登录态的人不能拿这些接口去试原密码或 4 位 PIN。

计数放 core/shared_store,多个工作进程共用一份;没配 Redis 时退回进程内存。
"""
from __future__ import annotations

import hashlib
import math
from typing import Iterable, Optional

from fastapi import HTTPException

from app.core.shared_store import store
from app.services.auth_service import verify_password_async

STAFF_ROLES = frozenset({"teacher", "org_admin", "admin", "sales"})

PAIR_WINDOW = 15 * 60
PAIR_LIMIT_STAFF = 5
PAIR_LIMIT_OTHER = 10

ACCT_WINDOW = 60 * 60
ACCT_LIMIT_STAFF = 30
ACCT_LIMIT_OTHER = 60

IP_WINDOW = 10 * 60
IP_LIMIT = 500

TRUST_TTL = 7 * 86400

CONFIRM_WINDOW = 15 * 60
CONFIRM_LIMIT = 8


def is_staff(role: Optional[str]) -> bool:
    return role in STAFF_ROLES


def account_keys(user_ids: Iterable[int], typed: Optional[str] = None) -> list[str]:
    """账号的计数键。找到了用户按 id;一个都没找到按输入的字(散列)"""
    ids = [f"u{int(i)}" for i in user_ids]
    if ids:
        return ids
    norm = (typed or "").strip().lower()
    return ["n" + hashlib.sha1(norm.encode("utf-8")).hexdigest()[:20]]


def _ip(ip: Optional[str]) -> str:
    return (ip or "-")[:64]


def _locked(message: str, wait: float) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={"code": "login_locked", "message": message},
        headers={"Retry-After": str(max(1, math.ceil(wait)))},
    )


def _minutes(sec: float) -> int:
    return max(1, math.ceil(sec / 60))


async def check(ip: Optional[str], keys: list[str], *, staff: bool) -> None:
    """记一次登录尝试;任何一道满了抛 429(这一次不去校验密码)"""
    addr = _ip(ip)
    wait = await store.window_hit(f"lg:ip:{addr}", [(IP_WINDOW, IP_LIMIT)])
    if wait > 0:
        raise _locked(f"这个网络里登录太频繁了，请 {_minutes(wait)} 分钟后再试", wait)

    pair_limit = PAIR_LIMIT_STAFF if staff else PAIR_LIMIT_OTHER
    acct_limit = ACCT_LIMIT_STAFF if staff else ACCT_LIMIT_OTHER
    for k in keys:
        wait = await store.window_hit(f"lg:pair:{k}:{addr}", [(PAIR_WINDOW, pair_limit)])
        if wait > 0:
            raise _locked(f"密码输错太多次了，请 {_minutes(wait)} 分钟后再试。"
                          "忘了密码可以找老师或管理员重置", wait)
        wait = await store.window_hit(f"lg:acct:{k}", [(ACCT_WINDOW, acct_limit)])
        if wait > 0 and not await store.get(f"lg:trust:{k}:{addr}"):
            raise _locked(f"这个账号最近被尝试登录的次数太多，已暂时锁住，请 {_minutes(wait)} 分钟后再试。"
                          "如果不是你本人在试，登录后请尽快修改密码", wait)


async def record_success(ip: Optional[str], keys: list[str]) -> None:
    """密码对了: 清掉这个账号在这个 IP 上的尝试,并记住这个 IP 7 天(②那道不拦它)"""
    addr = _ip(ip)
    for k in keys:
        await store.delete(f"lg:pair:{k}:{addr}")
        await store.set(f"lg:trust:{k}:{addr}", "1", TRUST_TTL)


async def confirm_secret(kind: str, user_id: int, plain: Optional[str], hashed: Optional[str]) -> bool:
    """已登录用户输当前密码 / PIN 确认。错了记一次,15 分钟错满 8 次直接 429(不再校验)。
    kind 区分密码和金币 PIN,两边各数各的"""
    key = f"lg:confirm:{kind}:{user_id}"
    if await store.window_count(key, CONFIRM_WINDOW) >= CONFIRM_LIMIT:
        raise _locked("输错太多次了，请 15 分钟后再试", CONFIRM_WINDOW)
    try:
        ok = bool(plain) and bool(hashed) and await verify_password_async(plain, hashed)
    except ValueError:  # 认不出的哈希(脏数据)当作不匹配
        ok = False
    if not ok:
        await store.window_record(key, CONFIRM_WINDOW)
    return ok
