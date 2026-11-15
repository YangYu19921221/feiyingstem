"""句子积木的题: 写法、发给孩子的样子、判分(唯一真源)

七种题,都是点一点,不用打字:
- pick   选一块放进空格            - hear   听一句,选是哪张图
- tap    点出某一块(变了的 / 多余的 / 要搬到最前面的)
- gap    点一个空隙,把一块插进去     - order  把几块排成一句(可以混进用不上的块)
- sort   一块一块分到两个筐里(一块算一步)
- fix    小鹰同学拼错了: 先点出错的那块,再挑一块换上(两步)

**答案只在服务器**: public() 发下去的没有答案;孩子每点一下交一次,grade() 判。
连错两次(或回头考答错)才把答案给页面(show),做完才给整句(reveal)。
每个错的选项可以挂一种「错法」(wrong / code),判错时回这一种错法的讲解,不是把原话重说一遍。

选项的顺序按题目的 key 定死(同一道题每次一样、不同的题不一样),正确答案不会总在同一个位置。
"""
from __future__ import annotations

import random
import re
from typing import Any, Optional

from app.grammar import blocks as B

# 每种题默认说的那句话(写课时可以换)
PROMPTS = {
    "pick": "选一块,放进空格里。",
    "hear": "听一听,说的是哪一个?",
    "tap.odd": "下面这句,哪一块变了?点一下。",
    "tap.extra": "这句多了一块。点出多余的那一块。",
    "tap.front": "要问一问,哪一块搬到最前面?",
    "gap": "这一块该放在哪儿?点一下空隙。",
    "order": "把积木排成一句话。",
    "sort": "它该去哪一边?",
    "fix": "小鹰同学拼了一句,有一块不对。帮它点出来。",
    "fix.1": "换成哪一块?",
}
# 没挂具体错法时说的
HINTS = {
    "pick": "不是这一块,再看看。",
    "hear": "再听一遍。",
    "tap": "不是这一块,再找找。",
    "gap": "不是这里,换一个空隙试试。",
    "order": "顺序不对。听一遍,再排排看。",
    "sort": "不对,它是另一边的。",
    "fix": "这一块没问题。看看「谁」和它后面那一块,对不对得上。",
}
PRAISE = ["对啦!", "真棒!", "没错!", "就是这样!", "谢谢你,我会了!"]


def _order(key: str, n: int) -> list[int]:
    idx = list(range(n))
    random.Random(key).shuffle(idx)
    if n > 1 and idx == list(range(n)):     # 洗完还是原样的,挪一下,别让答案总在写课时的位置
        idx = idx[1:] + idx[:1]
    return idx


def _base(typ: str, level: int, prompt: Optional[str], scene, zh, links: bool) -> dict:
    return {"key": "", "type": typ, "level": level, "prompt": prompt, "scene": scene, "zh": zh, "links": links}


# ---------- 写课用的七个函数 ----------

def pick(rows: str | list[str], options: list[str], answer: str, *, zh: str | None = None,
         scene: str | None = None, wrong: dict[str, str] | None = None, links: bool = True, level: int = 2,
         prompt: str | None = None, role: str | None = None) -> dict:
    rows = [rows] if isinstance(rows, str) else list(rows)
    assert sum(r.count("___") for r in rows) == 1, f"要正好一个空: {rows}"
    assert answer in options, f"答案不在选项里: {answer} / {options}"
    it = _base("pick", level, prompt, scene, zh, links)
    it.update(rows=rows, options=options, answer=answer, wrong=wrong or {}, role=role)
    return it


def hear(text: str, cards: list[tuple[str, str]], answer: int = 0, *, level: int = 1,
         prompt: str | None = None) -> dict:
    it = _base("hear", level, prompt, None, None, False)
    it.update(text=text, cards=cards, answer=answer)
    return it


def tap(rows: str | list[str], target: str | tuple[int, str], *, ask: str = "odd", after: list[str] | None = None,
        hint: str | None = None, links: bool = True, level: int = 1, prompt: str | None = None,
        scene: str | None = None, zh: str | None = None) -> dict:
    rows = [rows] if isinstance(rows, str) else list(rows)
    r, bid = (len(rows) - 1, target) if isinstance(target, str) else target
    it = _base("tap", level, prompt, scene, zh, links)
    it.update(rows=rows, target=(r, bid), ask=ask, after=after, hint=hint)
    return it


def gap(row: str, insert: str, *, before: str | None = None, after_block: str | None = None,
        result: str | None = None, hint: str | None = None, links: bool = True, level: int = 3,
        prompt: str | None = None, scene: str | None = None, zh: str | None = None) -> dict:
    assert (before is None) != (after_block is None), f"before / after_block 写一个: {row}"
    it = _base("gap", level, prompt, scene, zh, links)
    it.update(row=row, insert=insert, before=before, after_block=after_block, result=result, hint=hint)
    return it


def order(answer: str, *, extra: list[str] | None = None, accept: list[str] | None = None,
          wrong_extra: str | None = None, links: bool = False, level: int = 5, prompt: str | None = None,
          scene: str | None = None, zh: str | None = None) -> dict:
    it = _base("order", level, prompt, scene, zh, links)
    it.update(answer=answer, extra=extra or [], accept=accept or [], wrong_extra=wrong_extra)
    return it


def sort(bins: list[tuple[str, str | None, str | None]], items: list[tuple], *, level: int = 1,
         prompt: str | None = None, role: str | None = None) -> dict:
    """bins: [(大字, 小字, 形状)];items: [(积木, 第几个筐)] 或 [(积木, 第几个筐, 错法)]"""
    assert len(bins) == 2, "现在只做两个筐"
    it = _base("sort", level, prompt, None, None, True)
    it.update(bins=bins, items=[(i + (None,))[:3] for i in items], role=role)
    return it


def fix(row: str, bad: str, options: list[str], answer: str, *, wrong: dict[str, str] | None = None,
        hint: str | None = None, links: bool = False, level: int = 4, prompt: str | None = None,
        scene: str | None = None, zh: str | None = None, role: str | None = None) -> dict:
    assert answer in options, f"答案不在选项里: {answer} / {options}"
    it = _base("fix", level, prompt, scene, zh, links)
    it.update(row=row, bad=bad, options=options, answer=answer, wrong=wrong or {}, hint=hint, role=role)
    return it


# ---------- 内部: 把写法算成积木 ----------

def _opt_tokens(options: list[str]) -> list[str]:
    return [o.replace("_", " ") for o in options]


def _pick_mode(it: dict) -> Optional[str]:
    blocks = [b for r in it["rows"] for b in B.parse(r)]
    return B.detect_mode(blocks, tuple(_opt_tokens(it["options"])))


def _find(blocks: list[dict], bid: str) -> int:
    """按积木的名字(原形)或上面的字找它是第几块"""
    for i, b in enumerate(blocks):
        if b["id"] == bid or b["t"] == bid.replace("_", " "):
            return i
    raise ValueError(f"找不到积木 {bid}: {[b['t'] for b in blocks]}")


def _with_audio(blocks: list[dict]) -> list[dict]:
    """每块带上它的读音文件名(孩子点一下能听)。标点、空格、故意写错的不配"""
    for b in blocks:
        if b.get("slot") or b["r"] == "x" or b["t"].lower() in B.FAKE_FORMS:
            continue
        b["a"] = B.en_key(b["t"])
    return blocks


def _rows(rows: list[str], mode: Optional[str], links: bool) -> list[list[dict]]:
    return [_with_audio(B.row(r, mode, links)) for r in rows]


def _gap_index(it: dict) -> int:
    blocks = B.parse(it["row"])
    if it["before"] is not None:
        return _find(blocks, it["before"])
    return _find(blocks, it["after_block"]) + 1


def _gap_result(it: dict) -> str:
    if it["result"]:
        return it["result"]
    toks = it["row"].split()
    toks.insert(_gap_index(it), it["insert"])
    return " ".join(toks)


def _order_pool(it: dict) -> list[dict]:
    """排句子用的那一堆积木(已经洗过)。形状照正确的那句算"""
    mode = B.detect_mode(B.parse(it["answer"]))
    blocks = B.row(it["answer"], mode, it["links"])
    extras = B.option_blocks(_opt_tokens(it["extra"]), mode, it["links"])
    pool = blocks + extras
    out = []
    for n, i in enumerate(_order(it["key"], len(pool))):
        b = dict(pool[i])
        b["id"] = f"p{n}"
        out.append(b)
    return _with_audio(out)


def _fix_fixed(it: dict) -> str:
    toks = it["row"].split()
    i = _find(B.parse(it["row"]), it["bad"])
    toks[i] = it["answer"]
    return " ".join(toks)


def parts(it: dict) -> int:
    if it["type"] == "sort":
        return len(it["items"])
    return 2 if it["type"] == "fix" else 1


def _sort_order(it: dict) -> list[int]:
    return _order(it["key"], len(it["items"]))


def _pick_side(it: dict) -> str:
    row = next(r for r in it["rows"] if "___" in r)
    return B.slot_side(B.parse(row))


def _option_view(it: dict) -> list[dict]:
    mode = _pick_mode(it) if it["type"] == "pick" else B.detect_mode(B.parse(_fix_fixed(it)))
    side = _pick_side(it) if it["type"] == "pick" else "l"
    role = it.get("role")
    if role is None:
        # 空格是什么颜色,挑的那几块就是什么颜色(故意写错的词自己认不出颜色)
        src = next(r for r in it["rows"] if "___" in r) if it["type"] == "pick" else None
        if src:
            role = next(b["r"] for b in B.parse(src) if b.get("slot"))
        else:
            role = B.parse(it["row"])[_find(B.parse(it["row"]), it["bad"])]["r"]
    opts = B.option_blocks(_opt_tokens(it["options"]), mode, it["links"], side, role)
    order_ = _order(it["key"], len(opts))
    return _with_audio([opts[i] for i in order_])


def _option_text(it: dict, shown_index: int) -> Optional[str]:
    order_ = _order(it["key"], len(it["options"]))
    if not isinstance(shown_index, int) or not 0 <= shown_index < len(order_):
        return None
    return it["options"][order_[shown_index]]


def _answer_shown_index(it: dict) -> int:
    order_ = _order(it["key"], len(it["options"]))
    return order_.index(it["options"].index(it["answer"]))


# ---------- 发给孩子的样子(没有答案) ----------

def default_prompt(it: dict) -> str:
    if it["prompt"]:
        return it["prompt"]
    if it["type"] == "tap":
        return PROMPTS[f"tap.{it['ask']}"]
    return PROMPTS[it["type"]]


def public(it: dict) -> dict:
    t = it["type"]
    out: dict[str, Any] = {"key": it["key"], "type": t, "level": it["level"], "parts": parts(it),
                           "prompt": B.say(default_prompt(it)), "scene": it["scene"], "zh": it["zh"]}
    if t == "pick":
        out["rows"] = _rows(it["rows"], _pick_mode(it), it["links"])
        out["options"] = _option_view(it)
    elif t == "hear":
        out["audio"] = B.en_audio(B.sentence(it["text"]))
        order_ = _order(it["key"], len(it["cards"]))
        out["cards"] = [{"emoji": it["cards"][i][0], "zh": it["cards"][i][1]} for i in order_]
    elif t == "tap":
        out["rows"] = _rows(it["rows"], None, it["links"])
        out["ask"] = it["ask"]
    elif t == "gap":
        out["rows"] = _rows([it["row"]], None, it["links"])
        out["insert"] = _with_audio(B.option_blocks([it["insert"].replace("_", " ")], None, False))[0]
    elif t == "order":
        out["pool"] = _order_pool(it)
    elif t == "sort":
        out["bins"] = [{"label": b[0], "sub": b[1], "k": b[2]} for b in it["bins"]]
        texts = [it["items"][i][0] for i in _sort_order(it)]
        out["items"] = _with_audio([_one_block(x, n, it.get("role")) for n, x in enumerate(texts)])
    elif t == "fix":
        out["rows"] = _rows([it["row"]], None, it["links"])
    return out


def _one_block(text: str, n: int, role: Optional[str]) -> dict:
    b = B.parse(text if role is None else f"{text}/{role}")[0]
    b["id"] = f"s{n}"
    return b


def next_part(it: dict, part: int) -> Optional[dict]:
    """做完第 part 步以后,下一步要用到的东西(只有 fix 的第二步要等第一步对了才给选项)"""
    if it["type"] == "fix" and part == 0:
        return {"options": _option_view(it), "prompt": B.say(PROMPTS["fix.1"])}
    return None


# ---------- 判分 ----------

def grade(it: dict, part: int, answer: Any) -> tuple[bool, Optional[str]]:
    """→ (对不对, 错法)。错法是这节课 misc 里的名字,没有挂的回 None"""
    t = it["type"]
    if t == "pick" or (t == "fix" and part == 1):
        chosen = _option_text(it, answer)
        if chosen is None:
            return False, None
        return chosen == it["answer"], it["wrong"].get(chosen)
    if t == "hear":
        order_ = _order(it["key"], len(it["cards"]))
        ok = isinstance(answer, int) and 0 <= answer < len(order_) and order_[answer] == it["answer"]
        return ok, None
    if t == "tap":
        r, bid = it["target"]
        want = (r, _find(B.parse(it["rows"][r]), bid))
        return _pos(answer) == want, None
    if t == "fix":
        want = (0, _find(B.parse(it["row"]), it["bad"]))
        return _pos(answer) == want, None
    if t == "gap":
        return answer == _gap_index(it), None
    if t == "order":
        pool = _order_pool(it)
        if not isinstance(answer, list) or len(set(map(str, answer))) != len(answer):
            return False, None
        try:
            got = [pool[int(i)]["t"] for i in answer]
        except (ValueError, IndexError, TypeError):
            return False, None
        good = [[b["t"] for b in B.parse(a)] for a in [it["answer"], *it["accept"]]]
        if got in good:
            return True, None
        used_extra = any(x in got for x in _opt_tokens(it["extra"]))
        return False, (it["wrong_extra"] if used_extra else None)
    if t == "sort":
        order_ = _sort_order(it)
        if not 0 <= part < len(order_):
            return False, None
        _, want, code = it["items"][order_[part]]
        return answer == want, code
    return False, None


def _pos(answer: Any) -> Optional[tuple[int, int]]:
    try:
        return int(answer["r"]), int(answer["i"])
    except (TypeError, KeyError, ValueError):
        return None


def show(it: dict, part: int) -> Any:
    """这一步的正确答案(和孩子交上来的同一种格式)。只在该给的时候给"""
    t = it["type"]
    if t == "pick" or (t == "fix" and part == 1):
        return _answer_shown_index(it)
    if t == "hear":
        return _order(it["key"], len(it["cards"])).index(it["answer"])
    if t == "tap":
        r, bid = it["target"]
        return {"r": r, "i": _find(B.parse(it["rows"][r]), bid)}
    if t == "fix":
        return {"r": 0, "i": _find(B.parse(it["row"]), it["bad"])}
    if t == "gap":
        return _gap_index(it)
    if t == "order":
        pool = _order_pool(it)
        want = [b["t"] for b in B.parse(it["answer"])]
        used: set[int] = set()
        seq = []
        for w in want:
            i = next(i for i, b in enumerate(pool) if b["t"] == w and i not in used)
            used.add(i)
            seq.append(i)
        return seq
    if t == "sort":
        return it["items"][_sort_order(it)[part]][1]
    return None


def hint_text(it: dict, part: int, code: Optional[str], misc: dict[str, str]) -> str:
    """判错时说哪句: 先看这个选项挂的错法,再看这道题自己写的,最后是这种题通用的那句"""
    if code and code in misc:
        return misc[code]
    if it.get("hint") and not (it["type"] == "fix" and part == 1):
        return it["hint"]
    return HINTS[it["type"]]


def final_rows(it: dict) -> list[str]:
    """做完以后摆出来的整句(写法)"""
    t = it["type"]
    if t == "pick":
        return [re.sub(r"___(/\w)?", it["answer"], r) for r in it["rows"]]
    if t == "hear":
        return [it["text"]]
    if t == "tap":
        return it["after"] or it["rows"]
    if t == "gap":
        return [_gap_result(it)]
    if t == "order":
        return [it["answer"]]
    if t == "fix":
        return [_fix_fixed(it)]
    return []


def reveal(it: dict) -> Optional[dict]:
    """做完以后给页面的: 整句的积木(形状都画上)+ 读整句的声音"""
    rows = final_rows(it)
    if not rows:
        return None
    text = " ".join(B.sentence(r) for r in rows)
    return {"rows": [_with_audio(B.row(r)) for r in rows], "en": text, "audio": B.en_audio(text)}


# ---------- 给出音频的脚本和测试用: 这道题会用到哪些声音 ----------

def say_lines(it: dict) -> set[str]:
    out = {default_prompt(it)}
    if it.get("hint"):
        out.add(it["hint"])
    if it["type"] == "fix":
        out.add(PROMPTS["fix.1"])
    return out


def en_lines(it: dict) -> set[str]:
    """整句(做完读的、听句选图的)和每一块的读音"""
    out: set[str] = set()
    rv = reveal(it)
    if rv:
        out.add(rv["en"])
        out |= {b["t"] for r in rv["rows"] for b in r if b.get("a")}
    pub = public(it)
    for r in pub.get("rows", []):
        out |= {b["t"] for b in r if b.get("a")}
    for name in ("options", "pool", "items"):
        out |= {b["t"] for b in pub.get(name, []) if b.get("a")}
    if pub.get("insert", {}).get("a"):
        out.add(pub["insert"]["t"])
    if it["type"] == "fix":
        out |= {b["t"] for b in _option_view(it) if b.get("a")}
    if it["type"] == "hear":
        out.add(B.sentence(it["text"]))
    return out


def words(it: dict) -> set[str]:
    """这道题里出现的英文词(小写),核对课本词表用。故意写错的不算"""
    texts: set[str] = set()
    for r in final_rows(it):
        texts |= {b["t"] for b in B.parse(r)}
    for name in ("options", "extra"):
        texts |= set(_opt_tokens(it.get(name, [])))
    if it["type"] == "sort":
        texts |= {x[0].replace("_", " ") for x in it["items"]}
    out: set[str] = set()
    for t in texts:
        for w in t.replace("|", "").split():
            w = w.strip(".,?!").lower()
            if w and w not in B.FAKE_FORMS:
                out.add(w)
    return out
