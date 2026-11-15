"""一节小课怎么写(写课用的几个函数)+ 所有小课都会说的话

一节课 = 几步「看和听」(watch)和「跟着做」(题,不计成绩)交替 → 6 道左右「自己练」(计成绩)→ 另备 8 道以上「回头考」。

    lesson(
        102, "他、她、它", "He is · She is · It is", "一个人、一个东西,用 is",
        steps=[
            watch(F("一个男生,叫 {He}。{He is Mike.}", "He is Mike .", scene="👦", hl=["he"]), ...),
            tap([...], "be"),                       # 跟着做
            ...
        ],
        practice=[...], pool=[...],
        misc={"shape_s3": "他、她、它,一个,后面用 {is}。"},      # 错法 → 针对这一种错法说的话
        rule=["He is tall .", "She is tall ."], rule_say="他、她、它,一个,用 {is}。",
    )

规矩:
- 讲解一句不超过 30 来个字,一步「看和听」不超过 5 句(孩子每 20–30 秒要动一次手)
- 讲解里的英文用 {花括号} 包起来: 出声音时中文用小鹰老师的声音,英文用英式女声(和背单词同一个)
- 自己练的前一两道带形状,后面的不带(links=False): 形状是拐杖,要撤
- 回头考的题一律不带形状
"""
from __future__ import annotations

from typing import Optional

from app.grammar import blocks as B
from app.grammar import items as I

# 所有小课都会说的话(出音频的脚本会把它们一起做出来)
LINES = {
    "start": "准备好了吗?我们开始。",
    "practice": "下面自己试一试。",
    "done_good": "这一节学完了!过几天我回来考考你,还记得,这一块就点亮。",
    "done_weak": "这一节学完了。有几道没一次做对,明天我再来考考你。",
    "review_start": "来,看看前几天学的还记得吗。",
    "review_lit": "还记得!这一块点亮了。",
    "review_solid": "记得很牢,这一块学会了!",
    "review_again": "这一块还没记牢。没关系,明天再来。",
    "show": "看,是这一块。你来点一下。",
}


def F(say: Optional[str], *rows: str, scene: Optional[str] = None, zh: Optional[str] = None,
      hl: Optional[list[str]] = None, links: bool = True) -> dict:
    """一帧: 小鹰老师说一句,台上摆这几行积木。hl 是要亮起来的积木(按原形: be / like / do / not / he …)"""
    return {"say": say, "rows": list(rows), "scene": scene, "zh": zh, "hl": hl or [], "links": links}


def watch(*frames: dict) -> dict:
    assert 1 <= len(frames) <= 5, "一步「看和听」最多 5 句"
    return {"kind": "watch", "frames": list(frames)}


def lesson(pid: int, name: str, title: str, goal: str, *, steps: list[dict], practice: list[dict],
           pool: list[dict], misc: dict[str, str], rule: list[str], rule_say: str) -> dict:
    n = 0
    for st in steps:
        if st.get("kind") != "watch":
            n += 1
            st["key"] = f"{pid}.t{n}"
    for i, it in enumerate(practice, 1):
        it["key"] = f"{pid}.p{i}"
    for i, it in enumerate(pool, 1):
        it["key"] = f"{pid}.r{i}"
        assert not it["links"] or it["type"] == "sort", f"{it['key']}: 回头考的题不带形状"
    return {"id": pid, "name": name, "title": title, "goal": goal, "steps": steps, "practice": practice,
            "pool": pool, "misc": misc, "rule": rule, "rule_say": rule_say}


def frame_view(f: dict) -> dict:
    """一帧发给页面的样子"""
    return {
        "say": B.say(f["say"]) if f["say"] else None,
        "rows": [I._with_audio(B.row(r, None, f["links"])) for r in f["rows"]],
        "scene": f["scene"], "zh": f["zh"], "hl": f["hl"],
    }


def all_items(ls: dict) -> list[dict]:
    return [s for s in ls["steps"] if s.get("kind") != "watch"] + ls["practice"] + ls["pool"]


def find_item(ls: dict, key: str) -> Optional[dict]:
    return next((it for it in all_items(ls) if it["key"] == key), None)


def say_lines(ls: dict) -> set[str]:
    out = {ls["rule_say"], *ls["misc"].values()}
    for st in ls["steps"]:
        if st.get("kind") == "watch":
            out |= {f["say"] for f in st["frames"] if f["say"]}
    for it in all_items(ls):
        out |= I.say_lines(it)
    return out


def en_lines(ls: dict) -> set[str]:
    out: set[str] = set()
    for st in ls["steps"]:
        if st.get("kind") == "watch":
            for f in st["frames"]:
                out |= {b["t"] for r in f["rows"] for b in B.parse(r) if b["r"] != "x"}
    for r in ls["rule"]:
        out |= {b["t"] for b in B.parse(r) if b["r"] != "x"}
    for it in all_items(ls):
        out |= I.en_lines(it)
    return out


def words(ls: dict) -> set[str]:
    out: set[str] = set()
    rows = list(ls["rule"])
    for st in ls["steps"]:
        if st.get("kind") == "watch":
            rows += [r for f in st["frames"] for r in f["rows"]]
    for r in rows:
        for b in B.parse(r):
            out |= {w.strip(".,?!").lower() for w in b["t"].split() if w.strip(".,?!")}
    for it in all_items(ls):
        out |= I.words(it)
    return out
