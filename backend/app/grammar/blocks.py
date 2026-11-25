"""句子积木: 把一句话写成一排积木(写法、颜色、形状的唯一真源)

写课的人这样写一行: "He likes apples ."
- 空格分块;一块里有空格写下划线: my_dad、a_cat、at_home
- ___ 是要孩子填的空;后面可以写它是什么颜色的空: ___/w(默认是蓝色「干什么」那一格)
- 颜色(角色)自动认,认不准的在后面写 /角色: at_home/p、it/o
  一排里只有第一个「谁」是橙色: 后面再出现的人名(I am Amy / Are you Mike?)说的是「是什么」,自动算绿色
    w 谁(橙)  d 是 / 干什么(蓝)  o 什么 / 怎么样(绿)  p 哪里 / 什么时候(黄)
    h 小帮手 do does not(紫)  n 其它小词(灰)  x 标点
- 词尾要单独上色的写竖线: The_cat|s(「猫」后面多出来的 s)。动作词的尾巴(likes / goes / studies)自动拆,不用写
- #id 指定「动画里是同一块」: 默认按词的原形算(am / is / are 是同一块,like / likes 是同一块)

形状(接口)—— 规则做成看得见的样子:
- 「谁」那块朝着后面的词伸出一个头: I 圆的,他 / 她 / 它 / 一个人 / 一个东西 尖的,你 / 我们 / 他们 / 很多个 方的
- am 圆口,is 尖口,are 方口;动作词带尾巴(likes)是尖口,不带尾巴的没有口;does / doesn't 尖口
  所以「尖的都带 s」: is、likes、has、does
- 说「是什么」的句子(be)三种形状都画;说「做什么」的句子(do)只画尖的 —— 那里只有「他她它」特别
- 问句里 is / does 站在「谁」前面,头和口自动换到另一边
"""
from __future__ import annotations

import hashlib
import re
from typing import Optional

# 原形 → 第三人称单数。只收课里用得到的;没收的词当普通词(绿色),写课时会被 check 拦下
VERBS: dict[str, str] = {
    "like": "likes", "play": "plays", "eat": "eats", "drink": "drinks", "read": "reads", "go": "goes",
    "watch": "watches", "wash": "washes", "study": "studies", "have": "has", "love": "loves", "want": "wants",
    "live": "lives", "get": "gets", "run": "runs", "swim": "swims", "sing": "sings", "draw": "draws",
    "fly": "flies", "see": "sees", "help": "helps", "make": "makes", "come": "comes", "walk": "walks",
    "cook": "cooks", "teach": "teaches", "brush": "brushes", "carry": "carries", "cry": "cries",
    "say": "says", "buy": "buys", "ride": "rides", "sleep": "sleeps", "need": "needs", "know": "knows",
    "work": "works", "dance": "dances", "jump": "jumps", "open": "opens", "clean": "cleans",
}
S_FORMS: dict[str, str] = {v: k for k, v in VERBS.items()}

BE = {"am": "c", "is": "t", "are": "s", "isn't": "t", "aren't": "s"}
AUX = {"do": None, "don't": None, "does": "t", "doesn't": "t", "not": None}

# 「谁」是哪一类: c = 我,t = 他她它 / 一个,s = 你 / 很多个
SUBJECTS: dict[str, str] = {
    "i": "c",
    "you": "s", "we": "s", "they": "s",
    "he": "t", "she": "t", "it": "t",
    "amy": "t", "mike": "t", "sarah": "t", "john": "t", "tom": "t", "lily": "t",
    "my dad": "t", "my mum": "t", "my friend": "t", "my teacher": "t", "my brother": "t", "my sister": "t",
    "the cat": "t", "the dog": "t", "the bird": "t", "the boy": "t", "the girl": "t", "my cat": "t", "my dog": "t",
    "the cats": "s", "the dogs": "s", "the birds": "s", "the boys": "s", "the girls": "s",
    "my friends": "s", "my mum and dad": "s", "amy and mike": "s", "tom and lily": "s",
}

# 故意写错的样子(给孩子挑的干扰项)。它们不是词,不配发音,也不参加课本词表核对
FAKE_FORMS = {"gos", "studys", "studyes", "plaies", "haves", "watchs", "flys", "flyes", "washs", "drinkes"}

PUNCT = {".": "end", "?": "end", "!": "end", ",": "comma"}
ROLES = ("w", "d", "o", "p", "h", "n", "x")
PLAIN = {"yes", "no"}


def _lemma(text: str) -> str:
    """动画里认「同一块」用的名字"""
    low = text.lower()
    if text in PUNCT:
        return PUNCT[text]
    if low in BE:
        return "be"
    if low in AUX and low != "not":
        return "do"
    if low in S_FORMS:
        return S_FORMS[low]
    return low


def _auto_role(text: str) -> str:
    low = text.lower()
    if text in PUNCT:
        return "x"
    if low in BE:
        return "d"
    if low in AUX:
        return "h"
    if low in SUBJECTS:
        return "w"
    if low in VERBS or low in S_FORMS:
        return "d"
    if low in PLAIN:
        return "n"
    return "o"


def _own_link(text: str, role: str) -> Optional[str]:
    """这一块自己是什么形状(和句子无关): 「谁」看它是哪一类,动词看它的样子"""
    low = text.lower()
    if role == "w":
        return SUBJECTS.get(low)
    if low in BE:
        return BE[low]
    if low in AUX:
        return AUX[low]
    if low in S_FORMS:
        return "t"
    return None


def _segs(text: str, manual_tail: Optional[str]) -> Optional[list[list[str]]]:
    """一块里要分开上色的几段: [文字, 种类],种类 tail = 尾巴,neg = 否定。不用分的回 None"""
    if manual_tail is not None:
        return [[text[: len(text) - len(manual_tail)], ""], [manual_tail, "tail"]]
    low = text.lower()
    if low in ("doesn't",):
        return [[text[:2], ""], [text[2:4], "tail"], [text[4:], "neg"]]
    if low == "does":
        return [[text[:2], ""], [text[2:], "tail"]]
    if low in ("don't", "isn't", "aren't"):
        return [[text[:-3], ""], [text[-3:], "neg"]]
    if low == "not":
        return [[text, "neg"]]
    if low in S_FORMS:
        base = S_FORMS[low]
        n = 0
        while n < min(len(base), len(low)) and base[n] == low[n]:
            n += 1
        return [[text[:n], ""], [text[n:], "tail"]]
    return None


def parse(text: str) -> list[dict]:
    """一行写法 → 一排积木(还没算形状)"""
    out: list[dict] = []
    seen: dict[str, int] = {}
    has_subject = False
    for raw in text.split():
        tok, _, bid = raw.partition("#")
        bid = bid or None
        role = None
        if "/" in tok and not tok.startswith("/"):
            tok, role = tok.rsplit("/", 1)
            if role not in ROLES:
                raise ValueError(f"不认识的角色 /{role}: {raw}")
        if tok == "___":
            blk = {"id": bid or "slot", "t": "", "r": role or "d", "slot": True}
        else:
            manual_tail = None
            if "|" in tok:
                tok, manual_tail = tok.split("|", 1)
                tok = tok + manual_tail
            shown = tok.replace("_", " ")
            r = role or _auto_role(shown)
            if r == "w":
                # 一排里只有第一个「谁」是橙色。后面自动认出来的人名(I am Amy)说的是「是什么」→ 绿色
                if has_subject and role is None:
                    r = "o"
                has_subject = True
            blk = {"id": bid or _lemma(shown), "t": shown, "r": r}
            segs = _segs(shown, manual_tail)
            if segs:
                blk["segs"] = segs
        n = seen.get(blk["id"], 0) + 1
        seen[blk["id"]] = n
        if n > 1:
            blk["id"] = f"{blk['id']}~{n}"
        out.append(blk)
    return out


def detect_mode(blocks: list[dict], extra: tuple[str, ...] = ()) -> Optional[str]:
    """这一句是说「是什么」(be)还是「做什么」(do)。两样都有(I am like)算 do: 那里只有尖角说了算"""
    words = [b["t"].lower() for b in blocks if not b.get("slot")] + [e.lower() for e in extra]
    has_be = any(w in BE for w in words)
    has_do = any((w in AUX and w != "not") or w in VERBS or w in S_FORMS for w in words)
    if has_do:
        return "do"
    if has_be:
        return "be"
    return None


def _finite(blocks: list[dict]) -> Optional[int]:
    """和「谁」对形状的那一块: 第一个 是 / 干什么 / 小帮手(not 不算),空格也算"""
    for i, b in enumerate(blocks):
        if b["r"] in ("d", "h") and b["t"].lower() != "not":
            return i
    return None


def _subject(blocks: list[dict]) -> Optional[int]:
    for i, b in enumerate(blocks):
        if b["r"] == "w" and not b.get("slot"):
            return i
    return None


def link(blocks: list[dict], mode: Optional[str] = None, show: bool = True) -> list[dict]:
    """给一排积木算形状(原地改并返回)。show=False 时不画形状(练到后面要撤掉这根拐杖)"""
    for b in blocks:
        b.pop("k", None)
        b.pop("ks", None)
    if not show:
        return blocks
    mode = mode or detect_mode(blocks)
    if mode is None:
        return blocks
    si, fi = _subject(blocks), _finite(blocks)
    # 头朝哪边: 正常「谁」在前,头朝右、口朝左;问句里倒过来
    flipped = si is not None and fi is not None and fi < si
    for i, b in enumerate(blocks):
        if b.get("slot"):
            continue
        k = _own_link(b["t"], b["r"])
        if b["r"] == "w":
            if i != si or fi is None:
                continue
            if mode == "do" and k != "t":
                continue            # 说「做什么」的句子里,只有他她它带头
            if k:
                b["k"], b["ks"] = k, ("l" if flipped else "r")
        elif b["r"] in ("d", "h"):
            if mode == "do" and k != "t":
                continue
            if k:
                b["k"], b["ks"] = k, ("r" if flipped and i == fi else "l")
    return blocks


def row(text: str, mode: Optional[str] = None, links: bool = True) -> list[dict]:
    return link(parse(text), mode, links)


def option_blocks(texts: list[str], mode: Optional[str], links: bool, side: str = "l", role: Optional[str] = None) -> list[dict]:
    """给孩子挑的几块。形状按它们自己的样子画,口朝 side 那边"""
    out = []
    for i, t in enumerate(texts):
        b = parse(t if role is None else f"{t}/{role}")[0]
        b["id"] = f"opt{i}"
        if links and mode:
            k = _own_link(b["t"], b["r"])
            if k and not (mode == "do" and k != "t"):
                b["k"], b["ks"] = k, side
        out.append(b)
    return out


def slot_side(blocks: list[dict]) -> str:
    """空格里那块的口该朝哪边"""
    si, fi = _subject(blocks), _finite(blocks)
    slot = next((i for i, b in enumerate(blocks) if b.get("slot")), None)
    if si is not None and slot is not None and slot == fi and slot < si:
        return "r"
    return "l"


def sentence(text: str) -> str:
    """一行写法 → 平常的句子: "He likes apples ." → "He likes apples." """
    words = [t.split("#")[0].rsplit("/", 1)[0] if "/" in t else t.split("#")[0] for t in text.split()]
    out = ""
    for w in words:
        w = w.replace("|", "").replace("_", " ")
        if w in PUNCT:
            out += w
        else:
            out += (" " if out else "") + w
    return out


# ---------- 配音文件名(后端发地址、出音频的脚本、测试,三处同一个算法) ----------

ZH_VOICE = "zh-CN-XiaoxiaoNeural"
ZH_RATE = "-6%"
EN_VOICE = "en-GB-SoniaNeural"
AUDIO_VERSION = 1
MEDIA_PREFIX = "/grammar-media/a"


def say_key(text: str) -> str:
    """一句讲解(中文里夹着 {英文})的文件名"""
    raw = f"say|{AUDIO_VERSION}|{ZH_VOICE}|{ZH_RATE}|{EN_VOICE}|{text.strip()}"
    return "s" + hashlib.sha1(raw.encode()).hexdigest()[:14]


def en_key(text: str) -> str:
    """一句英文(整句或一块)的文件名"""
    raw = f"en|{AUDIO_VERSION}|{EN_VOICE}|{text.strip()}"
    return "e" + hashlib.sha1(raw.encode()).hexdigest()[:14]


def say(text: str) -> dict:
    return {"text": text, "audio": f"{MEDIA_PREFIX}/{say_key(text)}.mp3"}


def en_audio(text: str) -> str:
    return f"{MEDIA_PREFIX}/{en_key(text)}.mp3"


_BRACE = re.compile(r"\{([^{}]*)\}")


def say_segments(text: str) -> list[tuple[str, str]]:
    """一句讲解拆成 [(zh|en, 文字)],出音频时中文、英文各用各的声音"""
    out: list[tuple[str, str]] = []
    pos = 0
    for m in _BRACE.finditer(text):
        if m.start() > pos:
            out.append(("zh", text[pos:m.start()]))
        out.append(("en", m.group(1)))
        pos = m.end()
    if pos < len(text):
        out.append(("zh", text[pos:]))
    return [(k, t.strip()) for k, t in out if re.search(r"\w", t)]
