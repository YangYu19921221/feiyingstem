"""音标学习报告(2026-11-03,唯一真源)

用户原话:「我还需要学生音标的学习报告 越详细越好老师才知道学生差哪里」。给老师、学生、家长三种人看,
**三个版本都从这里出数**(各算一遍会出现老师说他差 /æ/、孩子自己那页说 /æ/ 已经会了)。

## 数据从哪来(只读,不另存)
- 写音标: phonetic_textbook_attempts(卡片版 / 整页版每交一次一行,submitted_json 是孩子填的音素)
- 读音标: phonetic_readings(每读一次一行;verdict / judge_detail 是判定服务给的,10-30 起才有)
- 听力: phonetic_listening_attempts(单词对没对、音标对没对、写成了什么)
- 视频: phonetic_video_views(services/video_watch 同一口径)

## 口径(改这里,三个版本跟着变)
1. **只认第一遍**算音素对错: 第二遍辅音是服务端回填的、只填元音,算进去会把辅音正确率虚高
2. **按音素算,不按词算**: 「这个孩子差哪里」答案是 /ŋ/ 写成 /n/、/eɪ/ 写成 /aɪ/,不是 bang 错了
3. 一个音素**第一遍出现不到 MIN_SEEN(4)次**不下结论(写错 1 次就判「不会」是冤枉)
4. 弱音素 = 正确率 < WEAK_RATE(75%);**写混** = (该写的, 写成的) 成对数,出现 ≥ 2 次才列
5. 读音标的毛病按判定服务的 error_code 归类(词尾多带音 / 元音不对 / 开头辅音没读),
   并列出读得最差的几个词,每个带最近一条录音 id 给老师听(老师能听本机构的,学生能听自己的;
   录音回放接口照旧,本模块不碰权限)。**「我读对了」自己点的**单独数 —— 多了说明机器拦得太严或孩子在糊弄
6. 时间范围默认近 30 天(DAYS),可传 7 / 30 / 90 / 0(=全部)。用时每次作答封顶 2 分钟(CAP_MS_PER_ITEM,挂机不算)
7. 建议是**规则写的**,不调 AI: 看最弱的 3 个音素 + 最多的读音毛病,写成「下一步练什么」,每条带它出自哪节课
   (学生 / 家长版的入口按钮靠这个找节)。不写分数排名,不和别的孩子比
8. 家长 / 学生版只给: 练了几节、多久、哪几个音还要练(最多 5 个)+ 一句建议;**没有录音、没有写成了什么的明细**
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.phonetic_listening import ListeningAttempt, ListeningItem, ListeningSet
from app.models.phonetic_practice import (
    PhoneticAttempt, PhoneticItem, PhoneticLesson, PhoneticReading,
)

DAYS = 30
MIN_SEEN = 4
WEAK_RATE = 0.75
CONFUSION_MIN = 2
TOP_WEAK = 6
TOP_WORDS = 8
# 一次作答最多算 2 分钟: 孩子开着页面走开,一题能记成 12 分钟(生产 96 号实测 719 秒),
# 不封顶的话「练了 118 分钟」全是挂机。整页版一次交 20 题,按题数放宽
CAP_MS_PER_ITEM = 120_000

VOWELS = {'iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə',
          'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə'}

# 读音毛病: 判定服务的 error_code → 给人看的话 + 怎么练(老师版和学生版共用)
READ_ISSUES = {
    "extra_final_vowel": ("词尾多带一个音", "词尾的辅音读完就收住,别往后拖成两个字(bad 不是 bei-de)"),
    "wrong_vowel": ("元音读得不对", "先听标准音,把中间那个元音单独拉长读三遍,再连起来读"),
    "missing_onset": ("开头的辅音没读出来", "开头的 b / p / d / t / k / g 要先把嘴闭上或舌头顶住,再弹开"),
    "accent": ("能听懂但口音重", "跟着标准音一句一句模仿,先慢后快"),
}
GRADE_RANK = {"green": 0, "yellow": 1, "red": 2}


def _loads(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _since(days: int) -> Optional[datetime]:
    return None if not days else datetime.utcnow() - timedelta(days=days)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    # 库里存的是 UTC 不带时区,补 Z 前端才不会当成本地时间
    return dt.isoformat() + "Z" if dt else None


@dataclass
class _Ph:
    seen: int = 0
    right: int = 0
    wrong_as: Counter = field(default_factory=Counter)
    lessons: Counter = field(default_factory=Counter)        # 在哪几节里练的(给「去练」按钮找节)
    words: Counter = field(default_factory=Counter)          # 写错时是哪几个词


async def build(db: AsyncSession, student_id: int, days: int = DAYS) -> dict:
    """一个学生的完整音标报告(老师版)。学生 / 家长版用 brief() 从这里裁"""
    since = _since(days)

    # ---------------------------------------------------------------- 写音标
    q = (select(PhoneticAttempt, PhoneticItem.word, PhoneticItem.answer_json, PhoneticLesson.code, PhoneticLesson.id)
         .join(PhoneticItem, PhoneticItem.id == PhoneticAttempt.item_id)
         .join(PhoneticLesson, PhoneticLesson.id == PhoneticAttempt.lesson_id)
         .where(PhoneticAttempt.user_id == student_id))
    if since:
        q = q.where(PhoneticAttempt.created_at >= since)
    write_rows = (await db.execute(q.order_by(PhoneticAttempt.id))).all()

    ph: dict[str, _Ph] = defaultdict(_Ph)
    write_words: dict[int, dict] = {}            # item_id → 第一遍对没对、最后对没对
    write_lessons: dict[int, dict] = {}
    for a, word, answer_json, code, lesson_id in write_rows:
        answer = _loads(answer_json, [])
        wl = write_lessons.setdefault(lesson_id, {"lesson_id": lesson_id, "code": code, "items": set(),
                                                   "first_right": set(), "last": a.created_at})
        wl["items"].add(a.item_id)
        wl["last"] = max(wl["last"], a.created_at) if a.created_at else wl["last"]
        w = write_words.setdefault(a.item_id, {"word": word, "code": code, "first_ok": None, "ever_ok": False,
                                               "tries": 0, "wrote": None, "answer": "".join(answer)})
        w["tries"] += 1
        if a.is_correct:
            w["ever_ok"] = True
        if a.pass_number != 1 or w["first_ok"] is not None:
            continue
        # 只认第一遍(口径 1)
        w["first_ok"] = bool(a.is_correct)
        if a.is_correct:
            wl["first_right"].add(a.item_id)
        sub = _loads(a.submitted_json, [])
        if not a.is_correct:
            w["wrote"] = "".join(x or "_" for x in sub)
        for i, t in enumerate(answer):
            if t == 'ˈ':
                continue
            got = sub[i] if i < len(sub) else None
            p = ph[t]
            p.seen += 1
            p.lessons[(lesson_id, code)] += 1
            if got == t:
                p.right += 1
            else:
                p.words[word] += 1
                if got:
                    p.wrong_as[got] += 1

    # 听力里的音标也算进音素统计(同样只认第一遍)
    lq = (select(ListeningAttempt, ListeningItem.word, ListeningItem.answer_json, ListeningSet.title, ListeningSet.id)
          .join(ListeningItem, ListeningItem.id == ListeningAttempt.item_id)
          .join(ListeningSet, ListeningSet.id == ListeningAttempt.set_id)
          .where(ListeningAttempt.user_id == student_id))
    if since:
        lq = lq.where(ListeningAttempt.created_at >= since)
    listen_rows = (await db.execute(lq.order_by(ListeningAttempt.id))).all()
    listen_first: dict[int, dict] = {}
    listen_sets: dict[int, dict] = {}
    for a, word, answer_json, title, set_id in listen_rows:
        ls = listen_sets.setdefault(set_id, {"set_id": set_id, "title": title, "items": set(), "first_right": set(),
                                             "word_wrong": 0, "phonetic_wrong": 0, "last": a.created_at})
        ls["items"].add(a.item_id)
        if a.created_at:
            ls["last"] = max(ls["last"], a.created_at)
        if a.pass_number != 1 or a.item_id in listen_first:
            continue
        listen_first[a.item_id] = {"word": word, "set": title, "word_ok": a.word_correct, "phonetic_ok": a.phonetic_correct,
                                   "wrote": a.word_submitted, "gave_up": a.gave_up}
        if a.is_correct:
            ls["first_right"].add(a.item_id)
        if a.gave_up:
            continue
        if not a.word_correct:
            ls["word_wrong"] += 1
        if not a.phonetic_correct:
            ls["phonetic_wrong"] += 1
        answer = _loads(answer_json, [])
        sub = _loads(a.phonetic_submitted_json, [])
        for i, t in enumerate(answer):
            if t == 'ˈ':
                continue
            got = sub[i] if i < len(sub) else None
            p = ph[t]
            p.seen += 1
            if got == t:
                p.right += 1
            else:
                p.words[word] += 1
                if got:
                    p.wrong_as[got] += 1

    phonemes = []
    for t, p in ph.items():
        rate = p.right / p.seen if p.seen else None
        phonemes.append({
            "phoneme": t, "vowel": t in VOWELS, "seen": p.seen, "right": p.right,
            "rate": round(rate, 3) if rate is not None else None,
            "enough": p.seen >= MIN_SEEN,
            "weak": p.seen >= MIN_SEEN and rate is not None and rate < WEAK_RATE,
            "wrong_as": [{"phoneme": k, "times": v} for k, v in p.wrong_as.most_common(3)],
            "words": [w for w, _ in p.words.most_common(4)],
            "lesson": ({"id": p.lessons.most_common(1)[0][0][0], "code": p.lessons.most_common(1)[0][0][1]}
                       if p.lessons else None),
        })
    phonemes.sort(key=lambda x: (not x["enough"], x["rate"] if x["rate"] is not None else 1, -x["seen"]))
    weak = [x for x in phonemes if x["weak"]][:TOP_WEAK]

    confusions = []
    for t, p in ph.items():
        for got, n in p.wrong_as.items():
            if n >= CONFUSION_MIN:
                confusions.append({"should": t, "wrote": got, "times": n, "words": [w for w, _ in p.words.most_common(3)]})
    confusions.sort(key=lambda x: -x["times"])

    # ---------------------------------------------------------------- 读音标
    rq = (select(PhoneticReading, PhoneticItem.word, PhoneticItem.answer_display, PhoneticLesson.code)
          .join(PhoneticItem, PhoneticItem.id == PhoneticReading.item_id)
          .join(PhoneticLesson, PhoneticLesson.id == PhoneticReading.lesson_id)
          .where(PhoneticReading.user_id == student_id))
    if since:
        rq = rq.where(PhoneticReading.created_at >= since)
    read_rows = (await db.execute(rq.order_by(PhoneticReading.id))).all()
    grades = Counter()
    issues = Counter()
    issue_words: dict[str, Counter] = defaultdict(Counter)
    self_passed = 0
    judged = 0
    read_words: dict[int, dict] = {}
    read_lessons: dict[str, dict] = {}
    for r, word, phonetic, code in read_rows:
        d = _loads(r.judge_detail, {})
        g = d.get("grade")
        rl = read_lessons.setdefault(code, {"code": code, "lesson_id": r.lesson_id, "words": set(), "green": set(),
                                            "last": r.created_at})
        rl["words"].add(r.item_id)
        if r.created_at:
            rl["last"] = max(rl["last"], r.created_at)
        if r.self_passed:
            self_passed += 1
        if g:
            judged += 1
            grades[g] += 1
            if g == "green":
                rl["green"].add(r.item_id)
        code_ = d.get("error_code") or ("accent" if d.get("accent") else None)
        if code_ in READ_ISSUES:
            issues[code_] += 1
            issue_words[code_][word] += 1
        w = read_words.setdefault(r.item_id, {"word": word, "phonetic": phonetic, "code": code, "tries": 0,
                                              "best": None, "last_grade": None, "last_reading_id": None,
                                              "issue": None, "self_passed": False})
        w["tries"] += 1
        if g:
            w["last_grade"] = g
            w["best"] = g if w["best"] is None or GRADE_RANK[g] < GRADE_RANK[w["best"]] else w["best"]
        w["last_reading_id"] = r.id
        if code_:
            w["issue"] = code_
        if r.self_passed:
            w["self_passed"] = True

    # 读得最差的词: 从来没读到绿、读了好几遍的排前面
    hard_reads = sorted(
        (w for w in read_words.values() if w["best"] != "green"),
        key=lambda w: (GRADE_RANK.get(w["best"] or "red", 2) * -1, -w["tries"]))[:TOP_WORDS]
    for w in hard_reads:
        w["issue_label"] = READ_ISSUES[w["issue"]][0] if w["issue"] in READ_ISSUES else None

    # ---------------------------------------------------------------- 写错最多的词
    hard_writes = sorted(
        (w for w in write_words.values() if w["first_ok"] is False),
        key=lambda w: (w["ever_ok"], -w["tries"]))[:TOP_WORDS]

    # ---------------------------------------------------------------- 视频
    from app.services.video_watch import stats_by_student
    vs = (await stats_by_student(db, user_ids=[student_id])).get(student_id)

    # ---------------------------------------------------------------- 每天练了多少(近 days 天,最多 30 个点)
    daily: Counter = Counter()
    for a, *_ in write_rows:
        if a.created_at:
            daily[(a.created_at + timedelta(hours=8)).date().isoformat()] += 1
    for r, *_ in read_rows:
        if r.created_at:
            daily[(r.created_at + timedelta(hours=8)).date().isoformat()] += 1
    for a, *_ in listen_rows:
        if a.created_at:
            daily[(a.created_at + timedelta(hours=8)).date().isoformat()] += 1

    cap = lambda ms: min(ms or 0, CAP_MS_PER_ITEM)
    write_secs = sum(cap(a.duration_ms) for a, *_ in write_rows) // 1000
    read_secs = sum(cap(r.duration_ms) for r, *_ in read_rows) // 1000
    listen_secs = sum(cap(a.duration_ms) for a, *_ in listen_rows) // 1000

    lessons_out = []
    for wl in write_lessons.values():
        lessons_out.append({"kind": "write", "lesson_id": wl["lesson_id"], "code": wl["code"],
                            "items": len(wl["items"]), "first_right": len(wl["first_right"]), "last": _iso(wl["last"])})
    for rl in read_lessons.values():
        lessons_out.append({"kind": "read", "lesson_id": rl["lesson_id"], "code": rl["code"],
                            "items": len(rl["words"]), "green": len(rl["green"]), "last": _iso(rl["last"])})
    for ls in listen_sets.values():
        lessons_out.append({"kind": "listen", "set_id": ls["set_id"], "code": ls["title"], "items": len(ls["items"]),
                            "first_right": len(ls["first_right"]), "word_wrong": ls["word_wrong"],
                            "phonetic_wrong": ls["phonetic_wrong"], "last": _iso(ls["last"])})
    lessons_out.sort(key=lambda x: x["last"] or "", reverse=True)

    first_write = [w for w in write_words.values() if w["first_ok"] is not None]
    listen_list = list(listen_first.values())
    summary = {
        "days": days,
        "active_days": len(daily),
        "minutes": round((write_secs + read_secs + listen_secs + (vs.total_watch_seconds if vs else 0)) / 60),
        "write": {"words": len(first_write), "first_right": sum(1 for w in first_write if w["first_ok"]),
                  "lessons": len(write_lessons), "minutes": round(write_secs / 60)},
        "read": {"words": len(read_words), "judged": judged, "green": grades["green"], "yellow": grades["yellow"],
                 "red": grades["red"], "self_passed": self_passed, "lessons": len(read_lessons),
                 "minutes": round(read_secs / 60)},
        "listen": {"items": len(listen_list), "first_right": sum(1 for x in listen_list if x["word_ok"] and x["phonetic_ok"]),
                   "word_wrong": sum(1 for x in listen_list if not x["word_ok"] and not x["gave_up"]),
                   "phonetic_wrong": sum(1 for x in listen_list if not x["phonetic_ok"] and not x["gave_up"]),
                   "gave_up": sum(1 for x in listen_list if x["gave_up"]), "sets": len(listen_sets),
                   "minutes": round(listen_secs / 60)},
        "video": {"started": vs.videos_started if vs else 0, "completed": vs.videos_completed if vs else 0,
                  "minutes": round((vs.total_watch_seconds if vs else 0) / 60)},
    }

    read_issue_list = [{"code": c, "label": READ_ISSUES[c][0], "how": READ_ISSUES[c][1], "times": n,
                        "words": [w for w, _ in issue_words[c].most_common(4)]}
                       for c, n in issues.most_common()]

    return {
        "summary": summary,
        "weak_phonemes": weak,
        "phonemes": phonemes,
        "confusions": confusions[:8],
        "read_issues": read_issue_list,
        "hard_reads": hard_reads,
        "hard_writes": hard_writes,
        "listen_wrong": [x for x in listen_list if not (x["word_ok"] and x["phonetic_ok"])][:TOP_WORDS],
        "lessons": lessons_out[:30],
        "daily": sorted(({"day": d, "n": n} for d, n in daily.items()), key=lambda x: x["day"])[-30:],
        "advice": advice(weak, confusions, read_issue_list, summary),
        "has_data": bool(write_rows or read_rows or listen_rows or (vs and vs.videos_started)),
    }


def advice(weak: list, confusions: list, read_issues: list, s: dict) -> list[dict]:
    """下一步练什么(规则写的,口径 7)。每条: 一句话 + 可选的去练哪节"""
    out = []
    if not (s["write"]["words"] or s["read"]["words"] or s["listen"]["items"]):
        if s["video"]["started"]:
            return [{"text": "只看了视频,还没练过。看完一节就去「读音标」「写音标」练一遍,记得更牢", "lesson": None}]
        return [{"text": "这段时间还没练过音标。从教材第 1 节开始,先看视频,再读、再写", "lesson": None}]
    for c in confusions[:2]:
        out.append({"text": f"/{c['should']}/ 常写成 /{c['wrote']}/(错了 {c['times']} 次,如 {'、'.join(c['words'][:2])})。"
                            f"把这两个音放在一起听、一起读,分清了再写",
                    "lesson": next((p["lesson"] for p in weak if p["phoneme"] == c["should"] and p["lesson"]), None)})
    for p in weak:
        if len(out) >= 4:
            break
        if any(c["should"] == p["phoneme"] for c in confusions[:2]):
            continue
        out.append({"text": f"/{p['phoneme']}/ 只写对 {p['right']} / {p['seen']} 次,再回这一节练一遍",
                    "lesson": p["lesson"]})
    if read_issues:
        top = read_issues[0]
        out.append({"text": f"读的时候常「{top['label']}」({top['times']} 次): {top['how']}", "lesson": None})
    if s["read"]["self_passed"] >= 5:
        out.append({"text": f"有 {s['read']['self_passed']} 次没读过、自己点了「我读对了」。老师可以抽听一下这几条录音", "lesson": None,
                    "teacher_only": True})
    if s["read"]["words"] == 0 and s["write"]["words"]:
        out.append({"text": "只写不读。音标要读出来才记得住,每节写完也读一遍", "lesson": None})
    if not out:
        out.append({"text": "这段时间练得不错,没有明显的薄弱音。接着往下一节学", "lesson": None})
    return out


def brief(full: dict) -> dict:
    """学生 / 家长看的简版(口径 8): 没有录音、没有写成了什么"""
    s = full["summary"]
    return {
        "days": s["days"], "active_days": s["active_days"], "minutes": s["minutes"],
        "write": {"words": s["write"]["words"], "first_right": s["write"]["first_right"]},
        "read": {"words": s["read"]["words"], "green": s["read"]["green"]},
        "listen": {"items": s["listen"]["items"], "first_right": s["listen"]["first_right"]},
        "video": s["video"],
        "practice": [{"phoneme": p["phoneme"], "right": p["right"], "seen": p["seen"], "lesson": p["lesson"],
                      "words": p["words"][:2]} for p in full["weak_phonemes"][:5]],
        "advice": [a for a in full["advice"] if not a.get("teacher_only")][:3],
        "has_data": full["has_data"],
    }


async def class_overview(db: AsyncSession, student_ids: Iterable[int], names: dict[int, str], days: int = DAYS) -> dict:
    """全班: 每人一行(练了多少、写对率、读绿率、最弱的 3 个音)+ 全班最多人弱的音素。
    一人一次 build: 全班 60 人本机库副本约 1 秒,够用;涨到几百人再改成一次批量查"""
    rows, weak_count, weak_people = [], Counter(), defaultdict(list)
    for sid in student_ids:
        r = await build(db, sid, days)
        s = r["summary"]
        for p in r["weak_phonemes"]:
            weak_count[p["phoneme"]] += 1
            weak_people[p["phoneme"]].append(names.get(sid, f"#{sid}"))
        rows.append({
            "id": sid, "name": names.get(sid, f"#{sid}"), "active_days": s["active_days"], "minutes": s["minutes"],
            "write_words": s["write"]["words"], "write_first_right": s["write"]["first_right"],
            "read_words": s["read"]["words"], "read_green": s["read"]["green"], "read_judged": s["read"]["judged"],
            "listen_items": s["listen"]["items"], "listen_first_right": s["listen"]["first_right"],
            "video_completed": s["video"]["completed"],
            "weak": [p["phoneme"] for p in r["weak_phonemes"][:3]],
            "has_data": r["has_data"],
        })
    # 没练过的排前面(老师要找的就是他们),其余按写对率从低到高
    def key(x):
        rate = x["write_first_right"] / x["write_words"] if x["write_words"] else 2
        return (x["has_data"], rate)
    rows.sort(key=key)
    return {
        "days": days,
        "students": rows,
        "class_weak": [{"phoneme": p, "students": n, "names": weak_people[p][:8]} for p, n in weak_count.most_common(8)],
        "not_started": sum(1 for x in rows if not x["has_data"]),
    }


# ---------------------------------------------------------------- 作业完成(写音标 / 读音标)
#
# 写音标: 作业开放后这一节每个词都「结束过」—— 写对了(哪一遍都算),或者第二遍判完 / 看了答案。
#   卡片版和整页版都写 phonetic_textbook_attempts,两种都算。只看做没做完,对几个老师在报告里看
# 读音标: 作业开放后这一节每个词都读过一次「判出结果」的(verdict 不是 off / silent),或者孩子点了「我读对了」。
#   没判出来(判定服务慢)不算读过 —— 不然网络一卡整节都算完成了


async def lesson_completion(db: AsyncSession, kind: str, pairs) -> dict:
    """[(学生, 节 id, 开放时刻)] → {同一个 key: 做完的时刻}"""
    pairs = list(pairs)
    if not pairs:
        return {}
    uids = {u for u, _, _ in pairs}
    lids = {l for _, l, _ in pairs}
    earliest = min(t for _, _, t in pairs)
    totals = dict((await db.execute(
        select(PhoneticItem.lesson_id, func.count(PhoneticItem.id))
        .where(PhoneticItem.lesson_id.in_(lids)).group_by(PhoneticItem.lesson_id))).all())
    if kind == "write":
        from sqlalchemy import or_
        rows = (await db.execute(
            select(PhoneticAttempt.user_id, PhoneticAttempt.lesson_id, PhoneticAttempt.item_id, PhoneticAttempt.created_at)
            .where(PhoneticAttempt.user_id.in_(uids), PhoneticAttempt.lesson_id.in_(lids),
                   PhoneticAttempt.created_at >= earliest,
                   or_(PhoneticAttempt.is_correct.is_(True), PhoneticAttempt.pass_number >= 2)))).all()
    else:
        from sqlalchemy import or_, and_
        rows = (await db.execute(
            select(PhoneticReading.user_id, PhoneticReading.lesson_id, PhoneticReading.item_id, PhoneticReading.created_at)
            .where(PhoneticReading.user_id.in_(uids), PhoneticReading.lesson_id.in_(lids),
                   PhoneticReading.created_at >= earliest,
                   or_(PhoneticReading.self_passed.is_(True),
                       and_(PhoneticReading.verdict.is_not(None),
                            PhoneticReading.verdict.notin_(("off", "silent"))))))).all()
    out = {}
    for u, lid, opened in pairs:
        n = totals.get(lid, 0)
        if not n:
            continue
        first: dict[int, datetime] = {}
        for ru, rl, item_id, at in rows:
            if ru == u and rl == lid and at and at >= opened and (item_id not in first or at < first[item_id]):
                first[item_id] = at
        if len(first) >= n:
            out[(u, lid, opened)] = max(first.values())
    return out
