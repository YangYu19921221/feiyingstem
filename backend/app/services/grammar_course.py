"""语法小课(句子积木)怎么上 —— 规则真源(2026-11-15,第一步: 样课)

内容在 app/grammar/: blocks 积木的写法 / 颜色 / 形状,items 七种题和判分,course 写课用的函数,
lessons_present 第一条线「是什么 · 做什么」10 节。这里管: 谁能进、一节课的顺序、孩子每点一下怎么判、
什么时候把答案给他看、学完怎么算。页面上显示的字和数都从这里给,不在前端另写一份。

1. **谁能进**(system_configs 里 grammar_settings 的 scope;没有这一行 = staff):
   off 全关 / staff 只有老师、机构管理员、平台管理员能点开试(样课阶段的默认)/ hq 直营的学生也能学 / all 所有学生。
   老师随时能进(试课、备课)。老师自己的上课记录也存在 grammar_runs 里,以后做学生统计要按角色排掉。
   **工作台上放不放入口**(show_staff_entry)比「能不能进」窄: 平台管理员一直有;老师 / 机构管理员在样课阶段(staff)和只开直营(hq)时
   只有直营的才有 —— 内容还没让老师审过,不先摆到加盟校面前(知道地址的仍然进得去);开给所有学生(all)以后各机构都有。
2. **一节课的顺序**: 几步「看和听」和「跟着做」交替(lesson.steps)→ 6 道左右「自己练」(lesson.practice)→ 小结。
   回头考(lesson.pool)还没接,这些题不下发。
3. **答案只在服务器**: 下发的题没有答案(items.public)。孩子每点一下交一次,服务器判(items.grade)。
   - 错了: 回这一种错法对应的那句话(items.hint_text),不是把原话再说一遍。
   - 同一步错满 SHOW_AFTER(2)次: 把答案指给他看(show),让他自己点一下 —— 不替他点。
   - 一道题可以有好几步(分筐: 一块算一步;帮小鹰同学改错: 先点出错的那块,再挑一块换上),要按顺序交。
     交上来的不是当前这一步(页面旧了 / 另一台设备做过了)→ Stale,接口回 409,页面按服务器的进度重摆。
   - 做完才给整句(reveal)。
4. **学完怎么算**: 「自己练」里一步都没错过的算「一次做对」;全对或只错 GOOD_MISS(1)道说 done_good,
   其余说 done_weak。「跟着做」不计成绩。当场做对不算会 —— 点亮要等回头考(下一步做)。
5. **没上完就走了**: RESUME_HOURS(6)小时内再点开,接着上(从第一道没做完的题开始);更久的重新上一遍。
6. **两台设备 / 连点**: 每次作答按 version 条件更新,没抢到的算 Stale。
"""
from __future__ import annotations

import json
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_today, utc_now
from app.grammar import blocks as B
from app.grammar import course as C
from app.grammar import items as I
from app.grammar.lessons_present import LESSONS as PRESENT_LESSONS
from app.models.grammar import GrammarRun
from app.models.system_config import SystemConfig
from app.models.user import User

SETTINGS_KEY = "grammar_settings"
SCOPES = ("off", "staff", "hq", "all")
DEFAULT_SCOPE = "staff"
HQ_ORG_ID = 1                       # 直营(雪域飞鹰)
STAFF_ROLES = ("teacher", "org_admin", "admin")

SHOW_AFTER = 2                      # 同一步错几次,把答案指给他看
GOOD_MISS = 1                       # 「自己练」最多错几道还算学得好
RESUME_HOURS = 6                    # 没上完,多久以内回来接着上

# 一条线 = 一组按顺序学的小课。现在只有第一条
LINES = [
    {"id": "present", "name": "是什么 · 做什么", "sub": "am is are · like likes · don't doesn't", "lessons": PRESENT_LESSONS},
]
LESSONS: dict[int, dict] = {ls["id"]: ls for line in LINES for ls in line["lessons"]}


class Stale(Exception):
    """交上来的不是当前这一步(页面上的进度旧了)。接口回 409,页面重新取进度"""


# ---------------------------------------------------------------- 谁能进

async def get_settings(db: AsyncSession) -> dict:
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    scope = DEFAULT_SCOPE
    if row is not None and row.config_value:
        try:
            data = json.loads(row.config_value)
        except ValueError:
            data = None
        if isinstance(data, dict) and data.get("scope") in SCOPES:
            scope = data["scope"]
    return {"scope": scope}


async def can_enter(db: AsyncSession, user: User) -> tuple[bool, str]:
    """→ (能不能进, 不能进的原因 —— 直接给人看的一句话)"""
    scope = (await get_settings(db))["scope"]
    if scope == "off":
        return False, "句子积木暂时关着,过几天再来"
    if user.role in STAFF_ROLES:
        return True, ""
    if user.role != "student":
        return False, "这个账号不能学句子积木"
    if scope == "all" or (scope == "hq" and user.org_id == HQ_ORG_ID):
        return True, ""
    return False, "句子积木还在准备,过几天就能学啦"


def show_staff_entry(user: User, scope: str) -> bool:
    """管理端首页 / 教师工作台上放不放「句子积木」的入口。规则见文件头第 1 条"""
    if scope == "off" or user.role not in STAFF_ROLES:
        return False
    if user.role == "admin" or scope == "all":
        return True
    return user.org_id == HQ_ORG_ID


# ---------------------------------------------------------------- 发给页面的样子

def lesson_brief(ls: dict) -> dict:
    return {"id": ls["id"], "name": ls["name"], "title": ls["title"], "goal": ls["goal"],
            "practice_count": len(ls["practice"])}


def run_items(ls: dict) -> list[dict]:
    """这节课里要孩子动手的题,按上课的顺序: 跟着做的 + 自己练的(回头考的不在里面)"""
    return [s for s in ls["steps"] if s.get("kind") != "watch"] + list(ls["practice"])


def find_item(ls: dict, key: str) -> Optional[dict]:
    return next((it for it in run_items(ls) if it["key"] == key), None)


def lesson_view(ls: dict) -> dict:
    """一节课要用到的全部东西(没有答案),一次给页面: 页面可以提前把声音拉下来"""
    steps: list[dict] = []
    for st in ls["steps"]:
        if st.get("kind") == "watch":
            steps.append({"kind": "watch", "frames": [C.frame_view(f) for f in st["frames"]]})
        else:
            steps.append({"kind": "item", "item": I.public(st)})
    return {
        "lesson": lesson_brief(ls),
        "media": B.MEDIA_PREFIX,
        "lines": {k: B.say(v) for k, v in C.LINES.items()},
        "steps": steps,
        "practice": [I.public(it) for it in ls["practice"]],
        "rule": {"rows": [I._with_audio(B.row(r)) for r in ls["rule"]], "say": B.say(ls["rule_say"])},
    }


def _blank() -> dict:
    return {"p": 0, "t": 0, "w": 0, "d": False}


def _items_state(state: Any) -> dict:
    items = (state or {}).get("items") if isinstance(state, dict) else None
    return items if isinstance(items, dict) else {}


def state_view(ls: dict, state: Any) -> dict:
    """每道题做到哪了。做了一半的题,把接着做要用的东西一起带上"""
    saved = _items_state(state)
    out: dict[str, dict] = {}
    for it in run_items(ls):
        st = {**_blank(), **(saved.get(it["key"]) or {})}
        v: dict[str, Any] = {"part": st["p"], "tries": st["t"], "wrong": st["w"], "done": bool(st["d"])}
        if not st["d"]:
            if it["type"] == "fix" and st["p"] == 1:
                v["next"] = I.next_part(it, 0)       # 第二步的选项
                v["bad"] = I.show(it, 0)             # 第一步已经点对的那一块
            if st["t"] >= SHOW_AFTER:
                v["show"] = I.show(it, st["p"])
        out[it["key"]] = v
    return out


def _all_done(ls: dict, saved: dict) -> bool:
    return all((saved.get(it["key"]) or {}).get("d") for it in run_items(ls))


def summary(ls: dict, state: Any) -> dict:
    saved = _items_state(state)
    total = len(ls["practice"])
    first_right = sum(1 for it in ls["practice"]
                      if (saved.get(it["key"]) or {}).get("d") and not (saved.get(it["key"]) or {}).get("w"))
    good = first_right >= total - GOOD_MISS
    return {"total": total, "first_right": first_right, "good": good,
            "say": B.say(C.LINES["done_good" if good else "done_weak"])}


def praise_for(it: dict) -> str:
    """做对了说哪句。帮小鹰同学改错的那种题,是小鹰同学说谢谢"""
    if it["type"] == "fix":
        return I.PRAISE[-1]
    return I.PRAISE[sum(map(ord, it["key"])) % (len(I.PRAISE) - 1)]


def run_view(ls: dict, run: GrammarRun, resumed: bool) -> dict:
    finished = run.finished_at is not None
    return {
        "run_id": run.id, "version": run.version, "resumed": resumed,
        **lesson_view(ls),
        "state": state_view(ls, run.state),
        "finish": summary(ls, run.state) if finished else None,
        "show_after": SHOW_AFTER,
    }


# ---------------------------------------------------------------- 上课

async def done_map(db: AsyncSession, user_id: int) -> dict[int, dict]:
    """这个人每节课上完过几次、最好一次「自己练」一次做对几道"""
    rows = (await db.execute(
        select(GrammarRun.lesson_id, func.count(GrammarRun.id), func.max(GrammarRun.first_right),
               func.max(GrammarRun.total))
        .where(GrammarRun.user_id == user_id, GrammarRun.kind == "lesson", GrammarRun.finished_at.isnot(None))
        .group_by(GrammarRun.lesson_id)
    )).all()
    return {r[0]: {"times": r[1], "best": r[2] or 0, "total": r[3] or 0} for r in rows}


async def start_run(db: AsyncSession, user: User, ls: dict, fresh: bool = False) -> tuple[GrammarRun, bool]:
    """开始一节课 → (这次上课, 是不是接着上次的)。调用方 commit"""
    if not fresh:
        last = (await db.execute(
            select(GrammarRun)
            .where(GrammarRun.user_id == user.id, GrammarRun.lesson_id == ls["id"],
                   GrammarRun.kind == "lesson", GrammarRun.finished_at.is_(None))
            .order_by(GrammarRun.id.desc()).limit(1)
            # 作答走条件 UPDATE,不同步会话里读过的对象;不加这句会拿到旧进度
            .execution_options(populate_existing=True)
        )).scalar_one_or_none()
        # 时间在 Python 里比(SQLite 里两种 datetime 写法按字符串比会出错)
        if last is not None and last.started_at and utc_now() - last.started_at <= timedelta(hours=RESUME_HOURS):
            return last, bool(_items_state(last.state))
    run = GrammarRun(user_id=user.id, org_id=user.org_id, lesson_id=ls["id"], kind="lesson",
                     day=local_today().isoformat(), state={"items": {}}, version=0, started_at=utc_now())
    db.add(run)
    await db.flush()
    return run, False


async def answer(db: AsyncSession, run: GrammarRun, ls: dict, key: str, part: int, ans: Any) -> dict:
    """孩子点了一下。判分、记进度、(全做完了)结课,一起提交。交的不是当前这一步 → Stale"""
    it = find_item(ls, key)
    if it is None:
        raise LookupError(key)
    run_id, version, old_state = run.id, run.version, run.state
    saved = dict(_items_state(old_state))
    st = {**_blank(), **(saved.get(key) or {})}
    if run.finished_at is not None or st["d"] or part != st["p"]:
        raise Stale()

    ok, code = I.grade(it, part, ans)
    out: dict[str, Any] = {"ok": ok, "done": False}
    if ok:
        st["p"] += 1
        st["t"] = 0
        if st["p"] >= I.parts(it):
            st["d"] = True
            out["done"] = True
            out["reveal"] = I.reveal(it)
            out["praise"] = B.say(praise_for(it))
        else:
            out["next"] = I.next_part(it, part)
    else:
        st["t"] += 1
        st["w"] += 1
        out["hint"] = B.say(I.hint_text(it, part, code, ls["misc"]))
        if st["t"] >= SHOW_AFTER:
            out["show"] = I.show(it, part)
            out["show_say"] = B.say(C.LINES["show"])
    out["part"], out["tries"], out["wrong"] = st["p"], st["t"], st["w"]

    saved[key] = st
    base = old_state if isinstance(old_state, dict) else {}
    new_state = {**base, "items": saved}
    values: dict[str, Any] = {"state": new_state, "version": version + 1}
    finish = None
    if _all_done(ls, saved):
        finish = summary(ls, new_state)
        values.update(finished_at=utc_now(), total=finish["total"], first_right=finish["first_right"])
    res = await db.execute(update(GrammarRun).where(GrammarRun.id == run_id, GrammarRun.version == version)
                           .values(**values))
    if res.rowcount != 1:
        # 没改到任何行,不用 rollback(rollback 会让调用方手里的 ORM 对象过期 → 再读属性就 MissingGreenlet)
        raise Stale()
    await db.commit()
    out["version"] = version + 1
    out["finish"] = finish
    return out
