"""小鹰老师在聊天里出的练习: 服务器判分、结果回给小鹰老师点评、记进笔记(2026-10-27,用户「按你建议来」)

以前的练习卡是网页当场判的,孩子做对做错小鹰老师不知道,没法接着说「第 2 个错了,我们看看为什么」。
现在一组练习 = 一行 tutor_quizzes,**答案只存在服务器**:

## 题型
- word: 单词卡(make_practice),听发音写 / 看中文写。卡片里只有 word_id(放发音)和中文,不带拼写
- choice: 选择题,2–4 个选项
- fill: 句子填空,题目里一个 ___,答案可以给几个都算对的写法(also)
- order: 连词成句,服务器把正确句子拆成词、打乱顺序发下去(去掉标点和句首大写,不然一眼看出哪个词在头尾)

## 判分口径
大小写、首尾空格、弯撇号、句末标点不算错;fill 的 also 都算对;order 比的是去掉标点后的词序

## 交了以后
1. 第一次交的答案和结果存下来(刷新对话还在;「再写一遍」只判分不覆盖、不记笔记)
2. 记笔记(services/tutor_notes): 单词卡按单词(错了记一条,明天回头考);语法题按出题时给的 topic(全对算答对)
3. 前端接着自动发一句「我做完了」,带上 quiz_id: 服务器把每题的答案和对错发给小鹰老师点评。
   **这次点评不扣次数、也不占「同一道题追问」的那 3 次**(用户 10-27「做完练习后的点评不另扣次数」),
   一份练习只点评一次(条件 UPDATE 认领 feedback_at)。点评那一轮里再出的练习(free_feedback=0),
   它的点评按普通提问算(否则「做题 → 免费点评 → 又出题 → 又免费」能一直白用)

## 不进学习记录
聊天里随手练,不算掌握度、不进学情(算进去会变成刷分入口)。只进小鹰老师自己的笔记。
"""
from __future__ import annotations

import random
import re
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.tutor import TutorQuiz

MAX_ITEMS = 5
Q_MAX = 120
OPT_MAX = 40
EXPLAIN_MAX = 80
ORDER_MAX_TOKENS = 14
BLANK = "___"
KINDS = ("choice", "fill", "order")


# ---------------------------------------------------------------- 判分口径

def norm(s: Any) -> str:
    s = str(s or "").strip().lower().replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .!?。！？,，;；\"'")


def _words(s: str) -> list[str]:
    return [w for w in (re.sub(r"[^\w'’\- ]+", " ", s or "").replace("’", "'").lower().split()) if w]


def _order_tokens(sentence: str) -> list[str]:
    """拆成词: 去掉标点;句首词改小写(I 和句中本来就大写的专有名词保留)"""
    toks = re.sub(r"[^\w'’\- ]+", " ", sentence or "").replace("’", "'").split()
    out = []
    for i, t in enumerate(toks):
        if i == 0 and t != "I" and not (len(t) > 1 and t[1:].lower() != t[1:]):
            t = t[0].lower() + t[1:]
        out.append(t)
    return out


# ---------------------------------------------------------------- 模型出的题 → 存库的(带答案)+ 发给孩子的(不带)

def _clip(s: Any, n: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:n]


def _choice_index(ans: Any, options: list[str]) -> Optional[int]:
    if isinstance(ans, bool):
        return None
    if isinstance(ans, int):
        return ans if 0 <= ans < len(options) else None
    a = str(ans or "").strip()
    if len(a) == 1 and a.upper() in "ABCD" and "ABCD".index(a.upper()) < len(options):
        return "ABCD".index(a.upper())
    for i, o in enumerate(options):
        if norm(o) == norm(a):
            return i
    return None


def build_items(raw_items: Any, seed: int) -> tuple[list[dict], list[dict], list[str]]:
    """(存库的题, 发给孩子的题, 丢掉的原因)。不合格的题丢掉并说明原因(回给模型,它可以重出)"""
    full: list[dict] = []
    public: list[dict] = []
    problems: list[str] = []
    rng = random.Random(seed)
    for n, it in enumerate((raw_items or [])[:MAX_ITEMS * 2] if isinstance(raw_items, list) else [], 1):
        if not isinstance(it, dict):
            problems.append(f"第 {n} 题格式不对")
            continue
        kind = str(it.get("type") or "").strip()
        q = _clip(it.get("question"), Q_MAX)
        explain = _clip(it.get("explain"), EXPLAIN_MAX) or None
        if kind == "choice":
            opts = [_clip(o, OPT_MAX) for o in (it.get("options") or []) if _clip(o, OPT_MAX)]
            if not q or not 2 <= len(opts) <= 4 or len({norm(o) for o in opts}) != len(opts):
                problems.append(f"第 {n} 题: 选择题要有题目和 2–4 个不一样的选项")
                continue
            idx = _choice_index(it.get("answer"), opts)
            if idx is None:
                problems.append(f"第 {n} 题: answer 要是选项之一")
                continue
            full.append({"type": "choice", "question": q, "options": opts, "answer": idx, "explain": explain})
            public.append({"type": "choice", "question": q, "options": opts})
        elif kind == "fill":
            q = re.sub(r"_{2,}", BLANK, q)
            ans = _clip(it.get("answer"), OPT_MAX)
            if q.count(BLANK) != 1 or not ans:
                problems.append(f"第 {n} 题: 填空题题目里要有且只有一个 ___,并给出 answer")
                continue
            also = [_clip(a, OPT_MAX) for a in (it.get("also") or []) if isinstance(a, str) and _clip(a, OPT_MAX)][:4]
            full.append({"type": "fill", "question": q, "answer": ans, "also": also, "explain": explain})
            public.append({"type": "fill", "question": q})
        elif kind == "order":
            sentence = _clip(it.get("answer") or it.get("sentence"), Q_MAX)
            toks = _order_tokens(sentence)
            if not 3 <= len(toks) <= ORDER_MAX_TOKENS:
                problems.append(f"第 {n} 题: 连词成句的 answer 是正确的整句,3–{ORDER_MAX_TOKENS} 个词")
                continue
            shuffled = toks[:]
            for _ in range(5):
                rng.shuffle(shuffled)
                if shuffled != toks:
                    break
            full.append({"type": "order", "question": q or "把下面的词排成一句话", "answer": sentence,
                         "tokens": toks, "explain": explain})
            public.append({"type": "order", "question": q or "把下面的词排成一句话", "tokens": shuffled})
        else:
            problems.append(f"第 {n} 题: type 只能是 choice / fill / order")
            continue
        if len(full) >= MAX_ITEMS:
            break
    return full, public, problems


def grade_one(item: dict, ans: Any) -> dict:
    kind = item["type"]
    if kind == "word":
        ok = norm(ans) == norm(item["word"])
        return {"ok": ok, "your": _clip(ans, OPT_MAX), "answer": item["word"]}
    if kind == "choice":
        idx = _choice_index(ans, item["options"]) if ans not in (None, "") else None
        return {"ok": idx == item["answer"], "your": item["options"][idx] if idx is not None else "",
                "answer": item["options"][item["answer"]], "explain": item.get("explain")}
    if kind == "fill":
        ok = norm(ans) != "" and norm(ans) in {norm(a) for a in [item["answer"], *item.get("also", [])]}
        return {"ok": ok, "your": _clip(ans, OPT_MAX), "answer": item["answer"], "explain": item.get("explain")}
    # order
    ok = _words(str(ans or "")) == _words(item["answer"])
    return {"ok": ok, "your": _clip(ans, Q_MAX), "answer": item["answer"], "explain": item.get("explain")}


def grade(items: list[dict], answers: Any) -> tuple[list[dict], int]:
    answers = answers if isinstance(answers, list) else []
    results = [grade_one(it, answers[i] if i < len(answers) else "") for i, it in enumerate(items)]
    return results, sum(1 for r in results if r["ok"])


# ---------------------------------------------------------------- 存 / 交

async def create(db: AsyncSession, user_id: int, ctx: Optional[dict], items: list[dict], topic: Optional[str]) -> TutorQuiz:
    ctx = ctx or {}
    q = TutorQuiz(user_id=user_id, conversation_id=ctx.get("conversation_id"), topic=(topic or "")[:40] or None,
                  items=items, total=len(items), free_feedback=not ctx.get("is_feedback"), created_at=utc_now())
    db.add(q)
    await db.flush()
    return q


async def tool_make_quiz(db: AsyncSession, user_id: int, ctx: Optional[dict], inp: dict) -> tuple[dict, Optional[dict]]:
    full, public, problems = build_items(inp.get("items"), seed=user_id * 7919 + int(utc_now().timestamp()))
    if not full:
        return {"ok": False, "reason": "题目都不合格: " + ";".join(problems[:3])}, None
    topic = _clip(inp.get("topic"), 40) or None
    q = await create(db, user_id, ctx, full, topic)
    await db.commit()
    card = {"type": "quiz", "quiz_id": q.id, "topic": topic, "items": public}
    return {"ok": True, "count": len(full), "dropped": problems,
            "note": "题目已经显示在你的回答下面,孩子做完会把结果发给你。回答里不要写出答案,一句话让他在下面做"}, card


async def practice_card(db: AsyncSession, user_id: int, ctx: Optional[dict], mode: str, words: list[dict]) -> dict:
    """单词卡(make_practice): words = [{word_id, word, meaning, phonetic}]。卡片里不带拼写"""
    full = [{"type": "word", "word": w["word"], "word_id": w["word_id"], "meaning": w.get("meaning")} for w in words]
    q = await create(db, user_id, ctx, full, None)
    await db.commit()
    return {"type": "practice", "mode": mode, "quiz_id": q.id,
            # 不带拼写也不带音标(音标几乎就是答案),听发音用 word_id 去取
            "items": [{"word_id": w["word_id"], "meaning": w.get("meaning"), "letters": len(w["word"])} for w in words]}


async def _record_notes(db: AsyncSession, quiz: TutorQuiz, results: list[dict]) -> None:
    from app.services import tutor_notes

    if quiz.items and quiz.items[0].get("type") == "word":
        for it, r in zip(quiz.items, results):
            if r["ok"]:
                await tutor_notes.record(db, quiz.user_id, it["word"], "right", kind="word")
            elif r["your"]:
                await tutor_notes.record(db, quiz.user_id, it["word"], "wrong", kind="word",
                                         detail=f"写成了 {r['your']}")
            else:
                await tutor_notes.record(db, quiz.user_id, it["word"], "wrong", kind="word", detail="没写出来")
        return
    if not quiz.topic:
        return
    wrong = [(i, r) for i, r in enumerate(results) if not r["ok"]]
    if not wrong:
        await tutor_notes.record(db, quiz.user_id, quiz.topic, "right")
    else:
        i, r = wrong[0]
        await tutor_notes.record(db, quiz.user_id, quiz.topic, "wrong",
                                 detail=f"「{quiz.items[i]['question'][:40]}」答成 {r['your'] or '没答'}")


class QuizNotFound(Exception):
    pass


async def submit(db: AsyncSession, user_id: int, quiz_id: int, answers: Any) -> dict:
    q = await db.get(TutorQuiz, quiz_id)
    if q is None or q.user_id != user_id:
        raise QuizNotFound()
    results, score = grade(q.items, answers)
    first = q.submitted_at is None
    if first:
        # 第一次交的才算(刷新后显示、记笔记、发给小鹰老师点评)。两个请求同时到: 只认先写进去的那个
        r = await db.execute(update(TutorQuiz).where(TutorQuiz.id == q.id, TutorQuiz.submitted_at.is_(None))
                             .values(answers=answers if isinstance(answers, list) else [], results=results,
                                     score=score, submitted_at=utc_now())
                             .execution_options(synchronize_session=False))
        first = r.rowcount == 1
        if first:
            await _record_notes(db, q, results)
        await db.commit()
    await db.refresh(q)
    # free: 点评这份不扣次数(前端只有 free 或还在免费追问时间里才自动请点评,要扣次数的让孩子自己点)
    return {"quiz_id": q.id, "results": results, "score": score, "total": q.total, "first": first,
            "feedback": first and q.feedback_at is None, "free": bool(q.free_feedback)}


async def claim_feedback(db: AsyncSession, user_id: int, quiz_id: int) -> Optional[TutorQuiz]:
    """点评认领: 交过了、还没点评过的才行(一份练习只点评一次)。不 commit"""
    r = await db.execute(update(TutorQuiz).where(TutorQuiz.id == quiz_id, TutorQuiz.user_id == user_id,
                                                 TutorQuiz.submitted_at.isnot(None), TutorQuiz.feedback_at.is_(None))
                         .values(feedback_at=utc_now()).execution_options(synchronize_session=False))
    if r.rowcount != 1:
        return None
    return (await db.execute(select(TutorQuiz).where(TutorQuiz.id == quiz_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def release_feedback(db: AsyncSession, quiz_id: int) -> None:
    """点评没调通(退回了): 放回去,孩子可以再点一次"""
    await db.execute(update(TutorQuiz).where(TutorQuiz.id == quiz_id).values(feedback_at=None)
                     .execution_options(synchronize_session=False))
    await db.commit()


def feedback_prompt(q: TutorQuiz) -> str:
    """发给小鹰老师的那段(孩子看到的只是「我做完了,对了 2/3」)"""
    lines = [f"[系统] 孩子做完了你出的练习{('(考: ' + q.topic + ')') if q.topic else ''},对了 {q.score}/{q.total}:"]
    for i, (it, r) in enumerate(zip(q.items, q.results or []), 1):
        mark = "对" if r["ok"] else "错"
        if it["type"] == "word":
            lines.append(f"{i}. 单词 {it['word']}({it.get('meaning') or ''}) 他写: {r['your'] or '没写'} —— {mark}")
        else:
            lines.append(f"{i}. {it['question']} 他答: {r['your'] or '没答'};正确: {r['answer']} —— {mark}")
    lines.append("请点评: 先说对了几题、具体夸做对的;错的指出错在哪、为什么,给一句好记的方法;"
                 "全对就问他要不要加一点难度;还没会的点用 save_note(stuck)记下。不要把整张卷子重复一遍,不超过 120 字。")
    return "\n".join(lines)


def feedback_display(q: TutorQuiz) -> str:
    return f"我做完了,对了 {q.score}/{q.total}"


async def attach(db: AsyncSession, msgs: list[dict], teacher: bool = False) -> list[dict]:
    """对话里的练习卡: 交过的带上第一次的作答和结果(刷新后照样显示);老师看的另外带上答案"""
    ids = {c["quiz_id"] for m in msgs for c in m["cards"] if c.get("quiz_id")}
    if not ids:
        return msgs
    qs = {q.id: q for q in (await db.execute(select(TutorQuiz).where(TutorQuiz.id.in_(ids)))).scalars()}
    for m in msgs:
        cards = []
        for c in m["cards"]:
            q = qs.get(c.get("quiz_id")) if c.get("quiz_id") else None
            if q is not None:
                c = dict(c)
                if q.submitted_at is not None:
                    c["result"] = {"answers": q.answers or [], "results": q.results or [], "score": q.score,
                                   "total": q.total, "feedback_done": q.feedback_at is not None,
                                   "free": bool(q.free_feedback)}
                if teacher:
                    c["key"] = [it.get("word") if it["type"] == "word"
                                else (it["options"][it["answer"]] if it["type"] == "choice" else it["answer"])
                                for it in q.items]
            cards.append(c)
        m["cards"] = cards
    return msgs
